/**
 * TE Connectivity M&A Portal — page-cms.js (Phase 5)
 * If a page has a published CMS body for the current language, render it into the
 * page's CMS region. Falls back to the original static markup when unpublished/empty.
 * Opt-in per page via <body data-cms-page="slug"> and an element with [data-cms-region].
 *
 * [security] SAFE-01 / D-13-02 (13-09): the stored page body is rendered by
 * MASafeHtml (public/js/safe-html.js: DOMParser into an inert document, then a
 * node-by-node rebuild from the parity-tested allowlist). The wrapper and badge
 * are built with createElement/textContent; no HTML string is ever assigned to
 * innerHTML. If the renderer is missing the static markup is kept (fail closed).
 */
(function () {
  const slug = document.body && document.body.getAttribute('data-cms-page');
  if (!slug) return;
  const lang = localStorage.getItem('employeeLanguage') || 'en';
  fetch('/api/pages?slug=' + encodeURIComponent(slug))
    .then(r => r.json())
    .then(page => {
      if (!page || page.published === false) return;
      const body = page.body && (page.body[lang] || page.body.en);
      if (!body || !body.trim()) return;
      const region = document.querySelector('[data-cms-region="' + slug + '"]') || document.querySelector('[data-cms-region]');
      if (!region) return;
      if (!window.MASafeHtml || typeof window.MASafeHtml.toFragment !== 'function') {
        console.error('page-cms: MASafeHtml missing - CMS page body not rendered');
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'cms-authored';
      wrap.style.cssText = 'max-width:820px;margin:0 auto;';
      const badge = document.createElement('div');
      badge.className = 'cms-authored-badge';
      badge.style.cssText = 'font-size:0.68rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--te-orange);margin-bottom:0.75rem;';
      badge.textContent = 'Content managed in Admin CMS';
      wrap.appendChild(badge);
      wrap.appendChild(window.MASafeHtml.toFragment(body));
      region.textContent = '';
      region.appendChild(wrap);
    })
    .catch(function () { /* keep static content on error */ });
})();
