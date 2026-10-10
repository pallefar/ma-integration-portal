'use strict';
// D-12-05 / DATA-05 (Phase 12, plan 12-04): the worker-side half of
// lib/isolatedTask.js — a tiny request/response loop shared by every worker
// module so each one is just its rendering function. Requires nothing but
// worker_threads: no database, filesystem, network or audit module may ever
// enter a worker's require graph (T-12-32).
//
// Protocol: the parent posts `{ id, payload }`; this replies
// `{ id, ok: true, result }` (optionally transferring ArrayBuffers named by
// the handler) or `{ id, ok: false, error: { message } }`. A handler failure is
// reported, never thrown — the worker stays alive for the next job.

const { parentPort } = require('worker_threads');

/**
 * @param {(payload:any)=>Promise<{result:any, transfer?:ArrayBuffer[]}>} handler
 */
function serveWorker(handler) {
  if (!parentPort) throw new Error('lib/workers/serve: must be loaded inside a worker_thread');
  parentPort.on('message', (msg) => {
    const id = msg && msg.id;
    Promise.resolve()
      .then(() => handler(msg && msg.payload))
      .then(
        (out) => parentPort.postMessage({ id, ok: true, result: out.result }, out.transfer || []),
        (err) => parentPort.postMessage({ id, ok: false, error: { message: String((err && err.message) || err) } })
      );
  });
}

module.exports = { serveWorker };
