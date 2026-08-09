// RPT-01..04 (07-07): proves every translation key the reports/exports
// interface and the steerco pack renderer introduced resolves to a
// non-empty, non-raw-key value in all four shipped languages — the failure
// this test exists to catch is the exact one a green feature-test suite
// cannot see: a screen or a pack showing "rpt.pack_col_owner" instead of
// "Owner" because a key was declared in the interface but never seeded.
//
// The key list is derived FROM SOURCE, not from scripts/seed-reports-i18n.js's
// own NEW_LABELS object — a source-derived list is what catches the seed
// script itself missing a key the interface actually uses, which trusting
// the seed script's own list could never catch.
//
// Run: node --test test/reports-i18n.test.js (or via npm test / node
// scripts/seed-reports-i18n.js first, as this plan's own <verify> does).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { DEMO_DB_PATH } = require('../db/dbFiles');

const EXECUTION_HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'execution.html'), 'utf8');
const REPORT_PACK_SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'reportPack.js'), 'utf8');

const SUPPORTED_LANGUAGES = ['en', 'de', 'zh', 'cs'];

// --- Derive the key list from source -----------------------------------

function extractKeys(source, regex) {
  const found = new Set();
  let m;
  while ((m = regex.exec(source))) found.add(m[1]);
  return found;
}

// The reports pane's own data-i18n attributes, plus the Reports & Exports
// tab label (data-i18n="exec.tab_reports") that opens that pane.
const domKeys = extractKeys(
  EXECUTION_HTML,
  /data-i18n="(rpt\.[a-zA-Z_]+|exec\.tab_reports)"/g
);

// Every key the pack renderer resolves: direct t('rpt.xxx', ...) calls,
// plus column-header key/fallback pairs threaded through
// resolveColumnHeaders() as `header: ['rpt.xxx', 'Fallback']`.
const packDirectKeys = extractKeys(REPORT_PACK_SRC, /t\(\s*['"](rpt\.[a-zA-Z_]+)['"]/g);
const packHeaderKeys = extractKeys(REPORT_PACK_SRC, /header:\s*\[\s*['"](rpt\.[a-zA-Z_]+)['"]/g);

// rpt.pack_col_bar's header text is an intentionally empty string (the
// synergies table's bar-chart column draws a graphic, not a labelled
// value) — scripts/seed-reports-i18n.js deliberately does not seed it, and
// this test allows it to resolve empty rather than requiring non-empty.
const INTENTIONALLY_EMPTY_KEYS = new Set(['rpt.pack_col_bar']);

// The Plan 07-04 gap this plan closes alongside the reports namespace: the
// Synergy tab's "Unphased" rollup tile, named explicitly in 07-07-PLAN.md's
// Task 1 action text. Not derivable from the reports pane or the pack
// renderer's own source, so it is named explicitly here.
const EXPLICIT_EXTRA_KEYS = new Set(['syn.rollup_unphased']);

const allKeys = new Set([
  ...domKeys,
  ...packDirectKeys,
  ...packHeaderKeys,
  ...EXPLICIT_EXTRA_KEYS,
]);

// --- Load the seeded i18n store -----------------------------------------

let i18n;
test.before(() => {
  const Database = require('better-sqlite3');
  const conn = new Database(DEMO_DB_PATH, { readonly: true });
  try {
    const row = conn.prepare("SELECT data FROM app_state WHERE key = 'i18n'").get();
    assert.ok(row, 'data/demo.db must carry an i18n row in app_state');
    i18n = JSON.parse(row.data);
  } finally {
    conn.close();
  }
});

/**
 * Mirrors BOTH resolution paths this app actually uses on screen/in the
 * pack — public/js/transitions.js's applyPortalI18n() (`s[lang][key] ||
 * s.en[key] || null`, element left untouched if null) and
 * lib/reportPack.js's resolveLanguage() (`s[lang][key] || s.en[key] ||
 * englishFallback || key`) — collapsed to one check: does SOME
 * language-agnostic value exist for this key that is not the bare key name?
 */
function resolve(key, lang) {
  const strings = (i18n.strings && i18n.strings[lang]) || {};
  const en = (i18n.strings && i18n.strings.en) || {};
  return strings[key] || en[key] || null;
}

test('reports-i18n: source-derived key list is non-empty (regression guard on the extraction regexes themselves)', () => {
  assert.ok(domKeys.size >= 10, `expected at least 10 rpt./exec.tab_reports data-i18n keys in execution.html, found ${domKeys.size}`);
  assert.ok(packDirectKeys.size + packHeaderKeys.size >= 15, `expected at least 15 rpt. keys resolved by lib/reportPack.js, found ${packDirectKeys.size + packHeaderKeys.size}`);
});

test('reports-i18n: every key resolves to a non-empty value in all four shipped languages', () => {
  const failures = [];
  for (const key of allKeys) {
    for (const lang of SUPPORTED_LANGUAGES) {
      const value = resolve(key, lang);
      if (INTENTIONALLY_EMPTY_KEYS.has(key)) continue; // no value expected/required
      if (!value) failures.push(`${key} [${lang}]: resolved to ${JSON.stringify(value)}`);
    }
  }
  assert.deepStrictEqual(failures, [], `keys failing to resolve to a non-empty value:\n${failures.join('\n')}`);
});

test('reports-i18n: no key in the reports namespace resolves to its own key name', () => {
  const failures = [];
  for (const key of allKeys) {
    if (INTENTIONALLY_EMPTY_KEYS.has(key)) continue;
    for (const lang of SUPPORTED_LANGUAGES) {
      const value = resolve(key, lang);
      if (value === key) failures.push(`${key} [${lang}] resolved to its own key name — this is what a missing entry surfaces as on screen`);
    }
  }
  assert.deepStrictEqual(failures, []);
});

test('reports-i18n: scripts/seed-reports-i18n.js\'s own key list is a superset of every source-derived key', () => {
  const { NEW_LABELS } = require('../scripts/seed-reports-i18n.js');
  const seededKeys = new Set(Object.keys(NEW_LABELS));
  const missing = [...allKeys].filter((k) => !seededKeys.has(k) && !INTENTIONALLY_EMPTY_KEYS.has(k));
  assert.deepStrictEqual(missing, [], `keys used by the interface/pack but never declared in the seed script: ${missing.join(', ')}`);
});
