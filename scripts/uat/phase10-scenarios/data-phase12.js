// Phase 12 plan 12-14: browser + API evidence for the data-layer contracts that
// are visible from a page session (DATA-02, DATA-04, DATA-05, QUAL-01). Loaded
// by scripts/uat/phase10-walk.js (the runner contract: scenario modules export
// `{ name: async (ctx) => ... }` plus `__lanes`; later plans ADD modules and
// never edit the runner or another plan's module).
//
// Lanes
//   real   ddPageOneRequest, raidPagedApi, auditSealFlow: a real deal
//          (MA_MODE=real), an Integration Leader account (hrbp: every DD area),
//          every assertion made from the account's OWN session.
//   dev    contentHashStamps: the committed showcase pages, fetched through a
//          browser page; every `?v=` stamp must equal the first 16 hex of the
//          sha256 of the bytes served at that URL.
//
// Contract, not implementation: every assertion names a status code, a body
// field, a request path or a visible string; nothing here reads the stamper,
// the list parser or the audit lifecycle to decide an expectation.
//
// Hygiene (T-12-131): every account/deal/record is synthetic. Temporary and
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

// The evidence directory is capped (<= 1200 KB for the whole directory). The
// Phase 10 runner's own shot() is JPEG q60; this module uses q28 like the
// Phase 11 module so the shots of this plan fit the same cap.
const SHOT_QUALITY = 28;
async function snap(ctx, page, name) {
  const file = path.join(ctx.outDir, name + '.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: SHOT_QUALITY, fullPage: false });
  return file;
}

// A fetch made by the page itself from a neutral same-origin document (/healthz
// is a plain JSON document that is always served): it carries the browser
// context's own session cookie and nothing from the app's scripts.
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

// ------------------------------------------------------- real-lane fixture
// One deal + one Integration Leader account per real-lane server, built once
// and shared by the real-lane scenarios (they run sequentially on one server).
const fixtures = new Map();

async function buildFixture(ctx) {
  const adminCookie = await ctx.adminLogin();
  const username = 'p12.il';
  const created = await ctx.api(adminCookie, 'POST', '/api/admin/users', { username, name: 'Phase Twelve IL', role: 'hrbp' });
  if (created.status !== 201 || !created.json || !created.json.tempPassword) {
    throw new Error('account create failed for ' + username + ': ' + created.status);
  }
  const first = await ctx.loginFull(username, created.json.tempPassword);
  const next = secret('Rot-');
  const ch = await ctx.api(first.cookie, 'POST', '/api/auth/change-password', { currentPassword: created.json.tempPassword, newPassword: next });
  if (ch.status !== 200) throw new Error('forced rotation failed for ' + username + ': ' + ch.status);
  const ilCookie = cookieOf(ch.headers) || first.cookie;

  const deal = await ctx.api(adminCookie, 'POST', '/api/deals', {
    name: 'Phase 12 evidence deal',
    targetCompany: 'Synthetic Phase Twelve Target Co',
    members: [username],
  });
  if (deal.status !== 200 || !deal.json || !deal.json.deal || !deal.json.deal.id) {
    throw new Error('deal create failed: ' + deal.status + ' ' + JSON.stringify(deal.json));
  }
  const dealId = deal.json.deal.id;
  for (const [who, cookie] of [['admin', adminCookie], [username, ilCookie]]) {
    const sel = await ctx.api(cookie, 'POST', '/api/deals/select', { dealId });
    if (sel.status !== 200) throw new Error('deal select failed for ' + who + ': ' + sel.status);
  }
  return { dealId, il: { cookie: ilCookie, username }, admin: { cookie: adminCookie } };
}

function fixtureFor(ctx) {
  if (!fixtures.has(ctx.base)) fixtures.set(ctx.base, buildFixture(ctx));
  return fixtures.get(ctx.base);
}

// Only the requests of `/api/dd/` from a page's request log, as "METHOD path".
function ddRequests(page, from) {
  return page.apiRequests.slice(from || 0)
    .filter((r) => r.url.indexOf('/api/dd/') === 0)
    .map((r) => `${r.method} ${r.url.split('?')[0]}`);
}

// ------------------------------------------------------------ the scenarios
module.exports = {
  __lanes: {
    ddPageOneRequest: ['real'],
    raidPagedApi: ['real'],
    auditSealFlow: ['real'],
    contentHashStamps: ['dev'],
  },

  // D-12-02 / PD-16 (DATA-02, PRD acceptance 2 / SC2: "DD page 18 requests -> 1").
  // The browser network log of a due-diligence.html load holds exactly ONE
  // /api/dd/ request, GET /api/dd/workspace; an edit adds the write and exactly
  // one more workspace read (the refresh), never the old 17-request fan-out.
  async ddPageOneRequest(ctx) {
    const f = await fixtureFor(ctx);

    // Seed one request item in the first cleared area via the IL's own session.
    const ilPage = await neutralPage(ctx, f.il.cookie);
    const areas = await pageFetch(ilPage, 'GET', '/api/dd/areas');
    const areaId = Array.isArray(areas.json) && areas.json.length ? areas.json[0].id : null;
    ctx.check('the Integration Leader reads all DD areas (200, 8 areas)', areas.status === 200 && Array.isArray(areas.json) && areas.json.length === 8,
      { status: areas.status, areas: Array.isArray(areas.json) ? areas.json.length : null });
    const item = await pageFetch(ilPage, 'POST', '/api/dd/request-items', { area: areaId, text: 'P12 evidence request item', owner: 'p12.il' });
    ctx.check('fixture: the IL files a request item (201/200)', item.status === 201 || item.status === 200, item.status);

    const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [f.il.cookie] });
    const seen = [];
    page.on('response', (r) => {
      const u = r.url();
      if (u.indexOf(ctx.base) === 0) seen.push({ url: u.slice(ctx.base.length), status: r.status(), method: r.request().method() });
    });

    await page.goto(ctx.base + '/due-diligence.html', { waitUntil: 'load' });
    await ctx.sleep(2600);
    const landed = new URL(page.url()).pathname;
    const onLoad = ddRequests(page);
    ctx.check('PRD acceptance 2 / SC2: the due-diligence page load issues exactly ONE /api/dd/ request',
      onLoad.length === 1, onLoad);
    ctx.check('that request is GET /api/dd/workspace', onLoad[0] === 'GET /api/dd/workspace', onLoad);
    ctx.check('the page stays on /due-diligence.html and raises no page error',
      landed === '/due-diligence.html' && page.pageErrors.length === 0, { landed, pageErrors: page.pageErrors });
    const refused = seen.filter((r) => r.status === 401 || r.status === 403 || r.status >= 500);
    ctx.check('no 401/403/5xx during the page load', refused.length === 0, refused.map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`));
    const itemShown = await page.evaluate(() => /P12 evidence request item/.test(document.body.innerText));
    ctx.check('the seeded request item is rendered from that single response', itemShown === true, { itemShown });
    await snap(ctx, page, 'p12-dd-page-1440');

    // Edit the item's status: the write, then exactly one workspace read.
    const before = page.apiRequests.length;
    const sel = page.locator('.dd-item select').first();
    const target = await sel.evaluate((s) => {
      const vals = Array.from(s.options).map((o) => o.value);
      return vals.find((v) => v !== s.value) || null;
    });
    ctx.check('a status control with at least two options is present', !!target, { target });
    if (target) {
      await sel.selectOption(target);
      await ctx.sleep(2000);
      const after = ddRequests(page, before);
      ctx.check('after one status change: exactly [POST /api/dd/request-items, GET /api/dd/workspace]',
        after.length === 2 && after[0] === 'POST /api/dd/request-items' && after[1] === 'GET /api/dd/workspace', after);
      const bad = seen.filter((r) => r.status === 409 || r.status >= 500);
      ctx.check('the edit raised no 409 and no 5xx', bad.length === 0, bad.map((r) => `${r.method} ${r.url.split('?')[0]} ${r.status}`));
    }

    // Phone width: the same one-request contract on a reload.
    await page.setViewportSize({ width: ctx.viewports.phone.width, height: ctx.viewports.phone.height });
    const mark = page.apiRequests.length;
    await page.reload({ waitUntil: 'load' });
    await ctx.sleep(2600);
    const phone = ddRequests(page, mark);
    ctx.check('390 px reload: exactly ONE /api/dd/ request (GET /api/dd/workspace)',
      phone.length === 1 && phone[0] === 'GET /api/dd/workspace', phone);
    const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    ctx.pass('OBSERVATION (not an assertion): 390 px horizontal overflow of the DD page', overflow);
    await snap(ctx, page, 'p12-dd-page-390');
    await page.close();
  },

  // D-12-02 / PD-12 (DATA-02, PRD acceptance 2 / SC2): paged list API through a real
  // page session. `?limit=` -> {items,total}; no parameter -> the legacy array.
  async raidPagedApi(ctx) {
    const f = await fixtureFor(ctx);
    const page = await neutralPage(ctx, f.il.cookie);
    const created = [];
    for (let i = 1; i <= 7; i++) {
      const r = await pageFetch(page, 'POST', '/api/raid', { title: `P12 paged RAID entry ${i}`, type: 'risk', severity: 'medium' });
      created.push(r.status);
    }
    ctx.check('fixture: seven RAID entries filed (201)', created.every((c) => c === 201), created);

    const paged = await pageFetch(page, 'GET', '/api/raid?limit=5');
    ctx.check('GET /api/raid?limit=5 -> 200 {items,total}, 5 items, total >= 7',
      paged.status === 200 && !!paged.json && Array.isArray(paged.json.items) && paged.json.items.length === 5
        && typeof paged.json.total === 'number' && paged.json.total >= 7,
      { status: paged.status, items: paged.json && paged.json.items ? paged.json.items.length : null, total: paged.json && paged.json.total });
    const legacy = await pageFetch(page, 'GET', '/api/raid');
    ctx.check('GET /api/raid (no list parameter) -> 200 and the legacy bare array',
      legacy.status === 200 && Array.isArray(legacy.json), { status: legacy.status, isArray: Array.isArray(legacy.json) });
    ctx.check('the paged total equals the length of the unparameterized array',
      Array.isArray(legacy.json) && paged.json && paged.json.total === legacy.json.length,
      { total: paged.json && paged.json.total, length: Array.isArray(legacy.json) ? legacy.json.length : null });
    const page2 = await pageFetch(page, 'GET', '/api/raid?limit=5&offset=5');
    const ids1 = new Set(((paged.json && paged.json.items) || []).map((x) => x.id));
    const overlap = ((page2.json && page2.json.items) || []).filter((x) => ids1.has(x.id));
    ctx.check('the second page (offset=5) is disjoint from the first and holds the remainder',
      page2.status === 200 && !!page2.json && Array.isArray(page2.json.items) && page2.json.items.length >= 2 && overlap.length === 0,
      { status: page2.status, items: page2.json && page2.json.items ? page2.json.items.length : null, overlap: overlap.length });
    const bad = await pageFetch(page, 'GET', '/api/raid?limit=banana');
    ctx.check('an invalid list parameter is a 400 (never a 500)', bad.status === 400, bad.status);
  },

  // D-12-04 (DATA-04, PRD acceptance 4 / SC4): archive -> seal -> status -> viewer,
  // from an admin session. The seal records a sha256 and the viewer's
  // `?deal=` filter returns rows tagged with that deal's partition.
  async auditSealFlow(ctx) {
    const adminCookie = await ctx.adminLogin();
    const deal = await ctx.api(adminCookie, 'POST', '/api/deals', {
      name: 'Phase 12 sealed-audit deal', targetCompany: 'Synthetic Sealed Target Co', members: [],
    });
    const dealId = deal.json && deal.json.deal && deal.json.deal.id;
    ctx.check('fixture: admin creates a deal (200)', deal.status === 200 && !!dealId, deal.status);
    const sel = await ctx.api(adminCookie, 'POST', '/api/deals/select', { dealId });
    ctx.check('fixture: admin selects the deal (200)', sel.status === 200, sel.status);

    const writes = [];
    for (let i = 1; i <= 3; i++) writes.push((await ctx.api(adminCookie, 'POST', '/api/raid', { title: `P12 sealed RAID ${i}`, type: 'risk', severity: 'low' })).status);
    for (let i = 1; i <= 2; i++) writes.push((await ctx.api(adminCookie, 'POST', '/api/integration-tasks', { title: `P12 sealed task ${i}` })).status);
    ctx.check('fixture: five audited writes land (201)', writes.every((c) => c === 201), writes);

    const before = await ctx.api(adminCookie, 'GET', `/api/admin/deals/${dealId}/audit`);
    ctx.check('status before sealing: partition exists with rows, sealed false',
      before.status === 200 && before.json && before.json.exists === true && before.json.rows >= 5 && before.json.sealed === false,
      before.json && { exists: before.json.exists, rows: before.json.rows, sealed: before.json.sealed });
    const early = await ctx.api(adminCookie, 'POST', `/api/admin/deals/${dealId}/audit/purge`, { confirm: dealId });
    ctx.check('purge of an unsealed partition is refused 409 (not-sealed)', early.status === 409 && early.json && early.json.reason === 'not-sealed',
      { status: early.status, reason: early.json && early.json.reason });

    const wrongConfirm = await ctx.api(adminCookie, 'POST', `/api/admin/deals/${dealId}/audit/seal`, { confirm: 'nope' });
    ctx.check('seal needs the deal id as confirmation (400 on a mismatch)', wrongConfirm.status === 400, wrongConfirm.status);

    const arch = await ctx.api(adminCookie, 'POST', `/api/admin/deals/${dealId}/archive`, { confirm: dealId });
    ctx.check('admin archives the deal (200)', arch.status === 200, arch.status);
    const seal = await ctx.api(adminCookie, 'POST', `/api/admin/deals/${dealId}/audit/seal`, { confirm: dealId });
    ctx.check('admin seals the archived deal\'s audit partition (200, sha256, rows >= 5)',
      seal.status === 200 && seal.json && /^[0-9a-f]{64}$/.test(String(seal.json.sha256)) && seal.json.rows >= 5,
      { status: seal.status, rows: seal.json && seal.json.rows, error: seal.json && seal.json.error });
    const after = await ctx.api(adminCookie, 'GET', `/api/admin/deals/${dealId}/audit`);
    const st = after.json || {};
    ctx.check('status after sealing: sealed, read-only, file matches the recorded seal sha256',
      after.status === 200 && st.sealed === true && st.writable === false && st.fileMatchesSeal === true
        && !!seal.json && st.sealedSha256 === seal.json.sha256 && st.dealState === 'archived',
      { status: after.status, sealed: st.sealed, writable: st.writable, fileMatchesSeal: st.fileMatchesSeal, dealState: st.dealState });
    const events = Array.isArray(st.events) ? st.events.map((e) => e.action) : [];
    ctx.check('the lifecycle events include audit-partition-sealed and the early purge refusal',
      events.indexOf('audit-partition-sealed') !== -1 && events.indexOf('audit-partition-purge-refused') !== -1, events);

    const again = await ctx.api(adminCookie, 'POST', `/api/admin/deals/${dealId}/audit/seal`, { confirm: dealId });
    ctx.check('a repeated seal is idempotent (200, same sha256)', again.status === 200 && again.json && again.json.sha256 === (seal.json && seal.json.sha256),
      { status: again.status });

    const rowsRes = await ctx.api(adminCookie, 'GET', `/api/admin/audit?deal=${encodeURIComponent(dealId)}&limit=200`);
    const rows = Array.isArray(rowsRes.json) ? rowsRes.json : [];
    const own = rows.filter((r) => r.partition === dealId);
    const stray = rows.filter((r) => r.partition !== dealId && r.partition !== 'control' && r.partition !== 'legacy');
    ctx.check('admin viewer ?deal= returns rows tagged with that deal\'s partition (>= 5)', rowsRes.status === 200 && own.length >= 5,
      { status: rowsRes.status, total: rows.length, partitionRows: own.length });
    ctx.check('no row of another deal\'s partition appears', stray.length === 0, stray.map((r) => r.partition));
    ctx.check('the control-plane trail for the deal shows archive and seal',
      rows.some((r) => r.partition === 'control' && r.action === 'deal-archive')
        && rows.some((r) => r.partition === 'control' && r.action === 'audit-partition-sealed'),
      Array.from(new Set(rows.filter((r) => r.partition === 'control').map((r) => r.action))));

    // The audit tab of the admin console, filtered to the deal (1440).
    const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [adminCookie] });
    await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
    await ctx.sleep(2600);
    await page.evaluate(() => {
      const b = document.getElementById('admin-tab-btn-audit');
      if (b) { b.style.display = ''; b.click(); }
    });
    await ctx.sleep(600);
    await page.fill('#audit-filter-deal', dealId);
    await page.click('#btn-audit-filter');
    await ctx.sleep(1500);
    const shown = await page.evaluate(() => {
      const list = document.getElementById('audit-log-list');
      return { rows: list ? list.querySelectorAll('.cms-row').length : 0, text: list ? list.innerText.slice(0, 4000) : '' };
    });
    ctx.check('the admin audit tab lists the sealed deal\'s rows (>= 5)', shown.rows >= 5, { rows: shown.rows });
    ctx.check('the listed rows name the deal id', shown.text.indexOf(dealId) !== -1, null);
    ctx.check('no page error on the admin audit tab', page.pageErrors.length === 0, page.pageErrors);
    await snap(ctx, page, 'p12-admin-audit-sealed-1440');
    await page.close();
  },

  // QUAL-01 / D-12-07 (PRD acceptance 6, SC6): the committed showcase pages
  // carry content-hash stamps. Every local /js or /css reference of every
  // public/*.html, fetched through a browser page, has a `?v=` equal to the
  // first 16 hex of the sha256 of the bytes served at that URL.
  async contentHashStamps(ctx) {
    const publicDir = path.join(__dirname, '..', '..', '..', 'public');
    const pages = fs.readdirSync(publicDir).filter((n) => n.endsWith('.html')).sort();
    const page = await neutralPage(ctx, null);
    const out = await page.evaluate(async (pageNames) => {
      const hex = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      const re = /(?:src|href)="(\/(?:js|css)\/[^"?#]+)(\?[^"#]*)?"/g;
      const result = { pages: 0, refs: 0, stamped: 0, mismatches: [], unstamped: [], failedPages: [], failedRefs: [], cacheControl: {} };
      const hashOf = {};
      for (const name of pageNames) {
        const res = await fetch('/' + name);
        if (res.status !== 200) { result.failedPages.push(name + ' ' + res.status); continue; }
        result.pages += 1;
        result.cacheControl[name] = res.headers.get('cache-control');
        const text = await res.text();
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
          result.refs += 1;
          const url = m[1];
          const stampMatch = /[?&]v=([0-9a-f]+)/.exec(m[2] || '');
          if (!stampMatch) { result.unstamped.push(name + ' ' + url); continue; }
          result.stamped += 1;
          const full = url + m[2];
          if (!(full in hashOf)) {
            const r = await fetch(full);
            if (r.status !== 200) { hashOf[full] = null; result.failedRefs.push(full + ' ' + r.status); continue; }
            hashOf[full] = (await hex(await r.arrayBuffer())).slice(0, 16);
          }
          if (hashOf[full] !== null && hashOf[full] !== stampMatch[1]) result.mismatches.push(`${name} ${url} stamp=${stampMatch[1]} body=${hashOf[full]}`);
        }
      }
      result.distinctUrls = Object.keys(hashOf).length;
      return result;
    }, pages);
    ctx.check(`every public/*.html is served (200): ${pages.length} pages`, out.failedPages.length === 0 && out.pages === pages.length,
      { pages: out.pages, failed: out.failedPages });
    ctx.check('every HTML page is served Cache-Control: no-cache',
      Object.keys(out.cacheControl).every((n) => /no-cache/.test(out.cacheControl[n] || '')),
      Object.keys(out.cacheControl).filter((n) => !/no-cache/.test(out.cacheControl[n] || '')));
    ctx.check('the pages carry stamped js/css references', out.stamped > 0, { refs: out.refs, stamped: out.stamped, distinctUrls: out.distinctUrls });
    ctx.check('every ?v= stamp equals the first 16 hex of sha256 of the body served at that URL', out.mismatches.length === 0 && out.failedRefs.length === 0,
      { mismatches: out.mismatches.slice(0, 10), failedRefs: out.failedRefs.slice(0, 10), checked: out.stamped });
    ctx.check('no local js/css reference is left without a stamp', out.unstamped.length === 0, out.unstamped.slice(0, 10));
    await page.close();
  },
};
