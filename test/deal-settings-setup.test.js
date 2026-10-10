// AUTHZ-02 / D-11-02 (Phase 11, plan 11-02, Task 3): the deal-level values an
// Integration Lead legitimately edits (currency, Day-1 date, synergy target,
// staleness threshold, phasing horizon) live on the deal's own
// POST /api/deals/:id/setup, because the instance settings singleton is
// admin-only now. Readers honour the deal values (deal > db.settings >
// default); the demo store keeps reading db.settings.
//
// Boots the REAL requireable app against an isolated temp control/runtime/
// demo/deals/audit set (MA_* paths); the committed data/*.db is never opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deal-settings-setup-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = '';
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const controlStore = require('../db/controlStore.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');
// This suite's subject is the deal setup route, not the CONC-02 version
// contract — supply the held-version precondition a real client sends.
require('./helpers/held-version.js').installHeldVersionFetch();

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function freshDeal(id, members) {
  return {
    id, name: id, targetCompany: id + ' Co', members, memberGrants: {},
    status: 'active', createdBy: 'dss-admin', createdAt: new Date().toISOString(),
    currency: 'USD', day1Date: '2026-12-01',
    setup: {
      steps: { basics: { at: new Date().toISOString(), by: 'dss-admin' }, team: null, assessments: null, scope: null, timeline: null, ddKickoff: null },
      complete: false,
    },
  };
}
function provision(id, members) {
  const deal = freshDeal(id, members);
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  ensureUser(controlConn, { username, role });
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body === undefined ? {} : body),
  });
}
async function listen() {
  const server = await listenLocal(app);
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const FULL_SETTINGS = { currency: 'EUR', day1Date: '2027-01-15', synergyTargetM: 42, synergyStaleDays: 10, synergyHorizonYears: 5 };

test('deal-settings-setup (a): an hrbp member sets all five deal-level values; the deal record, rollup and phasing readers honour them', async () => {
  const deal = provision('deal_dssa', ['dss-hrbp-a']);
  const hrbp = newSession('dss-hrbp-a', 'hrbp'); bindDeal(hrbp, deal.id);
  const { server, base } = await listen();
  try {
    const res = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, { dealSettings: FULL_SETTINGS });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.deal.currency, 'EUR');
    assert.strictEqual(body.deal.day1Date, '2027-01-15');
    assert.deepStrictEqual(
      { ...body.deal.dealSettings },
      { synergyTargetM: 42, synergyStaleDays: 10, synergyHorizonYears: 5 },
    );

    const listed = await (await fetch(`${base}/api/deals`, { headers: { Cookie: cookieHeader(hrbp) } })).json();
    const mine = listed.find((d) => d.id === deal.id);
    assert.strictEqual(mine.currency, 'EUR');
    assert.strictEqual(mine.day1Date, '2027-01-15');
    assert.strictEqual(mine.dealSettings.synergyTargetM, 42);

    const rollup = await (await fetch(`${base}/api/synergies/rollup`, { headers: { Cookie: cookieHeader(hrbp) } })).json();
    assert.strictEqual(rollup.dealSynergyTargetM, 42, 'the rollup surfaces the deal-level synergy target');
    assert.strictEqual(rollup.staleThresholdDays, 10, 'the rollup reports the threshold the deal value set');

    // phasing horizon: 5 years x 12 months from the deal value, not the 3-year default
    const created = await (await postJSON(base, '/api/synergies', hrbp, { title: 'Horizon probe', category: 'cost', owner: 'dss-hrbp-a', targetM: 5 })).json();
    const gen = await postJSON(base, `/api/synergies/${created.initiative.id}/generate-phasing`, hrbp, { runRateM: 12, startMonth: '2027-01', curveShape: 'cost' });
    assert.strictEqual(gen.status, 200);
    assert.strictEqual((await gen.json()).initiative.phasing.length, 60, 'a 5-year deal horizon yields 60 monthly rows');
  } finally {
    sessionsDb.deleteSession(runtimeConn, hrbp);
    server.close();
  }
});

test('deal-settings-setup (b): pmo and employee members are refused (403); a non-member hrbp gets the same 404 as a missing deal; an admin non-member succeeds', async () => {
  const deal = provision('deal_dssb', ['dss-pmo-b', 'dss-emp-b', 'dss-hrbp-b']);
  const pmo = newSession('dss-pmo-b', 'pmo');
  const emp = newSession('dss-emp-b', 'employee');
  const outsider = newSession('dss-hrbp-outsider-b', 'hrbp');
  const admin = newSession('dss-admin-b', 'admin');
  const { server, base } = await listen();
  try {
    for (const [role, token] of [['pmo', pmo], ['employee', emp]]) {
      const res = await postJSON(base, `/api/deals/${deal.id}/setup`, token, { dealSettings: { currency: 'GBP' } });
      assert.strictEqual(res.status, 403, `${role} member must be refused by the write policy`);
    }

    const missing = await postJSON(base, '/api/deals/deal_does_not_exist/setup', outsider, { dealSettings: { currency: 'GBP' } });
    const nonMember = await postJSON(base, `/api/deals/${deal.id}/setup`, outsider, { dealSettings: { currency: 'GBP' } });
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(nonMember.status, 404, 'a non-member must not learn the deal exists');
    assert.deepStrictEqual(await nonMember.json(), await missing.json(), 'identical body: no existence oracle');
    assert.strictEqual(controlStore.getDeal(deal.id).currency, 'USD', 'a refused caller changed nothing');

    const adminRes = await postJSON(base, `/api/deals/${deal.id}/setup`, admin, { dealSettings: { currency: 'CHF' } });
    assert.strictEqual(adminRes.status, 200, 'admin is always a member');
    assert.strictEqual(controlStore.getDeal(deal.id).currency, 'CHF');
  } finally {
    for (const t of [pmo, emp, outsider, admin]) sessionsDb.deleteSession(runtimeConn, t);
    server.close();
  }
});

test('deal-settings-setup (c): out-of-range values are refused 400 and nothing is stored', async () => {
  const deal = provision('deal_dssc', ['dss-hrbp-c']);
  const hrbp = newSession('dss-hrbp-c', 'hrbp'); bindDeal(hrbp, deal.id);
  const { server, base } = await listen();
  try {
    const before = JSON.stringify(controlStore.getDeal(deal.id));
    for (const bad of [
      { synergyStaleDays: 999999999 },
      { synergyStaleDays: 0 },
      { synergyStaleDays: -1 },
      { synergyHorizonYears: 2000 },
      { synergyHorizonYears: 0 },
      { synergyHorizonYears: 2.5 },
      { synergyTargetM: -5 },
      { synergyTargetM: 100001 },
      { currency: 'x'.repeat(11) },
      { day1Date: '2027-01-15T00:00:00Z' },
      // IN-05 (Phase 11 review): ISO YYYY-MM-DD only — length-valid junk is refused too
      { day1Date: 'not-a-date' },
      { day1Date: '2027-13-01' },
      { day1Date: '15.01.2027' },
    ]) {
      const res = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, { dealSettings: bad });
      assert.strictEqual(res.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
    assert.strictEqual(JSON.stringify(controlStore.getDeal(deal.id)), before, 'nothing was stored by any refused write');
  } finally {
    sessionsDb.deleteSession(runtimeConn, hrbp);
    server.close();
  }
});

test('deal-settings-setup (d): a body with only dealSettings is accepted; neither step, dealSettings nor completion is still refused; completion-only still works', async () => {
  const deal = provision('deal_dssd', ['dss-hrbp-d']);
  const hrbp = newSession('dss-hrbp-d', 'hrbp'); bindDeal(hrbp, deal.id);
  const { server, base } = await listen();
  try {
    const only = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, { dealSettings: { synergyTargetM: 7 } });
    assert.strictEqual(only.status, 200);
    const afterOnly = controlStore.getDeal(deal.id);
    assert.strictEqual(afterOnly.dealSettings.synergyTargetM, 7);
    assert.strictEqual(afterOnly.setup.steps.timeline, null, 'a dealSettings-only post must not stamp any wizard step');
    assert.strictEqual(afterOnly.setup.complete, false, 'nor flip completion');

    const empty = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, {});
    assert.strictEqual(empty.status, 400);
    const emptySettings = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, { data: { a: 'b' } });
    assert.strictEqual(emptySettings.status, 400);

    const completion = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, { complete: true });
    assert.strictEqual(completion.status, 200);
    assert.strictEqual(controlStore.getDeal(deal.id).setup.complete, true);
    assert.strictEqual(controlStore.getDeal(deal.id).dealSettings.synergyTargetM, 7, 'completion keeps the stored deal settings');

    // a step post and dealSettings together apply both
    const both = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, { step: 'timeline', dealSettings: { synergyHorizonYears: 4 } });
    assert.strictEqual(both.status, 200);
    const afterBoth = controlStore.getDeal(deal.id);
    assert.ok(afterBoth.setup.steps.timeline, 'the named step is stamped');
    assert.strictEqual(afterBoth.dealSettings.synergyHorizonYears, 4);
    assert.strictEqual(afterBoth.dealSettings.synergyTargetM, 7, 'partial patches merge, never replace');
  } finally {
    sessionsDb.deleteSession(runtimeConn, hrbp);
    server.close();
  }
});

test('deal-settings-setup (e): reader precedence — deal value > db.settings > default, with the same clamps; the demo store reads db.settings', () => {
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 45 } }), 45);
  assert.strictEqual(app.synergyStaleDays({ settings: {} }), 30);
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 45 } }, { synergyStaleDays: 10 }), 10, 'deal value wins over instance settings');
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 45 } }, {}), 45, 'a deal with no value falls through to db.settings');
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 45 } }, null), 45, 'null deal settings (demo store) fall through');
  assert.strictEqual(app.synergyStaleDays({ settings: {} }, { synergyStaleDays: 999999999 }), 365, 'a hostile stored deal value clamps to the ceiling');
  assert.strictEqual(app.synergyStaleDays({ settings: { synergyStaleDays: 45 } }, { synergyStaleDays: -3 }), 45, 'an unusable deal value falls through, never poisons the verdict');
  assert.strictEqual(app.synergyStaleDays({ settings: {} }, { synergyStaleDays: 'ten' }), 30);

  assert.strictEqual(app.synergyHorizonYears({ settings: { synergyHorizonYears: 7 } }), 7);
  assert.strictEqual(app.synergyHorizonYears({ settings: {} }), 3);
  assert.strictEqual(app.synergyHorizonYears({ settings: { synergyHorizonYears: 7 } }, { synergyHorizonYears: 5 }), 5);
  assert.strictEqual(app.synergyHorizonYears({ settings: { synergyHorizonYears: 7 } }, {}), 7);
  assert.strictEqual(app.synergyHorizonYears({ settings: {} }, { synergyHorizonYears: 2000 }), 15, 'deal value clamps to [1, 15]');
  assert.strictEqual(app.synergyHorizonYears({ settings: {} }, { synergyHorizonYears: 0 }), 1);
});

test('deal-settings-setup (f): the demo store is unchanged — admin sets staleness through POST /api/settings and the demo readers honour db.settings', async () => {
  const admin = newSession('dss-admin-f', 'admin');
  const { server, base } = await listen();
  try {
    const set = await postJSON(base, '/api/settings', admin, { synergyStaleDays: 12, synergyHorizonYears: 4 });
    assert.strictEqual(set.status, 200);
    const rollup = await (await fetch(`${base}/api/synergies/rollup`, { headers: { Cookie: cookieHeader(admin) } })).json();
    assert.strictEqual(rollup.staleThresholdDays, 12, 'demo store: threshold still comes from db.settings');
    assert.strictEqual(rollup.dealSynergyTargetM, null, 'no deal-level target exists on the demo store');
  } finally {
    sessionsDb.deleteSession(runtimeConn, admin);
    server.close();
  }
});

test('deal-settings-setup (g): every dealSettings change records exactly one deal-settings-update security event with before/after', async () => {
  const deal = provision('deal_dssg', ['dss-hrbp-g']);
  const hrbp = newSession('dss-hrbp-g', 'hrbp'); bindDeal(hrbp, deal.id);
  const { server, base } = await listen();
  try {
    const res = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, { dealSettings: { currency: 'EUR', synergyTargetM: 9 } });
    assert.strictEqual(res.status, 200);
    const rows = auditHook.queryAudit({ dealId: deal.id, limit: 100 }).filter((r) => r.action === 'deal-settings-update');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].actor_username, 'dss-hrbp-g');
    const before = JSON.parse(rows[0].before_json);
    const after = JSON.parse(rows[0].after_json);
    assert.strictEqual(before.currency, 'USD');
    assert.strictEqual(after.currency, 'EUR');
    assert.strictEqual(after.synergyTargetM, 9);

    // a refused write leaves no event
    const bad = await postJSON(base, `/api/deals/${deal.id}/setup`, hrbp, { dealSettings: { synergyHorizonYears: 9999 } });
    assert.strictEqual(bad.status, 400);
    const after2 = auditHook.queryAudit({ dealId: deal.id, limit: 100 }).filter((r) => r.action === 'deal-settings-update');
    assert.strictEqual(after2.length, 1);
  } finally {
    sessionsDb.deleteSession(runtimeConn, hrbp);
    server.close();
  }
});

test('IN-05 (Phase 11 review): BOTH day1Date fields (wizard basics + create-deal, and dealSettings) take an ISO YYYY-MM-DD date or empty, nothing else', () => {
  const wizard = require('../validators/wizard.js');
  const deals = require('../validators/deals.js');
  const basics = { name: 'Falcon', targetCompany: 'T' };
  const schemas = [
    ['WizardBasicsSchema', (d) => wizard.WizardBasicsSchema.safeParse(Object.assign({}, basics, { day1Date: d }))],
    ['CreateDealSchema', (d) => deals.CreateDealSchema.safeParse(Object.assign({}, basics, { day1Date: d }))],
    ['DealSettingsSchema', (d) => wizard.DealSettingsSchema.safeParse({ day1Date: d })],
  ];
  for (const [name, parse] of schemas) {
    for (const ok of ['2026-12-01', '2027-01-31', '']) assert.ok(parse(ok).success, `${name} accepts ${JSON.stringify(ok)}`);
    for (const bad of ['not-a-date', '2027-13-01', '2027-00-10', '2027-01-32', '15.01.2027', '20270115', '2027-1-5']) {
      assert.ok(!parse(bad).success, `${name} refuses ${JSON.stringify(bad)}`);
    }
  }
});
