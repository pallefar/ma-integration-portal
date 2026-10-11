// demoWalk / ilWalk - the D-13-03 rollout gate (PD-31, PD-24), D-13-07.
//
// Walks the app under the strict policy and asserts ZERO violations from BOTH
// sources: the in-page `securitypolicyviolation` events (window.__cspv, every
// frame) and the admin endpoint /api/admin/csp-violations. In report-only mode
// (CSP_MODE=report-only) the strict policy rides beside the legacy enforcing
// one, so a clean walk is the measured precondition for flipping to enforce
// (13-13); the same scenarios are re-run under --csp-mode enforce there.
//
//   demoWalk  dev + demo-open: every public/*.html page, the chatbot (open + send),
//             the sidebar easter-egg and Ask slide through openHtmlSlide (the deck
//             slide asserts one non-blank sandboxed render, I-5), the overview deck
//             with its Agenda popover, the survey-scores modal, the employee lesson
//             modal and welcome video, every admin-console tab (Settings incl. the
//             External services panel, Pages, Slides).
//   ilWalk    real: the Integration Lead over the smoke IL pages (+ every
//             dashboard tab, execution tabs incl. RAID and Reports, DD, org) at 1440
//             and 390, the chatbot and slides; the admin over every console tab.
//
// A failed step or a violation is NEVER fixed here (PD-24): it is printed with
// the exact (directive, blocked-uri, source-file, page) tuple and the run FAILS.
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./_shared');

// JPEG quality: the whole evidence directory is capped (<= 1200 KB, README).
const SHOT_Q = 13;

function appPages() {
  return fs.readdirSync(path.join(S.REPO_ROOT, 'public')).filter((n) => n.endsWith('.html')).sort().map((n) => '/' + n);
}

function createWalk(ctx, tag) {
  const state = { pages: 0, steps: 0, failedSteps: 0, inpage: [], notes: [] };
  return {
    state,
    // Collect the in-page events of every frame at this point of the walk.
    async collect(page, at) {
      const v = await ctx.pageViolations(page);
      state.pages += 1;
      v.forEach((x) => state.inpage.push(Object.assign({ at }, x)));
      return v;
    },
    async step(name, fn) {
      state.steps += 1;
      try {
        const r = await fn();
        ctx.pass(`${name}`, r === undefined ? '' : r);
      } catch (e) {
        state.failedSteps += 1;
        ctx.fail(`${name}`, String(e && e.message ? e.message : e).split('\n')[0].slice(0, 200));
      }
    },
    async finish(adminCheck) {
      const ev = await ctx.endpointViolations();
      const tuples = (ev.violations || []).map((t) => `${t.directive} | ${t.blockedUri} | ${t.sourceFile || '(none)'}:${t.lineNumber || 0} | ${t.documentPath || ''} | x${t.count}`);
      const inpageTuples = Array.from(new Set(state.inpage.map((x) => `${x.directive} | ${x.blocked} | ${x.source || '(none)'}:${x.line} | ${x.doc} | at ${x.at} | ${x.disposition}`)));
      ctx.check(`in-page securitypolicyviolation events across the walk: none (${state.pages} checkpoints)`, state.inpage.length === 0, inpageTuples.slice(0, 12));
      ctx.check('GET /api/admin/csp-violations is empty after the walk', ev.count === 0, tuples.slice(0, 12));
      ctx.check('no walk step failed', state.failedSteps === 0, { failed: state.failedSteps, of: state.steps });
      ctx.check('canary server saw zero hits during the walk', ctx.canary.hits().length === 0, ctx.canary.hits().slice(0, 3));
      if (adminCheck) await adminCheck();
      const violations = Math.max(state.inpage.length, ev.count);
      ctx.say(`${tag} violations=${violations} endpoint=${ev.count} inpage=${state.inpage.length} checkpoints=${state.pages} steps=${state.steps} failedSteps=${state.failedSteps} csp-mode=${ctx.cspMode}`);
    },
  };
}

async function go(ctx, page, p, walk, opts) {
  const o = opts || {};
  await page.goto(ctx.base + p, { waitUntil: 'load' });
  await ctx.settle(page, o.wait === undefined ? 900 : o.wait);
  await walk.collect(page, p);
  return new URL(page.url()).pathname;
}

async function shot(ctx, page, name) {
  try { await ctx.shot(page, name, SHOT_Q); } catch (e) { /* evidence only */ }
}

// ---- reusable interactions -------------------------------------------------
async function chatbot(ctx, page, walk, label) {
  await walk.step(`${label}: open the assistant, send a message, receive an answer`, async () => {
    await page.click('#unified-fab');
    await page.click('.unified-tab[data-tab="chat"]');
    await page.fill('#teodor-global-input', 'How do I earn XP and what are the core modules?');
    await page.press('#teodor-global-input', 'Enter');
    await page.waitForSelector('#teodor-global-history .teodor-bubble.assistant', { timeout: 20000 });
    await walk.collect(page, label + ' chatbot');
  });
}

async function slides(ctx, page, walk, label, shotName) {
  await walk.step(`${label}: sidebar easter-egg opens through openHtmlSlide (sandboxed frame)`, async () => {
    await page.locator('.sidebar-egg').first().evaluate((el) => el.click());
    await page.waitForSelector('#html-slide-overlay iframe[sandbox="allow-scripts"]', { timeout: 8000 });
    await ctx.settle(page, 1200);
    await walk.collect(page, label + ' easter-egg');
    await page.keyboard.press('Escape');
  });
  await walk.step(`${label}: Ask 1 deck slide renders non-blank in the sandboxed opaque-origin frame (I-5)`, async () => {
    await page.locator('.sidebar-group[data-group="slides"] .sidebar-link', { hasText: 'Ask 1' }).first().evaluate((el) => el.click());
    await page.waitForSelector('#html-slide-overlay iframe[sandbox="allow-scripts"]', { timeout: 8000 });
    await ctx.settle(page, 1500);
    const frame = page.frames().find((f) => f.url().indexOf('/overview-deck/slide5.html') !== -1);
    if (!frame) throw new Error('slide5 frame not found');
    const render = await frame.evaluate(() => {
      const text = (document.body && document.body.innerText || '').trim().length;
      const visible = Array.from(document.querySelectorAll('body *')).filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      }).length;
      return { text, visible, origin: String(self.origin) };
    });
    if (!(render.text > 0 && render.visible > 0)) throw new Error('blank slide: ' + JSON.stringify(render));
    if (render.origin !== 'null') throw new Error('slide frame is not opaque-origin: ' + render.origin);
    // The same first-party slide renders identically in every lane: one screenshot
    // (dev) is the evidence, the assertion above runs in all of them.
    if (shotName) await shot(ctx, page, shotName);
    await walk.collect(page, label + ' ask-1');
    await page.keyboard.press('Escape');
    return render;
  });
}

async function adminTabs(ctx, page, walk, label, shotName) {
  await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
  await ctx.settle(page, 1500);
  await walk.collect(page, '/admin.html');
  const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.admin-tab-btn[data-tab]'))
    .filter((b) => b.getClientRects().length > 0).map((b) => b.getAttribute('data-tab')));
  await walk.step(`${label}: the admin console exposes its tabs (${tabs.length})`, async () => {
    if (tabs.length < 5) throw new Error('only ' + tabs.length + ' visible tabs: ' + tabs.join(','));
    return tabs.join(',');
  });
  for (const t of tabs) {
    await walk.step(`${label}: admin tab "${t}" opens`, async () => {
      await page.locator(`.admin-tab-btn[data-tab="${t}"]`).first().evaluate((el) => el.click());
      await ctx.sleep(700);
      if (t === 'system') {
        await page.waitForSelector('#egress-panel #egress-youtube', { timeout: 10000 });
        await shot(ctx, page, shotName);
      }
      await walk.collect(page, '/admin.html#' + t);
    });
  }
  for (const need of ['system', 'pages', 'slides']) {
    ctx.check(`${label}: tab "${need}" (Settings / Pages / Slides) was part of the walk`, tabs.indexOf(need) !== -1, tabs);
  }
}

// ---------------------------------------------------------------- demoWalk
async function demoWalk(ctx) {
  const fx = await ctx.fixture();
  const walk = createWalk(ctx, `demoWalk@${ctx.lane}`);
  const label = ctx.lane;
  // dev: the signed-in admin walks everything; demo-open: the page walk is the
  // anonymous showcase visitor (the admin console needs the operator session).
  const user = ctx.lane === 'demo-open' ? fx.users.victim : fx.users.admin;
  ctx.canary.reset();

  // anonymous login page first (a session would bounce it)
  if (ctx.lane !== 'demo-open') {
    const anon = await ctx.newPage({});
    await go(ctx, anon, '/login.html', walk);
  }

  const page = await ctx.newPage({ cookies: [user.cookie] });
  const landed = [];
  const shotsFor = new Set(['/index.html', '/dashboard.html', '/overview.html', '/employee.html']);
  for (const p of appPages()) {
    if (p === '/login.html' && ctx.lane !== 'demo-open') continue;
    await walk.step(`${label}: ${p} loads and settles`, async () => {
      const at = await go(ctx, page, p, walk);
      landed.push(p + ' -> ' + at);
      if (shotsFor.has(p)) await shot(ctx, page, `p13-walk-${ctx.lane}-${p.replace(/^\//, '').replace('.html', '')}-1440`);
      return at;
    });
  }

  await page.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
  await ctx.settle(page, 1000);
  await chatbot(ctx, page, walk, label);
  await slides(ctx, page, walk, label, ctx.lane === 'dev' ? 'p13-walk-dev-deck-slide-1440' : null);

  await walk.step(`${label}: survey-scores modal opens (insertAdjacentHTML template, close listener)`, async () => {
    await page.evaluate(() => window.showSurveyModal());
    await page.waitForSelector('#survey-scores-modal', { state: 'visible', timeout: 5000 });
    await walk.collect(page, 'survey-scores modal');
    await page.click('#survey-scores-modal-close');
  });

  await walk.step(`${label}: overview deck (framed) + Agenda popover`, async () => {
    await page.goto(ctx.base + '/overview.html', { waitUntil: 'load' });
    await ctx.settle(page, 2500);
    const deck = page.frames().find((f) => f.url().indexOf('/overview-deck/deck.html') !== -1);
    if (!deck) throw new Error('deck frame not found');
    await walk.collect(page, '/overview.html deck');
    await deck.click('#deck-agenda-btn', { timeout: 8000 });
    await page.waitForSelector('#html-slide-overlay iframe', { timeout: 8000 });
    await ctx.settle(page, 1200);
    await walk.collect(page, '/overview.html agenda popover');
    await page.keyboard.press('Escape');
  });

  await walk.step(`${label}: employee portal lesson modal`, async () => {
    await page.goto(ctx.base + '/employee.html', { waitUntil: 'load' });
    await ctx.settle(page, 1500);
    const btn = page.locator('.academy-view-lesson').first();
    await btn.waitFor({ state: 'attached', timeout: 12000 });
    await btn.evaluate((el) => el.click());
    await page.waitForSelector('.cms-modal .lesson-body', { timeout: 6000 });
    await walk.collect(page, '/employee.html lesson modal');
    await page.keyboard.press('Escape').catch(() => {});
  });
  await walk.step(`${label}: employee welcome video control`, async () => {
    await page.goto(ctx.base + '/employee.html', { waitUntil: 'load' });
    await ctx.settle(page, 1200);
    const play = page.locator('#btn-play-video');
    if (await play.count()) await play.evaluate((el) => el.click());
    await ctx.sleep(500);
    await walk.collect(page, '/employee.html welcome video');
  });

  const adminPage = await ctx.newPage({ cookies: [fx.users.admin.cookie] });
  await adminTabs(ctx, adminPage, walk, label, `p13-walk-${ctx.lane}-admin-settings-1440`);
  ctx.pass(`${label}: page list with landing paths`, landed);
  await walk.finish();
}

// ---------------------------------------------------------------- ilWalk
async function ilWalk(ctx) {
  const fx = await ctx.fixture();
  const walk = createWalk(ctx, `ilWalk@${ctx.lane}`);
  const il = fx.users.il;
  const label = 'IL';
  ctx.canary.reset();

  const smokePages = require(path.join(S.REPO_ROOT, 'scripts', 'smoke', 'pages.js')).filter((p) => p.as === 'il');
  const page = await ctx.newPage({ cookies: [il.cookie] });
  for (const entry of smokePages) {
    await walk.step(`${label}: ${entry.path} (smoke IL page) at 1440`, async () => {
      const at = await go(ctx, page, entry.path, walk);
      if (at !== entry.path) throw new Error('redirected to ' + at);
      await shot(ctx, page, `p13-walk-real-${entry.name}-1440`);
    });
    await walk.step(`${label}: ${entry.path} at 390`, async () => {
      await page.setViewportSize({ width: ctx.viewports.phone.width, height: ctx.viewports.phone.height });
      await page.reload({ waitUntil: 'load' });
      await ctx.settle(page, 900);
      await walk.collect(page, entry.path + ' @390');
      await shot(ctx, page, `p13-walk-real-${entry.name}-390`);
      await page.setViewportSize({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height });
    });
  }

  await walk.step(`${label}: deal home - every dashboard tab`, async () => {
    await go(ctx, page, '/dashboard.html', walk, { wait: 1200 });
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.dashboard-nav-btn[data-tab]')).map((b) => b.getAttribute('data-tab')));
    if (tabs.length < 5) throw new Error('only ' + tabs.length + ' tabs');
    for (const t of tabs) {
      await page.locator(`.dashboard-nav-btn[data-tab="${t}"]`).first().evaluate((el) => el.click());
      await ctx.sleep(500);
      await walk.collect(page, '/dashboard.html#' + t);
    }
    return tabs.length + ' tabs';
  });

  await walk.step(`${label}: execution - tasks, synergy, RAID, reports tabs`, async () => {
    await go(ctx, page, '/execution.html', walk, { wait: 1200 });
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.ex-tab[data-ex-tab]')).map((b) => b.getAttribute('data-ex-tab')));
    for (const need of ['raid', 'reports']) if (tabs.indexOf(need) === -1) throw new Error('missing execution tab ' + need);
    for (const t of tabs) {
      await page.locator(`.ex-tab[data-ex-tab="${t}"]`).first().evaluate((el) => el.click());
      await ctx.sleep(700);
      await walk.collect(page, '/execution.html#' + t);
      if (t === 'reports') await shot(ctx, page, 'p13-walk-real-execution-reports-1440');
    }
    return tabs.join(',');
  });

  await go(ctx, page, '/index.html', walk, { wait: 800 });
  await go(ctx, page, '/dashboard.html', walk, { wait: 800 });
  await chatbot(ctx, page, walk, label);
  await slides(ctx, page, walk, label, null);

  const admin = fx.users.admin;
  const adminPage = await ctx.newPage({ cookies: [admin.cookie] });
  await adminTabs(ctx, adminPage, walk, 'admin', 'p13-walk-real-admin-settings-1440');

  await walk.finish(async () => {
    // the real-mode defaults held during the whole walk: no third-party attempt, same-origin only
    const attempts = []
      .concat(page.externalBlocked, adminPage.externalBlocked);
    ctx.check('real-mode walk: no third-party request was even attempted', attempts.length === 0, attempts.slice(0, 5));
  });
}

module.exports = {
  demoWalk,
  ilWalk,
  __lanes: { demoWalk: ['dev', 'demo-open'], ilWalk: ['real'] },
};
