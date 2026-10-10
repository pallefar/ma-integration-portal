/**
 * Execution Hub — unified Day-1/100-day checklist + workstream task engine.
 * Tasks come from three sources: the checklist template (instantiated once),
 * readiness-assessment remediation (created from the Assessment Center), and
 * manual adds. Status cycles todo → doing → blocked → done on click.
 */
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  // T-05-35/UI-SPEC Copywriting Contract: the single choke point every write
  // handler on the synergy detail surface (stage change, re-baseline, and
  // Plan 07's confirm-current/cost-entry writes) routes its non-success
  // branch through — a rejected write can never fail silently, and the
  // server's own stated reason is always shown verbatim (D-08's hard-gate
  // refusal, D-09's empty-reason 400, D-15's authz 403, etc).
  function synAlertFailure(res) {
    // [Rule 1] CONC-02 (09-REVIEW WR-01): a 409 conflict body is already
    // fully handled by the shared conflict dialog rendered by
    // transitions.js's fetch wrapper — this alert must not ALSO fire for
    // that case, or the user sees two contradictory messages for one save.
    // GD-5 (09-12): a settled conflict also re-reads the server state so the
    // page shows what the user chose to keep — reloadAfterConflict() returns
    // true exactly when `res.conflict === true`, preserving WR-01.
    if (reloadAfterConflict(res)) return;
    window.alert((res && res.error) || 'That action could not be completed. Please try again.');
  }

  // GD-5 (09-12, T-09-49): the conflict dialog has settled WITHOUT applying
  // this user's change (Discard, Escape, overlay-click, Close, Cancel, or a
  // record that was withheld/deleted underneath them). Re-reading the server
  // state is what makes "keep theirs" true on screen — otherwise the page
  // keeps presenting the stale copy the user just declined to overwrite. The
  // held promise (09-11) guarantees this runs only AFTER the dialog is gone,
  // so it can never re-render underneath an open dialog. The re-read goes
  // through the normal clearance-filtered GET routes (T-09-38): a record the
  // caller is no longer cleared for simply disappears. Returns true when it
  // handled a conflict (callers then skip their own failure alert, WR-01).
  function reloadAfterConflict(res) {
    if (!(res && res.conflict === true)) return false;
    load().then(function () {
      render(); renderSynergy(); renderRaid(); applyI18n();
    }).catch(function (e) { console.error('re-read after conflict failed', e); });
    return true;
  }

  var PHASES = ['pre', 'day1', 'd30', 'd60', 'd100'];
  var PHASE_LABELS = { pre: 'Pre-close', day1: 'Day 1', d30: 'Day 30', d60: 'Day 60', d100: 'Day 100' };
  var STATUS_ORDER = ['todo', 'doing', 'blocked', 'done'];
  var STATUS_META = {
    todo: { label: 'To do', color: '#8a8f92' },
    doing: { label: 'In progress', color: '#167987' },
    blocked: { label: 'Blocked', color: '#C0392B' },
    done: { label: 'Done', color: '#3f7a37' }
  };

  // SYN-01: state.synExpanded is read at the top of each card's render to
  // decide whether that card's .syn-detail is included in the rendered
  // markup, and written to ONLY by the expand-toggle click handler below —
  // renderSynergy() must NEVER reset it wholesale, or an expanded card would
  // silently collapse on the next unrelated re-render (UI-SPEC §2).
  // state.synShowAll is the mobile-grid analogue: per-initiative "show all
  // months" flag, read by buildSynDetail() and written ONLY by the
  // .syn-show-all-link click handler — same never-reset-wholesale rule.
  var state = { tasks: [], template: null, wsFilter: null, synergies: [], raid: [], raidFilter: null, synExpanded: {}, synShowAll: {}, synRollup: {} };

  // D-07/D-11: four ordered confidence stages — an INDEPENDENT COPY of
  // server.js's own SYN_STAGES and validators/workstream.js's own SYN_STAGES,
  // mirroring the RAID_LEVELS/D-26 lockstep-copy convention used elsewhere in
  // this codebase. All THREE MUST move together — a partial edit here is
  // this repository's documented repeat failure mode; test/synergy-stage
  // .test.js's cross-file anti-drift assertion is what binds them, not
  // review alone. One-way cutover (D-07/D-11): the retired five-value
  // vocabulary never re-enters this file.
  var SYN_STAGES = ['idea', 'validated', 'committed', 'captured'];
  // UI-SPEC Copywriting Contract: the four stage label keys' English text.
  var SYN_LABELS = { idea: 'Idea', validated: 'Validated', committed: 'Committed', captured: 'Captured' };
  // UI-SPEC stage-badge palette: grey/slate/amber/green — all four hex
  // values already present in this file's retired SYN_COLORS, so no new
  // colour enters the codebase.
  var SYN_COLORS = { idea: '#8a8f92', validated: '#475569', committed: '#C77700', captured: '#3f7a37' };
  // D-05: the three named ramp shapes, verbatim per UI-SPEC's Copywriting
  // Contract — labels state each curve's checkpoints so the choice is
  // self-explanatory without a separate legend.
  var SYN_CURVE_OPTIONS = [
    { value: 'cost', label: 'Cost 30/70/100' },
    { value: 'revenue', label: 'Revenue 10/40/70' },
    { value: 'linear', label: 'Linear 33/67/100' }
  ];
  var RAID_STATUS_ORDER = ['open', 'mitigating', 'closed'];
  var RAID_STATUS_META = { open: { label: 'Open', color: '#C0392B' }, mitigating: { label: 'Mitigating', color: '#C77700' }, closed: { label: 'Closed', color: '#3f7a37' } };
  var RAID_TYPES = ['risk', 'issue', 'decision', 'dependency'];
  var RAID_TYPE_LABELS = { risk: 'Risk', issue: 'Issue', decision: 'Decision', dependency: 'Dependency' };

  function applyI18n() { if (window.applyPortalI18n) window.applyPortalI18n(); }

  function workstreams() {
    var fromTpl = (state.template && state.template.workstreams) || [];
    if (fromTpl.length) return fromTpl;
    // No template (e.g. stripped custom project): derive from tasks
    var seen = {};
    state.tasks.forEach(function (t) { seen[t.workstreamId || 'ws_imo'] = true; });
    return Object.keys(seen).map(function (id) { return { id: id, label: id, icon: '🗂️' }; });
  }

  function load() {
    return Promise.all([
      fetch('/api/integration-tasks').then(function (r) { return r.json(); }),
      fetch('/api/checklist-templates').then(function (r) { return r.json(); }),
      fetch('/api/synergies').then(function (r) { return r.json(); }).catch(function () { return []; }),
      fetch('/api/raid').then(function (r) { return r.json(); }).catch(function () { return []; }),
      // UI-SPEC §7/D-18/D-21: a fourth fetch feeding the four-tile rollup and
      // the unconfirmed-split sentence — same per-fetch degradation pattern
      // as synergies/raid above, so a failed rollup fetch yields a neutral
      // empty object and the tab still renders (never blanks).
      fetch('/api/synergies/rollup').then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function (res) {
      state.tasks = Array.isArray(res[0]) ? res[0] : [];
      state.template = (Array.isArray(res[1]) && res[1][0]) || null;
      state.synergies = Array.isArray(res[2]) ? res[2] : [];
      state.raid = Array.isArray(res[3]) ? res[3] : [];
      state.synRollup = (res[4] && typeof res[4] === 'object') ? res[4] : {};
    });
  }

  function ragColor(pct, anyBlocked) {
    if (anyBlocked) return '#C0392B';
    if (pct >= 80) return '#3f7a37';
    if (pct >= 40) return '#C77700';
    return '#C0392B';
  }

  function render() {
    // Overall progress
    var total = state.tasks.length;
    var done = state.tasks.filter(function (t) { return t.status === 'done'; }).length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById('ex-overall').innerHTML = total
      ? '<div style="width:56px;height:56px;border-radius:50%;background:' + ragColor(pct, false) + ';color:#fff;font-weight:800;font-size:1rem;display:flex;align-items:center;justify-content:center;">' + pct + '%</div>'
        + '<div><div style="font-size:.82rem;font-weight:800;color:var(--te-dark-teal);" data-i18n="exec.progress">Progress</div>'
        + '<div style="font-size:.72rem;color:var(--text-dim);">' + done + '/' + total + ' <span data-i18n="exec.done">done</span></div></div>'
      : '';

    // Offer template instantiation when its items have no tasks yet
    var inst = document.getElementById('ex-instantiate');
    if (state.template) {
      var anyFromTemplate = state.tasks.some(function (t) { return String(t.source || '').indexOf('template:' + state.template.id) === 0; });
      inst.style.display = anyFromTemplate ? 'none' : 'inline-block';
    } else inst.style.display = 'none';

    // Workstream rollup cards (click = filter)
    var wsGrid = document.getElementById('ex-ws-grid');
    wsGrid.innerHTML = workstreams().map(function (w) {
      var ts = state.tasks.filter(function (t) { return t.workstreamId === w.id; });
      if (!ts.length) return '';
      var d = ts.filter(function (t) { return t.status === 'done'; }).length;
      var blocked = ts.some(function (t) { return t.status === 'blocked'; });
      var p = Math.round((d / ts.length) * 100);
      return '<button class="ex-ws' + (state.wsFilter === w.id ? ' active' : '') + '" data-ws="' + esc(w.id) + '">'
        + '<div class="ex-ws-head"><span class="ex-ws-name">' + (w.icon || '') + ' <span data-i18n="' + esc(w.labelKey || '') + '">' + esc(w.label) + '</span></span>'
        + '<span class="ex-ws-count">' + d + '/' + ts.length + '</span></div>'
        + '<div class="ex-ws-track"><div class="ex-ws-fill" style="width:' + p + '%;background:' + ragColor(p, blocked) + '"></div></div>'
        + (blocked ? '<div class="ex-ws-flag">⚠ <span data-i18n="exec.status_blocked">Blocked</span></div>' : '')
        + '</button>';
    }).join('');
    wsGrid.querySelectorAll('.ex-ws').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-ws');
        state.wsFilter = state.wsFilter === id ? null : id;
        render();
      });
    });

    // Phase sections
    var phasesEl = document.getElementById('ex-phases');
    phasesEl.innerHTML = PHASES.map(function (ph) {
      var ts = state.tasks.filter(function (t) {
        return (t.phase || 'd30') === ph && (!state.wsFilter || t.workstreamId === state.wsFilter);
      });
      if (!ts.length && state.wsFilter) return '';
      var d = ts.filter(function (t) { return t.status === 'done'; }).length;
      var rows = ts.map(function (t) {
        var meta = STATUS_META[t.status] || STATUS_META.todo;
        var wsDef = workstreams().find(function (w) { return w.id === t.workstreamId; });
        var isRemediation = String(t.source || '').indexOf('remediation:') === 0;
        return '<div class="ex-task ' + esc(t.status) + '" data-task="' + esc(t.id) + '">'
          + '<button class="ex-status" style="background:' + meta.color + '" data-i18n="exec.status_' + esc(t.status) + '" title="' + esc(meta.label) + '">' + esc(meta.label) + '</button>'
          + '<div class="ex-task-main"><div class="ex-task-title"' + (t.titleKey ? ' data-i18n="' + esc(t.titleKey) + '"' : '') + '>' + esc(t.title) + '</div>'
          + '<div class="ex-task-meta">'
          + (wsDef ? '<span>' + (wsDef.icon || '') + ' <span data-i18n="' + esc(wsDef.labelKey || '') + '">' + esc(wsDef.label) + '</span></span>' : '')
          + (t.owner ? '<span>👤 ' + esc(t.owner) + '</span>' : '')
          + (t.due ? '<span>📅 ' + esc(t.due) + '</span>' : '')
          + (isRemediation ? '<span class="ex-src" data-i18n="exec.from_assessment">From readiness assessment</span>' : '')
          + '</div></div>'
          + '<button class="ex-del" title="✕">✕</button>'
          + '</div>';
      }).join('');
      return '<section class="ex-phase"><div class="ex-phase-head">'
        + '<h2 class="ex-phase-title" data-i18n="exec.phase_' + ph + '">' + PHASE_LABELS[ph] + '</h2>'
        + '<span class="ex-phase-count">' + d + '/' + ts.length + '</span></div>'
        + (rows || '<div class="ex-empty" data-i18n="exec.empty_phase">No tasks in this phase.</div>')
        + '</section>';
    }).join('');

    // Status cycle + delete
    phasesEl.querySelectorAll('.ex-task').forEach(function (row) {
      var id = row.getAttribute('data-task');
      row.querySelector('.ex-status').addEventListener('click', function () {
        var task = state.tasks.find(function (t) { return t.id === id; });
        if (!task) return;
        var next = STATUS_ORDER[(STATUS_ORDER.indexOf(task.status) + 1) % STATUS_ORDER.length];
        // CONC-02/D-02 (Phase 9): a single-field kanban status flip goes
        // through the SAME version check as a full edit — no exemptions.
        // The version this page already holds in memory for this record is
        // ALWAYS sent: window.maVersionOf() yields it, or 0 for a never-
        // edited record (D-09 / GD-1 — the strict server refuses an absent
        // version in a real deal, so omission is never a valid state; R7
        // F-1 was exactly a silent clobber on a never-edited task).
        var body = { id: id, status: next, version: window.maVersionOf(task) };
        fetch('/api/integration-tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.success) {
            // Refresh BOTH status and version from the server's own
            // response — without refreshing version, the NEXT click in this
            // same tab would resubmit the now-stale version and
            // self-conflict against its own prior write.
            task.status = res.task.status;
            task.version = res.task.version;
            render();
          } else {
            // GD-5: a conflict that settled without applying this change
            // (Discard etc.) — show the server's state, not the stale copy.
            reloadAfterConflict(res);
          }
        }).catch(function (e) { console.error('status update failed', e); });
      });
      row.querySelector('.ex-del').addEventListener('click', function () {
        var msg = (window.__assessDict && null) || 'Delete this task?';
        if (!window.confirm(msg)) return;
        // CONC-02/D-08 (Phase 9, Plan 06): the version this page currently
        // holds for this record, taken from the same in-memory list the row
        // was rendered from — never a re-fetch. ALWAYS sent (D-09 / GD-1):
        // window.maVersionOf() yields 0 for a never-edited record, and the
        // strict server refuses a delete that carries no precondition.
        var task = state.tasks.find(function (t) { return t.id === id; });
        var delUrl = '/api/integration-tasks/' + encodeURIComponent(id)
          + '?expectedVersion=' + encodeURIComponent(window.maVersionOf(task));
        fetch(delUrl, { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.success) {
              state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
              render();
            } else {
              reloadAfterConflict(res); // GD-5
            }
          }).catch(function (e) { console.error('delete failed', e); });
      });
    });

    applyI18n();
  }

  function wireControls() {
    // Add-task form selects
    var wsSel = document.getElementById('ex-new-ws');
    wsSel.innerHTML = workstreams().map(function (w) {
      return '<option value="' + esc(w.id) + '">' + (w.icon || '') + ' ' + esc(w.label) + '</option>';
    }).join('');
    var phSel = document.getElementById('ex-new-phase');
    phSel.innerHTML = PHASES.map(function (p) { return '<option value="' + p + '">' + PHASE_LABELS[p] + '</option>'; }).join('');
    phSel.value = 'd30';

    document.getElementById('ex-add-btn').addEventListener('click', function () {
      var title = document.getElementById('ex-new-title').value.trim();
      if (!title) return;
      fetch('/api/integration-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          workstreamId: wsSel.value,
          phase: phSel.value,
          owner: document.getElementById('ex-new-owner').value.trim(),
          due: document.getElementById('ex-new-due').value,
          source: 'manual'
        })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.success) {
          state.tasks.push(res.task);
          document.getElementById('ex-new-title').value = '';
          document.getElementById('ex-new-owner').value = '';
          render();
        }
      }).catch(function (e) { console.error('add task failed', e); });
    });

    document.getElementById('ex-instantiate').addEventListener('click', function () {
      if (!state.template) return;
      fetch('/api/integration-tasks/instantiate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklistTemplateId: state.template.id })
      }).then(function (r) { return r.json(); }).then(function () {
        return load();
      }).then(render).catch(function (e) { console.error('instantiate failed', e); });
    });
  }

  // ---------------------------------------------------------------- synergy

  // SYN-01/UI-SPEC §2: builds the expanded card's ramp-controls + phasing
  // grid markup. Only ever called for a card whose id is in
  // state.synExpanded — a collapsed card never includes this markup at all
  // (not merely hidden with CSS), so rendering N collapsed cards costs
  // nothing extra.
  function buildSynDetail(s) {
    var rows = Array.isArray(s.phasing) ? s.phasing : [];
    var curveOptions = SYN_CURVE_OPTIONS.map(function (o) {
      var sel = (s.curveShape || '') === o.value ? ' selected' : '';
      return '<option value="' + o.value + '"' + sel + '>' + esc(o.label) + '</option>';
    }).join('');

    var gridHtml;
    if (rows.length === 0) {
      // UI-SPEC §2/Copywriting Contract: the empty state replaces the grid
      // AND its header row entirely (never an empty grid shell) — the ramp
      // controls above stay visible so the empty state is actionable.
      gridHtml = '<div class="syn-empty-phasing">'
        + '<div class="syn-section-label" data-i18n="syn.no_phasing">No phasing rows yet</div>'
        + '<div class="ex-empty" data-i18n="syn.no_phasing_body">Enter a run-rate, start month and curve shape, then generate phasing rows to start tracking monthly targets.</div>'
        + '</div>';
    } else {
      // SYN-01/D-06/UI-SPEC §2: the client mirrors the server's
      // monthHasArrived() rule using the same YYYY-MM string comparison —
      // cosmetic only, the server is the real enforcement (T-05-01). An
      // arrived month's Realized cell is a structurally different tag
      // (<input>) from a future month's (<span class="syn-grid-locked">),
      // never one tag toggled between disabled/enabled states — the
      // concrete guard against the Phase 4 Wave 7 bug class where a value
      // landed on the right element but was rendered invisible.
      var currentMonth = new Date().toISOString().slice(0, 7);
      function buildRealizedCell(r) {
        var arrived = r.month <= currentMonth;
        return arrived
          ? '<input type="number" class="syn-realized-input" min="0" step="0.1" value="' + (r.realizedM || 0) + '" data-syn-month="' + esc(r.month) + '">'
          : '<span class="syn-grid-locked" title="Not yet arrived — editable once this month begins">—</span>';
      }
      function buildTargetCell(r) {
        return '<input type="number" class="syn-target-input" min="0" step="0.1" value="' + (r.targetM || 0) + '" data-syn-month="' + esc(r.month) + '">';
      }

      // Desktop (>=768px): every row, sticky header, scroll container.
      var head = '<div class="syn-grid-head"><span data-i18n="syn.grid_month">Month</span><span data-i18n="syn.grid_target">Target $</span><span data-i18n="syn.grid_realized">Realized $</span></div>';
      var body = rows.map(function (r) {
        return '<div class="syn-grid-row" data-syn-month="' + esc(r.month) + '">'
          + '<span>' + esc(r.month) + '</span>'
          + '<span>' + buildTargetCell(r) + '</span>'
          + '<span>' + buildRealizedCell(r) + '</span>'
          + '</div>';
      }).join('');
      var desktopGrid = '<div class="syn-grid">' + head + body + '</div>';

      // Mobile (<768px, CSS media query below): stacked cards, windowed to
      // 4 months (prior + current + next 2, clamped to the generated
      // range) by default; "Show all N months" reveals the rest inline —
      // never horizontal scroll, never a modal (UI-SPEC §2).
      var showAll = !!state.synShowAll[s.id];
      var currentIdx = rows.findIndex(function (r) { return r.month === currentMonth; });
      var windowStart = currentIdx === -1 ? 0 : Math.max(0, currentIdx - 1);
      var windowEnd = currentIdx === -1 ? Math.min(rows.length, 4) : Math.min(rows.length, currentIdx + 3);
      var visibleRows = showAll ? rows : rows.slice(windowStart, windowEnd);
      var mobileBody = visibleRows.map(function (r) {
        return '<div class="syn-grid-mobile-row" data-syn-month="' + esc(r.month) + '">'
          + '<div class="syn-grid-mobile-month">' + esc(r.month) + '</div>'
          + '<div class="syn-grid-mobile-field"><span data-i18n="syn.grid_target">Target $</span>' + buildTargetCell(r) + '</div>'
          + '<div class="syn-grid-mobile-field"><span data-i18n="syn.grid_realized">Realized $</span>' + buildRealizedCell(r) + '</div>'
          + '</div>';
      }).join('');
      var showAllLink = (!showAll && visibleRows.length < rows.length)
        ? '<a href="#" class="syn-show-all-link">Show all ' + rows.length + ' months</a>'
        : '';
      var mobileGrid = '<div class="syn-grid-mobile">' + mobileBody + showAllLink + '</div>';

      gridHtml = desktopGrid + mobileGrid;
    }

    return '<div class="syn-detail">'
      + '<div class="syn-ramp-controls">'
      + '<input type="number" class="syn-ramp-runrate" min="0" step="0.1" data-i18n-ph="syn.runrate_ph" placeholder="Run-rate $M" value="' + (s.runRateM || '') + '">'
      + '<input type="month" class="syn-ramp-start" value="' + esc(s.startMonth || '') + '">'
      + '<select class="syn-ramp-curve">' + curveOptions + '</select>'
      + '<button class="btn btn-primary syn-generate-btn" type="button" data-i18n="syn.generate_btn">Generate phasing rows</button>'
      + '</div>'
      + gridHtml
      + renderBaselines(s)
      + renderCostSection(s)
      + '</div>';
  }

  // ------------------------------------------------------- stage control --

  // UI-SPEC §1: the pill carries the stage's palette colour and its English
  // fallback label, plus a data-i18n attribute composed from the stage value
  // so the four syn.st_* keys hydrate it (applyPortalI18n's own missing-key
  // no-op is why SYN_LABELS is the real safety net, per read_first note).
  // Wrapped in a position:relative span so the caret's menu can be
  // position:absolute against it (UI-SPEC's declared containment rule).
  function renderStageControl(item) {
    var color = SYN_COLORS[item.stage] || '#8a8f92';
    var label = SYN_LABELS[item.stage] || item.stage;
    return '<span class="syn-stage-wrap">'
      + '<button type="button" class="ex-status syn-stage" style="background:' + color + ';min-width:96px;" data-i18n="syn.st_' + esc(item.stage) + '">' + esc(label) + '</button>'
      + '<button type="button" class="syn-stage-caret" title="Change stage" aria-label="Change stage">&#9662;</button>'
      + '</span>';
  }

  // module-level: at most one stage menu open at a time across the whole
  // list — closeSynStageMenu() is the single place that tears down the
  // document-level Escape/outside-click listener pair, so a wholesale
  // renderSynergy() re-render (triggered by any successful write) can never
  // leave an orphaned document listener behind (UI-SPEC §1).
  var synStageMenuState = null;

  function closeSynStageMenu() {
    if (synStageMenuState) {
      synStageMenuState.cleanup();
      synStageMenuState = null;
    }
  }

  // requestStageChange(id, targetStage[, reason]) is the ONE fetch this
  // section issues — used by both the pill (forward-only) and every menu
  // row (forward runs the same D-08 gate; backward carries the D-09 reason).
  function requestStageChange(id, targetStage, reason) {
    closeSynStageMenu();
    var body = { targetStage: targetStage };
    if (reason) body.reason = reason;
    // CONC-02/D-02 (Phase 9): ALWAYS send the version this page already holds
    // for this initiative — window.maVersionOf() yields 0 for a never-edited
    // record (D-09 / GD-1); the strict server refuses an absent precondition.
    var existingItem = state.synergies.find(function (s) { return s.id === id; });
    body.version = window.maVersionOf(existingItem);
    fetch('/api/synergies/' + encodeURIComponent(id) + '/stage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.success) {
        var idx = state.synergies.findIndex(function (s) { return s.id === id; });
        if (idx !== -1) state.synergies[idx] = res.initiative;
        renderSynergy(); applyI18n();
      } else {
        // D-08/D-09/UI-SPEC error contract: the pill keeps showing the
        // unchanged stage (no re-render happens on this branch at all) and
        // the server's stated gate reason is shown verbatim.
        synAlertFailure(res);
      }
    });
  }

  // UI-SPEC §1: opens the absolutely-positioned 4-row menu inside wrapEl
  // (the .syn-stage-wrap span, position:relative). The current stage stays
  // in the list, marked with a checkmark rather than removed. Selecting the
  // current stage closes the menu with no request; selecting a stage ahead
  // runs the same gate as the pill; selecting a stage behind runs the
  // reason prompt and aborts (no fetch) on a cancelled or empty trimmed
  // result.
  function openSynStageMenu(wrapEl, item, id) {
    closeSynStageMenu();
    var menu = document.createElement('div');
    menu.className = 'syn-stage-menu';
    menu.innerHTML = SYN_STAGES.map(function (stage) {
      var isCurrent = stage === item.stage;
      return '<button type="button" class="syn-stage-menu-item" data-stage="' + esc(stage) + '">'
        + (isCurrent ? '&#10003; ' : '')
        + '<span data-i18n="syn.st_' + esc(stage) + '">' + esc(SYN_LABELS[stage] || stage) + '</span>'
        + '</button>';
    }).join('');
    wrapEl.appendChild(menu);
    applyI18n();

    function onDocClick(ev) {
      if (!wrapEl.contains(ev.target)) closeSynStageMenu();
    }
    function onKeydown(ev) {
      if (ev.key === 'Escape') closeSynStageMenu();
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeydown);

    menu.querySelectorAll('.syn-stage-menu-item').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var targetStage = btn.getAttribute('data-stage');
        var currentOrdinal = SYN_STAGES.indexOf(item.stage);
        var targetOrdinal = SYN_STAGES.indexOf(targetStage);
        if (targetOrdinal === currentOrdinal) { closeSynStageMenu(); return; }
        if (targetOrdinal > currentOrdinal) {
          requestStageChange(id, targetStage);
          return;
        }
        // D-09: a backward move requires a non-empty trimmed reason — a
        // cancelled prompt (null) or an empty/whitespace-only result aborts
        // entirely, and no request is ever sent from the client.
        closeSynStageMenu();
        var targetLabel = SYN_LABELS[targetStage] || targetStage;
        var reason = window.prompt('Reason for moving this initiative back to ' + targetLabel + ':');
        if (reason === null) return;
        reason = reason.trim();
        if (!reason) return;
        requestStageChange(id, targetStage, reason);
      });
    });

    synStageMenuState = {
      id: id,
      cleanup: function () {
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKeydown);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      }
    };
  }

  // ------------------------------------------------------ baseline history --

  function formatBaselineDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // UI-SPEC §3/D-12/D-14/D-15: renders the deal case (version 1, located
  // explicitly rather than assumed to be array index 0) pinned first, every
  // remaining entry newest-first beneath it, and the re-baseline control —
  // absent from the markup entirely for any role other than admin/hrbp
  // (D-15's authz split: this is the cosmetic half, the route is the real
  // control, per DD-04 precedent).
  function renderBaselines(item) {
    var baselines = Array.isArray(item.baselines) ? item.baselines : [];
    var canRebaseline = !!(window.__portalUser && (window.__portalUser.role === 'admin' || window.__portalUser.role === 'hrbp'));
    var rebaselineBtn = canRebaseline
      ? '<button type="button" class="btn btn-secondary syn-rebaseline-btn" data-i18n="syn.rebaseline_btn">Re-baseline this initiative</button>'
      : '';

    if (baselines.length === 0) {
      // UI-E3 empty: no baseline yet — the deal case is stamped the first
      // time this initiative gets a phased target, not before.
      return '<div class="syn-baselines">'
        + '<div class="syn-section-label" data-i18n="syn.baselines_heading">Baseline history</div>'
        + '<div class="ex-empty" data-i18n="syn.no_baseline">No baseline yet — the deal case is created with the first phased target.</div>'
        + rebaselineBtn
        + '</div>';
    }

    // D-14: locate version 1 EXPLICITLY (never assume array order/index 0)
    // and render it first; every remaining entry renders newest-first
    // beneath it, and the deal case keeps first position regardless of how
    // many later baselines accumulate.
    var dealCase = baselines.find(function (b) { return b.version === 1; });
    var rest = baselines.filter(function (b) { return b !== dealCase; })
      .slice()
      .sort(function (a, b) { return (b.version || 0) - (a.version || 0); });
    var ordered = dealCase ? [dealCase].concat(rest) : rest;

    var rows = ordered.map(function (b) {
      var isDealCase = !!dealCase && b === dealCase;
      var dateOrLabel = isDealCase
        ? '<span class="syn-baseline-label" data-i18n="syn.baseline_dealcase">Deal case</span><span class="syn-baseline-date">' + esc(formatBaselineDate(b.at)) + '</span>'
        : '<span class="syn-baseline-date">' + esc(formatBaselineDate(b.at)) + '</span>';
      var dot = '<span class="syn-baseline-dot" style="background:' + (SYN_COLORS[b.stage] || '#8a8f92') + ';" title="' + esc(SYN_LABELS[b.stage] || b.stage || '') + '"></span>';
      var reasonText = b.reason || '';
      // UI-E3 overflow/long-text: one-line truncation via CSS, full text in
      // a title attribute — matches the existing .ex-src truncation
      // convention. Every dynamic value here passes through esc().
      return '<div class="syn-baseline-row">'
        + dateOrLabel
        + dot
        + '<span class="syn-baseline-actor">' + esc(b.by || '') + '</span>'
        + '<span class="syn-baseline-runrate">$' + esc(b.runRateM != null ? b.runRateM : 0) + 'M</span>'
        + '<span class="syn-baseline-reason" title="' + esc(reasonText) + '">' + esc(reasonText) + '</span>'
        + '</div>';
    }).join('');

    return '<div class="syn-baselines">'
      + '<div class="syn-section-label" data-i18n="syn.baselines_heading">Baseline history</div>'
      + rows
      + rebaselineBtn
      + '</div>';
  }

  // -------------------------------------------------- cost-to-achieve --

  // UI-SPEC §4/D-20: costExpectedMonth is a YYYY-MM string (not a full
  // date) — formatted the same way as the baseline dates for a consistent
  // "Month Year" reading, never left as the raw machine-readable string.
  function formatCostExpectedMonth(monthStr) {
    if (!monthStr) return '';
    var parts = String(monthStr).split('-');
    if (parts.length !== 2) return monthStr;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    if (isNaN(d.getTime())) return monthStr;
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  // UI-SPEC §4/D-20: the third .syn-detail sub-section — a single planned-
  // figure line, then .syn-cost-list, a PLAIN LIST (never a grid) of dated
  // actual-cost entries. Entries render in EXACTLY the order
  // GET /api/synergies already returned (the server sorts newest-date-first
  // with a stable same-date tiebreak, Plan 04) — this function applies no
  // .sort() of its own, so the two sides can never disagree about
  // equal-dated rows. A row with no note renders date+amount only; a long
  // note truncates to one line via CSS with the full text in a title
  // attribute, matching the baseline-reason convention from Plan 06.
  function renderCostSection(item) {
    var plannedLine = (item.costPlannedM != null || item.costExpectedMonth)
      ? '<div class="syn-cost-planned"><span data-i18n="syn.cost_planned_lbl">Planned</span>: $'
        + (item.costPlannedM != null ? item.costPlannedM : 0) + 'M'
        + (item.costExpectedMonth
          ? ', <span data-i18n="syn.cost_expected_lbl">expected</span> ' + esc(formatCostExpectedMonth(item.costExpectedMonth))
          : '')
        + '</div>'
      : '';

    var entries = Array.isArray(item.costEntries) ? item.costEntries : [];
    var listHtml;
    if (entries.length === 0) {
      // UI-E4 empty: the no-costs-logged line replaces the list entirely —
      // never an empty .syn-cost-list container.
      listHtml = '<div class="ex-empty" data-i18n="syn.no_costs">No actual costs logged yet.</div>';
    } else {
      var rows = entries.map(function (e) {
        // UI-E4 partial: a note-less entry renders date+amount only —
        // nothing occupies the note position. The note (when present)
        // passes through esc() for both its text content and its title.
        var noteHtml = e.note
          ? '<span class="syn-cost-note" title="' + esc(e.note) + '">' + esc(e.note) + '</span>'
          : '';
        return '<div class="syn-cost-row" data-cost-entry="' + esc(e.id) + '">'
          + '<span class="syn-cost-date">' + esc(e.date) + '</span>'
          + '<span class="syn-cost-amount">$' + esc(e.amountM) + 'M</span>'
          + noteHtml
          + '<button class="ex-del syn-cost-del" title="✕">✕</button>'
          + '</div>';
      }).join('');
      listHtml = '<div class="syn-cost-list">' + rows + '</div>';
    }

    // UI-SPEC §4: the add-entry mini-form matches the existing .ex-add
    // pattern (date + number + text + Add button) already used three times
    // in this file — no new form pattern invented.
    var addForm = '<div class="ex-add syn-cost-add">'
      + '<input type="date" class="syn-cost-date-input">'
      + '<input type="number" class="syn-cost-amount-input" min="0" step="0.1" data-i18n-ph="syn.cost_amount_ph" placeholder="Amount $M">'
      + '<input type="text" class="syn-cost-note-input" data-i18n-ph="syn.cost_note_ph" placeholder="Note (optional)">'
      + '<button class="btn btn-primary syn-cost-add-btn" type="button" data-i18n="syn.cost_add_btn">Add cost entry</button>'
      + '</div>';

    return '<div class="syn-cost">'
      + '<div class="syn-section-label" data-i18n="syn.cost_heading">Cost to achieve</div>'
      + plannedLine
      + listHtml
      + addForm
      + '</div>';
  }

  // -------------------------------------------------------- task linkage --

  // UI-SPEC §5/D-22/D-23: informational only, NEVER a control — no button,
  // no click handler, no pointer cursor, no hover state anywhere in this
  // markup or its CSS (the concrete rule that satisfies "must not look like
  // a control that changes value or stage"). The denominator is the count
  // of linked ids that STILL resolve to a task in the already-fetched task
  // array (state.tasks, from load()'s Promise.all — no new endpoint); a
  // linked id whose task has since been deleted inflates neither figure.
  function renderTaskProgress(item) {
    var ids = Array.isArray(item.taskIds) ? item.taskIds : [];
    var linked = ids.map(function (tid) {
      return state.tasks.find(function (t) { return t.id === tid; });
    }).filter(Boolean);

    if (linked.length === 0) {
      // UI-E5 empty: the no-tasks-linked line, never "0 of 0 tasks done".
      return '<div class="syn-task-progress"><span class="ex-empty" data-i18n="syn.no_tasks">No tasks linked yet.</span></div>';
    }

    var done = linked.filter(function (t) { return t.status === 'done'; }).length;
    var pct = Math.round((done / linked.length) * 100);
    // UI-E5 zero-one-many: plain "N of M tasks done" phrasing scales from
    // one linked task to many with no pluralization edge case. Reuses the
    // existing .ex-ws-track/.ex-ws-fill workstream bar classes verbatim —
    // not a new bar component.
    return '<div class="syn-task-progress">'
      + '<span>' + done + ' <span data-i18n="syn.tasks_of">of</span> ' + linked.length + ' <span data-i18n="syn.tasks_done">tasks done</span></span>'
      + '<div class="ex-ws-track"><div class="ex-ws-fill" style="width:' + pct + '%;background:' + ragColor(pct, false) + '"></div></div>'
      + '</div>';
  }

  // UI-SPEC §7/D-18/D-21, T-05-47/D-01/D-02: five stat tiles (gross
  // realized, unphased, cost incurred, net benefit, deal target) — the
  // "unphased" tile is new (07-04-PLAN.md), added so the screen and the
  // steerco pack (Plan 07-05) render the same five figures from the same
  // rollup response, in the same order UI-SPEC §5 fixes for the pack. It is
  // a tile in its own right, never a footnote inside the gross tile, so
  // free-typed unphased money can never read as folded into "gross". Reads
  // ONLY state.synRollup (the server-computed GET /api/synergies/rollup
  // response) — never recomputes any of these figures from the card list,
  // so a wrong client clock or a stale local card can never disagree with
  // the server's own totals (T-05-36).
  function renderSynRollup() {
    var r = state.synRollup || {};
    var gross = r.grossRealizedM || 0;
    var unphased = r.unphasedRealizedM || 0;
    var cost = r.costIncurredM || 0;
    var net = r.netBenefitM != null ? r.netBenefitM : (gross - cost);
    var target = r.dealTargetM || 0;
    var staleCount = r.staleCount || 0;
    var unconfirmed = r.unconfirmedRealizedM || 0;
    // T-05-47/D-01: the percentage now reflects the phased-only gross
    // against the deal target — that is the point of the redefinition.
    var pct = target > 0 ? Math.round((gross / target) * 100) : 0;
    // Destructive colour when net benefit is negative — a real, expected
    // early-deal state (cost currently exceeds realized value), not an
    // error, so a colour rather than a warning treatment (UI-SPEC §7).
    var netColor = net < 0 ? '#C0392B' : 'var(--te-dark-teal)';

    var tiles = '<div class="syn-rollup-tiles">'
      + '<div class="syn-rollup-tile"><div class="syn-rollup-label" data-i18n="syn.rollup_gross">Gross realized</div><div class="syn-rollup-value">$' + gross.toFixed(1) + 'M</div></div>'
      + '<div class="syn-rollup-tile"><div class="syn-rollup-label" data-i18n="syn.rollup_unphased">Unphased</div><div class="syn-rollup-value">$' + unphased.toFixed(1) + 'M</div></div>'
      + '<div class="syn-rollup-tile"><div class="syn-rollup-label" data-i18n="syn.rollup_cost">Cost incurred</div><div class="syn-rollup-value">$' + cost.toFixed(1) + 'M</div></div>'
      + '<div class="syn-rollup-tile"><div class="syn-rollup-label" data-i18n="syn.rollup_net">Net benefit</div><div class="syn-rollup-value" style="color:' + netColor + ';">$' + net.toFixed(1) + 'M</div></div>'
      + '<div class="syn-rollup-tile"><div class="syn-rollup-label" data-i18n="syn.rollup_target">Deal target</div><div class="syn-rollup-value">$' + target.toFixed(1) + 'M</div></div>'
      + '</div>';

    // D-18: the unconfirmed-split sentence is emitted ONLY when the stale
    // count is non-zero — omitted entirely (not a "$0M unconfirmed"
    // version of it) when nothing is stale, because a zero-value sentence
    // reads as an error, not reassurance.
    var staleSentence = staleCount > 0
      ? '<div class="syn-rollup-stale-split">realized $' + gross.toFixed(1) + 'M, of which $' + unconfirmed.toFixed(1) + 'M unconfirmed</div>'
      : '';

    return '<div class="syn-card" style="border-top:4px solid var(--te-orange);">'
      + tiles
      + staleSentence
      + '<div style="margin-top:.75rem;"><div style="font-size:.72rem;font-weight:800;color:var(--text-dim);margin-bottom:.3rem;">' + pct + '% <span data-i18n="syn.of_target">of target</span></div>'
      + '<div class="syn-track" style="margin-top:0;height:12px;"><div class="syn-fill" style="width:' + Math.min(pct, 100) + '%"></div></div></div>'
      + '</div>';
  }

  function renderSynergy() {
    var list = state.synergies;
    document.getElementById('syn-rollup').innerHTML = renderSynRollup();

    document.getElementById('syn-list').innerHTML = list.map(function (s) {
      var p = s.targetM > 0 ? Math.round(((s.realizedM || 0) / s.targetM) * 100) : 0;
      var wsDef = workstreams().find(function (w) { return w.id === s.workstreamId; });
      // SYN-01/UI-SPEC §2: read state.synExpanded (never write it here) to
      // decide whether this card's .syn-detail is included at all.
      var expanded = !!state.synExpanded[s.id];
      // UI-SPEC §6/D-16/D-18: the badge renders ONLY inside a conditional
      // on the item's SERVER-COMPUTED stale flag (enrichSynergy(), Plan
      // 05) — the client never recomputes staleness from timestamps. The
      // title carries the exact last-confirmed date.
      var staleBadge = s.stale
        ? '<span class="syn-stale-badge" data-i18n="syn.stale_badge" title="' + esc('Last confirmed: ' + (s.lastConfirmedAt ? formatBaselineDate(s.lastConfirmedAt) : 'Never')) + '">Stale</span>'
        : '';
      return '<div class="syn-card" data-syn="' + esc(s.id) + '">'
        + '<div class="syn-head"><div style="flex:1;min-width:0;"><div class="syn-title">' + esc(s.title) + '</div>'
        + '<div class="syn-meta">'
        + '<span class="syn-cat ' + esc(s.category) + '" data-i18n="syn.cat_' + esc(s.category) + '">' + (s.category === 'cost' ? 'Cost' : 'Revenue') + '</span>'
        + renderStageControl(s)
        + staleBadge
        + '<button type="button" class="btn btn-secondary syn-confirm-btn" data-i18n="syn.confirm_current">Confirm current</button>'
        + (wsDef ? '<span>' + (wsDef.icon || '') + ' <span data-i18n="' + esc(wsDef.labelKey || '') + '">' + esc(wsDef.label) + '</span></span>' : '')
        + (s.owner ? '<span>👤 ' + esc(s.owner) + '</span>' : '')
        // WR-05: once phasing rows exist, D-04 refuses this route's write
        // unconditionally (server.js: "edit targetM/realizedM per month on
        // the phasing grid, not on the initiative directly") — an input
        // here was guaranteed to error on every use, sitting right next to
        // the correct read-only rollup figure (.syn-realized below). Gated
        // on the exact same condition the server enforces, so an editable
        // input only ever appears where the write can actually succeed; a
        // phased card shows the figure read-only instead.
        + (Array.isArray(s.phasing) && s.phasing.length > 0
          ? '<span><span data-i18n="syn.realized_lbl">Realized $M</span>: $' + (s.realizedM || 0) + '</span>'
          : '<span><span data-i18n="syn.realized_lbl">Realized $M</span>: <input type="number" class="syn-realized-input" min="0" step="0.1" value="' + (s.realizedM || 0) + '"></span>')
        + '</div>'
        + renderTaskProgress(s)
        // Close the flex column ONLY — .syn-money and .ex-del stay inside
        // .syn-head (closed after them), and .syn-track/.syn-expand-toggle/
        // .syn-detail stay inside .syn-card (closed by the final </div>).
        // 05-07 added a meta-closing </div> before renderTaskProgress but left
        // this as '</div></div>', over-closing .syn-head so the stray </div>
        // after .ex-del closed .syn-card EARLY — the toggle/track/detail
        // parsed as SIBLINGS of the card and card.querySelector('.syn-expand-
        // toggle') returned null, aborting the whole wiring loop (caught by
        // the wave-8 live regression walk; invisible to source-level tests).
        + '</div>'
        + '<div class="syn-money"><div class="syn-realized">$' + (s.realizedM || 0) + 'M</div><div class="syn-target">/ $' + (s.targetM || 0) + 'M</div></div>'
        + '<button class="ex-del" title="✕">✕</button>'
        + '</div>'
        + '<div class="syn-track"><div class="syn-fill" style="width:' + Math.min(p, 100) + '%"></div></div>'
        + '<button class="syn-expand-toggle" type="button">' + (expanded ? '▾ Hide details' : '▸ Phasing, baseline & cost details') + '</button>'
        + (expanded ? buildSynDetail(s) : '')
        + '</div>';
    }).join('');

    document.querySelectorAll('#syn-list .syn-card').forEach(function (card) {
      var id = card.getAttribute('data-syn');
      // UI-SPEC §1: pill click advances one stage forward ONLY — no
      // wraparound, no modulo. At the last vocabulary entry the click is a
      // no-op: no request, no visual change (this is what prevents the old
      // cycle-and-wrap handler's silent-demotion class of bug).
      card.querySelector('.syn-stage').addEventListener('click', function () {
        var item = state.synergies.find(function (s) { return s.id === id; });
        if (!item) return;
        var currentIdx = SYN_STAGES.indexOf(item.stage);
        if (currentIdx === SYN_STAGES.length - 1) return;
        requestStageChange(id, SYN_STAGES[currentIdx + 1]);
      });
      card.querySelector('.syn-stage-caret').addEventListener('click', function (ev) {
        ev.stopPropagation();
        var item = state.synergies.find(function (s) { return s.id === id; });
        if (!item) return;
        if (synStageMenuState && synStageMenuState.id === id) { closeSynStageMenu(); return; }
        openSynStageMenu(card.querySelector('.syn-stage-wrap'), item, id);
      });
      // UI-SPEC §6/D-16: its OWN button, hitting its OWN dedicated route
      // with a payload carrying no CONTENT fields at all (an empty object
      // plus, per CONC-02/D-02, the held version as the sole precondition —
      // never derived from any input on the page) — structurally distinct
      // from every title/notes change handler, so a confirmation and a
      // content edit can never be the same request.
      card.querySelector('.syn-confirm-btn').addEventListener('click', function () {
        var existingItem = state.synergies.find(function (s) { return s.id === id; });
        // Always sent — maVersionOf() is 0 for a never-edited record (GD-1).
        var confirmBody = {};
        confirmBody.version = window.maVersionOf(existingItem);
        fetch('/api/synergies/' + encodeURIComponent(id) + '/confirm-current', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(confirmBody)
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.success) {
            var idx = state.synergies.findIndex(function (s) { return s.id === id; });
            if (idx !== -1) state.synergies[idx] = res.initiative;
            renderSynergy(); applyI18n();
          } else {
            synAlertFailure(res);
          }
        });
      });
      // SYN-01/UI-SPEC §2: writes state.synExpanded — the ONLY place in
      // this file that assigns to it. Toggling re-renders the whole list,
      // which is what proves this write must survive the rebuild (Task 3's
      // regression test).
      card.querySelector('.syn-expand-toggle').addEventListener('click', function () {
        state.synExpanded[id] = !state.synExpanded[id];
        renderSynergy(); applyI18n();
      });
      var genBtn = card.querySelector('.syn-generate-btn');
      if (genBtn) {
        genBtn.addEventListener('click', function () {
          // UI-SPEC §2/Copywriting Contract: regenerating discards
          // manually-edited rows, so it must never be silent when rows
          // already exist. window.confirm() is called BEFORE the fetch —
          // Task 3's source-level regression asserts that ordering.
          var existing = state.synergies.find(function (s) { return s.id === id; });
          if (existing && Array.isArray(existing.phasing) && existing.phasing.length > 0) {
            if (!window.confirm('This replaces the existing phasing rows. Continue?')) return;
          }
          var runRateEl = card.querySelector('.syn-ramp-runrate');
          var startEl = card.querySelector('.syn-ramp-start');
          var curveEl = card.querySelector('.syn-ramp-curve');
          var body = {
            runRateM: parseFloat(runRateEl.value) || 0,
            startMonth: startEl.value,
            curveShape: curveEl.value
          };
          // CONC-02/D-02 (Phase 9): `existing` above is the same held record —
          // always send its version (0 when never edited; GD-1).
          body.version = window.maVersionOf(existing);
          fetch('/api/synergies/' + encodeURIComponent(id) + '/generate-phasing', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (res && res.success) {
              var idx = state.synergies.findIndex(function (s) { return s.id === id; });
              if (idx !== -1) state.synergies[idx] = res.initiative;
              renderSynergy(); applyI18n();
            } else {
              // GD-5 / WR-01: a settled conflict re-reads and never alerts.
              if (!reloadAfterConflict(res)) window.alert(res && res.error);
            }
          });
        });
      }
      // WR-05: the header input is now gated (above) on the item having no
      // phasing rows, so it may not exist in the DOM at all — scoped to
      // .syn-head so this NEVER mistakenly matches a per-month grid cell
      // when the card is both phased AND expanded (in that state the header
      // input is absent by design, and .syn-head contains no .syn-detail
      // descendants, so this selector still correctly finds nothing).
      var headerRealizedInput = card.querySelector('.syn-head .syn-realized-input');
      if (headerRealizedInput) {
        headerRealizedInput.addEventListener('change', function (ev) {
          var val = parseFloat(ev.target.value) || 0;
          // CONC-02/D-02 (Phase 9): always send the version this page already
          // holds for this initiative (0 when never edited; GD-1).
          var existingItem = state.synergies.find(function (s) { return s.id === id; });
          var body = { id: id, realizedM: val, version: window.maVersionOf(existingItem) };
          fetch('/api/synergies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (res && res.success) {
                var item = state.synergies.find(function (s) { return s.id === id; });
                if (item) { item.realizedM = res.initiative.realizedM; item.version = res.initiative.version; }
                renderSynergy(); applyI18n();
              } else {
                // Rule 1 fix: once an initiative has phasing rows, D-04
                // refuses this direct write with 400 — this field must not
                // fail silently (UI-SPEC's "never silently fail" contract).
                // GD-5 (R7 F-2b): a settled conflict re-reads so the header
                // shows the server's realized value, and never alerts (WR-01).
                if (!reloadAfterConflict(res)) window.alert(res && res.error);
              }
            });
        });
      }
      // SYN-01/D-06/D-25: per-month grid cell handlers — scoped to
      // .syn-detail so they never collide with the card-head
      // .syn-realized-input above (different DOM subtree, same reused CSS
      // class per UI-SPEC §2 "existing input styling, reused verbatim").
      // Each cell POSTs only the field that changed to the dedicated
      // per-month sub-route; the server is the real arrived-month gate
      // (T-05-01) — this handler never decides that on its own.
      card.querySelectorAll('.syn-detail .syn-target-input, .syn-detail .syn-realized-input').forEach(function (cell) {
        cell.addEventListener('change', function (ev) {
          var month = cell.getAttribute('data-syn-month');
          if (!month) return;
          var field = cell.classList.contains('syn-target-input') ? 'targetM' : 'realizedM';
          var body = {};
          body[field] = parseFloat(ev.target.value) || 0;
          // CONC-02/D-02 (Phase 9): always send the version this page already
          // holds for this initiative (0 when never edited; GD-1).
          var existingItem = state.synergies.find(function (s) { return s.id === id; });
          body.version = window.maVersionOf(existingItem);
          fetch('/api/synergies/' + encodeURIComponent(id) + '/phasing/' + encodeURIComponent(month), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (res && res.success) {
              var idx = state.synergies.findIndex(function (s) { return s.id === id; });
              if (idx !== -1) state.synergies[idx] = res.initiative;
              renderSynergy(); applyI18n();
            } else {
              // GD-5 / WR-01: a settled conflict re-reads and never alerts.
              if (!reloadAfterConflict(res)) window.alert(res && res.error);
            }
          });
        });
      });
      // UI-SPEC §3/D-15: rendered only for admin/hrbp (renderBaselines()'s
      // own conditional) — absent from the markup for any other role, so
      // there is nothing to wire for them. The route enforcement
      // (isAdminOrIlRequest) is the real control regardless.
      var rebaselineBtn = card.querySelector('.syn-rebaseline-btn');
      if (rebaselineBtn) {
        rebaselineBtn.addEventListener('click', function () {
          // D-15/UI-SPEC: same reason-prompt flow as a backward stage
          // move — a cancelled prompt or an empty trimmed reason aborts
          // entirely, no request is ever sent.
          var reason = window.prompt('Reason for re-baselining this initiative:');
          if (reason === null) return;
          reason = reason.trim();
          if (!reason) return;
          // CONC-02/D-02 (Phase 9): always send the version this page already
          // holds for this initiative (0 when never edited; GD-1).
          var existingItem = state.synergies.find(function (s) { return s.id === id; });
          var rebaselineBody = { reason: reason, version: window.maVersionOf(existingItem) };
          fetch('/api/synergies/' + encodeURIComponent(id) + '/rebaseline', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rebaselineBody)
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (res && res.success) {
              var idx = state.synergies.findIndex(function (s) { return s.id === id; });
              if (idx !== -1) state.synergies[idx] = res.initiative;
              renderSynergy(); applyI18n();
            } else {
              synAlertFailure(res);
            }
          });
        });
      }
      // UI-SPEC §4/D-20: the cost-entry mini-form — copies the raid-add
      // handler's shape verbatim (read+trim, return early on empty
      // required fields, POST, push the returned entry's owning initiative
      // into local state and re-render on success, route the non-success
      // branch through the shared failure helper). Both elements are only
      // present when the card is expanded (buildSynDetail()'s output), so
      // this is guarded exactly like the ramp-controls' genBtn above.
      var costAddBtn = card.querySelector('.syn-cost-add-btn');
      if (costAddBtn) {
        costAddBtn.addEventListener('click', function () {
          var dateEl = card.querySelector('.syn-cost-date-input');
          var amountEl = card.querySelector('.syn-cost-amount-input');
          var noteEl = card.querySelector('.syn-cost-note-input');
          var date = dateEl.value.trim();
          var amountRaw = amountEl.value.trim();
          if (!date || !amountRaw) return;
          var body = { date: date, amountM: parseFloat(amountRaw) || 0 };
          var note = noteEl.value.trim();
          if (note) body.note = note;
          // CONC-02/D-02 (Phase 9): always send the version this page already
          // holds for this initiative (0 when never edited; GD-1).
          var existingItem = state.synergies.find(function (s) { return s.id === id; });
          body.version = window.maVersionOf(existingItem);
          fetch('/api/synergies/' + encodeURIComponent(id) + '/cost-entries', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (res && res.success) {
              var idx = state.synergies.findIndex(function (s) { return s.id === id; });
              if (idx !== -1) state.synergies[idx] = res.initiative;
              renderSynergy(); applyI18n();
            } else {
              synAlertFailure(res);
            }
          });
        });
      }
      // UI-SPEC §4/Copywriting Contract: the delete button runs the
      // window.confirm() cost-entry confirmation BEFORE issuing the
      // request — mirrors the existing .ex-del confirm-then-delete idiom.
      card.querySelectorAll('.syn-cost-del').forEach(function (delBtn) {
        delBtn.addEventListener('click', function () {
          var row = delBtn.parentNode;
          var eid = row.getAttribute('data-cost-entry');
          if (!window.confirm('Delete this cost entry?')) return;
          // CONC-02/D-02 (Phase 9): this route carries no JSON body — the
          // version precondition travels as a query parameter, resolved by
          // the server's shared parseExpectedVersion() dual-channel
          // contract. ALWAYS send the version this page already holds for
          // this initiative (0 when never edited; GD-1).
          var existingItem = state.synergies.find(function (s) { return s.id === id; });
          var delUrl = '/api/synergies/' + encodeURIComponent(id) + '/cost-entries/' + encodeURIComponent(eid)
            + '?expectedVersion=' + encodeURIComponent(window.maVersionOf(existingItem));
          fetch(delUrl, { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (res && res.success) {
                var item = state.synergies.find(function (s) { return s.id === id; });
                if (item) {
                  if (Array.isArray(item.costEntries)) {
                    item.costEntries = item.costEntries.filter(function (e) { return e.id !== eid; });
                  }
                  // Refresh the version from the server's response — without
                  // it, the NEXT write in this same tab would resubmit the
                  // now-stale version and self-conflict against its own
                  // successful delete.
                  if (res.initiative && res.initiative.version !== undefined) item.version = res.initiative.version;
                }
                renderSynergy(); applyI18n();
              } else {
                synAlertFailure(res);
              }
            });
        });
      });
      // SYN-01/UI-SPEC §2: writes state.synShowAll — the mobile-grid
      // analogue of the expand-toggle write above, and the ONLY place in
      // this file that assigns to it.
      var showAllLink = card.querySelector('.syn-show-all-link');
      if (showAllLink) {
        showAllLink.addEventListener('click', function (ev) {
          ev.preventDefault();
          state.synShowAll[id] = true;
          renderSynergy(); applyI18n();
        });
      }
      card.querySelector('.ex-del').addEventListener('click', function () {
        if (!window.confirm('Delete this initiative?')) return;
        // CONC-02/D-08 (Phase 9, Plan 06): the version this page currently
        // holds for this initiative, taken from the same in-memory list the
        // card was rendered from — never a re-fetch. ALWAYS sent (0 when the
        // record was never edited; D-09 / GD-1).
        var item = state.synergies.find(function (s) { return s.id === id; });
        var delUrl = '/api/synergies/' + encodeURIComponent(id)
          + '?expectedVersion=' + encodeURIComponent(window.maVersionOf(item));
        fetch(delUrl, { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.success) {
              state.synergies = state.synergies.filter(function (s) { return s.id !== id; });
              renderSynergy(); applyI18n();
            } else {
              reloadAfterConflict(res); // GD-5
            }
          });
      });
    });
    applyI18n();
  }

  // ---------------------------------------------------------------- raid
  function renderRaid() {
    var filters = document.getElementById('raid-filters');
    filters.innerHTML = ['all'].concat(RAID_TYPES).map(function (ty) {
      var active = (state.raidFilter || 'all') === ty;
      var key = ty === 'all' ? 'raid.all' : 'raid.type_' + ty;
      return '<button class="raid-fbtn' + (active ? ' active' : '') + '" data-raid-f="' + ty + '" data-i18n="' + key + '">' + (ty === 'all' ? 'All' : RAID_TYPE_LABELS[ty]) + '</button>';
    }).join('');
    filters.querySelectorAll('.raid-fbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-raid-f');
        state.raidFilter = v === 'all' ? null : v;
        renderRaid();
      });
    });

    var list = state.raid.filter(function (r) { return !state.raidFilter || r.type === state.raidFilter; });
    document.getElementById('raid-list').innerHTML = list.map(function (r) {
      var st = RAID_STATUS_META[r.status] || RAID_STATUS_META.open;
      var wsDef = workstreams().find(function (w) { return w.id === r.workstreamId; });
      return '<div class="raid-row" data-raid="' + esc(r.id) + '">'
        + '<span class="raid-type ' + esc(r.type) + '" data-i18n="raid.type_' + esc(r.type) + '">' + (RAID_TYPE_LABELS[r.type] || r.type) + '</span>'
        + '<div class="ex-task-main"><div class="ex-task-title">' + esc(r.title) + '</div>'
        + '<div class="ex-task-meta">'
        + '<span class="raid-lvl ' + esc(r.severity) + '"><span data-i18n="raid.sev">Severity</span>: <span data-i18n="raid.lvl_' + esc(r.severity) + '">' + esc(r.severity) + '</span></span>'
        + (r.probability ? '<span class="raid-lvl ' + esc(r.probability) + '"><span data-i18n="raid.prob">Probability</span>: <span data-i18n="raid.lvl_' + esc(r.probability) + '">' + esc(r.probability) + '</span></span>' : '')
        + (wsDef ? '<span>' + (wsDef.icon || '') + ' <span data-i18n="' + esc(wsDef.labelKey || '') + '">' + esc(wsDef.label) + '</span></span>' : '')
        + (r.owner ? '<span>👤 ' + esc(r.owner) + '</span>' : '')
        + (r.notes ? '<span style="flex-basis:100%;">📝 ' + esc(r.notes) + '</span>' : '')
        + '</div></div>'
        + '<button class="ex-status raid-status" style="background:' + st.color + ';min-width:92px;" data-i18n="raid.st_' + esc(r.status) + '">' + st.label + '</button>'
        + '<button class="ex-del" title="✕">✕</button>'
        + '</div>';
    }).join('') || '<div class="ex-empty" data-i18n="exec.empty_phase">No tasks in this phase.</div>';

    document.querySelectorAll('#raid-list .raid-row').forEach(function (row) {
      var id = row.getAttribute('data-raid');
      row.querySelector('.raid-status').addEventListener('click', function () {
        var item = state.raid.find(function (r) { return r.id === id; });
        if (!item) return;
        var next = RAID_STATUS_ORDER[(RAID_STATUS_ORDER.indexOf(item.status) + 1) % RAID_STATUS_ORDER.length];
        // CONC-02/D-02 (Phase 9): a single-field kanban status flip goes
        // through the SAME version check as a full edit — no exemptions.
        // Always send the version this page holds in memory for this
        // record: window.maVersionOf() yields the held version, or 0 for a
        // never-edited record (D-09 — version-less IS version 0). Sending 0
        // is what lets the server catch the FIRST concurrent edit of a
        // never-edited record (R7 F-1); the server refuses a write with no
        // precondition in a real deal.
        var body = { id: id, status: next, version: window.maVersionOf(item) };
        fetch('/api/raid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.success) {
              // Refresh BOTH status and version from the server's own
              // response — without refreshing version, the NEXT click in
              // this same tab would resubmit the now-stale version and
              // self-conflict against its own prior write.
              item.status = res.entry.status;
              item.version = res.entry.version;
              renderRaid();
            } else {
              reloadAfterConflict(res); // GD-5: show the server's state
            }
          });
      });
      row.querySelector('.ex-del').addEventListener('click', function () {
        if (!window.confirm('Delete this entry?')) return;
        // CONC-02/D-08 (Phase 9, Plan 06): the version this page currently
        // holds for this entry, taken from the same in-memory list the row
        // was rendered from — never a re-fetch. Always sent: window.maVersionOf()
        // yields 0 for a never-edited record (D-09 — version-less IS version
        // 0), so a stale delete of it is still caught (R7 F-1); a delete with
        // no precondition is refused in a real deal.
        var entry = state.raid.find(function (r) { return r.id === id; });
        var delUrl = '/api/raid/' + encodeURIComponent(id) + '?expectedVersion=' + encodeURIComponent(window.maVersionOf(entry));
        fetch(delUrl, { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.success) {
              state.raid = state.raid.filter(function (x) { return x.id !== id; });
              renderRaid();
            } else {
              reloadAfterConflict(res); // GD-5: a withheld/changed record
            }
          });
      });
    });
    applyI18n();
  }

  function wireExtraControls() {
    // Hub tabs
    document.querySelectorAll('.ex-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        var tab = b.getAttribute('data-ex-tab');
        document.querySelectorAll('.ex-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
        ['tasks', 'synergy', 'raid', 'reports'].forEach(function (p) {
          document.getElementById('ex-pane-' + p).style.display = p === tab ? 'block' : 'none';
        });
      });
    });
    // Add synergy
    document.getElementById('syn-add-btn').addEventListener('click', function () {
      var title = document.getElementById('syn-new-title').value.trim();
      if (!title) return;
      fetch('/api/synergies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          category: document.getElementById('syn-new-cat').value,
          targetM: document.getElementById('syn-new-target').value,
          owner: document.getElementById('syn-new-owner').value.trim()
        })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.success) {
          state.synergies.push(res.initiative);
          document.getElementById('syn-new-title').value = '';
          document.getElementById('syn-new-target').value = '';
          renderSynergy();
        }
      });
    });
    // Add raid entry
    document.getElementById('raid-add-btn').addEventListener('click', function () {
      var title = document.getElementById('raid-new-title').value.trim();
      if (!title) return;
      fetch('/api/raid', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: document.getElementById('raid-new-type').value,
          title: title,
          severity: document.getElementById('raid-new-sev').value,
          owner: document.getElementById('raid-new-owner').value.trim()
        })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.success) {
          state.raid.push(res.entry);
          document.getElementById('raid-new-title').value = '';
          renderRaid();
        }
      });
    });

    // RPT-02/07-06: the steerco pack button — the ONE accent-coloured
    // control this phase introduces (07-UI-SPEC.md §7). Ports the existing
    // content-management save button's disable+label-swap idiom
    // (admin-cms.js:37) verbatim. No demo-conditional branch exists anywhere
    // in this handler — demo generates the identical pack via the identical
    // fetch (07-UI-SPEC.md §6); the only demo-conditional code in this
    // phase's entire surface lives server-side, in the route's audit call.
    var packBtn = document.getElementById('rpt-pack-btn');
    var packErr = document.getElementById('rpt-pack-error');
    if (packBtn) {
      var packBtnDefaultLabel = packBtn.textContent;
      packBtn.addEventListener('click', function () {
        packBtn.disabled = true;
        packBtn.textContent = 'Generating pack…';
        // T-07-32/07-UI-SPEC.md §7: the browser's own active language is the
        // ENTIRE request surface this fetch supplies — the server has no
        // other way to learn it, since it never persists a per-user
        // language preference. Shares the 'employeeLanguage' storage key
        // transitions.js's own i18n bootstrap already reads/writes.
        var lang = localStorage.getItem('employeeLanguage') || 'en';
        fetch('/api/reports/pack?lang=' + encodeURIComponent(lang))
          .then(function (res) {
            if (!res.ok) {
              return res.json().catch(function () { return {}; }).then(function (body) {
                throw new Error((body && body.error) || 'Failed to generate the pack.');
              });
            }
            // WR-02 fix (07-REVIEW.md): lib/reportFilename.js's
            // setContentDisposition() emits BOTH an RFC 5987 extended
            // filename*=UTF-8''... parameter (for non-ASCII codenames, e.g.
            // 中文/Müller) and an ASCII filename="..." fallback, with the
            // ASCII form appearing FIRST in the header. Try the extended
            // parameter first so non-ASCII codenames survive into the
            // downloaded filename; only fall back to the ASCII match (or
            // the literal default) if the extended parameter is absent or
            // malformed. decodeURIComponent is wrapped in try/catch so a
            // malformed extended parameter can never throw — it just falls
            // through to the ASCII match instead.
            var disposition = res.headers.get('content-disposition') || '';
            var extMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
            var asciiMatch = /filename="([^"]*)"/i.exec(disposition);
            var filename = 'steerco-pack.pdf';
            if (extMatch) {
              try {
                filename = decodeURIComponent(extMatch[1]);
              } catch (e) {
                filename = asciiMatch ? asciiMatch[1] : 'steerco-pack.pdf';
              }
            } else if (asciiMatch) {
              filename = asciiMatch[1];
            }
            return res.blob().then(function (blob) { return { blob: blob, filename: filename }; });
          })
          .then(function (result) {
            // The download itself is the success confirmation — no toast
            // (07-UI-SPEC.md §7). fetch() responses aren't navigable URLs a
            // browser can download directly, so a temporary anchor's
            // synthetic click is the standard blob-download pattern.
            var url = URL.createObjectURL(result.blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = result.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (packErr) { packErr.textContent = ''; packErr.style.display = 'none'; }
          })
          .catch(function (e) {
            // Copywriting Contract / the Phase-4-Wave-7 invisible-error
            // countermeasure: an explicit visible display value, NEVER an
            // empty-string reset (that reverts to the stylesheet's `display:
            // none` rule and makes the message invisible while every
            // source-level test still passes — this exact failure has
            // already shipped twice on this project and been fixed twice).
            // #rpt-pack-error is revealed with an EXPLICIT visible value.
            if (packErr) {
              packErr.textContent = (e && e.message) || 'Failed to generate the pack.';
              packErr.style.display = 'block';
            }
          })
          .then(function () {
            packBtn.disabled = false;
            packBtn.textContent = packBtnDefaultLabel;
          });
      });
    }
  }

  load().then(function () { wireControls(); wireExtraControls(); render(); renderSynergy(); renderRaid(); })
    .catch(function (e) { console.error('Execution hub load failed:', e); });
})();
