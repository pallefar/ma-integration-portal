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

module.exports = { pathForms, isCanonical };
