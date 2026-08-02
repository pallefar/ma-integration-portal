// ISO-01 / ISO-02 / D-06: proves a new deal database is created with only the
// three template collections + i18n + a fresh identity-only settings
// singleton, and that every other collection in the FULL inventory is
// provably empty — not just a hand-picked subset.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ARRAY_COLLECTIONS } = require('../db/collections.js');
const { DEAL_SEED_COLLECTIONS, createDealDatabase } = require('../db/dealSeed.js');

const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

function tempPath(label) {
  return path.join(os.tmpdir(), `gsd-deal-seed-test-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
}

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

/** Build a small synthetic demo-shaped source database: rows in all three
 * DEAL_SEED_COLLECTIONS PLUS rows in several non-template collections
 * (employees/projects/pulses/courses) so the "everything else stays empty"
 * assertion is meaningfully exercised, plus an i18n singleton and a
 * `settings` singleton carrying demo presentation state that must NOT
 * bleed into the new deal. */
function buildSyntheticDemoSource(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const insertRow = (table, id, projectId, seq, data) => {
    db.prepare(`INSERT INTO ${table} (id, project_id, seq, data) VALUES (?, ?, ?, ?)`)
      .run(id, projectId, seq, JSON.stringify(data));
  };

  insertRow('checklistTemplates', 'ck_1', null, 0, { id: 'ck_1', workstream: 'ws_hr', task: 'Day-1 checklist item' });
  insertRow('checklistTemplates', 'ck_2', null, 1, { id: 'ck_2', workstream: 'ws_it', task: 'IT access checklist item' });
  insertRow('assessmentTemplates', 'at_1', null, 0, { id: 'at_1', dimension: 'culture' });
  insertRow('processCatalog', 'pc_1', null, 0, { id: 'pc_1', domain: 'HR', sendingProcess: 'Onboarding' });
  // D-13: the standard DD request checklist template — a single row whose
  // `data` blob carries the whole template object (same shape
  // db/ddRequestTemplateSeed.js#DD_REQUEST_TEMPLATE produces), mirroring how
  // checklistTemplates/assessmentTemplates/processCatalog are each one row
  // per template above, not one row per item.
  insertRow('ddRequestTemplates', 'ddtpl_synthetic', null, 0, {
    id: 'ddtpl_synthetic',
    name: 'Synthetic DD checklist',
    version: 1,
    items: [{ id: 'dd_legal_01', area: 'legal', text: 'Synthetic legal item', ownerHint: 'Legal' }],
  });

  insertRow('employees', 'emp_1', 'proj_demo', 0, { id: 'emp_1', name: 'Demo Alice' });
  insertRow('projects', 'proj_demo', null, 0, { id: 'proj_demo', name: 'Demo Project' });
  insertRow('pulses', 'pulse_1', 'proj_demo', 0, { id: 'pulse_1', score: 4 });
  insertRow('courses', 'course_1', null, 0, { id: 'course_1', title: 'Integration Academy Module 1' });

  const settings = {
    companyName: 'Demo Showcase Co',
    timeTravelDay: 60,
    gamificationEnabled: true,
    xpTotals: { emp_1: 500 },
  };
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('settings', JSON.stringify(settings));
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run(
    'i18n', JSON.stringify({ strings: { en: { hello: 'Hi' }, de: { hello: 'Hallo' } } })
  );
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('menus', JSON.stringify({ sidebar: [] }));
  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('activeProjectId', JSON.stringify('proj_demo'));

  db.close();
  return settings;
}

test('deal-seed', async (t) => {
  const sourcePath = tempPath('demo-source') + '.db';
  const dealsDir = tempPath('deals-dir');
  fs.mkdirSync(dealsDir, { recursive: true });
  const sourceSettings = buildSyntheticDemoSource(sourcePath);

  // db/dbFiles.js's dealDbPath() always resolves under its OWN fixed
  // DEALS_DIR (data/deals), which this module has no way to override — so
  // exercise createDealDatabase() by pointing templateSourcePath at our
  // synthetic fixture and letting the real dealId->path resolution run
  // as-is, cleaning up the created file (and its dir if we created it)
  // afterwards, rather than trying to redirect DEALS_DIR itself.
  const dbFiles = require('../db/dbFiles.js');
  const dealId = `deal_seedtest${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const dealPath = dbFiles.dealDbPath(dealId);

  t.after(() => {
    cleanupDbFile(sourcePath);
    cleanupDbFile(dealPath);
    try { fs.rmSync(dealsDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  await t.test('(a) each template collection has the same row count as the source', () => {
    const createdPath = createDealDatabase(dealId, {
      name: 'Project Falcon',
      targetCompany: 'Acquiree Corp',
      templateSourcePath: sourcePath,
    });
    assert.strictEqual(createdPath, dealPath);
    assert.ok(fs.existsSync(dealPath));

    const conn = new Database(dealPath, { readonly: true });
    try {
      for (const key of DEAL_SEED_COLLECTIONS) {
        const src = new Database(sourcePath, { readonly: true });
        try {
          const srcCount = src.prepare(`SELECT COUNT(*) AS c FROM ${key}`).get().c;
          const gotCount = conn.prepare(`SELECT COUNT(*) AS c FROM ${key}`).get().c;
          assert.strictEqual(gotCount, srcCount, `${key} row count should match the template source`);
          assert.ok(gotCount > 0, `${key} should have at least one seeded row in this fixture`);
        } finally {
          src.close();
        }
      }
    } finally {
      conn.close();
    }
  });

  await t.test('(b) the i18n singleton is present', () => {
    const conn = new Database(dealPath, { readonly: true });
    try {
      const row = conn.prepare('SELECT data FROM app_state WHERE key = ?').get('i18n');
      assert.ok(row, 'i18n singleton should be present in the new deal database');
      const i18n = JSON.parse(row.data);
      assert.strictEqual(i18n.strings.en.hello, 'Hi');
      assert.strictEqual(i18n.strings.de.hello, 'Hallo');
    } finally {
      conn.close();
    }
  });

  await t.test('(c) every non-seeded array collection has exactly 0 rows (full inventory, not a hand-picked subset)', () => {
    const conn = new Database(dealPath, { readonly: true });
    try {
      let checked = 0;
      for (const key of ARRAY_COLLECTIONS) {
        if (DEAL_SEED_COLLECTIONS.includes(key)) continue;
        const count = conn.prepare(`SELECT COUNT(*) AS c FROM ${key}`).get().c;
        assert.strictEqual(count, 0, `${key} must be empty in a freshly seeded deal database`);
        checked++;
      }
      // Sanity: this actually exercised the bulk of the inventory (33 total
      // minus the 3 seeded collections).
      assert.strictEqual(checked, ARRAY_COLLECTIONS.length - DEAL_SEED_COLLECTIONS.length);
    } finally {
      conn.close();
    }
  });

  await t.test('(d) settings contains only the supplied identity fields, none of the source settings keys', () => {
    const conn = new Database(dealPath, { readonly: true });
    try {
      const row = conn.prepare('SELECT data FROM app_state WHERE key = ?').get('settings');
      assert.ok(row, 'settings singleton should be present');
      const dealSettings = JSON.parse(row.data);

      assert.strictEqual(dealSettings.name, 'Project Falcon');
      assert.strictEqual(dealSettings.targetCompany, 'Acquiree Corp');
      assert.strictEqual(dealSettings.dealId, dealId);
      assert.ok(dealSettings.createdAt, 'createdAt should be stamped');

      for (const sourceKey of Object.keys(sourceSettings)) {
        assert.strictEqual(
          Object.prototype.hasOwnProperty.call(dealSettings, sourceKey),
          false,
          `deal settings must not inherit source settings key "${sourceKey}"`
        );
      }
    } finally {
      conn.close();
    }
  });

  await t.test('(e) a second createDealDatabase() call for the same id throws and leaves the file byte-identical', () => {
    const statBefore = fs.statSync(dealPath);
    const contentBefore = fs.readFileSync(dealPath);

    assert.throws(() => {
      createDealDatabase(dealId, { name: 'Overwrite Attempt', templateSourcePath: sourcePath });
    }, /refusing to overwrite/);

    const statAfter = fs.statSync(dealPath);
    const contentAfter = fs.readFileSync(dealPath);
    assert.strictEqual(statAfter.size, statBefore.size);
    assert.ok(contentBefore.equals(contentAfter), 'existing deal database must be byte-identical after a rejected overwrite attempt');
  });
});
