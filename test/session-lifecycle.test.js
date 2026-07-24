// AUTH-03 + AUTH-04 (D-06/D-07): a session authorizes until logout, an admin
// revoke-all, or its 12h absolute expiry — each of which stops authorization
// immediately, with zero background sweep required. Tokens are stored ONLY
// as SHA-256 hashes at rest (D-06) — the load-bearing threat this mitigates
// is a leaked/exfiltrated data/ma-portal.db dump handing an attacker
// directly-replayable session tokens for every currently-logged-in user.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.
// `node --test test/` does NOT work on this project's target Node version
// (v22.18.0) — it errors with "Cannot find module '.../test'".

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-session-lifecycle-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

function freshStore(dbPath) {
  delete require.cache[require.resolve('../db/store.js')];
  delete require.cache[require.resolve('../db/sessions.js')];
  const store = require('../db/store.js');
  store.initDb(dbPath);
  const sessions = require('../db/sessions.js');
  return { store, sessions };
}

test('session-lifecycle: create -> find resolves {username, role}; logout (deleteSession) immediately revokes it', () => {
  const dbPath = tempDbPath('logout');
  try {
    const { store, sessions } = freshStore(dbPath);
    const conn = store.getConnection();

    const token = sessions.createSession(conn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
    assert.strictEqual(typeof token, 'string', 'createSession must return the raw opaque token');

    const resolved = sessions.findSession(conn, token);
    assert.ok(resolved, 'a freshly created session must resolve');
    assert.strictEqual(resolved.username, 'karen');
    assert.strictEqual(resolved.role, 'hrbp');

    sessions.deleteSession(conn, token);
    assert.strictEqual(sessions.findSession(conn, token), null, 'logout must immediately revoke the token (no grace period)');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('session-lifecycle: admin deleteAllSessionsForUser revokes every live session for that user', () => {
  const dbPath = tempDbPath('revoke-all');
  try {
    const { store, sessions } = freshStore(dbPath);
    const conn = store.getConnection();

    const tokenA = sessions.createSession(conn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
    const tokenB = sessions.createSession(conn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
    assert.ok(sessions.findSession(conn, tokenA), 'session A must resolve before revoke-all');
    assert.ok(sessions.findSession(conn, tokenB), 'session B must resolve before revoke-all');

    sessions.deleteAllSessionsForUser(conn, 'karen');

    assert.strictEqual(sessions.findSession(conn, tokenA), null, 'admin revoke-all must immediately revoke every session for that user (A)');
    assert.strictEqual(sessions.findSession(conn, tokenB), null, 'admin revoke-all must immediately revoke every session for that user (B)');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('session-lifecycle: a row whose expires_at is in the past is never returned by findSession (no background sweep required)', () => {
  const dbPath = tempDbPath('expiry');
  try {
    const { store, sessions } = freshStore(dbPath);
    const conn = store.getConnection();

    // Create with a real ttl, then directly age the row's expires_at into the
    // past via raw SQL — this is the lazy-expiry contract, not a sleep-based test.
    const token = sessions.createSession(conn, { username: 'pmo', role: 'pmo', ttlMs: 12 * 60 * 60 * 1000 });
    assert.ok(sessions.findSession(conn, token), 'session must resolve before it is aged past expiry');

    const pastIso = new Date(Date.now() - 1000).toISOString();
    conn.prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`).run(pastIso, sessions.hashToken(token));

    assert.strictEqual(sessions.findSession(conn, token), null, 'a past-expiry row must be treated as an immediate miss, no sweep required');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('session-lifecycle (D-06): the sessions table stores only the SHA-256 hash of the token, never the raw token', () => {
  const dbPath = tempDbPath('hashed-at-rest');
  try {
    const { store, sessions } = freshStore(dbPath);
    const conn = store.getConnection();

    const token = sessions.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
    const row = conn.prepare(`SELECT token_hash FROM sessions WHERE username = ?`).get('admin');
    assert.ok(row, 'the inserted row must be readable directly from the sessions table');
    assert.strictEqual(row.token_hash, sessions.hashToken(token), 'the persisted token_hash must equal sha256(raw token)');
    assert.notStrictEqual(row.token_hash, token, 'the persisted value must NOT equal the raw token itself');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('session-lifecycle (AUTH-04): findSession returns exactly the {username, role, sessionId} shape the gate assigns to req.portalUser', () => {
  const dbPath = tempDbPath('identity-shape');
  try {
    const { store, sessions } = freshStore(dbPath);
    const conn = store.getConnection();

    const token = sessions.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
    const resolved = sessions.findSession(conn, token);

    assert.deepStrictEqual(
      Object.keys(resolved).sort(),
      ['role', 'sessionId', 'username'],
      'findSession must resolve exactly {username, role, sessionId} — the identity shape req.portalUser is set to'
    );
    assert.strictEqual(resolved.sessionId, sessions.hashToken(token), 'sessionId must be the token hash, not the raw token');
  } finally {
    cleanupDbFile(dbPath);
  }
});
