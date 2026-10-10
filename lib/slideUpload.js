'use strict';
// SAFE-03 / D-13-04 (Phase 13, plan 13-03): the slide upload contract.
//
// One module owns (a) which files may be stored as slides (extension AND
// declared type AND, for binary types, magic bytes must agree), (b) the size
// and library-quota limits, (c) where slides live, and (d) the exact response
// headers a served slide carries. server.js only wires these into the upload
// route and the dedicated /uploads/slides mount.
//
// [security] R1-04 / T-13-20..T-13-26: an uploaded HTML slide used to be served
// same-origin as raw bytes and framed without `sandbox`, so its script ran with
// the viewer's portal session. The sandbox CSP gives the document an opaque
// origin even when it is opened top-level, and `nosniff` stops a mislabelled
// polyglot from being re-interpreted as markup.

const fs = require('fs');
const path = require('path');

const MB = 1024 * 1024;
const MAX_FILE_BYTES = 10 * MB;          // D-13-04 (a): per-file limit, applied to DECODED bytes
const DEFAULT_QUOTA_MB = 100;            // D-13-04 (a): per-instance library quota (MA_SLIDE_QUOTA_MB)

// D-13-04 (b), verbatim. No allow-same-origin, no top-navigation, no forms, no
// popups, no network (connect-src 'none'), no cookies/storage (opaque origin).
const SLIDE_SANDBOX_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; " +
  "connect-src 'none'; form-action 'none'";

// Fixed refusal bodies (never echo caller input).
const REFUSALS = Object.freeze({
  type: Object.freeze({ error: 'This file type is not allowed for slides.', code: 'slide-type-refused' }),
  tooLarge: Object.freeze({ error: 'Slide file is larger than 10 MB.', code: 'slide-too-large' }),
  quota: Object.freeze({ error: 'The slide library is full.', code: 'slide-quota-exceeded' }),
});

const startsWith = (buf, sig, offset) => {
  const o = offset || 0;
  if (buf.length < o + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (buf[o + i] !== sig[i]) return false;
  return true;
};
const SIG_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SIG_JPEG = [0xff, 0xd8, 0xff];
const SIG_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const SIG_RIFF = [0x52, 0x49, 0x46, 0x46];       // RIFF????WEBP
const SIG_WEBP = [0x57, 0x45, 0x42, 0x50];
const isPng = (b) => startsWith(b, SIG_PNG);
const isJpeg = (b) => startsWith(b, SIG_JPEG);
const isPdf = (b) => startsWith(b, SIG_PDF);
const isWebp = (b) => startsWith(b, SIG_RIFF) && startsWith(b, SIG_WEBP, 8);
const anyBinarySignature = (b) => isPng(b) || isJpeg(b) || isPdf(b) || isWebp(b);

// extension (no dot) -> declared MIME, magic check (null = text), whether the
// served response carries the sandbox CSP (PD-17: Chromium cannot render a PDF
// in a sandboxed document, so PDFs keep the app CSP + nosniff + magic check).
const SLIDE_TYPES = Object.freeze({
  html: Object.freeze({ mime: 'text/html', magic: null, sandbox: true }),
  htm: Object.freeze({ mime: 'text/html', magic: null, sandbox: true }),
  pdf: Object.freeze({ mime: 'application/pdf', magic: isPdf, sandbox: false }),
  png: Object.freeze({ mime: 'image/png', magic: isPng, sandbox: true }),
  jpg: Object.freeze({ mime: 'image/jpeg', magic: isJpeg, sandbox: true }),
  jpeg: Object.freeze({ mime: 'image/jpeg', magic: isJpeg, sandbox: true }),
  webp: Object.freeze({ mime: 'image/webp', magic: isWebp, sandbox: true }),
});

let _dir = null;
/** The slide directory: MA_SLIDES_UPLOAD_DIR, else <repo>/public/uploads/slides. Resolved once. */
function slidesDir() {
  if (!_dir) {
    _dir = path.resolve(process.env.MA_SLIDES_UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads', 'slides'));
  }
  return _dir;
}

let _quota = null;
/** MA_SLIDE_QUOTA_MB (positive integer, else 100), read once; an invalid value logs a warning. */
function quotaBytes() {
  if (_quota === null) {
    const raw = process.env.MA_SLIDE_QUOTA_MB;
    let mb = DEFAULT_QUOTA_MB;
    if (raw !== undefined && raw !== '') {
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0) mb = n;
      else console.warn(`[slides] MA_SLIDE_QUOTA_MB=${JSON.stringify(String(raw).slice(0, 40))} is not a positive integer — using ${DEFAULT_QUOTA_MB} MB.`);
    }
    _quota = mb * MB;
  }
  return _quota;
}

/** Sum of the sizes of the regular, non-dot files directly in `dir` (0 when it does not exist). */
function libraryBytes(dir) {
  const d = dir || slidesDir();
  let total = 0;
  let names;
  try { names = fs.readdirSync(d); } catch (e) { return 0; }
  for (const n of names) {
    if (n.startsWith('.')) continue;
    try {
      const st = fs.statSync(path.join(d, n));
      if (st.isFile()) total += st.size;
    } catch (e) { /* raced with a delete — not counted */ }
  }
  return total;
}

/** Filename -> `[A-Za-z0-9._-]` only, no leading dots, bounded so the stored name stays < 255 bytes. */
function sanitizeFilename(name) {
  let base = String(name == null || name === '' ? 'slide.html' : name)
    .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  if (base.length > 120) {
    const ext = path.extname(base);
    base = base.slice(0, 120 - ext.length) + ext;
  }
  return base;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Judge an upload WITHOUT touching the disk beyond a directory listing.
 *   input: { filename, type, encoding, content }   (content is the JSON string)
 *   opts:  { dir, quotaBytes }                      (tests; defaults are the env-driven values)
 * -> { ok:false, status, body } | { ok:true, status:200, ext, bytes, buffer, safeName, mime }
 */
function checkUpload(input, opts) {
  const o = opts || {};
  const inp = input || {};
  const safeName = sanitizeFilename(inp.filename);
  const ext = path.extname(safeName).slice(1).toLowerCase();
  const spec = Object.prototype.hasOwnProperty.call(SLIDE_TYPES, ext) ? SLIDE_TYPES[ext] : null;
  const refuse = (kind, status) => ({ ok: false, status, body: { ...REFUSALS[kind] } });
  if (!spec) return refuse('type', 415);

  // Declared type: an empty/absent value is derived from the extension (some OSes
  // report '' for .webp); a non-empty value must name the extension's MIME.
  const declared = typeof inp.type === 'string' ? inp.type.split(';')[0].trim().toLowerCase() : '';
  if (declared && declared !== spec.mime) return refuse('type', 415);

  const content = typeof inp.content === 'string' ? inp.content : '';
  const encoding = inp.encoding === 'base64' ? 'base64' : 'utf8';

  let buffer;
  if (encoding === 'base64') {
    const clean = content.replace(/\s+/g, '');
    if (!BASE64_RE.test(clean)) return refuse('type', 415);
    const pad = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
    // Reject on the arithmetic size BEFORE allocating the decoded buffer.
    if (Math.floor(clean.length * 3 / 4) - pad > MAX_FILE_BYTES) return refuse('tooLarge', 413);
    buffer = Buffer.from(clean, 'base64');
  } else {
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return refuse('tooLarge', 413);
    buffer = Buffer.from(content, 'utf8');
  }
  if (buffer.length > MAX_FILE_BYTES) return refuse('tooLarge', 413);

  // Magic bytes: a binary type must carry its own signature; an HTML file must
  // not start with any binary signature (a PNG/PDF renamed to .html).
  if (spec.magic) {
    if (!spec.magic(buffer)) return refuse('type', 415);
  } else if (anyBinarySignature(buffer)) {
    return refuse('type', 415);
  }

  const quota = typeof o.quotaBytes === 'number' ? o.quotaBytes : quotaBytes();
  if (libraryBytes(o.dir) + buffer.length > quota) return refuse('quota', 413);

  return { ok: true, status: 200, ext, bytes: buffer.length, buffer, safeName, mime: spec.mime };
}

/** Does a served slide with this file extension (with or without dot) carry the sandbox CSP? */
function sandboxedExt(extension) {
  const e = String(extension || '').replace(/^\./, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(SLIDE_TYPES, e) && SLIDE_TYPES[e].sandbox === true;
}

/** Is this file extension one the slides mount may serve at all? */
function servableExt(extension) {
  const e = String(extension || '').replace(/^\./, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(SLIDE_TYPES, e);
}

module.exports = {
  SLIDE_TYPES,
  SLIDE_SANDBOX_CSP,
  MAX_FILE_BYTES,
  REFUSALS,
  slidesDir,
  quotaBytes,
  libraryBytes,
  sanitizeFilename,
  checkUpload,
  sandboxedExt,
  servableExt,
};
