-- audit.db schema, version 1 (Phase 12, D-12-03 / D-12-04, plan 12-13).
--
-- audit.db is GITIGNORED and excluded from the admin download-zip (D-09) —
-- it lives physically outside every deals/<id>.db so the audit trail survives
-- deal deletion by construction, not by convention.
--
-- WHAT THIS FILE HOLDS FROM VERSION 1 ON: the CONTROL-PLANE log only — deal
-- lifecycle, membership and grant changes, user/credential events, read audits,
-- Phase 11 `access-denied` rows, CLI / break-glass-token events, and the
-- lifecycle records of the audit partitions themselves (seal, export, purge).
-- A deal's own data deltas live in its hash-chained partition
-- (data/audit/<dealId>.db, db/audit-partition-schema.sql); rows written before
-- the upgrade moved there (or into the sealed `legacy` partition) through
-- migration #1 of the audit family (db/migrations/audit/001-partition-legacy.js).
--
-- `audit_log` is an EXPLICIT-COLUMN table, deliberately NOT the blob-per-row
-- shape used elsewhere in this codebase, and deliberately NOT part of
-- db/collections.js's ARRAY_COLLECTIONS inventory (the same precedent
-- db/schema.sql already set for `sessions`): audit rows are appended once,
-- read via filtered admin queries (D-10: filter by deal/user/date range),
-- never read-modify-written as part of a whole-object readDb()/writeDb()
-- business flow.
--
-- Each row stores a FULL before/after JSON snapshot of the affected row
-- (D-11) where one applies. `deal_id` is nullable because control-plane
-- security events (user/role/password changes, session revocations,
-- break-glass X-Admin-Token use — D-08) are not scoped to any single deal.
--
-- TAMPER EVIDENCE (D-12-04, supersedes the "deferred to the shared-host
-- milestone" remark of the Phase 3 header / AUD-02): every row is HASH-CHAINED
-- (db/auditChain.js, genesis bound to the partition id `control`):
--   legacy_id  the row's id in a pre-partition file (NULL for rows born here)
--   prev_hash  row_hash of the previous HASHED row (genesis for the first)
--   row_hash   sha256 of the canonical row including prev_hash
-- The three columns are deliberately NULLABLE in audit.db (planner decision
-- PD-25): a raw INSERT that skips the chain — or a row appended by a previous
-- release after a rollback — must not make the file unusable. Integrity rests on
-- the CHAIN, never on a column constraint: scripts/audit-verify.js reports every
-- hashless row as `unchained-row` and exits 1, and the next chained append
-- links to the last row that HAS a hash (PD-30).
--
-- Append-only by CONSTRUCTION (AUD-02), not by convention: these two BEFORE
-- triggers RAISE(ABORT) on any attempted UPDATE or DELETE against this
-- table, so even a bug or a future careless call site cannot rewrite or
-- erase compliance history. This is intra-file only — no cross-database
-- ATTACH trigger is used anywhere in this codebase (a trigger firing across an
-- ATTACHed database is not guaranteed atomic with the attaching connection's
-- own transaction). Filesystem-level edits (a hex editor, a replaced file)
-- bypass triggers; the chain is what makes THEM detectable.
--
-- CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS so opening a fresh/existing
-- audit.db is idempotent. An EXISTING version-0 file never reaches this DDL
-- first: the migration runner (db/migrate.js) runs migration #1 before the
-- schema exec, and the migration carries its own frozen copy of this DDL.

CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,   -- ISO-8601
  actor_username  TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  session_id      TEXT,
  deal_id         TEXT,            -- NULL for control-plane events not scoped to a deal
  db_kind         TEXT NOT NULL,   -- 'control' | 'runtime' | 'demo' | 'deal'
  action          TEXT NOT NULL,   -- e.g. 'insert' | 'update' | 'delete' | 'admin-token-use'
  collection      TEXT,            -- affected table/collection name, if applicable
  row_id          TEXT,            -- affected row's id, if applicable
  before_json     TEXT,            -- full JSON snapshot before the write (NULL on create)
  after_json      TEXT,            -- full JSON snapshot after the write (NULL on delete)
  request_method  TEXT,
  request_path    TEXT,
  ip              TEXT,
  legacy_id       INTEGER,         -- v1: original id in a pre-partition file (NULL for new rows)
  prev_hash       TEXT,            -- v1: hash chain (nullable here, NOT NULL in partitions — PD-25)
  row_hash        TEXT             -- v1: sha256 of the canonical row incl. prev_hash
);
CREATE INDEX IF NOT EXISTS idx_audit_deal   ON audit_log(deal_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor_username);
CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_log(ts);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log rows are append-only: UPDATE is not permitted (AUD-02)');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log rows are append-only: DELETE is not permitted (AUD-02)');
END;
