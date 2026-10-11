// D-13-01 (Phase 13, SAFE-01): migration #2 of the deal family — every stored
// HTML-bearing value is re-sanitized ONCE, at boot, with the parser sanitizer
// (lib/sanitizeHtml.js). Applies to data/deals/<id>.db files and (through the
// rule-5 regeneration script) the committed data/demo.db.
//
// WHY. Content stored before the parser sanitizer existed (no sanitizer, or the
// Phase-3 regex port that R1-03 measured four bypasses of) is still in the
// pages and lessons of existing deal files. The write-time gate in
// validators/index.js only ever sees NEW writes, so without this migration a
// payload stored last year would keep rendering raw.
//
// SCOPE (PD-6) — exactly the three htmlField() paths of the TAGGED-FIELD
// INVENTORY in validators/index.js (a test cross-checks FIELD_PATHS against the
// validators and fails if a fourth htmlField() appears):
//   pages.body                               validators/cms.js PageUpsertSchema.body
//   pages.layout[].data.html                 validators/cms.js PageBlockDataSchema.html
//   courses.modules[].lessons[].body         validators/cms.js LessonSchema.body
// Each value is a string or a language map (`{ en, de, … }`); like the write
// path ("tagging a container propagates to every string leaf beneath it") every
// string leaf beneath the path is sanitized. Banners and slides are NOT
// htmlField-wrapped (plain text, rendered via textContent) and are excluded.
//
// ROWS. A row whose values are all unchanged is NOT written (its `data` bytes
// stay identical — no spurious write, no audit noise, no 409 storms). A changed
// row is rewritten with JSON.stringify(record) — the store's own serialization.
// The record version follows the store's own rule (db/store.js writeDb):
// `version` is stamped only on VERSIONED_COLLECTIONS members; pages and courses
// are last-writer-wins documents (db/collections.js — D-06) and carry none, so
// none is invented here. If either table were ever added to that set the bump
// below (comparableVersion + 1) applies.
//
// NO AUDIT ROWS. A migration runs at boot, outside any request and outside a
// deal write transaction; it is a system-actor repair, not an edit. What it
// leaves behind is one log line per file plus, per changed value,
// collection/#row-id-digest/path with sha256 of the value before and after —
// never the content itself (MNPI), never a row id (an author-chosen slug, WR-A05:
// logged as sha256(id).slice(0,8)), and never a deal id (files are tagged by name
// digest). Rollback is the pre-upgrade data-directory backup
// (DEPLOYMENT.md §6): migrations are forward-only and this one sets no
// `backup: true` (a VACUUM INTO of every deal file for a rewrite expected to
// touch ~0 values).
//
// PD-35: this module's BODY IS FROZEN once released (db/migrate.js authoring
// rule 2). It deliberately requires the LIVE lib/sanitizeHtml.js: version 2
// means "stored HTML was re-sanitized by the sanitizer of the day". A later
// sanitizer change does not re-run it — a later migration (003+) would.
//
// [security] the migration only ever REMOVES or entity-escapes markup (the
// sanitizer is allowlist-based and idempotent), so it can narrow what stored
// content renders but never introduce a live construct.

const crypto = require('crypto');
const path = require('path');

const FIELD_PATHS = Object.freeze([
  Object.freeze({ table: 'pages', path: 'body' }),
  Object.freeze({ table: 'pages', path: 'layout[].data.html' }),
  Object.freeze({ table: 'courses', path: 'modules[].lessons[].body' }),
]);

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Sanitize every string leaf of `value` (a string, a language map, or any
 * container of them). Returns { value, changed } — `value` is the input itself
 * when nothing changed.
 */
function sanitizeLeaves(value, sanitizeHtml) {
  if (typeof value === 'string') {
    const clean = sanitizeHtml(value);
    return clean === value ? { value, changed: false } : { value: clean, changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = sanitizeLeaves(v, sanitizeHtml);
      if (r.changed) changed = true;
      return r.value;
    });
    return changed ? { value: out, changed } : { value, changed: false };
  }
  if (value !== null && typeof value === 'object') {
    let changed = false;
    const out = {};
    for (const k of Object.keys(value)) {
      const r = sanitizeLeaves(value[k], sanitizeHtml);
      if (r.changed) changed = true;
      out[k] = r.value;
    }
    return changed ? { value: out, changed } : { value, changed: false };
  }
  return { value, changed: false }; // number / boolean / null / undefined — inert
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Walk one record. Returns the list of changed values
 * `{ path, before, after }` (path is the concrete location, e.g.
 * `layout[1].data.html`); mutates `record` in place.
 */
function resanitizeRecord(table, record, sanitizeHtml) {
  const changes = [];
  const apply = (holder, key, where) => {
    if (!isPlainObject(holder) || !Object.prototype.hasOwnProperty.call(holder, key)) return;
    const r = sanitizeLeaves(holder[key], sanitizeHtml);
    if (!r.changed) return;
    changes.push({ path: where, before: sha256(holder[key]), after: sha256(r.value) });
    holder[key] = r.value;
  };
  if (!isPlainObject(record)) return changes;
  if (table === 'pages') {
    apply(record, 'body', 'body');
    if (Array.isArray(record.layout)) {
      record.layout.forEach((block, i) => {
        if (isPlainObject(block) && isPlainObject(block.data)) apply(block.data, 'html', `layout[${i}].data.html`);
      });
    }
  } else if (table === 'courses') {
    if (Array.isArray(record.modules)) {
      record.modules.forEach((mod, mi) => {
        if (!isPlainObject(mod) || !Array.isArray(mod.lessons)) return;
        mod.lessons.forEach((lesson, li) => apply(lesson, 'body', `modules[${mi}].lessons[${li}].body`));
      });
    }
  }
  return changes;
}

function up(conn, ctx) {
  const { sanitizeHtml } = require('../../../lib/sanitizeHtml'); // eslint-disable-line global-require
  const { VERSIONED_COLLECTIONS, comparableVersion } = require('../../collections'); // eslint-disable-line global-require
  const tables = [...new Set(FIELD_PATHS.map((f) => f.table))];
  const present = new Set(
    conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );
  const lines = [];
  let changedRows = 0;
  let changedValues = 0;

  for (const table of tables) {
    if (!present.has(table)) continue; // a pre-baseline file; the schema exec creates it empty
    const rows = conn.prepare(`SELECT id, data FROM ${table}`).all();
    const update = conn.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`);
    for (const row of rows) {
      let record;
      try { record = JSON.parse(row.data); } catch (e) { continue; } // not ours to repair
      const changes = resanitizeRecord(table, record, sanitizeHtml);
      if (changes.length === 0) continue; // unchanged -> the row is not written
      if (VERSIONED_COLLECTIONS.has(table)) record.version = comparableVersion(record.version) + 1;
      update.run(JSON.stringify(record), row.id);
      changedRows += 1;
      changedValues += changes.length;
      // [security] WR-A05 (13-REVIEW): the row id is an author-chosen slug (CMS
      // page/course ids are free text, ID_MAX 120) that can name the target or
      // the project code name — MNPI in a boot log that gets pasted into support
      // channels. It is logged as an 8-hex digest, like the file name; the value
      // digests below stay the operator's stable handle.
      const rowTag = `#${crypto.createHash('sha256').update(String(row.id)).digest('hex').slice(0, 8)}`;
      for (const c of changes) {
        lines.push(`[migrate] deal/002 resanitize-html ${table}/${rowTag} ${c.path} sha256 ${c.before} -> ${c.after}`);
      }
    }
  }

  // The boot sweep's log contract names no deal id (test/healthz-readiness.test.js):
  // the committed demo file is named, every other file only by a short digest of its name.
  const base = ctx && ctx.file ? path.basename(ctx.file) : '';
  const where = base === 'demo.db' ? 'demo.db'
    : `deal-file#${crypto.createHash('sha256').update(base).digest('hex').slice(0, 8)}`;
  console.log(`[migrate] deal/002 resanitize-html ${where}: ${changedValues} value(s) changed in ${changedRows} row(s)`);
  for (const l of lines) console.log(l);
}

module.exports = {
  id: 2,
  slug: 'resanitize-html',
  FIELD_PATHS,
  resanitizeRecord, // exported for the regeneration script and tests
  up,
};
