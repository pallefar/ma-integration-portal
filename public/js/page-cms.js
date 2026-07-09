/**
 * TE Connectivity M&A Portal — page-cms.js (Phase 5)
 * If a page has a published CMS body for the current language, render it into the
 * page's CMS region. Falls back to the original static markup when unpublished/empty.
 * Opt-in per page via <body data-cms-page="slug"> and an element with [data-cms-region].
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
      region.innerHTML =
        '<div class="cms-authored" style="max-width:820px;margin:0 auto;">' +
        '<div class="cms-authored-badge" style="font-size:0.68rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--te-orange);margin-bottom:0.75rem;">Content managed in Admin CMS</div>' +
        body + '</div>';
    })
    .catch(function () { /* keep static content on error */ });
})();
