// D-11-05 / AUTHZ-05 (Phase 11, plan 11-04) — every authorization denial is a
// rate-bounded `access-denied` security event.
//
// Two layers:
//   1. UNIT — lib/denialAudit.js with a fake clock and an in-memory writer:
//      first denial writes (count 1), the rest of the window is only counted,
//      the folded count is written ONCE as the next row, <= 1 row per key per
//      window, route-template keys, capped key map, failed write loses nothing,
//      and the module issues no SQL update (audit.db is append-only, AUD-02).
//   2. LIVE — the real app against an ISOLATED temp control/runtime/demo/deals/
//      audit set (MA_* paths; the committed data/*.db is never opened):
//      gate 401/403, resolver 403 and clearance-404 rows, byte-identical
//      responses, variant spellings sharing one canonical route.
//
// Each live scenario uses its own account / route / reason so the shared
// process-wide auditor window state never couples two scenarios (a probe that
// "must produce exactly one row" never follows another scenario hitting the
// same actor+route+reason).
//
// node:test — run via `node --test test/denial-audit.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-denial-audit-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const { createDenialAuditor } = require('../lib/denialAudit');
const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const auditHook = require('../db/auditHook.js');
const app = require('../server.js');
const { createDealFixture } = require('./helpers/deal-fixture');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  app.denialAuditor.stopSweeper();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 1. UNIT
// ---------------------------------------------------------------------------

function unitAuditor(opts) {
  const clock = { t: 1_000_000 };
  const rows = [];
  const auditor = createDenialAuditor(Object.assign({
    now: () => clock.t,
    write: (e) => rows.push(e),
    templateFor: (p) => p,
  }, opts || {}));
  return { auditor, clock, rows };
}
const probe = (over) => Object.assign({
  actor: { username: 'u1', role: 'pmo' }, method: 'GET', path: '/api/x', reason: 'role-read', status: 403,
}, over || {});

test('unit: first denial writes count 1; 49 more inside 60 s write nothing; sweep writes ONE folded row of 49', () => {
  const { auditor, clock, rows } = unitAuditor();
  assert.strictEqual(auditor.record(probe()), true);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].action, 'access-denied');
  assert.strictEqual(rows[0].after.count, 1);
  assert.strictEqual(rows[0].after.folded, false);
  assert.strictEqual(rows[0].subject, 'GET /api/x');
  for (let i = 0; i < 49; i += 1) {
    clock.t += 500; // 24.5 s total — all inside the window
    assert.strictEqual(auditor.record(probe()), false);
  }
  assert.strictEqual(rows.length, 1, '50 identical probes inside 60 s = exactly ONE row');
  clock.t += 60000;
  assert.strictEqual(auditor.sweep(), 1);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].after.count, 49);
  assert.strictEqual(rows[1].after.folded, true);
  assert.strictEqual(auditor.sweep(), 0, 'nothing pending: a second sweep writes nothing');
  const total = rows.reduce((n, r) => n + r.after.count, 0);
  assert.strictEqual(total, 50, 'no denial is lost: row counts add up to the probe count');
});

test('unit: <= 1 row per key per window across many windows; counts always add up', () => {
  const { auditor, clock, rows } = unitAuditor();
  let sent = 0;
  const start = clock.t;
  for (let s = 0; s < 600; s += 1) { // 1 probe/second for 10 minutes
    auditor.record(probe());
    sent += 1;
    clock.t += 1000;
  }
  auditor.sweep();
  clock.t += 60000;
  auditor.sweep();
  const windows = Math.ceil((clock.t - start) / 60000);
  assert.ok(rows.length <= windows + 1, `rows ${rows.length} must stay within the window count ${windows}`);
  assert.ok(rows.length >= 2);
  assert.strictEqual(rows.reduce((n, r) => n + r.after.count, 0), sent);
});

test('unit: a different actor, method, route or reason is a different key (own first row)', () => {
  const { auditor, rows } = unitAuditor();
  auditor.record(probe());
  auditor.record(probe({ actor: { username: 'u2', role: 'pmo' } }));
  auditor.record(probe({ method: 'POST' }));
  auditor.record(probe({ path: '/api/y' }));
  auditor.record(probe({ reason: 'role-write' }));
  assert.strictEqual(rows.length, 5);
  assert.strictEqual(auditor.size(), 5);
});

test('unit: anonymous actor is named (anonymous) with a non-null role (audit_log.actor_role is NOT NULL)', () => {
  const { auditor, rows } = unitAuditor();
  auditor.record(probe({ actor: null, reason: 'no-session', status: 401 }));
  assert.strictEqual(rows[0].actor.username, '(anonymous)');
  assert.ok(rows[0].actor.role, 'role must be a non-empty string');
});

test('unit: random ids on one route template share ONE rate key (keys bounded by templates, not ids)', () => {
  const { auditor, rows } = unitAuditor({
    templateFor: (p) => p.replace(/^(\/api\/raid)\/[^/]+$/, '$1/:id'),
  });
  for (let i = 0; i < 200; i += 1) {
    auditor.record(probe({ method: 'DELETE', path: `/api/raid/rnd_${i}_${Math.random().toString(36).slice(2)}`, status: 404, reason: 'clearance-404' }));
  }
  assert.strictEqual(auditor.size(), 1);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].subject, 'DELETE /api/raid/:id');
});

test('unit: the key map is size-capped; excess keys fold into a per-reason (overflow) key and are counted', () => {
  const { auditor, rows } = unitAuditor({ maxKeys: 3 });
  for (let i = 0; i < 20; i += 1) {
    auditor.record(probe({ actor: { username: `flood${i}`, role: 'pmo' } }));
  }
  assert.ok(auditor.size() <= 4, `size ${auditor.size()} must stay at the cap plus one overflow key per reason`);
  const overflow = rows.filter((r) => r.actor.username === '(overflow)');
  assert.strictEqual(overflow.length, 1, 'the overflow key writes its own first row once per window');
  auditor.flushAll();
  const total = rows.reduce((n, r) => n + r.after.count, 0);
  assert.strictEqual(total, 20, 'overflowed denials are still counted');
});

test('unit: a failing write is never swallowed and loses no pending count', () => {
  let fail = false;
  const rows = [];
  const clock = { t: 5 };
  const auditor = createDenialAuditor({
    now: () => clock.t,
    templateFor: (p) => p,
    write: (e) => { if (fail) throw new Error('SQLITE_BUSY'); rows.push(e); },
  });
  auditor.record(probe());
  auditor.record(probe());
  auditor.record(probe());
  clock.t += 60000;
  fail = true;
  assert.throws(() => auditor.sweep(), /SQLITE_BUSY/);
  assert.throws(() => auditor.record(probe({ actor: { username: 'fresh', role: 'pmo' } })), /SQLITE_BUSY/);
  fail = false;
  auditor.sweep();
  assert.strictEqual(rows.reduce((n, r) => n + r.after.count, 0), 3, 'the 2 folded denials were written after recovery');
  assert.strictEqual(auditor.size(), 1, 'the failed fresh key left nothing half-recorded in memory');
});

test('unit: lib/denialAudit.js issues no SQL update (AUD-02 append-only; comments may name the trigger)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'denialAudit.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.strictEqual((code.match(/UPDATE/g) || []).length, 0);
  assert.strictEqual((code.match(/DELETE\s+FROM/gi) || []).length, 0);
  assert.strictEqual((code.match(/\.prepare\(|\.exec\(/g) || []).length, 0, 'no SQL of any kind: the writer is injected');
  assert.strictEqual(typeof createDenialAuditor, 'function');
});

// ---------------------------------------------------------------------------
// 2. LIVE
// ---------------------------------------------------------------------------

function denialRows(where, params) {
  const conn = auditHook.getAuditConnection();
  return conn.prepare(
    `SELECT * FROM audit_log WHERE action = 'access-denied'${where ? ' AND ' + where : ''} ORDER BY id`
  ).all(...(params || []));
}
const detail = (row) => JSON.parse(row.after_json);

test('tracer: anonymous GET /api/synergies x5 -> 401 x5 -> exactly ONE access-denied row (count 1, no-session)', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${base}/api/synergies`);
      assert.strictEqual(res.status, 401);
      assert.deepStrictEqual(await res.json(), { error: 'Login required.', authRequired: true }, 'body byte-identical to before 11-04');
    }
    const rows = denialRows("actor_username = '(anonymous)' AND row_id = 'GET /api/synergies'");
    assert.strictEqual(rows.length, 1, `5 identical probes in one window = one row, got ${rows.length}`);
    assert.strictEqual(rows[0].actor_role, '(anonymous)');
    assert.strictEqual(rows[0].request_method, 'GET');
    assert.strictEqual(rows[0].request_path, '/api/synergies');
    const d = detail(rows[0]);
    assert.strictEqual(d.reason, 'no-session');
    assert.strictEqual(d.status, 401);
    assert.strictEqual(d.count, 1);
    assert.strictEqual(d.folded, false);
    // The 4 folded denials are counted, never dropped: flushing writes them once.
    app.denialAuditor.flushAll();
    const after = denialRows("actor_username = '(anonymous)' AND row_id = 'GET /api/synergies'");
    assert.strictEqual(after.length, 2);
    assert.strictEqual(detail(after[1]).count, 4);
    assert.strictEqual(detail(after[1]).folded, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live: random ids on one template share a key (anonymous DELETE /api/raid/<random> x20 = one row, template /api/raid/:id)', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${base}/api/raid/rid_${i}_${Math.random().toString(36).slice(2)}`, { method: 'DELETE' });
      assert.strictEqual(res.status, 401);
      await res.text();
    }
    const rows = denialRows("actor_username = '(anonymous)' AND row_id = 'DELETE /api/raid/:id'");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(detail(rows[0]).reason, 'no-session');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live: no existing audit row is ever updated or deleted (AUD-02 triggers intact)', () => {
  const conn = auditHook.getAuditConnection();
  assert.throws(() => conn.prepare("UPDATE audit_log SET actor_username = 'x' WHERE id = 1").run(), /append-only/);
  assert.throws(() => conn.prepare('DELETE FROM audit_log WHERE id = 1').run(), /append-only/);
});

// ---------------------------------------------------------------------------
// 3. LIVE — every gate / resolver / clearance refusal reason (Task 2)
// ---------------------------------------------------------------------------

const sessionsDb = require('../db/sessions.js');
const { lockdownMiddleware, createLockdown } = require('../lib/credentialLockdown');

function call(base, method, urlPath, cookie, body) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(base + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function withServer(fn) {
  const server = await listenLocal(app);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
function realDeal(id, members) {
  return createDealFixture({ controlConn, runtimeConn, dealId: id, members });
}
const rowsFor = (actor, subject, reason) => denialRows(
  'actor_username = ? AND row_id = ?' + (reason ? ' AND after_json LIKE ?' : ''),
  reason ? [actor, subject, `%"reason":"${reason}"%`] : [actor, subject]
);
function insertAccount(data) {
  controlConn.prepare(
    `INSERT OR IGNORE INTO users (id, project_id, seq, data)
     VALUES (?, NULL, COALESCE((SELECT MAX(seq) FROM users), -1) + 1, ?)`
  ).run(data.username, JSON.stringify(data));
}

test('live role-read: employee in a real deal GET /api/raid x3 -> 403 x3 -> ONE role-read row naming actor, template, deal', async () => {
  const fx = realDeal('deal_dareadone', [
    { username: 'da-read-emp', role: 'employee' },
    { username: 'da-read-admin', role: 'admin' },
  ]);
  await withServer(async (base) => {
    let firstBody;
    for (let i = 0; i < 3; i += 1) {
      const res = await call(base, 'GET', '/api/raid', fx.cookie('da-read-emp'));
      assert.strictEqual(res.status, 403);
      const text = await res.text();
      firstBody = firstBody || text;
      assert.strictEqual(text, firstBody);
      assert.deepStrictEqual(JSON.parse(text), { error: 'Your role cannot view this information.' }, 'response unchanged by 11-04');
    }
    const rows = rowsFor('da-read-emp', 'GET /api/raid', 'role-read');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].actor_role, 'employee');
    assert.strictEqual(rows[0].deal_id, 'deal_dareadone');
    assert.strictEqual(rows[0].request_method, 'GET');
    assert.strictEqual(detail(rows[0]).status, 403);
    assert.strictEqual(detail(rows[0]).count, 1);
    // an ALLOWED role is not a denial: no row for the admin
    const ok = await call(base, 'GET', '/api/raid', fx.cookie('da-read-admin'));
    assert.strictEqual(ok.status, 200);
    await ok.text();
    assert.strictEqual(denialRows('actor_username = ?', ['da-read-admin']).length, 0);
  });
});

test('live role-write: pmo POST /api/settings -> 403 -> one role-write row; body unchanged', async () => {
  const fx = realDeal('deal_dawriteone', [{ username: 'da-write-pmo', role: 'pmo' }]);
  await withServer(async (base) => {
    for (let i = 0; i < 2; i += 1) {
      const res = await call(base, 'POST', '/api/settings', fx.cookie('da-write-pmo'), { demoMode: false });
      assert.strictEqual(res.status, 403);
      assert.deepStrictEqual(await res.json(), { error: 'Your role cannot perform this action.' });
    }
    const rows = rowsFor('da-write-pmo', 'POST /api/settings', 'role-write');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(detail(rows[0]).count, 1);
  });
});

test('live demo-only: admin in a real deal POST /api/settings/time-travel -> 403 -> one demo-only row', async () => {
  const fx = realDeal('deal_dademoone', [{ username: 'da-demo-admin', role: 'admin' }]);
  await withServer(async (base) => {
    const res = await call(base, 'POST', '/api/settings/time-travel', fx.cookie('da-demo-admin'), { day: 3 });
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(await res.json(), { error: 'This showcase-only feature is unavailable inside a real deal.' });
    const rows = rowsFor('da-demo-admin', 'POST /api/settings/time-travel', 'demo-only');
    assert.strictEqual(rows.length, 1);
  });
});

test('live must-change-password: a forced-rotation session is refused everywhere but recorded once', async () => {
  insertAccount({ username: 'da-rotate', name: 'da-rotate', role: 'pmo', mustChangePassword: true });
  const token = sessionsDb.createSession(runtimeConn, { username: 'da-rotate', role: 'pmo', ttlMs: 60 * 60 * 1000 });
  await withServer(async (base) => {
    for (let i = 0; i < 3; i += 1) {
      const res = await call(base, 'GET', '/api/menus', `ma_session=${token}`);
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.mustChangePassword, true);
    }
    const rows = rowsFor('da-rotate', 'GET /api/menus', 'must-change-password');
    assert.strictEqual(rows.length, 1);
  });
});

test('live deal-access: a session bound to a deal it is not a member of -> resolver 403 -> one deal-access row (resolver stays audit-free)', async () => {
  insertAccount({ username: 'da-ghost', name: 'da-ghost', role: 'pmo' });
  const token = sessionsDb.createSession(runtimeConn, { username: 'da-ghost', role: 'pmo', ttlMs: 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, token, 'deal_nosuchdealaa');
  await withServer(async (base) => {
    for (let i = 0; i < 3; i += 1) {
      const res = await call(base, 'GET', '/api/raid', `ma_session=${token}`);
      assert.strictEqual(res.status, 403);
      assert.deepStrictEqual(await res.json(), { error: 'You are not a member of that deal.' });
    }
    const rows = rowsFor('da-ghost', 'GET /api/raid', 'deal-access');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].deal_id, 'deal_nosuchdealaa', 'the deal the session was bound to is recorded');
  });
  const resolverSrc = fs.readFileSync(path.join(__dirname, '..', 'db', 'resolver.js'), 'utf8');
  assert.ok(!/require\([^)]*(auditHook|denialAudit)/.test(resolverSrc), 'db/resolver.js must not require the audit modules');
  assert.ok(!/recordSecurityEvent\(/.test(resolverSrc), 'db/resolver.js must not write audit rows itself');
  assert.ok((resolverSrc.match(/onDenied/g) || []).length >= 2, 'the resolver exposes the optional onDenied hook');
});

test('live variants: /api/Synergies, /api/synergies/ and /api//synergies are recorded under the SAME canonical route/template', async () => {
  const fx = realDeal('deal_davariant', [{ username: 'da-var-emp', role: 'employee' }]);
  await withServer(async (base) => {
    for (const spelling of ['/api/synergies', '/api/Synergies', '/api/synergies/', '/api//synergies']) {
      const res = await call(base, 'GET', spelling, fx.cookie('da-var-emp'));
      assert.strictEqual(res.status, 403, spelling);
      await res.text();
    }
    const rows = denialRows('actor_username = ?', ['da-var-emp']);
    assert.strictEqual(rows.length, 1, 'four spellings of one route are ONE key');
    assert.strictEqual(rows[0].row_id, 'GET /api/synergies');
    assert.strictEqual(detail(rows[0]).path, '/api/synergies', 'the canonical path, not the client spelling');
    app.denialAuditor.flushAll();
    const after = denialRows('actor_username = ?', ['da-var-emp']);
    assert.strictEqual(after.length, 2);
    assert.strictEqual(detail(after[1]).count, 3, 'the 3 variant denials are counted, none lost');
  });
});

test('live clearance-404: uncleared member DELETE /api/raid/<hr id> -> 404 byte-identical to a missing id -> one clearance-404 row on /api/raid/:id; missing ids are NOT recorded', async () => {
  const fx = realDeal('deal_daclear', [
    { username: 'da-clr-admin', role: 'admin' },
    { username: 'da-clr-none', role: 'pmo' }, // deal member with NO clearance grant
  ]);
  await withServer(async (base) => {
    const raidIds = [];
    for (const n of [1, 2]) {
      const f = await call(base, 'POST', '/api/dd/findings', fx.cookie('da-clr-admin'), {
        area: 'hr', title: `DA-HR-SECRET finding ${n}`, severity: 'high', notes: 'DA-HR-SECRET-NOTES',
      });
      assert.ok(f.status === 200 || f.status === 201, `fixture: finding created, got ${f.status}`);
      const { finding } = await f.json();
      const c = await call(base, 'POST', `/api/dd/findings/${finding.id}/convert`, fx.cookie('da-clr-admin'), {
        toRaid: true, version: Number.isSafeInteger(finding.version) ? finding.version : 0,
      });
      assert.strictEqual(c.status, 200);
      const conv = await c.json();
      assert.ok(conv.raid && conv.raid.id, 'fixture: converted RAID entry');
      raidIds.push(conv.raid.id);
    }

    const cookie = fx.cookie('da-clr-none');
    const missing = await call(base, 'DELETE', '/api/raid/raid_does_not_exist', cookie);
    assert.strictEqual(missing.status, 404);
    const missingText = await missing.text();
    assert.deepStrictEqual(JSON.parse(missingText), { error: 'Not found' });
    // a genuinely missing id is not a clearance denial: nothing recorded yet
    assert.strictEqual(rowsFor('da-clr-none', 'DELETE /api/raid/:id', 'clearance-404').length, 0);

    for (const id of raidIds) {
      const res = await call(base, 'DELETE', `/api/raid/${id}`, cookie);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(await res.text(), missingText, 'invisible == missing: byte-identical response, unchanged by 11-04');
    }
    for (let i = 0; i < 3; i += 1) {
      const res = await call(base, 'DELETE', `/api/raid/raid_missing_${i}`, cookie);
      assert.strictEqual(res.status, 404);
      await res.text();
    }

    const rows = rowsFor('da-clr-none', 'DELETE /api/raid/:id', 'clearance-404');
    assert.strictEqual(rows.length, 1, 'two different invisible ids share ONE key (route template)');
    assert.strictEqual(detail(rows[0]).status, 404);
    assert.strictEqual(detail(rows[0]).count, 1);
    assert.strictEqual(rows[0].deal_id, 'deal_daclear');
    app.denialAuditor.flushAll();
    const after = rowsFor('da-clr-none', 'DELETE /api/raid/:id', 'clearance-404');
    assert.strictEqual(after.length, 2);
    assert.strictEqual(detail(after[1]).count, 1, 'only the second INVISIBLE id was folded; the 4 missing ids were never counted');
    // no field of the restricted record reached the audit row
    for (const r of after) assert.ok(!/DA-HR-SECRET/.test(JSON.stringify(r)), 'audit rows carry no record content');
  });
});

test('live: a refused probe cannot flood audit.db — 60 denials across 3 templates produce one row per key', async () => {
  const fx = realDeal('deal_dabound', [{ username: 'da-bound-emp', role: 'employee' }]);
  await withServer(async (base) => {
    for (let i = 0; i < 20; i += 1) {
      for (const p of ['/api/raid', '/api/org/positions', '/api/employees']) {
        const res = await call(base, 'GET', p, fx.cookie('da-bound-emp'));
        assert.strictEqual(res.status, 403);
        await res.text();
      }
    }
    const rows = denialRows('actor_username = ?', ['da-bound-emp']);
    assert.strictEqual(rows.length, 3, 'one row per (actor, route, reason) key inside the window');
    const subjects = rows.map((r) => r.row_id).sort();
    assert.deepStrictEqual(subjects, ['GET /api/employees', 'GET /api/org/positions', 'GET /api/raid']);
    app.denialAuditor.flushAll();
    const after = denialRows('actor_username = ?', ['da-bound-emp']);
    assert.strictEqual(after.reduce((n, r) => n + detail(r).count, 0), 60, 'total counted equals the probe count');
  });
});

test('structural: the inline grants 403 and the clearance-404 branch go through the auditor; the gate has no raw 401/403 left', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok((src.match(/denyAt\(req, res/g) || []).length >= 6, 'gate + grants refusals use denyAt');
  assert.match(src, /denyAt\(req, res, 403, 'role-inline'/);
  assert.match(src, /'clearance-404'/);
  assert.match(src, /err\.reason === 'clearance'/);
  // the consolidated gate body: from the `app.use('/api', (req, res, next)` to the validation call
  const start = src.indexOf("app.use('/api', (req, res, next) => {");
  const end = src.indexOf('validators.validationMiddleware(req, res, next);\n  }, onResolverDenied);');
  assert.ok(start > 0 && end > start, 'gate body located');
  const gate = src.slice(start, end);
  const rawRefusals = gate.split('\n').filter((l) => /res\.status\((401|403)\)/.test(l) && !/^\s*\/\//.test(l));
  assert.deepStrictEqual(rawRefusals, [], 'every 401/403 inside the consolidated gate is a denyAt()');
});

// Suites that only inspect the route table / source and never send a request:
// no denial can be triggered, so they need no audit isolation.
const NO_REQUESTS = new Set(['deal-wizard-page.test.js', 'write-validation-coverage.test.js']);

test('suite isolation: every test file that requires server.js points the audit database at a temp file BEFORE the require', () => {
  const dir = __dirname;
  const offenders = [];
  let scanned = 0;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'))) {
    if (name === 'denial-audit.test.js' || NO_REQUESTS.has(name)) continue;
    // comment-only lines are dropped so prose that quotes the require does not count
    const src = fs.readFileSync(path.join(dir, name), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (!/require\((['"])\.\.\/server(\.js)?\1\)/.test(src)) continue;
    scanned += 1;
    // MA_AUDIT_DB_PATH (explicit) or MA_DATA_DIR (the real-mode data dir carries its own audit.db)
    const env = /MA_AUDIT_DB_PATH|MA_DATA_DIR/.exec(src);
    // a column-0 (module-level) require loads the app at file load: the env must precede it.
    // An indented require runs inside a test body, after every module-level assignment.
    const top = /^\S.*require\((['"])\.\.\/server(\.js)?\1\)/m.exec(src);
    if (!env || (top && env.index > top.index)) offenders.push(name);
  }
  assert.ok(scanned >= 10, `expected to scan the server-loading suites, scanned ${scanned}`);
  assert.deepStrictEqual(offenders, [], 'these suites would write access-denied rows into the developer data/audit.db');
});

test('docs: DEPLOYMENT.md states the rate bound and the accepted crash-loss of pending denial counts (amendment 7 / T-11-35)', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'DEPLOYMENT.md'), 'utf8');
  assert.match(doc, /## Denial audit/);
  assert.match(doc, /access-denied/);
  assert.match(doc, /Crash loss \(accepted\)/);
  assert.match(doc, /one row per account \+ method \+ route \+ reason per 60 seconds/);
  assert.match(doc, /per process/i);
});

test('lockdown: a credential-lockdown refusal reports through onDenied (anonymous, 403); allowlisted paths report nothing', () => {
  const lockdown = createLockdown({ enabled: true });
  lockdown.noteDemoLogin('someone');
  const seen = [];
  const mw = lockdownMiddleware(lockdown, (req, status) => seen.push([req.path, status]));
  const fakeRes = () => {
    const r = { set() { return r; }, status() { return r; }, json() { return r; }, type() { return r; }, send() { return r; } };
    return r;
  };
  let nexted = 0;
  const run = (method, p) => mw({ method, path: p }, fakeRes(), () => { nexted += 1; });
  run('GET', '/api/raid');
  run('GET', '/index.html');
  run('POST', '/api/auth/login');
  run('GET', '/login.html');
  assert.deepStrictEqual(seen, [['/api/raid', 403], ['/index.html', 403]]);
  assert.strictEqual(nexted, 2, 'login + login page pass through untouched');
});
