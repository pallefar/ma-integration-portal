// SYN-05/D-16/D-17: freshness is only as honest as the mechanism that stamps
// it. A stamp any write can touch tells you nothing; a stamp only a
// deliberate act (or a real value/stage change) can touch is a claim
// somebody stands behind. This file proves the confirmation stamp's
// deliberate semantics (Task 1) and the per-deal threshold + server-computed
// rollup split (Task 2).
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/synergy-cost.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/synergy-staleness.test.js` (or `npm test`). Never `node --test test/`
// (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-synergy-staleness-'));
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
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Small shared setup helper — boots a fresh deal + hrbp session, following
// this file's own established one-deal-per-test convention.
async function setupDeal(id, overrides) {
  const deal = freshDeal(id, overrides);
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const token = newSession('karen', 'hrbp');
  bindDeal(token, deal.id);
  return token;
}

// ============================================================
// Task 1: the confirmation stamp and its deliberate semantics
// ============================================================

test('synergy-staleness (a): POST /api/synergies/:id/confirm-current sets a fresh lastConfirmedAt and changes no other field; an unknown id 404s', async () => {
  const token = await setupDeal('deal_synstala');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Confirm me', category: 'cost', owner: 'karen', notes: 'original notes' });
    const { initiative: created } = await createRes.json();
    assert.strictEqual(created.lastConfirmedAt, undefined, 'a freshly created initiative must carry no lastConfirmedAt');

    const confirmRes = await postJSON(base, `/api/synergies/${created.id}/confirm-current`, token, {});
    assert.notStrictEqual(confirmRes.status, 500, 'the route must be registered — never the validator registry\'s 500');
    assert.strictEqual(confirmRes.status, 200);
    const { initiative: confirmed } = await confirmRes.json();
    assert.ok(confirmed.lastConfirmedAt, 'confirm-current must set a fresh lastConfirmedAt');

    // Exactly one field must differ between the pre-request and post-request state.
    const changedKeys = Object.keys(created).filter((k) => JSON.stringify(created[k]) !== JSON.stringify(confirmed[k]));
    const newKeys = Object.keys(confirmed).filter((k) => !(k in created));
    assert.deepStrictEqual(changedKeys, [], 'no pre-existing field may change value');
    // CONC-02 (Phase 9): synergyInitiatives is a VERSIONED_COLLECTIONS member
    // (D-06 names it explicitly), so ANY write that changes a field —
    // including this route's own lastConfirmedAt stamp — now also stamps
    // version/updatedAt/updatedBy (db/store.js writeDb(), PD-1). This is the
    // new, correct cross-cutting behavior this phase introduces uniformly
    // across every in-scope collection, not a regression specific to this
    // route.
    assert.deepStrictEqual(newKeys, ['lastConfirmedAt', 'version', 'updatedAt', 'updatedBy'], 'lastConfirmedAt plus the Phase 9 version/updatedAt/updatedBy stamp must be the only new fields introduced by confirm-current');

    const unknownRes = await postJSON(base, '/api/synergies/syn_totally_unknown/confirm-current', token, {});
    assert.strictEqual(unknownRes.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (b): a title-only edit leaves lastConfirmedAt byte-identical; an owner-only edit refreshes it (D-16)', async () => {
  const token = await setupDeal('deal_synstalb');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Stamp seed', category: 'cost', owner: 'karen' });
    const { initiative: created } = await createRes.json();

    // Seed an initial lastConfirmedAt via a stamping-field edit (owner change).
    const seedRes = await postJSON(base, '/api/synergies', token, { id: created.id, owner: 'pmo' });
    const seeded = (await seedRes.json()).initiative;
    assert.ok(seeded.lastConfirmedAt, 'lastConfirmedAt must be set after a stamping-field edit');

    const titleOnlyRes = await postJSON(base, '/api/synergies', token, { id: created.id, title: 'Renamed only' });
    assert.strictEqual(titleOnlyRes.status, 200);
    const afterTitle = (await titleOnlyRes.json()).initiative;
    assert.strictEqual(afterTitle.lastConfirmedAt, seeded.lastConfirmedAt, 'a title-only edit must leave lastConfirmedAt byte-identical');

    const ownerOnlyRes = await postJSON(base, '/api/synergies', token, { id: created.id, owner: 'admin' });
    const afterOwner = (await ownerOnlyRes.json()).initiative;
    assert.notStrictEqual(afterOwner.lastConfirmedAt, seeded.lastConfirmedAt, 'an owner-only edit must refresh lastConfirmedAt');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (c): a notes-only edit leaves lastConfirmedAt byte-identical', async () => {
  const token = await setupDeal('deal_synstalc');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Notes seed', category: 'cost', owner: 'karen' });
    const { initiative: created } = await createRes.json();

    const seedRes = await postJSON(base, '/api/synergies', token, { id: created.id, category: 'revenue' });
    const seeded = (await seedRes.json()).initiative;
    assert.ok(seeded.lastConfirmedAt, 'lastConfirmedAt must be set after a stamping-field edit');

    const notesOnlyRes = await postJSON(base, '/api/synergies', token, { id: created.id, notes: 'a typo fix, nothing more' });
    assert.strictEqual(notesOnlyRes.status, 200);
    const afterNotes = (await notesOnlyRes.json()).initiative;
    assert.strictEqual(afterNotes.lastConfirmedAt, seeded.lastConfirmedAt, 'a notes-only edit must leave lastConfirmedAt byte-identical');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (d): runRateM, curveShape, startMonth, costPlannedM, costExpectedMonth, category, owner and workstreamId edits each refresh lastConfirmedAt', async () => {
  const token = await setupDeal('deal_synstald');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const fields = [
      { runRateM: 12 },
      { curveShape: 'linear' },
      { startMonth: '2025-01' },
      { costPlannedM: 5 },
      { costExpectedMonth: '2025-06' },
      { category: 'cost' },
      { owner: 'pmo' },
      { workstreamId: 'ws_finance' },
    ];
    for (const patch of fields) {
      const createRes = await postJSON(base, '/api/synergies', token, { title: 'Field ' + JSON.stringify(patch), category: 'revenue' });
      const { initiative: created } = await createRes.json();
      assert.strictEqual(created.lastConfirmedAt, undefined, 'a freshly created initiative must carry no lastConfirmedAt');

      const updateRes = await postJSON(base, '/api/synergies', token, Object.assign({ id: created.id }, patch));
      assert.strictEqual(updateRes.status, 200, `edit ${JSON.stringify(patch)} must succeed`);
      const updated = (await updateRes.json()).initiative;
      assert.ok(updated.lastConfirmedAt, `edit ${JSON.stringify(patch)} must refresh lastConfirmedAt`);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (e): a realized-value write through the per-month phasing route refreshes lastConfirmedAt', async () => {
  const token = await setupDeal('deal_synstale');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Phased realize', category: 'cost' });
    const { initiative: created } = await createRes.json();

    const genRes = await postJSON(base, `/api/synergies/${created.id}/generate-phasing`, token, { runRateM: 120, startMonth: '2020-01', curveShape: 'linear' });
    const generated = (await genRes.json()).initiative;
    assert.strictEqual(generated.lastConfirmedAt, undefined, 'generate-phasing itself must not stamp lastConfirmedAt (out of this task\'s behavior list)');

    const realizeRes = await postJSON(base, `/api/synergies/${created.id}/phasing/2020-01`, token, { realizedM: 3 });
    assert.strictEqual(realizeRes.status, 200);
    const realized = (await realizeRes.json()).initiative;
    assert.ok(realized.lastConfirmedAt, 'a realized-value write must refresh lastConfirmedAt');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (f): a stage change refreshes lastConfirmedAt (already implemented; asserted here as the contract)', async () => {
  const token = await setupDeal('deal_synstalf');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Stage stamp', category: 'cost' });
    const { initiative: created } = await createRes.json();
    assert.strictEqual(created.lastConfirmedAt, undefined);

    const stageRes = await postJSON(base, `/api/synergies/${created.id}/stage`, token, { targetStage: 'validated' });
    assert.strictEqual(stageRes.status, 200);
    const staged = (await stageRes.json()).initiative;
    assert.ok(staged.lastConfirmedAt, 'a stage change must refresh lastConfirmedAt');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (g): isSynergyStale() is false at exactly the threshold and true one millisecond later (boundary)', () => {
  const staleDays = 30;
  const now = Date.now();
  const exactlyAtThreshold = { lastConfirmedAt: new Date(now - staleDays * 86400000).toISOString() };
  const oneMsPast = { lastConfirmedAt: new Date(now - staleDays * 86400000 - 1).toISOString() };

  assert.strictEqual(app.isSynergyStale(exactlyAtThreshold, staleDays, now), false, 'exactly the threshold must NOT be stale');
  assert.strictEqual(app.isSynergyStale(oneMsPast, staleDays, now), true, 'one millisecond past the threshold must be stale');
});

test('synergy-staleness (h): isSynergyStale() falls back to createdAt when lastConfirmedAt is absent, and reports not stale when neither field is present or parseable', () => {
  const now = Date.now();
  const staleDays = 30;

  const oldCreatedOnly = { createdAt: new Date(now - staleDays * 86400000 - 5000).toISOString() };
  assert.strictEqual(app.isSynergyStale(oldCreatedOnly, staleDays, now), true, 'an old createdAt with no lastConfirmedAt must be judged stale via the fallback');

  const freshCreatedOnly = { createdAt: new Date(now - 1000).toISOString() };
  assert.strictEqual(app.isSynergyStale(freshCreatedOnly, staleDays, now), false, 'a fresh createdAt must not be stale');

  assert.strictEqual(app.isSynergyStale({}, staleDays, now), false, 'an item with neither field must be reported not stale, not defaulted to stale');
  assert.strictEqual(app.isSynergyStale({ lastConfirmedAt: 'not-a-date' }, staleDays, now), false, 'an unparseable lastConfirmedAt with no createdAt fallback must be reported not stale');
});

// ============================================================
// Task 2: per-deal settings and the server-computed rollup
// ============================================================

async function getSynergies(base, token) {
  return (await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } })).json();
}
async function getRollup(base, token) {
  return (await fetch(`${base}/api/synergies/rollup`, { headers: { Cookie: cookieHeader(token) } })).json();
}
async function getSettings(base, token) {
  return (await fetch(`${base}/api/settings`, { headers: { Cookie: cookieHeader(token) } })).json();
}

test('synergy-staleness (i): POST /api/settings with synergyStaleDays and synergyHorizonYears stores both; re-reading settings returns them (not stripped)', async () => {
  const token = await setupDeal('deal_synstali');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const writeRes = await postJSON(base, '/api/settings', token, { synergyStaleDays: 45, synergyHorizonYears: 5 });
    assert.strictEqual(writeRes.status, 200);

    const settings = await getSettings(base, token);
    assert.strictEqual(settings.synergyStaleDays, 45, 'synergyStaleDays must survive the write, not be stripped');
    assert.strictEqual(settings.synergyHorizonYears, 5, 'synergyHorizonYears must survive the write, not be stripped');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (j): a non-positive or non-numeric threshold falls back to the 30-day default at read time', () => {
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 0 } }), 30, 'a zero threshold must fall back to 30');
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: -5 } }), 30, 'a negative threshold must fall back to 30');
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 'not-a-number' } }), 30, 'a non-numeric threshold must fall back to 30');
  assert.strictEqual(app.synergyStaleDays({ settings: {} }), 30, 'an absent threshold must fall back to 30');
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 45 } }), 45, 'a valid positive threshold must be honored');
});

// WR-03: an unbounded synergyStaleDays had the IDENTICAL effect the reader's
// own comment warns against for the near-zero direction (T-05-27) — a huge
// configured value makes every initiative read as fresh forever, silently
// suppressing SYN-05's governance signal. D-17's per-deal configurability is
// preserved; only the ceiling is new.
test('synergy-staleness (q): WR-03 — a huge configured threshold clamps to the 365-day ceiling at read time, never suppressing the staleness signal permanently', () => {
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 999999999 } }), 365, 'a huge stored threshold must clamp to the 365-day ceiling');
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 365 } }), 365, 'exactly the ceiling must pass through unchanged');
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 364 } }), 364, 'just under the ceiling must pass through unchanged');
});

test('synergy-staleness (r): WR-03 — POST /api/settings with an out-of-range synergyStaleDays (e.g. 999999999) is refused with 400 by the schema, before any value can reach the settings singleton', async () => {
  const token = await setupDeal('deal_synstalr');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await postJSON(base, '/api/settings', token, { synergyStaleDays: 999999999 });
    assert.strictEqual(res.status, 400, 'an out-of-range synergyStaleDays must be refused by the schema, not silently accepted');

    const validRes = await postJSON(base, '/api/settings', token, { synergyStaleDays: 90 });
    assert.strictEqual(validRes.status, 200, 'an in-range synergyStaleDays must still be accepted');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (k): a configured short threshold on the deal changes the returned stale flags to match, not the 30-day default (D-17 configurability)', async () => {
  const token = await setupDeal('deal_synstalk');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await postJSON(base, '/api/settings', token, { synergyStaleDays: 1 });

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Short threshold', category: 'cost', owner: 'karen' });
    const { initiative: created } = await createRes.json();
    // A stamping-field edit sets lastConfirmedAt to "now" — with a 1-day
    // threshold this item is fresh immediately after the edit.
    await postJSON(base, '/api/synergies', token, { id: created.id, owner: 'pmo' });

    const list = await getSynergies(base, token);
    const stored = list.find((s) => s.id === created.id);
    assert.strictEqual(stored.stale, false, 'an item confirmed moments ago must not be stale even against a 1-day threshold');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// T-05-47/D-01 (07-04-PLAN.md): updated deliberately, not deleted. Both
// fixtures below carry no phasing rows, so under the redefinition their
// realized value lands in unphasedRealizedM, not grossRealizedM — the old
// "unconfirmed <= gross" invariant is now stated against the CONSERVED
// gross+unphased total (grossRealizedM alone no longer sums every item).
test('synergy-staleness (l): unconfirmedRealizedM never exceeds the conserved gross+unphased total across a lane with both stale and fresh initiatives carrying fractional values (precision)', async () => {
  const token = await setupDeal('deal_synstall');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    // A fresh (confirmed-just-now) initiative and a stale one (never
    // confirmed, old createdAt fallback simulated via a short threshold
    // applied AFTER creation so the just-created item reads as stale).
    const freshRes = await postJSON(base, '/api/synergies', token, { title: 'Fresh', category: 'cost', owner: 'karen', realizedM: 3.3 });
    const { initiative: fresh } = await freshRes.json();
    await postJSON(base, '/api/synergies', token, { id: fresh.id, owner: 'pmo' }); // seeds a lastConfirmedAt "now"

    const staleRes = await postJSON(base, '/api/synergies', token, { title: 'Stale', category: 'cost', owner: 'karen', realizedM: 4.1 });
    const { initiative: stale } = await staleRes.json();
    // No confirming edit — lastConfirmedAt falls back to createdAt.

    // A zero-day threshold makes ANY confirmed-in-the-past item stale
    // immediately, while the not-yet-elapsed-a-tick "fresh" one may or may
    // not tip over depending on timing — the precision property under test
    // (unconfirmed <= gross) holds regardless of exactly which items land on
    // which side, so this does not need to pin down which item is stale.
    await postJSON(base, '/api/settings', token, { synergyStaleDays: 0.0000000001 });

    const rollup = await getRollup(base, token);
    assert.ok(rollup.unconfirmedRealizedM <= (rollup.grossRealizedM + rollup.unphasedRealizedM), 'unconfirmedRealizedM must never exceed the conserved gross+unphased total');
    assert.strictEqual(rollup.grossRealizedM, 0, 'neither fixture carries phasing rows, so grossRealizedM (phased-only, T-05-47) must be 0');
    assert.strictEqual(rollup.unphasedRealizedM, 7.4, 'unphasedRealizedM must be the sum of both initiatives\' realized values');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (m): with zero stale initiatives, unconfirmedRealizedM, staleCount and mine.staleCount are all exactly zero (empty)', async () => {
  const token = await setupDeal('deal_synstalm');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Never stale', category: 'cost', owner: 'karen', realizedM: 5 });
    const { initiative: created } = await createRes.json();
    await postJSON(base, '/api/synergies', token, { id: created.id, owner: 'pmo' }); // freshly confirmed

    const rollup = await getRollup(base, token);
    assert.strictEqual(rollup.unconfirmedRealizedM, 0);
    assert.strictEqual(rollup.staleCount, 0);
    assert.strictEqual(rollup.mine.staleCount, 0);
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// T-05-47/D-01 (07-04-PLAN.md): updated deliberately, not deleted. Net
// benefit is now derived from the REDEFINED (phased-only) grossRealizedM, so
// this fixture is given phasing rows (rather than a bare realizedM) to keep
// exercising the general "net benefit = gross - cost" formula this test
// names — an unphased fixture would report netBenefitM = 0 - 10 = -10 here,
// which is the intended consequence of the redefinition, not what this
// specific test is about.
test('synergy-staleness (n): net benefit equals gross realized minus cost incurred and is negative when cost exceeds realized value', async () => {
  const token = await setupDeal('deal_synstaln');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Net benefit', category: 'cost' });
    const { initiative: created } = await createRes.json();
    await postJSON(base, `/api/synergies/${created.id}/generate-phasing`, token, { runRateM: 24, startMonth: '2020-01', curveShape: 'linear' });
    await postJSON(base, `/api/synergies/${created.id}/phasing/2020-06`, token, { realizedM: 2 });
    await postJSON(base, `/api/synergies/${created.id}/cost-entries`, token, { date: '2025-01-01', amountM: 10 });

    const rollup = await getRollup(base, token);
    assert.strictEqual(rollup.grossRealizedM, 2);
    assert.strictEqual(rollup.costIncurredM, 10);
    assert.strictEqual(rollup.netBenefitM, -8, 'net benefit must equal gross realized minus cost incurred, negative and unclamped');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (o): two initiatives sharing an identical lastConfirmedAt carry the same stale flag in one response (adjacency)', async () => {
  const token = await setupDeal('deal_synstalo');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const aRes = await postJSON(base, '/api/synergies', token, { title: 'Adjacency A', category: 'cost', owner: 'karen' });
    const { initiative: a } = await aRes.json();
    const bRes = await postJSON(base, '/api/synergies', token, { title: 'Adjacency B', category: 'cost', owner: 'karen' });
    const { initiative: b } = await bRes.json();

    // Both fall back to createdAt (never confirmed) — a very short threshold
    // makes both stale in the same request, judged against the same clock.
    await postJSON(base, '/api/settings', token, { synergyStaleDays: 0.0000000001 });

    const list = await getSynergies(base, token);
    const storedA = list.find((s) => s.id === a.id);
    const storedB = list.find((s) => s.id === b.id);
    assert.strictEqual(storedA.stale, true);
    assert.strictEqual(storedB.stale, true, 'both initiatives must carry the same stale verdict within one response');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (p): mine.staleCount differs between two identities reading the same lane, proving the scoping is on the caller (D-19)', async () => {
  const deal = freshDeal('deal_synstalp', { members: ['karen', 'pmo'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await postJSON(base, '/api/settings', karenToken, { synergyStaleDays: 0.0000000001 });

    const karenItemRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Owned by karen', category: 'cost', owner: 'karen' });
    await karenItemRes.json();
    const pmoItemRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Owned by pmo', category: 'cost', owner: 'pmo' });
    await pmoItemRes.json();

    const rollupAsKaren = await getRollup(base, karenToken);
    const rollupAsPmo = await getRollup(base, pmoToken);

    assert.strictEqual(rollupAsKaren.staleCount, 2, 'the total stale count is identical for both callers');
    assert.strictEqual(rollupAsPmo.staleCount, 2);
    assert.strictEqual(rollupAsKaren.mine.staleCount, 1, 'karen owns exactly one of the two stale initiatives');
    assert.strictEqual(rollupAsPmo.mine.staleCount, 1, 'pmo owns exactly one of the two stale initiatives');
    assert.notStrictEqual(rollupAsKaren.mine.staleCount, rollupAsKaren.staleCount, 'mine must be scoped narrower than the total in this fixture');
  } finally {
    [karenToken, pmoToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

// -------------------------------------------- Plan 07: client staleness UI --
//
// Source-level assertions against public/js/execution.js and
// public/execution.html — a live browser walk is deferred to Plan 08's
// human checkpoint (per this plan's own <verification> block), so these
// tests are what proves the confirm-current click/route/payload isolation
// (D-16), the server-verdict-only stale badge, the omitted-at-zero
// unconfirmed sentence, and the four-tile net-benefit colour rule, ahead of
// that walk.

function readClientSrc() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
}
function readExecutionHtml() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'execution.html'), 'utf8');
}

test('synergy-staleness-ui (a): the confirm-current handler is attached to its own dedicated button and issues a request carrying no content fields', () => {
  const src = readClientSrc();
  const handlerMatch = src.match(/card\.querySelector\('\.syn-confirm-btn'\)\.addEventListener\('click', function \(\) \{([\s\S]*?)\n {6}\}\);/);
  assert.ok(handlerMatch, 'a .syn-confirm-btn click handler must be attached, distinct from every other control');
  const body = handlerMatch[1];
  assert.match(body, /\/confirm-current/, 'the handler must POST to the dedicated confirm-current sub-route');
  // CONC-02 (Phase 9, Plan 02 Task 2): the request body is now built as a
  // variable (starting from an empty object literal) rather than an inline
  // `{}` literal, so the optimistic-lock `version` field — the SOLE
  // exception to D-16's "no content fields" guarantee, per Plan 02's
  // must_haves — can be conditionally attached. Assert BOTH halves of that
  // guarantee still hold: the body starts genuinely empty, and the ONLY
  // property ever assigned onto it is `version` — never a title, a note, or
  // any other content field.
  assert.match(body, /var confirmBody = \{\};/, 'the request body must start from a genuinely empty object literal');
  assert.match(body, /body: JSON\.stringify\(confirmBody\)/, 'the fetch call must send the confirmBody variable, not a second inline literal');
  const assignedProps = [...body.matchAll(/confirmBody\.(\w+)\s*=/g)].map((m) => m[1]);
  assert.deepStrictEqual(assignedProps, ['version'], 'the ONLY property ever assigned onto confirmBody must be the optimistic-lock version — no content field of any kind');
});

test('synergy-staleness-ui (b): no title or notes change handler in the file references the confirm-current route', () => {
  const src = readClientSrc();
  // Every fetch() call site targeting the confirm-current route (as
  // opposed to a plain descriptive comment mentioning the feature by
  // name) must be the ONE dedicated handler asserted above — never a
  // second call site riding along inside a title/notes/owner edit handler.
  const callSites = (src.match(/'\/confirm-current'/g) || []).length;
  assert.strictEqual(callSites, 1, 'the confirm-current route literal must appear in exactly one fetch() call — its own dedicated handler');
});

test('synergy-staleness-ui (c): the unconfirmed sentence is emitted only inside a conditional on a non-zero stale count, and is therefore absent at zero', () => {
  const src = readClientSrc();
  const fnMatch = src.match(/function renderSynRollup\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fnMatch, 'renderSynRollup must be defined');
  const body = fnMatch[0];
  assert.match(body, /staleCount > 0\s*\n\s*\? '<div class="syn-rollup-stale-split">/, 'the stale-split sentence must be gated on staleCount > 0, and the else branch must be empty');
});

test('synergy-staleness-ui (d): the stale badge is emitted only inside a conditional on the item\'s server-computed stale flag, and the client performs no staleness computation from timestamps', () => {
  const src = readClientSrc();
  assert.match(src, /var staleBadge = s\.stale\s*\n\s*\? /, 'the badge markup must be gated on the item\'s own s.stale field (the server verdict), not a client-side date comparison');
  assert.ok(!/Date\.now\(\)\s*-.*lastConfirmedAt/.test(src), 'the client must never subtract lastConfirmedAt from the current time to derive its own staleness verdict');
  assert.ok(!/isSynergyStale/.test(src), 'the client must never replicate the server\'s staleness function');
});

test('synergy-staleness-ui (e): five rollup tile elements are emitted (07-04-PLAN.md adds the unphased tile), and the net-benefit tile applies the destructive colour under a negative-value condition', () => {
  const src = readClientSrc();
  const fnMatch = src.match(/function renderSynRollup\(\) \{[\s\S]*?\n {2}\}/);
  const body = fnMatch[0];
  const tileCount = (body.match(/class="syn-rollup-tile"/g) || []).length;
  assert.strictEqual(tileCount, 5, 'exactly five .syn-rollup-tile elements must be emitted: gross realized, unphased, cost incurred, net benefit, deal target (T-05-47/D-01)');
  assert.match(body, /data-i18n="syn.rollup_unphased">Unphased</, 'the unphased tile must carry its own label, never a footnote inside the gross tile');
  assert.match(body, /var netColor = net < 0 \? '#C0392B' : /, 'the net-benefit tile\'s colour must be conditioned on a negative net value, applying the destructive colour');
  assert.match(body, /syn-rollup-value" style="color:' \+ netColor/, 'the destructive colour must actually be applied to the net-benefit tile\'s value element');
});

test('synergy-staleness-ui (f): the rollup fetch added to load() carries a degradation branch matching the file\'s existing per-fetch pattern', () => {
  const src = readClientSrc();
  const loadFnMatch = src.match(/function load\(\) \{[\s\S]*?\n {2}\}/);
  assert.ok(loadFnMatch, 'load() must be defined');
  const body = loadFnMatch[0];
  assert.match(body, /fetch\('\/api\/synergies\/rollup'\)\.then\(function \(r\) \{ return r\.json\(\); \}\)\.catch\(function \(\) \{ return \{\}; \}\)/, 'the rollup fetch must degrade to a neutral empty object on failure, matching the synergies/raid fetches\' own .catch pattern');
});

test('synergy-staleness-ui (g): public/execution.html declares .syn-rollup-tiles and .syn-stale-badge rules', () => {
  const html = readExecutionHtml();
  assert.ok(html.split('\n').some((l) => l.includes('.syn-rollup-tiles{')), '.syn-rollup-tiles rule must exist in public/execution.html');
  assert.ok(html.split('\n').some((l) => l.includes('.syn-stale-badge{')), '.syn-stale-badge rule must exist in public/execution.html');
});

test('synergy-staleness-ui (h): the retained percent-of-target bar still uses the pre-existing .syn-track/.syn-fill classes', () => {
  const src = readClientSrc();
  const fnMatch = src.match(/function renderSynRollup\(\) \{[\s\S]*?\n {2}\}/);
  const body = fnMatch[0];
  assert.match(body, /class="syn-track"/, 'the progress bar track must reuse the pre-existing .syn-track class');
  assert.match(body, /class="syn-fill"/, 'the progress bar fill must reuse the pre-existing .syn-fill class');
});

// ------------------------------------------ Plan 07: deal-home nudge UI --
//
// Source-level assertions against public/js/deal-home.js — a live browser
// walk is deferred to Plan 08's human checkpoint (per this plan's own
// <verification> block), so these tests are what proves the nudge's
// independence from the due-diligence page's own owner-nudge function
// (D-19, corrected location per 05-RESEARCH.md Finding #7/Pitfall 2), its
// textContent-only discipline, its zero/absent early return, and the
// rollup fetch's degradation branch, ahead of that walk.

function readDealHomeSrc() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'deal-home.js'), 'utf8');
}

test('synergy-staleness-ui (i): public/js/deal-home.js contains no assignment to an innerHTML property, preserving its stated textContent-only discipline', () => {
  const src = readDealHomeSrc();
  assert.ok(!/\.innerHTML\s*=/.test(src), 'no element\'s innerHTML may be assigned anywhere in this file');
});

test('synergy-staleness-ui (j): renderStaleSynergyNudge() returns early when the caller-scoped stale count is zero or absent', () => {
  const src = readDealHomeSrc();
  const fnMatch = src.match(/function renderStaleSynergyNudge\(wrap, rollup\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fnMatch, 'renderStaleSynergyNudge must be defined');
  const body = fnMatch[0];
  assert.match(body, /var mineStale = \(rollup && rollup\.mine && rollup\.mine\.staleCount\) \|\| 0;/, 'the count must default to 0 when rollup, rollup.mine, or rollup.mine.staleCount is absent');
  const guardIdx = body.indexOf('if (mineStale <= 0) return;');
  assert.ok(guardIdx > -1, 'an early return on a non-positive count must exist');
  assert.ok(guardIdx < body.indexOf('findSectionHeading'), 'the early return must be ordered BEFORE any DOM work — a zero/absent count produces no badge and no banner at all');
});

test('synergy-staleness-ui (k): the dismissal storage key is distinct from the due-diligence nudge\'s key', () => {
  const src = readDealHomeSrc();
  assert.match(src, /'syn_nudge_dismissed'/, 'a synergy-specific dismissal key must be used');
  assert.ok(!src.includes('dd_nudge_dismissed'), 'the due-diligence page\'s own dismissal key must never appear in this file');
});

test('synergy-staleness-ui (l): public/js/deal-home.js contains no reference to the due-diligence nudge function and no import of that file', () => {
  const src = readDealHomeSrc();
  // A prose comment mentioning the due-diligence page's discipline for
  // documentation purposes (pre-existing in this file's header, unrelated
  // to this plan) is fine — what must never exist is an actual import of
  // that file or a call to its nudge functions.
  assert.ok(!/require\([^)]*due-diligence[^)]*\)/.test(src), 'deal-home.js must not require/import due-diligence.js');
  assert.ok(!/script[^>]*src=["'][^"']*due-diligence\.js/.test(src), 'deal-home.js must not <script>-tag due-diligence.js');
  assert.ok(!/renderOwnerNudge\(/.test(src), 'deal-home.js must never call renderOwnerNudge()');
  assert.ok(!/loadOwnerNudge\(/.test(src), 'deal-home.js must never call loadOwnerNudge()');
});

test('synergy-staleness-ui (m): the banner and badge element ids are distinct from the due-diligence nudge\'s ids, and each is created only when not already present', () => {
  const src = readDealHomeSrc();
  assert.match(src, /'syn-nudge-badge'/);
  assert.match(src, /'syn-nudge-banner'/);
  assert.ok(!src.includes('dd-nudge-badge'), 'the due-diligence page\'s own badge id must never appear in this file');
  assert.ok(!src.includes('dd-nudge-banner'), 'the due-diligence page\'s own banner id must never appear in this file');
  assert.match(src, /!document\.getElementById\('syn-nudge-badge'\)/, 'the badge must be created only when an element with that id is not already present');
  assert.match(src, /if \(document\.getElementById\('syn-nudge-banner'\)\) return;/, 'the banner must be created only when an element with that id is not already present');
});

test('synergy-staleness-ui (n): the rollup fetch added to renderDealHome() carries a degradation branch matching the three existing fetches', () => {
  const src = readDealHomeSrc();
  const fnMatch = src.match(/function renderDealHome\(dealId\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fnMatch, 'renderDealHome must be defined');
  const body = fnMatch[0];
  assert.match(body, /fetch\('\/api\/synergies\/rollup'\)\.then\(function \(r\) \{ return r\.json\(\); \}\)\.catch\(function \(\) \{ return null; \}\)/, 'the rollup fetch must degrade the same way as the assessment-status/dd-summary fetches (a failed fetch yields null, best-effort)');
  assert.match(body, /renderStaleSynergyNudge\(wrap, rollup\);/, 'the nudge must be called alongside the three existing panel renders');
});

test('synergy-staleness-ui (o): window.makeBannerDismissible is called guarded by a typeof check', () => {
  const src = readDealHomeSrc();
  const occurrences = (src.match(/makeBannerDismissible/g) || []).length;
  assert.ok(occurrences >= 1, 'makeBannerDismissible must be referenced at least once');
  assert.match(src, /typeof window\.makeBannerDismissible === 'function'/, 'the call must be guarded by a typeof check, matching the due-diligence page\'s own defensive pattern');
});

test('synergy-staleness (q): GET /api/synergies returns items in the lane\'s stored insertion order (ordering)', async () => {
  const token = await setupDeal('deal_synstalq');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const titles = ['First', 'Second', 'Third'];
    for (const title of titles) {
      await postJSON(base, '/api/synergies', token, { title, category: 'cost' });
    }

    const list = await getSynergies(base, token);
    assert.deepStrictEqual(list.map((s) => s.title), titles, 'items must be returned in the lane\'s stored insertion order');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});
