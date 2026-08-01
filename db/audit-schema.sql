-- Phase 3 (Deal Isolation, Audit Log & Write Validation): audit.db schema.
--
-- audit.db is GITIGNORED and excluded from the admin download-zip (D-09) —
-- it lives physically outside every deals/<id>.db so AUD-02 ("the audit
-- trail survives deal deletion") holds by construction, not by convention.
--
-- `audit_log` is an EXPLICIT-COLUMN table, deliberately NOT the blob-per-row
-- shape used elsewhere in this codebase, and deliberately NOT part of
-- db/collections.js's ARRAY_COLLECTIONS inventory (the same precedent
-- db/schema.sql already set for `sessions`): audit rows are appended once,
-- read via filtered admin queries (D-10: filter by deal/user/date range),
-- never read-modify-written as part of a whole-object readDb()/writeDb()
-- business flow, so routing them through the snapshot-diff merge would be
-- wasteful and would pollute __snapshot bookkeeping for no reason.
--
-- Each row stores a FULL before/after JSON snapshot of the affected row
-- (D-11) — self-contained compliance reconstruction without needing to
-- replay a diff chain. `deal_id` is nullable because control-plane security
-- events (user/role/password changes, session revocations, break-glass
-- X-Admin-Token use — D-08) are not scoped to any single deal.
--
-- Append-only by CONSTRUCTION (AUD-02), not by convention: these two BEFORE
-- triggers RAISE(ABORT) on any attempted UPDATE or DELETE against this
-- table, so even a bug or a future careless call site cannot rewrite or
-- erase compliance history. This is intra-file only — no cross-database
-- ATTACH trigger is used anywhere in this codebase (03-RESEARCH.md's
-- verified WAL/ATTACH atomicity finding is why: a trigger firing across an
-- ATTACHed database is not guaranteed atomic with the attaching connection's
-- own transaction, so audit.db is always written to directly, in-process,
-- via its own connection — never via a trigger reaching INTO it from another
-- database file). Filesystem-level tampering (someone editing the .db file
-- directly with a hex editor) is out of scope this phase — hash-chaining
-- tamper-evidence is deferred to the shared-host milestone (v2) per
-- 03-CONTEXT.md's Deferred Ideas.
--
-- CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS so opening a fresh/existing
-- audit.db is idempotent.

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
  ip              TEXT
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
