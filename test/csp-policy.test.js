'use strict';
// SAFE-02 / D-13-03 (plan 13-07): the strict `script-src 'self' 'wasm-unsafe-eval'`
// policy ships as Content-Security-Policy-Report-Only beside today's enforcing
// policy, and CSP_MODE selects report-only | enforce (unknown -> enforce).
//
// Part 1 is the header matrix against lib/csp.js directly (modes x dev egress
// defaults x real egress defaults). Part 2 boots the real app as a child
// (test/helpers/egress-server.js) and reads the headers off real responses.
// The isolation guard stays on: every child uses temp MA_* paths.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const csp = require('../lib/csp');
const { modeDefaults } = require('../lib/egress');
const { startServer, parseCsp } = require('./helpers/egress-server');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-csp-policy-'));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

const CSP = 'Content-Security-Policy';
const RO = 'Content-Security-Policy-Report-Only';

function withMode(value, fn) {
  const prev = process.env.CSP_MODE;
  if (value === undefined) delete process.env.CSP_MODE; else process.env.CSP_MODE = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.CSP_MODE; else process.env.CSP_MODE = prev;
  }
}

function captureWarnings(fn) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try { fn(); } finally { console.warn = orig; }
  return warnings;
}

const DEV = modeDefaults(false);
const REAL = modeDefaults(true);

test('default mode (CSP_MODE unset): legacy policy enforced, strict policy Report-Only', () => {
  const h = withMode(undefined, () => csp.headersFor({ egress: DEV }));
  assert.deepStrictEqual(Object.keys(h).sort(), [CSP, RO].sort());

  const legacy = parseCsp(h[CSP]);
  assert.ok(legacy['script-src'].includes("'unsafe-inline'"), 'enforced policy is exactly today\'s (never weaker, PD-10)');
  assert.ok(legacy['script-src'].includes("'unsafe-eval'"));
  assert.deepStrictEqual(legacy['report-uri'], ['/api/csp-report']);

  const strict = parseCsp(h[RO]);
  assert.deepStrictEqual(strict['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepStrictEqual(strict['report-uri'], ['/api/csp-report']);
  assert.ok(!/unsafe-eval/.test(h[RO].replace(/wasm-unsafe-eval/g, '')), 'no unsafe-eval in the strict policy');
  assert.ok(!/unsafe-inline/.test(parseCsp(h[RO])['script-src'].join(' ')), 'no unsafe-inline in script-src');
  assert.ok(!/nonce-/.test(h[RO]), 'no nonces');
  assert.ok(!/report-to|Reporting-Endpoints/i.test(h[CSP] + h[RO]), 'report-uri only (PD-11)');
});

test('strict policy, directive by directive (dev egress defaults)', () => {
  const strict = parseCsp(withMode('enforce', () => csp.headersFor({ egress: DEV }))[CSP]);
  assert.deepStrictEqual(strict['default-src'], ["'self'"]);
  assert.deepStrictEqual(strict['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepStrictEqual(strict['worker-src'], ["'self'", 'blob:']);
  assert.deepStrictEqual(strict['object-src'], ["'none'"]);
  assert.deepStrictEqual(strict['base-uri'], ["'self'"]);
  assert.deepStrictEqual(strict['form-action'], ["'self'"]);
  assert.deepStrictEqual(strict['frame-ancestors'], ["'self'"]);
  assert.deepStrictEqual(strict['style-src'], ["'self'", "'unsafe-inline'"], 'style-src unchanged');
  assert.deepStrictEqual(strict['report-uri'], ['/api/csp-report']);
  // third-party origins only per the egress switch (dev defaults: youtube + huggingface on)
  assert.ok(strict['frame-src'].includes('https://www.youtube.com'));
  assert.ok(strict['connect-src'].includes('https://huggingface.co'));
  assert.ok(!strict['script-src'].some((t) => /^https?:/.test(t)), 'no third-party script origin, ever');
});

test('CSP_MODE=enforce: strict policy as the ONLY header', () => {
  for (const egress of [DEV, REAL]) {
    const h = withMode('enforce', () => csp.headersFor({ egress }));
    assert.deepStrictEqual(Object.keys(h), [CSP]);
    assert.deepStrictEqual(parseCsp(h[CSP])['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
  }
});

test('CSP_MODE=report-only (explicit, any case) equals the default; an unknown value fails closed to enforce with ONE warning', () => {
  const explicit = withMode(' Report-Only ', () => csp.headersFor({ egress: DEV }));
  assert.deepStrictEqual(Object.keys(explicit).sort(), [CSP, RO].sort());

  const warnings = captureWarnings(() => {
    for (let i = 0; i < 5; i++) {
      const h = withMode('bogus-mode-xyz', () => csp.headersFor({ egress: DEV }));
      assert.deepStrictEqual(Object.keys(h), [CSP], 'unknown value -> enforce');
      assert.deepStrictEqual(parseCsp(h[CSP])['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
    }
    withMode('bogus-mode-xyz', () => csp.logBootMode());
  });
  const security = warnings.filter((w) => w.startsWith('[security]') && w.includes('CSP_MODE'));
  assert.strictEqual(security.length, 1, `exactly one boot warning, got ${security.length}: ${security.join(' | ')}`);

  assert.deepStrictEqual(withMode('bogus-mode-xyz', () => csp.resolveMode()), { mode: 'enforce', requested: 'bogus-mode-xyz', valid: false });
  assert.deepStrictEqual(withMode('', () => csp.resolveMode()), { mode: 'report-only', requested: '', valid: true });
});

test('real-mode defaults: neither header carries an https: token, in report-only AND enforce (W-6)', () => {
  for (const mode of [undefined, 'enforce']) {
    const h = withMode(mode, () => csp.headersFor({ egress: REAL }));
    for (const name of Object.keys(h)) {
      assert.ok(!/https?:/i.test(h[name]), `${name} (mode ${mode || 'default'}) must list no http(s) origin: ${h[name]}`);
      assert.ok(!/\*/.test(h[name]), `${name} lists no wildcard source`);
    }
  }
});

test('child server, dev defaults: both headers on a page, strict value reported on /login.html', async () => {
  const s = await startServer({ dir: fs.mkdtempSync(path.join(DIR, 'dev-')), mode: 'dev' });
  try {
    const res = await s.request('/login.html');
    assert.strictEqual(res.status, 200);
    const enforced = res.headers.get('content-security-policy');
    const reportOnly = res.headers.get('content-security-policy-report-only');
    assert.ok(enforced && /'unsafe-inline'/.test(enforced), 'legacy policy still enforced');
    assert.ok(reportOnly, 'strict policy present as Report-Only');
    assert.deepStrictEqual(parseCsp(reportOnly)['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
    assert.ok(/report-uri \/api\/csp-report/.test(reportOnly));
    assert.ok(!/unsafe-eval/.test(reportOnly.replace(/wasm-unsafe-eval/g, '')) && !/nonce-/.test(reportOnly));

    // the header also rides an API response (every response carries it)
    const api = await s.request('/api/auth/mode');
    assert.ok(api.headers.get('content-security-policy-report-only'));
  } finally {
    await s.stop();
  }
});

test('child server, real mode + CSP_MODE=enforce: one header, strict, no https: token', async () => {
  const prev = process.env.CSP_MODE;
  process.env.CSP_MODE = 'enforce'; // the helper's child inherits process.env
  let s;
  try {
    s = await startServer({ dir: fs.mkdtempSync(path.join(DIR, 'real-')), mode: 'real' });
  } finally {
    if (prev === undefined) delete process.env.CSP_MODE; else process.env.CSP_MODE = prev;
  }
  try {
    const res = await s.request('/login.html');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-security-policy-report-only'), null);
    const value = res.headers.get('content-security-policy');
    assert.deepStrictEqual(parseCsp(value)['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
    assert.ok(!/https?:/i.test(value), `real-mode strict policy lists no origin: ${value}`);
  } finally {
    await s.stop();
  }
});

// PD-37: a slide response keeps ONLY its sandbox CSP. Plan 13-03 owns the slides
// mount and removes the Report-Only header there; this regression guard makes
// sure the strict Report-Only policy never reports a slide's own inline scripts.
// It is conditional on the 13-03 mount being present (a sandbox directive on the
// slide response); before that plan is merged it records a skip, after it the
// assertion is live.
// IN-A03 / CR-A01 (13-REVIEW): the upload goes to a temp MA_SLIDES_UPLOAD_DIR —
// never into the checkout's default slide directory (now <repo>/data/slides,
// outside public/; it used to be public/uploads/slides).
test('PD-37: a served slide carries no Content-Security-Policy-Report-Only header', async (t) => {
  const slideDir = fs.mkdtempSync(path.join(DIR, 'slide-'));
  const slidesUploadDir = path.join(slideDir, 'uploaded-slides');
  const s = await startServer({ dir: slideDir, mode: 'dev', env: { MA_SLIDES_UPLOAD_DIR: slidesUploadDir } });
  let uploaded = null;
  try {
    const up = await s.request('/api/slides/upload', {
      method: 'POST', token: 'admin', body: { filename: 'csp-probe.html', content: '<!doctype html><title>t</title><script>window.x=1</script>' },
    });
    assert.strictEqual(up.status, 200);
    uploaded = up.body.url;
    const slide = await s.request(uploaded, { token: 'admin' });
    assert.strictEqual(slide.status, 200);
    const enforced = slide.headers.get('content-security-policy') || '';
    if (!/\bsandbox\b/.test(enforced)) {
      t.skip('slides mount not yet sandboxed (plan 13-03 not merged): assertion becomes live after the merge');
      return;
    }
    assert.strictEqual(slide.headers.get('content-security-policy-report-only'), null,
      'strict Report-Only policy must not ride a sandboxed slide response');
  } finally {
    await s.stop();
    if (uploaded && /^\/uploads\/slides\/[A-Za-z0-9._-]+$/.test(uploaded)) {
      assert.ok(fs.existsSync(path.join(slidesUploadDir, path.basename(uploaded))), 'the slide was written into the temp MA_SLIDES_UPLOAD_DIR');
      try { fs.rmSync(path.join(slidesUploadDir, path.basename(uploaded)), { force: true }); } catch (e) { /* ignore */ }
    }
  }
});
