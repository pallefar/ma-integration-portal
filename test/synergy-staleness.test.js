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
  const server = app.listen(0);
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
    assert.deepStrictEqual(newKeys, ['lastConfirmedAt'], 'lastConfirmedAt must be the ONLY new field introduced by confirm-current');

    const unknownRes = await postJSON(base, '/api/synergies/syn_totally_unknown/confirm-current', token, {});
    assert.strictEqual(unknownRes.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (b): a title-only edit leaves lastConfirmedAt byte-identical; an owner-only edit refreshes it (D-16)', async () => {
  const token = await setupDeal('deal_synstalb');
  const server = app.listen(0);
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
  const server = app.listen(0);
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
  const server = app.listen(0);
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
  const server = app.listen(0);
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
  const server = app.listen(0);
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
