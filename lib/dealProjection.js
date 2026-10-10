'use strict';
// [security] CR-01 (Phase 11 review, AUTHZ-01 / D-11-01 / D-11-02): the ONE
// per-role projection of a control-plane deal registry record.
//
// The registry row (db/controlStore.js) carries far more than the deal switcher
// needs: `setup.steps.<step>.data` (deal size, signing / expected-close dates,
// currency), `dealSettings` (the IL's synergy target, staleness threshold,
// phasing horizon), `day1Date`, `members[]` (every colleague's username),
// `memberGrants` (who holds which clean-room clearance) and `createdBy`.
// Membership filtering (listDealsForUser / isDealMember) decides WHICH deals a
// caller sees; this module decides WHAT of each deal they see. Pre-announcement
// valuations and synergy financials are MNPI, and the read policy already
// refuses `/api/synergies` to an employee — the same figures must not be
// readable one route over through the deal record.
//
// Mitigation strategy: an ALLOWLIST per role, applied at EVERY route that hands
// a deal record to a client (GET /api/deals, the POST /api/deals/select echo,
// and the create / setup / members / grants / archive responses — server.js).
//   - admin, hrbp: the full record (they create and run the deal).
//   - pmo:         { id, name, targetCompany, status } — what the deal switcher
//                  renders (public/js/deal-switcher.js).
//   - employee:    { id, name, status } — no target company: a pre-announcement
//                  target name is MNPI and `name` is the deal's code name.
//   - any other / missing role: the employee shape (fail closed — a role this
//                  table does not know never gets more than the least-privileged
//                  known role).
// A new field added to the registry record later is therefore withheld from
// pmo / employee by default; widening needs an explicit edit here.

const FULL_RECORD_ROLES = new Set(['admin', 'hrbp']);
const ROLE_FIELDS = Object.freeze({
  pmo: Object.freeze(['id', 'name', 'targetCompany', 'status']),
  employee: Object.freeze(['id', 'name', 'status']),
});
const LEAST_PRIVILEGED_FIELDS = ROLE_FIELDS.employee;

/**
 * The deal record as `role` may see it. `null` / non-object values pass
 * through unchanged (e.g. the `deal: null` return-to-demo echo).
 */
function projectDealForRole(deal, role) {
  if (!deal || typeof deal !== 'object') return deal;
  if (FULL_RECORD_ROLES.has(role)) return deal;
  const fields = Object.prototype.hasOwnProperty.call(ROLE_FIELDS, role) ? ROLE_FIELDS[role] : LEAST_PRIVILEGED_FIELDS;
  const out = {};
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(deal, key)) out[key] = deal[key];
  }
  return out;
}

/** Convenience for a list response. */
function projectDealsForRole(deals, role) {
  return (Array.isArray(deals) ? deals : []).map((d) => projectDealForRole(d, role));
}

module.exports = { projectDealForRole, projectDealsForRole, FULL_RECORD_ROLES, ROLE_FIELDS };
