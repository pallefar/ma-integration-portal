// D-12-03 (Phase 12): baseline migration of the runtime family — data/runtime.db (sessions, runtime app_state, login throttling).
//
// STAMP-ONLY: the schema in db/runtime-schema.sql already creates every table with
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
    'sessions',
    'app_state',
    'account_logins',
  ],
  up() { /* stamp-only */ },
};
