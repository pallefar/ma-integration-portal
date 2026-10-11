// egress + transformersImport - PRD acceptance 4 (SAFE-06 / D-13-05), D-13-07.
//
// egress
//   real        every request of the IL / admin / employee walk is same-origin
//               and the served CSP names no third-party origin (defaults: all
//               channels off); the admin panel then switches youtube and
//               huggingface on, the NEXT response's CSP gains exactly the PD-9
//               origins and the employee video / model dialog change behaviour;
//               switched back, everything returns to the all-off policy.
//   dev, demo-open
//               the showcase is unchanged: the employee video still builds its
//               YouTube thumbnail + embed, the model dialog offers the downloads,
//               and the CSP equals the all-on policy.
// Nothing leaves the host: the runner answers every non-app, non-canary request
// locally (page.externalBlocked) while the attempt stays visible in page.reqLog.
//
// transformersImport (demo-open, huggingface on; PD-44 / W-1)
//   the vendored bundle imports under the active policy AND WebAssembly.compile of
//   /vendor/transformers/ort-wasm-simd.wasm resolves (no model download, no
//   network beyond same-origin) with no securitypolicyviolation in-page or on
//   the endpoint. The threaded worker path (importScripts(blob:)) is NOT
//   exercised - recorded as unverified for 13-13 / 13-14.
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./_shared');

const VIDEO_ID = 'dQw4w9WgXcQ';
const csp = require(path.join(S.REPO_ROOT, 'lib', 'csp.js'));

function expectedCsp(ctx, egress) {
  const prev = process.env.CSP_MODE;
  process.env.CSP_MODE = ctx.cspMode;
  try { return Object.assign({}, csp.headersFor({ egress })); } finally {
    if (prev === undefined) delete process.env.CSP_MODE; else process.env.CSP_MODE = prev;
  }
}

function headerPair(res) {
  return {
    'Content-Security-Policy': res.headers.get('content-security-policy'),
    'Content-Security-Policy-Report-Only': res.headers.get('content-security-policy-report-only'),
  };
}

// The header map of a real response, reduced to the keys the policy emits.
function samePolicy(actual, expected) {
  return Object.keys(expected).every((k) => actual[k] === expected[k]) &&
    Object.keys(actual).every((k) => actual[k] === null || expected[k] === actual[k]);
}

function externalRequests(ctx, page) {
  const out = [];
  page.reqLog.forEach((q) => {
    if (/^(data|blob|about):/i.test(q.url)) return;
    let origin = '';
    try { origin = new URL(q.url).origin; } catch (e) { origin = q.url; }
    if (origin !== ctx.base) out.push(q.method + ' ' + q.url.slice(0, 90));
  });
  return out;
}

async function openPage(ctx, who, p, label) {
  const page = await ctx.newPage({ cookies: [who.cookie] });
  await page.goto(ctx.base + p, { waitUntil: 'load' });
  await ctx.settle(page, 1500);
  const landed = new URL(page.url()).pathname;
  ctx.check(`${label}: stays on ${p}`, landed === p, landed);
  return page;
}

async function savePanel(ctx, admin, wanted) {
  const page = await ctx.newPage({ cookies: [admin.cookie] });
  await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
  await page.waitForSelector('.admin-tab-btn[data-tab="system"]', { state: 'visible', timeout: 15000 });
  await page.click('.admin-tab-btn[data-tab="system"]');
  await page.waitForSelector('#egress-panel #egress-youtube', { timeout: 15000 });
  for (const key of Object.keys(wanted)) {
    const box = page.locator('#egress-' + key);
    if ((await box.isChecked()) !== wanted[key]) await box.setChecked(wanted[key]);
  }
  await page.click('#egress-panel button.btn-primary');
  await page.waitForFunction(() => {
    const s = document.querySelector('#egress-panel [role="status"]');
    return s && s.textContent === 'Saved';
  }, null, { timeout: 10000 });
  const state = await page.evaluate(() => ({
    youtube: document.getElementById('egress-youtube').checked,
    huggingface: document.getElementById('egress-huggingface').checked,
    gemini: document.getElementById('egress-gemini').checked,
  }));
  return state;
}

async function videoState(ctx, who) {
  const page = await openPage(ctx, who, '/employee.html', 'employee page');
  const state = await page.evaluate(() => ({
    off: !!document.getElementById('welcome-video-egress-off'),
    playVisible: (() => { const b = document.getElementById('btn-play-video'); return !!b && b.style.display !== 'none'; })(),
    bg: (document.querySelector('.video-wrapper') || { style: {} }).style.backgroundImage || '',
  }));
  const yt = page.reqLog.filter((q) => /youtube\.com|ytimg\.com/.test(q.url));
  return { page, state, yt };
}

// The scenario changes settings of the lane's store (a YouTube welcome video in the real lane, the AI-model
// prompt in the showcase lanes) to make the egress behaviour observable. Those are put back afterwards: a
// full multi-scenario run shares one lane server, and a left-over `browserModel: 'none'` opens the AI-Insight
// activation dialog over every later visitor's dashboard (it intercepted storedXss's sidebar click).
async function egress(ctx) {
  const fx = await ctx.fixture();
  const admin = fx.users.admin;
  const before = await ctx.api(admin.cookie, 'GET', '/api/settings');
  const original = (before.json && typeof before.json === 'object') ? before.json : {};
  try {
    await egressWalk(ctx);
  } finally {
    const restore = ctx.lane === 'real'
      ? { welcomeVideoType: original.welcomeVideoType || 'local', welcomeVideoUrl: original.welcomeVideoUrl || '' }
      : (original.browserModel !== undefined ? { browserModel: original.browserModel } : null);
    if (restore) {
      const r = await ctx.api(admin.cookie, 'POST', '/api/settings', restore);
      ctx.check('the settings this scenario changed are restored for the scenarios that follow in the lane', r.status === 200, { status: r.status, keys: Object.keys(restore) });
    }
  }
}

async function egressWalk(ctx) {
  const fx = await ctx.fixture();
  const admin = fx.users.admin;
  const isReal = ctx.lane === 'real';

  // A real deal ships no welcome video, so the admin configures a YouTube one to
  // make the egress behaviour observable. The showcase lanes keep the video the
  // demo data already carries (the point is that it still works unchanged); the
  // throw-away copy only gets the AI-model prompt re-armed (browserModel 'none')
  // so the activation dialog can be observed with Hugging Face on.
  if (isReal) {
    const setVideo = await ctx.api(admin.cookie, 'POST', '/api/settings', { welcomeVideoType: 'youtube', welcomeVideoUrl: VIDEO_ID });
    ctx.check('admin set a YouTube welcome video (settings POST)', setVideo.status === 200, { status: setVideo.status });
  } else {
    const arm = await ctx.api(admin.cookie, 'POST', '/api/settings', { browserModel: 'none' });
    ctx.check('showcase copy: AI-model prompt re-armed on the throw-away database (browserModel none)', arm.status === 200, { status: arm.status });
  }
  const thumb = (q) => (isReal ? q.url.indexOf('img.youtube.com/vi/' + VIDEO_ID) !== -1 : /img\.youtube\.com\/vi\//.test(q.url));

  const allOff = { gemini: false, huggingface: false, youtube: false };
  const allOn = { gemini: true, huggingface: true, youtube: true };
  const defaults = isReal ? allOff : allOn;

  // ---- 1. the walk: every request same-origin (real) ------------------------
  const walkers = [
    { who: fx.users.il, paths: ['/dashboard.html', '/execution.html', '/due-diligence.html', '/org.html', '/index.html'], label: 'IL' },
    { who: fx.users.emp, paths: ['/employee.html'], label: 'employee' },
    { who: admin, paths: ['/admin.html'], label: 'admin' },
  ];
  let total = 0;
  const offenders = [];
  const blocked = [];
  for (const w of walkers) {
    const page = await ctx.newPage({ cookies: [w.who.cookie] });
    for (const p of w.paths) {
      await page.goto(ctx.base + p, { waitUntil: 'load' });
      await ctx.settle(page, 1200);
      ctx.check(`${w.label} walk: stays on ${p}`, new URL(page.url()).pathname === p, new URL(page.url()).pathname);
    }
    total += page.reqLog.length;
    offenders.push(...externalRequests(ctx, page).map((x) => w.label + ': ' + x));
    blocked.push(...page.externalBlocked);
    const v = await ctx.pageViolations(page);
    ctx.check(`${w.label} walk: no securitypolicyviolation event`, v.length === 0, v.slice(0, 4));
  }
  if (isReal) {
    ctx.check(`real lane defaults: every request of the IL/employee/admin walk is same-origin (${total} requests)`, offenders.length === 0, offenders.slice(0, 8));
    ctx.check('real lane defaults: nothing had to be intercepted locally (no third-party attempt at all)', blocked.length === 0, blocked.slice(0, 8));
  } else {
    ctx.pass(`${ctx.lane}: showcase walk completed (${total} requests; ${blocked.length} third-party attempt(s) intercepted locally: ${Array.from(new Set(blocked.map((u) => new URL(u).host))).join(', ') || 'none'})`);
  }

  // ---- 2. the served policy under the defaults -------------------------------
  const mode = await fetch(ctx.base + '/api/auth/mode');
  const pair = headerPair(mode);
  await mode.arrayBuffer();
  ctx.check(`served CSP equals the ${isReal ? 'all-off (real-mode)' : 'all-on (showcase)'} policy for CSP_MODE=${ctx.cspMode}`,
    samePolicy(pair, expectedCsp(ctx, defaults)), pair);
  if (isReal) {
    const joined = Object.values(pair).filter(Boolean).join(' ');
    ctx.check('real-mode CSP lists no third-party origin (no http:/https: token, no wildcard)', !/https?:/i.test(joined) && joined.indexOf('*') === -1, null);
    const doc = await fetch(ctx.base + '/index.html', { headers: { Cookie: fx.users.il.cookie } });
    const docPair = headerPair(doc);
    await doc.arrayBuffer();
    ctx.check('the HTML document response carries the same all-off policy', samePolicy(docPair, expectedCsp(ctx, allOff)), docPair);
  }

  // ---- 3. model dialog + gemini marker + employee video (defaults) -----------
  const dialogPage = await openPage(ctx, admin, '/dashboard.html', 'admin dashboard');
  let modal = await dialogPage.waitForSelector('#ai-insight-modal', { timeout: 9000 }).catch(() => null);
  if (!modal) {
    // admin may not land on the IL dashboard in every lane: the main index page offers the same dialog
    await dialogPage.goto(ctx.base + '/index.html', { waitUntil: 'load' });
    await ctx.settle(dialogPage, 800);
    modal = await dialogPage.waitForSelector('#ai-insight-modal', { timeout: 9000 }).catch(() => null);
  }
  ctx.check('the AI Insight activation dialog is offered to the admin', !!modal, null);
  if (modal) {
    const m = await dialogPage.evaluate(() => ({
      options: Array.from(document.querySelectorAll('.ai-insight-model-option')).map((o) => ({ model: o.getAttribute('data-model'), disabled: o.classList.contains('disabled') })),
      offNote: !!document.getElementById('ai-insight-egress-off'),
    }));
    const downloads = m.options.filter((o) => o.model !== 'simulated-duck');
    if (isReal) {
      ctx.check('real defaults: both downloadable models are disabled and the switched-off note is shown',
        downloads.length >= 2 && downloads.every((o) => o.disabled) && m.offNote, m);
    } else {
      ctx.check('showcase: the downloadable models are selectable and no switched-off note is shown',
        downloads.length >= 2 && downloads.every((o) => !o.disabled) && !m.offNote, m);
    }
  }
  const hfReq = dialogPage.reqLog.filter((q) => /huggingface\.co/.test(q.url));
  if (isReal) ctx.check('real defaults: no request to Hugging Face from the dialog page', hfReq.length === 0, hfReq.slice(0, 3));

  const insight = await dialogPage.evaluate(async () => {
    const r = await fetch('/api/ai/insight');
    let j = null;
    try { j = await r.json(); } catch (e) { /* none */ }
    return { status: r.status, egressDisabled: j && j.egressDisabled };
  });
  if (isReal) ctx.check('real defaults: /api/ai/insight answers the 200 egressDisabled marker (no Gemini call)', insight.status === 200 && insight.egressDisabled === 'gemini', insight);

  const v0 = await videoState(ctx, fx.users.emp);
  if (isReal) {
    ctx.check('real defaults: the employee video shows the "switched off" card, no play control, no YouTube request',
      v0.state.off === true && v0.yt.length === 0, { state: v0.state, yt: v0.yt.length });
  } else {
    ctx.check('showcase: the employee video still builds the YouTube thumbnail (request to img.youtube.com attempted) and no switched-off card',
      v0.state.off === false && v0.yt.some(thumb), { state: v0.state, yt: v0.yt.map((q) => q.url.slice(0, 60)) });
    await v0.page.click('#btn-play-video');
    const iframeSrc = await v0.page.evaluate(() => { const f = document.querySelector('#welcome-video-player-container iframe'); return f ? f.getAttribute('src') : null; });
    ctx.check('showcase: Play embeds the YouTube iframe', typeof iframeSrc === 'string' && iframeSrc.indexOf('https://www.youtube.com/embed/') === 0, iframeSrc);
  }

  // ---- 4. the switches (real lane: panel, next response, behaviour, back) ----
  if (isReal) {
    const on = await savePanel(ctx, admin, { youtube: true, huggingface: true });
    ctx.check('panel: youtube and huggingface saved ON, gemini still off', on.youtube && on.huggingface && !on.gemini, on);
    const after = await fetch(ctx.base + '/api/auth/mode');
    const afterPair = headerPair(after);
    await after.arrayBuffer();
    const want = expectedCsp(ctx, { gemini: false, huggingface: true, youtube: true });
    ctx.check('the very next response carries the CSP with exactly the youtube + huggingface origins (PD-9)', samePolicy(afterPair, want), afterPair);
    const strict = afterPair['Content-Security-Policy-Report-Only'] || afterPair['Content-Security-Policy'] || '';
    ctx.check('...and those origins are only in img-src / connect-src / frame-src / media-src, never script-src',
      /script-src 'self'( 'wasm-unsafe-eval')?;/.test(strict) && strict.indexOf('youtube') !== -1 && strict.indexOf('huggingface') !== -1, null);

    const v1 = await videoState(ctx, fx.users.emp);
    ctx.check('youtube ON: the employee video no longer shows the switched-off card and builds the thumbnail',
      v1.state.off === false && v1.yt.some(thumb), { state: v1.state, yt: v1.yt.length });

    const dlg = await openPage(ctx, admin, '/dashboard.html', 'admin dashboard (huggingface on)');
    const m2 = await dlg.waitForSelector('#ai-insight-modal', { timeout: 9000 }).catch(() => null);
    if (m2) {
      const st = await dlg.evaluate(() => ({
        disabled: Array.from(document.querySelectorAll('.ai-insight-model-option.disabled')).length,
        offNote: !!document.getElementById('ai-insight-egress-off'),
      }));
      ctx.check('huggingface ON: the model options are selectable again and the switched-off note is gone', st.disabled === 0 && st.offNote === false, st);
    } else {
      ctx.fail('huggingface ON: the AI Insight dialog is offered to the admin', 'not shown');
    }

    const back = await savePanel(ctx, admin, { youtube: false, huggingface: false });
    ctx.check('panel: switched back OFF', !back.youtube && !back.huggingface && !back.gemini, back);
    const again = await fetch(ctx.base + '/api/auth/mode');
    const againPair = headerPair(again);
    await again.arrayBuffer();
    ctx.check('the next response is the all-off policy again', samePolicy(againPair, expectedCsp(ctx, allOff)), againPair);
    const v2 = await videoState(ctx, fx.users.emp);
    ctx.check('youtube OFF again: the switched-off card is back and no YouTube request is made', v2.state.off === true && v2.yt.length === 0, { state: v2.state, yt: v2.yt.length });
  }

  const ev = await ctx.endpointViolations();
  ctx.check('GET /api/admin/csp-violations is empty after the whole egress walk', ev.count === 0, { count: ev.count, tuples: ev.violations.slice(0, 5) });
  ctx.say(`egress@${ctx.lane} requests=${total} thirdPartyAttempts=${blocked.length} violations=${ev.count}`);
}

async function transformersImport(ctx) {
  const canary = ctx.canary;
  canary.reset();
  const page = await ctx.newPage({});
  await page.goto(ctx.base + '/index.html', { waitUntil: 'load' });
  await ctx.settle(page, 1200);
  const baseline = (await ctx.pageViolations(page)).length;
  ctx.check('the page used for the import is itself violation-free first', baseline === 0, baseline);
  const reqBefore = page.reqLog.length;

  const importResult = await page.evaluate(async () => {
    try {
      const m = await import('/vendor/transformers/transformers.min.js');
      return { ok: true, keys: Object.keys(m).length, hasPipeline: typeof m.pipeline === 'function', hasEnv: typeof m.env === 'object' };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) };
    }
  });
  ctx.check('the vendored transformers bundle imports under the active policy', importResult.ok === true && importResult.hasPipeline, importResult);
  await ctx.sleep(500);
  // PD-44: an EVAL-class report from the vendored bundle (its guarded
  // `new Function("return this")` / eval fallbacks, W-1 evidence) is RECORDED, it is
  // outside the two walks and does not stop the import. Any other violation fails.
  const isEvalClass = (e) => e.blocked === 'eval' || (/^script-src/.test(e.directive || '') && e.blocked === 'eval');
  const afterImport = await ctx.pageViolations(page);
  const importEval = afterImport.filter(isEvalClass);
  const importOther = afterImport.filter((e) => !isEvalClass(e));
  ctx.check('no violation other than the recorded eval-class ones from the import (in-page)', importOther.length === 0, importOther.slice(0, 5));
  ctx.pass(`recorded (PD-44): eval-class reports from the vendored bundle during import = ${importEval.length}`,
    importEval.slice(0, 4).map((e) => ({ directive: e.directive, blocked: e.blocked, source: e.source, line: e.line, disposition: e.disposition })));

  const wasm = await page.evaluate(async () => {
    try {
      const res = await fetch('/vendor/transformers/ort-wasm-simd.wasm');
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const buf = await res.arrayBuffer();
      const mod = await WebAssembly.compile(buf);
      return { ok: true, bytes: buf.byteLength, imports: WebAssembly.Module.imports(mod).length };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 200) };
    }
  });
  ctx.check('WebAssembly.compile of /vendor/transformers/ort-wasm-simd.wasm resolves', wasm.ok === true, wasm);
  await ctx.sleep(500);
  const afterWasm = await ctx.pageViolations(page);
  const wasmEvents = afterWasm.slice(afterImport.length);
  ctx.check('no securitypolicyviolation event from the wasm compile (in-page) - wasm-unsafe-eval suffices (W-1)', wasmEvents.length === 0, wasmEvents.slice(0, 5));

  const ext = externalRequests(ctx, page).filter((u) => true);
  ctx.check('no non-same-origin request during import + compile', ext.length === 0, ext.slice(0, 5));
  ctx.check('no browser request to the canary origin', S.requestsTo(page, canary.origin).length === 0, null);
  const newReq = page.reqLog.slice(reqBefore).filter((q) => /vendor\/transformers\//.test(q.url)).map((q) => q.url.replace(ctx.base, '') + ' ' + (q.status || q.failed));
  ctx.pass('same-origin vendor requests during the scenario', newReq);

  const ev = await ctx.endpointViolations();
  const evOther = ev.violations.filter((t) => t.blockedUri !== 'eval');
  ctx.check('GET /api/admin/csp-violations lists nothing but the recorded eval-class tuples (endpoint)', evOther.length === 0,
    { count: ev.count, other: evOther.slice(0, 5), evalTuples: ev.violations.length - evOther.length });

  // PD-44: first-party callers never ask for threads (the threaded worker path is unverified by design).
  const hits = [];
  const root = path.join(S.REPO_ROOT, 'public');
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      if (e.name === 'vendor' || e.name === 'node_modules') return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name) && fs.readFileSync(p, 'utf8').indexOf('numThreads') !== -1) hits.push(path.relative(S.REPO_ROOT, p));
    });
  })(root);
  ctx.check('no first-party file sets numThreads (single-thread runtime: wasm-unsafe-eval suffices)', hits.length === 0, hits);
  ctx.pass('UNVERIFIED by design: the threaded runtime path (importScripts(blob:) inside a blob worker inherits script-src \'self\' and would be blocked) is not exercised', 'recorded for 13-13 DEPLOYMENT.md / 13-14 open items');

  if (importResult.ok === true && wasm.ok === true && wasmEvents.length === 0 && importOther.length === 0 && evOther.length === 0) {
    ctx.say('transformersImport wasm-compile PASS');
  }
  ctx.say(`transformersImport@${ctx.lane} csp-mode=${ctx.cspMode} importResolved=${importResult.ok === true} wasmCompiled=${wasm.ok === true} ` +
    `evalClassReports=${importEval.length} otherViolations=${importOther.length + wasmEvents.length + evOther.length}`);
}

module.exports = {
  egress,
  transformersImport,
  __lanes: { egress: ['real', 'dev', 'demo-open'], transformersImport: ['demo-open'] },
};
