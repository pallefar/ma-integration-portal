/**
 * Deal home (D-19) — ALL deal-bound rendering for the dashboard page lives
 * here, in one file that can be grep-asserted as a whole, so this new
 * surface never has to be audited against public/js/dashboard.js's ~2400
 * lines of pre-existing (and legitimately markup-assigning) demo rendering.
 *
 * Renders four panels into #deal-home, entirely from server responses that
 * are already scoped to the caller's own clearance/membership — this module
 * holds NO client-side list of "every possible area" or "every possible
 * setup step's completeness" to fall back on; an uncleared DD area or org
 * restricted tier is simply absent from what it draws (T-04-46/D-20),
 * mirroring public/js/due-diligence.js's own D-16 discipline.
 *
 * - Setup checklist — GET /api/deals, the caller's own deal by id.
 * - Readiness assessments — GET /api/assessment-status (WIZ-01's
 *   pending/bySubject rollup, already in the server's declared subject
 *   order).
 * - Diligence progress — GET /api/dd/summary (Phase 4's clearance-scoped
 *   rollup).
 * - Organisation status — GET /api/org/summary (06-07's clearance-scoped
 *   rollup, Task 1) — open tier always drawn, restricted tier drawn only
 *   when the response's `restricted` key is present (D-19/D-20/D-21).
 *
 * D-20: deliberately NO activity feed — status rollups only. This module
 * never references the admin audit route, by design; a grep-asserted
 * absence is part of this plan's own acceptance criteria.
 *
 * Every user-facing string is written with textContent, never assigned as
 * markup (T-04-06's rule, applied to this new surface exactly like the DD
 * workspace page already applies it) — no markup-assignment sink of any
 * kind appears anywhere in this file.
 */
(function () {
  'use strict';

  // WIZ-01/D-05: the six wizard setup steps, in the wizard's own order —
  // duplicated (not imported) here, mirroring the SAME duplication already
  // established across validators/wizard.js, db/controlStore.js and
  // server.js's own reference comment (each layer keeps its own copy; no
  // shared module exists between client and server code in this app).
  var DEAL_SETUP_STEPS = [
    { id: 'basics', label: 'Deal Basics' },
    { id: 'team', label: 'Team & Access' },
    { id: 'assessments', label: 'Readiness Assessments' },
    { id: 'scope', label: 'Integration Scope' },
    { id: 'timeline', label: 'Timeline Markers' },
    { id: 'ddKickoff', label: 'Data Room & DD Kickoff' },
  ];

  var WIZARD_SUBJECT_LABELS = {
    'acquirer-org': 'Acquirer (TE) Readiness',
    'target-org': 'Target Readiness',
    'integration-leader': 'Integration Leader Readiness',
  };

  function el(tag, opts) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    return node;
  }

  // D-05: outstanding steps get a resume link into the wizard (never a
  // blocker — DD-09/D-09 keep every other workflow usable regardless of
  // wizard completeness, mirrored here by never disabling anything).
  function renderSetupChecklist(wrap, deal) {
    var section = el('div', { className: 'card deal-home-section' });
    section.appendChild(el('h2', { className: 'deal-home-section-title', text: 'Setup checklist' }));

    var setup = (deal && deal.setup) || {};
    var steps = setup.steps || {};
    var list = el('div', { className: 'deal-home-checklist' });
    var anyOutstanding = false;

    DEAL_SETUP_STEPS.forEach(function (step) {
      var done = steps[step.id] != null;
      if (!done) anyOutstanding = true;
      var row = el('div', { className: 'deal-home-checklist-row' });
      row.appendChild(el('span', {
        className: 'deal-home-checklist-status' + (done ? ' deal-home-checklist-status--done' : ''),
        text: done ? 'Done' : 'Outstanding',
      }));
      row.appendChild(el('span', { className: 'deal-home-checklist-label', text: step.label }));
      list.appendChild(row);
    });
    section.appendChild(list);

    if (anyOutstanding) {
      var line = el('div', { className: 'deal-home-setup-incomplete' });
      line.appendChild(el('span', { text: 'Setup incomplete — ' }));
      var resumeLink = document.createElement('a');
      resumeLink.href = '/deal-wizard.html';
      resumeLink.textContent = 'resume setup';
      line.appendChild(resumeLink);
      section.appendChild(line);
    }

    wrap.appendChild(section);
  }

  // D-09: completion is shown prominently while incomplete, but NEVER as a
  // blocker — this panel renders no lock/overlay/disabled-control of any
  // kind, unlike the demo showcase's own gated-tab pattern.
  function renderReadiness(wrap, statusData) {
    var section = el('div', { className: 'card deal-home-section' });
    section.appendChild(el('h2', { className: 'deal-home-section-title', text: 'Readiness assessments' }));

    var bySubject = (statusData && statusData.bySubject) || {};
    var list = el('div', { className: 'deal-home-readiness-list' });

    // WIZ-01: bySubject is already reshaped server-side into the declared
    // acquirer/target/integration-leader order — this module iterates its
    // own key order rather than re-declaring a second copy of that order,
    // so the two can never drift apart.
    Object.keys(bySubject).forEach(function (subject) {
      var entry = bySubject[subject];
      if (!entry) return;
      var row = el('div', { className: 'deal-home-readiness-row' });
      row.appendChild(el('span', {
        className: 'deal-home-readiness-subject',
        text: WIZARD_SUBJECT_LABELS[subject] || subject,
      }));
      row.appendChild(el('span', {
        className: 'deal-home-readiness-status' + (entry.satisfied ? ' deal-home-readiness-status--done' : ''),
        text: entry.satisfied ? 'Complete' : 'Pending',
      }));
      list.appendChild(row);

      (entry.pending || []).forEach(function (p) {
        var pendingRow = el('div', { className: 'deal-home-readiness-pending' });
        pendingRow.appendChild(el('span', { text: 'Owner: ' + (p.owner || 'unassigned') }));
        pendingRow.appendChild(el('span', { text: 'Due: ' + (p.dueDate || 'not set') }));
        list.appendChild(pendingRow);
      });
    });

    if (!list.children.length) {
      list.appendChild(el('div', { className: 'deal-home-empty', text: 'No readiness assessments assigned yet.' }));
    }

    section.appendChild(list);
    wrap.appendChild(section);
  }

  // D-15/D-16: one row per area GET /api/dd/summary actually returned —
  // never a client-side list of every possible area. An area's overdue
  // count is rendered as a distinct highlight; a findings count calls out
  // the critical tally specifically.
  function renderDiligence(wrap, summary) {
    var section = el('div', { className: 'card deal-home-section' });
    section.appendChild(el('h2', { className: 'deal-home-section-title', text: 'Diligence progress' }));

    var areas = (summary && Array.isArray(summary.areas)) ? summary.areas : [];

    if (!areas.length) {
      section.appendChild(el('div', { className: 'deal-home-empty', text: 'No due-diligence areas available yet.' }));
      wrap.appendChild(section);
      return;
    }

    var list = el('div', { className: 'deal-home-dd-list' });
    areas.forEach(function (area) {
      var row = document.createElement('a');
      row.className = 'deal-home-dd-row';
      row.href = '/due-diligence.html';

      row.appendChild(el('span', { className: 'deal-home-dd-label', text: area.label }));
      row.appendChild(el('span', {
        className: 'deal-home-dd-total',
        text: area.items.total + (area.items.total === 1 ? ' item' : ' items'),
      }));
      if (area.items.overdue > 0) {
        row.appendChild(el('span', {
          className: 'deal-home-dd-overdue',
          text: area.items.overdue + ' overdue',
        }));
      }
      var findingsText = area.findings.total + (area.findings.total === 1 ? ' finding' : ' findings');
      if (area.findings.critical > 0) findingsText += ' (' + area.findings.critical + ' critical)';
      row.appendChild(el('span', { className: 'deal-home-dd-findings', text: findingsText }));

      list.appendChild(row);
    });
    section.appendChild(list);
    wrap.appendChild(section);
  }

  // D-14 (06-04): an independent copy of the five-value decision vocabulary
  // and its English labels — the SAME i18n-key construction
  // public/js/org.js's orgDecisionI18nKey() uses ('org.dec_' + value with
  // hyphens replaced by underscores), duplicated here because this file
  // shares no module system with org.js (mirrors the RAID_LEVELS/SYN_STAGES
  // multi-copy convention already established elsewhere in this codebase —
  // a fourth copy, not a new pattern).
  var ORG_DECISION_TYPES = ['retain', 'redeploy', 'in-selection', 'redundant', 'open'];
  var ORG_DECISION_LABELS = {
    retain: 'Retain',
    redeploy: 'Redeploy',
    'in-selection': 'In Selection',
    redundant: 'Redundant',
    open: 'Open',
  };

  // D-19/D-20/D-21/UI-SPEC §7: renders from GET /api/org/summary alone — no
  // client-side tallying of any kind. The open tier (current headcount,
  // open positions) is ALWAYS drawn as a `div.org-summary-open`. The
  // restricted tier is a DIFFERENT ELEMENT TAG — `section.org-summary-
  // restricted`, never a div — constructed ONLY when `summary` carries a
  // `restricted` key, branching on the KEY'S PRESENCE (hasOwnProperty)
  // rather than a truthiness test of its contents, and never built then
  // removed after the fact. This is the tag-level countermeasure Design
  // Tension 3 names: a raw-markup query for the restricted container
  // returns zero for an uncleared caller and exactly one for a cleared one,
  // with no false positives from styling surviving a future CSS edit.
  function renderOrgPanel(wrap, summary) {
    var section = el('div', { className: 'card deal-home-section' });
    section.appendChild(el('h2', { className: 'deal-home-section-title', text: 'Organisation' }));

    var open = (summary && summary.open) || null;
    if (!open || !open.currentPositions) {
      var empty = el('div', { className: 'deal-home-empty' });
      var link = document.createElement('a');
      link.href = '/org.html';
      link.textContent = 'No positions mapped yet — see the Org page';
      empty.appendChild(link);
      section.appendChild(empty);
      wrap.appendChild(section);
      return;
    }

    var openTier = el('div', { className: 'org-summary-open' });
    var headcountRow = el('div', { className: 'org-summary-row deal-home-readiness-row' });
    headcountRow.appendChild(el('span', { text: 'Current headcount' }));
    headcountRow.appendChild(el('span', { text: String(open.currentHeadcount) }));
    openTier.appendChild(headcountRow);
    var openPositionsRow = el('div', { className: 'org-summary-row deal-home-readiness-row' });
    openPositionsRow.appendChild(el('span', { text: 'Open positions' }));
    openPositionsRow.appendChild(el('span', { text: String(open.openPositions) }));
    openTier.appendChild(openPositionsRow);
    section.appendChild(openTier);

    // D-20: branch on the key's PRESENCE — never on a truthiness test of
    // its contents (a genuinely all-zero restricted object must still
    // render its section), and never remove a constructed section after
    // the fact.
    if (summary && Object.prototype.hasOwnProperty.call(summary, 'restricted')) {
      var restricted = summary.restricted || {};
      var restrictedTier = document.createElement('section');
      restrictedTier.className = 'org-summary-restricted';

      var targetRow = el('div', { className: 'org-summary-row deal-home-readiness-row' });
      targetRow.appendChild(el('span', { text: 'Target headcount' }));
      targetRow.appendChild(el('span', { text: String(restricted.targetHeadcount || 0) }));
      restrictedTier.appendChild(targetRow);

      // The single most-asked number per D-19 gets its own row, emphasised
      // (the existing overdue-style treatment) ONLY when the delta is
      // negative — a net reduction. A positive/zero delta stays at normal
      // weight, avoiding false-alarm styling on growth or no change.
      var delta = restricted.delta || 0;
      var deltaRow = el('div', { className: 'org-summary-row org-summary-delta deal-home-readiness-row' });
      deltaRow.appendChild(el('span', { text: 'Current → target delta' }));
      var deltaValue = el('span', { text: String(delta) });
      if (delta < 0) {
        deltaValue.className = 'deal-home-dd-overdue';
      }
      deltaRow.appendChild(deltaValue);
      restrictedTier.appendChild(deltaRow);

      var decisions = restricted.decisions || {};
      ORG_DECISION_TYPES.forEach(function (type) {
        var row = el('div', { className: 'org-summary-row deal-home-readiness-row' });
        var label = el('span', { text: ORG_DECISION_LABELS[type] || type });
        label.setAttribute('data-i18n', 'org.dec_' + type.replace(/-/g, '_'));
        row.appendChild(label);
        row.appendChild(el('span', { text: String(decisions[type] || 0) }));
        restrictedTier.appendChild(row);
      });

      var riskRow = el('div', { className: 'org-summary-row deal-home-readiness-row' });
      riskRow.appendChild(el('span', { text: 'Unmitigated high/critical flight risks' }));
      riskRow.appendChild(el('span', { text: String(restricted.unmitigatedFlightRisks || 0) }));
      restrictedTier.appendChild(riskRow);

      section.appendChild(restrictedTier);
    }

    wrap.appendChild(section);
  }

  // D-19/UI-SPEC §6: locate a REAL, already-rendered panel heading by its
  // own text content, rather than assuming DOM order or inventing a
  // top-level heading this file does not otherwise produce (the file
  // builds per-panel headings only — the plan's own instruction: "pick a
  // real element it produces rather than assuming one").
  function findSectionHeading(wrap, titleText) {
    var headings = wrap.querySelectorAll('.deal-home-section-title');
    for (var i = 0; i < headings.length; i++) {
      if (headings[i].textContent === titleText) return headings[i];
    }
    return null;
  }

  // D-19/UI-SPEC §6: the stale-synergy nudge — a heading badge plus a
  // dismissible warning banner for the CALLER'S OWN stale synergy
  // initiatives, sourced from GET /api/synergies/rollup's caller-scoped
  // mine.staleCount (Plan 05). AUTHORED following the due-diligence page's
  // established owner-nudge shape (a heading badge + a session-scoped
  // dismissible .page-banner--warning raised through the shared
  // window.makeBannerDismissible helper) — that page's own nudge function
  // is NEVER called, imported or extended here: its DOM selectors exist
  // only on the due-diligence page, and this deal-home surface had no
  // nudge code at all before this plan (05-RESEARCH.md Finding #7 /
  // Pitfall 2 — the concrete failure mode this instruction avoids). This
  // banner STACKS as an additional banner alongside that other nudge —
  // never merges text into it — so the two surfaces stay independent.
  function renderStaleSynergyNudge(wrap, rollup) {
    var mineStale = (rollup && rollup.mine && rollup.mine.staleCount) || 0;
    if (mineStale <= 0) return;

    var heading = findSectionHeading(wrap, 'Diligence progress');
    if (heading && !document.getElementById('syn-nudge-badge')) {
      // Inline styling only — no CSS file is in this plan's declared file
      // scope (files_modified: public/js/deal-home.js only) — matching the
      // due-diligence page's own established pattern for a JS-injected
      // badge/pill.
      var badge = el('span', { text: String(mineStale) });
      badge.id = 'syn-nudge-badge';
      badge.style.cssText = 'display:inline-block;margin-left:.6rem;font-size:.68rem;font-weight:800;padding:.15rem .55rem;border-radius:999px;background:#C77700;color:#fff;vertical-align:middle;';
      heading.appendChild(badge);
    }

    if (document.getElementById('syn-nudge-banner')) return;
    try {
      if (sessionStorage.getItem('syn_nudge_dismissed') === 'true') return;
    } catch (e) { /* sessionStorage unavailable — fall through and still show it */ }

    var main = document.querySelector('.main-content') || document.querySelector('main');
    if (!main) return;

    var banner = el('div', { className: 'page-banner page-banner--warning' });
    banner.id = 'syn-nudge-banner';
    banner.setAttribute('role', 'status');
    var body = el('div', { className: 'page-banner-body' });
    var msg = el('span', {
      className: 'page-banner-msg',
      text: 'You have ' + mineStale + (mineStale === 1
        ? ' synergy initiative that has not been confirmed recently'
        : ' synergy initiatives that have not been confirmed recently') + '.',
    });
    body.appendChild(msg);
    banner.appendChild(body);
    main.insertBefore(banner, main.firstChild);
    if (typeof window.makeBannerDismissible === 'function') {
      window.makeBannerDismissible(banner, 'syn_nudge_dismissed', 'session');
    }
  }

  // D-22/UI-SPEC §8: the flight-risk owner nudge — a heading badge plus a
  // dismissible warning banner for unmitigated high/critical flight-risk
  // entries the CALLER owns, sourced from GET /api/org/summary's restricted
  // caller-scoped block (Task 1). Follows renderStaleSynergyNudge()'s shape
  // ABOVE strictly as a PATTERN, not as shared code — that function's own
  // comment states it must never be called, imported or extended for a
  // second nudge, so this is an independent function with its OWN element
  // ids and its OWN sessionStorage key, inserted so it STACKS as an
  // additional banner alongside the synergy nudge rather than merging text
  // into it.
  //
  // Sourced STRICTLY from summary.restricted.mine.unmitigatedFlightRisks —
  // returns immediately (no badge, no banner) when the restricted key is
  // absent, when the caller-scoped block is absent, or when the count is
  // not greater than zero. This is the D-20 absence rule applied to a
  // nudge: the nudge must be ABSENT, not zero, for an uncleared caller and
  // for a caller who owns none — a retention nudge that fires on bad or
  // partial data (e.g. a failed fetch degrading `summary` to null) is worse
  // than one that does not fire at all.
  function renderFlightRiskNudge(wrap, summary) {
    if (!summary || !Object.prototype.hasOwnProperty.call(summary, 'restricted')) return;
    var restricted = summary.restricted;
    if (!restricted || !restricted.mine) return;
    var mineUnmitigated = restricted.mine.unmitigatedFlightRisks || 0;
    if (mineUnmitigated <= 0) return;

    var heading = findSectionHeading(wrap, 'Organisation');
    if (heading && !document.getElementById('org-risk-nudge-badge')) {
      var badge = el('span', { text: String(mineUnmitigated) });
      badge.id = 'org-risk-nudge-badge';
      badge.style.cssText = 'display:inline-block;margin-left:.6rem;font-size:.68rem;font-weight:800;padding:.15rem .55rem;border-radius:999px;background:#C0392B;color:#fff;vertical-align:middle;';
      heading.appendChild(badge);
    }

    if (document.getElementById('org-risk-nudge-banner')) return;
    try {
      if (sessionStorage.getItem('org_risk_nudge_dismissed') === 'true') return;
    } catch (e) { /* sessionStorage unavailable — fall through and still show it */ }

    var main = document.querySelector('.main-content') || document.querySelector('main');
    if (!main) return;

    var banner = el('div', { className: 'page-banner page-banner--warning' });
    banner.id = 'org-risk-nudge-banner';
    banner.setAttribute('role', 'status');
    var body = el('div', { className: 'page-banner-body' });
    var msg = el('span', {
      className: 'page-banner-msg',
      text: 'You have ' + mineUnmitigated + (mineUnmitigated === 1
        ? ' unmitigated high/critical flight-risk entry you own'
        : ' unmitigated high/critical flight-risk entries you own') + '.',
    });
    body.appendChild(msg);
    banner.appendChild(body);
    // Inserted at main.firstChild exactly like the existing stale-synergy
    // nudge banner above — the two banners STACK (each insertion pushes
    // the previous one down), never merge text, and each dismisses
    // independently via its own sessionStorage key.
    main.insertBefore(banner, main.firstChild);
    if (typeof window.makeBannerDismissible === 'function') {
      window.makeBannerDismissible(banner, 'org_risk_nudge_dismissed', 'session');
    }
  }

  /** Entry point — called by public/js/dashboard.js's deal-bound branch.
   * Fetches all five sources, then renders all four panels plus both
   * nudges (stale-synergy, flight-risk) once every fetch has resolved
   * (best-effort: a single failed fetch renders that panel's own empty
   * state, or — for a rollup — simply omits its nudge, rather than
   * blanking the whole page). */
  function renderDealHome(dealId) {
    var container = document.getElementById('deal-home');
    if (!container) return;
    container.textContent = '';
    var wrap = el('div', { className: 'deal-home-wrap' });
    container.appendChild(wrap);

    Promise.all([
      fetch('/api/deals').then(function (r) { return r.json(); }).catch(function () { return []; }),
      fetch('/api/assessment-status').then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch('/api/dd/summary').then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch('/api/synergies/rollup').then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch('/api/org/summary').then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (results) {
      var deals = Array.isArray(results[0]) ? results[0] : [];
      var statusData = results[1];
      var summary = results[2];
      var rollup = results[3];
      var orgSummary = results[4];
      var deal = deals.filter(function (d) { return d.id === dealId; })[0] || null;

      wrap.textContent = '';
      renderSetupChecklist(wrap, deal);
      renderReadiness(wrap, statusData);
      renderDiligence(wrap, summary);
      renderOrgPanel(wrap, orgSummary);
      renderFlightRiskNudge(wrap, orgSummary);
      renderStaleSynergyNudge(wrap, rollup);

      // Plan 08 Task 2 walk finding F2: the org panel's five decision-type
      // labels (renderOrgPanel above) carry data-i18n, but this whole panel
      // is built asynchronously AFTER transitions.js's own one-time
      // [data-i18n] pass already ran at i18n-dictionary-fetch time — a
      // fresh page load with a non-EN language already stored otherwise
      // leaves them in English forever. Mirrors the SAME
      // `if (window.applyPortalI18n) window.applyPortalI18n();` idiom
      // already established in public/js/dashboard.js/execution.js/
      // assessments.js/app.js/employee.js — never a new pattern.
      if (window.applyPortalI18n) window.applyPortalI18n();
    });
  }

  window.renderDealHome = renderDealHome;
})();
