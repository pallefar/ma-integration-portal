/**
 * TE Connectivity M&A Portal — inline-edit.js (Phase 6)
 * Click-to-edit on live pages, admin only. Reuses the existing adminEditMode flag +
 * editModeChanged event (toggled from the header "Edit Content" pill or the admin
 * EDIT MODE pill). Two editable surfaces:
 *   1) [data-i18n] / [data-i18n-html] text  -> saved to /api/i18n for the current language.
 *   2) The CMS page body ([data-cms-region]) -> saved to /api/pages (publishes the page).
 * Loaded app-wide (injected once by transitions.js). Self-gates: does nothing unless
 * edit mode is ON and the active demo role is admin.
 */
(function () {
  if (window.__inlineEditLoaded) return;
  window.__inlineEditLoaded = true;

  const LANG_KEY = 'employeeLanguage';
  const getLang = () => localStorage.getItem(LANG_KEY) || 'en';
  // Open-access demo: the operator/presenter is always the admin regardless of which
  // persona view is on screen, so editing is gated purely on the edit-mode flag.
  const isAdmin = () => true;
  const editOn = () => localStorage.getItem('adminEditMode') === 'true';

  function toast(msg, err) {
    let el = document.getElementById('inline-edit-toast');
    if (!el) { el = document.createElement('div'); el.id = 'inline-edit-toast'; el.className = 'inline-edit-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('err', !!err);
    el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // Matches page-cms.js output so a live save looks identical without a reload.
  function wrapAuthored(html) {
    return '<div class="cms-authored" style="max-width:820px;margin:0 auto;">' +
      '<div class="cms-authored-badge" style="font-size:0.68rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--te-orange);margin-bottom:0.75rem;">Content managed in Admin CMS</div>' +
      html + '</div>';
  }

  // ---------- i18n inline text editing ----------
  function editI18n(el) {
    const isHtml = el.hasAttribute('data-i18n-html');
    const key = el.getAttribute('data-i18n') || el.getAttribute('data-i18n-html');
    if (!key) return;
    const original = isHtml ? el.innerHTML : el.textContent;
    el.contentEditable = 'true';
    el.classList.add('cms-editing-active');
    el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.contentEditable = 'false';
      el.classList.remove('cms-editing-active');
      const val = isHtml ? el.innerHTML : el.textContent;
      if (!commit) { if (isHtml) el.innerHTML = original; else el.textContent = original; return; }
      if (val === original) return;
      fetch('/api/i18n', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: getLang(), key: key, value: val }) })
        .then(r => r.json())
        .then(() => {
          if (typeof window.setPortalI18nEntry === 'function') window.setPortalI18nEntry(getLang(), key, val);
          toast('Saved "' + key + '" (' + getLang().toUpperCase() + ')');
        })
        .catch(() => { toast('Save failed', true); if (isHtml) el.innerHTML = original; else el.textContent = original; });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); el.blur(); }
      else if (e.key === 'Enter' && !e.shiftKey && !isHtml) { e.preventDefault(); finish(true); el.blur(); }
    };
    const onBlur = () => finish(true);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  }

  // Delegated (capture phase) so it preempts links/card handlers and catches
  // dynamically-rendered [data-i18n] elements too.
  document.addEventListener('click', (e) => {
    if (!editOn() || !isAdmin()) return;
    const el = e.target.closest && e.target.closest('[data-i18n], [data-i18n-html]');
    if (!el || el.isContentEditable) return;
    if (el.matches('input, select, textarea')) return;
    e.preventDefault(); e.stopPropagation();
    editI18n(el);
  }, true);

  // ---------- CMS page body editing ----------
  let bar = null, editing = false, original = null, region = null, slug = null;

  function pageCtx() {
    slug = document.body.getAttribute('data-cms-page');
    if (!slug) { region = null; return false; }
    region = document.querySelector('[data-cms-region="' + slug + '"]');
    return !!region;
  }

  function renderBar() {
    if (!bar) { bar = document.createElement('div'); bar.className = 'cms-page-editbar'; bar.style.display = 'none'; document.body.appendChild(bar); }
    if (!(editOn() && isAdmin() && slug && region)) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    if (!editing) {
      // Pages driven by the block Layout Builder are edited in Admin ▸ Pages, not inline
      // (a single contentEditable blob would fight the block model).
      if (region.querySelector('[data-cms-layout]')) {
        bar.innerHTML = '<span class="pe-label">📐 Block layout — edit in Admin ▸ Pages</span>';
        return;
      }
      bar.innerHTML = '<span class="pe-label">Live page</span><button type="button" class="pe-edit">📄 Edit page body</button>';
      bar.querySelector('.pe-edit').addEventListener('click', startPage);
    } else {
      bar.innerHTML = '<span class="pe-label">Editing “' + slug + '” · ' + getLang().toUpperCase() + '</span>' +
        '<button type="button" class="pe-save">💾 Save &amp; publish</button>' +
        '<button type="button" class="pe-cancel">✕ Cancel</button>';
      bar.querySelector('.pe-save').addEventListener('click', () => endPage(true));
      bar.querySelector('.pe-cancel').addEventListener('click', () => endPage(false));
    }
  }

  function startPage() {
    fetch('/api/pages?slug=' + encodeURIComponent(slug)).then(r => r.json()).then(page => {
      original = region.innerHTML;
      region.__page = page || { slug: slug };
      const lang = getLang();
      let bodyStr = (page && page.body && page.body[lang]) || '';
      if (!bodyStr.trim()) {
        const title = (page && page.title && (page.title[lang] || page.title.en)) || slug;
        bodyStr = '<h3>' + title + '</h3><p>Start writing this page…</p>';
      }
      region.innerHTML = '<div class="cms-editable-body" style="max-width:820px;margin:0 auto;">' + bodyStr + '</div>';
      const target = region.querySelector('.cms-editable-body');
      region.__target = target;
      editing = true;
      target.contentEditable = 'true';
      target.classList.add('cms-editing-active');
      target.focus();
      renderBar();
    }).catch(() => toast('Could not load page', true));
  }

  function endPage(commit) {
    const target = region && region.__target;
    const html = target ? target.innerHTML : '';
    if (target) { target.contentEditable = 'false'; target.classList.remove('cms-editing-active'); }
    editing = false;
    if (commit && target) {
      const page = region.__page || { slug: slug };
      const merged = Object.assign({ en: '', de: '', zh: '', cs: '' }, page.body || {});
      merged[getLang()] = html;
      fetch('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: page.id, slug: slug, body: merged, published: true }) })
        .then(r => r.json())
        .then(() => toast('Page saved & published (' + getLang().toUpperCase() + ')'))
        .catch(() => toast('Save failed', true));
      region.innerHTML = wrapAuthored(html);   // reflect the published look immediately
    } else if (original != null) {
      region.innerHTML = original;
    }
    renderBar();
  }

  // ---------- activation ----------
  function refresh() {
    const on = editOn() && isAdmin();
    document.body.classList.toggle('cms-inline-on', on);
    if (!on && editing) endPage(false);
    renderBar();
  }
  window.cmsInlineRefresh = refresh;

  document.addEventListener('editModeChanged', refresh);
  // Editing is per-language; if the operator switches language mid-edit, drop the edit.
  document.addEventListener('portalLanguageChanged', () => { if (editing) endPage(false); renderBar(); });

  function init() { pageCtx(); refresh(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
