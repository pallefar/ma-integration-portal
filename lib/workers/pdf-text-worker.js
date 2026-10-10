'use strict';
// D-12-05 / DATA-05 (Phase 12, plan 12-04): extracts plain text from an
// uploaded PDF OFF the main event loop. pdf-parse (pdfjs-dist) is CPU-bound and
// a crafted or merely large PDF can hold the loop for seconds; POST
// /api/rag/upload is reachable by any signed-in staff member (R2-03).
//
// Input is the PDF bytes only; output is the extracted text only. No database,
// no filesystem, no network, no audit (T-12-32) — everything after the parse
// (AI review, ragUploads write, RAG retrain) stays on the main thread.
//
// pdf-parse is required lazily inside the handler so a load failure is an
// ordinary job error rather than a worker that dies at startup.

const { serveWorker } = require('./serve');

serveWorker(async (payload) => {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(payload.data) });
  try {
    const parsed = await parser.getText();
    return { result: { text: (parsed && parsed.text) || '' } };
  } finally {
    // The worker is persistent: free the pdfjs document between jobs.
    try { await parser.destroy(); } catch (e) { /* best effort */ }
  }
});
