// ISO-01 / ISO-02 / D-06: template-only, demo-free deal database seeder.
//
// WHY allowlist-direction (not a denylist over ARRAY_COLLECTIONS): later
// phases (DD workspace, synergy value capture, IMO reporting, org design)
// each add new capability collections to db/collections.js's inventory. A
// denylist ("copy everything except these") would silently start leaking
// each NEW collection into every freshly created real-deal workspace the
// moment it lands — exactly the fabricated-data-inside-an-MNPI-store risk
// D-06 exists to prevent, since a showcase employee, a fabricated pulse
// score or an XP total is indistinguishable from real diligence data to the
// next reader once it's inside a live acquisition's own database file. An
// explicit allowlist (DEAL_SEED_COLLECTIONS below) stays correct with ZERO
// changes required when a later phase adds a collection: it simply isn't on
// the list, so it is never copied — proven programmatically, across the
// FULL current inventory, by test/deal-seed.test.js.

const fs = require('fs');
const Database = require('better-sqlite3');
const { dealDbPath, openDbFile, DEAL_SCHEMA_PATH, DEMO_DB_PATH } = require('./dbFiles');

// The three row-shaped template collections D-06 names (checklist templates,
// assessment templates, the sending->receiving process catalog). The i18n
// singleton is copied alongside these (handled separately below, since it is
// not row-shaped) — together these are the ONLY things a new deal inherits.
const DEAL_SEED_COLLECTIONS = ['checklistTemplates', 'assessmentTemplates', 'processCatalog'];

/**
 * Create a brand-new deal database at dealDbPath(dealId), seeded ONLY with
 * the DEAL_SEED_COLLECTIONS template rows + the i18n singleton copied from
 * `templateSourcePath` (defaulting to the demo store, DEMO_DB_PATH), plus a
 * fresh `settings` singleton carrying nothing but the deal's own identity
 * fields. Every other collection is left empty by construction (D-06) — no
 * employees, no projects, no pulses, no XP/gamification rows, no CMS
 * showcase content pre-populates a real acquisition workspace.
 *
 * `dealId` is validated by dealDbPath() (Plan 03-01) before any filesystem
 * path is touched — an invalid/traversal id throws there, never here.
 *
 * Throws (never silently overwrites) if a database already exists at that
 * deal's path — a silent overwrite of a live acquisition workspace file is
 * unacceptable; the caller must pick a fresh id.
 *
 * Returns the created file's absolute path.
 */
function createDealDatabase(dealId, { name, targetCompany, templateSourcePath = DEMO_DB_PATH } = {}) {
  const targetPath = dealDbPath(dealId); // throws on an invalid/traversal id

  if (fs.existsSync(targetPath)) {
    throw new Error(`db/dealSeed.js: refusing to overwrite an existing deal database at ${targetPath}`);
  }

  // Read-only pass over the template source — this module never writes to
  // templateSourcePath.
  const source = new Database(templateSourcePath, { readonly: true, fileMustExist: true });
  let templateRows;
  let templateI18n;
  try {
    templateRows = {};
    for (const key of DEAL_SEED_COLLECTIONS) {
      templateRows[key] = source.prepare(`SELECT id, project_id, seq, data FROM ${key} ORDER BY seq`).all();
    }
    const i18nRow = source.prepare('SELECT data FROM app_state WHERE key = ?').get('i18n');
    templateI18n = i18nRow ? i18nRow.data : undefined;
  } finally {
    source.close();
  }

  // Per D-06 ("same schema as demo"), a deal database opens with the shared
  // Phase-1 schema (db/schema.sql via DEAL_SCHEMA_PATH) — this CREATEs all
  // ARRAY_COLLECTIONS tables, but only DEAL_SEED_COLLECTIONS below ever
  // receives an INSERT; every other table is created empty and stays empty.
  const conn = openDbFile(targetPath, DEAL_SCHEMA_PATH);
  try {
    const seed = conn.transaction(() => {
      for (const key of DEAL_SEED_COLLECTIONS) {
        const insert = conn.prepare(`INSERT INTO ${key} (id, project_id, seq, data) VALUES (?, ?, ?, ?)`);
        for (const row of templateRows[key]) {
          insert.run(row.id, row.project_id, row.seq, row.data);
        }
      }
      if (templateI18n !== undefined) {
        conn.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('i18n', templateI18n);
      }

      // Fresh identity-only settings singleton — deliberately NOT copied
      // from templateSourcePath's settings, so no demo presentation state
      // (time-travel day scaling, gamification toggles, showcase target
      // company, Gemini/secret fields) is inherited into a real acquisition
      // workspace.
      const settings = {
        dealId,
        name: name || null,
        targetCompany: targetCompany || null,
        createdAt: new Date().toISOString(),
      };
      conn.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('settings', JSON.stringify(settings));
    });
    seed();
  } finally {
    conn.close();
  }

  return targetPath;
}

module.exports = { DEAL_SEED_COLLECTIONS, createDealDatabase };
