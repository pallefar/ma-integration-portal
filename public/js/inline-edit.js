/**
 * TE Connectivity M&A Portal — inline-edit.js (Phase 6)
 * Click-to-edit on live pages, admin only. Reuses the existing adminEditMode flag +
 * editModeChanged event (toggled from the header "Edit Content" pill or the admin
 * EDIT MODE pill). Two editable surfaces:
 *   1) [data-i18n] / [data-i18n-html] text  -> saved to /api/i18n for the current language.
 *   2) The CMS page body ([data-cms-region]) -> saved to /api/pages (publishes the page).
 * Loaded app-wide (injected once by transitions.js). Self-gates: does nothing unless
 * edit mode is ON and the active demo role is admin.
 *
 * [security] SAFE-01 / D-13-02 (13-09): no HTML string is ever assigned to
 * innerHTML here. Stored markup is rendered by MASafeHtml (public/js/safe-html.js);
 * the edit bar and page wrappers are built with createElement/textContent; a
 * cancelled page edit puts the ORIGINAL nodes back (no serialise/parse round trip).
 * Reading `.innerHTML` to POST an edit is fine - the server sanitizes on write.
 */
(function () {
  if (window.__inlineEditLoaded) return;
  window.__inlineEditLoaded = true;

  const LANG_KEY = 'employeeLanguage';
  const getLang = () => localStorage.getItem(LANG_KEY) || 'en';
  // [security] D-11-02 (Phase 11, plan 11-07): click-to-edit saves through POST
  // /api/i18n and POST /api/pages, both admin-only (ROLE_WRITE_POLICY). The
  // capability comes from the server-computed access map on /api/auth/me
  // (window.maCan, transitions.js) — no role table here. It is true when the page
  // has no map (demo-open: the presenter is always the operator, so the showcase
  // edits exactly as before) and false only when the server said this role may
  // not write configuration/content. Evaluated lazily at every use.
  const isAdmin = () => (typeof window.maCan === 'function' ? window.maCan('configWrite') : true);
  const editOn = () => localStorage.getItem('adminEditMode') === 'true';

  function toast(msg, err) {
    let el = document.getElementById('inline-edit-toast');
    if (!el) { el = document.createElement('div'); el.id = 'inline-edit-toast'; el.className = 'inline-edit-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('err', !!err);
    el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // Small element builder: tag + optional class + optional textContent.
  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Render stored markup into `el` through the allowlist renderer. Without it
  // the value is shown as plain text (fail closed) - never parsed as HTML.
  function setMarkup(el, html) {
    if (window.MASafeHtml && typeof window.MASafeHtml.render === 'function') window.MASafeHtml.render(el, html);
    else el.textContent = html;
  }

  // Matches page-cms.js output so a live save looks identical without a reload.
  function wrapAuthored(html) {
    const wrap = mk('div', 'cms-authored');
    wrap.style.cssText = 'max-width:820px;margin:0 auto;';
    const badge = mk('div', 'cms-authored-badge', 'Content managed in Admin CMS');
    badge.style.cssText = 'font-size:0.68rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--te-orange);margin-bottom:0.75rem;';
    wrap.appendChild(badge);
    if (window.MASafeHtml && typeof window.MASafeHtml.toFragment === 'function') wrap.appendChild(window.MASafeHtml.toFragment(html));
    else wrap.appendChild(document.createTextNode(String(html)));
    return wrap;
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
      if (!commit) { if (isHtml) setMarkup(el, original); else el.textContent = original; return; }
      if (val === original) return;
      fetch('/api/i18n', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: getLang(), key: key, value: val }) })
        .then(r => r.json())
        .then(() => {
          if (typeof window.setPortalI18nEntry === 'function') window.setPortalI18nEntry(getLang(), key, val);
          toast('Saved "' + key + '" (' + getLang().toUpperCase() + ')');
        })
        .catch(() => { toast('Save failed', true); if (isHtml) setMarkup(el, original); else el.textContent = original; });
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
    bar.textContent = '';
    if (!(editOn() && isAdmin() && slug && region)) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    if (!editing) {
      // Pages driven by the block Layout Builder are edited in Admin ▸ Pages, not inline
      // (a single contentEditable blob would fight the block model).
      if (region.querySelector('[data-cms-layout]')) {
        bar.appendChild(mk('span', 'pe-label', '📐 Block layout — edit in Admin ▸ Pages'));
        return;
      }
      bar.appendChild(mk('span', 'pe-label', 'Live page'));
      const editBtn = mk('button', 'pe-edit', '📄 Edit page body');
      editBtn.type = 'button';
      editBtn.addEventListener('click', startPage);
      bar.appendChild(editBtn);
    } else {
      bar.appendChild(mk('span', 'pe-label', 'Editing “' + slug + '” · ' + getLang().toUpperCase()));
      const saveBtn = mk('button', 'pe-save', '💾 Save & publish');
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', () => endPage(true));
      const cancelBtn = mk('button', 'pe-cancel', '✕ Cancel');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', () => endPage(false));
      bar.appendChild(saveBtn);
      bar.appendChild(cancelBtn);
    }
  }

  function startPage() {
    fetch('/api/pages?slug=' + encodeURIComponent(slug)).then(r => r.json()).then(page => {
      // Keep the ORIGINAL nodes (not a serialised copy) so Cancel restores the
      // exact DOM - block-layout attributes and listeners included.
      original = Array.prototype.slice.call(region.childNodes);
      region.__page = page || { slug: slug };
      const lang = getLang();
      const bodyStr = (page && page.body && page.body[lang]) || '';
      const target = mk('div', 'cms-editable-body');
      target.style.cssText = 'max-width:820px;margin:0 auto;';
      if (!bodyStr.trim()) {
        const title = (page && page.title && (page.title[lang] || page.title.en)) || slug;
        target.appendChild(mk('h3', null, String(title)));
        target.appendChild(mk('p', null, 'Start writing this page…'));
      } else {
        setMarkup(target, bodyStr);
      }
      region.textContent = '';
      region.appendChild(target);
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
      region.textContent = '';
      region.appendChild(wrapAuthored(html));   // reflect the published look immediately
    } else if (original != null) {
      region.textContent = '';
      original.forEach(function (node) { region.appendChild(node); });
    }
    original = null;
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

  function init() {
    pageCtx(); refresh();
    // The access map may settle after this first pass: re-evaluate so a stale
    // adminEditMode flag left in localStorage by an earlier admin session never
    // leaves editing switched on for a role without configWrite.
    if (window.maAccessReady && typeof window.maAccessReady.then === 'function') window.maAccessReady.then(refresh);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
