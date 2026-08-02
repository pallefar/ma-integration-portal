// CR-01 (code review 03-REVIEW.md): POST /api/rag/upload threw
// `ReferenceError: db is not defined` on every call — commit 333da21 moved
// the secret lookup to controlStore.getSecretSettings() but deleted the
// `const db = readDb();` line without updating the three call sites below it
// that still reference `db` (db.ragUploads = ...; db.ragUploads.push(...);
// writeDb(db);). This regression had ZERO test coverage — that's how it
// shipped. This suite proves the happy path: a valid PDF upload extracts
// text, runs the (API-key-less, so purely local/deterministic) AI Insight
// review, and persists a new row into ragUploads (db/collections.js), which
// is readable back out of demo.db directly.
//
// Boots the REAL requireable app against an ISOLATED temp trio of
// control.db/runtime.db/demo.db (db/dbFiles.js's MA_*_PATH env overrides),
// the same pattern test/write-validation.test.js establishes.
//
// node:test — Node's built-in runner. Run via `node --test test/rag-upload.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-rag-upload-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-rag-upload-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH);

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR });

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');

const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const demoConn = store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);

// Seed real accounts directly (ARRAY_COLLECTIONS no longer carries `users`).
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

const app = require('../server.js');

function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}

// A hand-built, minimal-but-valid single-page PDF (no external fixture file
// needed) whose text stream extracts cleanly via pdf-parse — verified
// directly against the installed pdf-parse@2 class API before writing this
// test. Deliberately tiny so the suite stays fast and self-contained.
const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 61 >>
stream
BT /F1 24 Tf 100 700 Td (Integration Guidelines Test PDF) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;
const MINIMAL_PDF_BASE64 = `data:application/pdf;base64,${Buffer.from(MINIMAL_PDF, 'utf8').toString('base64')}`;

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('CR-01: POST /api/rag/upload persists a new ragUploads row instead of throwing ReferenceError: db is not defined', async () => {
  const token = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/rag/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'test-policy.pdf', fileData: MINIMAL_PDF_BASE64 }),
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.strictEqual(body.success, true);
    assert.ok(body.upload, 'response must include the persisted upload record');
    assert.strictEqual(body.upload.fileName, 'test-policy.pdf');
    assert.ok(body.upload.id, 'the persisted upload must have an id');

    // Persistence must be REAL, not just an in-memory response — read the
    // row back directly out of demo.db (the request was made with no deal
    // bound, so it resolves to demo.db per D-01/D-02).
    const row = demoConn.prepare('SELECT data FROM ragUploads WHERE id = ?').get(body.upload.id);
    assert.ok(row, 'the upload must actually be persisted in ragUploads, not lost to the ReferenceError this regression caused');
    const stored = JSON.parse(row.data);
    assert.strictEqual(stored.fileName, 'test-policy.pdf');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('CR-01: a second upload persists as its own independent row (no stale/shared handler-scope state)', async () => {
  const token = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const post = () => fetch(`http://127.0.0.1:${port}/api/rag/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'second-policy.pdf', fileData: MINIMAL_PDF_BASE64 }),
    });

    const firstBody = await (await post()).json();
    const secondBody = await (await post()).json();
    assert.strictEqual(firstBody.success, true);
    assert.strictEqual(secondBody.success, true);
    assert.notStrictEqual(firstBody.upload.id, secondBody.upload.id, 'each upload must get its own id');

    const count = demoConn.prepare('SELECT COUNT(*) AS n FROM ragUploads').get().n;
    assert.ok(count >= 2, `expected at least 2 persisted ragUploads rows, got ${count}`);
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});
