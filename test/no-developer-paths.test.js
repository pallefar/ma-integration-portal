'use strict';
// N-03 (v3.0.0-rc.1 whole-codebase security review, LOW): a developer's OS
// username and broken absolute `file:///Users/<name>/...` links must not ship.
//
// aiService.js used to hard-code `file:///Users/<developer>/M&A/public/playbook.html#...`
// into the "Top 3 Core Playbook Links" block of the assessment AI plan; the text
// was then persisted into the committed data/demo.db (assessments.data). The
// links were broken for everyone else and leaked the developer's account name.
//
// This test fails if
//   (a) any tracked source file that ships (public/, lib/, db/, validators/,
//       aiService.js, server.js) contains `file:///Users/` or `/Users/<name>`
//       with a non-placeholder <name>; or
//   (b) any cell of the committed data/demo.db — or any raw byte run in the
//       file, e.g. a stale freed page — contains one.
//
// The database is only ever read from a COPY in an isolated os.tmpdir()
// directory; the committed file is never opened (D-12-06 isolation stays intact).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const REPO = path.resolve(__dirname, '..');

// `/Users/<name>` where <name> is a real-looking account directory. Template
// placeholders (`<name>`, `{user}`, `$USER`, `you`, ...) and the macOS `Shared`
// folder are not developer identities.
const USER_PATH_RE = /\/Users\/([A-Za-z0-9._][A-Za-z0-9._-]*)/g;
const PLACEHOLDER_NAMES = new Set([
  'you', 'your', 'yourname', 'your-name', 'your_name', 'user', 'username', 'name', 'me', 'example',
  'someone', 'developer', 'dev', 'shared', 'guest', 'jdoe', 'test', 'tester',
]);

function leaks(text) {
  const out = [];
  if (text.includes('file:///Users/')) out.push('file:///Users/');
  USER_PATH_RE.lastIndex = 0;
  let m;
  while ((m = USER_PATH_RE.exec(text)) !== null) {
    if (!PLACEHOLDER_NAMES.has(m[1].toLowerCase())) out.push(`/Users/${m[1]}`);
  }
  return out;
}

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.json', '.html', '.htm', '.css', '.md', '.txt', '.sh', '.bat', '.command',
  '.svg', '.sql', '.xml', '.csv', '.yml', '.yaml', '.map', '.webmanifest',
]);

function walk(target, files) {
  const st = fs.statSync(target);
  if (st.isFile()) { files.push(target); return; }
  for (const name of fs.readdirSync(target)) {
    if (name === 'node_modules' || name === '.git') continue;
    walk(path.join(target, name), files);
  }
}

function sourceFiles() {
  const files = [];
  for (const rel of ['public', 'lib', 'db', 'validators']) walk(path.join(REPO, rel), files);
  files.push(path.join(REPO, 'aiService.js'), path.join(REPO, 'server.js'));
  return files.filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
}

test('no-developer-paths (a): shipped source carries no developer OS-user path', () => {
  const files = sourceFiles();
  assert.ok(files.length > 50, `expected to scan the shipped source tree, scanned ${files.length}`);
  const offenders = [];
  for (const f of files) {
    const hit = leaks(fs.readFileSync(f, 'utf8'));
    if (hit.length) offenders.push(`${path.relative(REPO, f)}: ${[...new Set(hit)].join(', ')}`);
  }
  assert.deepStrictEqual(offenders, [], `developer OS-user paths in shipped source:\n${offenders.join('\n')}`);
});

test('no-developer-paths (a2): the assessment plan template links are root-relative', () => {
  const src = fs.readFileSync(path.join(REPO, 'aiService.js'), 'utf8');
  const block = src.split('Top 3 Core Playbook Links')[1];
  assert.ok(block, 'aiService.js must still carry the "Top 3 Core Playbook Links" block');
  for (const anchor of ['culture', 'talent', 'value']) {
    assert.ok(block.includes(`](/playbook.html#${anchor})`), `link to /playbook.html#${anchor} must be root-relative`);
  }
});

test('no-developer-paths (b): the committed data/demo.db carries no developer OS-user path', () => {
  const committed = path.join(REPO, 'data', 'demo.db');
  assert.ok(fs.existsSync(committed), 'data/demo.db must exist');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-n03-'));
  try {
    const copy = path.join(dir, 'demo-copy.db');
    fs.copyFileSync(committed, copy);
    // A dev boot may have left sidecars; copy them so the read is consistent.
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(committed + ext)) fs.copyFileSync(committed + ext, copy + ext);
    }

    // Cell-level scan: every text/blob cell of every table, every column.
    const db = new Database(copy, { readonly: true, fileMustExist: true });
    const offenders = [];
    let tableCount = 0;
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      for (const { name } of tables) {
        tableCount++;
        const cols = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
        for (const col of cols) {
          const rows = db.prepare(
            `SELECT rowid AS rid, "${col}" AS v FROM "${name}" WHERE typeof("${col}") IN ('text','blob') AND CAST("${col}" AS TEXT) LIKE '%/Users/%'`
          ).all();
          for (const r of rows) {
            const text = Buffer.isBuffer(r.v) ? r.v.toString('utf8') : String(r.v);
            const hit = leaks(text);
            if (hit.length) offenders.push(`${name}.${col} rowid=${r.rid}: ${[...new Set(hit)].join(', ')}`);
          }
        }
      }
    } finally {
      db.close();
    }
    assert.ok(tableCount > 10, `expected the deal-family schema, saw ${tableCount} tables`);
    assert.deepStrictEqual(offenders, [], `developer OS-user paths in data/demo.db cells:\n${offenders.join('\n')}`);

    // Byte-level scan of the main file: catches a stale copy left in a freed
    // page after an UPDATE (the cell scan cannot see freelist pages).
    const raw = fs.readFileSync(committed).toString('latin1');
    const rawHits = leaks(raw);
    assert.deepStrictEqual([...new Set(rawHits)], [], 'developer OS-user path present in raw bytes of data/demo.db (stale page?)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
