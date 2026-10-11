/**
 * TE Connectivity M&A Portal — page-layout.js (Layout Builder)
 * Renders a page's ordered, typed content BLOCKS (page.layout) into its CMS region.
 * Fallback ladder: layout → legacy CMS body → original static markup.
 * Exposes window.PageBlockRegistry so the admin builder shares the same block schema.
 * Opt-in per page via <body data-cms-page="slug"> + an element with [data-cms-region].
 */
(function () {
  // [security] SAFE-01 / D-13-02 (R1-03 client half): this file used to carry a
  // regex `sanitize()` and assign its output to innerHTML. Stored CMS HTML now
  // goes ONLY through MASafeHtml.render (public/js/safe-html.js: DOMParser into
  // an inert document, then a createElement/setAttribute/createTextNode build
  // from the shared allowlist — never serialized, never re-parsed). The chrome
  // (region wrapper, badge, hero/cards/cta) is trusted template code built with
  // createElement/textContent, so author text can never become markup there
  // either. Only richtext `html` and the legacy page `body` are HTML strings.
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = String(text);
    return n;
  };
  const str = (s) => String(s == null ? '' : s);
  // CTA targets pass the same scheme check an <a href> inside richtext does.
  const safeHref = (h) => {
    const sh = window.MASafeHtml && window.MASafeHtml.safeHref;
    return (sh && sh(h || '#')) || '#';
  };
  // L() resolves an i18n {en,de,..} value (or plain string) for the active language.
  const makeL = (lang) => (v) => (v && typeof v === 'object') ? (v[lang] || v.en || Object.values(v).find(Boolean) || '') : (v || '');

  // ---- Block type registry: schema (fields) + render(data, L) → DOM node ----
  // field.kind: input|textarea|wysiwyg are per-language (i18n); text|lines are plain.
  const REGISTRY = {
    richtext: {
      label: 'Rich text', icon: '📝',
      fields: [{ key: 'html', kind: 'wysiwyg', label: 'Content' }],
      render: (d, L) => {
        const wrap = mk('div', 'pl-richtext');
        window.MASafeHtml.render(wrap, str(L(d.html)));
        return wrap;
      }
    },
    hero: {
      label: 'Hero', icon: '⭐',
      fields: [
        { key: 'title', kind: 'input', label: 'Title' },
        { key: 'subtitle', kind: 'textarea', label: 'Subtitle' },
        { key: 'cta', kind: 'input', label: 'Button text' },
        { key: 'ctaHref', kind: 'text', label: 'Button link' }
      ],
      render: (d, L) => {
        const wrap = mk('div', 'pl-hero');
        wrap.appendChild(mk('h2', '', L(d.title)));
        if (L(d.subtitle)) wrap.appendChild(mk('p', '', L(d.subtitle)));
        if (L(d.cta)) {
          const a = mk('a', 'btn btn-primary', L(d.cta));
          a.setAttribute('href', safeHref(d.ctaHref));
          wrap.appendChild(a);
        }
        return wrap;
      }
    },
    cards: {
      label: 'Card grid', icon: '🗂️',
      fields: [
        { key: 'heading', kind: 'input', label: 'Section heading' },
        { key: 'items', kind: 'lines', label: 'Cards — one per line: "Title | description | icon"' }
      ],
      render: (d, L) => {
        const items = String(d.items || '').split('\n').map(x => x.trim()).filter(Boolean).map(l => { const p = l.split('|'); return { t: (p[0] || '').trim(), desc: (p[1] || '').trim(), icon: (p[2] || '').trim() }; });
        const wrap = mk('div', 'pl-cards-wrap');
        if (L(d.heading)) wrap.appendChild(mk('h3', '', L(d.heading)));
        const grid = mk('div', 'pl-cards');
        items.forEach(i => {
          const card = mk('div', 'pl-card');
          if (i.icon) card.appendChild(mk('div', 'pl-card-icon', i.icon));
          card.appendChild(mk('h4', '', i.t));
          if (i.desc) card.appendChild(mk('p', '', i.desc));
          grid.appendChild(card);
        });
        wrap.appendChild(grid);
        return wrap;
      }
    },
    cta: {
      label: 'Call to action', icon: '📣',
      fields: [
        { key: 'heading', kind: 'input', label: 'Heading' },
        { key: 'text', kind: 'textarea', label: 'Text' },
        { key: 'button', kind: 'input', label: 'Button text' },
        { key: 'href', kind: 'text', label: 'Button link' }
      ],
      render: (d, L) => {
        const wrap = mk('div', 'pl-cta');
        wrap.appendChild(mk('h3', '', L(d.heading)));
        if (L(d.text)) wrap.appendChild(mk('p', '', L(d.text)));
        if (L(d.button)) {
          const a = mk('a', 'btn btn-primary', L(d.button));
          a.setAttribute('href', safeHref(d.href));
          wrap.appendChild(a);
        }
        return wrap;
      }
    }
  };
  window.PageBlockRegistry = REGISTRY;

  // The authored-content badge (same look as before; style set through CSSOM).
  const makeBadge = () => {
    const b = mk('div', 'cms-authored-badge', 'Content managed in Admin CMS');
    b.style.cssText = 'font-size:0.68rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--te-orange);margin-bottom:0.75rem;';
    return b;
  };

  // Only pages that opt in render; on admin/other pages we just expose the registry.
  const slug = document.body && document.body.getAttribute('data-cms-page');
  if (!slug) return;

  function renderPageContent() {
    const lang = localStorage.getItem('employeeLanguage') || 'en';
    const L = makeL(lang);
    fetch('/api/pages?slug=' + encodeURIComponent(slug))
      .then(r => r.json())
      .then(page => {
        if (!page || page.published === false) return;
        const region = document.querySelector('[data-cms-region="' + slug + '"]') || document.querySelector('[data-cms-region]');
        if (!region) return;

        // Fail closed: without the shared renderer, never fall back to a
        // string path — keep the static markup (PD-28 guarantees it loads first).
        if (!window.MASafeHtml) { console.error('page-layout: MASafeHtml missing — CMS content not rendered'); return; }
        const setRegion = (node) => { if (region.replaceChildren) region.replaceChildren(node); else { while (region.firstChild) region.removeChild(region.firstChild); region.appendChild(node); } };

        // 1) Block layout (each block wrapped in try/catch so one bad block can't blank the page)
        if (Array.isArray(page.layout) && page.layout.length) {
          const blocks = [];
          page.layout.slice()
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .filter(b => b.visible !== false)
            .forEach(b => {
              const t = REGISTRY[b.type];
              if (!t) return;
              try {
                const blockEl = mk('div', 'pl-block pl-block-' + b.type);
                blockEl.appendChild(t.render(b.data || {}, L));
                blocks.push(blockEl);
              } catch (e) { console.error('block render failed', b.type, e); }
            });
          if (blocks.length) {
            const layoutEl = mk('div', 'cms-authored cms-layout');
            layoutEl.setAttribute('data-cms-layout', '1');
            layoutEl.style.cssText = 'max-width:900px;margin:0 auto;';
            layoutEl.appendChild(makeBadge());
            blocks.forEach(bl => layoutEl.appendChild(bl));
            setRegion(layoutEl);
            return;
          }
        }

        // 2) Legacy single-body CMS content
        const body = page.body && (page.body[lang] || page.body.en);
        if (body && String(body).trim()) {
          const legacyEl = mk('div', 'cms-authored');
          legacyEl.style.cssText = 'max-width:820px;margin:0 auto;';
          // Render the sanitized body straight into the wrapper (same flat DOM as
          // before: badge + body siblings), then put the badge first.
          window.MASafeHtml.render(legacyEl, str(body));
          legacyEl.insertBefore(makeBadge(), legacyEl.firstChild);
          setRegion(legacyEl);
        }
        // 3) else keep the original static markup
      })
      .catch(function () { /* keep static content on error */ });
  }

  renderPageContent();
  // Re-render on live language switch so authored blocks localize too.
  window.addEventListener('portalLanguageChanged', renderPageContent);
})();
