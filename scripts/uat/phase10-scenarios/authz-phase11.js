// Phase 11 plan 11-08: browser + API evidence for authorization and clean-room
// closure (AUTHZ-01..05, PRD acceptance 1-6). Loaded by scripts/uat/phase10-walk.js
// (the runner contract: scenario modules export `{ name: async (ctx) => ... }`
// plus `__lanes`; later plans ADD modules and never edit the runner).
//
// Lanes
//   real              authzRoleMatrix, cleanRoom404, denialAuditBounded: a real
//                     deal (MA_MODE=real), four accounts + a probe account, every
//                     assertion made from the account's OWN session.
//   dev, demo-open    demoShowcaseUnchanged: the committed showcase must render as
//                     before - no 403 in the network log, settings-driven content
//                     present, no page error.
//
// Contract, not implementation: every assertion names a status code, a body
// field or a visible string; nothing here reads the policy tables to decide an
// expectation except the PUBLIC_SETTINGS_KEYS allowlist (the declared contract
// of "what a non-admin may see in /api/settings").
//
// Hygiene (T-11-71): every account/deal/finding is synthetic. Temporary and
// rotated passwords live only in local variables - they are never logged, never
// put in a check detail, never typed before a screenshot.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------- helpers
function secret(prefix) {
  return prefix + crypto.randomBytes(14).toString('base64url');
}

function cookieOf(headers) {
  const m = /ma_session=([^;]+)/.exec(headers.get('set-cookie') || '');
  return m ? 'ma_session=' + m[1] : null;
}

// The published demo password is read from the shipped login.js (its single
// client-side home, D-10-08c), never hard-coded here.
function publishedDemoPassword() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'js', 'login.js'), 'utf8');
  const m = /var\s+DEMO_PASSWORD\s*=\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('could not read DEMO_PASSWORD from public/js/login.js');
  return m[1];
}

function publicSettingsKeys() {
  return require(path.join(__dirname, '..', '..', '..', 'validators', 'settings.js')).PUBLIC_SETTINGS_KEYS;
}

// Every same-origin response status for the life of the page, with the widths
// it was recorded at (so a 390 px reload is reported separately).
function trackResponses(page, base) {
  const seen = [];
  page.on('response', (r) => {
    const u = r.url();
    if (u.indexOf(base) === 0) seen.push({ url: u.slice(base.length), status: r.status(), method: r.request().method() });
  });
  return seen;
}

const SECRETISH = /api[-_]?key|secret|token|password|connection|credential|private/i;

// Evidence is capped (<= 1200 KB for the whole directory, T-11-71 keeps it to
// synthetic data). The Phase 10 runner's own shot() is JPEG q60; this module
// uses q28 so the page shots of this plan fit the same cap. Same file
// format, same viewport, same screenshot call.
const SHOT_QUALITY = 28;
async function snap(ctx, page, name) {
  const file = path.join(ctx.outDir, name + '.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: SHOT_QUALITY, fullPage: false });
  return file;
}

// A fetch made by the page itself, from a neutral same-origin document (/healthz
// is a plain JSON document that is always served): the request carries the
// browser context's own session cookie and nothing from the app's scripts (no
// transitions.js fetch override, no redirects) can interfere with it.
async function pageFetch(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    let text = '';
    try { text = await res.text(); json = JSON.parse(text); } catch (e) { /* non-JSON body */ }
    return { status: res.status, json, text };
  }, { method, url, body });
}

async function neutralPage(ctx, cookie) {
  const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: cookie ? [cookie] : [] });
  await page.goto(ctx.base + '/healthz', { waitUntil: 'load' });
  return page;
}

async function overflowOf(page) {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
}

// ------------------------------------------------------- real-lane fixture
// One deal + five accounts per real-lane server, built once and shared by the
// three real-lane scenarios (they run sequentially against the same server).
const fixtures = new Map();

const ACCOUNTS = [
  { key: 'hrbp', username: 'p11.hrbp', name: 'Phase Eleven IL', role: 'hrbp' },
  { key: 'pmo', username: 'p11.pmo', name: 'Phase Eleven Workstream Lead', role: 'pmo' },
  { key: 'cleared', username: 'p11.cleared', name: 'Phase Eleven Cleared Lead', role: 'pmo', ddAreas: ['hr'] },
  { key: 'emp', username: 'p11.emp', name: 'Phase Eleven Employee', role: 'employee' },
  { key: 'probe', username: 'p11.probe', name: 'Phase Eleven Probe', role: 'employee' },
];

async function buildFixture(ctx) {
  const adminCookie = await ctx.adminLogin();
  const users = {};
  for (const a of ACCOUNTS) {
    const created = await ctx.api(adminCookie, 'POST', '/api/admin/users', { username: a.username, name: a.name, role: a.role });
    if (created.status !== 201 || !created.json || !created.json.tempPassword) {
      throw new Error('account create failed for ' + a.username + ': ' + created.status);
    }
    const first = await ctx.loginFull(a.username, created.json.tempPassword);
    const next = secret('Rot-');
    const ch = await ctx.api(first.cookie, 'POST', '/api/auth/change-password', { currentPassword: created.json.tempPassword, newPassword: next });
    if (ch.status !== 200) throw new Error('forced rotation failed for ' + a.username + ': ' + ch.status);
    users[a.key] = { username: a.username, role: a.role, cookie: cookieOf(ch.headers) || first.cookie };
  }

  const deal = await ctx.api(adminCookie, 'POST', '/api/deals', {
    name: 'Phase 11 evidence deal',
    targetCompany: 'Synthetic Evidence Target Co',
    members: ACCOUNTS.map((a) => a.username),
  });
  if (deal.status !== 200 || !deal.json || !deal.json.deal || !deal.json.deal.id) {
    throw new Error('deal create failed: ' + deal.status + ' ' + JSON.stringify(deal.json));
  }
  const dealId = deal.json.deal.id;

  const grant = await ctx.api(adminCookie, 'POST', `/api/deals/${dealId}/grants`, { username: 'p11.cleared', ddAreas: ['hr'] });
  if (grant.status !== 200) throw new Error('hr grant failed: ' + grant.status);

  // Bind every session (admin included) to the deal: that is what makes the
  // request resolve to the REAL deal store rather than the demo store.
  const all = Object.assign({ admin: { username: 'admin', role: 'admin', cookie: adminCookie } }, users);
  for (const key of Object.keys(all)) {
    const sel = await ctx.api(all[key].cookie, 'POST', '/api/deals/select', { dealId });
    if (sel.status !== 200) throw new Error('deal select failed for ' + all[key].username + ': ' + sel.status);
  }
  return { dealId, users: all };
}

function fixtureFor(ctx) {
  if (!fixtures.has(ctx.base)) fixtures.set(ctx.base, buildFixture(ctx));
  return fixtures.get(ctx.base);
}

// Loads a landing page as `role`, fails on any refused/errored response during
// page load, and shoots it at the requested widths. Returns the tracked rows.
// EVERY page is checked at 1440 AND 390; `shotAt` lists the widths that are also
// screenshotted (the evidence directory is capped at 1200 KB).
async function landing(ctx, who, pagePath, shotAt, tag) {
  const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [who.cookie] });
  const seen = trackResponses(page, ctx.base);
  const stem = pagePath.replace(/^\//, '').replace(/\.html$/, '');
  const shots = [];
  let loads = 0;
  for (const width of [ctx.viewports.desktop.width, ctx.viewports.phone.width]) {
    if (width === ctx.viewports.phone.width) await page.setViewportSize({ width: ctx.viewports.phone.width, height: ctx.viewports.phone.height });
    const from = seen.length;
    if (loads === 0) await page.goto(ctx.base + pagePath, { waitUntil: 'load' });
    else await page.reload({ waitUntil: 'load' });
    loads += 1;
    await ctx.sleep(2600);
    const landed = new URL(page.url()).pathname;
    const rows = seen.slice(from);
    const refused = rows.filter((r) => r.status === 401 || r.status === 403);
    const errored = rows.filter((r) => r.status >= 500);
    const label = `${tag || who.role} ${pagePath} @${width}`;
    ctx.check(`${label}: stays on the page (no bounce to login / change-password)`,
      landed === pagePath, landed);
    ctx.check(`${label}: no 401/403 raised by the page load`, refused.length === 0, refused.map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`));
    ctx.check(`${label}: no 5xx during the page load`, errored.length === 0, errored.map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`));
    ctx.check(`${label}: no page error`, page.pageErrors.length === 0, page.pageErrors);
    // IN-C01 (review fix): the Day pill / Time Machine posts to the demo-only
    // time-travel route, so a real-deal session is never offered it (any role).
    const pill = await page.evaluate(() => {
      const t = document.getElementById('time-machine-trigger');
      return !!t && t.getClientRects().length > 0;
    });
    ctx.check(`${label}: the Day pill (time machine) is not offered in a real deal (IN-C01)`, pill === false, { pillVisible: pill });
    ctx.check(`${label}: no POST /api/settings/time-travel was fired by the page load`,
      rows.filter((r) => r.method === 'POST' && r.url.split('?')[0] === '/api/settings/time-travel').length === 0, null);
    if (shotAt.includes(width)) {
      const file = `p11-${tag || who.role}-${stem}-${width}`;
      await snap(ctx, page, file);
      shots.push(file + '.jpg');
    }
  }
  return { page, seen, shots };
}

// A role follows a link / types a URL to a page that is NOT on its own landing
// list. Since the review fix (WR-C01/WR-C04) the page gate decides with the
// server-verified role: the page either stays (expect === the page path) or
// sends the visitor home ('/') - in both cases with ZERO refused responses
// (before the fix these loaded the shell and raised 403s). Every response status
// is read from the page's own network log.
async function gatePage(ctx, who, label, pagePath, expectLanded) {
  const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [who.cookie] });
  const seen = trackResponses(page, ctx.base);
  await page.goto(ctx.base + pagePath, { waitUntil: 'load' });
  await ctx.sleep(2600);
  const landed = new URL(page.url()).pathname;
  const refused = seen.filter((r) => r.status === 401 || r.status === 403).map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`);
  const errored = seen.filter((r) => r.status >= 500).map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`);
  const tag = `${label} opens ${pagePath}`;
  ctx.check(`${tag}: the server-verified role ${expectLanded === pagePath ? 'is allowed to stay' : 'is sent home (/)'}`, landed === expectLanded, landed);
  ctx.check(`${tag}: 0 refused (401/403) responses`, refused.length === 0, refused);
  ctx.check(`${tag}: no 5xx and no page error`, errored.length === 0 && page.pageErrors.length === 0, { errored, pageErrors: page.pageErrors });
  await page.close();
}

// Dev lane (logged-in demo store): pages each published demo account is sent
// home from because its server-verified role is not on the page's access list.
const SENT_HOME = {
  karen: ['/employee.html', '/pmo.html'],
  pmo: ['/admin.html'],
};

// ------------------------------------------------------------ the scenarios
module.exports = {
  __lanes: {
    authzRoleMatrix: ['real'],
    cleanRoom404: ['real'],
    denialAuditBounded: ['real'],
    demoShowcaseUnchanged: ['dev', 'demo-open'],
  },

  // PRD acceptance 1, 2, 4 (live), 5 and the page-load half of the 11-07
  // hidden-controls contract, from each role's own browser session.
  async authzRoleMatrix(ctx) {
    const f = await fixtureFor(ctx);
    const { users, dealId } = f;

    // ---------------- acceptance 1: employee, real deal
    {
      const page = await neutralPage(ctx, users.emp.cookie);
      const refused = ['/api/synergies', '/api/raid', '/api/integration-tasks', '/api/employees', '/api/communications',
        '/api/org/positions', '/api/dd/areas', '/api/reports/export'];
      for (const p of refused) {
        const r = await pageFetch(page, 'GET', p);
        ctx.check(`acceptance 1: employee GET ${p} -> 403`, r.status === 403, r.status);
      }
      const served = ['/api/courses', '/api/lessons', '/api/notifications'];
      for (const p of served) {
        const r = await pageFetch(page, 'GET', p);
        ctx.check(`acceptance 1: employee GET ${p} -> 200`, r.status === 200, r.status);
      }

      // pulses: own only for the employee, aggregate-only for pmo, everything for hrbp/admin.
      const own = await pageFetch(page, 'POST', '/api/pulses', { employeeName: 'P11 Own Employee', rating: 4, comment: 'p11-own-comment-marker', type: '30-day' });
      ctx.check('acceptance 1: employee may file its own pulse (201)', own.status === 201, own.status);
      const other = await ctx.api(users.admin.cookie, 'POST', '/api/pulses', { employeeName: 'P11 Other Person', rating: 2, comment: 'p11-other-comment-marker', type: '30-day' });
      ctx.check('admin files a second pulse as the "someone else" fixture (201)', other.status === 201, other.status);
      const empPulses = await pageFetch(page, 'GET', '/api/pulses');
      const empBody = empPulses.text || '';
      ctx.check('acceptance 1: employee GET /api/pulses -> 200 and holds only its own pulse',
        empPulses.status === 200 && Array.isArray(empPulses.json) && empPulses.json.length >= 1
          && empBody.indexOf('p11-own-comment-marker') !== -1
          && empBody.indexOf('p11-other-comment-marker') === -1 && empBody.indexOf('P11 Other Person') === -1,
        { status: empPulses.status, rows: Array.isArray(empPulses.json) ? empPulses.json.length : null });
      const pmoPage = await neutralPage(ctx, users.pmo.cookie);
      const pmoPulses = await pageFetch(pmoPage, 'GET', '/api/pulses');
      ctx.check('acceptance 1/D-11-06: pmo sees no named rating or comment of another author',
        pmoPulses.status === 200 && (pmoPulses.text || '').indexOf('p11-other-comment-marker') === -1
          && (pmoPulses.text || '').indexOf('P11 Other Person') === -1 && (pmoPulses.text || '').indexOf('p11-own-comment-marker') === -1,
        pmoPulses.status);
      const hrbpPage = await neutralPage(ctx, users.hrbp.cookie);
      const hrbpPulses = await pageFetch(hrbpPage, 'GET', '/api/pulses');
      ctx.check('D-11-06: the Integration Leader sees the named pulses',
        hrbpPulses.status === 200 && (hrbpPulses.text || '').indexOf('p11-other-comment-marker') !== -1, hrbpPulses.status);
      const ownPulse = Array.isArray(hrbpPulses.json) ? hrbpPulses.json.find((x) => String(x.comment || '').indexOf('p11-own-comment-marker') !== -1) : null;
      ctx.check('IN-02: the pulse filed with body employeeName "P11 Own Employee" is attributed to the ACCOUNT ("Phase Eleven Employee"), not the free-text name',
        !!ownPulse && ownPulse.employeeName === 'Phase Eleven Employee', ownPulse ? { employeeName: ownPulse.employeeName } : null);

      // the employee's own profile resolves to an account-derived record (11-06 hand-off)
      // WR-03 (review): the FIRST call creates the account-derived roster row; a
      // forged role / department / company in the body must not become staff data.
      const goc = await pageFetch(page, 'POST', '/api/employees/get-or-create', {
        empId: 'emp_colleague_probe', name: 'Colleague Probe',
        role: 'P11 forged role', department: 'P11 forged department', company: 'P11 Forged Co',
      });
      const gocEmp = goc.json && goc.json.employee;
      ctx.check('acceptance 4/5: employee POST /api/employees/get-or-create resolves ONLY its own account-derived record',
        (goc.status === 200 || goc.status === 201) && !!gocEmp && /^emp_acct_/.test(String(gocEmp.id)) && String(gocEmp.id) !== 'emp_colleague_probe',
        { status: goc.status, idPrefix: gocEmp ? String(gocEmp.id).slice(0, 9) : null });
      ctx.check('WR-03: the restricted get-or-create lane ignores a forged role / department / company (server-minted defaults only)',
        !!gocEmp && gocEmp.role !== 'P11 forged role' && gocEmp.department !== 'P11 forged department' && gocEmp.company !== 'P11 Forged Co',
        gocEmp ? { role: gocEmp.role, department: gocEmp.department, company: gocEmp.company } : null);
      const gocSlash = await pageFetch(page, 'POST', '/api/employees/get-or-create/', {});
      ctx.check('IN-04: a trailing-slash spelling of the POST behaves like the canonical path (200/201, same account-derived id), never a 500 diagnostic',
        (gocSlash.status === 200 || gocSlash.status === 201) && !!gocSlash.json && !!gocSlash.json.employee && gocSlash.json.employee.id === (gocEmp && gocEmp.id),
        { status: gocSlash.status });
      const gocCase = await pageFetch(page, 'POST', '/api/Employees/get-or-create', {});
      ctx.check('IN-04: a non-canonical POST spelling is answered by the router (404) or the gate (403), never a 500', gocCase.status < 500 && gocCase.status !== 200 && gocCase.status !== 201, gocCase.status);
      const gocGet = await pageFetch(page, 'GET', '/api/employees/get-or-create?empId=emp_colleague_probe&name=Colleague+Probe');
      ctx.check('acceptance 4: the GET form of get-or-create no longer answers 200 for an employee', gocGet.status !== 200 && gocGet.status < 500, gocGet.status);
      const gocGetAdmin = await ctx.api(users.admin.cookie, 'GET', '/api/employees/get-or-create?empId=emp_colleague_probe&name=Colleague+Probe');
      ctx.check('acceptance 4: the GET form is gone for admin too (never 200, no write)', gocGetAdmin.status !== 200 && gocGetAdmin.status < 500, gocGetAdmin.status);

      // the capability map the client reads (11-07) agrees with the server's verdicts
      const me = await pageFetch(page, 'GET', '/api/auth/me');
      const acc = me.json && me.json.access;
      ctx.check('11-07: /api/auth/me carries an access map for the employee: roster/synergies/tasks false, configWrite false',
        !!acc && acc.roster === false && acc.synergies === false && acc.tasks === false && acc.configWrite === false, acc);
      ctx.check('GET /api/settings for the employee holds only allowlisted keys and no secret-ish field', await (async () => {
        const s = await pageFetch(page, 'GET', '/api/settings');
        const allowed = new Set(publicSettingsKeys());
        const keys = s.json && typeof s.json === 'object' ? Object.keys(s.json) : [];
        const outside = keys.filter((k) => !allowed.has(k));
        const secretish = keys.filter((k) => SECRETISH.test(k) && k !== 'hasGeminiApiKey');
        ctx.check('  (settings detail: employee) status 200, no key outside the allowlist, no secret-ish key',
          s.status === 200 && outside.length === 0 && secretish.length === 0, { status: s.status, outside, secretish });
        return s.status === 200 && outside.length === 0 && secretish.length === 0;
      })());
    }

    // ---------------- acceptance 2: pmo / hrbp
    const configWrites = ['/api/settings', '/api/menus', '/api/pages', '/api/banners', '/api/slides', '/api/media', '/api/i18n'];
    for (const role of ['pmo', 'hrbp']) {
      const page = await neutralPage(ctx, users[role].cookie);
      for (const p of configWrites) {
        const r = await pageFetch(page, 'POST', p, {});
        ctx.check(`acceptance 2: ${role} POST ${p} -> 403`, r.status === 403, r.status);
      }
      const s = await pageFetch(page, 'GET', '/api/settings');
      const allowed = new Set(publicSettingsKeys());
      const keys = s.json && typeof s.json === 'object' ? Object.keys(s.json) : [];
      const outside = keys.filter((k) => !allowed.has(k));
      const secretish = keys.filter((k) => SECRETISH.test(k) && k !== 'hasGeminiApiKey');
      ctx.check(`acceptance 2: ${role} GET /api/settings keys are a subset of the public allowlist, no secret-ish key`,
        s.status === 200 && outside.length === 0 && secretish.length === 0, { status: s.status, outside, secretish });
    }
    {
      const pmoPage = await neutralPage(ctx, users.pmo.cookie);
      const hrbpPage = await neutralPage(ctx, users.hrbp.cookie);
      const pmoSetup = await pageFetch(pmoPage, 'POST', `/api/deals/${dealId}/setup`, { dealSettings: { synergyTargetM: 7 } });
      ctx.check('acceptance 2: a workstream lead (pmo) cannot edit deal-level values', pmoSetup.status === 403, pmoSetup.status);
      const hrbpSetup = await pageFetch(hrbpPage, 'POST', `/api/deals/${dealId}/setup`, { dealSettings: { synergyTargetM: 25, currency: 'EUR', synergyStaleDays: 10 } });
      ctx.check('acceptance 2: the Integration Leader (hrbp) edits deal-level values via the deal setup route -> 200', hrbpSetup.status === 200, hrbpSetup.status);
      for (const bad of ['not-a-date', '2026-13-45']) {
        const r = await pageFetch(hrbpPage, 'POST', `/api/deals/${dealId}/setup`, { dealSettings: { day1Date: bad } });
        ctx.check(`IN-05: deal setup refuses day1Date "${bad}" (400), nothing stored`, r.status === 400, r.status);
      }
      const roll = await pageFetch(hrbpPage, 'GET', '/api/synergies/rollup');
      ctx.check('acceptance 2: the deal-level synergy target is what the rollup reports (25)',
        roll.status === 200 && roll.json && Number(roll.json.dealSynergyTargetM) === 25, roll.json && roll.json.dealSynergyTargetM);
      const adminPage = await neutralPage(ctx, users.admin.cookie);
      const adminSettings = await pageFetch(adminPage, 'GET', '/api/settings');
      ctx.check('acceptance 2: admin still reads the full settings object (200)', adminSettings.status === 200, adminSettings.status);
      const hrbpAudit = await pageFetch(hrbpPage, 'GET', '/api/admin/audit');
      ctx.check('control: hrbp cannot read the audit log (403)', hrbpAudit.status === 403, hrbpAudit.status);
    }

    // ---------------- CR-01 (review): the deal registry record is projected per role
    // Before the fix an `employee` read the control-plane record: deal size,
    // signing / close dates, the IL's synergy target, who is cleared for which
    // clean-room area. The record is now {id,name,status} for an employee,
    // {id,name,targetCompany,status} for a pmo and the full record for hrbp/admin.
    {
      const MNPI_KEYS = ['dealSizeM', 'synergyTargetM', 'memberGrants', 'members', 'setup', 'dealSettings', 'createdBy', 'currency', 'day1Date'];
      const sameKeys = (o, keys) => !!o && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys.slice().sort());
      const hrbpPage = await neutralPage(ctx, users.hrbp.cookie);
      const basics = await pageFetch(hrbpPage, 'POST', `/api/deals/${dealId}/setup`, {
        step: 'basics',
        data: { targetCompany: 'Synthetic Evidence Target Co', dealSizeM: 850, signingDate: '2026-11-01', expectedClose: '2027-01-15' },
      });
      ctx.check('CR-01 fixture: the IL records deal size / signing / close dates through the wizard basics step (200)', basics.status === 200, basics.status);

      const hl = await pageFetch(hrbpPage, 'GET', '/api/deals');
      const hdeal = Array.isArray(hl.json) ? hl.json.find((d) => d.id === dealId) : null;
      ctx.check('CR-01 control: the Integration Leader (hrbp) still reads the FULL record (deal size, synergy target, members, grants, setup)',
        hl.status === 200 && !!hdeal && /"dealSizeM":850/.test(hl.text || '') && /"synergyTargetM":25/.test(hl.text || '')
          && Array.isArray(hdeal.members) && !!hdeal.memberGrants && !!hdeal.setup,
        { status: hl.status, keys: hdeal ? Object.keys(hdeal).sort() : null });

      for (const [who, label, keys, withTarget] of [
        [users.emp, 'employee', ['id', 'name', 'status'], false],
        [users.pmo, 'pmo', ['id', 'name', 'targetCompany', 'status'], true],
      ]) {
        const page = await neutralPage(ctx, who.cookie);
        const list = await pageFetch(page, 'GET', '/api/deals');
        const deal = Array.isArray(list.json) ? list.json.find((d) => d.id === dealId) : null;
        const text = list.text || '';
        const leaked = MNPI_KEYS.filter((k) => text.indexOf('"' + k + '"') !== -1);
        ctx.check(`CR-01: ${label} GET /api/deals (200) holds the deal as exactly {${keys.join(',')}}`,
          list.status === 200 && sameKeys(deal, keys), { status: list.status, keys: deal ? Object.keys(deal).sort() : null });
        ctx.check(`CR-01: ${label} GET /api/deals body has none of dealSizeM / synergyTargetM / memberGrants / members / setup (nor dealSettings, createdBy, currency, day1Date)`,
          leaked.length === 0, leaked);
        ctx.check(`CR-01: ${label} GET /api/deals ${withTarget ? 'names the target company (the switcher renders it)' : 'does not name the target company (pre-announcement MNPI)'}`,
          (text.indexOf('Synthetic Evidence Target Co') !== -1) === withTarget, { named: text.indexOf('Synthetic Evidence Target Co') !== -1 });
        ctx.check(`CR-01: ${label} GET /api/deals does not carry the seeded figures (850 / 2026-11-01 / 2027-01-15)`,
          text.indexOf('2026-11-01') === -1 && text.indexOf('2027-01-15') === -1 && !/"dealSizeM"/.test(text), null);
        const sel = await pageFetch(page, 'POST', '/api/deals/select', { dealId });
        const echoed = sel.json && sel.json.deal;
        const selLeaked = MNPI_KEYS.filter((k) => (sel.text || '').indexOf('"' + k + '"') !== -1);
        ctx.check(`CR-01: ${label} POST /api/deals/select echoes the same projected record (200)`,
          sel.status === 200 && sameKeys(echoed, keys) && selLeaked.length === 0, { status: sel.status, keys: echoed ? Object.keys(echoed).sort() : null, leaked: selLeaked });
      }
    }

    {
      // FIXER S observation (kept as a measurement, not an assertion - a product
      // call deferred to Phase 17, the real-deal shell): the target name withheld
      // from the employee deal record is still part of the PUBLIC settings subset.
      const page = await neutralPage(ctx, users.emp.cookie);
      const es = await pageFetch(page, 'GET', '/api/settings');
      ctx.pass('OBSERVATION (not an assertion): employee GET /api/settings carries targetCompany (public allowlist key; deferred to Phase 17)',
        { status: es.status, hasTargetCompany: !!(es.json && typeof es.json.targetCompany === 'string' && es.json.targetCompany.length > 0) });
    }

    // ---------------- acceptance 5: spelling variants never widen a role
    {
      const variants = ['/api/Synergies', '/api//raid', '/api/%73ynergies', '//api/raid', '/api/synergies/', '/api/raid/',
        '/API/raid', '/api/%52aid', '/api/./integration-tasks', '/api//employees', '/api/Employees', '/api/%64d/areas'];
      for (const v of variants) {
        const r = await ctx.api(users.emp.cookie, 'GET', v);
        ctx.check(`acceptance 5: employee GET ${v} is never 200`, r.status !== 200, r.status);
      }
      const writeVariants = ['/api/Settings', '/api//settings', '/api/%73ettings', '/api/settings/', '/api/MENUS', '/api//pages'];
      for (const v of writeVariants) {
        const r = await ctx.api(users.pmo.cookie, 'POST', v, {});
        ctx.check(`acceptance 5: pmo POST ${v} is never 2xx`, r.status < 200 || r.status >= 300, r.status);
      }
    }

    // ---------------- page-load network log + screenshots per role
    // Screenshot widths: 1440 and 390 for the primary landing page of each role;
    // the secondary pages are checked at both widths but shot only at 1440 (the
    // evidence directory is capped, README.md maps every file).
    const phone = ctx.viewports.phone.width;
    const desktop = ctx.viewports.desktop.width;
    await landing(ctx, users.emp, '/employee.html', [desktop, phone], 'employee');
    await landing(ctx, users.pmo, '/pmo.html', [desktop, phone], 'pmo');
    await landing(ctx, users.pmo, '/execution.html', [], 'pmo'); // network log only; the boards are shot in cleanRoom404
    await landing(ctx, users.hrbp, '/dashboard.html', [desktop, phone], 'hrbp');
    await landing(ctx, users.hrbp, '/admin.html', [desktop, phone], 'hrbp'); // the console with the config cards hidden (11-07)
    await landing(ctx, users.admin, '/admin.html', [desktop], 'admin');       // the full console, for comparison

    // ---------------- page gate (review fixes WR-C01 / WR-C04, plan 11-08 refresh)
    // The Phase 11 first pass could only OBSERVE these (the employee following the
    // Admin Console link raised six 403s, due-diligence/org three each). The page
    // gate now decides with the server-verified role (never the role derived from
    // the path), so each is an ASSERTION: the page stays for the roles that own it
    // and sends everyone else home, with ZERO refused responses either way.
    //   employee: sent home from every staff page, incl. the persona pages that
    //             used to be reachable by URL (dashboard, supporting)
    //   pmo:      keeps pmo/execution/DD/org, loses admin.html
    //   hrbp:     keeps dashboard/admin/DD/org, loses the employee / pmo personas
    for (const p of ['/admin.html', '/pmo.html', '/due-diligence.html', '/org.html', '/dashboard.html', '/supporting.html', '/execution.html']) {
      await gatePage(ctx, users.emp, 'employee', p, '/');
    }
    await gatePage(ctx, users.pmo, 'pmo', '/admin.html', '/');
    for (const p of ['/pmo.html', '/execution.html', '/due-diligence.html', '/org.html']) {
      await gatePage(ctx, users.pmo, 'pmo', p, p);
    }
    for (const p of ['/employee.html', '/pmo.html', '/supporting.html']) {
      await gatePage(ctx, users.hrbp, 'hrbp', p, '/');
    }
    for (const p of ['/dashboard.html', '/admin.html', '/due-diligence.html', '/org.html']) {
      await gatePage(ctx, users.hrbp, 'hrbp', p, p);
    }

    // IN-C02: the kiosk page is public and used to throw for an employee session
    // (GET /api/employees 403 + "employees.filter is not a function").
    await gatePage(ctx, users.emp, 'employee', '/signage.html', '/signage.html');

    // IN-C03 / WR-C07 on the Integration Leader's and the admin's consoles.
    for (const [who, label, expectTabs] of [[users.hrbp, 'hrbp', false], [users.admin, 'admin', true]]) {
      const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [who.cookie] });
      await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
      await ctx.sleep(2600);
      const tabs = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('[data-config-only]'));
        return { total: els.length, visible: els.filter((e) => e.getClientRects().length > 0).length };
      });
      ctx.check(`IN-C03: ${label} admin console — the configuration / content rail tabs are ${expectTabs ? 'revealed' : 'hidden (never flashed)'}`,
        tabs.total > 0 && (expectTabs ? tabs.visible > 0 : tabs.visible === 0), tabs);
      await page.close();
    }
    // WR-C07: the honest sender-side note under the recipient picker of the two
    // composers a real-deal session can reach (the PMO desk and the admin
    // dispatcher). textContent, not innerText: the desk may sit in a tab that is not
    // the active one at load and innerText skips display:none content.
    const NOTE = "Employees can't read in-app messages yet.";
    for (const [who, pagePath, label] of [[users.pmo, '/pmo.html', 'PMO desk'], [users.admin, '/admin.html', 'admin dispatcher']]) {
      const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [who.cookie] });
      await page.goto(ctx.base + pagePath, { waitUntil: 'load' });
      await ctx.sleep(2600);
      const probe = await page.evaluate(() => ({
        notes: Array.from(document.querySelectorAll('.ma-employee-inbox-note')).map((n) => n.textContent),
        dealBound: !!window.__portalDealId,
      }));
      ctx.check(`WR-C07: the ${label} composer carries the honest sender-side note exactly once in a real deal`,
        probe.dealBound && probe.notes.length === 1 && probe.notes[0] === NOTE, probe);
      await page.close();
    }
    {
      // The IL desk call site lives inside initDemoDashboard(), which a deal-bound
      // session never runs (dashboard.js: the deal home replaces the showcase), so
      // the note has nothing to attach to there. Recorded as a measurement.
      const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [users.hrbp.cookie] });
      await page.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
      await ctx.sleep(2600);
      const probe = await page.evaluate(() => ({
        notes: document.querySelectorAll('.ma-employee-inbox-note').length,
        dealHomeShown: !!document.getElementById('deal-home') && getComputedStyle(document.getElementById('deal-home')).display !== 'none',
        legacyDeskVisible: !!document.getElementById('hrbp-comm-recipient-type') && document.getElementById('hrbp-comm-recipient-type').getClientRects().length > 0,
      }));
      ctx.pass('OBSERVATION (not an assertion): IL dashboard.html in a real deal shows the deal home and no legacy Communications Desk, so the WR-C07 note call site in dashboard.js is not reached (F-R1)', probe);
      await page.close();
    }

    // ---------------- WR-C03: assessments.html no longer asks for the admin-only
    // instance list (3 refused requests per load for hrbp and pmo before the fix).
    for (const who of [users.hrbp, users.pmo]) {
      const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [who.cookie] });
      const seen = trackResponses(page, ctx.base);
      await page.goto(ctx.base + '/assessments.html', { waitUntil: 'load' });
      await ctx.sleep(2600);
      const landed = new URL(page.url()).pathname;
      const inst = seen.filter((r) => r.url.indexOf('/api/assessment-instances') === 0);
      const refused = seen.filter((r) => r.status === 401 || r.status === 403).map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`);
      ctx.check(`WR-C03: ${who.role} /assessments.html stays on the page`, landed === '/assessments.html', landed);
      ctx.check(`WR-C03: ${who.role} /assessments.html fires no /api/assessment-instances request`, inst.length === 0, inst.map((r) => r.status));
      ctx.check(`WR-C03: ${who.role} /assessments.html raises no 401/403 and no page error`, refused.length === 0 && page.pageErrors.length === 0,
        { refused, pageErrors: page.pageErrors });
      await page.close();
    }

    // ---------------- WR-C02: the employee helpdesk card is not offered (the
    // role may not file communications) and a forced submission never shows the
    // false "Inquiry Received" any more.
    {
      const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [users.emp.cookie] });
      const seen = trackResponses(page, ctx.base);
      await page.goto(ctx.base + '/employee.html', { waitUntil: 'load' });
      await ctx.sleep(2600);
      const sendFiredOnLoad = seen.filter((r) => r.url.indexOf('/api/communications') === 0);
      const card = await page.evaluate(() => {
        const c = document.getElementById('helpdesk-section');
        return { present: !!c, visible: !!c && c.getClientRects().length > 0 };
      });
      ctx.check('WR-C02: the employee page does not offer the helpdesk card (hidden by the access map)', card.present && card.visible === false, card);
      ctx.check('WR-C02: the employee page load issues no /api/communications request at all', sendFiredOnLoad.length === 0, sendFiredOnLoad.map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`));
      // Forced anyway (the form still exists in the DOM): the server refuses and
      // the page must say so instead of the old `.finally(success)`.
      const respP = page.waitForResponse((r) => r.url().indexOf('/api/communications/send') !== -1, { timeout: 8000 }).catch(() => null);
      const submitted = await page.evaluate(() => {
        const f = document.getElementById('hr-inquiry-form');
        const m = document.getElementById('hr-inquiry-msg');
        if (!f || !m) return false;
        m.value = 'p11 evidence probe (no real ticket)';
        if (typeof f.requestSubmit === 'function') f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true }));
        return true;
      });
      const resp = await respP;
      await ctx.sleep(800);
      const shown = await page.evaluate(() => {
        const s = document.getElementById('hr-form-success-message');
        return !!s && getComputedStyle(s).display !== 'none';
      });
      ctx.check('WR-C02: a forced ticket is refused by the server (403) and the success message is NOT shown',
        submitted && !!resp && resp.status() === 403 && shown === false, { formFound: submitted, status: resp ? resp.status() : null, successMessageShown: shown });
      await page.close();
    }
  },

  // PRD acceptance 3: an uncleared deal member gets 404 (never 403/409, nothing
  // of the record) on read/update/status-flip/delete of an hr-area task and RAID
  // entry; a cleared member and the IL are unaffected; conversions still work.
  async cleanRoom404(ctx) {
    const { users } = await fixtureFor(ctx);
    const MARK = 'P11-CLEANROOM-QX7';
    const title = `${MARK} restricted HR finding`;

    const hrbp = await neutralPage(ctx, users.hrbp.cookie);
    const created = await pageFetch(hrbp, 'POST', '/api/dd/findings', { area: 'hr', title, severity: 'high' });
    const finding = created.json && created.json.finding;
    ctx.check('hrbp files an hr-area DD finding (201)', created.status === 201 && !!finding && !!finding.id, created.status);
    // Phase 9: a by-id write names the version of the record it was based on.
    const fresh = await pageFetch(hrbp, 'GET', `/api/dd/findings/${finding.id}`);
    const fv = fresh.json && (fresh.json.finding ? fresh.json.finding.version : fresh.json.version);
    const conv = await pageFetch(hrbp, 'POST', `/api/dd/findings/${finding.id}/convert`, { toTask: true, toRaid: true, version: typeof fv === 'number' ? fv : 0 }); // a never-edited record is version 0
    const task = conv.json && conv.json.task;
    const raid = conv.json && conv.json.raid;
    ctx.check('hrbp converts the finding to a task and a RAID entry (200)', conv.status === 200 && !!task && !!raid,
      conv.status === 200 ? 200 : { status: conv.status, error: conv.json && conv.json.error });
    const taskId = task.id;
    const raidId = raid.id;
    const fresh2 = await pageFetch(hrbp, 'GET', `/api/dd/findings/${finding.id}`);
    const fv2 = fresh2.json && (fresh2.json.finding ? fresh2.json.finding.version : fresh2.json.version);
    const conv2 = await pageFetch(hrbp, 'POST', `/api/dd/findings/${finding.id}/convert`, { toTask: true, toRaid: true, version: typeof fv2 === 'number' ? fv2 : 0 });
    ctx.check('conversion is idempotent: the same task and RAID ids come back', conv2.status === 200
      && conv2.json.task && conv2.json.raid && conv2.json.task.id === taskId && conv2.json.raid.id === raidId, conv2.status);

    // ---- the uncleared member
    const pmo = await neutralPage(ctx, users.pmo.cookie);
    const NOT_FOUND = JSON.stringify({ error: 'Not found' });
    const missing = await pageFetch(pmo, 'DELETE', '/api/raid/raid_doesnotexistp11');
    ctx.check('control: deleting an id that does not exist answers 404 {"error":"Not found"}',
      missing.status === 404 && JSON.stringify(missing.json) === NOT_FOUND, { status: missing.status, body: missing.json });

    const leakFree = (r) => (r.text || '').indexOf(MARK) === -1 && (r.text || '').indexOf('"clearanceArea"') === -1
      && (r.text || '').indexOf('currentRecord') === -1;
    const rows = [
      ['POST task update (status flip)', 'POST', '/api/integration-tasks', { id: taskId, status: 'done' }],
      ['POST task update, stale version 999', 'POST', '/api/integration-tasks', { id: taskId, title: 'overwrite attempt', version: 999 }],
      ['POST task update, version 0 (a plausible never-edited guess)', 'POST', '/api/integration-tasks', { id: taskId, status: 'done', version: 0 }],
      ['DELETE task, no version precondition', 'DELETE', `/api/integration-tasks/${taskId}`],
      ['DELETE task, stale expectedVersion=999', 'DELETE', `/api/integration-tasks/${taskId}?expectedVersion=999`],
      ['POST RAID update (status flip)', 'POST', '/api/raid', { id: raidId, status: 'closed' }],
      ['POST RAID update, stale version 999', 'POST', '/api/raid', { id: raidId, notes: 'overwrite attempt', version: 999 }],
      ['POST RAID update, version 0 (a plausible never-edited guess)', 'POST', '/api/raid', { id: raidId, status: 'closed', version: 0 }],
      ['DELETE RAID, no version precondition', 'DELETE', `/api/raid/${raidId}`],
      ['DELETE RAID, stale expectedVersion=999', 'DELETE', `/api/raid/${raidId}?expectedVersion=999`],
    ];
    for (const [label, method, url, body] of rows) {
      const r = await pageFetch(pmo, method, url, body);
      ctx.check(`acceptance 3: uncleared pmo ${label} -> 404, body identical to a missing id, no field of the record`,
        r.status === 404 && JSON.stringify(r.json) === NOT_FOUND && leakFree(r), { status: r.status, body: r.json });
    }
    const pmoTasks = await pageFetch(pmo, 'GET', '/api/integration-tasks');
    const pmoRaid = await pageFetch(pmo, 'GET', '/api/raid');
    ctx.check('acceptance 3: uncleared pmo list reads hold neither record (200, marker absent)',
      pmoTasks.status === 200 && pmoRaid.status === 200 && (pmoTasks.text || '').indexOf(MARK) === -1 && (pmoRaid.text || '').indexOf(MARK) === -1,
      { tasks: pmoTasks.status, raid: pmoRaid.status });
    const pmoFinding = await pageFetch(pmo, 'GET', `/api/dd/findings/${finding.id}`);
    ctx.check('acceptance 3: the uncleared pmo cannot read the finding itself (403/404, marker absent)',
      (pmoFinding.status === 403 || pmoFinding.status === 404) && (pmoFinding.text || '').indexOf(MARK) === -1, pmoFinding.status);

    // ---- the cleared member, the IL and admin are unaffected
    const cleared = await neutralPage(ctx, users.cleared.cookie);
    const clTasks = await pageFetch(cleared, 'GET', '/api/integration-tasks');
    const clRaid = await pageFetch(cleared, 'GET', '/api/raid');
    ctx.check('cleared member (hr grant) reads both records',
      clTasks.status === 200 && clRaid.status === 200 && (clTasks.text || '').indexOf(MARK) !== -1 && (clRaid.text || '').indexOf(MARK) !== -1,
      { tasks: clTasks.status, raid: clRaid.status });
    const hrTasks = await pageFetch(hrbp, 'GET', '/api/integration-tasks');
    const hrRaid = await pageFetch(hrbp, 'GET', '/api/raid');
    ctx.check('the Integration Leader reads both records and they are unchanged after the uncleared attempts',
      hrTasks.status === 200 && hrRaid.status === 200
        && (JSON.parse(hrTasks.text).find((t) => t.id === taskId) || {}).status === 'todo'
        && (JSON.parse(hrRaid.text).find((r) => r.id === raidId) || {}).status === 'open',
      { tasks: hrTasks.status, raid: hrRaid.status });
    const admin = await neutralPage(ctx, users.admin.cookie);
    const adTasks = await pageFetch(admin, 'GET', '/api/integration-tasks');
    ctx.check('admin reads the converted task', adTasks.status === 200 && (adTasks.text || '').indexOf(MARK) !== -1, adTasks.status);

    // ---- the browser boards: the same data, two members, one sees it and one does not
    for (const [who, label, expectVisible] of [[users.cleared, 'cleared', true], [users.pmo, 'uncleared', false]]) {
      const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [who.cookie] });
      const seen = trackResponses(page, ctx.base);
      await page.goto(ctx.base + '/execution.html', { waitUntil: 'load' });
      await ctx.sleep(3200);
      const taskPane = await page.evaluate(() => (document.getElementById('ex-pane-tasks') || document.body).innerText);
      await page.evaluate(() => { const b = document.querySelector('.ex-tab[data-ex-tab="raid"]'); if (b) b.click(); });
      await ctx.sleep(600);
      const raidPane = await page.evaluate(() => (document.getElementById('ex-pane-raid') || document.body).innerText);
      const hasTask = taskPane.indexOf(MARK) !== -1;
      const hasRaid = raidPane.indexOf(MARK) !== -1;
      ctx.check(`execution board (${label} member): converted task ${expectVisible ? 'is shown' : 'is not shown'}`, hasTask === expectVisible, { hasTask });
      ctx.check(`execution board (${label} member): converted RAID entry ${expectVisible ? 'is shown' : 'is not shown'}`, hasRaid === expectVisible, { hasRaid });
      const refused = seen.filter((r) => r.status === 401 || r.status === 403);
      ctx.check(`execution board (${label} member): no 401/403 raised by the page load`, refused.length === 0, refused.map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`));
      ctx.check(`execution board (${label} member): no page error`, page.pageErrors.length === 0, page.pageErrors);
      await snap(ctx, page, `p11-cleanroom-board-${label}-1440`);
    }

    // ---- WR-02 (review): nobody can PLANT a reserved provenance `source`.
    // Before the fix an uncleared member could create a task / RAID entry whose
    // `source` named the hr finding; the IL's conversion then adopted the planted
    // record as the finding's task. The four reserved prefixes are now refused on
    // create AND update for every role (only the convert / instantiate routes mint
    // them), and the conversion only adopts a record carrying the server stamp.
    {
      // A SECOND, not-yet-converted finding: the hijack needs the planting to
      // happen BEFORE the IL converts (a converted finding already dedupes on its
      // genuine task).
      const created2 = await pageFetch(hrbp, 'POST', '/api/dd/findings', { area: 'hr', title: `${MARK} second restricted HR finding (conversion-adoption probe)`, severity: 'high' });
      const finding2 = created2.json && created2.json.finding;
      ctx.check('WR-02 fixture: hrbp files a second hr-area DD finding (201), not yet converted', created2.status === 201 && !!finding2 && !!finding2.id, created2.status);
      const planted = [
        ['task', '/api/integration-tasks', { title: 'P11-PLANTED task', source: `dd-finding:${finding2.id}` }],
        ['task (upper-case prefix)', '/api/integration-tasks', { title: 'P11-PLANTED task upper', source: `DD-FINDING:${finding2.id}` }],
        ['task (template:)', '/api/integration-tasks', { title: 'P11-PLANTED task template', source: 'template:p11' }],
        ['task (remediation:)', '/api/integration-tasks', { title: 'P11-PLANTED task remediation', source: 'remediation:p11' }],
        ['RAID entry', '/api/raid', { title: 'P11-PLANTED raid', type: 'risk', severity: 'high', source: 'org-flightrisk:p11-planted' }],
        ['RAID entry (dd-finding:)', '/api/raid', { title: 'P11-PLANTED raid dd', type: 'risk', severity: 'high', source: `dd-finding:${finding2.id}` }],
      ];
      for (const [who, label] of [[users.pmo, 'uncleared pmo'], [users.hrbp, 'hrbp'], [users.admin, 'admin']]) {
        const page = await neutralPage(ctx, who.cookie);
        const codes = [];
        for (const [what, url, body] of planted) {
          const r = await pageFetch(page, 'POST', url, body);
          codes.push(r.status);
          if (r.status !== 400) ctx.fail(`WR-02: ${label} POST ${what} with a reserved source -> 400`, { status: r.status });
        }
        ctx.check(`WR-02: ${label} creating ${planted.length} task / RAID records with a reserved \`source\` is refused 400 on every one`,
          codes.every((c) => c === 400), codes);
      }
      const control = await pageFetch(await neutralPage(ctx, users.pmo.cookie), 'POST', '/api/integration-tasks', { title: 'P11 control task (free-text source)', source: 'manual' });
      ctx.check('WR-02 control: a free-text source ("manual") is still accepted (201), so the 400s are the reserved prefixes only', control.status === 201, control.status);

      // IN-01 (review): a restricted task id linked to an initiative is not echoed
      // to a caller who cannot see the task.
      const syn = await pageFetch(hrbp, 'POST', '/api/synergies', { title: 'P11 synergy link probe', taskIds: [taskId] });
      ctx.check('IN-01 fixture: hrbp links the restricted converted task to an initiative (201/200)', syn.status === 201 || syn.status === 200, syn.status);
      const synHr = await pageFetch(hrbp, 'GET', '/api/synergies');
      const synPmo = await pageFetch(await neutralPage(ctx, users.pmo.cookie), 'GET', '/api/synergies');
      const synCl = await pageFetch(await neutralPage(ctx, users.cleared.cookie), 'GET', '/api/synergies');
      ctx.check('IN-01: the Integration Leader and the cleared member read the link (task id present)',
        synHr.status === 200 && synCl.status === 200 && (synHr.text || '').indexOf(taskId) !== -1 && (synCl.text || '').indexOf(taskId) !== -1, { hrbp: synHr.status, cleared: synCl.status });
      ctx.check('IN-01: the uncleared pmo reads the initiative list without the restricted task id',
        synPmo.status === 200 && (synPmo.text || '').indexOf(taskId) === -1 && (synPmo.text || '').indexOf('P11 synergy link probe') !== -1, { status: synPmo.status });

      // nothing was planted, and the conversion mints the GENUINE task / RAID entry
      const hrTasks2 = await pageFetch(hrbp, 'GET', '/api/integration-tasks');
      const hrRaid2 = await pageFetch(hrbp, 'GET', '/api/raid');
      ctx.check('WR-02: no planted record exists for the Integration Leader (task and RAID lists)',
        hrTasks2.status === 200 && hrRaid2.status === 200
          && (hrTasks2.text || '').indexOf('P11-PLANTED') === -1 && (hrRaid2.text || '').indexOf('P11-PLANTED') === -1,
        { tasks: hrTasks2.status, raid: hrRaid2.status });
      const fresh3 = await pageFetch(hrbp, 'GET', `/api/dd/findings/${finding2.id}`);
      const fv3 = fresh3.json && (fresh3.json.finding ? fresh3.json.finding.version : fresh3.json.version);
      const conv3 = await pageFetch(hrbp, 'POST', `/api/dd/findings/${finding2.id}/convert`, { toTask: true, toRaid: true, version: typeof fv3 === 'number' ? fv3 : 0 });
      const t3 = conv3.json && conv3.json.task;
      const r3 = conv3.json && conv3.json.raid;
      ctx.check('WR-02: converting the second finding mints its GENUINE task and RAID entry (derived from the finding, never a planted record)',
        conv3.status === 200 && !!t3 && !!r3 && String(t3.title || '').indexOf(MARK) !== -1 && String(t3.title || '').indexOf('P11-PLANTED') === -1
          && String(r3.title || '').indexOf('P11-PLANTED') === -1,
        { status: conv3.status, taskTitle: t3 ? String(t3.title).slice(0, 60) : null });
      const cl3 = await pageFetch(await neutralPage(ctx, users.cleared.cookie), 'GET', '/api/integration-tasks');
      ctx.check('WR-02: the cleared member sees the genuine converted task and no planted record',
        cl3.status === 200 && (cl3.text || '').indexOf('second restricted HR finding') !== -1 && (cl3.text || '').indexOf('P11-PLANTED') === -1, cl3.status);
    }
  },

  // PRD acceptance 6 / D-11-05: denials produce rate-bounded audit rows. A FRESH
  // account and a FRESH route are used (amendment 6) so no other scenario has
  // touched this actor+route+reason key.
  async denialAuditBounded(ctx) {
    const { users } = await fixtureFor(ctx);
    const probe = users.probe;
    const ROUTE = 'GET /api/communications';
    const page = await neutralPage(ctx, probe.cookie);

    const PROBES = 20;
    const bodies = new Set();
    let refusedCount = 0;
    for (let i = 0; i < PROBES; i++) {
      const r = await pageFetch(page, 'GET', '/api/communications');
      if (r.status === 403) refusedCount += 1;
      bodies.add(r.text);
    }
    ctx.check(`acceptance 6: ${PROBES} repeated refused reads all answer 403 with one identical body`, refusedCount === PROBES && bodies.size === 1, { refusedCount, distinctBodies: bodies.size });

    const readRows = async () => {
      const r = await ctx.api(users.admin.cookie, 'GET', `/api/admin/audit?user=${encodeURIComponent(probe.username)}&limit=500`);
      const rows = Array.isArray(r.json) ? r.json : [];
      return rows.filter((x) => x.action === 'access-denied' && x.row_id === ROUTE)
        .map((x) => Object.assign({}, x, { detail: (() => { try { return JSON.parse(x.after_json); } catch (e) { return {}; } })() }))
        .sort((a, b) => a.id - b.id);
    };

    const first = await readRows();
    ctx.check(`acceptance 6: ${PROBES} denials of one actor+route+reason wrote exactly ONE audit row in the window`,
      first.length === 1 && first[0].detail.count === 1 && first[0].detail.reason === 'role-read', first.map((r) => ({ id: r.id, count: r.detail.count, reason: r.detail.reason })));
    ctx.check('the row names the actor, the route template and the method (no body, no password)',
      first.length === 1 && first[0].actor_username === probe.username && first[0].request_method === 'GET'
        && String(first[0].request_path || '').indexOf('/api/communications') === 0, first.length ? { actor: first[0].actor_username, method: first[0].request_method } : null);

    // ---- WR-01 (review): the clean-room clearance denials on the DD and org
    // by-id routes are bounded by the same window. Before the fix every probe
    // appended one permanent `dd-access-denied` / `org-*-access-denied` row (25
    // probes -> 25 rows). The actor is the UNCLEARED workstream lead (the probe
    // account is an employee and is refused at the gate before the clearance
    // layer); ids are random per run so no earlier scenario shares the key.
    const CLEARANCE = [
      { action: 'dd-access-denied', reason: 'dd-clearance', label: 'GET /api/dd/findings/:id (random ids)', url: (i, tag) => `/api/dd/findings/p11probe-${tag}-${i}` },
      { action: 'org-decisions-access-denied', reason: 'org-clearance', label: 'GET /api/org/decisions?positionId=<random>', url: (i, tag) => `/api/org/decisions?positionId=p11probe-${tag}-${i}` },
      { action: 'org-flightrisk-access-denied', reason: 'org-clearance', label: 'GET /api/org/flight-risk', url: () => '/api/org/flight-risk' },
    ];
    const pmo = users.pmo;
    const pmoPage = await neutralPage(ctx, pmo.cookie);
    const CLEAR_PROBES = 25;
    const tag = crypto.randomBytes(5).toString('hex');
    const readClearanceRows = async (action) => {
      const r = await ctx.api(users.admin.cookie, 'GET', `/api/admin/audit?user=${encodeURIComponent(pmo.username)}&limit=500`);
      const rows = Array.isArray(r.json) ? r.json : [];
      return rows.filter((x) => x.action === action && (x.row_id === null || x.row_id === undefined))
        .map((x) => Object.assign({}, x, { detail: (() => { try { return x.after_json ? JSON.parse(x.after_json) : null; } catch (e) { return null; } })() }))
        .sort((p1, p2) => p1.id - p2.id);
    };
    const baseline = {};
    for (const c of CLEARANCE) baseline[c.action] = (await readClearanceRows(c.action)).length;
    for (const c of CLEARANCE) {
      const statuses = new Set();
      const bodies = new Set();
      for (let i = 0; i < CLEAR_PROBES; i++) {
        const r = await pageFetch(pmoPage, 'GET', c.url(i, tag));
        statuses.add(r.status);
        bodies.add(r.text);
      }
      ctx.check(`WR-01: ${CLEAR_PROBES} uncleared-pmo probes of ${c.label} are all refused (one status, one body)`,
        statuses.size === 1 && (statuses.has(403) || statuses.has(404)) && bodies.size === 1, { statuses: Array.from(statuses), distinctBodies: bodies.size });
      const now = await readClearanceRows(c.action);
      const added = now.length - baseline[c.action];
      ctx.check(`WR-01: ${CLEAR_PROBES} probes of ${c.label} wrote exactly ONE ${c.action} row inside the window (was ${CLEAR_PROBES} before the fix)`,
        added === 1, { rowsBefore: baseline[c.action], rowsAfter: now.length });
    }

    // The window is 60 s. After it expires any later denial flushes the folded
    // count as the key's next row: the total must equal the probe count.
    await ctx.sleep(62000);
    const trigger = await pageFetch(page, 'GET', '/api/raid'); // a different route: only triggers the sweep
    ctx.check('a later denial (different route) is still refused 403', trigger.status === 403, trigger.status);
    const after = await readRows();
    const total = after.reduce((n, r) => n + (r.detail.count || 0), 0);
    ctx.check('acceptance 6: after the window the folded denials are written as at most one more row (<= 1 row per 60 s)',
      after.length >= 1 && after.length <= 2, after.map((r) => ({ id: r.id, count: r.detail.count, folded: r.detail.folded })));
    ctx.check(`acceptance 6: the rows account for every probe (total count == ${PROBES})`, total === PROBES, { total });
    if (after.length === 2) {
      const gap = Date.parse(after[1].ts) - Date.parse(after[0].ts);
      ctx.check('the two rows are at least one window (60 s, with clock tolerance) apart', gap >= 59000, { gapMs: gap });
    }

    // WR-01 after the window: the folded count of each clearance key is written as
    // its next row, so first row (1) + folded row (24) == the 25 probes, never a
    // row per probe.
    for (const c of CLEARANCE) {
      const now = await readClearanceRows(c.action);
      const fresh = now.slice(baseline[c.action]);
      const folded = fresh.filter((r) => r.detail && r.detail.folded === true);
      const firsts = fresh.filter((r) => !(r.detail && r.detail.folded === true));
      const total = firsts.length + folded.reduce((n, r) => n + (r.detail.count || 0), 0);
      ctx.check(`WR-01: after the window ${c.label} holds one first row + one folded row and the counts add up to ${CLEAR_PROBES}`,
        fresh.length === 2 && firsts.length === 1 && folded.length === 1 && total === CLEAR_PROBES && folded[0].detail.reason === c.reason,
        { rows: fresh.length, total, folded: folded.map((r) => ({ count: r.detail.count, reason: r.detail.reason })) });
    }
  },

  // The showcase must render as before (ROADMAP SC4, D-11-01 demo-lenient):
  // no 401/403 raised by any page load, settings-driven content present, no
  // page error. Runs as the published demo accounts in the dev lane and
  // anonymously in demo-open.
  async demoShowcaseUnchanged(ctx) {
    const demoPw = publishedDemoPassword();
    const pages = ['/dashboard.html', '/employee.html', '/pmo.html', '/execution.html', '/admin.html', '/overview.html'];
    const desktop = ctx.viewports.desktop.width;
    const phone = ctx.viewports.phone.width;

    const actors = [];
    if (ctx.lane === 'dev') {
      for (const username of ['admin', 'karen', 'pmo']) {
        const lg = await ctx.loginFull(username, demoPw);
        ctx.check(`dev: published demo account ${username} signs in without a forced rotation`, lg.mustChangePassword === false, { mustChangePassword: lg.mustChangePassword });
        actors.push({ label: username, cookie: lg.cookie });
      }
    } else {
      actors.push({ label: 'anon', cookie: null });
    }

    for (const actor of actors) {
      // Settings-driven content: what the page's own session reads from /api/settings.
      const probe = await neutralPage(ctx, actor.cookie);
      const settings = await pageFetch(probe, 'GET', '/api/settings');
      const S = settings.json || {};
      ctx.check(`${actor.label}: GET /api/settings answers 200 with the showcase profile (targetCompany, welcome-video keys, roleVisibility)`,
        settings.status === 200 && typeof S.targetCompany === 'string' && S.targetCompany.length > 0
          && Object.prototype.hasOwnProperty.call(S, 'welcomeVideoUrl') && typeof S.roleVisibility === 'object',
        { status: settings.status, keys: Object.keys(S).length });
      const leaked = Object.keys(S).filter((k) => SECRETISH.test(k) && k !== 'hasGeminiApiKey');
      if (actor.label !== 'admin') ctx.check(`${actor.label}: the settings payload carries no secret-ish key`, leaked.length === 0, leaked);
      const target = String(S.targetCompany || '');
      if (ctx.lane === 'dev') {
        // IN-C04 (documented decision D-11-02): on the logged-in demo store the
        // config controls follow the write table (admin only); the Day pill
        // (time machine) stays for the staff roles that may POST it.
        const me = await pageFetch(probe, 'GET', '/api/auth/me');
        const acc = (me.json && me.json.access) || {};
        const wantConfig = actor.label === 'admin';
        ctx.check(`${actor.label}: /api/auth/me access map on the demo store: configWrite ${wantConfig}, timeTravel true, every read key true (the showcase reads stay open)`,
          me.status === 200 && acc.configWrite === wantConfig && acc.timeTravel === true
            && Object.keys(acc).filter((k) => k !== 'configWrite' && k !== 'helpdesk' && k !== 'timeTravel').every((k) => acc[k] === true),
          { status: me.status, configWrite: acc.configWrite, timeTravel: acc.timeTravel });
      }

      for (const p of pages) {
        const primary = (actor.label === 'admin' || actor.label === 'anon');
        const widths = primary ? [desktop, phone] : [desktop];
        const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: actor.cookie ? [actor.cookie] : [] });
        const seen = trackResponses(page, ctx.base);
        let i = 0;
        for (const width of widths) {
          if (width === phone) await page.setViewportSize({ width: ctx.viewports.phone.width, height: ctx.viewports.phone.height });
          const from = seen.length;
          if (i === 0) await page.goto(ctx.base + p, { waitUntil: 'load' });
          else await page.reload({ waitUntil: 'load' });
          i += 1;
          await ctx.sleep(2600);
          const landed = new URL(page.url()).pathname;
          const rows = seen.slice(from);
          const label = `${ctx.lane} ${actor.label} ${p} @${width}`;
          // demo-open: the admin console is not reachable cookie-less (Phase 10
          // contract) - it lands on /login.html. The 401 on GET /api/deals IS that
          // redirect mechanism (identical on the pre-Phase-11 tree, measured), so
          // for this one page only a 403 counts as a refusal raised by the load.
          const expectLogin = ctx.lane === 'demo-open' && p === '/admin.html';
          // WR-C01 (review fix): a LOGGED-IN demo-store session is held to its
          // server-verified role by the page gate (the role is no longer derived
          // from the path): the Integration Leader (karen / hrbp) is sent home from
          // the employee and PMO personas, the workstream lead (pmo) from the admin
          // console. The open showcase (demo-open) has no role and is unchanged.
          const sentHome = ctx.lane === 'dev' && (SENT_HOME[actor.label] || []).indexOf(p) !== -1;
          const refused = rows.filter((r) => (expectLogin ? r.status === 403 : (r.status === 401 || r.status === 403)));
          const errored = rows.filter((r) => r.status >= 500);
          if (expectLogin) {
            ctx.check(`${label}: cookie-less admin console lands on /login.html (Phase 10 contract, unchanged)`, landed === '/login.html', landed);
          } else if (sentHome) {
            ctx.check(`${label}: the verified role is not allowed on this page and is sent home (/) (WR-C01, intended)`, landed === '/', landed);
          } else {
            ctx.check(`${label}: stays on the page`, landed === p, landed);
          }
          ctx.check(`${label}: no 401/403 raised by the page load`, refused.length === 0, refused.map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`));
          ctx.check(`${label}: no 5xx during the page load`, errored.length === 0, errored.map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`));
          ctx.check(`${label}: no page error`, page.pageErrors.length === 0, page.pageErrors);
          if (width === desktop && landed === p) {
            const state = await page.evaluate((t) => {
              const text = document.body ? document.body.innerText : '';
              const html = document.documentElement.outerHTML;
              return {
                hasTarget: text.indexOf(t) !== -1 || html.indexOf(t) !== -1,
                welcome: !!document.getElementById('welcome-video-player-container') || !!document.getElementById('welcome-video-placeholder-bg'),
                bodyLen: text.length,
                dayPill: !!document.getElementById('time-machine-trigger') && document.getElementById('time-machine-trigger').getClientRects().length > 0,
              };
            }, target);
            if (p === '/employee.html') {
              ctx.check(`${label}: the welcome-video section is rendered`, state.welcome, state);
            }
            ctx.check(`${label}: page has content (not blank)`, state.bodyLen > 200, { bodyLen: state.bodyLen });
            if (p === '/dashboard.html') {
              // IN-C01: the showcase keeps its Day pill (time machine) for every
              // staff session on the demo store and for the open showcase.
              ctx.check(`${label}: the Day pill (time machine) is still offered in the showcase`, state.dayPill === true, { dayPill: state.dayPill });
            }
            if (p === '/dashboard.html' || p === '/employee.html') {
              ctx.check(`${label}: settings-driven target company name "${target.slice(0, 40)}" is present in the page`, state.hasTarget, { hasTarget: state.hasTarget });
            }
          }
          // Shot policy (1200 KB evidence cap): dev/admin = the persona pages at
          // 1440 (+ the dashboard at 390) and the admin console; dev/karen and
          // dev/pmo = the one page each can open (IN-C04); demo-open = the dashboard
          // at both widths and the admin-console landing at 1440. Every page is
          // CHECKED at every width whether or not it is shot.
          const stem = p.replace(/^\//, '').replace(/\.html$/, '');
          const persona = p === '/dashboard.html' || p === '/employee.html' || p === '/pmo.html';
          let wantShot = false;
          if (ctx.lane === 'dev' && actor.label === 'admin') {
            // (the evidence directory is capped: the three persona pages at 1440,
            // the dashboard also at 390, and the admin console at 1440)
            wantShot = (persona && width === desktop) || (p === '/dashboard.html' && width === phone) || (width === desktop && p === '/admin.html');
          } else if (ctx.lane === 'dev' && width === desktop && landed === p
            && ((actor.label === 'karen' && p === '/dashboard.html') || (actor.label === 'pmo' && p === '/pmo.html'))) {
            // the logged-in showcase for the non-admin demo accounts (IN-C04): the
            // pages they CAN open, config controls hidden.
            wantShot = true;
          } else if (ctx.lane === 'demo-open') {
            // anonymous: the dashboard at both widths and the cookie-less admin
            // console's (login) landing at 1440.
            wantShot = (p === '/dashboard.html') || (p === '/admin.html' && width === desktop);
          }
          if (wantShot) await snap(ctx, page, `p11-${ctx.lane}-${actor.label}-${stem}-${width}`);
        }
      }
    }
  },
};
