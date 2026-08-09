// RPT-01 (07-01 Task 1): the phase tracer's proof file — RAID CSV export
// parity with GET /api/raid (D-08), the codename-never-legal-target
// filename/header/body discipline (D-07/D-09), the dataset whitelist
// refusal (D-09), the headers-only-at-zero empty state, and RFC 4180
// quoting/formula-neutralisation (T-07-05).
//
// Modelled on test/raid-access-filter.test.js's harness shape exactly: boots
// the REAL requireable app (`require('../server.js')`) against an ISOLATED
// temp control/runtime/demo/deals/audit trio. Every identity's expected
// result is asserted as a SORTED ARRAY OF IDS parsed back out of the CSV
// body, never as a length — an over-filter and an under-filter both fail
// the same assertion.
//
// node:test — run via `node --test test/reports-export.test.js` (or
// `npm test`). Never `node --test test/` (the directory argument is
// mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reports-export-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-reports-export-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/raid-access-filter.test.js).
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
function getRaw(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Cookie: cookieHeader(token) } : {}),
    body: JSON.stringify(body || {}),
  });
}

// D-07/D-09: the fixture's legal-target field (deal.targetCompany) carries
// this distinctive sentinel, appearing NOWHERE else in the fixture — the
// codename (deal.name) is a plain, ordinary string. Every export filename,
// header and body must contain ZERO occurrences of this sentinel.
const LEGAL_TARGET_SENTINEL = 'ZZZ-SENTINEL-LEGALTARGET-8f3c1a-ZZZ';

function makeDeal(id, overrides) {
  const deal = Object.assign({
    id, name: id, targetCompany: LEGAL_TARGET_SENTINEL,
    // pmo_legal is granted the 'legal' area only; pmo_none is a deal member
    // with NO memberGrants entry at all — the "member granted no area"
    // identity this plan's four-identity test requires, deliberately
    // distinct from pmo_legal so the include-case and the zero-grant case
    // are proven by two independent identities.
    members: ['admin', 'karen', 'pmo_legal', 'pmo_none'],
    memberGrants: {
      pmo_legal: { ddAreas: ['legal'] },
    },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  }, overrides || {});
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

/**
 * Strips the leading UTF-8 BOM, splits on CRLF row terminators, drops the
 * header row and any trailing empty line, and returns the SORTED array of
 * `id` values (always the first CSV field, never comma/quote-bearing since
 * ids are server-minted `raid_<...>` strings — safe to split on the first
 * comma even when a LATER column, e.g. title, is itself comma-containing
 * and RFC-4180-quoted).
 */
function sortedIdsFromCsv(csvText) {
  const body = csvText.replace(/^\uFEFF/, '');
  const lines = body.split('\r\n').filter((l) => l.length > 0);
  const dataLines = lines.slice(1); // drop the header row
  return dataLines.map((line) => line.slice(0, line.indexOf(','))).sort();
}

async function createManualRaid(base, adminToken, title) {
  const res = await postJSON(base, '/api/raid', adminToken, { title, type: 'risk', severity: 'medium' });
  const { entry } = await res.json();
  return entry;
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

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('reports-export (a): four-identity parity — admin, the IL (hrbp), a one-area member and a no-area member each receive from the CSV export EXACTLY the id set GET /api/raid returns for that same identity in the same run (D-08)', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rpta');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
    const legalToken = newSession('pmo_legal', 'pmo'); bindDeal(legalToken, deal.id);
    const noneToken = newSession('pmo_none', 'pmo'); bindDeal(noneToken, deal.id);

    // Spans: no clearance provenance (manual), stamped to one DD area
    // (legal), stamped to a second area (financial).
    await createManualRaid(base, adminToken, 'A manually created risk with no source');
    const legalFinding = await createFinding(base, adminToken, 'legal', 'A legal finding');
    await convertFindingToRaid(base, adminToken, legalFinding.id);
    const financialFinding = await createFinding(base, adminToken, 'financial', 'A financial finding');
    await convertFindingToRaid(base, adminToken, financialFinding.id);

    const identities = [
      { name: 'admin', token: adminToken },
      { name: 'karen (IL/hrbp)', token: karenToken },
      { name: 'pmo_legal (one area)', token: legalToken },
      { name: 'pmo_none (no area)', token: noneToken },
    ];

    for (const identity of identities) {
      const liveRes = await getRaw(base, '/api/raid', identity.token);
      assert.strictEqual(liveRes.status, 200);
      const liveIds = (await liveRes.json()).map((e) => e.id).slice().sort();

      const csvRes = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', identity.token);
      assert.strictEqual(csvRes.status, 200, `${identity.name}: expected 200 from the export route`);
      const csvIds = sortedIdsFromCsv(await csvRes.text());

      assert.deepStrictEqual(csvIds, liveIds, `${identity.name}: the CSV export's id set must exactly equal GET /api/raid's own id set for this identity — over- and under-filtering both fail this assertion`);
    }

    // Sanity: the fixture actually varies visibility across identities, or
    // this test would pass vacuously even with the filter absent entirely.
    const adminIds = (await (await getRaw(base, '/api/raid', adminToken)).json()).map((e) => e.id).sort();
    const legalIds = (await (await getRaw(base, '/api/raid', legalToken)).json()).map((e) => e.id).sort();
    const noneIds = (await (await getRaw(base, '/api/raid', noneToken)).json()).map((e) => e.id).sort();
    assert.notDeepStrictEqual(adminIds, legalIds, 'sanity: admin and the legal-only member must see DIFFERENT sets');
    assert.notDeepStrictEqual(legalIds, noneIds, 'sanity: the legal-only member and the no-area member must see DIFFERENT sets');
  } finally {
    server.close();
  }
});

test('reports-export (b): the filename/header/body are built from the deal codename ONLY — the legal-target sentinel appears ZERO times in the Content-Disposition header or the CSV body (D-07/D-09)', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptb', { name: 'project-falcon' });
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    await createManualRaid(base, adminToken, 'A risk that mentions nothing sensitive');

    const res = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', adminToken);
    assert.strictEqual(res.status, 200);
    const disposition = res.headers.get('content-disposition') || '';
    const body = await res.text();

    assert.ok(!disposition.includes(LEGAL_TARGET_SENTINEL), 'Content-Disposition must never carry the legal-target sentinel');
    assert.ok(!body.includes(LEGAL_TARGET_SENTINEL), 'the CSV body must never carry the legal-target sentinel');
    assert.ok(disposition.includes('project-falcon'), 'the filename must be built from the codename (deal.name), not left generic');
  } finally {
    server.close();
  }
});

test('reports-export (c): a deal with no RAID entries yields byte-order-mark plus header line only — a valid, honest empty file, never an error', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptc');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

    const res = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', adminToken);
    assert.strictEqual(res.status, 200);
    // res.text() (WHATWG "UTF-8 decode") silently STRIPS a leading BOM per
    // spec \u2014 the real consumer is a browser saving raw bytes via
    // Content-Disposition, so the BOM's actual presence must be asserted at
    // the BYTE level via arrayBuffer(), not through the decoded text.
    const buf = Buffer.from(await res.arrayBuffer());
    const UTF8_BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
    assert.ok(buf.subarray(0, 3).equals(UTF8_BOM), 'the CSV body must begin with a UTF-8 byte-order mark');
    assert.strictEqual(buf.toString('utf8'), '\uFEFFID,Type,Severity,Probability,Title,Owner,Workstream,Status\r\n');
  } finally {
    server.close();
  }
});

test('reports-export (d): org and talent dataset spellings are refused with 400 before any lane is opened — no export surface exists for them at all (D-09)', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptd');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

    for (const dataset of ['positions', 'decisions', 'flightrisk']) {
      const res = await getRaw(base, `/api/reports/export?dataset=${dataset}&format=csv`, adminToken);
      assert.strictEqual(res.status, 400, `dataset=${dataset} must be refused with 400, never silently honoured`);
    }
  } finally {
    server.close();
  }
});

test('reports-export (e): a title beginning with an equals sign is apostrophe-prefixed before quoting (T-07-05), and a title containing a comma and a double quote round-trips through RFC 4180 quoting', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rpte');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

    await createManualRaid(base, adminToken, '=SUM(A1:A2)');
    await createManualRaid(base, adminToken, 'Comma, and "quote" title');

    const res = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.text();

    assert.ok(body.includes(",'=SUM(A1:A2),"), 'a title beginning with = must be apostrophe-prefixed before being placed in the CSV, never evaluated as a formula by the recipient spreadsheet');
    assert.ok(body.includes('"Comma, and ""quote"" title"'), 'a title containing a comma and a double quote must be RFC 4180 quoted, with the internal double quote doubled');
  } finally {
    server.close();
  }
});
