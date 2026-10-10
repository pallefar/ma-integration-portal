// Phase 9 gap closure (plan 09-15, R5-03 / GD-11 / SC8): a REAL browser loading
// the Phase 9 pages requests every client asset changed since v2.1.0 under its
// NEW `?v=` stamp and receives 200. server.js serves /js and /css with a 30-day
// max-age, so a changed file reaches a returning browser only through a changed
// stamp (T-09-57 / T-09-41). Scenario module loaded by
// scripts/uat/phase9-walk.js.
//
// The expected stamp is not hard-coded here (it is bumped by every release
// that changes an asset): the scenario requires, per asset, that
//   (a) every request the browser made for it carries one numeric stamp,
//   (b) that stamp equals the stamp in the page's HTML on disk,
//   (c) it is strictly greater than the asset's pre-gap-closure floor below
//       (its v2.1.0 value and its value just before the 09-15 bump), and
//   (d) the response was 200 (a 304 would mean a cached copy was revalidated,
//       which a first load in a fresh context must never produce).

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', '..', 'public');

// asset URL path -> highest pre-gap-closure stamp (must be exceeded).
const ASSETS = {
  '/js/transitions.js': 1784900002,
};

// page -> assets that page must request under the new stamp.
const PAGES = {
  '/execution.html': ['/js/transitions.js'],
  '/org.html': ['/js/transitions.js'],
  '/due-diligence.html': ['/js/transitions.js'],
};

function diskStamp(page, asset) {
  const html = fs.readFileSync(path.join(PUBLIC, page.replace(/^\//, '')), 'utf8');
  const re = new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=([0-9]+)');
  const m = re.exec(html);
  return m ? Number(m[1]) : null;
}

module.exports = {
  'asset-stamps': async (ctx) => {
    for (const pagePath of Object.keys(PAGES)) {
      const page = await ctx.openTab({ user: 'karen' });
      const seen = []; // { url, status }
      page.on('response', (r) => {
        const u = r.url();
        if (u.indexOf('/js/') !== -1 || u.indexOf('/css/') !== -1) seen.push({ url: u.replace(ctx.base, ''), status: r.status() });
      });
      await page.goto(ctx.base + pagePath, { waitUntil: 'load' });
      await ctx.sleep(500);

      for (const asset of PAGES[pagePath]) {
        const hits = seen.filter((s) => s.url.split('?')[0] === asset);
        const stamps = Array.from(new Set(hits.map((h) => (/[?&]v=([^&]*)/.exec(h.url) || [])[1])));
        const disk = diskStamp(pagePath, asset);
        const label = `${pagePath} requests ${asset}`;
        ctx.check(label + ' (requested)', hits.length > 0, hits);
        ctx.check(label + ' (one numeric stamp)', stamps.length === 1 && /^[0-9]+$/.test(stamps[0] || ''), stamps);
        const stamp = Number(stamps[0]);
        ctx.check(label + ' (stamp matches the page on disk)', disk !== null && stamp === disk, { requested: stamp, disk });
        ctx.check(label + ' (stamp > pre-gap-closure ' + ASSETS[asset] + ')', stamp > ASSETS[asset], stamp);
        ctx.check(label + ' (200)', hits.length > 0 && hits.every((h) => h.status === 200), hits.map((h) => h.status));
      }
      ctx.check(pagePath + ' loaded without a page error', page.pageErrors.length === 0, page.pageErrors);
      await page.context().close();
    }
  },
};
