// ISO-02 / ROADMAP SC-2: the demo-only showcase mechanics (time-travel
// day-scaling, the merit-award/lesson-complete/uncomplete endpoints that
// drive XP/badges/leaderboards) are refused with 403 for any request whose
// resolved database is not demo.db, enforced once by DEMO_ONLY_PREFIXES in
// the consolidated /api gate — and leave that deal's stored data byte-
// identical, proven by direct SQL, not by the response status alone.
//
// Uses the SAME temp-trio-plus-env-override pattern test/deal-resolver.test.js
// establishes — see its header comment for the full rationale.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-demo-only-gating-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-demo-only-gating-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.ADMIN_TOKEN = '';

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH);

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR });

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const demoConn = store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);

const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
registerDeal({ id: 'deal_gate1', name: 'Gate Deal', targetCompany: 'Gate Co', members: ['karen'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });
createDealDatabase('deal_gate1', { name: 'Gate Deal', targetCompany: 'Gate Co' });
const dealConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_gate1'), dbFiles.DEAL_SCHEMA_PATH);

// A demo employee (case a: showcase scaling stays observable) and a deal
// employee with real, already-completed progress (case d: no scaling must
// ever be applied to it).
demoConn.prepare(`INSERT INTO employees (id, project_id, seq, data) VALUES (?, NULL, 0, ?)`)
  .run('emp_demo_showcase', JSON.stringify({ id: 'emp_demo_showcase', name: 'Showcase Employee', completedLessons: [], points: 0, badge: 'New Recruit', bonusPoints: 0 }));
dealConn.prepare(`INSERT INTO employees (id, project_id, seq, data) VALUES (?, NULL, 0, ?)`)
  .run('emp_deal_real', JSON.stringify({ id: 'emp_deal_real', name: 'Real Employee', completedLessons: ['l1_1'], points: 20, badge: 'Culture Champion', bonusPoints: 0 }));

const app = require('../server.js');
function cookieHeader(token) { return `ma_session=${token}`; }

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('demo-only-gating (a): a demo-bound session can still set a time-travel day and complete a lesson — the showcase must not regress', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const ttRes = await fetch(`http://127.0.0.1:${port}/api/settings/time-travel`, {
      method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ day: 60 }),
    });
    assert.strictEqual(ttRes.status, 200, 'a demo-bound time-travel POST must still succeed');

    const lessonRes = await fetch(`http://127.0.0.1:${port}/api/employees/complete-lesson`, {
      method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ empId: 'emp_demo_showcase', lessonId: 'l1_1' }),
    });
    assert.strictEqual(lessonRes.status, 200, 'a demo-bound lesson-complete POST must still succeed');

    const empRes = await fetch(`http://127.0.0.1:${port}/api/employees`, { headers: { Cookie: cookieHeader(token) } });
    const employees = await empRes.json();
    const showcase = employees.find((e) => e.id === 'emp_demo_showcase');
    assert.ok(showcase, 'the demo showcase employee must still be present in the response');
    // Day-60 scaling assigns badge/points from a deterministic formula based
    // on the employee's name — NOT the raw stored ('New Recruit') value —
    // proving the showcase scaling is still observably applied.
    assert.notStrictEqual(showcase.badge, 'New Recruit', 'day-60 scaling must still transform the demo showcase employee\'s badge');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('demo-only-gating (b)+(c): a deal-bound session calling each demo-only endpoint gets 403, and the deal\'s stored data is byte-identical afterwards', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, token, 'deal_gate1');
  const server = app.listen(0);
  try {
    const { port } = server.address();

    const settingsBefore = dealConn.prepare(`SELECT data FROM app_state WHERE key = 'settings'`).get();
    const employeeBefore = dealConn.prepare(`SELECT data FROM employees WHERE id = 'emp_deal_real'`).get();

    const calls = [
      { path: '/api/settings/time-travel', body: { day: 60 } },
      { path: '/api/employees/award-merit', body: { empId: 'emp_deal_real', points: 50 } },
      { path: '/api/employees/complete-lesson', body: { empId: 'emp_deal_real', lessonId: 'l1_2' } },
      { path: '/api/employees/uncomplete-lesson', body: { empId: 'emp_deal_real', lessonId: 'l1_1' } },
    ];
    for (const call of calls) {
      const res = await fetch(`http://127.0.0.1:${port}${call.path}`, {
        method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' }, body: JSON.stringify(call.body),
      });
      assert.strictEqual(res.status, 403, `a deal-bound session calling ${call.path} must be refused with 403`);
    }

    const settingsAfter = dealConn.prepare(`SELECT data FROM app_state WHERE key = 'settings'`).get();
    const employeeAfter = dealConn.prepare(`SELECT data FROM employees WHERE id = 'emp_deal_real'`).get();
    assert.strictEqual(settingsAfter ? settingsAfter.data : null, settingsBefore ? settingsBefore.data : null, 'the deal\'s settings row must be byte-identical after every refused demo-only call');
    assert.strictEqual(employeeAfter.data, employeeBefore.data, 'the deal\'s employee row must be byte-identical after every refused demo-only call — award-merit/complete-lesson/uncomplete-lesson had NO effect');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('demo-only-gating (d): a deal-bound read of employees and pulses returns the stored rows with no day-scaling transformation applied', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, token, 'deal_gate1');
  const server = app.listen(0);
  try {
    const { port } = server.address();

    const empRes = await fetch(`http://127.0.0.1:${port}/api/employees`, { headers: { Cookie: cookieHeader(token) } });
    const employees = await empRes.json();
    const real = employees.find((e) => e.id === 'emp_deal_real');
    assert.ok(real, 'the deal\'s real employee row must be present');
    assert.deepStrictEqual(real.completedLessons, ['l1_1'], 'completedLessons must match the stored value exactly — no scaling');
    assert.strictEqual(real.points, 20, 'points must match the stored value exactly — no scaling');
    assert.strictEqual(real.badge, 'Culture Champion', 'badge must match the stored value exactly — no scaling');

    const pulsesRes = await fetch(`http://127.0.0.1:${port}/api/pulses`, { headers: { Cookie: cookieHeader(token) } });
    const pulses = await pulsesRes.json();
    assert.deepStrictEqual(pulses, [], 'a deal with no stored pulses must get an empty array — the seeded showcase pulse library must never be injected');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('demo-only-gating (e): every DEMO_ONLY_PREFIXES entry corresponds to a route that actually exists — the table cannot rot into dead prefixes', () => {
  const stack = (app._router && app._router.stack) || [];
  const liveRoutes = [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const m of methods) liveRoutes.push({ method: m.toUpperCase(), path: layer.route.path });
    }
  }
  assert.ok(liveRoutes.length > 0, 'route inventory must not be empty');
  assert.ok(Array.isArray(app.DEMO_ONLY_PREFIXES) && app.DEMO_ONLY_PREFIXES.length > 0, 'server.js must export a non-empty DEMO_ONLY_PREFIXES for this proof to be meaningful');

  for (const rule of app.DEMO_ONLY_PREFIXES) {
    const matchingRoute = liveRoutes.find((r) => r.path === rule.prefix && (!rule.methods || rule.methods.includes(r.method)));
    assert.ok(matchingRoute, `DEMO_ONLY_PREFIXES entry ${JSON.stringify(rule)} does not correspond to any live registered route — dead prefix`);
  }
});
