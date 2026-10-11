// slideSandbox - PRD acceptance 3 (SAFE-03 / D-13-04), D-13-07, B-1.
//
// An uploaded HTML slide runs hostile probes (fetch the session API, read
// document.cookie, touch parent.document, touch storage, beacon to the canary).
// Framed by the real openHtmlSlide() (sandbox="allow-scripts") AND opened
// top-level, every probe must fail; the slide is served with exactly
// SLIDE_SANDBOX_CSP + nosniff and no Report-Only header; refused uploads
// (.svg, .exe, over the library quota, over 10 MB) answer the fixed bodies and add
// no file.
//
// Lanes: real + dev use a runner-owned temp MA_SLIDES_UPLOAD_DIR (1 MB quota so
// the quota refusal is cheap). dev-defaultdir starts the child with
// MA_SLIDES_UPLOAD_DIR UNSET so the slide lands in the product's DEFAULT slide
// directory (B-1). Since the CR-A01 review fix (13-REVIEW-FIX-S) that default is
// OUTSIDE the public static root: `<instance data dir>/slides`, which for this
// non-real lane is `<repo>/data/slides` (gitignored, created 0700 at first
// upload). The slide is served only through the dedicated /uploads/slides mount;
// nothing may land in the old `public/uploads/slides` (the variant asserts that
// listing is unchanged). The variant deletes what it uploaded in `finally`
// (removing `data/slides` again when the run created it) and compares the slide
// directory listing before/after.
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./_shared');
const { SLIDE_SANDBOX_CSP, REFUSALS } = require(path.join(S.REPO_ROOT, 'lib', 'slideUpload.js'));

function probeHtml(canaryOrigin) {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>P13 slide probe</title></head><body>',
    '<h1 id="t">P13 slide probe</h1><pre id="out">pending</pre>',
    '<script>',
    '(async function () {',
    '  var r = {};',
    '  try { var x = await fetch("/api/auth/me", { credentials: "include" }); r.fetchApi = "REACHED:" + x.status; } catch (e) { r.fetchApi = "blocked:" + (e && e.name); }',
    '  try { r.cookie = "READ:" + String(document.cookie).length; } catch (e) { r.cookie = "blocked:" + (e && e.name); }',
    '  try { r.parentDoc = "READ:" + String(parent.document.title); } catch (e) { r.parentDoc = "blocked:" + (e && e.name); }',
    '  try { r.storage = "READ:" + localStorage.length; } catch (e) { r.storage = "blocked:" + (e && e.name); }',
    '  try { await fetch(' + JSON.stringify(canaryOrigin + '/slide-beacon') + ', { mode: "no-cors" }); r.beacon = "REACHED"; } catch (e) { r.beacon = "blocked:" + (e && e.name); }',
    '  try { new Image().src = ' + JSON.stringify(canaryOrigin + '/slide-img') + '; r.img = "attempted"; } catch (e) { r.img = "blocked:" + (e && e.name); }',
    '  r.origin = String(self.origin);',
    '  try { document.getElementById("out").textContent = JSON.stringify(r); } catch (e) {}',
    '  try { parent.postMessage({ p13: r }, "*"); } catch (e) {}',
    '})();',
    '</script></body></html>',
  ].join('\n');
}

function listing(dir) {
  try { return fs.readdirSync(dir).sort(); } catch (e) { return null; }
}

async function slideSandbox(ctx) {
  const fx = await ctx.fixture();
  const author = fx.users.author.cookie;
  const canary = ctx.canary;
  canary.reset();
  const isDefaultDir = ctx.lane === 'dev-defaultdir';
  const results = [];
  const chk = (step, cond, detail) => { ctx.check(step, cond, detail); results.push(!!cond); };

  // dev-defaultdir: the product's default slide directory is <instance data dir>/slides - for this
  // non-real lane <repo>/data/slides (db/dbFiles.js DATA_DIR; lib/slideUpload.js defaultSlidesDir()).
  // The other lanes use the runner-owned temp directory it passed in as MA_SLIDES_UPLOAD_DIR.
  const dir = isDefaultDir ? path.join(S.REPO_ROOT, 'data', 'slides') : ctx.slidesDir;
  const dirExisted = fs.existsSync(dir);
  const before = listing(dir);
  // The pre-CR-A01 location. Nothing may be written there any more (it is inside the public static root).
  const legacyDir = path.join(S.REPO_ROOT, 'public', 'uploads', 'slides');
  const legacyBefore = listing(legacyDir);
  const created = [];

  try {
    // ---- refusals first: they must add no file ---------------------------
    const svg = await ctx.api(author, 'POST', '/api/slides/upload', {
      filename: 'p13.svg', type: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>',
    });
    chk('.svg upload is refused with the fixed type body (415)', svg.status === 415 && JSON.stringify(svg.json) === JSON.stringify(REFUSALS.type), { status: svg.status, body: svg.json });
    const exe = await ctx.api(author, 'POST', '/api/slides/upload', {
      filename: 'p13.exe', type: 'application/x-msdownload', content: 'MZ\u0090\u0000\u0003 not a slide',
    });
    chk('.exe upload is refused with the fixed type body (415)', exe.status === 415 && JSON.stringify(exe.json) === JSON.stringify(REFUSALS.type), { status: exe.status, body: exe.json });
    const polyglot = await ctx.api(author, 'POST', '/api/slides/upload', {
      filename: 'p13-polyglot.html', type: 'text/html', encoding: 'base64', content: Buffer.from('%PDF-1.4\n<script>1</script>').toString('base64'),
    });
    chk('a PDF renamed .html is refused (magic bytes, 415)', polyglot.status === 415 && JSON.stringify(polyglot.json) === JSON.stringify(REFUSALS.type), { status: polyglot.status });
    chk('refused uploads added no file', JSON.stringify(listing(dir)) === JSON.stringify(before), { before, after: listing(dir) });

    // ---- the probe slide --------------------------------------------------
    const up = await ctx.api(author, 'POST', '/api/slides/upload', { filename: 'p13-probe.html', type: 'text/html', content: probeHtml(canary.origin) });
    chk('probe slide uploads (200 with a /uploads/slides/ URL)', up.status === 200 && up.json && /^\/uploads\/slides\/[A-Za-z0-9._-]+\.html$/.test(up.json.url || ''), { status: up.status });
    const slideUrl = up.json && up.json.url;
    if (!slideUrl) throw new Error('probe upload returned no URL');
    created.push(path.basename(slideUrl));
    chk('the uploaded file is in the expected slide directory', fs.existsSync(path.join(dir, path.basename(slideUrl))), { dir: isDefaultDir ? 'data/slides (the default, outside public/)' : 'runner temp dir' });
    if (isDefaultDir) {
      chk('default directory: the slide is NOT under the public static root (public/uploads/slides listing unchanged)',
        JSON.stringify(listing(legacyDir)) === JSON.stringify(legacyBefore) && !fs.existsSync(path.join(legacyDir, path.basename(slideUrl))),
        { before: legacyBefore, after: listing(legacyDir) });
    }

    // ---- served headers (node view of the exact response) -------------------
    const res = await fetch(ctx.base + slideUrl);
    const csp = res.headers.get('content-security-policy');
    chk('served slide carries exactly SLIDE_SANDBOX_CSP', csp === SLIDE_SANDBOX_CSP, { csp });
    chk('served slide carries X-Content-Type-Options: nosniff', (res.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff', null);
    chk('served slide carries no Report-Only header (PD-37)', res.headers.get('content-security-policy-report-only') === null, null);
    await res.arrayBuffer();
    if (isDefaultDir) {
      // 13-03 deviation 1: non-exact spellings of the prefix are answered 404, never served by the app static handler.
      const alt = await fetch(ctx.base + slideUrl.replace('/uploads/slides/', '/UPLOADS/Slides/'));
      const altCsp = alt.headers.get('content-security-policy');
      chk('a case-variant spelling is not served with the app CSP (404 or sandboxed)', alt.status === 404 || altCsp === SLIDE_SANDBOX_CSP, { status: alt.status });
      await alt.arrayBuffer();
    }

    // ---- framed: the real openHtmlSlide() ---------------------------------
    const who = fx.users.il;
    const host = await ctx.newPage({ cookies: [who.cookie] });
    await host.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
    await ctx.settle(host, 800);
    await host.evaluate(() => {
      window.__p13msg = [];
      window.addEventListener('message', (e) => { if (e.data && e.data.p13) window.__p13msg.push({ origin: e.origin, r: e.data.p13 }); });
    });
    await host.evaluate((u) => window.openHtmlSlide(u, 'P13 probe slide'), slideUrl);
    await host.waitForFunction(() => window.__p13msg && window.__p13msg.length > 0, null, { timeout: 20000 }).catch(() => {});
    const msgs = await host.evaluate(() => window.__p13msg.slice());
    chk('the framed slide reported its probe results via postMessage', msgs.length === 1, { n: msgs.length });
    const r = (msgs[0] && msgs[0].r) || {};
    const isBlocked = (v) => typeof v === 'string' && v.indexOf('blocked:') === 0;
    chk('framed: fetch("/api/auth/me") failed', isBlocked(r.fetchApi), r.fetchApi);
    chk('framed: document.cookie read failed', isBlocked(r.cookie), r.cookie);
    chk('framed: parent.document access failed', isBlocked(r.parentDoc), r.parentDoc);
    chk('framed: localStorage access failed', isBlocked(r.storage), r.storage);
    chk('framed: beacon fetch to the canary failed', isBlocked(r.beacon), r.beacon);
    chk('framed: the slide document has an opaque origin ("null")', r.origin === 'null' && msgs[0].origin === 'null', { self: r.origin, message: msgs[0] && msgs[0].origin });
    const frameInfo = await host.evaluate(() => {
      const f = document.querySelector('#html-slide-overlay iframe');
      return f ? { sandbox: f.getAttribute('sandbox'), src: f.getAttribute('src') } : null;
    });
    chk('framed: the overlay iframe is sandbox="allow-scripts" (no allow-same-origin)', !!frameInfo && frameInfo.sandbox === 'allow-scripts', frameInfo);
    await ctx.settle(host, 600);

    // The request log: nothing from the slide frame reached /api or the canary.
    const fromSlide = host.reqLog.filter((q) => q.frame.indexOf('/uploads/slides/') !== -1);
    const apiReached = fromSlide.filter((q) => q.url.indexOf('/api/') !== -1 && q.status !== undefined);
    const apiAttempted = fromSlide.filter((q) => q.url.indexOf('/api/') !== -1);
    chk('framed: no /api request from the slide frame reached the server', apiReached.length === 0,
      { attempted: apiAttempted.map((q) => q.method + ' ' + q.url.slice(-30) + ' ' + (q.failed || q.status)), reached: apiReached.length });
    chk('framed: no request from the slide frame reached the canary (log)', fromSlide.filter((q) => q.url.indexOf(canary.origin) === 0 && q.status !== undefined).length === 0,
      fromSlide.filter((q) => q.url.indexOf(canary.origin) === 0).map((q) => q.failed || q.status));
    chk('framed: canary server saw zero hits', canary.hits().length === 0, canary.hits().slice(0, 3));

    // ---- top-level: opened directly --------------------------------------
    canary.reset();
    const top = await ctx.newPage({ cookies: [who.cookie] });
    const nav = await top.goto(ctx.base + slideUrl, { waitUntil: 'load' });
    await top.waitForFunction(() => { const o = document.getElementById('out'); return o && o.textContent !== 'pending'; }, null, { timeout: 20000 }).catch(() => {});
    const topCsp = nav ? nav.headers()['content-security-policy'] : null;
    chk('top-level: the response CSP is exactly SLIDE_SANDBOX_CSP', topCsp === SLIDE_SANDBOX_CSP, { topCsp });
    let tr = {};
    try { tr = JSON.parse(await top.evaluate(() => document.getElementById('out').textContent)); } catch (e) { /* stays empty */ }
    chk('top-level: fetch("/api/auth/me") failed', isBlocked(tr.fetchApi), tr.fetchApi);
    chk('top-level: document.cookie read failed', isBlocked(tr.cookie), tr.cookie);
    chk('top-level: localStorage access failed', isBlocked(tr.storage), tr.storage);
    chk('top-level: beacon fetch to the canary failed', isBlocked(tr.beacon), tr.beacon);
    chk('top-level: the document origin is opaque ("null") even with no frame', tr.origin === 'null', tr.origin);
    chk('top-level: no request reached /api or the canary', top.reqLog.filter((q) => (q.url.indexOf('/api/') !== -1 || q.url.indexOf(canary.origin) === 0) && q.status !== undefined && q.frame.indexOf('/uploads/slides/') !== -1).length === 0, null);
    chk('top-level: canary server saw zero hits', canary.hits().length === 0, canary.hits().slice(0, 3));

    // ---- library limits (real + dev; the default directory is not filled) ----
    if (!isDefaultDir) {
      const big = '<!doctype html><html><body><!--' + 'x'.repeat(600 * 1024) + '--><p>big</p></body></html>';
      const b1 = await ctx.api(author, 'POST', '/api/slides/upload', { filename: 'p13-big-1.html', type: 'text/html', content: big });
      chk('a ~600 KB slide fits the 1 MB test quota (200)', b1.status === 200, { status: b1.status });
      if (b1.json && b1.json.url) created.push(path.basename(b1.json.url));
      const afterOne = listing(dir);
      const b2 = await ctx.api(author, 'POST', '/api/slides/upload', { filename: 'p13-big-2.html', type: 'text/html', content: big });
      chk('the next ~600 KB slide is refused: fixed quota body (413)', b2.status === 413 && JSON.stringify(b2.json) === JSON.stringify(REFUSALS.quota), { status: b2.status, body: b2.json });
      chk('the quota refusal added no file', JSON.stringify(listing(dir)) === JSON.stringify(afterOne), { before: afterOne, after: listing(dir) });
      const huge = '<!doctype html><html><body><!--' + 'x'.repeat(11 * 1024 * 1024) + '--></body></html>';
      const h = await ctx.api(author, 'POST', '/api/slides/upload', { filename: 'p13-huge.html', type: 'text/html', content: huge });
      chk('an 11 MB slide is refused: fixed too-large body (413)', h.status === 413 && JSON.stringify(h.json) === JSON.stringify(REFUSALS.tooLarge), { status: h.status, body: h.json });
      chk('the too-large refusal added no file', JSON.stringify(listing(dir)) === JSON.stringify(afterOne), { before: afterOne, after: listing(dir) });
    }

    const ev = await ctx.endpointViolations();
    chk('GET /api/admin/csp-violations is empty (the sandbox policy reports nothing, the app page stays clean)', ev.count === 0, { count: ev.count, tuples: ev.violations.slice(0, 5) });
  } finally {
    if (isDefaultDir) {
      // T-13-114: remove exactly what this run created, then prove the listing is back.
      created.forEach((n) => { try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* already gone */ } });
      if (!dirExisted) { try { fs.rmdirSync(dir); } catch (e) { /* not empty or gone */ } }
      const after = listing(dir);
      const same = JSON.stringify(after) === JSON.stringify(before);
      ctx.check('default directory: data/slides listing identical before/after (probe slide deleted by its returned name; directory removed when this run created it)', same, { before, after });
      results.push(same);
      const legacyAfter = listing(legacyDir);
      const legacySame = JSON.stringify(legacyAfter) === JSON.stringify(legacyBefore);
      ctx.check('default directory: public/uploads/slides listing identical before/after (nothing was ever written under public/)', legacySame, { before: legacyBefore, after: legacyAfter });
      results.push(legacySame);
    }
  }

  if (isDefaultDir && results.length && results.every(Boolean)) ctx.say('slideSandbox default-dir PASS');
  ctx.say(`slideSandbox@${ctx.lane} checks=${results.length} failed=${results.filter((x) => !x).length}`);
}

module.exports = { slideSandbox, __lanes: { slideSandbox: ['real', 'dev', 'dev-defaultdir'] } };
