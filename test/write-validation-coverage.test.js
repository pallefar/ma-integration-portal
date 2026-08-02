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

const app = require('../server.js');
const { findUnvalidatedWriteRoutes } = require('../validators/index.js');

test('write-validation-coverage (VAL-01): every registered write route resolves to a schema', () => {
  const unvalidated = findUnvalidatedWriteRoutes(app);
  assert.deepStrictEqual(
    unvalidated,
    [],
    `The following write route(s) have no registered schema:\n${unvalidated.map((r) => `  ${r.method} ${r.path}`).join('\n')}`,
  );
});
