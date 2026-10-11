/**
 * TE Connectivity M&A Portal — safe-html.js (SAFE-01 client half, D-13-02)
 *
 * The single client-side renderer for admin-authored / stored HTML. It exposes
 *   window.MASafeHtml = { render(el, html), toFragment(html), safeHref(value), POLICY }
 *
 * [security] R1-03 client half: the old client sanitizers were regex strippers
 * followed by `innerHTML = …`, i.e. the same bypassable family as the retired
 * server regex (R1-03 measured four payloads straight through it) AND a
 * serialize-then-parse round trip, which is exactly where mutation XSS lives.
 * This renderer never serializes and never hands a string to the HTML parser
 * of a LIVE document: the input is parsed by DOMParser into an INERT document
 * (no script execution, no resource loads, no event handlers), then the output
 * is BUILT node by node with createElement / setAttribute / createTextNode
 * from the allowlist below. Nothing the parser produced is ever re-attached;
 * whatever the allowlist does not name simply cannot appear in the output.
 *
 * POLICY is a literal copy of lib/htmlPolicy.js (the server's single allowlist
 * table). Hand-maintained copies drift, so test/safe-html-policy.test.js
 * asserts table-for-table parity and fails on any difference — change the
 * server table and this one together, never one alone. The CSP of D-13-03 is
 * the independent second layer behind this renderer.
 *
 * Semantics mirror the server (PD-36):
 *   - DROP_WITH_CONTENT_TAGS are removed together with their content;
 *   - every other non-allowlisted element is unwrapped (children rendered);
 *   - elements outside the HTML namespace (SVG / MathML) are dropped with
 *     their content, comments / processing instructions are dropped;
 *   - URL attributes are resolved against the page origin after control
 *     characters are stripped and must carry an allowlisted protocol
 *     (relative URLs resolve to the page origin and are allowed; protocol-
 *     relative `//host` is not); `data:` only for img with an allowlisted
 *     raster MIME and base64;
 *   - `style` is copied property by property through a detached element's
 *     CSSStyleDeclaration, filtered by the CSS allowlist (CSSOM only — never
 *     setAttribute('style'), so the CSP style-src-attr stays satisfiable);
 *   - `a` always gets rel="noopener noreferrer"; `target` only `_blank`.
 *
 * Load order: a static, parser-blocking <script src="/js/safe-html.js?v=…">
 * sits before every consumer script on each page (PD-28). The module touches
 * no DOM API at load time, so a vm without a DOM can read POLICY.
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  function deepFreeze(o) {
    // RegExp objects are left alone (anchored, non-global, never mutated).
    if (o && typeof o === 'object' && !(o instanceof RegExp) && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.getOwnPropertyNames(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }

  // ---- POLICY: parity-tested copy of lib/htmlPolicy.js --------------------
  var LENGTH = '-?\\d{1,4}(?:\\.\\d{1,3})?(?:px|em|rem|%|pt|ex|ch|vw|vh)?';
  var SPACING = new RegExp('^(?:auto|' + LENGTH + ')(?:\\s+(?:auto|' + LENGTH + ')){0,3}$', 'i');
  var COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\(\s*[\d.]+%?(?:\s*,\s*[\d.]+%?){2,3}\s*\))$/i;

  var POLICY = deepFreeze({
    ALLOWED_TAGS: [
      'p', 'br', 'hr', 'div', 'span',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'pre', 'code',
      'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      'a', 'img', 'figure', 'figcaption'
    ],
    DROP_WITH_CONTENT_TAGS: [
      'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed',
      'svg', 'math', 'textarea', 'title', 'xmp', 'noembed', 'noframes',
      'select', 'option'
    ],
    NEVER_ALLOWED_TAGS: [
      'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'base', 'meta',
      'link', 'form', 'input', 'button', 'template', 'noscript', 'frame', 'frameset',
      'applet', 'audio', 'video', 'source', 'canvas', 'textarea', 'select', 'option'
    ],
    NEVER_ALLOWED_ATTRIBUTES: ['srcdoc', 'formaction', 'id', 'name', 'xlink:href', 'srcset'],
    NEVER_ALLOWED_ATTRIBUTE_PREFIX: 'on',
    GLOBAL_ATTRIBUTES: ['class', 'title', 'lang', 'dir', 'style'],
    ALLOWED_ATTRIBUTES: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      ol: ['start'],
      col: ['span'],
      colgroup: ['span']
    },
    URL_SCHEMES: ['http', 'https', 'mailto', 'tel'],
    IMG_SCHEMES: ['http', 'https', 'data'],
    DATA_IMAGE_MIME: ['png', 'jpeg', 'gif', 'webp'],
    ALLOWED_TARGET: '_blank',
    FORCED_LINK_REL: 'noopener noreferrer',
    ALLOWED_STYLES: {
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
        'padding-left': [SPACING]
      }
    }
  });

  // ---- lookup sets (null-prototype: no inherited-key surprises) -----------
  function toSet(list) {
    var o = Object.create(null);
    for (var i = 0; i < list.length; i++) o[list[i]] = true;
    return o;
  }
  var TAGS = toSet(POLICY.ALLOWED_TAGS);
  var DROP = toSet(POLICY.DROP_WITH_CONTENT_TAGS);
  var NEVER_ATTR = toSet(POLICY.NEVER_ALLOWED_ATTRIBUTES);
  var GLOBAL_ATTR = toSet(POLICY.GLOBAL_ATTRIBUTES);
  var TAG_ATTR = Object.create(null);
  Object.keys(POLICY.ALLOWED_ATTRIBUTES).forEach(function (t) { TAG_ATTR[t] = toSet(POLICY.ALLOWED_ATTRIBUTES[t]); });
  var STYLE_PROPS = Object.keys(POLICY.ALLOWED_STYLES['*']);
  var NS_HTML = 'http://www.w3.org/1999/xhtml';
  var DATA_IMAGE_RE = new RegExp('^data:image/(?:' + POLICY.DATA_IMAGE_MIME.join('|') + ');base64,[A-Za-z0-9+/]+={0,2}$', 'i');

  // ---- URL checks ---------------------------------------------------------
  function urlBase() {
    try {
      if (typeof location !== 'undefined' && location.origin && location.origin !== 'null') return location.origin;
    } catch (e) { /* fall through */ }
    return 'https://portal.invalid';
  }

  // Strip C0/C1 control characters (the parser ignores tab/CR/LF anywhere in a
  // URL and trims the ends; other controls inside a scheme are an obfuscation
  // trick) and trim, so the value validated is the value written.
  function cleanUrl(v) {
    return String(v).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  }

  // Returns the (cleaned) URL when it is allowed for `tag`, else ''.
  function checkUrl(value, tag) {
    var v = cleanUrl(value);
    if (v === '') return '';
    // Protocol-relative (`//host`, and the backslash forms browsers treat as
    // slashes) is not allowed — allowProtocolRelative:false on the server.
    if (/^[\\/]{2}/.test(v)) return '';
    var u;
    try { u = new URL(v, urlBase()); } catch (e) { return ''; }
    // Conservative on top of what the URL parser does: whitespace inside a
    // scheme (`java script:`) is a relative path to a browser, but the server
    // sanitizer and the structural checker both judge the COMPACT form, so a
    // value whose compact form names a scheme is judged by that scheme.
    var compact = v.replace(/\s+/g, '');
    var m = /^([a-z][a-z0-9+.\-]*):/i.exec(compact);
    var proto = (m ? m[1] : u.protocol.replace(/:$/, '')).toLowerCase();
    if (proto === 'data') {
      // Must be a base64 raster image of an allowlisted MIME, img only.
      if (tag !== 'img') return '';
      return DATA_IMAGE_RE.test(compact) ? compact : '';
    }
    var schemes = tag === 'img' ? POLICY.IMG_SCHEMES : POLICY.URL_SCHEMES;
    return schemes.indexOf(proto) !== -1 ? v : '';
  }

  // For trusted template code (page-layout CTA hrefs): the same scheme check
  // as an <a href>, returning the cleaned value or '' when it is not allowed.
  function safeHref(value) {
    return checkUrl(value == null ? '' : value, 'a');
  }

  // ---- style --------------------------------------------------------------
  // Parse the declaration list with the browser's own CSS parser on a
  // DETACHED element, then copy ONLY allowlisted properties whose serialized
  // value matches the anchored allowlist regex. Reading by allowlisted name
  // (not iterating the declared longhands) keeps shorthands such as
  // `margin` / `text-decoration` working across engines.
  function copyStyle(value, outEl) {
    var probe = document.createElement('span');
    probe.style.cssText = String(value);
    // Only properties the author DECLARED by that name are candidates: the
    // CSSOM also expands non-allowlisted shorthands into allowlisted longhands
    // (`background: url(x)` -> background-color: initial), which the server
    // drops and which must not appear here either. A fake name in the scan can
    // only enable a property the parser already set, and every value is still
    // matched against the anchored allowlist regex below.
    var declared = Object.create(null);
    String(value).replace(/(?:^|;)\s*([a-z-]+)\s*:/gi, function (m, n) { declared[n.toLowerCase()] = true; return m; });
    for (var i = 0; i < STYLE_PROPS.length; i++) {
      var prop = STYLE_PROPS[i];
      if (!declared[prop]) continue;
      var v = probe.style.getPropertyValue(prop);
      if (!v) continue;
      var rules = POLICY.ALLOWED_STYLES['*'][prop];
      var ok = false;
      for (var j = 0; j < rules.length; j++) { if (rules[j].test(v)) { ok = true; break; } }
      if (ok) outEl.style.setProperty(prop, v);
    }
  }

  // ---- attributes ---------------------------------------------------------
  function copyAttributes(src, out, tag) {
    var perTag = TAG_ATTR[tag];
    var attrs = src.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name.toLowerCase();
      var value = attrs[i].value;
      if (name.indexOf(POLICY.NEVER_ALLOWED_ATTRIBUTE_PREFIX) === 0) continue; // on*
      if (NEVER_ATTR[name]) continue;
      if (!(GLOBAL_ATTR[name] || (perTag && perTag[name]))) continue;

      if (name === 'style') { copyStyle(value, out); continue; }
      if (name === 'rel') continue;                       // forced below on <a>
      if (name === 'target') {
        if (String(value).toLowerCase() === POLICY.ALLOWED_TARGET) out.setAttribute('target', POLICY.ALLOWED_TARGET);
        continue;
      }
      if ((tag === 'a' && name === 'href') || (tag === 'img' && name === 'src')) {
        var safe = checkUrl(value, tag);
        if (safe !== '') out.setAttribute(name, safe);
        continue;
      }
      out.setAttribute(name, value);
    }
    if (tag === 'a') out.setAttribute('rel', POLICY.FORCED_LINK_REL);
  }

  // ---- the walk -----------------------------------------------------------
  function build(srcParent, outParent) {
    var kids = srcParent.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) {                              // text
        outParent.appendChild(document.createTextNode(n.data));
      } else if (n.nodeType === 1) {                       // element
        if (n.namespaceURI !== NS_HTML) continue;          // SVG / MathML: drop with content
        var tag = String(n.localName).toLowerCase();
        if (DROP[tag]) continue;                           // drop with content
        if (!TAGS[tag]) { build(n, outParent); continue; } // unwrap
        var el = document.createElement(tag);
        copyAttributes(n, el, tag);
        build(n, el);
        outParent.appendChild(el);
      }
      // comments, processing instructions, doctype, CDATA: dropped
    }
  }

  function toFragment(html) {
    if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
      throw new Error('MASafeHtml: no DOM available');
    }
    var frag = document.createDocumentFragment();
    var str = html == null ? '' : String(html);
    if (str === '') return frag;
    // DOMParser output is an inert document: scripts never run, nothing loads.
    var doc = new DOMParser().parseFromString(str, 'text/html');
    // Head-only elements (script/style/meta/link/title/base/noscript/template)
    // are all dropped or empty by policy, so only the body subtree is walked.
    if (doc.body) build(doc.body, frag);
    return frag;
  }

  function render(el, html) {
    var frag = toFragment(html);
    if (typeof el.replaceChildren === 'function') {
      el.replaceChildren(frag);
    } else {
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(frag);
    }
    return el;
  }

  root.MASafeHtml = Object.freeze({
    render: render,
    toFragment: toFragment,
    safeHref: safeHref,
    POLICY: POLICY
  });
})();
