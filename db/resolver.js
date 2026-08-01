// ISO-01 / ISO-03 / D-01 / D-03: the deal-resolver — the single choke point
// deciding which physical SQLite file THIS request is bound to (demo.db, a
// specific deals/<id>.db, or control.db for the deal-management surface)
// BEFORE any route handler runs. Every readDb()/writeDb() call downstream of
// this middleware resolves the SAME connection this module obtained — see
// db/store.js's requestDbStorage/runWithDb.
//
// Pitfall 3 (03-RESEARCH.md): membership is refused at BIND TIME, never as a
// post-hoc read-time filter. A non-member session simply never obtains a
// connection handle to that deal's file — a bug in any one of the ~60 write
// endpoints therefore cannot become a cross-deal write, because that
// connection was never created for this request in the first place.

const dbFiles = require('./dbFiles');
const controlStore = require('./controlStore');
const { getOrOpenConnection, runWithDb } = require('./store');

// The deal-management control-plane surface (list/select/create/archive/
// delete a deal, edit its membership — Plan 04) is deliberately resolved to
// control.db regardless of the session's CURRENT deal binding. Without this
// escape hatch, a session bound to a deal that was archived or deleted
// underneath it would be refused on EVERY route — including the one route
// that would let it rebind — locking the user out of the whole app. This
// covers BOTH `/api/deals*` (create/list/select/members) AND
// `/api/admin/deals*` (archive/delete) — the second family matters because
// ADMIN is always a member of every deal (isDealMember()), so an admin's OWN
// session can be bound to some unrelated, since-archived deal at the moment
// they try to archive/delete a DIFFERENT one; without this, that stale
// binding would 404 the admin out of the very endpoint meant to fix it.
const CONTROL_PLANE_PATHS = new Set(['/api/deals']);
function isControlPlanePath(fullPath) {
  return CONTROL_PLANE_PATHS.has(fullPath)
    || fullPath.startsWith('/api/deals/')
    || fullPath === '/api/admin/deals'
    || fullPath.startsWith('/api/admin/deals/');
}

/** Thrown by resolveDatabase() when a session's deal binding cannot be
 * honored — carries the HTTP status the gate should respond with. Resolving
 * to demo.db instead of throwing here would let an operator believe they are
 * looking at a real deal while actually reading demo rows (Pitfall 3). */
class DealAccessError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DealAccessError';
    this.status = status;
  }
}

/**
 * Resolve which database THIS request is bound to. Never falls back to demo
 * on a failed deal bind — throws DealAccessError instead, so a missing,
 * archived, or non-member deal binding is always refused, never silently
 * downgraded.
 *
 * Returns `{ kind: 'control'|'demo'|'deal', dealId, dbPath, schemaPath }`.
 */
function resolveDatabase(req) {
  const fullPath = (req.baseUrl || '') + (req.path || '');

  if (isControlPlanePath(fullPath)) {
    return { kind: 'control', dealId: null, dbPath: dbFiles.CONTROL_DB_PATH, schemaPath: dbFiles.CONTROL_SCHEMA_PATH };
  }

  const dealId = (req.portalUser && req.portalUser.dealId) || null;
  if (!dealId) {
    return { kind: 'demo', dealId: null, dbPath: dbFiles.DEMO_DB_PATH, schemaPath: dbFiles.DEAL_SCHEMA_PATH };
  }

  const deal = controlStore.getDeal(dealId);
  if (!deal || deal.status === 'archived') {
    throw new DealAccessError(404, 'That deal no longer exists.');
  }
  if (!controlStore.isDealMember(dealId, req.portalUser)) {
    throw new DealAccessError(403, 'You are not a member of that deal.');
  }
  return { kind: 'deal', dealId, dbPath: dbFiles.dealDbPath(dealId), schemaPath: dbFiles.DEAL_SCHEMA_PATH };
}

/**
 * Express middleware: resolves this request's database, sets
 * `req.dealContext`/`req.isDemo`, obtains (or reuses, from the shared
 * connection cache) the connection, and binds it via db/store.js's
 * runWithDb() so the binding covers the WHOLE downstream chain — every
 * readDb()/writeDb() call the route handler (and anything it awaits) makes.
 * A DealAccessError becomes its carried HTTP status with the existing
 * `{ error: '...' }` body shape, matching every other short-circuit in the
 * consolidated /api gate.
 */
function dealResolverMiddleware(req, res, next) {
  let resolved;
  try {
    resolved = resolveDatabase(req);
  } catch (e) {
    if (e instanceof DealAccessError) {
      return res.status(e.status).json({ error: e.message });
    }
    throw e;
  }

  req.dealContext = resolved;
  req.isDemo = resolved.kind === 'demo';

  const conn = getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath }, () => next());
}

module.exports = {
  resolveDatabase, dealResolverMiddleware, DealAccessError,
  CONTROL_PLANE_PATHS, isControlPlanePath,
};
