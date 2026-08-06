// SYN-03 / D-07 / D-11: proves the one-way lifecycle-vocabulary cutover —
// `stage` (idea/validated/committed/captured) replaces the retired
// `status` (identified/validated/planned/executing/realized) — across all
// three independent code copies, refused-not-coerced legacy values, and (in
// Task 3's extension below) the committed-database migration script.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/synergy-phasing.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/synergy-stage.test.js` (or `npm test`). Never `node --test test/`
// (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-synergy-stage-'));
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

// --------------------------------------------------------- anti-drift --

// D-11: the mechanism that makes a one-copy-behind edit impossible to ship
// — reads all THREE independent copies (two via require(), the client's via
// fs.readFileSync + a regex extraction, since it is a browser-global IIFE
// never require()-able under node:test) and asserts all three are the
// identical ordered four-value array.
test('synergy-stage (a): server.js, validators/workstream.js and public/js/execution.js all hold the identical ordered SYN_STAGES vocabulary', () => {
  const expected = ['idea', 'validated', 'committed', 'captured'];

  assert.deepStrictEqual(app.SYN_STAGES, expected, 'server.js SYN_STAGES must be the exact ordered four-value vocabulary');
  assert.deepStrictEqual(workstreamValidators.SYN_STAGES, expected, 'validators/workstream.js SYN_STAGES must be the exact ordered four-value vocabulary');

  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
  const match = clientSrc.match(/var SYN_STAGES\s*=\s*(\[[^\]]*\]);/);
  assert.ok(match, 'public/js/execution.js must declare a var SYN_STAGES = [...] array literal');
  // eslint-disable-next-line no-eval
  const clientStages = JSON.parse(match[1].replace(/'/g, '"'));
  assert.deepStrictEqual(clientStages, expected, 'public/js/execution.js SYN_STAGES must be the exact ordered four-value vocabulary');

  // Cross-file agreement, not just each-matches-expected independently — this
  // is what actually fails if only ONE of the three is edited.
  assert.deepStrictEqual(app.SYN_STAGES, workstreamValidators.SYN_STAGES);
  assert.deepStrictEqual(workstreamValidators.SYN_STAGES, clientStages);
});

test('synergy-stage (b): the client label map and colour map each have exactly four keys matching the vocabulary array', () => {
  const expected = ['idea', 'validated', 'committed', 'captured'];
  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');

  const labelsMatch = clientSrc.match(/var SYN_LABELS\s*=\s*(\{[^}]*\});/);
  assert.ok(labelsMatch, 'public/js/execution.js must declare a var SYN_LABELS = {...} object literal');
  const labels = JSON.parse(labelsMatch[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  assert.deepStrictEqual(Object.keys(labels).sort(), [...expected].sort(), 'SYN_LABELS must have exactly the four vocabulary keys');

  const colorsMatch = clientSrc.match(/var SYN_COLORS\s*=\s*(\{[^}]*\});/);
  assert.ok(colorsMatch, 'public/js/execution.js must declare a var SYN_COLORS = {...} object literal');
  const colors = JSON.parse(colorsMatch[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  assert.deepStrictEqual(Object.keys(colors).sort(), [...expected].sort(), 'SYN_COLORS must have exactly the four vocabulary keys');
});

// -------------------------------------------------------- schema-level --

test('synergy-stage (c): SynergyUpsertSchema accepts a create with stage "idea" and rejects a retired legacy status value', () => {
  const ok = workstreamValidators.SynergyUpsertSchema.safeParse({ title: 'x', stage: 'idea' });
  assert.strictEqual(ok.success, true, 'a create carrying a valid stage value must parse successfully');

  const legacy = workstreamValidators.SynergyUpsertSchema.safeParse({ title: 'x', stage: 'identified' });
  assert.strictEqual(legacy.success, false, 'a create carrying a retired legacy status value must be REFUSED by the schema, never coerced');
});

// ------------------------------------------------------------- http --

test('synergy-stage (d): POST /api/synergies with no stage creates an initiative whose stage is the first ordered vocabulary value', async () => {
  const deal = freshDeal('deal_synsd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Stage-less create', category: 'cost' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.initiative.stage, 'idea', 'a stage-less create must default to the first vocabulary value');
    assert.strictEqual(body.initiative.status, undefined, 'the retired `status` key must not be present on a newly created initiative');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage (e): POST /api/synergies carrying a retired legacy stage value returns 400 and creates no row (D-11 — refusal, never coercion)', async () => {
  const deal = freshDeal('deal_synse');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should be refused', category: 'cost', stage: 'executing' }),
    });
    assert.strictEqual(res.status, 400);

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 0, 'a refused create must not add a row to the lane');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage (f): T-05-13 — POST /api/synergies carrying a `stage` key on the update branch is refused with 400 and the stored stage is unchanged; the dedicated stage route has no bypass', async () => {
  const deal = freshDeal('deal_synsf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Advance me', category: 'cost' }),
    });
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.stage, 'idea');

    const bypassRes = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: initiative.id, stage: 'validated' }),
    });
    assert.strictEqual(bypassRes.status, 400, 'a valid stage value on the base upsert update branch must still be refused — no bypass route');

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const list = await listRes.json();
    const stored = list.find((s) => s.id === initiative.id);
    assert.strictEqual(stored.stage, 'idea', 'the stored stage must be unchanged after the refused bypass attempt');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ============================================================= Plan 03 ==
// Task 1: D-08 hard stage gates, D-09 reasoned backward movement.
// ============================================================================

// Small file-local helper (NOT extracted to a shared module — matches this
// file's own established convention above) to cut boilerplate across the
// stage-gate tests below, which each need several sequential POSTs.
function postJSON(base, path, token, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

test('synergy-stage-gate (a): advancing to committed with an owner and a phased target (run-rate + start month) succeeds; advancing to captured with realized value in an arrived month succeeds', async () => {
  const deal = freshDeal('deal_synga');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Ramp me', category: 'cost', owner: 'Karen Owner' });
    const { initiative } = await createRes.json();

    const phaseRes = await postJSON(base, `/api/synergies/${initiative.id}/generate-phasing`, karenToken, { runRateM: 2, startMonth: '2020-01', curveShape: 'linear' });
    assert.strictEqual(phaseRes.status, 200);

    const toValidated = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'validated' });
    assert.strictEqual(toValidated.status, 200);

    const toCommitted = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'committed' });
    assert.strictEqual(toCommitted.status, 200, 'owner + run-rate + start month must satisfy the committed gate');

    const realizedRes = await postJSON(base, `/api/synergies/${initiative.id}/phasing/2020-01`, karenToken, { realizedM: 1 });
    assert.strictEqual(realizedRes.status, 200);

    const toCaptured = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'captured' });
    assert.strictEqual(toCaptured.status, 200, 'realized value in an arrived month must satisfy the captured gate');
    const capturedBody = await toCaptured.json();
    assert.strictEqual(capturedBody.initiative.stage, 'captured');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage-gate (b): advancing to committed with an empty owner is refused with 400 naming the missing owner, and the persisted stage (read back via GET) is unchanged', async () => {
  const deal = freshDeal('deal_syngb');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'No owner', category: 'cost' });
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.owner, '');

    const res = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'committed' });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /owner/i, 'the refusal reason must name the missing owner');

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.find((s) => s.id === initiative.id).stage, 'idea', 'a refused advance must leave the persisted stage unchanged');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage-gate (c): advancing to committed with an owner but no run-rate/start month is refused with 400 naming the missing phased target', async () => {
  const deal = freshDeal('deal_syngc');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Owner only', category: 'cost', owner: 'Karen Owner' });
    const { initiative } = await createRes.json();

    const res = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'committed' });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /phased target/i, 'the refusal reason must name the missing phased target');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage-gate (d): advancing to captured with zero realized value anywhere is refused with 400', async () => {
  const deal = freshDeal('deal_syngd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Zero realized', category: 'cost', owner: 'Karen Owner' });
    const { initiative } = await createRes.json();
    await postJSON(base, `/api/synergies/${initiative.id}/generate-phasing`, karenToken, { runRateM: 2, startMonth: '2020-01', curveShape: 'linear' });
    await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'committed' });

    const res = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'captured' });
    assert.strictEqual(res.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage-gate (e): defence-in-depth — stageGateFailure() refuses captured when the only non-zero realized value sits in a future month (unreachable via the normal write path, asserted directly against the exported pure function)', () => {
  const futureMonth = new Date(Date.now() + 1000 * 60 * 60 * 24 * 400).toISOString().slice(0, 7); // > 1 year out
  const item = {
    stage: 'committed', owner: 'Karen Owner', runRateM: 2, startMonth: '2020-01',
    phasing: [{ month: futureMonth, targetM: 1, realizedM: 5 }],
  };
  const failure = app.stageGateFailure(item, 'captured');
  assert.ok(failure, 'a future-month-only realized value must not satisfy the captured gate');
});

test('synergy-stage-gate (f): moving backward requires a non-empty reason — no reason and a whitespace-only reason both 400 with no baseline entry appended; a real reason succeeds and appends one carrying the reason and the pre-change stage', async () => {
  const deal = freshDeal('deal_syngf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Demote me', category: 'cost' });
    const { initiative } = await createRes.json();
    await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'validated' });

    const noReasonRes = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'idea' });
    assert.strictEqual(noReasonRes.status, 400);

    const whitespaceRes = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'idea', reason: '   ' });
    assert.strictEqual(whitespaceRes.status, 400, 'a whitespace-only reason must be refused exactly like an empty one');

    const afterRefusalsRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const afterRefusals = await afterRefusalsRes.json();
    const storedAfterRefusals = afterRefusals.find((s) => s.id === initiative.id);
    assert.strictEqual(storedAfterRefusals.stage, 'validated', 'a refused demotion must leave the persisted stage unchanged');
    assert.strictEqual((storedAfterRefusals.baselines || []).length, 0, 'no refused demotion may append a baseline entry');

    const realReasonRes = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'idea', reason: 'De-scoped pending re-review' });
    assert.strictEqual(realReasonRes.status, 200);
    const demoted = await realReasonRes.json();
    assert.strictEqual(demoted.initiative.stage, 'idea');
    assert.strictEqual(demoted.initiative.baselines.length, 1);
    assert.strictEqual(demoted.initiative.baselines[0].reason, 'De-scoped pending re-review');
    assert.strictEqual(demoted.initiative.baselines[0].stage, 'validated', 'the baseline entry must carry the PRE-CHANGE stage');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage-gate (g): requesting the stage an initiative already holds is a 200 no-op — no state change, no baseline entry, no lastConfirmedAt stamp', async () => {
  const deal = freshDeal('deal_syngg');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Same stage', category: 'cost' });
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.lastConfirmedAt, undefined);

    const res = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'idea' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.initiative.stage, 'idea');
    assert.strictEqual((body.initiative.baselines || []).length, 0);
    assert.strictEqual(body.initiative.lastConfirmedAt, undefined, 'a same-stage no-op must not stamp lastConfirmedAt');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage-gate (h): a targetStage outside the four-value vocabulary is refused with 400 by the schema', async () => {
  const deal = freshDeal('deal_syngh');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Bad target', category: 'cost' });
    const { initiative } = await createRes.json();

    const res = await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'realized' });
    assert.strictEqual(res.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// CR-02: `STAGE_ORDER[item.stage]` is `undefined` for a row whose stage was
// never migrated onto the four-value vocabulary (WR-04's exact scenario — a
// customSynergyInitiatives-lane row that predates this phase's migration
// script, or any row a future write path leaves without a `stage`).
// `targetOrdinal > currentOrdinal` is ALWAYS false against `undefined` (a
// NaN comparison), which used to fall into the backward-move branch —
// requiring only a non-empty reason string and running NO gate at all. This
// is reachable through completely ordinary use of the stage route, not
// database tampering: `{ targetStage: 'captured', reason: 'x' }` against
// such a row used to jump it straight to captured with no owner, no phased
// target and no realized value. Simulates the pre-migration row directly by
// inserting a raw synergyInitiatives row via the deal's own SQLite file,
// bypassing the create-time schema (which always enum-validates `stage`) —
// exactly how a real pre-Phase-5 row would look, and the ONLY way to
// construct one for this test.
test('synergy-stage-gate (i): CR-02 — a stage-change request against an initiative with NO stage value (unmigrated row) is refused with 500, never silently advanced to the target stage with no gate check', async () => {
  const deal = freshDeal('deal_syngi');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const dealDbPath = dbFiles.dealDbPath(deal.id);
  const conn = dbFiles.openDbFile(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
  try {
    const item = {
      id: 'syn_unmigrated', title: 'Pre-migration row', category: 'cost',
      targetM: 0, realizedM: 0, owner: '', runRateM: 0, phasing: [], baselines: [],
      createdAt: new Date().toISOString(),
      // Deliberately NO `stage` key — mirrors an unmigrated WR-04 row.
    };
    conn.prepare('INSERT INTO synergyInitiatives (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
      .run(item.id, null, 0, JSON.stringify(item));
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    // The exact exploit payload from the review: jump straight to captured
    // with a reason string, no owner, no phased target, no realized value.
    const res = await postJSON(base, '/api/synergies/syn_unmigrated/stage', karenToken, { targetStage: 'captured', reason: 'x' });
    assert.notStrictEqual(res.status, 200, 'a stage-change request against an unmigrated row must NEVER succeed — this is the whole gate-bypass bug');
    assert.strictEqual(res.status, 500, 'an unrecognized current stage must fail closed with a clear server error, not silently coerce to a backward move');

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const list = await listRes.json();
    const stored = list.find((s) => s.id === 'syn_unmigrated');
    assert.notStrictEqual(stored.stage, 'captured', 'the row must NOT have been silently advanced to captured with no owner, no phased target and no realized value');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// CR-03: generate-phasing wholesale-replaces item.phasing with rows all
// carrying realizedM: 0. Regenerating on an already-captured initiative used
// to leave item.stage === 'captured' with no re-check — the stage badge
// claimed "Captured" while grossRealizedM (the steering-committee rollup)
// silently dropped to 0, a domain-invariant violation reachable through the
// feature's own primary documented workflow, not database tampering.
test('synergy-stage-gate (j): CR-03 — regenerating phasing on a captured initiative demotes it to committed (the highest stage whose own gate still passes) and records an automatic-demotion baseline entry; realizedM rolls back to the fresh zero-row sum', async () => {
  const deal = freshDeal('deal_syngj');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Regen after capture', category: 'cost', owner: 'Karen Owner' });
    const { initiative } = await createRes.json();

    // A start month far enough in the past that the whole 3-year horizon's
    // first months have already arrived, mirroring the arrived-month setup
    // synergy-phasing.test.js's own http (f) test uses.
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));
    const startMonth = startDate.toISOString().slice(0, 7);
    const currentMonth = now.toISOString().slice(0, 7);

    await postJSON(base, `/api/synergies/${initiative.id}/generate-phasing`, karenToken, { runRateM: 2, startMonth, curveShape: 'linear' });
    await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'validated' });
    const toCommitted = await (await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'committed' })).json();
    assert.strictEqual(toCommitted.initiative.stage, 'committed');

    await postJSON(base, `/api/synergies/${initiative.id}/phasing/${currentMonth}`, karenToken, { realizedM: 1 });
    const toCaptured = await (await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'captured' })).json();
    assert.strictEqual(toCaptured.initiative.stage, 'captured', 'sanity check: the initiative must actually reach captured before this test\'s regeneration step is meaningful');
    const baselineCountBeforeRegen = toCaptured.initiative.baselines.length;

    // The regeneration itself — same runRateM/startMonth/curveShape, so this
    // is purely "re-run the ramp", not a scope change. Every fresh row
    // carries realizedM: 0, which is exactly what invalidates the captured
    // gate's "realized value recorded in at least one arrived month"
    // requirement.
    const regenRes = await postJSON(base, `/api/synergies/${initiative.id}/generate-phasing`, karenToken, { runRateM: 2, startMonth, curveShape: 'linear' });
    assert.strictEqual(regenRes.status, 200);
    const regenBody = await regenRes.json();

    assert.strictEqual(regenBody.initiative.stage, 'committed', 'the captured-evidence gate no longer holds against the fresh zero rows — the initiative must be demoted to the highest stage (committed) whose own gate still passes, never left claiming captured');
    assert.strictEqual(regenBody.initiative.realizedM, 0, 'the derived rollup must reflect the fresh zero-row phasing, matching the demoted stage');
    assert.strictEqual(regenBody.initiative.baselines.length, baselineCountBeforeRegen + 1, 'exactly one new baseline entry must record the automatic demotion');
    const demotionEntry = regenBody.initiative.baselines[regenBody.initiative.baselines.length - 1];
    assert.match(demotionEntry.reason, /[Aa]utomatic demotion/, 'the appended baseline must state this was an automatic demotion, distinguishable from a deliberate D-09 backward move');

    // Persisted, not just the response body — read back via GET to prove the
    // demotion survived the write, matching this file's established
    // read-back-after-write proof pattern.
    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const list = await listRes.json();
    const stored = list.find((s) => s.id === initiative.id);
    assert.strictEqual(stored.stage, 'committed', 'the persisted stage must reflect the demotion, not just the response body');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ============================================================= Plan 03 ==
// Task 2: D-12/D-13/D-14 baseline history + the pinned deal case, D-15
// re-baseline authz (the CR-01-lesson two-identity 200/403 proof).
// ============================================================================

test('synergy-baseline (a): D-15 — re-baselining the SAME payload returns 200 for admin and hrbp, 403 for pmo and employee; baselines.length is unchanged after each refusal', async () => {
  const deal = freshDeal('deal_synba', { members: ['karen', 'pmo', 'employee-demo'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const employeeToken = newSession('employee-demo', 'employee'); bindDeal(employeeToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Four identities', category: 'cost' });
    const { initiative } = await createRes.json();
    const payload = { reason: 'quarterly reforecast' };

    const adminRes = await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, adminToken, payload);
    assert.strictEqual(adminRes.status, 200, 'admin must be able to re-baseline');

    const karenRes = await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, karenToken, payload);
    assert.strictEqual(karenRes.status, 200, 'hrbp (Integration Lead) must be able to re-baseline');

    const beforePmo = (await (await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } })).json())
      .find((s) => s.id === initiative.id).baselines.length;

    const pmoRes = await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, pmoToken, payload);
    assert.strictEqual(pmoRes.status, 403, 'pmo must be refused — the SAME payload that succeeded for admin/hrbp');

    const employeeRes = await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, employeeToken, payload);
    assert.strictEqual(employeeRes.status, 403, 'employee must be refused — the SAME payload that succeeded for admin/hrbp');

    const afterRefusals = (await (await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } })).json())
      .find((s) => s.id === initiative.id).baselines.length;
    assert.strictEqual(afterRefusals, beforePmo, 'baselines.length must be unchanged after each 403 refusal');
  } finally {
    [adminToken, karenToken, pmoToken, employeeToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('synergy-baseline (b): the 403 is returned for an unknown initiative id too, proving the role guard runs BEFORE the lookup', async () => {
  const deal = freshDeal('deal_synbb');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await postJSON(base, '/api/synergies/syn_totally_unknown_id/rebaseline', pmoToken, { reason: 'anything' });
    assert.strictEqual(res.status, 403, 'an unauthorized role must be refused before the id is even looked up (no 404 leak)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('synergy-baseline (c): re-baselining with an empty or whitespace-only reason returns 400', async () => {
  const deal = freshDeal('deal_synbc');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Reasonless', category: 'cost' });
    const { initiative } = await createRes.json();

    const emptyRes = await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, karenToken, { reason: '' });
    assert.strictEqual(emptyRes.status, 400);

    const whitespaceRes = await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, karenToken, { reason: '   ' });
    assert.strictEqual(whitespaceRes.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-baseline (d): D-14 — the deal case is stamped as version 1 the first time an initiative gets a phased target, and three successive re-baselines never move, renumber or replace it', async () => {
  const deal = freshDeal('deal_synbd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Deal case', category: 'cost' });
    const { initiative } = await createRes.json();
    assert.strictEqual((initiative.baselines || []).length, 0, 'UI-E3 empty: no baseline yet is a real state before any phased target exists');

    const phaseRes = await postJSON(base, `/api/synergies/${initiative.id}/generate-phasing`, karenToken, { runRateM: 2, startMonth: '2020-01', curveShape: 'linear' });
    const phased = await phaseRes.json();
    assert.strictEqual(phased.initiative.baselines.length, 1, 'generating the first phased target must stamp the deal case');
    assert.strictEqual(phased.initiative.baselines[0].version, 1);
    const dealCase = phased.initiative.baselines[0];

    const first = await (await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, karenToken, { reason: 'r1' })).json();
    const second = await (await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, karenToken, { reason: 'r2' })).json();
    const third = await (await postJSON(base, `/api/synergies/${initiative.id}/rebaseline`, karenToken, { reason: 'r3' })).json();

    assert.strictEqual(third.initiative.baselines.length, 4, 'deal case + 3 re-baselines = 4 entries');
    [first, second, third].forEach((r) => {
      assert.strictEqual(r.initiative.baselines[0].id, dealCase.id, 'the entry at index 0 must keep the SAME id after every subsequent re-baseline');
      assert.strictEqual(r.initiative.baselines[0].version, 1, 'the entry at index 0 must stay version 1');
      assert.strictEqual(r.initiative.baselines[0].at, dealCase.at, 'the entry at index 0 must keep the SAME timestamp');
      assert.strictEqual(r.initiative.baselines[0].reason, dealCase.reason, 'the entry at index 0 must keep the SAME reason');
    });
    assert.strictEqual(third.initiative.baselines[3].version, 4, 'a later re-baseline must derive its version from the highest existing version, not the array length');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-baseline (e): D-12 — a baseline\'s targetCurve is a deep copy; editing item.phasing afterwards through the per-month route leaves the stored baseline unchanged', async () => {
  const deal = freshDeal('deal_synbe');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Deep copy', category: 'cost' });
    const { initiative } = await createRes.json();
    // runRateM=240 with linear checkpoints guarantees a non-trivial (nonzero,
    // easily distinguishable after rounding) targetM even in the ramp's very
    // first month, so the "did it actually mutate" assertion below is
    // meaningful regardless of the ramp math's exact interpolation.
    const phaseRes = await postJSON(base, `/api/synergies/${initiative.id}/generate-phasing`, karenToken, { runRateM: 240, startMonth: '2020-01', curveShape: 'linear' });
    const phased = await phaseRes.json();
    const originalTargetM = phased.initiative.baselines[0].targetCurve.find((r) => r.month === '2020-01').targetM;
    assert.ok(originalTargetM > 0, 'sanity check: the seeded fixture (runRateM=240) must produce a nonzero first-month target');

    const mutatedTargetM = originalTargetM + 999;
    const mutateRes = await postJSON(base, `/api/synergies/${initiative.id}/phasing/2020-01`, karenToken, { targetM: mutatedTargetM });
    assert.strictEqual(mutateRes.status, 200);

    const afterRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const after = (await afterRes.json()).find((s) => s.id === initiative.id);
    assert.strictEqual(after.phasing.find((r) => r.month === '2020-01').targetM, mutatedTargetM, 'the LIVE phasing row must reflect the edit');
    assert.strictEqual(after.baselines[0].targetCurve.find((r) => r.month === '2020-01').targetM, originalTargetM, 'the STORED baseline must be UNCHANGED — a shared reference would have let it drift');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-baseline (f): D-13 — once committed, a run-rate/curve-shape change without a reason is refused (400, no baseline appended); with a reason it succeeds and pins the PRE-CHANGE run-rate', async () => {
  const deal = freshDeal('deal_synbf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Post-commit edit', category: 'cost', owner: 'Karen Owner' });
    const { initiative } = await createRes.json();
    await postJSON(base, `/api/synergies/${initiative.id}/generate-phasing`, karenToken, { runRateM: 2, startMonth: '2020-01', curveShape: 'linear' });
    await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'validated' });
    const toCommitted = await (await postJSON(base, `/api/synergies/${initiative.id}/stage`, karenToken, { targetStage: 'committed' })).json();
    const baselineCountBefore = toCommitted.initiative.baselines.length; // deal case only, 1

    const noReasonRes = await postJSON(base, '/api/synergies', karenToken, { id: initiative.id, runRateM: 5 });
    assert.strictEqual(noReasonRes.status, 400, 'a post-commitment run-rate change without a reason must be refused');

    const afterRefusal = (await (await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } })).json()).find((s) => s.id === initiative.id);
    assert.strictEqual(afterRefusal.baselines.length, baselineCountBefore, 'a refused run-rate change must append no baseline');
    assert.strictEqual(afterRefusal.runRateM, 2, 'a refused run-rate change must leave the stored value unchanged');

    const withReasonRes = await postJSON(base, '/api/synergies', karenToken, { id: initiative.id, runRateM: 5, reason: 'Scope increased per steerco' });
    assert.strictEqual(withReasonRes.status, 200);
    const withReasonBody = await withReasonRes.json();
    assert.strictEqual(withReasonBody.initiative.runRateM, 5, 'the run-rate must be updated');
    assert.strictEqual(withReasonBody.initiative.baselines.length, baselineCountBefore + 1, 'exactly one new baseline must be appended');
    const newEntry = withReasonBody.initiative.baselines[withReasonBody.initiative.baselines.length - 1];
    assert.strictEqual(newEntry.runRateM, 2, 'the appended baseline must pin the PRE-CHANGE run-rate, not the new one');
    assert.strictEqual(newEntry.reason, 'Scope increased per steerco');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-baseline (g): below committed, an ordinary run-rate change requires no reason and appends no baseline entry', async () => {
  const deal = freshDeal('deal_synbg');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', karenToken, { title: 'Still forming', category: 'cost' });
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.stage, 'idea');

    const res = await postJSON(base, '/api/synergies', karenToken, { id: initiative.id, runRateM: 3 });
    assert.strictEqual(res.status, 200, 'below committed, a run-rate edit needs no reason');
    const body = await res.json();
    assert.strictEqual(body.initiative.runRateM, 3);
    assert.strictEqual((body.initiative.baselines || []).length, 0, 'no baseline entry may be appended below committed');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-baseline (h): grep-level guard — isAdminOrIlRequest is defined once in server.js and called only from the re-baseline route', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const definitionCount = (src.match(/function isAdminOrIlRequest\(/g) || []).length;
  const callSites = (src.match(/isAdminOrIlRequest\(req\)/g) || []).length;
  assert.strictEqual(definitionCount, 1, 'isAdminOrIlRequest must be defined exactly once');
  // One definition-site usage (`function isAdminOrIlRequest(req)`) + exactly
  // one call site (`if (!isAdminOrIlRequest(req))` in the re-baseline route).
  assert.strictEqual(callSites, 2, 'isAdminOrIlRequest(req) must appear exactly twice: its own definition signature and its one call site in the re-baseline route');
});

// WR-01: the function's own comment states it "Deliberately does NOT honour
// the X-Admin-Token break-glass path isAdminRequest() accepts", but the
// implementation used to check only req.portalUser.role — true for the
// break-glass identity too (role: 'admin', sessionId: null, per the
// consolidated /api gate). Asserted directly against the exported pure
// function with a constructed req, mirroring the break-glass shape exactly,
// rather than standing up a real ADMIN_TOKEN-configured HTTP server.
test('synergy-baseline (i): WR-01 — isAdminOrIlRequest excludes the X-Admin-Token break-glass identity (sessionId: null) even though its role is "admin", matching the function\'s own documented intent', () => {
  const breakGlassReq = { portalUser: { username: 'admin-token', role: 'admin', sessionId: null, dealId: null } };
  assert.strictEqual(app.isAdminOrIlRequest(breakGlassReq), false, 'the break-glass token identity must be excluded despite role === "admin" — D-15 requires an ATTRIBUTED human role');

  const adminSessionReq = { portalUser: { username: 'admin', role: 'admin', sessionId: 'real-session-hash', dealId: 'deal_x' } };
  assert.strictEqual(app.isAdminOrIlRequest(adminSessionReq), true, 'a real admin session must still be allowed');

  const hrbpSessionReq = { portalUser: { username: 'karen', role: 'hrbp', sessionId: 'real-session-hash', dealId: 'deal_x' } };
  assert.strictEqual(app.isAdminOrIlRequest(hrbpSessionReq), true, 'a real hrbp (Integration Lead) session must still be allowed');

  const pmoSessionReq = { portalUser: { username: 'pmo', role: 'pmo', sessionId: 'real-session-hash', dealId: 'deal_x' } };
  assert.strictEqual(app.isAdminOrIlRequest(pmoSessionReq), false, 'pmo must still be refused regardless of sessionId');

  assert.strictEqual(app.isAdminOrIlRequest({ portalUser: null }), false, 'a null portalUser (unauthenticated) must be refused');
});

// ------------------------------------------- Task 3: migration script --

const { migrateSynergyStages } = require('../scripts/migrate-synergy-stages.js');

const LEGACY_ROWS = [
  { id: 'syn_mig_1', status: 'identified' },
  { id: 'syn_mig_2', status: 'validated' },
  { id: 'syn_mig_3', status: 'planned' },
  { id: 'syn_mig_4', status: 'executing' },
  { id: 'syn_mig_5', status: 'realized' },
];
const LEGACY_I18N_LABELS = {
  en: { 'syn.st_identified': 'Identified', 'syn.st_validated': 'Validated', 'syn.st_planned': 'Planned', 'syn.st_executing': 'Executing', 'syn.st_realized': 'Realized', 'unrelated.key': 'Untouched' },
  de: { 'syn.st_identified': 'Identifiziert', 'syn.st_validated': 'Validiert', 'syn.st_planned': 'Geplant', 'syn.st_executing': 'In Umsetzung', 'syn.st_realized': 'Realisiert' },
  zh: { 'syn.st_identified': '已识别', 'syn.st_validated': '已验证', 'syn.st_planned': '已规划', 'syn.st_executing': '执行中', 'syn.st_realized': '已实现' },
  cs: { 'syn.st_identified': 'Identifikováno', 'syn.st_validated': 'Ověřeno', 'syn.st_planned': 'Naplánováno', 'syn.st_executing': 'V realizaci', 'syn.st_realized': 'Realizováno' },
};

function seedLegacyMigrationDb(dbPath) {
  const conn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  try {
    LEGACY_ROWS.forEach((row, i) => {
      const item = { id: row.id, title: 'Migration seed ' + row.id, category: 'cost', targetM: 1, realizedM: 0, status: row.status, createdAt: new Date().toISOString() };
      conn.prepare('INSERT INTO synergyInitiatives (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
        .run(row.id, null, i, JSON.stringify(item));
    });
    conn.prepare("INSERT INTO app_state (key, data) VALUES ('i18n', ?)")
      .run(JSON.stringify({ languages: [{ code: 'en' }, { code: 'de' }, { code: 'zh' }, { code: 'cs' }], defaultLang: 'en', strings: LEGACY_I18N_LABELS }));
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }
}

function readMigrationDb(dbPath) {
  const conn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  try {
    const rows = conn.prepare('SELECT id, data FROM synergyInitiatives ORDER BY id').all().map((r) => JSON.parse(r.data));
    const i18nRow = conn.prepare("SELECT data FROM app_state WHERE key = 'i18n'").get();
    return { rows, i18n: JSON.parse(i18nRow.data) };
  } finally {
    conn.close();
  }
}

test('synergy-stage (g): migrateSynergyStages rewrites every legacy row onto the four-stage vocabulary, deletes the retired `status` key, and migrates the i18n singleton per D-07\'s mechanical map', () => {
  const dbPath = path.join(TMP_DIR, 'migration-test-g.db');
  seedLegacyMigrationDb(dbPath);

  const result = migrateSynergyStages(dbPath);
  assert.strictEqual(result.rowsMigrated, 5);
  assert.strictEqual(result.rowsSkipped, 0);

  const { rows, i18n } = readMigrationDb(dbPath);
  const expectedStages = { syn_mig_1: 'idea', syn_mig_2: 'validated', syn_mig_3: 'committed', syn_mig_4: 'committed', syn_mig_5: 'captured' };
  rows.forEach((r) => {
    assert.strictEqual(r.stage, expectedStages[r.id], `row ${r.id} must map to ${expectedStages[r.id]} per D-07's mechanical map`);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r, 'status'), false, `row ${r.id} must have the retired status key deleted`);
  });

  ['en', 'de', 'zh', 'cs'].forEach((lang) => {
    const strings = i18n.strings[lang];
    ['syn.st_idea', 'syn.st_validated', 'syn.st_committed', 'syn.st_captured'].forEach((newKey) => {
      const isDirectPredecessor = newKey === 'syn.st_validated' || newKey === 'syn.st_captured';
      if (lang === 'en' || isDirectPredecessor) {
        assert.ok(strings[newKey], `${lang} must carry ${newKey}`);
      }
    });
    ['syn.st_identified', 'syn.st_planned', 'syn.st_executing', 'syn.st_realized'].forEach((retiredKey) => {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(strings, retiredKey), false, `${lang} must no longer carry the retired key ${retiredKey}`);
    });
  });
  // An untouched, unrelated key must survive the rewrite unchanged.
  assert.strictEqual(i18n.strings.en['unrelated.key'], 'Untouched');
});

test('synergy-stage (h): running migrateSynergyStages a second time is a full no-op — byte-identical result, zero rows migrated', () => {
  // Seed ONE database, then fs.copyFileSync it to two paths BEFORE either is
  // migrated — two independently-INSERTed SQLite files can differ at the
  // byte level even with identical logical content (page layout, freelist
  // state), so a true file copy is what makes byte-equality a meaningful
  // idempotency proof rather than an artifact of independent construction.
  const seedPath = path.join(TMP_DIR, 'migration-test-h-seed.db');
  const dbPathA = path.join(TMP_DIR, 'migration-test-h-a.db');
  const dbPathB = path.join(TMP_DIR, 'migration-test-h-b.db');
  seedLegacyMigrationDb(seedPath);
  fs.copyFileSync(seedPath, dbPathA);
  fs.copyFileSync(seedPath, dbPathB);

  migrateSynergyStages(dbPathA);
  migrateSynergyStages(dbPathB);
  const second = migrateSynergyStages(dbPathB);

  assert.strictEqual(second.rowsMigrated, 0, 'a second run must migrate zero rows');
  assert.strictEqual(second.rowsSkipped, LEGACY_ROWS.length, 'a second run must find every row already migrated');
  assert.strictEqual(second.languagesTouched, 0, 'a second run must touch zero i18n languages');

  const bytesA = fs.readFileSync(dbPathA);
  const bytesB = fs.readFileSync(dbPathB);
  assert.ok(bytesA.equals(bytesB), 'a single run and a run-twice result must be byte-identical on disk');
});

// WR-04: the migration used to be hard-scoped to the synergyInitiatives
// table ONLY — a row living in the customSynergyInitiatives lane (used
// whenever a deal's settings.demoMode === false, server.js:3054-3059) was
// never touched, kept its retired `status` field, never got a `stage`
// value, and fed directly into CR-02's gate-bypass bug on its first
// stage-change request. Seeds a legacy row into customSynergyInitiatives
// specifically (never synergyInitiatives) to prove the SECOND lane is now
// covered.
test('synergy-stage (i): WR-04 — migrateSynergyStages also migrates the customSynergyInitiatives lane, not just synergyInitiatives', () => {
  const dbPath = path.join(TMP_DIR, 'migration-test-i.db');
  const conn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  try {
    const item = { id: 'syn_custom_1', title: 'Custom-lane legacy row', category: 'cost', targetM: 1, realizedM: 0, status: 'executing', createdAt: new Date().toISOString() };
    conn.prepare('INSERT INTO customSynergyInitiatives (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
      .run('syn_custom_1', null, 0, JSON.stringify(item));
    // A sanity-check row in the OTHER lane too, so this test also proves
    // both lanes are migrated in the SAME run, not exclusively.
    conn.prepare('INSERT INTO synergyInitiatives (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
      .run('syn_normal_1', null, 0, JSON.stringify({ id: 'syn_normal_1', title: 'Normal-lane legacy row', category: 'cost', targetM: 1, realizedM: 0, status: 'realized', createdAt: new Date().toISOString() }));
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }

  const result = migrateSynergyStages(dbPath);
  assert.strictEqual(result.rowsMigrated, 2, 'both the custom-lane row and the normal-lane row must be migrated in the same run');

  const readConn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  try {
    const customRow = JSON.parse(readConn.prepare('SELECT data FROM customSynergyInitiatives WHERE id = ?').get('syn_custom_1').data);
    assert.strictEqual(customRow.stage, 'committed', 'the custom-lane row must be migrated per D-07\'s mechanical map (executing -> committed)');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(customRow, 'status'), false, 'the custom-lane row must have the retired status key deleted');

    const normalRow = JSON.parse(readConn.prepare('SELECT data FROM synergyInitiatives WHERE id = ?').get('syn_normal_1').data);
    assert.strictEqual(normalRow.stage, 'captured', 'the normal-lane row must still be migrated (realized -> captured)');
  } finally {
    readConn.close();
  }
});

test('synergy-stage (j): WR-04 — a second run over a database with a migrated customSynergyInitiatives row finds it already up to date (idempotent) and touches no i18n language a second time', () => {
  const dbPath = path.join(TMP_DIR, 'migration-test-j.db');
  const conn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  try {
    const item = { id: 'syn_custom_2', title: 'Custom-lane legacy row', category: 'cost', targetM: 1, realizedM: 0, status: 'identified', createdAt: new Date().toISOString() };
    conn.prepare('INSERT INTO customSynergyInitiatives (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
      .run('syn_custom_2', null, 0, JSON.stringify(item));
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }

  const first = migrateSynergyStages(dbPath);
  assert.strictEqual(first.rowsMigrated, 1);

  const second = migrateSynergyStages(dbPath);
  assert.strictEqual(second.rowsMigrated, 0, 'a second run must migrate zero rows in the custom lane too');
  assert.strictEqual(second.rowsSkipped, 1, 'the already-migrated custom-lane row must be counted as skipped on the second run');
});

// -------------------------------------------- Plan 06: client stage UI --
//
// Source-level assertions against public/js/execution.js and
// public/execution.html — a live browser walk of these controls is deferred
// to Plan 08's human checkpoint (per this plan's own <verification> block),
// so these tests are what proves the wraparound removal, the empty-reason
// abort, the deal-case pin, the role-conditional re-baseline render, and
// the universal write-failure helper, ahead of that walk.

function readClientSrc() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
}
function readExecutionHtml() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'execution.html'), 'utf8');
}

test('synergy-stage-ui (a): public/js/execution.js contains no modulo-based SYN_STAGES index computation — the wraparound cycle is gone', () => {
  const src = readClientSrc();
  assert.ok(!/%\s*SYN_STAGES\.length/.test(src), 'no "% SYN_STAGES.length" modulo operation may remain anywhere in the file — this is exactly how the old cycle-and-wrap handler produced a silent demotion');
});

test('synergy-stage-ui (b): the stage pill click handler returns early — no fetch, no visual change — when the current stage is already the last vocabulary entry', () => {
  const src = readClientSrc();
  const handlerMatch = src.match(/card\.querySelector\('\.syn-stage'\)\.addEventListener\('click', function \(\) \{([\s\S]*?)\n {6}\}\);/);
  assert.ok(handlerMatch, 'a .syn-stage click handler must be attached inside the card-wiring loop');
  const body = handlerMatch[1];
  assert.match(body, /if \(currentIdx === SYN_STAGES\.length - 1\) return;/, 'the handler must return early, with no fetch, when the current index is the last vocabulary index');
  // The early-return line must appear BEFORE the stage-change request, not
  // merely exist somewhere in the function — proves the last stage cannot
  // fall through to a request.
  const returnIdx = body.indexOf('if (currentIdx === SYN_STAGES.length - 1) return;');
  const requestIdx = body.indexOf('requestStageChange(');
  assert.ok(returnIdx > -1 && requestIdx > returnIdx, 'the early return must be ordered BEFORE the stage-change request call');
});

test('synergy-stage-ui (c): the stage menu\'s backward-selection branch prompts for a reason and issues no fetch when the prompt is cancelled or the trimmed result is empty', () => {
  const src = readClientSrc();
  const fnMatch = src.match(/function openSynStageMenu\(wrapEl, item, id\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fnMatch, 'openSynStageMenu must be defined');
  const body = fnMatch[0];
  assert.match(body, /window\.prompt\(/, 'a backward move must prompt for a reason');
  assert.match(body, /if \(reason === null\) return;/, 'a cancelled prompt (null) must abort with no request');
  assert.match(body, /reason = reason\.trim\(\);/, 'the prompt result must be trimmed before the emptiness check');
  assert.match(body, /if \(!reason\) return;/, 'an empty trimmed reason must abort with no request — an empty-reason request must never leave the client');
  // Ordering proof: both abort checks must appear BEFORE the fetch-issuing
  // requestStageChange(...reason) call, not merely exist in the function.
  const promptIdx = body.indexOf('window.prompt(');
  const nullAbortIdx = body.indexOf('if (reason === null) return;');
  const emptyAbortIdx = body.indexOf('if (!reason) return;');
  const requestWithReasonIdx = body.lastIndexOf('requestStageChange(id, targetStage, reason);');
  assert.ok(promptIdx > -1 && promptIdx < nullAbortIdx && nullAbortIdx < emptyAbortIdx && emptyAbortIdx < requestWithReasonIdx,
    'the fetch-triggering call must be ordered strictly after both abort checks');
});

test('synergy-stage-ui (d): every fetch added by the stage control routes its non-success branch through the shared failure helper', () => {
  const src = readClientSrc();
  assert.match(src, /function synAlertFailure\(res\) \{/, 'the shared failure helper must be defined');
  const reqFnMatch = src.match(/function requestStageChange\(id, targetStage, reason\) \{[\s\S]*?\n {2}\}/);
  assert.ok(reqFnMatch, 'requestStageChange must be defined — it is the ONE fetch this task adds (the pill and every menu row route through it)');
  assert.match(reqFnMatch[0], /\} else \{[\s\S]*?synAlertFailure\(res\);/, 'requestStageChange\'s non-success branch must call synAlertFailure(res)');
});

test('synergy-stage-ui (e): public/execution.html declares .syn-stage-menu as position:absolute, inside a position:relative wrapper', () => {
  const html = readExecutionHtml();
  const menuLine = html.split('\n').find((l) => l.includes('.syn-stage-menu{'));
  assert.ok(menuLine, '.syn-stage-menu rule must exist in public/execution.html');
  assert.match(menuLine, /position:absolute/, '.syn-stage-menu must be position:absolute');
  const wrapLine = html.split('\n').find((l) => l.includes('.syn-stage-wrap{'));
  assert.ok(wrapLine, '.syn-stage-wrap rule must exist');
  assert.match(wrapLine, /position:relative/, '.syn-stage-wrap must be the position:relative containing block for the absolutely-positioned menu');
});

test('synergy-stage-ui (f): the stage pill composes the per-stage i18n key so the four syn.st_* keys hydrate it', () => {
  const src = readClientSrc();
  const occurrences = (src.match(/syn\.st_/g) || []).length;
  assert.ok(occurrences >= 1, 'public/js/execution.js must compose at least one syn.st_ i18n key');
});

test('synergy-stage-ui (g): the stage menu adds and removes both the Escape-key and outside-click document listeners, never leaving one behind across a wholesale re-render', () => {
  const src = readClientSrc();
  const fnMatch = src.match(/function openSynStageMenu\(wrapEl, item, id\) \{[\s\S]*?\n {2}\}/);
  const body = fnMatch[0];
  assert.match(body, /document\.addEventListener\('click', onDocClick\);/, 'an outside-click document listener must be added when the menu opens');
  assert.match(body, /document\.addEventListener\('keydown', onKeydown\);/, 'an Escape-key document listener must be added when the menu opens');
  assert.match(body, /document\.removeEventListener\('click', onDocClick\);/, 'the outside-click listener must be removed by the close/cleanup path');
  assert.match(body, /document\.removeEventListener\('keydown', onKeydown\);/, 'the Escape-key listener must be removed by the close/cleanup path');
  // The removal calls must live inside the cleanup function assigned to
  // synStageMenuState — the single choke point closeSynStageMenu() invokes
  // — not merely exist elsewhere unreachably in the file.
  assert.match(body, /cleanup: function \(\) \{[\s\S]*?document\.removeEventListener\('click', onDocClick\);[\s\S]*?document\.removeEventListener\('keydown', onKeydown\);/,
    'both removeEventListener calls must be inside the cleanup function that closeSynStageMenu() invokes');
});

test('synergy-stage-ui (h): renderBaselines() selects the version-1 baseline entry explicitly and renders it before the remaining entries, rather than relying on array order', () => {
  const src = readClientSrc();
  const fnMatch = src.match(/function renderBaselines\(item\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fnMatch, 'renderBaselines must be defined');
  const body = fnMatch[0];
  assert.match(body, /baselines\.find\(function \(b\) \{ return b\.version === 1; \}\);/, 'the deal case must be located by an explicit version === 1 lookup, never assumed to be array index 0');
  assert.match(body, /\[dealCase\]\.concat\(rest\)/, 'the deal case must be concatenated FIRST, ahead of the remaining newest-first-sorted entries');
});

test('synergy-stage-ui (i): the re-baseline button is emitted only inside a window.__portalUser role conditional, and no disabled-attribute variant is emitted for any other role', () => {
  const src = readClientSrc();
  assert.match(src, /window\.__portalUser && \(window\.__portalUser\.role === 'admin' \|\| window\.__portalUser\.role === 'hrbp'\)/,
    'the re-baseline conditional must check window.__portalUser and exactly the two permitted role strings');
  assert.ok(!src.includes('syn-rebaseline-btn" disabled'), 'no disabled-attribute variant of the re-baseline button may be emitted — absent for other roles, not disabled');
});

test('synergy-stage-ui (j): the re-baseline click handler returns without issuing a fetch when the trimmed prompt result is empty', () => {
  const src = readClientSrc();
  const handlerMatch = src.match(/rebaselineBtn\.addEventListener\('click', function \(\) \{([\s\S]*?)\n {8}\}\);/);
  assert.ok(handlerMatch, 'a .syn-rebaseline-btn click handler must be attached');
  const body = handlerMatch[1];
  assert.match(body, /window\.prompt\(/);
  assert.match(body, /if \(reason === null\) return;/);
  assert.match(body, /reason = reason\.trim\(\);/);
  assert.match(body, /if \(!reason\) return;/);
  const abortIdx = body.indexOf('if (!reason) return;');
  const fetchIdx = body.indexOf('fetch(');
  assert.ok(abortIdx > -1 && fetchIdx > abortIdx, 'the fetch must be ordered strictly after the empty-reason abort check');
  assert.match(body, /\} else \{[\s\S]*?synAlertFailure\(res\);/, 'the handler\'s non-success branch must call the shared failure helper');
});

test('synergy-stage-ui (k): public/execution.html declares .syn-baselines and .syn-baseline-row rules', () => {
  const html = readExecutionHtml();
  assert.ok(html.split('\n').some((l) => l.includes('.syn-baselines{')), '.syn-baselines rule must exist in public/execution.html');
  assert.ok(html.split('\n').some((l) => l.includes('.syn-baseline-row{')), '.syn-baseline-row rule must exist in public/execution.html');
});

test('synergy-stage-ui (l): every dynamic value in the baseline row markup passes through the file\'s escaping helper', () => {
  const src = readClientSrc();
  const fnMatch = src.match(/function renderBaselines\(item\) \{[\s\S]*?\n {2}\}/);
  const body = fnMatch[0];
  assert.match(body, /esc\(formatBaselineDate\(b\.at\)\)/, 'the baseline date must pass through esc()');
  assert.match(body, /esc\(b\.by \|\| ''\)/, 'the actor name must pass through esc()');
  assert.match(body, /esc\(b\.runRateM/, 'the run-rate figure must pass through esc()');
  assert.match(body, /esc\(reasonText\)/, 'the reason text must pass through esc() (both in the markup body and its title attribute)');
  assert.match(body, /esc\(SYN_LABELS\[b\.stage\] \|\| b\.stage \|\| ''\)/, 'the stage-dot title text must pass through esc()');
});

test('synergy-stage-ui (m): renderBaselines() emits an explanatory line, not an empty list container, when the baselines array is empty', () => {
  const src = readClientSrc();
  const fnMatch = src.match(/function renderBaselines\(item\) \{[\s\S]*?\n {2}\}/);
  const body = fnMatch[0];
  assert.match(body, /if \(baselines\.length === 0\) \{/, 'an explicit empty-array branch must exist');
  assert.match(body, /syn\.no_baseline/, 'the empty branch must render the no-baseline-yet copy key, not an empty list shell');
});

test('synergy-stage-ui (n): the baseline reason carries a title attribute holding its full untruncated text, matching the existing truncation convention', () => {
  const src = readClientSrc();
  assert.match(src, /class="syn-baseline-reason" title="' \+ esc\(reasonText\) \+ '"/, 'the reason span must carry a title attribute set to the escaped full reason text');
});

