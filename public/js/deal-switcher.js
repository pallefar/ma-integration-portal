// D-04: the header deal switcher + minimal create-deal modal — deliberately
// visually distinct from the demo Projects/Custom-M&A switcher
// (#demo-mode-switcher-container in admin.html/pmo.html) so the two modes
// can never be confused at a glance (03-CONTEXT.md "## Specific Ideas").
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

  // --- Create-deal modal (D-04's "minimal create-deal form"), shared by the
  // header switcher's own affordance and the admin console's Deals tab. ---
  function openCreateDealForm(onCreated) {
    const existing = document.getElementById('deal-create-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'deal-create-overlay';
    overlay.className = 'deal-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'deal-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const title = document.createElement('h3');
    title.className = 'deal-modal-title';
    title.textContent = 'New real deal';
    modal.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'deal-modal-sub';
    sub.textContent = 'Creates an isolated workspace, separate from the demo showcase.';
    modal.appendChild(sub);

    const form = document.createElement('form');
    form.className = 'deal-modal-form';

    const nameField = document.createElement('label');
    nameField.className = 'deal-modal-field';
    const nameLabel = document.createElement('span');
    nameLabel.textContent = 'Deal name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.required = true;
    nameInput.maxLength = 200;
    nameInput.placeholder = 'e.g. Project Alpha';
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);

    const targetField = document.createElement('label');
    targetField.className = 'deal-modal-field';
    const targetLabel = document.createElement('span');
    targetLabel.textContent = 'Target company';
    const targetInput = document.createElement('input');
    targetInput.type = 'text';
    targetInput.required = true;
    targetInput.maxLength = 200;
    targetInput.placeholder = 'e.g. NextGen Sensors Ltd.';
    targetField.appendChild(targetLabel);
    targetField.appendChild(targetInput);

    const membersField = document.createElement('label');
    membersField.className = 'deal-modal-field';
    const membersLabel = document.createElement('span');
    membersLabel.textContent = 'Members (comma-separated usernames)';
    const membersInput = document.createElement('input');
    membersInput.type = 'text';
    membersInput.placeholder = 'karen, pmo';
    membersField.appendChild(membersLabel);
    membersField.appendChild(membersInput);

    const errorEl = document.createElement('p');
    errorEl.className = 'deal-modal-error';
    errorEl.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'deal-modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = 'Create deal';
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);

    form.appendChild(nameField);
    form.appendChild(targetField);
    form.appendChild(membersField);
    form.appendChild(errorEl);
    form.appendChild(actions);
    modal.appendChild(form);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      const members = membersInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.value, targetCompany: targetInput.value, members }),
      }).then((res) => res.json().then((body) => ({ ok: res.ok, body })))
        .then(({ ok, body }) => {
          if (!ok) {
            errorEl.textContent = body.error || 'Failed to create deal.';
            errorEl.style.display = '';
            submitBtn.disabled = false;
            return;
          }
          close();
          if (typeof onCreated === 'function') onCreated(body.deal);
          renderDealSwitcher();
        })
        .catch(() => {
          errorEl.textContent = 'Network error — please try again.';
          errorEl.style.display = '';
          submitBtn.disabled = false;
        });
    });
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
      createItem.addEventListener('click', () => { menu.remove(); openCreateDealForm(); });
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

      const nameLabel = document.createElement('span');
      nameLabel.className = 'deal-switcher-name';
      nameLabel.textContent = currentDeal ? currentDeal.name : 'Demo showcase';
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
  window.openCreateDealForm = openCreateDealForm;

  renderDealSwitcher();
})();
