'use strict';
// D-10-04 / COLLAB-02 (Phase 10): once the /api gate re-reads a session's
// account (role, disabled) from control.db on every request, a session whose
// username has no control.db row correctly stops authorizing. Suites that
// authenticate through a directly-created session (db/sessions.js
// createSession, bypassing /api/auth/login) must therefore seed a matching
// account — this helper does that without weakening the production gate.
//
// No password hash is stored: these identities never log in through
// /api/auth/login, they only carry a pre-minted session cookie.

const sessionsDb = require('../../db/sessions.js');

/**
 * Ensure control.db `users` holds an account for `username` with `role`.
 * Idempotent. THROWS if an account already exists with a DIFFERENT role — a
 * test that relied on a session-snapshot role differing from the stored
 * account would silently change meaning once the gate re-reads roles
 * (T-10-11), so the mismatch is surfaced here instead of papered over.
 *
 * `controlConn` MUST be the same control.db the app under test opens
 * (MA_CONTROL_DB_PATH) — e.g. db/store.js getOrOpenConnection(
 * dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH).
 */
function ensureUser(controlConn, { username, role, name } = {}) {
  if (!username || !role) throw new Error('ensureUser: username and role are required');
  const rows = controlConn.prepare('SELECT id, data FROM users').all();
  for (const r of rows) {
    let u;
    try { u = JSON.parse(r.data); } catch (e) { continue; }
    if (r.id === username || (u && u.username === username)) {
      if (u.role !== role) {
        throw new Error(
          `ensureUser: account '${username}' already exists with role '${u.role}', test expects '${role}' — ` +
          'use a distinct username instead of relying on a snapshot role (D-10-04)'
        );
      }
      return u;
    }
  }
  const data = { username, name: name || username, role };
  controlConn.prepare(
    `INSERT OR IGNORE INTO users (id, project_id, seq, data)
     VALUES (?, NULL, COALESCE((SELECT MAX(seq) FROM users), -1) + 1, ?)`
  ).run(username, JSON.stringify(data));
  return data;
}

/**
 * ensureUser + db/sessions.js createSession. Returns the raw session token.
 * `runtimeConn` is the runtime.db connection sessions live in.
 */
function sessionAs(runtimeConn, controlConn, { username, role, name, ttlMs } = {}) {
  ensureUser(controlConn, { username, role, name });
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: ttlMs || 12 * 60 * 60 * 1000 });
}

module.exports = { ensureUser, sessionAs };
