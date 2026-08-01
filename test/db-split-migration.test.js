// ISO-01 / D-05 / D-07: proves scripts/split-db-into-control-demo-deals.js
// physically splits a source SQLite store into control.db/demo.db/runtime.db
// with union parity, is idempotent, keeps secrets out of the committed
// outputs, actually gates on a corrupted output, and never touches the
// source file.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { runSplit, verifySplit } = require('../scripts/split-db-into-control-demo-deals.js');
const { COLLECTION_TARGETS } = require('../db/collections.js');

const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

function tempPath(label) {
  return path.join(os.tmpdir(), `gsd-db-split-test-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
}

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

/** Build a small synthetic source database, shaped exactly like
 * data/ma-portal.db (the real db/schema.sql, Phase 3 Task 2: no longer
 * carries a `users` table — accounts are a control.db-native table reached
 * only through db/controlStore.js, outside this generic split entirely),
 * with rows across a demo-target collection ('employees'), a custom*
 * shadow-lane collection ('customEmployees'), and all five singletons —
 * including a `settings` object carrying both SECRET_SETTINGS_FIELDS values. */
function buildSyntheticSource(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const insertRow = (table, id, projectId, seq, data) => {
    db.prepare(`INSERT INTO ${table} (id, project_id, seq, data) VALUES (?, ?, ?, ?)`)
      .run(id, projectId, seq, JSON.stringify(data));
  };

  insertRow('employees', 'emp_1', 'proj_demo', 0, { id: 'emp_1', name: 'Alice', projectId: 'proj_demo' });
  insertRow('employees', 'emp_2', 'proj_demo', 1, { id: 'emp_2', name: 'Bob', projectId: 'proj_demo' });

  insertRow('customEmployees', 'cemp_1', 'proj_demo', 0, { id: 'cemp_1', name: 'Shadow Alice' });

  const settings = {
    companyName: 'Acme Corp',
    timeTravelDay: 30,
    geminiApiKey: 'secret-gemini-key-abc123',
    databaseConfig: { connectionDetails: 'secret-conn-string-xyz789', poolSize: 5 },
  };
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('settings', JSON.stringify(settings));
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('customSettings', JSON.stringify({ theme: 'dark' }));
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('i18n', JSON.stringify({ strings: { en: { hello: 'Hi' } } }));
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('menus', JSON.stringify({ sidebar: [] }));
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('activeProjectId', JSON.stringify('proj_demo'));

  db.close();
  return settings;
}

test('db-split-migration', async (t) => {
  const sourcePath = tempPath('source') + '.db';
  const outDir = tempPath('out-dir');
  fs.mkdirSync(outDir, { recursive: true });
  const settings = buildSyntheticSource(sourcePath);
  const sourceStatBefore = fs.statSync(sourcePath);

  t.after(() => {
    cleanupDbFile(sourcePath);
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  await t.test('(a) all three outputs exist after runSplit()', () => {
    const { finalPaths } = runSplit({ sourcePath, outDir });
    assert.ok(fs.existsSync(finalPaths.control), 'control.db should exist');
    assert.ok(fs.existsSync(finalPaths.demo), 'demo.db should exist');
    assert.ok(fs.existsSync(finalPaths.runtime), 'runtime.db should exist');
  });

  await t.test('(b) the union of the three outputs round-trips to the source (verifySplit green)', () => {
    const ok = verifySplit({ sourcePath, outDir });
    assert.strictEqual(ok, true, 'verifySplit() should report parity against the synthetic source');
  });

  await t.test('(c) no array collection routes to control.db anymore — accounts are a control.db-native table outside this split (ISO-01, Phase 3 Task 2)', () => {
    const control = new Database(path.join(outDir, 'control.db'), { readonly: true });
    try {
      assert.strictEqual(
        Object.values(COLLECTION_TARGETS).includes('control'), false,
        'COLLECTION_TARGETS must route every array collection to demo now that users left the request-bound inventory (db/collections.js)'
      );
      // control.db's `users` table still exists (control-schema.sql defines it
      // structurally) but this generic split never seeds it — real accounts
      // are managed exclusively through db/controlStore.js, not this mechanism.
      const controlUsersCount = control.prepare('SELECT COUNT(*) AS c FROM users').get().c;
      assert.strictEqual(controlUsersCount, 0, 'the split must not seed control.db\'s users table from ARRAY_COLLECTIONS');
    } finally {
      control.close();
    }
  });

  await t.test('(d) custom* shadow-lane rows land in demo.db', () => {
    const demo = new Database(path.join(outDir, 'demo.db'), { readonly: true });
    try {
      const rows = demo.prepare('SELECT id, data FROM customEmployees ORDER BY seq').all();
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(JSON.parse(rows[0].data).name, 'Shadow Alice');
    } finally {
      demo.close();
    }
  });

  await t.test('(e) secret fields are absent from control.db and demo.db, present in runtime.db secretSettings', () => {
    const control = new Database(path.join(outDir, 'control.db'), { readonly: true });
    const demo = new Database(path.join(outDir, 'demo.db'), { readonly: true });
    const runtime = new Database(path.join(outDir, 'runtime.db'), { readonly: true });
    try {
      const controlSettingsRow = control.prepare('SELECT data FROM app_state WHERE key = ?').get('controlSettings');
      const controlSettingsText = controlSettingsRow ? controlSettingsRow.data : '';
      assert.ok(!controlSettingsText.includes('secret-gemini-key-abc123'));
      assert.ok(!controlSettingsText.includes('secret-conn-string-xyz789'));

      const demoSettingsRow = demo.prepare('SELECT data FROM app_state WHERE key = ?').get('settings');
      assert.ok(demoSettingsRow, 'demo.db should carry a settings singleton');
      const demoSettings = JSON.parse(demoSettingsRow.data);
      assert.strictEqual(demoSettings.geminiApiKey, undefined);
      // Only the SECRET_SETTINGS_FIELDS leaf ('databaseConfig.connectionDetails')
      // is deep-deleted — sibling fields on the same nested object (poolSize)
      // are non-secret and must survive in demo.db.
      assert.strictEqual(demoSettings.databaseConfig.connectionDetails, undefined);
      assert.strictEqual(demoSettings.databaseConfig.poolSize, 5);
      assert.strictEqual(demoSettings.companyName, 'Acme Corp', 'non-secret fields must survive in demo.db');

      const secretRow = runtime.prepare('SELECT data FROM app_state WHERE key = ?').get('secretSettings');
      assert.ok(secretRow, 'runtime.db should carry a secretSettings singleton');
      const secrets = JSON.parse(secretRow.data);
      assert.strictEqual(secrets.geminiApiKey, 'secret-gemini-key-abc123');
      assert.strictEqual(secrets.databaseConfig.connectionDetails, 'secret-conn-string-xyz789');
    } finally {
      control.close();
      demo.close();
      runtime.close();
    }
  });

  await t.test('(f) re-running runSplit() a second time is idempotent (same canonical union)', () => {
    runSplit({ sourcePath, outDir }); // second run
    const ok = verifySplit({ sourcePath, outDir });
    assert.strictEqual(ok, true, 'a second run should still verify green');
  });

  await t.test('(g) a deliberately corrupted output makes verifySplit() return failure', () => {
    const demoPath = path.join(outDir, 'demo.db');
    const corrupt = new Database(demoPath);
    try {
      corrupt.prepare('DELETE FROM employees WHERE id = ?').run('emp_2');
    } finally {
      corrupt.close();
    }

    const ok = verifySplit({ sourcePath, outDir });
    assert.strictEqual(ok, false, 'deleting a row from an output must make the gate fail');

    // Repair for subsequent assertions in this file (re-run is idempotent/safe).
    runSplit({ sourcePath, outDir });
    assert.strictEqual(verifySplit({ sourcePath, outDir }), true);
  });

  await t.test('(h) the source file mtime and byte length are unchanged after every run', () => {
    const sourceStatAfter = fs.statSync(sourcePath);
    assert.strictEqual(sourceStatAfter.size, sourceStatBefore.size, 'source byte length must be unchanged');
    assert.strictEqual(sourceStatAfter.mtimeMs, sourceStatBefore.mtimeMs, 'source mtime must be unchanged');
  });

  // Sanity: settings object built above is actually used (guards against an
  // unused-variable drift making the fixture silently stale).
  assert.ok(settings.geminiApiKey && settings.databaseConfig.connectionDetails);
});
