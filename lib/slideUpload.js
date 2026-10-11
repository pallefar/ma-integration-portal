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

// [security] CR-A01 (13-REVIEW): the DEFAULT slide directory lives OUTSIDE the
// public static root, under the instance data directory (db/dbFiles.js DATA_DIR:
// <repo>/data in dev/demo, MA_DATA_DIR — default <repo>/data/real — in real
// mode). While slides sat in public/uploads/slides, the only thing keeping a
// slide away from sendHtml()/express.static(public) (app CSP, same origin, no
// sandbox) was a URL-prefix regex, and `send` resolves paths with the PLATFORM
// path module: on Windows `%5C` separators, a trailing-period segment
// (`/uploads./slides/x.html`), 8.3 short names and NTFS stream suffixes all
// reach the same file through spellings the regex never sees. With the files
// outside public/, no spelling the public static handlers can resolve ever names
// a slide — the class is gone, not one more regex. The dedicated /uploads/slides
// mount (server.js) is the only way to read a slide, so the stored record URLs
// (`/uploads/slides/<name>`) are unchanged. MA_SLIDES_UPLOAD_DIR still overrides.
const LEGACY_PUBLIC_SLIDES_DIR = path.join(__dirname, '..', 'public', 'uploads', 'slides');
function defaultSlidesDir() {
  // Required lazily: db/dbFiles resolves the mode contract at require time.
  return path.join(require('../db/dbFiles').DATA_DIR, 'slides');
}

let _dir = null;
/** The slide directory: MA_SLIDES_UPLOAD_DIR, else <instance data dir>/slides. Resolved once. */
function slidesDir() {
  if (!_dir) {
    _dir = path.resolve(process.env.MA_SLIDES_UPLOAD_DIR || defaultSlidesDir());
  }
  return _dir;
}

/** Create the slide directory if needed (0700 for every directory this call creates — slides can be deal material). */
function ensureSlidesDir(dir) {
  const d = dir || slidesDir();
  require('../db/dbFiles').ensurePrivateDir(d);
  return d;
}

// [security] CR-A01 (c): the exact shape of a name the slides mount may serve —
// what the upload route itself generates (`<ms>_<hex>_<sanitizeFilename()>`).
// One path segment, [A-Za-z0-9._-] only, no leading dot, <= 200 chars, plus an
// allowlisted extension (checked separately). This refuses backslashes, `:`
// (NTFS alternate data streams), `~` (8.3 short names), `%` (any encoded
// spelling), spaces and a trailing dot (no allowlisted extension) at the mount.
const SLIDE_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

/** Is `name` (one bare file name, no slash) a name the slides mount may serve? */
function isServableName(name) {
  const n = String(name == null ? '' : name);
  return SLIDE_NAME_RE.test(n) && servableExt(path.extname(n));
}

/**
 * The mount's verdict on `req.path` as seen INSIDE the `/uploads/slides` mount
 * (e.g. `/171234_ab12cd_deck.html`), RAW (never decoded — the allowlist has no
 * `%`, so any encoded spelling is refused). -> the bare file name, or null.
 */
function mountFileName(mountPath) {
  const m = /^\/([^/]*)$/.exec(String(mountPath == null ? '' : mountPath));
  if (!m || !isServableName(m[1])) return null;
  return m[1];
}

/**
 * CR-A01 (b): one-time, best-effort move of legacy slide files from
 * <repo>/public/uploads/slides into the slide directory, so every existing slide
 * record URL keeps working after the default moved. Only regular files whose
 * name the mount would serve are moved; a name that already exists in the
 * target is skipped (never overwritten — link(2) is EEXIST-atomic; across
 * filesystems the copy uses COPYFILE_EXCL). Idempotent; never throws; logs
 * COUNTS only (a slide file name can carry a target name — MNPI).
 *   opts: { from, to, log }   (tests; defaults are the legacy dir / slidesDir())
 * -> { moved, skipped, failed }
 */
function migrateLegacySlides(opts) {
  const o = opts || {};
  const from = path.resolve(o.from || LEGACY_PUBLIC_SLIDES_DIR);
  const result = { moved: 0, skipped: 0, failed: 0 };
  try {
    const to = path.resolve(o.to || slidesDir());
    if (from === to) return result;
    let names;
    try { names = fs.readdirSync(from); } catch (e) { return result; } // absent: nothing to do
    let ensured = false;
    for (const name of names) {
      const src = path.join(from, name);
      try {
        if (!isServableName(name) || !fs.lstatSync(src).isFile()) { result.skipped += 1; continue; }
        if (!ensured) { ensureSlidesDir(to); ensured = true; }
        const dst = path.join(to, name);
        try {
          fs.linkSync(src, dst);
        } catch (e) {
          if (e.code === 'EEXIST') { result.skipped += 1; continue; }
          // EXDEV (other filesystem) or no hard links (FAT/exFAT, some shares).
          try {
            fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
          } catch (copyErr) {
            if (copyErr.code === 'EEXIST') { result.skipped += 1; continue; }
            throw copyErr;
          }
        }
        fs.unlinkSync(src);
        result.moved += 1;
      } catch (e) {
        result.failed += 1;
      }
    }
  } catch (e) {
    result.failed += 1;
  }
  const log = o.log || ((m) => console.log(m));
  if (result.moved || result.failed) {
    log(`[slides] legacy slide move: ${result.moved} file(s) moved out of public/uploads/slides into the slide directory` +
      (result.skipped ? `, ${result.skipped} skipped` : '') + (result.failed ? `, ${result.failed} failed` : '') + '.');
  }
  return result;
}

/** Boot hook: the legacy move runs ONLY when MA_SLIDES_UPLOAD_DIR is unset (an override means the operator placed the files). */
function migrateLegacySlidesAtBoot(opts) {
  if (process.env.MA_SLIDES_UPLOAD_DIR) return { moved: 0, skipped: 0, failed: 0, overridden: true };
  return migrateLegacySlides(opts);
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
  LEGACY_PUBLIC_SLIDES_DIR,
  ensureSlidesDir,
  isServableName,
  mountFileName,
  migrateLegacySlides,
  migrateLegacySlidesAtBoot,
  quotaBytes,
  libraryBytes,
  sanitizeFilename,
  checkUpload,
  sandboxedExt,
  servableExt,
};
