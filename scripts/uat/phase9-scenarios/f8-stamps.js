// Phase 9 gap closure (plan 09-15, R5-03 / GD-11 / SC8): a REAL browser loading
// the Phase 9 pages requests every client asset changed since v2.1.0 under its
// NEW `?v=` stamp and receives 200. server.js serves /js and /css with a 30-day
// max-age, so a changed file reaches a returning browser only through a changed
// stamp (T-09-57 / T-09-41). Scenario module loaded by
// scripts/uat/phase9-walk.js.
//
// Phase 12 / 12-14 evidence refresh (orchestrator decision 2, D-12-07): the
// stamp is no longer a hand-bumped number but `?v=<first 16 hex of
// sha256(served bytes)>` (content-hash stamps, test/asset-cache-bust.test.js
// and the contentHashStamps scenario). The three numeric assertions this
// module made per asset - "one numeric stamp", "matches the page on disk as a
// number", "> pre-gap-closure floor" - are superseded by the stronger contract
// below. This is a DELIBERATE edit of this scenario module; the "requested" and
// "200" assertions are unchanged. The scenario now requires, per asset, that
//   (a) the browser requested it,
//   (b) every request carries exactly one stamp matching /^[0-9a-f]{16}$/,
//   (c) that stamp equals the stamp in the page's HTML AS SERVED (the checked-in
//       HTML on disk still carries the legacy numeric stamps; the server
//       rewrites them to content hashes at serve time),
//   (d) that stamp equals the first 16 hex of sha256 of the bytes the server
//       returns for that asset URL (fetched through the page's own session), and
//   (e) the response was 200 (a 304 would mean a cached copy was revalidated,
//       which a first load in a fresh context must never produce).

'use strict';

const crypto = require('crypto');

// page -> assets that page must request under the new stamp.
const PAGES = {
  '/execution.html': ['/css/style.css', '/js/transitions.js', '/js/execution.js'],
  '/org.html': ['/css/style.css', '/js/transitions.js', '/js/org.js'],
  '/due-diligence.html': ['/css/style.css', '/js/transitions.js', '/js/due-diligence.js'],
  // login.html does not load transitions.js; it is opened WITHOUT a session
  // (a signed-in session redirects away from it) in a fresh context.
  '/login.html': ['/css/style.css'],
};
const ANONYMOUS = { '/login.html': true };

function stampInHtml(html, asset) {
  const re = new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=([0-9a-f]+)');
  const m = re.exec(html);
  return m ? m[1] : null;
}

module.exports = {
  'asset-stamps': async (ctx) => {
    for (const pagePath of Object.keys(PAGES)) {
      let page = await ctx.openTab({ user: 'karen' });
      if (ANONYMOUS[pagePath]) {
        const browser = page.context().browser();
        await page.context().close();
        const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        page = await anonCtx.newPage();
        page.pageErrors = [];
        page.on('pageerror', (e) => page.pageErrors.push(String(e)));
      }
      const seen = []; // { url, status }
      page.on('response', (r) => {
        const u = r.url();
        if (u.indexOf('/js/') !== -1 || u.indexOf('/css/') !== -1) seen.push({ url: u.replace(ctx.base, ''), status: r.status() });
      });
      await page.goto(ctx.base + pagePath, { waitUntil: 'load' });
      await ctx.sleep(500);

      const servedHtml = await (await page.request.get(ctx.base + pagePath)).text();
      for (const asset of PAGES[pagePath]) {
        const hits = seen.filter((s) => s.url.split('?')[0] === asset);
        const stamps = Array.from(new Set(hits.map((h) => (/[?&]v=([^&]*)/.exec(h.url) || [])[1])));
        const inPage = stampInHtml(servedHtml, asset);
        const label = `${pagePath} requests ${asset}`;
        ctx.check(label + ' (requested)', hits.length > 0, hits);
        const stamp = stamps[0] || '';
        ctx.check(label + ' (one 16-hex content-hash stamp)', stamps.length === 1 && /^[0-9a-f]{16}$/.test(stamp), stamps);
        ctx.check(label + ' (stamp matches the page as served)', inPage !== null && stamp === inPage, { requested: stamp, inPage });
        let served = null;
        if (hits.length > 0) {
          const res = await page.request.get(ctx.base + hits[0].url);
          served = res.status() === 200
            ? crypto.createHash('sha256').update(await res.body()).digest('hex').slice(0, 16)
            : 'status-' + res.status();
        }
        ctx.check(label + ' (stamp = first 16 hex of sha256 of the served bytes)', served !== null && stamp === served, { requested: stamp, served });
        ctx.check(label + ' (200)', hits.length > 0 && hits.every((h) => h.status === 200), hits.map((h) => h.status));
      }
      ctx.check(pagePath + ' loaded without a page error', page.pageErrors.length === 0, page.pageErrors);
      await page.context().close();
    }
  },
};
