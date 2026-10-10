// Phase 10 plan 10-09 Task 1: PRD acceptance 1 and 3, plus the committed-control
// account-write refusal, shown in a real browser (D-10-01, D-10-02, D-10-08).
// Loaded by scripts/uat/phase10-walk.js. Sorted first among the scenario
// modules, so realEmptyDirBootstrap sees the lane before any other scenario
// has created an account.
//
// T-10-52: no password is ever typed before a screenshot, no screenshot shows a
// credential, and log lines carry statuses and names only.

'use strict';

const fs = require('fs');
const path = require('path');

// The published demo password is read from the shipped login.js constant, never
// hard-coded here (D-10-08c: that file is its single client-side home).
function publishedDemoPassword() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'js', 'login.js'), 'utf8');
  const m = /var\s+DEMO_PASSWORD\s*=\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('could not read DEMO_PASSWORD from public/js/login.js');
  return m[1];
}

async function waitForPath(page, re, ms) {
  const pathOf = () => new URL(page.url()).pathname;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (re.test(pathOf())) return pathOf();
    await new Promise((r) => setTimeout(r, 150));
  }
  return pathOf();
}

// Records every same-origin response status for the life of the page.
function trackResponses(page, base) {
  const seen = [];
  page.on('response', (r) => {
    const u = r.url();
    if (u.indexOf(base) === 0) seen.push({ url: u.slice(base.length), status: r.status() });
  });
  return seen;
}

async function visibleChangePassword(page) {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-am="change-password"]'));
    const vis = els.find((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    if (!vis) return null;
    const wrap = vis.parentElement;
    const note = wrap ? wrap.querySelector('.am-note') : null;
    return {
      disabled: vis.disabled === true,
      ariaDisabled: vis.getAttribute('aria-disabled'),
      note: note ? note.textContent : null,
    };
  });
}

// Opens the header profile dropdown when its trigger is visible (1440 and 390).
async function openProfileMenu(page) {
  await page.waitForSelector('#profile-dropdown-card [data-am="change-password"]', { state: 'attached', timeout: 15000 });
  const trigger = await page.$('#profile-menu-trigger');
  if (trigger && (await trigger.isVisible())) await trigger.click();
}

async function fits(page) {
  return page.evaluate(() => ({
    ok: document.documentElement.scrollWidth <= window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

module.exports = {
  __lanes: {
    realEmptyDirBootstrap: ['real'],
    handCopiedControlDbLockdown: ['real-handcopied'],
    committedControlAccountWritesHidden: ['dev-committed', 'demo-committed'],
  },

  // PRD acceptance 1: real mode on an empty data dir boots with zero users,
  // says so, shows no demo credentials, and bootstrap-admin creates the admin.
  async realEmptyDirBootstrap(ctx) {
    const demoPw = publishedDemoPassword();
    const mode = await ctx.api(null, 'GET', '/api/auth/mode');
    ctx.check('GET /api/auth/mode says mode real, demoOpen false, accountsWritable true',
      !!mode.json && mode.json.mode === 'real' && mode.json.demoOpen === false && mode.json.accountsWritable === true, mode.json);
    ctx.check('the seeded control.db had 0 users before bootstrap-admin ran', ctx.preBootstrapUserCount === 0, ctx.preBootstrapUserCount);
    const repoData = path.join(__dirname, '..', '..', '..', 'data') + path.sep;
    ctx.check('the lane data dir is a temp dir, not the committed data/', ctx.dataDir.indexOf(repoData) !== 0, path.basename(ctx.dataDir));

    // Login page: no demo panel, no password anywhere in the DOM (1440 and 390).
    for (const [label, vp] of [['1440', ctx.viewports.desktop], ['390', ctx.viewports.phone]]) {
      const page = await ctx.newPage({ width: vp.width, height: vp.height });
      await page.goto(ctx.base + '/login.html', { waitUntil: 'load' });
      await ctx.sleep(1200);
      const s = await page.evaluate((pw) => ({
        slotChildren: (document.getElementById('lg-demo-slot') || { children: [] }).children.length,
        text: document.body.innerText,
        domHasPassword: document.documentElement.outerHTML.indexOf(pw) !== -1,
        form: !!document.getElementById('lg-user') && !!document.getElementById('lg-pass'),
      }), demoPw);
      ctx.check(`${label}px: no demo panel, no "Demo accounts", no password in the DOM`,
        s.slotChildren === 0 && s.text.indexOf('Demo accounts') === -1 && !s.domHasPassword, { slotChildren: s.slotChildren });
      ctx.check(`${label}px: the sign-in form is present`, s.form);
      await ctx.shot(page, 'acceptance1-login-real-' + label);
    }

    // bootstrap-admin created the admin (forced rotation done once by the runner).
    const adminCookie = await ctx.adminLogin();
    ctx.pass('bootstrap admin signed in and completed the forced rotation');
    const list = await ctx.api(adminCookie, 'GET', '/api/admin/users');
    const users = list.json && Array.isArray(list.json.users) ? list.json.users : (Array.isArray(list.json) ? list.json : null);
    ctx.check('GET /api/admin/users returns exactly one account, admin',
      list.status === 200 && !!users && users.length === 1 && users[0].username === 'admin', { status: list.status, count: users && users.length });
    const keys = users && users[0] ? Object.keys(users[0]) : [];
    ctx.check('the account listing carries no hash / salt / password field',
      keys.length > 0 && !keys.some((k) => /hash|salt|password/i.test(k) && k !== 'mustChangePassword'), keys);

    // Browser sign-in with the rotated password lands inside the app.
    const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height });
    await page.goto(ctx.base + '/login.html', { waitUntil: 'load' });
    await page.fill('#lg-user', 'admin');
    await page.fill('#lg-pass', ctx.adminPasswordNow());
    await page.click('#login-form button[type="submit"]');
    const landed = await waitForPath(page, /^\/(?!login\.html)/, 10000);
    ctx.check('browser sign-in as the bootstrap admin leaves the login page', landed !== '/login.html', landed);
    ctx.check('no page error', page.pageErrors.length === 0, page.pageErrors);
  },

  // PRD acceptance 3: a real-mode host started on a hand-copied committed
  // control.db serves only login / auth / healthz.
  async handCopiedControlDbLockdown(ctx) {
    const demoPw = publishedDemoPassword();
    const health = await fetch(ctx.base + '/healthz');
    ctx.check('GET /healthz answers 200', health.status === 200, health.status);

    const data = await ctx.api(null, 'GET', '/api/settings');
    ctx.check('a data API route answers 403 credentialLockdown:true',
      data.status === 403 && !!data.json && data.json.credentialLockdown === true, { status: data.status });

    // The lockdown page, at both widths.
    for (const [label, vp] of [['1440', ctx.viewports.desktop], ['390', ctx.viewports.phone]]) {
      const page = await ctx.newPage({ width: vp.width, height: vp.height });
      const res = await page.goto(ctx.base + '/index.html', { waitUntil: 'load' });
      const text = await page.evaluate(() => document.body.innerText);
      ctx.check(`${label}px: /index.html shows the lockdown page (403)`,
        res.status() === 403 && /This server is locked/.test(text), { status: res.status() });
      const f = await fits(page);
      ctx.check(`${label}px: lockdown page has no horizontal overflow`, f.ok, f);
      await ctx.shot(page, 'acceptance3-lockdown-' + label);
    }

    // Login page + change-password page load with every same-origin request
    // admitted (presence-based proof that the allowlist covers what they load).
    const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height });
    const seen = trackResponses(page, ctx.base);
    const loginRes = await page.goto(ctx.base + '/login.html', { waitUntil: 'load' });
    await ctx.sleep(1200);
    ctx.check('/login.html renders (200) under lockdown', loginRes.status() === 200, loginRes.status());
    const formOk = await page.evaluate(() => !!document.getElementById('lg-user') && !!document.getElementById('lg-pass'));
    ctx.check('/login.html shows the sign-in form', formOk);
    await ctx.shot(page, 'acceptance3-login-under-lockdown-1440');

    // Sign in as karen with the published demo password: forced to change it.
    await page.fill('#lg-user', 'karen');
    await page.fill('#lg-pass', demoPw);
    await page.click('#login-form button[type="submit"]');
    const landed = await waitForPath(page, /change-password\.html$/, 10000);
    ctx.check('signing in as karen with the published password lands on /change-password.html', landed === '/change-password.html', landed);
    await ctx.sleep(1200);
    const cpForm = await page.evaluate(() => !!document.getElementById('cp-new'));
    ctx.check('/change-password.html renders its form under lockdown', cpForm);
    await ctx.shot(page, 'acceptance3-change-password-under-lockdown-1440');

    const bad = seen.filter((r) => r.status >= 400);
    ctx.check('no same-origin response was refused (>= 400) while loading login + change-password',
      seen.length > 0 && bad.length === 0, bad.length ? bad : seen.length + ' responses');
    ctx.check('no page error', page.pageErrors.length === 0, page.pageErrors);
  },

  // D-10-01: with the committed control.db active, no account write control
  // is rendered that could only fail, and the server refuses the write.
  async committedControlAccountWritesHidden(ctx) {
    const demoPw = publishedDemoPassword();
    const mode = await ctx.api(null, 'GET', '/api/auth/mode');
    ctx.check('GET /api/auth/mode: accountsWritable is false', !!mode.json && mode.json.accountsWritable === false, mode.json);

    // demo-open (DEMO_OPEN=1): the server treats every request as the open
    // demo and ignores a session cookie (/api/auth/me answers authEnabled:false,
    // user:null even with a valid cookie), so there is no signed-in user and
    // therefore NO account surface at all — a stronger form of "no control that
    // could only fail". Shown from a cookie-less browser, which is how a demo
    // visitor arrives.
    if (mode.json && mode.json.demoOpen === true) {
      const me = await ctx.api(await ctx.login('admin', demoPw), 'GET', '/api/auth/me');
      ctx.check('demo-open ignores a session cookie: /api/auth/me is authEnabled:false, user:null',
        !!me.json && me.json.authEnabled === false && me.json.user === null, me.json);
      for (const [label, vp] of [['1440', ctx.viewports.desktop], ['390', ctx.viewports.phone]]) {
        const page = await ctx.newPage({ width: vp.width, height: vp.height });
        // A working app page (the header menu lives on every app page). The
        // admin console itself is an admin-only page: cookie-less it answers
        // by landing on /login.html (and staying there — WINDOWS #4), checked
        // right after the shot.
        await page.goto(ctx.base + '/execution.html', { waitUntil: 'load' });
        await ctx.sleep(3500);
        const s = await page.evaluate(() => {
          const usersBtn = document.getElementById('admin-tab-btn-users');
          const visible = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
          return {
            path: window.location.pathname,
            accountItems: document.querySelectorAll('[data-am]').length,
            usersTabVisible: visible(usersBtn),
            usersAddVisible: visible(document.getElementById('btn-users-add')),
            fits: document.documentElement.scrollWidth <= window.innerWidth,
          };
        });
        ctx.check(`${label}px: demo-open app page stays put and offers no Change password / My sessions item`, s.path === '/execution.html' && s.accountItems === 0, s);
        ctx.check(`${label}px: no horizontal overflow`, s.fits, s);
        await ctx.shot(page, 'demo-open-no-account-ui-' + label);
        ctx.check(`${label}px: no page error`, page.pageErrors.length === 0, page.pageErrors);
        await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
        await ctx.sleep(3500);
        const adm = await page.evaluate(() => {
          const visible = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
          return {
            path: window.location.pathname,
            usersTabVisible: visible(document.getElementById('admin-tab-btn-users')),
            usersAddVisible: visible(document.getElementById('btn-users-add')),
          };
        });
        ctx.check(`${label}px: demo-open admin console is not reachable cookie-less (stays on /login.html) and shows no Users tab / Add user`,
          adm.path === '/login.html' && adm.usersTabVisible === false && adm.usersAddVisible === false, adm);
      }
      const cpPage = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height });
      await cpPage.goto(ctx.base + '/change-password.html', { waitUntil: 'load' });
      await ctx.sleep(2500);
      const cpState = await cpPage.evaluate(() => {
        const ids = ['cp-current', 'cp-new', 'cp-submit'].map((id) => document.getElementById(id));
        return {
          path: window.location.pathname,
          disabled: ids.every((e) => !e || e.disabled === true),
          note: (document.getElementById('cp-readonly') || {}).textContent || '',
        };
      });
      ctx.check('demo-open change-password page: no enabled form (disabled with the note, or bounced to sign-in)',
        (cpState.path === '/change-password.html' && cpState.disabled && /start-real-deal/.test(cpState.note)) || cpState.path === '/login.html', cpState);
      const post = await ctx.api(null, 'POST', '/api/admin/users', { username: 'should.not.exist', name: 'Nope', role: 'pmo' });
      ctx.check('POST /api/admin/users is refused (401/403, never 2xx) under demo-open',
        post.status === 401 || post.status === 403, { status: post.status });
      return;
    }

    const cookie = await ctx.login('admin', demoPw);

    for (const [label, vp] of [['1440', ctx.viewports.desktop], ['390', ctx.viewports.phone]]) {
      const page = await ctx.newPage({ width: vp.width, height: vp.height, cookies: [cookie] });

      // Header menu: Change password disabled + note; My sessions without End buttons.
      await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
      await openProfileMenu(page);
      const cp = await visibleChangePassword(page);
      ctx.check(`${label}px: header "Change password" is disabled with aria-disabled and its note`,
        !!cp && cp.disabled === true && cp.ariaDisabled === 'true' && /start-real-deal/.test(cp.note || ''), cp);
      const sessBtn = page.locator('[data-am="my-sessions"]:visible').first();
      await sessBtn.click();
      await page.waitForSelector('.am-session', { timeout: 8000 });
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.am-session')).map((r) => ({ canEnd: !!r.querySelector('.am-session-end') })));
      ctx.check(`${label}px: My sessions lists >= 1 session with no End-session button`, rows.length >= 1 && rows.every((r) => !r.canEnd), rows);
      const modalNote = await page.locator('.am-modal .am-note').first().textContent();
      ctx.check(`${label}px: My sessions shows the read-only note`, /start-real-deal/.test(modalNote || ''), modalNote);
      await ctx.shot(page, 'committed-readonly-menu-' + label);
      await page.keyboard.press('Escape');

      // Standalone change-password page: disabled form + note.
      await page.goto(ctx.base + '/change-password.html', { waitUntil: 'load' });
      await page.waitForFunction(() => document.getElementById('cp-readonly').textContent !== '', null, { timeout: 8000 });
      const form = await page.evaluate(() => ({
        note: document.getElementById('cp-readonly').textContent,
        disabled: ['cp-current', 'cp-new', 'cp-submit'].every((id) => document.getElementById(id).disabled === true),
      }));
      ctx.check(`${label}px: change-password page form is disabled with the note`, form.disabled && /start-real-deal/.test(form.note), form);

      // Admin Users tab: accounts listed, no write control, note shown.
      await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
      await page.waitForSelector('#admin-tab-btn-users', { state: 'visible', timeout: 15000 });
      await page.click('#admin-tab-btn-users');
      await page.waitForSelector('#users-list .au-table', { timeout: 10000 });
      await page.waitForSelector('#tab-users.active', { timeout: 5000 });
      await ctx.sleep(600);
      const tab = await page.evaluate(() => {
        const add = document.getElementById('btn-users-add');
        const note = document.getElementById('users-readonly-note');
        const visible = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
        return {
          rows: document.querySelectorAll('#users-list tbody tr').length,
          actionButtons: document.querySelectorAll('#users-list .au-actions button').length,
          addVisible: visible(add),
          noteVisible: visible(note),
          note: note ? note.textContent : '',
        };
      });
      ctx.check(`${label}px: Users tab lists accounts`, tab.rows > 0, tab.rows);
      ctx.check(`${label}px: Users tab has no Add / Edit / Disable / Reset password control`, tab.actionButtons === 0 && tab.addVisible === false, tab);
      ctx.check(`${label}px: Users tab shows the one-line note`, tab.noteVisible && /start-real-deal/.test(tab.note), tab.note);
      const f = await fits(page);
      ctx.check(`${label}px: Users tab has no horizontal overflow`, f.ok, f);
      // At 390 px the rail stacks above the panel; bring the panel into the
      // viewport so the shot shows the list and its note, not just the header.
      await page.evaluate(() => {
        const n = document.getElementById('tab-users');
        if (n) n.scrollIntoView({ block: 'start' });
      });
      await ctx.sleep(250);
      await ctx.shot(page, 'committed-readonly-users-' + label);
      ctx.check(`${label}px: no page error`, page.pageErrors.length === 0, page.pageErrors);
    }

    // The server holds the same line.
    const post = await ctx.api(cookie, 'POST', '/api/admin/users', { username: 'should.not.exist', name: 'Nope', role: 'pmo' });
    ctx.check('POST /api/admin/users answers 403 committedControlDb',
      post.status === 403 && !!post.json && post.json.committedControlDb === true, { status: post.status });
  },
};
