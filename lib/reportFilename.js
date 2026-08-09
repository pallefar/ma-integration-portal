// RPT-01 (07-01): safe filename + Content-Disposition builder for the
// report/export tracer. Follows lib/sanitizeHtml.js's module shape (JSDoc
// header, named function declarations, one CommonJS exports object at the
// bottom) per this plan's own <read_first> instruction.
//
// Closes 07-RESEARCH.md's Pitfall 2: `deal.name` (the codename used in every
// export filename per D-07/D-09 — never `deal.targetCompany`, the real
// legal target name, which is a structurally separate field precisely so it
// can be withheld) is free MNPI text validated only for length
// (validators/deals.js). It has never before been placed into an HTTP
// header — every prior consumer (the header deal-switcher pill,
// public/js/deal-switcher.js) renders it via textContent, which does not
// care about embedded control characters. `res.setHeader()` throws a
// TypeError on a raw CR/LF in the header value — verified in 07-RESEARCH.md
// — so a codename containing an embedded newline would 500 the whole export
// unless sanitised first.
'use strict';

// C0 control characters (including CR/LF and the delete character) plus the
// Unicode bidirectional-override/embedding range — the latter is a
// defence-in-depth measure against a codename that could otherwise visually
// disguise a filename's real extension in a filesystem viewer.
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BIDI_CHARS = /[\x00-\x1F\x7F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const GENERIC_FALLBACK = 'deal';

/**
 * Strip C0 control characters, the delete character and Unicode
 * bidirectional-override characters from `raw`, then trim. Falls back to a
 * generic literal (never an empty string) when the result is empty — a
 * codename that is entirely control characters must not produce an empty
 * filename component.
 * @param {*} raw
 * @returns {string}
 */
function sanitizeForFilename(raw) {
  const cleaned = String(raw || '').replace(CONTROL_OR_BIDI_CHARS, '').trim();
  return cleaned || GENERIC_FALLBACK;
}

/**
 * Build the locked filename shape (07-UI-SPEC.md §2):
 * `{codename}-{dataset}-{YYYY-MM-DD}.{ext}`. `codename` is sanitised via
 * sanitizeForFilename() above, then filesystem-reserved characters
 * (`\ / : * ? " < > |`) are replaced with hyphens so the value cannot escape
 * a directory or collide with a drive prefix.
 * @param {*} codename
 * @param {string} dataset
 * @param {string} ext
 * @returns {string}
 */
function buildReportFilename(codename, dataset, ext) {
  const safeCodename = sanitizeForFilename(codename).replace(/[\\/:*?"<>|]/g, '-');
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${safeCodename}-${dataset}-${date}.${ext}`;
}

/**
 * Set the `Content-Disposition` response header for `filename`, emitting
 * both the ASCII quoted-string fallback (RFC 6266 — non-ASCII bytes, quotes
 * and backslashes replaced with `_`) and the RFC 5987 percent-encoded
 * extended parameter (so a codename containing non-ASCII characters, e.g.
 * `中文` or `Müller`, still renders correctly in a compliant browser). The
 * whole call is wrapped in try/catch: sanitizeForFilename()/
 * buildReportFilename() above should make an encoding failure here
 * unreachable in practice, but a header-encoding edge case must NEVER leak
 * an uncaught exception into the export response — on failure this logs via
 * console.error with the `[security]` prefix convention and falls back to a
 * generic attachment name instead of letting the request 500.
 * @param {import('express').Response} res
 * @param {string} filename
 */
function setContentDisposition(res, filename) {
  try {
    const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
  } catch (e) {
    console.error('[security] Content-Disposition header rejected, falling back to a generic filename:', e.message);
    res.setHeader('Content-Disposition', 'attachment; filename="report.dat"');
  }
}

module.exports = { sanitizeForFilename, buildReportFilename, setContentDisposition };
