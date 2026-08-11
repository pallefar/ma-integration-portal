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
