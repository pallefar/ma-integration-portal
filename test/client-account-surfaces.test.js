// Phase 10 plan 10-06: client account surfaces (login page, forced
// change-password screen, header-menu self-service). Source-level + node:vm,
// no browser — the real-browser proof is scripts/uat/phase10-walk.js. This is
// the established pattern for the framework-less, no-build-step client (see
// test/client-busy-retry.test.js and test/client-xss-sinks.test.js).
//
// node:test — run via `node --test test/client-account-surfaces.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const readPublic = (...segs) => fs.readFileSync(path.join(PUBLIC, ...segs), 'utf8');

// Runs a client file in a bare sandbox (no `document`, so DOM-binding code
// exits early) and returns the sandbox `window`, where the policy objects live.
function loadPolicyWindow(...segs) {
  const window = {};
  const sandbox = { window, console };
  vm.createContext(sandbox);
  vm.runInContext(readPublic(...segs), sandbox);
  return window;
}

// ================================================================ login.html
test('login.html carries no demo credential and no inline script (D-10-08c)', () => {
  const html = readPublic('login.html');
  assert.ok(!/TEdemo/i.test(html), 'login.html must not contain the published demo password');
  assert.ok(!/Demo accounts/i.test(html), 'login.html must not contain the demo-account panel title');
  // An inline script is a <script> element with no src attribute.
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || [];
  assert.deepStrictEqual(inline, [], 'login.html must not carry an inline script');
  assert.ok(/<script src="\/js\/login\.js\?v=\d+"><\/script>/.test(html), 'login.html loads /js/login.js with a ?v= stamp');
  assert.ok(html.includes('id="lg-demo-slot"'), 'the empty demo slot must exist');
  assert.ok(html.includes('id="lg-notice"'), 'the notice element must exist');
});

// ============================================================ login.js policy
test('maLoginPolicy.shouldShowDemoPanel truth table: real -> false, dev -> true, demo+demoOpen -> true, missing/failed -> false', () => {
  const p = loadPolicyWindow('js', 'login.js').maLoginPolicy;
  assert.ok(p, 'login.js must expose window.maLoginPolicy');
  assert.strictEqual(p.shouldShowDemoPanel({ mode: 'real', demoOpen: false }), false);
  assert.strictEqual(p.shouldShowDemoPanel({ mode: 'real', demoOpen: true }), false, 'real never shows it, even with a (impossible) demoOpen flag');
  assert.strictEqual(p.shouldShowDemoPanel({ mode: 'dev', demoOpen: false }), true);
  assert.strictEqual(p.shouldShowDemoPanel({ mode: 'demo', demoOpen: true }), true);
  assert.strictEqual(p.shouldShowDemoPanel({ mode: 'demo', demoOpen: false }), false, 'demo mode without demoOpen is not a display signal');
  assert.strictEqual(p.shouldShowDemoPanel(null), false, 'failed probe fails closed');
  assert.strictEqual(p.shouldShowDemoPanel(undefined), false);
  assert.strictEqual(p.shouldShowDemoPanel({}), false);
  assert.strictEqual(p.shouldShowDemoPanel('dev'), false, 'a non-object body fails closed');
  assert.strictEqual(p.shouldShowDemoPanel({ mode: 'weird', demoOpen: 'true' }), false, 'only boolean true counts');
});

test('maLoginPolicy.landingFor routes a must-change account to the change-password screen', () => {
  const p = loadPolicyWindow('js', 'login.js').maLoginPolicy;
  assert.strictEqual(p.landingFor({ username: 'a' }, true), '/change-password.html');
  assert.strictEqual(p.landingFor({ username: 'a' }, false), '/');
  assert.strictEqual(p.landingFor(null, false), '/');
});

test('login.js has no auto-redirect on a missing session (WINDOWS #4) and builds its panel without HTML-string sinks', () => {
  const src = readPublic('js', 'login.js');
  // The only redirects are the signed-in landing and the post-login landing.
  assert.ok(!/authEnabled/.test(src), 'login.js must not branch on authEnabled (the old loop trigger)');
  assert.ok(!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/.test(src), 'login.js must not assign HTML strings');
});
