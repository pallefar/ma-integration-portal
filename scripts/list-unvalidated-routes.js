#!/usr/bin/env node
// VAL-01: a reporter (NOT a test — the suite must stay green at every commit
// boundary) that prints every registered write route still missing a zod
// schema in validators/index.js's WRITE_SCHEMAS registry, and exits
// non-zero while the list is non-empty. This is Task 1's worklist: run it,
// author a schema for each printed route, re-run, repeat until it exits 0.
// Once it prints nothing, Task 2 promotes the SAME
// findUnvalidatedWriteRoutes() check into test/write-validation-coverage.test.js
// so the coverage gate becomes a permanent part of the suite — this script
// and that test share ONE implementation of the check (validators/index.js),
// never two copies.
//
// Usage: node scripts/list-unvalidated-routes.js
'use strict';

// Booting the real app has side effects the reporter doesn't need (opening
// the committed control/demo databases) — acceptable for a one-shot local
// dev tool, matching the require('../server.js') pattern every test file in
// this repo already uses. DEMO_OPEN is left unset; ADMIN_TOKEN is left unset
// — neither affects which routes are REGISTERED (app._router.stack is built
// at module load time regardless of runtime auth config).
const app = require('../server.js');
const { findUnvalidatedWriteRoutes } = require('../validators/index');

const unvalidated = findUnvalidatedWriteRoutes(app);

if (unvalidated.length === 0) {
  console.log('Every registered write route has a schema in WRITE_SCHEMAS.');
  process.exit(0);
}

console.log(`${unvalidated.length} write route(s) still have no registered schema:\n`);
unvalidated.forEach(({ method, path }) => console.log(`  ${method} ${path}`));
console.log('\nAuthor a schema for each route above and register it via registerSchema() in the appropriate validators/*.js module.');
process.exit(1);
