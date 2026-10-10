// D-12-03 (Phase 12): baseline migration of the deal family — data/demo.db and every data/deals/<id>.db (one schema, D-06).
//
// STAMP-ONLY: the schema in db/schema.sql already creates every table with
// CREATE TABLE IF NOT EXISTS, and every file that exists today was produced by
// exactly that DDL, so version 1 means "the schema as of Phase 12" and moving a
// version-0 file to 1 changes no table. Older releases ignore user_version, so
// stamping stays backward compatible. NEVER edit this file once released — add
// a new NNN-<slug>.js (see db/migrate.js).
//
// requiredTables: what a committed file must hold for the runner to REPORT it
// as version 1 without writing (PD-5).

module.exports = {
  id: 1,
  slug: 'baseline',
  requiredTables: [
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
    'ddFindings',
    'ddRequestItems',
    'ddRequestTemplates',
    'departments',
    'employees',
    'hrbps',
    'integrationTasks',
    'media',
    'modules',
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
    'app_state',
    'sessions',
  ],
  up() { /* stamp-only */ },
};
