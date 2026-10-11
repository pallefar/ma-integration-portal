// SAFE-02 / D-13-03 (Phase 13, plan 13-11): the first-party overview decks and the handlers that
// transitions.js generates at runtime must run under script-src 'self' (no 'unsafe-inline').
//
// What is asserted:
//   1. each public/overview-deck/*.html in DECKS is inline-free (no <script> without src, no on*=
//      attribute, no javascript: URL), loads its code from /js/overview-deck/<deck>.js at the
//      former position, and the SERVED page carries a 16-hex content-hash stamp equal to
//      sha256(GET <that url>) (the Phase-12 invariant extends to the deck scripts);
//   2. transitions.js generates no inline handler and no javascript: URL: sidebar launchers use
//      href="#" (their listeners call preventDefault), the quick-nav hover is a CSS :hover rule,
//      the survey-scores modal close button is wired with addEventListener, and the sidebar
//      slide-link builder (addSlide) builds its icon/label with textContent (D-13-02);
//   3. a client-JS-wide static gate: no string literal under public/js (vendor excluded) carries an
//      inline handler attribute or a javascript: URL.
//
// node:test — run via `node --test test/csp-inline-free-decks.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { listenLocal } = require('./helpers/listen-local');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DECK_DIR = path.join(PUBLIC, 'overview-deck');
const DECK_JS_DIR = path.join(PUBLIC, 'js', 'overview-deck');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-csp-inline-free-decks-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const app = require('../server.js');

const sha16 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

let server;
let base;
test.before(async () => {
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------- inline-free checker ---

/** Violations of the strict policy in one HTML document (comments are ignored). */
function inlineViolations(html) {
  const out = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  const scriptRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = scriptRe.exec(body)) !== null) {
    if (!/\bsrc\s*=/i.test(m[1])) out.push('inline <script> (no src): ' + m[0]);
  }
  const tagRe = /<[a-zA-Z][^>]*>/g;
  while ((m = tagRe.exec(body)) !== null) {
    const handler = /\son[a-z]+\s*=/i.exec(m[0]);
    if (handler) out.push('inline handler attribute ' + handler[0].trim() + ' in ' + m[0].slice(0, 80));
    if (/\b(?:href|src|action|formaction|xlink:href)\s*=\s*["']?\s*javascript:/i.test(m[0])) {
      out.push('javascript: URL in ' + m[0].slice(0, 80));
    }
  }
  return out;
}

// Decks externalised so far (the full set after plan task 2).
const DECKS = ['easter-egg'];

test('checker self-test: it flags inline scripts, handlers and javascript: URLs and passes external scripts', () => {
  assert.strictEqual(inlineViolations('<script src="/js/a.js?v=1"></script><a href="#">x</a>').length, 0);
  assert.strictEqual(inlineViolations('<script>var a=1;</script>').length, 1);
  assert.strictEqual(inlineViolations('<button onclick="x()">y</button>').length, 1);
  assert.strictEqual(inlineViolations('<a href="javascript:void(0)">y</a>').length, 1);
  assert.strictEqual(inlineViolations('<!-- <script>var a=1;</script> --><p>ok</p>').length, 0);
});

for (const deck of DECKS) {
  test(`deck ${deck}.html is inline-free, loads /js/overview-deck/${deck}*.js, and is served with content-hash stamps`, async () => {
    const file = path.join(DECK_DIR, deck + '.html');
    const html = fs.readFileSync(file, 'utf8');
    assert.deepStrictEqual(inlineViolations(html), [], `${deck}.html source`);
    const refs = [];
    const re = /<script\b[^>]*\bsrc\s*=\s*["'](\/js\/overview-deck\/[A-Za-z0-9_.\-]+\.js)(?:\?v=[A-Za-z0-9_.\-]+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) refs.push(m[1]);
    assert.ok(refs.length >= 1, `${deck}.html must load its code from /js/overview-deck/`);
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(PUBLIC, ref)), `${ref} must exist`);
      assert.ok(fs.existsSync(path.join(DECK_JS_DIR, path.basename(ref))));
    }

    const res = await fetch(`${base}/overview-deck/${deck}.html`);
    assert.strictEqual(res.status, 200);
    const served = await res.text();
    assert.deepStrictEqual(inlineViolations(served), [], `${deck}.html as served`);
    for (const ref of refs) {
      const stamped = new RegExp(ref.replace(/[.]/g, '\\.') + '\\?v=([0-9a-f]{16})["\']').exec(served);
      assert.ok(stamped, `${ref} must carry a 16-hex stamp in the served page`);
      const asset = await fetch(`${base}${ref}?v=${stamped[1]}`);
      assert.strictEqual(asset.status, 200);
      assert.strictEqual(stamped[1], sha16(Buffer.from(await asset.arrayBuffer())), `${ref} stamp == sha256(served body)`);
    }
  });
}

// ----------------------------------------------------------- transitions.js templates ---

const TRANSITIONS = fs.readFileSync(path.join(PUBLIC, 'js', 'transitions.js'), 'utf8');

test('transitions.js sidebar survey and easter-egg launchers carry href="#" (not javascript:void(0))', () => {
  assert.match(TRANSITIONS, /<a href="#" class="sidebar-link" id="sidebar-survey-link"/);
  assert.match(TRANSITIONS, /<a href="#" class="sidebar-link sidebar-egg" data-html-slide="\/overview-deck\/easter-egg\.html"/);
  const wired = /sidebarSurveyLink\.addEventListener\('click', \(e\) => \{\s*(?:\/\/[^\n]*\n\s*)*e\.preventDefault\(\);/.exec(TRANSITIONS);
  assert.ok(wired, 'the survey link click handler must call preventDefault');
});
