#!/usr/bin/env node
'use strict';
// Phase 13 / plan 13-14 (Task 1): how long does deal migration 002
// (resanitize-html, D-13-01) take to run at boot on a deal the size the Phase 12
// performance profile builds?
//
//   node scripts/perf/migration-002-timing.js [--dirty-pages N] [--dirty-lessons N]
//
// Builds a scratch MA_* tree under os.tmpdir() (the committed data/*.db are only
// ever copied READ-ONLY through the guard-aware snapshot helper, never opened
// writable), then for each variant:
//   1. createDealDatabase() - a real deal seeded from the demo template (pages,
//      courses, i18n: the HTML-bearing rows migration 002 inspects);
//   2. seedVolumeDeal() - the R5 profile: 1,000 tasks, 5,000 RAID entries, 200
//      org positions (scripts/perf/lib/volume-deal.js, unchanged);
//   3. optionally N legacy "dirty" pages / lessons carrying handler attributes
//      and javascript: links, so the migration has real values to rewrite;
//   4. stamps the file at user_version 1 (a Phase 12 release's deal file) and
//      opens it through openDbFile() - the exact boot path - timing that open;
//   5. a second open of the now-v2 file (the steady-state cost) for contrast.
// It prints ms, the number of changed values (parsed from the migration's own
// per-file `[migrate] deal/002 ...` summary line) and the file size. Row ids and
// content are never printed (the migration already logs hashes only).
//
// Nothing here is a budget: no PRD number covers migration time. It exists so a
// release note can say what the one-time boot cost on a big deal is.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function numArg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
const DIRTY_PAGES = numArg('--dirty-pages', 300);
const DIRTY_LESSONS = numArg('--dirty-lessons', 150);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-m002-timing-'));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

// Scratch paths FIRST: db/dbFiles.js reads these at require time.
process.env.MA_CONTROL_DB_PATH = path.join(tmp, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(tmp, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(tmp, 'demo.db');
process.env.MA_DEALS_DIR = path.join(tmp, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(tmp, 'audit.db');
for (const k of ['MA_MODE', 'MA_DATA_DIR', 'NODE_TEST_CONTEXT']) delete process.env[k];
fs.mkdirSync(process.env.MA_DEALS_DIR, { recursive: true });

const Database = require(path.join(REPO_ROOT, 'node_modules', 'better-sqlite3'));
const dbFiles = require(path.join(REPO_ROOT, 'db', 'dbFiles.js'));
const { createDealDatabase } = require(path.join(REPO_ROOT, 'db', 'dealSeed.js'));
const { seedVolumeDeal } = require('./lib/volume-deal.js');

function freeBytes() {
  const s = fs.statfsSync(os.tmpdir());
  return Number(s.bavail) * Number(s.bsize);
}
if (freeBytes() < 1024 * 1024 * 1024) {
  console.error('migration-002-timing: less than 1 GB free in ' + os.tmpdir() + ' - refusing to start');
  process.exit(2);
}

// Legacy markup of the kind the old write path let through (the review payloads).
function dirtyHtml(i) {
  const para = '<p>Integration playbook paragraph ' + i + ': align the retention plan with the workstream leads and confirm Day-1 ownership.</p>';
  const filler = para.repeat(12);
  const bad = [
    '<img src=x onerror=alert(' + i + ')>',
    '<a href="javascript:alert(' + i + ')">open</a>',
    '<p onclick="steal(' + i + ')">click</p>',
    '<script>alert(' + i + ')</script>',
  ];
  return filler + bad[i % bad.length] + filler;
}
function cleanHtml(i) {
  const para = '<p>Clean playbook paragraph ' + i + ': <strong>retention</strong> and <em>Day-1</em> ownership.</p>';
  return para.repeat(24);
}

function insert(conn, table, id, seq, rec) {
  conn.prepare('INSERT INTO ' + table + ' (id, project_id, seq, data) VALUES (?, NULL, ?, ?)').run(id, seq, JSON.stringify(rec));
}

function addLegacyContent(file, pages, lessons) {
  const conn = new Database(file);
  try {
    conn.pragma('busy_timeout = 5000');
    const tx = conn.transaction(() => {
      let seq = conn.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM pages').get().n;
      for (let i = 0; i < pages; i++) {
        const dirty = i % 4 === 0;
        insert(conn, 'pages', 'p13m_page_' + i, seq++, {
          id: 'p13m_page_' + i, slug: 'p13m-page-' + i, title: { en: 'Legacy page ' + i }, published: true,
          body: dirty ? dirtyHtml(i) : cleanHtml(i),
          layout: [{ id: 'b' + i, type: 'richtext', data: { html: dirty ? dirtyHtml(i + 1) : cleanHtml(i) } }],
        });
      }
      seq = conn.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM courses').get().n;
      const perCourse = 10;
      for (let c = 0; c < Math.ceil(lessons / perCourse); c++) {
        const ls = [];
        for (let l = 0; l < perCourse && c * perCourse + l < lessons; l++) {
          const n = c * perCourse + l;
          ls.push({ id: 'p13m_l_' + n, title: { en: 'Lesson ' + n }, body: { en: n % 3 === 0 ? dirtyHtml(n) : cleanHtml(n) } });
        }
        insert(conn, 'courses', 'p13m_course_' + c, seq++, {
          id: 'p13m_course_' + c, title: { en: 'Legacy course ' + c }, published: true,
          modules: [{ id: 'p13m_m_' + c, title: { en: 'Module' }, lessons: ls }],
        });
      }
    });
    tx();
  } finally {
    conn.close();
  }
}

function stampV1AndCheckpoint(file) {
  const conn = new Database(file);
  try {
    conn.pragma('user_version = 1');
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }
}

function timedOpen(file) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  let ms;
  try {
    const t0 = process.hrtime.bigint();
    const c = dbFiles.openDbFile(file, dbFiles.DEAL_SCHEMA_PATH);
    c.close();
    ms = Number(process.hrtime.bigint() - t0) / 1e6;
  } finally {
    console.log = orig;
  }
  return { ms, lines };
}

function userVersion(file) {
  const c = new Database(file, { readonly: true });
  try { return c.pragma('user_version', { simple: true }); } finally { c.close(); }
}

async function main() {
  // The committed demo database is the deal template; copy it read-only.
  const snap = dbFiles.openReadOnlySnapshot(path.join(REPO_ROOT, 'data', 'demo.db'));
  try { await snap.backup(process.env.MA_DEMO_DB_PATH); } finally { snap.close(); }

  const variants = [
    { name: 'A: perf volume deal as the Phase 12 scripts build it (template content, nothing legacy)', pages: 0, lessons: 0 },
    { name: 'B: A + ' + DIRTY_PAGES + ' legacy pages (every 4th carries markup the old sanitiser passed) + ' + DIRTY_LESSONS + ' legacy lessons (every 3rd dirty)', pages: DIRTY_PAGES, lessons: DIRTY_LESSONS },
  ];
  console.log('migration-002-timing: node ' + process.version + '; host load ' + os.loadavg().map((x) => x.toFixed(2)).join(' / ') + ' (1/5/15 min); ' + os.cpus().length + ' CPUs');
  let n = 0;
  for (const v of variants) {
    n += 1;
    const dealId = 'deal_m002' + String.fromCharCode(96 + n);
    const file = createDealDatabase(dealId, { name: 'Migration 002 timing ' + n, targetCompany: 'Synthetic Timing Target ' + n });
    seedVolumeDeal({ dealDbPath: file, tasks: 1000, raid: 5000, positions: 200 });
    if (v.pages || v.lessons) addLegacyContent(file, v.pages, v.lessons);
    stampV1AndCheckpoint(file);
    const bytes = fs.statSync(file).size;
    const first = timedOpen(file);
    const after = userVersion(file);
    const summary = first.lines.filter((l) => /\[migrate\] deal\/002/.test(l));
    const total = summary.find((l) => /changed|rows|value/i.test(l) && !/sha256/.test(l)) || summary[0] || '(no summary line)';
    const perValue = first.lines.filter((l) => /sha256/.test(l)).length;
    const second = timedOpen(file);
    console.log('');
    console.log('variant ' + v.name);
    console.log('  file size before migration : ' + (bytes / 1048576).toFixed(2) + ' MiB');
    console.log('  first open (runs 002)      : ' + first.ms.toFixed(1) + ' ms; user_version 1 -> ' + after);
    console.log('  migration summary line     : ' + total);
    console.log('  changed values logged      : ' + perValue + ' (per-value digest lines)');
    console.log('  second open (already v2)   : ' + second.ms.toFixed(1) + ' ms; migration lines: ' + second.lines.filter((l) => /\[migrate\]/.test(l)).length);
  }
  console.log('');
  console.log('MIGRATION-002-TIMING DONE');
}

main().then(() => { cleanup(); }).catch((e) => {
  console.error('migration-002-timing failed: ' + (e && e.stack ? e.stack : e));
  cleanup();
  process.exit(1);
});
