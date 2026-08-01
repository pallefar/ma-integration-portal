// ISO-01 / D-03: direct-SQL sibling module for control.db's account registry
// and deal registry (mirrors db/sessions.js's established shape: a module
// that bypasses readDb()/writeDb()'s whole-object collection API).
//
// WHY this module holds its OWN lazily-opened connection (via
// db/store.js's getOrOpenConnection(), the SAME shared cache db/resolver.js
// uses) rather than taking a connection as its first argument the way
// db/sessions.js does: its callers — the consolidated /api gate resolving a
// login before any deal binding exists, the login/change-password handlers,
// db/resolver.js's own membership check — have NO request-bound connection
// in scope at the point they need to read an account or a deal row. Control
// data (accounts, the deal registry) is deliberately reached ONLY through
// this module's own control.db handle, never through the request-bound
// read model (requireDb()/readDb()) — so a deal-bound request's own
// connection can never be used to read or write the account store or the
// deal registry, even by a future bug in a deal-scoped endpoint (T-03-16).

const { getOrOpenConnection } = require('./store');
const dbFiles = require('./dbFiles');

function controlConn() {
  return getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
}

function runtimeConn() {
  return getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
}

// --- users (blob-per-row, verbatim shape copied from db/schema.sql) -------

/** Every account row, in seq order — mirrors readDb()'s ARRAY_COLLECTIONS
 * shape for a single collection, without going through the whole-object API. */
function listUsers() {
  const rows = controlConn().prepare('SELECT data FROM users ORDER BY seq').all();
  return rows.map((r) => JSON.parse(r.data));
}

/** Returns the account object for `username`, or `null` if none exists. */
function findUser(username) {
  if (!username) return null;
  return listUsers().find((u) => u.username === username) || null;
}

/**
 * Merge `patch` onto the existing account row for `username` and persist.
 * Throws if no such account exists — this is deliberately NOT an upsert:
 * user-CRUD (creating new accounts) is out of scope this milestone (D-09),
 * so a call site that typos a username fails loudly instead of silently
 * doing nothing.
 */
function updateUser(username, patch) {
  const conn = controlConn();
  const row = conn.prepare('SELECT id, data FROM users').all()
    .map((r) => ({ id: r.id, user: JSON.parse(r.data) }))
    .find((r) => r.user.username === username);
  if (!row) throw new Error(`db/controlStore.js: updateUser() found no account for username '${username}'`);
  const updated = { ...row.user, ...patch };
  conn.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(updated), row.id);
  return updated;
}

// --- deals (blob-per-row + `status` metadata column, control-schema.sql) --

/** Every deal row (including archived ones), in seq order. */
function listDeals() {
  const rows = controlConn().prepare('SELECT data FROM deals ORDER BY seq').all();
  return rows.map((r) => JSON.parse(r.data));
}

/** Returns the deal object for `dealId`, or `null` if it does not exist. */
function getDeal(dealId) {
  if (!dealId) return null;
  const row = controlConn().prepare('SELECT data FROM deals WHERE id = ?').get(dealId);
  return row ? JSON.parse(row.data) : null;
}

/** Every non-archived deal `user` may see: every deal for admin (D-03: admin
 * is always a member), otherwise only deals whose members[] allowlist
 * includes user.username. */
function listDealsForUser(user) {
  if (!user) return [];
  const active = listDeals().filter((d) => d.status !== 'archived');
  if (user.role === 'admin') return active;
  return active.filter((d) => Array.isArray(d.members) && d.members.includes(user.username));
}

/**
 * D-03: the resolver's bind-time membership check. Admin is ALWAYS treated
 * as a member (per the locked decision), regardless of the deal's own
 * members[] allowlist — every other role must appear in members[] by
 * username. Returns false (never throws) for a missing deal — the caller
 * (db/resolver.js) is responsible for distinguishing "missing/archived" from
 * "not a member" so it can return the right status code.
 */
function isDealMember(dealId, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const deal = getDeal(dealId);
  if (!deal) return false;
  return Array.isArray(deal.members) && deal.members.includes(user.username);
}

// --- app_state singletons ---------------------------------------------------

/** control.db's single `controlSettings` singleton (deployment-level config,
 * never secrets — see control-schema.sql's header). Returns `{}` if unset. */
function getControlSettings() {
  const row = controlConn().prepare('SELECT data FROM app_state WHERE key = ?').get('controlSettings');
  return row ? JSON.parse(row.data) : {};
}

function setControlSettings(patch) {
  const updated = { ...getControlSettings(), ...(patch || {}) };
  controlConn().prepare(
    `INSERT INTO app_state (key, data) VALUES ('controlSettings', ?)
     ON CONFLICT(key) DO UPDATE SET data = excluded.data`
  ).run(JSON.stringify(updated));
  return updated;
}

// --- secretSettings (lives in runtime.db, NOT control.db — see D-07) ------
//
// Dotted-path merge, mirroring scripts/split-db-into-control-demo-deals.js's
// splitSecretFields()/mergeSecretFields() shape (db/collections.js's
// SECRET_SETTINGS_FIELDS is itself dotted-path: 'geminiApiKey',
// 'databaseConfig.connectionDetails') — deliberately shallow, no array-index
// support, matching that established precedent exactly.

function dottedSet(target, dottedPath, value) {
  const parts = dottedPath.split('.');
  let dst = target;
  for (let i = 0; i < parts.length - 1; i++) {
    dst[parts[i]] = (dst[parts[i]] && typeof dst[parts[i]] === 'object') ? dst[parts[i]] : {};
    dst = dst[parts[i]];
  }
  dst[parts[parts.length - 1]] = value;
}

/** runtime.db's single `secretSettings` singleton — the two credential-
 * bearing fields server.js's publicSettings() already strips from every API
 * response (geminiApiKey, databaseConfig.connectionDetails). Returns `{}` if
 * unset. */
function getSecretSettings() {
  const row = runtimeConn().prepare('SELECT data FROM app_state WHERE key = ?').get('secretSettings');
  return row ? JSON.parse(row.data) : {};
}

/** `patch` keys are DOTTED paths (e.g. `{ geminiApiKey: '...' }` or
 * `{ 'databaseConfig.connectionDetails': {...} }`), matching
 * SECRET_SETTINGS_FIELDS's own dotted-path convention — merged onto the
 * existing secretSettings singleton and persisted. */
function setSecretSettings(patch) {
  const updated = JSON.parse(JSON.stringify(getSecretSettings()));
  for (const [dottedPath, value] of Object.entries(patch || {})) {
    dottedSet(updated, dottedPath, value);
  }
  runtimeConn().prepare(
    `INSERT INTO app_state (key, data) VALUES ('secretSettings', ?)
     ON CONFLICT(key) DO UPDATE SET data = excluded.data`
  ).run(JSON.stringify(updated));
  return updated;
}

module.exports = {
  findUser, listUsers, updateUser,
  getDeal, listDeals, listDealsForUser, isDealMember,
  getControlSettings, setControlSettings,
  getSecretSettings, setSecretSettings,
};
