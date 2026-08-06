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
  const server = app.listen(0);
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

test('synergy-staleness (k): a configured short threshold on the deal changes the returned stale flags to match, not the 30-day default (D-17 configurability)', async () => {
  const token = await setupDeal('deal_synstalk');
  const server = app.listen(0);
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

test('synergy-staleness (l): unconfirmedRealizedM never exceeds grossRealizedM across a lane with both stale and fresh initiatives carrying fractional values (precision)', async () => {
  const token = await setupDeal('deal_synstall');
  const server = app.listen(0);
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
    assert.ok(rollup.unconfirmedRealizedM <= rollup.grossRealizedM, 'unconfirmedRealizedM must never exceed grossRealizedM');
    assert.strictEqual(rollup.grossRealizedM, 7.4, 'gross realized must be the sum of both initiatives\' realized values');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-staleness (m): with zero stale initiatives, unconfirmedRealizedM, staleCount and mine.staleCount are all exactly zero (empty)', async () => {
  const token = await setupDeal('deal_synstalm');
  const server = app.listen(0);
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

test('synergy-staleness (n): net benefit equals gross realized minus cost incurred and is negative when cost exceeds realized value', async () => {
  const token = await setupDeal('deal_synstaln');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Net benefit', category: 'cost', realizedM: 2 });
    const { initiative: created } = await createRes.json();
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
  const server = app.listen(0);
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
  const server = app.listen(0);
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

test('synergy-staleness (q): GET /api/synergies returns items in the lane\'s stored insertion order (ordering)', async () => {
  const token = await setupDeal('deal_synstalq');
  const server = app.listen(0);
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
