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

  var PHASES = ['pre', 'day1', 'd30', 'd60', 'd100'];
  var PHASE_LABELS = { pre: 'Pre-close', day1: 'Day 1', d30: 'Day 30', d60: 'Day 60', d100: 'Day 100' };
  var STATUS_ORDER = ['todo', 'doing', 'blocked', 'done'];
  var STATUS_META = {
    todo: { label: 'To do', color: '#8a8f92' },
    doing: { label: 'In progress', color: '#167987' },
    blocked: { label: 'Blocked', color: '#C0392B' },
    done: { label: 'Done', color: '#3f7a37' }
  };

  var state = { tasks: [], template: null, wsFilter: null };

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
      fetch('/api/checklist-templates').then(function (r) { return r.json(); })
    ]).then(function (res) {
      state.tasks = Array.isArray(res[0]) ? res[0] : [];
      state.template = (Array.isArray(res[1]) && res[1][0]) || null;
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
        fetch('/api/integration-tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, status: next })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.success) { task.status = next; render(); }
        }).catch(function (e) { console.error('status update failed', e); });
      });
      row.querySelector('.ex-del').addEventListener('click', function () {
        var msg = (window.__assessDict && null) || 'Delete this task?';
        if (!window.confirm(msg)) return;
        fetch('/api/integration-tasks/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.success) {
              state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
              render();
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

  load().then(function () { wireControls(); render(); })
    .catch(function (e) { console.error('Execution hub load failed:', e); });
})();
