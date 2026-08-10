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
const { csvField } = require('../lib/reportCsv.js');

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
async function createTask(base, adminToken, body) {
  const res = await postJSON(base, '/api/integration-tasks', adminToken, body);
  const { task } = await res.json();
  return task;
}
async function createSynergy(base, adminToken, body) {
  const res = await postJSON(base, '/api/synergies', adminToken, body);
  const { initiative } = await res.json();
  return initiative;
}
// 07-02 Task 1: inserts a single checklistTemplates row DIRECTLY into the
// given deal's own SQLite file (mirroring test/deal-seed.test.js's
// insertRow pattern) — there is no API surface to create a checklist
// template, and computeWorkstreamRollup(db) reads db.checklistTemplates[0].
// Uses store.getOrOpenConnection() (the SAME cache db/resolver.js uses) so
// this is a reference read/write against the connection the app itself will
// use for that deal, never a second independent handle on the same file.
function seedChecklistTemplate(dealId, workstreams) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  conn.prepare('INSERT INTO checklistTemplates (id, project_id, seq, data) VALUES (?, NULL, 0, ?)')
    .run('ck_test', JSON.stringify({ id: 'ck_test', workstreams }));
}
/** Strips the leading BOM, splits on CRLF, drops the header row and any
 * trailing empty line, and returns the number of DATA rows (never a header). */
function dataRowCountFromCsv(csvText) {
  const body = csvText.replace(/^\uFEFF/, '');
  const lines = body.split('\r\n').filter((l) => l.length > 0);
  return lines.length - 1;
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
// RPT-04/D-14 (07-04-PLAN.md Task 2): direct SQLite manipulation of the
// deal's own synergyInitiatives row — mirrors seedChecklistTemplate()'s
// established pattern above, since there is no API surface that lets a
// caller backdate lastConfirmedAt/createdAt to a precise, deterministic age.
// Uses store.getOrOpenConnection() (the SAME cache db/resolver.js uses), so
// this is a reference read/write against the connection the app itself will
// use for that deal, never a second independent handle on the same file.
function patchSynergyRow(dealId, synergyId, patch) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  const row = conn.prepare('SELECT data FROM synergyInitiatives WHERE id = ?').get(synergyId);
  const item = Object.assign(JSON.parse(row.data), patch);
  conn.prepare('UPDATE synergyInitiatives SET data = ? WHERE id = ?').run(JSON.stringify(item), synergyId);
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ============================================================
// WR-01 fix (07-REVIEW.md): csvField() must only apostrophe-prefix
// string-typed values. A JS number's string form can only ever contain
// digits/./-/e (never a formula payload), so a computed numeric column
// (e.g. a negative netBenefitM) must round-trip as a real number, not
// spreadsheet text — while the T-07-05 defence stays in force for every
// string-typed field, including a numeric-looking string.
// ============================================================
test('reports-export (csvField unit): a number-typed negative value is NEVER apostrophe-prefixed, but the identical string value keeps the T-07-05 escaping, and a formula string is still escaped', () => {
  assert.strictEqual(csvField(-5.2), '-5.2', 'a number must round-trip as real CSV numeric text, not spreadsheet text');
  assert.strictEqual(csvField('-5.2'), "'-5.2", 'a numeric-looking STRING must still keep the T-07-05 apostrophe-prefix escaping');
  assert.strictEqual(csvField('=cmd'), "'=cmd", 'a formula-string value must still be escaped');
  assert.strictEqual(csvField(0), '0', 'a zero number must not be prefixed');
  assert.strictEqual(csvField(-1), '-1', 'a negative integer number must not be prefixed');
});

// ============================================================
// 07-04 Task 2: the stale day count, from one clock and one per-deal
// threshold, into the exports (RPT-04/D-14)
// ============================================================

// The exact-at-threshold-is-not-yet-stale boundary is already proven at the
// pure-function level against a FIXED, caller-controlled clock
// (test/synergy-staleness.test.js (g): isSynergyStale(exactlyAtThreshold,
// staleDays, now)). This export-level test instead proves the whole-day
// count and the boolean survive correctly into the export surface and move
// together with D-14's one threshold — an HTTP round trip has no way to
// inject a fixed "now", so the "within threshold" fixture below is given a
// deliberate safety margin (25 of a 30-day threshold, not exactly 30) so the
// assertion can never flake on the few milliseconds of real wall-clock time
// this test itself takes to run.
test('reports-export (n): the synergies export carries a whole-day staleDays age alongside the existing boolean — comfortably-within-threshold is not stale, well-past-threshold is, moving the deal\'s threshold flips the within-threshold item, and an item with neither timestamp exports as not stale with a null day count', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptn');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

    // D-14: an explicit threshold, not the 30-day default, so the test does
    // not depend on a default that could change independently of this plan.
    await postJSON(base, '/api/settings', adminToken, { synergyStaleDays: 30 });

    const today = await createSynergy(base, adminToken, { title: 'Confirmed today', category: 'cost' });
    const nowIso = new Date().toISOString();
    patchSynergyRow(deal.id, today.id, { lastConfirmedAt: nowIso });

    const withinThreshold = await createSynergy(base, adminToken, { title: 'Confirmed comfortably within threshold', category: 'cost' });
    const twentyFiveDaysAgoIso = new Date(Date.now() - 25 * 86400000).toISOString();
    patchSynergyRow(deal.id, withinThreshold.id, { lastConfirmedAt: twentyFiveDaysAgoIso });

    const pastThreshold = await createSynergy(base, adminToken, { title: 'Confirmed well past threshold', category: 'cost' });
    const fortyFiveDaysAgoIso = new Date(Date.now() - 45 * 86400000).toISOString();
    patchSynergyRow(deal.id, pastThreshold.id, { lastConfirmedAt: fortyFiveDaysAgoIso });

    // Carries neither lastConfirmedAt nor createdAt — an unknown-age item.
    const unknownAge = await createSynergy(base, adminToken, { title: 'Unknown age' });
    patchSynergyRow(deal.id, unknownAge.id, { lastConfirmedAt: undefined, createdAt: undefined });

    const exportRows = async () => JSON.parse(await (await getRaw(base, '/api/reports/export?dataset=synergies&format=json', adminToken)).text());
    const byId = (rows, id) => rows.find((r) => r.id === id);

    let rows = await exportRows();
    assert.strictEqual(byId(rows, today.id).stale, false, 'an item confirmed today must not be stale');
    assert.strictEqual(byId(rows, today.id).staleDays, 0, 'an item confirmed today must carry a whole-day age of 0');

    assert.strictEqual(byId(rows, withinThreshold.id).stale, false, 'comfortably within the threshold must NOT be stale');
    assert.strictEqual(byId(rows, withinThreshold.id).staleDays, 25, 'the within-threshold item\'s day count must be exactly 25');

    assert.strictEqual(byId(rows, pastThreshold.id).stale, true, 'well past the threshold must be stale');
    assert.strictEqual(byId(rows, pastThreshold.id).staleDays, 45, 'the well-past-threshold item\'s day count must be exactly 45');

    assert.strictEqual(byId(rows, unknownAge.id).stale, false, 'an item with neither timestamp must export as not stale, never defaulted to stale');
    assert.strictEqual(byId(rows, unknownAge.id).staleDays, null, 'an item with neither timestamp must export a null day count, never 0 (which would misleadingly read as confirmed today)');

    // D-14: moving the deal's ONE threshold moves the export's verdict — the
    // within-threshold (25-day-old) item flips to stale once the threshold
    // drops below its age, proven at the export surface, not just the live route.
    await postJSON(base, '/api/settings', adminToken, { synergyStaleDays: 10 });
    rows = await exportRows();
    assert.strictEqual(byId(rows, withinThreshold.id).stale, true, 'lowering the threshold below the item\'s age must flip its exported stale column to true');
    assert.strictEqual(byId(rows, withinThreshold.id).staleDays, 25, 'the day count itself is an intrinsic property of the item\'s age and must not move when only the threshold changes');

    // CSV: the staleDays column exists immediately after the stale column,
    // and the JSON export's values above are exactly what the CSV serializes
    // (D-08's "same enriched shape" rule) — proven here by header order.
    const csvText = await (await getRaw(base, '/api/reports/export?dataset=synergies&format=csv', adminToken)).text();
    const headerLine = csvText.replace(/^﻿/, '').split('\r\n')[0];
    const headerCols = headerLine.split(',');
    const staleIdx = headerCols.indexOf('Stale');
    assert.strictEqual(headerCols[staleIdx + 1], 'Stale days', 'the Stale days column must appear immediately after the Stale column');
  } finally {
    server.close();
  }
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

// =====================================================================
// 07-02 Task 1: the three remaining datasets (workstreams/tasks/synergies)
// and the JSON format branch, on top of the tracer's proven architecture.
// =====================================================================

test('reports-export (f): all eight accepted dataset/format combinations return 200 with the expected content type — no 501 remains', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptf');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    await createManualRaid(base, adminToken, 'A risk for the combination sweep');
    await createTask(base, adminToken, { title: 'A task for the combination sweep', workstreamId: 'ws_imo' });
    await createSynergy(base, adminToken, { title: 'A synergy for the combination sweep', category: 'cost', targetM: 1, realizedM: 0.5 });

    for (const dataset of ['workstreams', 'tasks', 'raid', 'synergies']) {
      for (const format of ['csv', 'json']) {
        const res = await getRaw(base, `/api/reports/export?dataset=${dataset}&format=${format}`, adminToken);
        assert.strictEqual(res.status, 200, `dataset=${dataset}&format=${format} must return 200, never 501`);
        const contentType = res.headers.get('content-type') || '';
        if (format === 'json') {
          assert.ok(contentType.includes('application/json'), `dataset=${dataset}&format=json must have an application/json content type, got '${contentType}'`);
          const parsed = JSON.parse(await res.text());
          assert.ok(Array.isArray(parsed), `dataset=${dataset}&format=json must return a JSON array`);
        } else {
          assert.ok(contentType.includes('text/csv'), `dataset=${dataset}&format=csv must have a text/csv content type, got '${contentType}'`);
        }
      }
    }
  } finally {
    server.close();
  }
});

test('reports-export (g): the JSON export of synergies and raid deep-equals the live GET route body for the SAME identity in the SAME run — never a bespoke export schema (D-08)', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptg');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    await createManualRaid(base, adminToken, 'A RAID entry for the parity check');
    await createSynergy(base, adminToken, { title: 'A synergy for the parity check', category: 'revenue', targetM: 3, realizedM: 1, owner: 'Jamie', workstreamId: 'ws_sales' });

    const liveRaid = await (await getRaw(base, '/api/raid', adminToken)).json();
    const exportRaid = JSON.parse(await (await getRaw(base, '/api/reports/export?dataset=raid&format=json', adminToken)).text());
    assert.deepStrictEqual(exportRaid, liveRaid, 'the RAID JSON export must be field-for-field identical to GET /api/raid for the same identity');

    const liveSynergies = await (await getRaw(base, '/api/synergies', adminToken)).json();
    const exportSynergies = JSON.parse(await (await getRaw(base, '/api/reports/export?dataset=synergies&format=json', adminToken)).text());
    assert.deepStrictEqual(exportSynergies, liveSynergies, 'the synergies JSON export must be field-for-field identical to GET /api/synergies for the same identity');
  } finally {
    server.close();
  }
});

test('reports-export (h): the exported workstream rows equal what execution.js\'s own client-side math produces for the same seeded template and task set — a blocked workstream forces a red band, a zero-task workstream is absent', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rpth');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    seedChecklistTemplate(deal.id, [
      { id: 'ws_amber', label: 'Amber Stream', icon: '' },
      { id: 'ws_blocked', label: 'Blocked Stream', icon: '' },
      { id: 'ws_green', label: 'Green Stream', icon: '' },
      { id: 'ws_empty', label: 'Empty Stream', icon: '' },
    ]);

    // ws_amber: 2/3 done -> 67% -> amber (>=40, <80), not blocked.
    await createTask(base, adminToken, { title: 'a1', workstreamId: 'ws_amber', status: 'done' });
    await createTask(base, adminToken, { title: 'a2', workstreamId: 'ws_amber', status: 'done' });
    await createTask(base, adminToken, { title: 'a3', workstreamId: 'ws_amber', status: 'todo' });
    // ws_blocked: 1/2 done but one blocked -> red regardless of the 50% figure.
    await createTask(base, adminToken, { title: 'b1', workstreamId: 'ws_blocked', status: 'done' });
    await createTask(base, adminToken, { title: 'b2', workstreamId: 'ws_blocked', status: 'blocked' });
    // ws_green: 4/4 done -> 100% -> green.
    await createTask(base, adminToken, { title: 'g1', workstreamId: 'ws_green', status: 'done' });
    await createTask(base, adminToken, { title: 'g2', workstreamId: 'ws_green', status: 'done' });
    await createTask(base, adminToken, { title: 'g3', workstreamId: 'ws_green', status: 'done' });
    await createTask(base, adminToken, { title: 'g4', workstreamId: 'ws_green', status: 'done' });
    // ws_empty has NO tasks — must not appear in the rollup at all.

    const res = await getRaw(base, '/api/reports/export?dataset=workstreams&format=json', adminToken);
    assert.strictEqual(res.status, 200);
    const rows = JSON.parse(await res.text());

    assert.deepStrictEqual(rows, [
      { id: 'ws_amber', label: 'Amber Stream', tasksTotal: 3, tasksDone: 2, pctComplete: 67, blocked: false, ragStatus: 'amber' },
      { id: 'ws_blocked', label: 'Blocked Stream', tasksTotal: 2, tasksDone: 1, pctComplete: 50, blocked: true, ragStatus: 'red' },
      { id: 'ws_green', label: 'Green Stream', tasksTotal: 4, tasksDone: 4, pctComplete: 100, blocked: false, ragStatus: 'green' },
    ], 'the exported rollup must equal execution.js\'s own client-side math exactly, and must omit the zero-task workstream');

    // The same numbers via CSV, so the two formats can never disagree either.
    const csvRes = await getRaw(base, '/api/reports/export?dataset=workstreams&format=csv', adminToken);
    const csvBody = await csvRes.text();
    assert.strictEqual(dataRowCountFromCsv(csvBody), 3, 'the CSV export must carry exactly the three non-empty workstreams');
    assert.ok(csvBody.includes('ws_amber,Amber Stream,3,2,67,false,amber'), 'the amber row must carry the identical figures as the JSON export');
    assert.ok(csvBody.includes('ws_blocked,Blocked Stream,2,1,50,true,red'), 'the blocked row must carry the identical figures as the JSON export');
    assert.ok(csvBody.includes('ws_green,Green Stream,4,4,100,false,green'), 'the green row must carry the identical figures as the JSON export');
  } finally {
    server.close();
  }
});

test('reports-export (i): a deal with no data at all yields a headers-only CSV and an empty JSON array for all four datasets', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rpti');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

    for (const dataset of ['workstreams', 'tasks', 'raid', 'synergies']) {
      const csvRes = await getRaw(base, `/api/reports/export?dataset=${dataset}&format=csv`, adminToken);
      assert.strictEqual(csvRes.status, 200);
      assert.strictEqual(dataRowCountFromCsv(await csvRes.text()), 0, `dataset=${dataset}&format=csv on an empty deal must have zero data rows`);

      const jsonRes = await getRaw(base, `/api/reports/export?dataset=${dataset}&format=json`, adminToken);
      assert.strictEqual(jsonRes.status, 200);
      assert.deepStrictEqual(JSON.parse(await jsonRes.text()), [], `dataset=${dataset}&format=json on an empty deal must be an empty array, never an error`);
    }
  } finally {
    server.close();
  }
});

// =====================================================================
// 07-02 Task 3: proves the RAID clearance filter survived the four-dataset
// expansion, that the three unfiltered datasets return identical sets
// across identities (catching an accidental over-filter as loudly as an
// under-filter), and that no dataset/format combination ever leaks a
// second deal's rows or the legal-target sentinel.
// =====================================================================

test('reports-export (j): the RAID clearance parity from test (a) holds in BOTH formats now that the handler branches on four datasets', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptj');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
    const legalToken = newSession('pmo_legal', 'pmo'); bindDeal(legalToken, deal.id);
    const noneToken = newSession('pmo_none', 'pmo'); bindDeal(noneToken, deal.id);

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
      const liveIds = ((await (await getRaw(base, '/api/raid', identity.token)).json())).map((e) => e.id).slice().sort();

      const csvIds = sortedIdsFromCsv(await (await getRaw(base, '/api/reports/export?dataset=raid&format=csv', identity.token)).text());
      assert.deepStrictEqual(csvIds, liveIds, `${identity.name}: CSV export id set must equal GET /api/raid's own id set`);

      const jsonRows = JSON.parse(await (await getRaw(base, '/api/reports/export?dataset=raid&format=json', identity.token)).text());
      const jsonIds = jsonRows.map((r) => r.id).sort();
      assert.deepStrictEqual(jsonIds, liveIds, `${identity.name}: JSON export id set must equal GET /api/raid's own id set`);
    }
  } finally {
    server.close();
  }
});

// 260810-erm (T-ERM-01): tasks now DOES carry a conditional clearance
// concept — a task converted from a dd-finding/flight-risk stamps its
// resolved area and is filtered via reportTaskRows(), exactly like RAID.
// This test's own fixture below uses only an UNRESTRICTED manual task (no
// source, so resolveTaskClearanceArea() resolves it to null), so the
// identical-id-set assertion still holds for all three datasets here; a
// dedicated over/under-filter proof for a RESTRICTED (converted) task lives
// in test/task-access-filter.test.js.
test('reports-export (k): workstreams and synergies carry NO per-item clearance concept, and this fixture\'s tasks are all unrestricted (manual) — all three return the IDENTICAL set for all four identities', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptk');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
    const legalToken = newSession('pmo_legal', 'pmo'); bindDeal(legalToken, deal.id);
    const noneToken = newSession('pmo_none', 'pmo'); bindDeal(noneToken, deal.id);

    seedChecklistTemplate(deal.id, [{ id: 'ws_imo', label: 'Governance & IMO', icon: '' }]);
    await createTask(base, adminToken, { title: 'A task', workstreamId: 'ws_imo', status: 'done' });
    await createSynergy(base, adminToken, { title: 'A synergy', category: 'cost', targetM: 1, realizedM: 0.2 });

    const identities = [
      { name: 'admin', token: adminToken },
      { name: 'karen (IL/hrbp)', token: karenToken },
      { name: 'pmo_legal (one area)', token: legalToken },
      { name: 'pmo_none (no area)', token: noneToken },
    ];

    for (const dataset of ['workstreams', 'tasks', 'synergies']) {
      let firstIds = null;
      for (const identity of identities) {
        const rows = JSON.parse(await (await getRaw(base, `/api/reports/export?dataset=${dataset}&format=json`, identity.token)).text());
        const ids = rows.map((r) => r.id).sort();
        if (firstIds === null) { firstIds = ids; continue; }
        assert.deepStrictEqual(ids, firstIds, `dataset=${dataset}: ${identity.name} must see the IDENTICAL id set as every other identity — no clearance concept exists on this dataset`);
      }
      assert.ok(firstIds.length > 0, `dataset=${dataset}: the fixture must actually contain a row, or this assertion would pass vacuously`);
    }
  } finally {
    server.close();
  }
});

test('reports-export (l): the export route reads through the deal-bound context, never a global — a session bound to a SECOND deal receives ONLY that deal\'s rows', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const dealOne = makeDeal('deal_rptlone');
    const dealTwo = makeDeal('deal_rptltwo');
    const adminOneToken = newSession('admin', 'admin'); bindDeal(adminOneToken, dealOne.id);
    const adminTwoToken = newSession('karen', 'hrbp'); bindDeal(adminTwoToken, dealTwo.id);

    const entryOne = await createManualRaid(base, adminOneToken, 'Deal one\'s own risk');
    const entryTwo = await createManualRaid(base, adminTwoToken, 'Deal two\'s own risk');

    const idsForDealTwo = sortedIdsFromCsv(await (await getRaw(base, '/api/reports/export?dataset=raid&format=csv', adminTwoToken)).text());
    assert.deepStrictEqual(idsForDealTwo, [entryTwo.id], 'a session bound to deal two must see ONLY deal two\'s own RAID id, never deal one\'s');
    assert.ok(!idsForDealTwo.includes(entryOne.id), 'deal one\'s id must never leak into deal two\'s export');
  } finally {
    server.close();
  }
});

test('reports-export (m): the legal-target sentinel never appears in any response body or Content-Disposition header, across all four datasets and both formats (D-07)', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptm', { name: 'project-heron' });
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    seedChecklistTemplate(deal.id, [{ id: 'ws_imo', label: 'Governance & IMO', icon: '' }]);
    await createManualRaid(base, adminToken, 'A risk');
    await createTask(base, adminToken, { title: 'A task', workstreamId: 'ws_imo', status: 'done' });
    await createSynergy(base, adminToken, { title: 'A synergy', category: 'cost', targetM: 1, realizedM: 0.2 });

    for (const dataset of ['workstreams', 'tasks', 'raid', 'synergies']) {
      for (const format of ['csv', 'json']) {
        const res = await getRaw(base, `/api/reports/export?dataset=${dataset}&format=${format}`, adminToken);
        assert.strictEqual(res.status, 200);
        const disposition = res.headers.get('content-disposition') || '';
        const body = await res.text();
        assert.ok(!disposition.includes(LEGAL_TARGET_SENTINEL), `dataset=${dataset}&format=${format}: Content-Disposition must never carry the legal-target sentinel`);
        assert.ok(!body.includes(LEGAL_TARGET_SENTINEL), `dataset=${dataset}&format=${format}: the response body must never carry the legal-target sentinel`);
      }
    }
  } finally {
    server.close();
  }
});
