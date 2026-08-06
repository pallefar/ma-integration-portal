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
