'use strict';
// SAFE-02 / D-13-03 (Phase 13, plan 13-07): the CSP violation report channel.
//
// POST /api/csp-report is deliberately UNAUTHENTICATED (a browser sends the
// report with no cookie-bearing context we can rely on, and the login page must
// be observable too), so everything here is built for attacker-shaped input:
//
//   [security] T-13-60 (DoS): the store is bounded (last 100 DISTINCT tuples,
//   least-recently-seen evicted), every string is truncated to 200 chars, one
//   request contributes at most 20 tuples, and the per-IP limiter's own table is
//   capped. The 4 KB body limit is enforced by the route-level parser in
//   server.js, not here.
//   [security] T-13-61 (MNPI): a URL-valued field is reduced to origin + path -
//   the query string and fragment can carry deal ids or search text and are
//   NEVER stored. A non-http(s) URI (data:, blob:, javascript:) is reduced to
//   its scheme, so an inline payload is never retained either.
//   [security] T-13-62 (stored XSS): the list is JSON only. Nothing in this
//   module renders HTML; any later admin view must use textContent.
//
// The store is per process (a multi-process deployment lists per process).

const fs = require('fs');
const path = require('path');

const MAX_TUPLES = 100;
const MAX_STRING = 200;
const MAX_REPORTS_PER_REQUEST = 20;
const MAX_LIMITER_KEYS = 10000;
const WINDOW_MS = 60 * 1000;

const SUPPORTED_TYPES = Object.freeze(['application/csp-report', 'application/reports+json']);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function clip(value) {
  return String(value).replace(CONTROL_CHARS, '').slice(0, MAX_STRING);
}

/** Origin + path of an http(s) URL, the bare scheme of any other URI, else the clipped keyword. */
function cleanUri(value) {
  if (typeof value !== 'string' || value === '') return '';
  const raw = value.slice(0, 2048).trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (scheme) {
    const proto = scheme[1].toLowerCase();
    if (proto === 'http' || proto === 'https' || proto === 'ws' || proto === 'wss') {
      try {
        const u = new URL(raw);
        return clip(u.origin + u.pathname);
      } catch (e) { /* fall through to the generic cut below */ }
      return clip(raw.split(/[?#]/)[0]);
    }
    return clip(proto + ':');
  }
  // keyword values (`inline`, `eval`, `self`, `wasm-eval`) or a bare path.
  return clip(raw.split(/[?#]/)[0]);
}

/** The path component only of a document URI; never the query or fragment. */
function cleanDocumentPath(value) {
  if (typeof value !== 'string' || value === '') return '';
  const raw = value.slice(0, 2048).trim();
  try {
    return clip(new URL(raw).pathname);
  } catch (e) {
    return clip(raw.split(/[?#]/)[0]);
  }
}

function cleanDirective(value) {
  if (typeof value !== 'string') return '';
  // `violated-directive` can carry the whole policy fragment ("script-src 'self'").
  return clip(value.trim().split(/\s+/)[0] || '');
}

function cleanLine(value) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : NaN);
  return Number.isInteger(n) && n >= 0 && n <= 10000000 ? n : null;
}

function pick(obj, ...names) {
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(obj, n)) return obj[n];
  }
  return undefined;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function tupleFrom(report) {
  if (!isPlainObject(report)) return null;
  const directive = cleanDirective(pick(report, 'effective-directive', 'effectiveDirective') ||
    pick(report, 'violated-directive', 'violatedDirective'));
  if (!directive) return null;
  return {
    directive,
    blockedUri: cleanUri(pick(report, 'blocked-uri', 'blockedURL', 'blockedUri', 'blocked-url')),
    sourceFile: cleanUri(pick(report, 'source-file', 'sourceFile')),
    lineNumber: cleanLine(pick(report, 'line-number', 'lineNumber')),
    documentPath: cleanDocumentPath(pick(report, 'document-uri', 'documentURL', 'documentUri', 'document-url')),
  };
}

/**
 * Turn a parsed report body into 0..20 normalized tuples. Both wire formats:
 *   application/csp-report   { "csp-report": { "document-uri", "blocked-uri", ... } }
 *   application/reports+json [ { "type": "csp-violation", "body": { documentURL, blockedURL, ... } } ]
 * Unknown shapes and non-csp-violation Reporting API entries are ignored.
 * @param {string} contentType request Content-Type (parameters allowed)
 * @param {unknown} body already-parsed JSON
 */
function normalize(contentType, body) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const out = [];
  const push = (r) => {
    const t = tupleFrom(r);
    if (t && out.length < MAX_REPORTS_PER_REQUEST) out.push(t);
  };
  if (type === 'application/csp-report') {
    if (isPlainObject(body)) push(body['csp-report']);
  } else if (type === 'application/reports+json') {
    const list = Array.isArray(body) ? body : [];
    for (const entry of list.slice(0, MAX_REPORTS_PER_REQUEST * 2)) {
      if (isPlainObject(entry) && entry.type === 'csp-violation') push(entry.body);
    }
  }
  return out;
}

// [security] WR-A07 (13-REVIEW): the store is an ADVISORY signal. Reports cannot
// be authenticated, so an anonymous client can always add tuples; what this
// module CAN do cheaply is keep foreign noise from displacing first-party signal:
//   1. only a report about a page this app actually serves is kept — the
//      document path must be `/` or an existing `*.html` page under public/
//      (or a directory that has an index.html), computed ONCE from disk
//      (vendor/ and uploads/ excluded: never app pages);
//   2. when the store is full, a tuple whose source-file is FOREIGN (another
//      origin than the one the report was posted to, or a non-http scheme such
//      as an extension's) is evicted before any first-party tuple.
// The enforce-flip decision (D-13-03) must therefore ALSO rely on in-page
// `securitypolicyviolation` events captured by the walk scripts (plan 13-12
// asserts both) — never on this list alone.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const NON_PAGE_DIRS = new Set(['vendor', 'uploads']);

/** Every path at which public/ serves an app page: '/', '/<rel>.html', '/<dir>/' (with index.html). */
function listServedPages(root) {
  const out = new Set(['/']);
  const walk = (dir, rel, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const childRel = rel + '/' + ent.name;
      if (ent.isDirectory()) {
        if (rel === '' && NON_PAGE_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name), childRel, depth + 1);
      } else if (ent.isFile() && /\.html$/i.test(ent.name)) {
        out.add(childRel);
        if (ent.name === 'index.html') out.add(rel + '/');
      }
    }
  };
  walk(root, '', 0);
  return out;
}

let _servedPages = null;
/** Is `documentPath` (a URL pathname) a page this app serves? The page list is computed once. */
function isServedPage(documentPath) {
  if (typeof documentPath !== 'string' || documentPath === '') return false;
  if (!_servedPages) _servedPages = listServedPages(PUBLIC_DIR);
  if (_servedPages.has(documentPath)) return true;
  try { return _servedPages.has(decodeURIComponent(documentPath)); } catch (e) { return false; }
}

const FIRST_PARTY_KEYWORDS = new Set(['', 'inline', 'eval', 'wasm-eval', 'self']);
/**
 * Is a (cleaned) source-file foreign to `origin` (the origin the report was
 * posted to)? Keywords and bare paths are first-party; an http(s)/ws(s) URL is
 * foreign when its origin differs (unknown `origin` -> not foreign); any other
 * scheme (`chrome-extension:`, `data:`, `blob:`, …) is foreign.
 */
function isForeignSource(sourceFile, origin) {
  const s = String(sourceFile || '');
  if (FIRST_PARTY_KEYWORDS.has(s) || s.startsWith('/')) return false;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!m) return false;
  const proto = m[1].toLowerCase();
  if (proto === 'http' || proto === 'https' || proto === 'ws' || proto === 'wss') {
    if (!origin) return false;
    try { return new URL(s).origin !== origin; } catch (e) { return true; }
  }
  return true;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.max] distinct tuples kept
 * @param {() => number} [opts.now]
 * @param {(documentPath: string) => boolean} [opts.isKnownPage] WR-A07 page allowlist (default: public/ pages)
 */
function createStore({ max = MAX_TUPLES, now = Date.now, isKnownPage = isServedPage } = {}) {
  const map = new Map();
  return {
    /** -> true when the tuple was stored/updated; false when refused (not a served page). `ctx.origin`: the origin the report was posted to. */
    record(tuple, ctx) {
      if (!isKnownPage(tuple.documentPath)) return false; // WR-A07 (1)
      const foreign = isForeignSource(tuple.sourceFile, ctx && ctx.origin);
      const key = `${tuple.directive}|${tuple.blockedUri}|${tuple.sourceFile}`;
      const t = now();
      const prev = map.get(key);
      if (prev) {
        // re-insert so Map order is least-recently-seen first
        map.delete(key);
        map.set(key, {
          ...prev,
          count: prev.count + 1,
          lastSeen: t,
          lineNumber: tuple.lineNumber,
          documentPath: tuple.documentPath,
        });
        return true;
      }
      if (map.size >= max) {
        // WR-A07 (2): Map order is least-recently-seen first, so the first foreign
        // entry is the least recently seen foreign one; only when there is none
        // does a first-party tuple go.
        let victim = null;
        for (const [k, v] of map) {
          if (v.foreign) { victim = k; break; }
        }
        map.delete(victim !== null ? victim : map.keys().next().value);
      }
      map.set(key, {
        directive: tuple.directive,
        blockedUri: tuple.blockedUri,
        sourceFile: tuple.sourceFile,
        lineNumber: tuple.lineNumber,
        documentPath: tuple.documentPath,
        count: 1,
        firstSeen: t,
        lastSeen: t,
        foreign,
      });
      return true;
    },
    /** Most recently seen first. */
    list() {
      return Array.from(map.values()).reverse().map((v) => ({
        directive: v.directive,
        blockedUri: v.blockedUri,
        sourceFile: v.sourceFile,
        lineNumber: v.lineNumber,
        documentPath: v.documentPath,
        count: v.count,
        firstSeen: new Date(v.firstSeen).toISOString(),
        lastSeen: new Date(v.lastSeen).toISOString(),
      }));
    },
    size() { return map.size; },
    clear() { map.clear(); },
  };
}

/**
 * Fixed-window per-key limiter: the (perMinute+1)th take() inside one minute
 * from one key is refused; another key is unaffected. The table itself is
 * capped so an address spray cannot grow it without bound.
 */
function createLimiter({ perMinute = 60, now = Date.now, maxKeys = MAX_LIMITER_KEYS } = {}) {
  const windows = new Map();
  return {
    take(key) {
      const k = String(key || 'unknown');
      const t = now();
      let w = windows.get(k);
      if (!w || t - w.start >= WINDOW_MS) {
        if (!w && windows.size >= maxKeys) {
          for (const [wk, wv] of windows) {
            if (t - wv.start >= WINDOW_MS) windows.delete(wk);
          }
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value);
        }
        w = { start: t, count: 0 };
        windows.set(k, w);
      }
      w.count += 1;
      return w.count <= perMinute;
    },
    size() { return windows.size; },
  };
}

// The process-wide store the routes use (tests may call clear()).
const store = createStore();

module.exports = {
  MAX_TUPLES,
  MAX_STRING,
  SUPPORTED_TYPES,
  normalize,
  createStore,
  createLimiter,
  isServedPage,
  isForeignSource,
  record: (tuple, ctx) => store.record(tuple, ctx),
  list: () => store.list(),
  size: () => store.size(),
  clear: () => store.clear(),
};
