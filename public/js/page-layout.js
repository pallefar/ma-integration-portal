/**
 * TE Connectivity M&A Portal — page-layout.js (Layout Builder)
 * Renders a page's ordered, typed content BLOCKS (page.layout) into its CMS region.
 * Fallback ladder: layout → legacy CMS body → original static markup.
 * Exposes window.PageBlockRegistry so the admin builder shares the same block schema.
 * Opt-in per page via <body data-cms-page="slug"> + an element with [data-cms-region].
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Strip dangerous bits from admin-authored rich HTML (richtext block + legacy
  // body) before innerHTML: script/iframe/object/embed tags, inline on*= handlers,
  // and javascript:/vbscript: schemes. Benign rich markup is preserved. Defence-in-
  // depth alongside the CSP; DOMPurify is the recommended robust upgrade.
  const sanitize = (s) => String(s == null ? '' : s)
    .replace(/<\/?(?:script|iframe|object|embed|form|meta|base|link)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(=\s*["']?\s*)(?:javascript|vbscript)\s*:/gi, '$1');
  // L() resolves an i18n {en,de,..} value (or plain string) for the active language.
  const makeL = (lang) => (v) => (v && typeof v === 'object') ? (v[lang] || v.en || Object.values(v).find(Boolean) || '') : (v || '');

  // ---- Block type registry: schema (fields) + render(data, L) → html ----
  // field.kind: input|textarea|wysiwyg are per-language (i18n); text|lines are plain.
  const REGISTRY = {
    richtext: {
      label: 'Rich text', icon: '📝',
      fields: [{ key: 'html', kind: 'wysiwyg', label: 'Content' }],
      render: (d, L) => `<div class="pl-richtext">${sanitize(L(d.html))}</div>`
    },
    hero: {
      label: 'Hero', icon: '⭐',
      fields: [
        { key: 'title', kind: 'input', label: 'Title' },
        { key: 'subtitle', kind: 'textarea', label: 'Subtitle' },
        { key: 'cta', kind: 'input', label: 'Button text' },
        { key: 'ctaHref', kind: 'text', label: 'Button link' }
      ],
      render: (d, L) => `<div class="pl-hero"><h2>${esc(L(d.title))}</h2>${L(d.subtitle) ? `<p>${esc(L(d.subtitle))}</p>` : ''}${L(d.cta) ? `<a class="btn btn-primary" href="${esc(d.ctaHref || '#')}">${esc(L(d.cta))}</a>` : ''}</div>`
    },
    cards: {
      label: 'Card grid', icon: '🗂️',
      fields: [
        { key: 'heading', kind: 'input', label: 'Section heading' },
        { key: 'items', kind: 'lines', label: 'Cards — one per line: "Title | description | icon"' }
      ],
      render: (d, L) => {
        const items = String(d.items || '').split('\n').map(s => s.trim()).filter(Boolean).map(l => { const p = l.split('|'); return { t: (p[0] || '').trim(), desc: (p[1] || '').trim(), icon: (p[2] || '').trim() }; });
        return `<div class="pl-cards-wrap">${L(d.heading) ? `<h3>${esc(L(d.heading))}</h3>` : ''}<div class="pl-cards">${items.map(i => `<div class="pl-card">${i.icon ? `<div class="pl-card-icon">${esc(i.icon)}</div>` : ''}<h4>${esc(i.t)}</h4>${i.desc ? `<p>${esc(i.desc)}</p>` : ''}</div>`).join('')}</div></div>`;
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
      render: (d, L) => `<div class="pl-cta"><h3>${esc(L(d.heading))}</h3>${L(d.text) ? `<p>${esc(L(d.text))}</p>` : ''}${L(d.button) ? `<a class="btn btn-primary" href="${esc(d.href || '#')}">${esc(L(d.button))}</a>` : ''}</div>`
    }
  };
  window.PageBlockRegistry = REGISTRY;

  const BADGE = '<div class="cms-authored-badge" style="font-size:0.68rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--te-orange);margin-bottom:0.75rem;">Content managed in Admin CMS</div>';

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

        // 1) Block layout (each block wrapped in try/catch so one bad block can't blank the page)
        if (Array.isArray(page.layout) && page.layout.length) {
          const html = page.layout.slice()
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .filter(b => b.visible !== false)
            .map(b => {
              const t = REGISTRY[b.type];
              if (!t) return '';
              try { return '<div class="pl-block pl-block-' + esc(b.type) + '">' + t.render(b.data || {}, L) + '</div>'; }
              catch (e) { console.error('block render failed', b.type, e); return ''; }
            }).join('');
          if (html.trim()) {
            region.innerHTML = '<div class="cms-authored cms-layout" data-cms-layout="1" style="max-width:900px;margin:0 auto;">' + BADGE + html + '</div>';
            return;
          }
        }

        // 2) Legacy single-body CMS content
        const body = page.body && (page.body[lang] || page.body.en);
        if (body && body.trim()) {
          region.innerHTML = '<div class="cms-authored" style="max-width:820px;margin:0 auto;">' + BADGE + sanitize(body) + '</div>';
        }
        // 3) else keep the original static markup
      })
      .catch(function () { /* keep static content on error */ });
  }

  renderPageContent();
  // Re-render on live language switch so authored blocks localize too.
  window.addEventListener('portalLanguageChanged', renderPageContent);
})();
