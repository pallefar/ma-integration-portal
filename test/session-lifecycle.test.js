// AUTH-03 + AUTH-04 (D-06/D-07): a session authorizes until logout, an admin
// revoke-all, or its 12h absolute expiry — each of which stops authorization
// immediately, with zero background sweep required. Tokens are stored ONLY
// as SHA-256 hashes at rest (D-06) — the load-bearing threat this mitigates
// is a leaked/exfiltrated session-store dump handing an attacker
// directly-replayable session tokens for every currently-logged-in user.
//
// ISO-01 (Phase 3): sessions now live in runtime.db (runtime-schema.sql),
// not the demo/deal schema (db/schema.sql) sessions used before this phase —
// this file opens its temp connection against runtime-schema.sql directly
// via db/store.js's getOrOpenConnection() (the same shared cache
// db/resolver.js/db/controlStore.js use) rather than initDb(), since
// db/sessions.js's findSession() now unconditionally selects the `deal_id`
// column runtime-schema.sql adds (D-01).
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
  delete require.cache[require.resolve('../db/dbFiles.js')];
  const store = require('../db/store.js');
  const dbFiles = require('../db/dbFiles.js');
  const sessions = require('../db/sessions.js');
  const conn = store.getOrOpenConnection(dbPath, dbFiles.RUNTIME_SCHEMA_PATH);
  return { store, sessions, conn };
}

test('session-lifecycle: create -> find resolves {username, role}; logout (deleteSession) immediately revokes it', () => {
  const dbPath = tempDbPath('logout');
  try {
    const { sessions, conn } = freshStore(dbPath);

    const token = sessions.createSession(conn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
    assert.strictEqual(typeof token, 'string', 'createSession must return the raw opaque token');

    const resolved = sessions.findSession(conn, token);
    assert.ok(resolved, 'a freshly created session must resolve');
    assert.strictEqual(resolved.username, 'karen');
    assert.strictEqual(resolved.role, 'hrbp');
    assert.strictEqual(resolved.dealId, null, 'a freshly created session has no deal binding yet (D-01)');

    sessions.deleteSession(conn, token);
    assert.strictEqual(sessions.findSession(conn, token), null, 'logout must immediately revoke the token (no grace period)');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('session-lifecycle: admin deleteAllSessionsForUser revokes every live session for that user', () => {
  const dbPath = tempDbPath('revoke-all');
  try {
    const { sessions, conn } = freshStore(dbPath);

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
    const { sessions, conn } = freshStore(dbPath);

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
    const { sessions, conn } = freshStore(dbPath);

    const token = sessions.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
    const row = conn.prepare(`SELECT token_hash FROM sessions WHERE username = ?`).get('admin');
    assert.ok(row, 'the inserted row must be readable directly from the sessions table');
    assert.strictEqual(row.token_hash, sessions.hashToken(token), 'the persisted token_hash must equal sha256(raw token)');
    assert.notStrictEqual(row.token_hash, token, 'the persisted value must NOT equal the raw token itself');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('session-lifecycle (AUTH-04): findSession returns exactly the {username, role, sessionId, dealId} shape the gate assigns to req.portalUser', () => {
  const dbPath = tempDbPath('identity-shape');
  try {
    const { sessions, conn } = freshStore(dbPath);

    const token = sessions.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
    const resolved = sessions.findSession(conn, token);

    assert.deepStrictEqual(
      Object.keys(resolved).sort(),
      ['dealId', 'role', 'sessionId', 'username'],
      'findSession must resolve exactly {username, role, sessionId, dealId} — the identity shape req.portalUser is set to'
    );
    assert.strictEqual(resolved.sessionId, sessions.hashToken(token), 'sessionId must be the token hash, not the raw token');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('session-lifecycle (D-01): bindSessionDeal sets/clears the session\'s server-side deal binding', () => {
  const dbPath = tempDbPath('deal-binding');
  try {
    const { sessions, conn } = freshStore(dbPath);

    const token = sessions.createSession(conn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
    assert.strictEqual(sessions.findSession(conn, token).dealId, null, 'a fresh session is unbound (resolves to demo.db)');

    assert.strictEqual(sessions.bindSessionDeal(conn, token, 'deal_abc123'), true, 'binding an existing session must report success');
    assert.strictEqual(sessions.findSession(conn, token).dealId, 'deal_abc123', 'the bound dealId must be readable via findSession');

    assert.strictEqual(sessions.bindSessionDeal(conn, token, null), true, 'unbinding (dealId=null) must also report success');
    assert.strictEqual(sessions.findSession(conn, token).dealId, null, 'unbinding must clear the dealId back to null');

    assert.strictEqual(sessions.bindSessionDeal(conn, 'no-such-token', 'deal_xyz'), false, 'binding an unknown token must report false, not throw');
  } finally {
    cleanupDbFile(dbPath);
  }
});
