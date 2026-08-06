/**
 * Deal home (D-19) — ALL deal-bound rendering for the dashboard page lives
 * here, in one file that can be grep-asserted as a whole, so this new
 * surface never has to be audited against public/js/dashboard.js's ~2400
 * lines of pre-existing (and legitimately markup-assigning) demo rendering.
 *
 * Renders three panels into #deal-home, entirely from server responses that
 * are already scoped to the caller's own clearance/membership — this module
 * holds NO client-side list of "every possible area" or "every possible
 * setup step's completeness" to fall back on; an uncleared DD area is
 * simply absent from what it draws (T-04-46), mirroring
 * public/js/due-diligence.js's own D-16 discipline.
 *
 * - Setup checklist — GET /api/deals, the caller's own deal by id.
 * - Readiness assessments — GET /api/assessment-status (WIZ-01's
 *   pending/bySubject rollup, already in the server's declared subject
 *   order).
 * - Diligence progress — GET /api/dd/summary (this plan's clearance-scoped
 *   rollup, Task 1).
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

  /** Entry point — called by public/js/dashboard.js's deal-bound branch.
   * Fetches all four sources, then renders all three panels plus the
   * stale-synergy nudge once every fetch has resolved (best-effort: a
   * single failed fetch renders that panel's own empty state, or — for
   * the rollup — simply omits the nudge, rather than blanking the whole
   * page). */
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
    ]).then(function (results) {
      var deals = Array.isArray(results[0]) ? results[0] : [];
      var statusData = results[1];
      var summary = results[2];
      var rollup = results[3];
      var deal = deals.filter(function (d) { return d.id === dealId; })[0] || null;

      wrap.textContent = '';
      renderSetupChecklist(wrap, deal);
      renderReadiness(wrap, statusData);
      renderDiligence(wrap, summary);
      renderStaleSynergyNudge(wrap, rollup);
    });
  }

  window.renderDealHome = renderDealHome;
})();
