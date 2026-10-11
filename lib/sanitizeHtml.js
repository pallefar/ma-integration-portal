// VAL-02 / D-15 / SAFE-01 (D-13-01): server-side, write-time sanitizer for
// admin-authored HTML-bearing fields (pages body, page-layout richtext, course
// lesson bodies — the three fields validators/index.js htmlField() tags).
//
// [security] This module used to be a 58-line regex port of the client's
// page-layout.js sanitize() (Phase 3, VAL-02; residual limitation T-03-36).
// R1-03 measured four payloads that walked straight through it
// (`<img src="x"onerror=…>`, `jav&#x61;script:`, `java\tscript:`,
// `<scr<script>ipt>`). A regex strips substrings; an attacker simply builds the
// dangerous construct from the leftovers. It is replaced by a real allowlist
// HTML parser (vendored `sanitize-html` on htmlparser2) that PARSES the input,
// keeps only the tags / attributes / URL schemes / CSS properties named in
// lib/htmlPolicy.js and RE-SERIALIZES the result, so a payload can only
// survive as inert, entity-escaped text. The policy table is the single source
// of truth: the client renderer (public/js/safe-html.js, 13-06) is
// parity-tested against lib/htmlPolicy.js.
//
// The export, the "non-string → ''" contract and every call site
// (validators/index.js htmlField()) are unchanged — the swap is invisible
// there. D-15 stands: this is a write-time gate, and the render-time
// textContent / MASafeHtml discipline remains the independent second layer
// behind the CSP.
//
// Idempotency (PD-3): sanitize(sanitize(x)) === sanitize(x) is required so a
// re-save of stored content never changes it. The parser is applied until the
// output stops changing (at most MAX_PASSES). If it has not converged, the
// INPUT is returned fully entity-escaped as text (inert, fail-closed) rather
// than a value a later pass could still rewrite into live markup.
'use strict';

const sanitizeHtmlLib = require('sanitize-html');
const policy = require('./htmlPolicy');

const MAX_PASSES = 3;

// Pure character loop (no regex) so the fail-closed fallback has no pattern a
// crafted input could be shaped against.
// Escapes exactly the set the parser escapes in text nodes (& < >) so the
// fallback value is itself a fixed point of the sanitizer (idempotent).
// WR-A06: runs of ordinary characters are copied with one slice each (same
// output as a per-character append, but linear and fast on a multi-megabyte
// input — the depth-cap fallback below can receive one).
function escapeAsText(s) {
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x26 || c === 0x3c || c === 0x3e) {
      out += s.slice(last, i) + (c === 0x26 ? '&amp;' : (c === 0x3c ? '&lt;' : '&gt;'));
      last = i + 1;
    }
  }
  return out + s.slice(last);
}

// [security] WR-A06 (13-REVIEW): parse cost is SUPERLINEAR in nesting depth
// (htmlparser2's open-element stack + sanitize-html's frame stack, up to
// MAX_PASSES passes): 200 000 nested `<b>` took ~50 s of synchronous event-loop
// time. A size cap would be wrong (legitimate legacy lesson bodies can be
// large), so the bound is on DEPTH, estimated in one linear pass before the
// parser ever runs: +1 for every opening tag that can nest, -1 for every closing
// tag (floor 0). Void elements never open a level, and the tags whose next
// sibling implicitly closes them (`<p><p>`, `<li><li>`, `<td><td>`, …) cannot
// build depth in the parser either, so they are not counted — no legitimate
// document is affected. The estimate over-counts only (a `<b>` inside an
// attribute value or a dropped `<script>` still counts), i.e. it errs toward the
// fail-closed path. Above MAX_NESTING the input is returned entity-escaped as
// text — the same inert fallback a non-converging input already gets.
const MAX_NESTING = 2000;
const NON_NESTING_TAGS = new Set([
  // void elements
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
  // implicitly closed by a following sibling of the same family
  'p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'option', 'optgroup', 'rb', 'rt', 'rtc', 'rp', 'thead', 'tbody', 'tfoot',
]);
const isAsciiLetter = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isTagNameChar = (c) => isAsciiLetter(c) || (c >= 0x30 && c <= 0x39) || c === 0x2d;

/**
 * Linear, character-loop upper estimate of the element nesting depth htmlparser2
 * would build. Stops scanning as soon as the estimate exceeds `stopAbove`
 * (default: never), so an attack input costs ~MAX_NESTING tags, not its length.
 */
function nestingEstimate(s, stopAbove) {
  const limit = typeof stopAbove === 'number' ? stopAbove : Infinity;
  let depth = 0;
  let max = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    if (s.charCodeAt(i) !== 0x3c) continue; // '<'
    let j = i + 1;
    const closing = j < n && s.charCodeAt(j) === 0x2f; // '/'
    if (closing) j += 1;
    if (j >= n || !isAsciiLetter(s.charCodeAt(j))) continue;
    let k = j;
    while (k < n && isTagNameChar(s.charCodeAt(k))) k += 1;
    const name = s.slice(j, k).toLowerCase();
    i = k - 1;
    if (NON_NESTING_TAGS.has(name)) continue;
    if (closing) {
      if (depth > 0) depth -= 1;
    } else {
      depth += 1;
      if (depth > max) {
        max = depth;
        if (max > limit) return max;
      }
    }
  }
  return max;
}

// Whitespace and C0 control characters are ignored by URL parsers inside a
// scheme (`java\tscript:`), so the data-URL check compares the compacted form.
function compactUrl(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x20) out += s[i];
  }
  return out;
}

const DATA_IMAGE_RE = new RegExp(
  '^data:image/(?:' + policy.DATA_IMAGE_MIME.join('|') + ');base64,[A-Za-z0-9+/]+={0,2}$',
  'i'
);

function buildOptions() {
  const allowedAttributes = { '*': policy.GLOBAL_ATTRIBUTES.slice() };
  Object.keys(policy.ALLOWED_ATTRIBUTES).forEach((tag) => {
    allowedAttributes[tag] = policy.ALLOWED_ATTRIBUTES[tag].slice();
  });
  const allowedStyles = {};
  Object.keys(policy.ALLOWED_STYLES).forEach((sel) => {
    allowedStyles[sel] = {};
    Object.keys(policy.ALLOWED_STYLES[sel]).forEach((prop) => {
      allowedStyles[sel][prop] = policy.ALLOWED_STYLES[sel][prop].slice();
    });
  });
  return {
    allowedTags: policy.ALLOWED_TAGS.slice(),
    allowedAttributes,
    allowedSchemes: policy.URL_SCHEMES.slice(),
    allowedSchemesByTag: { img: policy.IMG_SCHEMES.slice() },
    allowProtocolRelative: false,
    allowedStyles,
    allowVulnerableTags: false,
    disallowedTagsMode: 'discard',
    // Replaces the library default list, so it carries the whole PD-4 set.
    nonTextTags: policy.DROP_WITH_CONTENT_TAGS.slice(),
    transformTags: {
      a: (tagName, attribs) => {
        const out = Object.assign({}, attribs);
        if (typeof out.target === 'string' && out.target.toLowerCase() !== policy.ALLOWED_TARGET) {
          delete out.target;
        } else if (typeof out.target === 'string') {
          out.target = policy.ALLOWED_TARGET;
        }
        out.rel = policy.FORCED_LINK_REL;
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => {
        const out = Object.assign({}, attribs);
        if (typeof out.src === 'string') {
          const compact = compactUrl(out.src);
          if (compact.slice(0, 5).toLowerCase() === 'data:') {
            // Only a base64 raster image of an allowlisted MIME type survives;
            // `data:image/svg+xml`, `data:text/html`, … lose the src.
            if (DATA_IMAGE_RE.test(compact)) out.src = compact;
            else delete out.src;
          }
        }
        return { tagName, attribs: out };
      },
    },
  };
}

const OPTIONS = buildOptions();

function onePass(s) {
  return sanitizeHtmlLib(s, OPTIONS);
}

/**
 * Sanitize an admin-authored HTML-bearing field before it is persisted. A
 * null/absent/non-string value coerces to an empty string — VAL-02's "never a
 * stringified placeholder for an absent value" rule.
 * @param {*} value
 * @returns {string}
 */
function sanitizeHtml(value) {
  const input = typeof value === 'string' ? value : '';
  if (input === '') return '';
  // WR-A06: pathological nesting never reaches the (superlinear) parser.
  if (nestingEstimate(input, MAX_NESTING) > MAX_NESTING) {
    sanitizeHtml.depthFallbacks += 1;
    return escapeAsText(input);
  }
  let current = input;
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = onePass(current);
    if (next === current) return next;
    current = next;
  }
  // Did not converge: fail closed to inert text.
  sanitizeHtml.escapedFallbacks += 1;
  return escapeAsText(input);
}

// Observability for the corpus test (PD-3: fallbacks must stay a rounding error).
sanitizeHtml.escapedFallbacks = 0;
// WR-A06: inputs refused by the nesting cap (kept apart so the corpus test's
// non-convergence counter above keeps its meaning).
sanitizeHtml.depthFallbacks = 0;
sanitizeHtml.MAX_NESTING = MAX_NESTING;
sanitizeHtml.nestingEstimate = nestingEstimate;

module.exports = { sanitizeHtml };
