-- Phase 3 (Deal Isolation, Audit Log & Write Validation): runtime.db schema.
--
-- runtime.db is GITIGNORED (D-07) — unlike control.db, it holds rows that
-- churn on every single login (sessions) and every settings save that
-- touches a secret. Committing this file would mean either a leaked live
-- session (replayable without a password, per the existing token_hash
-- discipline this table already relies on) or a churn-diff on every commit;
-- both are exactly what D-07's control/runtime split exists to prevent.
--
-- `sessions` is copied verbatim from db/schema.sql (Phase 2, AUTH-03, D-06)
-- PLUS one new nullable column, `deal_id`, which is this phase's server-side
-- deal binding (D-01): a logged-in user selects a deal and that selection is
-- stored on their OWN sessions-table row, never as a global "active deal".
-- `deal_id IS NULL` means the session has not bound to a deal and resolves
-- to the demo database (`db/dbFiles.js` DEMO_DB_PATH) — this is the
-- resolver's contract to implement in Plan 03, not enforced by this schema
-- file itself. Both pre-existing indexes are kept unchanged.
--
-- `app_state` (shared shape, mirrors db/schema.sql/control-schema.sql)
-- stores exactly one singleton key here, `secretSettings`, holding the two
-- credential-bearing settings fields server.js's publicSettings() already
-- strips from every API response before it reaches a client:
-- `geminiApiKey` and `databaseConfig.connectionDetails`. Placing secrets in
-- the gitignored runtime.db rather than the COMMITTED control.db is a
-- planner decision made under 03-CONTEXT.md's "exact control-DB vs
-- runtime-DB table split" discretion item — the reasoning is that a secret
-- committed into control.db (even once, even accidentally amended over) can
-- never be un-leaked from git history, whereas a secret in a gitignored file
-- was simply never at risk.
--
-- CREATE TABLE/INDEX IF NOT EXISTS so opening a fresh/existing runtime.db is
-- idempotent.

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,   -- sha256(raw opaque token), hex
  username    TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  TEXT NOT NULL,      -- ISO-8601
  expires_at  TEXT NOT NULL,      -- ISO-8601, created_at + 12h, ABSOLUTE (no sliding/refresh)
  user_agent  TEXT,
  ip          TEXT,
  deal_id     TEXT                -- NULL = unbound / resolves to demo.db (D-01)
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- D-10-03 (Phase 10): last successful sign-in per account, shown in the admin
-- Users tab. Lives HERE — runtime.db is gitignored churn that changes on every
-- login — and never in the committed control.db (a last-login stamp written
-- into control.db would dirty a git-tracked file on every sign-in).
CREATE TABLE IF NOT EXISTS account_logins (
  username      TEXT PRIMARY KEY,
  last_login_at TEXT NOT NULL,    -- ISO-8601
  last_login_ip TEXT
);
