// 12-REVIEW IN-01 (Phase 12): the readiness snapshot is served UNAUTHENTICATED
// by /healthz, so it must carry fixed tokens only — no per-family file count
// (= the number of deals on the host) and no per-file repetition of an exposed
// failure (which would count failing deal files just the same).
//
// Pure unit test of db/readiness.js — no database is opened.
// node:test — run via `node --test test/readiness-snapshot.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');

const readiness = require('../db/readiness.js');

test('IN-01: snapshot() carries no file counts and collapses identical exposed failures', () => {
  readiness._resetForTests();
  try {
    const dir = path.join(os.tmpdir(), 'gsd-readiness-snapshot-never-created');
    for (let i = 0; i < 7; i += 1) {
      readiness.recordVersion({ family: 'deal', file: path.join(dir, `deal_x${i}.db`), version: 1 });
      readiness.recordVersion({ family: 'audit-partition', file: path.join(dir, 'audit', `deal_x${i}.db`), version: 1 });
    }
    readiness.recordVersion({ family: 'control', file: path.join(dir, 'control.db'), version: 1, implied: true });
    for (let i = 0; i < 3; i += 1) {
      readiness.markNotReady({ family: 'deal', file: path.join(dir, `deal_bad${i}.db`), reason: readiness.REASONS.INTEGRITY_FAILED });
    }
    const snap = readiness.snapshot();
    assert.deepStrictEqual(snap.versions, {
      deal: { version: 1 },
      'audit-partition': { version: 1 },
      control: { version: 1, implied: true },
    });
    assert.deepStrictEqual(snap.failures, [{ family: 'deal', file: 'deal', reason: 'integrity-check-failed' }]);
    assert.strictEqual(snap.ready, false);
    const wire = JSON.stringify(snap);
    assert.ok(!/files/.test(wire), 'no file count on the wire');
    assert.ok(!wire.includes('deal_x') && !wire.includes('deal_bad') && !wire.includes(dir), 'no id or path on the wire');
  } finally {
    readiness._resetForTests();
  }
});
