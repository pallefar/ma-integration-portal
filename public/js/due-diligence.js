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

  var state = { areas: [], itemsByArea: {} };

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
      return Promise.all(state.areas.map(function (a) {
        return fetch('/api/dd/request-items?area=' + encodeURIComponent(a.id))
          .then(function (r) { return r.json(); })
          .then(function (items) { state.itemsByArea[a.id] = Array.isArray(items) ? items : []; });
      }));
    });
  }

  function refresh() { return load().then(render); }

  function updateItem(id, patch) {
    var body = Object.assign({ id: id }, patch);
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
    statusSel.addEventListener('change', function () { updateItem(item.id, { status: statusSel.value }); });
    controls.appendChild(statusSel);

    var dueInput = document.createElement('input');
    dueInput.type = 'date';
    dueInput.value = item.dueDate || '';
    dueInput.addEventListener('change', function () { updateItem(item.id, { dueDate: dueInput.value }); });
    controls.appendChild(dueInput);

    var ownerInput = document.createElement('input');
    ownerInput.type = 'text';
    ownerInput.placeholder = 'Owner';
    ownerInput.value = item.owner || '';
    ownerInput.addEventListener('change', function () { updateItem(item.id, { owner: ownerInput.value }); });
    controls.appendChild(ownerInput);

    var blockedLabel = el('label');
    var blockedCheckbox = document.createElement('input');
    blockedCheckbox.type = 'checkbox';
    blockedCheckbox.checked = !!item.blocked;
    blockedCheckbox.addEventListener('change', function () { updateItem(item.id, { blocked: blockedCheckbox.checked }); });
    blockedLabel.appendChild(blockedCheckbox);
    blockedLabel.appendChild(document.createTextNode(' Blocked'));
    controls.appendChild(blockedLabel);

    main.appendChild(controls);
    row.appendChild(main);
    return row;
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

  function render() {
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
      container.appendChild(section);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    load().then(render);
  });
})();
