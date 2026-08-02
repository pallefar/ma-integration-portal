// VAL-02 / D-15: server-side, write-time port of public/js/page-layout.js's
// client-side, render-time `sanitize()` regex. The client-side function stays
// in place unchanged (D-15: the render-time textContent/sanitize discipline
// is defence in depth, not replaced) — this module closes the gap that
// existed before this phase: a value could be stored WITHOUT ever passing
// through that regex if it reached the database via any path that didn't
// happen to re-render through page-layout.js first (e.g. a direct API
// client, or a future render path that forgets the client-side call).
//
// Deliberately the SAME regex family, not a rewrite — 03-RESEARCH.md's
// "Don't Hand-Roll" table is explicit that pulling a real DOM implementation
// (the standard robust upgrade, e.g. DOMPurify) into this vanilla-JS,
// no-build-step app is disproportionate for this phase, and the existing
// regex is already the app's SHIPPED production defence (it has been
// running client-side since the CMS layout builder shipped). Behind the CSP
// (script-src/object-src/frame-ancestors) as a second, independent layer —
// two gates, not one, per 03-RESEARCH.md's "Anti-Patterns to Avoid".
//
// Known residual limitation (T-03-36, accepted risk, not silently hidden):
// this is a regex sanitizer, not a real HTML parser. An attacker who can
// construct a sufficiently obfuscated/malformed markup fragment (nested or
// re-entrant tag boundaries a real parser would normalize before a regex
// ever sees them) may be able to construct a variant this regex does not
// catch. 03-RESEARCH.md's Assumptions Log A1 records that a robust allowlist
// parser was deliberately not adopted this phase — the CSP and the
// unchanged render-time textContent discipline are the backstop, not this
// function alone. See test/xss-sanitization.test.js for the specific
// variants this function is proven to neutralize and any variant left
// explicitly documented as a residual gap.
'use strict';

/**
 * Strip dangerous constructs from an admin-authored HTML-bearing field before
 * it is persisted. A null/absent/non-string value coerces to an empty string
 * — VAL-02's "never a stringified placeholder for an absent value" rule.
 * @param {*} value
 * @returns {string}
 */
function sanitizeHtml(value) {
  const s = typeof value === 'string' ? value : '';
  return s
    // script/iframe/object/embed/form/meta/base/link — the same tag family
    // page-layout.js's client-side sanitize() strips (open OR close tag).
    .replace(/<\/?(?:script|iframe|object|embed|form|meta|base|link)\b[^>]*>/gi, '')
    // Inline event-handler attributes in all three quoting forms
    // (on*="...", on*='...', on*=unquoted-token).
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    // Neutralize javascript:/vbscript: URL schemes wherever they appear
    // after an `=` (href="javascript:...", src='vbscript:...', etc.).
    .replace(/(=\s*["']?\s*)(?:javascript|vbscript)\s*:/gi, '$1');
}

module.exports = { sanitizeHtml };
