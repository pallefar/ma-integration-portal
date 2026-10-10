// Phase 11 review CR-01 (AUTHZ-01 / D-11-01 / D-11-02): the control-plane deal
// registry record is projected per role at EVERY exit that hands it to a client.
//
// Before the fix GET /api/deals and the POST /api/deals/select echo returned the
// raw control.db row to every member — an `employee` read the deal size, the
// signing / expected-close dates, the IL's synergy target, the member list and
// the clean-room grants (MNPI) one route over from the /api/synergies 403.
//
// Contract: admin + hrbp get the full record; pmo gets { id, name,
// targetCompany, status }; employee gets { id, name, status }; an unknown role
// gets the employee shape (fail closed). Boots the real app on isolated MA_*
// temp paths; the committed data/*.db is never opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deal-record-projection-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const app = require('../server.js');
const { createDealFixture } = require('./helpers/deal-fixture');
const { projectDealForRole } = require('../lib/dealProjection');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Every key / value that must never reach pmo or employee.
const FORBIDDEN_KEYS = ['dealSizeM', 'synergyTargetM', 'memberGrants', 'members', 'setup', 'createdBy', 'dealSettings', 'currency', 'day1Date'];
const FORBIDDEN_VALUES = ['850', '42.5', '2026-11-01', '2027-01-15', '2026-12-01', 'drp-pmo', 'drp-hrbp'];

const ROLE_KEYS = {
  pmo: ['id', 'name', 'status', 'targetCompany'],
  employee: ['id', 'name', 'status'],
};

function assertProjected(record, role, where) {
  assert.ok(record && typeof record === 'object', `${where}: a deal record is present for ${role}`);
  assert.deepStrictEqual(Object.keys(record).sort(), ROLE_KEYS[role].slice().sort(), `${where}: ${role} gets exactly the allowlisted keys`);
  const text = JSON.stringify(record);
  for (const k of FORBIDDEN_KEYS) assert.ok(!text.includes(`"${k}"`), `${where}: ${role} body must not carry ${k}`);
  for (const v of FORBIDDEN_VALUES) assert.ok(!text.includes(v), `${where}: ${role} body must not carry the value ${v}`);
}

async function seededDeal(base, id) {
  const fx = createDealFixture({
    controlConn, runtimeConn, dealId: id,
    members: [
      { username: 'drp-admin', role: 'admin' },
      { username: 'drp-hrbp', role: 'hrbp' },
      { username: 'drp-pmo', role: 'pmo', ddAreas: ['hr'] },
      { username: 'drp-emp', role: 'employee' },
    ],
  });
  const post = (u, p, body) => fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: fx.cookie(u) }, body: JSON.stringify(body),
  });
  const basics = await post('drp-hrbp', `/api/deals/${id}/setup`, {
    step: 'basics', data: { targetCompany: 'Project Falcon', dealSizeM: 850, signingDate: '2026-11-01', expectedClose: '2027-01-15' },
  });
  assert.strictEqual(basics.status, 200, 'fixture: hrbp stamps the basics step');
  const settings = await post('drp-hrbp', `/api/deals/${id}/setup`, {
    dealSettings: { synergyTargetM: 42.5, currency: 'EUR', day1Date: '2026-12-01' },
  });
  assert.strictEqual(settings.status, 200, 'fixture: hrbp sets the deal-level values');
  return { fx, post, basicsBody: await basics.json(), settingsBody: await settings.json() };
}

test('CR-01: GET /api/deals — admin/hrbp get the full record; pmo and employee get only the allowlisted projection', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const { fx } = await seededDeal(base, 'deal_drplist');
    const get = async (u) => {
      const r = await fetch(base + '/api/deals', { headers: { cookie: fx.cookie(u) } });
      assert.strictEqual(r.status, 200, `${u} GET /api/deals`);
      return (await r.json()).find((d) => d.id === 'deal_drplist');
    };

    for (const u of ['drp-admin', 'drp-hrbp']) {
      const full = await get(u);
      assert.strictEqual(full.dealSettings.synergyTargetM, 42.5, `${u} still reads the synergy target`);
      assert.strictEqual(full.setup.steps.basics.data.dealSizeM, 850, `${u} still reads the deal size`);
      assert.ok(Array.isArray(full.members) && full.memberGrants, `${u} still reads members and grants`);
    }
    const pmo = await get('drp-pmo');
    assertProjected(pmo, 'pmo', 'GET /api/deals');
    assert.strictEqual(pmo.targetCompany, 'deal_drplist Co', 'pmo keeps the target company the switcher renders');
    assertProjected(await get('drp-emp'), 'employee', 'GET /api/deals');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CR-01: POST /api/deals/select echoes the SAME per-role projection', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const { fx, post } = await seededDeal(base, 'deal_drpselect');
    for (const [u, role] of [['drp-pmo', 'pmo'], ['drp-emp', 'employee']]) {
      const r = await post(u, '/api/deals/select', { dealId: 'deal_drpselect' });
      assert.strictEqual(r.status, 200, `${u} selects its deal`);
      assertProjected((await r.json()).deal, role, 'POST /api/deals/select');
    }
    const lead = await post('drp-hrbp', '/api/deals/select', { dealId: 'deal_drpselect' });
    assert.strictEqual((await lead.json()).deal.dealSettings.synergyTargetM, 42.5, 'hrbp select echo is the full record');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CR-01: POST /api/deals/:id/setup responses stay full for the roles that may call it (admin/hrbp)', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const { basicsBody, settingsBody } = await seededDeal(base, 'deal_drpsetup');
    assert.strictEqual(basicsBody.deal.setup.steps.basics.data.dealSizeM, 850);
    assert.strictEqual(settingsBody.deal.dealSettings.synergyTargetM, 42.5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CR-01 (unit): projectDealForRole — full for admin/hrbp, allowlist for pmo/employee, employee shape for an unknown role, null passes through', () => {
  const deal = {
    id: 'd', name: 'Falcon', targetCompany: 'Target Co', status: 'active',
    members: ['a'], memberGrants: { a: { ddAreas: ['hr'] } }, setup: { steps: {} },
    dealSettings: { synergyTargetM: 1 }, currency: 'EUR', day1Date: '2026-12-01', createdBy: 'a',
  };
  assert.strictEqual(projectDealForRole(deal, 'admin'), deal);
  assert.strictEqual(projectDealForRole(deal, 'hrbp'), deal);
  assert.deepStrictEqual(projectDealForRole(deal, 'pmo'), { id: 'd', name: 'Falcon', targetCompany: 'Target Co', status: 'active' });
  assert.deepStrictEqual(projectDealForRole(deal, 'employee'), { id: 'd', name: 'Falcon', status: 'active' });
  for (const role of [undefined, null, '', 'superuser', '__proto__', 'constructor']) {
    assert.deepStrictEqual(projectDealForRole(deal, role), { id: 'd', name: 'Falcon', status: 'active' }, `unknown role ${String(role)} fails closed`);
  }
  assert.strictEqual(projectDealForRole(null, 'employee'), null);
});

// --- client render checks (vm): the two consumers of GET /api/deals ----------
const vm = require('node:vm');

function fakeEl() {
  const el = {
    style: {}, hidden: false, innerHTML: '', textContent: '', children: [], className: '', id: '',
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { el.children.push(c); return c; },
    addEventListener(ev, cb) { el['on_' + ev] = cb; },
    setAttribute() {}, remove() {}, contains() { return false; },
  };
  return el;
}
function textOf(node, out) {
  out = out || [];
  if (node && node.textContent) out.push(node.textContent);
  ((node && node.children) || []).forEach((c) => textOf(c, out));
  return out;
}
const settle = () => new Promise((r) => setTimeout(r, 20));
function jsonFetch(routes) {
  return (url) => {
    const key = Object.keys(routes).find((k) => String(url).startsWith(k));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(key ? routes[key] : {}) });
  };
}
const readPublicJs = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');

async function renderDealHomeWith(dealRecord) {
  const container = fakeEl();
  const win = {};
  const sandbox = {
    window: win, console, Promise, setTimeout,
    document: { getElementById: (id) => (id === 'deal-home' ? container : null), createElement: () => fakeEl() },
    fetch: jsonFetch({
      '/api/deals': [dealRecord], '/api/assessment-status': { bySubject: {} }, '/api/dd/summary': { areas: [] },
      '/api/synergies/rollup': { mine: { staleCount: 0 } }, '/api/org/summary': { open: null },
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(readPublicJs('deal-home.js'), sandbox);
  win.renderDealHome(dealRecord.id);
  await settle();
  return textOf(container);
}

test('CR-01 (vm): deal home renders for every role shape — the setup checklist only for the full (admin/hrbp) record', async () => {
  const full = { id: 'd1', name: 'Falcon', targetCompany: 'T', status: 'active', setup: { steps: { basics: { at: 'x' } } } };
  const fullText = await renderDealHomeWith(full);
  assert.ok(fullText.includes('Setup checklist') && fullText.includes('Readiness assessments'), 'admin/hrbp: checklist + readiness');
  for (const role of ['pmo', 'employee']) {
    const t = await renderDealHomeWith(projectDealForRole(full, role));
    assert.ok(t.includes('Readiness assessments'), `${role}: the deal home still renders`);
    assert.ok(!t.includes('Setup checklist') && !t.includes('resume setup'), `${role}: no checklist built from a record it cannot see`);
  }
});

test('CR-01 (vm): the header deal switcher renders the projected pmo/employee record (name; company only where present)', async () => {
  const full = { id: 'd1', name: 'Falcon', targetCompany: 'Target Co', status: 'active', members: ['x'], setup: {} };
  for (const [role, company] of [['pmo', 'Target Co'], ['employee', '']]) {
    const host = fakeEl();
    const win = {};
    const sandbox = {
      window: win, console, Promise, setTimeout,
      document: {
        getElementById: () => null, createElement: () => fakeEl(),
        querySelector: (sel) => (sel === '.header-tools-container' ? host : null),
        addEventListener() {}, removeEventListener() {},
      },
      fetch: jsonFetch({
        '/api/auth/me': { user: { username: 'u', role }, dealId: 'd1' },
        '/api/deals': [projectDealForRole(full, role)],
      }),
    };
    vm.createContext(sandbox);
    vm.runInContext(readPublicJs('deal-switcher.js'), sandbox);
    await settle();
    const container = host.children[0];
    assert.ok(container, `${role}: the switcher renders`);
    assert.ok(textOf(container).includes('Falcon'), `${role}: the current deal's code name is shown`);
    const trigger = container.children[0];
    trigger.on_click({ stopPropagation() {} });
    const menu = container.children[1];
    const items = textOf(menu);
    assert.ok(items.includes('Falcon'), `${role}: the menu lists the deal`);
    if (company) assert.ok(items.includes(company), `${role}: the company line shows`);
    else assert.ok(!items.includes('Target Co'), `${role}: no target company anywhere in the menu`);
  }
});

test('CR-01 (static): every deal-registry exit in server.js goes through the projection', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  // No response may echo a deal record without dealForCaller()/projectDealsForRole().
  const raw = src.match(/res\.json\(\{\s*success:\s*true,\s*deal(?::\s*(?!dealForCaller\(|null\b)[A-Za-z_]+)?\s*[,}]/g) || [];
  assert.deepStrictEqual(raw, [], 'an unprojected `deal` echo was found');
  assert.ok(/app\.get\('\/api\/deals',[^]*?projectDealsForRole\(controlStore\.listDealsForUser/.test(src), 'GET /api/deals projects its list');
});
