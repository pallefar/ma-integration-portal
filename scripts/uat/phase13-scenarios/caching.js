// caching - PRD acceptance 5 (SAFE-07 / D-13-06), D-13-07.
//
//   (1) /api responses of every status (200 / 401 / 403 / 404 / 409) carry
//       Cache-Control: no-store IN THE BROWSER'S VIEW (fetch() from a real
//       same-origin document, read from the Response object).
//   (2) a seeded Cache Storage entry named like the Transformers model cache
//       survives ten consecutive app page loads (the per-load wipe is gone).
//   (3) logging out through the UI clears Cache Storage, sessionStorage and every
//       localStorage key except the language preference, and the session is
//       really revoked.
'use strict';

const MODEL_CACHE = 'transformers-cache';
const PROBE_KEY = '/p13-model-probe';

async function browserFetch(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let text = '';
    try { text = await res.text(); } catch (e) { /* none */ }
    return { status: res.status, cacheControl: res.headers.get('cache-control'), text: text.slice(0, 200) };
  }, { method, url, body });
}

async function caching(ctx) {
  const fx = await ctx.fixture();
  const matrix = [];

  // ---- (1) no-store at every status, as the browser sees it -----------------
  const anon = await ctx.newPage({});
  await anon.goto(ctx.base + '/healthz', { waitUntil: 'load' });
  const adminPage = await ctx.newPage({ cookies: [fx.users.il.cookie] });
  await adminPage.goto(ctx.base + '/healthz', { waitUntil: 'load' });
  const empPage = await ctx.newPage({ cookies: [fx.users.emp.cookie] });
  await empPage.goto(ctx.base + '/healthz', { waitUntil: 'load' });

  const row = (status, route, r) => { matrix.push({ expected: status, status: r.status, route, cacheControl: r.cacheControl }); return r; };
  row(200, 'GET /api/auth/mode', await browserFetch(anon, 'GET', '/api/auth/mode'));
  row(401, 'GET /api/raid (no session)', await browserFetch(anon, 'GET', '/api/raid'));
  row(403, 'POST /api/raid (employee)', await browserFetch(empPage, 'POST', '/api/raid', { title: 'p13', type: 'risk', severity: 'low' }));
  row(404, 'DELETE /api/raid/:id (unknown)', await browserFetch(adminPage, 'DELETE', '/api/raid/p13-no-such-id?version=0'));
  const created = await browserFetch(adminPage, 'POST', '/api/raid', { title: 'P13 original', type: 'risk', severity: 'medium' });
  let entry = null;
  try { entry = JSON.parse(created.text).entry; } catch (e) { /* truncated body */ }
  if (!entry) {
    // body was clipped to 200 chars: re-read through the list route
    const list = await ctx.api(fx.users.il.cookie, 'GET', '/api/raid');
    const arr = Array.isArray(list.json) ? list.json : (list.json && (list.json.entries || list.json.raid)) || [];
    entry = arr.find((e) => e && e.title === 'P13 original') || null;
  }
  ctx.check('RAID entry created through the browser (201) for the 409 probe', created.status === 201 && !!(entry && entry.id), { status: created.status });
  if (entry && entry.id) {
    const edit = await browserFetch(adminPage, 'POST', '/api/raid', { id: entry.id, title: 'P13 first edit', version: 0 });
    ctx.check('first edit with version 0 succeeds (200)', edit.status === 200, { status: edit.status });
    row(409, 'POST /api/raid (stale version)', await browserFetch(adminPage, 'POST', '/api/raid', { id: entry.id, title: 'P13 stale', version: 0 }));
    await browserFetch(adminPage, 'DELETE', '/api/raid/' + encodeURIComponent(entry.id) + '?version=1');
  }
  matrix.forEach((m) => {
    ctx.check(`browser view: ${m.route} answered ${m.expected} with Cache-Control: no-store`,
      m.status === m.expected && /(^|[\s,])no-store([\s,]|$)/i.test(m.cacheControl || ''), { status: m.status, cacheControl: m.cacheControl });
  });

  // ---- (2) the model cache survives ten app page loads -----------------------
  const page = await ctx.newPage({ cookies: [fx.users.il.cookie] });
  await page.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
  await ctx.settle(page, 600);
  await page.evaluate(async ({ name, key }) => {
    const c = await caches.open(name);
    await c.put(key, new Response('p13-weights', { headers: { 'Content-Type': 'text/plain' } }));
  }, { name: MODEL_CACHE, key: PROBE_KEY });
  const seeded = await page.evaluate(async ({ name, key }) => ({ keys: await caches.keys(), has: !!(await (await caches.open(name)).match(key)) }), { name: MODEL_CACHE, key: PROBE_KEY });
  ctx.check('the model-cache probe entry is seeded', seeded.keys.indexOf(MODEL_CACHE) !== -1 && seeded.has, seeded);

  const paths = ['/dashboard.html', '/execution.html', '/due-diligence.html', '/org.html', '/index.html',
    '/dashboard.html', '/execution.html', '/due-diligence.html', '/org.html', '/index.html'];
  const survived = [];
  for (const p of paths) {
    await page.goto(ctx.base + p, { waitUntil: 'load' });
    await ctx.settle(page, 500);
    const st = await page.evaluate(async ({ name, key }) => {
      const keys = await caches.keys();
      return { keys, has: keys.indexOf(name) !== -1 && !!(await (await caches.open(name)).match(key)) };
    }, { name: MODEL_CACHE, key: PROBE_KEY });
    survived.push({ p, has: st.has });
  }
  ctx.check('the seeded transformers-cache entry survived ten consecutive app page loads', survived.length === 10 && survived.every((s) => s.has), survived.filter((s) => !s.has));

  // ---- (3) logout through the UI ---------------------------------------------
  await page.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
  await ctx.settle(page, 600);
  await page.evaluate(() => {
    sessionStorage.setItem('p13-session-note', 'secret-session-state');
    localStorage.setItem('p13-local-note', 'secret-local-state');
    localStorage.setItem('employeeLanguage', 'de');
  });
  let logoutHeaders = null;
  // allHeaders(): headers() omits the "extra info" headers Chromium reports separately.
  const logoutSeen = [];
  page.on('response', (r) => {
    if (r.url().indexOf('/api/auth/logout') !== -1) logoutSeen.push(r.allHeaders().then((h) => { logoutHeaders = h; }));
  });
  const link = page.locator('.sidebar-footer a', { hasText: 'Logout' }).first();
  await link.waitFor({ state: 'attached', timeout: 15000 });
  await link.evaluate((el) => el.click());
  await page.waitForURL('**/login.html', { timeout: 15000 });
  await ctx.settle(page, 500);
  ctx.check('the logout navigation landed on /login.html', new URL(page.url()).pathname === '/login.html', new URL(page.url()).pathname);
  const after = await page.evaluate(async () => ({
    caches: await caches.keys(),
    session: sessionStorage.length,
    local: Object.keys(localStorage),
    lang: localStorage.getItem('employeeLanguage'),
    sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  }));
  ctx.check('after logout: caches.keys() is empty (the model cache is cleared on purpose)', after.caches.length === 0, after.caches);
  ctx.check('after logout: sessionStorage is empty', after.session === 0, after.session);
  ctx.check('after logout: localStorage holds only the language key', after.local.every((k) => k === 'employeeLanguage'), after.local);
  ctx.check('after logout: the language preference itself survived', after.lang === 'de', after.lang);
  ctx.check('after logout: no service-worker registration remains', after.sw === 0, after.sw);
  await Promise.all(logoutSeen);
  ctx.check('the logout response carried Clear-Site-Data: "cache", "storage"', !!logoutHeaders && logoutHeaders['clear-site-data'] === '"cache", "storage"', logoutHeaders && logoutHeaders['clear-site-data']);
  // /api/auth/me answers 200 {authEnabled:true,user:null} for an unknown/revoked session.
  const me = await ctx.api(fx.users.il.cookie, 'GET', '/api/auth/me');
  ctx.check('the session is really revoked (the old cookie now resolves to no user)', me.status === 401 || (me.status === 200 && me.json && me.json.user === null), { status: me.status, user: me.json && me.json.user });

  const ev = await ctx.endpointViolations();
  ctx.check('GET /api/admin/csp-violations is empty after the caching walk', ev.count === 0, { count: ev.count, tuples: ev.violations.slice(0, 5) });
  const v = await ctx.pageViolations(page);
  ctx.check('no in-page securitypolicyviolation on the logout page', v.length === 0, v.slice(0, 4));
  ctx.say(`caching@${ctx.lane} statuses=${matrix.map((m) => m.status).join(',')} pageLoads=${survived.length} violations=${ev.count}`);
}

module.exports = { caching, __lanes: { caching: ['real', 'dev'] } };
