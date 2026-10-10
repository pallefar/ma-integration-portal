// T-05-47/D-01/D-02/D-03 (07-04-PLAN.md Task 1): the steering-committee
// headline must count phased-backed money only — free-typed realized money
// on an initiative with no phasing rows is real but not forecast-backed, and
// blending it into `grossRealizedM` overstated confidence a steerco pack
// would read as certain. This closes the reproduced Phase-5 residual
// (POST {stage:'validated', realizedM:9.9} moving grossRealizedM 0.9 -> 3.4,
// server.js's own comment cites 0.9 -> 3.4 for the analogous stage-gate
// bug): after this plan, a realized figure with no phasing backing lands in
// the SEPARATE `unphasedRealizedM` field, never in the headline.
//
// This file proves BOTH directions in ONE test (a field hardwired to zero
// would pass two independent one-directional tests), the conservation
// invariant (money is relabelled between the two fields, never created or
// lost), the item-level rounding discipline (the aggregate is cleaned up by
// roundSynergyMoney(), never re-derived by a second, divergent rounding
// path), and the zero-initiative edge case (both figures are 0, not
// undefined).
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/synergy-staleness.test.js's established harness shape exactly.
//
// node:test — Node's built-in runner. Run via `node --test
// test/synergy-rollup-split.test.js` (or `npm test`). Never `node --test
// test/` (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-synergy-rollup-split-'));
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

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/synergy-staleness.test.js).
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
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}
async function getRollup(base, token) {
  return (await fetch(`${base}/api/synergies/rollup`, { headers: { Cookie: cookieHeader(token) } })).json();
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

async function setupDeal(id, overrides) {
  const deal = freshDeal(id, overrides);
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const token = newSession('karen', 'hrbp');
  bindDeal(token, deal.id);
  return token;
}

// Creates an initiative WITH phasing rows and sets a single arrived month's
// realizedM, so the item's own rollup (synergyRollupFields()) is exactly
// `amount` — every other generated row stays at its generated realizedM: 0.
async function createPhasedInitiative(base, token, title, amount) {
  const createRes = await postJSON(base, '/api/synergies', token, { title, category: 'revenue' });
  const { initiative: created } = await createRes.json();
  await postJSON(base, `/api/synergies/${created.id}/generate-phasing`, token, {
    runRateM: 120, startMonth: '2020-01', curveShape: 'linear',
  });
  const realizeRes = await postJSON(base, `/api/synergies/${created.id}/phasing/2020-06`, token, { realizedM: amount });
  assert.strictEqual(realizeRes.status, 200, `seeding realizedM on the phased fixture "${title}" must succeed`);
  return created.id;
}

// Creates an initiative with NO phasing rows and a direct realizedM.
async function createUnphasedInitiative(base, token, title, amount) {
  const createRes = await postJSON(base, '/api/synergies', token, { title, category: 'revenue', realizedM: amount });
  assert.strictEqual(createRes.status, 201, `creating the unphased fixture "${title}" must succeed`);
  const { initiative: created } = await createRes.json();
  return created.id;
}

test('synergy-rollup-split (a): BOTH DIRECTIONS in one test — a phased initiative counts in grossRealizedM and NOT in unphasedRealizedM, an unphased initiative does exactly the reverse, and gross + unphased conserves the old undifferentiated total', async () => {
  const token = await setupDeal('deal_synsplita');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await createPhasedInitiative(base, token, 'Phased revenue line', 8);
    await createUnphasedInitiative(base, token, 'Unphased free-typed line', 5);

    const rollup = await getRollup(base, token);

    // Direction 1: the phased item is present in gross, absent from unphased.
    assert.strictEqual(rollup.grossRealizedM, 8, 'grossRealizedM must equal exactly the phased initiative\'s realized amount');
    // Direction 2: the unphased item is present in unphased, absent from gross.
    assert.strictEqual(rollup.unphasedRealizedM, 5, 'unphasedRealizedM must equal exactly the unphased initiative\'s realized amount');
    // A field hardwired to zero would satisfy only one of the two assertions
    // above in isolation — asserting both non-zero values in the SAME test,
    // against the SAME rollup response, is what proves the partition is real.
    assert.notStrictEqual(rollup.grossRealizedM, rollup.unphasedRealizedM, 'the two figures must be independently derived, not the same value by coincidence');

    // Conservation: gross + unphased equals what the old, undifferentiated
    // grossRealizedM field would have summed across BOTH initiatives (8+5) —
    // money is redistributed between two labels, never created or lost.
    assert.strictEqual(rollup.grossRealizedM + rollup.unphasedRealizedM, 13, 'gross plus unphased must equal the previously-undifferentiated realized total');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-rollup-split (b): a rounding-edge fixture whose per-item amounts do not sum cleanly at one decimal preserves the item-level rounding discipline rather than the aggregate being re-rounded', async () => {
  const token = await setupDeal('deal_synsplitb');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    // 0.1 + 0.2 === 0.30000000000000004 in raw IEEE-754 floating point — a
    // real hazard if the aggregate were summed and reported without cleanup.
    await createPhasedInitiative(base, token, 'Phased edge A', 0.1);
    await createPhasedInitiative(base, token, 'Phased edge B', 0.2);
    await createUnphasedInitiative(base, token, 'Unphased edge A', 0.1);
    await createUnphasedInitiative(base, token, 'Unphased edge B', 0.2);

    const rollup = await getRollup(base, token);
    assert.strictEqual(rollup.grossRealizedM, 0.3, 'summing two item-level-rounded phased amounts (0.1 + 0.2) must report exactly 0.3, not a floating-point residue');
    assert.strictEqual(rollup.unphasedRealizedM, 0.3, 'the same rounding discipline must hold for the unphased partition');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-rollup-split (c): a zero-initiative deal reports both figures as exactly 0, never undefined', async () => {
  const token = await setupDeal('deal_synsplitc');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const rollup = await getRollup(base, token);
    assert.strictEqual(rollup.grossRealizedM, 0);
    assert.strictEqual(rollup.unphasedRealizedM, 0);
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});
