'use strict';
// [security] CR-01 (Phase 10 review): ONE definition of "the path a policy
// table sees". Every prefix table that decides access by path — the consolidated
// /api gate's ROLE_WRITE_POLICY / DEMO_ONLY_PREFIXES / MUST_CHANGE_ALLOWED_PATHS
// checks, db/resolver.js's control-plane (never-open) list, and the credential
// lockdown allowlist — must evaluate the SAME canonical spellings of a request
// path, or a spelling the router still dispatches (case variant, `//`, trailing
// slash, percent-encoded letter or slash) slips past a table that only knows the
// literal lowercase form.
//
// Mitigation strategy (defence in depth, not one fix):
//   1. server.js sets `case sensitive routing` BEFORE the first middleware, so
//      the router itself no longer dispatches `/api/Admin/users` to the
//      `/api/admin/users` handler.
//   2. pathForms() returns EVERY spelling a policy must consider: the raw path
//      and its once-decoded form, each with `//` collapsed and a trailing slash
//      stripped, each both as-is and lowercased. Callers apply the MOST
//      RESTRICTIVE answer across the forms — "allowed" only if every form is
//      allowed, "admin / demo-only / control-plane" if ANY form is. Taking only
//      the decoded+lowercased form would be wrong in the other direction: an
//      exact-match self-service rule (`/api/deals/select`) would then widen to
//      `/api/deals/SELECT`, which the case-sensitive router dispatches to a
//      `/api/deals/:id` handler.
//   3. A path that is ambiguous by construction — a dot segment (raw or after
//      decoding) or an undecodable escape — is rejected outright; no route is
//      registered under such a spelling, so refusing it costs nothing.

/** Collapse runs of `/` and drop a trailing `/` (never the root itself). */
function tidy(p) {
  let out = p.replace(/\/{2,}/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function hasDotSegment(p) {
  return p.split('/').some((seg) => seg === '.' || seg === '..');
}

/**
 * @param {string} rawPath a request path WITHOUT query string (e.g.
 *   `req.baseUrl + req.path`, or `req.path` outside a mounted router).
 * @returns {{ ok: boolean, forms: string[], canonical: string }}
 *   `ok:false` = ambiguous spelling, refuse it. `canonical` is the decoded,
 *   tidied, lowercased form (the one the policy tables are written in).
 */
function pathForms(rawPath) {
  const raw = String(rawPath || '');
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch (e) {
    return { ok: false, forms: [], canonical: '' };
  }
  if (hasDotSegment(raw) || hasDotSegment(decoded) || decoded.includes('\\')) {
    return { ok: false, forms: [], canonical: '' };
  }
  const a = tidy(raw);
  const b = tidy(decoded);
  const forms = Array.from(new Set([a, a.toLowerCase(), b, b.toLowerCase()]));
  return { ok: true, forms, canonical: b.toLowerCase() };
}

/** True when the path is spelled exactly as its canonical form. */
function isCanonical(rawPath) {
  const r = pathForms(rawPath);
  return r.ok && r.forms.length === 1 && r.forms[0] === String(rawPath || '');
}

/**
 * [security] CR-A01 (13-REVIEW, defence in depth): does this request path carry a
 * spelling that a Windows host resolves to a DIFFERENT file than the one the
 * path's POSIX reading names? `send`/`fs` resolve with the platform path module,
 * and on Win32 `\` is a separator, a segment ending in `.` or a space is silently
 * trimmed (`uploads.` == `uploads`), `name:stream` addresses an NTFS alternate
 * data stream and `NAME~1` an 8.3 short name — so every prefix test written in
 * POSIX terms can be walked around. No route or public file of this app uses any
 * of these spellings, so refusing them costs nothing.
 *
 * Decodes ONCE (as `send` does); an undecodable path returns false and is left
 * to the existing handling. Exactly `.`/`..` segments are left to their existing
 * pinned handling (pathForms / htmlRequestVerdict / send's own 403).
 *   - `\` or NUL anywhere                      -> refused (every path)
 *   - a segment ending in `.` or a space       -> refused (every path)
 *   - `:` or `~` anywhere                      -> refused outside the canonical
 *     `/api` prefix only (static/page paths never contain them; /api route
 *     parameters are opaque ids that are never resolved against the disk).
 * @param {string} rawPath request path without query string (`req.path`)
 */
function windowsAmbiguousPath(rawPath) {
  const raw = String(rawPath || '');
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch (e) { return false; }
  if (decoded.indexOf('\\') !== -1 || decoded.indexOf('\0') !== -1) return true;
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') continue;
    const last = seg[seg.length - 1];
    if (last === '.' || last === ' ') return true;
  }
  const isApi = raw === '/api' || raw.startsWith('/api/');
  if (!isApi && (decoded.indexOf(':') !== -1 || decoded.indexOf('~') !== -1)) return true;
  return false;
}

module.exports = { pathForms, isCanonical, windowsAmbiguousPath };
