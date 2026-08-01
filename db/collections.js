// Single source of truth for the db.json -> SQLite collection inventory.
//
// This is the grep-verified 38-key top-level inventory of db.json (see
// .planning/phases/01-schema-migration/01-RESEARCH.md "Pattern 3"). It is
// NOT the same list as server.js's legacy readDb() defaulting block, which
// is missing 5 of these 38 keys (communications, customAlerts,
// customAssessments, customCommunications, customHrbps) because those
// collections were only ever guarded ad hoc with `|| []` at scattered call
// sites, never added to the central defaulting block.
//
// db/schema.sql, db/store.js, and scripts/migrate-db-json-to-sqlite.js all
// import this file — do NOT duplicate the inventory anywhere else.

// The 33 array-shaped top-level collections. Each gets its own SQLite table
// (see db/schema.sql): one JSON-blob-per-row, id/project_id extracted as
// metadata columns for indexing, `data` column holding the untouched item.
const ARRAY_COLLECTIONS = [
  'alerts',
  'assessmentInstances',
  'assessmentTemplates',
  'assessments',
  'banners',
  'checklistTemplates',
  'communications',
  'courses',
  'customAlerts',
  'customAssessmentInstances',
  'customAssessments',
  'customCommunications',
  'customEmployees',
  'customHrbps',
  'customIntegrationTasks',
  'customRaidEntries',
  'customSynergyInitiatives',
  'departments',
  'employees',
  'hrbps',
  'integrationTasks',
  'media',
  'modules',
  'pages',
  'processCatalog',
  'projects',
  'pulses',
  'questions',
  'ragUploads',
  'raidEntries',
  'slides',
  'synergyInitiatives',
];

// The 5 singleton (non-array) top-level keys. Each is stored as one row in
// the shared app_state table (key/data columns).
const SINGLETON_KEYS = [
  'settings',
  'customSettings',
  'i18n',
  'menus',
  'activeProjectId',
];

if (ARRAY_COLLECTIONS.length !== 32) {
  throw new Error(`db/collections.js: expected 32 array collections, got ${ARRAY_COLLECTIONS.length}`);
}
if (SINGLETON_KEYS.length !== 5) {
  throw new Error(`db/collections.js: expected 5 singleton keys, got ${SINGLETON_KEYS.length}`);
}

// ISO-01 / D-05: single source of truth for which physical database file
// (control.db | demo.db | runtime.db) owns each collection/singleton once
// db.json's single blob-per-row store is physically split
// (scripts/split-db-into-control-demo-deals.js, Phase 3 Plan 02). Every
// array collection routes to demo.db, INCLUDING all nine `custom*`
// shadow-lane collections (D-05: they were always showcase data, so a new
// real deal starts with zero demo-derived rows by construction, not by
// filtering) — and all five singleton keys route to demo.db too. No
// collection routes directly to 'control' or 'runtime' here: accounts and
// the deal registry (formerly `users`, the ONE array collection that used to
// route to control.db) moved OUT of this generic split entirely as of Phase
// 3 Task 2 — they are control.db-native tables reached only through
// db/controlStore.js, never through readDb()/writeDb() or this routing map
// (a deal-bound request must never be able to reach them through its own
// connection, T-03-16). runtime.db instead receives two individual FIELD
// PATHS lifted out of the demo `settings` singleton (see
// SECRET_SETTINGS_FIELDS below), never a whole collection.
//
// The completeness assertion below (same style as the two above) guarantees
// a collection added in a later phase cannot silently go unclassified —
// ARRAY_COLLECTIONS/SINGLETON_KEYS grow, this map MUST grow with them or the
// module fails to load.
const COLLECTION_TARGETS = {};
for (const key of ARRAY_COLLECTIONS) {
  COLLECTION_TARGETS[key] = 'demo';
}
for (const key of SINGLETON_KEYS) {
  COLLECTION_TARGETS[key] = 'demo';
}

const VALID_SPLIT_TARGETS = new Set(['control', 'demo', 'runtime']);
const unclassified = [...ARRAY_COLLECTIONS, ...SINGLETON_KEYS].filter(
  (key) => !VALID_SPLIT_TARGETS.has(COLLECTION_TARGETS[key])
);
if (unclassified.length) {
  throw new Error(`db/collections.js: COLLECTION_TARGETS is missing/invalid for: ${unclassified.join(', ')}`);
}

// ISO-01 / D-07: the two credential-bearing settings field PATHS (dotted,
// for nested lookup) lifted out of the demo `settings` singleton into
// runtime.db's gitignored `secretSettings` app_state row when the store is
// split — never left in, or copied into, the COMMITTED control.db or
// demo.db. Mirrors server.js's existing publicSettings() strip-list, which
// already keeps these two fields out of every API response.
const SECRET_SETTINGS_FIELDS = ['geminiApiKey', 'databaseConfig.connectionDetails'];

module.exports = { ARRAY_COLLECTIONS, SINGLETON_KEYS, COLLECTION_TARGETS, SECRET_SETTINGS_FIELDS };
