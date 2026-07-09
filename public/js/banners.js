/**
 * TE Connectivity M&A Portal — banners.js
 * Admin-configurable per-page / global notification & alert banners.
 * Loaded app-wide by transitions.js. Fetches /api/banners?slug=<page> (the server
 * filters by active + schedule window + page/global scope), then filters by role and
 * prior dismissal (localStorage), and mounts .page-banner elements at the top of the
 * main content. XSS-safe: title/message are set via textContent, never innerHTML.
 */
(function () {
  if (window.__bannersLoaded) return;
  window.__bannersLoaded = true;

  const LANG_KEY = 'employeeLanguage';
  const getLang = () => localStorage.getItem(LANG_KEY) || 'en';
  const getRole = () => localStorage.getItem('active_demo_role') || 'admin';
  const ICON = { info: 'ℹ️', success: '✅', warning: '⚠️', critical: '⛔' };

  function slugForPage() {
    const attr = document.body.getAttribute('data-cms-page');
    if (attr) return attr;
    let p = location.pathname.replace(/^\/+|\/+$/g, '');
    if (!p || p === 'index.html') return 'home';
    return p.replace(/\.html$/, '');
  }

  function pick(obj, lang) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj[lang] || obj.en || Object.values(obj).find(Boolean) || '';
  }

  function roleOk(b) {
    return !b.roleScope || b.roleScope === 'all' || b.roleScope === getRole();
  }
  function dKey(b) { return 'banner_dismissed_' + b.id + '_r' + (b.rev || 1); }
  function dismissed(b) {
    if (b.dismissible === false) return false;
    try { return localStorage.getItem(dKey(b)) === 'true'; } catch (_) { return false; }
  }

  let cache = null;

  function render(list) {
    const main = document.querySelector('.main-content') || document.querySelector('main');
    if (!main) return;
    main.querySelectorAll('.page-banner').forEach(el => el.remove());
    const lang = getLang();
    // list is priority-desc from the server; insert lowest first so highest ends up on top.
    list.filter(b => roleOk(b) && !dismissed(b)).slice().reverse().forEach(b => {
      const title = pick(b.title, lang);
      const message = pick(b.message, lang);
      if (!title && !message) return;
      const el = document.createElement('div');
      el.className = 'page-banner page-banner--' + (b.type || 'info');
      el.setAttribute('role', (b.type === 'critical' || b.type === 'warning') ? 'alert' : 'status');
      const ic = document.createElement('span');
      ic.className = 'page-banner-icon';
      ic.textContent = ICON[b.type] || ICON.info;
      const body = document.createElement('div');
      body.className = 'page-banner-body';
      if (title) {
        const t = document.createElement('strong');
        t.className = 'page-banner-title';
        t.textContent = title;
        body.appendChild(t);
      }
      if (message) {
        const m = document.createElement('span');
        m.className = 'page-banner-msg';
        m.textContent = message;
        body.appendChild(m);
      }
      el.appendChild(ic);
      el.appendChild(body);
      main.insertBefore(el, main.firstChild);
      if (b.dismissible !== false && typeof window.makeBannerDismissible === 'function') {
        window.makeBannerDismissible(el, dKey(b), 'local');
      }
    });
  }

  function load() {
    const slug = slugForPage();
    if (slug === 'admin') return; // the admin console manages banners; don't show them there
    fetch('/api/banners?slug=' + encodeURIComponent(slug))
      .then(r => r.json())
      .then(list => { cache = Array.isArray(list) ? list : []; render(cache); })
      .catch(() => {});
  }

  // Re-render (in the newly selected language) when the portal language changes.
  document.addEventListener('portalLanguageChanged', () => { if (cache) render(cache); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
