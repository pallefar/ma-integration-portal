// VAL-01: the permanent coverage gate — every registered write route in the
// live app resolves to a schema in validators/index.js's WRITE_SCHEMAS
// registry, asserted against the LIVE route inventory (app._router.stack),
// not a hand-maintained list. A write route added in a future phase without
// a registered schema turns this test red. Shares ONE implementation of the
// check (validators/index.js#findUnvalidatedWriteRoutes) with
// scripts/list-unvalidated-routes.js — the reporter that was this test's own
// worklist while validators/*.js were being authored.
//
// node:test — run via `node --test test/write-validation-coverage.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// [security] D-12-06 / R5-04: isolate every database file BEFORE requiring the
// app — requiring server.js opens the control/runtime/demo/audit files, and an
// un-overridden default would resolve to the developer's real <repo>/data.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-write-validation-coverage-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const app = require('../server.js');

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});
const { findUnvalidatedWriteRoutes } = require('../validators/index.js');

test('write-validation-coverage (VAL-01): every registered write route resolves to a schema', () => {
  const unvalidated = findUnvalidatedWriteRoutes(app);
  assert.deepStrictEqual(
    unvalidated,
    [],
    `The following write route(s) have no registered schema:\n${unvalidated.map((r) => `  ${r.method} ${r.path}`).join('\n')}`,
  );
});
