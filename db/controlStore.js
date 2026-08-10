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
// DD_AREA_IDS only (the fixed eight-area taxonomy) — db/accessPolicy.js is a
// pure module with no database connection of its own (see its own header), so
// requiring it here creates no circularity and no second connection.
const { DD_AREA_IDS } = require('./accessPolicy');

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
// D-09 (Phase 8): updateUser() is a direct-SQL writer that bypasses
// writeDb() entirely, so it needs its own lock acquisition to be covered by
// the phase's serialization contract. The SELECT that finds the account row
// now runs INSIDE the wrapped transaction (via the same captured `conn`
// handle, `.immediate` acquiring BEGIN IMMEDIATE up front) rather than
// before it — a read left outside the transaction would re-open the exact
// last-writer-wins window this wrap exists to close (08-RESEARCH.md Pitfall
// 4 / Open Question 1).
function updateUser(username, patch) {
  const conn = controlConn();
  const apply = conn.transaction((username, patch) => {
    const row = conn.prepare('SELECT id, data FROM users').all()
      .map((r) => ({ id: r.id, user: JSON.parse(r.data) }))
      .find((r) => r.user.username === username);
    if (!row) throw new Error(`db/controlStore.js: updateUser() found no account for username '${username}'`);
    const updated = { ...row.user, ...patch };
    conn.prepare('UPDATE users SET data = ? WHERE id = ?').run(JSON.stringify(updated), row.id);
    return updated;
  }).immediate;
  return apply(username, patch);
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

// WIZ-01/D-05: the six wizard setup steps, in the wizard's own order —
// duplicated (not imported) in validators/wizard.js's DEAL_SETUP_STEPS and
// server.js's own reference to that export; db/controlStore.js stays free of
// any dependency on the validators/ layer (mirrors this module's existing
// "no reference to the audit store" isolation rule above).
const DEAL_SETUP_STEPS = ['basics', 'team', 'assessments', 'scope', 'timeline', 'ddKickoff'];

/**
 * D-02/ISO-01/D-05: create a new deal registry row (control.db ONLY — this
 * function never touches the deal's own database file; server.js's route
 * handler provisions that separately via db/dealSeed.js's
 * createDealDatabase(), and rolls this row back if provisioning throws, so a
 * registry row can never point at a file that does not exist, T-03-23).
 * The creator is ALWAYS added to `members` if absent — an Integration Lead
 * who creates a deal and is then locked out of it by their own omission is a
 * bug, not a policy (D-03's "admin is always a member" is a separate,
 * additional rule enforced by isDealMember() above, not by this function).
 *
 * D-05: also accepts the wizard's six optional basics fields (stored as
 * `null` when omitted, never left as a missing key — a stable, always-present
 * shape is easier for any later reader than a conditionally-present one) and
 * stamps a `setup` skeleton: `basics`/`team` are ALREADY done (this route IS
 * those two steps), the remaining four start `null` — an incomplete-but-
 * usable deal, never a rollback, is the whole point of create-early.
 */
function createDeal({ name, targetCompany, members, createdBy, dealType, signingDate, expectedClose, day1Date, dealSizeM, currency }) {
  const id = newId('deal');
  const memberSet = new Set((members || []).map(String));
  if (createdBy) memberSet.add(createdBy);
  const conn = controlConn();
  const seqRow = conn.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS nextSeq FROM deals').get();
  const now = new Date().toISOString();
  const stamp = { at: now, by: createdBy || null };
  const setup = {
    steps: {
      basics: stamp, team: stamp,
      assessments: null, scope: null, timeline: null, ddKickoff: null,
    },
    complete: false,
  };
  const data = {
    id, name, targetCompany, members: Array.from(memberSet),
    status: 'active', createdBy: createdBy || null, createdAt: now,
    dealType: dealType || null,
    signingDate: signingDate || null,
    expectedClose: expectedClose || null,
    day1Date: day1Date || null,
    dealSizeM: (dealSizeM === undefined || dealSizeM === null || dealSizeM === '') ? null : dealSizeM,
    currency: currency || null,
    setup,
  };
  conn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(id, seqRow.nextSeq, data.status, JSON.stringify(data));
  return data;
}

/**
 * G-04-8: true when at least one of DEAL_SETUP_STEPS' six ids is `null` or
 * absent in `deal.setup.steps` — mirrors public/js/deal-home.js's own
 * `done = steps[step.id] != null` check for the setup checklist's
 * Outstanding/Done rows, so "is this deal still mid-setup" reads the same
 * everywhere. A deal with no `setup` object at all (a record predating the
 * wizard) counts as fully outstanding, never as done-by-omission.
 */
function hasOutstandingSetupStep(deal) {
  const steps = (deal && deal.setup && deal.setup.steps) || {};
  return DEAL_SETUP_STEPS.some((id) => steps[id] == null);
}

/**
 * G-04-8: the caller's own duplicate-create guard. Returns the first
 * non-archived deal from `listDeals()` whose `createdBy` equals `createdBy`,
 * whose `name` and `targetCompany` match EXACTLY, and whose setup is still
 * outstanding (hasOutstandingSetupStep() above) — otherwise `null`. Used by
 * `POST /api/deals` to resume an interrupted wizard instead of minting a
 * second, indistinguishable copy of the same deal (live UAT test 8).
 *
 * Exact string equality is deliberate, not an oversight: the validation
 * pipeline (validators/deals.js's CreateDealSchema) has already trimmed both
 * `name` and `targetCompany` before this ever runs, so a genuine duplicate
 * always matches byte-for-byte. A case or whitespace difference simply FAILS
 * to match — the safe direction for MNPI data is an extra (harmless) deal,
 * never a resume into a deal the operator did not intend (T-04-52). Pinning
 * on `createdBy` for the same reason: this can never return another user's
 * deal to a caller.
 *
 * A FINISHED deal (hasOutstandingSetupStep() false) is deliberately excluded
 * — the dedup key is an unfinished setup, not the name alone, so an operator
 * intentionally starting a second real deal that happens to share a name
 * with a long-closed one is never blocked (see test (ac)).
 */
function findUnfinishedDealFor({ createdBy, name, targetCompany }) {
  if (!createdBy) return null;
  return listDeals().find((d) => (
    d.status !== 'archived' &&
    d.createdBy === createdBy &&
    d.name === name &&
    d.targetCompany === targetCompany &&
    hasOutstandingSetupStep(d)
  )) || null;
}

/**
 * WIZ-01/D-05: merge `patch` onto `deal.setup` (a SHALLOW merge into the
 * `setup` sub-object, not a deep merge into `setup.steps` — the caller
 * (server.js's POST /api/deals/:id/setup handler) computes the fully-merged
 * `steps` object itself and passes it as one patch key, exactly like
 * setDealMemberGrants() above computes the full ddAreas array before
 * calling in). Mirrors updateDealMembers()'s exact read-modify-write and
 * throw-when-missing contract: spreads the EXISTING deal object first, so
 * `members`, `memberGrants`, `status` and every other field survive
 * untouched — only `setup` is ever touched by this function.
 */
// D-09 (Phase 8): a direct-SQL writer bypassing writeDb() — wrapped exactly
// like updateDealMembers()/setDealMemberGrants() below, so this read-modify-
// write pair is covered by the phase's serialization contract. getDeal()'s
// read now runs INSIDE the transaction (same captured `conn`, so it's part
// of the same `.immediate`-acquired locked section), not before it.
function updateDealSetup(dealId, patch) {
  const conn = controlConn();
  const apply = conn.transaction((dealId, patch) => {
    const deal = getDeal(dealId);
    if (!deal) throw new Error(`db/controlStore.js: updateDealSetup() found no deal '${dealId}'`);
    const updated = { ...deal, setup: { ...(deal.setup || {}), ...(patch || {}) } };
    conn.prepare('UPDATE deals SET data = ? WHERE id = ?').run(JSON.stringify(updated), dealId);
    return updated;
  }).immediate;
  return apply(dealId, patch);
}

/** D-03: replace a deal's members[] allowlist wholesale. Throws (does not
 * silently no-op) if the deal does not exist — mirrors updateUser()'s "not
 * an upsert" contract above. Does NOT release any removed member's session
 * binding — that is server.js route handler's job (it has req/sessions
 * access this module deliberately does not, see this file's header). */
// D-09 (Phase 8): closes 08-RESEARCH.md Pitfall 4 / Open Question 1 — this is
// a direct-SQL writer bypassing writeDb(), so without its own lock
// acquisition, two concurrent calls each read the deal, each mutate their
// own copy of `members`, and the second UPDATE silently clobbers the first —
// no SQLITE_BUSY, no thrown error, just a lost membership change on MNPI
// access-control data. getDeal()'s read now runs INSIDE the `.immediate`
// transaction (same captured `conn`), so both statements execute under one
// acquired write lock.
function updateDealMembers(dealId, members) {
  const conn = controlConn();
  const apply = conn.transaction((dealId, members) => {
    const deal = getDeal(dealId);
    if (!deal) throw new Error(`db/controlStore.js: updateDealMembers() found no deal '${dealId}'`);
    const updated = { ...deal, members: Array.from(new Set((members || []).map(String))) };
    conn.prepare('UPDATE deals SET data = ? WHERE id = ?').run(JSON.stringify(updated), dealId);
    return updated;
  }).immediate;
  return apply(dealId, members);
}

/**
 * DD-04/D-02: replace `username`'s DD-area clearance inside
 * `deal.memberGrants`, following updateDealMembers()'s exact read-modify-
 * write shape — spreads the EXISTING deal object (never rebuilds it), so
 * `members`, `status`, `createdBy` and every other field survive untouched.
 * `ddAreas` is de-duplicated into a Set and re-ordered to match DD_AREA_IDS's
 * own declared order (db/accessPolicy.js) — the persisted array is always in
 * that canonical order regardless of what order the caller submitted them in.
 * Throws (never silently no-ops) when the deal does not exist, mirroring
 * updateDealMembers()'s own "not an upsert" contract above. This module still
 * holds no reference to the audit store — server.js's route handler records
 * the security event, exactly like the deal-create/deal-archive/deal-members
 * call sites already do.
 */
// D-09 (Phase 8): same wrap as updateDealMembers() above, for the same
// reason — DD-area clearance grants are MNPI access-control data, and an
// unwrapped read-modify-write pair here means two concurrent grants to
// different users on the same deal can silently drop one. getDeal()'s read
// now runs INSIDE the `.immediate` transaction.
function setDealMemberGrants(dealId, username, ddAreas) {
  const conn = controlConn();
  const apply = conn.transaction((dealId, username, ddAreas) => {
    const deal = getDeal(dealId);
    if (!deal) throw new Error(`db/controlStore.js: setDealMemberGrants() found no deal '${dealId}'`);
    const set = new Set((ddAreas || []).map(String));
    const ordered = DD_AREA_IDS.filter((id) => set.has(id));
    const memberGrants = { ...(deal.memberGrants || {}) };
    memberGrants[username] = { ddAreas: ordered };
    const updated = { ...deal, memberGrants };
    conn.prepare('UPDATE deals SET data = ? WHERE id = ?').run(JSON.stringify(updated), dealId);
    return updated;
  }).immediate;
  return apply(dealId, username, ddAreas);
}

/** DD-04: the whole `memberGrants` map for `dealId`, or `{}` when the deal
 * has none (or does not exist — mirrors getDeal()'s own null-safety, never
 * throws for a read). */
function getDealMemberGrants(dealId) {
  const deal = getDeal(dealId);
  return (deal && deal.memberGrants) || {};
}

/** D-02: archive a deal — flips BOTH the `status` metadata column and
 * `data.status` (db/resolver.js's resolveDatabase() checks `deal.status ===
 * 'archived'` against the JSON blob, not the metadata column, so both must
 * agree). Leaves the deal's own database file on disk completely untouched —
 * archival is reversible-in-spirit (the file survives), unlike deleteDeal()
 * below. Throws if the deal does not exist. */
// D-09 (Phase 8): a direct-SQL writer bypassing writeDb() — wrapped like the
// other four functions in this file so this read-modify-write pair is
// covered by the phase's serialization contract. getDeal()'s read now runs
// INSIDE the `.immediate` transaction.
function archiveDeal(dealId) {
  const conn = controlConn();
  const apply = conn.transaction((dealId) => {
    const deal = getDeal(dealId);
    if (!deal) throw new Error(`db/controlStore.js: archiveDeal() found no deal '${dealId}'`);
    const updated = { ...deal, status: 'archived' };
    conn.prepare('UPDATE deals SET status = ?, data = ? WHERE id = ?').run('archived', JSON.stringify(updated), dealId);
    return updated;
  }).immediate;
  return apply(dealId);
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
  setDealMemberGrants, getDealMemberGrants,
  updateDealSetup, DEAL_SETUP_STEPS,
  hasOutstandingSetupStep, findUnfinishedDealFor,
  getControlSettings, setControlSettings,
  getSecretSettings, setSecretSettings,
};
