/**
 * Org Design workspace (ORG-01) — renders exactly the positions the server
 * returned for the signed-in caller (GET /api/org/positions), current state
 * only. This page holds NO client-side list of "every possible state" — an
 * uncleared caller never sees a target-state control, a target-state fetch,
 * or a target-state row, because the server never returns one to it (D-07).
 *
 * T-06-08: every user-facing string (position title, occupant name) is
 * written with textContent, never assigned as markup — org content is MNPI
 * and this page must never become a stored-XSS vector for it. This module
 * assigns no markup anywhere.
 */
(function () {
  'use strict';

  var state = { positions: [] };

  // Module-level, declared exactly once, never reassigned to a fresh Set
  // instance — an unrelated re-render (e.g. after the add form submits)
  // must not silently collapse the operator's working expand/collapse
  // view. Toggling a node adds/removes its own id via .add()/.delete();
  // this Set is never replaced wholesale anywhere else in this file.
  var expandedIds = new Set();

  // Design Tension 2: default expand depth is 2 (root + one level of
  // children); everything deeper starts collapsed. Design Tension 2/6: the
  // per-level indent stops growing past depth 6 on desktop, depth 3 below
  // 768px (the narrow cap is enforced purely in CSS via the
  // --cap-narrow class, scoped inside the @media block in org.html).
  var DEFAULT_EXPAND_DEPTH = 2;
  var INDENT_CAP_DESKTOP = 6;
  var INDENT_CAP_NARROW = 3;

  function el(tag, opts) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    return node;
  }

  function load() {
    return fetch('/api/org/positions').then(function (r) { return r.json(); }).then(function (positions) {
      state.positions = Array.isArray(positions) ? positions : [];
    }).catch(function () {
      state.positions = [];
    });
  }

  // Groups the flat list on reportsToId — every row whose parent is missing
  // or absent from the lane is treated as a root, matching due-diligence.js's
  // existing flat-to-grouped transform idiom.
  function buildTree(positions) {
    var byParent = {};
    var ids = {};
    positions.forEach(function (p) { ids[p.id] = true; });
    positions.forEach(function (p) {
      var parentId = (p.reportsToId && ids[p.reportsToId]) ? p.reportsToId : '__root__';
      byParent[parentId] = byParent[parentId] || [];
      byParent[parentId].push(p);
    });
    function children(parentId) {
      return (byParent[parentId] || []).map(function (p) {
        return { position: p, children: children(p.id) };
      });
    }
    return children('__root__');
  }

  // Adds default-expanded ids for depth 0 and depth 1 (DEFAULT_EXPAND_DEPTH
  // = 2) into the shared expandedIds Set. Called on every render pass — it
  // only ADDS ids (Set.add is idempotent), it never clears or replaces the
  // Set, so a node the operator manually collapsed at depth 0/1 stays
  // collapsed across an unrelated re-render just as much as a manually
  // EXPANDED deep node stays expanded. New nodes appearing at depth 0/1
  // (e.g. right after being added) pick up the default automatically.
  function seedDefaultExpansion(tree) {
    tree.forEach(function (rootNode) {
      expandedIds.add(rootNode.position.id);
      rootNode.children.forEach(function (childNode) {
        expandedIds.add(childNode.position.id);
      });
    });
  }

  function renderNode(node, depth) {
    var article = el('article', { className: 'org-node' });
    article.setAttribute('data-position-id', node.position.id);
    article.setAttribute('data-depth', String(depth));

    var row = el('div', { className: 'org-node-row' });

    var hasChildren = node.children.length > 0;
    var isExpanded = expandedIds.has(node.position.id);

    if (hasChildren) {
      var toggle = el('button', { className: 'org-node-toggle', text: isExpanded ? '▾' : '▸' });
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(isExpanded));
      toggle.addEventListener('click', function () {
        if (expandedIds.has(node.position.id)) expandedIds.delete(node.position.id);
        else expandedIds.add(node.position.id);
        renderTree();
      });
      row.appendChild(toggle);
    }

    // D-08: level is free text and rendered only when authored — depth is
    // never used as a seniority signal, so the chip appears at every depth
    // that has one, not only depth 0.
    if (node.position.level) {
      row.appendChild(el('span', { className: 'org-node-level', text: node.position.level }));
    }

    var main = el('div', { className: 'org-node-main' });
    main.appendChild(el('span', { className: 'org-node-title', text: node.position.title }));

    var occupant;
    if (node.position.employeeId) {
      occupant = el('span', { className: 'org-node-occupant', text: node.position.employeeId });
    } else {
      occupant = el('em', { className: 'org-node-occupant org-node-vacant', text: 'Vacant' });
    }
    main.appendChild(occupant);

    row.appendChild(main);
    article.appendChild(row);

    // The children container is constructed ONLY inside this branch — a
    // collapsed node (isExpanded === false) emits no
    // <div class="org-node-children"> at all, matching the structural-
    // absence discipline used elsewhere in this phase (never CSS-hidden).
    if (hasChildren && isExpanded) {
      var childWrap = el('div', { className: 'org-node-children' });
      var childDepth = depth + 1;
      if (childDepth > INDENT_CAP_DESKTOP) childWrap.classList.add('org-node-children--cap-desktop');
      if (childDepth > INDENT_CAP_NARROW) childWrap.classList.add('org-node-children--cap-narrow');
      node.children.forEach(function (child) {
        childWrap.appendChild(renderNode(child, childDepth));
      });
      article.appendChild(childWrap);
    }

    return article;
  }

  function renderTree() {
    var wrap = document.getElementById('org-tree');
    if (!wrap) return;
    wrap.textContent = '';
    if (!state.positions.length) {
      var heading = el('p', { className: 'org-empty', text: 'No positions mapped yet' });
      var body = el('p', { className: 'org-empty', text: 'Add positions manually, or paste a roster to populate the structure at once.' });
      wrap.appendChild(heading);
      wrap.appendChild(body);
      return;
    }
    var tree = buildTree(state.positions);
    seedDefaultExpansion(tree);
    tree.forEach(function (node) {
      wrap.appendChild(renderNode(node, 0));
    });
  }

  function renderLoading() {
    var wrap = document.getElementById('org-tree');
    if (!wrap) return;
    wrap.textContent = '';
    wrap.appendChild(el('p', { className: 'org-empty', text: 'Loading organization…' }));
  }

  function buildReportsToSelect() {
    var select = document.createElement('select');
    select.id = 'org-add-reportsto';
    var none = el('option', { text: 'None (top level)' });
    none.value = '';
    select.appendChild(none);
    state.positions.forEach(function (p) {
      var opt = el('option', { text: p.title });
      opt.value = p.id;
      select.appendChild(opt);
    });
    return select;
  }

  function buildLevelDatalist() {
    var datalist = document.createElement('datalist');
    datalist.id = 'org-level-suggestions';
    var seen = {};
    state.positions.forEach(function (p) {
      if (p.level && !seen[p.level]) {
        seen[p.level] = true;
        var opt = document.createElement('option');
        opt.value = p.level;
        datalist.appendChild(opt);
      }
    });
    return datalist;
  }

  function renderAddForm() {
    var wrap = document.getElementById('org-add');
    if (!wrap) return;
    wrap.textContent = '';

    var form = el('form', { className: 'org-add' });

    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Position title';
    titleInput.id = 'org-add-title';
    form.appendChild(titleInput);

    var levelInput = document.createElement('input');
    levelInput.type = 'text';
    levelInput.placeholder = 'Level';
    levelInput.id = 'org-add-level';
    levelInput.setAttribute('list', 'org-level-suggestions');
    form.appendChild(levelInput);
    form.appendChild(buildLevelDatalist());

    form.appendChild(buildReportsToSelect());

    var submit = el('button', { className: 'btn btn-primary', text: 'Add position' });
    submit.type = 'submit';
    form.appendChild(submit);

    var error = el('div', { className: 'org-add-error' });
    form.appendChild(error);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      error.textContent = '';
      error.style.display = 'none';
      submit.disabled = true;
      var body = {
        title: titleInput.value,
        level: levelInput.value,
        reportsToId: document.getElementById('org-add-reportsto').value || null,
      };
      fetch('/api/org/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      }).then(function (result) {
        if (!result.ok) {
          error.textContent = (result.data && result.data.error) || 'Could not add that position.';
          error.style.display = 'block';
          return;
        }
        titleInput.value = '';
        levelInput.value = '';
        return load().then(function () {
          renderTree();
          renderAddForm();
        });
      }).catch(function () {
        error.textContent = 'Could not add that position.';
        error.style.display = 'block';
      }).then(function () {
        submit.disabled = false;
      });
    });

    wrap.appendChild(form);
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderLoading();
    load().then(function () {
      renderTree();
      renderAddForm();
    });
  });
})();
