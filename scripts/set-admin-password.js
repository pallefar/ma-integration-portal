#!/usr/bin/env node
// First-run / operator mechanism to set the REAL admin password (D-09) so
// real-deal mode never ships on the publicly-known demo password
// (D-10 — TEdemo!2026, shared by every seeded demo account). Mirrors
// scripts/migrate-db-json-to-sqlite.js's established one-shot CLI shape: a
// single exported run() function, plus a require.main === module guard so
// this file is usable both as `node scripts/set-admin-password.js` and as a
// requireable function from a test or another script.
//
// Usage:
//   ADMIN_PASSWORD='a real secret' node scripts/set-admin-password.js
//   node scripts/set-admin-password.js        (interactive prompt if
//                                               ADMIN_PASSWORD is unset)
//
// This does NOT implement user-CRUD (create/delete/rename users, assign
// roles) — that is explicitly deferred per D-09. This script only rotates
// the salt/hash of the EXISTING `admin` account.

const crypto = require('crypto');
const readline = require('readline');
const store = require('../db/store');

// The publicly-known demo password shared by every seeded demo account
// (admin/karen/pmo/employee-demo) — see 02-CONTEXT.md D-10.
const DEMO_PASSWORD = 'TEdemo!2026';

// Same primitive as server.js's hashPassword() — deliberately reimplemented
// here (not required from server.js) so this script never triggers
// server.js's own module-load side effects (RAG index build, its own
// initDb() against the default path, etc.) just to rotate a password.
function hashPassword(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32).toString('hex');
}

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Rotate the `admin` account's password. Resolves { success: true, username }
 * on success; throws (never silently no-ops) if there is no admin account or
 * the supplied password is too short.
 *
 * @param {object} [opts]
 * @param {string} [opts.password] - the new admin password. If omitted, an
 *   interactive stdin prompt is used (CLI-only path) — a caller invoking
 *   run() programmatically (e.g. a test) must always supply it directly.
 * @param {string} [opts.dbPath] - optional SQLite path override, for tests;
 *   defaults to db/store.js's own DEFAULT_DB_PATH when omitted.
 */
async function run(opts = {}) {
  let { password, dbPath } = opts;
  if (!password) {
    password = await promptPassword('New admin password (min 8 characters): ');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  store.initDb(dbPath);
  const db = store.readDb();
  const user = (db.users || []).find((u) => u.username === 'admin');
  if (!user) {
    throw new Error("No 'admin' user found in the database — cannot set its password.");
  }

  // D-10: warn loudly (do not silently proceed) if the admin account is
  // CURRENTLY still on the known demo password and this deployment hasn't
  // explicitly opted into DEMO_OPEN — real-deal mode must never silently
  // ship on a publicly-known credential. This warns on the state BEFORE the
  // rotation this call is about to perform, i.e. it flags "you were exposed
  // until just now."
  const stillOnDemoPassword = !!(user.hash && user.salt &&
    timingSafeEqualStr(hashPassword(DEMO_PASSWORD, user.salt), user.hash));
  if (stillOnDemoPassword && process.env.DEMO_OPEN !== '1') {
    console.warn(
      "[security] admin account was still on the known demo password (D-10) — " +
      'rotating it now. Real-deal (non-DEMO_OPEN) deployments must never run ' +
      'with the publicly-known demo credential.'
    );
  }

  const newSalt = crypto.randomBytes(16).toString('hex');
  user.salt = newSalt;
  user.hash = hashPassword(password, newSalt);
  store.writeDb(db);

  console.log(`Admin password updated for user '${user.username}'.`);
  return { success: true, username: user.username };
}

async function main() {
  const password = process.env.ADMIN_PASSWORD || undefined;
  await run({ password });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to set admin password:', err.message);
    process.exit(1);
  });
}

module.exports = { run };
