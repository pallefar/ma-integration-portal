'use strict';
// [security] D-11-01 / AUTHZ-01 / R1-05 (Phase 11): the explicit READ policy.
//
// Before this module, reads were gated on "has a session" only — a real-deal
// `employee` could GET the synergy financials, RAID, the roster, org designs and
// DD records, because the only role check (ROLE_WRITE_POLICY) applied to writes.
// This table makes "which role may read which route" a declared, tested contract.
//
// Mitigation strategy (defence in depth, not one fix):
//   1. EXPLICIT, FAIL-CLOSED: every GET /api route family has a rule here and
//      there is NO default rule — an unlisted path is refused by the gate for any
//      non-demo request (control-plane and deal-bound alike). A coverage test
//      (test/read-policy-coverage.test.js) fails the build on a registered GET
//      route with no rule, and on a rule that matches no route.
//   2. CANONICAL-ANCHORED: the verdict is taken over the canonical spelling of
//      the path (lib/requestPath.js: decoded once, `//` collapsed, trailing slash
//      stripped, lowercased) — see readAllowsForms() for the exact rule and why.
//   3. DEMO STORE STAYS LENIENT: the gate only evaluates this table when the
//      request did not resolve to the demo store (req.isDemo !== true). The
//      committed showcase must remain exactly as demonstrated (D-11-01); a deal
//      or control-plane resolution is always strict.
//
// Rules are written in the SAME boundary-safe shape as server.js's
// ROLE_WRITE_POLICY: first match wins; `exact` means equality; otherwise
// `path === prefix || path.startsWith(prefix + '/')`. Order matters — more
// specific prefixes come first.

const ALL_ROLES = ['admin', 'hrbp', 'pmo', 'employee'];
const STAFF_ROLES = ['admin', 'hrbp', 'pmo'];
const LEAD_ROLES = ['admin', 'hrbp'];
const ADMIN_ROLES = ['admin'];

const ROLE_READ_POLICY = [
  // --- control plane / account surfaces --------------------------------------
  { prefix: '/api/admin', roles: ADMIN_ROLES,
    why: 'account roster, audit log, source/db archive download: admin only for every method (CR-02)' },
  { prefix: '/api/auth/sessions', roles: ALL_ROLES,
    why: 'every role lists and ends its OWN sessions (D-10-07); the handler is keyed by the caller' },
  { prefix: '/api/deals', exact: true, roles: ALL_ROLES,
    why: 'the deal list is already filtered to the caller\'s own memberships (the deal switcher)' },
  { prefix: '/api/deals', roles: LEAD_ROLES,
    why: 'per-deal member grants (GET /api/deals/:id/grants) are admin + hrbp, matching the handler\'s inline guard' },

  // --- deal data (MNPI) -------------------------------------------------------
  { prefix: '/api/synergies', roles: STAFF_ROLES,
    why: 'synergy financials (run-rate, one-time cost, owners) — staff only (R1-05)' },

  // --- everything else: today\'s effective roles (narrowed in a later task) ---
  { prefix: '/api/integration-tasks', roles: ALL_ROLES, why: 'integration task lane' },
  { prefix: '/api/checklist-templates', roles: ALL_ROLES, why: 'checklist templates' },
  { prefix: '/api/raid', roles: ALL_ROLES, why: 'RAID register' },
  { prefix: '/api/org', roles: ALL_ROLES, why: 'org design' },
  { prefix: '/api/dd', roles: ALL_ROLES, why: 'due-diligence workspace' },
  { prefix: '/api/reports', roles: ALL_ROLES, why: 'IMO reporting exports' },
  { prefix: '/api/employees/get-or-create', exact: true, roles: ALL_ROLES,
    why: 'the employee portal resolves its own roster record on load (amendment 1; plan 11-06 makes it a POST and removes this rule)' },
  { prefix: '/api/employees', roles: ALL_ROLES, why: 'employee roster' },
  { prefix: '/api/communications', roles: ALL_ROLES, why: 'communications log' },
  { prefix: '/api/projects', roles: ALL_ROLES, why: 'project list' },
  { prefix: '/api/processes', roles: ALL_ROLES, why: 'process catalog' },
  { prefix: '/api/assessment/latest', roles: ALL_ROLES, why: 'org-level latest assessment scores' },
  { prefix: '/api/assessment-templates', roles: ALL_ROLES, why: 'assessment question templates' },
  { prefix: '/api/assessment-status', roles: ALL_ROLES, why: 'assessment completion status' },
  { prefix: '/api/assessment-instances', roles: ALL_ROLES, why: 'assessment instances' },
  { prefix: '/api/assessments', roles: ALL_ROLES, why: 'assessment results list' },
  { prefix: '/api/ai/insight', roles: ALL_ROLES, why: 'AI insight' },
  { prefix: '/api/rag/search', roles: ALL_ROLES, why: 'document search' },
  { prefix: '/api/hrbps', roles: ALL_ROLES, why: 'integration leader directory' },
  { prefix: '/api/settings', roles: ALL_ROLES, why: 'portal settings' },
  { prefix: '/api/departments', roles: ALL_ROLES, why: 'departments' },
  { prefix: '/api/modules', roles: ALL_ROLES, why: 'learning modules' },
  { prefix: '/api/questions', roles: ALL_ROLES, why: 'assessment questions' },
  { prefix: '/api/slides', roles: ALL_ROLES, why: 'CMS slides' },
  { prefix: '/api/courses', roles: ALL_ROLES, why: 'CMS courses' },
  { prefix: '/api/lessons', roles: ALL_ROLES, why: 'CMS lessons' },
  { prefix: '/api/i18n', roles: ALL_ROLES, why: 'translations' },
  { prefix: '/api/menus', roles: ALL_ROLES, why: 'CMS menus' },
  { prefix: '/api/pages', roles: ALL_ROLES, why: 'CMS pages' },
  { prefix: '/api/banners', roles: ALL_ROLES, why: 'CMS banners' },
  { prefix: '/api/media', roles: ALL_ROLES, why: 'CMS media' },
  { prefix: '/api/notifications', roles: ALL_ROLES, why: 'caller\'s notifications' },
  { prefix: '/api/alerts', roles: ALL_ROLES, why: 'alerts' },
  { prefix: '/api/pulses', roles: ALL_ROLES, why: 'pulse surveys' },
];

/** First matching rule or `undefined` — there is deliberately NO default rule. */
function readRuleFor(p) {
  const path = String(p || '');
  return ROLE_READ_POLICY.find((r) => (r.exact
    ? path === r.prefix
    : path === r.prefix || path.startsWith(r.prefix + '/')));
}

function roleAllowedForRead(role, p) {
  const rule = readRuleFor(p);
  return !!rule && rule.roles.includes(role);
}

/**
 * The gate's verdict over every canonical spelling of a request path.
 *
 * [security] CR-01 (Phase 10) most-restrictive property, anchored on the
 * canonical form: allowed iff the CANONICAL path has a rule that allows `role`,
 * AND every other spelling in `forms` that HAS a rule of its own also allows it.
 * A spelling with no rule of its own (e.g. the raw `/api/Admin/users`, which has
 * no lower-case match) inherits the canonical verdict instead of being treated
 * as unlisted.
 *
 * Why not "every form must have an allowing rule"? Measured: that refuses
 * admin on case variants (it breaks the CR-01 live suite) while adding no
 * protection, because `case sensitive routing` (server.js) already 404s such
 * spellings at the router. Refusing when ANY ruled form refuses keeps the
 * Phase 10 CR-01 property that no spelling can widen a role.
 */
function readAllowsForms(role, forms, canonical) {
  const rule = readRuleFor(canonical);
  if (!rule || !rule.roles.includes(role)) return false;
  for (const f of Array.isArray(forms) ? forms : []) {
    const r = readRuleFor(f);
    if (r && !r.roles.includes(role)) return false;
  }
  return true;
}

// Probe path per capability key — one source of truth for what a client may
// show (consumed by plan 11-07; no client-side copy of the table).
const ACCESS_PROBES = {
  synergies: '/api/synergies',
  raid: '/api/raid',
  tasks: '/api/integration-tasks',
  roster: '/api/employees',
  communications: '/api/communications',
  org: '/api/org/positions',
  dd: '/api/dd/areas',
  reports: '/api/reports/export',
  hrbps: '/api/hrbps',
  projects: '/api/projects',
  processes: '/api/processes',
  assessmentsList: '/api/assessments',
  ai: '/api/ai/insight',
  rag: '/api/rag/search',
};

/**
 * Booleans a client may use to hide controls the caller's role cannot read.
 * `dealBound` false (demo store) => everything true, mirroring the lenient gate.
 */
function accessSummaryFor(role, dealBound) {
  const out = {};
  for (const key of Object.keys(ACCESS_PROBES)) {
    out[key] = dealBound ? roleAllowedForRead(role, ACCESS_PROBES[key]) : true;
  }
  return out;
}

module.exports = {
  ALL_ROLES, STAFF_ROLES, LEAD_ROLES, ADMIN_ROLES,
  ROLE_READ_POLICY, readRuleFor, roleAllowedForRead, readAllowsForms, accessSummaryFor,
};
