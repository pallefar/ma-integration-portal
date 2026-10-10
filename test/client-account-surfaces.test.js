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

// ============================================== change-password.js (Task 2)
test('maChangePasswordPolicy.accountWritesAllowed truth table (D-10-01)', () => {
  const p = loadPolicyWindow('js', 'change-password.js').maChangePasswordPolicy;
  assert.ok(p, 'change-password.js must expose window.maChangePasswordPolicy');
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: true }), true);
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: false }), false);
  assert.strictEqual(p.accountWritesAllowed({}), false);
  assert.strictEqual(p.accountWritesAllowed(null), false, 'a failed mode probe counts as not writable');
  assert.strictEqual(p.accountWritesAllowed(undefined), false);
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: 'true' }), false, 'only boolean true counts');
});

test('maChangePasswordPolicy.minLength: 12 in real mode, 8 otherwise', () => {
  const p = loadPolicyWindow('js', 'change-password.js').maChangePasswordPolicy;
  assert.strictEqual(p.minLength({ mode: 'real' }), 12);
  assert.strictEqual(p.minLength({ mode: 'dev' }), 8);
  assert.strictEqual(p.minLength(null), 8);
});

test('change-password.html: standalone, one style.css stamp, no transitions.js, versioned script', () => {
  const html = readPublic('change-password.html');
  assert.ok(html.includes('href="/css/style.css?v=1791625638"'), 'must link the single existing style.css stamp');
  assert.ok(!/transitions\.js/.test(html), 'a forced user must not get the app chrome from this page');
  assert.ok(/<script src="\/js\/change-password\.js\?v=\d+"><\/script>/.test(html));
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || [];
  assert.deepStrictEqual(inline, [], 'no inline script');
});

// ================================== transitions.js: fetch wrapper 403 marker
function extractWrapperRegion() {
  const src = readPublic('js', 'transitions.js');
  const beginIdx = src.indexOf('ma-fetch-wrapper:begin');
  const endIdx = src.indexOf('ma-fetch-wrapper:end');
  assert.ok(beginIdx >= 0 && endIdx > beginIdx, 'expected the ma-fetch-wrapper sentinels in transitions.js');
  return src.slice(src.indexOf('\n', beginIdx) + 1, src.lastIndexOf('\n', endIdx));
}

function jsonResponse(status, body) {
  const res = {
    status,
    headers: new Headers(),
    clone() { return res; },
    json() { return Promise.resolve(body); },
  };
  return res;
}

function buildWrapperSandbox(responses, pathname) {
  const calls = [];
  const fetchImpl = (input) => {
    calls.push(input);
    return Promise.resolve(responses[Math.min(calls.length - 1, responses.length - 1)]);
  };
  const location = { href: 'https://example.test' + pathname, origin: 'https://example.test', pathname };
  const window = { fetch: fetchImpl, location };
  const document = { body: { appendChild() {}, removeChild() {} }, createElement() { return { style: {} }; } };
  const localStorage = { getItem() { return null; }, setItem() {} };
  const sandbox = { window, location, document, localStorage, URL, Headers, setTimeout, console };
  vm.createContext(sandbox);
  vm.runInContext(extractWrapperRegion(), sandbox);
  return { window, location, calls };
}

test('fetch wrapper: 403 {mustChangePassword:true} navigates to /change-password.html and returns the original Response', async () => {
  const original = jsonResponse(403, { error: 'Password change required.', mustChangePassword: true });
  const { window, location } = buildWrapperSandbox([original], '/dashboard.html');
  const res = await window.fetch('/api/pulses', { method: 'GET' });
  assert.strictEqual(res, original, 'the original Response must come back untouched');
  assert.strictEqual(location.href, '/change-password.html');
});

test('fetch wrapper: a 403 without the marker is returned untouched, no navigation', async () => {
  const original = jsonResponse(403, { error: 'Forbidden.' });
  const { window, location } = buildWrapperSandbox([original], '/dashboard.html');
  const res = await window.fetch('/api/pulses', { method: 'POST', body: '{}' });
  assert.strictEqual(res, original);
  assert.strictEqual(location.href, 'https://example.test/dashboard.html', 'no navigation without the marker');
});

test('fetch wrapper: the marker does not navigate when already on change-password.html or login.html', async () => {
  for (const pathname of ['/change-password.html', '/login.html']) {
    const original = jsonResponse(403, { mustChangePassword: true });
    const { window, location } = buildWrapperSandbox([original], pathname);
    await window.fetch('/api/auth/me', { method: 'GET' });
    assert.strictEqual(location.href, 'https://example.test' + pathname, 'must not navigate away from ' + pathname);
  }
});

test('fetch wrapper: a non-JSON 403 body is returned untouched (parse failure swallowed)', async () => {
  const res403 = { status: 403, headers: new Headers(), clone() { return res403; }, json() { return Promise.reject(new Error('not json')); } };
  const { window, location } = buildWrapperSandbox([res403], '/dashboard.html');
  const res = await window.fetch('/api/pulses', { method: 'GET' });
  assert.strictEqual(res, res403);
  assert.strictEqual(location.href, 'https://example.test/dashboard.html');
});

// =========================================== transitions.js: the handshake
function extractHandshake() {
  const src = readPublic('js', 'transitions.js');
  const begin = src.indexOf('// Real-login handshake');
  const end = src.indexOf('/**\n * TE Connectivity M&A Integration Portal - Transitions Manager');
  assert.ok(begin >= 0 && end > begin, 'expected the real-login handshake block in transitions.js');
  return src.slice(begin, end);
}

async function runHandshake(meBody, pathname) {
  const appended = [];
  const location = { pathname, href: 'https://example.test' + pathname };
  const window = { location };
  const document = {
    getElementById(id) { return appended.find((e) => e.id === id) || null; },
    createElement(tag) { return { tagName: tag, style: {} }; },
    body: { appendChild(el) { appended.push(el); } },
    querySelector() { return null; },
  };
  const fetchImpl = () => Promise.resolve({ ok: true, json: () => Promise.resolve(meBody) });
  const store = {};
  const localStorage = { setItem(k, v) { store[k] = v; } };
  const sandbox = { window, location, document, fetch: fetchImpl, localStorage, setTimeout: () => 0, console };
  vm.createContext(sandbox);
  vm.runInContext(extractHandshake(), sandbox);
  await new Promise((r) => setImmediate(r));
  return { window, location, appended };
}

test('handshake: a must-change user is sent to /change-password.html and no account menu is loaded', async () => {
  const { location, appended } = await runHandshake({ authEnabled: true, user: { username: 'u', role: 'pmo', mustChangePassword: true } }, '/dashboard.html');
  assert.strictEqual(location.href, '/change-password.html');
  assert.strictEqual(appended.length, 0);
});

test('handshake: a normal user gets the account-menu script injected exactly once, with a stamp', async () => {
  const { location, appended } = await runHandshake({ authEnabled: true, user: { username: 'u', role: 'pmo', mustChangePassword: false } }, '/dashboard.html');
  assert.strictEqual(location.href, 'https://example.test/dashboard.html', 'no navigation');
  const scripts = appended.filter((e) => e.id === 'account-menu-js');
  assert.strictEqual(scripts.length, 1);
  assert.ok(/^\/js\/account-menu\.js\?v=\d+$/.test(scripts[0].src), scripts[0].src);
});

test('handshake: no session leaves the page alone in demo-open (authEnabled false) and goes to login otherwise', async () => {
  const open = await runHandshake({ authEnabled: false, user: null }, '/execution.html');
  assert.strictEqual(open.location.href, 'https://example.test/execution.html');
  assert.strictEqual(open.appended.length, 0);
  const closed = await runHandshake({ authEnabled: true, user: null }, '/execution.html');
  assert.strictEqual(closed.location.href, '/login.html');
});

// =================================================== deal-switcher.js loop
async function runDealSwitcher(meBody) {
  const requested = [];
  const document = {
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() { return { style: {}, appendChild() {}, addEventListener() {} }; },
  };
  const fetchImpl = (url) => {
    requested.push(url);
    if (url === '/api/auth/me') return Promise.resolve({ ok: true, json: () => Promise.resolve(meBody) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  };
  const window = {};
  const sandbox = { window, document, fetch: fetchImpl, setTimeout, console };
  vm.createContext(sandbox);
  vm.runInContext(readPublic('js', 'deal-switcher.js'), sandbox);
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  return requested;
}

test('deal-switcher: with no session /api/deals is never requested (WINDOWS #4)', async () => {
  const requested = await runDealSwitcher({ authEnabled: false, user: null });
  assert.deepStrictEqual(requested, ['/api/auth/me']);
});

test('deal-switcher: with a session /api/deals is still requested', async () => {
  const requested = await runDealSwitcher({ authEnabled: true, dealId: null, user: { username: 'karen', role: 'hrbp' } });
  assert.deepStrictEqual(requested, ['/api/auth/me', '/api/deals']);
});

// ======================================================= account-menu (Task 3)
test('maAccountMenuPolicy.accountWritesAllowed truth table (D-10-01, D-10-07)', () => {
  const p = loadPolicyWindow('js', 'account-menu.js').maAccountMenuPolicy;
  assert.ok(p, 'account-menu.js must expose window.maAccountMenuPolicy');
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: true }), true);
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: false }), false);
  assert.strictEqual(p.accountWritesAllowed({}), false);
  assert.strictEqual(p.accountWritesAllowed(null), false, 'a failed mode probe counts as not writable');
  assert.strictEqual(p.accountWritesAllowed(undefined), false);
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: 1 }), false, 'only boolean true counts');
});

test('maAccountMenuPolicy.deviceLabel shortens the user agent to 80 characters', () => {
  const p = loadPolicyWindow('js', 'account-menu.js').maAccountMenuPolicy;
  assert.strictEqual(p.deviceLabel(null), 'Unknown device');
  assert.strictEqual(p.deviceLabel('   '), 'Unknown device');
  assert.strictEqual(p.deviceLabel('Mozilla/5.0'), 'Mozilla/5.0');
  const long = 'A'.repeat(300);
  const label = p.deviceLabel(long);
  assert.strictEqual(label.length, 80);
  assert.ok(label.endsWith('…'));
});

test('account-menu.js, login.js and change-password.js never assign HTML strings to an element (T-10-39)', () => {
  const sink = /\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\.createContextualFragment|\.srcdoc\b/;
  ['account-menu.js', 'login.js', 'change-password.js'].forEach((name) => {
    const src = readPublic('js', name);
    assert.ok(!sink.test(src), name + ' must build the DOM with createElement/textContent only');
  });
});

test('account-menu.js mounts into the profile dropdown and the sidebar footer, gates on accountsWritable, and is stamped in transitions.js', () => {
  const src = readPublic('js', 'account-menu.js');
  assert.ok(src.includes("'#profile-dropdown-card .dropdown-body'"), 'dropdown mount');
  assert.ok(src.includes("'.sidebar-footer'"), 'sidebar-footer mount');
  assert.ok(src.includes('accountsWritable'), 'must read accountsWritable');
  assert.ok(src.includes("setAttribute('aria-disabled', 'true')"), 'the disabled item carries aria-disabled');
  assert.ok(src.includes('encodeURIComponent(s.id)'), 'the session id is encoded into the DELETE path');
  assert.ok(/account\.css\?v=\d+/.test(src), 'account.css is linked with a stamp');
  const transitions = readPublic('js', 'transitions.js');
  assert.ok(/account-menu\.js\?v=\d+/.test(transitions), 'transitions.js injects account-menu.js with a stamp');
});

test('account.css carries the <= 480px rules that keep both modals inside a 390px viewport', () => {
  const css = readPublic('css', 'account.css');
  assert.ok(/@media \(max-width: 480px\)/.test(css));
  assert.ok(css.includes('calc(100vw - 1.5rem)'), 'modal width is min(480px, calc(100vw - 1.5rem)) on phones');
});
