// Phase 10 plan 10-06 Task 1: the login page is honest about the mode it runs
// in (D-10-08c, T-10-38) and never redirect-loops in demo-open (WINDOWS #4,
// T-10-40). Loaded by scripts/uat/phase10-walk.js.
//
// The two read-only dev/demo scenarios also run in the committed-control lanes
// (dev-committed / demo-committed): that proves those lanes boot against the
// committed data/control.db and that the runner's control.db + -wal guard holds.

'use strict';

const DEMO_PASSWORD = 'TEdemo!2026';

async function loadLogin(ctx, viewport) {
  const page = await ctx.newPage(viewport);
  await page.goto(ctx.base + '/login.html', { waitUntil: 'load' });
  // login.js resolves /api/auth/mode and /api/auth/me in parallel; give it time.
  await ctx.sleep(1200);
  return page;
}

async function panelState(page) {
  return page.evaluate((pw) => {
    const slot = document.getElementById('lg-demo-slot');
    const rows = Array.from(document.querySelectorAll('.lg-demo-row'));
    const link = Array.from(document.querySelectorAll('a')).find((a) => a.textContent === 'Open the demo without signing in');
    return {
      slotChildren: slot ? slot.children.length : -1,
      accountButtons: rows.map((r) => r.getAttribute('data-user')),
      hasOpenLink: !!link,
      openHref: link ? link.getAttribute('href') : null,
      bodyText: document.body.innerText,
      domHasPassword: document.documentElement.outerHTML.indexOf(pw) !== -1,
      pathname: window.location.pathname,
      scrollFits: document.documentElement.scrollWidth <= window.innerWidth,
    };
  }, DEMO_PASSWORD);
}

module.exports = {
  __lanes: {
    realLoginHasNoDemoCredentials: ['real'],
    devLoginShowsDemoPanel: ['dev', 'dev-committed'],
    demoOpenLoginStays: ['demo-open', 'demo-committed'],
  },

  async realLoginHasNoDemoCredentials(ctx) {
    const mode = await ctx.api(null, 'GET', '/api/auth/mode');
    ctx.check('mode probe says real, accountsWritable true', mode.json && mode.json.mode === 'real' && mode.json.accountsWritable === true, mode.json);
    ctx.check('real lane: first boot seeded zero accounts before bootstrap', ctx.preBootstrapUserCount === 0, ctx.preBootstrapUserCount);
    for (const [label, vp] of [['1440', ctx.viewports.desktop], ['390', ctx.viewports.phone]]) {
      const page = await loadLogin(ctx, vp);
      const s = await panelState(page);
      ctx.check(`${label}px: stayed on /login.html with no session`, s.pathname === '/login.html', s.pathname);
      ctx.check(`${label}px: #lg-demo-slot has no children`, s.slotChildren === 0, s.slotChildren);
      ctx.check(`${label}px: page text has no "Demo accounts"`, s.bodyText.indexOf('Demo accounts') === -1);
      ctx.check(`${label}px: page text has no published demo password`, s.bodyText.indexOf(DEMO_PASSWORD) === -1 && !s.domHasPassword);
      ctx.check(`${label}px: no demo account buttons`, s.accountButtons.length === 0, s.accountButtons);
      ctx.check(`${label}px: no horizontal overflow`, s.scrollFits);
      ctx.check(`${label}px: no page error`, page.pageErrors.length === 0, page.pageErrors);
      await ctx.shot(page, 'login-real-' + label);
      // The sign-in form itself is still there.
      const hasForm = await page.evaluate(() => !!document.getElementById('lg-user') && !!document.getElementById('lg-pass'));
      ctx.check(`${label}px: sign-in form present`, hasForm);
    }
  },

  async devLoginShowsDemoPanel(ctx) {
    const mode = await ctx.api(null, 'GET', '/api/auth/mode');
    ctx.check('mode probe says dev', mode.json && mode.json.mode === 'dev' && mode.json.demoOpen === false, mode.json);
    if (ctx.lane === 'dev-committed') {
      ctx.check('dev-committed: accountsWritable is false (committed control.db active)', mode.json && mode.json.accountsWritable === false, mode.json);
    } else {
      ctx.check('dev: accountsWritable is true (temp control copy)', mode.json && mode.json.accountsWritable === true, mode.json);
    }
    const page = await loadLogin(ctx, ctx.viewports.desktop);
    const s = await panelState(page);
    ctx.check('demo panel shows the three account buttons', JSON.stringify(s.accountButtons) === JSON.stringify(['admin', 'karen', 'pmo']), s.accountButtons);
    ctx.check('no "Open the demo" link outside demo-open', s.hasOpenLink === false);
    ctx.check('stayed on /login.html', s.pathname === '/login.html', s.pathname);
    // Clicking an account fills the form.
    await page.click('.lg-demo-row[data-user="karen"]');
    const filled = await page.evaluate(() => ({ u: document.getElementById('lg-user').value, p: document.getElementById('lg-pass').value }));
    ctx.check('click fills username and password', filled.u === 'karen' && filled.p === DEMO_PASSWORD, { user: filled.u, passLen: filled.p.length });
    ctx.check('no page error', page.pageErrors.length === 0, page.pageErrors);
    await ctx.shot(page, 'login-' + ctx.lane + '-1440');
  },

  async demoOpenLoginStays(ctx) {
    const mode = await ctx.api(null, 'GET', '/api/auth/mode');
    ctx.check('mode probe says demo-open', mode.json && mode.json.mode === 'demo' && mode.json.demoOpen === true, mode.json);
    const me = await ctx.api(null, 'GET', '/api/auth/me');
    ctx.check('anonymous /api/auth/me is authEnabled:false (the loop trigger)', me.json && me.json.authEnabled === false && me.json.user === null, me.json);
    const page = await loadLogin(ctx, ctx.viewports.desktop);
    const s = await panelState(page);
    ctx.check('demo panel visible with three buttons', JSON.stringify(s.accountButtons) === JSON.stringify(['admin', 'karen', 'pmo']), s.accountButtons);
    ctx.check('"Open the demo without signing in" link present, href /', s.hasOpenLink && s.openHref === '/', { has: s.hasOpenLink, href: s.openHref });
    // A cookie-less load must stay put for 4 s (the pre-fix page bounced to '/').
    const navAtStart = page.navigations;
    await ctx.sleep(4000);
    const pathNow = await page.evaluate(() => window.location.pathname);
    ctx.check('cookie-less /login.html stays on /login.html for 4 s', pathNow === '/login.html' && page.navigations === navAtStart, { pathNow, navigations: page.navigations - navAtStart });
    ctx.check('no page error', page.pageErrors.length === 0, page.pageErrors);
    await ctx.shot(page, 'login-' + ctx.lane + '-1440');
  },
};
