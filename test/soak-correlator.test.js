// Soak-harness correlator guard (Phase 11 verifier gap G-1).
//
// Phase 11 IN-02 (commit feed9c9, D-11-06): in a real deal POST /api/pulses
// files a pulse under the SESSION ACCOUNT's display name and ignores the body's
// `employeeName`. scripts/soak.js used to carry its per-write correlator in
// `employeeName`, so after IN-02 every acknowledged write "mismatched" and the
// committed-but-unaudited detector (the Phase 8 CR-01 proof) went blind. The
// harness now carries the correlator in `comment` (preserved verbatim by the
// server for every role) and asserts `employeeName` against the worker account
// name.
//
// Two layers:
//   1. a static guard on scripts/soak.js, so the correlator can never silently
//      slide back into a field the server overwrites;
//   2. a real, short, isolated run of the harness (2 processes, ~6 s) asserting
//      exit 0 - the only thing that proves the whole chain (server stamping,
//      harness identification, D-15 checks) still agrees.
//
// node:test - run via `node --test test/soak-correlator.test.js` (or `npm test`).

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SOAK_PATH = path.join(__dirname, '..', 'scripts', 'soak.js');

// Code only: drop whole-line // comments so prose that mentions
// `employeeName` cannot satisfy (or trip) a code-shape assertion.
function soakCode() {
  return fs.readFileSync(SOAK_PATH, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

test('soak harness: the write payload carries the correlator in comment, not employeeName', () => {
  const code = soakCode();
  const m = code.match(/const payload = \{[\s\S]*?\n\s*\};/);
  assert.ok(m, 'doWrite() payload literal not found in scripts/soak.js');
  const payload = m[0];
  assert.match(payload, /comment:\s*correlatorComment\(correlator\)/,
    'the per-write correlator must travel in `comment` (the server preserves it verbatim)');
  assert.match(payload, /employeeName:\s*workerAccountName\(workerIndex\)/,
    'employeeName must be the worker ACCOUNT display name (what the server stamps)');
  assert.doesNotMatch(payload, /employeeName:\s*correlator/,
    'the correlator must NOT ride in employeeName (IN-02: the server overwrites it)');
});

test('soak harness: exactness compares employeeName with the account name and comment with the correlator', () => {
  const code = soakCode();
  assert.match(code, /row\.employeeName\s*===\s*workerAccountName\(w\.workerIndex\)/,
    'exactness must assert employeeName against the worker account display name');
  assert.match(code, /row\.comment\s*===\s*w\.payload\.comment/,
    'exactness must still compare the correlator-bearing comment exactly');
  assert.doesNotMatch(code, /row\.employeeName\s*===\s*w\.payload\.employeeName/,
    'employeeName must not be compared against the request body value');
  // The worker account is created with that same display name.
  assert.match(code, /name:\s*workerAccountName\(i\)/,
    'createWorkerSessions() must create the account with workerAccountName(i)');
});

test('soak harness: refused-write attribution is keyed on the correlator in comment', () => {
  const code = soakCode();
  assert.match(code, /pulseIdByCorrelator\.set\(rowCorrelator,\s*r\.id\)/);
  assert.match(code, /correlatorFromComment\(parsed\.comment\)/);
  assert.match(code, /pulseIdByCorrelator\.get\(w\.correlator\)/);
  assert.doesNotMatch(code, /\.set\(parsed\.employeeName/,
    'attribution must not key on employeeName (a real deal stamps it from the session)');
  assert.doesNotMatch(code, /pulseIdByEmployeeName/);
});

test('soak harness: a real 2-process smoke run passes every D-15 check (exit 0)', { timeout: 90000 }, async () => {
  // Isolated scratch: the harness makes its own mkdtemp under os.tmpdir(), so
  // pointing TMPDIR at a private directory keeps (and lets us verify cleanup
  // of) everything it writes.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-soak-correlator-'));
  try {
    const env = {
      ...process.env,
      TMPDIR: scratch,
      SOAK_PROCESSES: '2',
      SOAK_DURATION_MS: '6000',
      SOAK_WRITE_INTERVAL_MS: '400',
    };
    const { code, out } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SOAK_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; });
      child.stderr.on('data', (d) => { buf += d; });
      child.on('error', reject);
      const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } }, 80000);
      child.on('exit', (c) => { clearTimeout(killer); resolve({ code: c, out: buf }); });
    });
    const verdict = out.split('\n').filter((l) => /\[(PASS|FAIL)\]|soak: (PASS|FAIL)/.test(l)).join('\n');
    assert.strictEqual(code, 0, `soak harness exited ${code}:\n${verdict || out.slice(-2000)}`);
    assert.match(out, /every acknowledged write present in the final database and exact: acknowledged=\d+ missing=0 mismatched=0/);
    assert.doesNotMatch(out, /\[FAIL\]/);
    // The harness removes its own scratch dir on exit; nothing may be left.
    assert.deepStrictEqual(fs.readdirSync(scratch).filter((n) => n.startsWith('gsd-soak-')), []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
