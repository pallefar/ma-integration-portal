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

  var SUBJECT_TABS = { 'acquirer-org': 'acquirer', 'target-org': 'target' };

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
  function latestFor(tplId) {
    var list = state.instancesByTpl[tplId] || [];
    return list.length ? list[list.length - 1] : null;
  }
  function previousFor(tplId) {
    var list = state.instancesByTpl[tplId] || [];
    return list.length > 1 ? list[list.length - 2] : null;
  }

  // ---------------------------------------------------------------- data
  function loadAll() {
    return Promise.all([
      fetch('/api/assessment-templates').then(function (r) { return r.json(); }),
      fetch('/api/assessment-status').then(function (r) { return r.json(); })
    ]).then(function (res) {
      state.templates = Array.isArray(res[0]) ? res[0] : [];
      state.status = res[1] || {};
      return Promise.all(state.templates.map(function (tpl) {
        return fetch('/api/assessment-instances?templateId=' + encodeURIComponent(tpl.id) + '&rater=self')
          .then(function (r) { return r.json(); })
          .then(function (list) {
            list.sort(function (a, b) {
              var d = (a.demoDay || 0) - (b.demoDay || 0);
              return d !== 0 ? d : String(a.timestamp).localeCompare(String(b.timestamp));
            });
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
    el.innerHTML = '<p style="color:var(--text-secondary);margin:0 0 1.1rem;font-size:.92rem;max-width:820px;line-height:1.55;" data-i18n="assess.overview_intro">Required readiness assessments for this integration. Complete each one — the scores unlock phase gates and drive the coaching plan.</p>'
      + '<div class="as-req-grid">' + cards + '</div>'
      + '<p class="as-note" data-i18n="assess.n1_note">Structured judgment by 1 rater — a facilitated read of readiness, not a statistical instrument.</p>';
    el.querySelectorAll('.as-goto').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });
    applyI18n();
  }

  // ---------------------------------------------------------------- scorecard
  function renderScorecard(subject) {
    var tpl = tplBySubject(subject);
    var el = document.getElementById('as-pane-' + SUBJECT_TABS[subject]);
    if (!tpl) { el.innerHTML = ''; return; }
    var latest = latestFor(tpl.id);
    if (!latest) { renderIntro(subject); return; }
    var prev = previousFor(tpl.id);

    var axes = (tpl.dimensions || []).map(function (d) { return { id: d.id, label: d.label }; });
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
      + '</div>'
      + '<div class="as-actions"><button class="btn btn-secondary" id="as-retake-' + SUBJECT_TABS[subject] + '" style="font-size:.82rem;padding:.5rem 1rem;" data-i18n="assess.btn_retake">Retake assessment</button></div>'
      + '</div>'
      + '<div class="as-sc-grid">'
      + '<div>' + C.radarSVG(axes, series) + '</div>'
      + '<div><h3 data-i18n="assess.dim_breakdown">Dimension breakdown</h3>' + bars + '</div>'
      + '</div>'
      + '</div>'
      + (remedCards ? '<div class="as-card"><h3 data-i18n="assess.remediation">Recommended actions</h3>' + remedCards + '</div>' : '')
      + (subject === 'target-org' ? '<p class="as-note" data-i18n="assess.disclaimer_preclose">Sensitive: answers may contain competitively sensitive information about the target. Before legal close, complete this only with clean-team-approved information and involve Legal if unsure.</p>' : '')
      + '<p class="as-note" data-i18n="assess.n1_note">Structured judgment by 1 rater — a facilitated read of readiness, not a statistical instrument.</p>';

    var retake = el.querySelector('#as-retake-' + SUBJECT_TABS[subject]);
    if (retake) retake.addEventListener('click', function () { startWizard(subject, latest.id); });
    applyI18n();
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
  function startWizard(subject, retakeOf) {
    var tpl = tplBySubject(subject);
    if (!tpl) return;
    state.wizard[subject] = { tpl: tpl, step: 0, answers: {}, retakeOf: retakeOf || null };
    renderWizardStep(subject);
  }

  function renderWizardStep(subject) {
    var wz = state.wizard[subject];
    var tpl = wz.tpl;
    var el = document.getElementById('as-pane-' + SUBJECT_TABS[subject]);
    var dims = tpl.dimensions || [];
    var dim = dims[wz.step];
    var pct = Math.round(((wz.step) / dims.length) * 100);

    var qHtml = (dim.questions || []).map(function (q) {
      var chosen = wz.answers[q.id];
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

    el.innerHTML = '<div class="as-card as-wizard">'
      + '<div class="as-wz-head">'
      + '<h2 class="as-sc-title" style="font-size:1.15rem;" data-i18n="' + esc(tpl.titleKey || '') + '">' + esc(tpl.title) + '</h2>'
      + '<span class="as-wz-step"><span data-i18n="assess.section">Section</span> ' + (wz.step + 1) + '/' + dims.length + ' · ' + (dim.iconEmoji || '') + ' <span data-i18n="' + esc(dim.labelKey || '') + '">' + esc(dim.label) + '</span></span>'
      + '</div>'
      + '<div class="as-wz-bar"><div class="as-wz-fill" style="width:' + pct + '%"></div></div>'
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
    el.querySelector('#as-wz-back').addEventListener('click', function () {
      if (wz.step > 0) { wz.step--; renderWizardStep(subject); }
    });
    el.querySelector('#as-wz-next').addEventListener('click', function () {
      var missing = (dim.questions || []).some(function (q) { return wz.answers[q.id] === undefined; });
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
        rater: 'self',
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

  // ---------------------------------------------------------------- tabs
  function switchTab(tab) {
    document.querySelectorAll('.as-tab').forEach(function (x) {
      x.classList.toggle('active', x.getAttribute('data-as-tab') === tab);
    });
    ['overview', 'acquirer', 'target'].forEach(function (p) {
      var el = document.getElementById('as-pane-' + p);
      if (el) el.style.display = p === tab ? 'block' : 'none';
    });
  }

  function renderAll() {
    renderOverview();
    renderScorecard('acquirer-org');
    renderScorecard('target-org');
  }

  document.querySelectorAll('.as-tab').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.getAttribute('data-as-tab')); });
  });
  document.addEventListener('portalLanguageChanged', function () { renderAll(); });

  loadAll().then(renderAll).catch(function (e) { console.error('Assessment center load failed:', e); });
})();
