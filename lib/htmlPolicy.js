// SAFE-01 / D-13-01 / PD-2: the ONE allowlist table for CMS HTML.
//
// [security] lib/sanitizeHtml.js (server, write-time, vendored `sanitize-html`
// parser) is configured exclusively from these tables, and the client renderer
// public/js/safe-html.js (13-06) is parity-tested against the SAME table. A tag,
// attribute, URL scheme or CSS property that is not listed here cannot survive
// either side: the policy is deny-by-default, the parser re-serializes, so a
// payload can only ever persist as inert text. Never duplicate these lists in
// another file — import them (or, client side, fail the parity test).
//
// Every table is deep-frozen: a stray mutation elsewhere would silently widen
// the policy for the whole process.
'use strict';

function deepFreeze(o) {
  // RegExp objects are left alone (freezing makes lastIndex read-only; they
  // are never mutated here and are anchored, non-global patterns).
  if (o && typeof o === 'object' && !(o instanceof RegExp) && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.getOwnPropertyNames(o).forEach((k) => deepFreeze(o[k]));
  }
  return o;
}

// Tags that survive (block/inline text formatting, headings, lists, tables,
// links, images). Everything else is unwrapped (children kept as text/allowed
// markup) unless it is in DROP_WITH_CONTENT_TAGS (children discarded).
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'img', 'figure', 'figcaption',
];

// PD-4: tags whose CONTENT is discarded along with the tag (raw-text /
// foreign-content / mutation-XSS carriers). Passed to the parser as
// `nonTextTags`. None of these is in ALLOWED_TAGS.
const DROP_WITH_CONTENT_TAGS = [
  'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed',
  'svg', 'math', 'textarea', 'title', 'xmp', 'noembed', 'noframes',
  'select', 'option',
];

// The PRD "never allowed" list, asserted by test against ALLOWED_TAGS and the
// attribute tables so an accidental allowlist edit fails loudly.
const NEVER_ALLOWED_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'base', 'meta',
  'link', 'form', 'input', 'button', 'template', 'noscript', 'frame', 'frameset',
  'applet', 'audio', 'video', 'source', 'canvas', 'textarea', 'select', 'option',
];
const NEVER_ALLOWED_ATTRIBUTES = ['srcdoc', 'formaction', 'id', 'name', 'xlink:href', 'srcset'];
// Any attribute whose lower-cased name starts with this prefix is never allowed.
const NEVER_ALLOWED_ATTRIBUTE_PREFIX = 'on';

// Attributes allowed on every allowed tag, then per tag. `id`/`name` are
// deliberately absent (DOM clobbering, T-13-05).
const GLOBAL_ATTRIBUTES = ['class', 'title', 'lang', 'dir', 'style'];
const ALLOWED_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  th: ['colspan', 'rowspan', 'scope'],
  td: ['colspan', 'rowspan'],
  ol: ['start'],
  col: ['span'],
  colgroup: ['span'],
};

// URL schemes for href (relative URLs are always allowed; protocol-relative
// `//host` is NOT — allowProtocolRelative:false).
const URL_SCHEMES = ['http', 'https', 'mailto', 'tel'];
// img[src] additionally allows `data:` but ONLY for DATA_IMAGE_MIME base64 (never svg).
const IMG_SCHEMES = ['http', 'https', 'data'];
const DATA_IMAGE_MIME = ['png', 'jpeg', 'gif', 'webp'];

// `a[target]` may only ever be this; `a[rel]` is always overwritten.
const ALLOWED_TARGET = '_blank';
const FORCED_LINK_REL = 'noopener noreferrer';

// CSS allowlist: property -> value regexes. Every regex is ANCHORED and built
// from a closed character class, so `url(`, `expression(`, `javascript:`,
// backslash escapes, comments and `;` can never match.
const LENGTH = '-?\\d{1,4}(?:\\.\\d{1,3})?(?:px|em|rem|%|pt|ex|ch|vw|vh)?';
const SPACING = new RegExp('^(?:auto|' + LENGTH + ')(?:\\s+(?:auto|' + LENGTH + ')){0,3}$', 'i');
const COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\(\s*[\d.]+%?(?:\s*,\s*[\d.]+%?){2,3}\s*\))$/i;
const ALLOWED_STYLES = {
  '*': {
    'color': [COLOR],
    'background-color': [COLOR],
    'text-align': [/^(?:left|right|center|justify|start|end)$/i],
    'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
    'font-style': [/^(?:normal|italic|oblique)$/i],
    'font-size': [new RegExp('^(?:' + LENGTH + '|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$', 'i')],
    'text-decoration': [/^(?:none|underline|overline|line-through)(?:\s+(?:underline|overline|line-through))*$/i],
    'line-height': [new RegExp('^(?:normal|' + LENGTH + ')$', 'i')],
    'margin': [SPACING],
    'margin-top': [SPACING],
    'margin-right': [SPACING],
    'margin-bottom': [SPACING],
    'margin-left': [SPACING],
    'padding': [SPACING],
    'padding-top': [SPACING],
    'padding-right': [SPACING],
    'padding-bottom': [SPACING],
    'padding-left': [SPACING],
  },
};

const policy = {
  ALLOWED_TAGS,
  DROP_WITH_CONTENT_TAGS,
  NEVER_ALLOWED_TAGS,
  NEVER_ALLOWED_ATTRIBUTES,
  NEVER_ALLOWED_ATTRIBUTE_PREFIX,
  GLOBAL_ATTRIBUTES,
  ALLOWED_ATTRIBUTES,
  URL_SCHEMES,
  IMG_SCHEMES,
  DATA_IMAGE_MIME,
  ALLOWED_TARGET,
  FORCED_LINK_REL,
  ALLOWED_STYLES,
};

module.exports = deepFreeze(policy);
