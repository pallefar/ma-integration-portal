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
// D-10-05 (Phase 10): the single password-hashing module — login and
// change-password verify/hash only through it (self-describing scrypt hashes,
// legacy hashes still verify).
const passwords = require('./lib/passwords');
const { createThrottle } = require('./lib/loginThrottle');
const { createLockdown, lockdownMiddleware } = require('./lib/credentialLockdown');
const { pathForms } = require('./lib/requestPath');
const readPolicy = require('./lib/readPolicy');
const { createDenialAuditor } = require('./lib/denialAudit');
const { projectDealForRole, projectDealsForRole } = require('./lib/dealProjection');
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
// SYN-01/D-25: captured (not side-effect-only) — the phasing sub-route
// handler below reuses isValidMonth() rather than duplicating the month
// shape check, so a malformed :month path param is rejected with the SAME
// validation the schema layer uses, before the row-lookup 404 ever runs.
const workstreamValidators = require('./validators/workstream');
require('./validators/cms'); // ditto
require('./validators/people'); // ditto
require('./validators/assessment'); // ditto
require('./validators/settings'); // ditto
require('./validators/dd'); // ditto
require('./validators/users'); // ditto (D-10-03 admin user management + own-session end)
const orgValidators = require('./validators/org'); // provides ORG_STATE_CURRENT/ORG_STATE_TARGET below, plus its own registerSchema() side effect
const wizardValidators = require('./validators/wizard'); // provides DEAL_SETUP_STEPS below, plus its own registerSchema() side effect
// RPT-01 (07-01): GET /api/reports/export is a READ route, so it is outside
// validators/index.js's write-only WRITE_SCHEMAS pipeline — it validates its
// own dataset/format query parameters directly with zod (07-RESEARCH.md's
// Supporting Stack: "every existing write/query-validated route in this
// codebase already uses zod; export routes should follow the same VAL-01
// discipline even though they are reads"). reportCsv/reportFilename are the
// two new lib/ modules this plan's Task 1 builds.
const { z } = require('zod');
const reportCsv = require('./lib/reportCsv');
const reportFilename = require('./lib/reportFilename');
// Quick task 260810-e1j: the steerco pack module is deliberately NOT required
// here. It pulls in @napi-rs/canvas, whose skia binding is vendored in the
// committed node_modules tree for four platforms only (darwin-arm64,
// darwin-x64, linux-x64-gnu, win32-x64-msvc) — a load-time failure on any
// other host would abort this entire module's require, i.e. the whole
// portal's boot, over one route. It is acquired lazily, on first request, by
// getReportPack() next to the pack route below.

// [security] D-10-01 (Phase 10): MA_MODE=real prepares its own gitignored,
// 0700 data directory (account-less control.db + demo.db copy) HERE — before
// `app` exists and before any database is opened — so no code path can reach a
// committed data/*.db first. A no-op outside real mode. See db/dbFiles.js for
// the full mode contract.
require('./db/realDataDir').ensureRealDataDir();

// [security] D-12-03 / PD-6 / PD-27 (Phase 12): boot-time database readiness.
// A database that fails its migration or PRAGMA quick_check throws a
// DbNotReadyError from db/dbFiles.js openDbFile() and is refused (sticky) until
// restart. `bootOpen` wraps each require-time open: it catches ONLY that error,
// logs the reason (never a path or a deal id) and lets the process reach
// listen() so GET /healthz can report not-ready (503) and every request that
// needs the refused file fails closed. Every other error still throws exactly
// as before.
const readiness = require('./db/readiness');
function bootOpen(label, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof readiness.DbNotReadyError) {
      console.error(`[readiness] ${label} not ready: ${e.reason}`);
      return undefined;
    }
    throw e;
  }
}

const app = express();
// [security] CR-01 (Phase 10 review): Express matches routes case-INsensitively
// by default, while every path-prefix policy table in this file is written in
// lowercase — so `/api/Admin/users` used to reach the admin handler with the
// gate's `/api/admin` role check skipped. Routing is made case-sensitive here,
// BEFORE the first app.use() (Express builds its router lazily on the first
// middleware and reads this setting only then). The gate additionally evaluates
// every policy against all canonical spellings (lib/requestPath.js), so the two
// layers fail closed independently. `strict routing` stays OFF on purpose: a
// trailing-slash variant still dispatches, and is covered because pathForms()
// strips the trailing slash before any table is consulted.
app.set('case sensitive routing', true);
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

// [security] D-10-06 / T-10-55: with TRUST_PROXY unset, a reverse proxy's own
// address is every user's "source" — so the per-source sign-in limit would be
// shared by the whole team. The signal is a https PUBLIC_BASE_URL at boot, or
// (at runtime, once per process) a request that carries forwarded headers: with
// TRUST_PROXY unset Express's req.secure can never become true through a proxy,
// so the forwarded headers are the observable evidence. One warning per
// process, shared by both triggers.
const SHARED_SOURCE_WARNING =
  '[security] PUBLIC_BASE_URL is https but TRUST_PROXY is unset — behind a reverse proxy every user arrives ' +
  "from the proxy's address, so the per-source sign-in limit is shared by the whole team. " +
  "Set TRUST_PROXY to the proxy hop count.";
let _sharedSourceWarned = false;
function warnSharedSourceOnce() {
  if (_sharedSourceWarned) return;
  _sharedSourceWarned = true;
  console.warn(SHARED_SOURCE_WARNING);
}
if (!process.env.TRUST_PROXY && /^https:\/\//i.test(PUBLIC_BASE_URL)) warnSharedSourceOnce();
app.use((req, res, next) => {
  if (!_sharedSourceWarned && !process.env.TRUST_PROXY &&
      (req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto'])) {
    warnSharedSourceOnce();
  }
  next();
});

app.use(compression());

// --- Security response headers -----------------------------------------------
// Behaviour-preserving hardening: no dependency, applied to every response
// (static assets + API). The CSP keeps 'unsafe-inline'/'unsafe-eval' because the
// app relies on inline scripts/styles and the vendored Transformers.js WASM
// runtime; it still blocks external script injection, arbitrary data exfil
// (connect-src), object/embed, base-tag hijack, framing and form hijack.
app.disable('x-powered-by');
// [security] SAFE-06 / D-13-05: the page CSP is BUILT per request from the admin
// egress switch (lib/egress.js, runtime.db, re-read on PRAGMA data_version so a
// toggle reaches every process on its next request) by lib/csp.js. Real mode
// defaults every channel OFF, so no third-party origin appears in any directive
// unless an admin switched that channel on; dev/demo default to today's origins.
const egress = require('./lib/egress').createEgress({
  version: () => controlStore.runtimeDataVersion(),
  isReal: dbFiles.IS_REAL_MODE,
  read: () => controlStore.getEgressSettings(),
  write: (patch) => controlStore.setEgressSettings(patch),
});
const csp = require('./lib/csp');
aiService.setEgressCheck(() => egress.allows('gemini'));
const EGRESS_DISABLED_MESSAGE = 'This feature is switched off by your administrator.';
app.use((req, res, next) => {
  const cspHeaders = csp.headersFor({ egress: egress.current() });
  for (const name of Object.keys(cspHeaders)) res.setHeader(name, cspHeaders[name]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // HSTS is only meaningful behind TLS (terminated by the reverse proxy in the
  // internal deployment); enable it explicitly so the plain-HTTP local demo is
  // unaffected. [security] D-10-06: the subdomain directive is OPT-IN
  // (HSTS_INCLUDE_SUBDOMAINS=1) — on a shared corporate parent domain it would
  // pin every sibling host to https for a year, which is the operator's call.
  // The session cookie's Secure attribute is NOT tied to this flag (see
  // isSecureCookieContext below).
  if (process.env.ENABLE_HSTS === '1') {
    let hsts = 'max-age=31536000';
    if (process.env.HSTS_INCLUDE_SUBDOMAINS === '1') hsts += '; includeSubDomains';
    res.setHeader('Strict-Transport-Security', hsts);
  }
  next();
});

// [security] CR-01: an /api request spelled with a non-canonical mount segment
// (`/API/...`, `/Api/...`, `//api/...`, `/%61pi/...`) never reaches the
// consolidated /api gate (its mount is case-sensitive now) — answer a plain
// JSON 404 here instead of letting it fall through to static/SPA handling, so
// no such spelling can ever be served by anything.
app.use((req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  const r = pathForms(req.path);
  const forms = r.ok ? r.forms : [String(req.path).toLowerCase().replace(/\/{2,}/g, '/')];
  if (forms.some((f) => f === '/api' || f.startsWith('/api/'))) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

// [security] D-10-08b / T-10-34 (plan 10-05): demo-credential lockdown. In
// real-deal mode, if any enabled account still verifies a published demo
// password (a hand-copied committed control.db, or an account edited into that
// state), the server serves only the login page + its assets, /api/auth/* and
// /healthz until every offender has changed its password. The scan runs HERE,
// synchronously, before the app can serve its first request; the middleware is
// mounted before the body parsers, '/' and express.static so nothing is
// reachable around it. The static allowlist lives only in
// lib/credentialLockdown.js (LOCKDOWN_STATIC_ALLOWLIST).
const credentialLockdown = createLockdown({ enabled: dbFiles.IS_REAL_MODE });
if (dbFiles.IS_REAL_MODE) {
  // [security] T-12-56: if control.db is not ready (a failed migration or
  // integrity check, D-12-03) this scan cannot run — safe, because every
  // session, login and API path needs control.db and fails closed with it
  // (asserted by test/schema-migrations.test.js). The boot continues so
  // /healthz can report the failure.
  bootOpen('control-lockdown-scan', () => credentialLockdown.scanAccounts(
    controlStore.listUsers(), passwords.verifyPasswordSync, passwords.KNOWN_DEMO_PASSWORDS
  ));
  if (credentialLockdown.isActive()) {
    console.warn(
      '[security] CREDENTIAL LOCKDOWN — these accounts still accept a published demo password: ' +
      credentialLockdown.offenders().join(', ') + '. The server serves only the login page, /api/auth/* and /healthz ' +
      'until each has changed its password: sign in as each account and change the password, or start from a fresh ' +
      'data directory (empty MA_DATA_DIR) and run scripts/bootstrap-admin.js.'
    );
  }
}
// D-11-05: a refusal here (every non-allowlisted path while the lockdown is
// active) is a `credential-lockdown` denial — anonymous (no identity is
// resolved before this point), rate-bounded by the same auditor as the gate.
app.use(lockdownMiddleware(credentialLockdown, (req, status) => recordDenial(req, status, 'credential-lockdown')));

// [security] SAFE-07 / D-13-06 (a) / T-13-30 (R1-14): no /api response is ever
// stored by a browser — not in the HTTP cache and not in the back/forward
// cache. An MNPI page must not be restorable on a shared workstation after
// logout. The header is set HERE, before any body parser, so a parser's own 400
// (malformed JSON) and 413 (oversized body) answers carry it too, and so every
// later status (401/403/404/409/500/503) inherits it without per-route edits;
// the explicit `res.set('Cache-Control', 'no-store')` sites further down stay
// (a no-op re-set). The prefix match is the canonical `/api` form exactly as the
// CR-01 guard above: non-canonical spellings were already answered 404 there.
// Closes 12-CARRY-INS row 4 (per-caller ETag without Cache-Control).
app.use((req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
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
//
// QUAL-01 / D-12-07 (Phase 12, plan 12-03): content-hash cache-bust stamps.
// Every HTML response is rewritten at serve time so each local /js|/css
// reference carries `?v=<first 16 hex of sha256(the bytes served at that URL)>`
// (transitive through JS that itself references stamped assets). The hand
// stamps in the source files are overwritten, never trusted. lib/assetStamp.js
// has the contract; the mtime+size cache keeps the per-request cost to stats.
// The stamper hangs off `app` (not module.exports — the export tail is a shared
// merge surface) and every call below goes through `app.assetStamper` at
// request time, so the cache-bust test can swap in an identity stamper to build
// its negative control (the invariant must FAIL when the rewrite is removed).
const { createAssetStamper } = require('./lib/assetStamp');
const ASSET_STAMP_PUBLIC_DIR = path.join(__dirname, 'public');
app.assetStamper = createAssetStamper({ publicDir: ASSET_STAMP_PUBLIC_DIR });

/** Send an HTML file with its js/css references content-hash stamped. HTML is always revalidated. */
function sendHtml(res, filePath) {
  const html = app.assetStamper.rewriteHtml(fs.readFileSync(filePath, 'utf8'));
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.send(html);
}

/** Decode + validate a request path into an absolute file strictly inside public/, or null. */
function publicFileForRequest(reqPath) {
  let decoded;
  try { decoded = decodeURIComponent(reqPath); } catch (e) { return null; }
  if (decoded.indexOf('\0') !== -1 || decoded.indexOf('\\') !== -1) return null;
  const segs = decoded.split('/');
  // Dotfiles/dot-directories and traversal segments stay with express.static's own policy.
  if (segs.some((s) => s === '..' || (s.length > 0 && s[0] === '.'))) return null;
  const abs = path.resolve(ASSET_STAMP_PUBLIC_DIR, '.' + decoded);
  if (abs !== ASSET_STAMP_PUBLIC_DIR && !abs.startsWith(ASSET_STAMP_PUBLIC_DIR + path.sep)) return null;
  return abs;
}

app.get('/', (req, res) => {
  sendHtml(res, path.join(ASSET_STAMP_PUBLIC_DIR, 'overview.html'));
});

// HTML entry points (every public/**/*.html except vendored code): served
// through sendHtml() so the stamps are the content hash of what is served.
// Mounted AFTER the credential-lockdown gate (T-12-22) and the dedicated
// /uploads/slides mount (SAFE-03; defined just above the middleware itself),
// and BEFORE express.static, which keeps serving everything else.
//
// [security] WR-B01 (12-REVIEW-B): TERMINAL for every request whose path is, or
// normalises to, an `.html` path. express.static (`send`) normalises dot
// segments and duplicate slashes itself, so a raw `/x/../index.html` or
// `/vendor/../execution.html` that this middleware merely passed on was served
// from disk with the stale hand stamps. Now: a NON-CANONICAL spelling (dot
// segments, duplicate slashes, percent-encoded `.`/`/`/`\`, NUL/backslash, an
// undecodable escape) is answered 404 here and never reaches express.static; a
// canonical one is either stamped by sendHtml() or — only when it names no
// file (or a vendored /vendor/ file, which is never rewritten) — passed on with
// a path express.static resolves identically.
function htmlRequestVerdict(rawPath) {
  const raw = String(rawPath || '');
  let decoded = null;
  try { decoded = decodeURIComponent(raw); } catch (e) { decoded = null; }
  const htmlish = (s) => typeof s === 'string' && /\.html$/i.test(s);
  const normalised = decoded === null ? null : path.posix.normalize(decoded);
  if (!htmlish(raw) && !htmlish(decoded) && !htmlish(normalised)) return { html: false };
  if (decoded === null || decoded.indexOf('\0') !== -1 || decoded.indexOf('\\') !== -1) return { html: true, canonical: false };
  if (/%(?:2e|2f|5c)/i.test(raw)) return { html: true, canonical: false };
  if (normalised !== decoded || decoded.split('/').some((s) => s === '.' || s === '..')) return { html: true, canonical: false };
  return { html: true, canonical: true, path: decoded };
}

// [security] SAFE-03 / D-13-04 (b) / R1-04 / T-13-20 / T-13-26 (plan 13-03):
// admin-uploaded slides are untrusted markup. They are served ONLY from this
// dedicated mount, which sets the sandbox CSP (opaque origin, no network, no
// portal cookies — even when the URL is opened top-level) and nosniff. It MUST
// precede the terminal `.html` middleware below: that middleware answers every
// canonical `*.html` file under public/ through sendHtml() with the app CSP, so
// in the DEFAULT configuration (MA_SLIDES_UPLOAD_DIR unset -> public/uploads/
// slides) a mount placed after it would never see a slide (plan-check B-1).
// The mount is TERMINAL for its prefix (the trailing handler answers 404), so
// neither sendHtml nor the public express.static can serve a slide path — which
// also stops legacy files left in public/uploads/slides from being served
// unsandboxed when MA_SLIDES_UPLOAD_DIR points elsewhere. Routing here is
// case-sensitive (`case sensitive routing`), so the mount answers only the exact
// `/uploads/slides` spelling: any other spelling of the prefix (case variants,
// percent-encoded, dot segments, duplicate slashes) is answered 404 by the guard
// below and can never reach sendHtml or the public express.static — on a
// case-insensitive filesystem `/UPLOADS/Slides/x.html` would otherwise resolve to
// the same file with the app CSP.
const slideUpload = require('./lib/slideUpload');
const SLIDE_URL_PREFIX_RE = /^\/uploads\/slides(?:\/|$)/i;
const SLIDE_MOUNT_PREFIX_RE = /^\/uploads\/slides(?:\/|$)/;
const slideNotFound = (req, res) => res.status(404).type('text/plain').send('Not found');
app.use((req, res, next) => {
  if (SLIDE_MOUNT_PREFIX_RE.test(req.path)) return next();
  let decoded;
  try { decoded = decodeURIComponent(req.path); } catch (e) { return next(); }
  if (SLIDE_URL_PREFIX_RE.test(req.path) || SLIDE_URL_PREFIX_RE.test(decoded) ||
      SLIDE_URL_PREFIX_RE.test(path.posix.normalize(decoded))) return slideNotFound(req, res);
  return next();
});
app.use('/uploads/slides', (req, res, next) => {
  // Only the allowlisted slide extensions are ever served from this prefix.
  let decoded;
  try { decoded = decodeURIComponent(req.path); } catch (e) { return slideNotFound(req, res); }
  if (!slideUpload.servableExt(path.extname(decoded))) return slideNotFound(req, res);
  return next();
});
app.use('/uploads/slides', express.static(slideUpload.slidesDir(), {
  dotfiles: 'deny',
  index: false,
  redirect: false,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    // Later report-only CSP phases must not need to know about slides.
    res.removeHeader('Content-Security-Policy-Report-Only');
    // PD-17: a PDF cannot render in a sandboxed document; it keeps the app CSP
    // + nosniff + the magic-byte check done at upload.
    if (slideUpload.sandboxedExt(path.extname(filePath))) {
      res.setHeader('Content-Security-Policy', slideUpload.SLIDE_SANDBOX_CSP);
    }
  }
}));
app.use('/uploads/slides', slideNotFound);

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  // [security] SAFE-03 / B-1: slide paths belong to the dedicated mount above
  // (defence in depth — sendHtml/rewriteHtml must never touch slide bytes).
  if (SLIDE_URL_PREFIX_RE.test(req.path)) return next();
  const v = htmlRequestVerdict(req.path);
  if (!v.html) return next();
  if (!v.canonical) return res.status(404).type('text/plain').send('Not found');
  if (/^\/vendor\//i.test(v.path)) return next(); // vendored code: served as-is, never rewritten
  const abs = publicFileForRequest(v.path);
  if (!abs) return res.status(404).type('text/plain').send('Not found');
  let st;
  try { st = fs.statSync(abs); } catch (e) { return next(); }
  if (!st.isFile()) return next();
  return sendHtml(res, abs);
});

// JS/CSS that themselves reference stamped assets (transitions.js -> account-
// menu.js, inline-edit.js, banners.js, deal-switcher.js; account-menu.js ->
// account.css) are served with those references rewritten, so a changed
// dependency changes the dependant's own stamp (transitive). Only a file whose
// bytes actually change is answered here; every other asset falls through to
// express.static unchanged.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!/^\/(?:js|css)\//.test(req.path) || !/\.(?:js|css)$/.test(req.path)) return next();
  let decoded;
  try { decoded = decodeURIComponent(req.path); } catch (e) { return next(); }
  const out = app.assetStamper.rewriteAsset(decoded);
  if (!out || out.rewritten !== true) return next();
  const mime = express.static.mime;
  const type = mime.lookup(decoded);
  const charset = mime.charsets.lookup(type);
  res.set('Content-Type', charset ? type + '; charset=' + charset : type);
  res.set('Cache-Control', 'public, max-age=2592000');
  return res.send(out.body);
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
// [security] D-10-06 / T-10-37: the old boot line claimed the write/admin API
// was OPEN when ADMIN_TOKEN was unset — false since Phase 2 (a session is
// mandatory). The only truthful thing to say is when the token IS set: it is a
// shared break-glass secret that acts as the attributed 'admin-token' admin.
if (ADMIN_TOKEN) {
  console.warn("[security] ADMIN_TOKEN is set — any request carrying this X-Admin-Token acts as the attributed 'admin-token' admin identity. Prefer per-person accounts (scripts/bootstrap-admin.js, admin console Users tab).");
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

// isOpenMode(req) is the ONE seam that decides whether this request may skip
// the session gate entirely (D-02, the demo showcase). D-03 (Phase 3):
// `req.isDemo` is set by db/resolver.js's dealResolverMiddleware BEFORE this
// function is ever consulted (the consolidated gate below resolves the
// database first, then checks isOpenMode) — so a session bound to a REAL
// deal is NEVER open, regardless of this env flag. Only an unauthenticated
// request (which always resolves to demo.db, since it carries no deal
// binding) or a session explicitly bound to demo can ever pass this check.
// [security] D-10-01: real-deal mode is NEVER open — dbFiles already refuses to
// boot with MA_MODE=real + DEMO_OPEN=1; this is defence in depth should the
// env be mutated at runtime.
function isOpenMode(req) {
  return !dbFiles.IS_REAL_MODE && process.env.DEMO_OPEN === '1' && req.isDemo === true;
}

// The only /api paths reachable without a session — auth bootstrapping itself
// cannot require a session to exist first. /auth/mode (D-10-01/D-10-08) is the
// unauthenticated mode probe the login page reads before any session exists.
const PUBLIC_API_PATHS = new Set(['/auth/login', '/auth/logout', '/auth/me', '/auth/mode']);

// [security] D-10-05: the ONLY gated /api path a session with
// mustChangePassword may use (full '/api/...' form, as the consolidated gate
// reconstructs it). The public auth paths above (me/logout/mode/login) never
// reach the gate at all; everything else answers 403 {mustChangePassword:true}.
const MUST_CHANGE_ALLOWED_PATHS = new Set(['/api/auth/change-password']);

// Extracts the raw opaque session token from the `ma_session` cookie (replaces
// the previous HMAC payload decode — the token itself carries no data; it is
// looked up against the sessions table).
function readSessionCookie(req) {
  const cookies = String(req.headers.cookie || '');
  const m = cookies.match(/(?:^|;\s*)ma_session=([^;]+)/);
  return m ? m[1] : null;
}

// [security] D-10-04 / COLLAB-02 (T-10-14): resolve a session cookie to the
// caller's CURRENT identity. The sessions table's `role` column is the value
// snapshotted at login and is NEVER trusted for authorization — role and
// disabled state are re-read from the control.db account on EVERY request
// (one indexed PK SELECT, a <= ~50-row table), so an admin's role change or
// disable binds on the user's very next request with no re-login. A missing or
// disabled account revokes every session of that username immediately.
// Returns null (anonymous) when there is no live, enabled account behind the
// cookie; `mustChangePassword` is carried for the D-10-05 gate (plan 10-05).
function resolveSessionIdentity(cookieToken) {
  if (!cookieToken) return null;
  const runtimeConn = getRuntimeConnection();
  const sess = sessions.findSession(runtimeConn, cookieToken);
  if (!sess) return null;
  const acct = controlStore.getAccount(sess.username);
  if (!acct || acct.disabled === true) {
    sessions.deleteAllSessionsForUser(runtimeConn, sess.username);
    return null;
  }
  return {
    username: acct.username,
    role: acct.role,
    name: acct.name || acct.username,
    sessionId: sess.sessionId,
    dealId: sess.dealId,
    mustChangePassword: acct.mustChangePassword === true,
  };
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

  // [security] D-11-02 / AUTHZ-02 (Phase 11; R1-05, R1-16, R3 F-1): the
  // instance CONFIGURATION and CONTENT surface is admin-only. These routes
  // were silently inheriting DEFAULT_WRITE_ROLES, so any pmo/hrbp session
  // could flip demoMode, set geminiApiKey (third-party egress) or rewrite
  // menus/pages/banners for every user of the instance. The deal-level
  // values an Integration Lead legitimately edits (currency, Day-1 date,
  // synergy target/staleness/horizon) live on POST /api/deals/:id/setup
  // instead. Placed ahead of the self-service and default entries
  // (first-match wins); each rule is boundary-safe, so /api/settings also
  // covers /api/settings/new-ma, /api/slides covers /api/slides/upload and
  // /api/courses covers /api/courses/:courseId/lessons*.
  //
  // The demo time-travel control is the ONE settings sub-route staff keep —
  // it is a showcase-only mechanic already refused outside the demo store by
  // DEMO_ONLY_PREFIXES, so this entry leaves the demo exactly as it was.
  // It must precede the admin-only '/api/settings' rule below.
  { prefix: '/api/settings/time-travel', exact: true, methods: ['POST'], roles: ['admin', 'hrbp', 'pmo'] },
  { prefix: '/api/settings', roles: ['admin'] },
  { prefix: '/api/menus', roles: ['admin'] },
  { prefix: '/api/pages', roles: ['admin'] },
  { prefix: '/api/banners', roles: ['admin'] },
  { prefix: '/api/slides', roles: ['admin'] },
  { prefix: '/api/media', roles: ['admin'] },
  { prefix: '/api/i18n', roles: ['admin'] },
  { prefix: '/api/courses', roles: ['admin'] },

  // Self-service allowlist: the ONLY prefixes 'employee' may write to today.
  { prefix: '/api/pulses', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/employees/complete-lesson', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/employees/uncomplete-lesson', roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  // [security] D-11-04 / AUTHZ-04 (R3 F-2): get-or-create was a GET (so it
  // bypassed this table and validationMiddleware) reachable by every role; it
  // is now an exact, POST-only self-service rule — no widening, and no other
  // method or sibling path inherits it. The handler scopes what a role the
  // read policy refuses /api/employees can actually resolve (own record only).
  { prefix: '/api/employees/get-or-create', exact: true, methods: ['POST'], roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  // Boundary-safe AND POST-only: covers only `POST /api/assessment` (own
  // submission) and `POST /api/assessment-instances` (self-submission).
  // `DELETE /api/assessments/:id` and `DELETE /api/assessment-instances/:id`
  // do not match `methods: ['POST']` here, and no other rule below matches
  // them either, so both fall through to DEFAULT_WRITE_ROLES (CR-01).
  { prefix: '/api/assessment', exact: true, methods: ['POST'], roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/assessment-instances', exact: true, methods: ['POST'], roles: ['admin', 'hrbp', 'pmo', 'employee'] },
  { prefix: '/api/auth/change-password', roles: ['admin', 'hrbp', 'pmo', 'employee'] }, // D-09: every role may change their OWN password
  { prefix: '/api/auth/sessions', roles: ['admin', 'hrbp', 'pmo', 'employee'] }, // D-10-07: every role manages its OWN sessions (handlers are keyed by the caller's username)

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
  // communications, alerts, questions, hrbps, dashboard/reorder-widgets) —
  // no explicit entry needed; falls through to DEFAULT_WRITE_ROLES below.
  // (The CMS and settings groups are NOT in that list any more: D-11-02 made
  // them admin-only, see the rules at the top of this table.)
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

// [security] D-06/CONC-01 (Phase 8): the SINGLE definition of "this error is
// SQLite write-lock contention" — used by the central 503 error middleware
// below, and (D-09's scope) by every local try/catch re-throw guard a later
// plan (08-03) adds. A prefix test (startsWith), not an equality test, so the
// WAL-specific extended code SQLITE_BUSY_SNAPSHOT (raised when a read
// transaction tries to upgrade to a write transaction after another
// connection already committed — RESEARCH.md Pitfall 5) is also caught, not
// just the plain SQLITE_BUSY code. Checks `err.code`, NEVER `err.message` —
// message text is not a stable contract and other SqliteErrors can leak
// internal detail (file paths, table names) that must never reach a client.
function isBusyError(err) {
  return !!(err && typeof err.code === 'string' && err.code.startsWith('SQLITE_BUSY'));
}

// [security] CONC-02 (Phase 9, PD-3): the SINGLE 409 conflict-body builder —
// direct sibling of isBusyError()'s single-definition discipline above.
// Fixed shape, nothing else: never echoes err.message, a stack, a file path
// or a SQL string (the T-08-01 generic-safe-body precedent). `conflict: true`
// is the discriminating marker the client checks — NEVER the status code
// alone, because two unrelated 409s already exist elsewhere in this file
// (the empty-deal steerco-pack refusal and the unrecognized-synergy-stage
// refusal, 09-RESEARCH.md Pitfall 1). `currentRecord` may already have been
// passed through an area-clearance filter by the caller (see
// conflictIfStale()'s `clearanceFilter` option below) before it reaches here.
function conflictBody(detail) {
  return {
    conflict: true,
    conflictKind: detail.conflictKind,
    recordId: detail.recordId,
    currentRecord: detail.currentRecord || null,
    currentVersion: detail.currentVersion !== undefined ? detail.currentVersion : null,
    changedBy: detail.changedBy || null,
    changedAt: detail.changedAt || null,
  };
}

// [security] CONC-02 gap closure (Phase 9, plan 09-08, R7 F-1, T-09-36/T-09-37):
// the fixed message of the `versionRequired` 400. A write or delete of an
// EXISTING versioned record that carries no precondition at all cannot be
// judged stale, so it is refused rather than treated as "no check" (R1-11).
// The body is exactly `{ error, versionRequired: true }` — never the record,
// its version or its attribution — so a refused caller learns nothing it did
// not already hold.
const VERSION_REQUIRED_MESSAGE = 'This save did not include the version of the record it was based on. Reload the page and try again.';

// [security] CONC-02 (Phase 9, Plan 02): the SINGLE input-resolution helper
// for the version precondition — reads `req.body.version` when present (the
// JSON-body routes this plan and plan 01 wire), and falls back to
// `req.query.expectedVersion` when it is not, so the same contract also
// covers body-less DELETE-shaped routes (starting with
// `DELETE /api/synergies/:id/cost-entries/:eid` in this plan). There is no
// query-schema validation mechanism in validators/index.js — it validates
// `req.body` only (see `validationMiddleware` there) — so the bounds check
// on the query-channel form lives HERE, the one place both `conflictIfStale`
// call shapes go through, rather than being duplicated per route. A query
// value that is not a non-negative integer is flagged `invalid: true` and
// NEVER coerced — no `parseInt` fallthrough to `NaN`, no silent truncation
// of a decimal or a leading/trailing-junk string like "3abc". `conflictIfStale`
// turns `invalid: true` into a 400 before any record is mutated.
//
// IN-03 (09-REVIEW round 2): a request that carries BOTH channels with
// values that disagree is refused (`mismatch: true` -> 400) rather than
// silently letting the body win — otherwise a DELETE sent with a stale JSON
// body `version` would override a fresh `?expectedVersion=`, and the
// dialog's reapply (which rewrites the version it finds) could loop on
// "the record changed again" forever. Both channels agreeing is accepted.
function parseExpectedVersion(req) {
  const b = req.body || {};
  const q = req.query && req.query.expectedVersion;
  if (b.version !== undefined) {
    if (q !== undefined && !(typeof q === 'string' && /^\d+$/.test(q) && Number(q) === b.version)) {
      return { version: undefined, invalid: false, mismatch: true };
    }
    return { version: b.version, invalid: false };
  }
  if (q === undefined) return { version: undefined, invalid: false };
  if (typeof q !== 'string' || !/^\d+$/.test(q)) return { version: undefined, invalid: true };
  const n = Number(q);
  if (!Number.isInteger(n) || n < 0) return { version: undefined, invalid: true };
  return { version: n, invalid: false };
}

// CONC-02 (Phase 9): the single optimistic-locking gate every versioned
// write route passes through. It owns two layers of the contract, in order:
//
//   1. Route-level precondition (PD-2, this function). A fast, informative
//      409 in the common single-process case, judged against THIS request's
//      own freshly-read `record`. It is never a substitute for the
//      WHERE-clause layer in db/store.js's writeDb(), which is the one that
//      is actually race-free against Phase 8's multi-process model
//      (09-RESEARCH.md Pattern 2) — the two layers are deliberately both
//      kept.
//   2. The precondition RULE (GD-1/GD-1a/GD-1b/GD-2, D-02, D-06): an update
//      or delete of an EXISTING record (`record` truthy) that supplies NO
//      precondition — neither `req.body.version` nor
//      `req.query.expectedVersion`, resolved by parseExpectedVersion() above
//      — is refused 400 `{ error, versionRequired: true }`, because a write
//      that names no version cannot be judged stale. There is no per-route
//      opt-in or opt-out: the rule is unconditional and lives only here, so
//      every current and future versioned route inherits it. The structural
//      Part 1 gate in test/optimistic-locking-contract.test.js fails the
//      suite when a versioned-lane write handler skips this function, and
//      S1 in test/optimistic-locking-precondition.test.js fails it if an
//      option ever re-introduces a per-route switch.
//
// Fail-closed demo predicate (GD-1b): only `req.isDemo === true` (set by
// db/resolver.js for the demo store) is lenient — D-09 lazy adoption keeps
// the committed demo data byte-identical. A deal-bound request OR a request
// with no resolver context at all is strict. A create (`record` falsy) is
// never refused for lacking a precondition (D-06: creates carry no version
// precondition). A missing STORED version is version 0, so a client holding
// a never-edited record sends `version: 0` and is judged like any other.
// Only exact equality passes (D-01): one version below OR above the stored
// one is a conflict.
//
// `opts.clearanceFilter` is the ONLY option. When given, it is applied to
// `record` before it is echoed into the 409 body, and it is armed on the
// request's db context (CR-01) BEFORE every return below — including the
// 400s — so the WHERE-layer conflict throw can never echo an unfiltered
// record even when the client sent no (or an invalid) version. The DD/org
// callers pass their area-clearance gates through it, so a race where the
// record's area concurrently changed to one the caller isn't cleared for
// cannot leak the full current record (09-RESEARCH.md Pattern 3). The
// arming statement must stay first; do not reorder it below a return.
//
// Returns `true` when it has already responded (caller must return early
// without mutating/writing anything further), `false` otherwise.
function conflictIfStale(req, res, record, opts) {
  const options = opts || {};
  // [security] CR-01 (09-REVIEW): arm the SAME clearance rule on this
  // request's db context so db/store.js's WHERE-layer conflict throw — the
  // race-free layer that fires when this precheck passed but another
  // process committed in between — echoes exactly what this precheck would
  // have echoed, never the unfiltered stored record. Armed before the
  // early returns: the WHERE layer can conflict even when the client sent
  // no version at all.
  if (options.clearanceFilter) {
    const dbCtx = currentDbContext();
    if (dbCtx) {
      dbCtx.areaClearanceFilter = function (collectionKey, rec) {
        return options.clearanceFilter(rec);
      };
    }
  }
  const parsed = parseExpectedVersion(req);
  if (parsed.invalid) {
    res.status(400).json({ error: 'expectedVersion must be a non-negative integer.' });
    return true;
  }
  if (parsed.mismatch) {
    // IN-03: a fixed one-key literal — echoes nothing about the record.
    res.status(400).json({ error: 'The version in the request body and the expectedVersion query parameter disagree.' });
    return true;
  }
  if (parsed.version === undefined) {
    if (record && req.isDemo !== true) {
      res.status(400).json({ error: VERSION_REQUIRED_MESSAGE, versionRequired: true });
      return true;
    }
    return false;
  }
  // WR-04: one coercion rule with db/store.js's WHERE layer (comparableVersion).
  const currentVersion = comparableVersion(record && record.version);
  if (parsed.version === currentVersion) return false;
  const filtered = options.clearanceFilter ? options.clearanceFilter(record) : record;
  res.status(409).json(conflictBody({
    conflictKind: 'version',
    recordId: record && record.id,
    currentRecord: filtered,
    currentVersion,
    changedBy: record ? record.updatedBy : null,
    changedAt: record ? record.updatedAt : null,
  }));
  return true;
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

// [security] CR-01: the gate's path decisions over the canonical spellings
// (`forms`, from lib/requestPath.js#pathForms) — MOST RESTRICTIVE across forms.
// One object so the regression suite (test/path-canonical-gate.test.js) loops
// over every policy table through exactly the code the gate runs.
const gatePolicy = {
  /** Allowed only if EVERY spelling is allowed (and there is at least one). */
  roleAllows(role, forms, method) {
    return forms.length > 0 && forms.every((f) => roleAllowedForWrite(role, f, method));
  },
  /** Admin-prefixed if ANY spelling is under /api/admin. */
  isAdminPath(forms) {
    return forms.some((f) => pathMatchesPrefix(f, '/api/admin'));
  },
  /** Demo-only if ANY spelling is on DEMO_ONLY_PREFIXES. */
  isDemoOnly(forms, method) {
    return forms.some((f) => isDemoOnlyPath(f, method));
  },
  /** A must-change session may proceed only if EVERY spelling is allowed. */
  mustChangeAllows(forms) {
    return forms.length > 0 && forms.every((f) => MUST_CHANGE_ALLOWED_PATHS.has(f));
  },
  /**
   * D-11-01 read policy (lib/readPolicy.js): canonical-anchored, refused if the
   * canonical path has no allowing rule OR any other ruled spelling refuses.
   */
  readAllows(role, forms, canonical) {
    return forms.length > 0 && readPolicy.readAllowsForms(role, forms, canonical);
  },
};

// [security] SAFE-06 / D-13-05 (plan 13-02, PD-15): the "AI training" PDF upload
// (POST /api/rag/upload) exists only in dev/demo. In real-deal mode the route is
// answered 404 for EVERY caller - unauthenticated included - BEFORE the /api
// gate, because an unmounted route would be answered 403 by that gate for an
// authenticated non-admin (a different, route-revealing status). Matched on
// every canonical spelling of the path (lib/requestPath.js), so `/api//rag/upload`
// style spellings cannot slip past.
app.use((req, res, next) => {
  if (!dbFiles.IS_REAL_MODE) return next();
  const r = pathForms(req.path);
  if (r.ok && r.forms.some((f) => f === '/api/rag/upload')) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

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

  // [security] CR-01: every path policy below (and db/resolver.js's
  // control-plane list) is evaluated against ALL canonical spellings of the
  // request path — see lib/requestPath.js. An ambiguous spelling (dot segment,
  // undecodable escape, backslash) has no route and is refused here.
  const shape = pathForms(req.baseUrl + req.path);
  if (!shape.ok) return res.status(404).json({ error: 'Not found' });
  req.gatePathForms = shape.forms;
  req.gatePathCanonical = shape.canonical;

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
    // D-10-04: the identity is re-resolved from control.db on every request,
    // never trusted from the login-time session snapshot (see
    // resolveSessionIdentity()).
    req.portalUser = resolveSessionIdentity(readSessionCookie(req)); // may be null here — see step (c) above
  }

  // [security] D-11-05: the resolver stays audit-free (same isolation rule as
  // db/accessPolicy.js); it reports a refused deal bind through this callback.
  const onResolverDenied = (status, reason) => recordDenial(req, status, reason);
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

    if (!req.portalUser) return denyAt(req, res, 401, 'no-session', { error: 'Login required.', authRequired: true });

    // NOTE: req.path is mount-relative inside the consolidated /api gate above
    // (e.g. '/pulses', not '/api/pulses') — ROLE_WRITE_POLICY's/DEMO_ONLY_PREFIXES'
    // prefixes are written as full '/api/...' paths (matching this file's
    // route registrations 1:1), so req.baseUrl ('/api') + req.path
    // reconstructs the full path both lookups expect.
    // [security] CR-01: `forms` are the canonical spellings (lowercased,
    // decoded once, `//` collapsed, trailing slash stripped) — never the raw
    // client spelling alone. Each check takes the MOST RESTRICTIVE answer:
    // a path is allowed only if every form is allowed; it is admin-prefixed,
    // demo-only or must-change-blocked if ANY form is.
    const forms = req.gatePathForms;

    // [security] D-10-05 / T-10-27 forced rotation: a session whose account
    // still carries mustChangePassword (temporary password, admin reset, first
    // bootstrap, a demo password detected at login) may do NOTHING except
    // replace it. The client redirect (plan 10-06) is UX; THIS gate is the
    // control — so a temp password can never become a permanent working
    // credential. /auth/me, /auth/logout, /auth/login and /auth/mode are public
    // paths that returned at the top of this gate and never reach it. Placed
    // before the demo-only and role checks so no other refusal can mask it.
    if (req.portalUser.mustChangePassword === true && !gatePolicy.mustChangeAllows(forms)) {
      return denyAt(req, res, 403, 'must-change-password', {
        error: 'You must change your password before continuing.',
        mustChangePassword: true,
      });
    }

    if (gatePolicy.isDemoOnly(forms, req.method) && !req.isDemo) {
      return denyAt(req, res, 403, 'demo-only', { error: 'This showcase-only feature is unavailable inside a real deal.' });
    }

    const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    // CR-02: /api/admin/* must require the admin role for EVERY method, not
    // just writes — before this phase, admin-prefixed routes (e.g.
    // GET /api/admin/download-zip) were gated regardless of method. The
    // consolidated gate had narrowed that role check to writes only, silently
    // opening every admin-prefixed GET (source/db archive download, etc.) to
    // any authenticated non-admin session. Reads elsewhere stay gated on
    // session-existence alone (D-05) — this carve-out is admin-prefix-only.
    const requiresRoleCheck = isWrite || gatePolicy.isAdminPath(forms);
    if (requiresRoleCheck && !gatePolicy.roleAllows(req.portalUser.role, forms, req.method)) {
      return denyAt(req, res, 403, 'role-write', { error: 'Your role cannot perform this action.' });
    }
    // [security] D-11-01 / AUTHZ-01 / R1-05 (Phase 11): reads are role-gated by
    // the explicit ROLE_READ_POLICY (lib/readPolicy.js) — before this, any
    // authenticated session (a real-deal `employee` included) could read the
    // synergy financials, RAID, roster, org and DD data. GET, HEAD and OPTIONS
    // are judged as GET by the same check (T-11-06). FAIL-CLOSED: the check is
    // skipped ONLY when the request resolved to the demo store
    // (`req.isDemo === true`); a deal-bound or control-plane resolution is
    // strict, and an unlisted path has no rule and is refused. The demo store
    // stays lenient on purpose — the showcase must be unchanged (D-11-01,
    // mirrors conflictIfStale's GD-1b predicate). A fixed error string, no data.
    if (!isWrite && req.isDemo !== true
      && !gatePolicy.readAllows(req.portalUser.role, forms, req.gatePathCanonical)) {
      return denyAt(req, res, 403, 'role-read', { error: 'Your role cannot view this information.' });
    }
    // VAL-01/VAL-02: shape-validate, strip unknown keys, and sanitize
    // HTML-tagged fields — LAST in this gate, after identity resolution, the
    // deal-resolver bind, the demo-only check and the role check, so a
    // request that would be refused on any of those grounds never has its
    // payload parsed at all. validators/index.js#validationMiddleware is a
    // no-op for non-write methods (GET/HEAD/OPTIONS pass straight through).
    validators.validationMiddleware(req, res, next);
  }, onResolverDenied);
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

// D-15: re-baselining is restricted to admin and the Integration Lead
// (hrbp), enforced server-side. Mirrors isAdminRequest()'s shape — like
// POST /api/deals/:id/members above, ROLE_WRITE_POLICY's flat prefix table
// has no wildcard for "admin+hrbp+pmo on /api/synergies broadly, but
// admin+hrbp ONLY on this one dynamic-:id-segment sub-route" — so the
// narrowing lives inline, inside the handler. Deliberately does NOT honour
// the X-Admin-Token break-glass path isAdminRequest() accepts: D-15's rule
// is about an ATTRIBUTED human role, and an unattributed token would defeat
// the governance meaning of the baseline record.
// WR-01: the comment above stated the exclusion but the implementation only
// checked req.portalUser.role — the consolidated /api gate (above) sets
// req.portalUser.role === 'admin' for the X-Admin-Token break-glass path
// too (sessionId: null in that case, non-null for every real session, per
// db/sessions.js's findSession()), so the exclusion the comment promised was
// not actually enforced. Checking sessionId !== null closes that gap and
// makes the code match its own documented intent.
function isAdminOrIlRequest(req) {
  return !!(req.portalUser && req.portalUser.sessionId !== null && ['admin', 'hrbp'].includes(req.portalUser.role));
}

// [security] D-10-06 sign-in throttling (plan 10-05). Two independent,
// in-memory, bounded instances (lib/loginThrottle.js — its header comment holds
// the recovery paragraph DEPLOYMENT.md copies):
//   accountThrottle — keyed on the SUBMITTED account name ('u:<name>' for login,
//     'cp:<name>' for change-password), 5 free failures then exponential
//     backoff to 15 minutes. One user's typos cannot lock out a team behind a
//     proxy (R1-08), and the key exists whether or not the name does (T-10-30).
//   sourceThrottle — keyed on the source address ('ip:<req.ip>'), a much higher
//     ceiling (50 failures / 15 min): the guard against one host spraying many
//     names, deliberately not the primary control.
// scrypt is deliberately expensive, so both are consulted BEFORE any hashing.
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
// [security] WR-01 (Phase 10 review): ONE backoff ceiling for every account key.
// The original split (5 min for an enabled admin, 15 min for everyone else)
// made the throttle an enumeration oracle — `Retry-After: 300` vs `900`, and
// equally the moment a 429 stops, told an attacker per name "this is a live
// admin account", contradicting T-10-30. Reporting a uniform header while still
// enforcing the split would not close the second channel, so the cap itself is
// uniform: every account (known, unknown, disabled, any role) backs off to at
// most 5 minutes. T-10-55's purpose (an admin cannot be locked out for a
// quarter hour) is kept; the cost is a shorter ceiling for non-admin names,
// which still bounds a single name to ~12 guesses/hour on top of the per-source
// limit below and the password-length policy.
const ACCOUNT_MAX_BACKOFF_MS = 5 * 60 * 1000;
const ADMIN_MAX_BACKOFF_MS = ACCOUNT_MAX_BACKOFF_MS; // historical export name (T-10-55)
const accountThrottle = createThrottle({
  windowMs: THROTTLE_WINDOW_MS, freeFailures: 5, baseDelayMs: 1000,
  maxDelayMs: ACCOUNT_MAX_BACKOFF_MS, maxEntries: 10000,
});
const sourceThrottle = createThrottle({
  windowMs: THROTTLE_WINDOW_MS, freeFailures: 50, baseDelayMs: 1000,
  maxDelayMs: THROTTLE_WINDOW_MS, maxEntries: 10000,
});
// T-10-55 + WR-01: a known admin username must not be lockable for a quarter of
// an hour — and the ceiling must not depend on WHO the name is. The answer is
// deliberately independent of `account` (role, existence, disabled): the same
// options object for every name, so neither the Retry-After header nor the
// moment the 429 lifts can distinguish an enabled admin (T-10-30).
const UNIFORM_THROTTLE_OPTIONS = Object.freeze({ maxDelayMs: ACCOUNT_MAX_BACKOFF_MS });
// eslint-disable-next-line no-unused-vars
function throttleOptionsFor(account) {
  return UNIFORM_THROTTLE_OPTIONS;
}
// The submitted name goes into an operator-visible log line: strip anything a
// client could use to forge log structure, and bound the length.
function logSafe(value) {
  return String(value).replace(/[^\x20-\x7e]/g, '?').slice(0, 80);
}
function noteBackoff(result, key, req) {
  if (result && result.engaged) {
    console.warn(`[security] sign-in backoff engaged for ${logSafe(key)} from ${logSafe(req.ip || req.socket.remoteAddress || '?')}`);
  }
}
const THROTTLED_BODY = Object.freeze({ error: 'Too many sign-in attempts. Wait a moment and try again.' });
function sendThrottled(res, ...verdicts) {
  const ms = Math.max(...verdicts.map((v) => v.retryAfterMs || 0));
  res.set('Retry-After', String(Math.max(1, Math.ceil(ms / 1000))));
  return res.status(429).json(THROTTLED_BODY);
}

// [security] D-10-06 / T-10-32: the session cookie is Secure whenever the
// request itself is https (Express's req.secure, which honours TRUST_PROXY and
// X-Forwarded-Proto) or the deployment's PUBLIC_BASE_URL is https — independent
// of ENABLE_HSTS, which is only a header-policy switch. Every session-cookie header for
// the session goes through these helpers.
function isSecureCookieContext({ secure, publicBaseUrl } = {}) {
  return secure === true || /^https:\/\//i.test(String(publicBaseUrl || ''));
}
function sessionCookieAttributes(req) {
  const secure = isSecureCookieContext({ secure: req && req.secure, publicBaseUrl: PUBLIC_BASE_URL });
  return secure ? '; Secure' : '';
}
// SameSite=Strict (was Lax, D-08) — this app has no cross-site inbound-link
// flow that depends on Lax's top-level-navigation carve-out, and every write is
// already same-origin JSON fetch() (no classic <form> posts, no CORS headers
// ever set), so Strict closes the CSRF gap with no functional impact.
function sessionCookieHeader(req, token) {
  return 'ma_session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
    Math.floor(SESSION_TTL_MS / 1000) + sessionCookieAttributes(req);
}
function clearedSessionCookieHeader(req) {
  return 'ma_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + sessionCookieAttributes(req);
}

// D-10-05: async handler — scrypt now runs on the libuv threadpool
// (passwords.verifyPassword) instead of blocking the event loop. Any thrown
// error (including an isBusyError() from the control/runtime stores) is
// forwarded to next(err) so it reaches the central 503 middleware.
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    // D-01: login is now ALWAYS available (no more "disabled unless PORTAL_AUTH=1") —
    // it is the sole path into a mandatory-by-default app.
    // ISO-01 (Task 2 cutover): accounts moved OUT of the request-bound
    // readDb()/writeDb() model into control.db, reached only through
    // db/controlStore.js — a deal-bound request can never read/write the
    // account store through its own connection (T-03-16). The lookup is a PK
    // read (no scrypt); the backoff ceiling is uniform for every name
    // (throttleOptionsFor, WR-01), so the lookup no longer shapes the throttle.
    const submitted = String(username || '').trim().toLowerCase();
    const user = controlStore.findUser(submitted);
    const accountKey = 'u:' + submitted;
    const sourceKey = 'ip:' + (req.ip || req.socket.remoteAddress || '?');
    const accountVerdict = accountThrottle.check(accountKey, throttleOptionsFor(user));
    const sourceVerdict = sourceThrottle.check(sourceKey);
    if (!accountVerdict.allowed || !sourceVerdict.allowed) {
      return sendThrottled(res, accountVerdict, sourceVerdict);
    }
    // Always run one scrypt derivation (dummyVerify for unknown/disabled
    // accounts) so response time never reveals whether the username exists
    // or is enabled (T-10-08).
    let verdict = { ok: false, needsRehash: false };
    if (user && user.disabled !== true) {
      verdict = await passwords.verifyPassword(password || '', user);
    } else {
      await passwords.dummyVerify(password || '');
    }
    if (!verdict.ok) {
      noteBackoff(accountThrottle.fail(accountKey), accountKey, req);
      noteBackoff(sourceThrottle.fail(sourceKey), sourceKey, req);
      // IN-02 (Phase 10 review): no artificial delay here. The former fixed
      // 400 ms was additive (success had none), so it implied a timing
      // guarantee it never gave; the real equaliser is the one scrypt
      // derivation every attempt pays (dummyVerify above, T-10-08), and the
      // rate limit is the account/source throttle.
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    // A correct password ends the account's backoff episode; the source window
    // keeps sliding on its own.
    accountThrottle.clear(accountKey);
    // [security] D-10-08b login-time detection (real mode only): a sign-in
    // that succeeded with a PUBLISHED demo password puts the account in the
    // lockdown offender set and forces rotation, whatever the boot scan saw —
    // the 403 gate then fences the session to change-password.
    if (dbFiles.IS_REAL_MODE && passwords.isKnownDemoPassword(password)) {
      credentialLockdown.noteDemoLogin(user.username);
      controlStore.updateUser(user.username, { mustChangePassword: true });
      user.mustChangePassword = true;
    }
    // [security] D-10-05 lazy rehash: a legacy / low-cost hash is replaced with
    // the current-cost format on the first successful sign-in, BEFORE the
    // session exists. Never against the committed control.db (D-10-01: a
    // credential hash must not land in a git-tracked file). A busy lock is the
    // central 503 (nothing persisted, the client retries); any other failure
    // must not block a correct sign-in.
    if (verdict.needsRehash && !dbFiles.isCommittedControlDbActive()) {
      try {
        controlStore.updateUser(user.username, {
          hash: await passwords.hashPassword(password), salt: null,
        });
      } catch (rehashErr) {
        if (isBusyError(rehashErr)) throw rehashErr;
        console.error('[security] password rehash failed for ' + logSafe(user.username) + ': ' + logSafe(rehashErr && (rehashErr.code || rehashErr.name)));
      }
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
    sessions.recordLogin(getRuntimeConnection(), user.username, req.ip); // D-10-03: runtime.db only
    res.setHeader('Set-Cookie', sessionCookieHeader(req, token));
    // D-10-03: the response user object is the publicAccount() allowlist
    // projection — a secret field added to the account blob later can never
    // ride out through login by accident.
    res.json({
      success: true,
      user: controlStore.publicAccount(user),
      mustChangePassword: user.mustChangePassword === true,
    });
  } catch (err) {
    // isBusyError() reaches the central 503 + Retry-After middleware; every
    // other failure reaches the generic 500 handler — both only via next().
    if (isBusyError(err)) return next(err);
    next(err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  // D-07: logout deletes the session row immediately — revocation is real,
  // not a wait for the cookie to expire.
  const token = readSessionCookie(req);
  if (token) sessions.deleteSession(getRuntimeConnection(), token);
  res.setHeader('Set-Cookie', clearedSessionCookieHeader(req));
  // [security] SAFE-07 / D-13-06 (b) / T-13-31: ask the browser to drop its
  // HTTP cache and origin storage (cookies are not named: the session cookie is
  // cleared by the Set-Cookie above, and the language preference must survive).
  // Honoured in secure contexts only (https / localhost) — a plain-http LAN host
  // ignores it, which is why public/js/client-storage.js clears the same state
  // client-side regardless (T-13-34, PD-19).
  res.setHeader('Clear-Site-Data', '"cache", "storage"');
  res.json({ success: true });
});

// D-10-01/D-10-08: unauthenticated mode probe. `accountsWritable` is the
// client-facing mirror of the committed-control.db refusal (POST /api/deals,
// POST /api/auth/change-password below) — the SAME predicate, never a second
// rule — so the UI can hide controls that could only fail. Computed per
// request because existing tests toggle DEMO_OPEN at runtime.
app.get('/api/auth/mode', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const demoOpen = !dbFiles.IS_REAL_MODE && process.env.DEMO_OPEN === '1';
  res.json({
    mode: dbFiles.IS_REAL_MODE ? 'real' : (demoOpen ? 'demo' : 'dev'),
    demoOpen,
    accountsWritable: !dbFiles.isCommittedControlDbActive(),
  });
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
  const sess = resolveSessionIdentity(readSessionCookie(req)); // D-10-04: disabled/missing account -> null
  const wouldResolveDemo = !sess || !sess.dealId;
  if (!dbFiles.IS_REAL_MODE && process.env.DEMO_OPEN === '1' && wouldResolveDemo) return res.json({ authEnabled: false, user: null });
  if (!sess) return res.json({ authEnabled: true, user: null });
  const user = controlStore.getAccount(sess.username);
  // D-04: dealId is the caller's CURRENT server-side binding (D-01) — the
  // header deal switcher (public/js/deal-switcher.js) needs this to render
  // "which context am I in right now" without a second round-trip. Never the
  // full deal object here (name/targetCompany are cross-referenced from the
  // caller's own GET /api/deals response, which is already membership-
  // filtered) — this endpoint stays resolver-free (PUBLIC_API_PATHS) by
  // design, so it must not itself look up a deal by id.
  // [security] D-11-01/D-11-02 (Phase 11, plan 11-07): `access` is the SERVER-
  // computed capability map the client uses to HIDE controls that would answer
  // 403 — one source of truth (lib/readPolicy.js for reads, roleAllowedForWrite
  // for configuration writes), so the browser never carries its own copy of the
  // role table. It is advisory UX only: every route stays refused server-side by
  // the consolidated gate whatever the client shows or hides, and the map is
  // booleans only (no data). Only the AUTHENTICATED response carries it — the
  // demo-open and no-session responses above are unchanged, so an absent map
  // means "show everything exactly as the showcase always did". `dealBound`
  // mirrors the gate's own leniency predicate: a session with no deal binding
  // resolves to the demo store (req.isDemo === true), where reads stay open.
  // `helpdesk` (Phase 11 review WR-C02): may this role file the employee-portal
  // HR helpdesk ticket (POST /api/communications/send)? Taken from the SAME
  // write table the gate enforces, so the portal hides a form that could only
  // be refused (an employee has never been on DEFAULT_WRITE_ROLES).
  // `timeTravel` (Phase 11 review IN-C01): the demo Day pill / Time Machine
  // posts to a DEMO_ONLY_PREFIXES route, which the gate refuses for any request
  // that does not resolve to the demo store (a deal-bound session) and, on the
  // demo store, for a role ROLE_WRITE_POLICY does not list — so it is reachable
  // exactly when the session has no deal binding AND the role may write it.
  const role = user && user.role;
  res.json({
    authEnabled: true,
    dealId: sess.dealId || null,
    user: controlStore.publicAccount(user),
    access: Object.assign(
      {},
      readPolicy.accessSummaryFor(role, !!sess.dealId),
      {
        configWrite: roleAllowedForWrite(role, '/api/settings', 'POST'),
        helpdesk: roleAllowedForWrite(role, '/api/communications/send', 'POST'),
        timeTravel: !sess.dealId && roleAllowedForWrite(role, '/api/settings/time-travel', 'POST'),
      }
    ),
  });
});

// Self password-change (D-09): available to ANY authenticated role (its
// prefix is on the ROLE_WRITE_POLICY self-service allowlist so employee can
// change their own password too) — never full user-CRUD, only the caller's
// own credential. Requires a valid session (401 without one — not on
// PUBLIC_API_PATHS), verifies the CURRENT password with the same
// scrypt+constant-time-compare primitive login uses (401 on mismatch), then
// rotates to a fresh 16-byte salt before persisting the new hash.
app.post('/api/auth/change-password', async (req, res, next) => {
  try {
    if (!req.portalUser) return res.status(401).json({ error: 'Login required.' });
    // WR-02: reuse the same throttle /api/auth/login uses — scrypt is
    // deliberately expensive, and a caller who already holds a valid session
    // (e.g. a stolen cookie without the password) must not get unlimited
    // current-password guesses just because change-password skips login.
    // Keyed by username (a session already proves who the caller claims to be)
    // rather than IP, so one throttled user cannot lock out others behind the
    // same proxy/NAT.
    const cpKey = 'cp:' + req.portalUser.username;
    const cpVerdict = accountThrottle.check(cpKey);
    if (!cpVerdict.allowed) return sendThrottled(res, cpVerdict);
    // [security] D-10-01/T-10-09: a credential hash must never be written into
    // the committed data/control.db (a git-tracked file). Outside real mode
    // that file is the active control database unless MA_CONTROL_DB_PATH
    // points elsewhere; the SAME predicate backs /api/auth/mode's
    // `accountsWritable` flag so the UI never offers what would only fail.
    // Refused BEFORE the current password is verified or anything is written.
    if (dbFiles.isCommittedControlDbActive()) {
      return res.status(403).json({
        error: 'Accounts on the committed demo database are read-only. Use a real-deal host (start-real-deal) to manage real accounts.',
        committedControlDb: true,
      });
    }
    // VAL-01: the type/shape check is owned by validators/settings.js's
    // ChangePasswordSchema (min 8); the real-mode policy (min 12, no
    // published demo password) is passwords.checkNewPassword() below.
    const { currentPassword, newPassword } = req.body || {};
    const user = controlStore.findUser(req.portalUser.username);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const verdict = await passwords.verifyPassword(currentPassword || '', user);
    if (!verdict.ok) {
      noteBackoff(accountThrottle.fail(cpKey), cpKey, req);
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    // The caller proved the current password: end this key's failure episode
    // (a too-short NEW password below is a validation error, not a guess).
    accountThrottle.clear(cpKey);
    const problem = passwords.checkNewPassword(newPassword, { realMode: dbFiles.IS_REAL_MODE });
    if (problem) return res.status(400).json({ error: problem });
    controlStore.updateUser(user.username, {
      hash: await passwords.hashPassword(newPassword), salt: null, mustChangePassword: false,
    });
    // D-10-08b: this account no longer accepts a published password — it
    // leaves the lockdown offender set (the lockdown lifts when none remain).
    credentialLockdown.clear(user.username);
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
    res.setHeader('Set-Cookie', sessionCookieHeader(req, newToken));
    res.json({ success: true });
  } catch (err) {
    if (isBusyError(err)) return next(err); // central 503 + Retry-After
    next(err);
  }
});

// =====================================================================
// Self-service sessions (ACCT-06 server half, D-10-07). A control-plane path,
// so never open under DEMO_OPEN=1 and never deal-bound. Every query is keyed
// by the CALLER's username — there is no way to name another user's sessions.
// The id exposed per session is a derived value (db/sessions.js
// publicSessionId), never the stored token hash (T-10-19).
// =====================================================================

app.get('/api/auth/sessions', (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const rows = sessions.listSessionsForUser(getRuntimeConnection(), req.portalUser.username);
    // IN-01: req.portalUser.sessionId IS the stored token hash (db/sessions.js
    // findSession) — so `current` compares like with like. `tokenHash` stays
    // server-side: only the derived public `id` is ever serialised (T-10-19;
    // pinned by test/self-sessions.test.js).
    res.json(rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      userAgent: r.userAgent ? String(r.userAgent).slice(0, 200) : null,
      ip: r.ip || null,
      current: req.portalUser.sessionId !== null && r.tokenHash === req.portalUser.sessionId,
    })));
  } catch (err) {
    if (isBusyError(err)) return next(err);
    next(err);
  }
});

app.delete('/api/auth/sessions/:id', (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const ended = sessions.endOwnSession(getRuntimeConnection(), req.portalUser.username, String(req.params.id));
    // Indistinguishable from an unknown id: a foreign session id must never be
    // confirmable by status code.
    if (!ended.deleted) return res.status(404).json({ error: 'Session not found.' });
    if (req.portalUser.sessionId !== null && ended.tokenHash === req.portalUser.sessionId) {
      // The caller ended the session it is using — same cookie clearing as logout.
      res.setHeader('Set-Cookie', clearedSessionCookieHeader(req));
      return res.json({ success: true, endedCurrent: true });
    }
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'session-end-own', subject: req.portalUser.username,
      request: requestMeta(req),
    });
    res.json({ success: true });
  } catch (err) {
    if (isBusyError(err)) return next(err);
    next(err);
  }
});

// =====================================================================
// Admin user management (ACCT-01, D-10-03). Every route sits under
// ROLE_WRITE_POLICY's `/api/admin` prefix (admin only, every method) and is a
// control-plane path (db/resolver.js), so it can never be open under
// DEMO_OPEN=1 (T-10-13). No account deletion exists by design — disable only.
// =====================================================================

const COMMITTED_CONTROL_REFUSAL = {
  error: 'Accounts on the committed demo database are read-only. Use a real-deal host (start-real-deal) to manage real accounts.',
  committedControlDb: true,
};

// [security] D-10-01/T-10-21: a credential hash must never be written into the
// committed data/control.db. The predicate is the SAME one GET /api/auth/mode
// exposes as `accountsWritable`, so the UI flag and these refusals cannot
// disagree.
// [security] CR-01 defence in depth: the consolidated /api gate is the
// control for `/api/admin/*` (admin role, every method), but the account
// roster and account writes must not depend on that single prefix check —
// a future routing or prefix-table regression would otherwise hand the full
// roster to any session. Every /api/admin/users* handler re-checks inline.
function refuseNonAdmin(req, res) {
  if (isAdminRequest(req)) return false;
  res.status(403).json({ error: 'Your role cannot perform this action.' });
  return true;
}

function refuseCommittedControlWrite(res) {
  if (!dbFiles.isCommittedControlDbActive()) return false;
  res.status(403).json(COMMITTED_CONTROL_REFUSAL);
  return true;
}

// Resolve a supplied-or-generated one-time temporary password. Returns
// { tempPassword } or { problem }. An empty string means "generate one" (a
// blank form field), anything else is held to the mode's password policy.
function pickTempPassword(supplied) {
  if (supplied === undefined || supplied === null || supplied === '') {
    return { tempPassword: passwords.generateTempPassword() };
  }
  const problem = passwords.checkNewPassword(supplied, { realMode: dbFiles.IS_REAL_MODE });
  if (problem) return { problem };
  return { tempPassword: supplied };
}

// The audit before/after of an account change carries ONLY these fields —
// never the hash, salt or a temporary password (T-10-17).
function accountAuditView(acct) {
  const v = controlStore.publicAccount(acct);
  return { username: v.username, name: v.name, role: v.role, disabled: v.disabled, mustChangePassword: v.mustChangePassword };
}

app.post('/api/admin/users', async (req, res, next) => {
  if (refuseNonAdmin(req, res)) return;
  try {
    if (refuseCommittedControlWrite(res)) return;
    const { username, name, role, tempPassword: supplied } = req.body;
    const picked = pickTempPassword(supplied);
    if (picked.problem) return res.status(400).json({ error: picked.problem });
    if (controlStore.getAccount(username)) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    const account = {
      username, name, role,
      hash: await passwords.hashPassword(picked.tempPassword),
      salt: null,
      disabled: false,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      createdBy: req.portalUser.username,
    };
    try {
      controlStore.createAccount(account);
    } catch (err) {
      // A concurrent create of the same username loses on the PK.
      if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ error: 'That username is already taken.' });
      }
      throw err;
    }
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'user-create', subject: username,
      after: accountAuditView(account), request: requestMeta(req),
    });
    res.set('Cache-Control', 'no-store'); // the response carries a one-time secret
    res.status(201).json({
      success: true,
      user: controlStore.publicAccount(account),
      tempPassword: picked.tempPassword,
    });
  } catch (err) {
    if (isBusyError(err)) return next(err); // central 503 + Retry-After
    next(err);
  }
});

// Reads stay available even when the committed control.db is active (the
// admin can still SEE accounts; only writes are refused).
app.get('/api/admin/users', (req, res, next) => {
  if (refuseNonAdmin(req, res)) return;
  try {
    const logins = sessions.lastLogins(getRuntimeConnection());
    const users = controlStore.listAccounts()
      .map((acct) => controlStore.publicAccount(acct, { lastLoginAt: logins.get(acct.username) || null }))
      .sort((a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
    res.set('Cache-Control', 'no-store');
    res.json(users);
  } catch (err) {
    if (isBusyError(err)) return next(err);
    next(err);
  }
});

app.post('/api/admin/users/:username/reset-password', async (req, res, next) => {
  if (refuseNonAdmin(req, res)) return;
  try {
    if (refuseCommittedControlWrite(res)) return;
    const target = String(req.params.username);
    if (!controlStore.getAccount(target)) return res.status(404).json({ error: 'User not found.' });
    const picked = pickTempPassword(req.body && req.body.tempPassword);
    if (picked.problem) return res.status(400).json({ error: picked.problem });
    const updated = controlStore.updateUser(target, {
      hash: await passwords.hashPassword(picked.tempPassword), salt: null, mustChangePassword: true,
    });
    // The old credential is dead and so is every session that authenticated
    // with it; the target must sign in with the temp password and rotate it.
    sessions.deleteAllSessionsForUser(getRuntimeConnection(), target);
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'user-password-reset', subject: target, request: requestMeta(req),
    });
    res.set('Cache-Control', 'no-store'); // the response carries a one-time secret
    res.json({ success: true, user: controlStore.publicAccount(updated), tempPassword: picked.tempPassword });
  } catch (err) {
    if (isBusyError(err)) return next(err);
    next(err);
  }
});

app.patch('/api/admin/users/:username', (req, res, next) => {
  if (refuseNonAdmin(req, res)) return;
  try {
    if (refuseCommittedControlWrite(res)) return;
    const target = String(req.params.username);
    let result;
    try {
      result = controlStore.updateAccountGuarded(target, req.body, {
        actorUsername: req.portalUser && req.portalUser.username,
      });
    } catch (err) {
      if (err && err.code === 'ACCOUNT_NOT_FOUND') return res.status(404).json({ error: 'User not found.' });
      if (err && err.code === 'SELF_DISABLE') return res.status(409).json({ error: 'You cannot disable your own account.' });
      if (err && err.code === 'LAST_ADMIN') {
        return res.status(409).json({ error: 'At least one enabled admin must remain.', lastAdmin: true });
      }
      throw err;
    }
    // D-10-04: a disabled account loses every live session immediately (it
    // would 401 on its next request anyway via resolveSessionIdentity(); this
    // removes the rows). Re-enabling needs a fresh sign-in.
    if (req.body.disabled === true) sessions.deleteAllSessionsForUser(getRuntimeConnection(), target);
    const view = (a) => ({ role: a.role, name: a.name || a.username, disabled: a.disabled === true });
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'user-update', subject: target,
      before: view(result.before), after: view(result.after), request: requestMeta(req),
    });
    res.json({ success: true, user: controlStore.publicAccount(result.after) });
  } catch (err) {
    if (isBusyError(err)) return next(err);
    next(err);
  }
});

// Lightweight health check for uptime monitors and platform probes.
// D-12-03 (Phase 12): reports the process-level readiness object (db/readiness.js
// — per-family schema versions, and any failed migration / integrity check). It
// no longer parses the demo database per probe: a liveness `SELECT 1` on the
// already-open demo singleton replaces readDb().
// [security] T-12-52: unauthenticated — the snapshot carries family, migration
// id, a fixed reason code and a basename (`deal` for any deal file), never an
// absolute path or a deal id.
app.get('/healthz', (req, res) => {
  const snap = readiness.snapshot();
  if (!snap.ready) {
    return res.status(503).json({ status: 'not-ready', ts: Date.now(), readiness: snap });
  }
  try {
    require('./db/store').getConnection().prepare('SELECT 1').get();
    res.json({ status: 'ok', ts: Date.now(), readiness: snap });
  } catch (e) {
    res.status(503).json({ status: 'degraded' });
  }
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
const { initDb, readDb, writeDb, getOrOpenConnection, isConflictError, currentDbContext } = require('./db/store');
const { comparableVersion } = require('./db/collections');
const sessions = require('./db/sessions');

// ISO-01 (Phase 3 cutover): open the three live stores through the SAME
// connection cache the resolver/controlStore use — never a second,
// independent open of the same file. The module singleton (initDb) stays
// pointed at demo.db so any code path that runs OUTSIDE a request context
// (this startup block itself, a CLI script) still has a sane default —
// unchanged fallback behavior for requireDb() (03-RESEARCH.md Pattern 1).
bootOpen('demo', () => initDb(dbFiles.DEMO_DB_PATH));
bootOpen('runtime', () => getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH));
bootOpen('control', () => getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH));

// --- boot statements: audit open + deal sweep (D-12-03 / PD-27) -------------
// [security] Every database file family is opened — and therefore versioned,
// migrated and integrity-checked — HERE, before listen(), never on first use.
// audit.db: its family migrations must run at boot, outside any request. A lazy
// first open inside writeDb() would run them NESTED in a deal file's
// `.immediate` write transaction (holding that deal's write lock for the length
// of a migration), and a failure would surface only as a per-request 5xx
// (checker B-1 / T-12-57).
bootOpen('audit', () => auditHook.getAuditConnection());
// Registered deal files: bounded sweep — one open + one quick_check per
// EXISTING registered deal file, no network, boot never creates a file
// (checker W-5 / T-12-59). Active deals open through the resolver's shared
// connection cache (the first request reuses the handle); an archived deal
// (no request can bind it) is opened to be versioned and closed again. A
// DbNotReadyError is recorded under family `deal`, file `deal` — never the id.
bootOpen('deals', () => {
  const started = Date.now();
  let opened = 0;
  let notReady = 0;
  for (const deal of controlStore.listDeals()) {
    let dealPath;
    try { dealPath = dbFiles.dealDbPath(deal && deal.id); } catch (e) { continue; } // not a mintable id: no file to open
    if (!fs.existsSync(dealPath)) continue;
    try {
      if (deal.status === 'archived') {
        dbFiles.openDbFile(dealPath, dbFiles.DEAL_SCHEMA_PATH).close();
      } else {
        getOrOpenConnection(dealPath, dbFiles.DEAL_SCHEMA_PATH);
      }
      opened += 1;
    } catch (e) {
      if (!(e instanceof readiness.DbNotReadyError)) throw e;
      notReady += 1;
    }
  }
  console.log(`[readiness] deal sweep: ${opened} opened, ${notReady} not ready, ${Date.now() - started} ms`);
});

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
bootOpen('sessions-prune', () => sessions.pruneExpiredSessions(getRuntimeConnection()));

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

// [security] D-11-05 / AUTHZ-05 (Phase 11, plan 11-04): every authorization
// denial — a 401/403 from the consolidated /api gate or the deal resolver, and
// every clearance-404 — is recorded as an `access-denied` security event,
// RATE-BOUNDED by lib/denialAudit.js (<= 1 audit row per actor + method +
// route TEMPLATE + reason per 60 s; folded denials counted and written as the
// next row, because audit.db rows can never be updated — AUD-02). The route
// template is resolved from the registered /api route layers, so probing a
// thousand random ids on `DELETE /api/raid/:id` is ONE key, never a thousand.
// A busy audit.db is NOT swallowed (Phase 8 contract): the refusal still
// happens, as the central 503.
let denialRouteLayers = null;
function denialTemplateFor(canonicalPath, method) {
  if (!denialRouteLayers) {
    // Computed lazily — every route is registered by the time a request arrives.
    // `layer.regexp.test`, NOT `layer.match()`: Express 4's Layer#match writes
    // `layer.params`/`layer.path` on the SHARED layer object, which the router
    // itself reads while dispatching.
    denialRouteLayers = ((app._router && app._router.stack) || [])
      .filter((l) => l.route && typeof l.route.path === 'string' && l.route.path.startsWith('/api') && l.regexp)
      .map((l) => ({ regexp: l.regexp, path: l.route.path, methods: l.route.methods || {} }));
  }
  const verb = String(method || '').toLowerCase();
  const wanted = verb === 'head' ? 'get' : verb;
  let anyMatch = null;
  for (const layer of denialRouteLayers) {
    if (!layer.regexp.test(canonicalPath)) continue;
    if (layer.methods[wanted] || layer.methods._all) return layer.path;
    if (!anyMatch) anyMatch = layer.path;
  }
  return anyMatch;
}
const denialAuditor = createDenialAuditor({
  write: (event) => auditHook.recordSecurityEvent(event),
  templateFor: denialTemplateFor,
});
// Exposed on the app object (not module.exports) so a test can flush/inspect
// the window state without touching the module's export tail.
app.denialAuditor = denialAuditor;

function canonicalPathOf(req) {
  if (typeof req.gatePathCanonical === 'string' && req.gatePathCanonical) return req.gatePathCanonical;
  const shape = pathForms((req.baseUrl || '') + (req.path || ''));
  return shape.ok ? shape.canonical : '';
}

/** Record ONE denial (rate-bounded) — shared by the gate, resolver, lockdown and the 404 branch. */
function recordDenial(req, status, reason, route) {
  denialAuditor.startSweeper(); // idempotent, unref'd — see lib/denialAudit.js
  denialAuditor.record({
    actor: req.portalUser || null,
    method: req.method,
    path: canonicalPathOf(req),
    reason,
    status,
    route: route || undefined,
    dealId: (req.dealContext && req.dealContext.dealId) || (req.portalUser && req.portalUser.dealId) || null,
    request: requestMeta(req),
  });
}

/**
 * [security] WR-01 (Phase 11 review): the DD / org clean-room clearance
 * refusals go through the SAME rate bound as every other denial (one row per
 * actor + deal + method + route TEMPLATE + reason [+ subject] per window), so a
 * probe loop over `/api/dd/findings/<random id>` or `/api/org/flight-risk` can no
 * longer append one permanent audit.db row per request. Their historical
 * action names and row shape are preserved (lib/denialAudit.js "CLEARANCE
 * DENIALS"); `subject` must be a bounded value (a DD area id, or null).
 */
function recordClearanceDenial(req, action, reason, subject) {
  denialAuditor.startSweeper();
  denialAuditor.record({
    actor: req.portalUser || null,
    method: req.method,
    path: canonicalPathOf(req),
    reason,
    status: 403,
    route: (req.route && typeof req.route.path === 'string') ? req.route.path : undefined,
    dealId: (req.dealContext && req.dealContext.dealId) || null,
    request: requestMeta(req),
    action,
    subject: subject === undefined ? null : subject,
  });
}

/** Audit the refusal, then answer it with the SAME status/body the caller always sent. */
function denyAt(req, res, status, reason, body) {
  recordDenial(req, status, reason);
  return res.status(status).json(body);
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

// [security] CR-01 (Phase 11 review): EVERY response below that hands a deal
// registry record to the client goes through this one projection
// (lib/dealProjection.js) — admin/hrbp get the full record, pmo/employee only
// what the deal switcher renders. Membership filtering decides WHICH deals a
// caller sees; this decides WHAT of each (deal size, dates, synergy target,
// members, clearance grants are MNPI and never reach pmo/employee).
function dealForCaller(req, deal) {
  return projectDealForRole(deal, req.portalUser && req.portalUser.role);
}

// D-07/WIZ-01: validate-only — the wizard's first step gets ONE server-side
// rule set (WizardBasicsSchema, validators/wizard.js, kept in exact sync
// with CreateDealSchema's own basics fields below) rather than a duplicated
// client-side copy. This handler deliberately persists nothing and records
// nothing: the consolidated /api gate's validationMiddleware has already
// parsed, stripped and bounded req.body by the time this handler runs, so
// echoing it back IS the entire contract.
app.post('/api/deals/wizard/basics', (req, res) => {
  res.json({ success: true, basics: req.body });
});

// VAL-01: no per-route validateBody() call needed here — validators/deals.js
// registers this route's schema into the shared WRITE_SCHEMAS registry, and
// validators/index.js#validationMiddleware (mounted once in the consolidated
// /api gate above) resolves+validates+sanitizes req.body generically for
// every write route in the app, including this one.
app.post('/api/deals', (req, res) => {
  // [security] D-10-01: a real deal (MNPI target names, valuations) must never
  // be registered in the committed data/control.db — it is a git-tracked file.
  // Real deals are created only on a real-deal host (MA_MODE=real, its own
  // gitignored data directory) or against an explicit MA_CONTROL_DB_PATH
  // override; this refusal precedes every controlStore call, so a refused
  // request leaves the committed file byte-for-byte untouched.
  if (dbFiles.isCommittedControlDbActive()) {
    return res.status(403).json({
      error: 'Real deals cannot be created on the committed demo database. Start the portal with start-real-deal.command (macOS/Linux) or start-real-deal.bat (Windows), which run MA_MODE=real on its own data directory.',
      realModeRequired: true,
    });
  }
  const { name, targetCompany, members, dealType, signingDate, expectedClose, day1Date, dealSizeM, currency } = req.body;
  // G-04-8: re-entering the wizard after an interruption must RESUME the
  // caller's own unfinished deal, never mint a second, indistinguishable
  // copy of it (live UAT test 8). public/js/deal-wizard.js's resume-on-entry
  // bootstrap is the primary fix — this lookup is the server-side net it
  // cannot be bypassed around: a stale cached script, a second browser tab,
  // or a hand-rolled request all land here too. Nothing is created and no
  // security event is recorded on a resumed return — that deal's original
  // `deal-create` event already answers who created it and when, and this
  // call changed nothing. D-05 create-early is untouched below: a caller
  // with no matching unfinished deal still gets one created on the very
  // first successful basics-and-team post.
  //
  // [security] WR-01/WR-02 (Phase 8 review fix): the dedup check and the
  // create used to be two separate, unguarded controlStore calls — a
  // cross-process TOCTOU (two `node server.js` processes could each observe
  // "no existing unfinished deal" and each insert a row) that the D-09
  // `.immediate`-wrap pattern elsewhere in this file did not originally
  // cover. controlStore.createDealDeduped() now wraps BOTH the dedup read
  // and the create (seq-read included) in one `.immediate` transaction on
  // control.db — see its own doc comment in db/controlStore.js.
  const { deal: dealResult, resumed } = controlStore.createDealDeduped({
    name, targetCompany, members, createdBy: req.portalUser.username,
    dealType, signingDate, expectedClose, day1Date, dealSizeM, currency,
  });
  if (resumed) {
    return res.json({ success: true, deal: dealForCaller(req, dealResult), resumed: true });
  }
  // D-05/WIZ-01: the wizard's optional basics fields (dealType/signingDate/
  // expectedClose/day1Date/dealSizeM/currency) ride the SAME create call as
  // name/targetCompany/members — createDealDeduped() also stamps the `setup`
  // skeleton whose basics/team steps are already done by this very call.
  const deal = dealResult;
  try {
    // T-03-23: provision the deal's own database file AFTER the registry row
    // exists, matching an existing id — if this throws, the registry row is
    // rolled back below so a half-created deal is never left selectable.
    createDealDatabase(deal.id, { name, targetCompany });
  } catch (e) {
    console.error(`Error provisioning database for deal ${deal.id}, rolling back registry row:`, e);
    // [security] D-06/D-11/CONC-01 (Phase 8): a local catch that converts a
    // retryable write-lock contention error into a hand-written 500 denies
    // the client its documented retry path — a bounded 503 tells the client
    // to retry, a bare 500 looks permanent and the write is silently lost.
    // Every storage-wrapping catch in this file re-throws a busy error
    // (isBusyError(), the single predicate exported near the top of this
    // file) so it reaches the central 503 middleware instead of a local
    // response — uniformly, including control-plane writes (D-11), never by
    // matching error message text (RESEARCH.md "Don't Hand-Roll"). Here, the
    // compensating rollback must still run FIRST (T-08-11) — losing it on a
    // contention failure would leave a half-created deal selectable in the
    // registry with no database behind it — and only then is the original
    // provisioning error re-thrown.
    try {
      controlStore.deleteDeal(deal.id);
    } catch (rollbackErr) {
      console.error(`Error rolling back deal registry row ${deal.id} after provisioning failure:`, rollbackErr);
      if (isBusyError(rollbackErr)) throw rollbackErr;
    }
    if (isBusyError(e)) throw e;
    return res.status(500).json({ error: 'Failed to provision the new deal database.' });
  }
  // D-08: deal creation is a control-plane security event.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'deal-create', dealId: deal.id, subject: deal.id,
    before: null, after: deal, request: requestMeta(req),
  });
  res.json({ success: true, deal: dealForCaller(req, deal) });
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
  res.json({ success: true, deal: dealForCaller(req, deal) });
});

// D-03: never the full registry for a non-admin — listDealsForUser() itself
// filters to deals the caller is a member of (admin sees every active deal).
// [security] CR-01: ...and every record is projected for the caller's role.
app.get('/api/deals', (req, res) => {
  res.json(projectDealsForRole(controlStore.listDealsForUser(req.portalUser), req.portalUser && req.portalUser.role));
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
  res.json({ success: true, deal: dealForCaller(req, updated) });
});

// D-05/WIZ-01: records progress through the wizard's remaining setup steps
// (basics/team are already stamped by the create route above) — diligence
// is usable the moment the deal exists (D-09), so this route is TRACKING,
// never gating: no other route in this app ever checks `deal.setup.complete`
// before allowing work. `complete` flips true once every one of the six
// declared steps is stamped, OR the caller passes `complete: true`
// explicitly (an operator choice to mark the wizard "done enough").
// Inherits the SAME broader '/api/deals' ROLE_WRITE_POLICY entry (admin +
// hrbp) the clean-room/vdr grant routes below already use — this is deal
// CONFIGURATION state, the same audience D-02 gives deal creation itself.
app.post('/api/deals/:id/setup', (req, res) => {
  const dealId = req.params.id;
  const existing = controlStore.getDeal(dealId);
  if (!existing) return res.status(404).json({ error: 'Deal not found.' });
  // [security] T-11-13 (D-11-02, Phase 11): the '/api/deals' write policy only
  // proves the caller is admin or hrbp — it says nothing about WHICH deal.
  // An hrbp who is not a member of this deal must not edit its configuration,
  // and must not learn it exists: the refusal is byte-identical to the
  // missing-deal 404 above (the same anti-enumeration rule POST
  // /api/deals/select applies). Admin is always a member (isDealMember).
  if (!controlStore.isDealMember(dealId, req.portalUser)) {
    return res.status(404).json({ error: 'Deal not found.' });
  }
  const { step, data, complete, dealSettings } = req.body;
  const beforeSteps = (existing.setup && existing.setup.steps) || {};

  // D-11-02: deal-level values the Integration Lead edits on HER deal now that
  // the instance settings singleton is admin-only (currency, Day-1 date,
  // synergy target / staleness threshold / phasing horizon). Stored on the
  // deal's control.db registry record — this route is control-plane, no deal
  // database is bound. Applied FIRST, independently of any step/complete
  // below, so a dealSettings-only post never stamps a wizard step.
  let current = existing;
  if (dealSettings !== undefined) {
    const project = (d) => ({
      currency: d.currency === undefined ? null : d.currency,
      day1Date: d.day1Date === undefined ? null : d.day1Date,
      synergyTargetM: d.dealSettings && d.dealSettings.synergyTargetM !== undefined ? d.dealSettings.synergyTargetM : null,
      synergyStaleDays: d.dealSettings && d.dealSettings.synergyStaleDays !== undefined ? d.dealSettings.synergyStaleDays : null,
      synergyHorizonYears: d.dealSettings && d.dealSettings.synergyHorizonYears !== undefined ? d.dealSettings.synergyHorizonYears : null,
    });
    const beforeSettings = project(existing);
    current = controlStore.updateDealSettings(dealId, dealSettings);
    // D-08: a configuration change on a deal is a control-plane security
    // event, recorded with before/after (T-11-15).
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'deal-settings-update', dealId, subject: 'dealSettings',
      before: beforeSettings, after: project(current), request: requestMeta(req),
    });
    // Neither a step nor a completion request: settings only, nothing else
    // about the wizard changes.
    if (step === undefined && complete !== true) return res.json({ success: true, deal: dealForCaller(req, current) });
  }

  // G-04-10: a completion-only post (no `step` — validators/wizard.js's
  // refine is what guarantees `complete === true` and no `data` reach this
  // branch) is an operator saying "this deal is set up enough for now" — it
  // must NEVER fabricate a stamp for a step that was never actually done.
  // The existing `steps` object therefore passes through UNCHANGED: no step
  // is created, overwritten, or re-stamped. Before this fix, the wizard's
  // Finish control posted `{ step: 'ddKickoff', complete: true }`, which
  // stamped ddKickoff even when the operator had skipped it — the deal
  // home's setup checklist (and its "resume setup" nudge) derives its
  // per-step status straight from this object, so a fabricated stamp there
  // silently hid outstanding work from the Integration Lead (live UAT
  // test 10).
  if (step === undefined) {
    const beforeComplete = Boolean(existing.setup && existing.setup.complete);
    const newComplete = complete === true;
    const updated = controlStore.updateDealSetup(dealId, { steps: beforeSteps, complete: newComplete });
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'deal-setup-update', dealId, subject: 'complete',
      before: beforeComplete, after: newComplete, request: requestMeta(req),
    });
    return res.json({ success: true, deal: dealForCaller(req, updated) });
  }

  const beforeStepValue = beforeSteps[step] != null ? beforeSteps[step] : null;
  const stampedValue = { at: new Date().toISOString(), by: req.portalUser.username, ...(data !== undefined ? { data } : {}) };
  const newSteps = { ...beforeSteps, [step]: stampedValue };
  const allStamped = wizardValidators.DEAL_SETUP_STEPS.every((s) => newSteps[s] != null);
  const newComplete = complete === true || allStamped;
  const updated = controlStore.updateDealSetup(dealId, { steps: newSteps, complete: newComplete });
  // D-08/T-04-37: setup progress is deal-configuration state, not routine
  // content — recording it keeps the trail able to answer when a deal
  // actually became fully set up, and by whom each step was completed.
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'deal-setup-update', dealId, subject: step,
    before: beforeStepValue, after: stampedValue, request: requestMeta(req),
  });
  res.json({ success: true, deal: dealForCaller(req, updated) });
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
    return denyAt(req, res, 403, 'role-inline', { error: 'Your role cannot view deal grants.' });
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
    return res.json({ success: true, deal: dealForCaller(req, deal) });
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
  res.json({ success: true, deal: dealForCaller(req, updated) });
});

// DD-05/D-18: a data-room ACCESS-GRANT record — who was given access to
// which part of TE's own virtual data room, by whom, when, with an
// optional note. Deliberately inherits the SAME broader '/api/deals'
// ROLE_WRITE_POLICY entry (admin + hrbp) as the clean-room grants route
// above, UNCHANGED — D-18 gives this to the same audience D-02 gives area
// grants to. The record is written ONLY as a `vdr-access-grant`
// recordSecurityEvent() — there is no separate collection for it to drift
// out of sync with the trail, and the audit store is the one place in this
// system that survives deletion of the deal it describes, which is exactly
// the property an access-grant record most needs.
app.post('/api/deals/:id/vdr-grants', (req, res) => {
  const dealId = req.params.id;
  const deal = controlStore.getDeal(dealId);
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });
  const { username, vdrRef, note } = req.body;
  // T-04-30: recording that someone OUTSIDE the deal was given data-room
  // access would be a fabricated compliance record — refused outright,
  // mirroring the clean-room grants route's own non-member refusal above.
  if (!Array.isArray(deal.members) || !deal.members.includes(username)) {
    return res.status(400).json({ error: 'username must be a current member of this deal.' });
  }
  const grant = {
    username, vdrRef, note: note || '',
    grantedBy: req.portalUser.username, grantedAt: new Date().toISOString(),
  };
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'vdr-access-grant', dealId, subject: username,
    before: null, after: grant, request: requestMeta(req),
  });
  res.json({ success: true, grant });
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
  res.json({ success: true, deal: dealForCaller(req, updated) });
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

// ---------------------------------------------------------------------------
// [security] D-12-04 / PD-7 / PD-8 (Phase 12, plan 12-12): the audit-partition
// LIFECYCLE — seal, status, export, purge of ONE deal's hash-chained audit
// partition. Deliberately NOT under /api/admin/audit*: test/audit-security-
// events.test.js (e) locks that prefix to GET-only. These routes live under
// /api/admin/deals/:id/audit…, which db/resolver.js already treats as
// control-plane (never deal-bound, never open under DEMO_OPEN) and which the
// `/api/admin` rows of ROLE_WRITE_POLICY / ROLE_READ_POLICY make admin-only.
// Every step is a control-plane event in audit.db (via the injected recorder),
// and nothing here ever runs on a timer: seal and purge are explicit, confirmed
// admin actions (T-12-111). The orchestration lives in db/auditLifecycle.js so
// this route and scripts/audit-admin.js can never word or order a step
// differently.
const auditLifecycle = require('./db/auditLifecycle');

/**
 * [security] CR-01 (12-REVIEW): the partition id is resolved by FILE IDENTITY,
 * never by the caller's spelling. Valid only when it exactly equals a
 * registered deal id or exactly equals a partition file basename in an
 * exact-case listing of the audit directory (db/dbFiles.js
 * resolveAuditPartitionId). A case variant of a live deal's id would otherwise
 * open the SAME file on a case-insensitive filesystem while matching no
 * registry row — skipping the `deal-active` refusal. Not an id shape at all →
 * 400 (unchanged); every other spelling → the uniform 404, before any read,
 * write or event.
 */
function auditPartitionIdOf(req, res) {
  const r = dbFiles.resolveAuditPartitionId(req.params.id, (x) => {
    const deal = controlStore.getDeal(x);
    return !!deal && deal.id === x;
  });
  if (r.ok) return r.id;
  if (r.reason === 'unknown') res.status(404).json({ error: 'Not found' });
  else res.status(400).json({ error: 'Invalid deal id.' });
  return null;
}

/** The injected collaborators db/auditLifecycle.js needs (it never requires auditHook). */
function auditLifecycleDeps(req, id) {
  const user = req.portalUser || {};
  return {
    dealState: () => {
      const deal = controlStore.getDeal(id);
      if (!deal) return 'absent';
      return deal.status === 'archived' ? 'archived' : 'active';
    },
    findEvents: (actions) => auditHook.findControlEvents({ dealId: id, action: actions }),
    recordEvent: (ev) => auditHook.recordSecurityEvent({
      actor: req.portalUser, action: ev.action, dealId: id, subject: id, after: ev.after, request: requestMeta(req),
    }),
    closeConnection: () => auditHook.closePartitionConnection(id),
    actor: { username: user.username, role: user.role, sessionId: user.sessionId },
    now: auditLifecycleNow(),
    env: process.env,
  };
}

// The retention clock. `app.auditClock` is a TEST-ONLY seam (a function
// returning a Date) so a suite can prove "retention elapsed" without waiting
// days; it is ignored outright in real-deal mode, where only the wall clock
// counts (T-12-111).
function auditLifecycleNow() {
  if (!dbFiles.IS_REAL_MODE && typeof app.auditClock === 'function') {
    const t = app.auditClock();
    if (t instanceof Date && Number.isFinite(t.getTime())) return t;
  }
  return new Date();
}

// GET status: existence, rows, head, seal time/hash, whether the file still
// matches the seal, recorded exports, retention, purge eligibility and the
// partition's lifecycle events. READ-ONLY (no-get-mutates, 11-06): the
// partition is opened read-only and audit.db is only SELECTed.
app.get('/api/admin/deals/:id/audit', (req, res) => {
  const id = auditPartitionIdOf(req, res);
  if (!id) return;
  const deps = auditLifecycleDeps(req, id);
  const status = auditLifecycle.lifecycleStatus(id, deps);
  res.set('Cache-Control', 'no-store');
  res.json(Object.assign({ dealState: deps.dealState() }, status));
});

// [security] T-12-113: the export carries the FULL MNPI trail out of the host.
// Admin-only (the /api/admin rows), sealed-only, an attachment with
// `Cache-Control: no-store`, and its SHA-256 is recorded as a control event
// AFTER the last byte. WR-03 (12-REVIEW): the attempt itself is recorded
// (`audit-partition-export-started`) before the first byte, and a client
// disconnect or stream error records `audit-partition-export-aborted` with the
// bytes sent — never an `-exported` hash for a partial file.
app.get('/api/admin/deals/:id/audit/export', async (req, res, next) => {
  const id = auditPartitionIdOf(req, res);
  if (!id) return;
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; });
  try {
    const deps = auditLifecycleDeps(req, id);
    deps.shouldAbort = () => aborted;
    deps.write = (chunk) => (res.write(chunk) ? undefined : new Promise((resolve) => {
      res.once('drain', resolve);
      res.once('close', resolve);
    }));
    deps.onReady = () => {
      res.set('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      res.set('Content-Disposition', `attachment; filename="audit-${id}.jsonl"`);
    };
    const result = await auditLifecycle.exportPartition(id, deps);
    if (result.outcome === 'refused') {
      return res.status(409).json({ error: auditLifecycle.REFUSAL_MESSAGES[result.reason], reason: result.reason });
    }
    if (result.outcome === 'aborted') return undefined;
    return res.end();
  } catch (e) {
    if (isBusyError(e) && !res.headersSent) return next(e); // central 503 + Retry-After
    // Mid-stream (or the event could not be recorded after the last byte): never
    // end a response whose export has no control event — drop the connection so
    // the client sees an incomplete download rather than a clean one.
    if (res.headersSent) { res.destroy(); return undefined; }
    return next(e);
  }
});

// [security] T-12-111: purge is an explicit, confirmed, admin-only action and is
// refused unless the partition is sealed, unmodified since the seal, has a
// recorded export of exactly that sealed state, and the retention period
// (MA_AUDIT_RETENTION_DAYS, default never) has elapsed. NOTHING calls it on a
// timer (test/audit-lifecycle-routes.test.js scans for exactly that).
app.post('/api/admin/deals/:id/audit/purge', (req, res) => {
  const id = auditPartitionIdOf(req, res);
  if (!id) return;
  if (req.body.confirm !== id) {
    return res.status(400).json({ error: 'Confirmation value must exactly match the deal id.' });
  }
  const result = auditLifecycle.purgePartition(id, auditLifecycleDeps(req, id));
  if (result.outcome === 'refused') {
    const body = { error: auditLifecycle.REFUSAL_MESSAGES[result.reason], reason: result.reason };
    if (result.eligibleAt) body.eligibleAt = result.eligibleAt;
    return res.status(409).json(body);
  }
  if (result.outcome === 'failed') {
    return res.status(500).json({ error: 'The audit trail could not be removed. See the server log.' });
  }
  res.json({
    success: true, purged: true, sealedSha256: result.sealedSha256, rows: result.rows,
    headHash: result.headHash, exportSha256: result.exportSha256,
  });
});

app.post('/api/admin/deals/:id/audit/seal', (req, res) => {
  const id = auditPartitionIdOf(req, res);
  if (!id) return;
  if (req.body.confirm !== id) {
    return res.status(400).json({ error: 'Confirmation value must exactly match the deal id.' });
  }
  const result = auditLifecycle.sealPartition(id, auditLifecycleDeps(req, id));
  if (result.outcome === 'refused') {
    return res.status(409).json({ error: auditLifecycle.REFUSAL_MESSAGES[result.reason], reason: result.reason });
  }
  res.json({
    success: true, sha256: result.sha256, rows: result.rows, headHash: result.headHash, alreadySealed: result.alreadySealed,
  });
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

// [security] D-11-02 / AUTHZ-02 / T-11-11 (Phase 11): the settings response a
// given caller is allowed to see. Admin keeps publicSettings() exactly as it
// was (the admin console edits these fields). EVERY other caller — pmo, hrbp,
// employee and the anonymous DEMO_OPEN showcase (req.portalUser === null) — gets
// the publicSettings() result picked DOWN to validators/settings.js's
// PUBLIC_SETTINGS_KEYS. An allowlist pick, never a delete-list: a settings key
// added tomorrow (a webhook URL, a token) is withheld until someone consciously
// lists it. Resolved lazily here so no new require lands in the file header.
function settingsResponseFor(req, s) {
  const full = publicSettings(s);
  if (isAdminRequest(req)) return full;
  const allowed = require('./validators/settings').PUBLIC_SETTINGS_KEYS;
  const out = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(full, key)) out[key] = full[key];
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
    // [security] D-10-01 (Phase 10): the real-deal-mode data directory
    // (MA_MODE=real default, gitignored) holds MNPI — accounts, deal
    // databases, sessions, the audit trail — and is likewise excluded.
    execSync(`zip -r "${zipPath}" . -x "node_modules/*" ".git/*" ".gemini/*" "public/ma-app.zip" "ma-portal.zip" "looxmaxing/*" ".playwright-mcp/*" ".DS_Store" "*/.DS_Store" "db.json" "db.json.tmp" "db.json.bak" "data/*.db" "data/*.db-wal" "data/*.db-shm" "data/*.db.bak" "data/runtime.db*" "data/audit.db*" "data/audit/*" "data/deals/*" "data/real/*" ".env" ".env.*" "public/sent_emails/*" "sent_emails/*"`, { cwd: __dirname });

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

// [security] D-12-05 / DATA-05 / R2-03 (Phase 12, plan 12-04): pdf-parse
// (pdfjs-dist) is CPU-bound — a large or crafted PDF held the event loop for
// seconds, for every user, from any signed-in staff upload. The parse now runs
// in a persistent worker thread (lib/workers/pdf-text-worker.js) behind a
// ONE-in-flight guard: a second concurrent upload is REFUSED 429 + Retry-After,
// never queued. The worker gets the PDF bytes and returns text only; the AI
// review, the ragUploads write and the RAG retrain stay on the main thread.
// Shared with the steerco pack route far below (D-12-05).
const { createIsolatedTask } = require('./lib/isolatedTask');
const ragPdfTask = createIsolatedTask({
  name: 'rag-pdf',
  workerFile: path.join(__dirname, 'lib', 'workers', 'pdf-text-worker.js'),
});

// POST AI Model RAG PDF Training Upload & AI Insight Review
app.post('/api/rag/upload', async (req, res, next) => {
  // [security] SAFE-06 / D-13-05 (PD-14): Gemini switched off -> a 200 marker the
  // client never retries and no generic hook (503 retry, 409 dialog, 403 denial)
  // engages on. Checked FIRST: nothing is parsed, leased or written.
  if (!egress.allows('gemini')) {
    return res.json({ egressDisabled: 'gemini', message: EGRESS_DISABLED_MESSAGE });
  }
  // tryAcquire() is synchronous and precedes the base64 decode, so a refused
  // request costs nothing beyond the body the JSON parser already read.
  const lease = ragPdfTask.tryAcquire();
  if (!lease) {
    res.set('Retry-After', '5');
    return res.status(429).json({ success: false, error: 'Another PDF is being processed. Try again in a few seconds.' });
  }
  try {
    // VAL-01: presence is now owned exclusively by validators/settings.js's RagUploadSchema.
    const { fileName, fileData } = req.body;

    console.log(`Processing RAG PDF upload request: "${fileName}"...`);

    // Decode Base64 string
    const base64Data = fileData.replace(/^data:application\/pdf;base64,/, "");
    const pdfBuffer = Buffer.from(base64Data, 'base64');

    // Parse plain text from PDF (pdf-parse v2) — in the worker, off the loop.
    // The bytes are copied once into a fresh ArrayBuffer and TRANSFERRED.
    const pdfBytes = new Uint8Array(pdfBuffer);
    const parsedPdf = await lease.run({ data: pdfBytes.buffer }, [pdfBytes.buffer]);
    // The CPU-bound part is done: free the slot before the (network-bound) AI
    // review so a slow model call does not block the next upload's parse. The
    // finally below releases again on every error path (idempotent).
    lease.release();
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
  } catch (e) {
    // [security] D-06/D-10/CONC-01: Express 4 does not auto-forward a
    // rejected promise from an async handler — an isBusyError() re-throw
    // here would become an unhandled rejection, not a 503 (RESEARCH.md
    // Pitfall 2). Forward explicitly via next() instead.
    if (isBusyError(e)) return next(e);
    console.error('Error handling RAG PDF upload:', e);
    res.status(500).json({ success: false, error: 'Failed to process and train RAG model.' });
  } finally {
    lease.release();
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
    custom.egress = { ...egress.current() };
    res.json(settingsResponseFor(req, custom));
  } else {
    res.json(settingsResponseFor(req, { ...(db.settings || {}), geminiApiKey: secretGeminiApiKey, egress: { ...egress.current() } }));
  }
});

// POST Settings
app.post('/api/settings', (req, res) => {
  // [security] D-11-02 / T-11-12 (Phase 11): defence in depth, independent of
  // ROLE_WRITE_POLICY's table order. This handler can write the AI key and the
  // browser-model / database-config egress settings, so a non-admin must never
  // reach the write even if the policy table is later re-ordered. DEMO_OPEN
  // open mode sets req.portalUser to null by design (anonymous showcase) and
  // keeps working — the guard applies only to a resolved identity.
  if (req.portalUser && !isAdminRequest(req)) {
    return res.status(403).json({ error: 'Your role cannot perform this action.' });
  }
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

// [security] SAFE-06 / D-13-05 (plan 13-02): the instance-level egress switch.
// `/api/admin` is admin-only for EVERY method (ROLE_WRITE_POLICY + the read
// policy), and the body is a strict schema of optional booleans
// (validators/settings.js EgressUpdateSchema) - a non-admin can neither read nor
// change it, an unknown key or a non-boolean is a 400. The switch is
// instance-level (runtime.db), independent of any deal binding. Every change is
// a control-plane security event with the before/after booleans and the actor.
function egressSnapshot() {
  return { mode: egress.isReal ? 'real' : 'dev', defaults: { ...egress.defaults }, stored: egress.stored(), effective: { ...egress.current() } };
}
app.get('/api/admin/egress', (req, res) => {
  res.json(egressSnapshot());
});
app.post('/api/admin/egress', (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ error: 'Your role cannot perform this action.' });
  }
  const before = { ...egress.current() };
  egress.set(req.body || {});
  const snap = egressSnapshot();
  auditHook.recordSecurityEvent({
    actor: req.portalUser,
    action: 'egress-settings-changed',
    subject: 'egress',
    before,
    after: snap.effective,
    request: requestMeta(req),
  });
  res.json(snap);
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

// Upload a slide file -> saved under slideUpload.slidesDir() (MA_SLIDES_UPLOAD_DIR,
// default public/uploads/slides) and returned as a servable URL. Behind the same
// admin-write gate as other writes. SAFE-03 / D-13-04 (a): HTML is sent as utf8
// text, PDF/PNG/JPEG/WebP as base64 (`encoding: 'base64'`); extension AND declared
// type AND (binary) magic bytes must agree, > 10 MB or over the library quota is
// refused with a fixed body, and a refusal writes nothing.
app.post('/api/slides/upload', (req, res) => {
  const b = req.body || {};
  // VAL-01: non-empty-content is owned by validators/cms.js's SlideUploadSchema.
  const verdict = slideUpload.checkUpload({
    filename: b.filename,
    type: b.type,
    encoding: b.encoding,
    content: typeof b.content === 'string' ? b.content : '',
  });
  if (!verdict.ok) return res.status(verdict.status).json(verdict.body);
  const dir = slideUpload.slidesDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fname = Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + verdict.safeName;
    fs.writeFileSync(path.join(dir, fname), verdict.buffer, { flag: 'wx' });
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
    // [security] D-06/CONC-01: writeDb() contention must still 503 through
    // the central middleware here — the surrounding fs work (mkdir/write
    // file) keeps its existing generic handling for every other failure.
    if (isBusyError(e)) throw e;
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
// CR-01: since D-10-03 every /api/admin/users/* path IS control-plane
// (db/resolver.js), so it is never open under DEMO_OPEN=1 and the inline
// admin re-check below always has an identity to test.
app.post('/api/admin/users/:username/revoke-sessions', (req, res) => {
  if (refuseNonAdmin(req, res)) return;
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
app.get('/api/ai/insight', async (req, res, next) => {
  // [security] SAFE-06 / D-13-05 (PD-14): see POST /api/rag/upload.
  if (!egress.allows('gemini')) {
    return res.json({ egressDisabled: 'gemini', message: EGRESS_DISABLED_MESSAGE });
  }
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
    // [security] D-06/CONC-01: async handler — forward via next(), never a
    // bare re-throw (RESEARCH.md Pitfall 2).
    if (isBusyError(error)) return next(error);
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
app.post('/api/assessment', async (req, res, next) => {
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
      // [security] SAFE-06 / D-13-05 (PD-14): Gemini off -> an empty key, so the
      // existing local plan is used (refusing would block a core assessment write).
      apiKey: egress.allows('gemini') ? (controlStore.getSecretSettings().geminiApiKey || '') : ''
    });
  } catch (error) {
    // [security] D-06/CONC-01: async handler — a write-lock contention error
    // surfaced while reading the secret settings must still reach the
    // client as a 503 (D-11's uniform contract), not be silently absorbed
    // into the local-fallback degrade path below. Forward via next(), never
    // a bare re-throw (RESEARCH.md Pitfall 2).
    if (isBusyError(error)) return next(error);
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
    // [security] D-06/CONC-01: async handler — forward via next(), never a
    // bare re-throw (RESEARCH.md Pitfall 2).
    if (isBusyError(e)) return next(e);
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
    // D-24: a pending row (assigned but not yet taken) can never become the
    // "latest" instance for a template — it carries no score, band or
    // compatibility contribution to promote.
    if (i.status !== 'submitted') return;
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

// D-24/WIZ-01: assign a readiness assessment BEFORE anyone has answered
// anything — an owner and a due date, tracked as outstanding. Calls no
// scorer and sets no score field at all: a pending row is identified by the
// ABSENCE of a score, never by a zero that could be mistaken for a real
// result (T-04-33). Pushed onto the SAME assessmentInstances lane
// POST /api/assessment-instances below writes to — there is no separate
// "pending assessments" collection for this to drift out of sync with
// (D-24), which is what lets the completion path below promote this exact
// row in place instead of creating a second one.
app.post('/api/assessment-instances/assign', (req, res) => {
  const { templateId, owner, dueDate } = req.body || {};
  const db = readDb();
  const template = (db.assessmentTemplates || []).find(t => t.id === templateId);
  if (!template) return res.status(404).json({ error: 'Assessment template not found.' });
  const instance = {
    id: newId('ainst'),
    templateId,
    templateVersion: template.version || 1,
    subject: template.subject || 'target-org',
    rater: 'self',
    owner: String(owner || '').slice(0, 120),
    dueDate: String(dueDate || '').slice(0, 10),
    status: 'pending',
    timestamp: new Date().toISOString(),
  };
  assessLane(db).push(instance);
  writeDb(db);
  res.status(201).json({ success: true, instance: publicAssessInstance(instance) });
});

// POST a completed assessment — server computes every score (client sends raw answers only)
app.post('/api/assessment-instances', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/assessment.js's AssessmentInstanceSchema.
  const { templateId, rater, respondentName, respondentRole, responses, retakeOf, instanceId } = req.body || {};
  const db = readDb();
  const template = (db.assessmentTemplates || []).find(t => t.id === templateId);
  if (!template) return res.status(404).json({ error: 'Assessment template not found.' });
  const scoresBlock = scoreAssessmentInstance(template, responses);

  // D-24/T-04-32: an optional instanceId completes a PENDING row (created via
  // POST /api/assessment-instances/assign above) IN PLACE — mutating that
  // SAME row rather than pushing a second one, so one assignment can never
  // become two instances in the collection. Refused with a 400 (not
  // silently accepted) when the target row is not pending: a submitted,
  // scored, compliance-relevant record must never be silently rewritten
  // through this path — a retake uses the existing `retakeOf` field instead.
  if (instanceId) {
    const lane = assessLane(db);
    const pending = lane.find(i => i.id === instanceId);
    if (!pending) return res.status(404).json({ error: 'Assessment instance not found.' });
    if (pending.status !== 'pending') {
      return res.status(400).json({ error: 'This assessment instance is not pending completion.' });
    }
    // CR-01: only the session whose username matches the assigned `owner`
    // (set at assign-time via POST /api/assessment-instances/assign, and — per
    // that route's tests — expected to carry the intended completer's actual
    // username, not an arbitrary display label) or an elevated admin/hrbp
    // role may promote a pending row to submitted. Without this check any
    // deal member reachable via ROLE_WRITE_POLICY's self-service rule for
    // this route (even `employee`) could fabricate the completion of someone
    // else's assigned readiness assessment by reading its id off
    // GET /api/assessment-status and posting a fabricated score (04-REVIEW.md
    // CR-01). `req.portalUser` is guaranteed non-null here except in
    // anonymous DEMO_OPEN mode (no login, no MNPI content in the demo lane)
    // — the check is skipped there rather than false-failing on a null
    // identity, matching every other req.portalUser.username call site in
    // this file that assumes a real session whenever real deal data exists.
    if (req.portalUser) {
      const isElevated = ['admin', 'hrbp'].includes(req.portalUser.role);
      const ownerTrim = String(pending.owner || '').trim();
      const isOwner = !!ownerTrim && ownerTrim === req.portalUser.username;
      if (!isElevated && !isOwner) {
        return res.status(403).json({ error: 'You are not the assigned owner of this assessment.' });
      }
    }
    pending.rater = (template.raterModes || ['self']).includes(rater) ? rater : (pending.rater || 'self');
    pending.respondentRole = String(respondentRole || '').slice(0, 60);
    // IN-03: on this instanceId completion path specifically, respondentName
    // is stamped from the verified session identity above, never taken from
    // the request body — otherwise the legitimate owner (just verified) could
    // still complete their own assigned row while claiming to be a different
    // teammate, corrupting the record of who actually closed out the
    // obligation. req.portalUser is null only in anonymous DEMO_OPEN mode, in
    // which case the caller-supplied value is kept exactly as before (no real
    // identity exists to stamp instead). The non-instanceId (ad-hoc
    // self-service) submission path below is left untouched.
    pending.respondentName = req.portalUser ? req.portalUser.username : String(respondentName || '').slice(0, 120);
    pending.responses = responses;
    Object.assign(pending, scoresBlock);
    pending.status = 'submitted';
    pending.timestamp = new Date().toISOString();
    if (retakeOf) pending.retakeOf = retakeOf;
    if (!(db.settings && db.settings.demoMode === false)) {
      pending.demoDay = (db.settings && db.settings.timeTravelDay) || 30;
    }
    writeDb(db);
    return res.json({ success: true, instance: publicAssessInstance(pending) });
  }

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

// WIZ-01: the declared subject order the rollup's own bySubject output is
// reported in — acquirer, target, Integration Lead — so the report's order
// comes from THIS list, never from template array order, insertion order or
// instance timestamps. [security] Deviation from the plan's own interface
// contract text (Rule 1 auto-fix): the contract's literal example used 'il'
// as the third subject value, but every seeded IL readiness template
// (db.json/data/demo.db's atpl_il_readiness, copied verbatim into every new
// deal by db/dealSeed.js) actually carries subject: 'integration-leader' —
// verified live against the installed data, not assumed from the plan text.
// Using 'il' here would silently exclude the real IL template from the
// declared-order pass below (it would fall through to the "any subject not
// on the list" append-at-end branch instead of sorting third).
const WIZARD_ASSESSMENT_SUBJECTS = ['acquirer-org', 'target-org', 'integration-leader'];

// D-12-02 (Phase 12, plan 12-09): the collections the readiness rollup reads —
// settings (lane choice + time travel), customSettings (target company), the
// templates and BOTH instance lanes (assessLane() assigns whichever it does
// not return). A collection missed here throws CollectionNotLoadedError.
const ASSESSMENT_STATUS_SET = ['settings', 'customSettings', 'assessmentTemplates', 'assessmentInstances', 'customAssessmentInstances'];

// The pure response builder: (db, ctx) -> body, where ctx carries the two
// request-derived facts the rollup needs — `stripNames` (a locked-down posture
// for a non-admin) and `portalUser`. Exposed as app.assessmentStatusBody so
// the readCollections data path can be tested against the readDb() one.
function assessmentStatusBody(db, ctx) {
  const portalUser = ctx.portalUser;
  const templates = (db.assessmentTemplates || []).filter(t => t.published !== false);
  const visible = visibleAssessInstances(db);
  const required = [];
  const gatesSummary = {};
  const bySubject = {};
  const entriesBySubject = {};
  // In any locked-down posture the status rollup carries scores/bands only —
  // no respondent names (leader ratings are personal data) — unless the
  // requester is an admin.
  const stripNames = ctx.stripNames;
  const statusInstance = (inst) => {
    const pub = publicAssessInstance(inst);
    if (pub && stripNames) delete pub.respondentName;
    return pub;
  };
  templates.forEach(t => {
    const latest = latestAssessInstanceFor(visible, t.id, 'self');
    // WIZ-01/D-24: every PENDING instance for this template — reported
    // separately from `satisfied`/`latestInstance` (both derived from
    // submitted instances only, above) so a pending assessment never reads
    // as satisfied and never contributes a score. Ordered by due date, then
    // id, for a stable report regardless of assignment order.
    const pending = visible
      .filter(i => i.templateId === t.id && i.status === 'pending')
      .slice()
      .sort((a, b) => {
        const ad = String(a.dueDate || ''), bd = String(b.dueDate || '');
        if (ad !== bd) return ad < bd ? -1 : 1;
        return String(a.id) < String(b.id) ? -1 : 1;
      })
      .map(i => {
        // WR-01: `owner` is the same category of personal data statusInstance()
        // above already strips (respondentName) for every non-admin caller in
        // a locked-down posture — visible here only to admin/hrbp or the
        // assigned owner's own session, not to every deal member. `id` and
        // `dueDate` stay unconditionally visible: CR-01's ownership check
        // (above, on the completion route) is what actually gates who can
        // act on a pending row, so leaking the id alone no longer enables
        // fabricating a completion.
        const ownerTrim = String(i.owner || '').trim();
        const isElevated = !!portalUser && ['admin', 'hrbp'].includes(portalUser.role);
        const isOwner = !!portalUser && !!ownerTrim && ownerTrim === portalUser.username;
        const showOwner = !stripNames || isElevated || isOwner;
        return { id: i.id, owner: showOwner ? (i.owner || '') : '', dueDate: i.dueDate || '' };
      });
    const entry = {
      templateId: t.id, slug: t.slug, subject: t.subject,
      required: !!t.required, gates: t.gates || [],
      satisfied: !!latest,
      latestInstance: statusInstance(latest),
      pending
    };
    entriesBySubject[t.subject] = entry;
    if (t.required) required.push(entry);
    (t.gates || []).forEach(g => {
      gatesSummary[g] = gatesSummary[g] || { satisfied: true, blockedBy: [] };
      if (t.required && !latest) { gatesSummary[g].satisfied = false; gatesSummary[g].blockedBy.push(t.id); }
    });
  });
  // Insert into bySubject in WIZARD_ASSESSMENT_SUBJECTS's declared order —
  // any subject not on that list (none exist today) is appended afterward in
  // its original template order rather than silently dropped.
  const orderedSubjects = WIZARD_ASSESSMENT_SUBJECTS.filter(s => entriesBySubject[s]);
  Object.keys(entriesBySubject).forEach(s => { if (!orderedSubjects.includes(s)) orderedSubjects.push(s); });
  orderedSubjects.forEach(s => { bySubject[s] = entriesBySubject[s]; });

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
  return { success: true, targetCompany, required, bySubject, gatesSummary, compatibility };
}
app.assessmentStatusBody = assessmentStatusBody;

// GET the readiness rollup — single source of truth for every gate point in the UI
app.get('/api/assessment-status', (req, res) => {
  const db = readCollections(ASSESSMENT_STATUS_SET);
  // In any locked-down posture the status rollup carries scores/bands only —
  // no respondent names (leader ratings are personal data) — unless the
  // requester is an admin.
  res.json(assessmentStatusBody(db, {
    stripNames: lockedDown(req) && !isAdminRequest(req),
    portalUser: req.portalUser,
  }));
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

// D-12-02 (Phase 12, plan 12-09): the lane NAME taskLane() resolves, from the
// settings singleton alone — beside (never inside) taskLane(): the Phase 9
// structural test source-scans taskLane's body for exactly its two
// db.<collection> keys, and test/tasks-list-query asserts the two always agree
// for demoMode false / true / absent.
function taskLaneName(settings) {
  return settings && settings.demoMode === false ? 'customIntegrationTasks' : 'integrationTasks';
}

// The collections a task write handler needs: settings (lane choice), both
// lanes (the delete assigns whichever it does not read), and ddFindings (the
// provenance rule resolves `dd-finding:<id>` to that finding's area). A handler
// touching any other collection throws CollectionNotLoadedError naming it —
// add it here, never fall back to readDb().
const TASK_READ_SET = ['settings', 'integrationTasks', 'customIntegrationTasks', 'ddFindings'];

// RPT-01 (07-02): the SINGLE server-side port of public/js/execution.js's
// own client-side workstream rollup math (render()'s wsGrid block, ~line
// 130-144, and ragColor() ~line 105) — this is what lets the Reports export,
// the Execution Hub screen and (Plan 07-04's) the PDF pack's RAG strip agree
// on the same numbers. Reads the first checklist template's workstreams
// list plus taskLane(db); a workstream with zero tasks is dropped, matching
// the client's own `if (!ts.length) return '';` skip. Do NOT let a second
// consumer re-derive the RAG band from a percentage independently — call
// this function instead.
//
// [security] T-ERM-01/T-ERM-03 (260810-erm): `deal`/`portalUser` are now
// REQUIRED — the per-workstream task count is derived from reportTaskRows()
// (the same clearance-filtered read GET /api/integration-tasks uses), not
// the raw taskLane(db), so a hidden hr-retention task can no longer inflate
// the ws_hr count (and therefore the RAG band and pctComplete) for a caller
// who is not cleared to see that task exist at all — closes the count-
// inference side channel a purely-boolean/percentage rollup would otherwise
// leave open even after the title-level filter above closes the direct leak.
function computeWorkstreamRollup(db, deal, portalUser) {
  const template = (db.checklistTemplates || [])[0];
  const workstreams = (template && template.workstreams) || [];
  const tasks = reportTaskRows(db, deal, portalUser);
  const rows = [];
  workstreams.forEach((w) => {
    const ts = tasks.filter((t) => t.workstreamId === w.id);
    if (!ts.length) return;
    const tasksDone = ts.filter((t) => t.status === 'done').length;
    const blocked = ts.some((t) => t.status === 'blocked');
    const pctComplete = Math.round((tasksDone / ts.length) * 100);
    // Named form of execution.js's ragColor() thresholds: blocked always
    // wins red; otherwise green at/above 80, amber at/above 40, red below.
    const ragStatus = blocked ? 'red' : (pctComplete >= 80 ? 'green' : (pctComplete >= 40 ? 'amber' : 'red'));
    rows.push({ id: w.id, label: w.label, tasksTotal: ts.length, tasksDone, pctComplete, blocked, ragStatus });
  });
  return rows;
}

const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
const TASK_PHASES = ['pre', 'day1', 'd30', 'd60', 'd100'];

// What GET /api/integration-tasks accepts (PD-12). Same grammar as RAID plus the
// task-only `phase`; `q` scans the title (tasks carry no free-text notes).
const TASK_LIST_SPEC = {
  filters: { status: 'status', owner: 'owner', workstream: 'workstreamId', phase: 'phase' },
  enums: { status: TASK_STATUSES, phase: TASK_PHASES },
  search: ['title'],
};

// The task-lane rows of a projection read that the caller may see, judged by
// taskRowVisible() — the SAME predicate reportTaskRows() (export, pack,
// workstream rollup) filters with, so the paged list and the whole-db readers
// can never disagree about a task. Built lazily: the finding-area map is only
// read when an unstamped `dd-finding:` provenance is present.
function taskProjectionVisibleRows(rows, deal, portalUser) {
  let findingAreas = null;
  const findingAreaOf = (findingId) => {
    if (!findingAreas) {
      findingAreas = new Map();
      for (const r of readProjection('ddFindings', ['id', 'area'])) {
        if (findingAreas.has(r.f.id)) continue;
        findingAreas.set(r.f.id, r.f.area === null ? JSON.parse(r.raw).area : r.f.area);
      }
    }
    return findingAreas.has(findingId) ? findingAreas.get(findingId) : null;
  };
  return rows.filter((row) => {
    let { clearanceArea, source } = row.f;
    // A non-string stamp/source cannot be judged from the projection alone.
    if ((clearanceArea && typeof clearanceArea !== 'string') || (source && typeof source !== 'string')) {
      const full = JSON.parse(row.raw);
      clearanceArea = full.clearanceArea;
      source = full.source;
    }
    return taskRowVisible({ clearanceArea, source }, findingAreaOf, deal, portalUser);
  });
}

// D-12-02 / PD-10 / PD-12: the proportional task list read — one lane through a
// light projection, then taskRowVisible() BEFORE filters, total and page
// (T-12-80: `total` and `?q=` can never confirm a restricted task exists). No
// list parameter -> the legacy bare array, byte-identical to the previous
// reportTaskRows() output. [security] T-ERM-01 (260810-erm) clearance rule
// unchanged: reportTaskRows() remains the whole-db reader of the same rule.
app.get('/api/integration-tasks', (req, res) => {
  let parsed;
  try {
    parsed = listQuery.parseListQuery(req.query, TASK_LIST_SPEC);
  } catch (err) {
    if (err instanceof listQuery.ListQueryError) return res.status(400).json({ error: 'Invalid list query.' });
    throw err;
  }
  // Visibility below is the reportTaskRows() rule (taskRowVisible), evaluated
  // per row over projections instead of over a fully-read db object.
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = taskLaneName(readSingleton('settings'));
  const rows = readProjection(lane, listQuery.projectionFields(TASK_LIST_SPEC, parsed, ['clearanceArea', 'source']));
  const visible = taskProjectionVisibleRows(rows, deal, req.portalUser);
  listQuery.sendList(res, listQuery.applyListFilters(visible, parsed, TASK_LIST_SPEC), parsed);
});

// Create or update a task (upsert by id, like departments/processes)
app.post('/api/integration-tasks', (req, res) => {
  const b = req.body || {};
  const db = readCollections(TASK_READ_SET);
  const lane = taskLane(db);
  if (b.id) {
    const task = lane.find(t => t.id === b.id);
    // [security] D-11-03 / R1-02: missing AND out-of-clearance both answer
    // the central 404 `{ error: 'Not found' }` — placed BEFORE
    // conflictIfStale() (its 409 body would echo the record) and before any
    // field assignment below.
    const deal = controlStore.getDeal(req.dealContext && req.dealContext.dealId);
    assertRecordVisibleOr404(req, db, deal, task);
    // CONC-02 (Phase 9): the route-level precheck fast path — placed BEFORE
    // any field mutation below, including the status-flip branch (a kanban
    // quick action goes through the identical check as a full edit, D-02 —
    // no exemptions for a single-field payload). The clearanceFilter arms
    // the same rule on the WHERE-layer conflict throw (CR-01 / UF-2).
    if (conflictIfStale(req, res, task, { clearanceFilter: recordClearanceFilter(req, db, deal) })) return;
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
  const db = readCollections(TASK_READ_SET);
  const lane = taskLane(db);
  const task = lane.find(t => t.id === req.params.id);
  // [security] D-11-03 / R1-02: missing AND out-of-clearance both answer the
  // central 404 `{ error: 'Not found' }` (the retired `Task not found.` body
  // is gone — one body for every task/RAID not-found). BEFORE
  // conflictIfStale(): its 409 body would echo the record, and an unguarded
  // delete would let an uncleared member destroy a restricted record by id.
  const deal = controlStore.getDeal(req.dealContext && req.dealContext.dealId);
  assertRecordVisibleOr404(req, db, deal, task);
  // CONC-02 (Phase 9, Plan 06 / D-08): stale-delete rejection — this route
  // carries no JSON body (EmptyBodySchema), so the precondition travels via
  // ?expectedVersion=, resolved through the same parseExpectedVersion()
  // dual-channel contract conflictIfStale() already delegates to (Plan 02).
  // Deleting something already gone is not a conflict (the 404 above already
  // covers it) — this only fires when the record is present but stale.
  if (conflictIfStale(req, res, task, { clearanceFilter: recordClearanceFilter(req, db, deal) })) return;
  const filtered = lane.filter(t => t.id !== req.params.id);
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

// D-12-02 (12-09): reads exactly one collection.
function checklistTemplatesBody(db) {
  return db.checklistTemplates || [];
}
app.checklistTemplatesBody = checklistTemplatesBody;
app.get('/api/checklist-templates', (req, res) => {
  res.json(checklistTemplatesBody(readCollections(['checklistTemplates'])));
});

// =====================================================================
// Synergy tracker — initiatives with $M targets vs realized, lifecycle
// idea → validated → committed → captured (D-07).
// =====================================================================
function synergyLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customSynergyInitiatives = db.customSynergyInitiatives || []; return db.customSynergyInitiatives; }
  db.synergyInitiatives = db.synergyInitiatives || [];
  return db.synergyInitiatives;
}
// D-07/D-11: four ordered confidence stages — an INDEPENDENT COPY of
// validators/workstream.js's own SYN_STAGES and public/js/execution.js's
// own SYN_STAGES, mirroring the RAID_LEVELS/D-26 lockstep-copy convention
// (validators/workstream.js:139-147 below). All THREE MUST move together;
// a partial edit is this repository's documented repeat failure mode. This
// is a one-way cutover (D-07/D-11): the retired five-value vocabulary
// (identified/validated/planned/executing/realized) is refused, never
// coerced — enforced by test/synergy-stage.test.js's cross-file anti-drift
// assertion, never by review alone.
const SYN_STAGES = ['idea', 'validated', 'committed', 'captured'];

// SYN-01/D-05/D-24: fixed year-end cumulative-attainment checkpoints per
// curve shape — cost back-loads savings validation (30/70/100), revenue
// ramps slower given customer-facing lead time (10/40/70), linear is the
// neutral default (33/67/100). generatePhasingRows() below interpolates
// linearly BETWEEN these year-end checkpoints across each year's 12 months —
// a smooth monthly ramp, never a step at the year boundary.
const RAMP_CURVES = {
  cost: [0.30, 0.70, 1.00],
  revenue: [0.10, 0.40, 0.70],
  linear: [0.33, 0.67, 1.00],
};

// SYN-01: the same rounding contract as POST /api/synergies' own local
// `num()` helper below (parseFloat, NaN -> 0, clamp negative to 0, round to
// one decimal) — pulled out to module scope because generatePhasingRows()
// and the phasing sub-routes need it outside any single handler's closure.
// WR-02: reject non-finite results (e.g. parseFloat('1e400') === Infinity,
// well within SynMoneyUnion's 20-char string cap) rather than letting them
// through — Math.round(Infinity * 10) / 10 stays Infinity, which
// JSON.stringify() silently serializes as `null`, corrupting the stored
// figure with no 400/warning anywhere. isNaN(v) alone did not catch this,
// since Infinity is not NaN.
function roundSynergyMoney(v) {
  const n = parseFloat(v);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 10) / 10);
}

// SYN-01/D-01/D-03/D-05/D-24: generates horizonYears*12 consecutive monthly
// phasing rows starting at startMonth, ramped per curveShape's checkpoints.
// Month arithmetic is integer year/month math — never Date-object month
// addition, which drifts across DST/locale edge cases. A row's targetM is
// that row's interpolated CUMULATIVE attainment fraction multiplied by the
// annual run-rate, divided by 12 (D-24) — never a year-boundary step.
function generatePhasingRows(runRateM, startMonth, curveShape, horizonYears) {
  const checkpoints = RAMP_CURVES[curveShape] || RAMP_CURVES.linear;
  const [startYear, startMon] = String(startMonth).split('-').map(Number);
  const rate = roundSynergyMoney(runRateM);
  // CR-01: a SECOND, independent clamp on the row count — belt and braces
  // alongside synergyHorizonYears()'s own [1, 15] clamp, since the settings
  // route is not the only way a value could land here (a future caller
  // passing horizonYears directly, bypassing the settings singleton
  // entirely, must still be bounded before the synchronous allocation loop
  // below runs).
  const clampedHorizonYears = Math.min(Math.max(horizonYears | 0, 0), 15);
  const totalRows = clampedHorizonYears * 12;
  const rows = [];
  for (let i = 1; i <= totalRows; i++) {
    const absMonthIndex = (startMon - 1) + (i - 1);
    const rowYear = startYear + Math.floor(absMonthIndex / 12);
    const rowMonth = (absMonthIndex % 12) + 1;
    const month = rowYear + '-' + String(rowMonth).padStart(2, '0');

    const yearBucket = Math.ceil(i / 12);
    const monthWithinYear = i - (yearBucket - 1) * 12;
    const lastCheckpoint = checkpoints[checkpoints.length - 1];
    const prevCheckpoint = yearBucket === 1 ? 0 : (checkpoints[yearBucket - 2] !== undefined ? checkpoints[yearBucket - 2] : lastCheckpoint);
    const nextCheckpoint = checkpoints[yearBucket - 1] !== undefined ? checkpoints[yearBucket - 1] : lastCheckpoint;
    const attainment = prevCheckpoint + (nextCheckpoint - prevCheckpoint) * (monthWithinYear / 12);

    rows.push({
      month,
      targetM: roundSynergyMoney((attainment * rate) / 12),
      realizedM: 0,
    });
  }
  return rows;
}

// SYN-01/D-03: horizon length in years, read from the deal's own settings
// singleton, defaulting to 3 — the settings key itself is registered in
// Plan 05; this reader tolerates its absence today rather than throwing.
// CR-01: clamped to [1, 15] defensively, in addition to the schema bound in
// validators/settings.js's SettingsUpdateSchema — this reader is the second
// belt-and-braces layer, since a value already stored before the schema
// bound shipped (or written through any future non-validated path) must not
// let generatePhasingRows() allocate an unbounded number of monthly rows on
// the single-threaded request thread.
// D-11-02 (Phase 11): the optional second argument is the caller's deal-level
// values (dealSettingsFor(req) — null on the demo store). Precedence: a usable
// deal value > the db.settings singleton > the default, with the SAME clamp
// applied to whichever source wins. Unit tests that call this with one
// argument keep exactly the pre-existing behaviour.
function synergyHorizonYears(db, dealSettings) {
  const fromDeal = dealSettings && dealSettings.synergyHorizonYears;
  const configured = (typeof fromDeal === 'number' && isFinite(fromDeal))
    ? fromDeal
    : (db.settings && db.settings.synergyHorizonYears);
  const n = typeof configured === 'number' && isFinite(configured) ? configured : 3;
  return Math.min(Math.max(n, 1), 15);
}

// SYN-01/D-06: wall-clock "has this month started" check, mirroring
// computeOverdue()'s established real-clock precedent (below in this file)
// — deliberately NO timeTravelDay branch, in demo mode or real-deal mode
// (05-RESEARCH.md Finding A1, flagged in this plan's objective).
function monthHasArrived(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return false;
  return month <= new Date().toISOString().slice(0, 7);
}

// D-08: ordinal lookup DERIVED from SYN_STAGES — never a fifth hand-written
// copy of the vocabulary. { idea: 0, validated: 1, committed: 2, captured: 3 }.
const STAGE_ORDER = SYN_STAGES.reduce((acc, stage, i) => { acc[stage] = i; return acc; }, {});

// D-08: minimal hard gates, enforced server-side, with a stated rejection
// reason. Because the gates are cumulative confidence levels, a jump
// straight to a later stage (e.g. idea -> captured) must satisfy EVERY gate
// between the current ordinal and the target ordinal, not only the target's
// own — this is why the loop below walks every intervening stage rather
// than switching on targetStage alone. Returns the user-facing reason string
// (this is what the client alerts verbatim) when blocked, null when allowed.
function stageGateFailure(item, targetStage) {
  const fromOrdinal = STAGE_ORDER[item.stage];
  const toOrdinal = STAGE_ORDER[targetStage];
  for (let ord = fromOrdinal + 1; ord <= toOrdinal; ord++) {
    const stage = SYN_STAGES[ord];
    if (stage === 'committed') {
      const owner = String(item.owner || '').trim();
      if (!owner) return 'Advancing to committed requires an owner to be set.';
      const hasPhasedTarget = (item.runRateM || 0) > 0 && !!item.startMonth;
      if (!hasPhasedTarget) return 'Advancing to committed requires a phased target — a run-rate and a start month.';
    }
    if (stage === 'captured') {
      // D-06/D-08: realized value counted ONLY from months passing
      // monthHasArrived() — reusing the one arrival implementation rather
      // than a second that could disagree.
      const rows = Array.isArray(item.phasing) ? item.phasing : [];
      const hasArrivedRealizedValue = rows.some((row) => (row.realizedM || 0) > 0 && monthHasArrived(row.month));
      if (!hasArrivedRealizedValue) return 'Advancing to captured requires realized value recorded in at least one arrived month.';
    }
  }
  return null;
}

// CR-03: after a mutation that can invalidate a HIGHER stage's already-passed
// gate without moving the item through the /stage route (currently: phasing
// regeneration, which resets every row's realizedM to 0 — the ONLY thing the
// captured gate depends on), walks the ordinal DOWN from item.stage to the
// highest stage whose own gate re-checks satisfied against the item's
// CURRENT fields. Reuses stageGateFailure() one ordinal at a time — probing
// `stageGateFailure({...item, stage: SYN_STAGES[ord-1]}, SYN_STAGES[ord])`
// checks EXACTLY stage `ord`'s own gate (the loop inside stageGateFailure
// runs for a single ordinal when from/to are one apart), never re-walking
// gates below it that were never at risk. `idea` (ordinal 0) carries no
// gate, so this always terminates. Returns the item's stage unchanged when
// no demotion is needed.
function demoteToSatisfiedStage(item) {
  let ord = STAGE_ORDER[item.stage];
  while (ord > 0) {
    const probe = Object.assign({}, item, { stage: SYN_STAGES[ord - 1] });
    if (!stageGateFailure(probe, SYN_STAGES[ord])) break;
    ord -= 1;
  }
  return SYN_STAGES[ord];
}

// D-12/D-13/D-14: append-only baseline snapshot list. Version is derived
// from the HIGHEST existing version, never the array length (T-05-16), so a
// future deletion path could never silently reuse a version number. The
// targetCurve deep copy is load-bearing per D-12 — a shared reference to
// item.phasing would let a pinned baseline drift forward as the live rows
// are edited afterwards (proven by test/synergy-stage.test.js's D-12 case).
// Returns the appended entry.
function pushBaseline(item, req, reason) {
  item.baselines = Array.isArray(item.baselines) ? item.baselines : [];
  const maxVersion = item.baselines.reduce((max, entry) => Math.max(max, entry.version || 0), 0);
  const entry = {
    id: newId('bl'),
    version: maxVersion + 1,
    at: new Date().toISOString(),
    by: req.portalUser.username,
    stage: item.stage,
    runRateM: item.runRateM,
    startMonth: item.startMonth,
    curveShape: item.curveShape,
    targetCurve: (Array.isArray(item.phasing) ? item.phasing : []).map((row) => ({ month: row.month, targetM: row.targetM })),
    reason,
  };
  item.baselines.push(entry);
  return entry;
}

// SYN-01/D-04: targetM/realizedM become the derived rollup of an
// initiative's phasing rows once any exist; an initiative with zero rows
// keeps today's independently-writable pair, passed through unchanged.
function synergyRollupFields(item) {
  if (!item) return { targetM: 0, realizedM: 0 };
  if (!Array.isArray(item.phasing) || item.phasing.length === 0) {
    return { targetM: item.targetM || 0, realizedM: item.realizedM || 0 };
  }
  const targetM = roundSynergyMoney(item.phasing.reduce((a, r) => a + (r.targetM || 0), 0));
  const realizedM = roundSynergyMoney(item.phasing.reduce((a, r) => a + (r.realizedM || 0), 0));
  return { targetM, realizedM };
}

// SYN-02/D-20/D-21: cost incurred is the rounded sum of costEntries[]
// amounts; net benefit is derived realized (synergyRollupFields().realizedM)
// minus cost incurred, deliberately NOT clamped at zero — a negative net
// benefit is a real, expected early-deal state (more spent than realized so
// far) that a steering committee needs to see, not a floor that hides it.
// A dated entry's month bucket is its own date's first seven characters
// (YYYY-MM) — this is what makes monthly net benefit computable against the
// D-01 phasing grid without a second, parallel cost grid.
function synergyCostFields(item) {
  const entries = Array.isArray(item && item.costEntries) ? item.costEntries : [];
  const costIncurredM = roundSynergyMoney(entries.reduce((a, e) => a + (e.amountM || 0), 0));
  const realizedM = synergyRollupFields(item).realizedM;
  const netBenefitM = Math.round((realizedM - costIncurredM) * 10) / 10;
  return { costIncurredM, netBenefitM };
}

// SYN-05/D-17: staleness threshold in days, read from the deal's own
// settings singleton, defaulting to 30 — mirrors synergyHorizonYears()'s
// shape exactly. A non-positive, non-finite or non-numeric configured value
// falls back to the default rather than producing a nonsensical verdict, or
// (per T-05-27) letting a hostile value suppress the signal by making every
// item permanently fresh.
// WR-03: capped at 365 defensively, in addition to the schema bound in
// validators/settings.js's SettingsUpdateSchema — this reader is the second
// belt-and-braces layer (mirrors synergyHorizonYears()'s CR-01 fix), since a
// value already stored before the schema bound shipped must not be able to
// suppress the staleness signal permanently.
// D-11-02 (Phase 11): the optional second argument is the caller's deal-level
// values (dealSettingsFor(req) — null on the demo store). Precedence: a usable
// (finite, positive) deal value > db.settings > the 30-day default, then the
// 365-day ceiling — an unusable deal value falls through rather than
// poisoning the verdict (T-05-27 / T-11-14).
function synergyStaleDays(db, dealSettings) {
  const fromDeal = dealSettings && dealSettings.synergyStaleDays;
  const configured = (typeof fromDeal === 'number' && isFinite(fromDeal) && fromDeal > 0)
    ? fromDeal
    : (db.settings && db.settings.synergyStaleDays);
  const n = typeof configured === 'number' && isFinite(configured) && configured > 0 ? configured : 30;
  return Math.min(n, 365);
}

// D-11-02 (Phase 11): the deal-level values (validators/wizard.js
// DealSettingsSchema) of the deal THIS request is bound to, or null. The demo
// store has no deal record — it keeps reading db.settings, so the showcase is
// unchanged — and a request with no deal context has none either. Read from
// the control.db registry record (the same source every other deal-record
// reader in this file uses), never from the request.
function dealSettingsFor(req) {
  if (!req || req.isDemo === true || !req.dealContext || !req.dealContext.dealId) return null;
  const deal = controlStore.getDeal(req.dealContext.dealId);
  return (deal && deal.dealSettings) || null;
}

// SYN-05/D-16/D-17: an initiative's own confirmation clock, judged against a
// caller-supplied instant. `nowMs` is a PARAMETER, never read internally —
// this is what lets a caller capture Date.now() ONCE per request and judge
// every initiative in that request against the identical instant, so two
// initiatives sharing a lastConfirmedAt always receive the same verdict and
// no item can flip mid-loop. Falls back to `createdAt` when `lastConfirmedAt`
// is absent; when NEITHER parses to a finite timestamp this reports NOT
// STALE rather than defaulting an unknown-age item to stale — a false stale
// badge on every legacy row (carrying neither field) would train the reader
// to ignore the signal entirely. Strictly greater than the threshold is the
// boundary contract: exactly `staleDays` days old is not yet stale.
function isSynergyStale(item, staleDays, nowMs) {
  const raw = (item && item.lastConfirmedAt) || (item && item.createdAt);
  const parsed = Date.parse(raw);
  if (!isFinite(parsed)) return false;
  return (nowMs - parsed) > (staleDays * 86400000);
}

// RPT-04/D-14 (07-04-PLAN.md Task 2, 07-UI-SPEC.md §4): the pack's stale tag
// needs a whole-day age count behind isSynergyStale()'s boolean — the
// screen's own `.syn-stale-badge` only ever showed the exact date in a
// hover title, never an inline count. `nowMs` is the SAME single-clock
// parameter isSynergyStale() takes (captured ONCE per request by the
// caller's ctx, never read internally here) and this resolves the SAME
// lastConfirmedAt-falling-back-to-createdAt timestamp isSynergyStale() does,
// so the day count and the boolean can never disagree about which
// timestamp they are judging or which instant they are judged against.
// Returns null (never 0, which would misleadingly read as "confirmed
// today") when neither timestamp parses to a finite instant — mirroring
// isSynergyStale()'s own never-default-unknown-age-to-stale contract; an
// unknown-age item must never carry a false day count either.
function synergyStaleDayCount(item, nowMs) {
  const raw = (item && item.lastConfirmedAt) || (item && item.createdAt);
  const parsed = Date.parse(raw);
  if (!isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 86400000));
}

// SYN-05/D-16: an EXPLICIT ALLOWLIST of the fields that constitute a real
// value change on the base upsert — title and notes are deliberately
// excluded (a typo fix must not make a six-week-old forecast look
// confirmed). Expressed as an allowlist rather than a denylist of the two
// excluded fields so a future field added to the upsert defaults to NOT
// stamping unless explicitly added here too.
const SYNERGY_STAMPING_FIELDS = ['runRateM', 'curveShape', 'startMonth', 'costPlannedM', 'costExpectedMonth', 'category', 'owner', 'workstreamId', 'taskIds'];

// SYN-04/D-22/T-05-18: validates every supplied taskIds entry against the
// bound deal's OWN task lane (taskLane(db), resolved by the Phase 3
// session-bound resolver) BEFORE any mutation — an id from another deal or a
// nonexistent id is simply not found in this lane, so the whole request is
// refused with no partial write. Deduplicates while preserving first-seen
// order. Does not touch taskLane() itself or any task-side field (D-22).
//
// [security] D-11-03 / T-11-25 (Phase 11): "found in this lane" now also
// means VISIBLE to the caller. A task outside the caller's clearance (an
// hr-area converted task for an uncleared member) is reported EXACTLY like
// an unknown id — the same `Unknown task id: <id>` message, which only
// echoes the id the caller itself supplied — so the link route cannot be
// used as an existence/content oracle for restricted tasks.
//
// `existing` (update only) is the initiative's currently stored taskIds. A
// restricted link the caller cannot see is PRESERVED (returned in
// `preserved`, appended by the route) rather than silently dropped by an
// edit from an uncleared member who never saw it — the caller can neither
// add nor remove a link it is not cleared for.
function resolveSynergyTaskIds(taskIds, db, req, deal, existing) {
  const lane = taskLane(db);
  const known = new Set();
  const hidden = new Set();
  lane.forEach((t) => {
    if (recordVisibleTo(req, db, deal, t)) known.add(t.id);
    else hidden.add(t.id);
  });
  const seen = new Set();
  const ids = [];
  for (const id of taskIds) {
    if (!known.has(id)) return { ok: false, error: `Unknown task id: ${id}` };
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  const preserved = Array.isArray(existing)
    ? existing.filter((id) => hidden.has(id) && !seen.has(id))
    : [];
  return { ok: true, ids, preserved };
}

// SYN-05/D-18/D-19/RPT-04: the item merged with every derived field this
// phase's routes attach — the rollup totals (synergyRollupFields), the cost
// fields (synergyCostFields), the `stale` boolean (isSynergyStale), and the
// whole-day `staleDays` age count behind it (synergyStaleDayCount). `ctx` is
// built ONCE per request by the caller (GET /api/synergies,
// GET /api/synergies/rollup and GET /api/reports/export's synergies branch)
// — its `staleDays` (the deal's configured THRESHOLD) and `nowMs` are read
// once and reused for every item in that request, so two initiatives
// sharing a lastConfirmedAt are always judged against the identical instant
// and no item can flip mid-loop (SYN-05 adjacency). Note the per-item
// `staleDays` field this function attaches is a DIFFERENT number from
// `ctx.staleDays` — one is this item's own age, the other is the deal-wide
// threshold it is judged against; both happen to share the name the rest of
// this codebase already uses for each concept.
function enrichSynergy(item, ctx) {
  return Object.assign({}, item, synergyRollupFields(item), synergyCostFields(item), {
    stale: isSynergyStale(item, ctx.staleDays, ctx.nowMs),
    staleDays: synergyStaleDayCount(item, ctx.nowMs),
  });
}

// RPT-01/RPT-02 (07-06 Task 2/T-07-28): the SINGLE enriched-synergies read
// (with the SAME sorted-costEntries mapping) both GET /api/reports/export's
// synergies branch AND GET /api/reports/pack call — factored out so a future
// change can never make the CSV/JSON export and the PDF pack disagree about
// a caller's synergy rows (D-08). Synergies carry no per-item clearance
// concept today (every deal member sees every initiative), so this is an
// enrichment pass, not a filter.
function reportSynergyRows(db, ctx, visibleLinks) {
  const lane = synergyLane(db);
  const project = typeof visibleLinks === 'function' ? visibleLinks : (item) => item;
  return lane.map((raw) => {
    const item = project(raw);
    const entries = Array.isArray(item.costEntries) ? item.costEntries : [];
    const sortedCostEntries = entries.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return Object.assign({}, enrichSynergy(item, ctx), { costEntries: sortedCostEntries });
  });
}

// RPT-03 (07-06 Task 1/07-UI-SPEC.md §5 Section 4, amended 2026-08-09): the
// stage recorded at the initiative's LAST baseline snapshot — resolved here,
// server-side, so lib/reportPack.js's synergiesSection never has to read
// item.baselines itself (that module performs no database logic by design).
// Version is the append-only ordering key (pushBaseline() above never reuses
// or relies on array position), so "last" means highest version, not
// baselines[baselines.length - 1] — the two coincide today since baselines
// are only ever appended, but resolving by version is the correct contract
// regardless. Returns null (never a placeholder string) when the initiative
// has no baseline history yet — lib/reportPack.js renders that as an em-dash.
function stageAtLastBaseline(item) {
  const baselines = Array.isArray(item && item.baselines) ? item.baselines : [];
  if (!baselines.length) return null;
  const last = baselines.reduce((a, b) => ((b.version || 0) > (a.version || 0) ? b : a));
  return last.stage || null;
}

// [security] IN-01 (Phase 11 review): an initiative's stored `taskIds` keep
// links to tasks the reader may not see (resolveSynergyTaskIds() preserves a
// hidden link on an uncleared edit — correct for the WRITE). On the READ the
// ids of existing tasks outside the caller's clearance are dropped, so the
// list is no longer a count/existence oracle for restricted tasks (the same
// recordVisibleTo() rule the task routes 404 on). Ids that resolve to no task
// at all carry no information and are left as stored.
function synergyLinksVisibleTo(req, db) {
  const deal = controlStore.getDeal(req.dealContext && req.dealContext.dealId);
  const hidden = new Set();
  taskLane(db).forEach((t) => { if (!recordVisibleTo(req, db, deal, t)) hidden.add(t.id); });
  return (item) => {
    if (!hidden.size || !Array.isArray(item.taskIds) || !item.taskIds.some((id) => hidden.has(id))) return item;
    return Object.assign({}, item, { taskIds: item.taskIds.filter((id) => !hidden.has(id)) });
  };
}

// D-12-02 (Phase 12, plan 12-09): the collections the synergy reads need —
// settings (lane choice + staleness threshold), both synergy lanes
// (synergyLane() assigns the one it does not return), the task lanes and
// ddFindings (synergyLinksVisibleTo -> taskLane + recordVisibleTo ->
// resolveTaskClearanceArea -> ddFindingsLane). The rollup needs only the first
// three; a collection missed throws CollectionNotLoadedError.
const SYNERGY_ROLLUP_SET = ['settings', 'synergyInitiatives', 'customSynergyInitiatives'];
const SYNERGY_READ_SET = SYNERGY_ROLLUP_SET.concat(['integrationTasks', 'customIntegrationTasks', 'ddFindings']);

// Pure response builder (db, req, nowMs) -> body; exposed as app.synergiesBody.
function synergiesBody(db, req, nowMs) {
  const lane = synergyLane(db);
  // SYN-05: ctx built ONCE per request — every item in this response is
  // judged against the identical clock and threshold.
  const ctx = { staleDays: synergyStaleDays(db, dealSettingsFor(req)), nowMs };
  const visibleLinks = synergyLinksVisibleTo(req, db); // IN-01
  return lane.map((raw) => {
    const item = visibleLinks(raw);
    const entries = Array.isArray(item.costEntries) ? item.costEntries : [];
    // SYN-02: newest-date-first, a STABLE sort (Array.prototype.sort() is
    // spec-guaranteed stable) run against a COPY of the stored array — two
    // same-date entries keep their original insertion order between reads,
    // and the stored array itself is never reordered.
    const sortedCostEntries = entries.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return Object.assign({}, enrichSynergy(item, ctx), { costEntries: sortedCostEntries });
  });
}
app.synergiesBody = synergiesBody;

app.get('/api/synergies', (req, res) => {
  res.json(synergiesBody(readCollections(SYNERGY_READ_SET), req, Date.now()));
});

// SYN-05/D-18/D-19/D-21: a single server-computed object a report can read
// directly — gross realized, cost incurred, net benefit, deal target, the
// unconfirmed portion of gross realized, a total stale count, and a
// caller-scoped stale count. Every figure sums per-item values that were
// already rounded to one decimal inside enrichSynergy() — round only at the
// item level, never re-round the aggregate upward. Defined adjacent to
// GET /api/synergies so the two read paths sit together.
//
// T-05-47/D-01/D-02/D-03: `grossRealizedM` is REDEFINED here — it used to
// sum every item's realizedM; it now sums ONLY items that have at least one
// phasing row (the phased partition). Free-typed realized money on an
// initiative with no phasing rows is real but not forecast-backed, and
// blending it into the steering-committee headline overstated confidence —
// this is the standing Phase-5 debt this closes. `unphasedRealizedM` is the
// new field carrying the complementary (unphased) partition's sum. D-02:
// this split is computed ONCE, here, so the execution-tab tile row and (Plan
// 07-05) the PDF pack both read this one response and can never disagree.
// D-03: the partition is derived at read time on the SAME has-phasing
// predicate synergyRollupFields() already uses — no migration, no stored
// flag; an initiative that gains phasing rows moves partitions on its very
// next read with no intervention. `grossRealizedM + unphasedRealizedM`
// conserves the old undifferentiated total (money is relabelled, never
// created or lost) — proven by test/synergy-rollup-split.test.js.
//
// `costIncurredM`, `netBenefitM`, `dealTargetM`, `unconfirmedRealizedM` and
// `staleCount` deliberately keep summing the FULL enriched array,
// unpartitioned — cost/target/staleness are not phasing-dependent concepts.
// `netBenefitM` is derived from the REDEFINED (phased-only) `grossRealizedM`
// minus cost, so it moves with the redefinition too — a reader expecting it
// to still reflect the old undifferentiated total will not get that; this is
// the intended consequence of D-01, not an oversight. Because
// `unconfirmedRealizedM` sums over the FULL array while `grossRealizedM` now
// sums only the phased partition, the old "unconfirmed can never exceed
// gross" invariant is no longer stated against `grossRealizedM` alone — it
// now holds against `grossRealizedM + unphasedRealizedM` (the conserved
// total), which is what test/synergy-rollup-split.test.js asserts.
// WR-05 fix (07-REVIEW.md): the SINGLE phased/unphased rollup-split
// computation GET /api/synergies/rollup AND GET /api/reports/pack both call
// — factored out so a future change to the split's definition (e.g. a new
// partition rule, a rounding-order change) applied to one call site is
// automatically applied to the other, and the on-screen synergy rollup and
// the PDF pack's page-one/Section-4 numbers can never silently disagree
// (the exact "double-counting drift" the T-05-47/D-01/D-02 comments above
// describe preventing). Computes the FULL set of fields every caller might
// need — the rollup route uses all seven; the pack route currently only
// needs `staleCount` — so each caller reads what it needs from one shared
// result rather than re-deriving any of it.
function computeSynergyRollupSplit(enrichedItems) {
  const hasPhasing = (i) => Array.isArray(i.phasing) && i.phasing.length > 0;
  const phasedItems = enrichedItems.filter(hasPhasing);
  const unphasedItems = enrichedItems.filter((i) => !hasPhasing(i));

  const grossRealizedM = roundSynergyMoney(phasedItems.reduce((a, i) => a + (i.realizedM || 0), 0));
  const unphasedRealizedM = roundSynergyMoney(unphasedItems.reduce((a, i) => a + (i.realizedM || 0), 0));
  const costIncurredM = roundSynergyMoney(enrichedItems.reduce((a, i) => a + (i.costIncurredM || 0), 0));
  const netBenefitM = Math.round((grossRealizedM - costIncurredM) * 10) / 10;
  const dealTargetM = roundSynergyMoney(enrichedItems.reduce((a, i) => a + (i.targetM || 0), 0));
  const staleItems = enrichedItems.filter((i) => i.stale);
  const unconfirmedRealizedM = roundSynergyMoney(staleItems.reduce((a, i) => a + (i.realizedM || 0), 0));
  const staleCount = staleItems.length;

  return { grossRealizedM, unphasedRealizedM, costIncurredM, netBenefitM, dealTargetM, staleCount, unconfirmedRealizedM };
}

// Pure response builder (db, req, nowMs) -> body; exposed as app.synergyRollupBody.
function synergyRollupBody(db, req, nowMs) {
  const lane = synergyLane(db);
  // SYN-05: the SAME single-clock ctx pattern as GET /api/synergies above —
  // one captured instant, reused for every item this rollup sums.
  // D-11-02: the deal-level values (staleness threshold, synergy target)
  // come from the bound deal's own record; null on the demo store.
  const dealSettings = dealSettingsFor(req);
  const ctx = { staleDays: synergyStaleDays(db, dealSettings), nowMs };
  const enriched = lane.map((item) => enrichSynergy(item, ctx));

  const split = computeSynergyRollupSplit(enriched);
  const { grossRealizedM, unphasedRealizedM, costIncurredM, netBenefitM, dealTargetM, unconfirmedRealizedM, staleCount } = split;

  // `mine.staleCount` mirrors GET /api/dd/summary's owner-comparison idiom
  // exactly — derived from the SAME enriched array the totals above came
  // from, so the deal-home nudge and the card badges can never disagree
  // (D-19). Read only from the server-resolved session identity, never a
  // client-supplied username. Re-filters `enriched` for stale items rather
  // than reading them off `split` — computeSynergyRollupSplit() returns the
  // aggregate `staleCount` number, not the intermediate staleItems array,
  // since no other caller needs the array itself.
  const myUsername = String((req.portalUser && req.portalUser.username) || '').trim();
  const mineStaleCount = enriched.filter((i) => i.stale && String(i.owner || '').trim() === myUsername).length;

  return {
    grossRealizedM,
    unphasedRealizedM,
    costIncurredM,
    netBenefitM,
    dealTargetM,
    // D-11-02: the Integration Lead's own deal-level synergy target (set on
    // POST /api/deals/:id/setup) — null when none was set, and always null on
    // the demo store. `dealTargetM` above stays the sum of initiative targets.
    dealSynergyTargetM: dealSettings && typeof dealSettings.synergyTargetM === 'number' ? dealSettings.synergyTargetM : null,
    // The threshold (days) this response's stale verdicts were judged against.
    staleThresholdDays: ctx.staleDays,
    unconfirmedRealizedM,
    staleCount,
    mine: { staleCount: mineStaleCount },
  };
}
app.synergyRollupBody = synergyRollupBody;

app.get('/api/synergies/rollup', (req, res) => {
  res.json(synergyRollupBody(readCollections(SYNERGY_ROLLUP_SET), req, Date.now()));
});

app.post('/api/synergies', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  // WR-02: this local closure used to duplicate roundSynergyMoney()'s
  // rounding contract independently (isNaN-only, no isFinite guard) rather
  // than calling the shared helper — so fixing roundSynergyMoney() alone
  // left this route's targetM/realizedM/runRateM/costPlannedM fields still
  // vulnerable to the same Infinity-serializes-to-null corruption on both
  // the create and update branches below. Delegates to the shared,
  // now-fixed helper instead of re-implementing it.
  const num = roundSynergyMoney;
  if (b.id) {
    const item = lane.find(s => s.id === b.id);
    if (!item) return res.status(404).json({ error: 'Initiative not found.' });
    // CONC-02 (Phase 9): the route-level precheck fast path — placed BEFORE
    // any field mutation below, including the SYN-05 stamping-field
    // computation next.
    if (conflictIfStale(req, res, item)) return;
    // SYN-05/D-16: computed from the RAW body before any mutation below —
    // whether this edit touches ANY field in the SYNERGY_STAMPING_FIELDS
    // allowlist. Title and notes are deliberately absent from that list.
    const changesStampingField = SYNERGY_STAMPING_FIELDS.some((k) => b[k] !== undefined);
    // Validate before mutating the shared readDb() cache (see task update).
    // VAL-01: status enum membership is now owned exclusively by
    // validators/workstream.js's SynergyUpsertSchema (z.enum); the
    // empty-title-on-update check is NOT covered by that schema's refine()
    // (which only requires a title when `id` is absent) and stays here.
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'Initiative title cannot be empty.' });
    }
    // SYN-01/D-04/T-05-02: once an initiative carries phasing rows,
    // targetM/realizedM are a DERIVED rollup of those rows — this is the
    // base-upsert half of the forward-booking guard (the dedicated
    // per-month sub-route is the only writable path once rows exist).
    if (Array.isArray(item.phasing) && item.phasing.length > 0 && (b.targetM !== undefined || b.realizedM !== undefined)) {
      return res.status(400).json({ error: 'This initiative is phased — edit targetM/realizedM per month on the phasing grid, not on the initiative directly.' });
    }
    // SYN-04/D-22/T-05-18: resolved (validated + deduplicated) BEFORE any
    // mutation below — a bad id must never leave a half-written list behind.
    // An absent `taskIds` key leaves `resolvedTaskIds` undefined, so the
    // assignment below is skipped and the stored list is untouched; an
    // explicitly empty array resolves to [] and clears it.
    let resolvedTaskIds;
    if (b.taskIds !== undefined) {
      const taskDeal = controlStore.getDeal(req.dealContext && req.dealContext.dealId);
      const resolution = resolveSynergyTaskIds(b.taskIds, db, req, taskDeal, item.taskIds);
      if (!resolution.ok) return res.status(400).json({ error: resolution.error });
      resolvedTaskIds = resolution.ids.concat(resolution.preserved);
    }
    ['title', 'owner', 'workstreamId', 'notes'].forEach(k => { if (b[k] !== undefined) item[k] = String(b[k] || '').slice(0, 300); });
    if (b.category !== undefined) item.category = b.category === 'cost' ? 'cost' : 'revenue';
    if (b.targetM !== undefined) item.targetM = num(b.targetM);
    if (b.realizedM !== undefined) item.realizedM = num(b.realizedM);
    if (resolvedTaskIds !== undefined) item.taskIds = resolvedTaskIds;
    // D-08/T-05-13: the stage gate has no bypass — a stage change must go
    // through the dedicated POST /api/synergies/:id/stage route, which alone
    // evaluates stageGateFailure() and appends a reasoned demotion baseline
    // (D-09). No other field on this generic edit may set the stage.
    if (b.stage !== undefined) {
      return res.status(400).json({ error: 'Stage changes must go through POST /api/synergies/:id/stage.' });
    }
    // D-13: once an initiative has reached committed, a run-rate or
    // curve-shape change is a forced re-baseline event — require a reason
    // and pin the PRE-CHANGE state (via pushBaseline(), called BEFORE the
    // fields below are mutated) so the baseline records what was superseded,
    // not what replaced it. Below committed these stay ordinary edits.
    const changesRunRateOrCurve = b.runRateM !== undefined || b.curveShape !== undefined;
    if (changesRunRateOrCurve && STAGE_ORDER[item.stage] >= STAGE_ORDER.committed) {
      const reasonTrim = String(b.reason || '').trim();
      if (!reasonTrim) {
        return res.status(400).json({ error: 'A reason is required to change run-rate or curve shape once this initiative has reached committed.' });
      }
      pushBaseline(item, req, reasonTrim);
    }
    if (b.runRateM !== undefined) item.runRateM = num(b.runRateM);
    if (b.curveShape !== undefined) item.curveShape = b.curveShape;
    // SYN-05/D-16: startMonth was schema-accepted since Plan 01 but never
    // applied by this update branch (schema/handler drift, mirroring Plan
    // 03's identical runRateM/curveShape finding) — wired in here since
    // SYN-05's stamping allowlist names it as a real value-change field, and
    // a field that can never actually change must not be listed among the
    // fields that refresh the confirmation clock.
    if (b.startMonth !== undefined) item.startMonth = b.startMonth;
    // SYN-02/D-20/D-21: ordinary plan fields — unlike runRateM/curveShape
    // above, a costPlannedM/costExpectedMonth change never triggers D-13's
    // forced re-baseline regardless of stage.
    if (b.costPlannedM !== undefined) item.costPlannedM = num(b.costPlannedM);
    if (b.costExpectedMonth !== undefined) item.costExpectedMonth = b.costExpectedMonth;
    // SYN-05/D-16: stamp the confirmation clock LAST, after every field
    // mutation above, so it reflects the fully-applied state of this edit.
    if (changesStampingField) item.lastConfirmedAt = new Date().toISOString();
    writeDb(db);
    return res.json({ success: true, initiative: item });
  }
  // VAL-01: title-required-on-create is now owned exclusively by
  // validators/workstream.js's SynergyUpsertSchema.refine().
  // SYN-04/D-22/T-05-18: resolved BEFORE the item is built/pushed — a bad id
  // must refuse the whole create with no row added.
  let createdTaskIds = [];
  if (b.taskIds !== undefined) {
    const taskDeal = controlStore.getDeal(req.dealContext && req.dealContext.dealId);
    const resolution = resolveSynergyTaskIds(b.taskIds, db, req, taskDeal);
    if (!resolution.ok) return res.status(400).json({ error: resolution.error });
    createdTaskIds = resolution.ids;
  }
  const title = String(b.title || '').trim();
  const item = {
    id: newId('syn'),
    title: title.slice(0, 300),
    category: b.category === 'cost' ? 'cost' : 'revenue',
    targetM: num(b.targetM),
    realizedM: num(b.realizedM),
    owner: String(b.owner || '').slice(0, 120),
    workstreamId: String(b.workstreamId || 'ws_imo').slice(0, 60),
    stage: SYN_STAGES.includes(b.stage) ? b.stage : SYN_STAGES[0],
    notes: String(b.notes || '').slice(0, 600),
    // SYN-02/D-20: the planned cost-to-achieve figure and its expected
    // spend month — ordinary optional plan fields.
    costPlannedM: num(b.costPlannedM),
    costExpectedMonth: typeof b.costExpectedMonth === 'string' ? b.costExpectedMonth : '',
    taskIds: createdTaskIds,
    createdAt: new Date().toISOString()
  };
  // D-08/SYN-03 (G-05-01): the CREATE path must clear the SAME stage gates as
  // every other route that can set a stage. Enum membership alone is NOT a
  // gate — it only proves the value is spelled correctly. Without this, a
  // caller could POST {stage:'captured', realizedM:2.5} and mint a brand-new
  // initiative with no owner, no phased target and no arrived-month evidence,
  // whose fabricated value flows straight into GET /api/synergies/rollup's
  // grossRealizedM — the steerco headline D-18/D-21 exist to make trustworthy
  // (live-reproduced: rollup 0.9 -> 3.4). The /stage route and the upsert
  // UPDATE branch were both gated; only creation was missed.
  //
  // Evaluated against the fully-built item so the gate sees exactly the state
  // that would be persisted. `idea` and `validated` carry no gate and stay
  // freely creatable; `committed`/`captured` must be EARNED via the /stage
  // route once the initiative actually has an owner, phasing and realized
  // value — which is what "moves through confidence stage-gates" means.
  //
  // NOTE the `{ ...item, stage: SYN_STAGES[0] }` argument — it is load-bearing,
  // not defensive noise. stageGateFailure() walks `STAGE_ORDER[item.stage] + 1
  // .. toOrdinal`, so passing the item as-is (whose stage ALREADY equals the
  // target on this path) makes fromOrdinal === toOrdinal and the loop body
  // never executes — a silent no-op that would look like a gate in review and
  // enforce nothing. Evaluating from the baseline stage walks every
  // intervening gate, which is what a create-at-`captured` must clear.
  if (item.stage !== SYN_STAGES[0]) {
    const createGateFailure = stageGateFailure({ ...item, stage: SYN_STAGES[0] }, item.stage);
    if (createGateFailure) return res.status(400).json({ error: createGateFailure });
  }
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, initiative: item });
});

app.delete('/api/synergies/:id', (req, res) => {
  const db = readDb();
  const lane = synergyLane(db);
  const item = lane.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Initiative not found.' });
  // CONC-02 (Phase 9, Plan 06 / D-08): stale-delete rejection, same
  // query-channel contract as the sibling sub-routes above.
  if (conflictIfStale(req, res, item)) return;
  const filtered = lane.filter(s => s.id !== req.params.id);
  if (db.settings && db.settings.demoMode === false) db.customSynergyInitiatives = filtered;
  else db.synergyInitiatives = filtered;
  writeDb(db);
  res.json({ success: true });
});

// SYN-02/D-20/D-21/T-05-19: dedicated sub-route mirroring the established
// shape (resolve the lane, 404 on an unknown id, one writeDb() at the end).
// Two entries sharing a date and amount are two entries — never dedupe,
// because a lumpy cost profile legitimately contains repeated identical
// payments. The entry's identity is its generated id, never its array
// position.
app.post('/api/synergies/:id/cost-entries', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  const item = lane.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Initiative not found.' });
  // CONC-02 (Phase 9, Plan 02 Task 2): a cost-entry addition mutates the
  // owning initiative record — D-02 gives it no exemption from the version
  // precondition, even though the entry itself is a nested sub-object.
  if (conflictIfStale(req, res, item)) return;

  item.costEntries = Array.isArray(item.costEntries) ? item.costEntries : [];
  const entry = { id: newId('cost'), date: b.date, amountM: roundSynergyMoney(b.amountM), note: String(b.note || '').slice(0, 2000) };
  item.costEntries.push(entry);

  writeDb(db);
  res.json({ success: true, initiative: item });
});

// SYN-02/T-05-19: filters by the entry's generated id and 404s when no entry
// matches — never indexes into the array, so a crafted numeric path segment
// cannot remove an arbitrary neighbouring row. 404 on an unknown initiative
// id too, matching the established pattern.
app.delete('/api/synergies/:id/cost-entries/:eid', (req, res) => {
  const db = readDb();
  const lane = synergyLane(db);
  const item = lane.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Initiative not found.' });
  // CONC-02 (Phase 9, Plan 02 Task 2): this route carries no JSON body — its
  // precondition travels in the ?expectedVersion query parameter, resolved
  // by the SAME conflictIfStale()/parseExpectedVersion() dual-channel
  // contract Task 1 built. This is an UPDATE of the initiative (deleting a
  // nested entry from it), never a record delete, so it uses the ordinary
  // conflict path rather than a later plan's stale-delete surface.
  if (conflictIfStale(req, res, item)) return;

  const entries = Array.isArray(item.costEntries) ? item.costEntries : [];
  const filtered = entries.filter(e => e.id !== req.params.eid);
  if (filtered.length === entries.length) return res.status(404).json({ error: 'Cost entry not found.' });
  item.costEntries = filtered;

  writeDb(db);
  // [Rule 1 fix] CONC-02: echo the updated initiative (matching every other
  // synergy sub-route's response shape) so the client can refresh the
  // version it holds in memory — without this, the NEXT write in the same
  // tab would resubmit the now-stale version and self-conflict against its
  // own successful delete (mirrors the RAID/task status-flip refresh
  // pattern established in Plan 01/Task 1).
  res.json({ success: true, initiative: item });
});

// SYN-01/D-01/D-05/D-25: dedicated sub-route mirroring
// POST /api/deals/:id/members's shape (inline 404 guard, one writeDb() at
// the end). Regeneration REPLACES item.phasing wholesale, never merges — a
// phasing row's identity is its month, so there is no meaningful partial
// merge, and re-running the ramp after manual edits is a deliberate,
// client-confirmed destructive action (Task 3's window.confirm gate).
app.post('/api/synergies/:id/generate-phasing', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  const item = lane.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Initiative not found.' });
  // CONC-02 (Phase 9, Plan 02 Task 2): this route wholesale-replaces
  // item.phasing (a destructive act the client already confirms) — the
  // version precondition is checked here too, D-02, before any of the
  // fields below are touched.
  if (conflictIfStale(req, res, item)) return;

  item.runRateM = roundSynergyMoney(b.runRateM);
  item.startMonth = b.startMonth;
  item.curveShape = b.curveShape;
  item.phasing = generatePhasingRows(item.runRateM, item.startMonth, item.curveShape, synergyHorizonYears(db, dealSettingsFor(req)));

  // D-14: version 1 ("the deal case") is stamped the FIRST time this
  // initiative gets a phased target — never regenerated, renumbered or
  // reordered afterwards. The `.length === 0` guard is what stops a LATER
  // regeneration (a deliberate, client-confirmed destructive re-ramp) from
  // ever creating a competing v1; pushBaseline()'s own max-version
  // derivation would otherwise happily append a v2+ here too, but this
  // guard means it only ever runs once per initiative.
  if (!Array.isArray(item.baselines) || item.baselines.length === 0) {
    pushBaseline(item, req, 'Deal case — initial phased target.');
  }

  const rollup = synergyRollupFields(item);
  item.targetM = rollup.targetM;
  item.realizedM = rollup.realizedM;

  // CR-03: regeneration wholesale-replaces item.phasing with rows carrying
  // realizedM: 0 (the ramp loop above), so an initiative sitting at
  // `committed` or `captured` on the strength of evidence that no longer
  // exists in the fresh rows must not keep that stage claim — the rollup
  // above already dropped to reflect the fresh zero rows, but nothing else
  // re-checks whether item.stage is still true. Demote to the highest stage
  // whose own gate still passes, recording the automatic demotion as a
  // baseline entry (mirrors D-09's reasoned-demotion pattern) so the badge
  // and the steering-committee rollup can never again disagree about whether
  // the initiative's captured-value claim still holds.
  const preRegenStage = item.stage;
  const satisfiedStage = demoteToSatisfiedStage(item);
  if (satisfiedStage !== preRegenStage) {
    pushBaseline(item, req, `Automatic demotion: phasing regenerated, ${preRegenStage} evidence no longer present.`);
    item.stage = satisfiedStage;
  }

  writeDb(db);
  res.json({ success: true, initiative: item });
});

// SYN-01/D-06/D-25/T-05-01: the dedicated per-month sub-route — the ONLY
// writable path for a phasing row's realized value once phasing rows exist
// (the base POST /api/synergies upsert refuses targetM/realizedM above once
// item.phasing is non-empty, D-04). Realized value is arrival-restricted
// server-side via monthHasArrived(); target value is accepted for any month
// (forward planning is normal, only realized is forward-booking-restricted).
app.post('/api/synergies/:id/phasing/:month', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  const item = lane.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Initiative not found.' });
  // CONC-02 (Phase 9, Plan 02 Task 2): placed immediately after the
  // not-found guard — before the month-shape/row-existence checks below —
  // and before the first mutation of the resolved initiative (D-02).
  if (conflictIfStale(req, res, item)) return;

  // SYN-01/D-25: a malformed :month path param is a 400 (bad request shape),
  // distinct from a well-formed month that simply has no row (404 below) —
  // reuses isValidMonth() rather than a second, ad hoc shape check.
  if (!workstreamValidators.isValidMonth(req.params.month)) {
    return res.status(400).json({ error: 'Month must be a valid YYYY-MM month.' });
  }

  const row = Array.isArray(item.phasing) ? item.phasing.find(r => r.month === req.params.month) : undefined;
  if (!row) return res.status(404).json({ error: 'No phasing row exists for month ' + req.params.month + '.' });

  if (b.realizedM !== undefined) {
    if (!monthHasArrived(row.month)) {
      return res.status(400).json({ error: 'Month ' + row.month + ' has not arrived yet — realized value cannot be entered until this month begins.' });
    }
    row.realizedM = roundSynergyMoney(b.realizedM);
    // SYN-05/D-16: a realized-value write is a real value change — stamp the
    // confirmation clock here so no realized entry can leave it behind.
    item.lastConfirmedAt = new Date().toISOString();
  }
  if (b.targetM !== undefined) {
    row.targetM = roundSynergyMoney(b.targetM);
  }

  const rollup = synergyRollupFields(item);
  item.targetM = rollup.targetM;
  item.realizedM = rollup.realizedM;

  writeDb(db);
  res.json({ success: true, initiative: item });
});

// SYN-03/D-08/D-09: the ONLY route that may move an initiative's stage —
// the base upsert refuses a `stage` key outright (above), so this gate has
// no bypass. A same-stage request is a no-op 200 (no write, no baseline
// entry). A forward move runs stageGateFailure() and 400s with its exact
// reason on a block (this is the string the client alerts verbatim). A
// backward move (de-scoping) requires a non-empty trimmed reason (D-09) and
// records it in the initiative's baseline history alongside the pre-change
// stage.
app.post('/api/synergies/:id/stage', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  const item = lane.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Initiative not found.' });
  // CONC-02 (Phase 9, Plan 02 Task 2): placed BEFORE the CR-02
  // unrecognized-stage 409 below — that pre-existing 409's own body must
  // stay exactly as it is and must NEVER gain the conflict:true marker (it
  // is a business-rule refusal, not a version conflict; a dedicated
  // negative-control test asserts this). This call is a SEPARATE check that
  // fires and returns first whenever a stale version is supplied, regardless
  // of whether the request would otherwise hit the same-stage no-op, the
  // unrecognized-stage refusal, or a real stage move.
  if (conflictIfStale(req, res, item)) return;

  const targetStage = b.targetStage;
  const reason = String(b.reason || '').trim();
  const currentOrdinal = STAGE_ORDER[item.stage];
  const targetOrdinal = STAGE_ORDER[targetStage];

  // CR-02: an unrecognized/absent item.stage (e.g. a customSynergyInitiatives
  // row this phase's migration script never reached, WR-04) makes
  // currentOrdinal `undefined` — `targetOrdinal > currentOrdinal` is ALWAYS
  // false against undefined (a NaN comparison), so control used to silently
  // fall into the backward-move `else` branch below, which requires only a
  // reason string and never runs stageGateFailure(). Fail closed instead:
  // refuse the move outright rather than assuming "backward".
  if (currentOrdinal === undefined) {
    // 409, not 500: the server is working correctly and has REFUSED a request
    // because of a conflicting stored state. A 500 would misreport a handled
    // data condition as a server fault — noise in any monitoring that alerts
    // on 5xx, and misleading to the caller. Matches this file's convention of
    // 4xx for refused-because-of-state (see the phased-initiative refusal at
    // ~3449 and the not-pending-completion refusal at ~2658).
    return res.status(409).json({ error: 'This initiative carries an unrecognized stage value and cannot be advanced until migrated.' });
  }

  if (targetOrdinal === currentOrdinal) {
    return res.json({ success: true, initiative: item });
  }

  if (targetOrdinal > currentOrdinal) {
    const failure = stageGateFailure(item, targetStage);
    if (failure) return res.status(400).json({ error: failure });
    item.stage = targetStage;
  } else {
    if (!reason) {
      return res.status(400).json({ error: 'A reason is required to move an initiative backward to an earlier stage.' });
    }
    // D-09/D-12: record the pre-change stage and the reason in the
    // initiative's baseline history BEFORE applying the demotion —
    // pushBaseline() snapshots item.stage/runRateM/phasing as they stand
    // right now, which is the pre-change state.
    pushBaseline(item, req, reason);
    item.stage = targetStage;
  }

  // D-16: a stage change is a real value change — stamp lastConfirmedAt here
  // so no stage change can leave the confirmation clock behind. Plan 05 owns
  // the staleness READER; this write side is stamped now regardless.
  item.lastConfirmedAt = new Date().toISOString();
  writeDb(db);
  res.json({ success: true, initiative: item });
});

// D-13/D-15: an explicit re-baseline act, available at any time (unlike the
// D-13 FORCED re-baseline on the base upsert above, which only engages once
// committed). D-15's authz guard is deliberately the handler's FIRST
// statement, before even the 404 lookup, so an unauthorized caller gets an
// identical 403 whether or not the id exists — no existence oracle
// (T-05-17). Broader '/api/synergies' ROLE_WRITE_POLICY entry already lets
// admin/hrbp/pmo through the outer gate; isAdminOrIlRequest() narrows
// FURTHER, inside this handler, to admin+hrbp only.
app.post('/api/synergies/:id/rebaseline', (req, res) => {
  if (!isAdminOrIlRequest(req)) {
    return res.status(403).json({ error: 'Only admin and the Integration Lead can re-baseline a synergy initiative.' });
  }
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  const item = lane.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Initiative not found.' });
  // CONC-02 (Phase 9, Plan 02 Task 2): after the not-found guard, before
  // any mutation (D-02).
  if (conflictIfStale(req, res, item)) return;

  const reason = String(b.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required to re-baseline.' });

  pushBaseline(item, req, reason);
  item.lastConfirmedAt = new Date().toISOString();
  writeDb(db);
  res.json({ success: true, initiative: item });
});

// SYN-05/D-16: the ONLY route whose purpose is stamping lastConfirmedAt as a
// deliberate confirmation act. ConfirmCurrentSchema accepts no CONTENT
// fields, so there is no field on this request through which a title or a
// note could ride along with a confirmation — CONC-02 (Phase 9, Plan 02
// Task 2) added `version` to that schema as the sole exception, since it
// carries no content of its own, only the optimistic-lock precondition
// (must_haves: every route that mutates an existing initiative enforces the
// version precondition, this one included, D-02/D-06). This handler still
// assigns EXACTLY ONE content field (lastConfirmedAt) and touches nothing
// else — a reviewer can verify by inspection that a confirmation and a
// content edit can never be the same request.
app.post('/api/synergies/:id/confirm-current', (req, res) => {
  const db = readDb();
  const lane = synergyLane(db);
  const item = lane.find(s => s.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Initiative not found.' });
  if (conflictIfStale(req, res, item)) return;

  item.lastConfirmedAt = new Date().toISOString();
  writeDb(db);
  res.json({ success: true, initiative: item });
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

// D-12-02 (Phase 12, plan 12-05): the proportional read path for the RAID lane.
// Required here (beside the handlers that use them) rather than in the
// top-of-file import block so the RAID region stays one self-contained edit.
const { readCollections, readSingleton, readProjection } = require('./db/store');
const listQuery = require('./lib/listQuery');

// The lane NAME raidLane() resolves, from the settings singleton alone: the
// list read needs it before (and instead of) loading any collection. Kept
// BESIDE raidLane() rather than inside it: test/optimistic-locking-contract
// source-scans raidLane's body for exactly its two db.<collection> keys, and
// test/read-collections asserts the two always agree for demoMode
// false / true / absent.
function raidLaneName(settings) {
  return settings && settings.demoMode === false ? 'customRaidEntries' : 'raidEntries';
}

// The collections a RAID write handler needs: settings (lane choice), both
// lanes (raidLane() assigns the one it does not use), and ddFindings (the
// provenance rule resolves `dd-finding:<id>` to that finding's area). A
// handler that touches any other collection throws CollectionNotLoadedError
// naming it: add it here rather than going back to readDb().
const RAID_READ_SET = ['settings', 'raidEntries', 'customRaidEntries', 'ddFindings'];
const RAID_TYPES = ['risk', 'issue', 'decision', 'dependency'];
// D-26: four levels — a `critical` DD finding (db/accessPolicy.js's
// DD_FINDING_SEVERITIES, above) converts into a RAID entry via
// POST /api/dd/findings/:id/convert and must stay `critical`, not downgrade
// to `high`. This list is an INDEPENDENT COPY of validators/workstream.js's
// own RAID_LEVELS — the two are not shared via import and MUST be kept in
// sync by hand; a test in test/dd-findings.test.js asserts they agree.
// Widening this list also widens `probability` below (same field, same
// enum) — that is deliberate: a four-level probability scale is a strict
// superset of the previous three and rejects nothing accepted today.
const RAID_LEVELS = ['low', 'medium', 'high', 'critical'];
const RAID_STATUSES = ['open', 'mitigating', 'closed'];

// What GET /api/raid accepts (PD-12). `phase` is not a RAID concept, so it is
// not listed and is ignored like any other unknown key.
const RAID_LIST_SPEC = {
  filters: { status: 'status', owner: 'owner', workstream: 'workstreamId' },
  enums: { status: RAID_STATUSES },
  search: ['title', 'notes'],
};

// T-06-42/D-17 (06-06): closes the Phase-4 accepted risk (T-04-21, proven
// live once — converting a Legal DD finding republished its title and
// notes through this unfiltered log to a member cleared only for HR).
// GET /api/raid below gates each entry on the functional area its OWN
// PROVENANCE resolves to, never on the entry's workstreamId and never via
// db/accessPolicy.js's generic filterByAreaGrant() list helper — that
// helper keys on `item.area`, and RAID rows carry NO area field at all
// (only workstreamId), so a naive reuse would evaluate every entry's
// membership as `undefined` in the granted set, which is false for every
// possible set including the full admin set: FAIL-CLOSED-TO-USELESS,
// emptying the log for every caller, admin included. That failure looks
// correct from the restricted side (an uncleared-user test still passes)
// while silently breaking the open side — the opposite failure mode of a
// leak, and just as dangerous to a real deal team.
//
// The workstream field is deliberately NEVER used as the clearance key
// either: DD_AREA_WORKSTREAM (Due Diligence section, below) is a
// many-to-one mapping — financial AND tax both fold into ws_finance, legal
// AND complianceEsg both fold into ws_legal — so a workstream id cannot be
// inverted back to the area that produced it without guessing wrong
// roughly half the time that collision applies.
//
// An entry whose provenance resolves to null (manually created with an
// empty source, or orphaned because its originating record was since
// deleted AND carries no stamped clearanceArea — see WR-03 note below) is
// returned UNFILTERED — general RAID content is not MNPI; only content
// republished FROM a restricted source is gated, and an orphaned link
// degrades to unlinked rather than becoming permanently invisible to
// everyone including admin (T-06-45).
//
// WR-03 (06-REVIEW.md): both conversion routes (POST
// /api/dd/findings/:id/convert and POST /api/org/flight-risk/:id/convert,
// below) now STAMP the resolved area onto the created RAID entry's own
// `clearanceArea` field AT CONVERSION TIME, so this resolver checks that
// stamp FIRST — deleting the originating finding/flight-risk entry later
// can no longer retroactively declassify a converted RAID entry back to
// the whole deal (the exact residual risk 06-REVIEW.md WR-03 named). The
// source-parsing fallback below is retained ONLY for legacy/unstamped
// entries created before this field existed; every entry a conversion
// route creates from today onward always carries the stamp, so the
// fallback branch is never reached for a fresh conversion.
function resolveRaidEntryClearanceArea(entry, db) {
  return clearanceAreaFromProvenance(
    entry && entry.clearanceArea,
    entry && entry.source,
    (findingId) => {
      const finding = ddFindingsLane(db).find((f) => f.id === findingId);
      return finding ? finding.area : null;
    }
  );
}

// D-12-02 (PD-10): the provenance rule itself, factored out so the in-memory
// path (resolveRaidEntryClearanceArea, over a fully-read db) and the light list
// path (GET /api/raid, over column projections) apply LITERALLY the same
// rule. Stamped `clearanceArea` first (WR-03), then `dd-finding:<id>` -> that
// finding's area via `findingAreaOf(id)` (null when the finding no longer
// exists, T-06-45), then `org-flightrisk:` -> 'hr', else null = unrestricted.
function clearanceAreaFromProvenance(clearanceArea, source, findingAreaOf) {
  if (clearanceArea) return clearanceArea;
  if (!source) return null;
  const ddMatch = /^dd-finding:(.+)$/.exec(source);
  if (ddMatch) return findingAreaOf(ddMatch[1]);
  // Retention clearance is always the fixed `hr` area regardless of which
  // workstream a converted flight-risk entry was filed under (D-15's
  // conversion route, above, never sets a workstream-derived area here).
  if (typeof source === 'string' && source.indexOf('org-flightrisk:') === 0) return 'hr';
  return null;
}

// WR-04's "one filtered read path", made literal: the single per-row
// visibility predicate behind reportRaidRows() (export, pack) AND the paged /
// filtered GET /api/raid. `entryLike` is anything carrying `clearanceArea` and
// `source`: a full entry or a two-field projection.
function raidRowVisible(entryLike, findingAreaOf, deal, portalUser) {
  return areaVisibleTo(
    clearanceAreaFromProvenance(entryLike.clearanceArea, entryLike.source, findingAreaOf),
    deal,
    portalUser
  );
}

// The shared tail of that rule: a null area (unrestricted provenance) is visible
// to every deal member; any other area needs the caller's own grant for it.
function areaVisibleTo(area, deal, portalUser) {
  return area === null || accessPolicy.hasAreaGrant(deal, portalUser, area);
}

// [security] T-ERM-01/T-ERM-02 (260810-erm, milestone-close Fable 5 review):
// the task-lane TWIN of resolveRaidEntryClearanceArea() immediately above —
// structurally identical, on purpose. A converted TASK carries the exact
// same MNPI title as its RAID counterpart (`${employeeName} — retention
// risk mitigation`, or a DD finding's own `.title`), but until this fix the
// task lane had NO clearance concept at all — every deal member saw every
// task regardless of which RAID entry it was converted alongside. The stamp
// (`task.clearanceArea`) is checked FIRST, before any source-parsing, so
// deleting the originating dd-finding/flight-risk record can never
// retroactively DEclassify a converted task back to the whole deal team
// (fail-closed — mirrors WR-03). A task whose provenance resolves to null
// (manually created with an empty/absent source, or an orphaned/
// unrecognised source with no stamp) is returned UNRESTRICTED — an ordinary
// Day-1/100-day task is not MNPI; only content republished FROM a
// restricted source is gated.
function resolveTaskClearanceArea(task, db) {
  // D-12-02 (T-12-81): the provenance rule is the SHARED core the RAID lane
  // uses (clearanceAreaFromProvenance) — same stamp-first / dd-finding /
  // org-flightrisk order, so the two lanes cannot drift apart.
  return clearanceAreaFromProvenance(
    task && task.clearanceArea,
    task && task.source,
    (findingId) => {
      const finding = ddFindingsLane(db).find((f) => f.id === findingId);
      return finding ? finding.area : null;
    }
  );
}

// The per-row task visibility predicate behind reportTaskRows() AND the paged /
// filtered GET /api/integration-tasks: `entryLike` is anything carrying
// `clearanceArea` and `source` (a full task or a two-field projection). The
// twin of raidRowVisible() — both end in areaVisibleTo().
function taskRowVisible(entryLike, findingAreaOf, deal, portalUser) {
  return areaVisibleTo(
    clearanceAreaFromProvenance(entryLike.clearanceArea, entryLike.source, findingAreaOf),
    deal,
    portalUser
  );
}

// [security] T-ERM-01: the SINGLE clearance-filtered task read — every
// title-emitting task exit (GET /api/integration-tasks, the export
// dataset=tasks branch, the PDF pack, and computeWorkstreamRollup's own
// per-workstream task counts) must call this, never re-derive its own
// filter, mirroring reportRaidRows()'s "one filtered read path" guarantee
// (WR-04) for the task lane — a future edit can never make one of these
// exits disagree with the others about which tasks a given caller may see.
function reportTaskRows(db, deal, portalUser) {
  ddFindingsLane(db);
  // The area is resolved by resolveTaskClearanceArea() (stamp, then
  // provenance) and judged by taskRowVisible() — the predicate the paged list
  // uses — with the resolved area presented as the stamp, so no provenance
  // lookup repeats and the two readers share the one visibility tail.
  return taskLane(db).filter((task) => taskRowVisible(
    { clearanceArea: resolveTaskClearanceArea(task, db), source: '' },
    null, deal, portalUser
  ));
}

// RPT-01/RPT-02 (07-06 Task 2/T-07-28): the SINGLE clearance-filtered RAID
// read GET /api/reports/export's raid branch, GET /api/reports/pack, AND the
// live GET /api/raid screen route all call — factored out so there is
// exactly one filtered read path and a future change can never make the CSV
// export, the PDF pack, and the live screen disagree about which RAID rows a
// given caller may see (D-08). [WR-04 fix: GET /api/raid used to carry its
// own line-for-line duplicate of this filter; that duplicate is now gone, so
// the "one filtered read path" claim is actually true, not just true for two
// of the three callers.]
function reportRaidRows(db, deal, portalUser) {
  ddFindingsLane(db);
  // resolveRaidEntryClearanceArea -> clearanceAreaFromProvenance, then the same
  // areaVisibleTo() tail raidRowVisible() ends in: one rule, two read shapes.
  return raidLane(db).filter((entry) => areaVisibleTo(resolveRaidEntryClearanceArea(entry, db), deal, portalUser));
}

// [security] D-11-03 / R1-02 / T-11-20..22 (Phase 11): the by-id WRITE-path
// twin of the read filters above. Reading a task/RAID list was always
// clearance-filtered; an update, status flip, delete, synergy link or
// conversion lookup that addresses a record BY ID was not, so an uncleared
// deal member holding an id (ids leak via URLs/CSVs/screens — authorization
// must not rest on id secrecy) could read the record back through the
// optimistic-locking 409 echo, overwrite it, or delete it (R1-02,
// 09-SECURITY UF-2).
//
// `RecordNotFoundError` carries `reason` ('missing' | 'clearance') so the
// central 404 handler (error-middleware block, below) answers BOTH with the
// byte-identical `{ error: 'Not found' }` body — never a 403, never a 409,
// never any field of the record — while the reason stays available for the
// rate-bounded denial audit Plan 11-04 hangs on that same branch.
class RecordNotFoundError extends Error {
  constructor(reason) {
    super('Not found');
    this.name = 'RecordNotFoundError';
    this.status = 404;
    this.reason = reason === 'clearance' ? 'clearance' : 'missing';
  }
}

// True when the caller may know `record` exists. The area rule is the SHARED
// task/RAID rule: stamped `clearanceArea` first, then `dd-finding:<id>` →
// the finding's area, then `org-flightrisk:` → 'hr', else null =
// unrestricted. resolveTaskClearanceArea() and
// resolveRaidEntryClearanceArea() above are line-for-line the same rule
// (their own comments say so), so one resolver serves both lanes here —
// keep it that way: if the two ever diverge this helper must resolve per
// lane instead.
function recordVisibleTo(req, db, deal, record) {
  if (!record) return false;
  ddFindingsLane(db);
  const area = resolveTaskClearanceArea(record, db);
  return area === null || accessPolicy.hasAreaGrant(deal, req.portalUser, area);
}

// Throws RecordNotFoundError for a missing OR invisible record. MUST be
// called BEFORE conflictIfStale() (a 409 body is the R1-02 oracle) and
// before any field of the request body is applied. 404, not 403, so
// existence of an out-of-clearance record is never confirmed.
function assertRecordVisibleOr404(req, db, deal, record) {
  if (!record) throw new RecordNotFoundError('missing');
  if (!recordVisibleTo(req, db, deal, record)) throw new RecordNotFoundError('clearance');
}

// The clearanceFilter conflictIfStale() arms on the request's db context so
// the store's WHERE-layer conflict can never echo an invisible record either
// (CR-01 arming order — the filter is armed before any return).
function recordClearanceFilter(req, db, deal) {
  return (rec) => (recordVisibleTo(req, db, deal, rec) ? rec : null);
}

// [security] D-11-03 (Phase 11): the org-design lanes (orgPositions /
// orgFlightRisks) are writable only by callers holding the `hr` area grant —
// every handler checks it at the top, before any record is resolved. This
// filter restates that single fact for the conflict body and arms the
// WHERE-layer hook, so those lanes can sit in CLEARANCE_SCOPED_COLLECTIONS
// (db/collections.js: fail closed when no filter is armed) without changing
// anything for a cleared caller, and a future route that forgets the
// whole-route gate can never echo an org record across the boundary.
function hrClearanceFilter(req, deal) {
  return (rec) => (rec && accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr') ? rec : null);
}

// D-12-02 / PD-10 / PD-12: the proportional list read. Reads ONE lane through a
// light projection (id, raw JSON, clearanceArea, source + any filter field),
// never all 38 collections. It no longer builds the whole-db model that
// reportRaidRows() (CSV export, PDF pack) filters; instead it applies the SAME
// provenance rule through raidRowVisible() (WR-04: one rule, not two
// hand-synchronised copies; test/raid-list-query proves the two paths agree
// row for row), and only then filters, counts and pages. No list
// parameter -> the legacy bare array, byte-identical to the previous output;
// `?limit=` -> { items, total } with `total` counting only entries the caller
// may see (T-12-40).
app.get('/api/raid', (req, res) => {
  let parsed;
  try {
    parsed = listQuery.parseListQuery(req.query, RAID_LIST_SPEC);
  } catch (err) {
    if (err instanceof listQuery.ListQueryError) return res.status(400).json({ error: 'Invalid list query.' });
    throw err;
  }
  const deal = controlStore.getDeal(req.dealContext.dealId);
  // Visibility below is the reportRaidRows() rule (raidRowVisible), evaluated
  // per row over projections instead of over a fully-read db object.
  const lane = raidLaneName(readSingleton('settings'));
  const rows = readProjection(lane, listQuery.projectionFields(RAID_LIST_SPEC, parsed, ['clearanceArea', 'source']));

  // Built lazily, only when an unstamped `dd-finding:` provenance is present.
  // Exact for the odd record: a finding whose area is absent resolves to
  // undefined (restricted unless granted), a missing finding to null.
  let findingAreas = null;
  const findingAreaOf = (findingId) => {
    if (!findingAreas) {
      findingAreas = new Map();
      for (const r of readProjection('ddFindings', ['id', 'area'])) {
        if (findingAreas.has(r.f.id)) continue;
        findingAreas.set(r.f.id, r.f.area === null ? JSON.parse(r.raw).area : r.f.area);
      }
    }
    return findingAreas.has(findingId) ? findingAreas.get(findingId) : null;
  };

  const visible = rows.filter((row) => {
    let { clearanceArea, source } = row.f;
    // A non-string stamp/source cannot be judged from the projection alone.
    if ((clearanceArea && typeof clearanceArea !== 'string') || (source && typeof source !== 'string')) {
      const full = JSON.parse(row.raw);
      clearanceArea = full.clearanceArea;
      source = full.source;
    }
    return raidRowVisible({ clearanceArea, source }, findingAreaOf, deal, req.portalUser);
  });
  listQuery.sendList(res, listQuery.applyListFilters(visible, parsed, RAID_LIST_SPEC), parsed);
});

app.post('/api/raid', (req, res) => {
  const b = req.body || {};
  const db = readCollections(RAID_READ_SET);
  const lane = raidLane(db);
  if (b.id) {
    const item = lane.find(r => r.id === b.id);
    // [security] D-11-03 / R1-02: a RAID entry converted from an hr-area DD
    // finding or a flight-risk row IS clearance-scoped (provenance resolves
    // its area — resolveRaidEntryClearanceArea()). Missing AND invisible both
    // answer the central 404 `{ error: 'Not found' }` — BEFORE
    // conflictIfStale() (its 409 echoes the record) and before any field
    // assignment below.
    const deal = controlStore.getDeal(req.dealContext && req.dealContext.dealId);
    assertRecordVisibleOr404(req, db, deal, item);
    // CONC-02 (Phase 9, tracer): the route-level precheck fast path; the
    // clearanceFilter arms the same rule on the WHERE-layer conflict throw
    // (CR-01 / UF-2).
    if (conflictIfStale(req, res, item, { clearanceFilter: recordClearanceFilter(req, db, deal) })) return;
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
    // D-12: the reverse half of a bidirectional finding<->RAID link — a
    // manually-created entry carries an empty source; POST
    // /api/dd/findings/:id/convert (below) sets 'dd-finding:<findingId>'.
    // Bounded the same way the task shape's own `source` field is (160).
    source: String(b.source || '').slice(0, 160),
    createdAt: new Date().toISOString()
  };
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, entry: item });
});

// =====================================================================
// Org Design (ORG-01) — the position registry, split into a `current`/
// `target` state per D-06 (a position's identity is its own id; `state` is
// a discriminator on ONE record, never a link between two). `current` is
// open to any deal member (D-01, D-07); `target` sits behind the existing
// `hr` DD-area grant (D-02) — an area-cleared member, not only IL/admin
// (D-04, tier 1). Every route resolves the caller's FULL deal object via
// controlStore.getDeal() (never just req.dealContext, which carries only
// the id/kind) because accessPolicy needs deal.memberGrants/deal.members
// to decide clearance.
// =====================================================================

// Flat lane helpers, deliberately with NO demoMode/isCustom branch — see
// ddRequestLane()'s identical comment below: these three collections are
// deal-DB-native, never demo-shadow-laned.
function orgPositionsLane(db) {
  db.orgPositions = db.orgPositions || [];
  return db.orgPositions;
}
function orgDecisionsLane(db) {
  db.orgDecisions = db.orgDecisions || [];
  return db.orgDecisions;
}
function orgFlightRiskLane(db) {
  db.orgFlightRisks = db.orgFlightRisks || [];
  return db.orgFlightRisks;
}

// D-07: the requested state normalises to the target string ONLY on an
// exact match; anything else (absent, a padded/cased variant, an array-
// shaped query value) resolves to the current string — so a malformed
// query can never accidentally reach the restricted branch un-gated.
// D-12-02 (12-11): the org-design family reads only its own collections.
// ORG_READ_SET is the union of the three org lanes; each route below names the
// narrowest subset it actually touches (a throwing accessor proves a miss).
const ORG_READ_SET = ['orgPositions', 'orgDecisions', 'orgFlightRisks'];
const ORG_POSITIONS_SET = ['orgPositions'];
// Pure body builder for GET /api/org/positions (exposed as
// app.orgPositionsBody so test/read-sets-org-reports can assert it equals the
// HTTP body over readDb() and over readCollections()). Clearance and audit
// stay in the route, before this runs.
function orgPositionsBody(db, requestedState) {
  return orgPositionsLane(db).filter((p) => p.state === requestedState);
}
app.orgPositionsBody = orgPositionsBody;

app.get('/api/org/positions', (req, res) => {
  const db = readCollections(ORG_POSITIONS_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const requestedState = req.query.state === orgValidators.ORG_STATE_TARGET
    ? orgValidators.ORG_STATE_TARGET
    : orgValidators.ORG_STATE_CURRENT;
  // Clearance is asserted BEFORE the lane is read — a hand-crafted request
  // from a session that never loaded org.js's JS gets the identical 403.
  if (requestedState === orgValidators.ORG_STATE_TARGET
    && !accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    // [security] T-ERM-07 (260810-erm): the TARGET org design is restricted
    // MNPI (pre-announcement structure), so a denied read is audited — ONLY
    // on this branch, never for the open-tier current-state read below,
    // mirroring GET /api/org/flight-risk's identical read-audit shape.
    // Gated real-deal-only (!req.isDemo), matching GET /api/reports/export's
    // established audit-scoping rule.
    // WR-01: rate-bounded via the shared denial auditor (same row shape).
    if (!req.isDemo) {
      recordClearanceDenial(req, 'org-positions-target-access-denied', 'org-clearance', null);
    }
    return res.status(403).json({ error: 'You are not cleared to view the target org design.' });
  }
  // [security] T-ERM-07: a successful TARGET read is audited too — the
  // symmetric half of the denial above, ONLY on the target branch (current-
  // state reads stay silent, matching D-01/D-07's open-tier treatment).
  if (requestedState === orgValidators.ORG_STATE_TARGET && !req.isDemo) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'org-positions-target-read', dealId: req.dealContext.dealId,
      subject: null, before: null, after: null, request: requestMeta(req),
    });
  }
  res.json(orgPositionsBody(db, requestedState));
});

// D-05/D-06: refuses a `reportsToId` that is self-referential, unknown,
// cross-state, or would close a parent-chain cycle. Returns a human-readable
// reason string when `candidate.reportsToId` is invalid, null when it is
// acceptable (including when it is null/empty — a root position). Checks, in
// order: a null/empty parent is always acceptable; a parent equal to the
// candidate's own id is refused; a parent id absent from the lane is
// refused; a parent whose state differs from the candidate's is refused (the
// identity-model rule: a position may only report to a position in the same
// state); a parent whose ancestor chain reaches the candidate's own id is
// refused. Walks the ancestor chain iteratively with a visited-id Set so a
// pre-existing cycle in stored data makes this terminate rather than hang —
// the recursive tree render depends on this guard being the only way a
// parent link enters the lane.
function positionGraphFailure(lane, candidate) {
  const parentId = candidate.reportsToId;
  if (!parentId) return null;
  if (parentId === candidate.id) return 'A position cannot report to itself.';
  const byId = new Map(lane.map((p) => [p.id, p]));
  const parent = byId.get(parentId);
  if (!parent) return 'reportsToId does not name a known position.';
  if (parent.state !== candidate.state) return 'A position may only report to a position in the same state.';
  const visited = new Set([candidate.id]);
  let cursor = parent;
  while (cursor) {
    if (visited.has(cursor.id)) return 'That reporting line would create a cycle.';
    visited.add(cursor.id);
    if (!cursor.reportsToId) break;
    cursor = byId.get(cursor.reportsToId);
  }
  return null;
}

// D-04 tier 1: any `hr`-area-cleared deal member may create/maintain org
// structure, not only IL/admin. Upsert-by-id, mirroring the DD routes'
// validate-before-mutate shape.
// D-12-02 (12-11, PD-20): the common position write reads its own lane, plus
// the roster lane ONLY when the body names an employeeId (the sole consumer of
// employeeRosterLane() in this route). Every OTHER org write below (copy-to-
// target, delete, import, decisions, flight-risk, convert) keeps readDb(): they
// are rare/bulk or touch the task/RAID lanes too, so the whole-deal read is the
// honest read set there.
function orgPositionWriteSet(body) {
  if (!body || !body.employeeId) return ORG_POSITIONS_SET;
  const settings = readSingleton('settings');
  const roster = settings && settings.demoMode === false ? 'customEmployees' : 'employees';
  return ['orgPositions', 'settings', roster];
}
app.post('/api/org/positions', (req, res) => {
  const b = req.body || {};
  const db = readCollections(orgPositionWriteSet(b));
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to edit the org design.' });
  }
  const lane = orgPositionsLane(db);

  if (b.id) {
    const item = lane.find((p) => p.id === b.id);
    if (!item) return res.status(404).json({ error: 'Position not found.' });
    // WR-01 (06-REVIEW.md): mirrors POST /api/org/flight-risk's identical
    // employeeId-existence check (server.js, below) — same shape/wording,
    // so the two checks are textually consistent for future greps (IN-01).
    // Vacant (`null`/omitted) stays valid; only a NAMED, non-existent
    // employeeId is refused.
    if (b.employeeId) {
      if (!employeeRosterLane(db).find((e) => e.id === b.employeeId)) {
        return res.status(404).json({ error: 'That employee could not be found.' });
      }
    }
    // CONC-02 (Phase 9, Plan 05): placed after the not-found guard and the
    // employee-existence check above, and BEFORE the shallow-merge candidate
    // evaluation and positionGraphFailure() call below — nothing may mutate
    // the stored row before either refusal, per that comment's own rule. A
    // request that is BOTH stale AND structurally invalid gets the
    // conflict, not the 400 — the conflict is the actionable one for the
    // user. The whole route is gated on a single `hr` area grant checked at
    // the top, so a caller reaching this path is already cleared for every
    // record the route can resolve; `hrClearanceFilter` restates that one
    // fact on the 409 body and arms the WHERE layer (D-11-03: orgPositions
    // is a CLEARANCE_SCOPED_COLLECTIONS member, fail closed when unarmed).
    if (conflictIfStale(req, res, item, { clearanceFilter: hrClearanceFilter(req, deal) })) return;
    // Evaluate a shallow merge of the existing row and the incoming keys
    // BEFORE any field of the stored row is mutated — readDb() hands back a
    // shared cache, so a mutation followed by a refusal would stick.
    const candidate = Object.assign({}, item, b);
    const graphFailure = positionGraphFailure(lane, candidate);
    if (graphFailure) return res.status(400).json({ error: graphFailure });
    if (b.title !== undefined) item.title = String(b.title).trim();
    if (b.level !== undefined) item.level = String(b.level || '');
    if (b.reportsToId !== undefined) item.reportsToId = b.reportsToId || null;
    if (b.employeeId !== undefined) item.employeeId = b.employeeId || null;
    if (b.state !== undefined) item.state = b.state;
    writeDb(db);
    return res.json({ success: true, position: item });
  }

  // WR-01 (06-REVIEW.md): same existence check as the update branch above,
  // run before this candidate object is even built.
  if (b.employeeId) {
    if (!employeeRosterLane(db).find((e) => e.id === b.employeeId)) {
      return res.status(404).json({ error: 'That employee could not be found.' });
    }
  }
  const item = {
    id: newId('pos'),
    title: String(b.title || '').trim(),
    level: String(b.level || ''),
    reportsToId: b.reportsToId || null,
    employeeId: b.employeeId || null,
    state: b.state || orgValidators.ORG_STATE_CURRENT,
    createdAt: new Date().toISOString(),
  };
  const graphFailure = positionGraphFailure(lane, item);
  if (graphFailure) return res.status(400).json({ error: graphFailure });
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, position: item });
});

// 06-02: the "equivalent probe" UI-SPEC Design Tension 3 allows in place of
// GET /api/org/summary (which cannot exist until Plan 07 — its restricted
// tier tallies decisions and flight-risk entries Plans 04/05 create). The
// restricted capability key is assigned ONLY inside the granted branch,
// never from a ternary and never as false, so serialisation OMITS the key
// entirely for an uncleared caller — mirrors GET /api/dd/summary's
// filter-before-tally/absent-not-zeroed rule (server.js's DD summary route,
// above); Plan 07's GET /api/org/summary uses the identical grant check.
// This is defence in depth only — the server refusal on the write/read
// routes above and below is the actual control, not this probe's shape.
// 06-04 (D-04 tier 2, Surface Contract §5): a SECOND restricted key,
// assigned ONLY when the caller is IL/admin (the SAME governance role check
// the decisions POST route itself runs, below) — never a ternary, never
// `false`, so this key too is OMITTED entirely for every other cleared-but-
// non-IL member. The record-a-decision form is rendered client-side ONLY
// inside the branch guarded by this key's presence; this omission is a
// courtesy, not the control — the write route's own gate is.
app.get('/api/org/capabilities', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const capabilities = {};
  if (accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    capabilities.targetOrgDesign = true;
  }
  if (isAdminOrIlRequest(req)) {
    capabilities.recordOrgDecisions = true;
  }
  res.json(capabilities);
});

// D-04 tier 1: same hr-area write clearance as POST /api/org/positions
// above. Clones every current-state row into a NEW target-state row with a
// fresh id (per this phase's identity model — the two states are separate
// records with no shared identity, never a mutated original). Refuses with
// 400 while the target design already holds any row, making the action
// idempotent-by-refusal rather than silently doubling a large design on a
// repeated click or a replayed request (T-06-14).
app.post('/api/org/positions/copy-to-target', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to edit the org design.' });
  }
  const lane = orgPositionsLane(db);
  const existingTarget = lane.filter((p) => p.state === orgValidators.ORG_STATE_TARGET);
  if (existingTarget.length) {
    return res.status(400).json({ error: 'The target design is not empty — clear it before copying current state again.' });
  }
  const currentRows = lane.filter((p) => p.state === orgValidators.ORG_STATE_CURRENT);
  // Old-id-to-new-id map built in one pass BEFORE any clone is constructed,
  // so every clone (including one whose reportsToId names a row later in
  // this same array) can resolve its parent's clone id.
  const idMap = {};
  currentRows.forEach((p) => { idMap[p.id] = newId('pos'); });
  const clones = currentRows.map((p) => ({
    id: idMap[p.id],
    title: p.title,
    level: p.level,
    employeeId: p.employeeId,
    reportsToId: p.reportsToId ? (idMap[p.reportsToId] || null) : null,
    state: orgValidators.ORG_STATE_TARGET,
    createdAt: new Date().toISOString(),
  }));
  clones.forEach((c) => lane.push(c));
  writeDb(db);
  res.json({ success: true, count: clones.length, positions: clones });
});

// D-04 tier 1: same hr-area write clearance. Refuses with 400 while any row
// still reports to this position, naming the count — never cascades, so no
// part of an org design is removed outside the operator's field of view
// (the reassignment requirement is surfaced by the confirmation dialog's
// copy on the client, not silently handled here).
app.delete('/api/org/positions/:id', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to edit the org design.' });
  }
  const lane = orgPositionsLane(db);
  const idx = lane.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Position not found.' });
  const target = lane[idx];
  // CONC-02 (Phase 9, Plan 06 / D-08): placed before the direct-reports
  // structural check, mirroring Plan 05's positionGraphFailure() precedent —
  // a delete that is both stale AND blocked by direct reports returns 409,
  // not 400, so the caller learns their view is stale (the more fundamental
  // problem) before the business-rule refusal.
  if (conflictIfStale(req, res, target, { clearanceFilter: hrClearanceFilter(req, deal) })) return;
  const directReports = lane.filter((p) => p.reportsToId === target.id);
  if (directReports.length) {
    return res.status(400).json({ error: `This position has ${directReports.length} direct report(s) — reassign them before deleting.` });
  }
  lane.splice(idx, 1);
  writeDb(db);
  res.json({ success: true });
});

// D-09/D-10: bulk paste import. Same D-04 tier-1 hr-grant write clearance as
// the routes above. ALL-OR-NOTHING (per this plan's objective — an org chart
// is a graph, and importing the good rows while dropping the bad ones would
// silently re-root every child of a dropped row at the top level, producing
// a tree that LOOKS complete while being structurally wrong): a full
// validation pass over every row runs BEFORE any mutation, collecting every
// problem rather than stopping at the first one, and a non-empty problem
// list touches nothing. `reportsTo` resolves by TITLE — first against the
// other rows in the SAME paste, then against existing positions in the
// requested state; a duplicate title inside one paste is refused because
// title-based parent resolution is undecidable when two rows share a title.
app.post('/api/org/positions/import', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to edit the org design.' });
  }
  const requestedState = b.state === orgValidators.ORG_STATE_TARGET
    ? orgValidators.ORG_STATE_TARGET
    : orgValidators.ORG_STATE_CURRENT;
  const lane = orgPositionsLane(db);
  const rows = Array.isArray(b.rows) ? b.rows : [];

  // ---- Pass 1: VALIDATE EVERYTHING before any mutation --------------------
  const problems = [];
  const titleToRowIndex = new Map(); // lowercased title -> the FIRST row index it appeared at
  rows.forEach((row, idx) => {
    const title = String(row.title || '').trim();
    if (!title) {
      problems.push({ row: idx, message: 'Position title is required.' });
      return;
    }
    const key = title.toLowerCase();
    if (titleToRowIndex.has(key)) {
      problems.push({ row: idx, message: `Duplicate title "${title}" also appears at row ${titleToRowIndex.get(key)}.` });
      return;
    }
    titleToRowIndex.set(key, idx);
  });
  // Existing positions in the requested state, keyed by lowercased title —
  // the SECOND resolution tier for reportsTo, after the paste's own titles.
  const existingByTitle = new Map();
  lane.filter((p) => p.state === requestedState).forEach((p) => {
    existingByTitle.set(String(p.title || '').trim().toLowerCase(), p);
  });
  rows.forEach((row, idx) => {
    const reportsTo = String(row.reportsTo || '').trim();
    if (!reportsTo) return;
    const key = reportsTo.toLowerCase();
    if (titleToRowIndex.has(key) && titleToRowIndex.get(key) !== idx) return; // resolves within the paste
    if (existingByTitle.has(key)) return; // resolves against an existing position
    problems.push({ row: idx, message: `reportsTo "${reportsTo}" does not match any other row in this paste or any existing ${requestedState}-state position.` });
  });

  if (problems.length) {
    return res.status(400).json({ error: 'The paste could not be imported — every offending row is listed below, and nothing was created.', problems });
  }

  // ---- Pass 2: resolve employee links (staged, not yet attached to db) ---
  // IDENTICAL isCustom predicate to GET/POST /api/employees, so an imported
  // person lands in the exact lane those routes read/write.
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeeList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  const stagedEmployees = []; // new employee rows, attached to db only after the graph self-check below passes
  const employeeCache = new Map(); // per-request cache: one paste-key -> one employee id, so two rows naming the same person produce one employee
  function resolveEmployeeId(row) {
    const name = String(row.name || '').trim();
    const email = String(row.email || '').trim();
    if (!name && !email) return null;
    const cacheKey = email ? `email:${email.toLowerCase()}` : `name:${name}`;
    if (employeeCache.has(cacheKey)) return employeeCache.get(cacheKey);

    // D-09: email case-insensitively when the row carries one, else exact name.
    let existing = null;
    if (email) {
      const emailLower = email.toLowerCase();
      existing = employeeList.find((e) => (e.email || '').toLowerCase() === emailLower)
        || stagedEmployees.find((e) => (e.email || '').toLowerCase() === emailLower);
    } else {
      existing = employeeList.find((e) => e.name === name)
        || stagedEmployees.find((e) => e.name === name);
    }

    let employeeId;
    if (existing) {
      employeeId = existing.id;
    } else {
      // Identity fields only — the SAME field shape POST /api/employees
      // builds MINUS the demo gamification fields (points/badge/
      // bonusPoints/completedLessons): ISO-02 already hard-gates those
      // mechanics out of a real deal, so an imported real-deal person never
      // carries dead gamification data on a governance record.
      const newEmployee = {
        id: newId('emp'),
        name,
        email,
        role: '',
        department: '',
        company: '',
        lang: 'en',
        isLeader: false,
        leaderRole: 'None',
        buddyName: '',
        buddyEmail: '',
      };
      stagedEmployees.push(newEmployee);
      employeeId = newEmployee.id;
    }
    employeeCache.set(cacheKey, employeeId);
    return employeeId;
  }

  // ---- Pass 3: build the positions, two sub-passes ------------------------
  // Sub-pass A: allocate an id for every row and build a title-to-new-id map
  // BEFORE any position object is built, so a row whose reportsTo names a
  // row LATER in the array can still resolve it.
  const rowIds = rows.map(() => newId('pos'));
  const titleToNewId = new Map();
  rows.forEach((row, idx) => {
    titleToNewId.set(String(row.title || '').trim().toLowerCase(), rowIds[idx]);
  });
  // Sub-pass B: build each position, resolving reportsToId through the
  // paste's own map first, the existing-position lookup second.
  const newPositions = rows.map((row, idx) => {
    const title = String(row.title || '').trim();
    const reportsTo = String(row.reportsTo || '').trim();
    let reportsToId = null;
    if (reportsTo) {
      const key = reportsTo.toLowerCase();
      if (titleToNewId.has(key) && titleToNewId.get(key) !== rowIds[idx]) {
        reportsToId = titleToNewId.get(key);
      } else if (existingByTitle.has(key)) {
        reportsToId = existingByTitle.get(key).id;
      }
    }
    return {
      id: rowIds[idx],
      title,
      level: String(row.level || '').trim(),
      reportsToId,
      employeeId: resolveEmployeeId(row),
      state: requestedState,
      createdAt: new Date().toISOString(),
    };
  });

  // ---- Final self-check: run the SAME graph-integrity guard every other --
  // write route uses, against the lane as it would look with every new row
  // present, before a single byte is written.
  const mergedLane = lane.concat(newPositions);
  for (const p of newPositions) {
    const graphFailure = positionGraphFailure(mergedLane, p);
    if (graphFailure) {
      return res.status(400).json({ error: `Import refused — ${graphFailure} Nothing was created.` });
    }
  }

  // ---- Mutate ---------------------------------------------------------
  if (isCustom) { db.customEmployees = employeeList; } else { db.employees = employeeList; }
  stagedEmployees.forEach((e) => employeeList.push(e));
  newPositions.forEach((p) => lane.push(p));
  writeDb(db);
  res.status(201).json({
    success: true,
    createdPositions: newPositions.length,
    createdEmployees: stagedEmployees.length,
    positions: newPositions,
  });
});

// ORG-02 (06-04) — the append-only decision register. D-13: a decision is
// recorded as a NEW entry in `orgDecisions`, never as a field overwritten on
// the position — the position record itself is NEVER touched by any route
// below. D-14: the fixed five-value vocabulary. D-04 tier 2: recording a
// decision is a governance act, restricted to admin + Integration Lead
// ONLY — a strictly narrower gate than the tier-1 `hr`-area-grant write
// clearance the routes above use for structural org edits.
//
// D-14: an INDEPENDENT COPY of the five-value decision vocabulary, kept in
// sync BY HAND across three places — this array, validators/org.js's own
// copy, and public/js/org.js's client-side array — following the
// RAID_LEVELS/D-26 and SYN_STAGES/D-11 lockstep-copy convention already
// established elsewhere in this file. test/org-decisions.test.js's
// anti-drift block asserts all three agree, in order, with each other and
// with a literal expectation written into the test.
const ORG_DECISION_TYPES = ['retain', 'redeploy', 'in-selection', 'redundant', 'open'];

// D-13: a position's CURRENT decision is DERIVED as its latest orgDecisions
// entry by decidedAt, computed here at read time and stored nowhere — so a
// reversal recorded a week later leaves the original entry (and its
// rationale) intact and readable, never overwritten. Returns null when the
// position carries no decision entry at all.
//
// FLAGGED PLANNER ASSUMPTION (this plan's objective, unresolved by
// 06-CONTEXT.md/ROADMAP/UI-SPEC): an orgDecisions entry whose positionId no
// longer names a position in the lane is RETAINED in the log verbatim
// (append-only is absolute) but CONTRIBUTES TO NO DERIVED VALUE — this
// function only ever answers "what is the latest decision FOR this
// positionId", so a caller deriving over a live positions lane simply never
// asks this function about a deleted position's id in the first place;
// nothing in this function needs to know a position was deleted for that
// exclusion to hold.
function derivedDecisionFor(decisions, positionId) {
  const forPosition = decisions.filter((d) => d.positionId === positionId);
  if (!forPosition.length) return null;
  return forPosition.reduce((latest, d) => (!latest || d.decidedAt > latest.decidedAt ? d : latest), null);
}

// D-01/D-02: the decision log is RESTRICTED content — same `hr`-area-grant
// clearance boundary as target-state org structure, never open-tier like
// current-state positions. Ordered most-recent-first; narrowed by an
// optional `positionId` query value.
// Pure body builder (exposed as app.orgDecisionsBody for the equality suite):
// most-recent-first, narrowed by an optional positionId.
function orgDecisionsBody(db, positionId) {
  let lane = orgDecisionsLane(db);
  if (positionId) lane = lane.filter((d) => d.positionId === positionId);
  return lane.slice().sort((a, b) => String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')));
}
app.orgDecisionsBody = orgDecisionsBody;

app.get('/api/org/decisions', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    // [security] T-ERM-07 (260810-erm): the decision log is RESTRICTED MNPI
    // content (D-01/D-02) — a denied read is audited, mirroring GET
    // /api/org/flight-risk's identical read-audit shape. Gated real-deal-
    // only (!req.isDemo), matching GET /api/reports/export's established
    // audit-scoping rule.
    // WR-01: rate-bounded via the shared denial auditor (same row shape).
    if (!req.isDemo) {
      recordClearanceDenial(req, 'org-decisions-access-denied', 'org-clearance', null);
    }
    return res.status(403).json({ error: 'You are not cleared to view org decisions.' });
  }
  // [security] T-ERM-07: the symmetric successful-read half — subject
  // carries the narrowing positionId query value when the caller supplied
  // one, or null for the unnarrowed full-log read.
  if (!req.isDemo) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'org-decisions-read', dealId: req.dealContext.dealId,
      subject: req.query.positionId || null, before: null, after: null, request: requestMeta(req),
    });
  }
  res.json(orgDecisionsBody(readCollections(['orgDecisions']), req.query.positionId));
});

// D-04 tier 2: recording a decision is the most consequential act this app
// records about a named individual, so the gate is deliberately NARROWER
// than the tier-1 `hr`-area-grant write clearance the routes above use — the
// tier-2 role guard below runs as this handler's LITERAL FIRST STATEMENT,
// before the deal lookup, before the position lookup, before anything reads
// data, mirroring POST /api/synergies/:id/rebaseline's own D-15 precedent
// (server.js, above) exactly — including its deliberate exclusion of the
// X-Admin-Token break-glass identity (sessionId: null): an unattributed
// token must not be able to record a decision with legal and severance
// consequences against a named person.
app.post('/api/org/decisions', (req, res) => {
  if (!isAdminOrIlRequest(req)) {
    return res.status(403).json({ error: 'Only admin and the Integration Lead can record an org decision.' });
  }
  const b = req.body || {};
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  // D-02: role alone is not sufficient — ALSO require the hr area grant, so
  // the write is gated on both role (above) and clearance (here). This is a
  // structural no-op for admin/hrbp today (grantedAreas()'s role
  // short-circuit already reaches every area for both), but stays in place
  // because isAdminOrIlRequest() is a pure role check with zero awareness of
  // deal-level clearance.
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to edit the org design.' });
  }
  const position = orgPositionsLane(db).find((p) => p.id === b.positionId);
  if (!position) return res.status(404).json({ error: 'Position not found.' });

  const entry = {
    id: newId('orgdec'),
    positionId: b.positionId,
    employeeId: b.employeeId || null,
    type: b.type,
    rationale: b.rationale,
    // D-13/T-06-27: decidedBy/decidedAt are stamped HERE, server-side, from
    // the resolved session and the server clock — NEVER from the request
    // body. OrgDecisionSchema does not even declare these two keys, so a
    // caller-supplied value for either is already stripped before this
    // handler ever runs (z.object(shape)'s strip-unknown-keys-by-default).
    decidedBy: req.portalUser.username,
    decidedAt: new Date().toISOString(),
    effectiveDate: b.effectiveDate || null,
  };
  // Append-only (D-13/T-06-28): ALWAYS push a NEW entry — never search for
  // and mutate an existing one. A reversal is a new entry, not an edit, and
  // no route anywhere exposes an update or delete path for a decision.
  //
  // [security] CONC-02 (Phase 9, Plan 05) EXEMPTION, recorded deliberately
  // rather than left for a future reader to wonder whether it was missed:
  // CONC-02's own text ("A user whose edit to a co-edited record (RAID
  // entry, integration task, DD finding, synergy initiative, org decision)
  // is based on stale data has that write rejected with a 409...") names
  // "org decision" among its examples, but this route only ever PUSHES a
  // new entry — there is no update or delete path for a decision anywhere
  // in this file for a version precondition to guard. A decision record
  // therefore never carries a `version` field, and `orgDecisions` is
  // deliberately absent from db/collections.js's VERSIONED_COLLECTIONS set
  // (see that file's own comment for the identical reasoning, and
  // test/optimistic-locking-contract.test.js's structural assertion that
  // orgDecisions is excluded).
  orgDecisionsLane(db).push(entry);
  writeDb(db);
  res.status(201).json({ success: true, decision: entry });
});

// ORG-03 (06-05) — the key-talent flight-risk register. D-02: restricted to
// the `hr` area grant, the SAME clearance boundary as the decision log and
// target-state org structure — never open-tier like current-state
// positions. D-04 tier 2: writing an entry is a governance act, gated
// identically to POST /api/org/decisions — the shared role-guard function
// runs as each write handler's literal first statement, excluding the
// X-Admin-Token break-glass identity — a retention determination against a
// named person is the same class of act as a redundancy decision.
//
// D-03: THE GENUINELY NEW CONTROL THIS PLAN ADDS. No other GET handler in
// this file records a security event — a caller LOOKING at the retention
// list is itself the compliance-relevant act ORG-03's wording ("access to
// it audited") actually names, not merely a caller being refused one. Both
// halves — the denial (mirroring refuseDdArea()'s existing shape above) and
// the successful read (new) — are recorded from THIS route handler,
// deliberately never from db/accessPolicy.js, which stays free of any audit
// dependency (AUD-02's isolation precedent, mirrored for this module too).
// D-03's own checkpoint deliberately rejected session-scoped dedupe: every
// successful read writes a row, so public/js/org.js fetches this route
// exactly once per page visit and never from a poll or a revalidation loop.
//
// KNOWN, ACCEPTED LABELLING GAP (06-RESEARCH.md Assumptions Log A2):
// db/auditHook.js's recordSecurityEvent() hardcodes db_kind to 'control' for
// EVERY caller. A flight-risk read is conceptually a deal-scoped event and
// will be recorded with the control-plane label regardless. Nothing filters
// or facets on that column today, so this is a labelling inaccuracy, not a
// functional gap — fixing it would mean threading a new parameter through
// every existing recordSecurityEvent() call site, out of this plan's scope.
app.get('/api/org/flight-risk', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    // WR-01: rate-bounded via the shared denial auditor (same row shape).
    recordClearanceDenial(req, 'org-flightrisk-access-denied', 'org-clearance', null);
    return res.status(403).json({ error: 'You are not cleared to view the flight-risk register.' });
  }
  auditHook.recordSecurityEvent({
    actor: req.portalUser, action: 'org-flightrisk-read', dealId: req.dealContext.dealId,
    subject: null, before: null, after: null, request: requestMeta(req),
  });
  res.json(orgFlightRiskLane(readCollections(['orgFlightRisks'])));
});

// Resolves the SAME employee roster lane GET/POST /api/employees itself
// reads/writes (isCustom predicate identical to POST /api/org/positions/import
// above) — a flight-risk entry's employeeId must name a row in the actual
// roster the org tree and the employees page both use, never a second,
// divergent lane.
function employeeRosterLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  return isCustom ? (db.customEmployees || []) : (db.employees || []);
}

// D-04 tier 2: identical governance-role gate to POST /api/org/decisions —
// the shared role-guard function call is this handler's LITERAL FIRST
// STATEMENT, before the deal lookup, before the employee lookup, before
// anything reads data.
app.post('/api/org/flight-risk', (req, res) => {
  if (!isAdminOrIlRequest(req)) {
    return res.status(403).json({ error: 'Only admin and the Integration Lead can edit the flight-risk register.' });
  }
  const b = req.body || {};
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  // D-02: role alone is not sufficient — ALSO require the hr area grant,
  // mirroring POST /api/org/decisions' own structural no-op-for-admin/hrbp
  // comment above.
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to edit the flight-risk register.' });
  }
  const lane = orgFlightRiskLane(db);
  const employeeList = employeeRosterLane(db);

  if (b.id) {
    const item = lane.find((r) => r.id === b.id);
    if (!item) return res.status(404).json({ error: 'Flight-risk entry not found.' });
    if (b.employeeId !== undefined) {
      if (!employeeList.find((e) => e.id === b.employeeId)) {
        return res.status(404).json({ error: 'That employee could not be found.' });
      }
    }
    // CONC-02 (Phase 9, Plan 05): same placement as POST /api/org/positions
    // above — after the not-found guard and the employee-existence check,
    // before the first field of the stored row is mutated. The same
    // `hrClearanceFilter` is armed, for the reason given there.
    if (conflictIfStale(req, res, item, { clearanceFilter: hrClearanceFilter(req, deal) })) return;
    if (b.employeeId !== undefined) item.employeeId = b.employeeId;
    if (b.riskLevel !== undefined) item.riskLevel = b.riskLevel;
    // WR-02 (06-REVIEW.md): a blank/whitespace-only owner defaults to the
    // CALLER'S OWN session identity, mirroring how decidedBy is stamped
    // server-side on POST /api/org/decisions (above) — never trusted
    // free-text alone. A non-blank owner supplied by the caller is still
    // honoured verbatim; this is a default, not a constraint.
    if (b.owner !== undefined) item.owner = String(b.owner).trim() || req.portalUser.username;
    if (b.mitigation !== undefined) item.mitigation = String(b.mitigation || '');
    if (b.notes !== undefined) item.notes = String(b.notes || '');
    // linkedTaskIds/linkedRaidIds are NEVER touched by this route — Plan
    // 06's conversion route owns writes to those two fields exclusively.
    writeDb(db);
    return res.json({ success: true, entry: item });
  }

  if (!employeeList.find((e) => e.id === b.employeeId)) {
    return res.status(404).json({ error: 'That employee could not be found.' });
  }
  const entry = {
    id: newId('risk'),
    employeeId: b.employeeId,
    riskLevel: b.riskLevel,
    // WR-02 (06-REVIEW.md): defaults to the caller's own session identity
    // when the field is blank/whitespace/omitted, closing the class of bug
    // scripts/seed-org-demo.js's own comment documents having been caught
    // for the seed data — a free-text owner that can never equal any
    // session's username silently defeats GET /api/org/summary's
    // mine.unmitigatedFlightRisks owner nudge. A non-blank caller-supplied
    // owner is still honoured verbatim.
    owner: String(b.owner || '').trim() || req.portalUser.username,
    // Deliberately empty string, never undefined/null, when the field is
    // absent — a body with no mitigation returns 201 and stores an empty
    // mitigation, per this plan's own resolution of the UI-SPEC's mitigation
    // required/optional inconsistency (this plan's objective).
    mitigation: String(b.mitigation || ''),
    notes: String(b.notes || ''),
    // Declared here, empty, per this plan's recorded planner discretion —
    // Plan 06's conversion route pushes ids into these arrays; nothing else
    // ever does.
    linkedTaskIds: [],
    linkedRaidIds: [],
    createdAt: new Date().toISOString(),
  };
  lane.push(entry);
  writeDb(db);
  res.status(201).json({ success: true, entry });
});

// Same role-then-clearance gate ordering as the write route above.
app.delete('/api/org/flight-risk/:id', (req, res) => {
  if (!isAdminOrIlRequest(req)) {
    return res.status(403).json({ error: 'Only admin and the Integration Lead can edit the flight-risk register.' });
  }
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to edit the flight-risk register.' });
  }
  const lane = orgFlightRiskLane(db);
  const item = lane.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Flight-risk entry not found.' });
  // CONC-02 (Phase 9, Plan 06 / D-08): stale-delete rejection.
  if (conflictIfStale(req, res, item, { clearanceFilter: hrClearanceFilter(req, deal) })) return;
  db.orgFlightRisks = lane.filter((r) => r.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// D-15 (06-06): one-click conversion of a flight-risk register entry into a
// pre-filled Day-1 task and/or RAID entry, bidirectionally linked and
// deduped by a stable 'org-flightrisk:<entryId>' source string so
// re-clicking is a no-op — structurally mirrors
// POST /api/dd/findings/:id/convert above (task/RAID lookup-then-create,
// link-array append, single conditional write), with the DD area-clearance
// gate swapped for this register's own D-04 tier-2 role gate + hr grant.
// This exact source prefix is what GET /api/raid's provenance resolver
// (Due Diligence section below) branches on — produced here in exactly one
// place, never reconstructed elsewhere.
app.post('/api/org/flight-risk/:id/convert', (req, res) => {
  if (!isAdminOrIlRequest(req)) {
    return res.status(403).json({ error: 'Only admin and the Integration Lead can convert a flight-risk entry.' });
  }
  const b = req.body || {};
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  if (!accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr')) {
    return res.status(403).json({ error: 'You are not cleared to convert entries in the flight-risk register.' });
  }
  const lane = orgFlightRiskLane(db);
  const entry = lane.find((r) => r.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Flight-risk entry not found.' });

  // CONC-02 (Phase 9, Plan 05, D-02): this route mutates the entry itself
  // (it writes linkedTaskIds/linkedRaidIds below), so it carries the same
  // version precondition as any other entry edit — a conversion based on a
  // stale entry is refused rather than applied. Placed BEFORE `source` is
  // derived and before the task/RAID lanes are touched, so a stale-version
  // conflict leaves the entry, the task lane and the RAID lane all
  // untouched (Pitfall 6) — nothing here has mutated anything yet. No
  // clearanceFilter beyond the `hr` restatement: the whole route is already
  // gated on a single `hr` area grant, so `hrClearanceFilter` (D-11-03) only
  // arms the WHERE layer the same way the sibling routes above do.
  if (conflictIfStale(req, res, entry, { clearanceFilter: hrClearanceFilter(req, deal) })) return;

  const source = 'org-flightrisk:' + entry.id;
  const employee = employeeRosterLane(db).find((e) => e.id === entry.employeeId);
  const employeeName = employee ? employee.name : 'Unknown employee';
  let mutated = false;
  let task = null;
  let raidEntry = null;

  // [security] D-11-03 / R1-02 (Phase 11): BOTH source-matched existing
  // records are looked up and clearance-checked BEFORE either lane is
  // mutated (readDb() hands back the shared cache — a task pushed and then a
  // 404 thrown for the RAID half would leave the pushed task in the cache).
  // An existing record outside the converter's clearance answers the central
  // 404 — never returned as `task`/`raid` in the 200 body (a leak) and never
  // silently duplicated.
  // [security] WR-02 (Phase 11 review): adopt an existing record only when it
  // ALSO carries this route's server-side `clearanceArea: 'hr'` stamp — the
  // upsert schemas strip clearanceArea and refuse reserved sources, so only a
  // genuine conversion can carry both; a record planted with a matching
  // `source` is never handed back as the conversion.
  const isOwnConversion = (rec) => rec.source === source && rec.clearanceArea === 'hr';
  const existingTask = b.toTask ? (taskLane(db).find(isOwnConversion) || null) : null;
  const existingRaid = b.toRaid ? (raidLane(db).find(isOwnConversion) || null) : null;
  if (existingTask) assertRecordVisibleOr404(req, db, deal, existingTask);
  if (existingRaid) assertRecordVisibleOr404(req, db, deal, existingRaid);

  if (b.toTask) {
    const tLane = taskLane(db);
    task = existingTask;
    if (!task) {
      task = {
        id: newId('task'),
        title: `${employeeName} — retention risk mitigation`,
        workstreamId: 'ws_hr',
        phase: 'day1',
        owner: entry.owner || '',
        due: '',
        status: 'todo',
        source,
        // [security] T-ERM-01/WR-03 (260810-erm): retention clearance is
        // always the fixed `hr` area, stamped here at conversion time —
        // mirrors this same route's RAID-entry stamp a few lines below, so
        // resolveTaskClearanceArea() never needs to re-derive it from
        // `source`, and deleting this flight-risk entry later can never
        // widen this task's audience back to the whole deal team.
        clearanceArea: 'hr',
        createdAt: new Date().toISOString(),
      };
      tLane.push(task);
      mutated = true;
    }
    if (!entry.linkedTaskIds.includes(task.id)) { entry.linkedTaskIds.push(task.id); mutated = true; }
  }

  if (b.toRaid) {
    const rLane = raidLane(db);
    raidEntry = existingRaid;
    if (!raidEntry) {
      raidEntry = {
        id: newId('raid'),
        type: 'risk',
        title: `${employeeName} — retention risk`,
        // D-16: copied VERBATIM from the entry's level — no mapping table,
        // no clamping, mirroring the DD conversion route's identical rule
        // for the identical reason: a critical retention risk must not
        // arrive in the RAID log as a high one.
        severity: entry.riskLevel,
        owner: entry.owner || '',
        workstreamId: 'ws_hr',
        status: 'open',
        notes: entry.notes || entry.mitigation || '',
        source,
        // WR-03 (06-REVIEW.md): retention clearance is always the fixed
        // `hr` area, stamped here at conversion time — same rationale as
        // the DD finding conversion route's own stamp above.
        clearanceArea: 'hr',
        createdAt: new Date().toISOString(),
      };
      rLane.push(raidEntry);
      mutated = true;
    }
    if (!entry.linkedRaidIds.includes(raidEntry.id)) { entry.linkedRaidIds.push(raidEntry.id); mutated = true; }
  }

  if (mutated) writeDb(db);
  res.json({ success: true, task, raid: raidEntry, entry });
});

// D-19/D-21 (06-07): the clearance-scoped organisation rollup — one
// server-computed answer to "where does this organisation stand" so
// public/js/deal-home.js never tallies a target-derived number itself.
// Client-side tallying was rejected on a SECURITY ground, not a stylistic
// one (D-21): computing the delta in the browser would mean shipping
// target-state rows to an uncleared client and hiding them there, exactly
// the failure DD-04's clean-room rules forbid. Structurally mirrors
// GET /api/dd/summary above (06-RESEARCH.md Open Question 2, planner
// discretion): filter/derive once, then compute several named tallies from
// that single pass, rather than a narrowed query per number — keeps the two
// rollup routes shaped alike and leaves room for Plan 08's demo seed and any
// Phase-7 consumer to read more facets from the same pass.
//
// Exported as its own function (not inlined in the route) so Plan 08's seed
// verification and any Phase-7 consumer can call ONE implementation rather
// than reconstructing this shape a second time.
function orgSummaryFor(db, deal, user) {
  const positions = orgPositionsLane(db);
  const current = positions.filter((p) => p.state === orgValidators.ORG_STATE_CURRENT);
  const target = positions.filter((p) => p.state === orgValidators.ORG_STATE_TARGET);

  const summary = {
    open: {
      currentHeadcount: current.filter((p) => p.employeeId).length,
      openPositions: current.filter((p) => !p.employeeId).length,
      currentPositions: current.length,
    },
  };

  // D-20: the restricted key is assigned ONLY inside this branch, as a
  // plain assignment — never from a ternary, never null, never an empty
  // object. Serialisation OMITS a key that was never assigned; this
  // structural omission IS the control (this route's own objective: a
  // masked row still discloses that decisions exist, a zero is itself
  // information).
  if (accessPolicy.hasAreaGrant(deal, user, 'hr')) {
    const targetHeadcount = target.filter((p) => p.employeeId).length;

    // Decision-type counts are derived over the CURRENT-state roster only —
    // the population a retain/redeploy/redundant decision is actually
    // about — mirroring the open tier's own current-state-only headcount
    // above. derivedDecisionFor() is only ever asked about a LIVE
    // current-state position's id here, so a decision entry whose position
    // no longer exists (or was only ever recorded against a target-state
    // row) contributes to no count, per Plan 04's flagged assumption.
    const decisions = orgDecisionsLane(db);
    const decisionCounts = {};
    ORG_DECISION_TYPES.forEach((t) => { decisionCounts[t] = 0; });
    current.forEach((p) => {
      const decision = derivedDecisionFor(decisions, p.id);
      const type = decision ? decision.type : 'open';
      if (decisionCounts[type] !== undefined) decisionCounts[type]++;
    });

    // Unmitigated high/critical flight risks — high/critical level with an
    // EMPTY mitigation, excluding low/medium and mitigated entries. The
    // caller-scoped `mine` count is the field D-22's owner nudge reads.
    const myUsername = String((user && user.username) || '').trim();
    let unmitigated = 0;
    let mineUnmitigated = 0;
    orgFlightRiskLane(db).forEach((r) => {
      const isHighOrCritical = r.riskLevel === 'high' || r.riskLevel === 'critical';
      const isUnmitigated = !String(r.mitigation || '').trim();
      if (!isHighOrCritical || !isUnmitigated) return;
      unmitigated++;
      if (String(r.owner || '').trim() === myUsername) mineUnmitigated++;
    });

    summary.restricted = {
      targetHeadcount,
      delta: targetHeadcount - summary.open.currentHeadcount,
      decisions: decisionCounts,
      unmitigatedFlightRisks: unmitigated,
      mine: { unmitigatedFlightRisks: mineUnmitigated },
    };
  }

  return summary;
}

// This route deliberately writes NO security event of any kind, and carries
// NO explicit role gate. No audit: the flight-risk register's D-03 read
// audit (above) is scoped to the REGISTER's own contents — reading it
// directly is the compliance-relevant act ORG-03 names. This route reports
// PRE-AGGREGATED COUNTS, a materially different disclosure, and the deal
// home is the most-loaded surface in the app; wiring an audit call here
// would drown the compliance record within a day (Plan 05 already asserts
// this boundary from the register's own side; this asserts it again from
// here). No role gate: every number orgSummaryFor() returns above is
// already clearance-scoped BEFORE it is computed — exactly as
// GET /api/dd/summary documents for itself, above.
app.get('/api/org/summary', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  // D-12-02: an uncleared caller's summary is the open tier only, which reads
  // positions alone; the restricted tier also tallies decisions + flight-risks.
  const set = accessPolicy.hasAreaGrant(deal, req.portalUser, 'hr') ? ORG_READ_SET : ORG_POSITIONS_SET;
  res.json(orgSummaryFor(readCollections(set), deal, req.portalUser));
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

// D-12-02 (Phase 12, plan 12-10): the collections the due-diligence handlers
// actually read. A DD request loads exactly these through readCollections()
// instead of reconstructing the whole deal; any other collection a handler
// touches is a throwing accessor (CollectionNotLoadedError), never an empty
// array. Templates (ddRequestTemplates), tasks and RAID are read only by the
// convert/instantiate routes, which stay on readDb().
const DD_READ_SET = ['settings', 'ddRequestItems', 'ddFindings'];

// The caller's own "what do I owe" counts. `items`/`findings` MUST already be
// clearance-filtered (accessPolicy.filterByAreaGrant) — an uncleared area's
// rows can then never contribute to the caller's count (T-04-45). Shared by
// GET /api/dd/summary and GET /api/dd/workspace so the two can never disagree.
function ddMineFor(items, findings, user) {
  const myUsername = String((user && user.username) || '').trim();
  const mine = { openItems: 0, overdueItems: 0, openFindings: 0 };
  items.forEach((item) => {
    if (String(item.owner || '').trim() !== myUsername) return;
    if (item.status !== 'closed') mine.openItems++;
    if (computeOverdue(item)) mine.overdueItems++;
  });
  findings.forEach((finding) => {
    if (String(finding.owner || '').trim() !== myUsername) return;
    if (finding.status === 'open') mine.openFindings++;
  });
  return mine;
}

// One data-room link row — the shape GET /api/dd/vdr-links and the workspace
// both return per item.
function ddVdrLinkEntry(item) {
  return {
    itemId: item.id, text: item.text, url: item.vdrLink.url, folderRef: item.vdrLink.folderRef,
    label: item.vdrLink.label || '', updatedAt: item.vdrLink.updatedAt, updatedBy: item.vdrLink.updatedBy,
  };
}

// DD-05/D-17: applies `vdrLink` from the upsert body onto `item`, called on
// BOTH the create and update paths below. Absent key -> item's own value is
// left untouched. Explicit `vdrLink: null` -> cleared. A non-null value
// REPLACES the stored value wholesale (never merged, never appended) — an
// item carries at most ONE data-room reference, so posting the same
// reference twice leaves exactly one. `updatedAt`/`updatedBy` are stamped
// HERE, server-side, never read from the body — validators/dd.js's
// VdrLinkSchema does not even declare those two keys, so a caller-supplied
// value for either is already stripped before this function runs (T-04-31).
function applyVdrLink(item, b, req) {
  if (!('vdrLink' in b)) return;
  if (b.vdrLink === null) { item.vdrLink = null; return; }
  item.vdrLink = {
    url: b.vdrLink.url,
    folderRef: b.vdrLink.folderRef,
    label: b.vdrLink.label || '',
    updatedAt: new Date().toISOString(),
    updatedBy: req.portalUser.username,
  };
}

// D-16: every DD_AREAS entry the caller is cleared for (never the full
// fixed list) — the page (public/js/due-diligence.js) renders only what
// this route returns and holds no client-side area list of its own.
app.get('/api/dd/areas', (req, res) => {
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const granted = new Set(accessPolicy.grantedAreas(deal, req.portalUser));
  res.json(accessPolicy.DD_AREAS.filter((a) => granted.has(a.id)));
});

// D-12-02 / PD-16: the whole due-diligence workspace in ONE request — the
// caller's cleared areas plus, per cleared area, its request items, findings
// and data-room links, and the caller's own `mine` nudge counts. The page used
// to make 18 requests per load (areas + 2 per area + vdr-links + summary), each
// a full-deal read. Every field is produced by the SAME functions the per-area
// routes use (grantedAreas, filterByAreaGrant, publicDdItem, ddVdrLinkEntry,
// ddMineFor), so each per-area array is byte-for-byte what that route returns.
// [security] D-16/T-12-90: the three by-area objects are seeded ONLY from the
// granted area ids, so an uncleared area has no key, no empty array and no
// count anywhere in the response — absence carries no signal. Rows are
// clearance-filtered BEFORE grouping (T-04-01), never after. T-12-91: one
// `dd-findings-read` row (subject 'workspace') per real-deal load replaces the
// one-per-area rows the page load used to write; demo loads write none,
// matching GET /api/dd/findings.
app.get('/api/dd/workspace', (req, res) => {
  const db = readCollections(DD_READ_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const granted = new Set(accessPolicy.grantedAreas(deal, req.portalUser));
  const areas = accessPolicy.DD_AREAS.filter((a) => granted.has(a.id));

  const items = accessPolicy.filterByAreaGrant(ddRequestLane(db), deal, req.portalUser);
  const findings = accessPolicy.filterByAreaGrant(ddFindingsLane(db), deal, req.portalUser);

  const itemsByArea = {};
  const findingsByArea = {};
  const vdrLinksByArea = {};
  areas.forEach((a) => { itemsByArea[a.id] = []; findingsByArea[a.id] = []; vdrLinksByArea[a.id] = []; });
  items.forEach((item) => {
    if (!itemsByArea[item.area]) return; // defensive; filterByAreaGrant() already guarantees this
    itemsByArea[item.area].push(publicDdItem(item));
    if (item.vdrLink) vdrLinksByArea[item.area].push(ddVdrLinkEntry(item));
  });
  findings.forEach((finding) => {
    if (findingsByArea[finding.area]) findingsByArea[finding.area].push(finding);
  });

  if (!req.isDemo) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'dd-findings-read', dealId: req.dealContext.dealId,
      subject: 'workspace', before: null, after: null, request: requestMeta(req),
    });
  }
  res.json({ areas, itemsByArea, findingsByArea, vdrLinksByArea, mine: ddMineFor(items, findings, req.portalUser) });
});

// T-04-01: filterByAreaGrant() runs server-side on EVERY list response — an
// uncleared area's items are omitted here, never filtered client-side.
app.get('/api/dd/request-items', (req, res) => {
  const db = readCollections(DD_READ_SET);
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
  // WR-01: rate-bounded (first denial of a window writes this exact row; the
  // rest fold into one counted row) — see recordClearanceDenial().
  recordClearanceDenial(req, 'dd-access-denied', 'dd-clearance', areaId == null ? null : areaId);
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
  const db = readCollections(DD_READ_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const item = ddRequestLane(db).find((i) => i.id === req.params.id);
  if (ddAreaRefused(req, res, deal, item ? item.area : null)) return;
  res.json(publicDdItem(item));
});

// D-12-02 (PD-20): DELETE, instantiate and finding convert stay on readDb() —
// rare, multi-lane (convert/instantiate touch tasks + RAID + templates) and
// already proportional on WRITE thanks to the dirty-row writeDb (12-02).
app.delete('/api/dd/request-items/:id', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddRequestLane(db);
  const item = lane.find((i) => i.id === req.params.id);
  if (ddAreaRefused(req, res, deal, item ? item.area : null)) return;
  // CONC-02 (Phase 9, Plan 06 / D-08, T-09-27): the same clearanceFilter as
  // this route's POST sibling — a race that moved the item into an area this
  // caller is no longer cleared for cannot leak the record into a delete
  // conflict body, even though the ddAreaRefused() gate above already
  // guarantees this is unreachable via a single HTTP request (Plan 04's own
  // documented reasoning applies identically here).
  if (conflictIfStale(req, res, item, {
    clearanceFilter: (record) => (record && accessPolicy.hasAreaGrant(deal, req.portalUser, record.area)) ? publicDdItem(record) : null,
  })) return;
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
  const db = readCollections(DD_READ_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddRequestLane(db);

  if (b.id) {
    const item = lane.find((i) => i.id === b.id);
    if (ddAreaRefused(req, res, deal, item ? item.area : null)) return;
    // CONC-02 (Phase 9, Plan 04, T-09-17/T-09-18): the 409 conflict body's
    // `currentRecord` is filtered through the SAME area-clearance gate the
    // route's own read path applies, evaluated against the item's CURRENT
    // area — a concurrent writer may have moved it into an area this caller
    // is no longer cleared for, which is exactly the race this conflict is
    // reporting. On refusal the filter returns null, so the response still
    // carries the version and attribution (the caller learns their write
    // was rejected) but no field value from the item. When granted,
    // `currentRecord` is run through publicDdItem() — the same projection
    // the route's own success response below applies — so the conflict path
    // never discloses a wider shape than the route's 200 response would.
    if (conflictIfStale(req, res, item, {
      clearanceFilter: (record) => (record && accessPolicy.hasAreaGrant(deal, req.portalUser, record.area)) ? publicDdItem(record) : null,
    })) return;
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
    applyVdrLink(item, b, req);
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
  applyVdrLink(item, b, req);
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, item: publicDdItem(item) });
});

// DD-05/D-17: the area-level aggregate of every item's data-room reference —
// "who has seen what part of the data room" in one place, without the app
// ever holding a document of its own. Reuses filterByAreaGrant() on the
// SAME clean-room discipline every other DD list route already applies
// (T-04-28): an uncleared area's items are dropped BEFORE grouping, so an
// aggregate can never leak an uncleared item's reference. An area with no
// referenced item is OMITTED entirely (never returned with an empty
// `links` array) — mirroring GET /api/dd/areas's own D-16 shape, so absence
// carries no signal about whether the caller is cleared for it.
app.get('/api/dd/vdr-links', (req, res) => {
  const db = readCollections(DD_READ_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddRequestLane(db);
  const withLinks = lane.filter((item) => item.vdrLink);
  const visible = accessPolicy.filterByAreaGrant(withLinks, deal, req.portalUser);
  const byArea = new Map();
  visible.forEach((item) => {
    if (!byArea.has(item.area)) byArea.set(item.area, []);
    byArea.get(item.area).push(ddVdrLinkEntry(item));
  });
  const areaFilter = req.query.area;
  const areas = accessPolicy.DD_AREAS
    .filter((a) => byArea.has(a.id) && (!areaFilter || a.id === areaFilter))
    .map((a) => ({ area: a.id, label: a.label, links: byArea.get(a.id) }));
  res.json({ areas });
});

// D-13: the standard DD request checklist, seeded into every new deal via
// db/dealSeed.js's DEAL_SEED_COLLECTIONS allowlist. A template is a standard
// list, not deal content — it carries no MNPI, so this list route is
// unfiltered (no area-grant check), unlike GET /api/dd/request-items above.
app.get('/api/dd/request-templates', (req, res) => {
  // D-12-02: only the templates collection (not in DD_READ_SET — no other DD
  // route reads it except instantiate, which stays on readDb()).
  res.json(readCollections(['ddRequestTemplates']).ddRequestTemplates || []);
});

// Instantiate a DD request template: every item becomes a live request item
// once (source-deduped), so re-running after the IL adds template items only
// creates the new ones — mirrors POST /api/integration-tasks/instantiate's
// exact shape (server.js's own precedent above). Unlike that route, each
// item is ALSO gated by the caller's clearance (grantedAreas(), computed
// once): an item in an uncleared area is skipped and counted, never created,
// so a bulk instantiate can never materialise content the caller could not
// have created one at a time (T-04-16).
app.post('/api/dd/request-items/instantiate', (req, res) => {
  const { templateId } = req.body || {};
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const tpl = (db.ddRequestTemplates || []).find((t) => t.id === templateId);
  if (!tpl) return res.status(404).json({ error: 'Template not found.' });
  const granted = new Set(accessPolicy.grantedAreas(deal, req.portalUser));
  const lane = ddRequestLane(db);
  let created = 0;
  let skipped = 0;
  (tpl.items || []).forEach((tplItem) => {
    if (!granted.has(tplItem.area)) { skipped++; return; }
    const source = 'ddtemplate:' + tpl.id + ':' + tplItem.id;
    if (lane.some((i) => i.source === source)) return;
    lane.push({
      id: newId('ddreq'),
      area: tplItem.area,
      text: tplItem.text || tplItem.id,
      owner: tplItem.ownerHint || '',
      status: 'open',
      dueDate: '',
      blocked: false,
      vdrLink: null,
      notes: '',
      source,
      createdAt: new Date().toISOString(),
      createdBy: req.portalUser.username,
    });
    created++;
  });
  if (created) writeDb(db);
  res.json({ success: true, created, skipped });
});

// =====================================================================
// DD findings register (DD-02/DD-03) — the output of diligence. Same
// eight-area clean-room discipline as request items above: list routes run
// filterByAreaGrant() and record no denial; by-id routes assert clearance
// against the row's OWN stored area and route every refusal through the
// shared refuseDdArea()/ddAreaRefused() helpers defined above. A finding
// converts into a Day-1 task and/or a RAID entry via
// POST /api/dd/findings/:id/convert (DD_AREA_WORKSTREAM section, below the
// findings routes) — this section only owns the finding row itself.
// =====================================================================
function ddFindingsLane(db) {
  db.ddFindings = db.ddFindings || [];
  return db.ddFindings;
}

// D-11/D-26: four severities. Deliberately independent of RAID_LEVELS
// (server.js's RAID section, extended to match by this plan's Task 2) — a
// finding's severity is copied VERBATIM into a converted RAID entry, never
// mapped or clamped.
const DD_FINDING_SEVERITIES = ['low', 'medium', 'high', 'critical'];
// The same three-value lifecycle the RAID lane already uses.
const DD_FINDING_STATUSES = ['open', 'mitigating', 'closed'];

app.get('/api/dd/findings', (req, res) => {
  const db = readCollections(DD_READ_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddFindingsLane(db);
  let visible = accessPolicy.filterByAreaGrant(lane, deal, req.portalUser);
  if (req.query.area) visible = visible.filter((f) => f.area === req.query.area);
  // [security] T-ERM-07 (260810-erm): this route returns a per-caller
  // CLEARED SUBSET and never 403s (filterByAreaGrant silently narrows,
  // rather than refusing), so there is no denial branch to audit here —
  // only the successful read, gated real-deal-only (!req.isDemo), matching
  // GET /api/reports/export's established audit-scoping rule. `subject`
  // names the narrowing area query value, or 'all' for the unnarrowed read.
  if (!req.isDemo) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'dd-findings-read', dealId: req.dealContext.dealId,
      subject: req.query.area || 'all', before: null, after: null, request: requestMeta(req),
    });
  }
  res.json(visible);
});

app.get('/api/dd/findings/:id', (req, res) => {
  const db = readCollections(DD_READ_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const finding = ddFindingsLane(db).find((f) => f.id === req.params.id);
  if (ddAreaRefused(req, res, deal, finding ? finding.area : null)) return;
  // [security] T-ERM-07: ddAreaRefused() (above) already owns the denial
  // path (an unconditional 'dd-access-denied' row, pre-existing) — this is
  // only the successful-read half, gated real-deal-only (!req.isDemo),
  // matching GET /api/reports/export's established audit-scoping rule.
  if (!req.isDemo) {
    auditHook.recordSecurityEvent({
      actor: req.portalUser, action: 'dd-finding-read', dealId: req.dealContext.dealId,
      subject: req.params.id, before: null, after: null, request: requestMeta(req),
    });
  }
  res.json(finding);
});

app.delete('/api/dd/findings/:id', (req, res) => {
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddFindingsLane(db);
  const finding = lane.find((f) => f.id === req.params.id);
  if (ddAreaRefused(req, res, deal, finding ? finding.area : null)) return;
  // CONC-02 (Phase 9, Plan 06 / D-08, T-09-27): the same clearanceFilter as
  // this route's POST sibling.
  if (conflictIfStale(req, res, finding, {
    clearanceFilter: (record) => (record && accessPolicy.hasAreaGrant(deal, req.portalUser, record.area)) ? record : null,
  })) return;
  db.ddFindings = lane.filter((f) => f.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// Upsert-by-id, mirroring POST /api/dd/request-items's shape exactly. On
// UPDATE the guard runs against the finding's STORED area FIRST, before any
// field is mutated (the read model hands back a shared cache, so a mutation
// followed by a refusal would stick). A body that ALSO carries a different
// `area` additionally requires clearance for that NEW area.
app.post('/api/dd/findings', (req, res) => {
  const b = req.body || {};
  const db = readCollections(DD_READ_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const lane = ddFindingsLane(db);

  if (b.id) {
    const finding = lane.find((f) => f.id === b.id);
    if (ddAreaRefused(req, res, deal, finding ? finding.area : null)) return;
    // CONC-02 (Phase 9, Plan 04, T-09-17): the 409 conflict body's
    // `currentRecord` is filtered through the SAME area-clearance gate the
    // route's own read path applies, evaluated against the finding's
    // CURRENT area — a concurrent writer may have moved it into an area
    // this caller is no longer cleared for, which is exactly the race this
    // conflict is reporting. On refusal the filter returns null, so the
    // response still carries the version and attribution (the caller
    // learns their write was rejected) but no field value from the finding.
    if (conflictIfStale(req, res, finding, {
      clearanceFilter: (record) => (record && accessPolicy.hasAreaGrant(deal, req.portalUser, record.area)) ? record : null,
    })) return;
    // VAL-01: title-required-when-id-absent is owned by the schema's own
    // refine(); this empty-title-on-UPDATE guard stays here because the
    // schema's refine only requires title when `id` is absent (see the
    // identical comment on POST /api/dd/request-items above).
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'Finding title cannot be empty.' });
    }
    if (b.area !== undefined && b.area !== finding.area) {
      if (ddAreaRefused(req, res, deal, b.area)) return;
    }
    if (b.title !== undefined) finding.title = String(b.title).trim().slice(0, 2000);
    if (b.severity !== undefined && DD_FINDING_SEVERITIES.includes(b.severity)) finding.severity = b.severity;
    if (b.status !== undefined && DD_FINDING_STATUSES.includes(b.status)) finding.status = b.status;
    if (b.owner !== undefined) finding.owner = String(b.owner || '').slice(0, 120);
    if (b.notes !== undefined) finding.notes = String(b.notes || '').slice(0, 2000);
    if (b.area !== undefined) finding.area = b.area;
    writeDb(db);
    return res.json({ success: true, finding });
  }

  if (ddAreaRefused(req, res, deal, b.area)) return;
  const finding = {
    id: newId('ddfind'),
    area: b.area,
    title: String(b.title || '').trim().slice(0, 2000),
    severity: DD_FINDING_SEVERITIES.includes(b.severity) ? b.severity : 'medium',
    owner: String(b.owner || '').slice(0, 120),
    status: 'open',
    notes: String(b.notes || '').slice(0, 2000),
    linkedTaskIds: [],
    linkedRaidIds: [],
    createdAt: new Date().toISOString(),
    createdBy: req.portalUser.username,
  };
  lane.push(finding);
  writeDb(db);
  res.status(201).json({ success: true, finding });
});

// D-25: which workstream a converted finding's Day-1 task/RAID entry lands
// under — one hard-coded mapping, shaped exactly like REMEDIATION_WS above,
// not a per-conversion choice. `tax` folds into the finance workstream
// because no dedicated tax workstream exists (mirrors REMEDIATION_WS's own
// fold-in reasoning). `complianceEsg` folds into the legal workstream
// because that workstream's own label already reads as legal and
// compliance.
const DD_AREA_WORKSTREAM = {
  legal: 'ws_legal', financial: 'ws_finance', tax: 'ws_finance', hr: 'ws_hr',
  it: 'ws_it', commercial: 'ws_sales', operations: 'ws_ops', complianceEsg: 'ws_legal',
};

// One-click DD-02/DD-03/D-12 conversion: turns a finding into a pre-filled
// Day-1 task and/or RAID entry, bidirectionally linked and deduped by a
// stable 'dd-finding:<findingId>' source string so re-clicking is a no-op.
// A NEW route — deliberately not calling/extending
// POST /api/integration-tasks/from-remediation (that route takes an
// assessmentTemplateId and derives its work from dimension scores; there is
// no finding-shaped input path into it). Only the PATTERN is reused: dedup
// by source, pre-filled fields, one write at the end.
app.post('/api/dd/findings/:id/convert', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const findingsLane = ddFindingsLane(db);
  const finding = findingsLane.find((f) => f.id === req.params.id);
  // Clearance is asserted BEFORE any field of the finding is read or
  // returned — the convert route must never become a side channel that
  // confirms a finding exists in an area the caller cannot see.
  if (ddAreaRefused(req, res, deal, finding ? finding.area : null)) return;
  // CONC-02 (Phase 9, Plan 04, D-02): this route mutates the finding itself
  // (it writes linkedTaskIds/linkedRaidIds below), so it carries the same
  // version precondition as any other finding edit — a conversion based on
  // a stale finding is refused rather than applied. Placed BEFORE `source`/
  // `workstreamId` are derived and before the task/RAID lanes are touched,
  // so a stale-version conflict leaves the finding, the task lane and the
  // RAID lane all untouched (Pitfall 6) — nothing here has mutated anything
  // yet. Same clearance-filtered conflict body as POST /api/dd/findings.
  if (conflictIfStale(req, res, finding, {
    clearanceFilter: (record) => (record && accessPolicy.hasAreaGrant(deal, req.portalUser, record.area)) ? record : null,
  })) return;

  const source = 'dd-finding:' + finding.id;
  const workstreamId = DD_AREA_WORKSTREAM[finding.area] || 'ws_imo';
  let mutated = false;
  let task = null;
  let raidEntry = null;

  // [security] D-11-03 / R1-02 (Phase 11): BOTH source-matched existing
  // records are looked up and clearance-checked BEFORE either lane is
  // mutated (readDb() hands back the shared cache — a task pushed and then a
  // 404 thrown for the RAID half would leave the pushed task in the cache).
  // The finding's own area gate above does NOT cover this: a record stamped
  // with a DIFFERENT area (the finding was re-pointed to another area after
  // its first conversion — clearanceArea is deliberately sticky) must never
  // be handed back in the 200 body to a caller not cleared for the STAMPED
  // area. It answers the central 404 — never a leak, never a duplicate.
  // [security] WR-02 (Phase 11 review): adopt an existing record only when it
  // ALSO carries a server-side `clearanceArea` stamp (any DD area — the stamp
  // is deliberately sticky across a re-pointed finding, see above). The
  // upsert schemas strip clearanceArea and refuse reserved sources, so a
  // record planted with a matching `source` can never be adopted as the
  // finding's conversion; the genuine record is minted instead.
  const isOwnConversion = (rec) => rec.source === source
    && typeof rec.clearanceArea === 'string' && accessPolicy.DD_AREA_IDS.includes(rec.clearanceArea);
  const existingTask = b.toTask ? (taskLane(db).find(isOwnConversion) || null) : null;
  const existingRaid = b.toRaid ? (raidLane(db).find(isOwnConversion) || null) : null;
  if (existingTask) assertRecordVisibleOr404(req, db, deal, existingTask);
  if (existingRaid) assertRecordVisibleOr404(req, db, deal, existingRaid);

  if (b.toTask) {
    const tLane = taskLane(db);
    task = existingTask;
    if (!task) {
      task = {
        id: newId('task'),
        title: finding.title,
        workstreamId,
        phase: 'day1',
        owner: finding.owner || '',
        due: '',
        status: 'todo',
        source,
        // [security] T-ERM-01/WR-03 (260810-erm): the resolved clearance
        // area is stamped onto the TASK at conversion time, mirroring this
        // same route's RAID-entry stamp a few lines below —
        // resolveTaskClearanceArea() prefers this stamp over source-
        // parsing, so deleting this finding later can never widen this
        // task's audience back to the whole deal team.
        clearanceArea: finding.area,
        createdAt: new Date().toISOString(),
      };
      tLane.push(task);
      mutated = true;
    }
    if (!finding.linkedTaskIds.includes(task.id)) { finding.linkedTaskIds.push(task.id); mutated = true; }
  }

  if (b.toRaid) {
    const rLane = raidLane(db);
    raidEntry = existingRaid;
    if (!raidEntry) {
      raidEntry = {
        id: newId('raid'),
        type: 'risk',
        title: finding.title,
        // D-11/T-04-24: copied VERBATIM — no mapping table, no clamping.
        // finding.severity is already one of DD_FINDING_SEVERITIES' four
        // values, and RAID_LEVELS (server.js, above) now carries the same
        // four values (Task 2), so this can never fall through to a default.
        severity: finding.severity,
        owner: finding.owner || '',
        workstreamId,
        status: 'open',
        notes: finding.notes || '',
        source,
        // WR-03 (06-REVIEW.md): the resolved clearance area is stamped onto
        // the RAID entry AT CONVERSION TIME, not re-derived from `source`
        // on every read — resolveRaidEntryClearanceArea() (Due Diligence
        // section, below) prefers this field when present, so deleting
        // this finding later can never widen this entry's audience back to
        // the whole deal (fail-closed: deletion never DEclassifies).
        clearanceArea: finding.area,
        createdAt: new Date().toISOString(),
      };
      rLane.push(raidEntry);
      mutated = true;
    }
    if (!finding.linkedRaidIds.includes(raidEntry.id)) { finding.linkedRaidIds.push(raidEntry.id); mutated = true; }
  }

  if (mutated) writeDb(db);
  res.json({ success: true, task, raid: raidEntry, finding });
});

// D-15/DD-04: the clearance-scoped diligence rollup — one request answers
// "where do I stand across every area I'm cleared for, and what's overdue"
// without the caller (public/js/deal-home.js) assembling it themselves from
// the list routes above. Deliberately unguarded by an explicit role check,
// mirroring GET /api/dd/request-items/GET /api/dd/findings above: every
// number this route returns is already scoped to the CALLER's own clearance
// via filterByAreaGrant() BEFORE any tally runs, so any deal member — not
// just admin/hrbp — can safely call it. This is a different shape of read
// from GET /api/deals/:id/grants (narrowed to admin/hrbp above) because that
// route returns EVERY member's clearance map for an arbitrary deal id,
// unfiltered by the caller's own grant; this route only ever reports the
// caller's own view.
app.get('/api/dd/summary', (req, res) => {
  const db = readCollections(DD_READ_SET);
  const deal = controlStore.getDeal(req.dealContext.dealId);
  const grantedSet = new Set(accessPolicy.grantedAreas(deal, req.portalUser));

  // T-04-45: filter BEFORE any tally is computed — an uncleared area's rows
  // never reach the counting loops below, so the aggregate itself can carry
  // no residue of an area the caller cannot see.
  const items = accessPolicy.filterByAreaGrant(ddRequestLane(db), deal, req.portalUser);
  const findings = accessPolicy.filterByAreaGrant(ddFindingsLane(db), deal, req.portalUser);

  const emptyItemCounts = () => ({ total: 0, open: 0, requested: 0, received: 0, reviewed: 0, closed: 0, blocked: 0, overdue: 0 });
  const emptyFindingCounts = () => ({ total: 0, low: 0, medium: 0, high: 0, critical: 0, open: 0 });

  // D-16/T-04-46: seeded ONLY for areas the caller is granted, in DD_AREAS'
  // declared order — an uncleared area gets no entry at all (never a zero
  // row), so its absence carries no signal about whether it exists.
  const byArea = new Map();
  accessPolicy.DD_AREAS.forEach((a) => {
    if (grantedSet.has(a.id)) byArea.set(a.id, { area: a.id, label: a.label, items: emptyItemCounts(), findings: emptyFindingCounts() });
  });

  items.forEach((item) => {
    const bucket = byArea.get(item.area);
    if (!bucket) return; // defensive; filterByAreaGrant() already guarantees this
    bucket.items.total++;
    if (bucket.items[item.status] !== undefined) bucket.items[item.status]++;
    if (item.blocked) bucket.items.blocked++;
    // D-15: reuses computeOverdue() (defined above in this section) — one
    // implementation of "overdue", never a second copy that could disagree
    // with the per-item value the list routes already attach.
    if (computeOverdue(item)) bucket.items.overdue++;
  });

  findings.forEach((finding) => {
    const bucket = byArea.get(finding.area);
    if (!bucket) return;
    bucket.findings.total++;
    if (bucket.findings[finding.severity] !== undefined) bucket.findings[finding.severity]++;
    if (finding.status === 'open') bucket.findings.open++;
  });

  const areas = accessPolicy.DD_AREAS.filter((a) => byArea.has(a.id)).map((a) => byArea.get(a.id));

  // Sums ONLY the areas actually returned above (T-04-45) — never the
  // deal's true totals, so the number a caller sees is the number they are
  // entitled to.
  const totals = areas.reduce((acc, a) => {
    acc.items += a.items.total;
    acc.overdue += a.items.overdue;
    acc.findings += a.findings.total;
    acc.criticalFindings += a.findings.critical;
    return acc;
  }, { items: 0, overdue: 0, findings: 0, criticalFindings: 0 });

  // `mine` is derived from the SAME already-filtered `items`/`findings`
  // arrays above — an uncleared area's own rows can never contribute to the
  // caller's own "what do I owe" count either (ddMineFor, shared with the
  // workspace route).
  const mine = ddMineFor(items, findings, req.portalUser);

  res.json({ areas, totals, mine });
});

// =====================================================================
// In-app notifications — computed on demand from live data (no stored
// notification records to drift out of sync).
// =====================================================================
// The demo runs on its own clock: "now" is day N of the seeded 100-day arc,
// not the wall clock — otherwise seeded due dates go permanently overdue and
// ignore time travel. Custom projects use the real date.
const DEMO_ARC_START_MS = Date.parse('2026-05-01T09:00:00.000Z');
function portalNowMs(db, req) {
  // v3.0 R4 F2 (IL-03 server half): a REAL deal carries no `demoMode` flag in
  // its settings singleton, so the old test (`demoMode === false`) fell through
  // to the frozen demo arc and every real deal's overdue signal ran on 2026-05-30.
  // A deal-bound request (not the demo store) always uses the wall clock.
  const isRealDeal = !!(req && req.isDemo === false);
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom || isRealDeal) return Date.now();
  const day = (db.settings && db.settings.timeTravelDay) || 30;
  return DEMO_ARC_START_MS + (day - 1) * 86400000;
}

app.get('/api/notifications', (req, res) => {
  // D-12-02 (12-09): assessment templates/instances + settings (clock, lane
  // choice) are read whole; the task and RAID counts below come from the
  // light projection (status/due/severity only) — no row is parsed.
  const db = readCollections(['settings', 'assessmentTemplates', 'assessmentInstances', 'customAssessmentInstances']);
  const items = [];
  const visible = visibleAssessInstances(db);
  (db.assessmentTemplates || []).filter(t => t.published !== false && t.required).forEach(t => {
    if (!latestAssessInstanceFor(visible, t.id, 'self')) {
      items.push({ id: 'assess_' + t.id, type: 'assessment_pending', titleKey: t.titleKey || '', title: t.title || '', href: '/assessments.html', severity: 'high' });
    }
  });
  const nowMs = portalNowMs(db, req);
  const ilTpl = (db.assessmentTemplates || []).find(t => t.subject === 'integration-leader' && t.published !== false);
  if (ilTpl) {
    const latest = latestAssessInstanceFor(visible, ilTpl.id, 'self');
    if (latest && (nowMs - Date.parse(latest.timestamp)) > 90 * 86400000) {
      items.push({ id: 'reassess_il', type: 'reassess_il', href: '/assessments.html', severity: 'medium' });
    }
  }
  const today = new Date(nowMs).toISOString().slice(0, 10);
  // [security] T-ERM-08 (260810-erm): DOCUMENTED ACCEPTED RESIDUAL — the
  // tasks_overdue/tasks_blocked nudge counts below are computed over the
  // UNfiltered taskLane(db), not reportTaskRows(), deliberately. They are
  // aggregate integers with no title/name/owner attached, exactly matching
  // the existing accepted treatment of the raidHigh nudge count immediately
  // below (which is likewise computed over the unfiltered raidLane(db)) —
  // an uncleared viewer learns only a count, never which task or entry it
  // is. Do not "fix" this to reportTaskRows() without also revisiting the
  // raidHigh precedent it mirrors.
  //
  // [security] D-11-01 / T-11-43 (Phase 11 plan 05) extends the residual: the
  // counts stay unfiltered by CLEARANCE for roles that may read the lanes, but
  // are withheld ENTIRELY from a role the read matrix refuses the lane — an
  // employee must not learn task/RAID figures the lane routes would 403. One
  // source of truth: lib/readPolicy.js (no second role list here). The demo
  // store (req.isDemo === true) and an unauthenticated demo-open request are
  // not "strict" and keep today's response for every role.
  const readPolicy = require('./lib/readPolicy');
  const strict = req.isDemo !== true && req.portalUser;
  const mayReadTasks = !strict || readPolicy.roleAllowedForRead(req.portalUser.role, '/api/integration-tasks');
  const mayReadRaid = !strict || readPolicy.roleAllowedForRead(req.portalUser.role, '/api/raid');
  // A projected scalar is trusted only when it is a string (or absent); any
  // other stored type falls back to the row's own JSON so the verdict equals
  // the one the full-row filter gave.
  const projected = (row, name) => {
    const v = row.f[name];
    return (v === null || typeof v === 'string') ? v : JSON.parse(row.raw)[name];
  };
  if (mayReadTasks) {
    const tasks = readProjection(taskLaneName(db.settings), ['status', 'due']);
    let overdueCount = 0, blockedCount = 0;
    tasks.forEach((row) => {
      const status = projected(row, 'status');
      const due = projected(row, 'due');
      if (status !== 'done' && due && due < today) overdueCount++;
      if (status === 'blocked') blockedCount++;
    });
    if (overdueCount) items.push({ id: 'tasks_overdue', type: 'tasks_overdue', count: overdueCount, href: '/execution.html', severity: 'high' });
    if (blockedCount) items.push({ id: 'tasks_blocked', type: 'tasks_blocked', count: blockedCount, href: '/execution.html', severity: 'medium' });
  }
  if (mayReadRaid) {
    const raidHigh = readProjection(raidLaneName(db.settings), ['status', 'severity']).filter((row) => {
      const severity = projected(row, 'severity');
      return projected(row, 'status') !== 'closed' && (severity === 'high' || severity === 'critical');
    });
    if (raidHigh.length) items.push({ id: 'raid_high', type: 'raid_high', count: raidHigh.length, href: '/execution.html', severity: 'high' });
  }
  res.json({ success: true, items });
});

app.delete('/api/raid/:id', (req, res) => {
  const db = readCollections(RAID_READ_SET);
  const lane = raidLane(db);
  const entry = lane.find(r => r.id === req.params.id);
  // [security] D-11-03 / R1-02: missing AND out-of-clearance both answer the
  // central 404 `{ error: 'Not found' }` BEFORE conflictIfStale() (its 409
  // echoes the record) — an uncleared member cannot delete a restricted
  // RAID entry by id, nor learn it exists.
  const deal = controlStore.getDeal(req.dealContext && req.dealContext.dealId);
  assertRecordVisibleOr404(req, db, deal, entry);
  // CONC-02 (Phase 9, Plan 06 / D-08): the representative route — stale-delete
  // rejection via the query-channel version precondition. A delete that
  // carries NO expectedVersion cannot be judged stale, so it is refused in a
  // real deal (plan 09-08, GD-1a, D-02 no exemptions); demo stays lenient.
  if (conflictIfStale(req, res, entry, { clearanceFilter: recordClearanceFilter(req, db, deal) })) return;
  const filtered = lane.filter(r => r.id !== req.params.id);
  if (db.settings && db.settings.demoMode === false) db.customRaidEntries = filtered;
  else db.raidEntries = filtered;
  writeDb(db);
  res.json({ success: true });
});

// =====================================================================
// Reports & Exports (RPT-01). Plan 07-01's tracer proved the whole export
// architecture end to end on ONE dataset/format combination (RAID as CSV);
// Plan 07-02 fills in the remaining three datasets and the JSON format on
// the SAME architecture — one zod whitelist, one handler, one audit call
// site. See lib/reportCsv.js (RFC 4180 quoting, CRLF terminators, UTF-8 BOM,
// formula-injection neutralisation) and lib/reportFilename.js (codename
// sanitisation + safe Content-Disposition) for the reusable pieces this
// route composes.
//
// D-09 IS the zod enum below, not a denylist: `dataset` names exactly the
// four datasets RPT-01/02 cover (workstreams, tasks, raid, synergies).
// Org/talent data (positions, decisions, flight-risk) has NO export surface
// at all — a crafted request naming any of them is refused with 400 before
// any lane is ever opened, with no branch to forget to update if a future
// org/talent collection is added.
// D-12-02 (12-11): the union of every collection the four datasets and the pack
// read — the lane helpers they call (taskLane/raidLane/synergyLane choose the
// custom or demo lane from `settings`; resolve*ClearanceArea consults
// ddFindings for dd-finding: provenance; computeWorkstreamRollup reads the
// first checklist template; the pack carries the `i18n` bundle). Named so the
// equality suite and a throwing accessor catch a helper that grows a new read.
const REPORT_SET = [
  'settings', 'i18n', 'checklistTemplates', 'ddFindings',
  'integrationTasks', 'customIntegrationTasks',
  'raidEntries', 'customRaidEntries',
  'synergyInitiatives', 'customSynergyInitiatives',
];
app.REPORT_SET = REPORT_SET;
const ReportExportQuerySchema = z.object({
  dataset: z.enum(['workstreams', 'tasks', 'raid', 'synergies']),
  format: z.enum(['csv', 'json']),
});

app.get('/api/reports/export', (req, res) => {
  const parsed = ReportExportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'dataset must be one of workstreams/tasks/raid/synergies and format must be csv or json.' });
  }
  const { dataset, format } = parsed.data;

  try {
    const db = readCollections(REPORT_SET);
    const deal = controlStore.getDeal(req.dealContext.dealId);

    let rows;
    let columns;
    if (dataset === 'raid') {
      // D-08/T-07-28 (07-06): reportRaidRows() is now the SINGLE clearance-
      // filtered RAID read GET /api/reports/pack calls too — never a second,
      // divergent implementation.
      rows = reportRaidRows(db, deal, req.portalUser);
      // Mirrors the fields the RAID tab already shows that caller (D-08 parity).
      columns = [
        { key: 'id', header: 'ID' },
        { key: 'type', header: 'Type' },
        { key: 'severity', header: 'Severity' },
        { key: 'probability', header: 'Probability' },
        { key: 'title', header: 'Title' },
        { key: 'owner', header: 'Owner' },
        { key: 'workstreamId', header: 'Workstream' },
        { key: 'status', header: 'Status' },
      ];
    } else if (dataset === 'workstreams') {
      // Single server-side implementation — see computeWorkstreamRollup(db)
      // next to taskLane(db) above. Never re-derived here.
      // [security] T-ERM-03 (260810-erm): caller-aware since Task 1 — a
      // hidden hr-retention task can no longer inflate the ws_hr count for
      // an uncleared viewer.
      rows = computeWorkstreamRollup(db, deal, req.portalUser);
      columns = [
        { key: 'id', header: 'ID' },
        { key: 'label', header: 'Label' },
        { key: 'tasksTotal', header: 'Tasks total' },
        { key: 'tasksDone', header: 'Tasks done' },
        { key: 'pctComplete', header: 'Percent complete' },
        { key: 'blocked', header: 'Blocked' },
        { key: 'ragStatus', header: 'RAG status' },
      ];
    } else if (dataset === 'tasks') {
      // [security] T-ERM-01 (260810-erm): tasks now carry the SAME clearance
      // concept as RAID — reportTaskRows() is the single filtered read
      // GET /api/integration-tasks and the PDF pack both call too, so a
      // converted MNPI task (hr-flight-risk or dd-finding provenance) is
      // never republished here to a caller uncleared for its stamped area.
      rows = reportTaskRows(db, deal, req.portalUser);
      columns = [
        { key: 'id', header: 'ID' },
        { key: 'title', header: 'Title' },
        { key: 'workstreamId', header: 'Workstream' },
        { key: 'phase', header: 'Phase' },
        { key: 'status', header: 'Status' },
        { key: 'owner', header: 'Owner' },
        { key: 'due', header: 'Due' },
        { key: 'source', header: 'Source' },
      ];
    } else {
      // synergies — D-08/T-07-28 (07-06): reportSynergyRows() is now the
      // SINGLE enriched-synergies read GET /api/reports/pack calls too, so
      // the JSON export can never diverge from the pack's shape either.
      const ctx = { staleDays: synergyStaleDays(db, dealSettingsFor(req)), nowMs: Date.now() };
      rows = reportSynergyRows(db, ctx, synergyLinksVisibleTo(req, db)); // IN-01
      columns = [
        { key: 'id', header: 'ID' },
        { key: 'title', header: 'Title' },
        { key: 'category', header: 'Category' },
        { key: 'stage', header: 'Stage' },
        { key: 'targetM', header: 'Target ($M)' },
        { key: 'realizedM', header: 'Realized ($M)' },
        { key: 'costIncurredM', header: 'Cost incurred ($M)' },
        { key: 'netBenefitM', header: 'Net benefit ($M)' },
        { key: 'owner', header: 'Owner' },
        { key: 'workstreamId', header: 'Workstream' },
        { key: 'stale', header: 'Stale' },
        // RPT-04/07-UI-SPEC.md §4: the day-count column immediately after
        // the existing stale column — the CSV's data-only equivalent of the
        // pack's "Stale {N}d" tag, since a spreadsheet cell has no visual
        // weight to dim. Sourced from enrichSynergy()'s staleDays field
        // (07-04-PLAN.md Task 2), so the export, the pack, and any future
        // reader all move together with the deal's one threshold (D-14).
        { key: 'staleDays', header: 'Stale days' },
        { key: 'lastConfirmedAt', header: 'Last confirmed' },
      ];
    }

    // D-07/D-09: the filename is built from the deal's CODENAME (deal.name —
    // the same field the header deal-switcher pill renders), NEVER
    // deal.targetCompany, the real legal target name that exists separately
    // precisely so it can be withheld. The extension now tracks the
    // requested format.
    const filename = reportFilename.buildReportFilename((deal && deal.name) || '', dataset, format);
    // D-08: the JSON body is the SAME array of objects the CSV branch above
    // derived its rows from, serialised whole — never a bespoke export
    // schema that can drift from the live GET route's own shape.
    const body = format === 'json' ? JSON.stringify(rows) : reportCsv.toCsv(rows, columns);
    res.setHeader('Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8');
    reportFilename.setContentDisposition(res, filename);

    // D-10/D-11: exactly one audit event per successful real-deal export,
    // for either format and any dataset, gated on the request not being a
    // demo request — demo keeps full export parity and gains no audit rows.
    // The row count reflects the rows actually written to this response.
    //
    // KNOWN, ACCEPTED LABELLING GAP (06-RESEARCH.md Assumptions Log A2, cited
    // by 07-RESEARCH.md Pitfall 4): db/auditHook.js's recordSecurityEvent()
    // hardcodes the audit row's db_kind column to the literal 'control' for
    // EVERY caller. This export is conceptually deal-scoped and will be
    // recorded with the control-plane label regardless. This route
    // deliberately does not work around it — writing to the audit
    // connection directly would break db/controlStore.js's
    // zero-reference-to-audit.db isolation guarantee (AUD-02).
    if (!req.isDemo) {
      auditHook.recordSecurityEvent({
        actor: req.portalUser, action: 'report-export', dealId: req.dealContext.dealId,
        subject: dataset, before: null, after: { format, rowCount: rows.length },
        request: requestMeta(req),
      });
    }

    res.send(body);
  } catch (error) {
    // [security] D-06/D-11/CONC-01: the audit write (recordSecurityEvent)
    // inside this try is itself a SQLite write — its contention must still
    // 503 through the central middleware, uniformly with every other write
    // path, never a swallowed local 500.
    if (isBusyError(error)) throw error;
    console.error('Error generating report export:', error);
    res.status(500).json({ error: 'Failed to generate the export.' });
  }
});

// D-12-02 (12-11): the pack's DATA ASSEMBLY, extracted so the equality suite
// can prove `buildPackModel(readCollections(REPORT_SET), ctx)` equals
// `buildPackModel(readDb(), ctx)`. `ctx` carries everything request- or
// clock-derived: { req, deal, language, generatedAt: Date, nowMs: number }.
// Returns { hasAnyData, model, counts }; `model` is null for the entirely
// empty deal (the route answers 409 before any render). Same shared
// clearance-filtered helpers the CSV export calls (T-07-28/D-08) — no second
// implementation.
function buildPackModel(db, ctx) {
  const { req, deal, language, generatedAt, nowMs } = ctx;
  const raid = reportRaidRows(db, deal, req.portalUser);
  const workstreams = computeWorkstreamRollup(db, deal, req.portalUser);
  const tasks = reportTaskRows(db, deal, req.portalUser);
  const synergyCtx = { staleDays: synergyStaleDays(db, dealSettingsFor(req)), nowMs };
  // RPT-03 (D-04 Section 4, amended 2026-08-09): `stageAtBaseline` resolved
  // server-side from baselines[] — lib/reportPack.js performs no database logic.
  const synergies = reportSynergyRows(db, synergyCtx, synergyLinksVisibleTo(req, db)).map((item) => // IN-01
    Object.assign({}, item, { stageAtBaseline: stageAtLastBaseline(item) })
  );
  const counts = { workstreams: workstreams.length, tasks: tasks.length, raid: raid.length, synergies: synergies.length };
  const hasAnyData = raid.length > 0 || workstreams.length > 0 || tasks.length > 0 || synergies.length > 0;
  if (!hasAnyData) return { hasAnyData, model: null, counts };

  // T-05-47/D-01/WR-05: the SAME shared computeSynergyRollupSplit() helper
  // GET /api/synergies/rollup calls, over the SAME enriched `synergies` array.
  const { grossRealizedM, unphasedRealizedM, costIncurredM, netBenefitM, dealTargetM, staleCount } = computeSynergyRollupSplit(synergies);
  const model = {
    deal: { name: (deal && deal.name) || '' }, // the CODENAME — deal.targetCompany is never read here (T-07-22).
    language,
    generatedAt: formatPackTimestamp(generatedAt),
    generatedBy: req.portalUser.username,
    i18n: db.i18n,
    rollup: { grossRealizedM, unphasedRealizedM, costIncurredM, netBenefitM, dealTargetM, staleCount },
    workstreams,
    tasks,
    raid,
    synergies,
    staleThresholdDays: synergyStaleDays(db, dealSettingsFor(req)),
  };
  return { hasAnyData, model, counts };
}
app.buildPackModel = buildPackModel;

// RPT-02/RPT-03/RPT-04 (07-06 Task 2): the steering-committee PDF pack. A
// deliberate GET — the write-role policy (ROLE_WRITE_POLICY) only gates
// non-read methods, so D-08's any-deal-member access falls out of the
// existing gate with no new policy entry, exactly like GET /api/reports/export
// above.

/** "2026-08-09 14:32 UTC" — one server-resolved string, read verbatim by
 * both the header and footer bands (lib/reportPack.js never formats a
 * date/timestamp itself, per its own module contract). */
function formatPackTimestamp(date) {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// Quick task 260810-e1j: the lazy accessor for lib/reportPack — see the
// require-cluster comment near the top of this file for why the require
// cannot run at module load. A failed load is cached PERMANENTLY for the
// process lifetime rather than retried per request: a missing native binding
// is a fixed property of the host plus the committed node_modules tree, and
// neither can change while the process runs, so a retry could only re-emit
// the identical error and re-pay a failed module resolution on every
// request. This is deliberately UNLIKE the WR-03 review finding, where
// permanently poisoning a genuinely TRANSIENT failure was wrong — a missing
// skia binding is not transient, so the same "poison once" shape is correct
// here.
let reportPackModule = null;
let reportPackUnavailable = false;
function getReportPack() {
  if (reportPackModule) return reportPackModule;
  if (reportPackUnavailable) return null;
  try {
    reportPackModule = require('./lib/reportPack');
    return reportPackModule;
  } catch (error) {
    reportPackUnavailable = true;
    console.error('[portability] lib/reportPack (steerco PDF pack) could not be loaded on this host — GET /api/reports/pack will return 503 until the process restarts:', error && error.message);
    return null;
  }
}

// [security] D-12-05 / DATA-05 / R2-03 (Phase 12, plan 12-04): the pack render
// is 2-4 s of pure CPU and the route is reachable by any deal member — run on
// the main thread it froze the whole portal for everyone per click (measured
// 2,397 ms blocked). It now renders in a persistent worker thread
// (lib/workers/report-pack-worker.js) behind a ONE-in-flight guard: a second
// concurrent request is REFUSED 429 + Retry-After, never queued — an unbounded
// queue of multi-second CPU jobs is the same denial of service with extra
// memory. Data assembly, the clearance filtering, the audit event and the
// response stay on the main thread; the worker gets the already-filtered
// model and returns bytes only (Phase 8 D-03: it never opens SQLite).
const packTask = createIsolatedTask({
  name: 'report-pack',
  workerFile: path.join(__dirname, 'lib', 'workers', 'report-pack-worker.js'),
});
const PACK_BUSY_RETRY_AFTER_SECONDS = 5;
const PACK_BUSY_MESSAGE = 'A steering committee pack is already being generated. Try again in a few seconds.';

app.get('/api/reports/pack', async (req, res, next) => {
  const packLib = getReportPack();
  if (!packLib) {
    // `retryable: false` (PD-15): this is a fixed property of the host, not
    // contention — the client's Phase 8 busy-retry must not re-fire it 3x and
    // then tell the user a read "was not saved".
    return res.status(503).json({ error: 'PDF pack generation is unavailable on this host platform', retryable: false });
  }

  // `.catch('en')` (zod's default-on-parse-failure combinator, available since
  // the 4.4.3 pin already used elsewhere in this file) is deliberate: a
  // missing or unsupported language code is not a client error, it silently
  // resolves to English — matching lib/reportPack.js's own resolveLanguage()
  // fallback contract. `lang` (not `language`) is the query key, matching the
  // browser's fetch call this plan's own button wiring issues (Task 3) — and
  // is also the ENTIRE query-parameter surface this route reads; no other
  // request-supplied value reaches the model (T-07-32).
  const language = z.enum(packLib.SUPPORTED_LANGUAGES).catch('en').parse(req.query.lang);

  // One render at a time per process. tryAcquire() is synchronous and nothing
  // awaits between it and the try below, so two requests can never both pass.
  const lease = packTask.tryAcquire();
  if (!lease) {
    res.set('Retry-After', String(PACK_BUSY_RETRY_AFTER_SECONDS));
    return res.status(429).json({ error: PACK_BUSY_MESSAGE });
  }

  try {
    // D-12-02 (12-11): REPORT_SET, not the whole deal. The assembly itself —
    // the same clearance-filtered helpers the CSV export calls (T-07-28/D-08)
    // and the T-ERM-01/T-ERM-03 caller-aware task/workstream reads — lives in
    // buildPackModel() beside the export handler so it is provable equal to
    // the full-read result. The timestamp and username are resolved
    // server-side from the same req.portalUser/clock this generation's audit
    // event records below — never a client-supplied value (T-07-32).
    const db = readCollections(REPORT_SET);
    const deal = controlStore.getDeal(req.dealContext.dealId);
    const built = buildPackModel(db, { req, deal, language, generatedAt: new Date(), nowMs: Date.now() });

    // A deal with NO workstream, task, RAID or synergy data at all cannot be
    // summarised — refused with 409 so the button can show it inline. A deal
    // that merely has one empty section still generates normally.
    if (!built.hasAnyData) {
      return res.status(409).json({
        error: 'This deal has no data yet — a steering committee pack cannot summarise a deal with no workstreams, tasks, risks or synergies recorded.',
      });
    }
    const { model, counts } = built;

    // Rendered off the main event loop (see packTask above). The test hook
    // makes the worker throw so the crash/respawn path is provable; it is
    // ignored on a real-deal host (T-12-35).
    const testThrow = process.env.MA_TEST_PACK_WORKER_THROW === '1' && process.env.MA_MODE !== 'real';
    const rendered = await lease.run({ model, testThrow });
    const pdfBuffer = Buffer.from(rendered.pdf);

    // D-07/D-09: filename discipline identical to the raw exports — the
    // deal's CODENAME, never deal.targetCompany.
    const filename = reportFilename.buildReportFilename((deal && deal.name) || '', 'steerco-pack', 'pdf');
    res.setHeader('Content-Type', 'application/pdf');
    reportFilename.setContentDisposition(res, filename);

    // D-10/D-11: exactly one audit event per successful real-deal pack
    // generation, naming the actor, deal, format and scope, and carrying the
    // per-section row counts — gated on the request not being a demo
    // request, mirroring GET /api/reports/export's identical audit-scoping
    // rule immediately above. Same accepted db_kind:'control' labelling
    // residual documented there (06-RESEARCH.md Assumptions Log A2).
    if (!req.isDemo) {
      auditHook.recordSecurityEvent({
        actor: req.portalUser, action: 'report-pack-generated', dealId: req.dealContext.dealId,
        subject: 'steerco-pack',
        before: null,
        after: {
          format: 'pdf', language,
          rowCounts: counts,
        },
        request: requestMeta(req),
      });
    }

    res.send(pdfBuffer);
  } catch (error) {
    // [security] D-06/CONC-01: async handler — forward via next(), never a
    // bare re-throw (RESEARCH.md Pitfall 2). The audit write
    // (recordSecurityEvent) inside this try is itself a SQLite write whose
    // contention must reach the client as 503, uniformly with every other
    // write path.
    if (isBusyError(error)) return next(error);
    console.error('Error generating report pack:', error);
    res.status(500).json({ error: 'Failed to generate the steering committee pack.' });
  } finally {
    // Idempotent and per-lease: frees the one render slot on EVERY exit path
    // (success, the empty-deal 409, a worker failure, a busy-forward).
    lease.release();
  }
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
// D-12-02 (Phase 12, plan 12-09): settings (lane choice, time travel day) and
// both roster lanes; `courses` only when the showcase scaling can run — a
// deal-bound request (req.isDemo false) always returns its stored rows
// unscaled, so it never touches the course catalog.
const EMPLOYEES_READ_SET = ['settings', 'employees', 'customEmployees'];
// Pure response builder (db, req) -> body; exposed as app.employeesBody.
function employeesBody(db, req) {
  const day = db.settings.timeTravelDay || 30;
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  // Demo mode keeps the time-machine simulation (Day 1 = fresh org, Day 100 = fully
  // certified) so the org-wide ramp reads consistently. Custom mode shows REAL stored
  // progress so live lesson completions and +50 merit awards actually appear on the
  // leaderboard / dashboard roster / signage. ISO-02: the showcase scaling must ALSO
  // never apply outside the resolved demo database — a deal-bound request always sees
  // its own stored rows unscaled, routed through the single req.isDemo predicate.
  return (isCustom || !req.isDemo) ? employeesList : scaleEmployeesForDay(employeesList, day, getCatalogLessonIds(db));
}
app.employeesBody = employeesBody;
app.get('/api/employees', (req, res) => {
  const set = req.isDemo ? EMPLOYEES_READ_SET.concat(['courses']) : EMPLOYEES_READ_SET;
  res.json(employeesBody(readCollections(set), req));
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
//
// D-09: the orphan guard — this handler's first guard of any kind, for any
// cross-reference. Before this task it was a blind, unconditional filter-
// and-write. Refuses (400, naming the affected position count and the
// first one's title) rather than cascading or nulling the link, while ANY
// org position (current OR target state) still points at this employee via
// employeeId. This is the UI-SPEC §Surface Contract 4 resolution of a
// decision 06-CONTEXT.md delegated to Claude's discretion; the
// §Copywriting "The position they occupy will become vacant" confirm
// string is deliberately NOT used for this case, because the delete does
// not proceed — nothing becomes vacant, the caller must unlink or delete
// the position(s) first. Kept inside THIS route (not a helper shared with
// the org section above) because /api/employees is reachable by pmo as
// well as admin/hrbp through the default write policy (ROLE_WRITE_POLICY /
// DEFAULT_WRITE_ROLES) — a guard living only in the org lane's own callers
// would miss every one of those.
app.delete('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const occupied = orgPositionsLane(db).filter((p) => p.employeeId === id);
  if (occupied.length) {
    return res.status(400).json({
      error: `This employee occupies ${occupied.length} position(s), including "${occupied[0].title}" — unlink them from the employee, or delete the position(s), before deleting this employee.`,
    });
  }
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

// [security] D-11-04 / AUTHZ-04 / amendment 5 (Phase 11): the caller's OWN
// roster record id, derived from the authenticated session identity — never
// from anything the client supplies. A roster-refused role (employee in a real
// deal) resolves ONLY this record through get-or-create, so the route cannot be
// used as a lookup of a colleague's record by empId or by name. A one-way hash
// of the username keeps the id stable per account (one row per account, not one
// per supplied empId) and keeps the username itself out of roster ids/URLs.
function selfRosterId(username) {
  return 'emp_acct_' + crypto.createHash('sha256').update('roster-self:' + String(username || '')).digest('hex').slice(0, 20);
}

// Find or create an employee profile (tracks welcome-page progress).
// [security] R3 F-2 (D-11-04): this was `GET /api/employees/get-or-create` — a
// GET that wrote roster rows, so it skipped ROLE_WRITE_POLICY and
// validationMiddleware and could be fired by a cross-site link. It is a POST
// with a zod-validated body now; the GET route no longer exists.
app.post('/api/employees/get-or-create', (req, res) => {
  const body = req.body || {};
  const { empId, name, role, department, company, isLeader, leaderRole, buddyName, buddyEmail } = body;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");

  let employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);

  // [security] AUTHZ-01 bypass guard: outside the demo store, a role the read
  // policy refuses `/api/employees` (employee in a real deal) must not be able
  // to read the named roster through this route. Such a caller is "restricted":
  // the lookup key is the id derived from the session (selfRosterId), a supplied
  // empId / name is never used to find a record, and the caller's self-declared
  // leader/buddy attributes are not honoured. The demo store and every role the
  // read policy allows the roster keep the original behaviour unchanged.
  const restricted = req.isDemo !== true
    && !(req.portalUser && readPolicy.roleAllowedForRead(req.portalUser.role, '/api/employees'));
  if (restricted && !req.portalUser) {
    return res.status(403).json({ error: 'Your role cannot view this information.' });
  }
  const ownId = restricted ? selfRosterId(req.portalUser.username) : null;

  let found = null;
  if (restricted) {
    found = employeesList.find(e => e.id === ownId) || null;
  } else {
    if (empId) {
      found = employeesList.find(e => e.id === empId);
    }
    if (!found && name) {
      found = employeesList.find(e => e.name && e.name.toLowerCase() === name.toLowerCase());
    }
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
    id: restricted ? ownId : (empId || newId('emp')),
    // restricted: the authoritative display name from the account, not a claim
    name: restricted ? (req.portalUser.name || req.portalUser.username) : (name || "Valued Team Member"),
    // [security] WR-03 (Phase 11 review, amendment 5): the restricted lane is
    // a minimal, server-minted row — the caller cannot self-assign a role,
    // department or employer into the IL's roster (staff read GET
    // /api/employees). Same defaults as any other server-minted profile.
    role: restricted ? "Specialist" : (role || "Specialist"),
    department: restricted ? "Operations" : (department || "Operations"),
    company: restricted ? (targetCompany || 'NextGen Sensors Ltd.') : (company || targetCompany || 'NextGen Sensors Ltd.'),
    completedLessons: [],
    points: 0,
    badge: "New Recruit",
    bonusPoints: 0,
    isLeader: restricted ? false : (isLeader === true || isLeader === 'true' || false),
    leaderRole: restricted ? 'None' : (leaderRole || 'None'),
    buddyName: restricted ? '' : (buddyName || ''),
    buddyEmail: restricted ? '' : (buddyEmail || '')
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
  const all = [...scaled, ...stored];
  // [security] D-11-06 / R1-15 (Phase 11 plan 05): in a REAL deal a pulse is
  // personal data about a named colleague. admin/hrbp read everything, the
  // author reads its own, pmo gets own + aggregate rows (rating/type/day only),
  // employee gets own only — see lib/pulseView.js. The demo store (req.isDemo
  // === true) is never projected: the showcase library + stored feedback is
  // served exactly as demonstrated.
  if (req.isDemo !== true) {
    const { pulsesFor } = require('./lib/pulseView');
    const caller = req.portalUser || {};
    return res.json(pulsesFor(caller.role, caller.username, all));
  }
  res.json(all);
});

// POST Pulse
app.post('/api/pulses', (req, res) => {
  // VAL-01: presence is now owned exclusively by validators/people.js's PulseCreateSchema.
  const { employeeName, rating, comment, type } = req.body;
  const db = readDb();
  db.pulses = db.pulses || [];

  // [security] IN-02 (Phase 11 review, D-11-06): in a real deal the name a
  // pulse is filed under is the AUTHOR's account display name (fallback: the
  // username), never the free-text body value — an employee cannot file a
  // named pulse as a colleague that the IL then reads as that colleague's.
  // The demo store keeps the body value (showcase unchanged).
  const accountName = req.portalUser
    ? (String(req.portalUser.name || '').trim() || req.portalUser.username)
    : null;
  const filedName = (req.isDemo !== true && accountName) ? accountName : employeeName;

  const newPulse = {
    id: newId('pulse'),
    employeeName: filedName,
    rating: parseInt(rating) || 3,
    comment: comment || '',
    timestamp: new Date().toISOString(),
    type: type || '30-day',
    // [security] D-11-06 / T-11-41: authorship is stamped from the SESSION, never
    // from the body (employeeName is free text any caller can type). GET
    // /api/pulses matches "own" pulses on this field only.
    authorUsername: req.portalUser ? req.portalUser.username : null
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
  sendHtml(res, path.join(ASSET_STAMP_PUBLIC_DIR, 'index.html'));
});

// [security] D-11-03 / R1-02 / T-11-22 (Phase 11): the central 404 for a task/
// RAID record that is missing OR outside the caller's clearance
// (assertRecordVisibleOr404 throws RecordNotFoundError). One fixed body for
// both reasons, so the response can never distinguish "no such id" from "an
// id you may not know exists" and never carries a record field. Plan 11-04
// attaches the rate-bounded `err.reason === 'clearance'` denial audit at this
// exact branch. The FIRST typed mapping an error meets (above the 503/409
// handlers that follow).
app.use((err, req, res, next) => {
  if (err instanceof RecordNotFoundError) {
    if (res.headersSent) return next(err);
    // [security] D-11-05 / AUTHZ-05: only a CLEARANCE refusal is a denial worth
    // an audit row — a genuinely missing id is not (and recording it would let
    // id-probing mint rows). Keyed on the route TEMPLATE, never the id. A busy
    // audit.db throws from here and is mapped to the central 503 by the
    // handler below — the refusal is never converted into a success.
    if (err.reason === 'clearance') {
      recordDenial(req, 404, 'clearance-404', req.route && typeof req.route.path === 'string' ? req.route.path : undefined);
    }
    return res.status(404).json({ error: 'Not found' });
  }
  next(err);
});

// [security] D-12-03 / T-12-51 (Phase 12): a database that failed its migration
// or integrity check (db/readiness.js DbNotReadyError, thrown by every open of
// the refused file until restart) is a 503 that is NOT retryable: no
// Retry-After and `retryable: false`, so the client (plan 12-04's marker) shows
// it once and never retries. FIXED body — never err.message, a path or a deal
// id. A route that catches the error locally keeps its own generic 500; no path
// ever turns it into a 2xx. Sits ABOVE the busy 503 handler (a different cause,
// a different contract).
app.use((err, req, res, next) => {
  if (err instanceof readiness.DbNotReadyError) {
    if (res.headersSent) return next(err);
    return res.status(503).json({
      error: 'The server is not ready: a database failed its migration or integrity check. An administrator must restore it from backup.',
      retryable: false,
    });
  }
  next(err);
});

// [security] D-12-04 / PD-7 (Phase 12): a deal whose audit partition is SEALED
// (last row `partition-seal`, db/auditChain.js) refuses every further audited
// write. appendChained() throws from INSIDE the deal's transaction, so the deal
// write has already rolled back — a 409 here truthfully means "nothing
// persisted". FIXED body (never err.message / the deal id), and deliberately NO
// `conflict` marker: the Phase 9 compare dialog keys on that marker and must
// never open for a closed deal. Same guard order as its siblings.
app.use((err, req, res, next) => {
  if (err instanceof auditHook.AuditPartitionSealedError) {
    if (res.headersSent) return next(err);
    return res.status(409).json({ error: 'This deal is closed: its audit trail is sealed.' });
  }
  next(err);
});

// [security] D-06/CONC-01 (Phase 8): ONE central error middleware mapping
// SQLite write-lock contention (SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT, via
// isBusyError() above) to a bounded 503 + Retry-After — covering every write
// path that lets its SqliteError propagate uncaught (writeDb, sessions,
// controlStore, audit; D-09's scope). New endpoints inherit this contract for
// free, with zero per-route code. Mounted BEFORE the final generic 500
// handler below so non-contention errors still fall through to it (D-06).
// Same shape as the existing malformed-JSON handler near the top of this
// file: check a specific error property, respond directly if matched,
// otherwise next(err). The response body is a FIXED generic string — never
// err.message, a stack, a file path, or a deal identifier (T-08-01,
// Information Disclosure: a SQLite file path would leak the deal id, which
// is an MNPI target name pre-announcement) — matching the discipline the
// final 500 handler immediately below already documents.
app.use((err, req, res, next) => {
  if (isBusyError(err)) {
    // WR-04 (Phase 8 review fix): guard headersSent BEFORE calling
    // res.status(...), mirroring the final generic handler immediately
    // below. No route currently reachable in this diff throws a busy error
    // after already calling res.send()/res.json() — but this is the direct
    // sibling of a handler that DOES guard this, and a future route that
    // streams a response before a later SQLite write must not hit
    // ERR_HTTP_HEADERS_SENT from inside error-handling middleware itself.
    if (res.headersSent) return next(err);
    const retryAfterSeconds = 1; // Claude's Discretion within D-05's ~1s budget
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(503).json({ error: 'Server is busy. Please try again.' });
  }
  next(err);
});

// [security] CONC-02/PD-3 (Phase 9): the central 409 conflict middleware —
// direct sibling of the 503 middleware immediately above, same guard order
// (res.headersSent first) and same fixed generic-safe-body discipline
// (T-08-01: never echo err.message/a stack/a file path). Mapped from
// db/store.js's typed conflict throw (isConflictError(err)/err.conflictDetail)
// the exact same way isBusyError(err) maps a SqliteError — new versioned-
// collection routes inherit this contract for free. Mounted BEFORE the
// final generic 500 handler below so non-conflict errors still fall through
// to it, and it must be reachable even when a route's own precheck
// (conflictIfStale() above) did NOT catch the race — that fast-path helper
// only covers the single-process common case; this middleware is what makes
// the WHERE-clause layer's throw (the actually race-free layer) visible on
// the wire.
app.use((err, req, res, next) => {
  if (isConflictError(err)) {
    if (res.headersSent) return next(err);
    const detail = err.conflictDetail || {};
    return res.status(409).json(conflictBody(detail));
  }
  next(err);
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
// D-06/CONC-01 (Phase 8): exposed so a test can assert the SQLITE_BUSY*
// prefix-detection predicate directly, and so plan 08-03's re-throw guards
// share this SAME definition rather than re-declaring a second copy.
module.exports.isBusyError = isBusyError;
// CONC-02 (Phase 9): re-exported the same way isBusyError is — server.js
// imports it FROM db/store.js (the single definition), and re-exposes it
// here so a test can assert against server.js's own module surface without
// reaching into db/store.js separately.
module.exports.isConflictError = isConflictError;
module.exports.conflictBody = conflictBody;
module.exports.conflictIfStale = conflictIfStale;
// CONC-02 (Phase 9, Plan 02): exposed alongside conflictIfStale so a test can
// assert the dual-channel (body/query) resolution and its bounds check
// directly, without needing a full HTTP round trip for every case.
module.exports.parseExpectedVersion = parseExpectedVersion;
// Exposed alongside app for the same reason (ISO-02): lets a test unit-check
// isDemoOnlyPath()/DEMO_ONLY_PREFIXES directly against the live route
// inventory without booting the HTTP server for every case.
module.exports.isDemoOnlyPath = isDemoOnlyPath;
module.exports.DEMO_ONLY_PREFIXES = DEMO_ONLY_PREFIXES;
// CR-01 regression tests loop over every path-policy table.
module.exports.ROLE_WRITE_POLICY = ROLE_WRITE_POLICY;
module.exports.MUST_CHANGE_ALLOWED_PATHS = MUST_CHANGE_ALLOWED_PATHS;
module.exports.pathMatchesPrefix = pathMatchesPrefix;
module.exports.gatePolicy = gatePolicy;
// D-26: exposed so a test can assert this copy and validators/workstream.js's
// own independent RAID_LEVELS copy agree, without re-declaring a third list.
module.exports.RAID_LEVELS = RAID_LEVELS;
// SYN-01: exposed so a test can unit-check the ramp math and the
// arrived-month gate directly, without booting the HTTP server for every
// pure-function case (same rationale as roleAllowedForWrite above).
module.exports.generatePhasingRows = generatePhasingRows;
module.exports.monthHasArrived = monthHasArrived;
module.exports.synergyRollupFields = synergyRollupFields;
module.exports.RAMP_CURVES = RAMP_CURVES;
// WR-02: exposed for the same pure-function unit-check rationale — a test
// can assert the non-finite guard directly against overflow inputs like
// '1e400', without needing an HTTP round-trip.
module.exports.roundSynergyMoney = roundSynergyMoney;
// D-07/D-11: exposed so a test can assert this copy and
// validators/workstream.js's own independent SYN_STAGES copy (plus the
// client's third copy, read as text) all agree — same rationale as
// RAID_LEVELS above.
module.exports.SYN_STAGES = SYN_STAGES;
// D-08: exposed for the same pure-function unit-check rationale — a test can
// assert stageGateFailure()'s reasons directly against a constructed
// initiative object, without booting the HTTP server for every gate case.
module.exports.STAGE_ORDER = STAGE_ORDER;
module.exports.stageGateFailure = stageGateFailure;
// SYN-05: exposed for the same pure-function unit-check rationale — a test
// can drive the boundary and fallback cases directly against a controlled
// nowMs, without booting the HTTP server for every case.
module.exports.isSynergyStale = isSynergyStale;
module.exports.synergyStaleDays = synergyStaleDays;
// RPT-04: exposed for the same pure-function unit-check rationale as
// isSynergyStale — a test can drive the boundary/null cases directly
// against a controlled nowMs, without booting the HTTP server.
module.exports.synergyStaleDayCount = synergyStaleDayCount;
// CR-01: exposed for the same pure-function unit-check rationale — a test
// can assert the [1, 15] clamp directly against a constructed db.settings
// object, without needing an HTTP round-trip through the schema.
module.exports.synergyHorizonYears = synergyHorizonYears;
// WR-01: exposed for the same pure-function unit-check rationale — a test
// can assert the X-Admin-Token break-glass exclusion directly against a
// constructed req.portalUser object (sessionId: null, mirroring the
// consolidated /api gate's exact shape for that path), without standing up
// a real ADMIN_TOKEN-configured HTTP server.
module.exports.isAdminOrIlRequest = isAdminOrIlRequest;
// ORG-01 (Task 2): exposed for the same pure-function unit-check rationale —
// a test can drive the terminate-on-pre-existing-cycle case directly against
// a hand-built lane array, without a live POST sequence (which cannot itself
// construct a cycle, since every write is refused before it lands).
module.exports.positionGraphFailure = positionGraphFailure;
// ORG-02 (06-04): exposed for the same pure-function unit-check rationale —
// a test can assert derivedDecisionFor()'s latest-by-decidedAt/null/
// ignores-other-positions behavior directly against a hand-built decisions
// array, and the anti-drift test can assert this copy of the vocabulary
// agrees with validators/org.js's and public/js/org.js's own copies.
module.exports.ORG_DECISION_TYPES = ORG_DECISION_TYPES;
module.exports.derivedDecisionFor = derivedDecisionFor;
// D-17 (06-06): exposed for the same pure-function unit-check rationale —
// a test can drive the orphaned-provenance case (originating finding
// deleted from a hand-built lane) directly, without needing a live DELETE
// sequence against a real finding first.
module.exports.resolveRaidEntryClearanceArea = resolveRaidEntryClearanceArea;
// [security] T-ERM-01 (260810-erm): exposed for the same pure-function
// unit-check rationale as resolveRaidEntryClearanceArea immediately above —
// a test can drive the orphaned-provenance and stamp-wins cases directly
// against a hand-built task, without a live convert-then-DELETE sequence.
module.exports.resolveTaskClearanceArea = resolveTaskClearanceArea;
module.exports.reportTaskRows = reportTaskRows;
// D-11-03 (Phase 11): exposed so a test can unit-check the by-id clearance
// guard and its typed error without a full HTTP round trip.
module.exports.assertRecordVisibleOr404 = assertRecordVisibleOr404;
module.exports.recordVisibleTo = recordVisibleTo;
module.exports.RecordNotFoundError = RecordNotFoundError;
// D-19/D-21 (06-07): exposed so Plan 08's seed verification and any
// Phase-7 consumer can call the SAME rollup implementation this route uses,
// without booting the HTTP server for every pure-tally case.
module.exports.orgSummaryFor = orgSummaryFor;
// Quick task 260810-e1j: exposed for the same pure-function unit-check
// rationale — a test can drive the binding-absent path directly (via a
// sabotaged module loader in a child process) even on a host where the
// binding actually exists, without needing a real linux-arm64 machine.
module.exports.getReportPack = getReportPack;
// [security] D-10-06 (plan 10-05): exposed for the same pure-function
// unit-check rationale — tests drive the admin backoff-ceiling decision and the
// Secure-cookie decision directly, without an HTTP round-trip per case.
module.exports.throttleOptionsFor = throttleOptionsFor;
module.exports.isSecureCookieContext = isSecureCookieContext;
module.exports.ADMIN_MAX_BACKOFF_MS = ADMIN_MAX_BACKOFF_MS;
// [security] D-10-08b (plan 10-05): exposed so tests (and a future health
// probe) can read the lockdown state without an HTTP round-trip.
module.exports.isCredentialLockdownActive = () => credentialLockdown.isActive();
