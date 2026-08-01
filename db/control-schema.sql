-- Phase 3 (Deal Isolation, Audit Log & Write Validation): control.db schema.
--
-- control.db is COMMITTED to git (D-07) — it holds the app-managed user
-- accounts and the deal registry skeleton, kept deliberately near-static so
-- the zero-install bundle keeps booting with pre-seeded demo accounts. This
-- file must NEVER accumulate churning rows (sessions, per-request audit
-- entries, anything that mutates on every login) — those live in the
-- gitignored runtime.db and audit.db instead (see runtime-schema.sql,
-- audit-schema.sql). Adding a table here that writes on every request would
-- silently reopen the same git-diff-churn problem D-07 exists to close.
--
-- `users` is copied verbatim from db/schema.sql's blob-per-row shape (id/
-- project_id/seq/data) — no field-level change, just relocated to its own
-- file per this phase's control/runtime/deal split.
--
-- `deals` is the new deal registry (ISO-01). Per 03-RESEARCH.md Open
-- Question 1 there is no in-repo precedent for a normalized membership join
-- table, so the per-deal member allowlist (D-03) lives inside the JSON
-- `data` blob as `members: []`, alongside `name`, `targetCompany`, `status`,
-- `createdBy`, `createdAt` — NOT as separate typed columns. `status` is
-- additionally extracted as an indexed metadata column (same rationale as
-- `project_id` elsewhere in this codebase: it is filtered/looked-up far more
-- often than it is written) so admin/IL deal-list views can filter without
-- deserializing every row's JSON blob.
--
-- CREATE TABLE/INDEX IF NOT EXISTS so opening a fresh control.db (or
-- re-opening an existing one) is idempotent.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_project ON users(project_id);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  status TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);

-- Shared singleton-key table (mirrors db/schema.sql's app_state). control.db
-- stores exactly one singleton key here, `controlSettings`, holding
-- deployment-level configuration — never secrets (those live in runtime.db's
-- app_state, see runtime-schema.sql header).
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
