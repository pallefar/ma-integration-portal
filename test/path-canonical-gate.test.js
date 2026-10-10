// CR-01 (Phase 10 code review) — case / encoding / double-slash / trailing-slash
// spellings of a gated path must never get past ANY path-policy table.
//
// Express used to dispatch `/api/Admin/users` to the `/api/admin/users` handler
// (case-insensitive routing) while the gate's `/api/admin` role check compared
// case-sensitively, so a non-admin session read the full account roster. The fix
// is structural (case-sensitive routing + every table evaluated over all
// canonical spellings, lib/requestPath.js). This suite LOOPS OVER THE TABLES
// themselves — ROLE_WRITE_POLICY, DEMO_ONLY_PREFIXES, MUST_CHANGE_ALLOWED_PATHS,
// db/resolver.js's control-plane list, the credential-lockdown allowlist and
// every registered GET /api/admin* route — so a new entry is covered for free.
//
// All databases are temp copies (MA_* paths); the committed data/*.db is never
// opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-path-canonical-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const app = require('../server.js');
const { gatePolicy, ROLE_WRITE_POLICY, DEMO_ONLY_PREFIXES, MUST_CHANGE_ALLOWED_PATHS, roleAllowedForWrite } = app;
const resolver = require('../db/resolver.js');
const controlStore = require('../db/controlStore.js');
const sessionsDb = require('../db/sessions.js');
const { pathForms } = require('../lib/requestPath');
const { createLockdown, lockdownMiddleware, LOCKDOWN_STATIC_ALLOWLIST } = require('../lib/credentialLockdown');

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const ROLES = ['admin', 'hrbp', 'pmo', 'employee'];

/** Every spelling variant of a canonical path the review named, generated. */
function variants(p) {
  const segs = p.split('/'); // ['', 'api', 'x', ...]
  const out = new Set();
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const join = (arr) => arr.join('/');
  out.add(p.toUpperCase());
  out.add('/API' + p.slice(4));
  out.add(p.replace(/^\/api\//, '/api//'));
  out.add(p + '/');
  out.add(p + '//');
  if (segs.length >= 3) {
    out.add(join([...segs.slice(0, 2), cap(segs[2]), ...segs.slice(3)]));
    out.add(join([...segs.slice(0, -1), cap(segs[segs.length - 1])]));
    const first = segs[2];
    if (first) {
      const enc = '%' + first.charCodeAt(0).toString(16).toUpperCase();
      out.add(join([...segs.slice(0, 2), enc + first.slice(1), ...segs.slice(3)]));
    }
  }
  if (segs.length >= 4) {
    out.add(join(segs.slice(0, -1)) + '%2F' + segs[segs.length - 1]);
    out.add(join(segs.slice(0, -1)) + '%2f' + segs[segs.length - 1]);
  }
  out.delete(p);
  return Array.from(out);
}

/** What the gate sees for a variant (mounted at /api); null = refused 404. */
function gateForms(v) {
  if (!(v === '/api' || v.startsWith('/api/'))) return null; // pre-gate 404 (non-canonical mount)
  const r = pathForms(v);
  return r.ok ? r.forms : null;
}

// --- pure table loops --------------------------------------------------------

test('CR-01: ROLE_WRITE_POLICY — no spelling variant of any rule widens any role', () => {
  let checked = 0;
  for (const rule of ROLE_WRITE_POLICY) {
    const base = rule.exact ? rule.prefix : rule.prefix + '/probe';
    for (const method of rule.methods || ['POST', 'PATCH', 'DELETE', 'GET']) {
      for (const role of ROLES) {
        const canonicalAllowed = roleAllowedForWrite(role, base, method);
        for (const v of variants(base)) {
          const forms = gateForms(v);
          const variantAllowed = forms ? gatePolicy.roleAllows(role, forms, method) : false;
          if (!canonicalAllowed) {
            assert.strictEqual(variantAllowed, false, `${role} ${method} ${v} must stay refused like ${base}`);
          }
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 500, `expected a broad sweep, got ${checked}`);
});

test('CR-01: /api/admin — every variant is admin-prefixed (role check applies to reads too)', () => {
  for (const p of ['/api/admin', '/api/admin/users', '/api/admin/users/karen', '/api/admin/download-zip', '/api/admin/audit']) {
    for (const v of variants(p)) {
      const forms = gateForms(v);
      if (!forms) continue; // refused before any handler
      assert.strictEqual(gatePolicy.isAdminPath(forms), true, `${v} must be treated as /api/admin`);
      for (const role of ['hrbp', 'pmo', 'employee']) {
        assert.strictEqual(gatePolicy.roleAllows(role, forms, 'GET'), false, `${role} GET ${v}`);
      }
      assert.strictEqual(gatePolicy.roleAllows('admin', forms, 'GET'), true, `admin GET ${v}`);
    }
  }
});

test('CR-01: DEMO_ONLY_PREFIXES — every variant stays demo-only', () => {
  for (const rule of DEMO_ONLY_PREFIXES) {
    for (const method of rule.methods || ['POST']) {
      for (const v of variants(rule.prefix)) {
        const forms = gateForms(v);
        if (!forms) continue;
        assert.strictEqual(gatePolicy.isDemoOnly(forms, method), true, `${method} ${v} must stay demo-only`);
      }
    }
  }
});

test('CR-01: MUST_CHANGE_ALLOWED_PATHS — a must-change session cannot reach any other path by spelling', () => {
  for (const allowed of MUST_CHANGE_ALLOWED_PATHS) {
    assert.strictEqual(gatePolicy.mustChangeAllows([allowed]), true);
  }
  const others = ['/api/admin/users', '/api/auth/sessions', '/api/deals', '/api/employees'];
  for (const p of others) {
    for (const v of [p, ...variants(p)]) {
      const forms = gateForms(v);
      if (!forms) continue;
      assert.strictEqual(gatePolicy.mustChangeAllows(forms), false, v);
    }
  }
  for (const v of ['/api/auth/change-password/../../admin/users', '/api/auth/change-password%2F..%2F..%2Fadmin%2Fusers']) {
    assert.strictEqual(gateForms(v), null, `${v} is ambiguous and must be refused`);
  }
});

test('CR-01: control-plane (never-open) list — every variant still resolves to control', () => {
  const controlPaths = [
    ...resolver.CONTROL_PLANE_PATHS,
    '/api/admin/users', '/api/admin/users/karen', '/api/admin/deals', '/api/admin/deals/d1',
    '/api/auth/sessions', '/api/auth/sessions/abc', '/api/auth/change-password', '/api/deals/d1',
  ];
  for (const p of controlPaths) {
    assert.strictEqual(resolver.isControlPlanePath(p), true, `fixture ${p} must be control-plane`);
    for (const v of variants(p)) {
      const forms = gateForms(v);
      if (!forms) continue;
      const fake = { baseUrl: '/api', path: v.slice(4), portalUser: null, gatePathForms: forms };
      assert.strictEqual(resolver.resolveDatabase(fake).kind, 'control', `${v} must stay control-plane (never DEMO_OPEN)`);
      // and without the gate's hand-over (direct resolver callers)
      assert.strictEqual(resolver.resolveDatabase({ baseUrl: '/api', path: v.slice(4), portalUser: null }).kind, 'control', `${v} (no hand-over)`);
    }
  }
});

test('CR-01: credential-lockdown allowlist — only the exact canonical spelling passes', () => {
  const lockdown = createLockdown({ enabled: true });
  lockdown.noteDemoLogin('someone');
  const mw = lockdownMiddleware(lockdown);
  const run = (method, p) => {
    let passed = false;
    let status = null;
    const res = {
      set() { return res; }, status(s) { status = s; return res; }, json() { return res; },
      type() { return res; }, send() { return res; },
    };
    mw({ method, path: p }, res, () => { passed = true; });
    return { passed, status };
  };
  for (const asset of [...LOCKDOWN_STATIC_ALLOWLIST, '/healthz']) {
    assert.strictEqual(run('GET', asset).passed, true, `${asset} itself is served`);
    for (const v of [asset.toUpperCase(), asset.replace('/', '//'), asset + '/', '/x/..' + asset]) {
      const r = run('GET', v);
      assert.strictEqual(r.passed, false, `${v} must not pass the lockdown`);
      assert.strictEqual(r.status, 403);
    }
  }
  assert.strictEqual(run('POST', '/api/auth/login').passed, true);
  for (const v of ['/api/auth/../admin/users', '/api/auth/..%2Fadmin%2Fusers', '/api/auth%2F..%2Fadmin/users', '/api/Auth/login', '/API/auth/login']) {
    assert.strictEqual(run('POST', v).passed, false, `${v} must not ride the /api/auth/ prefix`);
  }
});

// --- live HTTP loops ---------------------------------------------------------

function seedAccountsAndSessions() {
  const cookies = {};
  const runtime = new Database(process.env.MA_RUNTIME_DB_PATH);
  try {
    runtime.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'runtime-schema.sql'), 'utf8'));
    for (const role of ROLES) {
      const username = 'cr01-' + role;
      if (!controlStore.getAccount(username)) {
        controlStore.createAccount({ username, name: username, role, hash: 'x', salt: null, disabled: false, mustChangePassword: false });
      }
      cookies[role] = 'ma_session=' + sessionsDb.createSession(runtime, { username, role, ttlMs: 600000 });
    }
  } finally {
    runtime.close();
  }
  return cookies;
}

function adminGetRoutes() {
  const out = [];
  for (const layer of app._router.stack) {
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    const p = layer.route.path;
    if (!p.startsWith('/api/admin') || p.includes(':')) continue;
    if (layer.route.methods.get) out.push(p);
  }
  return out;
}

test('CR-01 live: every GET /api/admin* route x every variant — non-admin 403/404, anonymous 401/404, never a 200', async () => {
  const cookies = seedAccountsAndSessions();
  const routes = adminGetRoutes();
  assert.ok(routes.includes('/api/admin/users') && routes.includes('/api/admin/download-zip'), 'route enumeration found the admin GETs');
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of routes) {
      for (const v of [...variants(route), route]) {
        for (const method of ['GET', 'HEAD']) {
          for (const role of ['hrbp', 'pmo', 'employee']) {
            const res = await fetch(base + v, { method, headers: { cookie: cookies[role] } });
            const body = method === 'GET' ? await res.text() : '';
            assert.ok([403, 404].includes(res.status), `${role} ${method} ${v} -> ${res.status}`);
            assert.ok(!body.includes('cr01-admin'), `${role} ${method} ${v} leaked the roster`);
          }
          const anon = await fetch(base + v, { method });
          if (method === 'GET') await anon.text();
          assert.ok([401, 404].includes(anon.status), `anonymous ${method} ${v} -> ${anon.status}`);
        }
      }
    }

    // admin is still allowed: the canonical path and the spellings the router
    // dispatches (trailing slash, `//`) answer 200; case/encoding variants 404.
    for (const v of ['/api/admin/users', ...variants('/api/admin/users')]) {
      const res = await fetch(base + v, { headers: { cookie: cookies.admin } });
      const body = await res.text();
      assert.ok(![401, 403].includes(res.status), `admin GET ${v} must not be refused (${res.status})`);
      if (res.status === 200) assert.ok(body.includes('cr01-employee'), 'admin sees the roster');
    }
    const ok = await fetch(base + '/api/admin/users', { headers: { cookie: cookies.admin } });
    assert.strictEqual(ok.status, 200);
    const users = await ok.json();
    assert.ok(users.some((u) => u.username === 'cr01-hrbp'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CR-01 live: ROLE_WRITE_POLICY x variants — a refused role is refused under every spelling', async () => {
  const cookies = seedAccountsAndSessions();
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    let probes = 0;
    for (const rule of ROLE_WRITE_POLICY) {
      const target = rule.exact ? rule.prefix : rule.prefix + '/probe';
      const method = (rule.methods && rule.methods[0]) || 'POST';
      for (const role of ROLES) {
        if (roleAllowedForWrite(role, target, method)) continue;
        for (const v of [target, ...variants(target)]) {
          const res = await fetch(base + v, {
            method, headers: { cookie: cookies[role], 'content-type': 'application/json' }, body: '{}',
          });
          await res.text();
          assert.ok([403, 404].includes(res.status), `${role} ${method} ${v} -> ${res.status}`);
          probes++;
        }
      }
      for (const v of [target, ...variants(target)]) {
        const res = await fetch(base + v, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
        await res.text();
        assert.ok([401, 404].includes(res.status), `anonymous ${method} ${v} -> ${res.status}`);
      }
    }
    // the exact self-service rule must not widen to a case variant the
    // case-sensitive router dispatches to a dynamic sibling route
    const sel = await fetch(base + '/api/deals/SELECT', {
      method: 'POST', headers: { cookie: cookies.employee, 'content-type': 'application/json' }, body: '{}',
    });
    await sel.text();
    assert.ok([403, 404].includes(sel.status), `employee POST /api/deals/SELECT -> ${sel.status}`);
    assert.ok(probes > 50, `expected a broad sweep, got ${probes}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
