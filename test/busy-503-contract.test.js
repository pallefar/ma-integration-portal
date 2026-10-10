// D-06/D-11/CONC-01 (Phase 8, Plan 03): the permanent coverage gate for
// "one central middleware covers every write path." Mirrors
// test/write-validation-coverage.test.js's discipline exactly: assert
// against the LIVE app and the LIVE source, never a hand-maintained list,
// and name the offenders in the failure message so a future developer sees
// exactly which route broke the contract.
//
// WHY the structural scan exists: 08-RESEARCH.md found that local
// try/catch blocks in server.js can silently convert a retryable
// SQLITE_BUSY* error into a hand-written 500 with no Retry-After — closing
// that hole once (plan 08-03's Task 1) is not the same as keeping it
// closed. A future route that wraps a storage call in its own catch and
// forgets the re-throw guard reopens exactly this hole; this test turns
// that red instead of shipping silently.
//
// WHY real contention, not a stub: server.js destructures
// `const { initDb, readDb, writeDb, getOrOpenConnection } = require('./db/store')`
// at require time (server.js:694-ish) — replacing db/store.js's module
// export afterwards has no effect on the already-bound references the route
// handlers closed over. A synthetic-throw stub cannot reach them. Real
// cross-process contention (a second OS process holding BEGIN IMMEDIATE) is
// the only injection mechanism that actually exercises the live code path
// — the same lesson test/concurrency-busy-retry.test.js (plan 08-01) already
// encoded for its own end-to-end proof.
//
// node:test — run via `node --test test/busy-503-contract.test.js`.

'use strict';

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('node:child_process');

// ---------------------------------------------------------------------------
// Part 1: structural coverage — scanned from the LIVE server.js source text,
// not a hand-maintained list of line numbers or route paths.
// ---------------------------------------------------------------------------

// The same six storage-layer call prefixes plan 08-03's Task 1 enumerated
// (PLAN.md's own literal list) — deliberately broad (matches ANY
// `controlStore.` call, not just writes) rather than trying to hand-classify
// read vs write among them; a defensive guard on a read call is harmless,
// missing one on a write call is not.
const STORAGE_CALL_RE = /\b(writeDb\(|controlStore\.|sessions\.|dealSeed\.|createDealDatabase\(|recordSecurityEvent\()/;

/**
 * Character-index brace matching from `openIdx` (which must point at a `{`)
 * to its balanced closing `}`. Braces inside template-literal `${...}`
 * expressions are still balanced pairs, so naive character counting stays
 * correct for this file's style (verified against every site below).
 * @param {string} src
 * @param {number} openIdx
 * @returns {number} index of the matching `}`, or -1
 */
function braceMatch(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Walks the live server.js source and returns every top-level `try { ... }
 * catch (...) { ... }` block whose TRY body reaches one of the six
 * storage-layer call prefixes above. For each, reports whether the CATCH
 * body carries the `isBusyError(` re-throw/forward guard. Mirrors the exact
 * brace-depth scan plan 08-03's own PLAN.md instructed for Task 1's audit
 * pass, so Task 1's fix scope and this gate's assertion scope can never
 * silently drift apart.
 * @param {string} source
 * @returns {{line:number, call:string, hasGuard:boolean}[]}
 */
function findStorageCatchSites(source) {
  const sites = [];
  let i = 0;
  while (true) {
    const tryIdx = source.indexOf('try', i);
    if (tryIdx === -1) break;
    const prevChar = source[tryIdx - 1];
    // Skip identifier fragments (e.g. a hypothetical "retry") — 'try' must
    // start a fresh token.
    if (prevChar && /[A-Za-z0-9_]/.test(prevChar)) {
      i = tryIdx + 3;
      continue;
    }
    const afterTry = source.slice(tryIdx + 3);
    const leadingWs = /^\s*/.exec(afterTry)[0];
    const braceIdx = tryIdx + 3 + leadingWs.length;
    if (source[braceIdx] !== '{') {
      i = tryIdx + 3;
      continue;
    }
    const tryBodyEnd = braceMatch(source, braceIdx);
    if (tryBodyEnd === -1) {
      i = tryIdx + 3;
      continue;
    }
    const tryBody = source.slice(tryIdx, tryBodyEnd + 1);

    // Locate the immediately-following `catch (...) { ... }` clause.
    let k = tryBodyEnd + 1;
    const wsAfterTry = /^\s*/.exec(source.slice(k))[0];
    k += wsAfterTry.length;
    const catchHeaderMatch = /^catch\s*\([^)]*\)\s*\{/.exec(source.slice(k));
    let catchBody = '';
    let nextScan = tryBodyEnd + 1;
    if (catchHeaderMatch) {
      const catchBraceIdx = k + catchHeaderMatch[0].length - 1;
      const catchBodyEnd = braceMatch(source, catchBraceIdx);
      if (catchBodyEnd !== -1) {
        catchBody = source.slice(k, catchBodyEnd + 1);
        nextScan = catchBodyEnd + 1;
      }
    }

    const callMatch = STORAGE_CALL_RE.exec(tryBody);
    if (callMatch) {
      const line = source.slice(0, tryIdx).split('\n').length;
      sites.push({
        line,
        call: callMatch[1],
        hasGuard: /isBusyError\(/.test(catchBody),
      });
    }
    i = nextScan;
  }
  return sites;
}

/**
 * Every `app.(post|put|patch|delete)(..., async (req, res[, next]) => { ...
 * })` handler registered in server.js, and whether its body forwards a
 * rejection to the error chain via `next(e)`, `next(err)`, or `.catch(next)`
 * — Express 4 (this project's pinned version) does not auto-forward a
 * rejected promise from an async handler the way it does a thrown
 * synchronous error (08-RESEARCH.md Pitfall 2). Same regex shape PLAN.md's
 * own <verify> block uses for this exact check.
 * @param {string} source
 * @returns {{handler:string, forwards:boolean}[]}
 */
function findAsyncWriteHandlers(source) {
  const matches = source.match(/app\.(post|put|patch|delete)\([^\n]*async[\s\S]*?\n\}\);/g) || [];
  return matches.map((body) => {
    const headerLine = body.split('\n')[0];
    return {
      handler: headerLine.trim(),
      forwards: /next\(e\)|next\(err\)|\.catch\(next\)/.test(body),
    };
  });
}

const SERVER_SRC_PATH = path.join(__dirname, '..', 'server.js');

test('busy-503-contract (structural): every storage-wrapping catch in server.js carries the isBusyError() re-throw/forward guard', () => {
  const src = fs.readFileSync(SERVER_SRC_PATH, 'utf8');
  const sites = findStorageCatchSites(src);
  assert.ok(sites.length > 0, 'the structural scan matched zero try/catch sites — it must fail loudly rather than pass vacuously if the scan itself breaks');
  const violations = sites.filter((s) => !s.hasGuard);
  assert.deepStrictEqual(
    violations,
    [],
    `The following catch site(s) wrap a storage call but lack the isBusyError() re-throw/forward guard:\n${violations.map((v) => `  server.js:${v.line} (${v.call.replace(/\($/, '(...)')})`).join('\n')}`,
  );
});

test('busy-503-contract (structural): every async write handler in server.js forwards a rejection to the error chain', () => {
  const src = fs.readFileSync(SERVER_SRC_PATH, 'utf8');
  const handlers = findAsyncWriteHandlers(src);
  assert.ok(handlers.length > 0, 'the async-handler scan matched zero registered async write handlers — it must fail loudly rather than pass vacuously if the scan itself breaks');
  const violations = handlers.filter((h) => !h.forwards);
  assert.deepStrictEqual(
    violations,
    [],
    `The following async write handler(s) do not forward a rejection to the error chain (next(e)/next(err)/.catch(next)):\n${violations.map((v) => `  ${v.handler}`).join('\n')}`,
  );
});

test('busy-503-contract (structural): the live write-route inventory is non-empty', () => {
  const app = require('../server.js');
  const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const stack = (app._router && app._router.stack) || [];
  const routes = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
    for (const m of methods) {
      const method = m.toUpperCase();
      if (!WRITE_METHODS.has(method)) continue;
      if (!layer.route.path.startsWith('/api')) continue;
      routes.push(`${method} ${layer.route.path}`);
    }
  }
  assert.ok(routes.length > 0, 'app._router.stack enumeration matched zero write routes — a scan matching nothing must fail, not pass vacuously');
});

// ---------------------------------------------------------------------------
// Part 2 & 3: live contention + negative control. Boots the real requireable
// app (`require('../server.js')`) against an ISOLATED temp trio of
// control/runtime/demo files (never the live committed data/*.db) — mirrors
// test/concurrency-busy-retry.test.js's (plan 08-01) established harness
// exactly, including its lock-holding child-process pattern.
// ---------------------------------------------------------------------------

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-busy-503-contract-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-busy-503-contract-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH); // seeds full non-account fixture data (questions, etc.)

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR }); // fans out to TMP_DIR/{control,demo,runtime}.db

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
// D-10-04 / COLLAB-02: the gate re-reads the account per request, so a
// directly-created session needs a matching control.db account.
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const { ensureUser } = require('./helpers/seed-identity.js');

const app = require('../server.js');

function cookieHeader(token) {
  return `ma_session=${token}`;
}

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Inline child script (node -e): opens the SAME demo.db file the parent's
// no-dealId session resolves to (db/resolver.js: no dealId -> DEMO_DB_PATH),
// acquires BEGIN IMMEDIATE directly, prints a readiness line once the lock
// is held, then releases after `holdMs`. Verbatim pattern from
// test/concurrency-busy-retry.test.js (plan 08-01).
const DB_FILES_ABS_PATH = path.join(__dirname, '..', 'db', 'dbFiles.js');
const LOCK_HOLDER_SCRIPT = `
  const dbFiles = require(${JSON.stringify(DB_FILES_ABS_PATH)});
  const dbPath = process.argv[1];
  const holdMs = parseInt(process.argv[2], 10);
  const conn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  conn.exec('BEGIN IMMEDIATE');
  console.log('READY');
  setTimeout(() => {
    conn.exec('COMMIT');
    conn.close();
  }, holdMs);
`;

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('lock holder child never reported READY within 5s'));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
    }
    function onData(chunk) {
      buf += chunk.toString();
      if (buf.includes('READY')) {
        cleanup();
        resolve();
      }
    }
    child.stdout.on('data', onData);
    child.once('error', (e) => { cleanup(); reject(e); });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
  });
}

test('busy-503-contract (live contention): three routes — one plain sync write, one async write, and one Task-1-patched catch site — all return 503 + Retry-After under real cross-process contention, never a leaked detail', async () => {
  // Comfortably longer than three sequential ~1000ms busy_timeout waits, with
  // extra margin for scheduling jitter when other parallel test/build
  // processes are competing for CPU on the same host (this plan runs
  // alongside sibling worktree agents) — a tight margin here would make the
  // LAST of the three sequential requests occasionally land after the lock
  // already released, turning a real assertion into a flaky one.
  const HOLD_MS = 9000;
  const child = spawn(process.execPath, ['-e', LOCK_HOLDER_SCRIPT, '--', dbFiles.DEMO_DB_PATH, String(HOLD_MS)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const childExited = waitForExit(child);

  let server;
  let token;
  let adminToken;
  try {
    await waitForReady(child);

    // A session with NO dealId — db/resolver.js's resolveDatabase() binds
    // this to DEMO_DB_PATH, the exact file the child above is holding the
    // write lock on. 'hrbp' covers the write policy for all three routes
    // below (DEFAULT_WRITE_ROLES for /api/questions; the explicit
    // /api/assessment entry also allows it; /api/media is admin-only — see
    // the admin identity minted below).
    ensureUser(controlConn, { username: 'busy-503-contract-test', role: 'hrbp' });
    token = sessionsDb.createSession(runtimeConn, { username: 'busy-503-contract-test', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
    // D-11-02 (Phase 11): POST /api/media is admin-only now, so the media
    // probe (3) below runs as an admin identity. The contract under test —
    // a contended write returns the fixed 503 — is independent of the role.
    ensureUser(controlConn, { username: 'busy-503-contract-admin', role: 'admin' });
    adminToken = sessionsDb.createSession(runtimeConn, { username: 'busy-503-contract-admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
    server = await listenLocal(app);
    const { port } = server.address();

    async function assertBusy503(label, res) {
      assert.strictEqual(res.status, 503, `${label}: a write contended by a real second OS process must return 503, never a hang/leaked/generic 500`);
      assert.ok(res.headers.get('retry-after'), `${label}: the 503 response must carry a Retry-After header`);
      const body = await res.json();
      const bodyText = JSON.stringify(body);
      // T-08-01 (Information Disclosure): never echo a SQLite error string,
      // a filesystem path, or the resolved database file path.
      assert.ok(!/SQLITE/i.test(bodyText), `${label}: 503 body must never echo a SQLite error string`);
      assert.ok(!bodyText.includes(TMP_DIR), `${label}: 503 body must never echo a filesystem path`);
      assert.ok(!bodyText.includes(dbFiles.DEMO_DB_PATH), `${label}: 503 body must never echo the resolved db file path`);
      assert.deepStrictEqual(body, { error: 'Server is busy. Please try again.' }, `${label}: 503 body must be the fixed generic literal`);
    }

    // (1) plain synchronous write route — NO local catch in server.js at
    // all; Express 4's own auto-forwarding of a thrown sync error must
    // reach the central middleware unaided.
    const questionsRes = await fetch(`http://127.0.0.1:${port}/api/questions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Busy-503 contract probe question', dimension: 'culture' }),
    });
    await assertBusy503('POST /api/questions (plain sync, unguarded route)', questionsRes);

    // (2) async write route — plan 08-03 Task 1 added the `next` parameter
    // and next(e) forwarding here; this is the case Express 4 does NOT
    // handle for free (08-RESEARCH.md Pitfall 2).
    const assessmentRes = await fetch(`http://127.0.0.1:${port}/api/assessment`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses: { q1: 4 } }),
    });
    await assertBusy503('POST /api/assessment (async, Task-1-patched)', assessmentRes);

    // (3) a route whose local catch Task 1 patched (sync) — proves the
    // re-throw guard survives alongside the route's OWN unrelated
    // (filesystem) error handling.
    const mediaRes = await fetch(`http://127.0.0.1:${port}/api/media`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'busy-503-contract-probe.txt', fileData: 'data:text/plain;base64,cHJvYmU=' }),
    });
    await assertBusy503('POST /api/media (sync, Task-1-patched catch)', mediaRes);

    await childExited;
  } finally {
    if (adminToken) {
      try { sessionsDb.deleteSession(runtimeConn, adminToken); } catch (e) { /* ignore */ }
    }
    if (token) {
      try { sessionsDb.deleteSession(runtimeConn, token); } catch (e) { /* ignore */ }
    }
    if (server) server.close();
    if (child.exitCode === null && !child.killed) {
      try { child.kill(); } catch (e) { /* ignore */ }
    }
    // Best-effort cleanup of the file POST /api/media wrote to disk before
    // hitting the contended writeDb() call — public/uploads/ is gitignored,
    // but tidy up regardless.
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
    try {
      for (const f of fs.readdirSync(uploadsDir)) {
        if (f.includes('busy-503-contract-probe')) fs.unlinkSync(path.join(uploadsDir, f));
      }
    } catch (e) { /* ignore */ }
  }
});

test('busy-503-contract (negative control): a validation failure still returns 400, and a non-contention server error still returns the existing generic 500 — the gate cannot pass by turning everything into a 503', async () => {
  // No lock held anywhere in this test — every response below must come
  // from ordinary (non-contended) request handling.
  ensureUser(controlConn, { username: 'busy-503-contract-negctl', role: 'hrbp' });
  const token = sessionsDb.createSession(runtimeConn, { username: 'busy-503-contract-negctl', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();

    // 400: the SAME write route the live-contention test above patched
    // (POST /api/rag/upload's async catch), driven with a body that fails
    // validators/settings.js's RagUploadSchema (both fields required).
    const badRes = await fetch(`http://127.0.0.1:${port}/api/rag/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(badRes.status, 400, 'a schema-validation failure must still return 400, not be swept into the busy/503 path');
    const badBody = await badRes.json();
    assert.ok(typeof badBody.error === 'string' && badBody.error.length > 0, 'the 400 body must carry the existing single-string error shape');

    // 500: the SAME route, driven with a body that PASSES validation
    // (non-empty fileData) but fails PDF parsing — a genuine, non-contention
    // server error. Proves Task 1's isBusyError() guard is selective: it
    // must NOT convert every error into a 503, only busy ones.
    const badPdfRes = await fetch(`http://127.0.0.1:${port}/api/rag/upload`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'not-a-real.pdf', fileData: 'this-is-not-valid-pdf-base64-content-at-all' }),
    });
    assert.strictEqual(badPdfRes.status, 500, 'a genuine non-contention server error must still return the existing 500, not a 503');
    assert.ok(!badPdfRes.headers.get('retry-after'), 'a non-contention 500 must never carry a Retry-After header');
    const badPdfBody = await badPdfRes.json();
    assert.deepStrictEqual(badPdfBody, { success: false, error: 'Failed to process and train RAG model.' }, 'the non-contention 500 body must be the existing, unchanged generic message');
  } finally {
    try { sessionsDb.deleteSession(runtimeConn, token); } catch (e) { /* ignore */ }
    server.close();
  }
});
