'use strict';
// D-12-05 / DATA-05 (Phase 12, plan 12-04): renders the steering committee
// pack OFF the main event loop. The main thread assembles the (already
// clearance-filtered) model and owns the audit event; this worker only turns
// plain data into PDF bytes via lib/reportPack.buildPack — no SQLite, no audit,
// no network (T-12-32).
//
// lib/reportPack is required lazily inside the handler, mirroring server.js's
// getReportPack(): a host whose @napi-rs/canvas binding is missing never gets
// here (the main thread's availability gate answers 503 first), and a load
// failure surfaces as an ordinary job error, not a worker crash.

const { serveWorker } = require('./serve');

serveWorker(async (payload) => {
  // Test hook (T-12-35): proves the crash/respawn path. The main thread gates
  // it on MA_MODE !== 'real'; this repeats the gate so a real-deal host can
  // never be made to throw from here even by a hand-built message.
  if (payload && payload.testThrow === true && process.env.MA_MODE !== 'real') {
    throw new Error('MA_TEST_PACK_WORKER_THROW: deliberate worker failure');
  }
  const { buildPack } = require('../reportPack');
  const pdf = await buildPack(payload.model);
  // Copy into a fresh, exactly-sized ArrayBuffer so it can be TRANSFERRED
  // (zero-copy) — a Buffer from the pool is a view over a shared slab.
  const bytes = new Uint8Array(pdf.length);
  bytes.set(pdf);
  return { result: { pdf: bytes.buffer }, transfer: [bytes.buffer] };
});
