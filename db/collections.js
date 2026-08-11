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

// The 38 array-shaped top-level collections. Each gets its own SQLite table
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
  // Phase 4 (Due Diligence Workspace): the clean-room-guarded DD collections.
  // Every read/write against these three goes through db/accessPolicy.js's
  // filterByAreaGrant()/assertAreaGrant() — see server.js's /api/dd section.
  'ddFindings',
  'ddRequestItems',
  'ddRequestTemplates',
  'departments',
  'employees',
  'hrbps',
  'integrationTasks',
  'media',
  'modules',
  // Phase 6 (Org Design & Talent Retention, ORG-01/ORG-02/ORG-03): deal-DB-
  // native collections for the org structure (positions, current/target
  // state), the position-decision log and the flight-risk register. Same
  // pattern as the Phase-4 DD block above — guarded at the application
  // layer by db/accessPolicy.js's hasAreaGrant()/grantedAreas() 'hr' area
  // gate, never by a schema constraint.
  'orgDecisions',
  'orgFlightRisks',
  'orgPositions',
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

if (ARRAY_COLLECTIONS.length !== 38) {
  throw new Error(`db/collections.js: expected 38 array collections, got ${ARRAY_COLLECTIONS.length}`);
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

// CONC-02 (Phase 9, D-06/PD-1): the collection-level gating set for
// optimistic-locking version enforcement inside db/store.js's writeDb() —
// the direct analog of db/auditHook.js's AUDITED_DB_KINDS (a kind-level
// set; this is collection-level, since the scope boundary here is
// per-collection, not per-database-kind). Both lanes of every demo/custom
// split collection are listed explicitly — omitting a `custom*` lane would
// leave every real-deal (non-demo) write on that feature unprotected while
// demo-mode tests still pass (09-RESEARCH.md Pitfall 7).
//
// [security] `orgDecisions` is deliberately ABSENT: `POST /api/org/decisions`
// is append-only with no update or delete route anywhere in server.js
// (09-RESEARCH.md Pitfall 8) — there is no mutable write path for a version
// check to ever run against, so listing it here would be dead code with
// nothing to protect. CMS/settings singletons and whole-document admin
// blobs (pages, menus, courses, settings) are out of scope per D-06 — they
// are admin-edited documents, not co-edited records, and are never
// ARRAY_COLLECTIONS members subject to this per-row check in the first
// place.
const VERSIONED_COLLECTIONS = new Set([
  'raidEntries', 'customRaidEntries',
  'integrationTasks', 'customIntegrationTasks',
  'synergyInitiatives', 'customSynergyInitiatives',
  'ddFindings', 'ddRequestItems',
  'orgPositions', 'orgFlightRisks',
]);

if (VERSIONED_COLLECTIONS.size !== 10) {
  throw new Error(`db/collections.js: expected 10 versioned collections, got ${VERSIONED_COLLECTIONS.size}`);
}
for (const key of VERSIONED_COLLECTIONS) {
  if (!ARRAY_COLLECTIONS.includes(key)) {
    throw new Error(`db/collections.js: VERSIONED_COLLECTIONS entry '${key}' is not a real ARRAY_COLLECTIONS table`);
  }
}

// [security] CR-01 (09-REVIEW): collections whose records carry PER-RECORD
// area clearance (db/accessPolicy.js hasAreaGrant) — a conflict 409 for
// these may only echo the stored record after the caller's clearance filter
// has passed it. db/store.js fails closed for these: when no per-request
// filter is armed, the WHERE-layer conflict throw withholds currentRecord
// entirely rather than echoing an unfiltered record across a clean-room
// boundary.
const CLEARANCE_SCOPED_COLLECTIONS = new Set(['ddFindings', 'ddRequestItems']);
for (const key of CLEARANCE_SCOPED_COLLECTIONS) {
  if (!VERSIONED_COLLECTIONS.has(key)) {
    throw new Error(`db/collections.js: CLEARANCE_SCOPED_COLLECTIONS entry '${key}' must be a VERSIONED_COLLECTIONS member`);
  }
}

// ISO-01 / D-07: the two credential-bearing settings field PATHS (dotted,
// for nested lookup) lifted out of the demo `settings` singleton into
// runtime.db's gitignored `secretSettings` app_state row when the store is
// split — never left in, or copied into, the COMMITTED control.db or
// demo.db. Mirrors server.js's existing publicSettings() strip-list, which
// already keeps these two fields out of every API response.
const SECRET_SETTINGS_FIELDS = ['geminiApiKey', 'databaseConfig.connectionDetails'];

module.exports = { ARRAY_COLLECTIONS, SINGLETON_KEYS, COLLECTION_TARGETS, SECRET_SETTINGS_FIELDS, VERSIONED_COLLECTIONS, CLEARANCE_SCOPED_COLLECTIONS };
