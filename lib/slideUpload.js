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

// WR-A02 (13-REVIEW): a slide upload's in-progress temp name. `.tmp` is NOT a
// servable extension (the mount answers 404 for it), the quota ignores it and
// the boot sweep removes stale ones.
const TMP_SUFFIX = '.tmp';
const isTmpName = (n) => n.endsWith(TMP_SUFFIX);

/**
 * WR-A02: write the slide atomically — `<name>.tmp` (exclusive create), then
 * rename into place, so a failed or partial write (ENOSPC/EIO on a nearly full
 * host) never leaves a servable, quota-counted fragment that no slide record
 * points at. On any error the temp file this call created is removed and the
 * error rethrown (the route answers its fixed 500). `fsImpl` is a test seam.
 */
function writeSlideAtomic(dir, fname, buffer, fsImpl) {
  const f = fsImpl || fs;
  const finalPath = path.join(dir, fname);
  const tmpPath = finalPath + TMP_SUFFIX;
  let created = false;
  try {
    // `wx`: the open itself fails if the temp name exists — `created` is only set past it.
    const fd = f.openSync(tmpPath, 'wx');
    created = true;
    try { f.writeFileSync(fd, buffer); } finally { f.closeSync(fd); }
    // Never replace an existing slide (the old `wx` guarantee, kept on the final name).
    if (f.existsSync(finalPath)) { const e = new Error('slide name already exists'); e.code = 'EEXIST'; throw e; }
    f.renameSync(tmpPath, finalPath);
  } catch (e) {
    if (created) { try { fs.rmSync(tmpPath, { force: true }); } catch (rmErr) { /* best effort */ } }
    throw e;
  }
  return finalPath;
}

/**
 * WR-A03 (13-REVIEW): remove the file behind a deleted slide record when it is an
 * uploaded slide (`url` = `/uploads/slides/<name>`) and no remaining record
 * references the same URL — otherwise every delete keeps consuming the library
 * quota and stays servable at its old URL, with no in-app way to free it. Only
 * the basename is used, it must pass the mount's own name allowlist and it is
 * resolved INSIDE the slide directory: the stored URL is never trusted as a path.
 * Never throws. -> true when a file was removed.
 */
function removeUnreferencedUpload(url, remainingSlides, dir) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/slides/')) return false;
  const name = url.slice('/uploads/slides/'.length);
  if (!isServableName(name)) return false;
  if ((remainingSlides || []).some((s) => s && s.url === url)) return false;
  try {
    const d = path.resolve(dir || slidesDir());
    const target = path.join(d, path.basename(name));
    if (path.dirname(target) !== d) return false;
    if (!fs.lstatSync(target).isFile()) return false;
    fs.rmSync(target, { force: true });
    return true;
  } catch (e) {
    return false; // absent already, or raced with another delete
  }
}

const STALE_TMP_MS = 60 * 60 * 1000;
/**
 * WR-A02: remove upload temp files (`*.tmp`) older than an hour from the slide
 * directory (a crash between write and rename). Younger ones may belong to a
 * concurrent upload in another process on a shared host. Never throws.
 */
function sweepStaleTmp(dir, nowMs) {
  const d = dir || slidesDir();
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  let removed = 0;
  let names;
  try { names = fs.readdirSync(d); } catch (e) { return 0; }
  for (const n of names) {
    if (!isTmpName(n)) continue;
    try {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isFile() && now - st.mtimeMs >= STALE_TMP_MS) { fs.rmSync(p, { force: true }); removed += 1; }
    } catch (e) { /* raced — leave it */ }
  }
  return removed;
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

/**
 * Boot hook: the legacy move runs ONLY when MA_SLIDES_UPLOAD_DIR is unset (an
 * override means the operator placed the files). Under `node --test`
 * (NODE_TEST_CONTEXT, the same signal db/dbFiles.js's isolation guard uses) it is
 * skipped unless MA_TEST_LEGACY_SLIDE_MOVE=1: dozens of suites boot the app in
 * parallel, and an incidental boot must never move files of the checkout under
 * another suite's feet — the one suite that proves the boot move opts in.
 */
function migrateLegacySlidesAtBoot(opts) {
  if (process.env.MA_SLIDES_UPLOAD_DIR) return { moved: 0, skipped: 0, failed: 0, overridden: true };
  if (process.env.NODE_TEST_CONTEXT && process.env.MA_TEST_LEGACY_SLIDE_MOVE !== '1') {
    return { moved: 0, skipped: 0, failed: 0, testSkipped: true };
  }
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

/** Sum of the sizes of the regular, non-dot, non-`*.tmp` files directly in `dir` (0 when it does not exist). */
function libraryBytes(dir) {
  const d = dir || slidesDir();
  let total = 0;
  let names;
  try { names = fs.readdirSync(d); } catch (e) { return 0; }
  for (const n of names) {
    if (n.startsWith('.') || isTmpName(n)) continue; // WR-A02: an in-progress/stale upload temp is not library content
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
 * Shared by checkUpload (slides) and checkMediaUpload (media library): base64
 * text -> decoded Buffer. The decoded size is judged ARITHMETICALLY, before the
 * buffer is allocated, so an oversize body never costs a 10+ MiB allocation.
 * -> { buffer } | { refuse: 'type' | 'tooLarge' }
 */
function decodeBase64Capped(content) {
  const clean = String(content).replace(/\s+/g, '');
  if (!BASE64_RE.test(clean)) return { refuse: 'type' };
  const pad = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  if (Math.floor(clean.length * 3 / 4) - pad > MAX_FILE_BYTES) return { refuse: 'tooLarge' };
  return { buffer: Buffer.from(clean, 'base64') };
}

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
    // Rejects on the arithmetic size BEFORE allocating the decoded buffer.
    const d = decodeBase64Capped(content);
    if (d.refuse) return refuse(d.refuse, d.refuse === 'tooLarge' ? 413 : 415);
    buffer = d.buffer;
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

// ---------------------------------------------------------------------------
// Media library (POST /api/media) — Phase 13 quick task 13-QUICK-media.
//
// [security] The media library stores admin uploads under public/uploads/, which
// express.static / the .html terminal middleware serve SAME-ORIGIN with the app
// CSP. Before this check any extension was written there, so an uploaded
// .html/.htm/.svg (or an .html that loads an uploaded same-origin .js, which even
// a strict `script-src 'self'` allows) executed with the viewer's session — the
// CR-A01 class through a sibling route. The write-side allowlist below mirrors
// the slide checker's rules (extension AND declared type AND magic bytes, 10 MiB
// decoded) with media-specific kinds: raster images and PDF only. Active content
// (html/htm/svg/js/...) is never storable. The refusal bodies are the ones
// Phase 14 (PRD D-14-04) specifies, so they do not churn when media moves into
// the per-deal store with a quota.
// ---------------------------------------------------------------------------
const MEDIA_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'pdf']);
// Same specs (mime + magic) as the slide table — one definition per type.
const MEDIA_TYPES = Object.freeze(Object.fromEntries(MEDIA_EXTENSIONS.map((e) => [e, SLIDE_TYPES[e]])));
const MEDIA_REFUSALS = Object.freeze({
  type: Object.freeze({ error: 'This file type is not allowed.', code: 'media-type-refused' }),
  tooLarge: Object.freeze({ error: 'This file is too large.', code: 'media-too-large' }),
});
// `data:<mime>[;param]*,` — header only, anchored; the payload is sliced off, never matched.
const DATA_URL_HEADER_RE = /^data:([^;,]*)((?:;[^;,]*)*),/;

/**
 * Judge a media upload WITHOUT touching the disk (the route creates nothing — not
 * even the directory — unless this returns ok).
 *   input: { fileName, fileData, declaredType }
 *     fileData     a base64 data URL (`data:<mime>;base64,<payload>`) or bare base64
 *     declaredType the request's `kind` field (the data-URL header is read from fileData)
 * Rules: the FINAL extension of the stored name (lower-cased) must be allowlisted
 * (so `x.png.html` and `x.html` are refused); every declared type present (data-URL
 * header, `kind`) must equal that extension's MIME and at least one must be
 * present; the decoded bytes must carry that type's magic signature (so
 * `x.html.png` holding HTML is refused); decoded size <= 10 MiB, judged on the
 * arithmetic size before decoding.
 * -> { ok:false, status, body } | { ok:true, status:200, ext, bytes, buffer, safeName, mime }
 */
function checkMediaUpload(input) {
  const inp = input || {};
  const refuse = (kind, status) => ({ ok: false, status, body: { ...MEDIA_REFUSALS[kind] } });

  // The stored name is `<ms>_<safeName>`: the extension is judged on the sanitized
  // name, exactly what is written (no trailing-dot/space/stream tricks survive).
  const safeName = String(inp.fileName == null ? '' : inp.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(safeName).slice(1).toLowerCase();
  const spec = Object.prototype.hasOwnProperty.call(MEDIA_TYPES, ext) ? MEDIA_TYPES[ext] : null;
  if (!spec) return refuse('type', 415);

  const fileData = typeof inp.fileData === 'string' ? inp.fileData : '';
  let payload = fileData;
  let headerMime = '';
  if (fileData.startsWith('data:')) {
    const m = DATA_URL_HEADER_RE.exec(fileData);
    if (!m) return refuse('type', 415);
    const params = m[2].split(';').map((p) => p.trim().toLowerCase());
    if (!params.includes('base64')) return refuse('type', 415); // only base64 data URLs are accepted
    headerMime = m[1].trim().toLowerCase();
    payload = fileData.slice(m[0].length);
  }
  const kind = typeof inp.declaredType === 'string' ? inp.declaredType.split(';')[0].trim().toLowerCase() : '';
  if (!headerMime && !kind) return refuse('type', 415);
  if (headerMime && headerMime !== spec.mime) return refuse('type', 415);
  if (kind && kind !== spec.mime) return refuse('type', 415);

  const d = decodeBase64Capped(payload);
  if (d.refuse) return refuse(d.refuse, d.refuse === 'tooLarge' ? 413 : 415);
  const buffer = d.buffer;
  if (buffer.length > MAX_FILE_BYTES) return refuse('tooLarge', 413);
  if (!spec.magic(buffer)) return refuse('type', 415);

  return { ok: true, status: 200, ext, bytes: buffer.length, buffer, safeName, mime: spec.mime };
}

// A stored media name: one segment, `<ms>_<sanitized-name>` — [A-Za-z0-9._-] only
// and never a leading dot, so no separator, `:` (NTFS stream), `~`, `%` or space.
const MEDIA_STORED_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * DELETE /api/media/:id containment. The record's `url` is DATA, never a path:
 * resolve it to an absolute file only when it is exactly `/uploads/<one segment>`
 * and that file would sit DIRECTLY inside `uploadsRoot` (so not the slides subtree,
 * no traversal, no separators). `uploadsRoot` is `<repo>/public/uploads`.
 * -> absolute path, or null when the url does not name a media-library file.
 */
function resolveMediaFile(url, uploadsRoot) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const name = url.slice('/uploads/'.length);
  if (!name || name.length > 255 || !MEDIA_STORED_NAME_RE.test(name)) return null;
  const root = path.resolve(uploadsRoot);
  const target = path.join(root, name);
  if (path.dirname(target) !== root) return null;
  return target;
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
  writeSlideAtomic,
  sweepStaleTmp,
  removeUnreferencedUpload,
  quotaBytes,
  libraryBytes,
  sanitizeFilename,
  checkUpload,
  MEDIA_TYPES,
  MEDIA_REFUSALS,
  checkMediaUpload,
  resolveMediaFile,
  sandboxedExt,
  servableExt,
};
