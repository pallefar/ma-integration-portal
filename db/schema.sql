-- SQLite schema for the db.json -> SQLite migration (Phase 1: Schema & Migration).
-- One JSON-blob-per-row table per array collection (db/collections.js ARRAY_COLLECTIONS,
-- the single source of truth for this list) plus one shared app_state table for the 5
-- singleton keys (settings, customSettings, i18n, menus, activeProjectId).
--
-- Table shape (D-08): id/project_id extracted as metadata columns; the item itself is
-- stored untouched as a JSON string in `data`. seq preserves the item's original array
-- index so reconstruction (ORDER BY seq) round-trips exactly, including array order.
-- Do NOT normalize individual fields into typed columns and do NOT add an audit_log table
-- here — both are explicitly out of scope for this phase (Phase 3/4-5 concerns).
--
-- CREATE TABLE IF NOT EXISTS so opening a fresh/empty database yields empty collections,
-- mirroring today's missing-db.json skeleton behaviour.

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project_id);

CREATE TABLE IF NOT EXISTS assessmentInstances (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessmentInstances_project ON assessmentInstances(project_id);

CREATE TABLE IF NOT EXISTS assessmentTemplates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessmentTemplates_project ON assessmentTemplates(project_id);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessments_project ON assessments(project_id);

CREATE TABLE IF NOT EXISTS banners (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_banners_project ON banners(project_id);

CREATE TABLE IF NOT EXISTS checklistTemplates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklistTemplates_project ON checklistTemplates(project_id);

CREATE TABLE IF NOT EXISTS communications (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_communications_project ON communications(project_id);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_project ON courses(project_id);

CREATE TABLE IF NOT EXISTS customAlerts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customAlerts_project ON customAlerts(project_id);

CREATE TABLE IF NOT EXISTS customAssessmentInstances (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customAssessmentInstances_project ON customAssessmentInstances(project_id);

CREATE TABLE IF NOT EXISTS customAssessments (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customAssessments_project ON customAssessments(project_id);

CREATE TABLE IF NOT EXISTS customCommunications (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customCommunications_project ON customCommunications(project_id);

CREATE TABLE IF NOT EXISTS customEmployees (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customEmployees_project ON customEmployees(project_id);

CREATE TABLE IF NOT EXISTS customHrbps (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customHrbps_project ON customHrbps(project_id);

CREATE TABLE IF NOT EXISTS customIntegrationTasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customIntegrationTasks_project ON customIntegrationTasks(project_id);

CREATE TABLE IF NOT EXISTS customRaidEntries (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customRaidEntries_project ON customRaidEntries(project_id);

CREATE TABLE IF NOT EXISTS customSynergyInitiatives (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customSynergyInitiatives_project ON customSynergyInitiatives(project_id);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_departments_project ON departments(project_id);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employees_project ON employees(project_id);

CREATE TABLE IF NOT EXISTS hrbps (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hrbps_project ON hrbps(project_id);

CREATE TABLE IF NOT EXISTS integrationTasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integrationTasks_project ON integrationTasks(project_id);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_project ON media(project_id);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_modules_project ON modules(project_id);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pages_project ON pages(project_id);

CREATE TABLE IF NOT EXISTS processCatalog (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_processCatalog_project ON processCatalog(project_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_project ON projects(project_id);

CREATE TABLE IF NOT EXISTS pulses (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pulses_project ON pulses(project_id);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_project ON questions(project_id);

CREATE TABLE IF NOT EXISTS ragUploads (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ragUploads_project ON ragUploads(project_id);

CREATE TABLE IF NOT EXISTS raidEntries (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raidEntries_project ON raidEntries(project_id);

CREATE TABLE IF NOT EXISTS slides (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slides_project ON slides(project_id);

CREATE TABLE IF NOT EXISTS synergyInitiatives (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_synergyInitiatives_project ON synergyInitiatives(project_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_project ON users(project_id);

-- Shared table for the 5 non-array top-level keys.
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
