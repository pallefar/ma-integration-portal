// D-11-06 / AUTHZ-01 (R1-05, R1-15) — colleagues' personal data in a REAL deal:
//   * GET /api/pulses: named ratings/comments only to admin/hrbp and each pulse's
//     author; pmo gets its own + aggregate rows (rating/type/day); employee gets
//     only its own; legacy (author-less) pulses are never "own".
//   * POST /api/pulses stamps authorUsername from the SESSION, never the body.
//   * GET /api/notifications withholds task/RAID nudges from a role the read
//     matrix refuses those lanes (lib/readPolicy.js is the single source).
//   * The demo store is byte-identical for every role (showcase unchanged).
//
// Boots the real app against an isolated temp control/runtime/demo/deals/audit
// set — the committed data/*.db is never opened (same pattern as
// test/demo-only-gating.test.js for a real, seeded demo.db).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-personal-data-reads-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

// A real, seeded demo.db (settings singleton + the showcase pulse library), built
// the same way test/demo-only-gating.test.js does — in the temp dir only.
const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_DB_PATH = path.join(TMP, `legacy-source-${crypto.randomBytes(4).toString('hex')}.db`);
runMigration(path.join(__dirname, '..', 'db.json'), SOURCE_DB_PATH);
const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP });

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const app = require('../server.js');
const { pulsesFor } = require('../lib/pulseView');
const { createDealFixture, demoSession } = require('./helpers/deal-fixture');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const MEMBERS = [
  { username: 'pd-admin', role: 'admin' },
  { username: 'pd-hrbp', role: 'hrbp' },
  { username: 'pd-pmo', role: 'pmo' },
  { username: 'pd-empa', role: 'employee' },
  { username: 'pd-empb', role: 'employee' },
];

function realDeal(id) {
  return createDealFixture({ controlConn, runtimeConn, dealId: id, members: MEMBERS });
}

async function withServer(fn) {
  const server = await listenLocal(app);
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postPulse(base, cookie, body) {
  const res = await fetch(`${base}/api/pulses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function getPulses(base, cookie) {
  const res = await fetch(`${base}/api/pulses`, { headers: { cookie } });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

/** A pre-authorUsername ("legacy") pulse written straight into the deal's own database. */
function injectLegacyPulse(dealId, pulse) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  const row = conn.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM pulses').get();
  conn.prepare('INSERT INTO pulses (id, project_id, seq, data) VALUES (?, NULL, ?, ?)')
    .run(pulse.id, row.n, JSON.stringify(pulse));
}

const LEAK_STRINGS = ['Bob B', 'B-secret-comment', 'PMO-secret-comment', 'Legacy Larry', 'LEGACY-secret-comment'];

// --- pure projection (unit) -----------------------------------------------------

test('pulsesFor (unit): admin/hrbp full, pmo own+aggregate sorted, employee own, unknown role fail-closed, input untouched', () => {
  const pulses = [
    { id: 'p1', employeeName: 'A', rating: 4, comment: 'c1', timestamp: '2026-10-02T09:15:00.000Z', type: '30-day', authorUsername: 'a' },
    { id: 'p2', employeeName: 'B', rating: 2, comment: 'c2', timestamp: '2026-10-01T23:59:00.000Z', type: '30-day', authorUsername: 'b' },
    { id: 'p3', employeeName: 'L', rating: 1, comment: 'c3', timestamp: '2026-10-01T08:00:00.000Z', type: '60-day' },
    { id: 'p4', employeeName: 'B2', rating: 5, comment: 'c4', timestamp: '2026-10-01T10:00:00.000Z', type: '30-day', authorUsername: 'b' },
  ];
  const snapshot = JSON.stringify(pulses);
  assert.deepStrictEqual(pulsesFor('admin', 'x', pulses), pulses);
  assert.deepStrictEqual(pulsesFor('hrbp', 'x', pulses), pulses);
  assert.deepStrictEqual(pulsesFor('employee', 'a', pulses).map((p) => p.id), ['p1']);
  assert.deepStrictEqual(pulsesFor('employee', 'nobody', pulses), []);
  const asPmo = pulsesFor('pmo', 'a', pulses);
  assert.strictEqual(asPmo[0].id, 'p1', 'own pulse first, in full');
  assert.strictEqual(asPmo[0].comment, 'c1');
  const aggs = asPmo.slice(1);
  assert.deepStrictEqual(aggs, [
    { rating: 1, type: '60-day', day: '2026-10-01' },
    { rating: 2, type: '30-day', day: '2026-10-01' },
    { rating: 5, type: '30-day', day: '2026-10-01' },
  ], 'aggregate rows: rating/type/day only, sorted by day then rating');
  for (const a of aggs) assert.deepStrictEqual(Object.keys(a).sort(), ['day', 'rating', 'type']);
  // a missing username never matches a missing author (legacy pulses are never "own")
  assert.deepStrictEqual(pulsesFor('employee', undefined, pulses), []);
  assert.deepStrictEqual(pulsesFor('employee', null, [{ id: 'x', rating: 3 }]), []);
  // unknown / missing role is own-only
  assert.deepStrictEqual(pulsesFor(undefined, 'a', pulses).map((p) => p.id), ['p1']);
  assert.strictEqual(JSON.stringify(pulses), snapshot, 'input is never mutated');
});

// --- real deal (tracer behaviours) --------------------------------------------

test('POST /api/pulses stamps authorUsername from the session; a body-supplied value is ignored', async () => {
  const fx = realDeal('deal_pdstamp');
  await withServer(async (base) => {
    const r = await postPulse(base, fx.cookie('pd-empa'), {
      employeeName: 'Alice A', rating: 5, comment: 'hello', type: '30-day', authorUsername: 'pd-empb',
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.pulse.authorUsername, 'pd-empa', 'stamped from the session');
    // and persisted that way — the lead reads it back
    const all = await getPulses(base, fx.cookie('pd-hrbp'));
    assert.strictEqual(all.json.length, 1);
    assert.strictEqual(all.json[0].authorUsername, 'pd-empa');
    // forged authorship cannot be used to read someone else's pulse
    const forged = await postPulse(base, fx.cookie('pd-empb'), {
      employeeName: 'Bob B', rating: 1, comment: 'forged', type: '30-day', authorUsername: 'pd-empa',
    });
    assert.strictEqual(forged.json.pulse.authorUsername, 'pd-empb');
    const a = await getPulses(base, fx.cookie('pd-empa'));
    assert.deepStrictEqual(a.json.map((p) => p.comment), ['hello'], 'employeeA still sees only its own pulse');
  });
});

test('real deal: employee sees only its own; pmo own + aggregate; hrbp/admin everything; legacy never own', async () => {
  const fx = realDeal('deal_pdvisible');
  await withServer(async (base) => {
    await postPulse(base, fx.cookie('pd-empa'), { employeeName: 'Alice A', rating: 5, comment: 'A-comment', type: '30-day' });
    await postPulse(base, fx.cookie('pd-empb'), { employeeName: 'Bob B', rating: 2, comment: 'B-secret-comment', type: '30-day' });
    await postPulse(base, fx.cookie('pd-pmo'), { employeeName: 'Pat PMO', rating: 4, comment: 'PMO-secret-comment', type: '30-day' });
    injectLegacyPulse('deal_pdvisible', {
      id: 'pulse_legacy_1', employeeName: 'Legacy Larry', rating: 1, comment: 'LEGACY-secret-comment',
      timestamp: '2026-01-02T03:04:05.000Z', type: '30-day',
    });

    // employee A: exactly its own, full fields, nothing about anyone else
    const a = await getPulses(base, fx.cookie('pd-empa'));
    assert.strictEqual(a.status, 200);
    assert.strictEqual(a.json.length, 1);
    assert.strictEqual(a.json[0].employeeName, 'Alice A');
    assert.strictEqual(a.json[0].comment, 'A-comment');
    assert.strictEqual(a.json[0].rating, 5);
    for (const s of LEAK_STRINGS) assert.ok(!a.text.includes(s), `employee body must not contain ${s}`);

    // employee B symmetric
    const b = await getPulses(base, fx.cookie('pd-empb'));
    assert.deepStrictEqual(b.json.map((p) => p.comment), ['B-secret-comment']);
    assert.ok(!b.text.includes('A-comment') && !b.text.includes('Alice A'));

    // pmo: own in full + one aggregate row per other pulse (3), rating/type/day only
    const pmo = await getPulses(base, fx.cookie('pd-pmo'));
    assert.strictEqual(pmo.status, 200);
    assert.strictEqual(pmo.json.length, 4);
    assert.strictEqual(pmo.json[0].employeeName, 'Pat PMO');
    assert.strictEqual(pmo.json[0].comment, 'PMO-secret-comment');
    const aggs = pmo.json.slice(1);
    for (const row of aggs) {
      assert.deepStrictEqual(Object.keys(row).sort(), ['day', 'rating', 'type']);
      assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
    }
    // the legacy pulse (2026-01-02) sorts first by day; the three live ones share today
    assert.deepStrictEqual(aggs[0], { rating: 1, type: '30-day', day: '2026-01-02' });
    assert.deepStrictEqual(aggs.slice(1).map((r) => r.rating), [2, 5], 'same day -> ordered by rating, not submission order');
    for (const s of ['Bob B', 'B-secret-comment', 'Alice A', 'A-comment', 'Legacy Larry', 'LEGACY-secret-comment', 'pd-empa', 'pd-empb']) {
      assert.ok(!pmo.text.includes(s), `pmo body must not contain ${s}`);
    }

    // hrbp and admin: every pulse, named, with comment
    for (const u of ['pd-hrbp', 'pd-admin']) {
      const lead = await getPulses(base, fx.cookie(u));
      assert.strictEqual(lead.json.length, 4, `${u} reads every pulse`);
      const comments = lead.json.map((p) => p.comment).sort();
      assert.deepStrictEqual(comments, ['A-comment', 'B-secret-comment', 'LEGACY-secret-comment', 'PMO-secret-comment']);
      assert.ok(lead.json.every((p) => typeof p.employeeName === 'string' && p.employeeName));
    }

    // a legacy pulse is never "own" for the employee or pmo (asserted above via
    // the body-leak checks); it is reachable only as admin/hrbp (full) or pmo (aggregate).
    assert.strictEqual(a.json.find((p) => p.id === 'pulse_legacy_1'), undefined);
  });
});

test('PRD acceptance 1 (pulses): 200 on own pulse, no named data for others\' pulses, every role', async () => {
  const fx = realDeal('deal_pdacc1');
  await withServer(async (base) => {
    await postPulse(base, fx.cookie('pd-empa'), { employeeName: 'Alice A', rating: 3, comment: 'own-note', type: '30-day' });
    await postPulse(base, fx.cookie('pd-empb'), { employeeName: 'Bob B', rating: 4, comment: 'other-note', type: '30-day' });
    for (const role of ['pd-empa', 'pd-empb']) {
      const r = await getPulses(base, fx.cookie(role));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.length, 1);
    }
    const a = await getPulses(base, fx.cookie('pd-empa'));
    assert.ok(a.text.includes('own-note'));
    assert.ok(!a.text.includes('other-note') && !a.text.includes('Bob B'));
  });
});

// --- demo control ---------------------------------------------------------------

test('demo store: every role gets today\'s exact, unprojected pulse response (showcase unchanged)', async () => {
  const cookies = {};
  for (const role of ['admin', 'hrbp', 'pmo', 'employee']) {
    cookies[role] = demoSession({ controlConn, runtimeConn, username: 'pd-demo-' + role, role });
  }
  await withServer(async (base) => {
    // the showcase library + whatever is stored: identical bytes for every role
    const baseline = await getPulses(base, cookies.admin);
    assert.strictEqual(baseline.status, 200);
    assert.ok(Array.isArray(baseline.json) && baseline.json.length > 0, 'the demo store serves the showcase pulse library');
    assert.ok(baseline.json.some((p) => p.employeeName && p.comment !== undefined), 'demo pulses stay named');
    for (const role of ['hrbp', 'pmo', 'employee']) {
      const r = await getPulses(base, cookies[role]);
      assert.strictEqual(r.text, baseline.text, `demo ${role} sees byte-identical pulses to admin`);
    }
    // a pulse posted on the demo store surfaces in full for every role, other authors included
    const posted = await postPulse(base, cookies.employee, {
      employeeName: 'Demo Dana', rating: 4, comment: 'demo-visible-note', type: '30-day',
    });
    assert.strictEqual(posted.status, 201);
    for (const role of ['admin', 'hrbp', 'pmo']) {
      const r = await getPulses(base, cookies[role]);
      const mine = r.json.find((p) => p.id === posted.json.pulse.id);
      assert.ok(mine, `demo ${role} sees the stored pulse`);
      assert.strictEqual(mine.employeeName, 'Demo Dana');
      assert.strictEqual(mine.comment, 'demo-visible-note');
    }
  });
});

// --- notifications honour the read matrix ---------------------------------------

async function getNotificationItems(base, cookie) {
  const res = await fetch(`${base}/api/notifications`, { headers: { cookie } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  return body.items;
}

async function postJson(base, cookie, p, body) {
  return fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

test('notifications: real-deal employee gets no task/RAID nudges; staff keep them with the same counts', async () => {
  const fx = realDeal('deal_pdnotify');
  await withServer(async (base) => {
    const adminCookie = fx.cookie('pd-admin');
    // overdue (due in the past on the wall clock) + blocked task, and a high open RAID entry
    let r = await postJson(base, adminCookie, '/api/integration-tasks', { title: 'Overdue one', status: 'todo', due: '2020-01-01', workstream: 'ws_imo' });
    assert.strictEqual(r.status, 201);
    r = await postJson(base, adminCookie, '/api/integration-tasks', { title: 'Blocked one', status: 'blocked', workstream: 'ws_imo' });
    assert.strictEqual(r.status, 201);
    r = await postJson(base, adminCookie, '/api/raid', { title: 'High risk', type: 'risk', severity: 'high' });
    assert.strictEqual(r.status, 201);

    const TYPES = ['tasks_overdue', 'tasks_blocked', 'raid_high'];
    const staffCounts = {};
    for (const u of ['pd-admin', 'pd-hrbp', 'pd-pmo']) {
      const items = await getNotificationItems(base, fx.cookie(u));
      for (const t of TYPES) {
        const it = items.find((i) => i.type === t);
        assert.ok(it && it.count >= 1, `${u} keeps the ${t} nudge`);
        staffCounts[u + t] = it.count;
      }
    }
    for (const t of TYPES) {
      assert.strictEqual(staffCounts['pd-hrbp' + t], staffCounts['pd-admin' + t], `${t} count identical for hrbp and admin`);
      assert.strictEqual(staffCounts['pd-pmo' + t], staffCounts['pd-admin' + t], `${t} count identical for pmo and admin`);
    }

    const empItems = await getNotificationItems(base, fx.cookie('pd-empa'));
    for (const t of TYPES) {
      assert.ok(!empItems.some((i) => i.type === t), `employee must not receive ${t}`);
    }
  });
});

test('notifications: assessment nudges are unchanged for every role (real deal)', async () => {
  const fx = realDeal('deal_pdnotifyass');
  await withServer(async (base) => {
    const ASSESS = ['assessment_pending', 'reassess_il'];
    const byRole = {};
    for (const u of ['pd-admin', 'pd-hrbp', 'pd-pmo', 'pd-empa']) {
      const items = await getNotificationItems(base, fx.cookie(u));
      byRole[u] = items.filter((i) => ASSESS.includes(i.type)).map((i) => i.id).sort();
    }
    for (const u of ['pd-hrbp', 'pd-pmo', 'pd-empa']) {
      assert.deepStrictEqual(byRole[u], byRole['pd-admin'], `${u} assessment nudges match admin`);
    }
  });
});

test('notifications: demo store response is identical for every role', async () => {
  const cookies = {};
  for (const role of ['admin', 'hrbp', 'pmo', 'employee']) {
    cookies[role] = demoSession({ controlConn, runtimeConn, username: 'pd-ndemo-' + role, role });
  }
  await withServer(async (base) => {
    const baseline = JSON.stringify(await getNotificationItems(base, cookies.admin));
    for (const role of ['hrbp', 'pmo', 'employee']) {
      assert.strictEqual(JSON.stringify(await getNotificationItems(base, cookies[role])), baseline,
        `demo ${role} notifications identical to admin (no read-matrix filtering on the showcase)`);
    }
  });
});
