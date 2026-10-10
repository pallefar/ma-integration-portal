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
  const fail = (id, err) => {
    try {
      parentPort.postMessage({ id, ok: false, error: { message: String((err && err.message) || err) } });
    } catch (e) { /* the port itself is gone — the parent sees the exit */ }
  };
  parentPort.on('message', (msg) => {
    const id = msg && msg.id;
    // IN-B01 (12-REVIEW-B): a missing result or a reply that cannot be posted
    // (DataCloneError for a non-cloneable value) is reported as a structured
    // error for THIS job — previously it escaped as an unhandled rejection
    // that killed the thread and cost a respawn.
    Promise.resolve()
      .then(() => handler(msg && msg.payload))
      .then((out) => {
        if (!out || typeof out !== 'object' || out.result === undefined) {
          throw new Error('worker handler returned no result');
        }
        parentPort.postMessage({ id, ok: true, result: out.result }, out.transfer || []);
      })
      .catch((err) => fail(id, err));
  });
}

module.exports = { serveWorker };
