// clientCorpus - PRD acceptance 1/2 (client renderer half), D-13-07.
//
// (a) EVERY vector of test/fixtures/xss-corpus.json (313, R1-03-a..d included) is
//     run through the real MASafeHtml.toFragment in Chromium, appended to the
//     live document (so a surviving <img onerror> / <a> would actually fire) and
//     audited against MASafeHtml.POLICY: no on* attribute, no non-allowlisted
//     element, attribute or URL scheme, no style that can fetch; window.__xss
//     never set, no dialog, nothing reaches the canary.
// (b) every committed `[data-i18n-html]` dictionary value (public/*.html keys x
//     every language in the demo dictionary) renders with the SAME element/text
//     structure as a plain browser parse of the same string - nothing legitimate
//     is dropped by the allowlist.
// (c) 13-09 fold-in: a message with a javascript: link, an i18n-html value with
//     onerror and a lesson body with onerror are covered end to end in storedXss;
//     here the renderer-level corpus also includes those three shapes.
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./_shared');

function i18nHtmlKeys() {
  const dir = path.join(S.REPO_ROOT, 'public');
  const keys = new Set();
  fs.readdirSync(dir).filter((n) => n.endsWith('.html')).forEach((n) => {
    const src = fs.readFileSync(path.join(dir, n), 'utf8');
    const re = /data-i18n-html="([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) keys.add(m[1]);
  });
  return Array.from(keys).sort();
}

async function clientCorpus(ctx) {
  const canary = ctx.canary;
  canary.reset();
  const expr = S.xssExpr(canary.origin);
  const extra = [
    { id: 'P13-chat-js-link', category: 'fold-in-13-09', input: '[click me](javascript:' + expr + ') **x**' },
    { id: 'P13-i18n-onerror', category: 'fold-in-13-09', input: '<strong>Hello</strong> <img src=x onerror=' + expr + '> <span onmouseover=' + expr + '>t</span>' },
    { id: 'P13-lesson-onerror', category: 'fold-in-13-09', input: '<p onclick=' + expr + '>Lesson</p><img src=x onerror=' + expr + '><a href="javascript:' + expr + '">go</a>' },
  ];
  const vectors = S.loadCorpus().concat(extra).map((v) => ({
    id: v.id, category: v.category, input: S.arm(S.pointAtCanary(v.input, canary.origin), expr),
  }));

  // The page: a neutral same-origin document (the app's /healthz JSON). The real
  // shipped renderer is fetched from the server and evaluated in it (CDP evaluate
  // is not subject to the page CSP), so what runs is exactly public/js/safe-html.js.
  const page = await ctx.newPage({});
  await page.goto(ctx.base + '/healthz', { waitUntil: 'load' });
  const src = await (await fetch(ctx.base + '/js/safe-html.js')).text();
  // A STRING expression: Runtime.evaluate is not governed by the page's
  // script-src, so this works unchanged under enforce (13-13) - no page eval().
  await page.evaluate(src);
  const loaded = await page.evaluate(() => typeof window.MASafeHtml === 'object' && typeof window.MASafeHtml.toFragment === 'function');
  ctx.check('safe-html.js is served and loads in the page', src.indexOf('MASafeHtml') !== -1 && loaded, { bytes: src.length });

  // ---- (a) corpus ----------------------------------------------------------
  const report = await page.evaluate(async (list) => {
    const P = window.MASafeHtml.POLICY;
    const allowedTags = new Set(P.ALLOWED_TAGS);
    const globalAttr = new Set(P.GLOBAL_ATTRIBUTES);
    const urlSchemes = new Set(P.URL_SCHEMES);
    const imgSchemes = new Set(P.IMG_SCHEMES);
    const holder = document.createElement('div');
    document.body.appendChild(holder);
    const rows = [];
    for (const v of list) {
      const box = document.createElement('div');
      holder.appendChild(box);
      let error = null;
      try { box.appendChild(window.MASafeHtml.toFragment(v.input)); } catch (e) { error = String(e && e.message ? e.message : e); }
      const problems = [];
      box.querySelectorAll('*').forEach((el) => {
        const tag = el.localName.toLowerCase();
        if (!allowedTags.has(tag)) problems.push('element <' + tag + '>');
        if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') problems.push('foreign namespace <' + tag + '>');
        Array.from(el.attributes).forEach((a) => {
          const n = a.name.toLowerCase();
          const perTag = (P.ALLOWED_ATTRIBUTES && P.ALLOWED_ATTRIBUTES[tag]) || [];
          if (n.indexOf('on') === 0) { problems.push(tag + '[' + n + '] event handler'); return; }
          if (!globalAttr.has(n) && perTag.indexOf(n) === -1) { problems.push(tag + '[' + n + '] attribute not allowlisted'); return; }
          if (n === 'href' || n === 'src') {
            let v2 = '';
            for (let i = 0; i < a.value.length; i++) { const c = a.value.charCodeAt(i); if (c > 0x20 && c !== 0x7f) v2 += a.value[i]; }
            let proto = '';
            try { proto = new URL(v2, location.origin).protocol.replace(/:$/, ''); } catch (e) { proto = 'unparsable'; }
            const ok = (tag === 'img' ? imgSchemes : urlSchemes).has(proto) || proto === 'http' || proto === 'https';
            if (!ok) problems.push(tag + '[' + n + '] scheme ' + proto);
            if (v2.indexOf('//') === 0) problems.push(tag + '[' + n + '] protocol-relative');
            if (/^data:/i.test(v2) && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v2)) problems.push(tag + '[' + n + '] data: not an allowed image');
          }
          if (n === 'style' && /url\(|expression\(|@import|javascript:|behavior|-moz-binding|position/i.test(a.value)) problems.push(tag + '[style] ' + a.value.slice(0, 40));
          if (n === 'target' && a.value !== '_blank') problems.push(tag + '[target=' + a.value + ']');
        });
      });
      rows.push({ id: v.id, category: v.category, error, problems, kept: box.childNodes.length });
    }
    // let any (wrongly) surviving <img>/<a> load or fire before the caller looks
    await new Promise((r) => setTimeout(r, 900));
    return { rows, xss: window.__xss === undefined ? null : window.__xss };
  }, vectors);

  const bad = report.rows.filter((r) => r.error || r.problems.length);
  ctx.check(`all ${vectors.length} corpus vectors rendered through MASafeHtml.toFragment without throwing`, report.rows.every((r) => !r.error), report.rows.filter((r) => r.error).slice(0, 5));
  ctx.check(`no vector leaves an on* attribute, non-allowlisted element/attribute/scheme or fetching style (${vectors.length} vectors)`,
    bad.length === 0, bad.slice(0, 8).map((r) => ({ id: r.id, problems: r.problems.slice(0, 3) })));
  const st = await S.execState(page);
  ctx.check('window.__xss never set by any vector', report.xss === null && st.xss === null, report.xss);
  ctx.check('no dialog opened by any vector', st.dialogs.length === 0, st.dialogs);
  ctx.check('no browser request to the canary origin', S.requestsTo(page, canary.origin).length === 0, S.requestsTo(page, canary.origin).slice(0, 5));
  ctx.check('canary server saw zero hits', canary.hits().length === 0, canary.hits().slice(0, 5));
  // Violation events while the corpus was live. One browser behaviour is expected and
  // recorded, never a script/img/connect/frame event: a DOMParser document inherits
  // the creator's CSP, so PARSING a `<base href=...>` vector (the renderer then drops
  // the element) is itself reported against `base-uri 'self'`. It affects no DOM.
  const v = await ctx.pageViolations(page);
  const baseUri = v.filter((x) => x.directive === 'base-uri');
  const other = v.filter((x) => x.directive !== 'base-uri');
  ctx.check('no script-src / img-src / connect-src / frame-src (or any non base-uri) violation while the corpus was live', other.length === 0, other.slice(0, 5));
  ctx.check('every base-uri event is the inert parse of a <base> vector (blocked URI = the canary origin, nothing applied)',
    baseUri.every((x) => x.blocked.indexOf(canary.origin) === 0), baseUri.map((x) => x.blocked + ' ' + x.disposition));
  ctx.say(`clientCorpus@${ctx.lane} vectors=${vectors.length} clean=${vectors.length - bad.length} canaryHits=${canary.hits().length} inertBaseUriParseEvents=${baseUri.length}`);

  // ---- (b) legitimate i18n-html dictionary values are not dropped ------------
  const keys = i18nHtmlKeys();
  const dict = await ctx.api(await ctx.adminCookie(), 'GET', '/api/i18n');
  ctx.check('the demo i18n dictionary is readable', dict.status === 200 && dict.json && dict.json.strings, { status: dict.status });
  const strings = (dict.json && dict.json.strings) || {};
  const langs = Object.keys(strings);
  const values = [];
  langs.forEach((lang) => keys.forEach((key) => { if (typeof strings[lang][key] === 'string') values.push({ lang, key, value: strings[lang][key] }); }));
  ctx.check(`dictionary covers the [data-i18n-html] keys of public/*.html (${keys.length} keys, ${langs.length} languages)`,
    values.length > 0, { keys: keys.length, langs, values: values.length });

  const parity = await page.evaluate((list) => {
    const sig = (parent) => {
      const out = [];
      const walk = (n) => {
        n.childNodes.forEach((c) => {
          if (c.nodeType === 3) out.push('T:' + c.data.replace(/\s+/g, ' '));
          else if (c.nodeType === 1) { out.push('<' + c.localName + '>'); walk(c); out.push('</' + c.localName + '>'); }
        });
      };
      walk(parent);
      return out.join('');
    };
    const diffs = [];
    list.forEach((item) => {
      const plain = new DOMParser().parseFromString(item.value, 'text/html').body;
      const host = document.createElement('div');
      window.MASafeHtml.render(host, item.value);
      const a = sig(plain);
      const b = sig(host);
      if (a !== b) diffs.push({ lang: item.lang, key: item.key, plain: a.slice(0, 120), rendered: b.slice(0, 120) });
    });
    return { n: list.length, diffs };
  }, values);
  ctx.check(`every demo [data-i18n-html] value renders with the same element/text structure as a plain parse (${parity.n} values)`,
    parity.diffs.length === 0, parity.diffs.slice(0, 6));
  ctx.say(`clientCorpus@${ctx.lane} i18nHtmlValues=${parity.n} structuralDiffs=${parity.diffs.length}`);

  const ev = await ctx.endpointViolations();
  ctx.check('GET /api/admin/csp-violations lists nothing but the inert base-uri parse tuples',
    ev.violations.every((t) => t.directive === 'base-uri'), { count: ev.count, tuples: ev.violations.slice(0, 5) });
}

module.exports = { clientCorpus, __lanes: { clientCorpus: ['dev'] } };
