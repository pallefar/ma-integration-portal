// D-04: the header deal switcher — deliberately visually distinct from the
// demo Projects/Custom-M&A switcher (#demo-mode-switcher-container in
// admin.html/pmo.html) so the two modes can never be confused at a glance
// (03-CONTEXT.md "## Specific Ideas").
//
// WIZ-01 (Phase 4 Plan 07): the create affordance below NAVIGATES to the
// full-page guided setup wizard (/deal-wizard.html) rather than opening a
// modal — that wizard supersedes the Phase-3 minimal create-deal form
// (D-06). This is the ONLY path into deal creation: the admin console's own
// "+ New Deal" button (public/js/admin.js) navigates the same way, so a
// real deal can never come into existence outside the guided flow.
//
// Loaded dynamically, once, app-wide by public/js/transitions.js (the SAME
// pattern that file already uses for inline-edit.js/banners.js — see its
// "Phase 6: load the inline content editor once" comment) — never via a
// static <script> tag on every role page, so this file needs zero edits to
// admin.html/dashboard.html/employee.html/pmo.html individually. Because it
// lives entirely OUTSIDE #demo-sidebar (injected into the .header-tools-
// container/.header-top-row region built by that same bootstrap), it is
// structurally exempt from applyMenuOverrides()'s `sb.querySelectorAll(
// 'a.sidebar-link')` collection pass — mirroring the sidebar-admin-link
// precedent's INTENT (never removed by the menu-override sweep) without
// needing its own exclusion branch, since it was never a candidate for that
// selector in the first place.
//
// Rides the existing window.fetch wrapper (transitions.js) for the
// authRequired/401 -> /login.html redirect — no second fetch wrapper.

(function () {
  if (window.__dealSwitcherLoaded) return;
  window.__dealSwitcherLoaded = true;

  const CREATE_ROLES = new Set(['admin', 'hrbp']); // D-02, mirrors ROLE_WRITE_POLICY's /api/deals entry (client-side convenience only — the server enforces this regardless)

  function findHeaderHost() {
    return document.querySelector('.header-tools-container')
      || document.querySelector('.header-top-row')
      || document.querySelector('.brand-wrapper');
  }

  function surfaceError(message) {
    window.alert(message || 'Something went wrong. Please try again.');
  }

  function selectDeal(dealId) {
    fetch('/api/deals/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId }),
    }).then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { surfaceError(body.error); return; }
        window.location.reload(); // every panel on the page must re-read under the new binding
      })
      .catch(() => surfaceError('Network error — please try again.'));
  }

  function buildMenu(host, currentDealId, deals, canCreate) {
    const existingMenu = document.getElementById('deal-switcher-menu');
    if (existingMenu) { existingMenu.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'deal-switcher-menu';
    menu.className = 'deal-switcher-menu';

    const demoItem = document.createElement('button');
    demoItem.type = 'button';
    demoItem.className = 'deal-switcher-menu-item' + (!currentDealId ? ' active' : '');
    const demoLabel = document.createElement('span');
    demoLabel.textContent = 'Demo showcase';
    demoItem.appendChild(demoLabel);
    demoItem.addEventListener('click', () => selectDeal(null));
    menu.appendChild(demoItem);

    if (deals.length) {
      const divider = document.createElement('div');
      divider.className = 'deal-switcher-menu-divider';
      menu.appendChild(divider);
    }

    deals.forEach((deal) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'deal-switcher-menu-item' + (deal.id === currentDealId ? ' active' : '');
      const nameEl = document.createElement('span');
      nameEl.className = 'deal-switcher-menu-item-name';
      nameEl.textContent = deal.name; // textContent only — deal names are user-controlled/MNPI
      const companyEl = document.createElement('span');
      companyEl.className = 'deal-switcher-menu-item-company';
      companyEl.textContent = deal.targetCompany || '';
      item.appendChild(nameEl);
      item.appendChild(companyEl);
      item.addEventListener('click', () => selectDeal(deal.id));
      menu.appendChild(item);
    });

    if (canCreate) {
      const createDivider = document.createElement('div');
      createDivider.className = 'deal-switcher-menu-divider';
      menu.appendChild(createDivider);
      const createItem = document.createElement('button');
      createItem.type = 'button';
      createItem.className = 'deal-switcher-menu-item deal-switcher-menu-item-create';
      createItem.textContent = '+ New real deal';
      // WIZ-01: navigates to the guided setup wizard rather than opening a
      // modal (D-06) — the wizard is the ONLY path into deal creation.
      createItem.addEventListener('click', () => { menu.remove(); window.location.href = '/deal-wizard.html'; });
      menu.appendChild(createItem);
    }

    host.appendChild(menu);
    const closeOnOutsideClick = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'deal-switcher-trigger') {
        menu.remove();
        document.removeEventListener('click', closeOnOutsideClick);
      }
    };
    // Deferred so the SAME click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 0);
  }

  /** Fetches the caller's deal list + current binding, and renders (or
   * removes) the header control. Safe to call repeatedly (e.g. after
   * creating a deal) — always removes any stale prior instance first. */
  function renderDealSwitcher() {
    const existing = document.getElementById('deal-switcher-container');
    if (existing) existing.remove();
    const staleMenu = document.getElementById('deal-switcher-menu');
    if (staleMenu) staleMenu.remove();

    Promise.all([
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : { user: null })),
      fetch('/api/deals').then((r) => (r.ok ? r.json() : [])),
    ]).then(([me, deals]) => {
      const user = me && me.user;
      if (!user) return; // no session (e.g. DEMO_OPEN anonymous demo) — nothing to switch
      const canCreate = CREATE_ROLES.has(user.role);
      if (!Array.isArray(deals)) deals = [];
      if (!deals.length && !canCreate) return; // an employee/pmo with zero deals sees no new chrome

      const host = findHeaderHost();
      if (!host) return;

      const currentDealId = me.dealId || null;
      const currentDeal = currentDealId ? deals.find((d) => d.id === currentDealId) : null;

      const container = document.createElement('div');
      container.id = 'deal-switcher-container';
      container.className = 'deal-switcher ' + (currentDealId ? 'deal-switcher--real' : 'deal-switcher--demo');

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.id = 'deal-switcher-trigger';
      trigger.className = 'deal-switcher-trigger';

      const stateLabel = document.createElement('span');
      stateLabel.className = 'deal-switcher-state';
      stateLabel.textContent = currentDealId ? 'Real deal' : 'Demo';
      trigger.appendChild(stateLabel);

      // IN-01: currentDealId can be truthy while currentDeal is undefined —
      // the session's server-side binding points at a deal that is archived
      // (excluded from listDealsForUser()'s active-only filter) or one the
      // caller lost membership to since their last page load. Falling back
      // to 'Demo showcase' in that case produced a self-contradictory
      // "Real deal / Demo showcase" chip; a neutral "deal no longer
      // available" label keeps the "Real deal" state badge honest instead.
      // Purely cosmetic — the server independently re-enforces membership on
      // every actual API call (db/resolver.js).
      const nameLabel = document.createElement('span');
      nameLabel.className = 'deal-switcher-name';
      nameLabel.textContent = currentDeal ? currentDeal.name : (currentDealId ? 'Deal no longer available' : 'Demo showcase');
      trigger.appendChild(nameLabel);

      const chevron = document.createElement('span');
      chevron.className = 'deal-switcher-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '▾';
      trigger.appendChild(chevron);

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        buildMenu(container, currentDealId, deals, canCreate);
      });

      container.appendChild(trigger);
      host.appendChild(container);
    }).catch(() => { /* best-effort — a failed fetch here must never break page load */ });
  }

  window.renderDealSwitcher = renderDealSwitcher;

  renderDealSwitcher();
})();
