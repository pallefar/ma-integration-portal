'use strict';
// D-11-05 / AUTHZ-05 (Phase 11, plan 11-04): the rate-bounded authorization-
// denial recorder. Every 401/403 the consolidated /api gate and the deal
// resolver return, and every clearance-404, becomes an `access-denied`
// security event naming actor, route template, method and reason — without
// letting a probe flood the append-only audit.db.
//
// [security] WHY RATE-BOUNDED. An attacker (or a buggy poller) controls how
// many denials it triggers, and audit.db rows are PERMANENT (AUD-02). One row
// per denial would turn a 100-request/second probe into an unbounded,
// unprunable write amplification (R1-07 / R2-01). The bound is: at most ONE row
// per (actor, method, route template, reason) per window (default 60 s). The
// first denial of a fresh key writes its row immediately (count 1); denials
// that arrive while that window is open are only COUNTED in memory; when the
// window expires the folded denials are written ONCE as that key's next row
// (`count = n`, `folded: true`) and a new window opens, so the bound holds
// across the whole run and no count is dropped while the process lives.
//
// [security] WHY NOT UPDATE THE FIRST ROW'S COUNTER. The PRD wording ("an
// incrementing counter in the same row's detail") cannot be implemented
// literally: db/audit-schema.sql carries `audit_log_no_update` /
// `audit_log_no_delete` triggers that RAISE(ABORT) on any UPDATE (AUD-02,
// append-only by construction). The counter therefore lives in memory per
// window and is written as the NEXT row. This module issues no SQL at all —
// `write` is injected (db/auditHook.js#recordSecurityEvent in server.js), so
// the append-only invariant cannot be touched from here.
//
// [security] WHY KEYS ARE ROUTE TEMPLATES, NOT PATHS. `DELETE /api/raid/<id>`
// with a thousand random ids is ONE key (`DELETE /api/raid/:id`), not a
// thousand — the key space is bounded by accounts x methods x registered
// routes x a fixed reason set, never by anything the caller can mint. The
// in-memory map is additionally capped (`maxKeys`); once full, a new key is
// folded into a per-reason `(overflow)` key instead of growing the map.
//
// [security] NO SWALLOW. A `write` that throws (a busy audit.db — Phase 8) is
// NOT caught here: the refusal that could not be audited still happens, as the
// central 503, never as a silently-unrecorded denial. Pending counts survive a
// failed write (state is only advanced after a write succeeds).
//
// [security] CLEARANCE DENIALS (Phase 11 review WR-01). The DD and org
// clean-room refusals (`dd-access-denied`, `org-positions-target-access-denied`,
// `org-decisions-access-denied`, `org-flightrisk-access-denied`) predate this
// module and are what compliance queries by name, so they go through the SAME
// bound but keep their own action name and row shape: a record() call that
// passes `action` (+ optional `subject`, a bounded value such as a DD area id
// or null) writes `{ action, subject, after: null }` for the first denial of a
// window — byte-for-byte the row those sites always wrote — and the folded
// count as the key's next row under the same action (`after: { count, folded:
// true, ... }`). The subject is part of the key, so "unknown id" (subject
// null) and "uncleared area" (subject = the area) stay distinguishable rows.
//
// [security] The deal id is part of every key: a denial in deal B must never
// fold into (and be reported under) a row naming deal A. The deal id comes from
// the server-side session binding / resolution, never from the request, so the
// key space stays bounded.
//
// ACCEPTED LOSS (T-11-35 / amendment 7): pending (not yet written) counts are
// held in process memory. A crash or kill loses at most one window's folded
// counts per key; the first denial of every window is always already durable.
// The bound is per process (replicas:1 under Option B). See DEPLOYMENT.md.

const ANONYMOUS = '(anonymous)';
const UNROUTED = '(unrouted)';
const OVERFLOW = '(overflow)';
const MAX_PATH_CHARS = 256;

function clipPath(p) {
  const s = typeof p === 'string' ? p : '';
  return s.length > MAX_PATH_CHARS ? s.slice(0, MAX_PATH_CHARS) : s;
}

/**
 * @param {object} opts
 * @param {number}   [opts.windowMs=60000]  rate window per key
 * @param {number}   [opts.maxKeys=5000]    cap on distinct live keys
 * @param {Function} [opts.now=Date.now]    injectable clock (ms)
 * @param {Function} opts.write             (event) => void — synchronous, may throw
 * @param {Function} [opts.templateFor]     (canonicalPath, method) => route template | null
 */
function createDenialAuditor({ windowMs = 60000, maxKeys = 5000, now = Date.now, write, templateFor } = {}) {
  if (typeof write !== 'function') {
    throw new Error('createDenialAuditor: `write` is required');
  }
  const entries = new Map();
  // Throttle the opportunistic sweep done at the start of record(): a full map
  // is up to maxKeys iterations, so it runs at most once per sweepEveryMs.
  const sweepEveryMs = Math.max(1, Math.min(1000, Math.floor(windowMs / 10)));
  let lastSweepAt = -Infinity;
  let timer = null;

  function emit(entry, count, folded) {
    if (entry.action) {
      // Legacy-named clearance denial (WR-01): the first row of a window is the
      // exact row the call site always wrote; a folded row carries the count.
      write({
        actor: { username: entry.actorName, role: entry.role, sessionId: entry.sessionId },
        action: entry.action,
        dealId: entry.dealId || null,
        subject: entry.subject === undefined ? null : entry.subject,
        before: null,
        after: folded
          ? {
            reason: entry.reason,
            status: entry.status,
            path: entry.path,
            route: `${entry.method} ${entry.route}`,
            count,
            folded: true,
            windowStartedAt: new Date(entry.windowStart).toISOString(),
          }
          : null,
        request: entry.request,
      });
      return;
    }
    write({
      actor: { username: entry.actorName, role: entry.role, sessionId: entry.sessionId },
      action: 'access-denied',
      dealId: entry.dealId || null,
      subject: `${entry.method} ${entry.route}`,
      after: {
        reason: entry.reason,
        status: entry.status,
        path: entry.path,
        count,
        folded,
        windowStartedAt: new Date(entry.windowStart).toISOString(),
      },
      request: entry.request,
    });
  }

  /** Resolve a key to a LIVE entry, retiring/flushing an expired one. */
  function liveEntry(key, t) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (t - entry.windowStart < windowMs) return entry;
    if (entry.pending > 0) {
      emit(entry, entry.pending, true);      // may throw: state untouched until it succeeds
      entry.pending = 0;
      entry.windowStart = t;                  // re-open so the 1-row-per-window bound holds
      return entry;
    }
    entries.delete(key);
    return undefined;
  }

  /** Flush every expired window with pending denials; evict idle expired keys. Returns rows written. */
  function sweepAt(t) {
    let rows = 0;
    for (const [key, entry] of entries) {
      if (t - entry.windowStart < windowMs) continue;
      if (entry.pending > 0) {
        emit(entry, entry.pending, true);
        entry.pending = 0;
        entry.windowStart = t;
        rows += 1;
      } else {
        entries.delete(key);
      }
    }
    return rows;
  }

  function sweep() {
    lastSweepAt = now();
    return sweepAt(lastSweepAt);
  }

  /**
   * Record one denial. Returns true when this call wrote an audit row (the
   * first denial of a key's window), false when it was folded into the open
   * window's count.
   */
  function record({ actor, method, path, reason, status, dealId, request, route, action, subject }) {
    const t = now();
    if (t - lastSweepAt >= sweepEveryMs) {
      lastSweepAt = t;
      sweepAt(t);
    }

    const actorName = actor && typeof actor.username === 'string' && actor.username ? actor.username : ANONYMOUS;
    const meth = typeof method === 'string' && method ? method.toUpperCase() : '(none)';
    const cleanPath = clipPath(path);
    const tmpl = route || (typeof templateFor === 'function' ? templateFor(cleanPath, meth) : null) || UNROUTED;
    const why = String(reason);
    const legacyAction = typeof action === 'string' && action ? action : null;
    const subj = legacyAction && subject !== undefined && subject !== null ? String(subject) : null;

    let key = `${actorName}|${dealId || ''}|${meth}|${tmpl}|${why}`
      + (legacyAction ? `|${legacyAction}|${subj === null ? '' : subj}` : '');
    let entry = liveEntry(key, t);
    if (entry) {
      entry.pending += 1;
      // The folded row names the most recent request (ip/path) of its window.
      entry.request = shapeRequest(request, meth, cleanPath);
      return false;
    }

    let fresh;
    if (entries.size >= maxKeys) {
      // Capacity: fold into a per-reason overflow key (bounded by the fixed
      // reason set, so it may sit just past maxKeys).
      key = `${OVERFLOW}|${why}`;
      entry = liveEntry(key, t);
      if (entry) {
        entry.pending += 1;
        return false;
      }
      fresh = {
        actorName: OVERFLOW, role: OVERFLOW, sessionId: null,
        method: '(any)', route: OVERFLOW, reason: why, status, path: '',
        dealId: null, request: { method: null, path: null, ip: null },
      };
    } else {
      fresh = {
        actorName,
        role: (actor && actor.role) || (actorName === ANONYMOUS ? ANONYMOUS : 'unknown'),
        sessionId: (actor && actor.sessionId) || null,
        method: meth, route: tmpl, reason: why, status, path: cleanPath,
        dealId: dealId || null, request: shapeRequest(request, meth, cleanPath),
        action: legacyAction, subject: subj,
      };
    }
    fresh.windowStart = t;
    fresh.pending = 0;
    emit(fresh, 1, false);                    // may throw: nothing recorded in memory
    entries.set(key, fresh);
    return true;
  }

  function shapeRequest(request, meth, cleanPath) {
    return {
      method: (request && request.method) || meth,
      path: clipPath(request && request.path) || cleanPath,
      ip: (request && request.ip) || null,
    };
  }

  /** Write every pending count now (test helper / graceful-shutdown hook). */
  function flushAll() {
    let rows = 0;
    for (const entry of entries.values()) {
      if (entry.pending > 0) {
        emit(entry, entry.pending, true);
        entry.pending = 0;
        rows += 1;
      }
    }
    return rows;
  }

  /** Start the unref'd periodic sweep (idempotent) — never holds the process open. */
  function startSweeper() {
    if (timer) return;
    timer = setInterval(() => {
      try {
        sweep();
      } catch (e) {
        // A busy audit.db: pending counts are kept and retried next tick.
        console.error('[security] denial-audit sweep deferred (audit write failed).');
      }
    }, windowMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stopSweeper() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { record, sweep, flushAll, size: () => entries.size, startSweeper, stopSweeper };
}

module.exports = { createDenialAuditor, ANONYMOUS, UNROUTED, OVERFLOW };
