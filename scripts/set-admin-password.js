#!/usr/bin/env node
// Operator mechanism to rotate the `admin` account's password on the ACTIVE
// data directory (D-09 originally; re-pointed by D-10-02, Phase 10) so a
// real-deal host never keeps a published credential. Mirrors
// scripts/migrate-db-json-to-sqlite.js's one-shot CLI shape: an exported run()
// plus a require.main === module guard.
//
// Usage:
//   ADMIN_PASSWORD='a real secret, 12+ chars' node scripts/set-admin-password.js
//   node scripts/set-admin-password.js        (no-echo TTY prompt if
//                                               ADMIN_PASSWORD is unset)
//
// [security] D-10-02 — what changed from the pre-Phase-10 script:
//   - MA_MODE defaults to `real` when run directly, so it acts on the real
//     host's own data directory (MA_DATA_DIR, default data/real) — never the
//     committed demo database. It refuses outright when the active control
//     database is the committed data/control.db.
//   - The secret comes from ADMIN_PASSWORD or a no-echo TTY prompt, never argv
//     (visible in `ps`/shell history): any positional argument is refused
//     before a database is opened.
//   - The new password is checked against the real-mode policy (>= 12
//     characters, not a published demo password) and stored as a
//     self-describing scrypt N=131072 hash (lib/passwords.js); the account's
//     mustChangePassword flag is cleared (the operator chose this value) and
//     `disabled` is reset to false.
//   - Every admin session minted under the old credential is revoked, and a
//     control-plane security event is recorded with actor `cli:<os-user>`.
//
// This does NOT create accounts (scripts/bootstrap-admin.js creates the first
// admin; user CRUD lives under /api/admin/users) — it only rotates the
// EXISTING `admin` account.
//
// To point this script at a temp data directory (tests) set MA_DATA_DIR (or
// MA_CONTROL_DB_PATH / MA_RUNTIME_DB_PATH, db/dbFiles.js) before requiring it.

// The publicly-known demo password shared by every seeded demo account
// (admin/karen/pmo/employee-demo) — see 02-CONTEXT.md D-10. lib/passwords.js
// carries the same value in KNOWN_DEMO_PASSWORDS (asserted equal by tests).
const DEMO_PASSWORD = 'TEdemo!2026';

/**
 * Rotate the `admin` account's password. Resolves { success: true, username }
 * on success; throws (never silently no-ops) on every refusal.
 *
 * @param {object} [opts]
 * @param {string} [opts.password] - the new admin password. If omitted,
 *   ADMIN_PASSWORD or a no-echo TTY prompt is used (CLI-only path).
 * @param {string} [opts.osUser] - overrides the audited `cli:<os-user>`.
 */
async function run(opts = {}) {
  const dbFiles = require('../db/dbFiles');
  const { ensureRealDataDir } = require('../db/realDataDir');
  const controlStore = require('../db/controlStore');
  const store = require('../db/store');
  const sessions = require('../db/sessions');
  const auditHook = require('../db/auditHook');
  const passwords = require('../lib/passwords');
  const { obtainSecret, currentOsUser } = require('./bootstrap-admin');

  ensureRealDataDir();
  if (dbFiles.isCommittedControlDbActive()) {
    throw new Error(
      '[security] the active control database is the committed data/control.db — refusing to rotate a credential in a git-tracked file. ' +
      'Run with MA_MODE=real (the default for this script) and a data directory outside git.'
    );
  }

  let { password } = opts;
  if (password === undefined || password === '') {
    password = await obtainSecret({
      envValue: process.env.ADMIN_PASSWORD,
      envName: 'ADMIN_PASSWORD',
      label: 'New admin password',
    });
  }
  const problem = passwords.checkNewPassword(password, { realMode: true });
  if (problem) throw new Error(problem);

  const user = controlStore.findUser('admin');
  if (!user) {
    throw new Error("No 'admin' user found in control.db — create it with `node scripts/bootstrap-admin.js`.");
  }

  // D-10: warn loudly if the admin account is CURRENTLY still on the known
  // demo password — real-deal mode must never silently ship on a publicly-
  // known credential. This flags the state BEFORE the rotation about to run.
  if (passwords.verifyPasswordSync(DEMO_PASSWORD, user).ok) {
    console.warn(
      '[security] admin account was still on the known demo password (D-10) — rotating it now. ' +
      'Real-deal deployments must never run with the publicly-known demo credential.'
    );
  }

  controlStore.updateUser('admin', {
    hash: await passwords.hashPassword(password),
    salt: null,
    mustChangePassword: false,
    disabled: false,
  });

  // WR-01: rotating the admin credential must revoke every outstanding admin
  // session immediately (db/sessions.js calls this "Admin offboarding
  // action") — otherwise a token issued under the OLD password stays valid for
  // up to SESSION_TTL_MS. Sessions live in runtime.db (D-07).
  const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  sessions.deleteAllSessionsForUser(runtimeConn, user.username);

  auditHook.recordSecurityEvent({
    // audit_log.actor_role is NOT NULL; a CLI actor has no portal role.
    actor: { username: 'cli:' + (opts.osUser || currentOsUser()), role: 'cli' },
    action: 'admin-password-set',
    subject: user.username,
  });

  console.log(`[security] real-deal data directory: ${dbFiles.DATA_DIR}`);
  console.log(`Admin password updated for user '${user.username}'.`);
  return { success: true, username: user.username };
}

async function main() {
  const extra = process.argv.slice(2);
  if (extra.length > 0) {
    console.error('Unexpected argument — passwords are never accepted on the command line. Set ADMIN_PASSWORD or use the interactive prompt.');
    process.exit(1);
  }
  // The real-host tool: default the mode BEFORE any db module is required.
  if (!process.env.MA_MODE) process.env.MA_MODE = 'real';
  await run({});
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to set admin password:', err.message);
    process.exit(1);
  });
}

module.exports = { run, DEMO_PASSWORD };
