#!/usr/bin/env node
// RPT-01..04 (07-07): seeds every translation key the reporting/exports
// phase introduced — the Reports & Exports tab label, the four dataset
// labels, the two format labels, the raw-export and steerco-pack section
// labels, the pack card copy, and every label lib/reportPack.js's renderer
// resolves via its t(key, englishFallback) calls (section titles, column
// headings, stat-tile labels, empty-state lines, the stale tag and the
// stale-count sentence) — into all four shipped languages (en/de/zh/cs).
// Also closes a Plan 07-04 gap: syn.rollup_unphased (the Synergy tab's
// "Unphased" rollup tile, added in that plan) was never seeded at all,
// discovered while deriving this script's key list from source.
//
// Mirrors scripts/seed-org-demo.js's i18n block exactly (same file, same
// idempotent per-key/per-language skip-if-exists loop, same truncating WAL
// checkpoint) — that script's i18n handling is itself add-only-by-skip, not
// the delete-by-id-prefix pattern it uses for its SQL table rows, because
// db.i18n is a single JSON blob under app_state, not a set of deletable rows.
//
// Translation strategy (07-UI-SPEC.md's carry-verbatim-or-ship-English
// convention, restated in 07-CONTEXT.md's read_first): a handful of keys
// whose MEANING is identical to an already-translated string carry that
// translation verbatim — rpt.pack_tile_gross/cost/net/target from the
// Synergy tab's syn.rollup_gross/cost/net/target, and rpt.pack_col_severity
// from the RAID tab's raid.sev. rpt.pack_tile_unphased and
// syn.rollup_unphased are one freshly-authored concept used in two places,
// authored together rather than twice. Every other key ships English only;
// public/js/transitions.js's applyPortalI18n() and lib/reportPack.js's
// resolveLanguage() BOTH fall back to the English entry when a
// language-specific value is absent (verified: neither ever surfaces a raw
// key), so a string never appears untranslated-looking to a reader unless
// it has no entry in ANY language — which this script guarantees against by
// always writing 'en'. Authoring real translations for all ~40 newly
// introduced strings was assessed as out of the budgeted ~10-15 new labels
// this convention exists to cap.
//
// Deliberately excluded:
// - rpt.pack_col_bar: the synergies table's realized-vs-target bar column
//   header is an intentionally empty string in the renderer (SYN_TABLE_
//   COLUMNS' `bar` entry) — it draws a graphic, not a labelled value, so
//   there is nothing to translate.
// - The pack's confidentiality footer line (lib/reportPack.js's
//   drawFooterBand): fully hardcoded, never passed through t() at all, by
//   design (T-07-22) — the leading "CONFIDENTIAL" word and the rest of that
//   line must never vary by language, so it carries no key to seed.
//
// Known gap, NOT closed by this script (documented in 07-07-SUMMARY.md):
// the pack button's in-flight label ("Generating pack…"), its failure
// message, and the pack route's 409 empty-deal error text are plain
// JavaScript string literals in public/js/execution.js and server.js with
// NO data-i18n attribute or t()-resolver call at all today — there is no
// key in source to seed. Wiring them would mean exposing a new global
// translate accessor from public/js/transitions.js and deciding how a JSON
// error response carries a caller's language, which is an interface change
// beyond this plan's declared file scope (scripts/seed-reports-i18n.js,
// data/demo.db, test/reports-i18n.test.js) and beyond a same-task auto-fix.
//
// Usage:
//   node scripts/seed-reports-i18n.js [path-to-db]
//   Defaults to db/dbFiles.js's DEMO_DB_PATH (data/demo.db) when run with no
//   argument.
//
// Idempotent: a key already carrying ANY value in a language is left
// untouched (skip-if-exists) — a second run against the same database adds
// zero keys and reports the database was already fully seeded.
'use strict';

const { openDbFile, DEAL_SCHEMA_PATH, DEMO_DB_PATH } = require('../db/dbFiles');

const NEW_LABELS = {
  'exec.tab_reports': { en: 'Reports & Exports' },

  'rpt.section_raw': { en: 'Raw data export' },
  'rpt.ds_workstreams': { en: 'Workstreams' },
  'rpt.ds_tasks': { en: 'Tasks' },
  'rpt.ds_raid': { en: 'RAID' },
  'rpt.ds_synergies': { en: 'Synergies' },
  'rpt.csv': { en: 'CSV' },
  'rpt.json': { en: 'JSON' },
  'rpt.section_pack': { en: 'Steering committee pack' },
  'rpt.pack_intro': {
    en: 'A one-page executive summary, then a section each for workstreams and tasks, risks and decisions, and synergies — TE-branded with a confidentiality footer on every page.',
  },
  'rpt.pack_btn': { en: 'Generate steerco pack (PDF)' },

  // Pack renderer (lib/reportPack.js) — page one tiles.
  'rpt.pack_tile_gross': { en: 'Gross realized', de: 'Brutto realisiert', zh: '总实现值', cs: 'Hrubě realizováno' },
  'rpt.pack_tile_unphased': { en: 'Unphased', de: 'Nicht phasiert', zh: '未分期', cs: 'Nefázováno' },
  'rpt.pack_tile_cost': { en: 'Cost incurred', de: 'Angefallene Kosten', zh: '已发生成本', cs: 'Vzniklé náklady' },
  'rpt.pack_tile_net': { en: 'Net benefit', de: 'Nettonutzen', zh: '净收益', cs: 'Čistý přínos' },
  'rpt.pack_tile_target': { en: 'Deal target', de: 'Deal-Ziel', zh: '交易目标', cs: 'Cíl transakce' },
  'rpt.pack_no_workstreams': { en: 'No workstreams yet.' },
  'rpt.pack_top_risks': { en: 'Top risks' },
  'rpt.pack_no_risks': { en: 'No risks recorded yet.' },
  'rpt.pack_stale_sentence': {
    en: '{staleCount} of {total} synergy initiatives are stale (unconfirmed for more than {staleDays} days).',
  },
  'rpt.pack_truncation_notice': {
    en: '{count} further row(s) exist in this dataset — see the CSV export for the complete list.',
  },

  // Pack renderer — Section 2 (Workstreams & Tasks).
  'rpt.pack_section_ws_tasks': { en: 'Workstreams & Tasks' },
  'rpt.pack_no_tasks': { en: 'No tasks recorded yet.' },
  'rpt.pack_col_title': { en: 'Title' },
  'rpt.pack_col_workstream': { en: 'Workstream' },
  'rpt.pack_col_phase': { en: 'Phase' },
  'rpt.pack_col_status': { en: 'Status' },
  'rpt.pack_col_owner': { en: 'Owner' },
  'rpt.pack_col_due': { en: 'Due date' },

  // Pack renderer — Section 3 (Risks & Decisions / RAID).
  'rpt.pack_section_raid': { en: 'Risks & Decisions' },
  'rpt.pack_no_raid': { en: 'No risks, issues, decisions or dependencies recorded yet.' },
  'rpt.pack_col_type': { en: 'Type' },
  'rpt.pack_col_severity': { en: 'Severity', de: 'Schwere', zh: '严重度', cs: 'Závažnost' },

  // Pack renderer — Section 4 (Synergies).
  'rpt.pack_syn_recap': {
    en: 'Rollup recap — gross realized ${gross}M · cost incurred ${cost}M · net benefit ${net}M · deal target ${target}M.',
  },
  'rpt.pack_section_synergies': { en: 'Synergies' },
  'rpt.pack_no_synergies': { en: 'No synergy initiatives recorded yet.' },
  'rpt.pack_col_category': { en: 'Category' },
  'rpt.pack_col_stage': { en: 'Stage' },
  'rpt.pack_col_stage_baseline': { en: 'Stage at last baseline' },
  'rpt.pack_col_target': { en: 'Target' },
  'rpt.pack_col_realized': { en: 'Realized' },
  'rpt.pack_col_cost_incurred': { en: 'Cost incurred', de: 'Angefallene Kosten', zh: '已发生成本', cs: 'Vzniklé náklady' },
  'rpt.pack_col_net_benefit': { en: 'Net benefit', de: 'Nettonutzen', zh: '净收益', cs: 'Čistý přínos' },
  'rpt.pack_stale_tag': { en: 'Stale {days}d' },

  // Plan 07-04 gap: the Synergy tab's "Unphased" rollup tile label
  // (public/js/execution.js's renderSynRollup()) was introduced in that
  // plan but never had an i18n entry at all until this script.
  'syn.rollup_unphased': { en: 'Unphased', de: 'Nicht phasiert', zh: '未分期', cs: 'Nefázováno' },
};

/**
 * Seeds (or re-seeds) the reports/pack translation keys into `dbPath`.
 * Opens `dbPath` through openDbFile(). Add-only per key+language: a key
 * already present in a language is left untouched. Returns a one-line
 * summary object for the CLI.
 */
function seedReportsI18n(dbPath) {
  const conn = openDbFile(dbPath, DEAL_SCHEMA_PATH);
  const summary = { keysAdded: 0, languagesTouched: 0 };
  try {
    const run = conn.transaction(() => {
      const i18nRow = conn.prepare("SELECT data FROM app_state WHERE key = 'i18n'").get();
      if (!i18nRow) return;
      const i18n = JSON.parse(i18nRow.data);
      i18n.strings = i18n.strings || {};
      const languages = Object.keys(i18n.strings);
      let anyTouched = false;
      for (const lang of languages) {
        const strings = i18n.strings[lang];
        let touchedThisLang = false;
        for (const [key, translations] of Object.entries(NEW_LABELS)) {
          if (Object.prototype.hasOwnProperty.call(strings, key)) continue; // add-only: never overwrite
          strings[key] = translations[lang] || translations.en;
          touchedThisLang = true;
          summary.keysAdded++;
        }
        if (touchedThisLang) { summary.languagesTouched++; anyTouched = true; }
      }
      if (anyTouched) {
        conn.prepare("UPDATE app_state SET data = ? WHERE key = 'i18n'").run(JSON.stringify(i18n));
      }
    });
    run();

    // openDbFile() opens under WAL — without a checkpoint the write lands
    // only in the gitignored -wal sidecar, leaving the COMMITTED dbPath file
    // itself byte-unchanged on disk (the standing WAL trap that has fired
    // repeatedly across this project). A full TRUNCATE checkpoint folds the
    // write back into the main file and clears the sidecar, so
    // `git status`/`git diff` on dbPath sees this change immediately.
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }
  return summary;
}

function main() {
  const target = process.argv[2] || DEMO_DB_PATH;
  const result = seedReportsI18n(target);
  console.log(
    `Seeded ${target}: ${result.keysAdded} i18n key-write(s) across ${result.languagesTouched} language(s) `
    + `(${Object.keys(NEW_LABELS).length} keys defined).`
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

module.exports = { seedReportsI18n, NEW_LABELS };
