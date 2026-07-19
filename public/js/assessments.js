/**
 * Readiness Assessment Center — template-driven wizards + scorecards.
 * Templates and scoring come from the server (/api/assessment-templates,
 * /api/assessment-instances, /api/assessment-status); the client renders
 * whatever the active project's templates define — nothing is hardcoded.
 */
(function () {
  'use strict';

  var esc = window.AssessCharts.esc;
  var C = window.AssessCharts;

  var state = {
    templates: [],
    status: null,
    instancesByTpl: {},   // templateId -> sorted instance list (oldest → newest)
    wizard: {}            // subject -> { tpl, step, answers }
  };

  var SUBJECT_TABS = { 'acquirer-org': 'acquirer', 'target-org': 'target', 'integration-leader': 'leader' };

  function t(key, fallback) {
    // read from the shared portal dictionary when loaded; fall back to inline EN
    try {
      var lang = localStorage.getItem('employeeLanguage') || 'en';
      if (window.__assessDict) {
        var s = window.__assessDict.strings || {};
        return (s[lang] && s[lang][key]) || (s.en && s.en[key]) || fallback;
      }
    } catch (e) {}
    return fallback;
  }

  function applyI18n() { if (window.applyPortalI18n) window.applyPortalI18n(); }

  // Anonymous workforce sentiment from pulses: mean rating (1–5 → 0–100) with an
  // n≥5 anonymity floor — shown alongside, never blended into, assessed scores.
  function sentimentStats() {
    var pulses = (state.pulses || []).filter(function (p) { return typeof p.rating === 'number' && p.rating > 0; });
    if (!pulses.length) return { n: 0, score: null };
    var mean = pulses.reduce(function (a, p) { return a + p.rating; }, 0) / pulses.length;
    return { n: pulses.length, score: Math.round(((mean - 1) / 4) * 100) };
  }

  function sentimentTileHtml() {
    var s = sentimentStats();
    var inner;
    if (s.n >= 5 && s.score != null) {
      inner = '<span style="font-weight:800;font-size:1.05rem;color:' + C.scoreBandColor(s.score) + '">' + s.score + '</span>'
        + ' <span style="font-size:.74rem;color:var(--text-dim);">(' + s.n + ' <span data-i18n="assess.sentiment_n">responses</span>)</span>';
    } else {
      inner = '<span style="font-size:.8rem;color:var(--text-dim);" data-i18n="assess.sentiment_low_n">Fewer than 5 responses — the aggregate appears once more arrive.</span>';
    }
    return '<div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;border-top:1px dashed var(--border-color);margin-top:1.1rem;padding-top:.9rem;">'
      + '<span style="font-size:.8rem;font-weight:800;color:var(--te-dark-teal);">💬 <span data-i18n="assess.sentiment_title">Workforce sentiment</span></span>'
      + inner
      + '<span style="font-size:.7rem;color:var(--text-dim);font-style:italic;flex-basis:100%;" data-i18n="assess.sentiment_hint">From anonymous employee pulses — displayed alongside, never blended into, assessed scores.</span>'
      + '</div>';
  }

  function bandLabelSpan(bandId) {
    return '<span data-i18n="assess.band_' + esc(bandId) + '">' + esc(bandId === 'ready' ? 'Ready' : bandId === 'support' ? 'Ready with support' : 'At risk') + '</span>';
  }

  function fmtDate(iso) {
    try {
      var lang = localStorage.getItem('employeeLanguage') || 'en';
      return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : lang, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return String(iso || '').slice(0, 10); }
  }

  function tplBySubject(subject) {
    return state.templates.find(function (x) { return x.subject === subject; }) || null;
  }
  function raterList(tplId, rater) {
    return (state.instancesByTpl[tplId] || []).filter(function (i) { return (i.rater || 'self') === rater; });
  }
  function latestFor(tplId, rater) {
    var list = raterList(tplId, rater || 'self');
    return list.length ? list[list.length - 1] : null;
  }
  function previousFor(tplId, rater) {
    var list = raterList(tplId, rater || 'self');
    return list.length > 1 ? list[list.length - 2] : null;
  }

  // ---------------------------------------------------------------- data
  function loadAll() {
    return Promise.all([
      fetch('/api/assessment-templates').then(function (r) { return r.json(); }),
      fetch('/api/assessment-status').then(function (r) { return r.json(); }),
      fetch('/api/pulses').then(function (r) { return r.json(); }).catch(function () { return []; })
    ]).then(function (res) {
      state.templates = Array.isArray(res[0]) ? res[0] : [];
      state.status = res[1] || {};
      state.pulses = Array.isArray(res[2]) ? res[2] : [];
      return Promise.all(state.templates.map(function (tpl) {
        return fetch('/api/assessment-instances?templateId=' + encodeURIComponent(tpl.id))
          .then(function (r) { return r.json(); })
          .catch(function () { return []; })
          .then(function (list) {
            if (!Array.isArray(list)) list = []; // e.g. 401 when ADMIN_TOKEN gates the record list
            list.sort(function (a, b) {
              var d = (a.demoDay || 0) - (b.demoDay || 0);
              return d !== 0 ? d : String(a.timestamp).localeCompare(String(b.timestamp));
            });
            // Record list unavailable (locked-down deployment): fall back to the
            // open status rollup so the scorecard still renders (no trend).
            if (!list.length && state.status && state.status.bySubject) {
              var entry = state.status.bySubject[tpl.subject];
              if (entry && entry.latestInstance && entry.latestInstance.templateId === tpl.id) {
                list = [entry.latestInstance];
              }
            }
            state.instancesByTpl[tpl.id] = list;
          });
      }));
    });
  }

  // ---------------------------------------------------------------- overview
  function renderOverview() {
    var el = document.getElementById('as-pane-overview');
    var cards = state.templates.map(function (tpl) {
      var latest = latestFor(tpl.id);
      var tab = SUBJECT_TABS[tpl.subject];
      var statusChip = latest
        ? '<span class="as-chip as-chip-green"><span data-i18n="assess.status_done">Completed</span> · ' + latest.overallScore + '</span>'
        : '<span class="as-chip as-chip-grey" data-i18n="assess.status_pending">Not yet completed</span>';
      var ring = latest ? C.scoreRing(latest.overallScore, null, 54) : '';
      var band = latest && latest.bandId
        ? '<span class="as-band-badge" style="background:' + C.bandColor(latest.bandId) + ';margin-top:.2rem;font-size:.7rem;padding:.2rem .6rem;">' + bandLabelSpan(latest.bandId) + '</span>'
        : '';
      return '<div class="as-req-card">'
        + '<div class="as-req-head"><div><div class="as-req-name" data-i18n="' + esc(tpl.titleKey || '') + '">' + esc(tpl.title) + '</div>'
        + '<div class="as-req-sub">' + (tpl.required ? '<span class="as-chip as-chip-req" data-i18n="assess.required_chip">Required</span> ' : '')
        + '<span data-i18n="assess.gate_note">Feeds phase gates</span></div>'
        + '<div style="margin-top:.4rem;">' + statusChip + '</div>' + band + '</div>' + ring + '</div>'
        + '<div class="as-req-foot">'
        + (latest
          ? '<button class="btn btn-secondary as-goto" data-tab="' + tab + '" style="font-size:.8rem;padding:.45rem .9rem;" data-i18n="assess.btn_view">View scorecard</button>'
          : '<button class="btn btn-primary as-goto" data-tab="' + tab + '" style="font-size:.8rem;padding:.45rem .9rem;" data-i18n="assess.btn_start">Start assessment</button>')
        + (latest ? '<span style="font-size:.72rem;color:var(--text-dim);"><span data-i18n="assess.last_taken">Last taken</span>: ' + fmtDate(latest.timestamp) + '</span>' : '')
        + '</div></div>';
    }).join('');
    el.innerHTML = '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.1rem;">'
      + '<p style="color:var(--text-secondary);margin:0;font-size:.92rem;max-width:720px;line-height:1.55;" data-i18n="assess.overview_intro">Required readiness assessments for this integration. Complete each one — the scores unlock phase gates and drive the coaching plan.</p>'
      + '<button class="btn btn-secondary" id="as-readout-btn" style="font-size:.8rem;padding:.5rem 1rem;flex:none;">🖨 <span data-i18n="assess.readout_btn">Exec readout (print/PDF)</span></button>'
      + '</div>'
      + '<div class="as-req-grid">' + cards + '</div>'
      + '<p class="as-note" data-i18n="assess.n1_note">Structured judgment by 1 rater — a facilitated read of readiness, not a statistical instrument.</p>';
    el.querySelectorAll('.as-goto').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });
    var ro = el.querySelector('#as-readout-btn');
    if (ro) ro.addEventListener('click', printReadout);
    applyI18n();
  }

  // ---------------------------------------------------------------- exec readout
  // Builds a one-page printable summary and opens the browser print dialog
  // (print CSS in assessments.html shows only #as-readout). PDF = print to PDF.
  function printReadout() {
    var old = document.getElementById('as-readout');
    if (old) old.remove();
    var by = (state.status || {}).bySubject || {};
    var compat = ((state.status || {}).compatibility || [])[0];
    var acq = by['acquirer-org'] && by['acquirer-org'].latestInstance;
    var tgt = by['target-org'] && by['target-org'].latestInstance;
    var ilTpl = tplBySubject('integration-leader');
    var il = ilTpl ? latestFor(ilTpl.id, 'self') : null;
    var sent = sentimentStats();
    var lang = localStorage.getItem('employeeLanguage') || 'en';
    var today = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : lang, { year: 'numeric', month: 'long', day: 'numeric' });

    var ringCell = function (labelKey, labelEn, score, bandId) {
      var col = score == null ? '#9aa4ab' : C.scoreBandColor(score);
      return '<td style="text-align:center;padding:10px;">'
        + '<div style="width:74px;height:74px;border-radius:50%;background:' + col + ';color:#fff;font-weight:800;font-size:24px;display:flex;align-items:center;justify-content:center;margin:0 auto;print-color-adjust:exact;-webkit-print-color-adjust:exact;">' + (score == null ? '—' : score) + '</div>'
        + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#555;margin-top:6px;" data-i18n="' + labelKey + '">' + labelEn + '</div>'
        + (bandId ? '<div style="font-size:11px;font-weight:800;color:' + C.bandColor(bandId) + ';">' + t('assess.band_' + bandId, bandId) + '</div>' : '')
        + '</td>';
    };
    var pairRows = compat && compat.complete ? compat.dims.map(function (d) {
      return '<tr><td style="padding:5px 8px;border-bottom:1px solid #e3e6e8;">' + (d.icon || '') + ' ' + esc(t(d.labelKey, d.label)) + '</td>'
        + '<td style="text-align:center;padding:5px 8px;border-bottom:1px solid #e3e6e8;font-weight:700;color:#167987;">' + d.acquirer + '</td>'
        + '<td style="text-align:center;padding:5px 8px;border-bottom:1px solid #e3e6e8;font-weight:700;color:#C77700;">' + d.target + '</td>'
        + '<td style="text-align:center;padding:5px 8px;border-bottom:1px solid #e3e6e8;font-weight:800;color:' + ((compat.topGaps || []).indexOf(d.mirrorId) > -1 ? '#C0392B' : '#555') + ';">Δ ' + d.gap + '</td></tr>';
    }).join('') : '';
    var ilLow = (il && ilTpl) ? (ilTpl.dimensions || [])
      .map(function (d) { return { d: d, s: (il.dimensionScores || {})[d.id] }; })
      .filter(function (x) { return typeof x.s === 'number' && x.s < 80; })
      .sort(function (a, b) { return a.s - b.s; }).slice(0, 3) : [];

    var div = document.createElement('div');
    div.id = 'as-readout';
    div.innerHTML = '<div style="font-family:inherit;color:#1c2b33;">'
      + '<table style="width:100%;border-collapse:collapse;"><tr>'
      + '<td><img src="/te-logo.png" style="height:34px;" alt="TE"></td>'
      + '<td style="text-align:right;font-size:11px;color:#555;"><span data-i18n="assess.readout_generated">Generated</span>: ' + today + '</td>'
      + '</tr></table>'
      + '<h1 style="font-size:21px;margin:14px 0 2px;color:#244C5A;" data-i18n="assess.readout_title">Integration Readiness Readout</h1>'
      + '<div style="font-size:12px;color:#555;margin-bottom:14px;">' + esc((state.status && state.status.targetCompany) || document.title.split(' - ')[0] || '') + '</div>'
      + '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;"><tr>'
      + ringCell('assess.kpi_acquirer', 'Acquirer (TE)', acq ? acq.overallScore : null, acq && acq.bandId)
      + ringCell('assess.compat_alignment', 'Alignment', compat && compat.complete ? compat.alignment : null, compat && compat.complete ? compat.fitBand : null)
      + ringCell('assess.kpi_target', 'Target', tgt ? tgt.overallScore : null, tgt && tgt.bandId)
      + ringCell('assess.tab_leader', 'Integration Leader', il ? il.overallScore : null, il && il.bandId)
      + '</tr></table>'
      + (pairRows
        ? '<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#E98300;margin:14px 0 6px;" data-i18n="assess.readout_pair">Company readiness — TE vs Target</h2>'
          + '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
          + '<tr style="font-size:10.5px;text-transform:uppercase;color:#777;"><th style="text-align:left;padding:4px 8px;" data-i18n="assess.readout_dim">Dimension</th><th style="padding:4px 8px;">TE</th><th style="padding:4px 8px;" data-i18n="assess.kpi_target">Target</th><th style="padding:4px 8px;" data-i18n="assess.readout_gap">Gap</th></tr>'
          + pairRows + '</table>'
        : '')
      + (il
        ? '<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#E98300;margin:14px 0 6px;" data-i18n="assess.tab_leader">Integration Leader</h2>'
          + '<div style="font-size:12px;line-height:1.6;">' + esc(il.respondentName || '') + ' — <strong style="color:' + C.bandColor(il.bandId) + '">' + t('assess.band_' + il.bandId, il.bandId) + '</strong>'
          + (il.experienceIndex != null ? ' · <span data-i18n="assess.il_exp">Experience index</span> ' + il.experienceIndex : '')
          + (ilLow.length ? '<br><span data-i18n="assess.plan_title">Development plan</span>: ' + ilLow.map(function (x) { return esc(t(x.d.labelKey, x.d.label)) + ' (' + x.s + ')'; }).join(' · ') : '')
          + '</div>'
        : '')
      + (sent.n >= 5 && sent.score != null
        ? '<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#E98300;margin:14px 0 6px;" data-i18n="assess.sentiment_title">Workforce sentiment</h2>'
          + '<div style="font-size:12px;">' + sent.score + ' / 100 (' + sent.n + ' <span data-i18n="assess.sentiment_n">responses</span>)</div>'
        : '')
      + '<div style="font-size:9.5px;color:#888;font-style:italic;margin-top:16px;border-top:1px solid #ddd;padding-top:8px;">'
      + '<span data-i18n="assess.n1_note">Structured judgment by 1 rater — a facilitated read of readiness, not a statistical instrument.</span> '
      + '<span data-i18n="assess.compat_note">Alignment measures how closely the two readiness profiles match. The fit band is capped by the weaker company\'s readiness.</span>'
      + '</div>'
      + '</div>';
    document.body.appendChild(div);
    applyI18n();
    setTimeout(function () { window.print(); }, 120);
  }

  // ---------------------------------------------------------------- scorecard
  function renderScorecard(subject) {
    var tpl = tplBySubject(subject);
    var el = document.getElementById('as-pane-' + SUBJECT_TABS[subject]);
    if (!tpl) { el.innerHTML = ''; return; }
    var latest = latestFor(tpl.id);
    if (!latest) { renderIntro(subject); return; }
    var prev = previousFor(tpl.id);

    var scoredDims = (tpl.dimensions || []).filter(function (d) { return (latest.dimensionScores || {})[d.id] != null; });
    var axes = scoredDims.map(function (d) { return { id: d.id, label: d.label }; });
    var series = [{ label: tpl.title, color: subject === 'acquirer-org' ? '#167987' : '#E98300', values: latest.dimensionScores || {} }];
    var bars = (tpl.dimensions || []).map(function (d) {
      var sc = (latest.dimensionScores || {})[d.id];
      if (sc == null) return '';
      var delta = prev && prev.dimensionScores && typeof prev.dimensionScores[d.id] === 'number' ? sc - prev.dimensionScores[d.id] : undefined;
      return C.gaugeBar({
        label: d.label, labelKey: d.labelKey, icon: d.iconEmoji, score: sc, delta: delta,
        redFlag: (latest.redFlags || []).indexOf(d.id) > -1,
        focus: sc < 70 && (latest.redFlags || []).indexOf(d.id) === -1
      });
    }).join('');

    var remedCards = (tpl.remediation || []).filter(function (r) {
      var sc = (latest.dimensionScores || {})[r.dimensionId];
      return typeof sc === 'number' && sc < 80;
    }).map(function (r) {
      var dim = (tpl.dimensions || []).find(function (d) { return d.id === r.dimensionId; }) || {};
      return '<div class="as-remed"><div class="d">' + (dim.iconEmoji || '') + ' <span data-i18n="' + esc(dim.labelKey || '') + '">' + esc(dim.label || r.dimensionId) + '</span></div>'
        + '<p data-i18n="' + esc(r.adviceKey || '') + '">' + esc(r.advice || '') + '</p></div>';
    }).join('');

    var overallDelta = prev ? latest.overallScore - prev.overallScore : 0;
    var trendHtml = prev
      ? '<span class="as-delta ' + (overallDelta >= 0 ? 'up' : 'down') + '" style="font-size:.85rem;">' + (overallDelta >= 0 ? '▲' : '▼') + Math.abs(overallDelta) + ' <span data-i18n="assess.trend">vs. previous</span></span>'
      : '';

    el.innerHTML = '<div class="as-card">'
      + '<div class="as-sc-top">'
      + C.scoreRing(latest.overallScore, '<span data-i18n="assess.overall">Overall readiness</span>', 84)
      + '<div class="as-sc-meta"><h2 class="as-sc-title" data-i18n="' + esc(tpl.titleKey || '') + '">' + esc(tpl.title) + '</h2>'
      + '<div class="as-sc-info">'
      + (latest.respondentName ? '<span><span data-i18n="assess.taken_by">Taken by</span>: ' + esc(latest.respondentName) + '</span>' : '')
      + '<span><span data-i18n="assess.last_taken">Last taken</span>: ' + fmtDate(latest.timestamp) + '</span>'
      + (trendHtml ? '<span>' + trendHtml + '</span>' : '')
      + '</div>'
      + (latest.bandId ? '<span class="as-band-badge" style="background:' + C.bandColor(latest.bandId) + '">' + bandLabelSpan(latest.bandId) + '</span>' : '')
      + (subject === 'integration-leader' && latest.experienceIndex != null
        ? '<span class="as-exp-chip" title="">🎖️ <span data-i18n="assess.il_exp">Experience index</span>: ' + latest.experienceIndex + '</span>'
        : '')
      + '</div>'
      + '<div class="as-actions"><button class="btn btn-secondary" id="as-retake-' + SUBJECT_TABS[subject] + '" style="font-size:.82rem;padding:.5rem 1rem;" data-i18n="assess.btn_retake">Retake assessment</button>'
      + (subject === 'integration-leader' && (tpl.raterModes || []).indexOf('manager') > -1
        ? '<button class="btn btn-secondary" id="as-invite-mgr" style="font-size:.82rem;padding:.5rem 1rem;" data-i18n="assess.il_invite">Add manager rating</button>'
        : '')
      + '</div>'
      + '</div>'
      + '<div class="as-sc-grid">'
      + '<div>' + C.radarSVG(axes, series) + '</div>'
      + '<div><h3 data-i18n="assess.dim_breakdown">Dimension breakdown</h3>' + bars + '</div>'
      + '</div>'
      + (subject === 'target-org' ? sentimentTileHtml() : '')
      + '</div>'
      + (subject === 'integration-leader' ? ilExtrasHtml(tpl, latest) : '')
      + (remedCards ? '<div class="as-card"><h3 data-i18n="assess.remediation">Recommended actions</h3>' + remedCards + '</div>' : '')
      + (subject === 'target-org' ? '<p class="as-note" data-i18n="assess.disclaimer_preclose">Sensitive: answers may contain competitively sensitive information about the target. Before legal close, complete this only with clean-team-approved information and involve Legal if unsure.</p>' : '')
      + '<p class="as-note" data-i18n="assess.n1_note">Structured judgment by 1 rater — a facilitated read of readiness, not a statistical instrument.</p>';

    var retake = el.querySelector('#as-retake-' + SUBJECT_TABS[subject]);
    if (retake) retake.addEventListener('click', function () { startWizard(subject, latest.id); });
    var invite = el.querySelector('#as-invite-mgr');
    if (invite) invite.addEventListener('click', function () { startWizard(subject, null, 'manager'); });
    el.querySelectorAll('.as-plan-add').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-task-id'), label = b.getAttribute('data-task-label');
        var tasks = [];
        try { tasks = JSON.parse(localStorage.getItem('ilStretchTasks') || '[]') || []; } catch (e) {}
        if (!tasks.some(function (x) { return x.id === id; })) tasks.push({ id: id, label: label });
        try { localStorage.setItem('ilStretchTasks', JSON.stringify(tasks)); } catch (e) {}
        b.textContent = t('assess.plan_added', 'Added ✓');
        b.disabled = true;
      });
    });
    applyI18n();
  }

  // Integration-Leader-only sections: self-vs-manager gap + 70-20-10 development plan
  function ilExtrasHtml(tpl, latest) {
    var html = '';
    // ~90-day re-assessment nudge
    var ageDays = (Date.now() - new Date(latest.timestamp).getTime()) / 86400000;
    if (ageDays >= 90) {
      html += '<div class="as-warn" data-i18n="assess.reassess_banner">It has been about 90 days since the last assessment — retake it to track progression.</div>';
    }
    // Self vs manager gap (dumbbell rows)
    var SELF_COL = '#E98300', MGR_COL = '#167987';
    var mgr = latestFor(tpl.id, 'manager');
    if (mgr) {
      var rows = (tpl.dimensions || []).map(function (d) {
        var s = (latest.dimensionScores || {})[d.id];
        var m = (mgr.dimensionScores || {})[d.id];
        if (s == null || m == null) return '';
        var lo = Math.min(s, m), hi = Math.max(s, m);
        return '<div class="as-db-row"><div class="as-dim-head"><span class="as-dim-name">' + (d.iconEmoji || '')
          + ' <span data-i18n="' + esc(d.labelKey || '') + '">' + esc(d.label) + '</span></span>'
          + '<span style="font-size:.74rem;font-weight:800;"><span style="color:' + SELF_COL + '">' + s + '</span> / <span style="color:' + MGR_COL + '">' + m + '</span></span></div>'
          + '<div class="as-db-track"><div class="as-db-line" style="left:' + lo + '%;width:' + Math.max(hi - lo, 0.5) + '%"></div>'
          + '<div class="as-db-dot" style="left:' + s + '%;background:' + SELF_COL + '"></div>'
          + '<div class="as-db-dot" style="left:' + m + '%;background:' + MGR_COL + '"></div></div></div>';
      }).join('');
      html += '<div class="as-card"><h3 data-i18n="assess.il_gap">Self vs. manager</h3>'
        + '<div class="as-radar-legend" style="justify-content:flex-start;margin:0 0 .9rem;">'
        + '<span class="as-radar-key"><span class="as-radar-swatch" style="background:' + SELF_COL + '"></span><span data-i18n="assess.rater_self">Self</span>' + (latest.respondentName ? ' · ' + esc(latest.respondentName) : '') + '</span>'
        + '<span class="as-radar-key"><span class="as-radar-swatch" style="background:' + MGR_COL + '"></span><span data-i18n="assess.rater_manager">Manager</span>' + (mgr.respondentName ? ' · ' + esc(mgr.respondentName) : '') + '</span>'
        + '</div>' + rows + '</div>';
    }
    // 70-20-10 development plan from the lowest sub-80 dimensions with remediation
    var low = (tpl.dimensions || [])
      .map(function (d) { return { d: d, score: (latest.dimensionScores || {})[d.id] }; })
      .filter(function (x) { return typeof x.score === 'number' && x.score < 80; })
      .sort(function (a, b) { return a.score - b.score; })
      .slice(0, 3)
      .map(function (x) {
        x.remed = (tpl.remediation || []).find(function (r) { return r.dimensionId === x.d.id; });
        return x;
      })
      .filter(function (x) { return !!x.remed; });
    if (low.length) {
      var expItems = low.map(function (x) {
        var taskId = 'il_stretch_' + x.d.id;
        return '<div class="as-plan-item">' + (x.d.iconEmoji || '') + ' <strong data-i18n="' + esc(x.d.labelKey || '') + '">' + esc(x.d.label) + '</strong> (' + x.score + ')<br>'
          + '<span data-i18n="' + esc(x.remed.adviceKey || '') + '">' + esc(x.remed.advice || '') + '</span><br>'
          + '<button class="btn btn-secondary as-plan-add" data-task-id="' + esc(taskId) + '" data-task-label="' + esc(x.remed.advice || '') + '" style="font-size:.72rem;padding:.3rem .7rem;" data-i18n="assess.plan_add">Add to checklist</button></div>';
      }).join('');
      html += '<div class="as-card"><h3 data-i18n="assess.plan_title">Development plan</h3>'
        + '<p style="font-size:.82rem;color:var(--text-secondary);margin:0 0 .9rem;" data-i18n="assess.plan_sub">Auto-generated from the lowest dimensions, following the 70-20-10 model.</p>'
        + '<div class="as-plan-grid">'
        + '<div class="as-plan-col"><h4 data-i18n="assess.plan_70">70% · Experiential</h4>' + expItems + '</div>'
        + '<div class="as-plan-col"><h4 data-i18n="assess.plan_20">20% · Social — coaching</h4>'
        + '<p class="as-plan-item" style="color:var(--text-secondary);">' + low.map(function (x) { return (x.d.iconEmoji || ''); }).join(' ') + '</p>'
        + '<a href="/dashboard.html#tab-coaching-track" class="btn btn-secondary" style="font-size:.78rem;padding:.4rem .85rem;" data-i18n="assess.plan_open_coaching">Open Coaching Desk</a></div>'
        + '<div class="as-plan-col"><h4 data-i18n="assess.plan_10">10% · Formal — academy</h4>'
        + '<p class="as-plan-item" style="color:var(--text-secondary);">' + low.map(function (x) { return ((x.remed.academyModuleIds || []).length ? '📚' : ''); }).join(' ') + '</p>'
        + '<a href="/dashboard.html#tab-il-academy" class="btn btn-secondary" style="font-size:.78rem;padding:.4rem .85rem;" data-i18n="assess.plan_open_academy">Open IL Academy</a></div>'
        + '</div></div>';
    } else {
      html += '<div class="as-card"><h3 data-i18n="assess.plan_title">Development plan</h3>'
        + '<p style="font-size:.85rem;color:var(--text-secondary);margin:0;" data-i18n="assess.plan_none">All dimensions at Ready — no development plan needed. Re-assess in ~90 days.</p></div>';
    }
    return html;
  }

  function renderIntro(subject) {
    var tpl = tplBySubject(subject);
    var el = document.getElementById('as-pane-' + SUBJECT_TABS[subject]);
    el.innerHTML = '<div class="as-card" style="max-width:760px;">'
      + '<h2 class="as-sc-title" data-i18n="' + esc(tpl.titleKey || '') + '">' + esc(tpl.title) + '</h2>'
      + '<p style="color:var(--text-secondary);line-height:1.6;font-size:.92rem;margin:.6rem 0 1rem;">'
      + '<span class="as-chip as-chip-req" data-i18n="assess.required_chip">Required</span> '
      + '<span data-i18n="assess.gate_note">Feeds phase gates</span></p>'
      + (subject === 'target-org' ? '<div class="as-warn" data-i18n="assess.disclaimer_preclose">Sensitive: answers may contain competitively sensitive information about the target. Before legal close, complete this only with clean-team-approved information and involve Legal if unsure.</div>' : '')
      + '<button class="btn btn-primary" id="as-start-' + SUBJECT_TABS[subject] + '" data-i18n="assess.btn_start">Start assessment</button>'
      + '</div>';
    el.querySelector('#as-start-' + SUBJECT_TABS[subject]).addEventListener('click', function () { startWizard(subject); });
    applyI18n();
  }

  // ---------------------------------------------------------------- wizard
  function startWizard(subject, retakeOf, rater) {
    var tpl = tplBySubject(subject);
    if (!tpl) return;
    state.wizard[subject] = { tpl: tpl, step: 0, answers: {}, retakeOf: retakeOf || null, rater: rater || 'self', name: '' };
    renderWizardStep(subject);
  }

  function wizardDims(wz) {
    // Manager raters skip evidence-checkbox-only dimensions (experience inventory
    // is self-reported); everyone else sees the full template.
    return (wz.tpl.dimensions || []).filter(function (d) {
      if (wz.rater !== 'manager') return true;
      return (d.questions || []).some(function (q) { return q.type !== 'checkbox'; });
    });
  }

  function renderWizardStep(subject) {
    var wz = state.wizard[subject];
    var tpl = wz.tpl;
    var el = document.getElementById('as-pane-' + SUBJECT_TABS[subject]);
    var dims = wizardDims(wz);
    var dim = dims[wz.step];
    var pct = Math.round(((wz.step) / dims.length) * 100);

    var qHtml = (dim.questions || []).map(function (q) {
      var chosen = wz.answers[q.id];
      if (q.type === 'checkbox') {
        return '<button type="button" class="as-cb' + (chosen === true ? ' sel' : '') + '" data-q="' + esc(q.id) + '" data-cb="1">'
          + '<span class="box">' + (chosen === true ? '✓' : '') + '</span>'
          + '<span data-i18n="' + esc(q.textKey || '') + '">' + esc(q.text) + '</span></button>';
      }
      if (q.type === 'sjt') {
        return '<div class="as-q" data-q="' + esc(q.id) + '"><div class="as-q-text" data-i18n="' + esc(q.textKey || '') + '">' + esc(q.text) + '</div>'
          + '<div style="font-size:.72rem;color:var(--text-dim);margin-bottom:.4rem;" data-i18n="assess.select_option">Select the closest answer</div>'
          + (q.options || []).map(function (o, i) {
            return '<button type="button" class="as-opt' + (chosen === i ? ' sel' : '') + '" data-q="' + esc(q.id) + '" data-val="' + i + '"><span data-i18n="' + esc(o.textKey || '') + '">' + esc(o.text) + '</span></button>';
          }).join('') + '</div>';
      }
      if (q.type === 'maturity') {
        return '<div class="as-q" data-q="' + esc(q.id) + '"><div class="as-q-text" data-i18n="' + esc(q.textKey || '') + '">' + esc(q.text) + '</div>'
          + '<div style="font-size:.72rem;color:var(--text-dim);margin-bottom:.4rem;" data-i18n="assess.maturity_label">Maturity level</div>'
          + [1, 2, 3, 4, 5].map(function (lvl) {
            return '<button type="button" class="as-opt' + (chosen === lvl ? ' sel' : '') + '" data-q="' + esc(q.id) + '" data-val="' + lvl + '"><strong>' + lvl + '</strong> · <span data-i18n="assess.cmm_' + lvl + '">Level ' + lvl + '</span></button>';
          }).join('') + '</div>';
      }
      // likert
      return '<div class="as-q" data-q="' + esc(q.id) + '"><div class="as-q-text" data-i18n="' + esc(q.textKey || '') + '">' + esc(q.text) + '</div>'
        + '<div class="as-likert">' + [1, 2, 3, 4, 5].map(function (v) {
          return '<button type="button" class="as-lk' + (chosen === v ? ' sel' : '') + '" data-q="' + esc(q.id) + '" data-val="' + v + '" title="' + v + '">' + v + '</button>';
        }).join('') + '</div>'
        + '<div class="as-lk-anchors"><span data-i18n="assess.scale5_1">Strongly disagree</span><span data-i18n="assess.scale5_5">Strongly agree</span></div>'
        + '</div>';
    }).join('');

    var managerHead = wz.rater === 'manager'
      ? '<div style="margin-bottom:1.1rem;"><span class="as-chip as-chip-amber" data-i18n="assess.il_manager">Manager view</span>'
        + '<input type="text" id="as-wz-name" value="' + esc(wz.name) + '" data-i18n-ph="assess.manager_name_ph" placeholder="Manager name" style="margin-left:.6rem;padding:.4rem .7rem;border:1.5px solid var(--border-color);border-radius:8px;font-family:inherit;font-size:.85rem;"></div>'
      : '';

    el.innerHTML = '<div class="as-card as-wizard">'
      + '<div class="as-wz-head">'
      + '<h2 class="as-sc-title" style="font-size:1.15rem;" data-i18n="' + esc(tpl.titleKey || '') + '">' + esc(tpl.title) + '</h2>'
      + '<span class="as-wz-step"><span data-i18n="assess.section">Section</span> ' + (wz.step + 1) + '/' + dims.length + ' · ' + (dim.iconEmoji || '') + ' <span data-i18n="' + esc(dim.labelKey || '') + '">' + esc(dim.label) + '</span></span>'
      + '</div>'
      + '<div class="as-wz-bar"><div class="as-wz-fill" style="width:' + pct + '%"></div></div>'
      + managerHead
      + qHtml
      + '<div class="as-err" id="as-wz-err" data-i18n="assess.answer_all">Please answer every question in this section to continue.</div>'
      + '<div class="as-wz-nav">'
      + '<button class="btn btn-secondary" id="as-wz-back"' + (wz.step === 0 ? ' disabled' : '') + ' data-i18n="assess.btn_back">Back</button>'
      + '<button class="btn btn-primary" id="as-wz-next" data-i18n="' + (wz.step === dims.length - 1 ? 'assess.btn_submit' : 'assess.btn_next') + '">' + (wz.step === dims.length - 1 ? 'Submit & score' : 'Next') + '</button>'
      + '</div></div>';

    el.querySelectorAll('.as-lk, .as-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = b.getAttribute('data-q');
        wz.answers[q] = parseInt(b.getAttribute('data-val'), 10);
        var container = el.querySelector('.as-q[data-q="' + q + '"]');
        container.querySelectorAll('.as-lk, .as-opt').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        document.getElementById('as-wz-err').style.display = 'none';
      });
    });
    el.querySelectorAll('.as-cb').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = b.getAttribute('data-q');
        wz.answers[q] = wz.answers[q] !== true;
        b.classList.toggle('sel', wz.answers[q]);
        b.querySelector('.box').textContent = wz.answers[q] ? '✓' : '';
      });
    });
    var nameInput = el.querySelector('#as-wz-name');
    if (nameInput) nameInput.addEventListener('input', function () { wz.name = nameInput.value; });
    el.querySelector('#as-wz-back').addEventListener('click', function () {
      if (wz.step > 0) { wz.step--; renderWizardStep(subject); }
    });
    el.querySelector('#as-wz-next').addEventListener('click', function () {
      // Evidence checkboxes are optional; every rated question must be answered.
      var missing = (dim.questions || []).some(function (q) { return q.type !== 'checkbox' && wz.answers[q.id] === undefined; });
      if (missing) { document.getElementById('as-wz-err').style.display = 'block'; return; }
      if (wz.step < dims.length - 1) { wz.step++; renderWizardStep(subject); }
      else submitWizard(subject);
    });
    applyI18n();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function submitWizard(subject) {
    var wz = state.wizard[subject];
    var btn = document.getElementById('as-wz-next');
    if (btn) btn.disabled = true;
    fetch('/api/assessment-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: wz.tpl.id,
        rater: wz.rater || 'self',
        respondentName: wz.name || undefined,
        respondentRole: localStorage.getItem('active_demo_role') || '',
        responses: wz.answers,
        retakeOf: wz.retakeOf || undefined
      })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.success) throw new Error((res && res.error) || 'submit failed');
      delete state.wizard[subject];
      return loadAll();
    }).then(function () {
      renderScorecard(subject);
      renderOverview();
    }).catch(function (e) {
      console.error('Assessment submit failed:', e);
      if (btn) btn.disabled = false;
    });
  }

  // ---------------------------------------------------------------- compatibility
  function renderCompatibility() {
    var el = document.getElementById('as-pane-compat');
    if (!el) return;
    var compat = ((state.status || {}).compatibility || [])[0];
    if (!compat) { el.innerHTML = ''; return; }
    if (!compat.complete) {
      el.innerHTML = '<div class="as-card" style="max-width:760px;"><p style="margin:0;color:var(--text-secondary);line-height:1.6;" data-i18n="assess.compat_incomplete">Complete both the Acquirer and Target readiness assessments to unlock the compatibility view.</p></div>';
      applyI18n();
      return;
    }
    var ACQ_COL = '#167987', TGT_COL = '#E98300';
    var axes = compat.dims.map(function (d) { return { id: d.mirrorId, label: d.label }; });
    var acqVals = {}, tgtVals = {};
    compat.dims.forEach(function (d) { acqVals[d.mirrorId] = d.acquirer; tgtVals[d.mirrorId] = d.target; });
    var acqLbl = t('assess.kpi_acquirer', 'Acquirer (TE)');
    var tgtLbl = t('assess.kpi_target', 'Target');

    var pairRows = compat.dims.map(function (d) {
      var isTop = (compat.topGaps || []).indexOf(d.mirrorId) > -1;
      return '<div class="as-pair-row"><div class="as-pair-head">'
        + '<span class="as-pair-name">' + (d.icon || '') + ' <span data-i18n="' + esc(d.labelKey || '') + '">' + esc(d.label) + '</span></span>'
        + '<span class="as-pair-gap" style="color:' + (isTop ? '#C77700' : 'var(--text-dim)') + '">Δ ' + d.gap
        + (isTop ? ' · <span data-i18n="assess.focus_area">Focus area</span>' : '') + '</span></div>'
        + '<div class="as-pair-bars">'
        + '<div class="as-pair-line"><span class="as-pair-tag">TE</span><div class="as-pair-track" style="flex:1;"><div class="as-pair-fill" style="width:' + d.acquirer + '%;background:' + ACQ_COL + '"></div></div><span class="as-pair-val" style="color:' + ACQ_COL + '">' + d.acquirer + '</span></div>'
        + '<div class="as-pair-line"><span class="as-pair-tag" data-i18n="assess.kpi_target">Target</span><div class="as-pair-track" style="flex:1;"><div class="as-pair-fill" style="width:' + d.target + '%;background:' + TGT_COL + '"></div></div><span class="as-pair-val" style="color:' + TGT_COL + '">' + d.target + '</span></div>'
        + '</div></div>';
    }).join('');

    el.innerHTML = '<div class="as-card">'
      + '<div class="as-compat-rings">'
      + '<div class="as-score"><div class="as-score-ring" style="background:' + ACQ_COL + ';width:64px;height:64px;font-size:20px;">' + compat.acquirer.score + '</div><div class="as-score-lbl" data-i18n="assess.kpi_acquirer">Acquirer (TE)</div></div>'
      + '<div class="as-score as-compat-mid"><div class="as-score-ring" style="background:' + C.bandColor(compat.fitBand) + ';width:92px;height:92px;font-size:29px;">' + compat.alignment + '</div><div class="as-score-lbl" data-i18n="assess.compat_alignment">Alignment</div>'
      + '<span class="as-band-badge" style="background:' + C.bandColor(compat.fitBand) + ';font-size:.72rem;padding:.22rem .7rem;"><span data-i18n="assess.compat_fit">Integration fit</span>: ' + bandLabelSpan(compat.fitBand) + '</span></div>'
      + '<div class="as-score"><div class="as-score-ring" style="background:' + TGT_COL + ';width:64px;height:64px;font-size:20px;">' + compat.target.score + '</div><div class="as-score-lbl" data-i18n="assess.kpi_target">Target</div></div>'
      + '</div>'
      + '<div class="as-sc-grid" style="margin-top:1.25rem;">'
      + '<div>' + C.radarSVG(axes, [
          { label: acqLbl, color: ACQ_COL, values: acqVals },
          { label: tgtLbl, color: TGT_COL, values: tgtVals, fillOpacity: 0.10 }
        ]) + '</div>'
      + '<div><h3 data-i18n="assess.dim_breakdown">Dimension breakdown</h3>' + pairRows + '</div>'
      + '</div>'
      + '<p class="as-note" data-i18n="assess.compat_note">Alignment measures how closely the two readiness profiles match. The fit band is capped by the weaker company\'s readiness — high alignment between two unready organizations is not a strong fit.</p>'
      + '</div>';
    applyI18n();
  }

  // ---------------------------------------------------------------- tabs
  function switchTab(tab) {
    document.querySelectorAll('.as-tab').forEach(function (x) {
      x.classList.toggle('active', x.getAttribute('data-as-tab') === tab);
    });
    ['overview', 'acquirer', 'target', 'compat', 'leader'].forEach(function (p) {
      var el = document.getElementById('as-pane-' + p);
      if (el) el.style.display = p === tab ? 'block' : 'none';
    });
  }

  function renderAll() {
    renderOverview();
    renderScorecard('acquirer-org');
    renderScorecard('target-org');
    renderCompatibility();
    renderScorecard('integration-leader');
  }

  document.querySelectorAll('.as-tab').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.getAttribute('data-as-tab')); });
  });
  document.addEventListener('portalLanguageChanged', function () { renderAll(); });

  // Shared dictionary for strings rendered outside [data-i18n] (e.g. radar legend)
  fetch('/api/i18n').then(function (r) { return r.json(); })
    .then(function (d) { window.__assessDict = d; })
    .catch(function () {});

  loadAll().then(renderAll).catch(function (e) { console.error('Assessment center load failed:', e); });
})();
