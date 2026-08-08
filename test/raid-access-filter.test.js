// D-17/T-06-42..46 (06-06 Task 2): closes the Phase-4 accepted risk
// (T-04-21) that was proven live once — converting a Legal DD finding
// republished its title/notes through the unfiltered RAID log to a member
// cleared only for HR. Proves BOTH directions, because a one-directional
// test passes a filter that blanks the entire lane: every identity's
// expected result is asserted as a SORTED ARRAY OF IDS, never a length, so
// an over-filter (the dangerous fail-closed-to-useless failure this plan's
// own objective warns about) and an under-filter are both caught by the
// same assertion.
//
// Modelled on test/org-flight-risk-conversion.test.js's harness shape:
// boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/raid-access-filter.test.js` (or `npm test`). Never `node --test
// test/` (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-raid-access-filter-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-raid-access-filter-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/org-flight-risk-conversion.test.js).
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
function delReq(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { method: 'DELETE', headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function sortedIds(arr) { return arr.map((e) => e.id).slice().sort(); }

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// admin + karen (hrbp/IL, reaches every area via grantedAreas()'s role
// short-circuit) + a member granted ONLY 'legal' + a member granted ONLY
// 'hr' — deliberately two SEPARATE single-area members (not one member
// granted both) so the under-filter case (a member excluded from an area
// they don't hold) and the include case (a member included for the area
// they DO hold) are proven by two independent identities, never the same
// one accidentally covering both directions.
function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin', 'karen', 'pmo_legal', 'pmo_hr'],
    memberGrants: {
      pmo_legal: { ddAreas: ['legal'] },
      pmo_hr: { ddAreas: ['hr'] },
    },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

async function createFinding(base, adminToken, area, title) {
  const res = await postJSON(base, '/api/dd/findings', adminToken, { area, title, severity: 'high' });
  const { finding } = await res.json();
  return finding;
}
async function convertFindingToRaid(base, adminToken, findingId) {
  const res = await postJSON(base, `/api/dd/findings/${findingId}/convert`, adminToken, { toRaid: true });
  const body = await res.json();
  return body.raid;
}
async function createEmployee(base, adminToken, name) {
  const res = await postJSON(base, '/api/employees', adminToken, { name, role: 'Engineer', department: 'Eng' });
  const { employee } = await res.json();
  return employee;
}
async function createFlightRisk(base, adminToken, employeeId, riskLevel) {
  const res = await postJSON(base, '/api/org/flight-risk', adminToken, {
    employeeId, riskLevel, owner: 'admin', mitigation: 'Retention conversation scheduled.',
  });
  const { entry } = await res.json();
  return entry;
}
async function convertFlightRiskToRaid(base, adminToken, entryId) {
  const res = await postJSON(base, `/api/org/flight-risk/${entryId}/convert`, adminToken, { toRaid: true });
  const body = await res.json();
  return body.raid;
}
async function createManualRaid(base, adminToken, title) {
  const res = await postJSON(base, '/api/raid', adminToken, { title, type: 'risk', severity: 'medium' });
  const { entry } = await res.json();
  return entry;
}

// Builds the standard four-entry fixture: a manually created source-less
// entry, an entry converted from a 'legal' finding, an entry converted from
// a 'financial' finding, and an entry converted from a flight-risk record
// (fixed 'hr' area). Returns { deal, tokens, entries, findings }.
async function seedFixture(base, id) {
  const deal = makeDeal(id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoLegalToken = newSession('pmo_legal', 'pmo'); bindDeal(pmoLegalToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);

  const manual = await createManualRaid(base, adminToken, 'A manually created risk with no source');
  const legalFinding = await createFinding(base, adminToken, 'legal', 'A legal finding');
  const legalRaid = await convertFindingToRaid(base, adminToken, legalFinding.id);
  const financialFinding = await createFinding(base, adminToken, 'financial', 'A financial finding');
  const financialRaid = await convertFindingToRaid(base, adminToken, financialFinding.id);
  const employee = await createEmployee(base, adminToken, 'Retention Target');
  const flightRisk = await createFlightRisk(base, adminToken, employee.id, 'high');
  const hrRaid = await convertFlightRiskToRaid(base, adminToken, flightRisk.id);

  return {
    deal,
    tokens: { adminToken, karenToken, pmoLegalToken, pmoHrToken },
    entries: { manual, legalRaid, financialRaid, hrRaid },
    findings: { legalFinding, financialFinding },
  };
}

test('raid-access-filter (a): admin receives every entry, including the manually created source-less one — the over-filtering regression a field-name-compatible-looking filter reuse would cause', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_rafa');
    const expected = sortedIds([fx.entries.manual, fx.entries.legalRaid, fx.entries.financialRaid, fx.entries.hrRaid]);

    const res = await getJSON(base, '/api/raid', fx.tokens.adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(sortedIds(body), expected, 'an admin session must receive EVERY entry, including the manually created one — a naive area-keyed filter reuse would return an empty array here instead');
  } finally {
    server.close();
  }
});

test('raid-access-filter (b): the IL (hrbp) identity receives every entry, exactly like admin', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_rafb');
    const expected = sortedIds([fx.entries.manual, fx.entries.legalRaid, fx.entries.financialRaid, fx.entries.hrRaid]);

    const res = await getJSON(base, '/api/raid', fx.tokens.karenToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(sortedIds(body), expected);
  } finally {
    server.close();
  }
});

test('raid-access-filter (c): a member cleared only for legal receives the manual entry and the legal-provenance entry, and EXCLUDES the financial- and hr-provenance entries', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_rafc');
    const expected = sortedIds([fx.entries.manual, fx.entries.legalRaid]);

    const res = await getJSON(base, '/api/raid', fx.tokens.pmoLegalToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(sortedIds(body), expected, 'a legal-only member must see the manual entry and the legal-provenance entry, and NOTHING else');
  } finally {
    server.close();
  }
});

test('raid-access-filter (d): a member cleared only for hr receives the manual entry and the flight-risk-provenance entry, and EXCLUDES the legal- and financial-provenance entries', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_rafd');
    const expected = sortedIds([fx.entries.manual, fx.entries.hrRaid]);

    const res = await getJSON(base, '/api/raid', fx.tokens.pmoHrToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(sortedIds(body), expected, 'an hr-only member must see the manual entry and the flight-risk-provenance entry, and NOTHING else');
  } finally {
    server.close();
  }
});

test('raid-access-filter (e): a deal whose RAID log contains only manually created entries returns the identical array to every identity, unchanged from before this filter existed', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rafe');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    const pmoLegalToken = newSession('pmo_legal', 'pmo'); bindDeal(pmoLegalToken, deal.id);

    const one = await createManualRaid(base, adminToken, 'Manual risk one');
    const two = await createManualRaid(base, adminToken, 'Manual risk two');
    const expected = sortedIds([one, two]);

    const adminBody = await (await getJSON(base, '/api/raid', adminToken)).json();
    const legalBody = await (await getJSON(base, '/api/raid', pmoLegalToken)).json();
    assert.deepStrictEqual(sortedIds(adminBody), expected);
    assert.deepStrictEqual(sortedIds(legalBody), expected, 'a deal with no restricted-provenance entries must return the same full array to every identity, exactly as before this filter shipped');
  } finally {
    server.close();
  }
});

test('raid-access-filter (f): WR-03 (06-REVIEW.md) — an entry whose originating finding has been DELETED is still returned to admin, and STAYS INVISIBLE to a member who was never cleared for the finding\'s area — deletion must never retroactively declassify a converted entry', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_raff');

    // Before deletion: the legal-only member must NOT see the financial-provenance entry.
    const beforeLegalBody = await (await getJSON(base, '/api/raid', fx.tokens.pmoLegalToken)).json();
    assert.ok(!beforeLegalBody.some((e) => e.id === fx.entries.financialRaid.id), 'before deletion, a legal-only member must not see the financial-provenance entry');

    const delRes = await delReq(base, `/api/dd/findings/${fx.findings.financialFinding.id}`, fx.tokens.adminToken);
    assert.strictEqual(delRes.status, 200);

    const adminAfter = await (await getJSON(base, '/api/raid', fx.tokens.adminToken)).json();
    assert.ok(adminAfter.some((e) => e.id === fx.entries.financialRaid.id), 'admin must still receive the entry after its originating finding is deleted — an orphaned link must not become invisible to everyone');

    // WR-03: the conversion route stamped `clearanceArea: 'financial'` onto
    // the RAID entry AT CONVERSION TIME (server.js), so resolveRaidEntryClearanceArea()
    // now reads THAT stamp first rather than re-deriving from the (now-gone)
    // finding — deleting the finding must NEVER widen this entry's audience.
    // This is the FLIPPED assertion from this test's pre-fix version, which
    // proved-and-accepted exactly the opposite (declassification-on-delete).
    const legalAfter = await (await getJSON(base, '/api/raid', fx.tokens.pmoLegalToken)).json();
    assert.ok(!legalAfter.some((e) => e.id === fx.entries.financialRaid.id), 'after the originating finding is deleted, the entry must REMAIN invisible to a member never cleared for the original financial area — fail-closed: deletion must never declassify (06-REVIEW.md WR-03)');

    // The hr-only member (also uncleared for financial) must likewise still
    // never see it — proves the retention holds for a second, independent
    // identity, not just the one this fixture happens to reuse elsewhere.
    const hrAfter = await (await getJSON(base, '/api/raid', fx.tokens.pmoHrToken)).json();
    assert.ok(!hrAfter.some((e) => e.id === fx.entries.financialRaid.id), 'an hr-only member must also remain excluded from the orphaned-but-still-stamped financial entry');
  } finally {
    server.close();
  }
});

test('raid-access-filter (f2): WR-03 — a LEGACY entry with no clearanceArea stamp (created before this field existed) still resolves via the source-parsing fallback, and still degrades to unfiltered once its source is orphaned — proves the fallback path is retained for pre-existing data', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_raff2');

    // Unit-level: a hand-built entry shaped like pre-WR-03 stored data (no
    // clearanceArea key at all) must still resolve through the legacy
    // source-parsing branch, live and orphaned, exactly as it did before.
    const resolve = app.resolveRaidEntryClearanceArea;
    const db = { ddFindings: [{ id: 'find_legacy', area: 'legal' }] };
    assert.strictEqual(resolve({ source: 'dd-finding:find_legacy' }, db), 'legal', 'an unstamped legacy entry must still resolve its live source to the finding\'s area');
    assert.strictEqual(resolve({ source: 'dd-finding:find_legacy_gone' }, db), null, 'an unstamped legacy entry whose source is now orphaned must still degrade to null (unfiltered) via the fallback — this plan\'s pre-existing, accepted trade-off for data that predates the stamp');

    // HTTP-level sanity: a freshly converted entry (this plan's own fixture)
    // DOES carry the stamp and is unaffected by the legacy fallback path —
    // proven again here for a second deal id, independent of test (f).
    assert.ok(fx.entries.legalRaid.id, 'sanity: the fixture\'s own conversion produced a RAID entry');
  } finally {
    server.close();
  }
});

// ============================================================= Unit-level ===
// resolveRaidEntryClearanceArea(entry, db) proven directly against
// hand-built inputs, per this task's own behavior block — no HTTP round
// trip needed for these five cases.
// ===========================================================================

test('raid-access-filter (g): resolveRaidEntryClearanceArea unit cases — empty source, dd-finding (live and orphaned), flight-risk prefix, unrecognised prefix', () => {
  const resolve = app.resolveRaidEntryClearanceArea;
  assert.strictEqual(typeof resolve, 'function', 'server.js must export resolveRaidEntryClearanceArea for direct unit testing');

  assert.strictEqual(resolve({ source: '' }, { ddFindings: [] }), null, 'an empty source resolves to null');
  assert.strictEqual(resolve({}, { ddFindings: [] }), null, 'an absent source resolves to null');

  const db = { ddFindings: [{ id: 'find_1', area: 'legal' }] };
  assert.strictEqual(resolve({ source: 'dd-finding:find_1' }, db), 'legal', 'a live dd-finding source resolves to the finding\'s own area');
  assert.strictEqual(resolve({ source: 'dd-finding:find_missing' }, db), null, 'an orphaned dd-finding source (finding deleted) resolves to null, not to a withheld state');

  assert.strictEqual(resolve({ source: 'org-flightrisk:risk_1' }, { ddFindings: [] }), 'hr', 'a flight-risk source resolves to the fixed hr area');
  assert.strictEqual(resolve({ source: 'something-unrecognised:1' }, { ddFindings: [] }), null, 'an unrecognised source prefix resolves to null');

  // WR-03 (06-REVIEW.md): the stamped clearanceArea field takes priority
  // over source-parsing, even when the source is orphaned/deleted — this is
  // the fix's entire point: deletion of the origin record must never widen
  // an already-stamped entry's audience back to null (unfiltered).
  assert.strictEqual(
    resolve({ source: 'dd-finding:find_missing', clearanceArea: 'legal' }, db),
    'legal',
    'a stamped clearanceArea must be preferred over source-parsing, even for an orphaned source — this is what keeps a converted entry restricted after its originating finding is deleted',
  );
  assert.strictEqual(
    resolve({ source: 'dd-finding:find_1', clearanceArea: 'financial' }, db),
    'financial',
    'a stamped clearanceArea must win even when the source is still LIVE and would resolve to a different area — the stamp is authoritative at conversion time, never re-derived',
  );
});

// ================================================================ Source-level ===
// The RAID list handler must reference the resolver (not a re-implemented
// filter), the fourth severity CSS rule must exist, and the due-diligence
// page's conversion note must carry the corrected copy — none of which are
// provable by an HTTP round-trip alone.
// ===================================================================================

test('raid-access-filter (h): the GET /api/raid handler body references resolveRaidEntryClearanceArea, proving the outbound filter is not a separately re-implemented predicate', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeMatch = /app\.get\('\/api\/raid',\s*\(req, res\) => \{([\s\S]*?)\n\}\);/.exec(src);
  assert.ok(routeMatch, 'expected to locate the GET /api/raid route handler body');
  assert.ok(routeMatch[1].includes('resolveRaidEntryClearanceArea'), 'the GET /api/raid handler must call resolveRaidEntryClearanceArea inside its own body');
});

test('raid-access-filter (i): public/execution.html carries the fourth severity CSS rule with a colour and a heavier font-weight than the third rule', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'execution.html'), 'utf8');
  const ruleMatch = /\.raid-lvl\.critical\{([^}]*)\}/.exec(src);
  assert.ok(ruleMatch, 'expected a .raid-lvl.critical rule');
  assert.match(ruleMatch[1], /color\s*:\s*#[0-9a-fA-F]{3,6}/, 'the critical rule must set a colour');
  assert.match(ruleMatch[1], /font-weight\s*:\s*9\d\d/, 'the critical rule must carry a heavier font-weight than the .high rule\'s inherited 800');
});

test('raid-access-filter (j): public/js/due-diligence.js carries the corrected conversion-note wording and no longer carries the superseded "whole deal team" sentence', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'due-diligence.js'), 'utf8');
  assert.ok(src.includes('visible only to members cleared for this area'), 'the corrected conversion-note wording must be present');
  assert.ok(!src.includes('whole deal team'), 'the superseded whole-deal-team sentence must no longer be present');
});

test('raid-access-filter (k): public/due-diligence.html\'s due-diligence.js cache stamp was bumped alongside the copy fix', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'due-diligence.html'), 'utf8');
  const match = /due-diligence\.js\?v=(\d+)/.exec(src);
  assert.ok(match, 'expected a cache-stamped due-diligence.js script tag');
  assert.notStrictEqual(match[1], '1784800003', 'the cache stamp must differ from the pre-Task-2 value recorded in this plan\'s own read-first notes');
});
