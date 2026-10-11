// Shared helpers for the Phase 13 browser proof scenarios (plan 13-12).
// A leading underscore keeps this file out of the runner's scenario registry
// (scripts/uat/phase13-xss.js skips `_*.js`).
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

// ---------------------------------------------------------------- corpus
function loadCorpus() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test', 'fixtures', 'xss-corpus.json'), 'utf8'));
}

// An executable proof expression: if ANY stored payload ever runs, it sets
// window.__xss and tries to reach the canary origin. It contains no space, no
// quote and no `>` so it survives every attribute context (unquoted, single-
// and double-quoted, javascript: URLs, <script> bodies).
function xssExpr(canaryOrigin) {
  const url = canaryOrigin + '/p13-xss';
  const codes = Array.from(url).map((c) => c.charCodeAt(0)).join(',');
  return 'window.__xss=1,fetch(String.fromCharCode(' + codes + '))';
}

// Replace every alert(...) call of a corpus vector with the proof expression.
function arm(input, expr) {
  return String(input).replace(/alert\([^)]*\)/g, expr);
}

// Replace the corpus's fictional attacker host with the live canary origin.
function pointAtCanary(input, canaryOrigin) {
  return String(input).split('https://evil.example').join(canaryOrigin).split('http://evil.example').join(canaryOrigin);
}

// Every Nth vector plus the four R1-03 originals, armed.
function sampleVectors(canaryOrigin, every, cap) {
  const expr = xssExpr(canaryOrigin);
  const all = loadCorpus();
  const picked = all.filter((v, i) => /^R1-03-/.test(v.id) || i % every === 0);
  const out = [];
  let size = 0;
  for (const v of picked) {
    const armed = arm(pointAtCanary(v.input, canaryOrigin), expr);
    if (cap && size + armed.length > cap) continue;
    size += armed.length;
    out.push({ id: v.id, category: v.category, armed });
  }
  return out;
}

// ---------------------------------------------------------------- in-page audit
// Runs in the page. Walks every element under `selector` and reports anything an
// inert stored-content container must not hold: a script-bearing / foreign
// element, an on* attribute, an id/name (DOM clobbering), a javascript:/vbscript:
// or non-image data: URL, a style that can fetch or execute.
function auditDom(arg) {
  const BAD = new Set(['SCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'FORM', 'SVG', 'MATH',
    'STYLE', 'LINK', 'META', 'BASE', 'TEMPLATE', 'NOSCRIPT', 'TEXTAREA', 'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS', 'INPUT', 'SELECT']);
  const URL_ATTRS = ['href', 'src', 'action', 'data', 'formaction', 'background', 'poster', 'xlink:href', 'srcset', 'srcdoc'];
  const roots = Array.from(document.querySelectorAll(arg.selector));
  const problems = [];
  let nodes = 0;
  roots.forEach((root) => {
    const all = [root].concat(Array.from(root.querySelectorAll('*')));
    all.forEach((el, idx) => {
      nodes += 1;
      const tag = String(el.tagName || '').toUpperCase();
      if (idx > 0 && BAD.has(tag)) problems.push({ kind: 'element', tag });
      Array.from(el.attributes || []).forEach((a) => {
        const n = a.name.toLowerCase();
        if (n.indexOf('on') === 0) problems.push({ kind: 'handler', tag, attr: n });
        if (idx > 0 && (n === 'id' || n === 'name')) problems.push({ kind: 'clobber', tag, attr: n });
        if (URL_ATTRS.indexOf(n) !== -1) {
          let v = '';
          for (let i = 0; i < a.value.length; i++) { const c = a.value.charCodeAt(i); if (c > 0x20 && c !== 0x7f) v += a.value[i]; }
          v = v.toLowerCase();
          if (n === 'srcdoc' || n === 'srcset') problems.push({ kind: 'attr', tag, attr: n });
          else if (/^(javascript|vbscript|livescript|mocha):/.test(v)) problems.push({ kind: 'scheme', tag, attr: n, value: v.slice(0, 40) });
          else if (/^data:/.test(v) && !/^data:image\/(png|jpe?g|gif|webp);base64,/.test(v)) problems.push({ kind: 'data-url', tag, attr: n });
          else if (v.indexOf('//') === 0) problems.push({ kind: 'protocol-relative', tag, attr: n });
        }
        if (n === 'style' && /url\(|expression\(|@import|javascript:|behavior|-moz-binding/i.test(a.value)) {
          problems.push({ kind: 'style', tag, value: a.value.slice(0, 60) });
        }
      });
    });
  });
  return { roots: roots.length, nodes, problems };
}

// ---------------------------------------------------------------- page probes
// Everything an executed payload would leave behind.
async function execState(page) {
  let xss = null;
  for (const f of page.frames()) {
    try {
      const v = await f.evaluate(() => (window.__xss === undefined ? null : window.__xss));
      if (v !== null) { xss = v; break; }
    } catch (e) { /* detached frame */ }
  }
  return { xss, dialogs: page.dialogs.slice() };
}

function requestsTo(page, origin) {
  return page.reqLog.filter((r) => r.url.indexOf(origin) === 0).map((r) => r.method + ' ' + r.url.slice(0, 80));
}

// Assert the four inertness facts after a page has been opened and settled:
// no __xss, no dialog, no request to the canary origin (log AND server side),
// no in-page violation.
async function assertInert(ctx, page, label) {
  const st = await execState(page);
  ctx.check(`${label}: window.__xss never set`, st.xss === null, st.xss);
  ctx.check(`${label}: no dialog opened`, st.dialogs.length === 0, st.dialogs);
  ctx.check(`${label}: no browser request to the canary origin`, requestsTo(page, ctx.canary.origin).length === 0, requestsTo(page, ctx.canary.origin));
  const v = await ctx.pageViolations(page);
  ctx.check(`${label}: no securitypolicyviolation event in any frame`, v.length === 0, v.slice(0, 5));
  return { st, violations: v };
}

// ---------------------------------------------------------------- legacy rows
// The lane's content store file (the DEAL database in the real lane, the demo copy elsewhere). Scenarios
// that must prove RENDER-time neutralisation of values the write path now refuses (CR-B01 / WR-B04: stored
// `javascript:` links) put those legacy values straight into the store, below the API - exactly what a
// database written by an older release holds.
function laneStoreFile(ctx, fixture) {
  return ctx.lane === 'real'
    ? path.join(ctx.dataDir, 'deals', fixture.dealId + '.db')
    : path.join(ctx.dataDir, 'demo.db');
}

function withStore(file, fn) {
  const Database = require(path.join(REPO_ROOT, 'node_modules', 'better-sqlite3'));
  const conn = new Database(file);
  try {
    conn.pragma('busy_timeout = 8000');
    return fn(conn);
  } finally {
    try { conn.pragma('wal_checkpoint(PASSIVE)'); } catch (e) { /* best effort */ }
    conn.close();
  }
}

module.exports = { REPO_ROOT, loadCorpus, xssExpr, arm, pointAtCanary, sampleVectors, auditDom, execState, requestsTo, assertInert, laneStoreFile, withStore };
