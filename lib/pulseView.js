'use strict';
// [security] D-11-06 / AUTHZ-01 / R1-15 (Phase 11): role-aware projection of the
// pulse survey feed.
//
// Before this module, GET /api/pulses handed every signed-in member the named
// rating and free-text comment of every colleague (employeeName + comment are
// personal data about named people). In a real deal that is now limited to:
//
//   admin / hrbp  -> every pulse, unchanged (the Integration Leader reads the
//                    named feedback it exists to surface)
//   author        -> the caller's OWN pulses in full (matched on the
//                    server-stamped `authorUsername`, never on the free-text
//                    `employeeName`, which any caller can type)
//   pmo           -> own pulses in full, plus ONE AGGREGATE ROW per other pulse
//                    so a workstream lead can still read the deal's mood trend
//   employee /    -> own pulses only
//   anything else    (unknown or missing role is fail-closed: own-only)
//
// Mitigation strategy for re-identification (T-11-42): in a small team the
// metadata around an anonymous rating re-identifies its author, so an aggregate
// row carries ONLY `rating`, `type` and the calendar `day` — no id, no name, no
// comment, no time of day — and the rows are re-sorted (day, rating, type) so the
// order the feedback arrived in is not preserved either.
//
// Legacy pulses created before authorUsername was stamped have no author; they
// are never "own" for anybody (a missing username must never match a missing
// author), so they are full only to admin/hrbp and aggregate-only for pmo.
//
// Pure function: no I/O, never mutates its input. The demo store never reaches
// this module (the caller applies it only when req.isDemo !== true), so the
// showcase response stays exactly as demonstrated.

const FULL_ROLES = ['admin', 'hrbp'];
const AGGREGATE_ROLES = ['pmo'];

function isOwn(pulse, username) {
  return !!username && !!pulse && typeof pulse.authorUsername === 'string'
    && pulse.authorUsername !== '' && pulse.authorUsername === username;
}

function aggregateRow(p) {
  return { rating: p.rating, type: p.type, day: String(p.timestamp || '').slice(0, 10) };
}

function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * @param {string|null|undefined} role      caller's role
 * @param {string|null|undefined} username  caller's session username
 * @param {object[]} pulses                 the unprojected pulse list
 * @returns {object[]} the projection the caller may read
 */
function pulsesFor(role, username, pulses) {
  const list = Array.isArray(pulses) ? pulses : [];
  if (FULL_ROLES.includes(role)) return list;
  const own = list.filter((p) => isOwn(p, username));
  if (!AGGREGATE_ROLES.includes(role)) return own;
  const aggregates = list
    .filter((p) => !isOwn(p, username))
    .map(aggregateRow)
    .sort((a, b) => cmp(a.day, b.day) || cmp(a.rating, b.rating) || cmp(String(a.type), String(b.type)));
  return own.concat(aggregates);
}

module.exports = { pulsesFor };
