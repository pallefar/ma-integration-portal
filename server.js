const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const compression = require('compression');
const aiService = require('./aiService');
const ragService = require('./ragService');
// ISO-01/02/03 (Phase 3): the deal-resolver, its control.db/runtime.db
// accessor, and the shared database-path/schema-path constants — see the
// consolidated /api gate below for how these three modules plug together.
const dbFiles = require('./db/dbFiles');
const controlStore = require('./db/controlStore');
const resolver = require('./db/resolver');
const { createDealDatabase } = require('./db/dealSeed');
// DD-04 (Phase 4 Plan 01): the clean-room need-to-know filter guarding every
// due-diligence route below (see the /api/dd section for how it's used).
const accessPolicy = require('./db/accessPolicy');
// AUD-01/D-08 (Phase 3 Plan 05): the store-layer audit hook — db/store.js's
// writeDb() dispatches to it automatically for every deal write; server.js
// itself calls recordSecurityEvent() directly at each D-08 control-plane
// event site below (break-glass token use, password change, session
// revocation, deal lifecycle/membership), and queryAudit() backs the
// admin-only GET /api/admin/audit viewer route.
const auditHook = require('./db/auditHook');
// VAL-01/VAL-02 (Phase 3 Plan 06): validators/index.js is the shared,
// generic, path-resolved validation pipeline (WRITE_SCHEMAS registry +
// validationMiddleware) mounted once in the consolidated /api gate below.
// Requiring each resource-group validator module HERE (at server.js's own
// module load time, before any request can arrive) is what populates
// WRITE_SCHEMAS — each module's own registerSchema() calls run as a require()
// side effect. validators/deals.js (Plan 04, VAL-01's first instance) is
// required for the same reason its schemas must be registered before this
// module's own routes below can be reached.
const validators = require('./validators/index');
require('./validators/deals'); // require()d for its registerSchema() side effect only
require('./validators/workstream'); // ditto
require('./validators/cms'); // ditto
require('./validators/people'); // ditto
require('./validators/assessment'); // ditto
require('./validators/settings'); // ditto
require('./validators/dd'); // ditto


const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
// db.json (D-01): the live persistence layer is SQLite (db/store.js) as of
// Phase 1. db.json itself is retained on disk purely as a frozen, read-only
// point-in-time snapshot from migration time — no code path below reads or
// writes it anymore. It exists only as a fixture for the migration test
// suite (see test/migration-roundtrip.test.js, test/concurrent-write.test.js)
// and as a historical reference.
//
// ISO-01/02/03 (Phase 3): the single-file store this comment used to name is
// itself now retired. The live app reads and writes exclusively through FOUR
// physical SQLite files (db/dbFiles.js is the single source of truth for
// every path): control.db (accounts + the deal registry, committed,
// near-static), demo.db (the showcase, committed), runtime.db (sessions +
// secrets, gitignored) and one deals/<id>.db per real acquisition
// (gitignored). Which file any given request reads/writes is decided ONCE,
// per request, by db/resolver.js's dealResolverMiddleware — see the
// consolidated /api gate below. The pre-split single file this app used
// before this phase is archived read-only (chmod 444), retained not
// deleted, per the same precedent Phase 1 set for db.json above.

// WR-04: req.ip (used for the new sessions.ip audit column and the login
// throttle) resolves to the DIRECT peer address by default — under this
// app's documented production target (self-hosted behind a reverse proxy /
// TLS terminator, see CLAUDE.md) that peer is the proxy itself, not the
// client, unless Express is told how many hops to trust. Defaulting to
// trusting an unbounded X-Forwarded-For chain would let any client spoof its
// own IP (defeating both the session audit trail and the throttle), so this
// stays OFF (Express default: req.ip = the raw socket address) unless an
// operator opts in with TRUST_PROXY, matching their actual reverse-proxy hop
// count (e.g. TRUST_PROXY=1 for a single nginx/Caddy hop in front of Node).
// See https://expressjs.com/en/guide/behind-proxies.html for the accepted
// value shapes (integer hop count, 'loopback', a specific IP/CIDR, etc.).
if (process.env.TRUST_PROXY) {
  const raw = process.env.TRUST_PROXY;
  const asNumber = Number(raw);
  app.set('trust proxy', Number.isInteger(asNumber) && String(asNumber) === raw ? asNumber : raw);
  console.warn(`[security] TRUST_PROXY=${raw} — req.ip now resolves via X-Forwarded-For per this setting. Ensure it matches your ACTUAL reverse-proxy hop count/address, or a client can spoof its own IP.`);
}

app.use(compression());

// --- Security response headers -----------------------------------------------
// Behaviour-preserving hardening: no dependency, applied to every response
// (static assets + API). The CSP keeps 'unsafe-inline'/'unsafe-eval' because the
// app relies on inline scripts/styles and the vendored Transformers.js WASM
// runtime; it still blocks external script injection, arbitrary data exfil
// (connect-src), object/embed, base-tag hijack, framing and form hijack.
app.disable('x-powered-by');
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://www.youtube.com https://youtube.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com https://*.huggingface.co",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com",
  "media-src 'self' blob: data: https://*.youtube.com",
  "worker-src 'self' blob:"
].join('; ');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // HSTS is only meaningful behind TLS (terminated by the reverse proxy in the
  // internal deployment); enable it explicitly so the plain-HTTP local demo is
  // unaffected.
  if (process.env.ENABLE_HSTS === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// VAL-01: a malformed JSON body (including a bare top-level `null`, which
// body-parser's strict mode rejects as invalid JSON — only object/array are
// valid top-level JSON in strict mode) must 400, never fall through to the
// generic 500 error handler at the bottom of this file. This keeps "a null
// body" behaviourally identical to "an empty/missing body" for every write
// route, matching the write-validation pipeline's own contract that a
// malformed request never crashes.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }
  next(err);
});

// The app now starts on the M&A HR Integration Enablement overview (the executive
// slide deck embedded as an app page). The role-based showcase stays at /index.html,
// one click away via the overview's "Enter the Portal" CTA. Registered BEFORE the
// static middleware so it wins for exactly "/" (static's default would serve index.html).
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'overview.html'));
});

// Long-cache versioned static assets (JS/CSS/images already carry ?v= busting);
// always revalidate HTML so users never get a stale page pointing at old assets.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.wasm$/i.test(filePath)) {
      // Vendored Transformers.js ONNX runtime — needs the application/wasm MIME for
      // streaming compilation, and is safe to long-cache (versioned by vendor bump).
      res.setHeader('Content-Type', 'application/wasm');
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (/\.(js|css|png|jpe?g|svg|webp|ico|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// --- Optional admin auth gate ------------------------------------------------
// Production locks down every state-changing endpoint (POST/PUT/DELETE) and the
// /api/admin/* routes behind a shared secret. Set ADMIN_TOKEN in the environment
// to enable it; when unset (e.g. the local demo) the gate stays OPEN but logs a
// warning, so the running demo is unaffected until you set the env var. The admin
// browser UI sends the secret via the X-Admin-Token header (fetch bridge in transitions.js).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
if (!ADMIN_TOKEN) {
  console.warn('[security] ADMIN_TOKEN not set — write/admin API endpoints are OPEN. Set ADMIN_TOKEN in production to require authentication.');
}
// WR-03: DEMO_OPEN=1 is strictly more consequential than an unset ADMIN_TOKEN
// — it disables the ENTIRE mandatory session gate for every /api/* route,
// reads included (see isOpenMode() below) — yet previously logged nothing at
// startup. An operator who carries DEMO_OPEN=1 into a real-deal deployment
// (e.g. by copying start.bat/start.command verbatim, which set it
// unconditionally for the demo showcase) must get a loud server-side signal.
if (process.env.DEMO_OPEN === '1') {
  console.warn('[security] DEMO_OPEN=1 — ALL /api authentication and authorization is DISABLED. Never set this for a real-deal deployment.');
}
// Constant-time string comparison (hash to equal length first so timingSafeEqual
// never throws on mismatched lengths and the compare itself leaks no timing info).
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
// --- Mandatory login (fail-closed by default, D-01) --------------------------
// Auth is now ALWAYS required on every /api/* endpoint (reads included)
// unless the deployment explicitly opts into DEMO_OPEN=1 (D-02 — the demo
// showcase launchers set this; real-deal deployments never do). This inverts
// the previous "open unless PORTAL_AUTH=1" default. PORTAL_AUTH is kept as a
// tolerated, non-gating env var name for backward compatibility with any
// existing deployment scripts, but no code path below reads it to make an
// authorization decision anymore.
//
// Sessions are opaque tokens backed by a revocable SQLite `sessions` table
// (db/sessions.js) rather than the previous stateless HMAC-signed cookie —
// see D-06/D-07: logout, admin revoke-all and absolute expiry all now take
// effect immediately instead of waiting out an unrevocable signed cookie.
const PORTAL_AUTH = process.env.PORTAL_AUTH === '1'; // vestigial; not used to gate anything below
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashPassword(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

// isOpenMode(req) is the ONE seam that decides whether this request may skip
// the session gate entirely (D-02, the demo showcase). D-03 (Phase 3):
// `req.isDemo` is set by db/resolver.js's dealResolverMiddleware BEFORE this
// function is ever consulted (the consolidated gate below resolves the
// database first, then checks isOpenMode) — so a session bound to a REAL
// deal is NEVER open, regardless of this env flag. Only an unauthenticated
// request (which always resolves to demo.db, since it carries no deal
// binding) or a session explicitly bound to demo can ever pass this check.
function isOpenMode(req) {
  return process.env.DEMO_OPEN === '1' && req.isDemo === true;
}

// The only /api paths reachable without a session — auth bootstrapping itself
// cannot require a session to exist first.
const PUBLIC_API_PATHS = new Set(['/auth/login', '/auth/logout', '/auth/me']);

// Extracts the raw opaque session token from the `ma_session` cookie (replaces
// the previous HMAC payload decode — the token itself carries no data; it is
// looked up against the sessions table).
function readSessionCookie(req) {
  const cookies = String(req.headers.cookie || '');
  const m = cookies.match(/(?:^|;\s*)ma_session=([^;]+)/);
  return m ? m[1] : null;
}

// Coarse role -> resource-group capability map (D-04/D-05, AUTH-02). Consulted
// ONLY for writes — reads stay gated on session-existence alone (D-05); coarse
// role-filtering of read *payloads* is Phase 4 clean-room territory, except
// where an endpoint already hands back admin-only data (the lockedDown(req)/
// isAdminRequest(req) guards below, preserved).
//
// This is a path-PREFIX default-allow table, not a hand-annotated list of the
// ~90 endpoints (D-05 explicitly rejects that — it wouldn't scale across the
// next 4 milestone phases' new routes). Unlisted prefixes fall through to
// DEFAULT_WRITE_ROLES, which matches today's ACTUAL behavior for admin/hrbp/
// pmo on the 59 non-admin write routes (no regression for those three roles)
// — the only new restriction this table introduces is that `employee` is
// opt-in-only via the explicit self-service allowlist below, never silently
// open by default. A future endpoint added without an explicit prefix entry
// is therefore safe-by-default (admin/hrbp/pmo, never employee).
// CR-01 fix: a plain `path.startsWith(prefix)` has no path-boundary check, so
// e.g. the `/api/assessment` self-service entry used to ALSO match
// `/api/assessments/:id` (plural, admin CRUD) and `/api/assessment-instances/:id`
// purely because both strings happen to begin with the same characters. Every
// rule below is matched boundary-safely — `path === prefix` or
// `path.startsWith(prefix + '/')` — via pathMatchesPrefix(), so a rule can
// never bleed into an unrelated sibling route just because it shares a string
// prefix (this also closes WR-05's broader "any future route silently
// inherits an existing prefix's roles" class of bug). A rule may additionally
// pin `methods: [...]` so it only ever applies to specific HTTP verbs — used
// below so the self-service `POST /api/assessment(-instances)` entries can
// NEVER cover `DELETE /api/assessments/:id` or
// `DELETE /api/assessment-instances/:id` (both admin/PMO cleanup per their
// own inline route comments), which instead fall through untouched to
// DEFAULT_WRITE_ROLES (no `employee`).
function pathMatchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/');
}

const ROLE_WRITE_POLICY = [
  { prefix: '/api/admin', roles: ['admin'] }, // migrate-db, download-zip, revoke-sessions — ALL methods (see CR-02 gate below)

  // Self-service allowlist: the ONLY prefixes 'employee' may write to today.
  { prefix: '/api/pulses', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/employees/complete-lesson', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/employees/uncomplete-lesson', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  // Boundary-safe AND POST-only: covers only `POST /api/assessment` (own
  // submission) and `POST /api/assessment-instances` (self-submission).
  // `DELETE /api/assessments/:id` and `DELETE /api/assessment-instances/:id`
  // do not match `methods: ['POST']` here, and no other rule below matches
  // them either, so both fall through to DEFAULT_WRITE_ROLES (CR-01).
  { prefix: '/api/assessment', exact: true, methods: ['POST'], roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/assessment-instances', exact: true, methods: ['POST'], roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/auth/change-password', roles: ['admin', 'hrbp', 'pmo', 'employee'] }, // D-09: every role may change their OWN password

  // D-01/D-03 (Phase 3): ANY authenticated role may select a deal they are a
  // member of — this is how an employee/pmo member switches INTO a deal
  // they already belong to, not how deals get created. Placed BEFORE the
  // broader '/api/deals' entry below (roleAllowedForWrite() takes the FIRST
  // matching rule) since 'exact: true' + boundary-safe matching would
  // otherwise never get a chance to override the broader prefix's roles.
  { prefix: '/api/deals/select', exact: true, methods: ['POST'], roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  // D-02: deal creation is admin + hrbp (Integration Lead) only. This same
  // prefix also covers POST /api/deals/:id/members (membership edits) —
  // ROLE_WRITE_POLICY's flat-prefix matcher has no wildcard for a fixed
  // suffix after a dynamic :id segment, so the members route additionally
  // enforces admin-only INLINE in its own handler (isAdminRequest(req)) on
  // top of this coarser admin+hrbp gate; see that route's own comment.
  { prefix: '/api/deals', roles: ['admin', 'hrbp'] },

  // DD-04: the due-diligence write surface is stated explicitly rather than
  // inherited from DEFAULT_WRITE_ROLES below — even though the two role sets
  // happen to be identical today, an explicit entry means a future change to
  // DEFAULT_WRITE_ROLES cannot silently widen who may write DD content.
  // `employee` must never write DD content (MNPI).
  { prefix: '/api/dd', roles: ['admin', 'hrbp', 'pmo'] },

  // Everything else under /api that accepts writes today (projects, employees
  // roster CRUD, integration-tasks, raid, synergies, departments, processes,
  // CMS: courses/pages/menus/slides/media/banners, settings, communications,
  // alerts, questions, hrbps, dashboard/reorder-widgets) — no explicit entry
  // needed; falls through to DEFAULT_WRITE_ROLES below.
];
const DEFAULT_WRITE_ROLES = ['admin', 'hrbp', 'pmo'];

function roleAllowedForWrite(role, path, method) {
  const rule = ROLE_WRITE_POLICY.find(r => {
    const pathMatches = r.exact ? path === r.prefix : pathMatchesPrefix(path, r.prefix);
    if (!pathMatches) return false;
    if (r.methods && !r.methods.includes(method)) return false;
    return true;
  });
  const allowed = rule ? rule.roles : DEFAULT_WRITE_ROLES;
  return allowed.includes(role);
}

// ISO-02: the demo-only showcase mechanics (time-travel day-scaling, the
// XP/merit-award/lesson-completion endpoints that drive points/badges/
// leaderboards) — gated ONCE here in the consolidated gate, in the exact
// same boundary-safe `{ prefix, exact?, methods? }` shape ROLE_WRITE_POLICY
// already uses, never as scattered per-handler `if (!req.isDemo)` checks
// (03-RESEARCH.md's own named anti-pattern — the same shape ISO-03 is
// replacing for the demoMode flag). A refused call leaves the resolved
// deal's stored data byte-identical — see test/demo-only-gating.test.js.
const DEMO_ONLY_PREFIXES = [
  { prefix: '/api/settings/time-travel', exact: true, methods: ['POST'] },
  { prefix: '/api/employees/award-merit', exact: true, methods: ['POST'] },
  { prefix: '/api/employees/complete-lesson', exact: true, methods: ['POST'] },
  { prefix: '/api/employees/uncomplete-lesson', exact: true, methods: ['POST'] },
];
function isDemoOnlyPath(fullPath, method) {
  return DEMO_ONLY_PREFIXES.some(r => {
    const pathMatches = r.exact ? fullPath === r.prefix : pathMatchesPrefix(fullPath, r.prefix);
    if (!pathMatches) return false;
    if (r.methods && !r.methods.includes(method)) return false;
    return true;
  });
}

// ONE consolidated /api gate (replaces the two overlapping middlewares this
// codebase previously ran — a write/admin-token gate and a separate session
// gate). Every /api/* route now goes through exactly this path:
//   (a) the 3 public auth-bootstrap paths pass straight through — BEFORE
//       identity resolution or the deal-resolver run at all (login/logout
//       have no session yet to resolve a deal binding from; /auth/me
//       resolves its own session + open-mode check inline, see its handler,
//       since it must stay reachable with zero session and never 401 here);
//   (b) an X-Admin-Token bearer resolves to a stable, ATTRIBUTED break-glass
//       identity (D-11) — {username:'admin-token', role:'admin'} — never an
//       anonymous bypass, so Phase 3's audit log can attribute its actions;
//   (c) otherwise, a valid, unexpired sessions-table row (looked up against
//       runtime.db, D-07) resolves req.portalUser — a MISS leaves it
//       unresolved (null) here, it does NOT 401 yet, because DEMO_OPEN may
//       still rescue an anonymous demo request once its deal binding (none)
//       is known;
//   (d) db/resolver.js's dealResolverMiddleware runs NEXT — this is the
//       bootstrapping inversion 03-PATTERNS.md flags: it must run BEFORE the
//       open-mode check below, because isOpenMode(req) now depends on
//       req.isDemo. It sets req.dealContext/req.isDemo and binds the
//       resolved connection for the whole downstream chain (ISO-01/03). A
//       failed deal bind (missing/archived/non-member) short-circuits here
//       with its own status, never falling back to demo (Pitfall 3);
//   (e) NOW isOpenMode(req) is evaluated — true only when DEMO_OPEN=1 AND
//       this request resolved to demo.db (D-03) — sets req.portalUser = null
//       (explicit, not undefined — AUTH-04) and passes through;
//   (f) otherwise, a still-unresolved req.portalUser 401s with
//       `authRequired: true` (AUTH-01's fail-closed default, D-01), never
//       trusting any client-supplied identity claim;
//   (g) ISO-02: a demo-only path refused for a non-demo resolved database
//       403s here, before the role check — see DEMO_ONLY_PREFIXES above;
//   (h) writes (+ every /api/admin/* method): the caller's role is checked
//       against ROLE_WRITE_POLICY (AUTH-02) — a mismatch 403s before the
//       route handler ever runs.
app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) return next();

  const suppliedToken = req.get('X-Admin-Token') || '';
  if (ADMIN_TOKEN && suppliedToken && timingSafeEqualStr(suppliedToken, ADMIN_TOKEN)) {
    // D-11: attributed break-glass identity, not anonymous — Phase 3's audit
    // log (AUD-01) can attribute every action taken via this token to a
    // stable, named identity instead of a null/undefined actor. Never
    // deal-bound (dealId: null) — a break-glass token has no session row to
    // persist a deal selection on.
    req.portalUser = { username: 'admin-token', role: 'admin', sessionId: null, dealId: null };
    // D-08: every use of the break-glass token is itself a control-plane
    // security event — this token grants admin-equivalent access outside a
    // normal session's own trail, so each use is recorded here, attributed
    // to this stable identity, never anonymously.
    auditHook.recordSecurityEvent({
      actor: req.portalUser,
      action: 'admin-token-use',
      subject: `${req.method} ${(req.baseUrl || '') + (req.path || '')}`,
      request: requestMeta(req),
    });
  } else {
    const cookieToken = readSessionCookie(req);
    const sess = cookieToken ? sessions.findSession(getRuntimeConnection(), cookieToken) : null;
    req.portalUser = sess; // may be null here — see step (c) above
  }

  resolver.dealResolverMiddleware(req, res, () => {
    // CR-02: DEMO_OPEN=1 documents itself as disabling auth/authz only — it
    // must NOT also bypass VAL-01/VAL-02 shape-validation and sanitization,
    // which apply regardless of who (or whether anyone) is signed in.
    // validationMiddleware is a no-op for non-write methods, so this short
    // circuit still returns immediately for open-mode reads.
    if (isOpenMode(req)) {
      req.portalUser = null;
      return validators.validationMiddleware(req, res, next);
    }

    if (!req.portalUser) return res.status(401).json({ error: 'Login required.', authRequired: true });

    // NOTE: req.path is mount-relative inside the consolidated /api gate above
    // (e.g. '/pulses', not '/api/pulses') — ROLE_WRITE_POLICY's/DEMO_ONLY_PREFIXES'
    // prefixes are written as full '/api/...' paths (matching this file's
    // route registrations 1:1), so req.baseUrl ('/api') + req.path
    // reconstructs the full path both lookups expect.
    const fullPath = req.baseUrl + req.path;

    if (isDemoOnlyPath(fullPath, req.method) && !req.isDemo) {
      return res.status(403).json({ error: 'This showcase-only feature is unavailable inside a real deal.' });
    }

    const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    // CR-02: /api/admin/* must require the admin role for EVERY method, not
    // just writes — before this phase, admin-prefixed routes (e.g.
    // GET /api/admin/download-zip) were gated regardless of method. The
    // consolidated gate had narrowed that role check to writes only, silently
    // opening every admin-prefixed GET (source/db archive download, etc.) to
    // any authenticated non-admin session. Reads elsewhere stay gated on
    // session-existence alone (D-05) — this carve-out is admin-prefix-only.
    const requiresRoleCheck = isWrite || pathMatchesPrefix(fullPath, '/api/admin');
    if (requiresRoleCheck && !roleAllowedForWrite(req.portalUser.role, fullPath, req.method)) {
      return res.status(403).json({ error: 'Your role cannot perform this action.' });
    }
    // VAL-01/VAL-02: shape-validate, strip unknown keys, and sanitize
    // HTML-tagged fields — LAST in this gate, after identity resolution, the
    // deal-resolver bind, the demo-only check and the role check, so a
    // request that would be refused on any of those grounds never has its
    // payload parsed at all. validators/index.js#validationMiddleware is a
    // no-op for non-write methods (GET/HEAD/OPTIONS pass straight through).
    validators.validationMiddleware(req, res, next);
  });
});

// True when the deployment is locked down at all (i.e. NOT demo-open) — used
// by read endpoints that must not hand sensitive records to non-admins.
// Request-aware per D-03: "locked down" can no longer be a static global
// boolean once Phase 3's deal-resolver ties isOpenMode() to which database was
// resolved (a real-deal database is ALWAYS locked down regardless of any
// flag) — every call site below now passes req.
function lockedDown(req) { return !isOpenMode(req); }
function isAdminRequest(req) {
  const supplied = req.get('X-Admin-Token') || '';
  if (ADMIN_TOKEN && supplied && timingSafeEqualStr(supplied, ADMIN_TOKEN)) return true;
  if (req.portalUser && req.portalUser.role === 'admin') return true;
  return false;
}

// Tiny in-memory login throttle: scrypt is deliberately expensive, so cap
// attempts per source before doing any hashing work.
const _loginAttempts = new Map();
function loginThrottled(ip) {
  const now = Date.now();
  const slot = _loginAttempts.get(ip);
  if (!slot || now > slot.reset) { _loginAttempts.set(ip, { count: 1, reset: now + 60000 }); return false; }
  slot.count++;
  return slot.count > 8;
}
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  // D-01: login is now ALWAYS available (no more "disabled unless PORTAL_AUTH=1") —
  // it is the sole path into a mandatory-by-default app.
  if (loginThrottled(req.ip || req.socket.remoteAddress || '?')) {
    return res.status(429).json({ error: 'Too many attempts — try again in a minute.' });
  }
  // ISO-01 (Task 2 cutover): accounts moved OUT of the request-bound
  // readDb()/writeDb() model into control.db, reached only through
  // db/controlStore.js — a deal-bound request can never read/write the
  // account store through its own connection (T-03-16).
  const user = controlStore.findUser(String(username || '').trim().toLowerCase());
  // Always run scrypt (dummy salt for unknown users) so response time never
  // reveals whether the username exists.
  const computed = hashPassword(password || '', user && user.salt ? user.salt : DUMMY_SALT);
  const ok = !!(user && user.hash && timingSafeEqualStr(computed, user.hash));
  if (!ok) {
    return setTimeout(() => res.status(401).json({ error: 'Invalid username or password.' }), 400);
  }
  // Opportunistic cleanup, not a security mechanism — piggyback on the
  // low-frequency login path rather than adding an interval timer (this
  // codebase has none). Sessions live in runtime.db (D-07), not the
  // request-bound connection (this route bypasses the resolver entirely —
  // PUBLIC_API_PATHS).
  sessions.pruneExpiredSessions(getRuntimeConnection());
  const token = sessions.createSession(getRuntimeConnection(), {
    username: user.username, role: user.role, ttlMs: SESSION_TTL_MS,
    userAgent: req.get('user-agent'), ip: req.ip,
  });
  // SameSite=Strict (was Lax, D-08) — this app has no cross-site inbound-link
  // flow that depends on Lax's top-level-navigation carve-out, and every
  // write is already same-origin JSON fetch() (no classic <form> posts, no
  // CORS headers ever set), so Strict closes the CSRF gap with no functional
  // impact.
  const cookie = ['ma_session=' + token, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    'Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)];
  if (process.env.ENABLE_HSTS === '1') cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
  res.json({ success: true, user: { username: user.username, name: user.name || user.username, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  // D-07: logout deletes the session row immediately — revocation is real,
  // not a wait for the cookie to expire.
  const token = readSessionCookie(req);
  if (token) sessions.deleteSession(getRuntimeConnection(), token);
  res.setHeader('Set-Cookie', 'ma_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  // Stays on PUBLIC_API_PATHS by design — this is the client's "am I logged
  // in" probe and must be reachable without a session already existing, so
  // it never goes through db/resolver.js's dealResolverMiddleware (that only
  // runs for gated routes). It therefore resolves its OWN session here and
  // applies the D-03 open-mode rule inline: DEMO_OPEN=1 only exempts a
  // request that would resolve to demo.db — i.e. no session, or a session
  // with no deal binding — a session bound to a REAL deal is never open,
  // mirroring isOpenMode(req)'s rule without needing the resolver to have run.
  const cookieToken = readSessionCookie(req);
  const sess = cookieToken ? sessions.findSession(getRuntimeConnection(), cookieToken) : null;
  const wouldResolveDemo = !sess || !sess.dealId;
  if (process.env.DEMO_OPEN === '1' && wouldResolveDemo) return res.json({ authEnabled: false, user: null });
  if (!sess) return res.json({ authEnabled: true, user: null });
  const user = controlStore.findUser(sess.username);
  // D-04: dealId is the caller's CURRENT server-side binding (D-01) — the
  // header deal switcher (public/js/deal-switcher.js) needs this to render
  // "which context am I in right now" without a second round-trip. Never the
  // full deal object here (name/targetCompany are cross-referenced from the
  // caller's own GET /api/deals response, which is already membership-
  // filtered) — this endpoint stays resolver-free (PUBLIC_API_PATHS) by
  // design, so it must not itself look up a deal by id.
  res.json({
    authEnabled: true,
    dealId: sess.dealId || null,
    user: user ? { username: user.username, name: user.name || user.username, role: user.role } : { username: sess.username, role: sess.role },
  });
});

// Self password-change (D-09): available to ANY authenticated role (its
// prefix is on the ROLE_WRITE_POLICY self-service allowlist so employee can
// change their own password too) — never full user-CRUD, only the caller's
// own credential. Requires a valid session (401 without one — not on
// PUBLIC_API_PATHS), verifies the CURRENT password with the same
// scrypt+constant-time-compare primitive login uses (401 on mismatch), then
// rotates to a fresh 16-byte salt before persisting the new hash.
app.post('/api/auth/change-password', (req, res) => {
  if (!req.portalUser) return res.status(401).json({ error: 'Login required.' });
  // WR-02: reuse the same throttle /api/auth/login uses — scrypt is
  // deliberately expensive, and a caller who already holds a valid session
  // (e.g. a stolen cookie without the password) must not get unlimited
  // current-password guesses just because change-password skips login.
  // Keyed by username (a session already proves who the caller claims to be)
  // rather than IP, so one throttled user cannot lock out others behind the
  // same proxy/NAT.
  if (loginThrottled('change-password:' + req.portalUser.username)) {
    return res.status(429).json({ error: 'Too many attempts — try again in a minute.' });
  }
  // VAL-01: the length/type check this line used to carry is now owned
  // exclusively by validators/settings.js's ChangePasswordSchema.
  const { currentPassword, newPassword } = req.body || {};
  const user = controlStore.findUser(req.portalUser.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const computed = hashPassword(currentPassword || '', user.salt);
  if (!user.hash || !timingSafeEqualStr(computed, user.hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const newSalt = crypto.randomBytes(16).toString('hex');
  controlStore.updateUser(user.username, { salt: newSalt, hash: hashPassword(newPassword, newSalt) });
  // D-08: a password change is a control-plane security event — the actor
  // and the subject are the SAME user here (self-service), which is exactly
  // why it must still be recorded: a session that changed its own password
  // is meaningfully different from one that never did.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'password-change', subject: user.username,
    request: requestMeta(req),
  });
  // WR-01: rotating a credential must revoke every OTHER outstanding session
  // for this user (db/sessions.js's own docstring calls this "Admin
  // offboarding action", but the same primitive applies here) — otherwise a
  // token an attacker already stole via a leaked cookie remains valid for up
  // to SESSION_TTL_MS after the password that would have invalidated it is
  // changed. Re-issue a fresh session for the CURRENT caller only, so they
  // are not logged out by their own password change.
  sessions.deleteAllSessionsForUser(getRuntimeConnection(), user.username);
  const newToken = sessions.createSession(getRuntimeConnection(), {
    username: user.username, role: user.role, ttlMs: SESSION_TTL_MS,
    userAgent: req.get('user-agent'), ip: req.ip,
  });
  const cookie = ['ma_session=' + newToken, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    'Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)];
  if (process.env.ENABLE_HSTS === '1') cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
  res.json({ success: true });
});

// Lightweight health check for uptime monitors and platform probes
app.get('/healthz', (req, res) => {
  try { readDb(); res.json({ status: 'ok', ts: Date.now() }); }
  catch (e) { res.status(503).json({ status: 'degraded' }); }
});

// Helper functions for database I/O
// SQLite-backed (better-sqlite3, WAL mode) via db/store.js. readDb()/writeDb(data)
// keep their exact whole-object signatures (D-03) so every one of the ~90 endpoint
// call sites below (`const db = readDb(); ...; writeDb(db);`) is unchanged — they
// now resolve whichever database db/resolver.js bound THIS request to (ISO-03),
// via db/store.js's AsyncLocalStorage. No in-memory mtime cache: better-sqlite3
// reads are sub-millisecond and in-process, so the store is the single source of
// truth on every call (RESEARCH.md Pitfall 3). db.json is retained on disk only
// as a frozen, read-only pre-migration archive — no live code path reads/writes it.
const { initDb, readDb, writeDb, getOrOpenConnection } = require('./db/store');
const sessions = require('./db/sessions');

// ISO-01 (Phase 3 cutover): open the three live stores through the SAME
// connection cache the resolver/controlStore use — never a second,
// independent open of the same file. The module singleton (initDb) stays
// pointed at demo.db so any code path that runs OUTSIDE a request context
// (this startup block itself, a CLI script) still has a sane default —
// unchanged fallback behavior for requireDb() (03-RESEARCH.md Pattern 1).
initDb(dbFiles.DEMO_DB_PATH);
getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

/** Sessions (Phase 2, AUTH-03) live in runtime.db (D-07), not the
 * request-bound demo/deal connection — a session must be resolvable BEFORE
 * db/resolver.js has bound anything, and a deal-bound request must never be
 * able to read the account/session store through its own connection. */
function getRuntimeConnection() {
  return getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
}

// Startup sweep of expired session rows — a table-bloat cleanup, NOT a
// security mechanism (findSession() already treats a past expires_at as an
// immediate miss regardless of whether the row has been physically deleted).
sessions.pruneExpiredSessions(getRuntimeConnection());

// Collision-resistant id: time-sortable base36 timestamp + random suffix. Two
// creates in the same millisecond used to mint identical `prefix_<Date.now()>`
// ids, which then corrupted each other on find/delete-by-id.
function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// AUD-01/D-08: the exact `{ method, path, ip }` shape db/auditHook.js's
// recordSecurityEvent()/writeAuditBatch() store per row. `req.path` is
// mount-relative ONLY inside the consolidated /api gate's own middleware
// callback (see that gate's own comment above) — every OTHER call site
// below (an actual matched route handler) sees the full path in req.path
// with an empty req.baseUrl, so `(req.baseUrl || '') + (req.path || '')`
// reconstructs the correct full path in both contexts.
function requestMeta(req) {
  return { method: req.method, path: (req.baseUrl || '') + (req.path || ''), ip: req.ip };
}

// =====================================================================
// Deal registry (ISO-01/D-01/D-02/D-03) — the control-plane surface on top
// of Plan 03's resolver. Every route below is a CONTROL_PLANE_PATH
// (db/resolver.js), so req.dealContext.kind is ALWAYS 'control' here — these
// handlers talk to db/controlStore.js exclusively, NEVER readDb()/writeDb()
// (control.db does not carry the ARRAY_COLLECTIONS schema demo.db/a deal
// file does; readDb() against it would simply fail to find those tables).
// Deliberately separate from the demo `/api/projects` section elsewhere in
// this file (D-04) — a real deal is not a "project", it is an isolated
// database with its own membership/lifecycle.
// =====================================================================

// VAL-01: no per-route validateBody() call needed here — validators/deals.js
// registers this route's schema into the shared WRITE_SCHEMAS registry, and
// validators/index.js#validationMiddleware (mounted once in the consolidated
// /api gate above) resolves+validates+sanitizes req.body generically for
// every write route in the app, including this one.
app.post('/api/deals', (req, res) => {
  const { name, targetCompany, members } = req.body;
  const deal = controlStore.createDeal({ name, targetCompany, members, createdBy: req.portalUser.username });
  try {
    // T-03-23: provision the deal's own database file AFTER the registry row
    // exists, matching an existing id — if this throws, the registry row is
    // rolled back below so a half-created deal is never left selectable.
    createDealDatabase(deal.id, { name, targetCompany });
  } catch (e) {
    console.error(`Error provisioning database for deal ${deal.id}, rolling back registry row:`, e);
    try { controlStore.deleteDeal(deal.id); }
    catch (rollbackErr) { console.error(`Error rolling back deal registry row ${deal.id} after provisioning failure:`, rollbackErr); }
    return res.status(500).json({ error: 'Failed to provision the new deal database.' });
  }
  // D-08: deal creation is a control-plane security event.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'deal-create', dealId: deal.id, subject: deal.id,
    before: null, after: deal, request: requestMeta(req),
  });
  res.json({ success: true, deal });
});

// D-01: any authenticated role may select a deal it is a member of (not just
// admin/hrbp — an employee/pmo deal member must be able to switch INTO a
// deal they already belong to). `dealId: null` is the explicit
// return-to-demo signal. A refusal (missing/archived/non-member) is a
// uniform 403 in every case — a distinct 404-for-missing vs 403-for-
// non-member would let a caller enumerate which deal ids exist purely from
// the status code, exactly what T-03-17 forbids for a pre-announcement
// target's very existence.
app.post('/api/deals/select', (req, res) => {
  if (!req.portalUser.sessionId) {
    // The D-11 attributed break-glass identity (X-Admin-Token) has no
    // sessions-table row to persist a deal selection onto.
    return res.status(400).json({ error: 'Deal selection requires a signed-in session.' });
  }
  const { dealId } = req.body;
  const rawToken = readSessionCookie(req);
  if (dealId === null) {
    sessions.bindSessionDeal(getRuntimeConnection(), rawToken, null);
    return res.json({ success: true, deal: null });
  }
  const deal = controlStore.getDeal(dealId);
  if (!deal || deal.status === 'archived' || !controlStore.isDealMember(dealId, req.portalUser)) {
    return res.status(403).json({ error: 'You are not a member of that deal.' });
  }
  sessions.bindSessionDeal(getRuntimeConnection(), rawToken, dealId);
  res.json({ success: true, deal });
});

// D-03: never the full registry for a non-admin — listDealsForUser() itself
// filters to deals the caller is a member of (admin sees every active deal).
app.get('/api/deals', (req, res) => {
  res.json(controlStore.listDealsForUser(req.portalUser));
});

// D-03: membership edits are admin-only. ROLE_WRITE_POLICY's flat prefix
// table has no wildcard for "admin+hrbp on /api/deals in general, but
// admin-only on this one dynamic-:id-segment route" — the broader
// '/api/deals' policy entry above lets an hrbp session past the gate, so
// this handler narrows to admin-only itself via the same isAdminRequest()
// guard several existing admin-only reads already use in this file.
app.post('/api/deals/:id/members', (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Only admin can manage deal membership.' });
  const dealId = req.params.id;
  const existing = controlStore.getDeal(dealId);
  if (!existing) return res.status(404).json({ error: 'Deal not found.' });
  const before = new Set(existing.members || []);
  const updated = controlStore.updateDealMembers(dealId, req.body.members);
  const after = new Set(updated.members || []);
  // A member removed from the allowlist must also lose their CURRENT
  // binding to this deal — otherwise their already-selected session keeps
  // reading/writing this deal's file until it happens to expire.
  for (const username of before) {
    if (!after.has(username)) sessions.releaseSessionsForDeal(getRuntimeConnection(), dealId, username);
  }
  // D-08: a membership edit is a control-plane security event.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'deal-members-update', dealId, subject: dealId,
    before: Array.from(before), after: Array.from(after), request: requestMeta(req),
  });
  res.json({ success: true, deal: updated });
});

// DD-04/D-02: per-area clean-room clearance. Deliberately inherits the
// broader '/api/deals' ROLE_WRITE_POLICY entry (admin + hrbp) UNCHANGED — NOT
// narrowed to admin-only via isAdminRequest() the way the members route above
// is, because D-02 explicitly calls for "the deal's Integration Lead (hrbp)
// OR an admin", not admin-only. There is no separate revoke route: a revoke
// is the SAME POST with a shorter (or empty) ddAreas array — the audit action
// name is chosen below by comparing the before/after sets as strict
// superset/subset/neither.
//
// Both routes 404 when the deal id does not exist, mirroring the members
// route's own 404 branch immediately above — a deal id is already enumerable
// through GET /api/deals for a member and through the admin list, so the
// deal-level anti-enumeration rule governing /api/deals/select does not apply
// to this admin/IL surface.
app.get('/api/deals/:id/grants', (req, res) => {
  // [security] Deviation from plan text (Rule 1/2 auto-fix): GET requests
  // bypass ROLE_WRITE_POLICY entirely except for '/api/admin'-prefixed paths
  // (see the consolidated /api gate's own `requiresRoleCheck` — CR-02's
  // carve-out is admin-prefix-only, and this route is NOT admin-prefixed).
  // Left unguarded, ANY authenticated role — including pmo/employee — could
  // read an arbitrary deal's membership AND per-area clearance map purely
  // from its id, which is exactly the MNPI disclosure D-02's "IL + admin"
  // access model is meant to prevent. Narrowed inline to the SAME admin+hrbp
  // role set the POST handler below inherits from ROLE_WRITE_POLICY's
  // broader '/api/deals' entry, so the read is never more permissive than
  // the write for this control-plane surface.
  if (req.portalUser.role !== 'admin' && req.portalUser.role !== 'hrbp') {
    return res.status(403).json({ error: 'Your role cannot view deal grants.' });
  }
  const dealId = req.params.id;
  const deal = controlStore.getDeal(dealId);
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });
  const grants = deal.memberGrants || {};
  const members = (deal.members || []).map((username) => ({
    username,
    ddAreas: (grants[username] && grants[username].ddAreas) || [],
  }));
  res.json({ members });
});

app.post('/api/deals/:id/grants', (req, res) => {
  const dealId = req.params.id;
  const deal = controlStore.getDeal(dealId);
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });
  const { username, ddAreas } = req.body;
  // T-04-09: clearance for an area can never exist for someone who is not a
  // member of the deal — a grant naming a non-member is refused outright,
  // never silently creating a shadow-access memberGrants entry.
  if (!Array.isArray(deal.members) || !deal.members.includes(username)) {
    return res.status(400).json({ error: 'username must be a current member of this deal.' });
  }

  const priorGrant = (deal.memberGrants && deal.memberGrants[username]) || { ddAreas: [] };
  const beforeArr = accessPolicy.DD_AREA_IDS.filter((id) => (priorGrant.ddAreas || []).includes(id));
  const afterSet = new Set((ddAreas || []).filter((id) => accessPolicy.DD_AREA_IDS.includes(id)));
  const afterArr = accessPolicy.DD_AREA_IDS.filter((id) => afterSet.has(id));

  // A no-op grant (identical before/after sets) must not pollute the
  // compliance record: persist nothing new and record nothing, returning the
  // UNCHANGED deal — mirrors the interface contract's own stated rule.
  const setsEqual = beforeArr.length === afterArr.length && beforeArr.every((id, i) => id === afterArr[i]);
  if (setsEqual) {
    return res.json({ success: true, deal });
  }

  const updated = controlStore.setDealMemberGrants(dealId, username, ddAreas);

  const beforeSet = new Set(beforeArr);
  const isSuperset = beforeArr.every((id) => afterSet.has(id)) && afterArr.length > beforeArr.length;
  const isSubset = afterArr.every((id) => beforeSet.has(id)) && beforeArr.length > afterArr.length;
  const action = isSuperset ? 'dd-area-grant' : (isSubset ? 'dd-area-revoke' : 'dd-area-grants-update');

  // D-08: every grant/revoke decision is a control-plane security event —
  // the SAME recordSecurityEvent() call shape server.js's other deal-lifecycle
  // routes already use, never a second, divergent audit call site.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action, dealId, subject: username,
    before: beforeArr, after: afterArr, request: requestMeta(req),
  });
  res.json({ success: true, deal: updated });
});

// D-02: archive/delete are admin-only, inherited with ZERO new
// ROLE_WRITE_POLICY entry from the existing `{ prefix: '/api/admin', roles:
// ['admin'] }` rule (matches migrate-db/revoke-sessions's own precedent).
// Both require the deal's OWN id as an explicit confirmation value in the
// body — a mismatch is a 400 and neither the registry row, the file, nor
// any session binding is touched, so a mis-clicked or replayed request can
// never destroy a live acquisition workspace.
app.post('/api/admin/deals/:id/archive', (req, res) => {
  const dealId = req.params.id;
  if (req.body.confirm !== dealId) {
    return res.status(400).json({ error: 'Confirmation value must exactly match the deal id.' });
  }
  const deal = controlStore.getDeal(dealId);
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });
  const updated = controlStore.archiveDeal(dealId);
  // Every session currently bound to this deal is released back to demo —
  // an archived deal must never be left silently readable/writable by a
  // session that selected it before the archive.
  sessions.releaseSessionsForDeal(getRuntimeConnection(), dealId);
  // D-08: archiving a deal is a control-plane security event. Recorded HERE
  // (server.js), never inside db/controlStore.js — that module must keep
  // holding zero reference to audit.db so AUD-02 holds by construction.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'deal-archive', dealId, subject: dealId,
    before: deal, after: updated, request: requestMeta(req),
  });
  res.json({ success: true, deal: updated });
});

app.delete('/api/admin/deals/:id', (req, res) => {
  const dealId = req.params.id;
  if (req.body.confirm !== dealId) {
    return res.status(400).json({ error: 'Confirmation value must exactly match the deal id.' });
  }
  const deal = controlStore.getDeal(dealId);
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });
  sessions.releaseSessionsForDeal(getRuntimeConnection(), dealId);
  controlStore.deleteDeal(dealId); // AUD-02: registry row + file only — never touches audit.db (db/controlStore.js's own header)
  // D-08: deleting a deal is a control-plane security event — routed through
  // this hook (server.js), never through db/controlStore.js, for the SAME
  // AUD-02 reason as the archive route above. `deal` (the pre-delete
  // snapshot fetched above) is the `before` value; the deal no longer
  // exists, so `after` is null.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'deal-delete', dealId, subject: dealId,
    before: deal, after: null, request: requestMeta(req),
  });
  res.json({ success: true });
});

// D-10: admin-only audit viewer. Inherits admin-only enforcement from the
// existing `{ prefix: '/api/admin', roles: ['admin'] }` ROLE_WRITE_POLICY
// rule, which (per CR-02) applies to EVERY method under /api/admin — reads
// included — so this route is never reachable by a non-admin session, and
// db/resolver.js's CONTROL_PLANE_PATHS covers this exact path so an admin's
// own stale/archived deal binding can never lock them out of it (see that
// module's own comment). Deliberately GET-only: no POST/PUT/DELETE route
// exists anywhere under /api/admin/audit* — the append-only triggers
// (Plan 03-01) would reject a mutation anyway, but the route must also
// simply not exist (asserted by test/audit-security-events.test.js's own
// route-inventory check).
app.get('/api/admin/audit', (req, res) => {
  res.json(auditHook.queryAudit({
    dealId: req.query.deal || undefined,
    actor: req.query.user || undefined,
    from: req.query.from || undefined,
    to: req.query.to || undefined,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
});

// Strip server-only secrets from any settings object before returning it to a
// client. The real API key / DB connection string must never leave the server;
// the client only needs to know WHETHER a key is configured.
function publicSettings(s) {
  const out = { ...(s || {}) };
  out.hasGeminiApiKey = !!(out.geminiApiKey && String(out.geminiApiKey).trim());
  delete out.geminiApiKey;
  if (out.databaseConfig && out.databaseConfig.connectionDetails) {
    out.databaseConfig = { ...out.databaseConfig };
    delete out.databaseConfig.connectionDetails;
  }
  return out;
}

// REST API Endpoints

// GET Portable Application Package Download (Dynamic ZIP creation)
app.get('/api/admin/download-zip', (req, res) => {
  try {
    const { execSync } = require('child_process');
    // Build the archive in the OS temp dir — NOT under public/, which express.static
    // would otherwise serve at /ma-app.zip to anyone. Exclude everything holding data
    // or secrets (db.json = API key + all records; .env; sent_emails). The downloaded
    // package boots with a fresh database. The temp file is deleted after sending.
    const zipPath = path.join(os.tmpdir(), `ma-app-${Date.now()}.zip`);
    // [security] the flat "data/*.db" pattern above does NOT recurse into the
    // nested data/deals/ directory (Phase 3, D-07/T-03-01) — real-deal
    // databases, the live session store and the audit trail each need their
    // own explicit exclusion entry or they would ship inside this export.
    execSync(`zip -r "${zipPath}" . -x "node_modules/*" ".git/*" ".gemini/*" "public/ma-app.zip" "ma-portal.zip" "looxmaxing/*" ".playwright-mcp/*" ".DS_Store" "*/.DS_Store" "db.json" "db.json.tmp" "db.json.bak" "data/*.db" "data/*.db-wal" "data/*.db-shm" "data/*.db.bak" "data/runtime.db*" "data/audit.db*" "data/deals/*" ".env" ".env.*" "public/sent_emails/*" "sent_emails/*"`, { cwd: __dirname });

    res.download(zipPath, 'te-ma-integration-portal.zip', (err) => {
      if (err) console.error('Error sending zip file to browser:', err);
      fs.unlink(zipPath, () => {}); // clean up the temp archive regardless
    });
  } catch (error) {
    console.error('Error generating zip archive dynamically:', error);
    res.status(500).json({ error: 'Failed to compile and zip the application package. Please ensure zip utility is available.' });
  }
});


// GET RAG Search of Playbook Snippets
app.get('/api/rag/search', (req, res) => {
  const query = req.query.q || '';
  try {
    const results = ragService.searchPlaybook(query, 3);
    res.json({ success: true, query, results });
  } catch (error) {
    console.error('Error during backend RAG search:', error);
    res.status(500).json({ success: false, error: 'Failed to search playbook database.' });
  }
});

// POST AI Model RAG PDF Training Upload & AI Insight Review
app.post('/api/rag/upload', async (req, res) => {
  try {
    // VAL-01: presence is now owned exclusively by validators/settings.js's RagUploadSchema.
    const { fileName, fileData } = req.body;

    console.log(`Processing RAG PDF upload request: "${fileName}"...`);

    // Decode Base64 string
    const base64Data = fileData.replace(/^data:application\/pdf;base64,/, "");
    const pdfBuffer = Buffer.from(base64Data, 'base64');

    // Parse plain text from PDF (pdf-parse v2 class API)
    const { PDFParse } = require('pdf-parse');
    const pdfParser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
    const parsedPdf = await pdfParser.getText();
    const pdfText = parsedPdf.text || '';

    if (pdfText.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Could not extract any plain text from the uploaded PDF.' });
    }

    console.log(`Extracted ${pdfText.length} characters. Invoking AI Insight cognitive review...`);

    // Get the active Gemini API Key. ISO-01 (Task 2 cutover): the key is a
    // secret field — it lives in runtime.db's secretSettings singleton
    // (db/controlStore.js), never the request-bound demo/deal settings row.
    const apiKey = controlStore.getSecretSettings().geminiApiKey || '';

    // Invoke AI Insight cognitive review
    const review = await aiService.reviewPdfContent({ pdfText, fileName, apiKey });

    console.log(`AI Insight review complete for "${fileName}". Dimension: ${review.dimension}. Chunks count: ${review.suggestedRags ? review.suggestedRags.length : 0}`);

    // Persist finding blocks to db.json
    const db = readDb();
    db.ragUploads = db.ragUploads || [];
    const newUpload = {
      id: newId('upload'),
      fileName: fileName,
      summary: review.summary || '',
      dimension: review.dimension || 'General Compliance',
      keyFindings: review.keyFindings || [],
      suggestedRags: review.suggestedRags || [],
      timestamp: new Date().toISOString()
    };
    db.ragUploads.push(newUpload);
    writeDb(db);

    // Retrain memory RAG model instantly
    ragService.initializeRAG();

    res.json({
      success: true,
      upload: newUpload
    });
  } catch (error) {
    console.error('Error handling RAG PDF upload:', error);
    res.status(500).json({ success: false, error: 'Failed to process and train RAG model.' });
  }
});

// Ordered list of real lesson IDs from the course catalog (drives consistent
// time-travel seeding so scaled progress matches actual lessons).
function getCatalogLessonIds(db) {
  const ids = [];
  (db.courses || []).forEach(c => (c.modules || []).forEach(m => (m.lessons || []).forEach(l => ids.push(l.id))));
  // Fallback to the legacy 9-lesson set if the catalog is empty
  return ids.length ? ids : ['l1_1', 'l1_2', 'l1_3', 'l2_1', 'l2_2', 'l2_3', 'l3_1', 'l3_2', 'l3_3'];
}

// Helper for temporal employee scaling
function scaleEmployeesForDay(employees, day, lessonIds) {
  const pool = (lessonIds && lessonIds.length) ? lessonIds : ['l1_1', 'l1_2', 'l1_3', 'l2_1', 'l2_2', 'l2_3', 'l3_1', 'l3_2', 'l3_3'];
  const total = pool.length;
  return employees.map(emp => {
    const cloned = { ...emp };
    cloned.completedLessons = cloned.completedLessons || [];
    cloned.bonusPoints = cloned.bonusPoints || 0;

    if (day === 1) {
      cloned.completedLessons = [];
      cloned.bonusPoints = 0;
      cloned.points = 0;
      cloned.badge = "New Recruit";
    } else if (day === 30) {
      const n = Math.min(((cloned.name || '?').charCodeAt(0) % 2) + 1, total);
      cloned.completedLessons = pool.slice(0, n);
      cloned.points = cloned.completedLessons.length * 20 + Math.min(cloned.bonusPoints, 10);
      cloned.badge = calculateBadge(cloned.completedLessons.length);
    } else if (day === 60) {
      const n = Math.min(((cloned.name || '?').charCodeAt(0) % 3) + 3, total);
      cloned.completedLessons = pool.slice(0, n);
      cloned.points = cloned.completedLessons.length * 20 + Math.min(cloned.bonusPoints, 20);
      cloned.badge = calculateBadge(cloned.completedLessons.length);
    } else if (day === 90) {
      const n = Math.min(((cloned.name || '?').charCodeAt(0) % 3) + 6, total);
      cloned.completedLessons = pool.slice(0, n);
      cloned.points = cloned.completedLessons.length * 20 + Math.min(cloned.bonusPoints, 30);
      cloned.badge = calculateBadge(cloned.completedLessons.length);
    } else if (day >= 100) {
      cloned.completedLessons = pool.slice();
      cloned.points = total * 20 + cloned.bonusPoints;
      cloned.badge = "Ultimate Integrator";
    }
    return cloned;
  });
}

// Helper for temporal pulses feedback
function getPulsesForDay(day) {
  const pulseLibrary = {
    1: [
      { id: "p1", employeeName: "Alex Mercer", rating: 3, comment: "Excited but curious how TE systems will align with ours.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p2", employeeName: "Sarah Connor", rating: 2, comment: "Concerned about R&D patent pipeline migrations. Need more clear directives.", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p3", employeeName: "Michael Scott", rating: 3, comment: "Will we get new email logins on Day 1? Communication could be clearer.", timestamp: "2026-05-21T10:30:00Z" }
    ],
    30: [
      { id: "p4", employeeName: "Alex Mercer", rating: 4, comment: "SSO accounts are synced! Love the personalized portal.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p5", employeeName: "Sarah Connor", rating: 3, comment: "HR training was standard, just got my first Culture Champion badge!", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p6", employeeName: "Michael Scott", rating: 4, comment: "Nice town-hall sync last week. Payroll mapping is feeling steady.", timestamp: "2026-05-21T10:30:00Z" }
    ],
    60: [
      { id: "p7", employeeName: "Alex Mercer", rating: 4, comment: "IT credentials mapping is fully complete. Zero access delays.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p8", employeeName: "Sarah Connor", rating: 4, comment: "The peer group alignment has been really transparent. Great teamwork.", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p9", employeeName: "Michael Scott", rating: 4, comment: "Standard benefits migration went through flawlessly this week.", timestamp: "2026-05-21T10:30:00Z" }
    ],
    90: [
      { id: "p10", employeeName: "Alex Mercer", rating: 5, comment: "Standard playbook links are working beautifully. Outstanding documentation.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p11", employeeName: "Sarah Connor", rating: 4, comment: "Retention contract alignment was very reassuring. Happy to stay with TE.", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p12", employeeName: "Michael Scott", rating: 5, comment: "Fully aligned with our core values of accountability and innovation.", timestamp: "2026-05-21T10:30:00Z" }
    ],
    100: [
      { id: "p13", employeeName: "Alex Mercer", rating: 5, comment: "Outstanding M&A process, 5 stars! The best integration journey I've experienced.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p14", employeeName: "Sarah Connor", rating: 5, comment: "Full synergy capture achieved seamlessly! Excited for the future.", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p15", employeeName: "Michael Scott", rating: 5, comment: "Felt extremely welcomed from Day 1 to Day 100! Complete organizational harmony.", timestamp: "2026-05-21T10:30:00Z" }
    ]
  };
  
  const targetDay = day >= 100 ? 100 : day >= 90 ? 90 : day >= 60 ? 60 : day >= 30 ? 30 : 1;
  return pulseLibrary[targetDay];
}

// Helper for temporal diagnostic scores scaling
function getScaledScores(latestScores, day) {
  if (!latestScores) {
    latestScores = { culture: 3.2, talent: 3.5, value: 3.0 };
  }
  if (day === 1) {
    return { culture: 2.0, talent: 2.2, value: 2.5 };
  } else if (day === 30) {
    return {
      culture: Math.min(Math.max(latestScores.culture, 3.0), 3.8),
      talent: Math.min(Math.max(latestScores.talent, 3.2), 4.0),
      value: Math.min(Math.max(latestScores.value, 3.0), 4.0)
    };
  } else if (day === 60) {
    return {
      culture: parseFloat(Math.min(Math.max(latestScores.culture * 1.15, 3.8), 4.5).toFixed(2)),
      talent: parseFloat(Math.min(Math.max(latestScores.talent * 1.15, 4.0), 4.5).toFixed(2)),
      value: parseFloat(Math.min(Math.max(latestScores.value * 1.15, 4.0), 4.6).toFixed(2))
    };
  } else if (day === 90) {
    return {
      culture: parseFloat(Math.min(Math.max(latestScores.culture * 1.3, 4.3), 4.8).toFixed(2)),
      talent: parseFloat(Math.min(Math.max(latestScores.talent * 1.3, 4.5), 4.8).toFixed(2)),
      value: parseFloat(Math.min(Math.max(latestScores.value * 1.3, 4.5), 4.9).toFixed(2))
    };
  } else {
    return { culture: 5.0, talent: 5.0, value: 5.0 };
  }
}

// POST Time Travel (Temporal Timeline Switch)
app.post('/api/settings/time-travel', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/settings.js's TimeTravelSchema.
  const { day } = req.body;
  const parsedDay = parseInt(day) || 30;
  const db = readDb();
  db.settings = db.settings || {};
  db.settings.timeTravelDay = parsedDay;
  if (db.customSettings) {
    db.customSettings.timeTravelDay = parsedDay;
  }
  writeDb(db);
  
  res.json({ success: true, timeTravelDay: parsedDay });
});

// POST Reorder Survey Questions
app.post('/api/questions/reorder', (req, res) => {
  // VAL-01: shape is now owned exclusively by validators/assessment.js's ReorderQuestionsSchema.
  const { questionIds } = req.body;
  const db = readDb();
  const questionsMap = {};
  db.questions.forEach(q => {
    questionsMap[q.id] = q;
  });
  
  const reordered = [];
  questionIds.forEach(id => {
    if (questionsMap[id]) {
      reordered.push(questionsMap[id]);
    }
  });
  
  db.questions.forEach(q => {
    if (!questionIds.includes(q.id)) {
      reordered.push(q);
    }
  });
  
  db.questions = reordered;
  writeDb(db);
  
  res.json({ success: true, questions: db.questions });
});

// POST Reorder Dashboard Widgets
app.post('/api/dashboard/reorder-widgets', (req, res) => {
  // VAL-01: shape is now owned exclusively by validators/workstream.js's ReorderWidgetsSchema.
  const { layoutOrder } = req.body;
  const db = readDb();
  db.settings = db.settings || {};
  db.settings.dashboardLayoutOrder = layoutOrder;
  writeDb(db);
  
  res.json({ success: true, dashboardLayoutOrder: layoutOrder });
});

// GET Settings
app.get('/api/settings', (req, res) => {
  const db = readDb();
  // ISO-01 (Task 2 cutover): geminiApiKey is a secret field — it lives in
  // runtime.db's secretSettings singleton (db/controlStore.js), never the
  // request-bound demo/deal settings row. Merge it in HERE, temporarily, so
  // publicSettings()'s existing hasGeminiApiKey-flag-then-strip logic below
  // keeps working unchanged — the real value still never reaches the client.
  const secretGeminiApiKey = controlStore.getSecretSettings().geminiApiKey;
  if (db.settings && db.settings.demoMode === false) {
    // Merge base settings under custom overrides so custom mode still exposes
    // shared fields (targetCompany, roleVisibility, ...) instead of a sparse object.
    const custom = { ...(db.settings || {}), ...(db.customSettings || {}), demoMode: false, geminiApiKey: secretGeminiApiKey };
    custom.timeTravelDay = custom.timeTravelDay !== undefined ? custom.timeTravelDay : (db.settings.timeTravelDay || 30);
    res.json(publicSettings(custom));
  } else {
    res.json(publicSettings({ ...(db.settings || {}), geminiApiKey: secretGeminiApiKey }));
  }
});

// POST Settings
app.post('/api/settings', (req, res) => {
  const db = readDb();
  db.settings = db.settings || {};

  if (req.body.demoMode !== undefined) {
    db.settings.demoMode = req.body.demoMode === true || req.body.demoMode === 'true';
    if (db.settings.demoMode === false && !db.customSettings) {
      db.customSettings = { demoMode: false };
    }
    writeDb(db);
    return res.json({ success: true, settings: publicSettings(db.settings.demoMode ? db.settings : db.customSettings) });
  }

  // Copy incoming keys, but NEVER overwrite a stored API key with a blank value —
  // the client sends the field empty when it hasn't been re-entered (the real key
  // is no longer sent to the browser), so a blank means "leave it unchanged".
  // ISO-01 (Task 2 cutover): a submitted value for either secret field
  // (geminiApiKey, databaseConfig.connectionDetails) is persisted through
  // db/controlStore.js's setSecretSettings() — runtime.db, never the
  // request-bound demo/deal settings row — while every other field continues
  // straight to `target` exactly as before.
  const applySettings = (target) => {
    const secretPatch = {};
    Object.keys(req.body).forEach(key => {
      if (key === 'geminiApiKey') {
        if (String(req.body[key] || '').trim()) secretPatch.geminiApiKey = req.body[key];
        return;
      }
      if (key === 'databaseConfig' && req.body[key] && typeof req.body[key] === 'object' && req.body[key].connectionDetails !== undefined) {
        secretPatch['databaseConfig.connectionDetails'] = req.body[key].connectionDetails;
        const rest = { ...req.body[key] };
        delete rest.connectionDetails;
        target[key] = rest;
        return;
      }
      target[key] = req.body[key];
    });
    if (Object.keys(secretPatch).length) controlStore.setSecretSettings(secretPatch);
  };

  if (db.settings.demoMode === false) {
    db.customSettings = db.customSettings || { demoMode: false };
    applySettings(db.customSettings);
  } else {
    applySettings(db.settings);
  }

  writeDb(db);
  const responseTarget = db.settings.demoMode === false ? db.customSettings : db.settings;
  res.json({ success: true, settings: publicSettings({ ...responseTarget, geminiApiKey: controlStore.getSecretSettings().geminiApiKey }) });
});

// POST Reset Custom M&A Wizard state
app.post('/api/settings/new-ma', (req, res) => {
  const db = readDb();
  db.customSettings = { demoMode: false };
  db.customEmployees = [];
  db.customHrbps = [];
  db.customAssessments = [];
  db.customAlerts = [];
  db.customCommunications = [];
  db.customAssessmentInstances = [];
  db.customIntegrationTasks = [];
  db.customSynergyInitiatives = [];
  db.customRaidEntries = [];
  
  // Wipe custom physical emails
  const emailDir = path.join(__dirname, 'public', 'sent_emails');
  if (fs.existsSync(emailDir)) {
    try {
      const files = fs.readdirSync(emailDir);
      files.forEach(file => {
        if (file.startsWith('comm_')) {
          fs.unlinkSync(path.join(emailDir, file));
        }
      });
    } catch (e) {
      console.warn("Could not wipe custom physical emails:", e);
    }
  }

  writeDb(db);
  res.json({ success: true, message: 'Custom M&A successfully reset.' });
});

// =====================================================================
// Projects — top of the M&A hierarchy (admin sets up each acquisition)
// =====================================================================
function findProject(db, id) { return (db.projects || []).find(p => p.id === id); }

// --- Per-project data isolation (phase 2) ---
// Each custom project owns its full workspace bundle (roster/assessment/leaders/comms/
// settings). The demo project uses the top-level demo collections and is never bundled.
function saveCustomLaneToProject(db, project) {
  if (!project) return;
  // The demo project is normally never bundled. EXCEPTION: if the app is in
  // Custom-M&A mode (demoMode:false) while the demo is still the active project, the
  // live custom collections belong to no project — persist them onto the demo's data
  // bundle so creating/switching a project can't silently wipe them (regression F1).
  const inCustomModeOnDemo = project.isDemo && db.settings && db.settings.demoMode === false && db.activeProjectId === project.id;
  if (project.isDemo && !inCustomModeOnDemo) return;
  project.data = {
    settings: db.customSettings || { demoMode: false },
    employees: db.customEmployees || [],
    hrbps: db.customHrbps || [],
    assessments: db.customAssessments || [],
    alerts: db.customAlerts || [],
    communications: db.customCommunications || [],
    assessmentInstances: db.customAssessmentInstances || [],
    integrationTasks: db.customIntegrationTasks || [],
    synergyInitiatives: db.customSynergyInitiatives || [],
    raidEntries: db.customRaidEntries || []
  };
}

// Load a project's bundle into the live custom lane. Intake fields always win for the
// company identity so switching visibly re-scopes the app to the acquired company.
function loadProjectIntoCustomLane(db, project) {
  const d = project.data || {};
  db.customSettings = {
    ...(d.settings || {}), demoMode: false,
    targetCompany: project.targetCompany, sector: project.sector, size: project.size,
    hq: project.hq, acquisitionDate: project.acquisitionDate, synergyObjective: project.synergyObjective
  };
  db.customEmployees = d.employees || [];
  db.customHrbps = d.hrbps || [];
  db.customAssessments = d.assessments || [];
  db.customAlerts = d.alerts || [];
  db.customCommunications = d.communications || [];
  db.customAssessmentInstances = d.assessmentInstances || [];
  db.customIntegrationTasks = d.integrationTasks || [];
  db.customSynergyInitiatives = d.synergyInitiatives || [];
  db.customRaidEntries = d.raidEntries || [];
}

// Persist whatever the live custom lane currently holds back to whichever custom
// project is active, so its in-progress work isn't lost when we switch away.
function stashActiveCustomProject(db) {
  const current = findProject(db, db.activeProjectId);
  // saveCustomLaneToProject() is a no-op for the demo project unless we're in
  // Custom-M&A mode with it active (see F1 guard there), so this is safe to call
  // unconditionally and preserves an orphaned custom lane before it gets overwritten.
  if (current) saveCustomLaneToProject(db, current);
}

// --- Per-project CMS content isolation (phase 3) ---
// The top-level courses/pages/menus/banners/departments ARE the ACTIVE project's live CMS.
// Each project (demo included) owns a `cms` snapshot; activate/create swaps it in/out.
// This keeps every CMS endpoint unchanged. i18n UI strings + media stay app-wide shared.
function snapshotCms(db) {
  const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
  return {
    courses: clone(db.courses || []),
    pages: clone(db.pages || []),
    menus: clone(db.menus || { sidebar: [], groups: [], landingCards: [] }),
    banners: clone(db.banners || []),
    departments: clone(db.departments || []),
    processCatalog: clone(db.processCatalog || []),
    slides: clone(db.slides || []),
    assessmentTemplates: clone(db.assessmentTemplates || []),
    checklistTemplates: clone(db.checklistTemplates || [])
  };
}
function applyCmsToTopLevel(db, cms) {
  if (!cms) return;
  db.courses = cms.courses || [];
  db.pages = cms.pages || [];
  db.menus = cms.menus || { sidebar: [], groups: [], landingCards: [] };
  db.banners = cms.banners || [];
  db.departments = cms.departments || [];
  db.processCatalog = cms.processCatalog || [];
  db.slides = cms.slides || [];
  db.assessmentTemplates = cms.assessmentTemplates || [];
  db.checklistTemplates = cms.checklistTemplates || [];
}
// Save the live CMS back to whichever project is active (demo included) before switching.
function stashActiveProjectCms(db) {
  const cur = findProject(db, db.activeProjectId);
  if (cur) cur.cms = snapshotCms(db);
}
function loadProjectCms(db, project) {
  if (project && project.cms) applyCmsToTopLevel(db, project.cms);
}
// A new acquisition starts from the demo's default CMS structure, then tailors it.
function defaultCms(db) {
  const demo = findProject(db, 'proj_demo');
  return (demo && demo.cms) ? JSON.parse(JSON.stringify(demo.cms)) : snapshotCms(db);
}

app.get('/api/projects', (req, res) => {
  const db = readDb();
  // Strip the heavy per-project data + cms bundles from the list response.
  const list = (db.projects || []).map(({ data, cms, ...meta }) => meta);
  res.json({ projects: list, activeProjectId: db.activeProjectId || 'proj_demo' });
});

// Create a new acquisition project from the admin intake wizard (activates it).
app.post('/api/projects', (req, res) => {
  const db = readDb();
  const b = req.body || {};
  // VAL-01: "name or targetCompany required" is now owned exclusively by
  // validators/settings.js's ProjectCreateSchema.refine().
  const name = String(b.name || b.targetCompany || '').trim();
  const project = {
    id: newId('proj'), isDemo: false, name,
    targetCompany: String(b.targetCompany || name).trim(),
    sector: b.sector || '', size: b.size || '', hq: b.hq || '',
    acquisitionDate: b.acquisitionDate || '', synergyObjective: b.synergyObjective || '',
    intake: b.intake || {}, createdAt: new Date().toISOString(),
    data: { settings: { demoMode: false }, employees: [], hrbps: [], assessments: [], alerts: [], communications: [], assessmentInstances: [], integrationTasks: [], synergyInitiatives: [], raidEntries: [] }
  };
  db.projects = db.projects || [];
  // Preserve the currently-active project's work & CMS before switching to the new one.
  stashActiveCustomProject(db);
  stashActiveProjectCms(db);
  // Playbook reuse: clone the chosen source project's full CMS bundle (courses,
  // assessment + checklist templates, processes, menus, …) so every finished
  // deal doubles as the next deal's playbook. Falls back to the demo default.
  const sourceProject = b.sourceProjectId ? findProject(db, b.sourceProjectId) : null;
  project.cms = (sourceProject && sourceProject.cms)
    ? JSON.parse(JSON.stringify(sourceProject.cms))
    : defaultCms(db);
  db.projects.push(project);
  db.settings = db.settings || {};
  db.settings.demoMode = false;
  loadProjectIntoCustomLane(db, project); // fresh, empty workspace scoped to the intake
  applyCmsToTopLevel(db, project.cms);
  db.activeProjectId = project.id;
  writeDb(db);
  res.json({ success: true, project: (({ data, cms, ...m }) => m)(project), activeProjectId: project.id });
});

// Switch the active project (demo <-> a specific acquisition), isolating each workspace.
app.post('/api/projects/:id/activate', (req, res) => {
  const db = readDb();
  const target = findProject(db, req.params.id);
  if (!target) return res.status(404).json({ error: 'Project not found.' });
  db.settings = db.settings || {};
  if (target.id !== db.activeProjectId) { stashActiveCustomProject(db); stashActiveProjectCms(db); }
  if (target.isDemo) {
    db.settings.demoMode = true;
  } else {
    db.settings.demoMode = false;
    loadProjectIntoCustomLane(db, target);
  }
  loadProjectCms(db, target); // swap in the target project's CMS content
  db.activeProjectId = target.id;
  writeDb(db);
  res.json({ success: true, activeProjectId: target.id, demoMode: db.settings.demoMode });
});

app.delete('/api/projects/:id', (req, res) => {
  const db = readDb();
  const project = findProject(db, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  if (project.isDemo) return res.status(400).json({ error: 'The demo project cannot be deleted.' });
  const wasActive = db.activeProjectId === req.params.id;
  db.projects = (db.projects || []).filter(p => p.id !== req.params.id);
  // Deleting the active project falls back to the demo workspace (restore its CMS too).
  if (wasActive) {
    db.activeProjectId = 'proj_demo';
    db.settings = db.settings || {};
    db.settings.demoMode = true;
    loadProjectCms(db, findProject(db, 'proj_demo'));
  }
  writeDb(db);
  res.json({ success: true, activeProjectId: db.activeProjectId });
});

// =====================================================================
// Department modules — functional integration tracks (Sales, Product, ...)
// Culture & Communication are shared; Systems & Trainings are per-department.
// =====================================================================
app.get('/api/departments', (req, res) => {
  res.json(readDb().departments || []);
});

// VAL-01: name-required is now enforced exclusively by
// validators/workstream.js's DepartmentUpsertSchema (one rejection path) —
// the ad hoc `if (!nameOk) return 400` checks this handler used to carry are
// removed; by the time this handler runs, req.body is already
// shape-validated, unknown-key-stripped and sanitized.
app.post('/api/departments', (req, res) => {
  const db = readDb();
  db.departments = db.departments || [];
  const d = req.body || {};
  let stored;
  if (d.id) {
    const i = db.departments.findIndex(x => x.id === d.id);
    // Existing department: merge (partial updates like the lock toggle are allowed).
    if (i > -1) { db.departments[i] = { ...db.departments[i], ...d }; stored = db.departments[i]; }
    else { db.departments.push(d); stored = d; }
  } else {
    stored = { locked: true, systems: [], trainings: [], ...d, id: newId('dept') };
    db.departments.push(stored);
  }
  writeDb(db);
  res.json({ success: true, department: stored });
});

app.delete('/api/departments/:id', (req, res) => {
  const db = readDb();
  db.departments = (db.departments || []).filter(x => x.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// =====================================================================
// Process Integration & Transformation — the per-project Process Catalog.
// Models how each business process moves from the Sending org (the acquired
// company) to the Receiving org (TE), where it is adopted/harmonized/retired.
// Project-scoped via the cms bundle, so it swaps on project switch just
// like `departments`. Writes are behind the ADMIN_TOKEN gate + atomic writeDb.
// =====================================================================
app.get('/api/processes', (req, res) => {
  res.json(readDb().processCatalog || []);
});

// VAL-01: name-required is now owned exclusively by
// validators/workstream.js's ProcessUpsertSchema.
app.post('/api/processes', (req, res) => {
  const db = readDb();
  db.processCatalog = db.processCatalog || [];
  const p = req.body || {};
  let stored;
  if (p.id) {
    const i = db.processCatalog.findIndex(x => x.id === p.id);
    // Existing process: merge (allows partial updates like a status change).
    if (i > -1) { db.processCatalog[i] = { ...db.processCatalog[i], ...p }; stored = db.processCatalog[i]; }
    else { db.processCatalog.push(p); stored = p; }
  } else {
    stored = { domain: '', approach: 'Harmonize', status: 'not-started', risk: 'Medium', phase: '', notes: '', sending: {}, receiving: {}, ...p, id: newId('proc') };
    db.processCatalog.push(stored);
  }
  writeDb(db);
  res.json({ success: true, process: stored });
});

app.delete('/api/processes/:id', (req, res) => {
  const db = readDb();
  db.processCatalog = (db.processCatalog || []).filter(x => x.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// =====================================================================
// HTML Slides — admin-authored full-screen slide decks (pasted link OR an
// uploaded HTML file), launched from a per-page sidebar icon and shown as a
// full overlay. Project-scoped via the cms bundle, like departments/processes.
// =====================================================================
app.get('/api/slides', (req, res) => {
  res.json(readDb().slides || []);
});

app.post('/api/slides', (req, res) => {
  const db = readDb();
  db.slides = db.slides || [];
  // VAL-01: url-required is now owned exclusively by validators/cms.js's SlideUpsertSchema.
  const s = req.body || {};
  let stored;
  if (s.id) {
    const i = db.slides.findIndex(x => x.id === s.id);
    if (i > -1) { db.slides[i] = { ...db.slides[i], ...s }; stored = db.slides[i]; }
    else { db.slides.push(s); stored = s; }
  } else {
    stored = { icon: '🖥️', label: 'Slide', pages: 'all', ...s, id: newId('slide') };
    db.slides.push(stored);
  }
  writeDb(db);
  res.json({ success: true, slide: stored });
});

app.delete('/api/slides/:id', (req, res) => {
  const db = readDb();
  db.slides = (db.slides || []).filter(x => x.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// Upload an HTML slide file (raw HTML string) -> saved under public/uploads/slides/
// and returned as a servable URL. Behind the same admin-write gate as other writes.
app.post('/api/slides/upload', (req, res) => {
  const b = req.body || {};
  // VAL-01: non-empty-content is now owned exclusively by validators/cms.js's SlideUploadSchema.
  const content = typeof b.content === 'string' ? b.content : '';
  const base = String(b.filename || 'slide.html').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  const safe = /\.html?$/i.test(base) ? base : base + '.html';
  const dir = path.join(__dirname, 'public', 'uploads', 'slides');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fname = Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + safe;
    fs.writeFileSync(path.join(dir, fname), content, 'utf8');
    res.json({ success: true, url: '/uploads/slides/' + fname });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save slide file.' });
  }
});

// =====================================================================
// CMS API — Courses/Lessons, i18n, Menus, Pages, Media
// =====================================================================

// ---- Courses & Lessons ----
app.get('/api/courses', (req, res) => {
  const db = readDb();
  res.json(db.courses || []);
});

// Create or update a whole course (upsert by id)
// VAL-01: title-required is now owned exclusively by validators/cms.js's CourseUpsertSchema.
app.post('/api/courses', (req, res) => {
  const db = readDb();
  db.courses = db.courses || [];
  const course = req.body || {};
  let stored;
  if (course.id) {
    const idx = db.courses.findIndex(c => c.id === course.id);
    if (idx >= 0) { db.courses[idx] = { ...db.courses[idx], ...course }; stored = db.courses[idx]; }
    else { db.courses.push(course); stored = course; }
  } else {
    course.id = newId('course');
    course.modules = course.modules || [];
    db.courses.push(course);
    stored = course;
  }
  writeDb(db);
  res.json({ success: true, course: stored });
});

app.delete('/api/courses/:id', (req, res) => {
  const db = readDb();
  db.courses = (db.courses || []).filter(c => c.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, message: 'Course deleted.' });
});

// Upsert a single lesson within a course/module (keeps big payloads small)
app.post('/api/courses/:courseId/lessons', (req, res) => {
  const db = readDb();
  const course = (db.courses || []).find(c => c.id === req.params.courseId);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  const { moduleId, lesson } = req.body || {};
  const mod = (course.modules || []).find(m => m.id === moduleId);
  if (!mod) return res.status(404).json({ error: 'Module not found.' });
  // VAL-01: lesson-payload-required is now owned by validators/cms.js's
  // registered schema for this route (a required nested object).
  mod.lessons = mod.lessons || [];
  let stored;
  if (lesson.id) {
    const idx = mod.lessons.findIndex(l => l.id === lesson.id);
    if (idx >= 0) { mod.lessons[idx] = { ...mod.lessons[idx], ...lesson }; stored = mod.lessons[idx]; }
    else { mod.lessons.push(lesson); stored = lesson; }
  } else {
    lesson.id = newId('lesson');
    lesson.order = mod.lessons.length + 1;
    mod.lessons.push(lesson);
    stored = lesson;
  }
  writeDb(db);
  res.json({ success: true, lesson: stored });
});

app.delete('/api/courses/:courseId/lessons/:lessonId', (req, res) => {
  const db = readDb();
  const course = (db.courses || []).find(c => c.id === req.params.courseId);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  (course.modules || []).forEach(m => { m.lessons = (m.lessons || []).filter(l => l.id !== req.params.lessonId); });
  writeDb(db);
  res.json({ success: true, message: 'Lesson deleted.' });
});

// Flat lesson lookup used by the employee academy + completion validation
app.get('/api/lessons', (req, res) => {
  const db = readDb();
  const flat = [];
  (db.courses || []).forEach(c => (c.modules || []).forEach(m => (m.lessons || []).forEach(l => {
    flat.push({ ...l, courseId: c.id, courseTitle: c.title, moduleId: m.id, moduleTitle: m.title, moduleBadge: m.badge });
  })));
  res.json(flat);
});

// ---- i18n (translations) ----
app.get('/api/i18n', (req, res) => {
  const db = readDb();
  res.json(db.i18n || { languages: [], defaultLang: 'en', strings: {} });
});

// Merge partial strings/languages into the i18n store
app.post('/api/i18n', (req, res) => {
  const db = readDb();
  db.i18n = db.i18n || { languages: [], defaultLang: 'en', strings: {} };
  const body = req.body || {};
  if (Array.isArray(body.languages)) db.i18n.languages = body.languages;
  if (body.defaultLang) db.i18n.defaultLang = body.defaultLang;
  if (body.strings && typeof body.strings === 'object') {
    Object.keys(body.strings).forEach(lang => {
      db.i18n.strings[lang] = { ...(db.i18n.strings[lang] || {}), ...body.strings[lang] };
    });
  }
  // Single-key convenience: { lang, key, value }
  if (body.lang && body.key !== undefined) {
    db.i18n.strings[body.lang] = db.i18n.strings[body.lang] || {};
    db.i18n.strings[body.lang][body.key] = body.value;
  }
  writeDb(db);
  res.json({ success: true, i18n: db.i18n });
});

// ---- Menus (sidebar / groups / landing cards) ----
app.get('/api/menus', (req, res) => {
  const db = readDb();
  res.json(db.menus || { sidebar: [], groups: [], landingCards: [] });
});

app.post('/api/menus', (req, res) => {
  const db = readDb();
  db.menus = db.menus || { sidebar: [], groups: [], landingCards: [] };
  const body = req.body || {};
  if (Array.isArray(body.sidebar)) db.menus.sidebar = body.sidebar;
  if (Array.isArray(body.groups)) db.menus.groups = body.groups;
  if (Array.isArray(body.landingCards)) db.menus.landingCards = body.landingCards;
  if (Array.isArray(body.bookmarks)) db.menus.bookmarks = body.bookmarks;
  writeDb(db);
  res.json({ success: true, menus: db.menus });
});

// ---- Pages (CMS-authored page content) ----
app.get('/api/pages', (req, res) => {
  const db = readDb();
  if (req.query.slug) {
    const page = (db.pages || []).find(p => p.slug === req.query.slug);
    return res.json(page || null);
  }
  res.json(db.pages || []);
});

app.post('/api/pages', (req, res) => {
  const db = readDb();
  db.pages = db.pages || [];
  const page = req.body || {};
  if (page.id) {
    const idx = db.pages.findIndex(p => p.id === page.id);
    if (idx >= 0) db.pages[idx] = { ...db.pages[idx], ...page };
    else db.pages.push(page);
  } else {
    page.id = newId('page');
    db.pages.push(page);
  }
  writeDb(db);
  res.json({ success: true, page });
});

app.delete('/api/pages/:id', (req, res) => {
  const db = readDb();
  db.pages = (db.pages || []).filter(p => p.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, message: 'Page deleted.' });
});

// ---- Notification / alert banners (admin-configurable, per-page or global) ----
app.get('/api/banners', (req, res) => {
  const db = readDb();
  const all = db.banners || [];
  if (!req.query.slug) return res.json(all); // admin: full list
  const slug = req.query.slug;
  const now = Date.now();
  const applies = all.filter(b => {
    if (!b || b.active === false) return false;
    if (b.start && now < Date.parse(b.start)) return false;
    if (b.end && now > Date.parse(b.end)) return false;
    if (b.scope === 'global') return true;
    return Array.isArray(b.pages) && b.pages.indexOf(slug) > -1;
  });
  applies.sort((a, b) => (b.priority || 0) - (a.priority || 0)); // higher priority renders on top
  res.json(applies);
});

app.post('/api/banners', (req, res) => {
  const db = readDb();
  db.banners = db.banners || [];
  const b = req.body || {};
  const TYPES = ['info', 'success', 'warning', 'critical'];
  if (b.type && TYPES.indexOf(b.type) === -1) b.type = 'info';
  const nowIso = new Date().toISOString();
  if (b.id) {
    const idx = db.banners.findIndex(x => x.id === b.id);
    if (idx >= 0) db.banners[idx] = { ...db.banners[idx], ...b, updatedAt: nowIso };
    else db.banners.push({ ...b, updatedAt: nowIso });
  } else {
    b.id = newId('banner');
    b.createdAt = nowIso;
    b.updatedAt = nowIso;
    if (b.rev == null) b.rev = 1;
    db.banners.push(b);
  }
  const ok = writeDb(db);
  res.json({ success: ok, banner: db.banners.find(x => x.id === b.id) || b });
});

app.delete('/api/banners/:id', (req, res) => {
  const db = readDb();
  db.banners = (db.banners || []).filter(b => b.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, message: 'Banner deleted.' });
});

// ---- Media library (base64 upload to /public/uploads) ----
app.get('/api/media', (req, res) => {
  const db = readDb();
  res.json(db.media || []);
});

app.post('/api/media', (req, res) => {
  const db = readDb();
  db.media = db.media || [];
  // VAL-01: presence is now owned exclusively by validators/cms.js's MediaUploadSchema.
  const { fileName, fileData, kind } = req.body || {};
  try {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const m = /^data:([^;]+);base64,(.*)$/.exec(fileData);
    const b64 = m ? m[2] : fileData.replace(/^data:[^,]*,/, '');
    const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const stored = `${Date.now()}_${safeName}`;
    fs.writeFileSync(path.join(uploadDir, stored), Buffer.from(b64, 'base64'));
    const item = { id: newId('media'), fileName: safeName, kind: kind || (m ? m[1] : 'application/octet-stream'), url: `/uploads/${stored}`, timestamp: new Date().toISOString() };
    db.media.push(item);
    writeDb(db);
    res.json({ success: true, media: item });
  } catch (e) {
    console.error('Media upload failed:', e);
    res.status(500).json({ error: 'Media upload failed.' });
  }
});

app.delete('/api/media/:id', (req, res) => {
  const db = readDb();
  const item = (db.media || []).find(m => m.id === req.params.id);
  if (item && item.url) {
    const p = path.join(__dirname, 'public', item.url.replace(/^\//, ''));
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ }
  }
  db.media = (db.media || []).filter(m => m.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, message: 'Media deleted.' });
});

// Helper function to generate high-fidelity SQL schemas
function generateSqlSchema(provider, db) {
  let ddl = "";
  let dml = "";

  // Dialect-specific types
  let jsonType = "JSON";
  
  if (provider === 'supabase' || provider === 'postgres') {
    jsonType = "JSONB";
  } else if (provider === 'azure') {
    jsonType = "NVARCHAR(MAX)";
  } else if (provider === 'aws' || provider === 'mysql') {
    jsonType = "JSON";
  }

  // 1. Settings Table DDL
  ddl += `-- -----------------------------------------------------\n`;
  ddl += `-- Target Provider Dialect: ${provider.toUpperCase()}\n`;
  ddl += `-- Table Structure for settings\n`;
  ddl += `-- -----------------------------------------------------\n`;
  if (provider === 'azure') {
    ddl += `CREATE TABLE settings (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  targetCompany NVARCHAR(255) NOT NULL,\n`;
    ddl += `  sector NVARCHAR(255),\n`;
    ddl += `  size NVARCHAR(100),\n`;
    ddl += `  hq NVARCHAR(255),\n`;
    ddl += `  acquisitionDate VARCHAR(50),\n`;
    ddl += `  synergyObjective NVARCHAR(MAX),\n`;
    ddl += `  browserModel NVARCHAR(100),\n`;
    ddl += `  timeTravelDay INT DEFAULT 1,\n`;
    ddl += `  doomGloballyEnabled BIT DEFAULT 1,\n`;
    ddl += `  doomUnlockXp INT DEFAULT 220,\n`;
    ddl += `  demoMode BIT DEFAULT 0\n`;
    ddl += `);\n\n`;
  } else {
    ddl += `CREATE TABLE settings (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  targetCompany VARCHAR(255) NOT NULL,\n`;
    ddl += `  sector VARCHAR(255),\n`;
    ddl += `  size VARCHAR(100),\n`;
    ddl += `  hq VARCHAR(255),\n`;
    ddl += `  acquisitionDate VARCHAR(50),\n`;
    ddl += `  synergyObjective TEXT,\n`;
    ddl += `  browserModel VARCHAR(100),\n`;
    ddl += `  timeTravelDay INT DEFAULT 1,\n`;
    ddl += `  doomGloballyEnabled BOOLEAN DEFAULT TRUE,\n`;
    ddl += `  doomUnlockXp INT DEFAULT 220,\n`;
    ddl += `  demoMode BOOLEAN DEFAULT FALSE\n`;
    ddl += `);\n\n`;
  }

  // Settings Active Row
  const settings = db.settings.demoMode === false ? (db.customSettings || { demoMode: false }) : db.settings;
  const targetCo = settings.targetCompany || "Apex Robotics Corp.";
  const sector = settings.sector || "Industrial Automation & AI";
  const size = settings.size || "120 Employees";
  const hq = settings.hq || "Zurich, Switzerland";
  const acqDate = settings.acquisitionDate || "2026-06-01";
  const objective = settings.synergyObjective || "Standardize systems and operations.";
  const browserModel = settings.browserModel || "simulated-duck";
  const timeTravelDay = settings.timeTravelDay || 1;
  const doomEnabled = settings.doomGloballyEnabled !== false ? 1 : 0;
  const doomUnlock = settings.doomUnlockXp || 220;

  if (provider === 'azure') {
    dml += `INSERT INTO settings (id, targetCompany, sector, size, hq, acquisitionDate, synergyObjective, browserModel, timeTravelDay, doomGloballyEnabled, doomUnlockXp, demoMode) VALUES (\n`;
    dml += `  'settings_active', N'${targetCo.replace(/'/g, "''")}', N'${sector.replace(/'/g, "''")}', N'${size.replace(/'/g, "''")}', N'${hq.replace(/'/g, "''")}', '${acqDate}', N'${objective.replace(/'/g, "''")}', N'${browserModel}', ${timeTravelDay}, ${doomEnabled}, ${doomUnlock}, 0\n`;
    dml += `);\n\n`;
  } else {
    const dBool = (doomEnabled === 1) ? 'TRUE' : 'FALSE';
    dml += `INSERT INTO settings (id, targetCompany, sector, size, hq, acquisitionDate, synergyObjective, browserModel, timeTravelDay, doomGloballyEnabled, doomUnlockXp, demoMode) VALUES (\n`;
    dml += `  'settings_active', '${targetCo.replace(/'/g, "''")}', '${sector.replace(/'/g, "''")}', '${size.replace(/'/g, "''")}', '${hq.replace(/'/g, "''")}', '${acqDate}', '${objective.replace(/'/g, "''")}', '${browserModel}', ${timeTravelDay}, ${dBool}, ${doomUnlock}, FALSE\n`;
    dml += `);\n\n`;
  }

  // 2. Employees Table DDL
  ddl += `-- Table Structure for employees\n`;
  ddl += `-- -----------------------------------------------------\n`;
  if (provider === 'azure') {
    ddl += `CREATE TABLE employees (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  name NVARCHAR(255) NOT NULL,\n`;
    ddl += `  role NVARCHAR(255) NOT NULL,\n`;
    ddl += `  department NVARCHAR(100) NOT NULL,\n`;
    ddl += `  company NVARCHAR(255),\n`;
    ddl += `  isLeader BIT DEFAULT 0,\n`;
    ddl += `  leaderRole NVARCHAR(255),\n`;
    ddl += `  buddyName NVARCHAR(255),\n`;
    ddl += `  buddyEmail NVARCHAR(255),\n`;
    ddl += `  completedLessons ${jsonType},\n`;
    ddl += `  points INT DEFAULT 0,\n`;
    ddl += `  badge NVARCHAR(100),\n`;
    ddl += `  bonusPoints INT DEFAULT 0\n`;
    ddl += `);\n\n`;
  } else {
    ddl += `CREATE TABLE employees (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  name VARCHAR(255) NOT NULL,\n`;
    ddl += `  role VARCHAR(255) NOT NULL,\n`;
    ddl += `  department VARCHAR(100) NOT NULL,\n`;
    ddl += `  company VARCHAR(255),\n`;
    ddl += `  isLeader BOOLEAN DEFAULT FALSE,\n`;
    ddl += `  leaderRole VARCHAR(255),\n`;
    ddl += `  buddyName VARCHAR(255),\n`;
    ddl += `  buddyEmail VARCHAR(255),\n`;
    ddl += `  completedLessons ${jsonType},\n`;
    ddl += `  points INT DEFAULT 0,\n`;
    ddl += `  badge VARCHAR(100),\n`;
    ddl += `  bonusPoints INT DEFAULT 0\n`;
    ddl += `);\n\n`;
  }

  const employees = db.settings.demoMode === false ? (db.customEmployees || []) : (db.employees || []);
  employees.forEach(emp => {
    const isLeader = emp.isLeader ? (provider === 'azure' ? 1 : 'TRUE') : (provider === 'azure' ? 0 : 'FALSE');
    const name = emp.name || '';
    const role = emp.role || '';
    const dept = emp.department || '';
    const comp = emp.company || '';
    const lRole = emp.leaderRole || 'None';
    const bName = emp.buddyName || '';
    const bEmail = emp.buddyEmail || '';
    const lessons = JSON.stringify(emp.completedLessons || []);
    const points = emp.points || 0;
    const badge = emp.badge || 'New Recruit';
    const bonus = emp.bonusPoints || 0;

    if (provider === 'azure') {
      dml += `INSERT INTO employees (id, name, role, department, company, isLeader, leaderRole, buddyName, buddyEmail, completedLessons, points, badge, bonusPoints) VALUES (\n`;
      dml += `  '${emp.id}', N'${name.replace(/'/g, "''")}', N'${role.replace(/'/g, "''")}', N'${dept.replace(/'/g, "''")}', N'${comp.replace(/'/g, "''")}', ${isLeader}, N'${lRole.replace(/'/g, "''")}', N'${bName.replace(/'/g, "''")}', N'${bEmail.replace(/'/g, "''")}', N'${lessons.replace(/'/g, "''")}', ${points}, N'${badge.replace(/'/g, "''")}', ${bonus}\n`;
      dml += `);\n`;
    } else {
      dml += `INSERT INTO employees (id, name, role, department, company, isLeader, leaderRole, buddyName, buddyEmail, completedLessons, points, badge, bonusPoints) VALUES (\n`;
      dml += `  '${emp.id}', '${name.replace(/'/g, "''")}', '${role.replace(/'/g, "''")}', '${dept.replace(/'/g, "''")}', '${comp.replace(/'/g, "''")}', ${isLeader}, '${lRole.replace(/'/g, "''")}', '${bName.replace(/'/g, "''")}', '${bEmail.replace(/'/g, "''")}', '${lessons.replace(/'/g, "''")}', ${points}, '${badge.replace(/'/g, "''")}', ${bonus}\n`;
      dml += `);\n`;
    }
  });

  // 3. Integration Leaders Table DDL
  ddl += `\n-- Table Structure for hrbps\n`;
  ddl += `-- -----------------------------------------------------\n`;
  if (provider === 'azure') {
    ddl += `CREATE TABLE hrbps (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  name NVARCHAR(255) NOT NULL,\n`;
    ddl += `  email NVARCHAR(255) NOT NULL,\n`;
    ddl += `  role NVARCHAR(100),\n`;
    ddl += `  assignedTracks ${jsonType},\n`;
    ddl += `  supportingTeams ${jsonType}\n`;
    ddl += `);\n\n`;
  } else {
    ddl += `CREATE TABLE hrbps (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  name VARCHAR(255) NOT NULL,\n`;
    ddl += `  email VARCHAR(255) NOT NULL,\n`;
    ddl += `  role VARCHAR(100),\n`;
    ddl += `  assignedTracks ${jsonType},\n`;
    ddl += `  supportingTeams ${jsonType}\n`;
    ddl += `);\n\n`;
  }

  const hrbps = db.settings.demoMode === false ? (db.customHrbps || []) : (db.hrbps || []);
  hrbps.forEach(h => {
    const name = h.name || '';
    const email = h.email || '';
    const role = h.role || 'hrbp';
    const tracks = JSON.stringify(h.assignedTracks || []);
    const teams = JSON.stringify(h.supportingTeams || []);

    if (provider === 'azure') {
      dml += `INSERT INTO hrbps (id, name, email, role, assignedTracks, supportingTeams) VALUES (\n`;
      dml += `  '${h.id}', N'${name.replace(/'/g, "''")}', N'${email.replace(/'/g, "''")}', N'${role.replace(/'/g, "''")}', N'${tracks.replace(/'/g, "''")}', N'${teams.replace(/'/g, "''")}'\n`;
      dml += `);\n`;
    } else {
      dml += `INSERT INTO hrbps (id, name, email, role, assignedTracks, supportingTeams) VALUES (\n`;
      dml += `  '${h.id}', '${name.replace(/'/g, "''")}', '${email.replace(/'/g, "''")}', '${role.replace(/'/g, "''")}', '${tracks.replace(/'/g, "''")}', '${teams.replace(/'/g, "''")}'\n`;
      dml += `);\n`;
    }
  });

  return ddl + dml;
}

// POST Migrate Database & Compile SQL Relational Schema
app.post('/api/admin/migrate-db', (req, res) => {
  // VAL-01: provider-required is now owned exclusively by validators/settings.js's MigrateDbSchema.
  const { provider, connectionDetails } = req.body;

  const db = readDb();
  
  // 1. Generate full customized schema script
  const sqlSchema = generateSqlSchema(provider, db);

  // 2. Save active configuration persistently in setting metadata
  db.settings = db.settings || {};
  db.settings.databaseConfig = {
    enabled: true,
    provider,
    status: 'connected',
    connectionDetails: connectionDetails || {},
    timestamp: new Date().toISOString()
  };

  if (db.settings.demoMode === false) {
    db.customSettings = db.customSettings || { demoMode: false };
    db.customSettings.databaseConfig = db.settings.databaseConfig;
  }

  writeDb(db);

  res.json({
    success: true,
    message: `Database successfully migrated to ${provider.toUpperCase()} SQL Relational schema!`,
    schema: sqlSchema
  });
});

// POST revoke all sessions for a user (D-07 offboarding action) — admin-only,
// enforced by ROLE_WRITE_POLICY's `/api/admin` prefix (AUTH-02) in the
// consolidated /api gate above: an hrbp/pmo/employee session 403s here before
// this handler ever runs. This is deliberately the minimum viable offboarding
// primitive — NOT the deferred full user-CRUD.
app.post('/api/admin/users/:username/revoke-sessions', (req, res) => {
  sessions.deleteAllSessionsForUser(getRuntimeConnection(), req.params.username);
  // D-08: an admin revoking a USER's sessions (offboarding) is a security
  // event — deliberately distinct from an ordinary self-service logout,
  // which is never audited. `req.portalUser` is null here under the
  // DEMO_OPEN=1 open-mode bypass (D-02: an isOpenMode request is not gated
  // on role/session at all, and this path is NOT a CONTROL_PLANE_PATH, so it
  // resolves to demo.db and skips the gate's role check entirely) — with no
  // attributable actor and no real security boundary in that mode to begin
  // with, this mirrors D-08's "demo writes are NOT audited" rule rather than
  // throwing and breaking an otherwise-legitimate demo-mode request.
  if (req.portalUser) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'session-revoke-all', subject: req.params.username,
      request: requestMeta(req),
    });
  }
  res.json({ success: true });
});

// GET AI Insight dynamic RAG portal insight
app.get('/api/ai/insight', async (req, res) => {
  const { portal } = req.query;
  if (!portal) {
    return res.status(400).json({ error: 'Portal parameter is required.' });
  }

  try {
    // ISO-01 (Task 2 cutover): the key is a secret field — one shared
    // runtime.db value regardless of demo/custom lane (a lane-specific
    // override never existed in runtime.db's secretSettings singleton).
    const apiKey = controlStore.getSecretSettings().geminiApiKey || '';

    // Invoke RAG-enabled AI insight service
    const aiService = require('./aiService');
    const insight = await aiService.generateSmolInsight({ portal, apiKey });

    res.json({
      success: true,
      portal,
      insight
    });
  } catch (error) {
    console.error('Error generating AI Insight dynamic insight:', error);
    res.status(500).json({ success: false, error: 'Failed to generate integration insight.' });
  }
});

  // GET Questions
app.get('/api/questions', (req, res) => {
  const db = readDb();
  res.json(db.questions || []);
});

// POST Question (Add New)
app.post('/api/questions', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/assessment.js's QuestionCreateSchema.
  const { text, dimension, weight } = req.body;

  const db = readDb();
  const newQuestion = {
    id: newId('q'),
    dimension,
    text,
    weight: parseFloat(weight) || 1.0
  };
  
  db.questions.push(newQuestion);
  writeDb(db);
  res.status(201).json({ success: true, question: newQuestion });
});

// POST Question Update (Edit Existing)
app.post('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  const { text, dimension, weight } = req.body;
  
  const db = readDb();
  const q = db.questions.find(item => item.id === id);
  if (!q) {
    return res.status(404).json({ error: 'Question not found.' });
  }
  
  if (text !== undefined) q.text = text;
  if (dimension !== undefined) q.dimension = dimension;
  if (weight !== undefined) q.weight = parseFloat(weight) || 1.0;
  
  writeDb(db);
  res.json({ success: true, question: q });
});

// DELETE Question
app.delete('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const initialLength = db.questions.length;
  
  db.questions = db.questions.filter(q => q.id !== id);
  
  if (db.questions.length === initialLength) {
    return res.status(404).json({ error: 'Question not found.' });
  }
  
  writeDb(db);
  res.json({ success: true, message: 'Question deleted successfully.' });
});

// POST Assessment (Submit responses and trigger AI Plan generation)
app.post('/api/assessment', async (req, res) => {
  // VAL-01: non-empty-responses is now owned exclusively by validators/assessment.js's AssessmentSubmitSchema.
  const { responses } = req.body; // e.g. { "q1": 4, "q2": 3 }
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");
  
  // Calculate average scores per dimension
  const sums = { culture: 0, talent: 0, value: 0 };
  const counts = { culture: 0, talent: 0, value: 0 };
  
  db.questions.forEach(q => {
    const score = parseFloat(responses[q.id]);
    if (!isNaN(score)) {
      sums[q.dimension] += score;
      counts[q.dimension]++;
    }
  });
  
  const scores = {
    culture: counts.culture > 0 ? parseFloat((sums.culture / counts.culture).toFixed(2)) : 3.0,
    talent: counts.talent > 0 ? parseFloat((sums.talent / counts.talent).toFixed(2)) : 3.0,
    value: counts.value > 0 ? parseFloat((sums.value / counts.value).toFixed(2)) : 3.0
  };
  
  const assessmentId = newId('assess');
  const timestamp = new Date().toISOString();
  
  // Generate the AI 100-Day Integration Plan
  let aiPlan = "";
  try {
    aiPlan = await aiService.generate100DayPlan({
      targetCompany,
      scores,
      responses,
      questions: db.questions,
      // ISO-01 (Task 2 cutover): the key is a secret field, sourced from
      // runtime.db's secretSettings singleton regardless of demo/custom lane.
      apiKey: controlStore.getSecretSettings().geminiApiKey || ''
    });
  } catch (error) {
    console.error("AI Plan generation failed, falling back to local engine:", error);
    aiPlan = aiService.generateLocalFallbackPlan(targetCompany, scores);
  }
  
  const assessmentRecord = {
    id: assessmentId,
    timestamp,
    targetCompany,
    responses,
    scores,
    aiPlan
  };
  
  if (isCustom) {
    db.customAssessments = db.customAssessments || [];
    db.customAssessments.push(assessmentRecord);
  } else {
    db.assessments = db.assessments || [];
    db.assessments.push(assessmentRecord);
  }
  try {
    writeDb(db);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to save assessment.' });
  }

  res.status(201).json({ success: true, assessment: assessmentRecord });
});

// GET Latest Assessment
app.get('/api/assessment/latest', (req, res) => {
  const db = readDb();
  const day = db.settings.timeTravelDay || 30;
  const isCustom = db.settings && db.settings.demoMode === false;
  const assessments = isCustom && db.customAssessments && db.customAssessments.length > 0 ? db.customAssessments : (db.assessments || []);
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");
  
  if (!assessments || assessments.length === 0) {
    // ISO-02: the day-scaling curve is a demo showcase device — a deal-bound
    // request with no real assessment yet gets a flat, unscaled placeholder
    // instead of a fabricated demo-arc score.
    const scores = req.isDemo ? getScaledScores(null, day) : { culture: 3.2, talent: 3.5, value: 3.0 };
    const mockAssessment = {
      id: 'mock_assess',
      timestamp: new Date().toISOString(),
      targetCompany: targetCompany,
      responses: {},
      scores,
      aiPlan: aiService.generateLocalFallbackPlan(targetCompany, scores)
    };
    return res.json({ success: true, assessment: mockAssessment });
  }
  // Get the most recent assessment
  const latest = { ...assessments[assessments.length - 1] };
  // ISO-02: only demo.db's stored scores get the showcase day-scaling curve
  // applied — a deal's real assessment scores are returned exactly as stored.
  latest.scores = req.isDemo ? getScaledScores(latest.scores, day) : latest.scores;
  res.json({ success: true, assessment: latest });
});

// GET All Assessments (History)
app.get('/api/assessments', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    res.json(db.customAssessments && db.customAssessments.length > 0 ? db.customAssessments : (db.assessments || []));
  } else {
    res.json(db.assessments || []);
  }
});

// DELETE Assessment
app.delete('/api/assessments/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    db.customAssessments = (db.customAssessments || []).filter(a => a.id !== id);
  } else {
    db.assessments = (db.assessments || []).filter(a => a.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Assessment deleted.' });
});

// =====================================================================
// Assessment Suite v2 — template-driven readiness assessments
// (two-sided company readiness, Integration Leader readiness).
// Templates ride the per-project cms bundle; instances live in the
// demo/custom lane split like `assessments`. The legacy questions[] /
// POST /api/assessment survey engine stays untouched alongside.
// =====================================================================

function assessLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customAssessmentInstances = db.customAssessmentInstances || []; return db.customAssessmentInstances; }
  db.assessmentInstances = db.assessmentInstances || [];
  return db.assessmentInstances;
}

// Demo-lane instances carry an explicit `demoDay` (the day in the 100-day arc the
// record was "taken"); time travel reveals later seeded retakes instead of
// fabricating score inflation on a single record.
function visibleAssessInstances(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  const lane = assessLane(db);
  if (isCustom) return lane;
  const day = (db.settings && db.settings.timeTravelDay) || 30;
  return lane.filter(i => i.demoDay == null || i.demoDay <= day);
}

// Pure synchronous scorer — deliberately NO awaits between readDb and writeDb
// anywhere on the instance-submit path (file DB has no write concurrency).
function scoreAssessmentInstance(template, responses) {
  const scale = template.scale || { min: 1, max: 5 };
  const span = (scale.max - scale.min) || 4;
  const dimensionScores = {};
  const dimWeights = {};
  let expEarned = 0, expTotal = 0;
  (template.dimensions || []).forEach(dim => {
    let sum = 0, wsum = 0;
    (dim.questions || []).forEach(q => {
      const raw = responses ? responses[q.id] : undefined;
      if (q.type === 'checkbox') {
        // Experience-inventory evidence: counts toward experienceIndex, never banding.
        expTotal += (q.score || 1);
        if (raw === true || raw === 'true' || raw === 1) expEarned += (q.score || 1);
        return;
      }
      if (raw === undefined || raw === null || raw === '') return;
      let pct = null;
      if (q.type === 'sjt') {
        const opts = q.options || [];
        const idx = parseInt(raw, 10);
        const maxScore = opts.reduce((m, o) => Math.max(m, o.score || 0), 0) || 1;
        if (!isNaN(idx) && opts[idx]) pct = ((opts[idx].score || 0) / maxScore) * 100;
      } else if (q.type === 'maturity') {
        const v = parseFloat(raw);
        if (!isNaN(v)) pct = ((Math.min(Math.max(v, 1), 5) - 1) / 4) * 100;
      } else { // likert
        let v = parseFloat(raw);
        if (!isNaN(v)) {
          v = Math.min(Math.max(v, scale.min), scale.max);
          if (q.reverse) v = scale.max + scale.min - v;
          pct = ((v - scale.min) / span) * 100;
        }
      }
      if (pct == null) return;
      const w = q.weight || 1;
      sum += pct * w; wsum += w;
    });
    if (wsum > 0) { dimensionScores[dim.id] = Math.round(sum / wsum); dimWeights[dim.id] = dim.weight || 1; }
  });
  let osum = 0, owsum = 0;
  Object.keys(dimensionScores).forEach(id => { osum += dimensionScores[id] * dimWeights[id]; owsum += dimWeights[id]; });
  const overallScore = owsum > 0 ? Math.round(osum / owsum) : 0;
  const banding = template.banding || {};
  const bands = (banding.bands || []).slice().sort((a, b) => (b.min || 0) - (a.min || 0));
  const band = bands.find(b => overallScore >= (b.min || 0));
  const redFlagBelow = banding.redFlagBelow;
  const redFlags = (redFlagBelow == null) ? [] : Object.keys(dimensionScores).filter(id => dimensionScores[id] < redFlagBelow);
  const experienceIndex = expTotal > 0 ? Math.round((expEarned / expTotal) * 100) : null;
  return { dimensionScores, overallScore, bandId: band ? band.id : null, redFlags, experienceIndex };
}

// Raw answer maps never leave the server via list/status responses — target-company
// self-ratings and leader competency answers are the most sensitive records in the
// app, and these endpoints feed open dashboards.
function publicAssessInstance(inst) {
  if (!inst) return null;
  const { responses, ...rest } = inst;
  return rest;
}

function latestAssessInstanceFor(visible, tplId, rater) {
  let latest = null;
  visible.forEach(i => {
    if (i.templateId !== tplId) return;
    if (rater && (i.rater || 'self') !== rater) return;
    if (!latest) { latest = i; return; }
    const byDay = (i.demoDay || 0) - (latest.demoDay || 0);
    if (byDay > 0 || (byDay === 0 && String(i.timestamp) > String(latest.timestamp))) latest = i;
  });
  return latest;
}

// GET published assessment templates (active project's CMS); ?all=1 includes drafts
app.get('/api/assessment-templates', (req, res) => {
  const db = readDb();
  const all = req.query.all === '1';
  const list = (db.assessmentTemplates || [])
    .filter(t => all || t.published !== false)
    .slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(list);
});

// POST a completed assessment — server computes every score (client sends raw answers only)
app.post('/api/assessment-instances', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/assessment.js's AssessmentInstanceSchema.
  const { templateId, rater, respondentName, respondentRole, responses, retakeOf } = req.body || {};
  const db = readDb();
  const template = (db.assessmentTemplates || []).find(t => t.id === templateId);
  if (!template) return res.status(404).json({ error: 'Assessment template not found.' });
  const scoresBlock = scoreAssessmentInstance(template, responses);
  const instance = {
    id: newId('ainst'),
    templateId,
    templateVersion: template.version || 1,
    subject: template.subject || 'target-org',
    rater: (template.raterModes || ['self']).includes(rater) ? rater : 'self',
    respondentRole: String(respondentRole || '').slice(0, 60),
    respondentName: String(respondentName || '').slice(0, 120),
    responses,
    ...scoresBlock,
    status: 'submitted',
    timestamp: new Date().toISOString(),
    ...(retakeOf ? { retakeOf } : {})
  };
  // Demo-lane submissions belong to "today" in the 100-day demo arc: stamp the
  // current time-travel day so they order after (and outrank) earlier seeded
  // retakes, and disappear again when the demo rewinds before their day.
  if (!(db.settings && db.settings.demoMode === false)) {
    instance.demoDay = (db.settings && db.settings.timeTravelDay) || 30;
  }
  assessLane(db).push(instance);
  writeDb(db);
  res.status(201).json({ success: true, instance: publicAssessInstance(instance) });
});

// GET instances (lane-aware, time-travel-aware, answers stripped).
// In any locked-down posture (ADMIN_TOKEN or PORTAL_AUTH) this list is
// admin-only: assessment records are the most sensitive data in the app.
app.get('/api/assessment-instances', (req, res) => {
  if (lockedDown(req) && !isAdminRequest(req)) {
    return res.status(401).json({ error: 'Admin authentication required to list assessment records.' });
  }
  const db = readDb();
  let list = visibleAssessInstances(db);
  if (req.query.templateId) list = list.filter(i => i.templateId === req.query.templateId);
  if (req.query.rater) list = list.filter(i => (i.rater || 'self') === req.query.rater);
  if (req.query.latest === '1') {
    const byKey = {};
    list.forEach(i => {
      const key = i.templateId + '|' + (i.rater || 'self');
      const cur = byKey[key];
      if (!cur) { byKey[key] = i; return; }
      const byDay = (i.demoDay || 0) - (cur.demoDay || 0);
      if (byDay > 0 || (byDay === 0 && String(i.timestamp) > String(cur.timestamp))) byKey[key] = i;
    });
    list = Object.values(byKey);
  }
  res.json(list.map(publicAssessInstance));
});

// DELETE an instance (admin cleanup)
app.delete('/api/assessment-instances/:id', (req, res) => {
  const db = readDb();
  const lane = assessLane(db);
  const filtered = lane.filter(i => i.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Instance not found.' });
  if (db.settings && db.settings.demoMode === false) db.customAssessmentInstances = filtered;
  else db.assessmentInstances = filtered;
  writeDb(db);
  res.json({ success: true });
});

// GET the readiness rollup — single source of truth for every gate point in the UI
app.get('/api/assessment-status', (req, res) => {
  const db = readDb();
  const templates = (db.assessmentTemplates || []).filter(t => t.published !== false);
  const visible = visibleAssessInstances(db);
  const required = [];
  const gatesSummary = {};
  const bySubject = {};
  // In any locked-down posture the status rollup carries scores/bands only —
  // no respondent names (leader ratings are personal data) — unless the
  // requester is an admin.
  const stripNames = lockedDown(req) && !isAdminRequest(req);
  const statusInstance = (inst) => {
    const pub = publicAssessInstance(inst);
    if (pub && stripNames) delete pub.respondentName;
    return pub;
  };
  templates.forEach(t => {
    const latest = latestAssessInstanceFor(visible, t.id, 'self');
    const entry = {
      templateId: t.id, slug: t.slug, subject: t.subject,
      required: !!t.required, gates: t.gates || [],
      satisfied: !!latest,
      latestInstance: statusInstance(latest)
    };
    bySubject[t.subject] = entry;
    if (t.required) required.push(entry);
    (t.gates || []).forEach(g => {
      gatesSummary[g] = gatesSummary[g] || { satisfied: true, blockedBy: [] };
      if (t.required && !latest) { gatesSummary[g].satisfied = false; gatesSummary[g].blockedBy.push(t.id); }
    });
  });

  // Compatibility per template pair (acquirer-org × target-org, joined on mirrorId).
  // Reported as two separate truths: per-company READINESS and profile ALIGNMENT
  // (100 − weighted mean gap). The fit band is the WORST of the alignment band and
  // both company bands — two equally weak companies must never read as a strong fit.
  const bandOf = (score) => score >= 80 ? 'ready' : score >= 60 ? 'support' : 'risk';
  const bandRank = { risk: 1, support: 2, ready: 3 };
  const pairs = {};
  templates.forEach(t => {
    if (!t.pairId) return;
    pairs[t.pairId] = pairs[t.pairId] || {};
    pairs[t.pairId][t.subject] = t;
  });
  const compatibility = [];
  Object.keys(pairs).forEach(pid => {
    const acqT = pairs[pid]['acquirer-org'], tgtT = pairs[pid]['target-org'];
    if (!acqT || !tgtT) return;
    const acqI = latestAssessInstanceFor(visible, acqT.id, 'self');
    const tgtI = latestAssessInstanceFor(visible, tgtT.id, 'self');
    if (!acqI || !tgtI) { compatibility.push({ pairId: pid, complete: false }); return; }
    const dims = [];
    (acqT.dimensions || []).forEach(d => {
      const mid = d.mirrorId || d.id;
      const td = (tgtT.dimensions || []).find(x => (x.mirrorId || x.id) === mid);
      if (!td) return;
      const a = (acqI.dimensionScores || {})[d.id];
      const tg = (tgtI.dimensionScores || {})[td.id];
      if (typeof a !== 'number' || typeof tg !== 'number') return;
      dims.push({ mirrorId: mid, label: d.label, labelKey: d.labelKey, icon: d.iconEmoji,
        acquirer: a, target: tg, gap: Math.abs(a - tg), weight: d.weight || 1 });
    });
    const wsum = dims.reduce((s, d) => s + d.weight, 0) || 1;
    const alignment = Math.round(100 - dims.reduce((s, d) => s + d.gap * d.weight, 0) / wsum);
    const fitBand = [bandOf(alignment), acqI.bandId || bandOf(acqI.overallScore), tgtI.bandId || bandOf(tgtI.overallScore)]
      .sort((a, b) => bandRank[a] - bandRank[b])[0];
    const topGaps = dims.slice().sort((a, b) => b.gap - a.gap).slice(0, 2).map(d => d.mirrorId);
    compatibility.push({
      pairId: pid, complete: true, alignment, fitBand,
      acquirer: { templateId: acqT.id, score: acqI.overallScore, bandId: acqI.bandId },
      target: { templateId: tgtT.id, score: tgtI.overallScore, bandId: tgtI.bandId },
      dims, topGaps
    });
  });

  const isCustomStatus = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustomStatus
    ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || '')
    : ((db.settings && db.settings.targetCompany) || '');
  res.json({ success: true, targetCompany, required, bySubject, gatesSummary, compatibility });
});

// =====================================================================
// Execution engine — Day-1/100-day checklists + workstream tasks in one
// task model. Checklist templates ride the cms bundle; live tasks are
// lane-split. Assessment remediation can create tasks (assessment → plan).
// =====================================================================

function taskLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customIntegrationTasks = db.customIntegrationTasks || []; return db.customIntegrationTasks; }
  db.integrationTasks = db.integrationTasks || [];
  return db.integrationTasks;
}

const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
const TASK_PHASES = ['pre', 'day1', 'd30', 'd60', 'd100'];

app.get('/api/integration-tasks', (req, res) => {
  const db = readDb();
  res.json(taskLane(db));
});

// Create or update a task (upsert by id, like departments/processes)
app.post('/api/integration-tasks', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = taskLane(db);
  if (b.id) {
    const task = lane.find(t => t.id === b.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    // Validate EVERYTHING before touching the object — readDb() hands back the
    // shared cache, so a mutation followed by a 400 would silently stick.
    // VAL-01: status/phase enum membership is now owned exclusively by
    // validators/workstream.js's TaskUpsertSchema (z.enum) — an out-of-enum
    // value already 400ed before this handler ran. The empty-title-on-update
    // check below is NOT covered by that schema (its own refine() only
    // requires a title when `id` is absent) and stays here by design.
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'Task title cannot be empty.' });
    }
    ['title', 'titleKey', 'workstreamId', 'phase', 'owner', 'due'].forEach(k => {
      if (b[k] !== undefined) task[k] = String(b[k] || '').slice(0, 300);
    });
    if (b.status !== undefined) {
      task.status = b.status;
      if (b.status === 'done') task.completedAt = task.completedAt || new Date().toISOString();
      else delete task.completedAt;
    }
    writeDb(db);
    return res.json({ success: true, task });
  }
  // VAL-01: title-required-on-create is now owned exclusively by
  // validators/workstream.js's TaskUpsertSchema.refine().
  const title = String(b.title || '').trim();
  const task = {
    id: newId('task'),
    title: title.slice(0, 300),
    ...(b.titleKey ? { titleKey: String(b.titleKey).slice(0, 120) } : {}),
    workstreamId: String(b.workstreamId || 'ws_imo').slice(0, 60),
    phase: TASK_PHASES.includes(b.phase) ? b.phase : 'd30',
    owner: String(b.owner || '').slice(0, 120),
    due: String(b.due || '').slice(0, 20),
    status: TASK_STATUSES.includes(b.status) ? b.status : 'todo',
    source: String(b.source || 'manual').slice(0, 160),
    createdAt: new Date().toISOString()
  };
  lane.push(task);
  writeDb(db);
  res.status(201).json({ success: true, task });
});

app.delete('/api/integration-tasks/:id', (req, res) => {
  const db = readDb();
  const lane = taskLane(db);
  const filtered = lane.filter(t => t.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Task not found.' });
  if (db.settings && db.settings.demoMode === false) db.customIntegrationTasks = filtered;
  else db.integrationTasks = filtered;
  writeDb(db);
  res.json({ success: true });
});

// Instantiate a checklist template: every item becomes a task once (source-deduped),
// so re-running after adding template items only creates the new ones.
app.post('/api/integration-tasks/instantiate', (req, res) => {
  const { checklistTemplateId } = req.body || {};
  const db = readDb();
  const tpl = (db.checklistTemplates || []).find(t => t.id === checklistTemplateId);
  if (!tpl) return res.status(404).json({ error: 'Checklist template not found.' });
  const lane = taskLane(db);
  const created = [];
  (tpl.items || []).forEach(item => {
    const source = 'template:' + tpl.id + ':' + item.id;
    if (lane.some(t => t.source === source)) return;
    const task = {
      id: newId('task'),
      title: item.text || item.id,
      ...(item.textKey ? { titleKey: item.textKey } : {}),
      workstreamId: item.workstreamId || 'ws_imo',
      phase: TASK_PHASES.includes(item.phase) ? item.phase : 'd30',
      owner: item.ownerHint || '',
      due: '',
      status: 'todo',
      source,
      createdAt: new Date().toISOString()
    };
    lane.push(task);
    created.push(task);
  });
  if (created.length) writeDb(db);
  res.json({ success: true, created: created.length });
});

// Assessment → plan: turn the latest instance's sub-80 remediation advice into
// tasks (source-deduped). This is the closing of the loop: readiness gaps
// become owned, trackable work.
const REMEDIATION_WS = {
  dim_governance: 'ws_imo', dim_people: 'ws_hr', dim_culture: 'ws_hr',
  dim_systems: 'ws_it', dim_commercial: 'ws_sales', dim_day1: 'ws_imo'
};
app.post('/api/integration-tasks/from-remediation', (req, res) => {
  const { assessmentTemplateId } = req.body || {};
  const db = readDb();
  const tpl = (db.assessmentTemplates || []).find(t => t.id === assessmentTemplateId);
  if (!tpl) return res.status(404).json({ error: 'Assessment template not found.' });
  const latest = latestAssessInstanceFor(visibleAssessInstances(db), tpl.id, 'self');
  if (!latest) return res.status(400).json({ error: 'No submitted assessment to derive tasks from.' });
  const lane = taskLane(db);
  const created = [];
  (tpl.remediation || []).forEach(r => {
    const score = (latest.dimensionScores || {})[r.dimensionId];
    if (typeof score !== 'number' || score >= 80) return;
    const source = 'remediation:' + tpl.id + ':' + r.dimensionId;
    if (lane.some(t => t.source === source)) return;
    const task = {
      id: newId('task'),
      title: r.advice || r.dimensionId,
      ...(r.adviceKey ? { titleKey: r.adviceKey } : {}),
      workstreamId: REMEDIATION_WS[r.dimensionId] || 'ws_imo',
      phase: 'd30',
      owner: '',
      due: '',
      status: 'todo',
      source,
      createdAt: new Date().toISOString()
    };
    lane.push(task);
    created.push(task);
  });
  if (created.length) writeDb(db);
  res.json({ success: true, created: created.length });
});

app.get('/api/checklist-templates', (req, res) => {
  res.json(readDb().checklistTemplates || []);
});

// =====================================================================
// Synergy tracker — initiatives with $M targets vs realized, lifecycle
// identified → validated → planned → executing → realized.
// =====================================================================
function synergyLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customSynergyInitiatives = db.customSynergyInitiatives || []; return db.customSynergyInitiatives; }
  db.synergyInitiatives = db.synergyInitiatives || [];
  return db.synergyInitiatives;
}
const SYN_STATUSES = ['identified', 'validated', 'planned', 'executing', 'realized'];

app.get('/api/synergies', (req, res) => {
  res.json(synergyLane(readDb()));
});

app.post('/api/synergies', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.max(0, Math.round(n * 10) / 10); };
  if (b.id) {
    const item = lane.find(s => s.id === b.id);
    if (!item) return res.status(404).json({ error: 'Initiative not found.' });
    // Validate before mutating the shared readDb() cache (see task update).
    // VAL-01: status enum membership is now owned exclusively by
    // validators/workstream.js's SynergyUpsertSchema (z.enum); the
    // empty-title-on-update check is NOT covered by that schema's refine()
    // (which only requires a title when `id` is absent) and stays here.
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'Initiative title cannot be empty.' });
    }
    ['title', 'owner', 'workstreamId', 'notes'].forEach(k => { if (b[k] !== undefined) item[k] = String(b[k] || '').slice(0, 300); });
    if (b.category !== undefined) item.category = b.category === 'cost' ? 'cost' : 'revenue';
    if (b.targetM !== undefined) item.targetM = num(b.targetM);
    if (b.realizedM !== undefined) item.realizedM = num(b.realizedM);
    if (b.status !== undefined) item.status = b.status;
    writeDb(db);
    return res.json({ success: true, initiative: item });
  }
  // VAL-01: title-required-on-create is now owned exclusively by
  // validators/workstream.js's SynergyUpsertSchema.refine().
  const title = String(b.title || '').trim();
  const item = {
    id: newId('syn'),
    title: title.slice(0, 300),
    category: b.category === 'cost' ? 'cost' : 'revenue',
    targetM: num(b.targetM),
    realizedM: num(b.realizedM),
    owner: String(b.owner || '').slice(0, 120),
    workstreamId: String(b.workstreamId || 'ws_imo').slice(0, 60),
    status: SYN_STATUSES.includes(b.status) ? b.status : 'identified',
    notes: String(b.notes || '').slice(0, 600),
    createdAt: new Date().toISOString()
  };
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, initiative: item });
});

app.delete('/api/synergies/:id', (req, res) => {
  const db = readDb();
  const lane = synergyLane(db);
  const filtered = lane.filter(s => s.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Initiative not found.' });
  if (db.settings && db.settings.demoMode === false) db.customSynergyInitiatives = filtered;
  else db.synergyInitiatives = filtered;
  writeDb(db);
  res.json({ success: true });
});

// =====================================================================
// RAID log — risks / issues / decisions / dependencies.
// =====================================================================
function raidLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customRaidEntries = db.customRaidEntries || []; return db.customRaidEntries; }
  db.raidEntries = db.raidEntries || [];
  return db.raidEntries;
}
const RAID_TYPES = ['risk', 'issue', 'decision', 'dependency'];
const RAID_LEVELS = ['low', 'medium', 'high'];
const RAID_STATUSES = ['open', 'mitigating', 'closed'];

app.get('/api/raid', (req, res) => {
  res.json(raidLane(readDb()));
});

app.post('/api/raid', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = raidLane(db);
  if (b.id) {
    const item = lane.find(r => r.id === b.id);
    if (!item) return res.status(404).json({ error: 'Entry not found.' });
    // Validate before mutating the shared readDb() cache (see task update).
    // VAL-01: status enum membership is now owned exclusively by
    // validators/workstream.js's RaidUpsertSchema (z.enum); the
    // empty-title-on-update check stays here for the same reason noted on
    // the tasks/synergies routes above.
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'Entry title cannot be empty.' });
    }
    ['title', 'owner', 'workstreamId', 'notes'].forEach(k => { if (b[k] !== undefined) item[k] = String(b[k] || '').slice(0, 300); });
    if (b.type !== undefined && RAID_TYPES.includes(b.type)) item.type = b.type;
    if (b.severity !== undefined && RAID_LEVELS.includes(b.severity)) item.severity = b.severity;
    if (b.probability !== undefined && RAID_LEVELS.includes(b.probability)) item.probability = b.probability;
    if (b.status !== undefined) item.status = b.status;
    writeDb(db);
    return res.json({ success: true, entry: item });
  }
  // VAL-01: title-required-on-create is now owned exclusively by
  // validators/workstream.js's RaidUpsertSchema.refine().
  const title = String(b.title || '').trim();
  const item = {
    id: newId('raid'),
    type: RAID_TYPES.includes(b.type) ? b.type : 'risk',
    title: title.slice(0, 300),
    severity: RAID_LEVELS.includes(b.severity) ? b.severity : 'medium',
    ...(b.probability && RAID_LEVELS.includes(b.probability) ? { probability: b.probability } : {}),
    owner: String(b.owner || '').slice(0, 120),
    workstreamId: String(b.workstreamId || 'ws_imo').slice(0, 60),
    status: RAID_STATUSES.includes(b.status) ? b.status : 'open',
    notes: String(b.notes || '').slice(0, 600),
    createdAt: new Date().toISOString()
  };
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, entry: item });
});

// =====================================================================
// Due Diligence workspace (DD-01/DD-04) — request items scoped to one of
// db/accessPolicy.js's eight fixed functional areas, guarded end-to-end by
// that module's clean-room need-to-know filter. Every route here resolves
// the caller's FULL deal object via controlStore.getDeal() (never just
// req.dealContext, which carries only the id/kind) because accessPolicy
// needs deal.memberGrants/deal.members to decide clearance.
// =====================================================================

// Flat lane helper, deliberately with NO demoMode/isCustom branch — copying
// that branch from raidLane()/synergyLane() above would be dead code inside
// a real deal's own database file (04-RESEARCH.md's named anti-pattern; this
// collection is deal-DB-native, never demo-shadow-laned).
function ddRequestLane(db) {
  db.ddRequestItems = db.ddRequestItems || [];
  return db.ddRequestItems;
}

// D-15: overdue is COMPUTED here at response time and never written into the
// stored row — true when dueDate is a non-empty 'YYYY-MM-DD' string strictly
// earlier than today's UTC date AND status is not 'closed'.
const DD_DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function computeOverdue(item) {
  if (!item || item.status === 'closed') return false;
  const due = item.dueDate;
  if (typeof due !== 'string' || !DD_DUE_DATE_RE.test(due)) return false;
  return due < new Date().toISOString().slice(0, 10);
}
function publicDdItem(item) {
  return Object.assign({}, item, { overdue: computeOverdue(item) });
}

// D-16: every DD_AREAS entry the caller is cleared for (never the full
// fixed list) — the page (public/js/due-diligence.js) renders only what
// this route returns and holds no client-side area list of its own.
app.get('/api/dd/areas', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const granted = new Set(accessPolicy.grantedAreas(deal, req.portalUser));
  res.json(accessPolicy.DD_AREAS.filter((a) => granted.has(a.id)));
});

// T-04-01: filterByAreaGrant() runs server-side on EVERY list response — an
// uncleared area's items are omitted here, never filtered client-side.
app.get('/api/dd/request-items', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddRequestLane(db);
  let visible = accessPolicy.filterByAreaGrant(lane, deal, req.portalUser);
  if (req.query.area) visible = visible.filter((i) => i.area === req.query.area);
  res.json(visible.map(publicDdItem));
});

// DD-04: "the denial itself is audited" — the ONLY place a DD access
// refusal is turned into an HTTP response. Records ONE `dd-access-denied`
// security event (the SAME call shape server.js's deal-create/deal-members
// call sites use), then sends the uniform 403 body. `areaId` is `null` for
// an unknown item id — the event's `subject` is null in that case too, so
// the audit row (never the HTTP response) is the only place "unknown id"
// and "uncleared area" are distinguishable. Called from server.js only,
// never from db/accessPolicy.js — that module stays free of any audit
// dependency, mirroring why db/controlStore.js holds no reference to
// audit.db (AUD-02's isolation precedent).
function refuseDdArea(req, res, areaId) {
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'dd-access-denied', dealId: req.dealContext.dealId, subject: areaId,
    before: null, after: null, request: requestMeta(req),
  });
  const err = new accessPolicy.AreaAccessError();
  res.status(err.status).json({ error: err.message });
}

// T-04-02/T-04-03: the shared by-id guard every DD by-id route runs BEFORE
// touching the item. `areaId` is the item's OWN stored area (or `null` for a
// missing item) — never a caller-supplied one. A missing item and an
// uncleared item are structurally indistinguishable to this guard (null is
// never a granted area for any role, including admin/hrbp), which is what
// gives GET/DELETE /api/dd/request-items/:id the uniform-403 anti-
// enumeration shape by construction rather than a second, forgettable
// branch (DD-04). Responds (via refuseDdArea, recording the denial) and
// returns `true` when refused; the caller must `return` immediately when
// this returns `true`.
function ddAreaRefused(req, res, deal, areaId) {
  try {
    accessPolicy.assertAreaGrant(deal, req.portalUser, areaId);
    return false;
  } catch (e) {
    if (!(e instanceof accessPolicy.AreaAccessError)) throw e;
    refuseDdArea(req, res, areaId);
    return true;
  }
}

app.get('/api/dd/request-items/:id', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const item = ddRequestLane(db).find((i) => i.id === req.params.id);
  if (ddAreaRefused(req, res, deal, item ? item.area : null)) return;
  res.json(publicDdItem(item));
});

app.delete('/api/dd/request-items/:id', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddRequestLane(db);
  const item = lane.find((i) => i.id === req.params.id);
  if (ddAreaRefused(req, res, deal, item ? item.area : null)) return;
  db.ddRequestItems = lane.filter((i) => i.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// Upsert-by-id, mirroring POST /api/raid's shape. On UPDATE (`id` present),
// the guard runs against the item's STORED area FIRST, before any field is
// mutated — the read model hands back a shared cache, so a mutation
// followed by a refusal would stick. A body that ALSO carries a different
// `area` additionally requires clearance for that NEW area (moving an item
// between areas requires clearance for both sides).
app.post('/api/dd/request-items', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddRequestLane(db);

  if (b.id) {
    const item = lane.find((i) => i.id === b.id);
    if (ddAreaRefused(req, res, deal, item ? item.area : null)) return;
    // Validate everything before mutating the shared readDb() cache (see
    // the task/RAID/synergy handlers' identical ordering comment above).
    // VAL-01: text-required-when-id-absent is owned by the schema's own
    // refine(); this empty-text-on-UPDATE guard stays here because the
    // schema's refine only requires text when `id` is absent.
    if (b.text !== undefined && !String(b.text).trim()) {
      return res.status(400).json({ error: 'Request item text cannot be empty.' });
    }
    if (b.area !== undefined && b.area !== item.area) {
      if (ddAreaRefused(req, res, deal, b.area)) return;
    }
    if (b.text !== undefined) item.text = String(b.text).trim().slice(0, 2000);
    if (b.owner !== undefined) item.owner = String(b.owner || '').slice(0, 120);
    if (b.status !== undefined) item.status = b.status;
    if (b.dueDate !== undefined) item.dueDate = String(b.dueDate || '').slice(0, 10);
    if (b.blocked !== undefined) item.blocked = !!b.blocked;
    if (b.notes !== undefined) item.notes = String(b.notes || '').slice(0, 2000);
    if (b.area !== undefined) item.area = b.area;
    writeDb(db);
    return res.json({ success: true, item: publicDdItem(item) });
  }

  if (ddAreaRefused(req, res, deal, b.area)) return;
  const item = {
    id: newId('ddreq'),
    area: b.area,
    text: String(b.text || '').trim().slice(0, 2000),
    owner: String(b.owner || '').slice(0, 120),
    status: 'open',
    dueDate: String(b.dueDate || '').slice(0, 10),
    blocked: false,
    vdrLink: null,
    notes: String(b.notes || '').slice(0, 2000),
    source: String(b.source || '').slice(0, 160),
    createdAt: new Date().toISOString(),
    createdBy: req.portalUser.username,
  };
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, item: publicDdItem(item) });
});

// =====================================================================
// In-app notifications — computed on demand from live data (no stored
// notification records to drift out of sync).
// =====================================================================
// The demo runs on its own clock: "now" is day N of the seeded 100-day arc,
// not the wall clock — otherwise seeded due dates go permanently overdue and
// ignore time travel. Custom projects use the real date.
const DEMO_ARC_START_MS = Date.parse('2026-05-01T09:00:00.000Z');
function portalNowMs(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) return Date.now();
  const day = (db.settings && db.settings.timeTravelDay) || 30;
  return DEMO_ARC_START_MS + (day - 1) * 86400000;
}

app.get('/api/notifications', (req, res) => {
  const db = readDb();
  const items = [];
  const visible = visibleAssessInstances(db);
  (db.assessmentTemplates || []).filter(t => t.published !== false && t.required).forEach(t => {
    if (!latestAssessInstanceFor(visible, t.id, 'self')) {
      items.push({ id: 'assess_' + t.id, type: 'assessment_pending', titleKey: t.titleKey || '', title: t.title || '', href: '/assessments.html', severity: 'high' });
    }
  });
  const nowMs = portalNowMs(db);
  const ilTpl = (db.assessmentTemplates || []).find(t => t.subject === 'integration-leader' && t.published !== false);
  if (ilTpl) {
    const latest = latestAssessInstanceFor(visible, ilTpl.id, 'self');
    if (latest && (nowMs - Date.parse(latest.timestamp)) > 90 * 86400000) {
      items.push({ id: 'reassess_il', type: 'reassess_il', href: '/assessments.html', severity: 'medium' });
    }
  }
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const tasks = taskLane(db);
  const overdue = tasks.filter(t => t.status !== 'done' && t.due && t.due < today);
  if (overdue.length) items.push({ id: 'tasks_overdue', type: 'tasks_overdue', count: overdue.length, href: '/execution.html', severity: 'high' });
  const blocked = tasks.filter(t => t.status === 'blocked');
  if (blocked.length) items.push({ id: 'tasks_blocked', type: 'tasks_blocked', count: blocked.length, href: '/execution.html', severity: 'medium' });
  const raidHigh = raidLane(db).filter(r => r.status !== 'closed' && r.severity === 'high');
  if (raidHigh.length) items.push({ id: 'raid_high', type: 'raid_high', count: raidHigh.length, href: '/execution.html', severity: 'high' });
  res.json({ success: true, items });
});

app.delete('/api/raid/:id', (req, res) => {
  const db = readDb();
  const lane = raidLane(db);
  const filtered = lane.filter(r => r.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Entry not found.' });
  if (db.settings && db.settings.demoMode === false) db.customRaidEntries = filtered;
  else db.raidEntries = filtered;
  writeDb(db);
  res.json({ success: true });
});

// ==========================================
// NEW M&A INTEGRATION DECK CRUD ENDPOINTS
// ==========================================

// GET Modules
app.get('/api/modules', (req, res) => {
  const db = readDb();
  res.json(db.modules || []);
});

// POST Module (Add/Edit)
app.post('/api/modules', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/workstream.js's ModuleUpsertSchema.
  const { id, title, dimension, urgency, minScore, maxScore, description, playbookLink, supportingTeams } = req.body;
  const db = readDb();
  db.modules = db.modules || [];

  if (id) {
    // Edit existing
    const idx = db.modules.findIndex(m => m.id === id);
    if (idx !== -1) {
      db.modules[idx] = {
        id,
        title,
        dimension,
        urgency,
        minScore: parseFloat(minScore) || 1.0,
        maxScore: parseFloat(maxScore) || 5.0,
        description,
        playbookLink: playbookLink || '',
        supportingTeams: supportingTeams || ''
      };
      writeDb(db);
      return res.json({ success: true, module: db.modules[idx] });
    }
  }

  // Create new
  const newModule = {
    id: newId('mod'),
    title,
    dimension,
    urgency,
    minScore: parseFloat(minScore) || 1.0,
    maxScore: parseFloat(maxScore) || 5.0,
    description,
    playbookLink: playbookLink || '',
    supportingTeams: supportingTeams || ''
  };

  db.modules.push(newModule);
  writeDb(db);
  res.status(201).json({ success: true, module: newModule });
});

// DELETE Module
app.delete('/api/modules/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.modules = (db.modules || []).filter(m => m.id !== id);
  writeDb(db);
  res.json({ success: true, message: 'Module deleted successfully.' });
});

// GET Employees
app.get('/api/employees', (req, res) => {
  const db = readDb();
  const day = db.settings.timeTravelDay || 30;
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  // Demo mode keeps the time-machine simulation (Day 1 = fresh org, Day 100 = fully
  // certified) so the org-wide ramp reads consistently. Custom mode shows REAL stored
  // progress so live lesson completions and +50 merit awards actually appear on the
  // leaderboard / dashboard roster / signage. ISO-02: the showcase scaling must ALSO
  // never apply outside the resolved demo database — a deal-bound request always sees
  // its own stored rows unscaled, routed through the single req.isDemo predicate.
  const result = (isCustom || !req.isDemo) ? employeesList : scaleEmployeesForDay(employeesList, day, getCatalogLessonIds(db));
  res.json(result);
});

// POST Employee
app.post('/api/employees', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's EmployeeUpsertSchema.
  const { id, name, role, department, company, lang, isLeader, leaderRole, buddyName, buddyEmail } = req.body;

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");

  let employee;
  const list = isCustom ? (db.customEmployees || []) : (db.employees || []);
  if (id) {
    employee = list.find(e => e.id === id);
  }

  if (employee) {
    employee.name = name;
    employee.role = role;
    employee.department = department;
    employee.company = company || targetCompany || 'Acquired Co.';
    employee.lang = lang || employee.lang || 'en';
    employee.isLeader = isLeader === true || isLeader === 'true';
    employee.leaderRole = leaderRole || 'None';
    employee.buddyName = buddyName || '';
    employee.buddyEmail = buddyEmail || '';
  } else {
    employee = {
      id: id || newId('emp'),
      name,
      role,
      department,
      company: company || targetCompany || 'Acquired Co.',
      lang: lang || 'en',
      isLeader: isLeader === true || isLeader === 'true',
      leaderRole: leaderRole || 'None',
      buddyName: buddyName || '',
      buddyEmail: buddyEmail || '',
      completedLessons: [],
      points: 0,
      badge: 'New Recruit',
      bonusPoints: 0
    };
    if (isCustom) {
      db.customEmployees = db.customEmployees || [];
      db.customEmployees.push(employee);
    } else {
      db.employees = db.employees || [];
      db.employees.push(employee);
    }
  }

  writeDb(db);
  res.status(id ? 200 : 201).json({ success: true, employee });
});

// DELETE Employee
app.delete('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    db.customEmployees = (db.customEmployees || []).filter(e => e.id !== id);
  } else {
    db.employees = (db.employees || []).filter(e => e.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Employee deleted successfully.' });
});

// Helper for Badge tier calculation
function calculateBadge(completedCount) {
  if (completedCount >= 9) return "Ultimate Integrator";
  if (completedCount >= 6) return "Synergy Scout";
  if (completedCount >= 3) return "Systems Scholar";
  if (completedCount >= 1) return "Culture Champion";
  return "New Recruit";
}

// GET or Create Employee (For tracking welcome page URLs & progress)
app.get('/api/employees/get-or-create', (req, res) => {
  const { empId, name, role, department, company, isLeader, leaderRole, buddyName, buddyEmail } = req.query;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");
  
  let employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);

  let found = null;
  if (empId) {
    found = employeesList.find(e => e.id === empId);
  }
  if (!found && name) {
    found = employeesList.find(e => e.name && e.name.toLowerCase() === name.toLowerCase());
  }

  if (found) {
    let updated = false;
    if (!found.completedLessons) { found.completedLessons = []; updated = true; }
    if (found.points === undefined) { found.points = 0; updated = true; }
    if (found.badge === undefined) { found.badge = "New Recruit"; updated = true; }
    if (found.bonusPoints === undefined) { found.bonusPoints = 0; updated = true; }
    if (found.isLeader === undefined) { found.isLeader = false; updated = true; }
    if (found.leaderRole === undefined) { found.leaderRole = "None"; updated = true; }
    if (found.buddyName === undefined) { found.buddyName = ""; updated = true; }
    if (found.buddyEmail === undefined) { found.buddyEmail = ""; updated = true; }
    if (updated) {
      writeDb(db);
    }
    return res.json({ success: true, employee: found });
  }

  // Create new profile dynamically
  const newEmployee = {
    id: empId || newId('emp'),
    name: name || "Valued Team Member",
    role: role || "Specialist",
    department: department || "Operations",
    company: company || targetCompany || 'NextGen Sensors Ltd.',
    completedLessons: [],
    points: 0,
    badge: "New Recruit",
    bonusPoints: 0,
    isLeader: isLeader === true || isLeader === 'true' || false,
    leaderRole: leaderRole || 'None',
    buddyName: buddyName || '',
    buddyEmail: buddyEmail || ''
  };

  if (isCustom) {
    db.customEmployees = db.customEmployees || [];
    db.customEmployees.push(newEmployee);
  } else {
    db.employees = db.employees || [];
    db.employees.push(newEmployee);
  }
  writeDb(db);
  res.status(201).json({ success: true, employee: newEmployee });
});

// POST Complete Lesson
app.post('/api/employees/complete-lesson', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's CompleteLessonSchema.
  const { empId, lessonId } = req.body;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  const employee = employeesList.find(e => e.id === empId);

  if (!employee) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  employee.completedLessons = employee.completedLessons || [];
  if (!employee.completedLessons.includes(lessonId)) {
    employee.completedLessons.push(lessonId);
    employee.bonusPoints = employee.bonusPoints || 0;
    employee.points = (employee.completedLessons.length * 20) + employee.bonusPoints;
    employee.badge = calculateBadge(employee.completedLessons.length);
    writeDb(db);
  }

  res.json({ success: true, employee });
});

// POST Uncomplete Lesson
app.post('/api/employees/uncomplete-lesson', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's CompleteLessonSchema.
  const { empId, lessonId } = req.body;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  const employee = employeesList.find(e => e.id === empId);

  if (!employee) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  employee.completedLessons = employee.completedLessons || [];
  if (employee.completedLessons.includes(lessonId)) {
    employee.completedLessons = employee.completedLessons.filter(id => id !== lessonId);
    employee.bonusPoints = employee.bonusPoints || 0;
    employee.points = (employee.completedLessons.length * 20) + employee.bonusPoints;
    employee.badge = calculateBadge(employee.completedLessons.length);
    writeDb(db);
  }

  res.json({ success: true, employee });
});

// POST Award Merit Bonus (For Integration Leaders to award extra +50 XP points)
app.post('/api/employees/award-merit', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's AwardMeritSchema.
  const { empId, points } = req.body;
  const meritPoints = parseInt(points) || 50;

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  const employee = employeesList.find(e => e.id === empId);

  if (!employee) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  employee.completedLessons = employee.completedLessons || [];
  employee.bonusPoints = (employee.bonusPoints || 0) + meritPoints;
  employee.points = (employee.completedLessons.length * 20) + employee.bonusPoints;
  employee.badge = calculateBadge(employee.completedLessons.length);
  writeDb(db);

  res.json({ success: true, employee });
});

// GET Integration Leaders
app.get('/api/hrbps', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    res.json(db.customHrbps || []);
  } else {
    res.json(db.hrbps || []);
  }
});

// POST Integration Leader
app.post('/api/hrbps', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's HrbpUpsertSchema.
  const { id, name, email, assignedTracks, supportingTeams, role } = req.body;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  
  let hrbp;
  const list = isCustom ? (db.customHrbps || []) : (db.hrbps || []);
  if (id) {
    hrbp = list.find(h => h.id === id);
  }

  if (hrbp) {
    hrbp.name = name;
    hrbp.email = email;
    hrbp.assignedTracks = Array.isArray(assignedTracks) ? assignedTracks : [];
    hrbp.supportingTeams = Array.isArray(supportingTeams) ? supportingTeams : [];
    hrbp.role = role || 'hrbp';
  } else {
    hrbp = {
      id: id || newId('hrbp'),
      name,
      email,
      assignedTracks: Array.isArray(assignedTracks) ? assignedTracks : [],
      supportingTeams: Array.isArray(supportingTeams) ? supportingTeams : [],
      role: role || 'hrbp'
    };
    if (isCustom) {
      db.customHrbps = db.customHrbps || [];
      db.customHrbps.push(hrbp);
    } else {
      db.hrbps = db.hrbps || [];
      db.hrbps.push(hrbp);
    }
  }

  writeDb(db);
  res.status(id ? 200 : 201).json({ success: true, hrbp });
});

// DELETE Integration Leader
app.delete('/api/hrbps/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    db.customHrbps = (db.customHrbps || []).filter(h => h.id !== id);
  } else {
    db.hrbps = (db.hrbps || []).filter(h => h.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Integration Leader deleted successfully.' });
});

// GET Alerts
app.get('/api/alerts', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    res.json(db.customAlerts || []);
  } else {
    res.json(db.alerts || []);
  }
});

// POST Alert
app.post('/api/alerts', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's AlertUpsertSchema.
  const { id, title, message, type } = req.body;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  
  let alertObj;
  const list = isCustom ? (db.customAlerts || []) : (db.alerts || []);
  if (id) {
    alertObj = list.find(a => a.id === id);
  }

  if (alertObj) {
    alertObj.title = title;
    alertObj.message = message;
    alertObj.type = type;
  } else {
    alertObj = {
      id: id || newId('alert'),
      title,
      message,
      type
    };
    if (isCustom) {
      db.customAlerts = db.customAlerts || [];
      db.customAlerts.push(alertObj);
    } else {
      db.alerts = db.alerts || [];
      db.alerts.push(alertObj);
    }
  }

  writeDb(db);
  res.status(id ? 200 : 201).json({ success: true, alert: alertObj });
});

// DELETE Alert
app.delete('/api/alerts/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    db.customAlerts = (db.customAlerts || []).filter(a => a.id !== id);
  } else {
    db.alerts = (db.alerts || []).filter(a => a.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Alert deleted successfully.' });
});

// GET Pulses
app.get('/api/pulses', (req, res) => {
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const day = (isCustom ? db.customSettings.timeTravelDay : db.settings.timeTravelDay) || db.settings.timeTravelDay || 30;
  // ISO-02: the seeded showcase pulse library must never inject fabricated
  // feedback into a deal-bound response — only demo.db gets the library.
  const scaled = req.isDemo ? getPulsesForDay(day) : [];
  // Append stored pulses (seeded + live submissions from the employee portal)
  // so POSTed feedback actually surfaces on the dashboard change curve.
  const stored = (db.pulses || []).filter(p => !scaled.some(s => s.id === p.id));
  res.json([...scaled, ...stored]);
});

// POST Pulse
app.post('/api/pulses', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's PulseCreateSchema.
  const { employeeName, rating, comment, type } = req.body;
  const db = readDb();
  db.pulses = db.pulses || [];

  const newPulse = {
    id: newId('pulse'),
    employeeName,
    rating: parseInt(rating) || 3,
    comment: comment || '',
    timestamp: new Date().toISOString(),
    type: type || '30-day'
  };

  db.pulses.push(newPulse);
  writeDb(db);
  res.status(201).json({ success: true, pulse: newPulse });
});

// --- Unified Communications Hub Endpoints ---

// GET Communications Ledger
app.get('/api/communications', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    res.json(db.customCommunications || []);
  } else {
    res.json(db.communications || []);
  }
});

// POST Communication (Dispatches alert & compiles HTML email)
app.post('/api/communications/send', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's CommunicationSendSchema.
  const { sender, senderRole, recipientType, recipientId, recipientEmail, recipientName, subject, template, body } = req.body;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;

  const commId = newId('comm');
  const htmlFileName = `${commId}.html`;
  
  // Create dynamic directory if it doesn't exist
  const emailDir = path.join(__dirname, 'public', 'sent_emails');
  if (!fs.existsSync(emailDir)) {
    fs.mkdirSync(emailDir, { recursive: true });
  }

  // Compile rich HTML email content
  const htmlContent = compileHtmlEmail({
    sender,
    senderRole: senderRole || 'system',
    recipientName: recipientName || recipientEmail,
    recipientEmail,
    subject,
    template: template || 'custom',
    body
  });

  // Write HTML file persistently
  const htmlFilePath = path.join(emailDir, htmlFileName);
  fs.writeFileSync(htmlFilePath, htmlContent, 'utf8');

  const newComm = {
    id: commId,
    timestamp: new Date().toISOString(),
    sender,
    senderRole: senderRole || 'system',
    recipientType: recipientType || 'all',
    recipientId: recipientId || 'all',
    recipientName: recipientName || recipientEmail,
    recipientEmail,
    subject,
    template: template || 'custom',
    body,
    htmlEmailPath: `/sent_emails/${htmlFileName}`,
    status: 'Sent'
  };

  if (isCustom) {
    db.customCommunications = db.customCommunications || [];
    db.customCommunications.push(newComm);
  } else {
    db.communications = db.communications || [];
    db.communications.push(newComm);
  }
  writeDb(db);

  res.status(201).json({ success: true, communication: newComm });
});

// DELETE Communication from history
app.delete('/api/communications/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const commsList = isCustom ? (db.customCommunications || []) : (db.communications || []);
  
  const comm = commsList.find(c => c.id === id);
  if (comm && comm.htmlEmailPath) {
    const filePath = path.join(__dirname, 'public', comm.htmlEmailPath);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn("Could not delete physical HTML email:", err);
      }
    }
  }

  if (isCustom) {
    db.customCommunications = (db.customCommunications || []).filter(c => c.id !== id);
  } else {
    db.communications = (db.communications || []).filter(c => c.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Communication record deleted successfully.' });
});

// HTML Email Compiler Helper Function
function compileHtmlEmail({ sender, senderRole, recipientName, recipientEmail, subject, template, body }) {
  // VAL-02/D-15: the app-wide stored-XSS control, as of this phase, is
  // three layers rather than one: (1) at WRITE time, every schema field a
  // reviewer has confirmed is genuinely rendered as markup is sanitized by
  // lib/sanitizeHtml.js via validators/index.js's htmlField()/
  // applySanitization() — see the tagged-field inventory comment in
  // validators/index.js for the full list (currently: lesson body, the
  // richtext page-layout block, and the legacy page body); (2) at RENDER
  // time, public/js/page-layout.js's own sanitize() call stays in place
  // unchanged as defence in depth (D-15); (3) every OTHER field — including
  // every field in THIS email compiler — is plain text, never tagged
  // HTML-bearing, and is defended here the same way it always has been: by
  // escaping it before interpolation, since the result is written to
  // public/sent_emails/<id>.html and served statically, so an unescaped
  // value here would be a stored-XSS vector. (\n -> <br> in the body still
  // works because escaping leaves newlines intact.)
  const escEmail = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  sender = escEmail(sender);
  senderRole = escEmail(senderRole);
  recipientName = escEmail(recipientName);
  subject = escEmail(subject);
  body = escEmail(body);
  let primaryColor = "#244C5A"; // Dark Teal
  let accentColor = "#E98300"; // TE Orange
  let typeLabel = "Welcome Announcement";
  let bannerColor = "rgba(36, 76, 90, 0.05)";
  
  if (template === "security") {
    primaryColor = "#B91C1C"; // Crimson
    accentColor = "#E98300"; // TE Orange
    typeLabel = "InfoSec Compliance Warning";
    bannerColor = "rgba(185, 28, 28, 0.05)";
  } else if (template === "synergy") {
    primaryColor = "#E98300"; // TE Orange
    accentColor = "#244C5A"; // Dark Teal
    typeLabel = "Values Synergy Workshop";
    bannerColor = "rgba(233, 131, 0, 0.05)";
  } else if (template === "custom") {
    primaryColor = "#374151"; // Charcoal
    accentColor = "#E98300"; // TE Orange
    typeLabel = "System Notice";
    bannerColor = "rgba(55, 65, 81, 0.05)";
  }

  const currentDate = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      background-color: #f1f5f9;
      color: #334155;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .email-container {
      max-width: 600px;
      margin: 2rem auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      border: 1px solid #e2e8f0;
    }
    .email-header {
      background: linear-gradient(135deg, ${primaryColor}, #1e293b);
      padding: 2rem;
      text-align: center;
      border-bottom: 4px solid ${accentColor};
    }
    .email-body {
      padding: 2.5rem 2rem;
    }
    .badge {
      display: inline-block;
      background-color: ${accentColor};
      color: #ffffff;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.25rem 0.6rem;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 800;
      color: ${primaryColor};
      margin: 0 0 1.25rem 0;
      line-height: 1.3;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 0.95rem;
      line-height: 1.6;
      color: #475569;
      margin: 0 0 1.5rem 0;
    }
    .salutation {
      font-size: 1.05rem;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 0.5rem;
    }
    .message-block {
      background-color: ${bannerColor};
      border-left: 4px solid ${accentColor};
      padding: 1.25rem;
      border-radius: 0 8px 8px 0;
      font-style: italic;
      font-size: 0.95rem;
      margin: 1.5rem 0;
      line-height: 1.6;
    }
    .cta-button {
      display: inline-block;
      background-color: ${primaryColor};
      color: #ffffff !important;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 700;
      padding: 0.75rem 1.75rem;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      margin-top: 1rem;
    }
    .email-footer {
      background-color: #f8fafc;
      padding: 1.5rem 2rem;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 0.75rem;
      color: #64748b;
      line-height: 1.5;
    }
    .footer-links {
      margin-top: 0.75rem;
      font-weight: 600;
    }
    .footer-links a {
      color: ${primaryColor};
      text-decoration: none;
      margin: 0 0.5rem;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <svg width="150" height="35" viewBox="0 0 160 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="40" height="40" rx="4" fill="#FFFFFF" />
        <text x="20" y="27" text-anchor="middle" font-family="-apple-system, sans-serif" font-weight="900" font-size="20" fill="${accentColor}">TE</text>
        <text x="48" y="26" font-family="-apple-system, sans-serif" font-weight="700" font-size="15" fill="#FFFFFF" letter-spacing="-0.03em">connectivity</text>
      </svg>
    </div>
    <div class="email-body">
      <span class="badge">${typeLabel}</span>
      <h1>${subject}</h1>
      
      <div class="salutation">Hello ${recipientName},</div>
      <p>
        This is an official communication broadcast regarding the ongoing <strong>TE Connectivity post-merger integration process</strong>.
      </p>
      
      <div class="message-block">
        ${body.replace(/\n/g, '<br>')}
      </div>
      
      <p>
        Please log into the M&A Integration Portal using your secure system Single Sign-On (SSO) credentials to review related milestones, complete required training modules, and track integration timelines.
      </p>
      
      <div style="text-align: center;">
        <a href="${PUBLIC_BASE_URL}/" class="cta-button">Launch Integration Workspace</a>
      </div>
    </div>
    <div class="email-footer">
      <p>
        <strong>Sender:</strong> ${sender} (${senderRole.toUpperCase()}) | <strong>Date:</strong> ${currentDate}
      </p>
      <p style="margin-top: 0.5rem;">
        This email was programmatically compiled and dispatched by the TE Connectivity Integration Management Office (IMO) System.
      </p>
      <p>
        CONFIDENTIALITY NOTICE: This message contains confidential information intended solely for the recipient's internal integration coordination purposes.
      </p>
      <div class="footer-links">
        <a href="${PUBLIC_BASE_URL}/">PMO Workspace</a> &bull; 
        <a href="${PUBLIC_BASE_URL}/playbook.html">M&A Playbook</a> &bull; 
        <a href="${PUBLIC_BASE_URL}/dashboard.html">Integration Leader Console</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Fallback for SPA routing/direct URLs
app.get('*', (req, res, next) => {
  // Unknown API routes get a real 404 (not the HTML fallback)
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Let express static handle real files
  const fileExt = path.extname(req.path);
  if (fileExt) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Final error handler — log server-side, return a generic message without internal details
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Keep the single process alive on unexpected errors rather than crashing silently.
// NOTE: for a supervised production deploy, switch uncaughtException to log-then-exit
// and let the supervisor (systemd/PM2/container) restart — resuming after an uncaught
// exception leaves the process in an undefined state. Left as log-only here so the
// unsupervised local/demo launcher doesn't die on a transient error.
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));

// Requireable-module refactor (Phase 2, AUTH-01 prerequisite): binding a real
// listener is now guarded behind direct invocation (`node server.js`) so a
// test file can `require('../server.js')` and drive the app object against an
// ephemeral port without colliding with a real running server. `node
// server.js` — every launcher, every deployment — is unaffected: this branch
// still runs exactly as before whenever the file is the process entry point.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`TE Connectivity M&A Portal server running on port ${PORT} (${PUBLIC_BASE_URL})`);
  });

  // Bound how long a single request may hold a socket — mitigates slow-request /
  // slowloris resource exhaustion. headersTimeout must exceed requestTimeout.
  server.requestTimeout = 60000;   // 60s to receive the full request body
  server.headersTimeout = 65000;   // 65s to receive the request headers
  server.keepAliveTimeout = 61000;

  // Graceful shutdown: stop accepting new connections and let in-flight requests
  // finish before exiting (so a deploy/restart doesn't drop live requests), with a
  // hard fallback so a stuck connection can't block shutdown forever.
  function shutdown(signal) {
    console.log(`${signal} received — shutting down gracefully...`);
    server.close(() => { console.log('HTTP server closed.'); process.exit(0); });
    setTimeout(() => { console.error('Forced shutdown after timeout.'); process.exit(1); }, 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
// Exposed alongside app so test/role-enforcement.test.js can unit-check the
// ROLE_WRITE_POLICY capability check directly, without needing to boot the
// HTTP server for the pure-function cases (AUTH-02).
module.exports.roleAllowedForWrite = roleAllowedForWrite;
// Exposed alongside app for the same reason (ISO-02): lets a test unit-check
// isDemoOnlyPath()/DEMO_ONLY_PREFIXES directly against the live route
// inventory without booting the HTTP server for every case.
module.exports.isDemoOnlyPath = isDemoOnlyPath;
module.exports.DEMO_ONLY_PREFIXES = DEMO_ONLY_PREFIXES;
