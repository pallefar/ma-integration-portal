'use strict';
// SAFE-01 (13-01): structural "is this HTML inert?" checker shared by the
// sanitizer suites. It PARSES the sanitizer's output with the vendored
// htmlparser2 and walks the DOM against the lib/htmlPolicy.js allowlist — no
// regex-on-output assertions (a regex over serialized HTML is exactly the
// technique R1-03 broke).

const { parseDocument } = require('htmlparser2');
const policy = require('../../lib/htmlPolicy.js');

const ALLOWED_TAG_SET = new Set(policy.ALLOWED_TAGS);
const GLOBAL_ATTR = new Set(policy.GLOBAL_ATTRIBUTES);
const URL_SCHEMES = new Set(policy.URL_SCHEMES);
const IMG_SCHEMES = new Set(policy.IMG_SCHEMES);
const ALLOWED_PROPS = new Set(Object.keys(policy.ALLOWED_STYLES['*']));
const DATA_IMAGE_OK = new RegExp('^data:image/(?:' + policy.DATA_IMAGE_MIME.join('|') + ');base64,[A-Za-z0-9+/]+={0,2}$', 'i');

// URL parsers ignore ASCII whitespace/control characters inside a scheme.
function compact(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c > 0x20 && c !== 0x7f) out += value[i];
  }
  return out;
}

function schemeOf(url) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function checkUrl(tag, attr, value, out) {
  const url = compact(value);
  if (url.startsWith('//')) { out.push(`${tag}[${attr}] protocol-relative url`); return; }
  const scheme = schemeOf(url);
  if (scheme === null) {
    // Something that is not a scheme but contains a colon before any / ? #
    // (e.g. `javascript&colon;`) would have been decoded already by the parser;
    // a relative url must not contain a scheme-looking prefix.
    return;
  }
  const allowed = tag === 'img' ? IMG_SCHEMES : URL_SCHEMES;
  if (!allowed.has(scheme)) { out.push(`${tag}[${attr}] scheme ${scheme}:`); return; }
  if (scheme === 'data' && !DATA_IMAGE_OK.test(url)) out.push(`${tag}[${attr}] data: url not an allowed image`);
}

function checkStyle(tag, value, out) {
  const decls = value.split(';');
  for (const d of decls) {
    if (d.trim() === '') continue;
    const idx = d.indexOf(':');
    if (idx < 0) { out.push(`${tag}[style] declaration without colon`); continue; }
    const prop = d.slice(0, idx).trim().toLowerCase();
    const val = d.slice(idx + 1).toLowerCase();
    if (!ALLOWED_PROPS.has(prop)) out.push(`${tag}[style] property ${prop}`);
    for (const bad of ['url(', 'expression(', 'javascript:', '\\', '@import', 'position', '/*']) {
      if (val.includes(bad)) out.push(`${tag}[style] value contains ${bad}`);
    }
  }
}

/**
 * Returns an array of violation strings ([] = structurally inert).
 * @param {string} html
 */
function inertViolations(html) {
  const out = [];
  const doc = parseDocument(String(html));
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'directive' || n.type === 'cdata') { out.push(`node type ${n.type}`); continue; }
      if (n.name !== undefined) {
        const tag = n.name.toLowerCase();
        if (!ALLOWED_TAG_SET.has(tag)) out.push(`element <${tag}>`);
        const allowedAttr = new Set(policy.ALLOWED_ATTRIBUTES[tag] || []);
        for (const [name, val] of Object.entries(n.attribs || {})) {
          const a = name.toLowerCase();
          if (a.startsWith(policy.NEVER_ALLOWED_ATTRIBUTE_PREFIX)) { out.push(`${tag}[${a}] event handler`); continue; }
          if (policy.NEVER_ALLOWED_ATTRIBUTES.includes(a)) { out.push(`${tag}[${a}] never-allowed attribute`); continue; }
          if (!GLOBAL_ATTR.has(a) && !allowedAttr.has(a)) { out.push(`${tag}[${a}] attribute not allowlisted`); continue; }
          if (a === 'href' || a === 'src') checkUrl(tag, a, val, out);
          if (a === 'style') checkStyle(tag, val, out);
          if (tag === 'a' && a === 'target' && val !== policy.ALLOWED_TARGET) out.push(`a[target=${val}]`);
          if (tag === 'a' && a === 'rel' && val !== policy.FORCED_LINK_REL) out.push(`a[rel=${val}]`);
        }
      }
      if (n.children) walk(n.children);
    }
  };
  walk(doc.children);
  return out;
}

module.exports = { inertViolations };
