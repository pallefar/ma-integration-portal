// D-12-04 (Phase 12): baseline migration of the audit-partition family —
// data/audit/<dealId>.db and data/audit/legacy.db (one schema,
// db/audit-partition-schema.sql).
//
// STAMP-ONLY: the schema creates the table with CREATE TABLE IF NOT EXISTS and
// every partition that exists was produced by exactly that DDL, so version 1
// means "the audit-partition schema as of Phase 12". NEVER edit this file once
// released — add a new NNN-<slug>.js (see db/migrate.js).

module.exports = {
  id: 1,
  slug: 'baseline',
  requiredTables: ['audit_log'],
  up() { /* stamp-only */ },
};
