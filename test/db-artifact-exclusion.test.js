// ISO-01 / D-07 / T-03-01: real-deal databases (data/deals/<id>.db), the live
// session store (data/runtime.db) and the compliance audit trail
// (data/audit.db) must NEVER reach git or a distributed admin download-zip
// export. This must be proven BEFORE any of those files can exist — Phase 3
// Plan 01 lands both exclusion lists before Plan 02 creates the first such
// file, exactly the way Phase 1 pre-empted the .db artifact family before
// wave 2 created data/ma-portal.db (see 01-01-PLAN.md Task 3).
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare) or `npm test`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const GITIGNORE_PATH = path.join(__dirname, '..', '.gitignore');
const SERVER_PATH = path.join(__dirname, '..', 'server.js');

test('db-artifact-exclusion: .gitignore excludes data/runtime.db*, data/audit.db*, data/deals/', () => {
  const contents = fs.readFileSync(GITIGNORE_PATH, 'utf8');
  const nonCommentLines = contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  assert.ok(
    nonCommentLines.includes('data/runtime.db*'),
    '.gitignore must have "data/runtime.db*" on its own non-comment line — live session store must never be committed'
  );
  assert.ok(
    nonCommentLines.includes('data/audit.db*'),
    '.gitignore must have "data/audit.db*" on its own non-comment line — compliance audit trail must never be committed'
  );
  assert.ok(
    nonCommentLines.includes('data/deals/'),
    '.gitignore must have "data/deals/" on its own non-comment line — every real-deal database (MNPI) must never be committed'
  );
});

test('db-artifact-exclusion: admin download-zip export excludes the same three families', () => {
  const contents = fs.readFileSync(SERVER_PATH, 'utf8');
  const zipCommandMatch = contents.match(/execSync\(`zip -r[^`]*`/);
  assert.ok(zipCommandMatch, 'server.js must contain the download-zip execSync zip command');
  const zipCommand = zipCommandMatch[0];

  assert.ok(
    zipCommand.includes('data/runtime.db*'),
    'download-zip -x list must exclude "data/runtime.db*" — live session store must never ship in a release export'
  );
  assert.ok(
    zipCommand.includes('data/audit.db*'),
    'download-zip -x list must exclude "data/audit.db*" — compliance audit trail must never ship in a release export'
  );
  assert.ok(
    zipCommand.includes('data/deals/*'),
    'download-zip -x list must exclude "data/deals/*" — the flat "data/*.db" pattern does not recurse into this nested directory (Pitfall 4), so a real-deal database would otherwise ship in the export'
  );
});

// D-10-01 (Phase 10): the real-deal-mode data directory (MA_MODE=real default
// data/real/) holds accounts, deal databases, sessions and the audit trail —
// MNPI. It must reach neither git nor the admin download-zip export.
test('db-artifact-exclusion: data/real/ is gitignored and excluded from the download-zip export', () => {
  const gitignore = fs.readFileSync(GITIGNORE_PATH, 'utf8')
    .split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
  assert.ok(
    gitignore.includes('data/real/'),
    '.gitignore must have "data/real/" on its own non-comment line — the real-deal data directory (MNPI) must never be committed'
  );

  const contents = fs.readFileSync(SERVER_PATH, 'utf8');
  const zipCommandMatch = contents.match(/execSync\(`zip -r[^`]*`/);
  assert.ok(zipCommandMatch, 'server.js must contain the download-zip execSync zip command');
  assert.ok(
    zipCommandMatch[0].includes('"data/real/*"'),
    'download-zip -x list must exclude "data/real/*" — the real-deal data directory must never ship in an export'
  );
});

// D-12-04 (Phase 12): per-deal audit partitions (data/audit/<dealId>.db) hold full
// MNPI before/after snapshots and their file names ARE deal ids — they must reach
// neither git nor the admin download-zip export.
test('db-artifact-exclusion: data/audit/ is gitignored and excluded from the download-zip export', () => {
  const gitignore = fs.readFileSync(GITIGNORE_PATH, 'utf8')
    .split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
  assert.ok(
    gitignore.includes('data/audit/'),
    '.gitignore must have "data/audit/" on its own non-comment line — audit partitions (MNPI) must never be committed'
  );

  const contents = fs.readFileSync(SERVER_PATH, 'utf8');
  const zipCommandMatch = contents.match(/execSync\(`zip -r[^`]*`/);
  assert.ok(zipCommandMatch, 'server.js must contain the download-zip execSync zip command');
  assert.ok(
    zipCommandMatch[0].includes('"data/audit/*"'),
    'download-zip -x list must exclude "data/audit/*" — audit partitions must never ship in an export'
  );
});
