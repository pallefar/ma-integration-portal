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

const fs = require('fs');
const crypto = require('crypto');
const { getOrOpenConnection, closeConnection } = require('./store');
const dbFiles = require('./dbFiles');

// Deal ids are minted with the SAME `${prefix}_${Date.now().toString(36)}
// ${randomHex}` convention server.js's own newId() uses (server.js:561-563).
// Duplicated here (not imported from server.js) to avoid a circular
// require — server.js already requires this module at load time, so this
// module cannot require server.js back. db/dbFiles.js's DEAL_ID_RE
// (`/^deal_[a-z0-9]+$/i`) accepts exactly this shape.
function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

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

/**
 * D-02/ISO-01: create a new deal registry row (control.db ONLY — this
 * function never touches the deal's own database file; server.js's route
 * handler provisions that separately via db/dealSeed.js's
 * createDealDatabase(), and rolls this row back if provisioning throws, so a
 * registry row can never point at a file that does not exist, T-03-23).
 * The creator is ALWAYS added to `members` if absent — an Integration Lead
 * who creates a deal and is then locked out of it by their own omission is a
 * bug, not a policy (D-03's "admin is always a member" is a separate,
 * additional rule enforced by isDealMember() above, not by this function).
 */
function createDeal({ name, targetCompany, members, createdBy }) {
  const id = newId('deal');
  const memberSet = new Set((members || []).map(String));
  if (createdBy) memberSet.add(createdBy);
  const conn = controlConn();
  const seqRow = conn.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS nextSeq FROM deals').get();
  const data = {
    id, name, targetCompany, members: Array.from(memberSet),
    status: 'active', createdBy: createdBy || null, createdAt: new Date().toISOString(),
  };
  conn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(id, seqRow.nextSeq, data.status, JSON.stringify(data));
  return data;
}

/** D-03: replace a deal's members[] allowlist wholesale. Throws (does not
 * silently no-op) if the deal does not exist — mirrors updateUser()'s "not
 * an upsert" contract above. Does NOT release any removed member's session
 * binding — that is server.js route handler's job (it has req/sessions
 * access this module deliberately does not, see this file's header). */
function updateDealMembers(dealId, members) {
  const deal = getDeal(dealId);
  if (!deal) throw new Error(`db/controlStore.js: updateDealMembers() found no deal '${dealId}'`);
  const updated = { ...deal, members: Array.from(new Set((members || []).map(String))) };
  controlConn().prepare('UPDATE deals SET data = ? WHERE id = ?').run(JSON.stringify(updated), dealId);
  return updated;
}

/** D-02: archive a deal — flips BOTH the `status` metadata column and
 * `data.status` (db/resolver.js's resolveDatabase() checks `deal.status ===
 * 'archived'` against the JSON blob, not the metadata column, so both must
 * agree). Leaves the deal's own database file on disk completely untouched —
 * archival is reversible-in-spirit (the file survives), unlike deleteDeal()
 * below. Throws if the deal does not exist. */
function archiveDeal(dealId) {
  const deal = getDeal(dealId);
  if (!deal) throw new Error(`db/controlStore.js: archiveDeal() found no deal '${dealId}'`);
  const updated = { ...deal, status: 'archived' };
  controlConn().prepare('UPDATE deals SET status = ?, data = ? WHERE id = ?').run('archived', JSON.stringify(updated), dealId);
  return updated;
}

/**
 * D-02/AUD-02: irreversibly delete a deal — removes ONLY its control.db
 * registry row and its own database file (plus WAL/SHM sidecars). This
 * function holds NO reference to audit.db anywhere in its body — AUD-02
 * ("the audit trail survives deletion of the deal it describes") holds by
 * construction because this code path has no way to reach the audit store
 * even by accident (asserted by a source-grep in test/deal-lifecycle.test.js
 * that `AUDIT_DB_PATH` never appears in this file).
 *
 * The file path is resolved ONLY through dbFiles.dealDbPath() — the single
 * sanctioned path-builder that validates the id shape before ever touching
 * the filesystem (T-03-03) — never a re-derived string. Before unlinking,
 * evicts any cached connection db/store.js's shared connection cache may
 * still be holding open for this exact file (closeConnection()): on Windows
 * an open file cannot be unlinked at all, and even on POSIX an unlinked-but-
 * still-open handle is a latent bug this delete path must not leave behind.
 */
function deleteDeal(dealId) {
  const deal = getDeal(dealId);
  if (!deal) throw new Error(`db/controlStore.js: deleteDeal() found no deal '${dealId}'`);
  controlConn().prepare('DELETE FROM deals WHERE id = ?').run(dealId);
  const targetPath = dbFiles.dealDbPath(dealId);
  closeConnection(targetPath);
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(targetPath + ext); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return true;
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
  createDeal, updateDealMembers, archiveDeal, deleteDeal,
  getControlSettings, setControlSettings,
  getSecretSettings, setSecretSettings,
};
