'use strict';
// QUAL-01 / R5-03 / D-12-07 (Phase 12, plan 12-03): serve-time content-hash
// cache-bust stamps.
//
// Why this exists. server.js serves /js and /css with
// `Cache-Control: public, max-age=2592000` (30 days), so a changed client
// asset only reaches a browser that already holds the old copy through a
// CHANGED `?v=` stamp on the URL that references it. Phases 8-11 each shipped
// client changes behind unchanged, hand-maintained stamps (09-SECURITY UF-1,
// Phase 11 review WR-C05); a hand table can never keep up, and a stale
// concurrency/authz client is a security-relevant integrity gap (T-12-20).
//
// Why serve time and not a build step. CLAUDE.md constraint: vanilla JS, no
// bundler, no build step, `node server.js` with nothing installed first. The
// stamp is therefore computed by the server, on demand, from the bytes it is
// about to serve, and cached per file by `mtimeMs:size`.
//
// Contract (PD-17). The stamp of a URL is the first 16 hex characters of
// sha256 over the EXACT bytes the app serves at that URL — transitive for JS /
// CSS that themselves reference stamped assets (their references are rewritten
// first, then hashed), so "stamp == hash(served body)" is checkable from the
// outside by fetching both. Hand-written stamps in the source files are never
// edited; they are overwritten at serve time.
//
// Scope. Only root-relative `/js/<file>.js` and `/css/<file>.css`. Vendored
// code (`/vendor/**`), external URLs, images and anything else are untouched.
// A request path can never reach outside public/: asset URLs must match a
// strict segment whitelist and the resolved path is re-checked against the
// public root before any read (T-12-21).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STAMP_LEN = 16;

// A root-relative js/css URL path. Segments are a strict character whitelist
// (no `%`, no `\`, no NUL) and `.`/`..` segments are rejected separately.
const ASSET_URL_RE = /^\/(?:js|css)\/[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*\.(?:js|css)$/;

// A stamped local reference inside JS/CSS/inline text: the lookbehind keeps
// `https://cdn/js/x.js`, `../js/x.js` and `public/js/x.js` out (the character
// before `/js` must not be part of a path/host); the stamp value must be
// non-empty so `'/js/x.js?v=' + n` (dynamic) is never touched.
const STAMPED_REF_RE = /(?<![A-Za-z0-9_.:\/\-])(\/(?:js|css)\/[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*\.(?:js|css))\?v=([A-Za-z0-9_.\-]+)/g;

// Non-global twin used only for a boolean probe (a global regex's lastIndex
// would make .test() stateful).
const STAMPED_REF_PROBE = new RegExp(STAMPED_REF_RE.source);

// An HTML attribute whose whole value is a local js/css URL, stamped or not.
// `(?!\?)`-style guarding is done by the optional `?v=` group followed by the
// closing quote: any OTHER query string fails the match and is left alone.
const HTML_ATTR_RE = /\b(src|href)(\s*=\s*)(["'])(\/(?:js|css)\/[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*\.(?:js|css))(?:\?v=[A-Za-z0-9_.\-]*)?\3/gi;

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, STAMP_LEN);
}

function createAssetStamper({ publicDir, warn } = {}) {
  if (!publicDir) throw new Error('createAssetStamper: publicDir is required');
  const root = path.resolve(publicDir);
  const warnFn = typeof warn === 'function' ? warn : (m) => console.warn(m);
  const warned = new Set();
  const counters = { reads: 0, hits: 0 };

  // urlPath -> { sig, buf, rawStamp, text, hasRefs }
  const rawCache = new Map();
  // urlPath -> { sig, depKey, result }
  const resultCache = new Map();

  function warnOnce(key, msg) {
    if (warned.has(key)) return;
    warned.add(key);
    warnFn(msg);
  }

  /** Map a /js|/css URL path to an absolute file strictly inside publicDir, or null. */
  function fileFor(urlPath) {
    if (typeof urlPath !== 'string' || !ASSET_URL_RE.test(urlPath)) return null;
    const segs = urlPath.split('/');
    for (const s of segs) {
      if (s === '.' || s === '..') return null;
    }
    const abs = path.resolve(root, '.' + urlPath);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return abs;
  }

  /** stat + (cached) read. Returns null when the file does not exist / is not a file. */
  function loadRaw(urlPath) {
    const abs = fileFor(urlPath);
    if (!abs) return null;
    let st;
    try { st = fs.statSync(abs); } catch (e) { return null; }
    if (!st.isFile()) return null;
    const sig = st.mtimeMs + ':' + st.size;
    const hit = rawCache.get(urlPath);
    if (hit && hit.sig === sig) { counters.hits++; return hit; }
    let buf;
    try { buf = fs.readFileSync(abs); } catch (e) { return null; }
    counters.reads++;
    const text = buf.toString('utf8');
    // IN-B03 (12-REVIEW-B): only a file that decodes to UTF-8 and re-encodes to
    // the SAME bytes is ever rewritten; anything else (e.g. a Latin-1 comment)
    // would be served with U+FFFD substitutions, so its bytes go out untouched
    // (references left as written, one warning).
    let hasRefs = STAMPED_REF_PROBE.test(text);
    if (hasRefs && !Buffer.from(text, 'utf8').equals(buf)) {
      hasRefs = false;
      warnOnce('non-utf8:' + urlPath, '[assetStamp] ' + urlPath + ' is not valid UTF-8 — served unmodified, its references left unstamped');
    }
    const entry = { sig, buf, text, rawStamp: hashBuffer(buf), hasRefs };
    rawCache.set(urlPath, entry);
    return entry;
  }

  /**
   * Resolve a js/css asset to the bytes the app serves.
   * `stack` is the chain of URLs being resolved (cycle guard): a file already
   * on the stack contributes its RAW bytes' hash — documented back-edge rule;
   * a result produced across a back-edge is context dependent and is never
   * cached (public/ has no cycle today; the cache-bust test asserts it).
   * Returns { body, rewritten, stamp, cyclic } or null for a missing file.
   */
  function resolve(urlPath, stack) {
    const raw = loadRaw(urlPath);
    if (!raw) return null;
    if (!raw.hasRefs) return { body: raw.buf, rewritten: false, stamp: raw.rawStamp, cyclic: false };

    const nextStack = stack.concat(urlPath);
    let cyclic = false;
    const deps = new Map(); // depUrl -> stamp (insertion order = first occurrence)

    const depStampOf = (depUrl) => {
      if (deps.has(depUrl)) return deps.get(depUrl);
      let stamp = null;
      if (stack.indexOf(depUrl) !== -1 || depUrl === urlPath) {
        const r = loadRaw(depUrl);
        stamp = r ? r.rawStamp : null;
        cyclic = true;
      } else {
        const r = resolve(depUrl, nextStack);
        if (r) { stamp = r.stamp; if (r.cyclic) cyclic = true; }
      }
      deps.set(depUrl, stamp);
      return stamp;
    };

    // First pass: learn the dependency stamps (cheap — each is cached).
    // matchAll clones the regex, so the recursive resolve() below can never
    // disturb this iteration through the shared global's lastIndex.
    for (const m of raw.text.matchAll(STAMPED_REF_RE)) depStampOf(m[1]);

    const depKey = Array.from(deps.entries()).map((e) => e[0] + '=' + e[1]).join('|');
    const cached = resultCache.get(urlPath);
    if (!cyclic && cached && cached.sig === raw.sig && cached.depKey === depKey) {
      counters.hits++;
      return cached.result;
    }

    const text = raw.text.replace(STAMPED_REF_RE, (whole, url) => {
      const stamp = deps.get(url);
      if (!stamp) {
        warnOnce('missing:' + url, '[assetStamp] ' + urlPath + ' references ' + url + ' which does not exist under public/ — left unstamped');
        return whole;
      }
      return url + '?v=' + stamp;
    });
    const body = Buffer.from(text, 'utf8');
    const result = { body, rewritten: text !== raw.text, stamp: hashBuffer(body), cyclic };
    if (!cyclic) resultCache.set(urlPath, { sig: raw.sig, depKey, result });
    return result;
  }

  /** The bytes served at a /js|/css URL: { body, rewritten }, or null if missing/unsafe. */
  function rewriteAsset(urlPath) {
    const r = resolve(urlPath, []);
    return r ? { body: r.body, rewritten: r.rewritten } : null;
  }

  /** First 16 hex of sha256(served bytes) for a /js|/css URL, or null. */
  function stampFor(urlPath) {
    const r = resolve(urlPath, []);
    return r ? r.stamp : null;
  }

  /**
   * Stamp every local js/css reference in HTML text: `src|href` attributes get
   * a stamp added or replaced; any `?v=`-stamped /js|/css reference in inline
   * text (e.g. a script that injects another script) is re-stamped. Missing
   * files are left untouched (one warning each).
   */
  function rewriteHtml(text) {
    if (typeof text !== 'string' || text.indexOf('/js/') === -1 && text.indexOf('/css/') === -1) return text;
    const stampOrNull = (url) => {
      const s = stampFor(url);
      if (!s) warnOnce('missing:' + url, '[assetStamp] HTML references ' + url + ' which does not exist under public/ — left unstamped');
      return s;
    };
    let out = text.replace(HTML_ATTR_RE, (whole, attr, eq, q, url) => {
      const s = stampOrNull(url);
      return s ? attr + eq + q + url + '?v=' + s + q : whole;
    });
    out = out.replace(STAMPED_REF_RE, (whole, url) => {
      const s = stampOrNull(url);
      return s ? url + '?v=' + s : whole;
    });
    return out;
  }

  return {
    rewriteHtml,
    rewriteAsset,
    stampFor,
    fileFor,
    /** { reads, hits } — file reads vs cache hits (unit-test visibility into the mtime cache). */
    stats() { return { reads: counters.reads, hits: counters.hits }; },
  };
}

module.exports = { createAssetStamper, STAMP_LEN, ASSET_URL_RE };
