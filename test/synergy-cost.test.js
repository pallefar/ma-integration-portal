// SYN-02/D-20/D-21: cost-to-achieve as a planned figure plus a dated
// actual-cost list, and a derived net benefit (gross realized minus cost
// incurred, never clamped at zero).
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/synergy-stage.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/synergy-cost.test.js` (or `npm test`). Never `node --test test/`
// (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-synergy-cost-'));
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
async function setupDeal(id) {
  const deal = freshDeal(id);
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const token = newSession('karen', 'hrbp');
  bindDeal(token, deal.id);
  return token;
}

test('synergy-cost (a): POST /api/synergies with costPlannedM and costExpectedMonth stores both; an invalid expected month is refused by the schema', async () => {
  const token = await setupDeal('deal_syncosta');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Cost plan', category: 'cost', costPlannedM: 12.5, costExpectedMonth: '2025-06' });
    assert.strictEqual(createRes.status, 201);
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.costPlannedM, 12.5);
    assert.strictEqual(initiative.costExpectedMonth, '2025-06');

    const badRes = await postJSON(base, '/api/synergies', token, { title: 'Bad month', category: 'cost', costExpectedMonth: '2025-13' });
    assert.strictEqual(badRes.status, 400, 'an invalid expected month must be refused by the schema, not the handler');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-cost (b): POST /api/synergies/:id/cost-entries with a valid date and amount returns 200 and appends one entry carrying a generated id; an invalid calendar date is refused by the schema', async () => {
  const token = await setupDeal('deal_syncostb');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Entry target', category: 'cost' });
    const { initiative } = await createRes.json();

    const res = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-03-15', amountM: 4.2 });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.initiative.costEntries.length, 1);
    assert.ok(body.initiative.costEntries[0].id, 'a cost entry must carry a generated id');
    assert.strictEqual(body.initiative.costEntries[0].date, '2025-03-15');
    assert.strictEqual(body.initiative.costEntries[0].amountM, 4.2);

    const badDateRes = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-13-40', amountM: 1 });
    assert.strictEqual(badDateRes.status, 400, 'an invalid calendar date must be refused by the schema, not the handler');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-cost (c): an unknown initiative id returns 404 on the cost-entries route; an unknown entry id on the delete route returns 404', async () => {
  const token = await setupDeal('deal_syncostc');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const unknownInitRes = await postJSON(base, '/api/synergies/syn_totally_unknown/cost-entries', token, { date: '2025-03-15', amountM: 1 });
    assert.strictEqual(unknownInitRes.status, 404);

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'For unknown entry', category: 'cost' });
    const { initiative } = await createRes.json();

    const unknownEntryRes = await fetch(`${base}/api/synergies/${initiative.id}/cost-entries/cost_unknown`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(unknownEntryRes.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-cost (d): DELETE /api/synergies/:id/cost-entries/:eid removes exactly that entry and leaves every other entry untouched', async () => {
  const token = await setupDeal('deal_syncostd');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Delete middle', category: 'cost' });
    const { initiative } = await createRes.json();

    await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-01-01', amountM: 1 });
    const secondRes = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-02-01', amountM: 2 });
    const secondEntry = (await secondRes.json()).initiative.costEntries.find((e) => e.date === '2025-02-01');
    await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-03-01', amountM: 3 });

    const delRes = await fetch(`${base}/api/synergies/${initiative.id}/cost-entries/${secondEntry.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(delRes.status, 200);

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const list = await listRes.json();
    const stored = list.find((s) => s.id === initiative.id);
    assert.strictEqual(stored.costEntries.length, 2, 'exactly two entries must remain');
    const remainingDates = stored.costEntries.map((e) => e.date).sort();
    assert.deepStrictEqual(remainingDates, ['2025-01-01', '2025-03-01'], 'the other two entries must be untouched, with their original dates/ids/values');
    assert.strictEqual(stored.costEntries.some((e) => e.id === secondEntry.id), false, 'the deleted entry must no longer be present');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-cost (e): two entries posted with the identical date and amount both exist afterwards with different ids (no merge/dedupe)', async () => {
  const token = await setupDeal('deal_syncoste');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Lumpy duplicates', category: 'cost' });
    const { initiative } = await createRes.json();

    await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-04-01', amountM: 5 });
    const secondRes = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-04-01', amountM: 5 });
    const secondBody = await secondRes.json();

    assert.strictEqual(secondBody.initiative.costEntries.length, 2, 'two identically-dated, identically-valued entries must both exist — never merged');
    const ids = secondBody.initiative.costEntries.map((e) => e.id);
    assert.notStrictEqual(ids[0], ids[1], 'the two entries must carry distinct generated ids');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-cost (f): entries are returned newest-date-first, and two same-date entries appear in the order they were inserted', async () => {
  const token = await setupDeal('deal_syncostf');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Ordering', category: 'cost' });
    const { initiative } = await createRes.json();

    // Insert out of chronological order: 2025-02-01, then 2025-05-01 (first),
    // then 2025-05-01 (second, same date) — the response must sort by date
    // descending with the two 2025-05-01 entries in their insertion order.
    await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-02-01', amountM: 1, note: 'february' });
    await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-05-01', amountM: 2, note: 'may-first' });
    await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-05-01', amountM: 3, note: 'may-second' });

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const list = await listRes.json();
    const stored = list.find((s) => s.id === initiative.id);
    assert.strictEqual(stored.costEntries.length, 3);
    const notesInOrder = stored.costEntries.map((e) => e.note);
    assert.deepStrictEqual(notesInOrder, ['may-first', 'may-second', 'february'], 'newest date first, with same-date entries in insertion order');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-cost (g): an initiative with zero cost entries reports cost incurred 0 and net benefit equal to its derived realized value', async () => {
  const token = await setupDeal('deal_syncostg');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Empty cost', category: 'cost', realizedM: 7.5 });
    const { initiative } = await createRes.json();

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const list = await listRes.json();
    const stored = list.find((s) => s.id === initiative.id);
    assert.strictEqual(stored.costIncurredM, 0);
    assert.strictEqual(stored.netBenefitM, 7.5, 'with no entries, net benefit must equal the derived realized value');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('synergy-cost (h): net benefit is negative when cost exceeds realized value and is not clamped to zero', async () => {
  const token = await setupDeal('deal_syncosth');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Underwater', category: 'cost', realizedM: 2 });
    const { initiative } = await createRes.json();
    await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-01-01', amountM: 10 });

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(token) } });
    const list = await listRes.json();
    const stored = list.find((s) => s.id === initiative.id);
    assert.strictEqual(stored.costIncurredM, 10);
    assert.strictEqual(stored.netBenefitM, -8, 'net benefit must be negative, not clamped to 0, when cost exceeds realized value');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// ---------------------------------------------- Plan 07: client cost UI --
//
// Source-level assertions against public/js/execution.js and
// public/execution.html — a live browser walk is deferred to Plan 08's
// human checkpoint (per this plan's own <verification> block), so these
// tests are what proves the mini-form pattern reuse, the confirm-before-
// delete idiom, the empty-state branch, the escaping/title-attribute
// discipline, and the no-client-sort ordering guarantee, ahead of that walk.

function readClientSrc() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
}
function readExecutionHtml() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'execution.html'), 'utf8');
}
function readCostSectionFn() {
  const src = readClientSrc();
  const m = src.match(/function renderCostSection\(item\) \{[\s\S]*?\n {2}\}/);
  return m && m[0];
}

test('synergy-cost-ui (a): renderCostSection() emits the no-costs-logged line rather than an empty .syn-cost-list container when costEntries is empty', () => {
  const body = readCostSectionFn();
  assert.ok(body, 'renderCostSection must be defined');
  assert.match(body, /entries\.length === 0/, 'an explicit empty-array branch must exist');
  assert.match(body, /syn\.no_costs/, 'the empty branch must render the no-costs-logged copy key, not an empty list shell');
});

test('synergy-cost-ui (b): the cost-entry add handler reuses the existing .ex-add mini-form class and the cost list applies no client-side sort', () => {
  const body = readCostSectionFn();
  assert.match(body, /class="ex-add syn-cost-add"/, 'the add-entry mini-form must reuse the existing .ex-add class, no new form pattern invented');
  assert.ok(!/entries\.slice\(\)\.sort/.test(body) && !/costEntries.*\.sort\(/.test(body), 'renderCostSection must apply no client-side sort — the server\'s own order is authoritative');
});

test('synergy-cost-ui (c): the delete handler calls window.confirm() before issuing its DELETE request', () => {
  const src = readClientSrc();
  const handlerMatch = src.match(/delBtn\.addEventListener\('click', function \(\) \{([\s\S]*?)\n {8}\}\);/);
  assert.ok(handlerMatch, 'a .syn-cost-del click handler must be attached');
  const handlerBody = handlerMatch[1];
  const confirmIdx = handlerBody.indexOf("window.confirm('Delete this cost entry?')");
  const fetchIdx = handlerBody.indexOf('fetch(');
  assert.ok(confirmIdx > -1 && fetchIdx > confirmIdx, 'window.confirm() must be called strictly BEFORE the delete fetch');
});

test('synergy-cost-ui (d): a note-less cost entry renders date and amount only, with nothing occupying the note position', () => {
  const body = readCostSectionFn();
  assert.match(body, /var noteHtml = e\.note\s*\n\s*\? /, 'the note position must be a conditional — present only when e.note is truthy');
});

test('synergy-cost-ui (e): the cost-entry note passes through the file\'s escaping helper and carries a title attribute holding the full text', () => {
  const body = readCostSectionFn();
  assert.match(body, /class="syn-cost-note" title="' \+ esc\(e\.note\) \+ '">/, 'the note span must carry a title attribute set to the escaped full note text');
  assert.match(body, /esc\(e\.note\) \+ '<\/span>/, 'the note\'s visible text content must also pass through esc()');
});

test('synergy-cost-ui (f): public/execution.html declares .syn-cost-row and .syn-task-progress rules', () => {
  const html = readExecutionHtml();
  assert.ok(html.split('\n').some((l) => l.includes('.syn-cost-row{')), '.syn-cost-row rule must exist in public/execution.html');
  assert.ok(html.split('\n').some((l) => l.includes('.syn-task-progress{')), '.syn-task-progress rule must exist in public/execution.html');
});

test('synergy-cost (i): both new routes are registered — each returns 200, 400 or 404, never the validator registry\'s 500', async () => {
  const token = await setupDeal('deal_syncosti');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await postJSON(base, '/api/synergies', token, { title: 'Registered', category: 'cost' });
    const { initiative } = await createRes.json();

    const postRes = await postJSON(base, `/api/synergies/${initiative.id}/cost-entries`, token, { date: '2025-01-01', amountM: 1 });
    assert.notStrictEqual(postRes.status, 500);
    assert.strictEqual(postRes.status, 200);

    const delRes = await fetch(`${base}/api/synergies/${initiative.id}/cost-entries/cost_missing`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(token) },
    });
    assert.notStrictEqual(delRes.status, 500);
    assert.strictEqual(delRes.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});
