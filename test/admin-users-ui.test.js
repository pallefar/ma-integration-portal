// Phase 10 plan 10-07: admin console Users tab (ACCT-01, D-10-03 / D-10-10).
// Source-level asserts (the framework-less client has no DOM harness) plus a
// node:vm run of admin-users.js to exercise the exact shipped accountsWritable
// decision — the same pattern as test/client-account-surfaces.test.js.
//
// node:test — run via `node --test test/admin-users-ui.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function readPublic(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'public', ...segments), 'utf8');
}

const html = readPublic('admin.html');
const usersJs = readPublic('js', 'admin-users.js');
const adminJs = readPublic('js', 'admin.js');

test('admin-users-ui: the Users rail button exists, is hidden by default and carries data-tab="users"', () => {
  const m = /<button[^>]*data-tab="users"[^>]*>/.exec(html);
  assert.ok(m, 'expected a rail button with data-tab="users"');
  assert.match(m[0], /class="admin-tab-btn"/);
  assert.match(m[0], /id="admin-tab-btn-users"/);
  assert.match(m[0], /style="display:none;"/, 'the tab button must be hidden until the role is confirmed');
  assert.strictEqual((html.match(/data-tab="users"/g) || []).length, 1);
});

test('admin-users-ui: the #tab-users panel exists and is hidden by default', () => {
  const m = /<div[^>]*id="tab-users"[^>]*>/.exec(html);
  assert.ok(m, 'expected #tab-users');
  assert.match(m[0], /tab-content tab-content-panel/);
  assert.match(m[0], /display:none/);
  assert.match(html, /id="users-list"/);
  assert.match(html, /id="btn-users-add"/);
});

test('admin-users-ui: admin-users.js is referenced exactly once, stamped, after admin.js', () => {
  // Stamp value is not pinned (it is bumped on every change — WR-C01 bumped it);
  // test/asset-cache-bust.test.js owns cross-page stamp consistency.
  const refs = html.match(/\/js\/admin-users\.js\?v=\d+/g) || [];
  assert.strictEqual(refs.length, 1);
  assert.strictEqual((html.match(/<script[^>]*admin-users\.js/g) || []).length, 1, 'exactly one script tag for admin-users.js');
  assert.ok(html.indexOf(refs[0]) > html.indexOf('/js/admin.js?v=1791700202'),
    'admin-users.js must load after admin.js (which carries the bumped stamp)');
  assert.strictEqual((html.match(/\/css\/admin-users\.css\?v=1791700201/g) || []).length, 1);
});

test('admin-users-ui: admin-users.js has no HTML-string sink and talks to the 10-03 API', () => {
  assert.doesNotMatch(usersJs, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.srcdoc\s*=/);
  assert.match(usersJs, /\/api\/admin\/users/);
  assert.match(usersJs, /accountsWritable/);
  assert.match(usersJs, /reset-password/);
  assert.match(usersJs, /'PATCH'/);
});

test('admin-users-ui: the temporary password is never persisted client-side', () => {
  assert.doesNotMatch(usersJs, /localStorage|sessionStorage|document\.cookie|indexedDB/);
  assert.doesNotMatch(usersJs, /console\.(log|info|debug)/);
});

function loadPolicy() {
  const sandbox = { window: {} };
  vm.runInNewContext(usersJs, sandbox);
  return sandbox.window.maAdminUsersPolicy;
}

// --- WR-C01: a tiny fake DOM, enough for the modal shell -----------------------
function fakeDom() {
  const docListeners = {};
  const all = (root) => root.children.reduce((acc, c) => acc.concat([c], all(c)), []);
  const doc = { activeElement: null };
  function node(tag) {
    const n = {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null, attrs: {}, listeners: {},
      style: {}, className: '', textContent: '', id: '', value: '', disabled: false,
      appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
      removeChild(c) { n.children = n.children.filter((x) => x !== c); c.parentNode = null; return c; },
      setAttribute(k, v) { n.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(n.attrs, k) ? n.attrs[k] : null; },
      addEventListener(t, f) { (n.listeners[t] = n.listeners[t] || []).push(f); },
      fire(t, extra) { (n.listeners[t] || []).forEach((f) => f(Object.assign({ target: n, preventDefault() {}, stopPropagation() {} }, extra))); },
      focus() { doc.activeElement = n; },
      select() {},
      querySelectorAll() { return all(n).filter((x) => ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(x.tagName)); },
      querySelector(sel) { return sel === 'button' ? all(n).find((x) => x.tagName === 'BUTTON') || null : null; },
    };
    return n;
  }
  doc.body = node('body');
  doc.createElement = node;
  doc.addEventListener = (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); };
  doc.removeEventListener = (t, f) => { docListeners[t] = (docListeners[t] || []).filter((x) => x !== f); };
  doc.keydown = (key) => (docListeners.keydown || []).slice().forEach((f) => f({ key, shiftKey: false, preventDefault() {}, stopPropagation() {} }));
  doc.contains = (x) => { for (let c = x; c; c = c.parentNode) if (c === doc.body) return true; return false; };
  doc.getElementById = (id) => all(doc.body).find((x) => x.id === id) || null;
  doc.querySelectorAll = () => [];
  return doc;
}

test('admin-users-ui (WR-C01): the temp-password modal survives Escape and scrim clicks; only "I have saved it" closes it; focus returns to the trigger', () => {
  const document = fakeDom();
  const sandbox = { window: {}, document, navigator: {}, setTimeout, Promise };
  vm.runInNewContext(usersJs, sandbox);
  const modal = sandbox.window.maAdminUsersModal;
  assert.ok(modal && typeof modal.openTempPasswordModal === 'function');

  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  modal.openTempPasswordModal('alice', 'Temp-Secret-123', 'User created', trigger);
  const overlay = document.body.children.find((c) => /au-overlay/.test(c.className));
  const input = document.getElementById('au-temp-password');
  assert.ok(overlay && input, 'modal rendered');

  document.keydown('Escape');
  assert.strictEqual(modal.isOpen(), true, 'Escape must not dismiss the one-time password');
  overlay.fire('click', { target: overlay });
  assert.strictEqual(modal.isOpen(), true, 'a scrim click must not dismiss the one-time password');
  assert.strictEqual(input.value, 'Temp-Secret-123', 'the password is still shown');

  const done = document.getElementById('au-temp-done');
  assert.strictEqual(done.textContent, 'I have saved it');
  done.fire('click');
  assert.strictEqual(modal.isOpen(), false);
  assert.strictEqual(input.value, '', 'closing blanks the value');
  assert.strictEqual(document.activeElement, trigger, 'focus returns to the trigger');
});

test('admin-users-ui (IN-C03): a load requested while one is in flight is queued (one trailing reload), never dropped', async () => {
  const document = fakeDom();
  const host = document.createElement('div');
  host.id = 'users-list';
  document.body.appendChild(host);
  const pending = [];
  const fetch = () => new Promise((resolve) => pending.push(resolve));
  const sandbox = { window: {}, document, navigator: {}, setTimeout, Promise, fetch };
  vm.runInNewContext(usersJs, sandbox);
  const api = sandbox.window.maAdminUsersModal;
  const settle = () => new Promise((r) => setImmediate(r));
  const respond = async () => {
    pending.shift()({ status: 500, json: () => Promise.resolve({ error: 'x' }) });
    await settle(); await settle(); await settle();
  };

  const first = api.loadUsers();
  api.loadUsers(); // e.g. the create that landed during the initial load
  api.loadUsers();
  assert.strictEqual(pending.length, 1, 'only one request in flight');
  await respond();
  assert.strictEqual(pending.length, 1, 'the queued request runs after the in-flight one settles');
  await respond();
  await first;
  assert.strictEqual(pending.length, 0, 'one trailing reload covers every queued request');
  assert.match(usersJs, /if \(opened\) \{ loadUsers\(\); return; \}/, 'a later Users-tab click refreshes the list');
});

test('admin-users-ui (WR-C01): a non-sticky modal (confirm) still closes on Escape — stickiness is opt-in', () => {
  assert.match(usersJs, /if \(sticky\) \{ e\.preventDefault\(\); return; \}/);
  assert.match(usersJs, /e\.target === overlay && !sticky/);
  assert.strictEqual((usersJs.match(/sticky: true/g) || []).length, 1, 'only the temp-password modal is sticky');
});

test('admin-users-ui: maAdminUsersPolicy.accountWritesAllowed truth table (failed probe is not writable)', () => {
  const p = loadPolicy();
  assert.ok(p && typeof p.accountWritesAllowed === 'function');
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: true }), true);
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: false }), false);
  assert.strictEqual(p.accountWritesAllowed({}), false);
  assert.strictEqual(p.accountWritesAllowed(null), false);
  assert.strictEqual(p.accountWritesAllowed({ accountsWritable: 'true' }), false);
});

test('admin-users-ui: role display labels match the product vocabulary', () => {
  const p = loadPolicy();
  assert.strictEqual(p.roleLabel('admin'), 'Admin');
  assert.strictEqual(p.roleLabel('hrbp'), 'Integration Leader');
  assert.strictEqual(p.roleLabel('pmo'), 'PMO');
  assert.strictEqual(p.roleLabel('employee'), 'Employee');
});

test('admin-users-ui: admin.js SECTION_META has a users key', () => {
  assert.match(adminJs, /users:\s*\['Users',/);
});

test('admin-users-ui: the read-only note names start-real-deal', () => {
  assert.match(usersJs, /read-only on the demo database\. Start a real-deal host \(start-real-deal\)/);
});

test('admin-users-ui: Disable is never offered on the signed-in admin\u2019s own row, and row actions sit behind the writable gate', () => {
  assert.match(usersJs, /if \(!own\) \{[\s\S]*?'Disable'/);
  assert.match(usersJs, /if \(state\.writable\) renderRowActions\(c, u\)/);
  ['openEditUser', 'openToggleDisabled', 'openResetPassword'].forEach((fn) => {
    assert.match(usersJs, new RegExp('function ' + fn + '\\([^)]*\\) \\{\\s*if \\(!state\\.writable\\) return;'),
      fn + ' must refuse to open when accounts are not writable');
  });
});
