'use strict';
// SAFE-06 / D-13-03 groundwork (Phase 13, plan 13-02): the per-request page
// Content-Security-Policy builder. server.js asks it for the header(s) of every
// response with the CURRENT effective egress (lib/egress.js), so a third-party
// origin appears in the policy only while an admin has that channel switched on.
// Plan 13-07 (D-13-03) extends headersFor() with the strict policy and CSP_MODE
// without touching the server.js middleware again (it loops over whatever
// header map this returns).
//
// Origins per switch (PD-9):
//   youtube      frame-src, img-src, media-src - NEVER script-src (no YouTube
//                script is loaded; employee.js uses an embed iframe + a thumbnail)
//   huggingface  connect-src, img-src (in-browser model download)
//   gemini       none (server-side egress only)
// Google Fonts are vendored (public/vendor/fonts), so no font CDN origin is ever
// listed. `frame-ancestors 'self'` is today's anti-framing value, kept (PD-8).
//
// Two policies (PD-10, PD-11):
//   legacy  today's enforcing policy (`'unsafe-inline' 'unsafe-eval'`) + report-uri
//   strict  identical except script-src is exactly `'self' 'wasm-unsafe-eval'`
//           (no inline, no eval, no nonce, no third-party script origin)
// CSP_MODE selects how they ship:
//   enforce     (DEFAULT since plan 13-13 / D-13-03 final state, PD-45)
//               strict as Content-Security-Policy, nothing else
//   report-only the documented ROLLBACK (one variable + a restart):
//               legacy as Content-Security-Policy, strict as
//               Content-Security-Policy-Report-Only - what Phase 13 shipped
//               behind until the report-only walks were clean
//   anything else fails CLOSED to enforce, with one [security] boot warning.
// Only `report-uri` is emitted - never report-to / Reporting-Endpoints: Chromium
// ignores report-uri when report-to is present and batches report-to deliveries
// by up to a minute, which would make the walk assertions racy.

const YOUTUBE = Object.freeze({
  frame: ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://youtube.com'],
  img: ['https://img.youtube.com', 'https://i.ytimg.com'],
  media: ['https://*.youtube.com'],
});
const HUGGINGFACE = Object.freeze({
  connect: ['https://huggingface.co', 'https://*.huggingface.co', 'https://cdn-lfs.huggingface.co', 'https://cdn-lfs-us-1.huggingface.co'],
  img: ['https://*.huggingface.co'],
});

const REPORT_URI = '/api/csp-report';
const STRICT_SCRIPT_SRC = "script-src 'self' 'wasm-unsafe-eval'";
const LEGACY_SCRIPT_SRC = "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'";

function buildPolicy(egress, scriptSrc) {
  const yt = !!(egress && egress.youtube);
  const hf = !!(egress && egress.huggingface);
  const list = (base, extra) => base.concat(extra).join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    'img-src ' + list(["'self'", 'data:', 'blob:'], [...(yt ? YOUTUBE.img : []), ...(hf ? HUGGINGFACE.img : [])]),
    "font-src 'self' data:",
    'connect-src ' + list(["'self'"], hf ? HUGGINGFACE.connect : []),
    'frame-src ' + list(["'self'"], yt ? YOUTUBE.frame : []),
    'media-src ' + list(["'self'", 'blob:', 'data:'], yt ? YOUTUBE.media : []),
    "worker-src 'self' blob:",
    'report-uri ' + REPORT_URI,
  ].join('; ');
}

const MODES = Object.freeze(['report-only', 'enforce']);
const DEFAULT_MODE = 'enforce'; // D-13-03 final state (13-13): unset/empty = the strict policy ENFORCED
const warned = new Set();

/**
 * Resolve CSP_MODE. Unset/empty = the default; a known value (case-insensitive,
 * trimmed) = itself; ANYTHING else = enforce (fail closed) with `valid: false`.
 * @returns {{ mode: 'report-only'|'enforce', requested: string, valid: boolean }}
 */
function resolveMode(raw = process.env.CSP_MODE) {
  const requested = raw === undefined || raw === null ? '' : String(raw).trim();
  if (requested === '') return { mode: DEFAULT_MODE, requested, valid: true };
  const lower = requested.toLowerCase();
  if (MODES.includes(lower)) return { mode: lower, requested, valid: true };
  return { mode: 'enforce', requested, valid: false };
}

function warnInvalid(requested) {
  if (warned.has(requested)) return;
  warned.add(requested);
  console.warn(
    `[security] CSP_MODE=${JSON.stringify(requested.slice(0, 40))} is not one of ${MODES.join(' | ')} - ` +
    'failing closed to enforce (the strict script-src policy is ENFORCED).'
  );
}

/** One line at boot naming the active mode (and one warning for an unknown value). */
function logBootMode() {
  const r = resolveMode();
  if (!r.valid) warnInvalid(r.requested);
  console.log(`[security] CSP_MODE=${r.mode} (strict script-src ${r.mode === 'enforce' ? 'ENFORCED' : 'reported only; legacy policy still enforced'})`);
  return r.mode;
}

const memo = new Map();

/** @returns {{ [headerName: string]: string }} header(s) to set on a response */
function headersFor({ egress } = {}) {
  const r = resolveMode();
  if (!r.valid) warnInvalid(r.requested);
  const key = r.mode + ':' + ['gemini', 'huggingface', 'youtube'].map((k) => (egress && egress[k] ? '1' : '0')).join('');
  let headers = memo.get(key);
  if (!headers) {
    headers = Object.freeze(r.mode === 'enforce'
      ? { 'Content-Security-Policy': buildPolicy(egress, STRICT_SCRIPT_SRC) }
      : {
          'Content-Security-Policy': buildPolicy(egress, LEGACY_SCRIPT_SRC),
          'Content-Security-Policy-Report-Only': buildPolicy(egress, STRICT_SCRIPT_SRC),
        });
    memo.set(key, headers);
  }
  return headers;
}

module.exports = { headersFor, resolveMode, logBootMode, REPORT_URI };
