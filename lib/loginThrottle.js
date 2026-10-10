'use strict';
// D-10-06 (Phase 10, plan 05): sliding-window failure counter with exponential
// backoff, used by /api/auth/login and /api/auth/change-password in server.js.
//
// [security] Design.
//   - The login throttle keys on the SUBMITTED account name (and, separately, on
//     the source address), NOT only on the source address. A single mistyped
//     password therefore cannot lock out a whole team that reaches the app
//     through one reverse-proxy address (R1-08 / T-10-28), and a throttled
//     answer is identical whether the name exists or not (T-10-30).
//   - A key's first `freeFailures` failures inside the sliding window are free.
//     From then on an attempt is only allowed once
//     lastFailure + min(maxDelayMs, baseDelayMs * 2^(count - freeFailures)).
//   - The map is bounded (T-10-31): expired keys are pruned at most once per 60 s
//     and whenever the size exceeds `maxEntries`, then the oldest entries are
//     evicted down to the cap, so a flood of distinct names cannot grow memory.
//   - check(key, {maxDelayMs}) takes a per-call ceiling. server.js passes the
//     SAME ceiling for every account name (WR-01): a role-dependent ceiling
//     would let Retry-After / the moment a 429 lifts reveal which names are
//     enabled admins.
//
// [security] Targeted-lockout recovery (T-10-55) — the exact mechanism
// implemented: throttle state is held only in this process's memory and is never
// persisted; a locked-out admin (1) waits — every account's backoff, admin or
// not, is capped at 5 minutes — or (2) the operator restarts the service, which clears every
// throttle entry; if the admin password itself is lost or suspected compromised,
// the operator stops the service, runs `node scripts/bootstrap-admin.js
// --force-reset-admin` (rotates the password, forces a change at next sign-in,
// deletes admin sessions) and starts the service again — the restart is what
// clears the throttle; the CLI does not reach into a running server.

const PRUNE_INTERVAL_MS = 60 * 1000;

function createThrottle({
  windowMs,
  freeFailures,
  baseDelayMs,
  maxDelayMs,
  maxEntries,
  now = Date.now,
} = {}) {
  // key -> array of failure timestamps (ms), oldest first, all inside windowMs.
  const entries = new Map();
  let lastPrune = now();
  // Beyond this many recorded failures the computed delay is already at its
  // ceiling for any sane configuration; bounding the array bounds per-key memory.
  const MAX_KEPT_FAILURES = freeFailures + 40;

  function liveFailures(key, t) {
    const list = entries.get(key);
    if (!list) return null;
    let i = 0;
    while (i < list.length && t - list[i] > windowMs) i++;
    if (i > 0) list.splice(0, i);
    if (list.length === 0) {
      entries.delete(key);
      return null;
    }
    return list;
  }

  function prune() {
    const t = now();
    lastPrune = t;
    for (const key of Array.from(entries.keys())) liveFailures(key, t);
    if (entries.size > maxEntries) {
      // Map iteration order is insertion order: oldest first.
      let excess = entries.size - maxEntries;
      for (const key of entries.keys()) {
        if (excess-- <= 0) break;
        entries.delete(key);
      }
    }
  }

  function maybePrune() {
    if (entries.size > maxEntries || now() - lastPrune >= PRUNE_INTERVAL_MS) prune();
  }

  function delayFor(count, ceiling) {
    const exponent = Math.min(count - freeFailures, 40);
    const raw = baseDelayMs * Math.pow(2, exponent);
    return Math.min(ceiling, raw);
  }

  /**
   * @returns {{allowed: boolean, retryAfterMs: number}}
   * `opts.maxDelayMs` can only LOWER the instance ceiling for this call.
   */
  function check(key, opts) {
    const t = now();
    const list = liveFailures(key, t);
    if (!list || list.length < freeFailures) return { allowed: true, retryAfterMs: 0 };
    const override = opts && Number.isFinite(opts.maxDelayMs) ? opts.maxDelayMs : Infinity;
    const ceiling = Math.min(maxDelayMs, override);
    const allowedAt = list[list.length - 1] + delayFor(list.length, ceiling);
    if (t >= allowedAt) return { allowed: true, retryAfterMs: 0 };
    return { allowed: false, retryAfterMs: allowedAt - t };
  }

  /**
   * Record a failure. `engaged` is true exactly when this failure is the one
   * that makes the key enter backoff (count === freeFailures), i.e. once per
   * backoff episode — callers log it.
   */
  function fail(key) {
    const t = now();
    maybePrune();
    let list = liveFailures(key, t);
    if (!list) {
      list = [];
      entries.set(key, list);
    }
    list.push(t);
    if (list.length > MAX_KEPT_FAILURES) list.splice(0, list.length - MAX_KEPT_FAILURES);
    if (entries.size > maxEntries) prune();
    return { count: list.length, engaged: list.length === freeFailures };
  }

  function clear(key) {
    entries.delete(key);
  }

  function size() {
    return entries.size;
  }

  return { check, fail, clear, size, prune };
}

module.exports = { createThrottle };
