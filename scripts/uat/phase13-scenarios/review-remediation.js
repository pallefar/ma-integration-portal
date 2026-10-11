// Review-remediation scenarios (plan 13-14, Task 0) - the browser/HTTP proofs the two Phase 13
// Fable code reviews and their fixers owe the runner (13-REVIEW.md Part A, 13-REVIEW-CLIENT.md
// Part B, 13-REVIEW-FIX-S.md / 13-REVIEW-FIX-C.md "scenarios owed", 13-QUICK-media-SUMMARY.md).
// Every scenario here ADDS checks; none relaxes an earlier one.
//
//   urlFields      CR-B01 / WR-B04   a pmo's POST /api/modules with the review payloads (attribute
//                                    breakout, javascript:) is 400 and stores nothing; lesson
//                                    playbookLink / sidebar href / welcomeVideoUrl writes with a
//                                    javascript: URL are 400; a LEGACY unsafe playbookLink inserted
//                                    below the API renders inert on the admin and IL dashboard (no
//                                    window.__xss, no dialog, no <img>, no javascript: href, clicks
//                                    run nothing) and in the admin console's module list.
//   sessionEnd     WR-B01            "End session" on the CURRENT session in the account menu clears
//                                    localStorage (language keys survive) / sessionStorage / Cache
//                                    Storage like logout does and the DELETE carries
//                                    Clear-Site-Data; ending ANOTHER device's session does neither.
//   overviewRelay  WR-B03            the overview page ignores forged / foreign message events
//                                    (wrong origin, wrong source, non-deck url); the first-party deck
//                                    still drives it (positive control).
//   slideSpellings CR-A01 / S        Windows path spellings of an uploaded slide (%5C, a trailing dot
//                                    on a directory segment, ::$DATA, ~1, ...) are 404 with no slide
//                                    bytes; the real slide still serves with the sandbox CSP.
//   mediaUpload    13-QUICK-media    POST /api/media refuses .html/.svg/.js with 415
//                                    media-type-refused and stores nothing; a PNG is 200 and served
//                                    as image/png.
//
// Lanes: urlFields / overviewRelay / mediaUpload real + dev; sessionEnd real only (the committed demo
// control.db makes accounts read-only, so the dev lane has no End-session button by design);
// slideSpellings real + dev + dev-defaultdir (the default directory is where the legacy public/ tree
// could be reached).
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const S = require('./_shared');
const { SLIDE_SANDBOX_CSP, MEDIA_REFUSALS } = require(path.join(S.REPO_ROOT, 'lib', 'slideUpload.js'));

const DB = () => require(path.join(S.REPO_ROOT, 'node_modules', 'better-sqlite3'));

function listing(dir) {
  try { return fs.readdirSync(dir).sort(); } catch (e) { return null; }
}

// A raw HTTP GET: the request line carries the path EXACTLY as given (fetch()/WHATWG URL would rewrite
// `\` to `/` and resolve dot segments, which are the very spellings under test).
function rawGet(base, rawPath, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ host: u.hostname, port: u.port, method: 'GET', path: rawPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const cookieOfHeaders = (headers) => {
  const m = /ma_session=([^;]+)/.exec(headers.get('set-cookie') || '');
  return m ? 'ma_session=' + m[1] : null;
};

// ============================================================ urlFields
async function urlFields(ctx) {
  const fx = await ctx.fixture();
  const canary = ctx.canary;
  canary.reset();
  const expr = S.xssExpr(canary.origin);
  const admin = fx.users.author.cookie;
  const pmo = fx.users.pmo.cookie;
  const tag = 'P13-' + crypto.randomBytes(3).toString('hex');
  const PAYLOADS = [
    { name: 'attribute breakout (CR-B01)', value: 'x" ><img src=x onerror=' + expr + '><a href="' },
    { name: 'javascript: scheme (CR-B01)', value: 'javascript:' + expr },
  ];
  const violationsBefore = (await ctx.endpointViolations()).count;

  // ---- (1) pmo POST /api/modules: both payloads are refused, nothing stored ----
  const listBefore = await ctx.api(pmo, 'GET', '/api/modules');
  ctx.check('pmo can read /api/modules (baseline list)', listBefore.status === 200 && Array.isArray(listBefore.json), { status: listBefore.status });
  const baseline = Array.isArray(listBefore.json) ? listBefore.json.length : -1;
  for (const p of PAYLOADS) {
    const r = await ctx.api(pmo, 'POST', '/api/modules', {
      title: tag + ' refused', dimension: 'culture', urgency: 'High', minScore: 0, maxScore: 5, description: 'refused', playbookLink: p.value,
    });
    ctx.check(`pmo POST /api/modules with the ${p.name} payload answers 400`, r.status === 400, { status: r.status });
    ctx.check(`  the refusal names playbookLink and never echoes the value`,
      r.status === 400 && /playbookLink/.test(String(r.json && r.json.error)) && String(r.text).indexOf(p.value) === -1, String(r.json && r.json.error).slice(0, 100));
  }
  const listAfter = await ctx.api(pmo, 'GET', '/api/modules');
  ctx.check('nothing was stored by the refused writes', Array.isArray(listAfter.json) && listAfter.json.length === baseline, { before: baseline, after: Array.isArray(listAfter.json) ? listAfter.json.length : null });

  // positive control: a legitimate relative link is still accepted (201) and cleaned up
  const okMod = await ctx.api(pmo, 'POST', '/api/modules', {
    title: tag + ' legit', dimension: 'culture', urgency: 'High', minScore: 0, maxScore: 5, description: 'legit', playbookLink: '/playbook.html#culture',
  });
  ctx.check('a legitimate relative playbookLink is stored (201)', okMod.status === 201 && okMod.json && okMod.json.module && okMod.json.module.playbookLink === '/playbook.html#culture', { status: okMod.status });
  const legitId = okMod.json && okMod.json.module && okMod.json.module.id;
  if (legitId) await ctx.api(admin, 'DELETE', '/api/modules/' + encodeURIComponent(legitId)); // keep the browser phase to the three legacy rows

  // ---- (2) the other URL-valued writes (WR-B04): javascript: is a 400 ----------
  const js = PAYLOADS[1].value;
  const lesson = await ctx.api(admin, 'POST', '/api/courses/p13-course/lessons', { lesson: { title: 'p13', playbookLink: js } });
  ctx.check('lesson playbookLink = javascript: answers 400', lesson.status === 400 && /playbookLink/.test(String(lesson.json && lesson.json.error)), { status: lesson.status, error: lesson.json && String(lesson.json.error).slice(0, 80) });
  const menu = await ctx.api(admin, 'POST', '/api/menus', { sidebar: [{ href: js }] });
  ctx.check('sidebar menu href = javascript: answers 400', menu.status === 400 && /href/.test(String(menu.json && menu.json.error)), { status: menu.status, error: menu.json && String(menu.json.error).slice(0, 80) });
  const menuCase = await ctx.api(admin, 'POST', '/api/menus', { sidebar: [{ href: 'JavaScript:' + expr }] });
  ctx.check('sidebar menu href = JavaScript: (mixed case) answers 400', menuCase.status === 400, { status: menuCase.status });
  for (const key of ['welcomeVideoUrl', 'welcomeVideoUrl_en', 'welcomeVideoUrl_de']) {
    const r = await ctx.api(admin, 'POST', '/api/settings', { [key]: js });
    ctx.check(`settings ${key} = javascript: answers 400`, r.status === 400 && new RegExp(key).test(String(r.json && r.json.error)), { status: r.status });
  }

  // ---- (3) legacy unsafe rows inserted BELOW the API render inert --------------
  const dbFile = ctx.lane === 'real' ? path.join(ctx.dataDir, 'deals', fx.dealId + '.db') : path.join(ctx.dataDir, 'demo.db');
  ctx.check('the lane store file exists (insertion target)', fs.existsSync(dbFile), path.basename(dbFile));
  const legacy = [
    { id: 'mod_p13_breakout', title: tag + ' legacy breakout', dimension: 'culture', urgency: 'High', minScore: 0, maxScore: 5,
      description: 'legacy <img src=x onerror=' + expr + '> text', playbookLink: PAYLOADS[0].value, supportingTeams: 'IMO' },
    { id: 'mod_p13_jsurl', title: tag + ' legacy javascript', dimension: 'talent', urgency: 'High', minScore: 0, maxScore: 5,
      description: 'legacy', playbookLink: PAYLOADS[1].value, supportingTeams: 'IMO' },
    { id: 'mod_p13_mixed', title: tag + ' legacy mixed-case', dimension: 'value', urgency: 'High', minScore: 0, maxScore: 5,
      description: 'legacy', playbookLink: 'JaVaScRiPt:' + expr, supportingTeams: 'IMO' },
  ];
  const conn = new (DB())(dbFile);
  try {
    conn.pragma('busy_timeout = 8000');
    const seq0 = conn.prepare('SELECT COALESCE(MAX(seq), -1) AS m FROM modules').get().m + 1;
    const ins = conn.prepare('INSERT INTO modules (id, project_id, seq, data) VALUES (?, ?, ?, ?)');
    legacy.forEach((m, i) => ins.run(m.id, null, seq0 + i, JSON.stringify(m)));
  } finally {
    try { conn.pragma('wal_checkpoint(PASSIVE)'); } catch (e) { /* best effort */ }
    conn.close();
  }
  const served = await ctx.api(admin, 'GET', '/api/modules');
  const servedLegacy = Array.isArray(served.json) ? served.json.filter((m) => /^mod_p13_/.test(m.id)) : [];
  ctx.check('the legacy rows are served unchanged by the real API (the defence is at render time)', servedLegacy.length === 3, { n: servedLegacy.length, status: served.status });

  const viewers = [['admin', fx.users.victim.cookie], ['Integration Lead', fx.users.il.cookie]];
  // Where the CR-B01 sink lives. The recommended-modules card (dashboard.js renderActionModules) is part of
  // the demo/dev dashboard only: a deal-bound session (real lane) gets the deal home instead, which never
  // calls /api/modules, so there the legacy rows can only surface in the admin console list (WR-B04 sink,
  // checked below in every lane).
  const dealBound = ctx.lane === 'real';
  for (const [who, cookie] of viewers) {
    const label = `${who} dashboard`;
    const page = await ctx.newPage({ cookies: [cookie] });
    await page.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
    await ctx.settle(page, 800);
    if (dealBound) {
      await ctx.settle(page, 1200);
      const home = await page.evaluate((t) => ({
        dealHome: !!document.getElementById('deal-home') && getComputedStyle(document.getElementById('deal-home')).display !== 'none',
        modulesContainer: !!document.querySelector('#hr-modules-container .card'),
        tagText: document.body.innerText.indexOf(t) !== -1,
        jsAnchors: Array.from(document.querySelectorAll('a[href]')).filter((a) => /^\s*javascript:/i.test(a.getAttribute('href'))).length,
        strayImgs: document.querySelectorAll('#hr-modules-container img').length,
      }), tag);
      ctx.check(`${label}: the deal-bound dashboard is the deal home and renders no recommended-module cards`, home.dealHome && !home.modulesContainer, home);
      ctx.check(`${label}: no legacy row text and no javascript: anchor anywhere on the deal home`, !home.tagText && home.jsAnchors === 0 && home.strayImgs === 0, home);
      await S.assertInert(ctx, page, label);
      continue;
    }
    // The "Recommended HR Integration Modules" tab (cards are built regardless; opening the tab is what a user does).
    await page.locator('.dashboard-nav-btn[data-tab="hr-modules"]').first().evaluate((el) => el.click()).catch(() => {});
    await page.waitForFunction((t) => document.querySelectorAll('#hr-modules-container .card').length >= 3 &&
      Array.from(document.querySelectorAll('#hr-modules-container h4')).some((h) => h.textContent.indexOf(t) !== -1), tag, { timeout: 20000 }).catch(() => {});
    const dom = await page.evaluate((t) => {
      const root = document.getElementById('hr-modules-container');
      const cards = Array.from(root ? root.querySelectorAll('.card') : []).filter((c) => (c.querySelector('h4') || {}).textContent.indexOf(t) !== -1);
      return {
        legacyCards: cards.map((c) => {
          const a = c.querySelector('a');
          return { title: c.querySelector('h4').textContent, rawHref: a ? a.getAttribute('href') : null, resolved: a ? a.href : null, text: c.textContent };
        }),
        imgs: root ? root.querySelectorAll('img').length : -1,
        origin: location.origin,
      };
    }, tag);
    ctx.check(`${label}: all three legacy cards rendered`, dom.legacyCards.length === 3, dom.legacyCards.map((c) => c.title));
    ctx.check(`${label}: no <img> in the recommended-modules container`, dom.imgs === 0, dom.imgs);
    const bad = dom.legacyCards.filter((c) => !c.resolved || !/^https?:$/.test(new URL(c.resolved).protocol) || new URL(c.resolved).origin !== dom.origin);
    ctx.check(`${label}: every legacy card link resolves same-origin http(s) (never javascript:)`, bad.length === 0, bad.map((c) => ({ t: c.title, h: String(c.rawHref).slice(0, 40) })));
    const jsCard = dom.legacyCards.find((c) => /legacy javascript$/.test(c.title));
    ctx.check(`${label}: the javascript: row falls back to /playbook.html`, !!jsCard && jsCard.rawHref === '/playbook.html', jsCard && jsCard.rawHref);
    const mixedCard = dom.legacyCards.find((c) => /mixed-case$/.test(c.title));
    ctx.check(`${label}: the mixed-case JaVaScRiPt: row falls back to /playbook.html`, !!mixedCard && mixedCard.rawHref === '/playbook.html', mixedCard && mixedCard.rawHref);
    const breakCard = dom.legacyCards.find((c) => /legacy breakout$/.test(c.title));
    ctx.check(`${label}: the markup in a legacy description stays text (rendered literally)`, !!breakCard && breakCard.text.indexOf('<img src=x onerror=') !== -1, null);
    const a = await page.evaluate(S.auditDom, { selector: '#hr-modules-container' });
    ctx.check(`${label}: structural audit of the container is clean`, a.roots === 1 && a.problems.length === 0, a.problems.slice(0, 5));
    await S.assertInert(ctx, page, label);

    // Clicking each legacy anchor executes nothing (fresh page per click: it navigates away).
    for (const c of dom.legacyCards) {
      const p2 = await ctx.newPage({ cookies: [cookie] });
      await p2.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
      await p2.waitForFunction((t) => Array.from(document.querySelectorAll('#hr-modules-container h4')).some((h) => h.textContent === t), c.title, { timeout: 20000 }).catch(() => {});
      const link = p2.locator('#hr-modules-container .card', { hasText: c.title }).locator('a').first();
      await Promise.all([
        p2.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => {}),
        link.evaluate((el) => el.click()),
      ]);
      await ctx.settle(p2, 400);
      await S.assertInert(ctx, p2, `${label}: after clicking "${c.title.replace(tag + ' ', '')}"`);
    }
  }

  // admin console > Action Modules list (admin.js escapeHtml(safeLink(...)))
  {
    const page = await ctx.newPage({ cookies: [fx.users.victim.cookie] });
    await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
    await ctx.settle(page, 800);
    await page.locator('.admin-tab-btn[data-tab="modules"]').first().evaluate((el) => el.click()).catch(() => {});
    await page.waitForFunction((t) => document.getElementById('modules-index-list') && document.getElementById('modules-index-list').textContent.indexOf(t) !== -1, tag, { timeout: 20000 }).catch(() => {});
    const links = await page.evaluate((t) => Array.from(document.querySelectorAll('#modules-index-list .admin-question-row'))
      .filter((r) => r.textContent.indexOf(t) !== -1)
      .map((r) => { const a = r.querySelector('a[target="_blank"]'); return { raw: a ? a.getAttribute('href') : null, resolved: a ? a.href : null }; }), tag);
    ctx.check('admin console module list: the three legacy rows render', links.length === 3, links.length);
    ctx.check('admin console module list: no row links to a javascript: URL (resolved href is same-origin http(s))',
      links.every((l) => l.resolved && /^https?:$/.test(new URL(l.resolved).protocol) && new URL(l.resolved).origin === ctx.base), links.map((l) => String(l.raw).slice(0, 30)));
    const imgs = await page.evaluate(() => document.querySelectorAll('#modules-index-list img').length);
    ctx.check('admin console module list: no <img> parsed out of a legacy value', imgs === 0, imgs);
    await S.assertInert(ctx, page, 'admin console module list');
  }

  // ---- cleanup + the shared violation oracle ----------------------------------
  for (const id of ['mod_p13_breakout', 'mod_p13_jsurl', 'mod_p13_mixed']) {
    await ctx.api(admin, 'DELETE', '/api/modules/' + encodeURIComponent(id));
  }
  const ev = await ctx.endpointViolations();
  ctx.check('GET /api/admin/csp-violations gained nothing during this scenario', ev.count === violationsBefore, { before: violationsBefore, after: ev.count, tuples: ev.violations.slice(0, 4) });
  ctx.check('the canary origin received no request', canary.hits().length === 0, canary.hits().slice(0, 3));
  ctx.say(`urlFields@${ctx.lane} (csp-mode=${ctx.cspMode}) payloads=${PAYLOADS.length} legacyRows=${legacy.length} violations=${ev.count}`);
}

// ============================================================ sessionEnd
async function sessionEnd(ctx) {
  const admin = await ctx.adminCookie();
  const username = 'p13.sessuser';
  const created = await ctx.api(admin, 'POST', '/api/admin/users', { username, name: 'Phase Thirteen Session User', role: 'pmo' });
  if (created.status !== 201 || !created.json || !created.json.tempPassword) throw new Error('session user create failed: ' + created.status);
  const first = await ctx.loginFull(username, created.json.tempPassword);
  const password = 'Rot-' + crypto.randomBytes(16).toString('base64url');
  const rot = await ctx.api(first.cookie, 'POST', '/api/auth/change-password', { currentPassword: created.json.tempPassword, newPassword: password });
  if (rot.status !== 200) throw new Error('forced rotation failed: ' + rot.status);
  const mine = cookieOfHeaders(rot.headers) || first.cookie;
  const other = (await ctx.loginFull(username, password)).cookie; // the seeded second device
  const alive = async (cookie) => {
    const r = await ctx.api(cookie, 'GET', '/api/auth/me');
    return r.status === 200 && !!(r.json && r.json.user);
  };
  ctx.check('seeded: the browser session and a second device session are both live', (await alive(mine)) && (await alive(other)), null);

  const page = await ctx.newPage({ cookies: [mine] });
  await page.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
  await ctx.settle(page, 800);
  const seed = () => page.evaluate(async () => {
    localStorage.setItem('employeeLanguage', 'de');
    localStorage.setItem('active_demo_role', 'pmo');
    localStorage.setItem('pmo_tasks_state', '{"p13":1}');
    sessionStorage.setItem('p13-session-note', 'secret-session-state');
    const c = await caches.open('transformers-cache');
    await c.put('/p13-model-probe', new Response('p13-weights', { headers: { 'Content-Type': 'text/plain' } }));
  });
  const snapshot = () => page.evaluate(async () => ({
    local: Object.keys(localStorage).sort(), lang: localStorage.getItem('employeeLanguage'),
    session: sessionStorage.length, caches: await caches.keys(), path: location.pathname,
  }));
  await seed();

  const deleteHeaders = [];
  page.on('response', (r) => {
    if (r.request().method() === 'DELETE' && r.url().indexOf('/api/auth/sessions/') !== -1) {
      deleteHeaders.push(r.allHeaders().then((h) => ({ status: r.status(), csd: h['clear-site-data'] || null })));
    }
  });
  const openSessions = async () => {
    const btn = page.locator('.am-item[data-am="my-sessions"]').first();
    await btn.waitFor({ state: 'attached', timeout: 20000 });
    await btn.evaluate((el) => el.click());
    await page.waitForSelector('.am-session', { timeout: 15000 });
  };

  // ---- (a) ending ANOTHER device's session leaves this browser untouched ------
  await openSessions();
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.am-session')).map((r) => ({
    current: !!r.querySelector('.am-badge'), hasEnd: !!r.querySelector('.am-session-end'),
  })));
  ctx.check('the account menu lists both sessions, one marked "This device", each with an End-session button',
    rows.length === 2 && rows.filter((r) => r.current).length === 1 && rows.every((r) => r.hasEnd), rows);
  await page.locator('.am-session:not(:has(.am-badge)) .am-session-end').first().evaluate((el) => el.click());
  await page.waitForFunction(() => document.querySelectorAll('.am-session').length === 1, null, { timeout: 15000 }).catch(() => {});
  await ctx.settle(page, 400);
  const s1 = await snapshot();
  const d1 = await Promise.all(deleteHeaders.splice(0));
  ctx.check('ending ANOTHER session: the DELETE answered 200 without Clear-Site-Data', d1.length === 1 && d1[0].status === 200 && d1[0].csd === null, d1);
  ctx.check('ending ANOTHER session: this browser keeps its localStorage keys', ['active_demo_role', 'employeeLanguage', 'pmo_tasks_state'].every((k) => s1.local.indexOf(k) !== -1), s1.local);
  ctx.check('ending ANOTHER session: sessionStorage and Cache Storage are untouched', s1.session === 1 && s1.caches.indexOf('transformers-cache') !== -1, { session: s1.session, caches: s1.caches });
  ctx.check('ending ANOTHER session: the page did not navigate away and the list reloaded to one row', s1.path === '/dashboard.html', s1.path);
  ctx.check('the other device is signed out; this browser session is still live', !(await alive(other)) && (await alive(mine)), null);

  // ---- (b) ending the CURRENT session is a sign-out ---------------------------
  const other2 = (await ctx.loginFull(username, password)).cookie; // a fresh second device
  await page.reload({ waitUntil: 'load' });
  await ctx.settle(page, 800);
  await seed();
  await openSessions();
  await page.waitForFunction(() => document.querySelectorAll('.am-session').length === 2, null, { timeout: 15000 }).catch(() => {});
  await page.locator('.am-session:has(.am-badge) .am-session-end').first().evaluate((el) => el.click());
  await page.waitForURL('**/login.html', { timeout: 20000 }).catch(() => {});
  await ctx.settle(page, 600);
  const s2 = await snapshot();
  const d2 = await Promise.all(deleteHeaders.splice(0));
  ctx.check('ending the CURRENT session lands on /login.html', s2.path === '/login.html', s2.path);
  ctx.check('ending the CURRENT session: the DELETE answered 200 with Clear-Site-Data: "cache", "storage"',
    d2.length === 1 && d2[0].status === 200 && d2[0].csd === '"cache", "storage"', d2);
  ctx.check('ending the CURRENT session: localStorage holds only the language key, value kept', s2.local.every((k) => k === 'employeeLanguage') && s2.lang === 'de', { local: s2.local, lang: s2.lang });
  ctx.check('ending the CURRENT session: sessionStorage is empty', s2.session === 0, s2.session);
  ctx.check('ending the CURRENT session: Cache Storage is empty', s2.caches.length === 0, s2.caches);
  ctx.check('the ended session is revoked server-side; the other device keeps its own session', !(await alive(mine)) && (await alive(other2)), null);
  const ev = await ctx.endpointViolations();
  ctx.check('GET /api/admin/csp-violations is empty after the session-end walk', ev.count === 0, { count: ev.count, tuples: ev.violations.slice(0, 4) });
  const pv = await ctx.pageViolations(page);
  ctx.check('no in-page securitypolicyviolation on the account-menu walk', pv.length === 0, pv.slice(0, 4));
  ctx.say(`sessionEnd@${ctx.lane} (csp-mode=${ctx.cspMode}) other=${d1.length} current=${d2.length}`);
}

// ============================================================ overviewRelay
async function overviewRelay(ctx) {
  const fx = await ctx.fixture();
  const cookie = fx.users.il.cookie;
  const violationsBefore = (await ctx.endpointViolations()).count;
  const overlayOpen = (pg) => pg.evaluate(() => !!document.getElementById('html-slide-overlay') || document.body.classList.contains('deck-fullscreen'));
  const state = (pg) => pg.evaluate(() => ({
    fullscreen: document.body.classList.contains('deck-fullscreen'),
    overlay: !!document.getElementById('html-slide-overlay'),
    label: (document.querySelector('#html-slide-overlay') || { textContent: '' }).textContent.slice(0, 60),
  }));

  const page = await ctx.newPage({ cookies: [cookie] });
  await page.goto(ctx.base + '/overview.html', { waitUntil: 'load' });
  await ctx.settle(page, 1200);
  const deck = page.frames().find((f) => /\/overview-deck\/deck\.html/.test(f.url()));
  ctx.check('the overview page embeds the first-party deck frame', !!deck, page.frames().map((f) => f.url().slice(-40)));
  ctx.check('baseline: no overlay open, not full-screen', (await overlayOpen(page)) === false, await state(page));

  // (1) same window, not the deck frame (e.source !== #deckframe.contentWindow)
  await page.evaluate(() => {
    window.postMessage({ type: 'deck-overlay', open: true }, '*');
    window.postMessage({ type: 'open-slide', url: '/overview-deck/agenda.html', label: 'Forged own-window' }, '*');
  });
  await ctx.sleep(500);
  const own = await state(page);
  ctx.check('a same-origin message from the top window itself (wrong source) is ignored', !own.fullscreen && !own.overlay, own);

  // (2) wrong origin: another origin's page holding a WindowProxy of the portal
  const attackerOrigin = 'http://attacker.p13.test';
  await page.context().route(attackerOrigin + '/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>attacker</title><p>attacker page</p>',
  }));
  const attacker = await page.context().newPage();
  attacker.on('dialog', (d) => d.dismiss().catch(() => {}));
  await attacker.goto(attackerOrigin + '/', { waitUntil: 'load' });
  const popupPromise = page.context().waitForEvent('page', { timeout: 15000 });
  await attacker.evaluate((url) => { window.__portal = window.open(url); }, ctx.base + '/overview.html');
  const popup = await popupPromise;
  const popupDialogs = [];
  popup.on('dialog', (d) => { popupDialogs.push(d.message().slice(0, 40)); d.dismiss().catch(() => {}); });
  await popup.waitForLoadState('load');
  await ctx.sleep(1500);
  await popup.evaluate(() => {
    window.__p13seen = [];
    window.addEventListener('message', (e) => window.__p13seen.push({ origin: e.origin, type: e.data && e.data.type }));
  });
  await attacker.evaluate(() => {
    window.__portal.postMessage({ type: 'deck-overlay', open: true }, '*');
    window.__portal.postMessage({ type: 'open-slide', url: 'https://attacker.example/x', label: 'Forged foreign origin' }, '*');
    window.__portal.postMessage({ type: 'open-slide', url: '/overview-deck/agenda.html', label: 'Forged foreign origin (deck path)' }, '*');
  });
  await ctx.sleep(700);
  const seen = await popup.evaluate(() => window.__p13seen);
  const foreign = await state(popup);
  ctx.check('the foreign-origin messages really reached the portal window (the check is not vacuous)', seen.length === 3 && seen.every((m) => m.origin === attackerOrigin), seen);
  ctx.check('foreign-origin deck-overlay / open-slide messages are ignored (no full-screen, no overlay, even for a deck path)', !foreign.fullscreen && !foreign.overlay, foreign);
  ctx.check('no dialog opened in the popup', popupDialogs.length === 0, popupDialogs);
  await attacker.close().catch(() => {});
  await popup.close().catch(() => {});

  // (3) correct source and origin (the deck frame) but a non-deck url
  const hostile = ['https://attacker.example/x', '//attacker.example/x.html', '/uploads/slides/p13-x.html', '/overview-deck/../x.html',
    '/overview-deck/agenda.html?x=1', '/overview-deck/sub/agenda.html', 'javascript:window.__xss=1'];
  for (const u of hostile) {
    await deck.evaluate((url) => parent.postMessage({ type: 'open-slide', url, label: 'Forged url' }, '*'), u);
  }
  await deck.evaluate(() => parent.postMessage({ type: 'open-slide', url: ['/overview-deck/agenda.html'], label: { x: 1 } }, '*'));
  await ctx.sleep(600);
  const bad = await state(page);
  ctx.check('open-slide from the deck frame with an off-deck / malformed url is ignored', !bad.overlay, { urls: hostile.length + 1, state: bad });

  // (4) positive control: the first-party deck still drives the relay
  await deck.evaluate(() => parent.postMessage({ type: 'deck-overlay', open: true }, '*'));
  await page.waitForFunction(() => document.body.classList.contains('deck-fullscreen'), null, { timeout: 5000 }).catch(() => {});
  ctx.check('control: a deck-overlay message from the deck frame still toggles full-screen', (await state(page)).fullscreen === true, await state(page));
  await deck.evaluate(() => parent.postMessage({ type: 'deck-overlay', open: false }, '*'));
  await deck.evaluate(() => parent.postMessage({ type: 'open-slide', url: '/overview-deck/agenda.html', label: 'Agenda' }, '*'));
  await page.waitForSelector('#html-slide-overlay', { timeout: 8000 }).catch(() => {});
  const ctl = await state(page);
  ctx.check('control: an open-slide for a first-party deck page from the deck frame still opens the overlay', ctl.overlay === true, ctl);
  ctx.check('control: the full-screen class was released again', ctl.fullscreen === false, ctl);

  await S.assertInert(ctx, page, 'overview page after the forged messages');
  const ev = await ctx.endpointViolations();
  ctx.check('GET /api/admin/csp-violations gained nothing during this scenario', ev.count === violationsBefore, { before: violationsBefore, after: ev.count, tuples: ev.violations.slice(0, 4) });
  ctx.say(`overviewRelay@${ctx.lane} (csp-mode=${ctx.cspMode}) forged=${3 + hostile.length + 1}`);
}

// ============================================================ slideSpellings
async function slideSpellings(ctx) {
  const fx = await ctx.fixture();
  const author = fx.users.author.cookie;
  const isDefaultDir = ctx.lane === 'dev-defaultdir';
  const dir = isDefaultDir ? path.join(S.REPO_ROOT, 'data', 'slides') : ctx.slidesDir;
  const dirExisted = fs.existsSync(dir);
  const before = listing(dir);
  const legacyDir = path.join(S.REPO_ROOT, 'public', 'uploads', 'slides');
  const legacyBefore = listing(legacyDir);
  const marker = 'P13-SPELLING-MARKER-' + crypto.randomBytes(5).toString('hex');
  const created = [];
  const violationsBefore = (await ctx.endpointViolations()).count;
  try {
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>p13 spellings</title></head><body><p>' + marker + '</p></body></html>';
    const up = await ctx.api(author, 'POST', '/api/slides/upload', { filename: 'p13-spelling.html', type: 'text/html', content: html });
    ctx.check('the probe slide uploads (200, /uploads/slides/<name>.html)', up.status === 200 && up.json && /^\/uploads\/slides\/[A-Za-z0-9._-]+\.html$/.test(up.json.url || ''), { status: up.status });
    const url = up.json && up.json.url;
    if (!url) throw new Error('slide upload returned no URL');
    const name = path.basename(url);
    created.push(name);

    const serve = async (label) => {
      const r = await rawGet(ctx.base, url, author);
      ctx.check(`${label}: the real slide serves 200 with the exact sandbox CSP and its bytes`,
        r.status === 200 && r.headers['content-security-policy'] === SLIDE_SANDBOX_CSP && r.body.toString('utf8').indexOf(marker) !== -1,
        { status: r.status, csp: String(r.headers['content-security-policy']).slice(0, 60) });
      ctx.check(`${label}: nosniff and no Report-Only header`, String(r.headers['x-content-type-options']).toLowerCase() === 'nosniff' && r.headers['content-security-policy-report-only'] === undefined, null);
    };
    await serve('before the spellings');

    const stem = name.replace(/\.html$/, '');
    const spellings = [
      ['%5C separator before the name', '/uploads/slides%5C' + name],
      ['%5C separators throughout', '/uploads%5Cslides%5C' + name],
      ['lower-case %5c', '/uploads%5cslides%5c' + name],
      ['literal backslash', '/uploads/slides\\' + name],
      ['trailing dot on the uploads segment', '/uploads./slides/' + name],
      ['trailing dot on the slides segment', '/uploads/slides./' + name],
      ['trailing dot on the file name', '/uploads/slides/' + name + '.'],
      ['trailing space (%20) on the slides segment', '/uploads/slides%20/' + name],
      ['alternate data stream ::$DATA', '/uploads/slides/' + name + '::$DATA'],
      ['$INDEX_ALLOCATION stream on the directory', '/uploads::$INDEX_ALLOCATION/slides/' + name],
      ['8.3 short name (~1) directory', '/UPLOAD~1/slides/' + name],
      ['8.3 short name (~1) file', '/uploads/slides/' + stem.slice(0, 6) + '~1.htm'],
      ['NUL byte (%00)', '/uploads/slides/' + name + '%00.png'],
      ['percent-encoded dot segments (%2e%2e)', '/uploads/slides/%2e%2e/slides/' + name],
      ['upper-case mount (/UPLOADS/Slides/)', '/UPLOADS/Slides/' + name],
    ];
    for (const [label, p] of spellings) {
      const withCookie = await rawGet(ctx.base, p, author);
      const anon = await rawGet(ctx.base, p, null);
      const leaked = withCookie.body.toString('utf8').indexOf(marker) !== -1 || anon.body.toString('utf8').indexOf(marker) !== -1;
      ctx.check(`spelling "${label}" is 404 with no slide bytes (signed in and anonymous)`,
        withCookie.status === 404 && anon.status === 404 && !leaked, { signedIn: withCookie.status, anonymous: anon.status, leaked });
    }
    await serve('after the spellings');
    const ev = await ctx.endpointViolations();
    ctx.check('GET /api/admin/csp-violations gained nothing during this scenario', ev.count === violationsBefore, { before: violationsBefore, after: ev.count });
    ctx.say(`slideSpellings@${ctx.lane} (csp-mode=${ctx.cspMode}) spellings=${spellings.length}`);
  } finally {
    if (isDefaultDir) {
      created.forEach((n) => { try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* already gone */ } });
      if (!dirExisted) { try { fs.rmdirSync(dir); } catch (e) { /* not empty or gone */ } }
      const after = listing(dir);
      ctx.check('default directory: data/slides listing identical before/after (probe slide removed by its returned name)', JSON.stringify(after) === JSON.stringify(before), { before, after });
      const legacyAfter = listing(legacyDir);
      ctx.check('default directory: nothing was ever written under public/uploads/slides', JSON.stringify(legacyAfter) === JSON.stringify(legacyBefore), { before: legacyBefore, after: legacyAfter });
    }
  }
}

// ============================================================ mediaUpload
// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function mediaUpload(ctx) {
  const fx = await ctx.fixture();
  const author = fx.users.author.cookie;
  const uploads = path.join(S.REPO_ROOT, 'public', 'uploads');
  const uploadsExisted = fs.existsSync(uploads);
  const before = listing(uploads);
  const run = 'p13m' + crypto.randomBytes(3).toString('hex');
  const createdIds = [];
  const createdFiles = [];
  const dataUrl = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
  const list0 = await ctx.api(author, 'GET', '/api/media');
  const count0 = Array.isArray(list0.json) ? list0.json.length : -1;
  try {
    const refusals = [
      ['.html', `${run}.html`, 'text/html', '<!doctype html><script>fetch("/api/auth/me")</script>'],
      ['.svg', `${run}.svg`, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'],
      ['.js', `${run}.js`, 'text/javascript', 'fetch("/api/auth/me");'],
      ['.html disguised by a double extension', `${run}.png.html`, 'image/png', '<script>1</script>'],
    ];
    for (const [label, fileName, mime, body] of refusals) {
      const r = await ctx.api(author, 'POST', '/api/media', { fileName, fileData: dataUrl(mime, body), kind: mime });
      ctx.check(`POST /api/media with ${label} answers 415 media-type-refused (fixed body)`,
        r.status === 415 && JSON.stringify(r.json) === JSON.stringify(MEDIA_REFUSALS.type), { status: r.status, body: r.json });
    }
    const mid = listing(uploads);
    ctx.check('the refusals stored nothing (public/uploads listing and the media list unchanged)',
      JSON.stringify(mid) === JSON.stringify(before) && (await ctx.api(author, 'GET', '/api/media')).json.length === count0, { before, mid });

    const ok = await ctx.api(author, 'POST', '/api/media', { fileName: `${run}.png`, fileData: dataUrl('image/png', Buffer.from(PNG_B64, 'base64')), kind: 'image/png' });
    ctx.check('POST /api/media with a PNG answers 200 and a /uploads/<name>.png URL',
      ok.status === 200 && ok.json && ok.json.success === true && ok.json.media && /^\/uploads\/[A-Za-z0-9_][A-Za-z0-9._-]*\.png$/.test(ok.json.media.url), { status: ok.status });
    const media = ok.json && ok.json.media;
    if (!media) throw new Error('png upload returned no media record');
    createdIds.push(media.id);
    createdFiles.push(path.basename(media.url));
    const got = await rawGet(ctx.base, media.url, author);
    ctx.check('the stored PNG is served 200 as image/png with nosniff and its own bytes',
      got.status === 200 && /^image\/png\b/i.test(String(got.headers['content-type'])) && String(got.headers['x-content-type-options']).toLowerCase() === 'nosniff' &&
      got.body.equals(Buffer.from(PNG_B64, 'base64')), { status: got.status, type: got.headers['content-type'], bytes: got.body.length });
    const del = await ctx.api(author, 'DELETE', '/api/media/' + encodeURIComponent(media.id));
    ctx.check('DELETE /api/media/:id answers 200 and removes the file', del.status === 200 && !fs.existsSync(path.join(uploads, createdFiles[0])), { status: del.status });
    const after = await ctx.api(author, 'GET', '/api/media');
    ctx.check('the media list is back to its baseline', Array.isArray(after.json) && after.json.length === count0, { before: count0, after: Array.isArray(after.json) ? after.json.length : null });
    ctx.say(`mediaUpload@${ctx.lane} (csp-mode=${ctx.cspMode}) refusals=${refusals.length}`);
  } finally {
    // The route's fixed location is this checkout's gitignored public/uploads: remove exactly what this run made.
    createdIds.forEach(() => { /* records are in the lane's temp store, discarded with it */ });
    createdFiles.forEach((n) => { try { fs.unlinkSync(path.join(uploads, n)); } catch (e) { /* already gone */ } });
    if (!uploadsExisted) { try { fs.rmdirSync(uploads); } catch (e) { /* not empty or gone */ } }
    const end = listing(uploads);
    ctx.check('public/uploads listing identical before/after the scenario (directory removed when this run created it)', JSON.stringify(end) === JSON.stringify(before), { before, after: end });
  }
}

module.exports = {
  urlFields, sessionEnd, overviewRelay, slideSpellings, mediaUpload,
  __lanes: {
    urlFields: ['real', 'dev'],
    sessionEnd: ['real', 'dev'],
    overviewRelay: ['real', 'dev'],
    slideSpellings: ['real', 'dev', 'dev-defaultdir'],
    mediaUpload: ['real', 'dev'],
  },
};
