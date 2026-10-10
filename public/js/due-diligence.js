/**
 * Due Diligence workspace (DD-01/DD-04) — renders exactly the functional
 * areas the server returned for the signed-in caller (GET /api/dd/areas),
 * then each returned area's own request items (GET /api/dd/request-items).
 * Every item's status/owner/due-date/blocked flag is editable inline,
 * PATCHing back through POST /api/dd/request-items with the item's id.
 *
 * T-04-06: every user-controlled string (item text, owner, area label) is
 * written with textContent, never assigned as markup — DD content is MNPI
 * and this page must never become a stored-XSS vector for it.
 *
 * T-04-01: the page holds NO client-side list of all eight DD_AREAS to draw
 * placeholders from — an uncleared area must never be visible here, not even
 * as a greyed-out or locked row. It renders only the areas GET /api/dd/areas
 * actually returned.
 *
 * D-15: `overdue` is a value the SERVER attaches to every item response —
 * this page never recomputes it client-side, only reads item.overdue.
 */
(function () {
  'use strict';

  var STATUSES = ['open', 'requested', 'received', 'reviewed', 'closed'];
  var STATUS_LABELS = { open: 'Open', requested: 'Requested', received: 'Received', reviewed: 'Reviewed', closed: 'Closed' };

  // DD-02/DD-03: findings register + one-click conversion.
  var SEVERITIES = ['low', 'medium', 'high', 'critical'];
  var SEVERITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

  // DD-05/D-17/D-18: data-room reference editor + area aggregate + the
  // audited access-grant form. `role`/`dealId` are populated from
  // GET /api/auth/me before the first render (see the DOMContentLoaded
  // handler at the bottom of this file) — the grant form is visible only to
  // admin/hrbp (the same audience D-02 gives area grants to).
  var state = {
    areas: [], itemsByArea: {}, checklistStatus: '', findingsByArea: {},
    vdrLinksByArea: {}, role: '', dealId: null, vdrGrantStatus: '',
  };

  function el(tag, opts) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    return node;
  }

  function load() {
    return fetch('/api/dd/areas').then(function (r) { return r.json(); }).then(function (areas) {
      state.areas = Array.isArray(areas) ? areas : [];
      var perArea = state.areas.map(function (a) {
        return fetch('/api/dd/request-items?area=' + encodeURIComponent(a.id))
          .then(function (r) { return r.json(); })
          .then(function (items) { state.itemsByArea[a.id] = Array.isArray(items) ? items : []; })
          .then(function () {
            return fetch('/api/dd/findings?area=' + encodeURIComponent(a.id))
              .then(function (r) { return r.json(); })
              .then(function (findings) { state.findingsByArea[a.id] = Array.isArray(findings) ? findings : []; });
          });
      });
      // D-17: ONE aggregate fetch, not per-area — GET /api/dd/vdr-links
      // already groups server-side by cleared area.
      var vdrAgg = fetch('/api/dd/vdr-links').then(function (r) { return r.json(); }).then(function (agg) {
        state.vdrLinksByArea = {};
        (agg && agg.areas ? agg.areas : []).forEach(function (a) { state.vdrLinksByArea[a.area] = a.links || []; });
      });
      return Promise.all(perArea.concat([vdrAgg]));
    });
  }

  function refresh() { return load().then(render); }

  function totalItemCount() {
    return Object.keys(state.itemsByArea).reduce(function (sum, key) {
      return sum + state.itemsByArea[key].length;
    }, 0);
  }

  // D-13: "Load standard checklist" — GET the seeded template(s), instantiate
  // the first one, then re-render. `created`/`skipped` are surfaced as a
  // short textContent-only status line; the skipped count is worded as
  // "outside your clearance" and NEVER names or lists an uncleared area —
  // naming one would leak exactly what the server-side filter hides (the
  // same anti-enumeration property test/dd-workspace.test.js's uniform-403
  // assertion locks in for the by-id case).
  function loadStandardChecklist() {
    return fetch('/api/dd/request-templates').then(function (r) { return r.json(); }).then(function (templates) {
      var tpl = Array.isArray(templates) && templates.length ? templates[0] : null;
      if (!tpl) {
        state.checklistStatus = 'No standard checklist template is available for this deal.';
        return render();
      }
      return fetch('/api/dd/request-items/instantiate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: tpl.id })
      }).then(function (r) { return r.json(); }).then(function (result) {
        var created = (result && typeof result.created === 'number') ? result.created : 0;
        var skipped = (result && typeof result.skipped === 'number') ? result.skipped : 0;
        var msg = 'Loaded ' + created + ' request item' + (created === 1 ? '' : 's') + ' from the standard checklist.';
        if (skipped) msg += ' ' + skipped + ' item' + (skipped === 1 ? '' : 's') + ' outside your clearance were not created.';
        state.checklistStatus = msg;
        return refresh();
      });
    });
  }

  // CONC-02 (Phase 9, Plan 04): `item` is the in-memory record this row was
  // rendered from (state.itemsByArea, populated by the most recent load()/
  // refresh() — never a re-fetch), so `item.version` is exactly the version
  // this user's edit form was built against. ALWAYS sent (09-12 / GD-1):
  // window.maVersionOf() yields 0 for a never-yet-edited item (D-09 — a
  // version-less record IS version 0), so even a first-ever edit carries a
  // precondition. Omission is no longer an exemption: the strict server
  // refuses an absent version in a real deal. The unconditional
  // `.then(refresh)` below is correct because the shared fetch wrapper holds
  // this promise while the conflict dialog is open (09-11) — refresh() runs
  // only after the dialog has closed, never underneath it.
  function updateItem(item, patch) {
    var body = Object.assign({ id: item.id }, patch);
    body.version = window.maVersionOf(item);
    return fetch('/api/dd/request-items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(refresh);
  }

  function renderItem(item) {
    var row = el('div', { className: 'dd-item' + (item.overdue ? ' dd-item--overdue' : '') });
    var main = el('div', { className: 'dd-item-main' });
    main.appendChild(el('div', { className: 'dd-item-text', text: item.text }));

    var controls = el('div', { className: 'dd-item-meta' });

    var statusSel = document.createElement('select');
    STATUSES.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s;
      opt.textContent = STATUS_LABELS[s] || s;
      if (item.status === s) opt.selected = true;
      statusSel.appendChild(opt);
    });
    statusSel.addEventListener('change', function () { updateItem(item, { status: statusSel.value }); });
    controls.appendChild(statusSel);

    var dueInput = document.createElement('input');
    dueInput.type = 'date';
    dueInput.value = item.dueDate || '';
    dueInput.addEventListener('change', function () { updateItem(item, { dueDate: dueInput.value }); });
    controls.appendChild(dueInput);

    var ownerInput = document.createElement('input');
    ownerInput.type = 'text';
    ownerInput.placeholder = 'Owner';
    ownerInput.value = item.owner || '';
    ownerInput.addEventListener('change', function () { updateItem(item, { owner: ownerInput.value }); });
    controls.appendChild(ownerInput);

    var blockedLabel = el('label');
    var blockedCheckbox = document.createElement('input');
    blockedCheckbox.type = 'checkbox';
    blockedCheckbox.checked = !!item.blocked;
    blockedCheckbox.addEventListener('change', function () { updateItem(item, { blocked: blockedCheckbox.checked }); });
    blockedLabel.appendChild(blockedCheckbox);
    blockedLabel.appendChild(document.createTextNode(' Blocked'));
    controls.appendChild(blockedLabel);

    main.appendChild(controls);
    main.appendChild(renderVdrLinkEditor(item));
    row.appendChild(main);
    return row;
  }

  // DD-05/D-17: `vdrLink` is set/cleared through the SAME upsert route every
  // other item field already uses — never a second route. An explicit
  // `vdrLink: null` clears it. CONC-02 (Phase 9, Plan 04): `item` is the
  // in-memory record renderVdrLinkEditor() was called with — the same
  // record the rest of this row's edit controls thread version from.
  function updateVdrLink(item, vdrLink) {
    var body = { id: item.id, vdrLink: vdrLink, version: window.maVersionOf(item) };
    return fetch('/api/dd/request-items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(refresh);
  }

  // T-04-27: re-checks the URL scheme at RENDER time — never trusts a stored
  // value blindly — following public/js/transitions.js's openHtmlSlide
  // scheme-guard precedent (a stored value could predate a validation
  // change). Returns null (render as inert text) for anything not http(s).
  function safeVdrUrl(url) {
    try {
      var u = new URL(url, window.location.origin);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch (e) { /* fall through to null */ }
    return null;
  }

  function renderVdrLinkEditor(item) {
    var wrap = el('div', { className: 'dd-vdr-editor' });
    var link = item.vdrLink;
    if (link) {
      var current = el('div', { className: 'dd-vdr-current' });
      var safe = safeVdrUrl(link.url);
      if (safe) {
        var a = document.createElement('a');
        a.href = safe;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = link.label || link.folderRef || link.url;
        current.appendChild(a);
      } else {
        // Renders as inert text — the stored scheme failed the render-time
        // re-check, so it must never become a live link (T-04-27).
        current.appendChild(el('span', { text: link.label || link.folderRef || link.url }));
      }
      current.appendChild(el('span', { className: 'dd-vdr-folder', text: ' (' + link.folderRef + ')' }));
      var clearBtn = el('button', { className: 'btn btn-tertiary', text: 'Clear' });
      clearBtn.type = 'button';
      clearBtn.addEventListener('click', function () { updateVdrLink(item, null); });
      current.appendChild(clearBtn);
      wrap.appendChild(current);
    } else {
      var urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.placeholder = 'Data room URL (https://…)';
      var folderInput = document.createElement('input');
      folderInput.type = 'text';
      folderInput.placeholder = 'Folder / index reference';
      var labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.placeholder = 'Label (optional)';
      var saveBtn = el('button', { className: 'btn btn-tertiary', text: 'Save data room link' });
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', function () {
        var url = urlInput.value.trim();
        var folderRef = folderInput.value.trim();
        if (!url || !folderRef) return;
        updateVdrLink(item, { url: url, folderRef: folderRef, label: labelInput.value.trim() });
      });
      wrap.appendChild(urlInput);
      wrap.appendChild(folderInput);
      wrap.appendChild(labelInput);
      wrap.appendChild(saveBtn);
    }
    return wrap;
  }

  // CONC-02 (Phase 9, Plan 04): `finding` is the in-memory record this row
  // was rendered from (state.findingsByArea, populated by the most recent
  // load()/refresh() — never a re-fetch), mirroring updateItem()'s identical
  // rationale above.
  function updateFinding(finding, patch) {
    var body = Object.assign({ id: finding.id }, patch);
    body.version = window.maVersionOf(finding); // always sent; 0 when never edited (GD-1)
    return fetch('/api/dd/findings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(refresh);
  }

  // DD-03/D-12: one-click conversion. After a successful conversion, refresh()
  // re-renders the finding with its linked ids as short read-only labels and
  // the corresponding button disabled — a repeat click on an already-disabled
  // button is impossible from the UI, and the server itself treats a repeat
  // POST as a dedup no-op regardless. CONC-02 (Phase 9, Plan 04): this route
  // mutates the finding's own link arrays, so it carries the same version
  // precondition as updateFinding() above — threaded from the SAME
  // in-memory `finding` record this button was rendered from.
  function convertFinding(finding, toTask, toRaid) {
    var body = { toTask: toTask, toRaid: toRaid, version: window.maVersionOf(finding) }; // always sent (GD-1)
    return fetch('/api/dd/findings/' + encodeURIComponent(finding.id) + '/convert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(refresh);
  }

  function renderFinding(finding) {
    var row = el('div', { className: 'dd-finding' });
    var main = el('div', { className: 'dd-finding-main' });
    main.appendChild(el('div', { className: 'dd-finding-title', text: finding.title }));

    var meta = el('div', { className: 'dd-finding-meta' });

    var sevSel = document.createElement('select');
    SEVERITIES.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s;
      opt.textContent = SEVERITY_LABELS[s] || s;
      if (finding.severity === s) opt.selected = true;
      sevSel.appendChild(opt);
    });
    sevSel.addEventListener('change', function () { updateFinding(finding, { severity: sevSel.value }); });
    meta.appendChild(sevSel);

    var ownerInput = document.createElement('input');
    ownerInput.type = 'text';
    ownerInput.placeholder = 'Owner';
    ownerInput.value = finding.owner || '';
    ownerInput.addEventListener('change', function () { updateFinding(finding, { owner: ownerInput.value }); });
    meta.appendChild(ownerInput);

    var statusSel = document.createElement('select');
    ['open', 'mitigating', 'closed'].forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
      if (finding.status === s) opt.selected = true;
      statusSel.appendChild(opt);
    });
    statusSel.addEventListener('change', function () { updateFinding(finding, { status: statusSel.value }); });
    meta.appendChild(statusSel);

    main.appendChild(meta);
    row.appendChild(main);

    var hasTask = !!(finding.linkedTaskIds && finding.linkedTaskIds.length);
    var hasRaid = !!(finding.linkedRaidIds && finding.linkedRaidIds.length);

    var convertRow = el('div', { className: 'dd-finding-convert' });

    var taskBtn = el('button', { className: 'btn btn-secondary', text: 'Create Day-1 task' });
    taskBtn.type = 'button';
    taskBtn.disabled = hasTask;
    taskBtn.addEventListener('click', function () { convertFinding(finding, true, false); });
    convertRow.appendChild(taskBtn);

    var raidBtn = el('button', { className: 'btn btn-secondary', text: 'Create RAID entry' });
    raidBtn.type = 'button';
    raidBtn.disabled = hasRaid;
    raidBtn.addEventListener('click', function () { convertFinding(finding, false, true); });
    convertRow.appendChild(raidBtn);

    if (hasTask) {
      (finding.linkedTaskIds || []).forEach(function (id) {
        convertRow.appendChild(el('span', { className: 'dd-finding-linked', text: 'Task created' }));
      });
    }
    if (hasRaid) {
      (finding.linkedRaidIds || []).forEach(function (id) {
        convertRow.appendChild(el('span', { className: 'dd-finding-linked', text: 'RAID entry created' }));
      });
    }

    // T-04-21, CLOSED by D-17 (06-06 Task 2): conversion copies title+notes
    // into the shared RAID/task lanes, which were previously unfiltered for
    // every deal member. GET /api/raid now gates each converted entry on
    // the originating finding's own functional area (server.js's
    // resolveRaidEntryClearanceArea()), so this note still renders for
    // every row — converted or not, so the operator makes an informed call
    // — but its wording must state the TRUE, now-restricted audience rather
    // than the pre-filter claim of an unrestricted, deal-wide audience.
    convertRow.appendChild(el('span', {
      className: 'dd-finding-convert-note',
      text: 'Creates a linked Day-1 task and/or RAID entry, visible only to members cleared for this area.',
    }));

    row.appendChild(convertRow);
    return row;
  }

  function renderFindingAddForm(area) {
    var form = el('div', { className: 'dd-finding-add' });
    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Finding title…';
    form.appendChild(titleInput);
    var addBtn = el('button', { className: 'btn btn-primary', text: 'Add finding' });
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () {
      var title = titleInput.value.trim();
      if (!title) return;
      fetch('/api/dd/findings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area: area.id, title: title })
      }).then(function () { titleInput.value = ''; return refresh(); });
    });
    form.appendChild(addBtn);
    return form;
  }

  function renderAddForm(area) {
    var form = el('div', { className: 'dd-add' });
    var textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.placeholder = 'Request item text…';
    form.appendChild(textInput);
    var addBtn = el('button', { className: 'btn btn-primary', text: 'Add' });
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () {
      var text = textInput.value.trim();
      if (!text) return;
      fetch('/api/dd/request-items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area: area.id, text: text })
      }).then(function () { textInput.value = ''; return refresh(); });
    });
    form.appendChild(addBtn);
    return form;
  }

  // D-17: the per-area aggregate of every item's data-room reference, from
  // the SAME GET /api/dd/vdr-links response load() already fetched once —
  // this function only reads state.vdrLinksByArea, it never re-fetches.
  function renderVdrLinksList(area) {
    var section = el('div', { className: 'dd-vdr-list' });
    section.appendChild(el('h3', { className: 'dd-vdr-list-title', text: 'Data room references' }));
    var links = state.vdrLinksByArea[area.id] || [];
    if (!links.length) {
      section.appendChild(el('div', { className: 'dd-empty', text: 'No data room references yet.' }));
      return section;
    }
    links.forEach(function (link) {
      var row = el('div', { className: 'dd-vdr-row' });
      var safe = safeVdrUrl(link.url);
      if (safe) {
        var a = document.createElement('a');
        a.href = safe;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = link.label || link.folderRef;
        row.appendChild(a);
      } else {
        row.appendChild(el('span', { text: link.label || link.folderRef }));
      }
      row.appendChild(el('span', { className: 'dd-vdr-folder', text: ' — ' + link.folderRef }));
      row.appendChild(el('span', { className: 'dd-vdr-item', text: ' (' + link.text + ')' }));
      section.appendChild(row);
    });
    return section;
  }

  // D-18: the workspace-header access-grant form. Visible only to admin/hrbp
  // (the same audience D-02 gives area grants to) — every other role never
  // even sees the container populated. The confirmation line deliberately
  // says the grant was RECORDED IN THE AUDIT LOG, not that access has been
  // PROVISIONED — this app records the decision; the data room itself grants
  // the access.
  function recordVdrGrant(username, vdrRef, note) {
    if (!state.dealId) {
      state.vdrGrantStatus = 'No active deal is selected.';
      return render();
    }
    return fetch('/api/deals/' + encodeURIComponent(state.dealId) + '/vdr-grants', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, vdrRef: vdrRef, note: note })
    }).then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (result) {
        state.vdrGrantStatus = result.ok
          ? 'Recorded in the audit log: ' + username + ' granted access to ' + vdrRef + '.'
          : ((result.body && result.body.error) || 'Failed to record the grant.');
        render();
      });
  }

  function renderVdrGrantForm() {
    var container = document.getElementById('dd-vdr-grant');
    if (!container) return;
    container.textContent = '';
    if (state.role !== 'admin' && state.role !== 'hrbp') return;

    var wrap = el('div', { className: 'dd-vdr-grant' });
    wrap.appendChild(el('h3', { className: 'dd-vdr-grant-title', text: 'Record data-room access grant' }));

    var usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.placeholder = 'Username';
    var vdrRefInput = document.createElement('input');
    vdrRefInput.type = 'text';
    vdrRefInput.placeholder = 'Data room area / folder reference';
    var noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = 'Note (optional)';
    var submitBtn = el('button', { className: 'btn btn-secondary', text: 'Record grant' });
    submitBtn.type = 'button';
    submitBtn.addEventListener('click', function () {
      var username = usernameInput.value.trim();
      var vdrRef = vdrRefInput.value.trim();
      if (!username || !vdrRef) return;
      recordVdrGrant(username, vdrRef, noteInput.value.trim());
    });

    wrap.appendChild(usernameInput);
    wrap.appendChild(vdrRefInput);
    wrap.appendChild(noteInput);
    wrap.appendChild(submitBtn);
    if (state.vdrGrantStatus) {
      wrap.appendChild(el('div', { className: 'dd-vdr-grant-status', text: state.vdrGrantStatus }));
    }
    container.appendChild(wrap);
  }

  function render() {
    renderVdrGrantForm();
    var statusContainer = document.getElementById('dd-checklist-status');
    if (statusContainer) {
      statusContainer.textContent = '';
      // The control appears only while the workspace has zero request items
      // across every cleared area — once any item exists (seeded or
      // manually added), the caller has already started their own list.
      if (totalItemCount() === 0) {
        var loadBtn = el('button', { className: 'btn btn-secondary', text: 'Load standard checklist' });
        loadBtn.type = 'button';
        loadBtn.addEventListener('click', function () { loadStandardChecklist(); });
        statusContainer.appendChild(loadBtn);
      }
      if (state.checklistStatus) {
        statusContainer.appendChild(el('div', { className: 'dd-checklist-status-line', text: state.checklistStatus }));
      }
    }

    var container = document.getElementById('dd-areas');
    container.textContent = '';
    state.areas.forEach(function (area) {
      var section = el('div', { className: 'dd-area' });
      var head = el('div', { className: 'dd-area-head' });
      head.appendChild(el('h2', { className: 'dd-area-title', text: area.label }));
      var items = state.itemsByArea[area.id] || [];
      head.appendChild(el('span', { className: 'dd-area-count', text: items.length + (items.length === 1 ? ' item' : ' items') }));
      section.appendChild(head);
      if (!items.length) {
        section.appendChild(el('div', { className: 'dd-empty', text: 'No request items yet.' }));
      } else {
        items.forEach(function (item) { section.appendChild(renderItem(item)); });
      }
      section.appendChild(renderAddForm(area));

      var findingsSection = el('div', { className: 'dd-findings' });
      findingsSection.appendChild(el('h3', { className: 'dd-findings-title', text: 'Findings' }));
      var findings = state.findingsByArea[area.id] || [];
      if (!findings.length) {
        findingsSection.appendChild(el('div', { className: 'dd-empty', text: 'No findings yet.' }));
      } else {
        findings.forEach(function (finding) { findingsSection.appendChild(renderFinding(finding)); });
      }
      findingsSection.appendChild(renderFindingAddForm(area));
      section.appendChild(findingsSection);

      section.appendChild(renderVdrLinksList(area));

      container.appendChild(section);
    });
  }

  // D-21: the owner nudge — badge + dismissible banner for open/overdue
  // rows assigned to the SIGNED-IN caller, sourced from GET /api/dd/summary's
  // already-clearance-scoped `mine` counts (Task 1). Names counts only —
  // never an area, an item title or another person — because a banner is
  // legible to anyone standing near the screen, not only the signed-in
  // user. Raised through the SAME shared banner mechanism (transitions.js's
  // window.makeBannerDismissible) every other injected banner in this
  // codebase already uses, with its session-scoped (not local-storage)
  // dismissal-key convention — a dismissal does not persist forever, so a
  // still-overdue item is nudged again in a fresh session. In-app only:
  // nothing here sends anything anywhere (D-21).
  function renderOwnerNudge(mine) {
    if (!mine) return;
    var total = (mine.openItems || 0) + (mine.openFindings || 0);
    var overdue = mine.overdueItems || 0;
    if (total <= 0) return;

    var titleEl = document.querySelector('.dd-hero h1');
    if (titleEl && !document.getElementById('dd-nudge-badge')) {
      var badge = document.createElement('span');
      badge.id = 'dd-nudge-badge';
      // Inline styling only (no CSS file touched by this plan) — matches
      // this codebase's existing pattern for a JS-injected badge/pill (see
      // public/js/dashboard.js's readiness-strip band colors).
      badge.style.cssText = 'display:inline-block;margin-left:.6rem;font-size:.68rem;font-weight:800;padding:.15rem .55rem;border-radius:999px;background:#C77700;color:#fff;vertical-align:middle;';
      badge.textContent = String(total);
      titleEl.appendChild(badge);
    }

    if (document.getElementById('dd-nudge-banner')) return;
    try {
      if (sessionStorage.getItem('dd_nudge_dismissed') === 'true') return;
    } catch (e) { /* sessionStorage unavailable — fall through and still show it */ }

    var main = document.querySelector('.main-content') || document.querySelector('main');
    if (!main) return;

    var banner = document.createElement('div');
    banner.id = 'dd-nudge-banner';
    banner.className = 'page-banner page-banner--warning';
    banner.setAttribute('role', 'status');
    var body = document.createElement('div');
    body.className = 'page-banner-body';
    var msg = document.createElement('span');
    msg.className = 'page-banner-msg';
    var text = 'You have ' + total + (total === 1 ? ' open due-diligence item assigned to you' : ' open due-diligence items assigned to you');
    if (overdue > 0) text += ', ' + overdue + ' overdue';
    text += '.';
    msg.textContent = text;
    body.appendChild(msg);
    banner.appendChild(body);
    main.insertBefore(banner, main.firstChild);
    if (typeof window.makeBannerDismissible === 'function') {
      window.makeBannerDismissible(banner, 'dd_nudge_dismissed', 'session');
    }
  }

  function loadOwnerNudge() {
    return fetch('/api/dd/summary').then(function (r) { return r.json(); }).then(function (summary) {
      renderOwnerNudge(summary && summary.mine);
    }).catch(function () { /* best-effort — the nudge simply stays absent */ });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // D-18: resolve the caller's role + current deal id ONCE, before the
    // first render, so the access-grant form's visibility gate and its
    // target deal id are both known up front — mirrors
    // public/js/deal-switcher.js's own GET /api/auth/me bootstrap.
    fetch('/api/auth/me').then(function (r) { return r.json(); }).then(function (me) {
      state.role = (me && me.user && me.user.role) || '';
      state.dealId = (me && me.dealId) || null;
    }).catch(function () { /* best-effort — the grant form simply stays hidden */ })
      .then(function () { return load().then(render); })
      .then(function () { return loadOwnerNudge(); });
  });
})();
