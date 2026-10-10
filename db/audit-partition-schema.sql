-- D-12-04 (Phase 12, DATA-04): per-deal audit PARTITION schema.
--
-- One file per deal (data/audit/<dealId>.db, plus `legacy.db` once plan 12-13
-- moves the pre-partition rows). GITIGNORED and excluded from the admin
-- download-zip exactly like audit.db — a partition holds full before/after
-- snapshots of MNPI rows.
--
-- Same columns as db/audit-schema.sql plus the hash chain (db/auditChain.js):
--   legacy_id  the row's id in the pre-partition audit.db (NULL for new rows)
--   prev_hash  row_hash of the previous row (genesis for the first)
--   row_hash   sha256 of the canonical row incl. prev_hash
-- The hash columns are NOT NULL: a raw INSERT that skips the chain is refused
-- by the schema itself, so the verifier's `unchained-row` path is for audit.db
-- (nullable hash columns until plan 12-13), not for a partition.
--
-- Append-only by CONSTRUCTION (AUD-02), same two RAISE(ABORT) triggers as
-- audit.db. Filesystem-level edits (a hex editor, a replaced file) bypass
-- triggers; the hash chain is what makes THEM detectable
-- (scripts/audit-verify.js).
--
-- CREATE ... IF NOT EXISTS so re-opening a partition is idempotent.

CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,   -- ISO-8601
  actor_username  TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  session_id      TEXT,
  deal_id         TEXT,
  db_kind         TEXT NOT NULL,
  action          TEXT NOT NULL,   -- 'insert' | 'update' | 'delete' | 'partition-seal' (plan 12-12) ...
  collection      TEXT,
  row_id          TEXT,
  before_json     TEXT,
  after_json      TEXT,
  request_method  TEXT,
  request_path    TEXT,
  ip              TEXT,
  legacy_id       INTEGER,
  prev_hash       TEXT NOT NULL,
  row_hash        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log(actor_username);

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
