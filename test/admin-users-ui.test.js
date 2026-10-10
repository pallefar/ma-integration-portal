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
  const refs = html.match(/\/js\/admin-users\.js\?v=1791700200/g) || [];
  assert.strictEqual(refs.length, 1);
  assert.strictEqual((html.match(/<script[^>]*admin-users\.js/g) || []).length, 1, 'exactly one script tag for admin-users.js');
  assert.ok(html.indexOf('/js/admin-users.js?v=1791700200') > html.indexOf('/js/admin.js?v=1791700202'),
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
