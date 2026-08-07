/**
 * Org Design workspace (ORG-01) — renders exactly the positions the server
 * returned for the signed-in caller (GET /api/org/positions). This page
 * holds NO client-side list of "every possible state": an uncleared caller
 * never sees a target-state control, a target-state fetch, or a
 * target-state row, because the current/target switch and every
 * target-state request are constructed ONLY inside the branch guarded by
 * GET /api/org/capabilities' restricted key — absent for that caller, so
 * the branch is never reached (D-07, Design Tension 4). Each state switch
 * re-fetches from the server; the two states are never combined into one
 * client-held payload and filtered locally.
 *
 * T-06-08: every user-facing string (position title, occupant name) is
 * written with textContent, never assigned as markup — org content is MNPI
 * and this page must never become a stored-XSS vector for it. This module
 * assigns no markup anywhere.
 */
(function () {
  'use strict';

  var state = { positions: [], employees: [], decisions: [] };

  // 'current' | 'target' — which state the tree currently displays. Held in
  // a plain JS variable (Surface Contract 3), not persisted server-side.
  // The switch and every target-state request are constructed ONLY inside
  // the branch guarded by capabilities.targetOrgDesign below — for an
  // uncleared or errored capability probe this stays {} forever, so the
  // switch never renders and viewState never leaves 'current'.
  var viewState = 'current';
  var capabilities = {};

  // Module-level, declared exactly once, never reassigned to a fresh Set
  // instance — an unrelated re-render (e.g. after the add form submits)
  // must not silently collapse the operator's working expand/collapse
  // view. Toggling a node adds/removes its own id via .add()/.delete();
  // this Set is never replaced wholesale anywhere else in this file.
  var expandedIds = new Set();

  // Current search text (lowercased, trimmed) — '' means search is
  // inactive. searchForcedIds is a plain hash (not a second Set — this
  // file holds exactly one Set instance) tracking ONLY the node ids that
  // THIS search pass force-expanded via an ancestor-of-match, so clearing
  // the input can release exactly those ids and fall back to the default
  // expand depth rather than leaving every ancestor of a former match
  // pinned open.
  var searchQuery = '';
  var searchForcedIds = {};

  // 06-04 Task 3: which position ids currently have their decision-history
  // panel open — a plain hash (NOT a second Set; this file holds exactly
  // one Set instance, expandedIds above), keyed the same way
  // searchForcedIds already is. Survives every re-render the same way
  // expandedIds does, since renderTree() rebuilds the whole DOM from
  // scratch on every state change.
  var historyOpenIds = {};

  // Design Tension 2: default expand depth is 2 (root + one level of
  // children); everything deeper starts collapsed. Design Tension 2/6: the
  // per-level indent stops growing past depth 6 on desktop, depth 3 below
  // 768px (the narrow cap is enforced purely in CSS via the
  // --cap-narrow class, scoped inside the @media block in org.html).
  var DEFAULT_EXPAND_DEPTH = 2;
  var INDENT_CAP_DESKTOP = 6;
  var INDENT_CAP_NARROW = 3;

  // D-14: the THIRD of three independent copies of the five-value decision
  // vocabulary — server.js's own ORG_DECISION_TYPES is the first,
  // validators/org.js's is the second. Declared as a single plain array
  // literal on ONE statement (never built by a function call or spread) —
  // test/org-decisions.test.js's anti-drift block reads this file as TEXT
  // and extracts this exact declaration with a regex. Used below (and by
  // Plan 06-04 Task 3's rendering) to build the decision-type select's
  // options and to map a value to its badge class and its i18n key.
  var ORG_DECISION_TYPES = ['retain', 'redeploy', 'in-selection', 'redundant', 'open'];

  // UI-SPEC Design Tension 5's exact per-value palette: the badge is a
  // filled pill, never a border-accent (that channel is reserved for
  // flight-risk severity, Plan 05) — the CSS class selects the fill/text
  // color pair, applied in public/org.html.
  var ORG_DECISION_BADGE_CLASS = {
    retain: 'org-dec-badge--retain',
    redeploy: 'org-dec-badge--redeploy',
    'in-selection': 'org-dec-badge--in-selection',
    redundant: 'org-dec-badge--redundant',
    open: 'org-dec-badge--open',
  };

  // Builds the badge's i18n key by concatenation, the SAME precedent
  // public/js/execution.js:1008 uses for the RAID severity badge
  // ('raid.lvl_' + severity) — the hyphenated 'in-selection' value becomes
  // an underscore in its key (org.dec_in_selection), per this plan's own
  // recorded planner discretion.
  function orgDecisionI18nKey(value) {
    return 'org.dec_' + String(value || '').replace(/-/g, '_');
  }

  // English display text — the badge/select/history/confirmation copy for
  // every one of the five values. Ships as English text now, relying on
  // transitions.js's documented fall-back-to-English contract; DE/ZH/CS
  // translations land in Plan 08 keyed by orgDecisionI18nKey() above.
  // Copywriting Contract: never abbreviate or substitute an abstraction for
  // the vocabulary word — "Redundant" and "Redeploy" are spelled out in
  // full everywhere, including inside the governance confirmation.
  var ORG_DECISION_LABELS = {
    retain: 'Retain',
    redeploy: 'Redeploy',
    'in-selection': 'In Selection',
    redundant: 'Redundant',
    open: 'Open',
  };

  // Mirrors server.js's derivedDecisionFor() exactly (D-13): the entry with
  // the latest decidedAt for this position, or null when there are none.
  // Reads from the already-fetched state.decisions — no per-position fetch,
  // matching this phase's "no new search endpoint" simplicity precedent.
  function derivedDecisionForClient(positionId) {
    var forPosition = state.decisions.filter(function (d) { return d.positionId === positionId; });
    if (!forPosition.length) return null;
    return forPosition.reduce(function (latest, d) {
      return (!latest || d.decidedAt > latest.decidedAt) ? d : latest;
    }, null);
  }

  function decisionsForPosition(positionId) {
    return state.decisions.filter(function (d) { return d.positionId === positionId; });
  }

  function el(tag, opts) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    return node;
  }

  function load() {
    // The capability probe fires alongside the positions/employees fetch —
    // a Promise.all fan-out, same idiom deal-home.js uses for its own
    // multi-source panel loads. Any failure (including the probe itself)
    // resets capabilities to {}, the fail-closed state, so the switch is
    // never briefly visible and then withdrawn (Tension 4).
    //
    // 06-04: GET /api/org/decisions joins the same fan-out. It is
    // hr-grant-restricted (D-01/D-02) — for an uncleared caller it 403s and
    // resolves to a non-array JSON body, so `Array.isArray` below falls
    // back to `[]` exactly like a network failure would. Every position's
    // badge then derives to the harmless 'open' default (Surface Contract
    // §5's "no gap state on the card" — open IS one of the five values),
    // never a fabricated retain/redeploy/in-selection/redundant value, so
    // this fallback discloses nothing about the true, restricted decision.
    return Promise.all([
      fetch('/api/org/positions').then(function (r) { return r.json(); }),
      fetch('/api/employees').then(function (r) { return r.json(); }),
      fetch('/api/org/capabilities').then(function (r) { return r.json(); }),
      fetch('/api/org/decisions').then(function (r) { return r.json(); }),
    ]).then(function (results) {
      state.positions = Array.isArray(results[0]) ? results[0] : [];
      state.employees = Array.isArray(results[1]) ? results[1] : [];
      capabilities = (results[2] && typeof results[2] === 'object') ? results[2] : {};
      state.decisions = Array.isArray(results[3]) ? results[3] : [];
    }).catch(function () {
      state.positions = [];
      state.employees = [];
      capabilities = {};
      state.decisions = [];
    });
  }

  function employeeNameFor(employeeId) {
    if (!employeeId) return '';
    var match = state.employees.filter(function (e) { return e.id === employeeId; })[0];
    return (match && match.name) || '';
  }

  // Re-fetches positions for whichever state is currently displayed. The
  // `state=target` query string is constructed ONLY inside the branch
  // guarded by capabilities.targetOrgDesign — an uncleared or errored probe
  // can never reach this branch, so no client code path constructs a
  // target-state request without a server-granted capability.
  function reloadPositionsForViewState() {
    var url = '/api/org/positions';
    if (viewState === 'target' && capabilities.targetOrgDesign) {
      url = '/api/org/positions?state=target';
    }
    return fetch(url).then(function (r) { return r.json(); }).then(function (positions) {
      state.positions = Array.isArray(positions) ? positions : [];
    }).catch(function () {
      state.positions = [];
    });
  }

  function showDeleteError(message) {
    var el2 = document.getElementById('org-delete-error');
    if (!el2) return;
    el2.textContent = message;
    el2.style.display = 'block';
  }

  function clearDeleteError() {
    var el2 = document.getElementById('org-delete-error');
    if (!el2) return;
    el2.textContent = '';
    el2.style.display = 'none';
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

  // Adds default-expanded ids for every depth below DEFAULT_EXPAND_DEPTH
  // (2 — depths 0 and 1) into the shared expandedIds Set. Called on every
  // render pass — it only ADDS ids (Set.add is idempotent), it never clears
  // or replaces the Set, so a node the operator manually collapsed at
  // depth 0/1 stays collapsed across an unrelated re-render just as much as
  // a manually EXPANDED deep node stays expanded. New nodes appearing at
  // depth 0/1 (e.g. right after being added) pick up the default
  // automatically.
  function seedDefaultExpansion(tree) {
    function seed(nodes, depth) {
      if (depth >= DEFAULT_EXPAND_DEPTH) return;
      nodes.forEach(function (node) {
        expandedIds.add(node.position.id);
        seed(node.children, depth + 1);
      });
    }
    seed(tree, 0);
  }

  // UI-SPEC Surface Contract §5: reverse-chronological row list, dashed-
  // bottom rows matching .dd-vdr-row (due-diligence.html), each carrying
  // the type pill (reduced size), the rationale as a normal wrapping block
  // (no clamp/ellipsis), who decided, when, and the effective date —
  // effectiveDate omitted entirely (not a placeholder) when absent. The
  // heading carries a bare count, correct at 0/1/many. Empty and error both
  // render "No decisions recorded yet." (see load()'s own comment on why a
  // 403 and a genuinely empty log are indistinguishable here by design).
  function buildDecisionHistoryPanel(position) {
    var panel = el('div', { className: 'org-dec-history' });
    var entries = decisionsForPosition(position.id).slice().sort(function (a, b) {
      return String(b.decidedAt || '').localeCompare(String(a.decidedAt || ''));
    });
    panel.appendChild(el('h4', { className: 'org-dec-history-heading', text: 'Decisions (' + entries.length + ')' }));

    if (!entries.length) {
      panel.appendChild(el('p', { className: 'org-empty', text: 'No decisions recorded yet.' }));
    } else {
      entries.forEach(function (entry) {
        var row = el('div', { className: 'org-dec-row' });
        var pill = el('span', {
          className: 'org-dec-row-type ' + (ORG_DECISION_BADGE_CLASS[entry.type] || ''),
          text: ORG_DECISION_LABELS[entry.type] || entry.type,
        });
        pill.setAttribute('data-i18n', orgDecisionI18nKey(entry.type));
        row.appendChild(pill);
        row.appendChild(el('span', { className: 'org-dec-row-rationale', text: entry.rationale || '' }));
        var metaParts = [];
        if (entry.decidedBy) metaParts.push(entry.decidedBy);
        if (entry.decidedAt) metaParts.push(new Date(entry.decidedAt).toLocaleString());
        // effectiveDate is OMITTED from the row when absent — never a
        // placeholder character (UI Considerations, decision-history/partial).
        if (entry.effectiveDate) metaParts.push('Effective ' + entry.effectiveDate);
        if (metaParts.length) {
          row.appendChild(el('span', { className: 'org-dec-row-meta', text: metaParts.join(' · ') }));
        }
        panel.appendChild(row);
      });
    }

    // Surface Contract §5/D-04: the record-a-decision form is rendered ONLY
    // inside the branch guarded by the server-supplied governance
    // capability key — for every other cleared member it is not
    // constructed at all, not disabled. This omission is a courtesy; the
    // ACTUAL control is POST /api/org/decisions' own isAdminOrIlRequest(req)
    // gate (server.js).
    if (capabilities.recordOrgDecisions) {
      panel.appendChild(buildDecisionForm(position));
    }

    return panel;
  }

  // Record-a-decision form (D-13/D-14): a closed-vocabulary select with NO
  // option preselected (a deliberate non-default so 'retain' is never
  // recorded by accident), a required rationale textarea, and an optional
  // effectiveDate date input. Never abbreviates or substitutes an
  // abstraction for the vocabulary word — the option text, the badge and
  // the confirmation all spell out "Redundant"/"Redeploy" in full.
  function buildDecisionForm(position) {
    var form = el('form', { className: 'org-dec-form' });

    var typeSelect = document.createElement('select');
    typeSelect.className = 'org-dec-form-type';
    var blank = el('option', { text: 'Select a decision…' });
    blank.value = '';
    typeSelect.appendChild(blank);
    ORG_DECISION_TYPES.forEach(function (value) {
      var opt = el('option', { text: ORG_DECISION_LABELS[value] || value });
      opt.value = value;
      opt.setAttribute('data-i18n', orgDecisionI18nKey(value));
      typeSelect.appendChild(opt);
    });
    form.appendChild(typeSelect);

    var rationaleInput = document.createElement('textarea');
    rationaleInput.className = 'org-dec-form-rationale';
    rationaleInput.placeholder = 'Rationale (required)';
    rationaleInput.rows = 3;
    form.appendChild(rationaleInput);

    var effectiveDateInput = document.createElement('input');
    effectiveDateInput.type = 'date';
    effectiveDateInput.className = 'org-dec-form-effective';
    form.appendChild(effectiveDateInput);

    var submit = el('button', { className: 'btn btn-primary', text: 'Record decision' });
    submit.type = 'submit';
    form.appendChild(submit);

    var error = el('div', { className: 'org-dec-form-error' });
    form.appendChild(error);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      error.textContent = '';
      error.style.display = 'none';

      var type = typeSelect.value;
      var rationale = rationaleInput.value;
      var label = ORG_DECISION_LABELS[type] || type;

      // Copywriting Contract's governance-confirmation gate: the SAME
      // "Record '{label}' decision for {position title}?" opener for every
      // one of the five values, but ONLY redundant/redeploy carry the
      // legal and severance consequences sentence — applied on write,
      // never softened. Aborts ENTIRELY (no fetch at all) on cancel.
      var confirmMessage = "Record '" + label + "' decision for " + position.title + '?';
      if (type === 'redundant' || type === 'redeploy') {
        confirmMessage += ' This is a governance record with legal and severance consequences — confirm before submitting.';
      }
      if (!window.confirm(confirmMessage)) return;

      submit.disabled = true;
      fetch('/api/org/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId: position.id,
          type: type,
          rationale: rationale,
          effectiveDate: effectiveDateInput.value || undefined,
        }),
      }).then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      }).then(function (result) {
        submit.disabled = false;
        if (!result.ok) {
          error.textContent = (result.data && result.data.error) || 'Could not record that decision.';
          error.style.display = 'block';
          return;
        }
        // Refresh the history and the card badge from the server, never by
        // patching local state — the response body carries only the ONE
        // new entry, not the position's full derived-current picture.
        return fetch('/api/org/decisions').then(function (r2) { return r2.json(); }).then(function (decisions) {
          state.decisions = Array.isArray(decisions) ? decisions : [];
          renderTree();
          renderUnassigned();
        });
      }).catch(function () {
        submit.disabled = false;
        error.textContent = 'Could not record that decision.';
        error.style.display = 'block';
      });
    });

    return form;
  }

  function renderNode(node, depth, searchActive, relevantIds) {
    var article = el('article', { className: 'org-node' });
    article.setAttribute('data-position-id', node.position.id);
    article.setAttribute('data-depth', String(depth));
    // De-emphasise (not remove) a non-matching sibling while a search is
    // active, so the operator keeps their bearings on the rest of the tree.
    if (searchActive && !relevantIds[node.position.id]) {
      article.classList.add('org-node--dim');
    }

    // UI-SPEC Design Tension 5: the decision badge is a FILLED PILL, top-
    // right of the card — `.org-node{ position:relative; }` (org.html)
    // already gives this absolute-positioned child its containing block.
    // Every position always carries a badge (open is itself one of the
    // five values — see load()'s own comment on the absent-decisions
    // fallback), so this is never wrapped in a presence check.
    var decisionType = (derivedDecisionForClient(node.position.id) || {}).type || 'open';
    var decisionBadge = el('span', {
      className: 'org-node-decision ' + (ORG_DECISION_BADGE_CLASS[decisionType] || ''),
      text: ORG_DECISION_LABELS[decisionType] || decisionType,
    });
    decisionBadge.setAttribute('data-i18n', orgDecisionI18nKey(decisionType));
    article.appendChild(decisionBadge);

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
      occupant = el('span', { className: 'org-node-occupant', text: employeeNameFor(node.position.employeeId) || node.position.employeeId });
    } else {
      occupant = el('em', { className: 'org-node-occupant org-node-vacant', text: 'Vacant' });
    }
    main.appendChild(occupant);

    row.appendChild(main);

    var historyBtn = el('button', { className: 'org-node-history-toggle', text: 'Decisions' });
    historyBtn.type = 'button';
    historyBtn.setAttribute('aria-expanded', String(!!historyOpenIds[node.position.id]));
    historyBtn.addEventListener('click', function () {
      if (historyOpenIds[node.position.id]) delete historyOpenIds[node.position.id];
      else historyOpenIds[node.position.id] = true;
      renderTree();
    });
    row.appendChild(historyBtn);

    var deleteBtn = el('button', { className: 'org-node-delete', text: 'Delete' });
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', function () {
      // Copywriting Contract's destructive-confirmation gate runs first;
      // the {N}-direct-report count is interpolated afterwards, into the
      // error surface below, using the SERVER-reported count from a
      // refusal — never a client-guessed number.
      if (!window.confirm('Delete position? This cannot be undone.')) return;
      clearDeleteError();
      deleteBtn.disabled = true;
      fetch('/api/org/positions/' + node.position.id, { method: 'DELETE' })
        .then(function (r) {
          return r.json().then(function (data) { return { ok: r.ok, data: data }; });
        })
        .then(function (result) {
          if (!result.ok) {
            showDeleteError((result.data && result.data.error) || 'Could not delete that position.');
            deleteBtn.disabled = false;
            return;
          }
          return reloadPositionsForViewState().then(function () {
            renderTree();
            renderUnassigned();
            renderAddForm();
          });
        })
        .catch(function () {
          showDeleteError('Could not delete that position.');
          deleteBtn.disabled = false;
        });
    });
    row.appendChild(deleteBtn);

    article.appendChild(row);

    // Decision-history panel — constructed ONLY when open (same structural-
    // absence discipline as the children container below), never CSS-
    // hidden. Reads state.decisions (already fetched by load()) filtered
    // to this position — no per-click fetch, matching this phase's
    // established "no new endpoint" simplicity. A caller uncleared to view
    // decisions and a position with a genuinely empty log render the
    // IDENTICAL empty copy — the same anti-enumeration graceful-
    // degradation convention DD-04 established (catch-to-empty-state).
    if (historyOpenIds[node.position.id]) {
      article.appendChild(buildDecisionHistoryPanel(node.position));
    }

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
        childWrap.appendChild(renderNode(child, childDepth, searchActive, relevantIds));
      });
      article.appendChild(childWrap);
    }

    return article;
  }

  // Case-insensitive substring match against title, level and the
  // occupant's resolved name — client-side only, over the already-fetched
  // tree data (no new search endpoint).
  function positionMatchesQuery(position, query) {
    var haystack = [position.title || '', position.level || '', employeeNameFor(position.employeeId)]
      .join(' ')
      .toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  // Walks the tree once, computing which node ids are "relevant" (a direct
  // match or an ancestor of one) and force-expanding every ancestor of a
  // match into the shared expandedIds Set (tracked via searchForcedIds so a
  // later clear can release exactly these ids). Returns the id of the
  // first match encountered in document order, for scroll-into-view.
  function computeSearchState(tree, query) {
    var relevantIds = {};
    var firstMatchId = null;

    function walk(nodes, ancestorChain) {
      var subtreeHasMatch = false;
      nodes.forEach(function (node) {
        var isMatch = positionMatchesQuery(node.position, query);
        if (isMatch && !firstMatchId) firstMatchId = node.position.id;
        var childChain = ancestorChain.concat([node.position.id]);
        var childHasMatch = walk(node.children, childChain);
        if (isMatch || childHasMatch) {
          relevantIds[node.position.id] = true;
          subtreeHasMatch = true;
        }
        if (isMatch) {
          ancestorChain.forEach(function (ancestorId) {
            if (!expandedIds.has(ancestorId)) {
              expandedIds.add(ancestorId);
              searchForcedIds[ancestorId] = true;
            }
          });
        }
      });
      return subtreeHasMatch;
    }

    walk(tree, []);
    return { relevantIds: relevantIds, firstMatchId: firstMatchId };
  }

  function renderTree() {
    var wrap = document.getElementById('org-tree');
    if (!wrap) return;
    wrap.textContent = '';
    if (!state.positions.length) {
      wrap.appendChild(el('p', { className: 'org-empty', text: 'No positions mapped yet' }));
      // Surface Contract 3: switching to Target with zero rows gets its own
      // body copy plus a copy-from-current action — never a silent blank
      // page. The 'current' empty state (Copywriting Contract) is
      // unchanged.
      if (viewState === 'target') {
        wrap.appendChild(el('p', { className: 'org-empty', text: 'No target design started yet. Positions copied from current state, or added new, will appear here.' }));
        var copyBtn = el('button', { className: 'btn btn-secondary', text: 'Copy from current' });
        copyBtn.type = 'button';
        copyBtn.addEventListener('click', function () {
          copyBtn.disabled = true;
          fetch('/api/org/positions/copy-to-target', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }).then(function (r) {
            return r.json().then(function (data) { return { ok: r.ok, data: data }; });
          }).then(function (result) {
            copyBtn.disabled = false;
            if (!result.ok) return;
            // Refresh the tree from the copy response itself — the newly
            // created target rows — rather than a second round trip.
            state.positions = Array.isArray(result.data.positions) ? result.data.positions : [];
            renderTree();
            renderUnassigned();
          }).catch(function () {
            copyBtn.disabled = false;
          });
        });
        wrap.appendChild(copyBtn);
      } else {
        wrap.appendChild(el('p', { className: 'org-empty', text: 'Add positions manually, or paste a roster to populate the structure at once.' }));
      }
      return;
    }
    var tree = buildTree(state.positions);
    seedDefaultExpansion(tree);

    var searchActive = !!searchQuery;
    var searchState = { relevantIds: {}, firstMatchId: null };
    if (searchActive) {
      searchState = computeSearchState(tree, searchQuery);
      if (!searchState.firstMatchId) {
        wrap.appendChild(el('p', { className: 'org-empty', text: 'No positions match your search.' }));
        return;
      }
    }

    tree.forEach(function (node) {
      wrap.appendChild(renderNode(node, 0, searchActive, searchState.relevantIds));
    });

    if (searchActive && searchState.firstMatchId) {
      var matchEl = wrap.querySelector('[data-position-id="' + searchState.firstMatchId + '"]');
      if (matchEl) matchEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderSearch() {
    var wrap = document.getElementById('org-search');
    if (!wrap) return;
    wrap.textContent = '';
    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'org-search-input';
    input.className = 'org-search-input';
    input.placeholder = 'Search positions or people…';
    input.value = searchQuery;
    // Filters the already-fetched tree client-side — no fetch call here,
    // there is no server-side search endpoint (Design Tension 2).
    input.addEventListener('input', function () {
      var nextQuery = input.value.trim().toLowerCase();
      if (!nextQuery && searchQuery) {
        // Clearing restores the pre-search expansion default rather than
        // leaving every ancestor of the former match pinned open — release
        // ONLY the ids THIS search forced, never a manually-expanded one.
        Object.keys(searchForcedIds).forEach(function (id) { expandedIds.delete(id); });
        searchForcedIds = {};
      }
      searchQuery = nextQuery;
      renderTree();
    });
    wrap.appendChild(input);
  }

  // Membership is computed by excluding employeeIds already referenced by
  // a position's employeeId in the currently displayed state — no second
  // server call. Vacant positions stay inline in the tree (D-05); this
  // bucket is exclusively people with no position at all.
  function computeUnassignedEmployees() {
    var assignedIds = {};
    state.positions.forEach(function (p) {
      if (p.employeeId) assignedIds[p.employeeId] = true;
    });
    return state.employees.filter(function (e) { return !assignedIds[e.id]; });
  }

  function renderUnassigned() {
    var wrap = document.getElementById('org-unassigned');
    if (!wrap) return;
    wrap.textContent = '';
    var unassigned = computeUnassignedEmployees();
    wrap.appendChild(el('h3', { className: 'org-unassigned-heading', text: 'Unassigned employees (' + unassigned.length + ')' }));
    if (!unassigned.length) {
      wrap.appendChild(el('p', { className: 'org-empty', text: 'No unassigned employees.' }));
      return;
    }
    var list = el('div', { className: 'org-unassigned-list' });
    unassigned.forEach(function (e) {
      var row = el('div', { className: 'org-unassigned-row' });
      // Each row shows the fields the record actually has; an absent field
      // is omitted entirely, never rendered as an em-dash placeholder.
      if (e.name) row.appendChild(el('span', { className: 'org-unassigned-name', text: e.name }));
      var metaParts = [];
      if (e.role) metaParts.push(e.role);
      if (e.department) metaParts.push(e.department);
      if (metaParts.length) {
        row.appendChild(el('span', { className: 'org-unassigned-meta', text: metaParts.join(' · ') }));
      }
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  // Design Tension 4: two plain-text toggle labels, not an animated switch
  // component (none exists in this codebase). Renders only after the
  // capability probe resolves (called from load().then(...) below) so the
  // switch is never briefly visible and then withdrawn — and it is absent
  // entirely, not a disabled pair, when the probe carries no restricted key.
  function renderStateSwitch() {
    var wrap = document.getElementById('org-state-switch');
    if (!wrap) return;
    wrap.textContent = '';
    if (!capabilities.targetOrgDesign) return;

    var currentLabel = el('span', { className: 'org-state-switch-label', text: 'Current' });
    var targetLabel = el('span', { className: 'org-state-switch-label', text: 'Target' });
    if (viewState === 'current') currentLabel.classList.add('org-state-switch-label--active');
    else targetLabel.classList.add('org-state-switch-label--active');

    currentLabel.addEventListener('click', function () { switchViewState('current'); });
    targetLabel.addEventListener('click', function () { switchViewState('target'); });

    wrap.appendChild(currentLabel);
    wrap.appendChild(targetLabel);
  }

  // Re-fetches from the server for the newly selected state — never fetches
  // both states and filters locally (shipping target-state rows to a client
  // that then hides them is exactly the pattern the clean-room rules
  // forbid). Guarded by the same capability check reloadPositionsForViewState()
  // itself carries, as defence in depth against a stray call site.
  function switchViewState(next) {
    if (!capabilities.targetOrgDesign) return;
    if (next === viewState) return;
    viewState = next;
    reloadPositionsForViewState().then(function () {
      renderStateSwitch();
      renderTree();
      renderUnassigned();
      renderAddForm();
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

  // D-09: the position's employee link, editable from the add/edit form —
  // a select populated from the already-fetched state.employees (no new
  // fetch), with an explicit unlinked option FIRST so a vacant position
  // stays the default. This changes the link stored on position.employeeId;
  // the occupant's name is still shown in exactly one place, the tree
  // card's existing occupant slot (renderNode above) — this control does
  // not introduce a second place a person's name is stored.
  function buildEmployeeSelect() {
    var select = document.createElement('select');
    select.id = 'org-add-employee';
    var none = el('option', { text: 'Vacant (no occupant)' });
    none.value = '';
    select.appendChild(none);
    state.employees.forEach(function (e) {
      var opt = el('option', { text: e.name || e.id });
      opt.value = e.id;
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
    form.appendChild(buildEmployeeSelect());

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
        // D-09: null for the unlinked option, the employee id otherwise —
        // never a free-text name.
        employeeId: document.getElementById('org-add-employee').value || null,
        // Adds to whichever state is currently displayed — the reportsTo
        // options above are already drawn from state.positions for that
        // same state, so a cross-state parent reference can't be offered.
        state: viewState,
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
        return reloadPositionsForViewState().then(function () {
          renderTree();
          renderAddForm();
          renderUnassigned();
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

  // -----------------------------------------------------------------------
  // Bulk paste importer (D-09/D-10) — a two-step Preview-then-Import flow.
  // importParsedRows holds the parsed row array between a successful
  // Preview and the Import click; the Import button's own `disabled`
  // attribute AND this variable's null-check both gate the commit path, so
  // the handler is reachable only after a preview has actually been
  // produced (never directly from raw textarea content).
  // -----------------------------------------------------------------------
  var importParsedRows = null;

  // Header matching (Claude's Discretion, 06-CONTEXT.md): lowercase, trim,
  // strip spaces and underscores, so 'Reports To', 'reports_to' and
  // 'reportsto' all resolve to the same column; 'manager' is accepted as an
  // alias for reportsTo.
  function normalizeImportHeaderCell(cell) {
    return String(cell || '').toLowerCase().trim().replace(/[\s_]+/g, '');
  }
  var IMPORT_HEADER_FIELD = {
    title: 'title', level: 'level', reportsto: 'reportsTo', manager: 'reportsTo', name: 'name', email: 'email',
  };

  // Accepts a JSON array of objects, or delimited text (comma or tab,
  // detected from the header line) whose first line is a header row.
  // Unknown columns are ignored rather than failing the parse. Throws on
  // any unparseable input — the caller renders the UI-SPEC's fixed parse-
  // failure apology on any throw, never the raw error.
  function parseImportPaste(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('Nothing pasted.');
    if (trimmed.charAt(0) === '[') {
      var data = JSON.parse(trimmed);
      if (!Array.isArray(data)) throw new Error('JSON paste must be an array.');
      return data.map(function (row) {
        row = row || {};
        return {
          title: row.title || '',
          level: row.level || '',
          reportsTo: row.reportsTo || row.reportsto || row.manager || '',
          name: row.name || '',
          email: row.email || '',
        };
      });
    }
    var lines = trimmed.split('\n').map(function (l) { return l.replace(/\r$/, ''); }).filter(function (l) { return l.trim().length > 0; });
    if (lines.length < 2) throw new Error('Delimited paste needs a header line and at least one row.');
    var delimiter = lines[0].indexOf('\t') !== -1 ? '\t' : ',';
    var fieldForCol = lines[0].split(delimiter).map(function (cell) {
      return IMPORT_HEADER_FIELD[normalizeImportHeaderCell(cell)] || null;
    });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(delimiter);
      var row = { title: '', level: '', reportsTo: '', name: '', email: '' };
      fieldForCol.forEach(function (field, idx) {
        if (field) row[field] = (cols[idx] || '').trim();
      });
      rows.push(row);
    }
    return rows;
  }

  function renderImportPreviewTable(previewWrap, rows) {
    previewWrap.textContent = '';
    // Zero-one-many: a bare count, correct at every value.
    previewWrap.appendChild(el('h4', { className: 'org-import-preview-heading', text: rows.length + ' position' + (rows.length === 1 ? '' : 's') + ' parsed' }));
    if (!rows.length) return;
    var table = document.createElement('table');
    table.className = 'org-import-preview-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Title', 'Level', 'Reports To', 'Name', 'Email'].forEach(function (h) {
      headRow.appendChild(el('th', { text: h }));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      [row.title, row.level, row.reportsTo, row.name, row.email].forEach(function (val) {
        tr.appendChild(el('td', { text: val || '' }));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    previewWrap.appendChild(table);
  }

  function renderImportSection() {
    var wrap = document.getElementById('org-import');
    if (!wrap) return;
    wrap.textContent = '';

    var section = el('div', { className: 'org-import' });
    var label = document.createElement('label');
    label.className = 'org-import-label';
    label.textContent = 'Paste roster (CSV or JSON) — title, level, reportsTo, name, email';
    section.appendChild(label);

    var textarea = document.createElement('textarea');
    textarea.rows = 6;
    textarea.id = 'org-import-textarea';
    textarea.className = 'org-import-textarea';
    textarea.placeholder = 'CSV: title,level,reportsTo,name,email\nCEO,,,, \n\nor JSON: [{"title":"VP Engineering","level":"VP","reportsTo":"CEO","name":"Jane Doe","email":"jane@example.com"}]';
    section.appendChild(textarea);

    var errorEl = el('div', { className: 'org-import-error' });
    section.appendChild(errorEl);
    var statusEl = el('div', { className: 'org-import-status' });
    section.appendChild(statusEl);

    var previewWrap = el('div', { className: 'org-import-preview' });
    section.appendChild(previewWrap);

    var actions = el('div', { className: 'org-import-actions' });
    var previewBtn = el('button', { className: 'btn btn-secondary', text: 'Preview' });
    previewBtn.type = 'button';
    var importBtn = el('button', { className: 'btn btn-primary', text: 'Import' });
    importBtn.type = 'button';
    importBtn.disabled = true; // enabled only once a preview exists
    actions.appendChild(previewBtn);
    actions.appendChild(importBtn);
    section.appendChild(actions);

    function showImportError(message) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
    function clearImportError() {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
    function showImportStatus(message) {
      statusEl.textContent = message;
      statusEl.style.display = 'block';
    }
    function clearImportStatus() {
      statusEl.textContent = '';
      statusEl.style.display = 'none';
    }

    previewBtn.addEventListener('click', function () {
      clearImportError();
      clearImportStatus();
      importParsedRows = null;
      importBtn.disabled = true;
      previewWrap.textContent = '';
      var rows;
      try {
        rows = parseImportPaste(textarea.value);
      } catch (err) {
        showImportError("Couldn't read that paste — check it's valid CSV or JSON, then try again.");
        return;
      }
      importParsedRows = rows;
      importBtn.disabled = false;
      renderImportPreviewTable(previewWrap, rows);
    });

    importBtn.addEventListener('click', function () {
      // Reachable only after a successful Preview populated importParsedRows.
      if (!importParsedRows) return;
      clearImportError();
      clearImportStatus();
      importBtn.disabled = true;
      fetch('/api/org/positions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: importParsedRows, state: viewState }),
      }).then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      }).then(function (result) {
        if (!result.ok) {
          // The route is all-or-nothing — state plainly that nothing was
          // imported, so the operator does not assume a partial import
          // happened and re-paste, doubling their data. Text and preview
          // stay intact so the operator can fix and retry.
          var problems = (result.data && result.data.problems) || [];
          var message = 'Nothing was imported. ' + ((result.data && result.data.error) || 'The paste could not be imported.');
          problems.forEach(function (p) {
            message += ' Row ' + (p.row + 1) + ': ' + p.message;
          });
          showImportError(message);
          importBtn.disabled = false;
          return;
        }
        textarea.value = '';
        importParsedRows = null;
        previewWrap.textContent = '';
        var createdPositions = (result.data && result.data.createdPositions) || 0;
        var createdEmployees = (result.data && result.data.createdEmployees) || 0;
        return reloadPositionsForViewState().then(function () {
          return fetch('/api/employees').then(function (r2) { return r2.json(); });
        }).then(function (employees) {
          state.employees = Array.isArray(employees) ? employees : [];
          renderTree();
          renderUnassigned();
          renderAddForm();
          showImportStatus('Imported ' + createdPositions + ' position(s) and ' + createdEmployees + ' new employee(s).');
        });
      }).catch(function () {
        showImportError('Nothing was imported. Could not reach the server.');
        importBtn.disabled = false;
      });
    });

    wrap.appendChild(section);
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderLoading();
    load().then(function () {
      renderSearch();
      renderStateSwitch();
      renderTree();
      renderUnassigned();
      renderAddForm();
      renderImportSection();
    });
  });
})();
