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

function createStore({ max = MAX_TUPLES, now = Date.now } = {}) {
  const map = new Map();
  return {
    record(tuple) {
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
        return;
      }
      if (map.size >= max) map.delete(map.keys().next().value);
      map.set(key, {
        directive: tuple.directive,
        blockedUri: tuple.blockedUri,
        sourceFile: tuple.sourceFile,
        lineNumber: tuple.lineNumber,
        documentPath: tuple.documentPath,
        count: 1,
        firstSeen: t,
        lastSeen: t,
      });
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
  record: (tuple) => store.record(tuple),
  list: () => store.list(),
  size: () => store.size(),
  clear: () => store.clear(),
};
