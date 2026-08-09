// RPT-01 (07-01): RFC 4180 CSV writer for the report/export tracer. Follows
// lib/sanitizeHtml.js's module shape (JSDoc header, named function
// declarations, one CommonJS exports object at the bottom) per this plan's
// own <read_first> instruction.
//
// Formula-injection neutralisation (planner-added hardening, IN per
// 07-CONTEXT.md discretion / 07-RESEARCH.md's Security Domain flag, T-07-05):
// a RAID entry title (and every other exported free-text field) is
// user-authored text with no character-class restriction. If that text is
// opened in a spreadsheet application and its first character is one of the
// four widely-recognised formula-trigger characters (=, +, -, @), the
// recipient's spreadsheet may evaluate it as a formula rather than display
// it as literal text — a tampering vector at the far end of an MNPI export
// path this codebase never had to consider before, because no export
// existed. A leading apostrophe is the standard, universally-supported
// defence: every mainstream spreadsheet application treats a value prefixed
// with `'` as a literal string, never a formula, and the apostrophe itself
// is not displayed to the reader.
'use strict';

// The four characters spreadsheet applications treat as a formula prefix.
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@']);

/**
 * Render one CSV field value per RFC 4180: a value whose first character is
 * a spreadsheet formula trigger is apostrophe-prefixed first (T-07-05); the
 * (possibly apostrophe-prefixed) string is then quoted if it contains a
 * comma, a double quote, a carriage return or a line feed, with any internal
 * double quote doubled. A null/undefined value coerces to an empty string.
 *
 * The formula-trigger check is skipped for `typeof value === 'number'`
 * inputs: a JS number's string form can only ever contain digits, `.`, `-`,
 * or `e`/`E` (never a spreadsheet formula payload), so a computed numeric
 * column (e.g. a negative netBenefitM) must never be apostrophe-prefixed
 * into spreadsheet text — that would silently break SUM()/sort/conditional
 * formatting on the column. String values (including numeric-looking
 * strings, e.g. user-authored free text) MUST still be escaped — that is
 * the T-07-05 defence and it stays in force for every string-typed field.
 * @param {*} value
 * @returns {string}
 */
function csvField(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (typeof value !== 'number' && s.length > 0 && FORMULA_TRIGGER_CHARS.has(s[0])) {
    s = "'" + s;
  }
  // RFC 4180: quote any field containing a comma, double-quote, or line
  // break; double any internal double-quote.
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Build a full RFC 4180 CSV document from `rows` using `columns` (an array
 * of `{ key, header }` objects). Rows are joined with CRLF row terminators
 * (RFC 4180's canonical, Excel-safe line ending on all three platforms); the
 * whole output is prefixed with a UTF-8 byte-order mark so Excel opens
 * accented and CJK content (e.g. a deal codename) as UTF-8 rather than
 * guessing the system codepage. An empty `rows` array naturally yields the
 * BOM plus the header line plus a trailing CRLF with no special-case branch
 * — an empty dataset is a valid, honest headers-only file, never an error.
 * @param {Array<Object>} rows
 * @param {Array<{key: string, header: string}>} columns
 * @returns {string}
 */
function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvField(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c.key])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv, csvField };
