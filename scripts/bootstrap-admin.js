#!/usr/bin/env node
// D-10-02 (Phase 10): create the FIRST admin account on a real-deal host.
//
// A real host starts with zero accounts (db/realDataDir.js seeds control.db
// without the published demo accounts), so it is unusable until this CLI runs
// once on the host as the service user. There is deliberately no network path
// to it — first-admin creation and lockout recovery are host-local operator
// actions (T-10-10).
//
// Usage:
//   MA_BOOTSTRAP_PASSWORD='a 12+ char secret' node scripts/bootstrap-admin.js
//   node scripts/bootstrap-admin.js                        (no-echo TTY prompt)
//   node scripts/bootstrap-admin.js --force-reset-admin    (recovery: re-hash
//                                                           admin, revoke its sessions)
//
// [security]
//   - The secret comes from MA_BOOTSTRAP_PASSWORD or a no-echo TTY prompt,
//     NEVER argv: a command-line password is visible in `ps` and shell history
//     (T-10-03). Any positional argument is rejected before a database is
//     opened, so a mistaken `bootstrap-admin.js hunter2` creates nothing.
//   - The created admin carries mustChangePassword:true — the bootstrap
//     password is a one-time credential, rotated at first sign-in (plan 10-05
//     enforces the gate; the flag is stamped here).
//   - It refuses when any account already exists unless --force-reset-admin.
//   - It records a control-plane security event with actor `cli:<os-user>`
//     (`:` is outside the username charset, so it can never collide with a
//     real account, T-10-04). The password is never logged or audited.
//   - MA_MODE defaults to `real` when this file is run directly: this is the
//     real-host tool, dev/demo never needs it. It refuses outright when the
//     active control database is the committed data/control.db.
//
// Exports run() for tests and for scripts/set-admin-password.js.

const os = require('os');
const readline = require('readline');

const ACCEPTED_FLAGS = new Set(['--force-reset-admin', '--help']);

function usage() {
  return [
    'Usage: node scripts/bootstrap-admin.js [--force-reset-admin]',
    '  Password source: MA_BOOTSTRAP_PASSWORD (env) or an interactive no-echo prompt.',
    '  Passwords are never accepted on the command line.',
  ].join('\n');
}

/** Returns {forceReset, help} or {error}. Pure — no I/O. */
function parseArgv(args) {
  const out = { forceReset: false, help: false };
  for (const arg of args) {
    if (!ACCEPTED_FLAGS.has(arg)) {
      return { error: `Unexpected argument — passwords are never accepted on the command line. ${usage()}` };
    }
    if (arg === '--force-reset-admin') out.forceReset = true;
    if (arg === '--help') out.help = true;
  }
  return out;
}

function currentOsUser() {
  try { return os.userInfo().username; } catch (e) { return process.env.USER || process.env.USERNAME || 'unknown'; }
}

/** Prompt on the TTY with echo suppressed. Resolves the entered line. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {}; // swallow echo of the typed characters
    process.stdout.write(question);
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/**
 * Obtain a secret without argv: `envValue` when set, else a confirmed no-echo
 * TTY prompt, else refuse (non-interactive stdin without the env var).
 */
async function obtainSecret({ envValue, envName, label }) {
  if (typeof envValue === 'string' && envValue !== '') return envValue;
  if (!process.stdin.isTTY) {
    throw new Error(`No ${label} supplied — set ${envName} or run this from an interactive terminal.`);
  }
  const first = await promptHidden(`${label}: `);
  const second = await promptHidden(`Confirm ${label}: `);
  if (first !== second) throw new Error('The two entries did not match.');
  return first;
}

/**
 * Create the first admin (or, with forceReset, reset it). Resolves
 * { success, username, created, forceReset, dataDir }; throws on every refusal.
 *
 * @param {object} [opts]
 * @param {string} [opts.password]   supplied directly by tests; otherwise
 *   MA_BOOTSTRAP_PASSWORD or a TTY prompt.
 * @param {boolean} [opts.forceReset]
 * @param {string} [opts.osUser]     overrides the audited `cli:<os-user>`.
 */
async function run(opts = {}) {
  const dbFiles = require('../db/dbFiles');
  const { ensureRealDataDir } = require('../db/realDataDir');
  const controlStore = require('../db/controlStore');
  const store = require('../db/store');
  const sessions = require('../db/sessions');
  const auditHook = require('../db/auditHook');
  const passwords = require('../lib/passwords');

  ensureRealDataDir();
  if (dbFiles.isCommittedControlDbActive()) {
    throw new Error(
      '[security] the active control database is the committed data/control.db — refusing to create a real account in a git-tracked file. ' +
      'Run with MA_MODE=real (the default for this script) and a data directory outside git.'
    );
  }

  const forceReset = opts.forceReset === true;
  const osUser = opts.osUser || currentOsUser();

  let password = opts.password;
  if (password === undefined) {
    password = await obtainSecret({
      envValue: process.env.MA_BOOTSTRAP_PASSWORD,
      envName: 'MA_BOOTSTRAP_PASSWORD',
      label: 'Initial admin password',
    });
  }
  const problem = passwords.checkNewPassword(password, { realMode: true });
  if (problem) throw new Error(problem);

  const existing = controlStore.countAccounts();
  if (existing > 0 && !forceReset) {
    throw new Error(
      `${existing} account(s) already exist — bootstrap-admin only creates the FIRST admin. ` +
      'To reset the admin password on this host, re-run with --force-reset-admin.'
    );
  }

  const hash = await passwords.hashPassword(password);
  const now = new Date().toISOString();
  const actorName = 'cli:' + osUser;
  const current = forceReset ? controlStore.getAccount('admin') : null;
  let created;
  if (current) {
    controlStore.updateUser('admin', { hash, salt: null, mustChangePassword: true, disabled: false });
    created = false;
  } else {
    try {
      controlStore.createAccount({
        username: 'admin', name: 'Administrator', role: 'admin',
        hash, disabled: false, mustChangePassword: true,
        createdAt: now, createdBy: actorName,
      });
    } catch (e) {
      if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')) {
        throw new Error("An 'admin' account already exists — re-run with --force-reset-admin to reset its password.");
      }
      throw e;
    }
    created = true;
  }

  if (forceReset) {
    // A reset credential must not leave a session minted under the old one
    // alive (WR-01 precedent in set-admin-password.js).
    const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
    sessions.deleteAllSessionsForUser(runtimeConn, 'admin');
  }

  auditHook.recordSecurityEvent({
    // audit_log.actor_role is NOT NULL; a CLI actor has no portal role, so it
    // is attributed with the literal role 'cli' (never 'admin').
    actor: { username: actorName, role: 'cli' },
    action: forceReset ? 'bootstrap-admin-force-reset' : 'bootstrap-admin',
    subject: 'admin',
  });

  console.log(`[security] real-deal data directory: ${dbFiles.DATA_DIR}`);
  console.log(created
    ? "Created account 'admin'. Sign in as admin; you will be asked to change this password."
    : "Reset account 'admin'. Sign in as admin; you will be asked to change this password.");
  return { success: true, username: 'admin', created, forceReset, dataDir: dbFiles.DATA_DIR };
}

async function main() {
  const parsed = parseArgv(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }
  if (parsed.help) {
    console.log(usage());
    return;
  }
  // The real-host tool: default the mode BEFORE any db module is required.
  if (!process.env.MA_MODE) process.env.MA_MODE = 'real';
  await run({ forceReset: parsed.forceReset });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('bootstrap-admin failed:', err.message);
    process.exit(1);
  });
}

module.exports = { run, parseArgv, obtainSecret, promptHidden, currentOsUser };
