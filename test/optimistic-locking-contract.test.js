// CONC-02 (Phase 9, Plan 01 — the tracer slice): the four end-to-end proofs
// for the storage-layer-through-HTTP-409 mechanism, in the mold of
// test/busy-503-contract.test.js's own four-part recipe. Scoped to the ONE
// route this tracer wires (POST /api/raid) — plan 07 expands this file into
// the full coverage gate across every VERSIONED_COLLECTIONS route.
//
// Modelled on test/raid-access-filter.test.js's harness shape: boots the
// REAL requireable app (`require('../server.js')`) against an ISOLATED temp
// control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/optimistic-locking-contract.test.js` (or `npm test`). Never `node
// --test test/` (the directory argument is mis-parsed on this Node version).

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-optimistic-locking-contract-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed a real admin account directly (same rationale as
// test/raid-access-filter.test.js): control.db-native, reached only through
// db/controlStore.js, never through readDb()/writeDb().
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
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Cookie: cookieHeader(token) } : {}),
    body: JSON.stringify(body || {}),
  });
}
function getJSON(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}

function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin'],
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Structural: VERSIONED_COLLECTIONS shape (also independently proven by the
// PLAN.md acceptance-criteria `node -e` one-liners run at verification time —
// re-asserted here so a `node --test` run alone is sufficient).
// ---------------------------------------------------------------------------

test('optimistic-locking-contract (structural): VERSIONED_COLLECTIONS carries exactly the 10 in-scope table names, both lanes of every demo/custom split, and excludes orgDecisions', () => {
  const collections = require('../db/collections.js');
  const expected = [
    'raidEntries', 'customRaidEntries',
    'integrationTasks', 'customIntegrationTasks',
    'synergyInitiatives', 'customSynergyInitiatives',
    'ddFindings', 'ddRequestItems',
    'orgPositions', 'orgFlightRisks',
  ];
  assert.strictEqual(collections.VERSIONED_COLLECTIONS.size, 10);
  for (const key of expected) {
    assert.ok(collections.VERSIONED_COLLECTIONS.has(key), `expected VERSIONED_COLLECTIONS to include '${key}'`);
  }
  assert.ok(!collections.VERSIONED_COLLECTIONS.has('orgDecisions'), 'orgDecisions must be excluded — append-only, no update/delete route');
  for (const key of collections.VERSIONED_COLLECTIONS) {
    assert.ok(collections.ARRAY_COLLECTIONS.includes(key), `VERSIONED_COLLECTIONS entry '${key}' must be a real ARRAY_COLLECTIONS table`);
  }
});

test('optimistic-locking-contract (structural): db/store.js\'s versioned WHERE clause always binds the expected version as a parameter, never interpolates it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'db', 'store.js'), 'utf8');
  const matches = src.match(/json_extract\(data,'\$\.version'\)/g) || [];
  assert.ok(matches.length >= 2, `expected at least 2 json_extract(data,'$.version') occurrences (UPDATE + DELETE), found ${matches.length}`);
  const interpolated = src.split('\n').filter((line) => line.includes('json_extract') && !line.includes('?'));
  assert.deepStrictEqual(interpolated, [], 'every json_extract(...) line must also carry a bound ? parameter — never a string-interpolated version value');
});

test('optimistic-locking-contract (structural): db/store.js exports isConflictError as a function', () => {
  const s = require('../db/store.js');
  assert.strictEqual(typeof s.isConflictError, 'function');
});

// ---------------------------------------------------------------------------
// Proof 1: a stale-version RAID update returns 409 with the conflict marker,
// and the record's stored fields are unchanged afterwards.
// ---------------------------------------------------------------------------

test('optimistic-locking-contract (1): a stale-version RAID update returns 409 with the conflict marker, and the earlier writer\'s field values survive intact', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc1');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/raid', token, { title: 'Original title', type: 'risk', severity: 'medium' });
    assert.strictEqual(createRes.status, 201);
    const { entry } = await createRes.json();
    assert.strictEqual(entry.version, undefined, 'a freshly created record carries no version field yet (D-09 lazy adoption)');

    // First edit: no version supplied yet (client never held one) — succeeds
    // and stamps version:1 (D-09's "first successful write" for a legacy/
    // unstamped row, which a brand-new INSERT also is per this plan's Task 1).
    const firstEditRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'First real edit' });
    assert.strictEqual(firstEditRes.status, 200);
    const firstEditBody = await firstEditRes.json();
    assert.strictEqual(firstEditBody.entry.version, 1, 'the first successful edit of an unstamped record must stamp version:1');

    // Second writer, holding the STALE version (0, i.e. "no version" — this
    // simulates a tab that loaded before the first edit committed) attempts
    // an edit carrying an explicit stale version.
    const staleRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.strictEqual(staleBody.conflict, true, 'the 409 body must carry the conflict:true marker');
    assert.strictEqual(staleBody.conflictKind, 'version');
    assert.strictEqual(staleBody.currentVersion, 1);
    assert.ok(staleBody.currentRecord, 'the 409 body must carry the current record');
    assert.strictEqual(staleBody.currentRecord.title, 'First real edit', 'the 409 body\'s currentRecord must reflect the winning writer\'s value');

    // Re-read: the earlier writer's field values are intact — the stale
    // write must not have persisted ANY of its own values.
    const rereadRes = await getJSON(base, '/api/raid', token);
    const reread = (await rereadRes.json()).find((r) => r.id === entry.id);
    assert.strictEqual(reread.title, 'First real edit', 'the stale write must not have overwritten the title');
    assert.strictEqual(reread.version, 1, 'the stale write must not have bumped the version');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Proof 2: a current-version RAID update returns 200 and the stored version
// is exactly one higher than before.
// ---------------------------------------------------------------------------

test('optimistic-locking-contract (2): a current-version RAID update returns 200 and the stored version is exactly one higher', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc2');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/raid', token, { title: 'v2 fixture', type: 'issue', severity: 'low' });
    const { entry } = await createRes.json();

    const firstEditRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'edit 1', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    const firstEditBody = await firstEditRes.json();
    assert.strictEqual(firstEditBody.entry.version, 1);

    // A second edit, submitting the CURRENT version (1) — must succeed and
    // bump to exactly 2, never more.
    const secondEditRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'edit 2', version: 1 });
    assert.strictEqual(secondEditRes.status, 200);
    const secondEditBody = await secondEditRes.json();
    assert.strictEqual(secondEditBody.entry.version, 2, 'a current-version write must bump the stored version by exactly one');
    assert.strictEqual(secondEditBody.entry.title, 'edit 2');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Proof 3: a RAID record with no version field is writable and gets
// version:1 stamped; nothing stamps records that are only read.
// ---------------------------------------------------------------------------

test('optimistic-locking-contract (3): a RAID record with no version field is writable and gets version:1 stamped; a record that is only read never gets stamped', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc3');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/raid', token, { title: 'legacy-shaped fixture', type: 'dependency', severity: 'high' });
    const { entry } = await createRes.json();
    assert.strictEqual(entry.version, undefined, 'a freshly created record has no version field');

    // Read-only pass: GET must never stamp anything.
    const readOnlyRes = await getJSON(base, '/api/raid', token);
    const readOnly = (await readOnlyRes.json()).find((r) => r.id === entry.id);
    assert.strictEqual(readOnly.version, undefined, 'a record that is only read must not gain a version field');

    // A write (no version supplied, since none was ever held) succeeds and
    // stamps version:1.
    const writeRes = await postJSON(base, '/api/raid', token, { id: entry.id, owner: 'karen' });
    assert.strictEqual(writeRes.status, 200);
    const writeBody = await writeRes.json();
    assert.strictEqual(writeBody.entry.version, 1, 'the first write to an unstamped record must stamp version:1');
    assert.strictEqual(writeBody.entry.owner, 'karen');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Proof 4: negative control — the pre-existing, unrelated empty-deal
// steerco-pack 409 must NOT carry the conflict marker.
// ---------------------------------------------------------------------------

test('optimistic-locking-contract (4, negative control): the pre-existing empty-deal steerco-pack 409 does not carry the conflict:true marker', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    // A brand-new deal with NO workstream/task/RAID/synergy data at all.
    const deal = makeDeal('deal_olc4');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const packRes = await getJSON(base, '/api/reports/pack', token);
    assert.strictEqual(packRes.status, 409, 'an empty deal\'s steerco-pack request must still return 409');
    const packBody = await packRes.json();
    assert.notStrictEqual(packBody.conflict, true, 'the pre-existing empty-deal 409 must never carry the conflict:true marker');
    assert.ok(typeof packBody.error === 'string' && packBody.error.length > 0, 'the pre-existing 409 keeps its own single-string error shape');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Plan 02 Task 1: integration tasks and synergy initiatives — the two main
// upsert routes. Mirrors the RAID proofs above, on the SAME contract, plus
// the D-02 no-exemptions proof on a kanban-shaped quick action and the
// dual-channel (query) bounds check.
// ---------------------------------------------------------------------------

test('optimistic-locking-contract (5): a stale-version integration-task update returns 409 with the conflict marker, and the earlier writer\'s field values survive intact', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc5');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/integration-tasks', token, { title: 'Original task title', workstreamId: 'ws_imo', phase: 'd30' });
    assert.strictEqual(createRes.status, 201);
    const { task } = await createRes.json();
    assert.strictEqual(task.version, undefined, 'a freshly created task carries no version field yet');

    const firstEditRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'First real edit' });
    assert.strictEqual(firstEditRes.status, 200);
    const firstEditBody = await firstEditRes.json();
    assert.strictEqual(firstEditBody.task.version, 1);

    const staleRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.strictEqual(staleBody.conflict, true, 'the 409 body must carry the conflict:true marker');
    assert.strictEqual(staleBody.conflictKind, 'version');
    assert.strictEqual(staleBody.currentVersion, 1);
    assert.strictEqual(staleBody.currentRecord.title, 'First real edit');

    const rereadRes = await getJSON(base, '/api/integration-tasks', token);
    const reread = (await rereadRes.json()).find((t) => t.id === task.id);
    assert.strictEqual(reread.title, 'First real edit', 'the stale write must not have overwritten the title');
    assert.strictEqual(reread.version, 1, 'the stale write must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (6): a current-version integration-task update returns 200 and the stored version is exactly one higher', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc6');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/integration-tasks', token, { title: 'v2 fixture', workstreamId: 'ws_imo' });
    const { task } = await createRes.json();

    const firstEditRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'edit 1', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).task.version, 1);

    const secondEditRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'edit 2', version: 1 });
    assert.strictEqual(secondEditRes.status, 200);
    const secondEditBody = await secondEditRes.json();
    assert.strictEqual(secondEditBody.task.version, 2, 'a current-version write must bump the stored version by exactly one');
    assert.strictEqual(secondEditBody.task.title, 'edit 2');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (7): a status-only stale integration-task update (id, status, version only — the kanban flip shape) also returns 409, with no quick-action exemption', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc7');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/integration-tasks', token, { title: 'kanban fixture', workstreamId: 'ws_imo' });
    const { task } = await createRes.json();

    const firstEditRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'stamped' });
    assert.strictEqual((await firstEditRes.json()).task.version, 1);

    const staleFlipRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, status: 'doing', version: 0 });
    assert.strictEqual(staleFlipRes.status, 409, 'a status-only quick action must be rejected identically to a full edit — D-02 has no exemptions');
    const staleFlipBody = await staleFlipRes.json();
    assert.strictEqual(staleFlipBody.conflict, true);

    const rereadRes = await getJSON(base, '/api/integration-tasks', token);
    const reread = (await rereadRes.json()).find((t) => t.id === task.id);
    assert.strictEqual(reread.status, 'todo', 'the stale status flip must not have changed the stored status');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (8): POST /api/integration-tasks/instantiate with no version in its payload still returns its normal success status — creates are exempt', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc8');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    // A freshly-created deal database is seeded with NO checklistTemplates
    // rows (db/dealSeed.js's DEAL_SEED_COLLECTIONS is copied from an empty
    // temp demo.db in this test harness, not db.json) — insert one directly
    // into this deal's own SQLite file, mirroring
    // test/reports-export.test.js's seedChecklistTemplate() helper, since
    // there is no API surface to create a checklist template.
    const dealConn = store.getOrOpenConnection(dbFiles.dealDbPath(deal.id), dbFiles.DEAL_SCHEMA_PATH);
    dealConn.prepare('INSERT INTO checklistTemplates (id, project_id, seq, data) VALUES (?, NULL, 0, ?)').run(
      'ctpl_olc8',
      JSON.stringify({ id: 'ctpl_olc8', workstreams: [{ id: 'ws_imo', label: 'IMO' }], items: [{ id: 'item_1', text: 'Seed item', workstreamId: 'ws_imo', phase: 'd30' }] })
    );

    const res = await postJSON(base, '/api/integration-tasks/instantiate', token, { checklistTemplateId: 'ctpl_olc8' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.created, 1);
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (9): a stale-version synergy-initiative update returns 409 with the conflict marker, and the earlier writer\'s field values survive intact', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc9');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Original synergy title', category: 'revenue', targetM: 5 });
    assert.strictEqual(createRes.status, 201);
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.version, undefined, 'a freshly created initiative carries no version field yet');

    const firstEditRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'First real edit' });
    assert.strictEqual(firstEditRes.status, 200);
    const firstEditBody = await firstEditRes.json();
    assert.strictEqual(firstEditBody.initiative.version, 1);

    const staleRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.strictEqual(staleBody.conflict, true);
    assert.strictEqual(staleBody.conflictKind, 'version');
    assert.strictEqual(staleBody.currentVersion, 1);
    assert.strictEqual(staleBody.currentRecord.title, 'First real edit');

    const rereadRes = await getJSON(base, '/api/synergies', token);
    const reread = (await rereadRes.json()).find((s) => s.id === initiative.id);
    assert.strictEqual(reread.title, 'First real edit', 'the stale write must not have overwritten the title');
    assert.strictEqual(reread.version, 1, 'the stale write must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (10): a current-version synergy-initiative update returns 200 and the stored version is exactly one higher', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc10');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'v2 synergy fixture', category: 'cost', targetM: 2 });
    const { initiative } = await createRes.json();

    const firstEditRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'edit 1', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).initiative.version, 1);

    const secondEditRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'edit 2', version: 1 });
    assert.strictEqual(secondEditRes.status, 200);
    const secondEditBody = await secondEditRes.json();
    assert.strictEqual(secondEditBody.initiative.version, 2, 'a current-version write must bump the stored version by exactly one');
    assert.strictEqual(secondEditBody.initiative.title, 'edit 2');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (11): a query-channel ?expectedVersion that is not a non-negative integer returns 400 before any record is mutated', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc11');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/integration-tasks', token, { title: 'query-channel fixture', workstreamId: 'ws_imo' });
    const { task } = await createRes.json();

    const badRes = await fetch(`${base}/api/integration-tasks?expectedVersion=abc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(token) },
      body: JSON.stringify({ id: task.id, title: 'should not apply' }),
    });
    assert.strictEqual(badRes.status, 400);

    const rereadRes = await getJSON(base, '/api/integration-tasks', token);
    const reread = (await rereadRes.json()).find((t) => t.id === task.id);
    assert.strictEqual(reread.title, 'query-channel fixture', 'the invalid expectedVersion must not have let the write through');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Plan 02 Task 2: the seven synergy sub-routes that mutate an initiative —
// stage, cost-entries (add/delete, the query-channel proof), plus the
// structural coverage scan and the unrecognized-stage negative control.
// ---------------------------------------------------------------------------

// RPT-04/D-14-style direct SQLite manipulation of the deal's own
// synergyInitiatives row — mirrors test/reports-export.test.js's
// patchSynergyRow() helper, since there is no API surface that can put an
// initiative into an unrecognized-stage state (every route that sets
// `stage` validates it against SYN_STAGES).
function patchSynergyRow(dealId, synergyId, patch) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  const row = conn.prepare('SELECT data FROM synergyInitiatives WHERE id = ?').get(synergyId);
  const item = Object.assign(JSON.parse(row.data), patch);
  conn.prepare('UPDATE synergyInitiatives SET data = ? WHERE id = ?').run(JSON.stringify(item), synergyId);
}

test('optimistic-locking-contract (12): a stale-version POST to the stage sub-route returns 409 with the conflict marker, and the initiative\'s stage is unchanged', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc12');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'stage stale fixture', category: 'revenue', targetM: 3 });
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.stage, 'idea');

    // Stamp version:1 via an ordinary edit (idea -> validated has no gate,
    // but this stamps the version cleanly without touching stage yet).
    const stampRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'stamped' });
    assert.strictEqual((await stampRes.json()).initiative.version, 1);

    const staleStageRes = await postJSON(base, `/api/synergies/${initiative.id}/stage`, token, { targetStage: 'validated', version: 0 });
    assert.strictEqual(staleStageRes.status, 409);
    const staleStageBody = await staleStageRes.json();
    assert.strictEqual(staleStageBody.conflict, true);
    assert.strictEqual(staleStageBody.conflictKind, 'version');

    const rereadRes = await getJSON(base, '/api/synergies', token);
    const reread = (await rereadRes.json()).find((s) => s.id === initiative.id);
    assert.strictEqual(reread.stage, 'idea', 'the stale stage-change attempt must not have moved the stage');
    assert.strictEqual(reread.version, 1, 'the stale stage-change attempt must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (13): a stale-version query-channel DELETE to the cost-entry sub-route returns 409 with the conflict marker, and the entry is still present', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc13');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'cost-entry stale fixture', category: 'cost', targetM: 1 });
    const { initiative } = await createRes.json();

    const addRes = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2026-01-15', amountM: 0.5 });
    assert.strictEqual(addRes.status, 200);
    const addBody = await addRes.json();
    assert.strictEqual(addBody.initiative.version, 1, 'the first write to an unstamped initiative must stamp version:1');
    const entry = addBody.initiative.costEntries[0];
    assert.ok(entry && entry.id);

    // A stale expectedVersion (0, the "no version yet" value) on the
    // query-channel-only DELETE route.
    const staleDelRes = await fetch(`${base}/api/synergies/${initiative.id}/cost-entries/${entry.id}?expectedVersion=0`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(staleDelRes.status, 409);
    const staleDelBody = await staleDelRes.json();
    assert.strictEqual(staleDelBody.conflict, true);
    assert.strictEqual(staleDelBody.conflictKind, 'version');

    const rereadRes = await getJSON(base, '/api/synergies', token);
    const reread = (await rereadRes.json()).find((s) => s.id === initiative.id);
    assert.strictEqual(reread.costEntries.length, 1, 'the stale delete must not have removed the cost entry');
    assert.strictEqual(reread.version, 1, 'the stale delete must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (14): a current-version query-channel DELETE to the cost-entry sub-route succeeds, and the initiative\'s version advances by one', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc14');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'cost-entry current fixture', category: 'cost', targetM: 1 });
    const { initiative } = await createRes.json();

    const addRes = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2026-02-20', amountM: 0.75 });
    const addBody = await addRes.json();
    assert.strictEqual(addBody.initiative.version, 1);
    const entry = addBody.initiative.costEntries[0];

    const delRes = await fetch(`${base}/api/synergies/${initiative.id}/cost-entries/${entry.id}?expectedVersion=1`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(delRes.status, 200);
    const delBody = await delRes.json();
    assert.strictEqual(delBody.success, true);
    assert.strictEqual(delBody.initiative.version, 2, 'a current-version write must bump the stored version by exactly one');
    assert.strictEqual(delBody.initiative.costEntries.length, 0);
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (15, negative control): the pre-existing unrecognized-stage 409 does not carry the conflict:true marker', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc15');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'unrecognized-stage fixture', category: 'revenue', targetM: 2 });
    const { initiative } = await createRes.json();

    // Force the stored record into an unrecognized-stage state — no API
    // surface can reach this, so it is patched directly (mirrors
    // test/reports-export.test.js's patchSynergyRow()).
    patchSynergyRow(deal.id, initiative.id, { stage: 'legacy_unknown' });

    // No `version` in the body — this must reach the CR-02 branch, not the
    // conflictIfStale() precheck (which is a no-op when no version is sent).
    const res = await postJSON(base, `/api/synergies/${initiative.id}/stage`, token, { targetStage: 'validated' });
    assert.strictEqual(res.status, 409, 'an unrecognized current stage must still 409');
    const body = await res.json();
    assert.notStrictEqual(body.conflict, true, 'the pre-existing unrecognized-stage 409 must never carry the conflict:true marker');
    assert.ok(typeof body.error === 'string' && body.error.length > 0, 'the pre-existing 409 keeps its own single-string error shape');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (16, structural): all seven synergy sub-routes call conflictIfStale() before their writeDb(db) call', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeMarkers = [
    "app.post('/api/synergies/:id/cost-entries',",
    "app.delete('/api/synergies/:id/cost-entries/:eid',",
    "app.post('/api/synergies/:id/generate-phasing',",
    "app.post('/api/synergies/:id/phasing/:month',",
    "app.post('/api/synergies/:id/stage',",
    "app.post('/api/synergies/:id/rebaseline',",
    "app.post('/api/synergies/:id/confirm-current',",
  ];
  routeMarkers.forEach((marker) => {
    const start = src.indexOf(marker);
    assert.ok(start !== -1, `route marker not found: ${marker}`);
    const rest = src.slice(start + marker.length);
    const nextAppIdx = rest.search(/\napp\.(get|post|put|delete|use)\(/);
    const body = nextAppIdx === -1 ? rest : rest.slice(0, nextAppIdx);
    const conflictIdx = body.indexOf('conflictIfStale(');
    const writeDbIdx = body.indexOf('writeDb(db)');
    assert.ok(conflictIdx !== -1, `${marker} must call conflictIfStale()`);
    assert.ok(writeDbIdx !== -1, `${marker} must call writeDb(db)`);
    assert.ok(conflictIdx < writeDbIdx, `${marker} must call conflictIfStale() BEFORE writeDb(db)`);
  });
});

// ---------------------------------------------------------------------------
// Plan 04: the Due Diligence workspace — findings, request items and the
// finding-to-task/RAID conversion. The clean-room area gate (ddAreaRefused)
// runs BEFORE conflictIfStale() on all three routes (T-09-19: a caller with
// no grant for a finding/item's CURRENT area gets the existing 403 and never
// reaches the conflict-body path at all — the anti-enumeration property
// these tests' structural case (26) locks in). Because of that ordering, by
// the time conflictIfStale() runs, the caller has ALREADY proven they hold a
// grant for the record's current area (hasAreaGrant(deal, user, record.area)
// is the exact same check both gates perform against the exact same fresh
// `record`), so the clearanceFilter's "denied" branch (T-09-17/T-09-18) is
// unreachable through this file's real-HTTP admin-session harness — proving
// it end-to-end would need a non-admin caller whose grant is revoked (or
// whose record moves to an area they lack) BETWEEN this same request's own
// ddAreaRefused check and its conflictIfStale check, which cannot happen
// within one synchronous handler invocation. Test (25, direct) instead
// invokes the exported `conflictIfStale()` directly with a stubbed
// clearanceFilter, proving the withholding LOGIC itself is correct — the
// same function every route above wires through the same `opts.clearanceFilter`
// contract.
// ---------------------------------------------------------------------------

test('optimistic-locking-contract (17): a stale-version DD-finding update returns 409 with the conflict marker, and the earlier writer\'s field values survive intact', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc17');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/findings', token, { area: 'legal', title: 'Original finding title', severity: 'medium' });
    assert.strictEqual(createRes.status, 201);
    const { finding } = await createRes.json();
    assert.strictEqual(finding.version, undefined, 'a freshly created finding carries no version field yet');

    const firstEditRes = await postJSON(base, '/api/dd/findings', token, { id: finding.id, title: 'First real edit' });
    assert.strictEqual(firstEditRes.status, 200);
    const firstEditBody = await firstEditRes.json();
    assert.strictEqual(firstEditBody.finding.version, 1);

    const staleRes = await postJSON(base, '/api/dd/findings', token, { id: finding.id, title: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.strictEqual(staleBody.conflict, true, 'the 409 body must carry the conflict:true marker');
    assert.strictEqual(staleBody.conflictKind, 'version');
    assert.strictEqual(staleBody.currentVersion, 1);
    assert.ok(staleBody.currentRecord, 'the 409 body must carry the current record when the caller is cleared for its area');
    assert.strictEqual(staleBody.currentRecord.title, 'First real edit');

    const rereadRes = await getJSON(base, '/api/dd/findings?area=legal', token);
    const reread = (await rereadRes.json()).find((f) => f.id === finding.id);
    assert.strictEqual(reread.title, 'First real edit', 'the stale write must not have overwritten the title');
    assert.strictEqual(reread.version, 1, 'the stale write must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (18): a stale-version DD request-item update returns 409 with the conflict marker, and the earlier writer\'s field values survive intact', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc18');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/request-items', token, { area: 'financial', text: 'Original item text' });
    assert.strictEqual(createRes.status, 201);
    const { item } = await createRes.json();
    assert.strictEqual(item.version, undefined, 'a freshly created item carries no version field yet');

    const firstEditRes = await postJSON(base, '/api/dd/request-items', token, { id: item.id, text: 'First real edit' });
    assert.strictEqual(firstEditRes.status, 200);
    const firstEditBody = await firstEditRes.json();
    assert.strictEqual(firstEditBody.item.version, 1);

    const staleRes = await postJSON(base, '/api/dd/request-items', token, { id: item.id, text: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.strictEqual(staleBody.conflict, true);
    assert.strictEqual(staleBody.conflictKind, 'version');
    assert.strictEqual(staleBody.currentVersion, 1);
    assert.strictEqual(staleBody.currentRecord.text, 'First real edit');

    const rereadRes = await getJSON(base, '/api/dd/request-items?area=financial', token);
    const reread = (await rereadRes.json()).find((i) => i.id === item.id);
    assert.strictEqual(reread.text, 'First real edit', 'the stale write must not have overwritten the text');
    assert.strictEqual(reread.version, 1, 'the stale write must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (19): a current-version DD-finding update returns 200 and the stored version is exactly one higher', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc19');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/findings', token, { area: 'it', title: 'v2 finding fixture', severity: 'low' });
    const { finding } = await createRes.json();

    const firstEditRes = await postJSON(base, '/api/dd/findings', token, { id: finding.id, title: 'edit 1', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).finding.version, 1);

    const secondEditRes = await postJSON(base, '/api/dd/findings', token, { id: finding.id, title: 'edit 2', version: 1 });
    assert.strictEqual(secondEditRes.status, 200);
    const secondEditBody = await secondEditRes.json();
    assert.strictEqual(secondEditBody.finding.version, 2, 'a current-version write must bump the stored version by exactly one');
    assert.strictEqual(secondEditBody.finding.title, 'edit 2');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (20): a current-version DD request-item update returns 200 and the stored version is exactly one higher', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc20');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/request-items', token, { area: 'hr', text: 'v2 item fixture' });
    const { item } = await createRes.json();

    const firstEditRes = await postJSON(base, '/api/dd/request-items', token, { id: item.id, text: 'edit 1', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).item.version, 1);

    const secondEditRes = await postJSON(base, '/api/dd/request-items', token, { id: item.id, text: 'edit 2', version: 1 });
    assert.strictEqual(secondEditRes.status, 200);
    const secondEditBody = await secondEditRes.json();
    assert.strictEqual(secondEditBody.item.version, 2, 'a current-version write must bump the stored version by exactly one');
    assert.strictEqual(secondEditBody.item.text, 'edit 2');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (21): the DD request-item 409 body\'s currentRecord carries the same projected shape as the route\'s 200-response item — publicDdItem() applied identically on both paths', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc21');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/request-items', token, { area: 'commercial', text: 'projection fixture' });
    const { item } = await createRes.json();
    // publicDdItem() only ADDS `overdue` (Object.assign({}, item, {overdue})) —
    // it never drops a key — so the 200-response item's key set is the floor
    // every projected shape (including the conflict body) must match exactly.
    assert.ok('overdue' in item, 'the 200-response item must already carry the publicDdItem()-added overdue key');

    const firstEditRes = await postJSON(base, '/api/dd/request-items', token, { id: item.id, text: 'stamped' });
    const stamped = (await firstEditRes.json()).item;

    const staleRes = await postJSON(base, '/api/dd/request-items', token, { id: item.id, text: 'stale attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.ok('overdue' in staleBody.currentRecord, 'the conflict body\'s currentRecord must carry the publicDdItem()-added overdue key, same as the success response');
    assert.deepStrictEqual(
      Object.keys(staleBody.currentRecord).sort(),
      Object.keys(stamped).sort(),
      'the conflict body\'s currentRecord key set must match the route\'s own 200-response item key set exactly'
    );
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (22, direct): conflictIfStale()\'s clearanceFilter option withholds currentRecord — but never version or attribution — when the caller lacks clearance for the record\'s current area', () => {
  let statusCode = null;
  let jsonBody = null;
  const req = { body: { version: 0 }, query: {} };
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
  };
  const record = {
    id: 'ddfind_direct1', version: 1, area: 'financial',
    title: 'A finding title that must never leak to an uncleared caller',
    updatedBy: 'admin', updatedAt: '2026-08-11T00:00:00.000Z',
  };
  const handled = app.conflictIfStale(req, res, record, {
    clearanceFilter: () => null, // simulates a caller with no grant for the record's CURRENT area
  });
  assert.strictEqual(handled, true, 'conflictIfStale() must report that it has already responded');
  assert.strictEqual(statusCode, 409);
  assert.strictEqual(jsonBody.conflict, true);
  assert.strictEqual(jsonBody.currentRecord, null, 'currentRecord must be withheld when the clearance filter refuses it');
  assert.strictEqual(jsonBody.currentVersion, 1, 'the version is still disclosed — only field VALUES are withheld, per T-09-17');
  assert.strictEqual(jsonBody.changedBy, 'admin', 'attribution (changedBy) is still disclosed');
  assert.strictEqual(jsonBody.changedAt, '2026-08-11T00:00:00.000Z', 'attribution (changedAt) is still disclosed');
});

test('optimistic-locking-contract (23): a stale-version convert returns 409 with the conflict marker, and afterwards no task or RAID entry exists and the finding\'s link arrays are unchanged', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc23');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/findings', token, { area: 'legal', title: 'Convert fixture', severity: 'high', owner: 'Karen' });
    const { finding } = await createRes.json();

    // Stamp version:1 via an ordinary edit (does not touch linkedTaskIds/linkedRaidIds).
    const stampRes = await postJSON(base, '/api/dd/findings', token, { id: finding.id, title: 'stamped' });
    assert.strictEqual((await stampRes.json()).finding.version, 1);

    const staleConvertRes = await postJSON(base, `/api/dd/findings/${finding.id}/convert`, token, { toTask: true, toRaid: true, version: 0 });
    assert.strictEqual(staleConvertRes.status, 409);
    const staleConvertBody = await staleConvertRes.json();
    assert.strictEqual(staleConvertBody.conflict, true);
    assert.strictEqual(staleConvertBody.conflictKind, 'version');

    const rereadRes = await getJSON(base, '/api/dd/findings?area=legal', token);
    const reread = (await rereadRes.json()).find((f) => f.id === finding.id);
    assert.strictEqual(reread.version, 1, 'the stale convert attempt must not have bumped the version');
    assert.deepStrictEqual(reread.linkedTaskIds, [], 'the stale convert attempt must not have linked a task');
    assert.deepStrictEqual(reread.linkedRaidIds, [], 'the stale convert attempt must not have linked a RAID entry');

    const source = 'dd-finding:' + finding.id;
    const tasksRes = await getJSON(base, '/api/integration-tasks', token);
    const orphanTask = (await tasksRes.json()).find((t) => t.source === source);
    assert.strictEqual(orphanTask, undefined, 'a stale convert must not have created an orphan task');
    const raidRes = await getJSON(base, '/api/raid', token);
    const orphanRaid = (await raidRes.json()).find((r) => r.source === source);
    assert.strictEqual(orphanRaid, undefined, 'a stale convert must not have created an orphan RAID entry');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (24): a current-version convert succeeds, creates the task/RAID entry, and the finding\'s version advances by one', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc24');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/findings', token, { area: 'operations', title: 'Convert current fixture', severity: 'critical', owner: 'Karen' });
    const { finding } = await createRes.json();

    const stampRes = await postJSON(base, '/api/dd/findings', token, { id: finding.id, title: 'stamped' });
    assert.strictEqual((await stampRes.json()).finding.version, 1);

    const convertRes = await postJSON(base, `/api/dd/findings/${finding.id}/convert`, token, { toTask: true, toRaid: true, version: 1 });
    assert.strictEqual(convertRes.status, 200);
    const convertBody = await convertRes.json();
    assert.strictEqual(convertBody.finding.version, 2, 'a current-version convert must bump the stored version by exactly one');
    assert.ok(convertBody.task && convertBody.task.id, 'a current-version convert with toTask must create a task');
    assert.ok(convertBody.raid && convertBody.raid.id, 'a current-version convert with toRaid must create a RAID entry');
    assert.deepStrictEqual(convertBody.finding.linkedTaskIds, [convertBody.task.id]);
    assert.deepStrictEqual(convertBody.finding.linkedRaidIds, [convertBody.raid.id]);
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (25, structural): the DD findings, request-items and convert routes all call ddAreaRefused() BEFORE conflictIfStale(), and conflictIfStale() before writeDb(db)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeMarkers = [
    "app.post('/api/dd/findings',",
    "app.post('/api/dd/request-items',",
    "app.post('/api/dd/findings/:id/convert',",
  ];
  routeMarkers.forEach((marker) => {
    const start = src.indexOf(marker);
    assert.ok(start !== -1, `route marker not found: ${marker}`);
    const rest = src.slice(start + marker.length);
    const nextAppIdx = rest.search(/\napp\.(get|post|put|delete|use)\(/);
    const body = nextAppIdx === -1 ? rest : rest.slice(0, nextAppIdx);
    const areaIdx = body.indexOf('ddAreaRefused(');
    const conflictIdx = body.indexOf('conflictIfStale(');
    const writeDbIdx = body.indexOf('writeDb(db)');
    assert.ok(areaIdx !== -1, `${marker} must call ddAreaRefused()`);
    assert.ok(conflictIdx !== -1, `${marker} must call conflictIfStale()`);
    assert.ok(writeDbIdx !== -1, `${marker} must call writeDb(db)`);
    assert.ok(areaIdx < conflictIdx, `${marker} must call ddAreaRefused() BEFORE conflictIfStale() (T-09-19 anti-enumeration ordering)`);
    assert.ok(conflictIdx < writeDbIdx, `${marker} must call conflictIfStale() BEFORE writeDb(db)`);
  });
});

// ---------------------------------------------------------------------------
// CONC-02 (Phase 9, Plan 05): org design (positions, flight-risk register,
// the flight-risk conversion) and the org-decisions append-only exemption.
// createEmployee() mirrors test/org-flight-risk-conversion.test.js's own
// helper — a flight-risk entry's employeeId must name a real roster row.
// ---------------------------------------------------------------------------

async function createEmployee(base, token, name) {
  const res = await postJSON(base, '/api/employees', token, { name, role: 'Engineer', department: 'Eng' });
  const { employee } = await res.json();
  return employee;
}

test('optimistic-locking-contract (26): a stale-version org-position update returns 409 with the conflict marker, and the earlier writer\'s field values survive intact', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc26');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/org/positions', token, { title: 'Original title', level: 'VP' });
    assert.strictEqual(createRes.status, 201);
    const { position } = await createRes.json();
    assert.strictEqual(position.version, undefined, 'a freshly created position carries no version field yet');

    const firstEditRes = await postJSON(base, '/api/org/positions', token, { id: position.id, title: 'First real edit' });
    assert.strictEqual(firstEditRes.status, 200);
    const firstEditBody = await firstEditRes.json();
    assert.strictEqual(firstEditBody.position.version, 1);

    const staleRes = await postJSON(base, '/api/org/positions', token, { id: position.id, title: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.strictEqual(staleBody.conflict, true, 'the 409 body must carry the conflict:true marker');
    assert.strictEqual(staleBody.conflictKind, 'version');
    assert.strictEqual(staleBody.currentVersion, 1);
    assert.strictEqual(staleBody.currentRecord.title, 'First real edit');

    const rereadRes = await getJSON(base, '/api/org/positions', token);
    const reread = (await rereadRes.json()).find((p) => p.id === position.id);
    assert.strictEqual(reread.title, 'First real edit', 'the stale write must not have overwritten the title');
    assert.strictEqual(reread.version, 1, 'the stale write must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (27): a stale-version org flight-risk update returns 409 with the conflict marker, and the earlier writer\'s field values survive intact', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc27');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    const employee = await createEmployee(base, token, 'Olc27 Employee');

    const createRes = await postJSON(base, '/api/org/flight-risk', token, { employeeId: employee.id, riskLevel: 'medium', owner: 'admin' });
    assert.strictEqual(createRes.status, 201);
    const { entry } = await createRes.json();
    assert.strictEqual(entry.version, undefined, 'a freshly created flight-risk entry carries no version field yet');

    const firstEditRes = await postJSON(base, '/api/org/flight-risk', token, { id: entry.id, notes: 'First real edit' });
    assert.strictEqual(firstEditRes.status, 200);
    const firstEditBody = await firstEditRes.json();
    assert.strictEqual(firstEditBody.entry.version, 1);

    const staleRes = await postJSON(base, '/api/org/flight-risk', token, { id: entry.id, notes: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.strictEqual(staleBody.conflict, true, 'the 409 body must carry the conflict:true marker');
    assert.strictEqual(staleBody.conflictKind, 'version');
    assert.strictEqual(staleBody.currentVersion, 1);
    assert.strictEqual(staleBody.currentRecord.notes, 'First real edit');

    const rereadRes = await getJSON(base, '/api/org/flight-risk', token);
    const reread = (await rereadRes.json()).find((r) => r.id === entry.id);
    assert.strictEqual(reread.notes, 'First real edit', 'the stale write must not have overwritten the notes');
    assert.strictEqual(reread.version, 1, 'the stale write must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (28): a current-version org-position update returns 200 and the stored version is exactly one higher', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc28');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/org/positions', token, { title: 'v2 position fixture', level: 'Director' });
    const { position } = await createRes.json();

    const firstEditRes = await postJSON(base, '/api/org/positions', token, { id: position.id, title: 'edit 1', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).position.version, 1);

    const secondEditRes = await postJSON(base, '/api/org/positions', token, { id: position.id, title: 'edit 2', version: 1 });
    assert.strictEqual(secondEditRes.status, 200);
    const secondEditBody = await secondEditRes.json();
    assert.strictEqual(secondEditBody.position.version, 2, 'a current-version write must bump the stored version by exactly one');
    assert.strictEqual(secondEditBody.position.title, 'edit 2');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (29): a current-version org flight-risk update returns 200 and the stored version is exactly one higher', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc29');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    const employee = await createEmployee(base, token, 'Olc29 Employee');

    const createRes = await postJSON(base, '/api/org/flight-risk', token, { employeeId: employee.id, riskLevel: 'low', owner: 'admin' });
    const { entry } = await createRes.json();

    const firstEditRes = await postJSON(base, '/api/org/flight-risk', token, { id: entry.id, notes: 'edit 1', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).entry.version, 1);

    const secondEditRes = await postJSON(base, '/api/org/flight-risk', token, { id: entry.id, notes: 'edit 2', version: 1 });
    assert.strictEqual(secondEditRes.status, 200);
    const secondEditBody = await secondEditRes.json();
    assert.strictEqual(secondEditBody.entry.version, 2, 'a current-version write must bump the stored version by exactly one');
    assert.strictEqual(secondEditBody.entry.notes, 'edit 2');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (30): an org-position update that is both stale AND graph-invalid returns 409, not 400, and the stored position is unchanged', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc30');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/org/positions', token, { title: 'Combined fixture', level: 'Manager' });
    const { position } = await createRes.json();

    const stampRes = await postJSON(base, '/api/org/positions', token, { id: position.id, title: 'stamped' });
    assert.strictEqual((await stampRes.json()).position.version, 1);

    // Self-parent (reportsToId === own id) is positionGraphFailure()'s
    // FIRST check ("A position cannot report to itself.") — combined here
    // with a stale version:0, the conflict must win over the 400.
    const combinedRes = await postJSON(base, '/api/org/positions', token, {
      id: position.id, reportsToId: position.id, version: 0,
    });
    assert.strictEqual(combinedRes.status, 409, 'a request that is both stale and structurally invalid must return 409, not 400');
    const combinedBody = await combinedRes.json();
    assert.strictEqual(combinedBody.conflict, true);

    const rereadRes = await getJSON(base, '/api/org/positions', token);
    const reread = (await rereadRes.json()).find((p) => p.id === position.id);
    assert.strictEqual(reread.reportsToId, null, 'the stale-and-invalid attempt must not have set reportsToId');
    assert.strictEqual(reread.version, 1, 'the stale-and-invalid attempt must not have bumped the version');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (31): POST /api/org/decisions succeeds with no version in its payload, and the created decision record has no version key — the recorded append-only exemption', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc31');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const posRes = await postJSON(base, '/api/org/positions', token, { title: 'Decision fixture position', level: 'VP' });
    const { position } = await posRes.json();

    const decRes = await postJSON(base, '/api/org/decisions', token, {
      positionId: position.id, type: 'retain', rationale: 'Key contributor, retaining through Day 100.',
    });
    assert.strictEqual(decRes.status, 201);
    const { decision } = await decRes.json();
    assert.ok(!('version' in decision), 'a decision record must never carry a version key');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (32): POST /api/org/positions/copy-to-target and the roster import both still succeed with no version in their payload', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc32');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/org/positions', token, { title: 'Copy fixture', level: 'VP' });
    assert.strictEqual(createRes.status, 201);

    const copyRes = await postJSON(base, '/api/org/positions/copy-to-target', token, {});
    assert.strictEqual(copyRes.status, 200);
    const copyBody = await copyRes.json();
    assert.strictEqual(copyBody.success, true);
    assert.strictEqual(copyBody.count, 1);

    const importRes = await postJSON(base, '/api/org/positions/import', token, {
      state: 'current',
      rows: [{ title: 'Imported Role' }],
    });
    assert.strictEqual(importRes.status, 201);
    const importBody = await importRes.json();
    assert.strictEqual(importBody.success, true);
    assert.strictEqual(importBody.createdPositions, 1);
  } finally {
    server.close();
  }
});
