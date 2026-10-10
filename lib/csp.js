'use strict';
// SAFE-06 / D-13-03 groundwork (Phase 13, plan 13-02): the per-request page
// Content-Security-Policy builder. server.js asks it for the header(s) of every
// response with the CURRENT effective egress (lib/egress.js), so a third-party
// origin appears in the policy only while an admin has that channel switched on.
// Plan 13-07 extends headersFor() with the strict / report-only policy without
// touching server.js again.
//
// Origins per switch (PD-9):
//   youtube      frame-src, img-src, media-src - NEVER script-src (no YouTube
//                script is loaded; employee.js uses an embed iframe + a thumbnail)
//   huggingface  connect-src, img-src (in-browser model download)
//   gemini       none (server-side egress only)
// Google Fonts are vendored (public/vendor/fonts), so no font CDN origin is ever
// listed. `frame-ancestors 'self'` is today's anti-framing value, kept (PD-8).

const YOUTUBE = Object.freeze({
  frame: ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://youtube.com'],
  img: ['https://img.youtube.com', 'https://i.ytimg.com'],
  media: ['https://*.youtube.com'],
});
const HUGGINGFACE = Object.freeze({
  connect: ['https://huggingface.co', 'https://*.huggingface.co', 'https://cdn-lfs.huggingface.co', 'https://cdn-lfs-us-1.huggingface.co'],
  img: ['https://*.huggingface.co'],
});

function buildPolicy(egress) {
  const yt = !!(egress && egress.youtube);
  const hf = !!(egress && egress.huggingface);
  const list = (base, extra) => base.concat(extra).join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    'img-src ' + list(["'self'", 'data:', 'blob:'], [...(yt ? YOUTUBE.img : []), ...(hf ? HUGGINGFACE.img : [])]),
    "font-src 'self' data:",
    'connect-src ' + list(["'self'"], hf ? HUGGINGFACE.connect : []),
    'frame-src ' + list(["'self'"], yt ? YOUTUBE.frame : []),
    'media-src ' + list(["'self'", 'blob:', 'data:'], yt ? YOUTUBE.media : []),
    "worker-src 'self' blob:",
  ].join('; ');
}

const memo = new Map();

/** @returns {{ [headerName: string]: string }} header(s) to set on a response */
function headersFor({ egress } = {}) {
  const key = ['gemini', 'huggingface', 'youtube'].map((k) => (egress && egress[k] ? '1' : '0')).join('');
  let headers = memo.get(key);
  if (!headers) {
    headers = Object.freeze({ 'Content-Security-Policy': buildPolicy(egress) });
    memo.set(key, headers);
  }
  return headers;
}

module.exports = { headersFor };
