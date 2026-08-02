#!/usr/bin/env node
// D-13: seeds db/ddRequestTemplateSeed.js's DD_REQUEST_TEMPLATE (the
// reviewable source of truth) into a target database's `ddRequestTemplates`
// table, following the export-plus-CLI shape
// scripts/split-db-into-control-demo-deals.js already established.
//
// Usage:
//   node scripts/seed-dd-request-templates.js [path-to-db]
//   Defaults to db/dbFiles.js's DEMO_DB_PATH (data/demo.db) when run with no
//   argument — that committed row is what db/dealSeed.js's allowlist copy
//   (DEAL_SEED_COLLECTIONS) reads from at createDealDatabase() time.
//
// Idempotent: DELETEs any existing row sharing the template's id before
// INSERTing the fresh one, so re-running never produces a second
// 'ddtpl_standard' row — mirrors this phase's own re-runnability discipline
// elsewhere (db/dealSeed.js's createDealDatabase(), the split script's
// --verify gate).

'use strict';

const { DD_REQUEST_TEMPLATE } = require('../db/ddRequestTemplateSeed');
const { openDbFile, DEAL_SCHEMA_PATH, DEMO_DB_PATH } = require('../db/dbFiles');

/**
 * Seed (or re-seed) DD_REQUEST_TEMPLATE into `demoDbPath`'s
 * `ddRequestTemplates` table. Opens the target through openDbFile() (the
 * shared "open + pragma + schema" contract), so the table is created if the
 * file predates this collection's schema addition. Returns
 * `{ inserted: number }` — the count of template ITEMS the freshly written
 * row now carries (the row count itself is always exactly one; the item
 * count is what a CLI caller actually wants to see in the one-line summary).
 */
function seedDdRequestTemplates(demoDbPath) {
  const conn = openDbFile(demoDbPath, DEAL_SCHEMA_PATH);
  try {
    const seed = conn.transaction(() => {
      conn.prepare('DELETE FROM ddRequestTemplates WHERE id = ?').run(DD_REQUEST_TEMPLATE.id);
      conn.prepare('INSERT INTO ddRequestTemplates (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
        .run(DD_REQUEST_TEMPLATE.id, null, 0, JSON.stringify(DD_REQUEST_TEMPLATE));
    });
    seed();
    // openDbFile() opens under WAL (journal_mode=WAL) — without a checkpoint
    // the write lands only in the gitignored -wal sidecar, leaving the
    // COMMITTED demoDbPath file itself byte-unchanged on disk. A full
    // TRUNCATE checkpoint folds the write back into the main file and clears
    // the sidecar, so `git status` on demoDbPath (and any plain file read of
    // it, e.g. by test fixtures or a fresh readonly connection) sees this
    // row immediately, not only after some LATER unrelated write happens to
    // trigger SQLite's own automatic checkpoint threshold.
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }
  return { inserted: DD_REQUEST_TEMPLATE.items.length };
}

function main() {
  const target = process.argv[2] || DEMO_DB_PATH;
  const result = seedDdRequestTemplates(target);
  console.log(`Seeded DD_REQUEST_TEMPLATE (${DD_REQUEST_TEMPLATE.id}, ${result.inserted} items) into ${target}`);
}

if (require.main === module) {
  main();
}

module.exports = { seedDdRequestTemplates };
