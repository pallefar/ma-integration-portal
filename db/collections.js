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
  'users',
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

if (ARRAY_COLLECTIONS.length !== 33) {
  throw new Error(`db/collections.js: expected 33 array collections, got ${ARRAY_COLLECTIONS.length}`);
}
if (SINGLETON_KEYS.length !== 5) {
  throw new Error(`db/collections.js: expected 5 singleton keys, got ${SINGLETON_KEYS.length}`);
}

module.exports = { ARRAY_COLLECTIONS, SINGLETON_KEYS };
