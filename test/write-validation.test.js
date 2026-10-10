// VAL-01/D-13/D-14: proves the shared, generic, path-resolved write
// validation pipeline (validators/index.js#validationMiddleware, mounted
// once in server.js's consolidated /api gate) against the departments route
// (a representative ordinary write route, validators/workstream.js) and the
// deal-registry routes (validators/deals.js, Plan 04) — a malformed payload
// is rejected 400 with a single-string error naming the field path (never
// the submitted value); an unknown key is silently stripped before it ever
// reaches storage; the boundary is inclusive at both the maximum and the
// minimum; an absent/empty/null body is handled without a crash; string
// length limits are measured in JavaScript string units, not UTF-8 bytes;
// a multi-issue payload produces a stable, repeatable error string; two
// concurrent requests never observe each other's validated body; and the
// exact same schema rejects the exact same payload identically whether the
// session is demo-bound or bound to a real deal (D-14 — one pipeline).
//
// Boots the REAL requireable app against an ISOLATED temp trio of
// control.db/runtime.db/demo.db (db/dbFiles.js's MA_*_PATH env overrides),
// the same pattern test/deal-registry.test.js establishes.
//
// node:test — Node's built-in runner. Run via `node --test test/write-validation.test.js`.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-write-validation-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-write-validation-split-'));
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

// Seed real accounts directly (ARRAY_COLLECTIONS no longer carries `users`).
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

const app = require('../server.js');
const validators = require('../validators/index.js');

function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('write-validation (a): wrong type / missing required / over-length each 400 with a field-naming single-string error that never echoes the submitted value', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const missing = await post({});
    assert.strictEqual(missing.status, 400);
    const missingBody = await missing.json();
    assert.strictEqual(typeof missingBody.error, 'string');
    assert.match(missingBody.error, /name/i);

    const wrongType = await post({ name: 12345 });
    assert.strictEqual(wrongType.status, 400);
    const wrongTypeBody = await wrongType.json();
    assert.match(wrongTypeBody.error, /name/i);

    const SECRET_TARGET = 'PreAnnouncement Secret Target Ltd — MNPI';
    const overLong = await post({ name: SECRET_TARGET + 'x'.repeat(301) });
    assert.strictEqual(overLong.status, 400);
    const overLongBody = await overLong.json();
    assert.match(overLongBody.error, /name/i);
    assert.ok(!overLongBody.error.includes(SECRET_TARGET), 'the 400 error must never echo the submitted value (T-03-34)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('write-validation (b): an unknown key is silently stripped and never appears in the stored row', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Stripped Key Dept', evilField: '<script>alert(1)</script>' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.department.evilField, undefined);

    const listRes = await fetch(`http://127.0.0.1:${port}/api/departments`, { headers: { Cookie: cookieHeader(token) } });
    const list = await listRes.json();
    const stored = list.find((d) => d.name === 'Stripped Key Dept');
    assert.ok(stored, 'the department must have been stored');
    assert.strictEqual(stored.evilField, undefined, 'the unknown key must not be present in the stored row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('write-validation (c): the boundary is inclusive at the maximum and the minimum', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const atMax = await post({ name: 'x'.repeat(300) });
    assert.strictEqual(atMax.status, 200, 'exactly 300 characters (the declared max) must be accepted');

    const overMax = await post({ name: 'x'.repeat(301) });
    assert.strictEqual(overMax.status, 400, 'one character over the max must be rejected');

    const atMin = await post({ name: 'x' });
    assert.strictEqual(atMin.status, 200, 'a single character (the declared min) must be accepted');

    const underMin = await post({ name: '' });
    assert.strictEqual(underMin.status, 400, 'an empty string must be rejected (below the min)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('write-validation (d): an absent, empty-object and null body all 400 without crashing for a required-field schema; an all-optional schema accepts an empty object', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();

    const noBody = await fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(noBody.status, 400);
    assert.strictEqual(typeof (await noBody.json()).error, 'string');

    const emptyObj = await fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(emptyObj.status, 400);

    const nullBody = await fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(null),
    });
    assert.strictEqual(nullBody.status, 400);

    // EmptyBodySchema (every DELETE route) is the all-optional case: an
    // empty object must be accepted, never a crash.
    const emptySchemaResult = validators.EmptyBodySchema.safeParse({});
    assert.ok(emptySchemaResult.success, 'an all-optional schema must accept an empty object');

    const deleteRes = await fetch(`http://127.0.0.1:${port}/api/departments/nonexistent-id`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(deleteRes.status, 200, 'a bodyless write route (EmptyBodySchema) must accept an absent body without crashing');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('write-validation (e): string length limits are measured in JavaScript string units (UTF-16 code units), not UTF-8 bytes', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    // 'é' is ONE JS string unit but TWO UTF-8 bytes — 300 of them is exactly
    // at the declared max in JS string length (300) yet 600 bytes in UTF-8,
    // well over 300. A byte-based limit would reject this; a JS-string-unit
    // limit (what zod actually applies) must accept it.
    const name = 'é'.repeat(300);
    assert.strictEqual(name.length, 300);
    assert.strictEqual(Buffer.byteLength(name, 'utf8'), 600);

    const res = await fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    assert.strictEqual(res.status, 200, 'a value at the JS-string-unit max (even if its UTF-8 byte length exceeds the number) must be accepted');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('write-validation (f): a multi-issue payload produces a stable, repeatable error string', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const badBody = { name: '', targetCompany: '', members: 'not-an-array' };
    const post = () => fetch(`http://127.0.0.1:${port}/api/deals`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(badBody),
    });

    const first = await post();
    assert.strictEqual(first.status, 400);
    const firstBody = await first.json();

    const second = await post();
    assert.strictEqual(second.status, 400);
    const secondBody = await second.json();

    assert.strictEqual(firstBody.error, secondBody.error, 'repeating the identical request must produce a byte-identical error string');
    // Three independently-checkable problems in this payload — name,
    // targetCompany and members — must all be represented.
    assert.match(firstBody.error, /name/i);
    assert.match(firstBody.error, /targetCompany/i);
    assert.match(firstBody.error, /members/i);
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('write-validation (g): two concurrent requests with different payloads each receive their own validated body', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const [validRes, invalidRes] = await Promise.all([
      post({ name: 'Concurrent Alpha Dept' }),
      post({ evilField: 'no name at all' }),
    ]);
    assert.strictEqual(validRes.status, 200, 'the valid concurrent request must succeed on its own merits');
    const validBody = await validRes.json();
    assert.strictEqual(validBody.department.name, 'Concurrent Alpha Dept', 'the valid request must see its OWN validated body, not the other request\'s');
    assert.strictEqual(invalidRes.status, 400, 'the invalid concurrent request must be refused on its own merits');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('write-validation: parametrized sweep — an unknown key + one invalid field 400s naming the field, and the group\'s known-good payload still succeeds with its original response shape, across every resource group', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const call = (method, urlPath, body) => fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const cases = [
      {
        group: 'cms', path: '/api/courses',
        invalid: { evilField: '<script>x</script>' }, invalidFieldPattern: /title/i,
        valid: { title: { en: 'Sweep Course' } }, assertValid: (b) => assert.strictEqual(b.course.title.en, 'Sweep Course'),
      },
      {
        group: 'workstream', path: '/api/raid',
        invalid: { evilField: 'x' }, invalidFieldPattern: /title/i,
        valid: { title: 'Sweep Risk' }, assertValid: (b) => assert.strictEqual(b.entry.title, 'Sweep Risk'),
      },
      {
        group: 'people', path: '/api/hrbps',
        invalid: { evilField: 'x', name: 'No Email' }, invalidFieldPattern: /email/i,
        valid: { name: 'Sweep Leader', email: 'sweep@example.com' }, assertValid: (b) => assert.strictEqual(b.hrbp.name, 'Sweep Leader'),
      },
      {
        group: 'assessment', path: '/api/questions',
        invalid: { evilField: 'x', text: 'No Dimension' }, invalidFieldPattern: /dimension/i,
        valid: { text: 'Sweep Question', dimension: 'culture' }, assertValid: (b) => assert.strictEqual(b.question.text, 'Sweep Question'),
      },
      {
        group: 'settings', path: '/api/settings/time-travel',
        invalid: { evilField: 'x' }, invalidFieldPattern: /day/i,
        valid: { day: 30 }, assertValid: (b) => assert.strictEqual(b.timeTravelDay, 30),
      },
    ];

    for (const c of cases) {
      const invalidRes = await call('POST', c.path, c.invalid);
      assert.strictEqual(invalidRes.status, 400, `${c.group} (${c.path}) must 400 an unknown-key+invalid-field payload`);
      const invalidBody = await invalidRes.json();
      assert.match(invalidBody.error, c.invalidFieldPattern, `${c.group} (${c.path}) 400 must name the invalid field`);

      const validRes = await call('POST', c.path, c.valid);
      assert.ok(validRes.status === 200 || validRes.status === 201, `${c.group} (${c.path}) must still accept its known-good payload, got ${validRes.status}`);
      const validBody = await validRes.json();
      assert.strictEqual(validBody.success, true, `${c.group} (${c.path}) must keep its original { success: true, ... } response shape`);
      c.assertValid(validBody);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('write-validation (h): the same schema rejects the same payload identically for a demo-bound and a deal-bound session (D-14)', async () => {
  const demoToken = newSession('karen', 'hrbp');
  const dealToken = newSession('karen2', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const createRes = await fetch(`http://127.0.0.1:${port}/api/deals`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(dealToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Parity Deal', targetCompany: 'Parity Co' }),
    });
    const { deal } = await createRes.json();
    const selectRes = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(dealToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(selectRes.status, 200);

    const badBody = { evilField: 'still no name' };
    const post = (token) => fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(badBody),
    });

    const demoRes = await post(demoToken);
    const dealRes = await post(dealToken);
    assert.strictEqual(demoRes.status, 400);
    assert.strictEqual(dealRes.status, 400);
    const demoBody = await demoRes.json();
    const dealBody = await dealRes.json();
    assert.strictEqual(demoBody.error, dealBody.error, 'the exact same malformed payload must produce the exact same rejection whether the session is demo-bound or bound to a real deal');
  } finally {
    sessionsDb.deleteSession(runtimeConn, demoToken);
    sessionsDb.deleteSession(runtimeConn, dealToken);
    server.close();
  }
});

// CR-02 (code review 03-REVIEW.md): DEMO_OPEN=1's isOpenMode() short-circuit
// in server.js's consolidated /api gate must bypass auth/authz ONLY — it
// must NOT also skip validationMiddleware (VAL-01/VAL-02). Before the fix,
// this exact payload against POST /api/i18n returned 200 success with zero
// session under DEMO_OPEN=1; the same payload under normal auth mode has
// always 400'd (proven by the demoRes/dealRes assertions above, D-14).
test('write-validation (i) / CR-02: DEMO_OPEN=1 still 400s a malformed write payload — the validation pipeline is not part of the auth bypass', async () => {
  const originalDemoOpen = process.env.DEMO_OPEN;
  process.env.DEMO_OPEN = '1';
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    // No cookie at all — under DEMO_OPEN an unbound request resolves to
    // demo.db and req.portalUser is null, never consulted (AUTH-04).
    const res = await fetch(`http://127.0.0.1:${port}/api/i18n`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 123, key: null, value: { x: 1 }, junk: 'field' }),
    });
    assert.strictEqual(res.status, 400, 'a malformed payload must still be rejected by validationMiddleware even under DEMO_OPEN=1');
    const body = await res.json();
    assert.strictEqual(typeof body.error, 'string');
  } finally {
    if (originalDemoOpen === undefined) delete process.env.DEMO_OPEN;
    else process.env.DEMO_OPEN = originalDemoOpen;
    server.close();
  }
});
