// db/sessions.js — dedicated SQLite session store (AUTH-03/AUTH-04, D-06/D-07).
//
// Session tokens are opaque, high-entropy (256-bit) values generated with
// crypto.randomBytes and handed back to the caller ONCE, at creation time,
// for use as the raw cookie value. Only the SHA-256 hash of the token is ever
// persisted (see db/schema.sql's `sessions` table) — a leaked/exfiltrated
// database file cannot be replayed as a live session, mirroring this
// codebase's existing password-hash discipline (server.js's hashPassword()).
//
// This module intentionally does NOT go through db/store.js's whole-object
// readDb()/writeDb() collection API — sessions are looked up on every single
// authenticated request, not read-modify-written as part of a business-object
// CRUD flow, and the `sessions` table is deliberately excluded from
// ARRAY_COLLECTIONS (see db/schema.sql's header comment on that table). Every
// exported function here takes the shared better-sqlite3 connection
// (db/store.js's getConnection()) as its first argument so there is only
// ever one open handle to data/ma-portal.db.
//
// Errors from better-sqlite3 are allowed to propagate uncaught to the caller,
// matching db/store.js's no-swallow convention (writeDb()'s own docstring:
// "Throws on unrecoverable failure").

const crypto = require('crypto');

function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url'); // 256 bits of entropy, URL/cookie-safe
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new session row and return the RAW opaque token — this is the
 * only time the raw value ever exists outside the caller's response cookie;
 * only its hash is persisted. `ttlMs` is an ABSOLUTE lifetime measured from
 * `now` (D-07: no sliding/refresh extension on activity).
 */
function createSession(conn, { username, role, ttlMs, userAgent, ip }) {
  const token = newSessionToken();
  const now = new Date();
  conn.prepare(
    `INSERT INTO sessions (token_hash, username, role, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    hashToken(token), username, role, now.toISOString(),
    new Date(now.getTime() + ttlMs).toISOString(), userAgent || null, ip || null
  );
  return token;
}

/**
 * Resolve a raw cookie token to `{ username, role, sessionId }`, or `null` if
 * the token is missing/unknown or has expired. `sessionId` is the token's
 * SHA-256 hash — a stable per-session identifier (AUTH-04's
 * req.portalUser.sessionId) that never re-derives or exposes the raw token.
 * Expiry is enforced lazily right here: a row whose `expires_at` has already
 * passed is treated as an immediate miss, so AUTH-03's "an expired row stops
 * authorizing immediately" holds with no background sweep required (physical
 * deletion of stale rows is a separate, non-security table-bloat concern —
 * see pruneExpiredSessions(), added in Task 2).
 */
function findSession(conn, token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = conn.prepare(
    `SELECT username, role, expires_at FROM sessions WHERE token_hash = ?`
  ).get(tokenHash);
  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) return null;
  return { username: row.username, role: row.role, sessionId: tokenHash };
}

/** Logout: delete the session row immediately — revocation is real, not a wait-for-expiry (D-07). */
function deleteSession(conn, token) {
  if (!token) return;
  conn.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}

/**
 * Admin offboarding action (D-07): delete every session belonging to a user,
 * revoking all of that user's devices/tabs at once. A single indexed
 * `DELETE ... WHERE username = ?` — trivial given idx_sessions_username.
 */
function deleteAllSessionsForUser(conn, username) {
  conn.prepare(`DELETE FROM sessions WHERE username = ?`).run(username);
}

/**
 * Physically delete rows whose expires_at has passed. This is a table-bloat
 * cleanup only, NOT a security mechanism — findSession() already treats a
 * past-expiry row as an immediate miss regardless of whether it has been
 * physically deleted yet (D-07's "an expired row stops authorizing
 * immediately" holds with zero background sweeps). Called once at server
 * startup and opportunistically on login (cheap; this app has no interval
 * timers or job scheduler anywhere).
 */
function pruneExpiredSessions(conn) {
  conn.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
}

module.exports = {
  createSession, findSession, deleteSession, deleteAllSessionsForUser, pruneExpiredSessions,
  newSessionToken, hashToken,
};
