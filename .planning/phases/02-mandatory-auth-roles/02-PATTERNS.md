# Phase 2: Mandatory Auth & Roles - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 10 (2 modified core, 2 new db files, 1 modified client file, 3 new test files, 2 modified launcher scripts + 1 seed-data edit)
**Analogs found:** 10 / 10 (all promote/harden an existing analog in this same repo — this is not a greenfield phase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|---------------|
| `server.js` (consolidated `/api` gate, session functions, `module.exports`) | middleware | request-response | `server.js` §auth itself, lines 92-248 (self-promotion, not an external analog) | exact (same file, being hardened) |
| `server.js` (`/api/auth/login\|logout\|me` + self password-change) | controller | request-response | `server.js` lines 208-242 (existing handlers) | exact |
| `db/sessions.js` (NEW) | model/service | CRUD (per-request lookup, not whole-object) | `db/store.js` (connection/pragma ownership, transaction style) | role-match (deliberately NOT the `ARRAY_COLLECTIONS` pattern — see Shared Patterns) |
| `db/schema.sql` (+ `sessions` table) | config/migration | batch (DDL) | `db/schema.sql` lines 15-53 (existing `CREATE TABLE ... ; CREATE INDEX ...` blocks) | exact |
| `db/collections.js` (NOT modified — sessions intentionally excluded) | config | — | `db/collections.js` itself (as a negative reference / boundary) | exact (pattern is "don't touch this file") |
| `db/store.js` (+ `getConnection()` export) | model | CRUD | `db/store.js` lines 92-95 (`requireDb()`) | exact |
| `public/js/transitions.js` (401-on-read redirect) | utility/client-bridge | request-response | `public/js/transitions.js` lines 5-36 (admin-token fetch wrapper) + lines 156-178 (`/api/auth/me` probe/redirect) | exact |
| `scripts/set-admin-password.js` (NEW, D-09 first-run secret) | utility | CRUD (one-shot) | `scripts/migrate-db-json-to-sqlite.js` (existing one-shot `scripts/*.js` CLI precedent) | role-match |
| `test/auth-route-inventory.test.js` (NEW) | test | request-response (integration sweep) | `test/migration-roundtrip.test.js` + `test/concurrent-write.test.js` | role-match (node:test style, adapted for HTTP not SQLite) |
| `test/role-enforcement.test.js` (NEW) | test | request-response | `test/concurrent-write.test.js` (temp-DB-per-test setup pattern) | role-match |
| `test/session-lifecycle.test.js` (NEW) | test | CRUD | `test/migration-roundtrip.test.js` (temp-DB-per-test + cleanup pattern) | role-match |
| `start.bat` / `start.command` (+ `DEMO_OPEN=1`) | config | — | `start.bat`/`start.command` themselves (existing `NODE_CMD`/install-guard structure) | exact |
| `db.json` `users` array (+ seeded `employee` account, D-12) | config/seed-data | — | existing 3 `users` entries (admin/karen/pmo) | exact |

## Pattern Assignments

### `server.js` — consolidated `/api` gate (replaces the two middlewares at ~148 and ~174)

**Analog:** `server.js` lines 92-248 (the existing auth region — this is a promote/harden, not a rebuild)

**Imports pattern** (already present, lines 1-9, no new imports needed beyond requiring the new `db/sessions.js`):
```javascript
const crypto = require('crypto');
// add:
const sessions = require('./db/sessions');
const { initDb, readDb, writeDb, getConnection } = require('./db/store'); // getConnection is new
```

**Existing two-gate structure being consolidated** (lines 148-181):
```javascript
app.use('/api', (req, res, next) => {
  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  const isAdminPath = req.path.startsWith('/admin');
  if (!isWrite && !isAdminPath) return next();
  if (req.path === '/auth/login' || req.path === '/auth/logout') return next();
  const supplied = req.get('X-Admin-Token') || '';
  const tokenOk = !!(ADMIN_TOKEN && supplied && timingSafeEqualStr(supplied, ADMIN_TOKEN));
  if (PORTAL_AUTH) {
    const sess = readSession(req);
    if (isAdminPath) {
      if (tokenOk || (sess && sess.role === 'admin')) return next();
      return res.status(403).json({ error: 'Administrator access required.' });
    }
    if (sess || tokenOk) return next();
    return res.status(401).json({ error: 'Login required.', authRequired: true });
  }
  if (!ADMIN_TOKEN) return next();
  if (tokenOk) return next();
  return res.status(401).json({ error: 'Admin authentication required. Provide a valid X-Admin-Token.' });
});

app.use('/api', (req, res, next) => {
  if (!PORTAL_AUTH) return next();
  if (req.path === '/auth/login' || req.path === '/auth/me') return next();
  const sess = readSession(req);
  if (!sess) return res.status(401).json({ error: 'Login required.', authRequired: true });
  req.portalUser = sess;
  next();
});
```

**Target consolidated shape** (RESEARCH.md's "Code Examples" section, verbatim-adaptable — copy this into the single new middleware, replacing both blocks above):
```javascript
function isOpenMode(req) {
  return process.env.DEMO_OPEN === '1'; // Phase 3 will AND this with req.isDemo
}
const PUBLIC_API_PATHS = new Set(['/auth/login', '/auth/logout', '/auth/me']);

app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  if (isOpenMode(req)) { req.portalUser = null; return next(); }

  const cookieToken = readSessionCookie(req);
  const sess = cookieToken ? sessions.findSession(getConnection(), cookieToken) : null;
  if (!sess) return res.status(401).json({ error: 'Login required.', authRequired: true });
  req.portalUser = sess;

  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (isWrite && !roleAllowedForWrite(sess.role, req.path)) {
    return res.status(403).json({ error: 'Your role cannot perform this action.' });
  }
  next();
});
```

**Auth/guard pattern to preserve verbatim** (`isAdminRequest`/`lockedDown` call sites, lines 185-194) — CONTEXT.md leaves the refactor to discretion but RESEARCH.md's Anti-Pattern flags `lockedDown()` must become request-aware:
```javascript
function isAdminRequest(req) { return !!(req.portalUser && req.portalUser.role === 'admin'); }
function lockedDown(req) { return !isOpenMode(req); }
```
Every existing call site of `lockedDown()` (no-arg) and `isAdminRequest(req)` elsewhere in `server.js` must be checked — `lockedDown()` becomes `lockedDown(req)`, a signature change touching every caller.

**Constant-time compare pattern to reuse for the new token-hash comparison** (line 104-108, keep as-is, reuse `timingSafeEqualStr`):
```javascript
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
```

**Login throttle — keep verbatim** (lines 196-206, no changes needed):
```javascript
const _loginAttempts = new Map();
function loginThrottled(ip) {
  const now = Date.now();
  const slot = _loginAttempts.get(ip);
  if (!slot || now > slot.reset) { _loginAttempts.set(ip, { count: 1, reset: now + 60000 }); return false; }
  slot.count++;
  return slot.count > 8;
}
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
```

**Password hashing — keep verbatim** (line 138-140):
```javascript
function hashPassword(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32).toString('hex');
}
```

**`module.exports` + listen guard (Pitfall 1, prerequisite for AUTH-01 test)** — target end-of-file shape, adapting lines 3042-3061:
```javascript
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`TE Connectivity M&A Portal server running on port ${PORT} (${PUBLIC_BASE_URL})`);
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 65000;
  server.keepAliveTimeout = 61000;
  function shutdown(signal) { /* unchanged body */ }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
module.exports = app;
```

---

### `server.js` — `/api/auth/login|logout|me` + self password-change

**Analog:** `server.js` lines 208-242 (extend in place, same file)

**Current login handler** (lines 208-228) — the row-lookup/throttle/constant-time-compare structure is kept; only the session-creation and cookie lines change:
```javascript
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!PORTAL_AUTH) return res.status(400).json({ error: 'Login is disabled (PORTAL_AUTH is not set).' });
  if (loginThrottled(req.ip || req.socket.remoteAddress || '?')) {
    return res.status(429).json({ error: 'Too many attempts — try again in a minute.' });
  }
  const db = readDb();
  const user = (db.users || []).find(u => u.username === String(username || '').trim().toLowerCase());
  const computed = hashPassword(password || '', user && user.salt ? user.salt : DUMMY_SALT);
  const ok = !!(user && user.hash && timingSafeEqualStr(computed, user.hash));
  if (!ok) {
    return setTimeout(() => res.status(401).json({ error: 'Invalid username or password.' }), 400);
  }
  const cookie = ['ma_session=' + makeSessionToken(user), 'Path=/', 'HttpOnly', 'SameSite=Lax',
    'Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)];
  if (process.env.ENABLE_HSTS === '1') cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
  res.json({ success: true, user: { username: user.username, name: user.name || user.username, role: user.role } });
});
```

**Target replacement** (D-01: `if (!PORTAL_AUTH) return ...` line is DELETED — login is now always on unless demo-open; D-06/D-08: session row + `SameSite=Strict`):
```javascript
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (loginThrottled(req.ip || req.socket.remoteAddress || '?')) {
    return res.status(429).json({ error: 'Too many attempts — try again in a minute.' });
  }
  const db = readDb();
  const user = (db.users || []).find(u => u.username === String(username || '').trim().toLowerCase());
  const computed = hashPassword(password || '', user && user.salt ? user.salt : DUMMY_SALT);
  const ok = !!(user && user.hash && timingSafeEqualStr(computed, user.hash));
  if (!ok) return setTimeout(() => res.status(401).json({ error: 'Invalid username or password.' }), 400);

  const token = sessions.createSession(getConnection(), {
    username: user.username, role: user.role, ttlMs: SESSION_TTL_MS,
    userAgent: req.get('user-agent'), ip: req.ip,
  });
  const cookie = ['ma_session=' + token, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    'Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)];
  if (process.env.ENABLE_HSTS === '1') cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
  res.json({ success: true, user: { username: user.username, name: user.name || user.username, role: user.role } });
});
```

**Logout — delete the session row (D-07)**, replacing lines 230-233:
```javascript
app.post('/api/auth/logout', (req, res) => {
  const token = readSessionCookie(req);
  if (token) sessions.deleteSession(getConnection(), token);
  res.setHeader('Set-Cookie', 'ma_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true });
});
```

**`/api/auth/me` (lines 235-242)** — stays on `PUBLIC_API_PATHS` allowlist per CONTEXT.md D-decision "confirmed"; only the session lookup mechanism swaps from `readSession(req)` to `sessions.findSession(getConnection(), readSessionCookie(req))`. No response-shape change.

**New: self password-change endpoint** — no direct analog exists (this is genuinely new), but follow the exact style of the adjacent `/api/auth/*` block (throttle-free since it requires an existing valid session, scrypt for the new hash, `writeDb()` for the `users` collection write):
```javascript
app.post('/api/auth/change-password', (req, res) => {
  if (!req.portalUser) return res.status(401).json({ error: 'Login required.' });
  const { currentPassword, newPassword } = req.body || {};
  const db = readDb();
  const user = (db.users || []).find(u => u.username === req.portalUser.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const computed = hashPassword(currentPassword || '', user.salt);
  if (!timingSafeEqualStr(computed, user.hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
  const newSalt = crypto.randomBytes(16).toString('hex');
  user.salt = newSalt;
  user.hash = hashPassword(newPassword || '', newSalt);
  writeDb(db);
  res.json({ success: true });
});
```

---

### `db/sessions.js` (NEW)

**Analog:** `db/store.js` — specifically its connection-ownership discipline (`requireDb()`, module-level `db` singleton, `db.transaction()` usage) — NOT its `ARRAY_COLLECTIONS`/whole-object CRUD pattern (see Shared Patterns / anti-pattern below).

**Connection-sharing pattern to copy** (`db/store.js` lines 92-95, plus the new export it requires):
```javascript
// db/store.js: add this export alongside the existing four
function getConnection() { return requireDb(); }
module.exports = { initDb, readDb, writeDb, idOf, projectIdOf, DEFAULT_DB_PATH, getConnection };
```

**Full target content for `db/sessions.js`** (from RESEARCH.md Pattern 2, verified-shape, ready to copy with only cosmetic adjustment):
```javascript
const crypto = require('crypto');

function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(conn, { username, role, ttlMs, userAgent, ip }) {
  const token = newSessionToken();
  const now = new Date();
  conn.prepare(
    `INSERT INTO sessions (token_hash, username, role, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(hashToken(token), username, role, now.toISOString(),
        new Date(now.getTime() + ttlMs).toISOString(), userAgent || null, ip || null);
  return token;
}

function findSession(conn, token) {
  const row = conn.prepare(
    `SELECT username, role, expires_at FROM sessions WHERE token_hash = ?`
  ).get(hashToken(token));
  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) return null;
  return { username: row.username, role: row.role };
}

function deleteSession(conn, token) {
  conn.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}
function deleteAllSessionsForUser(conn, username) {
  conn.prepare(`DELETE FROM sessions WHERE username = ?`).run(username);
}
function pruneExpiredSessions(conn) {
  conn.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
}

module.exports = { createSession, findSession, deleteSession, deleteAllSessionsForUser, pruneExpiredSessions };
```

**Error handling pattern:** `db/store.js` has no try/catch inside its query helpers — errors propagate to the caller (`writeDb()`'s docstring: "Throws on unrecoverable failure"). `db/sessions.js` should follow the same no-swallow convention — let `better-sqlite3` errors bubble to Express's error-handling middleware (server.js lines 3028-3032).

---

### `db/schema.sql` — new `sessions` table

**Analog:** any existing table block, e.g. lines 15-21 (`alerts`) — same `CREATE TABLE IF NOT EXISTS ... ; CREATE INDEX IF NOT EXISTS ...` two-statement shape, but sessions is NOT one of the `id/project_id/seq/data` JSON-blob tables — it has real typed columns (per RESEARCH.md Pattern 2, D-06 schema):
```sql
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at);
```
Place it in its own clearly-commented block (matching the file's existing per-table comment style at the top, lines 1-13), explicitly noting it is NOT part of the `ARRAY_COLLECTIONS` inventory.

---

### `public/js/transitions.js` — 401-on-read redirect handling

**Analog:** the existing admin-token fetch wrapper (lines 5-36) for the interception *mechanism*, and the `/api/auth/me` probe/redirect (lines 156-178) for the *redirect target*.

**Existing write-only 401 handling** (lines 25-33) — today only intercepts non-GET:
```javascript
return origFetch(input, init).then((res) => {
  if (res.status === 401 && isApi(url) && method !== 'GET' && typeof input === 'string') {
    const entered = window.prompt('Admin token required to save changes:');
    if (entered && entered.trim()) {
      localStorage.setItem(KEY, entered.trim());
      return origFetch(input, withToken(init, entered.trim()));
    }
  }
  return res;
});
```

**Target addition** (Pitfall 3 in RESEARCH.md): a new, separate interception for `authRequired:true` 401s that redirects regardless of method, added as its own IIFE near the existing ones (do not conflate with the `X-Admin-Token` prompt flow — different failure mode, different remedy). Suggested shape, following this file's existing `(function () { ... })()` IIFE-per-concern convention seen at lines 5, 41, 113, 156:
```javascript
(function () {
  if (window.__authRedirectWrapped || !window.fetch) return;
  window.__authRedirectWrapped = true;
  if (window.location.pathname.includes('login.html')) return;
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    return origFetch(input, init).then((res) => {
      if (res.status === 401) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        // reuse isApi()-equivalent same-origin /api/ check
        res.clone().json().then((body) => {
          if (body && body.authRequired) window.location.href = '/login.html';
        }).catch(() => {});
      }
      return res;
    });
  };
})();
```
Note: this must compose with the existing wrapper (both wrap `window.fetch`); the planner should decide ordering/merge rather than stacking two independent monkey-patches — flag for the plan.

**Existing redirect-on-no-session pattern to mirror** (lines 156-178, `me.user` falsy → redirect):
```javascript
fetch('/api/auth/me').then(r => r.json()).then(me => {
  if (!me || !me.authEnabled) return;
  if (!me.user) { window.location.href = '/login.html'; return; }
  ...
});
```

---

### `scripts/set-admin-password.js` (NEW, D-09)

**Analog:** `scripts/migrate-db-json-to-sqlite.js` — this repo's established one-shot CLI script precedent (imports `db/store.js`, does one job, exits). Read that file's shape (top-of-file `require`s, a single exported `run*` function callable both as CLI and from tests, `if (require.main === module) { ...; process.exit(...) }` guard) and mirror it for the admin-password-set script. Not read in full this pass — planner should Read `scripts/migrate-db-json-to-sqlite.js` directly when building this file; the key transferable pattern is the CLI/test dual-invocation guard, already proven at `server.js`'s own new `require.main === module` guard (Pitfall 1).

---

### `test/auth-route-inventory.test.js`, `test/role-enforcement.test.js`, `test/session-lifecycle.test.js` (NEW)

**Analog:** `test/migration-roundtrip.test.js` + `test/concurrent-write.test.js` — both establish this repo's `node:test` conventions.

**Imports pattern to copy verbatim** (both files, lines 11-21 / 16-21):
```javascript
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
```

**Temp-DB-per-test setup/cleanup pattern to copy** (`test/concurrent-write.test.js` lines 27-46, `test/migration-roundtrip.test.js` lines 23-31):
```javascript
function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-<suite-name>-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}
// then, inside each test():
delete require.cache[require.resolve('../db/store.js')];
const store = require('../db/store.js');
store.initDb(dbPath);
```
This `delete require.cache[...]` + fresh `require()` pattern is required because `db/store.js` holds module-level singleton state (`let db = null`) — every new test file that needs a fresh SQLite handle must repeat this exact idiom, and `server.js`'s own `require('./db/store')` + `require('./db/sessions')` will need the equivalent reset before `require('../server.js')` in `auth-route-inventory.test.js` if a prior test file already initialized a store against a different path.

**`node:test` structure/assertion style** (`test/concurrent-write.test.js` lines 37-60 — single `test('description', () => { try { ... } finally { cleanupDbFile(...) } })` body, `assert.ok`/`assert.strictEqual` calls with descriptive messages as the second argument):
```javascript
test('concurrent-write: two same-collection concurrent adds both survive (no lost update)', () => {
  const dbPath = tempDbPath('same-collection');
  try {
    // ... setup + assertions with message args ...
  } finally {
    cleanupDbFile(dbPath);
  }
});
```
Apply the same try/finally-cleanup shape to all three new test files.

**`auth-route-inventory.test.js` specific content** — copy directly from RESEARCH.md's verified `listApiRoutes()` + test sketch (already empirically run against this repo's `express@4.22.2`); requires `server.js`'s `module.exports = app` + `require.main === module` guard to land first (Pitfall 1 dependency ordering — flag as a task-ordering constraint for the plan).

**Header comment convention** — every existing test file opens with a multi-line `//` comment naming the requirement ID it proves and *why* the test is structured the way it is (see `test/concurrent-write.test.js` lines 1-14, `test/migration-roundtrip.test.js` lines 1-9). New test files should do the same, referencing AUTH-01/02/03/04 by ID.

---

### `start.bat` / `start.command` — demo-open flag (D-02)

**Analog:** the files themselves — the `NODE_CMD` resolution + install-guard structure is unchanged; only an env-var export needs to be added before the `node server.js` invocation.

**`start.bat` target insertion** (before line 38's `"%NODE_CMD%" server.js`):
```bat
set "DEMO_OPEN=1"
```

**`start.command` target insertion** (before line 28's `exec "$NODE_CMD" server.js`):
```bash
export DEMO_OPEN=1
```
Both launchers already follow a linear "resolve Node → install-guard → announce → run" structure (start.bat lines 5-39, start.command lines 5-28) — the new line is a one-line insertion, no restructuring needed. Do not touch the "Download ZIP" admin-export code path (`server.js`'s `/api/admin/download-zip`, not in this phase's file list) — it already excludes `node_modules`; the `DEMO_OPEN` flag only needs to reach these two launcher scripts.

---

### `db.json` `users` array — seed one demo `employee` account (D-12)

**Analog:** the three existing entries (admin/karen/pmo), `db.json` lines 10011-10031 — same shape, new `role: "employee"` value:
```json
{
  "username": "employee-demo",
  "name": "Demo Employee",
  "role": "employee",
  "salt": "<crypto.randomBytes(16).toString('hex')>",
  "hash": "<hashPassword('<demo-password>', salt)>"
}
```
The salt/hash pair must be generated via `hashPassword()` (server.js line 138-140 / reused in a one-off script), not hand-typed — copy the generation approach `scripts/migrate-db-json-to-sqlite.js` or a throwaway `node -e` snippet would use, consistent with how the existing three accounts were presumably seeded (their salt/hash pairs are already scrypt output, not derivable by inspection).

## Shared Patterns

### Consolidated session/role gate
**Source:** `server.js` lines 148-194 (existing two-gate structure being merged into one)
**Apply to:** the single new `app.use('/api', ...)` middleware — every `/api/*` route inherits this automatically; no per-route change needed for AUTH-01/AUTH-02's blanket coverage.

### Constant-time comparison
**Source:** `server.js` lines 102-108 (`timingSafeEqualStr`)
**Apply to:** the new session-token-hash lookup path (already constant-time via SQLite indexed equality + SHA-256 hashing before compare — no additional `timingSafeEqualStr` call needed for the token itself since it's a hash-and-lookup, not a raw string compare) and the `ADMIN_TOKEN` header check (unchanged, kept as-is per D-11).

### Non-enumerable internal state must never leak into `res.json(db)`
**Source:** `db/store.js` lines 120-123 (`__snapshot` via `Object.defineProperty(..., { enumerable: false })`)
**Apply to:** N/A directly for sessions (sessions live in their own dedicated table, never inside the whole-object `db` structure returned by `readDb()`) — but this is the concrete precedent RESEARCH.md's Pitfall 6 cites for *why* sessions must NOT be added to `ARRAY_COLLECTIONS`: doing so would mean every `res.json(db)`-style whole-object serialization (dozens of endpoints) would need the same non-enumerable treatment sessions don't currently need because they're architecturally separate.

### One-shot CLI script shape
**Source:** `scripts/migrate-db-json-to-sqlite.js` (not fully read this pass — Read directly when building `scripts/set-admin-password.js`)
**Apply to:** `scripts/set-admin-password.js`

### `node:test` file structure (imports, temp-DB lifecycle, try/finally cleanup, descriptive assert messages, requirement-ID header comment)
**Source:** `test/concurrent-write.test.js`, `test/migration-roundtrip.test.js`
**Apply to:** all three new test files (`test/auth-route-inventory.test.js`, `test/role-enforcement.test.js`, `test/session-lifecycle.test.js`)

### Launcher env-var propagation
**Source:** `start.bat`/`start.command`'s existing linear structure (Node resolution → install-guard → run)
**Apply to:** both launchers, one-line `DEMO_OPEN=1` insertion before the `node server.js` invocation

## No Analog Found

None. Every file in this phase's scope is either a direct promotion of existing `server.js` §auth code, a small dedicated addition alongside an established sibling pattern (`db/schema.sql` table block, `test/*.test.js` node:test file, `scripts/*.js` CLI precedent), or a one-line launcher/seed-data edit. This is consistent with CONTEXT.md's framing: "a real login already exists... the work is enforcement... not a greenfield auth build."

## Metadata

**Analog search scope:** `server.js` (full-file grep + targeted reads of lines 1-260, 3030-3061), `db/store.js` (full file, 218 lines), `db/schema.sql` (header + first 60 lines, representative of the repeating per-table block), `db/collections.js` (full file, 70 lines), `public/js/transitions.js` (lines 1-190), `test/concurrent-write.test.js` (lines 1-60), `test/migration-roundtrip.test.js` (lines 1-45), `start.bat` (full), `start.command` (full), `db.json` `users` array (grep).
**Files scanned:** 10 direct reads + 2 targeted greps
**Pattern extraction date:** 2026-07-24
