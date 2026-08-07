// DD-04 / D-03 / D-10 / D-16 / D-23: the clean-room need-to-know filter for
// due-diligence content. This is the reusable access-control primitive Phase
// 6's flight-risk register is expected to consume rather than inventing a
// second row/area-level access-policy pattern (ROADMAP Phase 6 "Depends on:
// Phase 4") — every export below is deliberately generic over "a deal object
// and a user", not DD-specific in its mechanics.
//
// WHY this module never opens a database connection itself (mirrors why
// db/controlStore.js's isDealMember() takes a `deal` it already fetched,
// applied here one level down — at the row/area level instead of the
// deal-membership level): every caller already holds the deal object via
// controlStore.getDeal(req.dealContext.dealId) by the time it needs an area
// decision, and a filter module reaching into its own connection would be a
// second, divergent path to the same control.db data controlStore.js already
// owns exclusively.
//
// Membership-lookup shape mirrored from db/controlStore.js#isDealMember
// (lines 107-113): resolve directly from the passed-in deal object, never
// re-fetch.
//
// D-03 vs D-04: filterByAreaGrant() is the LIST-response shape — it silently
// omits uncleared areas (a member browsing their own workspace is not
// "attempting access to anything" worth auditing). assertAreaGrant() is the
// BY-ID shape — it throws AreaAccessError, which the caller (server.js) both
// turns into the uniform-403 response AND writes a 'dd-access-denied'
// security event via db/auditHook.js's own event-recording function —
// this module holds NO reference to the audit store itself, mirroring why
// db/controlStore.js holds no reference to audit.db (AUD-02's isolation
// precedent, applied here to a different module for the same reason: keeping
// the audit dependency at the route-handler layer, never inside a filter
// primitive that a future caller might reuse in a context with no
// req/audit access at all).
'use strict';

// D-10: the fixed eight-area taxonomy, in this exact order — every later
// plan in this phase, and Phase 6, imports DD_AREAS/DD_AREA_IDS from here
// rather than redeclaring the list.
const DD_AREAS = [
  { id: 'legal', label: 'Legal' },
  { id: 'financial', label: 'Financial' },
  { id: 'tax', label: 'Tax' },
  { id: 'hr', label: 'HR' },
  { id: 'it', label: 'IT' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'operations', label: 'Operations' },
  { id: 'complianceEsg', label: 'Compliance/ESG' },
];

const DD_AREA_IDS = DD_AREAS.map((a) => a.id);
const DD_AREA_ID_SET = new Set(DD_AREA_IDS);

/** Thrown by assertAreaGrant() when the caller is not cleared for the given
 * area. Carries the SAME status/message for an uncleared area as for an
 * unknown item id — server.js's by-id routes pass a `null` areaId for a
 * missing item, which this class also refuses, giving the uniform-403
 * anti-enumeration shape by construction rather than by a second branch. */
class AreaAccessError extends Error {
  constructor() {
    super('You are not cleared for that due-diligence area.');
    this.name = 'AreaAccessError';
    this.status = 403;
  }
}

/**
 * D-16: every DD_AREA_IDS entry for admin or hrbp (the Integration Lead role
 * — admin and IL see every area in a deal they are a member of); otherwise
 * `deal.memberGrants[user.username].ddAreas` intersected with DD_AREA_IDS.
 * Returns `[]` when the user, the deal, or the grant entry is absent — never
 * throws, never defaults to the full set for an unrecognized shape.
 *
 * D-16's role-based (not deal-based) clearance for admin/hrbp PRESUPPOSES a
 * resolved deal — every real call site fetches one via
 * controlStore.getDeal(req.dealContext.dealId) before calling this function
 * (db/resolver.js's bind-time membership check guarantees that fetch never
 * fails for a request that reached a DD route at all). The `!deal` check
 * below runs BEFORE the role shortcut — not after — specifically so a future
 * caller that somehow invokes this with no resolved deal fails CLOSED for
 * every role, admin/hrbp included, rather than silently granting the
 * highest-privilege roles full access on a null deal. This ordering is a
 * defensive guard against a call-site bug, not a live code path today: it
 * changes nothing for any current caller, since `deal` is always a real
 * (possibly empty `{}`) object by the time this runs.
 */
function grantedAreas(deal, user) {
  if (!user) return [];
  if (!deal) return [];
  if (user.role === 'admin' || user.role === 'hrbp') return DD_AREA_IDS.slice();
  const grant = deal.memberGrants && deal.memberGrants[user.username];
  const ddAreas = grant && Array.isArray(grant.ddAreas) ? grant.ddAreas : [];
  return ddAreas.filter((a) => DD_AREA_ID_SET.has(a));
}

/** Exact string-equality clearance check on a single area id — never a
 * prefix or substring match (grantedAreas() already intersects against the
 * fixed DD_AREA_ID_SET, so `.includes()` here is exact by construction). */
function hasAreaGrant(deal, user, areaId) {
  return grantedAreas(deal, user).includes(areaId);
}

/** LIST-response filter (D-03): returns the input array filtered to items
 * whose `area` is granted, preserving the input's relative order — filtering
 * never re-sorts. */
function filterByAreaGrant(items, deal, user) {
  const granted = new Set(grantedAreas(deal, user));
  return items.filter((item) => granted.has(item.area));
}

/** BY-ID guard (D-04): throws AreaAccessError when `user` is not cleared for
 * `areaId`; returns undefined otherwise. The caller is responsible for
 * turning a caught AreaAccessError into the uniform 403 response AND the
 * `dd-access-denied` security event — this function does neither itself. */
function assertAreaGrant(deal, user, areaId) {
  if (!hasAreaGrant(deal, user, areaId)) throw new AreaAccessError();
}

module.exports = {
  DD_AREAS,
  DD_AREA_IDS,
  grantedAreas,
  hasAreaGrant,
  filterByAreaGrant,
  assertAreaGrant,
  AreaAccessError,
};
