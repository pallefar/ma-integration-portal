// SYN-01: proves the synergy phasing ramp (D-01/D-02/D-03/D-05/D-24) and the
// derived targetM/realizedM rollup (D-04) end-to-end through the REAL HTTP
// stack, plus direct unit coverage of the pure ramp-math helpers exposed on
// the app module.
//
// This is the phase's tracer plan (05-01): Task 1 covers generation +
// derived rollup; Task 2 extends this file with the per-month arrived-month
// gate; Task 3 extends it with the source-level UI regression checks.
//
// Deliberately does NOT assert on the initiative's stage/status value
// anywhere in this file — that vocabulary changes in Plan 02 and an
// assertion on it here would be churn.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-findings.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/synergy-phasing.test.js` (or `npm test`). Never `node --test test/`
// (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-synergy-phasing-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');
// GD-3 (CONC-02 gap closure): this suite's subject is not the version contract — supply the held-version precondition a real client sends.
require('./helpers/held-version.js').installHeldVersionFetch();
const workstreamValidators = require('../validators/workstream.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/dd-findings.test.js).
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
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
function freshDeal(id, overrides) {
  return {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides,
  };
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ------------------------------------------------------------------ unit --

test('synergy-phasing (unit a): isValidMonth accepts a well-formed YYYY-MM month and rejects out-of-range/malformed/empty values', () => {
  assert.strictEqual(workstreamValidators.isValidMonth('2026-04'), true);
  assert.strictEqual(workstreamValidators.isValidMonth('2026-13'), false, 'month 13 does not exist');
  assert.strictEqual(workstreamValidators.isValidMonth('2026-4'), false, 'un-padded month must be rejected');
  assert.strictEqual(workstreamValidators.isValidMonth('2026-00'), false, 'month 0 does not exist');
  assert.strictEqual(workstreamValidators.isValidMonth(''), false);
});

test('synergy-phasing (unit b): generatePhasingRows returns 36 rows spanning the exact requested horizon, each carrying month/targetM/realizedM', () => {
  const rows = app.generatePhasingRows(12, '2026-04', 'cost', 3);
  assert.strictEqual(rows.length, 36);
  assert.strictEqual(rows[0].month, '2026-04');
  assert.strictEqual(rows[rows.length - 1].month, '2029-03');
  rows.forEach((r) => {
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'month'));
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'targetM'));
    assert.strictEqual(r.realizedM, 0, 'a freshly generated row always starts at zero realized');
  });
});

test('synergy-phasing (unit c): the cost curve reaches its 30/70/100 year-end checkpoints exactly at rows 12/24/36, D-24', () => {
  const runRateM = 1200; // large enough that 1-decimal rounding never collapses distinct attainment levels
  const rows = app.generatePhasingRows(runRateM, '2026-01', 'cost', 3);
  assert.strictEqual(rows[11].targetM, Math.round((0.30 * runRateM / 12) * 10) / 10, 'row 12 must land exactly on the 30% year-1 checkpoint');
  assert.strictEqual(rows[23].targetM, Math.round((0.70 * runRateM / 12) * 10) / 10, 'row 24 must land exactly on the 70% year-2 checkpoint');
  assert.strictEqual(rows[35].targetM, Math.round((1.00 * runRateM / 12) * 10) / 10, 'row 36 must land exactly on the 100% year-3 checkpoint');
});

test('synergy-phasing (unit d): row 6 interpolates STRICTLY between row 5 and row 7 — a smooth monthly ramp, never a step at the year boundary', () => {
  const runRateM = 1200;
  const rows = app.generatePhasingRows(runRateM, '2026-01', 'cost', 3);
  assert.ok(rows[4].targetM < rows[5].targetM, 'row 6 must exceed row 5');
  assert.ok(rows[5].targetM < rows[6].targetM, 'row 6 must be exceeded by row 7');
});

test('synergy-phasing (unit e): the year-1 cumulative sum of monthly targets is bounded by the year-end checkpoint share, never equal to or exceeding it — a linear ramp from zero averages below its own endpoint', () => {
  // Resolves an imprecision in this plan's own acceptance-criteria shorthand
  // ("cumulative sum ... equals 30% of one year's run-rate share") against
  // the plan's own must_haves.truths formula (attainment% * runRateM / 12
  // per row): summing a linear 0->30% ramp across 12 discrete months always
  // lands BELOW the 30% endpoint (roughly half of it), never AT it. This
  // test asserts the mathematically true relationship the formula produces,
  // with row 12 itself (asserted above) being the value that DOES land
  // exactly on the 30% checkpoint.
  const runRateM = 1200;
  const rows = app.generatePhasingRows(runRateM, '2026-01', 'cost', 3);
  const year1Sum = rows.slice(0, 12).reduce((a, r) => a + r.targetM, 0);
  const oneYearShare = 0.30 * runRateM;
  assert.ok(year1Sum > 0, 'a non-zero ramp must capture some value in year 1');
  assert.ok(year1Sum < oneYearShare, 'a ramp starting at zero must average below its own year-end checkpoint');
});

test('synergy-phasing (unit f): monthHasArrived is true for the current and past months, false for a future month', () => {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const nextDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const previousMonth = prevDate.toISOString().slice(0, 7);
  const nextMonth = nextDate.toISOString().slice(0, 7);

  assert.strictEqual(app.monthHasArrived(currentMonth), true);
  assert.strictEqual(app.monthHasArrived(previousMonth), true);
  assert.strictEqual(app.monthHasArrived(nextMonth), false);
});

// CR-01: an unbounded synergyHorizonYears setting let any pmo/hrbp/admin
// caller crash the shared single-threaded process by requesting an absurd
// phasing horizon (generatePhasingRows() allocated horizonYears*12 rows
// synchronously on the request thread). Fixed with a schema bound
// (validators/settings.js) AND a defensive reader-side clamp (server.js's
// synergyHorizonYears()) AND a third clamp inside generatePhasingRows()
// itself — belt and braces, since the settings route is not the only way a
// value can land in the settings singleton.
test('synergy-phasing (unit g): CR-01 — generatePhasingRows clamps an absurd horizonYears to 15 years (180 rows), never allocating an unbounded row count', () => {
  const rows = app.generatePhasingRows(1, '2026-01', 'linear', 2000);
  assert.strictEqual(rows.length, 180, 'a 2000-year horizon must be clamped to the 15-year ceiling (15*12 rows), not allocate 24,000 rows');
});

test('synergy-phasing (unit h): CR-01 — synergyHorizonYears(db) clamps an already-stored out-of-range value to [1, 15], and falls back to the default 3 for non-numeric/absent configuration', () => {
  assert.strictEqual(app.synergyHorizonYears({ settings: { synergyHorizonYears: 100000000 } }), 15, 'a huge stored value must clamp to the 15-year ceiling');
  assert.strictEqual(app.synergyHorizonYears({ settings: { synergyHorizonYears: 0 } }), 1, 'a zero stored value must clamp to the 1-year floor');
  assert.strictEqual(app.synergyHorizonYears({ settings: { synergyHorizonYears: -5 } }), 1, 'a negative stored value must clamp to the 1-year floor');
  assert.strictEqual(app.synergyHorizonYears({ settings: {} }), 3, 'an absent value must default to 3');
  assert.strictEqual(app.synergyHorizonYears({ settings: { synergyHorizonYears: 'not-a-number' } }), 3, 'a non-numeric stored value must default to 3');
  assert.strictEqual(app.synergyHorizonYears({ settings: { synergyHorizonYears: 7 } }), 7, 'an in-range value must pass through unchanged');
});

test('synergy-phasing (http l): CR-01 — an out-of-range synergyHorizonYears (e.g. 2000) is refused with 400 by the schema on BOTH write paths (deal setup route and admin POST /api/settings), before any value can reach storage', async () => {
  const deal = freshDeal('deal_synhorz');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  // D-11-02 (Phase 11): the Integration Lead (karen, hrbp member) edits the
  // horizon on the deal's setup route; the instance settings route is
  // admin-only. The 1-15 year bound under test is the same on both.
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const post = (urlPath, token, body) => fetch(`${base}${urlPath}`, {
      method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const setupBad = await post(`/api/deals/${deal.id}/setup`, karenToken, { dealSettings: { synergyHorizonYears: 2000 } });
    assert.strictEqual(setupBad.status, 400, 'an out-of-range synergyHorizonYears must be refused by the deal setup schema');
    const res = await post('/api/settings', adminToken, { synergyHorizonYears: 2000 });
    assert.strictEqual(res.status, 400, 'an out-of-range synergyHorizonYears must be refused by the schema, not silently accepted');

    const setupOk = await post(`/api/deals/${deal.id}/setup`, karenToken, { dealSettings: { synergyHorizonYears: 5 } });
    assert.strictEqual(setupOk.status, 200, 'an in-range synergyHorizonYears must still be accepted on the setup route');
    const validRes = await post('/api/settings', adminToken, { synergyHorizonYears: 5 });
    assert.strictEqual(validRes.status, 200, 'an in-range synergyHorizonYears must still be accepted');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

// ------------------------------------------------------------------- http --

async function createInitiative(base, token, overrides) {
  const res = await fetch(`${base}/api/synergies`, {
    method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ title: 'Vendor consolidation', category: 'cost', targetM: 5, realizedM: 0, owner: 'Karen' }, overrides || {})),
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  return body.initiative;
}

test('synergy-phasing (http a): generate-phasing on a valid initiative returns 200, replaces item.phasing wholesale, and rolls up targetM/realizedM from the rows (D-04)', async () => {
  const deal = freshDeal('deal_synpa');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const initiative = await createInitiative(base, karenToken);
    const genRes = await fetch(`${base}/api/synergies/${initiative.id}/generate-phasing`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ runRateM: 12, startMonth: '2026-04', curveShape: 'cost' }),
    });
    assert.strictEqual(genRes.status, 200);
    const genBody = await genRes.json();
    assert.strictEqual(genBody.success, true);
    assert.strictEqual(genBody.initiative.phasing.length, 36);
    assert.strictEqual(genBody.initiative.runRateM, 12, 'D-02: run-rate is stored as a separate steady-state annual figure');

    const expectedSum = Math.round(genBody.initiative.phasing.reduce((a, r) => a + r.targetM, 0) * 10) / 10;
    assert.strictEqual(genBody.initiative.targetM, expectedSum, 'the enriched initiative\'s targetM must be the rounded row sum, not the stored pre-generation value');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http b): generate-phasing on an unknown initiative id returns 404', async () => {
  const deal = freshDeal('deal_synpb');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/synergies/syn_does_not_exist/generate-phasing`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ runRateM: 12, startMonth: '2026-04', curveShape: 'cost' }),
    });
    assert.strictEqual(res.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http c): generate-phasing with an out-of-enum curveShape is rejected by the schema with 400, before the handler ever runs', async () => {
  const deal = freshDeal('deal_synpc');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const initiative = await createInitiative(base, karenToken);
    const res = await fetch(`${base}/api/synergies/${initiative.id}/generate-phasing`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ runRateM: 12, startMonth: '2026-04', curveShape: 'parabolic' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http d): GET /api/synergies reports targetM equal to the rounded row sum after generation, and a subsequent POST carrying targetM is refused with 400 (D-04)', async () => {
  const deal = freshDeal('deal_synpd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const initiative = await createInitiative(base, karenToken);
    await fetch(`${base}/api/synergies/${initiative.id}/generate-phasing`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ runRateM: 12, startMonth: '2026-04', curveShape: 'cost' }),
    });

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    assert.strictEqual(listRes.status, 200);
    const list = await listRes.json();
    const found = list.find((s) => s.id === initiative.id);
    assert.ok(found, 'the generated initiative must still be present in the lane');
    const expectedSum = Math.round(found.phasing.reduce((a, r) => a + r.targetM, 0) * 10) / 10;
    assert.strictEqual(found.targetM, expectedSum);

    // D-04/T-05-02: the base upsert route is refused once phasing rows exist
    // — this is the SERVER-SIDE half of the forward-booking guard, proven
    // by a direct POST that never touches the UI.
    const forgeRes = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: initiative.id, targetM: 99 }),
    });
    assert.strictEqual(forgeRes.status, 400);
    const forgeBody = await forgeRes.json();
    assert.ok(forgeBody.error, 'a rejected forward-booking write must state a reason');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http e): an initiative with zero phasing rows keeps the pre-existing independently-writable targetM/realizedM behaviour (D-04)', async () => {
  const deal = freshDeal('deal_synpe');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const initiative = await createInitiative(base, karenToken, { targetM: 5, realizedM: 0 });
    const res = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: initiative.id, realizedM: 2.5 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.initiative.realizedM, 2.5);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ---------------------------------------------------------- Task 2: per-month gate --

// SYN-01/D-06/D-25/T-05-01: the arrived-month gate is a SERVER control,
// proven here by a direct fetch() against the per-month sub-route that never
// touches the UI — the client's span-vs-input rendering is cosmetic only.
async function setupPhasedInitiative(base, token, startMonth, curveShape) {
  const initiative = await createInitiative(base, token);
  const genRes = await fetch(`${base}/api/synergies/${initiative.id}/generate-phasing`, {
    method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ runRateM: 12, startMonth, curveShape: curveShape || 'cost' }),
  });
  const body = await genRes.json();
  return body.initiative;
}

test('synergy-phasing (http f): a realized-value write to the CURRENT month returns 200 and the row is updated; the derived realizedM equals the rounded sum of all rows', async () => {
  const deal = freshDeal('deal_synpf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    // startMonth 12 months before the current month, so the initiative's
    // 36-row horizon straddles past/current/future, giving every case a
    // real row to exercise (2026-04's tracer default is too far in the
    // future relative to "now" for a boundary test; this test derives its
    // own start month from wall-clock "now" instead).
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
    const startMonth = startDate.toISOString().slice(0, 7);
    const currentMonth = now.toISOString().slice(0, 7);

    const initiative = await setupPhasedInitiative(base, karenToken, startMonth);

    const res = await fetch(`${base}/api/synergies/${initiative.id}/phasing/${currentMonth}`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ realizedM: 2.5 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    const row = body.initiative.phasing.find((r) => r.month === currentMonth);
    assert.strictEqual(row.realizedM, 2.5);
    const expectedSum = Math.round(body.initiative.phasing.reduce((a, r) => a + r.realizedM, 0) * 10) / 10;
    assert.strictEqual(body.initiative.realizedM, expectedSum, 'derived realizedM must equal the rounded sum of all rows after a write');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http g): a realized-value write to the month immediately AFTER the current month returns 400 with a stated reason, and the stored row is unchanged (D-06 boundary)', async () => {
  const deal = freshDeal('deal_synpg');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
    const startMonth = startDate.toISOString().slice(0, 7);
    const nextDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const nextMonth = nextDate.toISOString().slice(0, 7);

    const initiative = await setupPhasedInitiative(base, karenToken, startMonth);
    const beforeRow = initiative.phasing.find((r) => r.month === nextMonth);
    assert.ok(beforeRow, 'the generated 36-row horizon must include the month right after current for this test to be meaningful');

    const res = await fetch(`${base}/api/synergies/${initiative.id}/phasing/${nextMonth}`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ realizedM: 9 }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error && body.error.includes(nextMonth), 'the rejection reason must name the month');
    assert.ok(/not.*arrived/i.test(body.error), 'the rejection reason must state the month has not arrived');

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const list = await listRes.json();
    const found = list.find((s) => s.id === initiative.id);
    const afterRow = found.phasing.find((r) => r.month === nextMonth);
    assert.strictEqual(afterRow.realizedM, beforeRow.realizedM, 'a rejected write must leave the stored row unchanged');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http h): a targetM write to a FUTURE month returns 200 — target planning is not arrival-restricted (D-06)', async () => {
  const deal = freshDeal('deal_synph');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
    const startMonth = startDate.toISOString().slice(0, 7);
    const nextDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const nextMonth = nextDate.toISOString().slice(0, 7);

    const initiative = await setupPhasedInitiative(base, karenToken, startMonth);
    const res = await fetch(`${base}/api/synergies/${initiative.id}/phasing/${nextMonth}`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetM: 4 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const row = body.initiative.phasing.find((r) => r.month === nextMonth);
    assert.strictEqual(row.targetM, 4);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http i): the month immediately BEFORE the current month accepts a realized write (200) — the boundary is inclusive of the current month, exclusive above it (D-06)', async () => {
  const deal = freshDeal('deal_synpi');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
    const startMonth = startDate.toISOString().slice(0, 7);
    const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const previousMonth = prevDate.toISOString().slice(0, 7);

    const initiative = await setupPhasedInitiative(base, karenToken, startMonth);
    const res = await fetch(`${base}/api/synergies/${initiative.id}/phasing/${previousMonth}`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ realizedM: 1 }),
    });
    assert.strictEqual(res.status, 200);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http j): a :month not present in item.phasing returns 404', async () => {
  const deal = freshDeal('deal_synpj');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const initiative = await setupPhasedInitiative(base, karenToken, '2026-04');
    const res = await fetch(`${base}/api/synergies/${initiative.id}/phasing/2099-01`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetM: 1 }),
    });
    assert.strictEqual(res.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-phasing (http k): a :month failing the shape check is rejected by the schema with 400, before the handler ever runs', async () => {
  const deal = freshDeal('deal_synpk');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const initiative = await setupPhasedInitiative(base, karenToken, '2026-04');
    const res = await fetch(`${base}/api/synergies/${initiative.id}/phasing/not-a-month`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetM: 1 }),
    });
    // :month is a route param, not a body field, so PhasingMonthSchema
    // itself never sees it — server.js's handler reuses the SAME
    // isValidMonth() the schema is built on, checked before the row-lookup
    // 404, so a malformed month is distinguishable from a well-formed month
    // that simply has no generated row.
    assert.strictEqual(res.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ------------------------------------------------------- Task 3: source-level --

// SYN-01/UI-SPEC §2 persistence rule: a card expanded by the user must
// survive renderSynergy() rebuilding #syn-list wholesale on an unrelated
// edit. require() is not viable for this browser-global IIFE file inside
// node:test, so this is asserted at the SOURCE level — reading the file text
// and confirming the only assignment shape present is the one the toggle
// handler makes, never a wholesale reassignment.
test('synergy-phasing (source a): state.synExpanded is declared exactly once, assigned to only inside the expand-toggle handler, and never reassigned wholesale', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');

  const declarations = src.match(/synExpanded\s*:\s*\{\}/g) || [];
  assert.strictEqual(declarations.length, 1, 'state.synExpanded must be declared exactly once, as part of the initial state object literal');

  const indexedAssignments = src.match(/state\.synExpanded\[[^\]]+\]\s*=(?!=)/g) || [];
  assert.strictEqual(indexedAssignments.length, 1, 'state.synExpanded[id] must be assigned to exactly once in this file');
  const assignIdx = src.indexOf(indexedAssignments[0]);
  const toggleHandlerIdx = src.indexOf(".syn-expand-toggle').addEventListener");
  assert.ok(toggleHandlerIdx !== -1 && assignIdx > toggleHandlerIdx, 'the one indexed assignment must occur inside (after the start of) the expand-toggle click handler');

  const wholesaleReassignments = src.match(/state\.synExpanded\s*=(?!\s*\{\}[\s,])/g) || [];
  assert.strictEqual(wholesaleReassignments.length, 0, 'state.synExpanded must never be reassigned a fresh object outside its initial declaration');
});

// Same shape of proof for the mobile-grid's per-initiative show-all flag —
// the "showAll" state UI-SPEC §2 places "in the same state.synExpanded-
// adjacent module state."
test('synergy-phasing (source b): state.synShowAll is declared exactly once and assigned to only inside the show-all-link click handler', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');

  const declarations = src.match(/synShowAll\s*:\s*\{\}/g) || [];
  assert.strictEqual(declarations.length, 1, 'state.synShowAll must be declared exactly once');

  const indexedAssignments = src.match(/state\.synShowAll\[[^\]]+\]\s*=(?!=)/g) || [];
  assert.strictEqual(indexedAssignments.length, 1, 'state.synShowAll[id] must be assigned to exactly once in this file');
  const assignIdx = src.indexOf(indexedAssignments[0]);
  const linkHandlerIdx = src.indexOf("showAllLink.addEventListener");
  assert.ok(linkHandlerIdx !== -1 && assignIdx > linkHandlerIdx, 'the one indexed assignment must occur inside the show-all-link click handler');
});

// UI-SPEC §2/Copywriting Contract: regenerating discards manually-edited
// rows and must never be silent. Asserted at the source level that
// window.confirm() textually precedes the fetch() call inside the generate
// handler, i.e. the confirm gate runs BEFORE any request is issued.
test('synergy-phasing (source c): the regenerate handler calls window.confirm before its fetch to generate-phasing', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
  const handlerStart = src.indexOf("genBtn.addEventListener('click', function () {");
  assert.ok(handlerStart !== -1, 'the generate button click handler must exist');
  // WR-05: the boundary marker moved when the header-input wiring gained a
  // null-guard (var headerRealizedInput = ...; if (headerRealizedInput) {...}),
  // but it is still the very next handler-wiring block after the generate
  // handler, so it remains a valid slice boundary.
  const handlerEnd = src.indexOf("var headerRealizedInput = card.querySelector('.syn-head .syn-realized-input');", handlerStart);
  assert.ok(handlerEnd !== -1 && handlerEnd > handlerStart, 'the next handler after the generate handler must be found to bound the slice');
  const handlerSrc = src.slice(handlerStart, handlerEnd);

  const confirmIdx = handlerSrc.indexOf('window.confirm(');
  const fetchIdx = handlerSrc.indexOf("fetch('/api/synergies/' + encodeURIComponent(id) + '/generate-phasing'");
  assert.ok(confirmIdx !== -1, 'the generate handler must call window.confirm');
  assert.ok(fetchIdx !== -1, 'the generate handler must call fetch on the generate-phasing route');
  assert.ok(confirmIdx < fetchIdx, 'window.confirm must be called BEFORE the fetch, so a cancelled confirm aborts the request entirely');
});

// UI-SPEC §2 empty state: replaces the grid and its header row entirely —
// never an empty grid shell.
test('synergy-phasing (source d): the empty-phasing state renders the exact "No phasing rows yet" heading exactly once', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
  const occurrences = src.match(/No phasing rows yet/g) || [];
  assert.strictEqual(occurrences.length, 1, 'the empty-state heading copy must appear exactly once');
});

// WR-05: the header-level "Realized $M" input used to render unconditionally
// for every card, regardless of s.phasing.length — once phasing rows exist,
// server.js's D-04 guard unconditionally refuses that route's write with
// 400, so the control was guaranteed to error on every use, sitting right
// next to the correct read-only rollup figure. Asserted at the source level
// (this file's established convention for public/js/execution.js, which is
// not require()-able under node:test) that the input is now gated on
// exactly the same condition the server enforces, and that the click
// wiring is null-safe for the case where the input is absent.
test('synergy-phasing (source e): WR-05 — the header-level "Realized $M" input is gated on s.phasing.length, matching D-04\'s exact server-side rule, and a read-only figure renders once phasing rows exist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
  assert.match(
    src,
    /\(Array\.isArray\(s\.phasing\) && s\.phasing\.length > 0\s*\n\s*\? '<span><span data-i18n="syn\.realized_lbl">Realized \$M<\/span>: \$' \+ \(s\.realizedM \|\| 0\) \+ '<\/span>'\s*\n\s*: '<span><span data-i18n="syn\.realized_lbl">Realized \$M<\/span>: <input type="number" class="syn-realized-input"/,
    'the header-level realized control must branch on the exact same condition (phasing rows present) D-04 enforces server-side — an editable input only when unphased, a read-only figure when phased'
  );
});

test('synergy-phasing (source f): WR-05 — the header realized-input click wiring is null-guarded, so a phased-and-unexpanded card (where the input does not exist in the DOM) never throws attaching a listener to null', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
  const declIdx = src.indexOf("var headerRealizedInput = card.querySelector('.syn-head .syn-realized-input');");
  assert.ok(declIdx !== -1, 'the header-input lookup must be scoped to .syn-head, never matching a per-month .syn-detail grid cell');
  const guardIdx = src.indexOf('if (headerRealizedInput) {', declIdx);
  assert.ok(guardIdx !== -1 && guardIdx < declIdx + 200, 'the lookup must be immediately null-guarded before .addEventListener is called');
  const addListenerIdx = src.indexOf('headerRealizedInput.addEventListener(', guardIdx);
  assert.ok(addListenerIdx !== -1 && addListenerIdx > guardIdx, 'the addEventListener call must be inside the null guard');
});
