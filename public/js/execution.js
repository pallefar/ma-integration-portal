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

  var state = { tasks: [], template: null, wsFilter: null, synergies: [], raid: [], raidFilter: null };

  var SYN_STATUSES = ['identified', 'validated', 'planned', 'executing', 'realized'];
  var SYN_LABELS = { identified: 'Identified', validated: 'Validated', planned: 'Planned', executing: 'Executing', realized: 'Realized' };
  var SYN_COLORS = { identified: '#8a8f92', validated: '#475569', planned: '#C77700', executing: '#167987', realized: '#3f7a37' };
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
      fetch('/api/raid').then(function (r) { return r.json(); }).catch(function () { return []; })
    ]).then(function (res) {
      state.tasks = Array.isArray(res[0]) ? res[0] : [];
      state.template = (Array.isArray(res[1]) && res[1][0]) || null;
      state.synergies = Array.isArray(res[2]) ? res[2] : [];
      state.raid = Array.isArray(res[3]) ? res[3] : [];
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

  // ---------------------------------------------------------------- synergy
  function renderSynergy() {
    var list = state.synergies;
    var target = list.reduce(function (a, s) { return a + (s.targetM || 0); }, 0);
    var realized = list.reduce(function (a, s) { return a + (s.realizedM || 0); }, 0);
    var pct = target > 0 ? Math.round((realized / target) * 100) : 0;
    document.getElementById('syn-rollup').innerHTML = '<div class="syn-card" style="border-top:4px solid var(--te-orange);">'
      + '<div style="display:flex;align-items:center;gap:2rem;flex-wrap:wrap;">'
      + '<div><div style="font-size:.72rem;font-weight:800;text-transform:uppercase;color:var(--text-dim);" data-i18n="syn.total_realized">Realized</div>'
      + '<div style="font-size:1.6rem;font-weight:800;color:var(--te-dark-teal);">$' + realized.toFixed(1) + 'M</div></div>'
      + '<div><div style="font-size:.72rem;font-weight:800;text-transform:uppercase;color:var(--text-dim);" data-i18n="syn.total_target">Deal target</div>'
      + '<div style="font-size:1.6rem;font-weight:800;color:var(--text-secondary);">$' + target.toFixed(1) + 'M</div></div>'
      + '<div style="flex:1;min-width:200px;"><div style="font-size:.72rem;font-weight:800;color:var(--text-dim);margin-bottom:.3rem;">' + pct + '% <span data-i18n="syn.of_target">of target</span></div>'
      + '<div class="syn-track" style="margin-top:0;height:12px;"><div class="syn-fill" style="width:' + Math.min(pct, 100) + '%"></div></div></div>'
      + '</div></div>';

    document.getElementById('syn-list').innerHTML = list.map(function (s) {
      var p = s.targetM > 0 ? Math.round(((s.realizedM || 0) / s.targetM) * 100) : 0;
      var wsDef = workstreams().find(function (w) { return w.id === s.workstreamId; });
      return '<div class="syn-card" data-syn="' + esc(s.id) + '">'
        + '<div class="syn-head"><div style="flex:1;min-width:0;"><div class="syn-title">' + esc(s.title) + '</div>'
        + '<div class="syn-meta">'
        + '<span class="syn-cat ' + esc(s.category) + '" data-i18n="syn.cat_' + esc(s.category) + '">' + (s.category === 'cost' ? 'Cost' : 'Revenue') + '</span>'
        + '<button class="ex-status syn-status" style="background:' + (SYN_COLORS[s.status] || '#8a8f92') + ';min-width:96px;" data-i18n="syn.st_' + esc(s.status) + '">' + (SYN_LABELS[s.status] || s.status) + '</button>'
        + (wsDef ? '<span>' + (wsDef.icon || '') + ' <span data-i18n="' + esc(wsDef.labelKey || '') + '">' + esc(wsDef.label) + '</span></span>' : '')
        + (s.owner ? '<span>👤 ' + esc(s.owner) + '</span>' : '')
        + '<span><span data-i18n="syn.realized_lbl">Realized $M</span>: <input type="number" class="syn-realized-input" min="0" step="0.1" value="' + (s.realizedM || 0) + '"></span>'
        + '</div></div>'
        + '<div class="syn-money"><div class="syn-realized">$' + (s.realizedM || 0) + 'M</div><div class="syn-target">/ $' + (s.targetM || 0) + 'M</div></div>'
        + '<button class="ex-del" title="✕">✕</button>'
        + '</div>'
        + '<div class="syn-track"><div class="syn-fill" style="width:' + Math.min(p, 100) + '%"></div></div>'
        + '</div>';
    }).join('');

    document.querySelectorAll('#syn-list .syn-card').forEach(function (card) {
      var id = card.getAttribute('data-syn');
      card.querySelector('.syn-status').addEventListener('click', function () {
        var item = state.synergies.find(function (s) { return s.id === id; });
        if (!item) return;
        var next = SYN_STATUSES[(SYN_STATUSES.indexOf(item.status) + 1) % SYN_STATUSES.length];
        fetch('/api/synergies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, status: next }) })
          .then(function (r) { return r.json(); })
          .then(function (res) { if (res && res.success) { item.status = next; renderSynergy(); applyI18n(); } });
      });
      card.querySelector('.syn-realized-input').addEventListener('change', function (ev) {
        var val = parseFloat(ev.target.value) || 0;
        fetch('/api/synergies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, realizedM: val }) })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.success) {
              var item = state.synergies.find(function (s) { return s.id === id; });
              if (item) item.realizedM = res.initiative.realizedM;
              renderSynergy(); applyI18n();
            }
          });
      });
      card.querySelector('.ex-del').addEventListener('click', function () {
        if (!window.confirm('Delete this initiative?')) return;
        fetch('/api/synergies/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.success) {
              state.synergies = state.synergies.filter(function (s) { return s.id !== id; });
              renderSynergy(); applyI18n();
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
        fetch('/api/raid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, status: next }) })
          .then(function (r) { return r.json(); })
          .then(function (res) { if (res && res.success) { item.status = next; renderRaid(); } });
      });
      row.querySelector('.ex-del').addEventListener('click', function () {
        if (!window.confirm('Delete this entry?')) return;
        fetch('/api/raid/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.success) {
              state.raid = state.raid.filter(function (x) { return x.id !== id; });
              renderRaid();
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
        ['tasks', 'synergy', 'raid'].forEach(function (p) {
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
  }

  load().then(function () { wireControls(); wireExtraControls(); render(); renderSynergy(); renderRaid(); })
    .catch(function (e) { console.error('Execution hub load failed:', e); });
})();
