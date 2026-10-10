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

  // --- deal data (MNPI): staff only --------------------------------------------
  { prefix: '/api/synergies', roles: STAFF_ROLES,
    why: 'synergy financials (run-rate, one-time cost, owners) — staff only (R1-05)' },
  { prefix: '/api/integration-tasks', roles: STAFF_ROLES,
    why: 'integration task lane (titles can name the pre-announcement target); an employee gets no task list and no task nudge in a real deal (plan 11-05 withholds the notifications counts from every role this rule refuses)' },
  { prefix: '/api/checklist-templates', roles: STAFF_ROLES,
    why: 'integration checklist templates feed the task lane' },
  { prefix: '/api/raid', roles: STAFF_ROLES,
    why: 'RAID register — risks and decisions about the deal (R1-05)' },
  { prefix: '/api/org', roles: STAFF_ROLES,
    why: 'org design: named positions, target-state designs, retention data (MNPI)' },
  { prefix: '/api/dd', roles: STAFF_ROLES,
    why: 'due-diligence workspace (MNPI); handlers additionally apply per-area clearance' },
  { prefix: '/api/reports', roles: STAFF_ROLES,
    why: 'IMO reporting exports and the report pack aggregate every deal dataset' },
  // (plan 11-06: `/api/employees/get-or-create` is a POST now — a write, governed by
  // ROLE_WRITE_POLICY — so its temporary all-roles READ rule from amendment 1 is gone.)
  { prefix: '/api/employees', roles: STAFF_ROLES,
    why: 'the named roster (names, emails, departments) — staff only (R1-05)' },
  { prefix: '/api/communications', roles: STAFF_ROLES,
    why: 'communications log can name affected populations pre-announcement' },
  { prefix: '/api/projects', roles: STAFF_ROLES,
    why: 'project list carries target / project names' },
  { prefix: '/api/processes', roles: STAFF_ROLES,
    why: 'process integration catalog (sending -> receiving), deal operating model' },
  { prefix: '/api/assessments', roles: STAFF_ROLES,
    why: 'named assessment results list' },
  { prefix: '/api/ai/insight', roles: STAFF_ROLES,
    why: 'third-party egress of portal data to the AI provider' },
  { prefix: '/api/rag/search', roles: STAFF_ROLES,
    why: 'deal uploads are indexed; search would return their text' },

  // --- admin / lead only --------------------------------------------------------
  { prefix: '/api/assessment-instances', roles: ADMIN_ROLES,
    why: 'matches the handler\'s existing admin-only guard (lockedDown / isAdminRequest)' },
  { prefix: '/api/hrbps', roles: LEAD_ROLES,
    why: 'integration leader directory with colleague emails (D-11-06)' },

  // --- every role: not deal-sensitive, or already filtered per caller ------------
  { prefix: '/api/assessment/latest', roles: ALL_ROLES,
    why: 'org-level latest assessment scores, not personal' },
  { prefix: '/api/assessment-templates', roles: ALL_ROLES,
    why: 'assessment question templates (a respondent needs them)' },
  { prefix: '/api/assessment-status', roles: ALL_ROLES,
    why: 'completion status, respondent names already stripped by the handler' },
  { prefix: '/api/settings', roles: ALL_ROLES,
    why: 'portal settings (plan 11-02 returns only a public subset to non-admins)' },
  { prefix: '/api/departments', roles: ALL_ROLES, why: 'department list (employee dashboard)' },
  { prefix: '/api/modules', roles: ALL_ROLES, why: 'learning modules' },
  { prefix: '/api/questions', roles: ALL_ROLES, why: 'assessment questions (a respondent needs them)' },
  { prefix: '/api/slides', roles: ALL_ROLES, why: 'CMS slides' },
  { prefix: '/api/courses', roles: ALL_ROLES, why: 'CMS courses (employee learning)' },
  { prefix: '/api/lessons', roles: ALL_ROLES, why: 'CMS lessons (employee learning)' },
  { prefix: '/api/i18n', roles: ALL_ROLES, why: 'translations' },
  { prefix: '/api/menus', roles: ALL_ROLES, why: 'CMS menus (the shell renders them for every role)' },
  { prefix: '/api/pages', roles: ALL_ROLES, why: 'CMS pages' },
  { prefix: '/api/banners', roles: ALL_ROLES, why: 'CMS banners' },
  { prefix: '/api/media', roles: ALL_ROLES, why: 'CMS media' },
  { prefix: '/api/notifications', roles: ALL_ROLES,
    why: 'caller\'s notifications (plan 11-05 gates the task / RAID nudges per role)' },
  { prefix: '/api/alerts', roles: ALL_ROLES, why: 'alerts' },
  { prefix: '/api/pulses', roles: ALL_ROLES,
    why: 'pulse surveys (plan 11-05 projects personal data per role)' },
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
// show (served as the `access` map on GET /api/auth/me by plan 11-07; the
// browser keeps no copy of this table — window.maCan() only reads that map).
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
  // Phase 11 review WR-C03: the per-template instance list (admin-only rule
  // above); assessments.js falls back to the status rollup without asking.
  assessmentInstances: '/api/assessment-instances',
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
