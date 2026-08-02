// WIZ-01: the new-deal setup wizard's client-side state machine — a
// full-page, seven-step guided flow that supersedes the Phase-3 minimal
// create-deal modal (D-06). Follows public/js/pmo.js's switchWizStep()
// shape (counter + hide/show panels + progress-bar fill), adapted from four
// steps to seven, WITHOUT porting that file's demo-only survey scoring.
//
// D-07: this file holds NO duplicate copy of any validation rule. Every
// field constraint the operator experiences comes from the server's own
// `{ error: "field.path: message" }` response (validators/index.js's
// formatIssues()) — the only client-side gating here is the browser's own
// `required` attribute on step 1/2/3's <form> elements, which is a submit
// affordance (blocks an empty/incomplete submit from ever reaching fetch),
// never a second, independently-drifting rule set.
//
// Every operator-supplied value (deal name, target company, member names,
// assessment owners) is rendered with textContent only, via
// document.createElement()/appendChild() — never the raw-markup DOM sink —
// deal and target names are MNPI.
(function () {
  'use strict';

  // Module-scoped wizard state: the collected basics payload (step 1), the
  // created deal id (stamped at step 2 — D-05), which readiness-assessment
  // template ids have already been assigned (resume-safe across a retry so
  // a partial failure never re-assigns and duplicates one that succeeded),
  // and the fetched template list (for the review step's count).
  var state = {
    basics: {},
    dealId: null,
    assignedTemplateIds: {},
    templates: [],
  };

  var WORKSTREAM_LABELS = {
    ws_imo: 'IMO', ws_hr: 'HR', ws_it: 'IT', ws_finance: 'Finance',
    ws_legal: 'Legal', ws_sales: 'Sales', ws_ops: 'Operations', ws_comms: 'Communications',
  };

  function qs(id) { return document.getElementById(id); }

  // Interface contract: id/class conventions copied from the existing
  // wizard precedent (public/js/pmo.js#switchWizStep) so the shared styles
  // apply — counter, hide-all/show-one panels, colour the progress fills.
  function switchWizStep(stepNum) {
    var counter = qs('current-step-num');
    if (counter) counter.textContent = stepNum;
    document.querySelectorAll('.wizard-step').forEach(function (step) {
      step.style.display = 'none';
    });
    var target = qs('wizard-step-' + stepNum);
    if (target) target.style.display = 'block';
    for (var i = 1; i <= 7; i++) {
      var fill = qs('wizard-step' + i + '-fill');
      if (fill) fill.style.backgroundColor = i <= stepNum ? 'var(--te-orange)' : 'var(--border-color)';
    }
  }

  function setBusy(btn, busy) { if (btn) btn.disabled = !!busy; }

  // A step's Next control is disabled while its own request is in flight,
  // and re-enabled on ANY response (success advances away from the step;
  // failure needs the control back so the operator can retry).
  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function getJson(url) {
    return fetch(url).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  // ---------------------------------------------------------------------
  // Interface contract: a non-2xx response's `error` string is already
  // field-path prefixed and semicolon-joined for multiple issues (e.g.
  // "targetCompany: Target company is required.") — split on ';' for
  // issues, then on the FIRST ':' within each issue for the field path vs.
  // the message, and place the message beside the field whose data-field
  // matches the path's first segment. No match falls back to the current
  // step's own banner.
  // ---------------------------------------------------------------------
  function splitIssues(errorString) {
    return String(errorString || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function parseIssue(issue) {
    var idx = issue.indexOf(':');
    if (idx === -1) return { fieldKey: null, message: issue };
    var fieldPath = issue.slice(0, idx).trim();
    var message = issue.slice(idx + 1).trim();
    return { fieldKey: fieldPath.split('.')[0], message: message };
  }

  function clearFieldErrors() {
    document.querySelectorAll('.wiz-field-error').forEach(function (el) {
      el.textContent = '';
      el.style.display = 'none';
    });
  }

  function clearStepBanner(stepEl) {
    var banner = stepEl.querySelector('.wizard-step-error');
    if (banner) { banner.textContent = ''; banner.style.display = 'none'; }
  }

  // Field lookup is document-wide (not scoped to the submitting step's own
  // panel) because a basics field (step 1's DOM) can be the one a LATER
  // step's request re-validates (e.g. step 2's create call re-validates the
  // whole basics-plus-team payload) — the message still needs to land next
  // to the input that actually holds that value, wherever it lives.
  function renderErrors(errorString, stepEl) {
    clearFieldErrors();
    clearStepBanner(stepEl);
    var unmatched = [];
    splitIssues(errorString).forEach(function (issue) {
      var parsed = parseIssue(issue);
      var target = parsed.fieldKey
        ? document.querySelector('.wiz-field-error[data-field="' + parsed.fieldKey + '"]')
        : null;
      if (target) {
        target.textContent = parsed.message;
        target.style.display = '';
      } else {
        unmatched.push(parsed.fieldKey ? (parsed.fieldKey + ': ' + parsed.message) : parsed.message);
      }
    });
    if (unmatched.length) {
      var banner = stepEl.querySelector('.wizard-step-error');
      if (banner) { banner.textContent = unmatched.join(' '); banner.style.display = ''; }
    }
  }

  // Step 3's rows repeat the same field names (owner/dueDate) once per
  // template, so its error rendering is scoped to the ONE row that was just
  // submitted (assign is called sequentially, one row at a time) rather
  // than matched document-wide.
  function renderRowError(errorString, rowEl) {
    rowEl.querySelectorAll('.wiz-assess-field-error').forEach(function (el) {
      el.textContent = '';
      el.style.display = 'none';
    });
    var rowBanner = rowEl.querySelector('.wiz-row-error');
    var unmatched = [];
    splitIssues(errorString).forEach(function (issue) {
      var parsed = parseIssue(issue);
      var target = parsed.fieldKey
        ? rowEl.querySelector('.wiz-assess-field-error[data-field="' + parsed.fieldKey + '"]')
        : null;
      if (target) { target.textContent = parsed.message; target.style.display = ''; }
      else unmatched.push(parsed.message);
    });
    if (rowBanner) {
      if (unmatched.length) { rowBanner.textContent = unmatched.join(' '); rowBanner.style.display = ''; }
      else { rowBanner.textContent = ''; rowBanner.style.display = 'none'; }
    }
  }

  // ---------------------------------------------------------------------
  // Step 1: Basics — Next round-trips POST /api/deals/wizard/basics (the
  // wizard's own validate-only echo route, D-07); the payload only becomes
  // module state (used by step 2's actual create call) once the server
  // accepts it.
  // ---------------------------------------------------------------------
  function collectBasics() {
    var basics = {
      name: qs('wiz-name').value.trim(),
      targetCompany: qs('wiz-target-company').value.trim(),
    };
    var dealType = qs('wiz-deal-type').value;
    if (dealType) basics.dealType = dealType;
    var currency = qs('wiz-currency').value.trim();
    if (currency) basics.currency = currency;
    var signingDate = qs('wiz-signing-date').value;
    if (signingDate) basics.signingDate = signingDate;
    var expectedClose = qs('wiz-expected-close').value;
    if (expectedClose) basics.expectedClose = expectedClose;
    var day1Date = qs('wiz-day1-date').value;
    if (day1Date) basics.day1Date = day1Date;
    var dealSizeRaw = qs('wiz-deal-size').value;
    if (dealSizeRaw !== '') {
      var n = parseFloat(dealSizeRaw);
      basics.dealSizeM = isNaN(n) ? dealSizeRaw : n;
    }
    return basics;
  }

  qs('wizard-form-1').addEventListener('submit', function (e) {
    e.preventDefault();
    var stepEl = qs('wizard-step-1');
    clearStepBanner(stepEl);
    clearFieldErrors();
    var basics = collectBasics();
    var btn = qs('wiz-next-1');
    setBusy(btn, true);
    postJson('/api/deals/wizard/basics', basics).then(function (res) {
      setBusy(btn, false);
      if (!res.ok) { renderErrors(res.data && res.data.error, stepEl); return; }
      state.basics = basics;
      switchWizStep(2);
    });
  });

  // ---------------------------------------------------------------------
  // Step 2: Team & access — this is where the deal comes into existence
  // (D-05): basics + members go to POST /api/deals, then the session is
  // immediately bound with POST /api/deals/select so every later step's
  // write lands in the new deal's own database.
  // ---------------------------------------------------------------------
  qs('wiz-back-2').addEventListener('click', function () { switchWizStep(1); });

  qs('wizard-form-2').addEventListener('submit', function (e) {
    e.preventDefault();
    var stepEl = qs('wizard-step-2');
    clearStepBanner(stepEl);
    clearFieldErrors();
    var members = qs('wiz-members').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var payload = Object.assign({}, state.basics, { members: members });
    var btn = qs('wiz-next-2');
    setBusy(btn, true);
    postJson('/api/deals', payload).then(function (res) {
      if (!res.ok) { setBusy(btn, false); renderErrors(res.data && res.data.error, stepEl); return; }
      state.dealId = res.data.deal.id;
      return postJson('/api/deals/select', { dealId: state.dealId }).then(function (selectRes) {
        setBusy(btn, false);
        if (!selectRes.ok) { renderErrors(selectRes.data && selectRes.data.error, stepEl); return; }
        loadAssessmentTemplates().then(function () { switchWizStep(3); });
      });
    });
  });

  // ---------------------------------------------------------------------
  // Step 3: Readiness assessments — mandatory (D-08). Lists the deal's own
  // published templates (GET /api/assessment-templates — already reading
  // from the newly-bound deal at this point), requires an owner and a due
  // date per row, then assigns each in turn (POST
  // /api/assessment-instances/assign) before stamping the `assessments`
  // setup step. Resume-safe: assignNext() skips any template id already in
  // state.assignedTemplateIds, so a retry after a partial failure never
  // creates a second instance for one that already succeeded.
  // ---------------------------------------------------------------------
  function loadAssessmentTemplates() {
    return getJson('/api/assessment-templates').then(function (res) {
      var list = qs('wiz-assessments-list');
      while (list.firstChild) list.removeChild(list.firstChild);
      var templates = (res.ok && Array.isArray(res.data)) ? res.data : [];
      state.templates = templates;
      templates.forEach(function (tpl) {
        var row = document.createElement('div');
        row.className = 'wiz-assess-row';
        row.setAttribute('data-template-id', tpl.id);

        var title = document.createElement('div');
        title.className = 'wiz-assess-title';
        title.textContent = tpl.title || tpl.subject || tpl.id; // textContent only — a template title may echo deal-specific naming
        row.appendChild(title);

        var ownerWrap = document.createElement('div');
        ownerWrap.className = 'wiz-assess-field';
        var ownerLabel = document.createElement('label');
        ownerLabel.className = 'form-label';
        ownerLabel.textContent = 'Owner';
        var ownerInput = document.createElement('input');
        ownerInput.type = 'text';
        ownerInput.className = 'form-control wiz-assess-owner';
        ownerInput.required = true;
        var ownerError = document.createElement('span');
        ownerError.className = 'wiz-assess-field-error wiz-field-error';
        ownerError.setAttribute('data-field', 'owner');
        ownerWrap.appendChild(ownerLabel);
        ownerWrap.appendChild(ownerInput);
        ownerWrap.appendChild(ownerError);
        row.appendChild(ownerWrap);

        var dueWrap = document.createElement('div');
        dueWrap.className = 'wiz-assess-field';
        var dueLabel = document.createElement('label');
        dueLabel.className = 'form-label';
        dueLabel.textContent = 'Due date';
        var dueInput = document.createElement('input');
        dueInput.type = 'date';
        dueInput.className = 'form-control wiz-assess-due';
        dueInput.required = true;
        var dueError = document.createElement('span');
        dueError.className = 'wiz-assess-field-error wiz-field-error';
        dueError.setAttribute('data-field', 'dueDate');
        dueWrap.appendChild(dueLabel);
        dueWrap.appendChild(dueInput);
        dueWrap.appendChild(dueError);
        row.appendChild(dueWrap);

        var rowError = document.createElement('span');
        rowError.className = 'wiz-row-error';
        row.appendChild(rowError);

        list.appendChild(row);
      });
    });
  }

  qs('wiz-back-3').addEventListener('click', function () { switchWizStep(2); });

  qs('wizard-form-3').addEventListener('submit', function (e) {
    e.preventDefault();
    var stepEl = qs('wizard-step-3');
    clearStepBanner(stepEl);
    var btn = qs('wiz-next-3');
    var rows = Array.prototype.slice.call(document.querySelectorAll('#wiz-assessments-list .wiz-assess-row'));
    setBusy(btn, true);

    function assignNext(i) {
      if (i >= rows.length) {
        return postJson('/api/deals/' + state.dealId + '/setup', { step: 'assessments' }).then(function (setupRes) {
          if (!setupRes.ok) { setBusy(btn, false); renderErrors(setupRes.data && setupRes.data.error, stepEl); return; }
          return loadChecklistTemplates().then(function () {
            setBusy(btn, false);
            switchWizStep(4);
          });
        });
      }
      var row = rows[i];
      var templateId = row.getAttribute('data-template-id');
      if (state.assignedTemplateIds[templateId]) return assignNext(i + 1);
      var owner = row.querySelector('.wiz-assess-owner').value.trim();
      var dueDate = row.querySelector('.wiz-assess-due').value;
      return postJson('/api/assessment-instances/assign', { templateId: templateId, owner: owner, dueDate: dueDate }).then(function (res) {
        if (!res.ok) {
          setBusy(btn, false);
          renderRowError(res.data && res.data.error, row);
          return;
        }
        state.assignedTemplateIds[templateId] = true;
        return assignNext(i + 1);
      });
    }

    assignNext(0);
  });

  // ---------------------------------------------------------------------
  // Step 4: Integration scope — skippable. Workstream selection + depth are
  // recorded as the `scope` setup step's `data`; the checklist-template
  // instantiate action is independent of Next (fires immediately on click).
  // ---------------------------------------------------------------------
  function renderWorkstreamCheckboxes() {
    var host = qs('wiz-workstreams');
    while (host.firstChild) host.removeChild(host.firstChild);
    Object.keys(WORKSTREAM_LABELS).forEach(function (id) {
      var label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:0.35rem;font-size:0.85rem;';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.value = id;
      box.className = 'wiz-workstream-checkbox';
      var text = document.createElement('span');
      text.textContent = WORKSTREAM_LABELS[id];
      label.appendChild(box);
      label.appendChild(text);
      host.appendChild(label);
    });
  }

  function loadChecklistTemplates() {
    return getJson('/api/checklist-templates').then(function (res) {
      var host = qs('wiz-checklist-templates');
      while (host.firstChild) host.removeChild(host.firstChild);
      var templates = (res.ok && Array.isArray(res.data)) ? res.data : [];
      if (!templates.length) {
        var empty = document.createElement('p');
        empty.className = 'wiz-skip-note';
        empty.textContent = 'No checklist templates available for this deal.';
        host.appendChild(empty);
        return;
      }
      templates.forEach(function (tpl) {
        var row = document.createElement('div');
        row.className = 'wiz-checklist-item';
        var name = document.createElement('span');
        name.textContent = tpl.name || tpl.id;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.9rem;';
        btn.textContent = 'Load checklist';
        btn.addEventListener('click', function () {
          btn.disabled = true;
          postJson('/api/integration-tasks/instantiate', { checklistTemplateId: tpl.id }).then(function (res2) {
            btn.disabled = false;
            if (!res2.ok) { renderErrors(res2.data && res2.data.error, qs('wizard-step-4')); return; }
            btn.textContent = 'Loaded (' + res2.data.created + ' new)';
          });
        });
        row.appendChild(name);
        row.appendChild(btn);
        host.appendChild(row);
      });
    });
  }

  qs('wiz-skip-4').addEventListener('click', function () { switchWizStep(5); });

  qs('wizard-form-4').addEventListener('submit', function (e) {
    e.preventDefault();
    var stepEl = qs('wizard-step-4');
    clearStepBanner(stepEl);
    var workstreams = Array.prototype.slice.call(document.querySelectorAll('.wiz-workstream-checkbox:checked')).map(function (b) { return b.value; });
    var depth = qs('wiz-depth').value;
    var data = {};
    if (workstreams.length) data.workstreams = workstreams;
    if (depth) data.depth = depth;
    var btn = qs('wiz-next-4');
    setBusy(btn, true);
    postJson('/api/deals/' + state.dealId + '/setup', { step: 'scope', data: data }).then(function (res) {
      setBusy(btn, false);
      if (!res.ok) { renderErrors(res.data && res.data.error, stepEl); return; }
      switchWizStep(5);
    });
  });

  // ---------------------------------------------------------------------
  // Step 5: Timeline markers — skippable (step 5's panel is plain date
  // inputs; nothing to fetch on entry).
  // ---------------------------------------------------------------------
  qs('wiz-skip-5').addEventListener('click', function () { loadDdTemplates(); switchWizStep(6); });

  qs('wizard-form-5').addEventListener('submit', function (e) {
    e.preventDefault();
    var stepEl = qs('wizard-step-5');
    clearStepBanner(stepEl);
    var data = {};
    var day1 = qs('wiz-day1').value; if (day1) data.day1 = day1;
    var day30 = qs('wiz-day30').value; if (day30) data.day30 = day30;
    var day60 = qs('wiz-day60').value; if (day60) data.day60 = day60;
    var day100 = qs('wiz-day100').value; if (day100) data.day100 = day100;
    var btn = qs('wiz-next-5');
    setBusy(btn, true);
    postJson('/api/deals/' + state.dealId + '/setup', { step: 'timeline', data: data }).then(function (res) {
      setBusy(btn, false);
      if (!res.ok) { renderErrors(res.data && res.data.error, stepEl); return; }
      loadDdTemplates().then(function () { switchWizStep(6); });
    });
  });

  // ---------------------------------------------------------------------
  // Step 6: Data room and DD kickoff — skippable. The data-room field is a
  // reference only (never a stored document — TE's own VDR holds the
  // content); the DD-checklist instantiate action fires independently, like
  // step 4's checklist action.
  // ---------------------------------------------------------------------
  function loadDdTemplates() {
    return getJson('/api/dd/request-templates').then(function (res) {
      var host = qs('wiz-dd-templates');
      while (host.firstChild) host.removeChild(host.firstChild);
      var templates = (res.ok && Array.isArray(res.data)) ? res.data : [];
      if (!templates.length) {
        var empty = document.createElement('p');
        empty.className = 'wiz-skip-note';
        empty.textContent = 'No DD request checklist templates available for this deal.';
        host.appendChild(empty);
        return;
      }
      templates.forEach(function (tpl) {
        var row = document.createElement('div');
        row.className = 'wiz-checklist-item';
        var name = document.createElement('span');
        name.textContent = tpl.name || tpl.id;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.9rem;';
        btn.textContent = 'Load DD checklist';
        btn.addEventListener('click', function () {
          btn.disabled = true;
          postJson('/api/dd/request-items/instantiate', { templateId: tpl.id }).then(function (res2) {
            btn.disabled = false;
            if (!res2.ok) { renderErrors(res2.data && res2.data.error, qs('wizard-step-6')); return; }
            btn.textContent = 'Loaded (' + res2.data.created + ' new)';
          });
        });
        row.appendChild(name);
        row.appendChild(btn);
        host.appendChild(row);
      });
    });
  }

  qs('wiz-skip-6').addEventListener('click', function () { renderReview(); switchWizStep(7); });

  qs('wizard-form-6').addEventListener('submit', function (e) {
    e.preventDefault();
    var stepEl = qs('wizard-step-6');
    clearStepBanner(stepEl);
    var vdrRef = qs('wiz-vdr-ref').value.trim();
    var data = {};
    if (vdrRef) data.vdrRef = vdrRef;
    var btn = qs('wiz-next-6');
    setBusy(btn, true);
    postJson('/api/deals/' + state.dealId + '/setup', { step: 'ddKickoff', data: data }).then(function (res) {
      setBusy(btn, false);
      if (!res.ok) { renderErrors(res.data && res.data.error, stepEl); return; }
      renderReview();
      switchWizStep(7);
    });
  });

  // ---------------------------------------------------------------------
  // Step 7: Review — a read-only summary of what the earlier steps
  // actually produced (never a re-statement of what was merely typed),
  // rendered with textContent only. Finish stamps `complete` and redirects.
  // ---------------------------------------------------------------------
  function renderReview() {
    var host = qs('wiz-review');
    while (host.firstChild) host.removeChild(host.firstChild);

    var basicsBlock = document.createElement('div');
    basicsBlock.className = 'wiz-review-block';
    var basicsHeading = document.createElement('h4');
    basicsHeading.textContent = 'Basics';
    basicsBlock.appendChild(basicsHeading);
    var nameP = document.createElement('p');
    nameP.textContent = 'Deal name: ' + (state.basics.name || '');
    basicsBlock.appendChild(nameP);
    var targetP = document.createElement('p');
    targetP.textContent = 'Target company: ' + (state.basics.targetCompany || '');
    basicsBlock.appendChild(targetP);
    host.appendChild(basicsBlock);

    var dealBlock = document.createElement('div');
    dealBlock.className = 'wiz-review-block';
    var dealHeading = document.createElement('h4');
    dealHeading.textContent = 'Deal';
    dealBlock.appendChild(dealHeading);
    var dealP = document.createElement('p');
    dealP.textContent = state.dealId ? ('Deal created: ' + state.dealId) : 'Deal not yet created.';
    dealBlock.appendChild(dealP);
    host.appendChild(dealBlock);

    var assessBlock = document.createElement('div');
    assessBlock.className = 'wiz-review-block';
    var assessHeading = document.createElement('h4');
    assessHeading.textContent = 'Readiness assessments';
    assessBlock.appendChild(assessHeading);
    var assessCount = Object.keys(state.assignedTemplateIds).length;
    var assessP = document.createElement('p');
    assessP.textContent = assessCount + ' of ' + state.templates.length + ' readiness assessments assigned.';
    assessBlock.appendChild(assessP);
    host.appendChild(assessBlock);
  }

  qs('wiz-back-7').addEventListener('click', function () { switchWizStep(6); });

  qs('wiz-finish').addEventListener('click', function () {
    var stepEl = qs('wizard-step-7');
    clearStepBanner(stepEl);
    var btn = qs('wiz-finish');
    setBusy(btn, true);
    // The Finish control's own stamp: DEAL_SETUP_STEPS requires SOME step
    // name (ddKickoff, the wizard's last real step) even though this call's
    // real purpose is `complete: true` — server.js's own handler comment
    // documents this exact "operator choice to mark the wizard done enough"
    // shape. Harmless to stamp ddKickoff again if step 6 already did.
    postJson('/api/deals/' + state.dealId + '/setup', { step: 'ddKickoff', complete: true }).then(function (res) {
      setBusy(btn, false);
      if (!res.ok) { renderErrors(res.data && res.data.error, stepEl); return; }
      window.location.href = '/dashboard.html';
    });
  });

  renderWorkstreamCheckboxes();
  switchWizStep(1);
})();
