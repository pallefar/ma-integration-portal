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
// Part 1 (Plan 07): the structural coverage gate — no future route ships
// unprotected. Reuses test/busy-503-contract.test.js's exact recipe: a
// character-index brace-matching handler-body isolation over the LIVE
// server.js source text, never a hand-maintained list of route paths. A NEW
// route that resolves a record from one of the seven versioned lane helpers
// (raidLane/taskLane/synergyLane/ddFindingsLane/ddRequestLane/
// orgPositionsLane/orgFlightRiskLane) and calls writeDb( without first
// calling conflictIfStale( fails this test by default (T-09-31) — the
// allow-list below is the ONLY escape hatch, and every entry must carry a
// one-line reason a future developer has to consciously accept.
// ---------------------------------------------------------------------------

/**
 * Character-index brace matching, identical to
 * test/busy-503-contract.test.js's braceMatch() — kept as a local copy
 * rather than importing a test-internal helper across files.
 */
function braceMatchOLC(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const VERSIONED_LANE_RE = /\b(raidLane|taskLane|synergyLane|ddFindingsLane|ddRequestLane|orgPositionsLane|orgFlightRiskLane)\(db\)/;

/**
 * Every `app.(post|put|patch|delete)('/path', (req, res[, next]) => { ... })`
 * handler registered in server.js, isolated via brace matching from the
 * LIVE source (not a hand-maintained route inventory) — the same simple
 * no-middleware-chain shape every write route in this codebase uses
 * (verified: every one of the 93 app.post/put/patch/delete registrations in
 * server.js matches this exact pattern, the same count a plain
 * `grep -c '^app\.(post|put|delete|patch)('` finds). Returns every handler
 * whose body BOTH references a versioned lane helper AND calls writeDb(,
 * with whether conflictIfStale( appears before that writeDb( call.
 */
function findVersionedLaneWriteHandlers(source) {
  const re = /app\.(post|put|patch|delete)\(\s*(['"])((?:[^'"\\]|\\.)*)\2\s*,\s*(async\s+)?\(\s*req\s*,\s*res(?:\s*,\s*next)?\s*\)\s*=>\s*\{/g;
  const out = [];
  let m;
  while ((m = re.exec(source))) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = braceMatchOLC(source, openIdx);
    if (closeIdx === -1) continue;
    const body = source.slice(openIdx, closeIdx + 1);
    const laneMatch = VERSIONED_LANE_RE.exec(body);
    const writeIdx = body.indexOf('writeDb(');
    if (!laneMatch || writeIdx === -1) continue;
    const conflictIdx = body.indexOf('conflictIfStale(');
    out.push({
      method: m[1].toUpperCase(),
      path: m[3],
      key: `${m[1].toUpperCase()} ${m[3]}`,
      lane: laneMatch[1],
      guarded: conflictIdx !== -1 && conflictIdx < writeIdx,
    });
  }
  return out;
}

// The allow-list: every route this scan finds that touches a versioned lane
// helper and calls writeDb() WITHOUT a version precheck, each with the
// one-line reason a reviewer must consciously accept. A route NOT on this
// list is caught by default. Never hand-maintain a list of PROTECTED routes
// (that list rots) — this is the opposite: a list of deliberately EXEMPT
// routes, small by construction, that the scan itself cross-checks against
// the live source below.
const VERSIONED_WRITE_ALLOWLIST = {
  'POST /api/integration-tasks/instantiate': 'create-only: pushes new tasks derived from a checklist template, never mutates an existing task',
  'POST /api/integration-tasks/from-remediation': 'create-only: pushes new tasks derived from assessment remediation advice, never mutates an existing task',
  'POST /api/org/positions/copy-to-target': 'create-only: clones current-state positions into new target-state rows, never mutates an existing position',
  'POST /api/org/positions/import': 'create-only: bulk-paste import validates every row then pushes new position rows, never mutates an existing position',
  'POST /api/dd/request-items/instantiate': 'create-only: pushes new request items derived from a DD request template, never mutates an existing item',
  'POST /api/org/decisions': 'append-only (09-RESEARCH.md Pitfall 8 / CONC-02\'s own named exemption): reads orgPositionsLane(db) only to validate positionId exists, then pushes a NEW orgDecisions entry — orgDecisions has no update/delete route anywhere in server.js, so there is no mutable write for a version check to guard (see db/collections.js\'s matching VERSIONED_COLLECTIONS comment)',
  'DELETE /api/employees/:id': 'reads orgPositionsLane(db) only as a pre-delete occupancy guard (refuses to delete an employee who still occupies a position) — the writeDb(db) call in this handler mutates employees/customEmployees, never orgPositions',
};

test('optimistic-locking-contract (Part 1, structural coverage gate): every server.js route handler that resolves a record via a versioned lane helper and calls writeDb() enforces the version precondition first, except an explicitly reasoned allow-list entry', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const handlers = findVersionedLaneWriteHandlers(src);
  assert.ok(handlers.length > 0, 'the structural scan matched zero versioned-lane write handlers — it must fail loudly rather than pass vacuously if the scan itself breaks');

  const violations = handlers.filter((h) => !h.guarded && !VERSIONED_WRITE_ALLOWLIST[h.key]);
  assert.deepStrictEqual(
    violations.map((v) => v.key),
    [],
    `The following route(s) touch a versioned lane and call writeDb() without a conflictIfStale() precheck, and are not on the allow-list:\n${violations.map((v) => `  ${v.key} (${v.lane})`).join('\n')}`
  );

  // The allow-list itself must never rot: every entry must correspond to a
  // route the live scan actually found, and that route must genuinely still
  // lack a precheck — a stale entry (naming a removed route, or one that has
  // since GAINED a precheck) silently widens the exemption for nothing.
  const foundByKey = new Map(handlers.map((h) => [h.key, h]));
  for (const key of Object.keys(VERSIONED_WRITE_ALLOWLIST)) {
    const entry = foundByKey.get(key);
    assert.ok(entry, `allow-list entry '${key}' does not correspond to any live versioned-lane write handler — remove the stale entry`);
    assert.strictEqual(entry.guarded, false, `allow-list entry '${key}' now HAS a conflictIfStale() precheck — remove it from the allow-list, it is no longer an exemption`);
  }
});

// ---------------------------------------------------------------------------
// Part 2 (Plan 07): live inventory cross-check, both directions.
// ---------------------------------------------------------------------------

test('optimistic-locking-contract (Part 2, structural): VERSIONED_COLLECTIONS carries exactly the 10 in-scope table names, both lanes of every demo/custom split, and excludes orgDecisions', () => {
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
  // [security] orgDecisions is deliberately absent — 09-RESEARCH.md Pitfall 8
  // and CONC-02's own requirement text name "org decision" among its
  // examples, but the route only ever PUSHES a new entry (see
  // db/collections.js's matching comment and this file's
  // VERSIONED_WRITE_ALLOWLIST entry for 'POST /api/org/decisions' above) —
  // there is no update/delete path for a version precondition to guard.
  assert.ok(!collections.VERSIONED_COLLECTIONS.has('orgDecisions'), 'orgDecisions must be excluded — append-only, no update/delete route (09-RESEARCH.md Pitfall 8)');
  for (const key of collections.VERSIONED_COLLECTIONS) {
    assert.ok(collections.ARRAY_COLLECTIONS.includes(key), `VERSIONED_COLLECTIONS entry '${key}' must be a real ARRAY_COLLECTIONS table`);
  }
});

test('optimistic-locking-contract (Part 2, structural, reverse direction): every lane helper referenced by an in-scope route resolves to a collection that is a VERSIONED_COLLECTIONS member — the check that would catch a missing custom* lane', () => {
  const collections = require('../db/collections.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const LANE_HELPERS = ['raidLane', 'taskLane', 'synergyLane', 'ddFindingsLane', 'ddRequestLane', 'orgPositionsLane', 'orgFlightRiskLane'];
  const laneCollectionKeys = {};
  LANE_HELPERS.forEach((helper) => {
    const marker = `function ${helper}(db) {`;
    const start = src.indexOf(marker);
    assert.ok(start !== -1, `lane helper not found: ${helper}`);
    const openIdx = start + marker.length - 1;
    const closeIdx = braceMatchOLC(src, openIdx);
    assert.ok(closeIdx !== -1, `could not isolate the body of ${helper}(db)`);
    const body = src.slice(openIdx, closeIdx + 1);
    const keys = new Set();
    const dbKeyRe = /db\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let km;
    while ((km = dbKeyRe.exec(body))) {
      if (km[1] === 'settings') continue; // read-only demoMode discriminator, not a collection
      keys.add(km[1]);
    }
    assert.ok(keys.size > 0, `${helper}(db) must reference at least one db.<collection> key`);
    laneCollectionKeys[helper] = [...keys];
  });

  const violations = [];
  Object.entries(laneCollectionKeys).forEach(([helper, keys]) => {
    keys.forEach((key) => {
      if (!collections.VERSIONED_COLLECTIONS.has(key)) violations.push(`${helper}(db) references db.${key}, which is NOT in VERSIONED_COLLECTIONS`);
    });
  });
  assert.deepStrictEqual(violations, [], `Every collection a versioned lane helper resolves to must itself be a VERSIONED_COLLECTIONS member:\n${violations.join('\n')}`);

  // And the demo/custom dual-lane collections specifically: raidLane/
  // taskLane/synergyLane must EACH resolve to exactly two collection keys
  // (the demo lane and its custom* shadow) — a helper that resolved to only
  // one would mean a missing custom* lane went unnoticed (09-RESEARCH.md
  // Pitfall 7).
  ['raidLane', 'taskLane', 'synergyLane'].forEach((helper) => {
    assert.strictEqual(laneCollectionKeys[helper].length, 2, `${helper}(db) must resolve to exactly 2 collection keys (demo + custom*), found ${laneCollectionKeys[helper].length}`);
  });
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

    // First edit: the client held a never-edited record, so it sends
    // version 0 (D-09: version-less IS version 0; a request with NO
    // precondition at all is refused in a deal — CONC-02 gap closure, R7 F-1)
    // — succeeds and stamps version:1.
    const firstEditRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'First real edit', version: 0 });
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

test('optimistic-locking-contract (3): a RAID record with no version field accepts version 0 and gets version:1 stamped; a record that is only read never gets stamped', async () => {
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

    // A write carrying version 0 (the version a client holding a
    // never-edited record sends — D-09) succeeds and stamps version:1.
    const writeRes = await postJSON(base, '/api/raid', token, { id: entry.id, owner: 'karen', version: 0 });
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

    const firstEditRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'First real edit', version: 0 });
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

    const firstEditRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'stamped', version: 0 });
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

    const firstEditRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'First real edit', version: 0 });
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
    const stampRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'stamped', version: 0 });
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

    const addRes = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2026-01-15', amountM: 0.5, version: 0 });
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

    const addRes = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2026-02-20', amountM: 0.75, version: 0 });
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

    // `version: 0` (the stored version of a never-edited record) — the
    // precondition is explicit, matches, and so passes conflictIfStale() and
    // reaches the CR-02 branch. (A precondition-less request would be refused
    // 400 versionRequired before it got there.)
    const res = await postJSON(base, `/api/synergies/${initiative.id}/stage`, token, { targetStage: 'validated', version: 0 });
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

test('optimistic-locking-contract (33): a stale-version flight-risk convert returns 409 with the conflict marker, and afterwards no task or RAID entry exists and the entry\'s link arrays are unchanged', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc33');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    const employee = await createEmployee(base, token, 'Olc33 Employee');

    const createRes = await postJSON(base, '/api/org/flight-risk', token, { employeeId: employee.id, riskLevel: 'high', owner: 'admin' });
    const { entry } = await createRes.json();

    // Stamp version:1 via an ordinary edit (does not touch linkedTaskIds/linkedRaidIds).
    const stampRes = await postJSON(base, '/api/org/flight-risk', token, { id: entry.id, notes: 'stamped' });
    assert.strictEqual((await stampRes.json()).entry.version, 1);

    const staleConvertRes = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, token, { toTask: true, toRaid: true, version: 0 });
    assert.strictEqual(staleConvertRes.status, 409);
    const staleConvertBody = await staleConvertRes.json();
    assert.strictEqual(staleConvertBody.conflict, true);
    assert.strictEqual(staleConvertBody.conflictKind, 'version');

    const rereadRes = await getJSON(base, '/api/org/flight-risk', token);
    const reread = (await rereadRes.json()).find((r) => r.id === entry.id);
    assert.strictEqual(reread.version, 1, 'the stale convert attempt must not have bumped the version');
    assert.deepStrictEqual(reread.linkedTaskIds, [], 'the stale convert attempt must not have linked a task');
    assert.deepStrictEqual(reread.linkedRaidIds, [], 'the stale convert attempt must not have linked a RAID entry');

    const source = 'org-flightrisk:' + entry.id;
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

test('optimistic-locking-contract (34): a current-version flight-risk convert succeeds, creates the task/RAID entry, and the entry\'s version advances by one', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc34');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    const employee = await createEmployee(base, token, 'Olc34 Employee');

    const createRes = await postJSON(base, '/api/org/flight-risk', token, { employeeId: employee.id, riskLevel: 'critical', owner: 'admin' });
    const { entry } = await createRes.json();

    const stampRes = await postJSON(base, '/api/org/flight-risk', token, { id: entry.id, notes: 'stamped' });
    assert.strictEqual((await stampRes.json()).entry.version, 1);

    const convertRes = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, token, { toTask: true, toRaid: true, version: 1 });
    assert.strictEqual(convertRes.status, 200);
    const convertBody = await convertRes.json();
    assert.strictEqual(convertBody.entry.version, 2, 'a current-version convert must bump the stored version by exactly one');
    assert.ok(convertBody.task && convertBody.task.id, 'a current-version convert with toTask must create a task');
    assert.ok(convertBody.raid && convertBody.raid.id, 'a current-version convert with toRaid must create a RAID entry');
    assert.deepStrictEqual(convertBody.entry.linkedTaskIds, [convertBody.task.id]);
    assert.deepStrictEqual(convertBody.entry.linkedRaidIds, [convertBody.raid.id]);
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (35, structural): conflictIfStale() is called before writeDb(db) in POST /api/org/positions, POST /api/org/flight-risk and POST /api/org/flight-risk/:id/convert, and before positionGraphFailure() specifically in the positions route', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeMarkers = [
    "app.post('/api/org/positions',",
    "app.post('/api/org/flight-risk',",
    "app.post('/api/org/flight-risk/:id/convert',",
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
    if (marker === "app.post('/api/org/positions',") {
      const graphFailureIdx = body.indexOf('positionGraphFailure(lane, candidate)');
      assert.ok(graphFailureIdx !== -1, 'expected positionGraphFailure(lane, candidate) call in the update branch');
      assert.ok(conflictIdx < graphFailureIdx, 'POST /api/org/positions must call conflictIfStale() BEFORE positionGraphFailure(lane, candidate) — the version precheck must sit alongside the shallow-merge ordering, not after it');
    }
  });
});

// ---------------------------------------------------------------------------
// CONC-02 (Phase 9, Plan 06 / D-08): stale-delete rejection on all seven
// in-scope DELETE routes. Every route carries no JSON body (EmptyBodySchema)
// — the precondition travels exclusively via `?expectedVersion=`, resolved
// through the same parseExpectedVersion()/conflictIfStale() dual-channel
// contract already proven on the query-channel cost-entries DELETE route
// (tests 13/14). Each test below proves the same four-part shape: a stale
// delete is rejected 409 with the record surviving; a current-version delete
// succeeds; repeating the delete afterwards returns the route's own
// not-found response with no conflict field; and an invalid (negative)
// expectedVersion is rejected 400 before any mutation.
// ---------------------------------------------------------------------------

function delWithVersion(base, urlPath, token, version) {
  const q = version === undefined ? '' : `?expectedVersion=${version}`;
  return fetch(`${base}${urlPath}${q}`, { method: 'DELETE', headers: { Cookie: cookieHeader(token) } });
}

test('optimistic-locking-contract (36): DELETE /api/raid/:id — stale delete 409s with the record surviving, current delete succeeds, repeat delete 404s with no conflict field, and a negative expectedVersion 400s', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc36');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/raid', token, { title: 'Delete fixture', type: 'risk', severity: 'medium' });
    const { entry } = await createRes.json();
    // Stamp version:1 via an ordinary edit (POST /api/raid handles both
    // create — no id — and edit — id present — per test 1's own fixture shape).
    const stampRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'stamped', version: 0 });
    assert.strictEqual(stampRes.status, 200);
    assert.strictEqual((await stampRes.json()).entry.version, 1);

    const negRes = await delWithVersion(base, `/api/raid/${entry.id}`, token, -1);
    assert.strictEqual(negRes.status, 400, 'a negative expectedVersion must 400 before any mutation');
    let reread = (await (await getJSON(base, '/api/raid', token)).json()).find((r) => r.id === entry.id);
    assert.ok(reread, 'the record must still exist after the invalid-version delete attempt');

    const staleRes = await delWithVersion(base, `/api/raid/${entry.id}`, token, 0);
    assert.strictEqual(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.strictEqual(staleBody.conflict, true);
    assert.strictEqual(staleBody.conflictKind, 'version');
    reread = (await (await getJSON(base, '/api/raid', token)).json()).find((r) => r.id === entry.id);
    assert.ok(reread, 'the record must still exist after the stale delete attempt');

    const currentRes = await delWithVersion(base, `/api/raid/${entry.id}`, token, 1);
    assert.strictEqual(currentRes.status, 200);
    assert.strictEqual((await currentRes.json()).success, true);
    reread = (await (await getJSON(base, '/api/raid', token)).json()).find((r) => r.id === entry.id);
    assert.strictEqual(reread, undefined, 'the record must be gone after the current-version delete');

    const repeatRes = await delWithVersion(base, `/api/raid/${entry.id}`, token, 1);
    assert.strictEqual(repeatRes.status, 404, 'deleting an already-gone record must return the route\'s own not-found status, not a conflict');
    const repeatBody = await repeatRes.json();
    assert.ok(!('conflict' in repeatBody), 'a genuine not-found response must carry no conflict field');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (37): DELETE /api/integration-tasks/:id — stale delete 409s with the record surviving, current delete succeeds, and repeat delete 404s with no conflict field', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc37');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/integration-tasks', token, { title: 'Delete fixture task', workstreamId: 'ws_imo', phase: 'd30' });
    const { task } = await createRes.json();
    const stampRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'stamped', version: 0 });
    assert.strictEqual(stampRes.status, 200);
    assert.strictEqual((await stampRes.json()).task.version, 1);

    const staleRes = await delWithVersion(base, `/api/integration-tasks/${task.id}`, token, 0);
    assert.strictEqual(staleRes.status, 409);
    assert.strictEqual((await staleRes.json()).conflict, true);
    let reread = (await (await getJSON(base, '/api/integration-tasks', token)).json()).find((t) => t.id === task.id);
    assert.ok(reread, 'the task must still exist after the stale delete attempt');

    const currentRes = await delWithVersion(base, `/api/integration-tasks/${task.id}`, token, 1);
    assert.strictEqual(currentRes.status, 200);
    reread = (await (await getJSON(base, '/api/integration-tasks', token)).json()).find((t) => t.id === task.id);
    assert.strictEqual(reread, undefined);

    const repeatRes = await delWithVersion(base, `/api/integration-tasks/${task.id}`, token, 1);
    assert.strictEqual(repeatRes.status, 404);
    assert.ok(!('conflict' in (await repeatRes.json())));
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (38): DELETE /api/synergies/:id — stale delete 409s with the record surviving, current delete succeeds, and repeat delete 404s with no conflict field', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc38');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Delete fixture initiative', category: 'revenue', targetM: 2 });
    const { initiative } = await createRes.json();
    const stampRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'stamped', version: 0 });
    assert.strictEqual((await stampRes.json()).initiative.version, 1);

    const staleRes = await delWithVersion(base, `/api/synergies/${initiative.id}`, token, 0);
    assert.strictEqual(staleRes.status, 409);
    assert.strictEqual((await staleRes.json()).conflict, true);
    let reread = (await (await getJSON(base, '/api/synergies', token)).json()).find((s) => s.id === initiative.id);
    assert.ok(reread, 'the initiative must still exist after the stale delete attempt');

    const currentRes = await delWithVersion(base, `/api/synergies/${initiative.id}`, token, 1);
    assert.strictEqual(currentRes.status, 200);
    reread = (await (await getJSON(base, '/api/synergies', token)).json()).find((s) => s.id === initiative.id);
    assert.strictEqual(reread, undefined);

    const repeatRes = await delWithVersion(base, `/api/synergies/${initiative.id}`, token, 1);
    assert.strictEqual(repeatRes.status, 404);
    assert.ok(!('conflict' in (await repeatRes.json())));
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (39): DELETE /api/org/positions/:id — stale delete 409s with the position surviving, current delete succeeds, and repeat delete 404s with no conflict field', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc39');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/org/positions', token, { title: 'Delete fixture position', level: 'Manager' });
    const { position } = await createRes.json();
    const stampRes = await postJSON(base, '/api/org/positions', token, { id: position.id, title: 'stamped' });
    assert.strictEqual((await stampRes.json()).position.version, 1);

    const staleRes = await delWithVersion(base, `/api/org/positions/${position.id}`, token, 0);
    assert.strictEqual(staleRes.status, 409);
    assert.strictEqual((await staleRes.json()).conflict, true);
    let reread = (await (await getJSON(base, '/api/org/positions', token)).json()).find((p) => p.id === position.id);
    assert.ok(reread, 'the position must still exist after the stale delete attempt');

    const currentRes = await delWithVersion(base, `/api/org/positions/${position.id}`, token, 1);
    assert.strictEqual(currentRes.status, 200);
    reread = (await (await getJSON(base, '/api/org/positions', token)).json()).find((p) => p.id === position.id);
    assert.strictEqual(reread, undefined);

    const repeatRes = await delWithVersion(base, `/api/org/positions/${position.id}`, token, 1);
    assert.strictEqual(repeatRes.status, 404);
    assert.ok(!('conflict' in (await repeatRes.json())));
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (40): DELETE /api/org/flight-risk/:id — stale delete 409s with the entry surviving, current delete succeeds, and repeat delete 404s with no conflict field', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc40');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    const employee = await createEmployee(base, token, 'Olc40 Employee');

    const createRes = await postJSON(base, '/api/org/flight-risk', token, { employeeId: employee.id, riskLevel: 'medium', owner: 'admin' });
    const { entry } = await createRes.json();
    const stampRes = await postJSON(base, '/api/org/flight-risk', token, { id: entry.id, notes: 'stamped' });
    assert.strictEqual((await stampRes.json()).entry.version, 1);

    const staleRes = await delWithVersion(base, `/api/org/flight-risk/${entry.id}`, token, 0);
    assert.strictEqual(staleRes.status, 409);
    assert.strictEqual((await staleRes.json()).conflict, true);
    let reread = (await (await getJSON(base, '/api/org/flight-risk', token)).json()).find((r) => r.id === entry.id);
    assert.ok(reread, 'the entry must still exist after the stale delete attempt');

    const currentRes = await delWithVersion(base, `/api/org/flight-risk/${entry.id}`, token, 1);
    assert.strictEqual(currentRes.status, 200);
    reread = (await (await getJSON(base, '/api/org/flight-risk', token)).json()).find((r) => r.id === entry.id);
    assert.strictEqual(reread, undefined);

    const repeatRes = await delWithVersion(base, `/api/org/flight-risk/${entry.id}`, token, 1);
    assert.strictEqual(repeatRes.status, 404);
    assert.ok(!('conflict' in (await repeatRes.json())));
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (41): DELETE /api/dd/request-items/:id — stale delete 409s with the item surviving, current delete succeeds, and repeat delete 404s with no conflict field', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc41');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/request-items', token, { area: 'financial', text: 'Delete fixture item' });
    const { item } = await createRes.json();
    const stampRes = await postJSON(base, '/api/dd/request-items', token, { id: item.id, text: 'stamped' });
    assert.strictEqual((await stampRes.json()).item.version, 1);

    const staleRes = await delWithVersion(base, `/api/dd/request-items/${item.id}`, token, 0);
    assert.strictEqual(staleRes.status, 409);
    assert.strictEqual((await staleRes.json()).conflict, true);
    let reread = (await (await getJSON(base, '/api/dd/request-items?area=financial', token)).json()).find((i) => i.id === item.id);
    assert.ok(reread, 'the item must still exist after the stale delete attempt');

    const currentRes = await delWithVersion(base, `/api/dd/request-items/${item.id}`, token, 1);
    assert.strictEqual(currentRes.status, 200);
    reread = (await (await getJSON(base, '/api/dd/request-items?area=financial', token)).json()).find((i) => i.id === item.id);
    assert.strictEqual(reread, undefined);

    // DD's ddAreaRefused() by-id guard (T-04-02/T-04-03) is deliberately
    // indistinguishable between "missing" and "uncleared" — a missing item
    // resolves `areaId` to null, which is never a granted area for any role,
    // so the route's OWN existing not-found response is a 403 anti-
    // enumeration refusal, not a literal 404. This plan's Task 1 leaves that
    // pre-existing response untouched (per its own action text: "do not
    // change it, and do not turn a not-found into a conflict").
    const repeatRes = await delWithVersion(base, `/api/dd/request-items/${item.id}`, token, 1);
    assert.strictEqual(repeatRes.status, 403, 'DD\'s by-id guard resolves a missing item to the SAME 403 anti-enumeration refusal as an uncleared one — this route\'s existing not-found response');
    assert.ok(!('conflict' in (await repeatRes.json())));
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (42): DELETE /api/dd/findings/:id — stale delete 409s with the finding surviving, current delete succeeds, and repeat delete 404s with no conflict field', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc42');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/dd/findings', token, { area: 'it', title: 'Delete fixture finding', severity: 'low' });
    const { finding } = await createRes.json();
    const stampRes = await postJSON(base, '/api/dd/findings', token, { id: finding.id, title: 'stamped' });
    assert.strictEqual((await stampRes.json()).finding.version, 1);

    const staleRes = await delWithVersion(base, `/api/dd/findings/${finding.id}`, token, 0);
    assert.strictEqual(staleRes.status, 409);
    assert.strictEqual((await staleRes.json()).conflict, true);
    let reread = (await (await getJSON(base, '/api/dd/findings?area=it', token)).json()).find((f) => f.id === finding.id);
    assert.ok(reread, 'the finding must still exist after the stale delete attempt');

    const currentRes = await delWithVersion(base, `/api/dd/findings/${finding.id}`, token, 1);
    assert.strictEqual(currentRes.status, 200);
    reread = (await (await getJSON(base, '/api/dd/findings?area=it', token)).json()).find((f) => f.id === finding.id);
    assert.strictEqual(reread, undefined);

    // Same DD by-id anti-enumeration shape as request-items (see test 41's
    // comment) — a missing finding resolves to the same 403 refusal.
    const repeatRes = await delWithVersion(base, `/api/dd/findings/${finding.id}`, token, 1);
    assert.strictEqual(repeatRes.status, 403, 'DD\'s by-id guard resolves a missing finding to the SAME 403 anti-enumeration refusal as an uncleared one — this route\'s existing not-found response');
    assert.ok(!('conflict' in (await repeatRes.json())));
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (43): DELETE with no expectedVersion — refused 400 versionRequired in a deal (the record survives), still deletes in the demo store (D-09)', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olc43');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);

    const createRes = await postJSON(base, '/api/raid', token, { title: 'No-version delete fixture', type: 'issue', severity: 'low' });
    const { entry } = await createRes.json();
    // No precondition at all — a delete that cannot be judged stale is
    // refused in a real deal (CONC-02 gap closure, GD-1a, R7 F-1).
    const delRes = await fetch(`${base}/api/raid/${entry.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(token) } });
    assert.strictEqual(delRes.status, 400, 'a delete with no expectedVersion at all must be refused in a deal');
    assert.strictEqual((await delRes.json()).versionRequired, true);
    const reread = (await (await getJSON(base, '/api/raid', token)).json()).find((r) => r.id === entry.id);
    assert.ok(reread, 'the refused delete must leave the record in place');

    // Demo store (session with no deal binding) stays lenient (D-09).
    const demoToken = newSession('admin', 'admin');
    const demoCreate = await postJSON(base, '/api/raid', demoToken, { title: 'Demo no-version delete fixture', type: 'issue', severity: 'low' });
    const demoEntry = (await demoCreate.json()).entry;
    const demoDel = await fetch(`${base}/api/raid/${demoEntry.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(demoToken) } });
    assert.strictEqual(demoDel.status, 200, 'the demo store still accepts a delete with no expectedVersion');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (44, structural): all seven in-scope DELETE routes call conflictIfStale() before writeDb(db)/the array reassignment, and the two DD delete routes pass a clearanceFilter matching their POST siblings', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeMarkers = [
    "app.delete('/api/raid/:id',",
    "app.delete('/api/integration-tasks/:id',",
    "app.delete('/api/synergies/:id',",
    "app.delete('/api/org/positions/:id',",
    "app.delete('/api/org/flight-risk/:id',",
    "app.delete('/api/dd/request-items/:id',",
    "app.delete('/api/dd/findings/:id',",
  ];
  routeMarkers.forEach((marker) => {
    // Find the DECLARATION of this exact route (not a later reference to the
    // same path inside a different route's comment/body) by scanning every
    // occurrence and taking the one immediately followed by a function body.
    const start = src.indexOf(marker);
    assert.ok(start !== -1, `route marker not found: ${marker}`);
    const rest = src.slice(start + marker.length);
    const nextAppIdx = rest.search(/\napp\.(get|post|put|delete|use)\(/);
    const body = nextAppIdx === -1 ? rest : rest.slice(0, nextAppIdx);
    const conflictIdx = body.indexOf('conflictIfStale(');
    const writeDbIdx = body.search(/writeDb\(db\)|lane\.splice\(idx, 1\)/);
    assert.ok(conflictIdx !== -1, `${marker} must call conflictIfStale()`);
    assert.ok(writeDbIdx !== -1, `${marker} must mutate the lane after the precheck`);
    assert.ok(conflictIdx < writeDbIdx, `${marker} must call conflictIfStale() BEFORE mutating the lane`);
  });

  // The two DD delete routes must pass the SAME clearanceFilter shape their
  // POST siblings pass (T-09-27) — asserted structurally since the HTTP-level
  // "denied" scenario is unreachable given ddAreaRefused()'s prior gate
  // (identical reasoning to Plan 04's test 22/25).
  ["app.delete('/api/dd/request-items/:id',", "app.delete('/api/dd/findings/:id',"].forEach((marker) => {
    const start = src.indexOf(marker);
    const rest = src.slice(start + marker.length);
    const nextAppIdx = rest.search(/\napp\.(get|post|put|delete|use)\(/);
    const body = nextAppIdx === -1 ? rest : rest.slice(0, nextAppIdx);
    assert.ok(body.includes('clearanceFilter:'), `${marker} must pass a clearanceFilter to conflictIfStale()`);
    const areaIdx = body.indexOf('ddAreaRefused(');
    const conflictIdx = body.indexOf('conflictIfStale(');
    assert.ok(areaIdx !== -1 && areaIdx < conflictIdx, `${marker} must call ddAreaRefused() BEFORE conflictIfStale() (T-09-19 ordering)`);
  });
});

// ---------------------------------------------------------------------------
// Part 3 (Plan 07): the dual-lane proof for the three demo/custom-split
// collections. Every test above (1-44) ran against the fixture's default
// demoMode (undefined, which raidLane()/taskLane()/synergyLane() all treat
// as "not custom" — `db.settings.demoMode === false` is false when the field
// is undefined) — a suite that only ever exercised the demo lane would pass
// while every real-deal (demoMode:false) write on RAID/tasks/synergies
// stayed unprotected (09-RESEARCH.md Pitfall 7). Each case below toggles
// demoMode:false via POST /api/settings BEFORE creating its fixture, so the
// SAME route under test (POST /api/raid etc.) resolves through the custom*
// lane, then confirms — by reading the deal's own SQLite file directly, not
// just via the API — that the row physically lives in the custom* table and
// NOT in the demo table.
// ---------------------------------------------------------------------------

function dealTableRow(dealId, table, id) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  const row = conn.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
  return row ? JSON.parse(row.data) : undefined;
}

async function enableCustomMode(base, token) {
  const res = await postJSON(base, '/api/settings', token, { demoMode: false });
  assert.strictEqual(res.status, 200, 'POST /api/settings {demoMode:false} must succeed for the dual-lane fixture setup');
}

test('optimistic-locking-contract (Part 3, dual-lane 1): in custom (demoMode:false) mode, a stale-version RAID update returns 409 and a current-version update advances the version by exactly one — and the row lives in customRaidEntries, never raidEntries', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olcdual1');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    await enableCustomMode(base, token);

    const createRes = await postJSON(base, '/api/raid', token, { title: 'Custom-lane fixture', type: 'risk', severity: 'medium' });
    assert.strictEqual(createRes.status, 201);
    const { entry } = await createRes.json();
    assert.ok(dealTableRow(deal.id, 'customRaidEntries', entry.id), 'the created entry must be stored in customRaidEntries when demoMode is false');
    assert.strictEqual(dealTableRow(deal.id, 'raidEntries', entry.id), undefined, 'the created entry must NOT be stored in the demo raidEntries table');

    const firstEditRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'First real edit', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).entry.version, 1);

    const staleRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409, 'a stale-version write must 409 in custom mode exactly as it does in demo mode');
    assert.strictEqual((await staleRes.json()).conflict, true);

    const currentRes = await postJSON(base, '/api/raid', token, { id: entry.id, title: 'edit 2', version: 1 });
    assert.strictEqual(currentRes.status, 200);
    assert.strictEqual((await currentRes.json()).entry.version, 2, 'a current-version write in custom mode must still bump the version by exactly one');
    assert.strictEqual(dealTableRow(deal.id, 'customRaidEntries', entry.id).title, 'edit 2');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (Part 3, dual-lane 2): in custom (demoMode:false) mode, a stale-version integration-task update returns 409 and a current-version update advances the version by exactly one — and the row lives in customIntegrationTasks, never integrationTasks', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olcdual2');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    await enableCustomMode(base, token);

    const createRes = await postJSON(base, '/api/integration-tasks', token, { title: 'Custom-lane task fixture', workstreamId: 'ws_imo' });
    assert.strictEqual(createRes.status, 201);
    const { task } = await createRes.json();
    assert.ok(dealTableRow(deal.id, 'customIntegrationTasks', task.id), 'the created task must be stored in customIntegrationTasks when demoMode is false');
    assert.strictEqual(dealTableRow(deal.id, 'integrationTasks', task.id), undefined, 'the created task must NOT be stored in the demo integrationTasks table');

    const firstEditRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'First real edit', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).task.version, 1);

    const staleRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409, 'a stale-version write must 409 in custom mode exactly as it does in demo mode');
    assert.strictEqual((await staleRes.json()).conflict, true);

    const currentRes = await postJSON(base, '/api/integration-tasks', token, { id: task.id, title: 'edit 2', version: 1 });
    assert.strictEqual(currentRes.status, 200);
    assert.strictEqual((await currentRes.json()).task.version, 2, 'a current-version write in custom mode must still bump the version by exactly one');
    assert.strictEqual(dealTableRow(deal.id, 'customIntegrationTasks', task.id).title, 'edit 2');
  } finally {
    server.close();
  }
});

test('optimistic-locking-contract (Part 3, dual-lane 3): in custom (demoMode:false) mode, a stale-version synergy-initiative update returns 409 and a current-version update advances the version by exactly one — and the row lives in customSynergyInitiatives, never synergyInitiatives', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_olcdual3');
    const token = newSession('admin', 'admin'); bindDeal(token, deal.id);
    await enableCustomMode(base, token);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Custom-lane synergy fixture', category: 'revenue', targetM: 4 });
    assert.strictEqual(createRes.status, 201);
    const { initiative } = await createRes.json();
    assert.ok(dealTableRow(deal.id, 'customSynergyInitiatives', initiative.id), 'the created initiative must be stored in customSynergyInitiatives when demoMode is false');
    assert.strictEqual(dealTableRow(deal.id, 'synergyInitiatives', initiative.id), undefined, 'the created initiative must NOT be stored in the demo synergyInitiatives table');

    const firstEditRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'First real edit', version: 0 });
    assert.strictEqual(firstEditRes.status, 200);
    assert.strictEqual((await firstEditRes.json()).initiative.version, 1);

    const staleRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'Stale clobber attempt', version: 0 });
    assert.strictEqual(staleRes.status, 409, 'a stale-version write must 409 in custom mode exactly as it does in demo mode');
    assert.strictEqual((await staleRes.json()).conflict, true);

    const currentRes = await postJSON(base, '/api/synergies', token, { id: initiative.id, title: 'edit 2', version: 1 });
    assert.strictEqual(currentRes.status, 200);
    assert.strictEqual((await currentRes.json()).initiative.version, 2, 'a current-version write in custom mode must still bump the version by exactly one');
    assert.strictEqual(dealTableRow(deal.id, 'customSynergyInitiatives', initiative.id).title, 'edit 2');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Part 4 (Plan 07): negative control. Tests (4) and (15) above already
// prove this — asserted as BEHAVIOR against the running routes' live
// responses, never by grepping the source for a status code (a grep-only
// check would pass even if the discrimination were missing): the pre-
// existing empty-deal steerco-pack 409 (test 4) and the pre-existing
// unrecognized-synergy-stage 409 (test 15) both return 409 with NO
// conflict:true marker, so neither can ever open the client's conflict
// dialog. Grouped here by reference rather than duplicated.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CR-01 (09-REVIEW): the WHERE-layer conflict throw inside db/store.js's
// writeDb() transaction gets the SAME clearance treatment the route-level
// precheck gives — and fails CLOSED for clearance-scoped collections when no
// per-request filter is armed.
// ---------------------------------------------------------------------------

test('CR-01 (a, store-layer backstop): a WHERE-layer version conflict on ddFindings with NO armed clearance filter withholds currentRecord entirely — version and attribution stay disclosed', () => {
  const create = store.readDb();
  create.ddFindings.push({ id: 'ddfind_cr01a', area: 'legal', title: 'MNPI title that must never leak', severity: 'high' });
  store.writeDb(create);

  const stamp = store.readDb();
  stamp.ddFindings.find((f) => f.id === 'ddfind_cr01a').title = 'MNPI title v1';
  store.writeDb(stamp);

  const snapA = store.readDb();
  const snapB = store.readDb();
  snapB.ddFindings.find((f) => f.id === 'ddfind_cr01a').title = 'MNPI title v2 (other writer)';
  store.writeDb(snapB);

  snapA.ddFindings.find((f) => f.id === 'ddfind_cr01a').title = 'stale attempt';
  let caught = null;
  try { store.writeDb(snapA); } catch (e) { caught = e; }
  assert.ok(caught && store.isConflictError(caught), 'the stale write must raise the typed conflict error');
  assert.strictEqual(caught.conflictDetail.conflictKind, 'version');
  assert.strictEqual(caught.conflictDetail.currentRecord, null,
    'CR-01: with no armed filter, a clearance-scoped collection must fail closed — no unfiltered record in the conflict detail');
  assert.ok(typeof caught.conflictDetail.currentVersion === 'number',
    'the version is still disclosed — only field VALUES are withheld (T-09-17)');
});

test('CR-01 (b, store-layer regression): the same WHERE-layer conflict on raidEntries — NOT clearance-scoped — still echoes the full current record', () => {
  const create = store.readDb();
  create.raidEntries.push({ id: 'raid_cr01b', type: 'risk', title: 'raid cr01b v0' });
  store.writeDb(create);

  const stamp = store.readDb();
  stamp.raidEntries.find((r) => r.id === 'raid_cr01b').title = 'raid cr01b v1';
  store.writeDb(stamp);

  const snapA = store.readDb();
  const snapB = store.readDb();
  snapB.raidEntries.find((r) => r.id === 'raid_cr01b').title = 'raid cr01b v2';
  store.writeDb(snapB);

  snapA.raidEntries.find((r) => r.id === 'raid_cr01b').title = 'stale attempt';
  let caught = null;
  try { store.writeDb(snapA); } catch (e) { caught = e; }
  assert.ok(caught && store.isConflictError(caught), 'the stale write must raise the typed conflict error');
  assert.ok(caught.conflictDetail.currentRecord, 'a deal-wide-visible collection still echoes the record');
  assert.strictEqual(caught.conflictDetail.currentRecord.title, 'raid cr01b v2');
});

test('CR-01 (c, arming): conflictIfStale() with a clearanceFilter arms areaClearanceFilter on the request db context — even when the client sent no version — and the armed hook applies the identical rule', () => {
  const ctx = { conn: null, kind: 'deal', dealId: 'deal_cr01c', dbPath: null };
  const denyAll = () => null;
  store.runWithDb(ctx, () => {
    const req = { body: {}, query: {} };
    const res = { status() { return this; }, json() { return this; } };
    const handled = app.conflictIfStale(req, res, { id: 'x', version: 3, area: 'legal' }, { clearanceFilter: denyAll });
    assert.strictEqual(handled, false, 'no client version supplied — precheck passes through');
  });
  assert.strictEqual(typeof ctx.areaClearanceFilter, 'function',
    'the WHERE-layer filter must be armed as a side effect of the precheck, before its early returns');
  assert.strictEqual(ctx.areaClearanceFilter('ddFindings', { id: 'x', title: 'secret' }), null,
    'the armed hook applies the SAME rule the precheck would have applied');
});

test('CR-01 (d, store-layer parity): with an armed granting filter, the WHERE-layer conflict echoes the FILTERED projection, not the raw record', () => {
  const create = store.readDb();
  create.ddRequestItems.push({ id: 'ddreq_cr01d', area: 'financial', text: 'request item v0' });
  store.writeDb(create);

  const stamp = store.readDb();
  stamp.ddRequestItems.find((r) => r.id === 'ddreq_cr01d').text = 'request item v1';
  store.writeDb(stamp);

  const snapA = store.readDb();
  const snapB = store.readDb();
  snapB.ddRequestItems.find((r) => r.id === 'ddreq_cr01d').text = 'request item v2';
  store.writeDb(snapB);

  snapA.ddRequestItems.find((r) => r.id === 'ddreq_cr01d').text = 'stale attempt';
  const ctx = {
    conn: null, kind: 'demo', dealId: null, dbPath: null,
    areaClearanceFilter: (collectionKey, rec) => ({ id: rec.id, area: rec.area, projected: true }),
  };
  let caught = null;
  store.runWithDb(ctx, () => {
    try { store.writeDb(snapA); } catch (e) { caught = e; }
  });
  assert.ok(caught && store.isConflictError(caught), 'the stale write must raise the typed conflict error');
  assert.deepStrictEqual(caught.conflictDetail.currentRecord, { id: 'ddreq_cr01d', area: 'financial', projected: true },
    'the armed filter output — not the raw record — is what the conflict detail carries');
});
