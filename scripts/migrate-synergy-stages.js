#!/usr/bin/env node
// D-07/D-11: one-off migration of the retired five-value synergy-initiative
// lifecycle (identified/validated/planned/executing/realized) onto the new
// four-value SYN-03 confidence-stage vocabulary (idea/validated/committed/
// captured), against a committed database's `synergyInitiatives` rows and
// its `app_state` i18n singleton, following
// scripts/seed-dd-request-templates.js's shape exactly (openDbFile() +
// prepared-statement rewrite + wal_checkpoint(TRUNCATE) + close, CLI
// defaulting to DEMO_DB_PATH).
//
// Usage:
//   node scripts/migrate-synergy-stages.js [path-to-db]
//   Defaults to db/dbFiles.js's DEMO_DB_PATH (data/demo.db) when run with no
//   argument. `data/ma-portal.db` has no exported path constant (it is a
//   dormant Phase-1 artifact, db/store.js:171-176) — pass its path
//   explicitly as the one CLI argument to migrate it too.
//
// Idempotent: a synergyInitiatives row already carrying `stage` (and no
// retired `status` key) is left untouched; an i18n language whose new stage
// label keys already exist is not duplicated. Running this script twice
// against the same file leaves it byte-identical to a single run.
//
// D-07's mechanical map (05-CONTEXT.md, UI-SPEC's stage-badge palette table)
// is intentionally a fixed lookup table local to this one-off script, not a
// re-declared array copy of either vocabulary — the per-row transform reads
// whatever legacy value is ACTUALLY stored in each row (via this map's keys)
// rather than validating rows against a hard-coded allowlist.
'use strict';

const { openDbFile, DEAL_SCHEMA_PATH, DEMO_DB_PATH } = require('../db/dbFiles');

// D-07: two lowest-confidence legacy values -> the first two new stages;
// the two mid-lifecycle legacy values both fold onto the third stage;
// the terminal legacy value -> the fourth stage. `validated` is the one
// legacy value whose key name is unchanged (still present, still means the
// same thing) — it is not a MIGRATION target, so it is deliberately absent
// from this map; a row already carrying stage:'validated' with no `status`
// key is the idempotent no-op case below.
const STAGE_MIGRATION_MAP = {
  identified: 'idea',
  validated: 'validated',
  planned: 'committed',
  executing: 'committed',
  realized: 'captured',
};

// UI-SPEC Copywriting Contract: the three label keys that are actually NEW
// (idea, committed) or renamed-with-a-direct-predecessor (captured <- the
// old syn.st_realized value). syn.st_validated already exists with the
// correct value in every committed database and is never touched here.
const NEW_LABEL_EN = { 'syn.st_idea': 'Idea', 'syn.st_committed': 'Committed', 'syn.st_captured': 'Captured' };
// The two retired-key values these labels absorb verbatim in the languages
// that already carry a direct-predecessor translation (05-RESEARCH.md
// Finding #11 / this plan's action text: "the two keys whose meaning is
// unchanged" -> validated (untouched) and captured (renamed from realized).
// `idea` and `committed` get NO manufactured DE/ZH/CS translation — a
// missing key is a no-op under transitions.js's t() fallback-to-English
// contract, never a blank render, so leaving them absent for non-English
// languages is a deliberate, correct choice per the action text, not a gap.
const CARRIED_TRANSLATION_KEY = { 'syn.st_captured': 'syn.st_realized' };

// The four retired label keys removed from every language once the new
// keys above are in place. `syn.st_validated` is NOT in this list — it is
// not retired, it carries forward unchanged.
const RETIRED_LABEL_KEYS = ['syn.st_identified', 'syn.st_planned', 'syn.st_executing', 'syn.st_realized'];

/**
 * Migrate one committed database's `synergyInitiatives` rows and its
 * `app_state['i18n']` singleton from the retired five-value lifecycle to the
 * new four-value SYN-03 stage vocabulary. Opens `dbPath` through
 * openDbFile() (creates the file / applies schema idempotently if it
 * predates this collection, mirroring seedDdRequestTemplates()'s contract).
 * Returns `{ rowsMigrated, rowsSkipped, languagesTouched }` for the CLI's
 * one-line summary.
 */
function migrateSynergyStages(dbPath) {
  const conn = openDbFile(dbPath, DEAL_SCHEMA_PATH);
  let rowsMigrated = 0;
  let rowsSkipped = 0;
  let languagesTouched = 0;
  try {
    const migrate = conn.transaction(() => {
      // --- 1. synergyInitiatives rows -----------------------------------
      const rows = conn.prepare('SELECT id, data FROM synergyInitiatives').all();
      const updateStmt = conn.prepare('UPDATE synergyInitiatives SET data = ? WHERE id = ?');
      for (const row of rows) {
        const item = JSON.parse(row.data);
        if (!Object.prototype.hasOwnProperty.call(item, 'status')) {
          // Already migrated (or never carried the retired key) — idempotent no-op.
          rowsSkipped++;
          continue;
        }
        const legacyValue = item.status;
        const newStage = STAGE_MIGRATION_MAP[legacyValue];
        if (!newStage) {
          throw new Error(
            `scripts/migrate-synergy-stages.js: row ${row.id} carries an unrecognized legacy status "${legacyValue}" with no D-07 mechanical mapping — refusing to guess.`
          );
        }
        delete item.status;
        item.stage = newStage;
        updateStmt.run(JSON.stringify(item), row.id);
        rowsMigrated++;
      }

      // --- 2. app_state['i18n'] singleton --------------------------------
      const i18nRow = conn.prepare("SELECT data FROM app_state WHERE key = 'i18n'").get();
      if (i18nRow) {
        const i18n = JSON.parse(i18nRow.data);
        i18n.strings = i18n.strings || {};
        const languages = Object.keys(i18n.strings);
        for (const lang of languages) {
          const strings = i18n.strings[lang];
          let touchedThisLang = false;

          for (const [newKey, enText] of Object.entries(NEW_LABEL_EN)) {
            if (Object.prototype.hasOwnProperty.call(strings, newKey)) continue; // idempotent
            if (lang === 'en') {
              strings[newKey] = enText;
              touchedThisLang = true;
            } else if (CARRIED_TRANSLATION_KEY[newKey] && strings[CARRIED_TRANSLATION_KEY[newKey]] !== undefined) {
              // Direct-predecessor translation carried over verbatim
              // (e.g. syn.st_captured <- this language's existing
              // syn.st_realized value) — meaning is unchanged.
              strings[newKey] = strings[CARRIED_TRANSLATION_KEY[newKey]];
              touchedThisLang = true;
            }
            // Else: deliberately left absent for this language — falls back
            // to English at render time (transitions.js t()), never blank.
          }

          for (const retiredKey of RETIRED_LABEL_KEYS) {
            if (Object.prototype.hasOwnProperty.call(strings, retiredKey)) {
              delete strings[retiredKey];
              touchedThisLang = true;
            }
          }

          if (touchedThisLang) languagesTouched++;
        }
        conn.prepare("UPDATE app_state SET data = ? WHERE key = 'i18n'").run(JSON.stringify(i18n));
      }
    });
    migrate();

    // openDbFile() opens under WAL (journal_mode=WAL) — without a checkpoint
    // the write lands only in the gitignored -wal sidecar, leaving the
    // COMMITTED dbPath file itself byte-unchanged on disk (the standing WAL
    // trap that has fired 9+ times in this project). A full TRUNCATE
    // checkpoint folds the write back into the main file and clears the
    // sidecar, so `git status`/`git diff` on dbPath sees this change
    // immediately.
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }
  return { rowsMigrated, rowsSkipped, languagesTouched };
}

function main() {
  const target = process.argv[2] || DEMO_DB_PATH;
  const result = migrateSynergyStages(target);
  console.log(
    `Migrated ${target}: ${result.rowsMigrated} synergyInitiatives row(s) rewritten, ${result.rowsSkipped} already up to date, ${result.languagesTouched} i18n language(s) touched.`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { migrateSynergyStages, STAGE_MIGRATION_MAP, RETIRED_LABEL_KEYS };
