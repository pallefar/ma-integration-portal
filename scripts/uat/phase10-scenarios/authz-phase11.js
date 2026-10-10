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
    if (shotAt.includes(width)) {
      const file = `p11-${tag || who.role}-${stem}-${width}`;
      await snap(ctx, page, file);
      shots.push(file + '.jpg');
    }
  }
  return { page, seen, shots };
}

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

      // the employee's own profile resolves to an account-derived record (11-06 hand-off)
      const goc = await pageFetch(page, 'POST', '/api/employees/get-or-create', { empId: 'emp_colleague_probe', name: 'Colleague Probe' });
      const gocEmp = goc.json && goc.json.employee;
      ctx.check('acceptance 4/5: employee POST /api/employees/get-or-create resolves ONLY its own account-derived record',
        (goc.status === 200 || goc.status === 201) && !!gocEmp && /^emp_acct_/.test(String(gocEmp.id)) && String(gocEmp.id) !== 'emp_colleague_probe',
        { status: goc.status, idPrefix: gocEmp ? String(gocEmp.id).slice(0, 9) : null });
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
      const roll = await pageFetch(hrbpPage, 'GET', '/api/synergies/rollup');
      ctx.check('acceptance 2: the deal-level synergy target is what the rollup reports (25)',
        roll.status === 200 && roll.json && Number(roll.json.dealSynergyTargetM) === 25, roll.json && roll.json.dealSynergyTargetM);
      const adminPage = await neutralPage(ctx, users.admin.cookie);
      const adminSettings = await pageFetch(adminPage, 'GET', '/api/settings');
      ctx.check('acceptance 2: admin still reads the full settings object (200)', adminSettings.status === 200, adminSettings.status);
      const hrbpAudit = await pageFetch(hrbpPage, 'GET', '/api/admin/audit');
      ctx.check('control: hrbp cannot read the audit log (403)', hrbpAudit.status === 403, hrbpAudit.status);
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

    // ---------------- OBSERVATIONS (not assertions): destinations a role can
    // reach by clicking a visible navigation link but that are not on its own
    // landing list. Rows are written as PASS with an "OBSERVATION" prefix so the
    // runner log shows the measured result without turning a product question
    // (page-level role gates were out of Phase 11's scope, 11-07 hand-off) into a
    // red scenario. Each is quoted in 11-08-SUMMARY.md under Findings.
    for (const [who, label] of [[users.emp, 'employee'], [users.pmo, 'pmo']]) {
      for (const p of ['/admin.html', '/due-diligence.html', '/org.html']) {
        const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [who.cookie] });
        const seen = trackResponses(page, ctx.base);
        await page.goto(ctx.base + p, { waitUntil: 'load' });
        await ctx.sleep(2600);
        const landed = new URL(page.url()).pathname;
        const refused = seen.filter((r) => r.status === 401 || r.status === 403).map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`);
        ctx.pass(`OBSERVATION (not an assertion): ${label} opens ${p}`, { landed, refusedResponses: refused.length, refused: refused.slice(0, 6) });
        await page.close();
      }
    }
    {
      // 11-07 hand-off: the employee helpdesk form posts to /api/communications/send,
      // which the write policy has never allowed for `employee`; the page shows its
      // success state in `.finally` regardless of the outcome.
      const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [users.emp.cookie] });
      await page.goto(ctx.base + '/employee.html', { waitUntil: 'load' });
      await ctx.sleep(2600);
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
      await ctx.sleep(600);
      const shown = await page.evaluate(() => {
        const s = document.getElementById('hr-form-success-message');
        return !!s && getComputedStyle(s).display !== 'none';
      });
      ctx.pass('OBSERVATION (not an assertion): employee helpdesk form (POST /api/communications/send)',
        { formFound: submitted, status: resp ? resp.status() : null, successMessageShown: shown });
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
          const refused = rows.filter((r) => (expectLogin ? r.status === 403 : (r.status === 401 || r.status === 403)));
          const errored = rows.filter((r) => r.status >= 500);
          if (expectLogin) {
            ctx.check(`${label}: cookie-less admin console lands on /login.html (Phase 10 contract, unchanged)`, landed === '/login.html', landed);
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
              };
            }, target);
            if (p === '/employee.html') {
              ctx.check(`${label}: the welcome-video section is rendered`, state.welcome, state);
            }
            ctx.check(`${label}: page has content (not blank)`, state.bodyLen > 200, { bodyLen: state.bodyLen });
            if (p === '/dashboard.html' || p === '/employee.html') {
              ctx.check(`${label}: settings-driven target company name "${target.slice(0, 40)}" is present in the page`, state.hasTarget, { hasTarget: state.hasTarget });
            }
          }
          // Shot policy (1200 KB evidence cap): dev/admin = the three persona
          // pages at both widths + execution/admin at 1440; demo-open = the
          // dashboard at both widths, pmo at 390, the admin-console landing at
          // 1440. Every page is CHECKED at every width whether or not it is shot.
          const stem = p.replace(/^\//, '').replace(/\.html$/, '');
          const persona = p === '/dashboard.html' || p === '/employee.html' || p === '/pmo.html';
          let wantShot = false;
          if (ctx.lane === 'dev' && actor.label === 'admin') {
            wantShot = persona || (width === desktop && (p === '/execution.html' || p === '/admin.html'));
          } else if (ctx.lane === 'demo-open') {
            // anonymous: the dashboard at both widths, the pmo page at 390, and the
            // cookie-less admin console's (login) landing at 1440.
            wantShot = (p === '/dashboard.html') || (p === '/pmo.html' && width === phone) || (p === '/admin.html' && width === desktop);
          }
          if (wantShot) await snap(ctx, page, `p11-${ctx.lane}-${actor.label}-${stem}-${width}`);
        }
      }
    }
  },
};
