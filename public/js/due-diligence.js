/**
 * Due Diligence workspace (DD-01/DD-04) — renders exactly the functional
 * areas the server returned for the signed-in caller (GET /api/dd/areas),
 * then each returned area's own request items (GET /api/dd/request-items).
 *
 * T-04-06: every user-controlled string (item text, owner, area label) is
 * written with textContent, never assigned as markup — DD content is MNPI
 * and this page must never become a stored-XSS vector for it.
 *
 * T-04-01: the page holds NO client-side list of all eight DD_AREAS to draw
 * placeholders from — an uncleared area must never be visible here, not even
 * as a greyed-out or locked row. It renders only the areas GET /api/dd/areas
 * actually returned.
 */
(function () {
  'use strict';

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

  function renderItem(item) {
    var row = el('div', { className: 'dd-item' + (item.overdue ? ' dd-item--overdue' : '') });
    var main = el('div', { className: 'dd-item-main' });
    var text = el('div', { className: 'dd-item-text', text: item.text });
    var meta = el('div', { className: 'dd-item-meta' });
    meta.appendChild(el('span', { text: STATUS_LABELS[item.status] || item.status }));
    if (item.owner) meta.appendChild(el('span', { text: 'Owner: ' + item.owner }));
    if (item.dueDate) meta.appendChild(el('span', { text: 'Due: ' + item.dueDate }));
    if (item.blocked) meta.appendChild(el('span', { text: 'Blocked' }));
    main.appendChild(text);
    main.appendChild(meta);
    row.appendChild(main);
    return row;
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
      container.appendChild(section);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    load().then(render);
  });
})();
