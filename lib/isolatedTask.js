'use strict';
// D-12-05 / DATA-05 / R2-03 (Phase 12, plan 12-04): CPU-bound work off the
// event loop, behind a hard one-in-flight bound.
//
// The steering committee pack render (@napi-rs/canvas rasterising every page)
// and the RAG PDF parse (pdf-parse / pdfjs-dist) each hold the single Node
// event loop for 2-4 s per call (measured 2,397 ms for a pack). Any signed-in
// staff member can trigger either, so one click froze the whole portal for
// everyone — a denial of service by an authorised user, no attacker needed.
//
// createIsolatedTask() owns ONE lazily started, persistent worker per task:
//   - `tryAcquire()` returns a lease or NULL. There is deliberately NO queue:
//     a second concurrent caller is refused (the route answers 429), because
//     an unbounded queue of 2-4 s CPU jobs is the same denial of service with
//     extra memory. The check and the acquire are one synchronous step, so two
//     requests can never both pass.
//   - `lease.run(payload)` posts the job and resolves with the worker's
//     result or rejects (worker error, abnormal exit, timeout). On any
//     failure the worker is terminated and discarded; the NEXT job starts a
//     fresh one, so a poisoned worker can never wedge the route.
//   - `lease.release()` is idempotent and per-lease: a late double release
//     can never free a slot a newer request now holds.
//   - The worker is unref'd while idle (it must never keep the process
//     alive) and ref'd only while a job is in flight (an awaited job in a
//     script must not be silently abandoned at exit).
//
// Workers receive plain data in and bytes out. They never open SQLite, never
// write the audit trail and never touch the network (Phase 8 D-03/D-04:
// storage stays synchronous on the main thread) — the worker modules under
// lib/workers/ require nothing but their rendering library.
//
// PD-14: `mode: 'thread'` is the only mode implemented. Both shipped workers
// were probed inside a worker_thread on the build host and load and run there
// (see 12-04-SUMMARY.md); the `child_process.fork` fallback the plan reserves
// for a platform where a native addon will not load in a worker is therefore
// NOT built — asking for it fails loudly instead of silently running the work
// on the main thread, which is the one thing this module exists to prevent.

const { Worker } = require('worker_threads');

class BusyTaskError extends Error {
  constructor(name) {
    super(`${name}: a job is already in flight`);
    this.name = 'BusyTaskError';
    this.code = 'TASK_BUSY';
  }
}

class TaskTimeoutError extends Error {
  constructor(name, timeoutMs) {
    super(`${name}: job exceeded ${timeoutMs} ms and its worker was terminated`);
    this.name = 'TaskTimeoutError';
    this.code = 'TASK_TIMEOUT';
  }
}

class TaskWorkerError extends Error {
  constructor(name, message) {
    super(`${name}: ${message}`);
    this.name = 'TaskWorkerError';
    this.code = 'TASK_WORKER_FAILED';
  }
}

/**
 * @param {object} o
 * @param {string} o.name        label used in errors/logs
 * @param {string} o.workerFile  absolute path of the worker module
 * @param {number} [o.timeoutMs] per-job ceiling; the worker is terminated past it (default 60 s)
 * @param {number} [o.idleMs]    an idle worker is terminated after this long (default 60 s)
 * @param {'thread'} [o.mode]
 */
function createIsolatedTask({ name, workerFile, timeoutMs = 60000, idleMs = 60000, mode = 'thread' }) {
  if (!name || !workerFile) throw new Error('createIsolatedTask: name and workerFile are required');
  if (mode !== 'thread') {
    throw new Error(`createIsolatedTask(${name}): mode '${mode}' is not implemented — the thread probe passed for every shipped worker (PD-14); refusing to fall back to in-process execution`);
  }

  let worker = null;       // the live Worker, or null
  let pending = null;      // the one in-flight job: { id, worker, resolve, reject, timer }
  let held = null;         // the lease currently holding the slot
  let idleTimer = null;
  let seq = 0;
  let spawnCount = 0;

  function clearIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function discard(w) {
    if (worker === w) worker = null;
    try { w.terminate(); } catch (e) { /* already gone */ }
  }

  function settle(job, fn, value) {
    if (pending !== job) return;
    pending = null;
    clearTimeout(job.timer);
    try { job.worker.unref(); } catch (e) { /* worker already gone */ }
    fn(value);
  }

  function spawn() {
    const w = new Worker(workerFile);
    spawnCount += 1;
    w.unref();
    w.on('message', (msg) => {
      const job = pending;
      if (!job || job.worker !== w || !msg || msg.id !== job.id) return;
      if (msg.ok) settle(job, job.resolve, msg.result);
      else settle(job, job.reject, new TaskWorkerError(name, (msg.error && msg.error.message) || 'worker reported an error'));
    });
    w.on('error', (err) => {
      if (worker === w) worker = null;
      const job = pending;
      if (job && job.worker === w) settle(job, job.reject, new TaskWorkerError(name, (err && err.message) || 'worker error'));
    });
    w.on('exit', (code) => {
      if (worker === w) worker = null;
      const job = pending;
      if (job && job.worker === w) settle(job, job.reject, new TaskWorkerError(name, `worker exited unexpectedly (code ${code})`));
    });
    return w;
  }

  function dispatch(payload, transferList) {
    return new Promise((resolve, reject) => {
      clearIdle();
      if (!worker) worker = spawn();
      const w = worker;
      const job = { id: ++seq, worker: w, resolve, reject, timer: null };
      pending = job;
      w.ref();
      job.timer = setTimeout(() => {
        if (pending !== job) return; // never terminate a worker another job is using
        discard(w);
        settle(job, reject, new TaskTimeoutError(name, timeoutMs));
      }, timeoutMs);
      try {
        w.postMessage({ id: job.id, payload }, transferList || []);
      } catch (err) {
        // e.g. a payload that cannot be structured-cloned: the worker is fine,
        // the job is not — fail this job, keep the worker.
        settle(job, reject, new TaskWorkerError(name, `could not post the job: ${err && err.message}`));
      }
    });
  }

  function armIdle() {
    clearIdle();
    if (!worker || !(idleMs > 0)) return;
    const w = worker;
    idleTimer = setTimeout(() => { idleTimer = null; if (!pending) discard(w); }, idleMs);
    idleTimer.unref();
  }

  const task = {
    name,
    mode,
    /** true while a lease is held (acquired and not yet released). */
    inFlight() { return held !== null; },
    /** worker spawns so far — a respawn after a crash/timeout increments it. */
    spawnCount() { return spawnCount; },
    /** A lease, or null when a job already holds the single slot. Synchronous. */
    tryAcquire() {
      if (held) return null;
      const lease = {
        released: false,
        run(payload, transferList) {
          // WR-B03 (12-REVIEW-B): one job per slot. A second run() while this
          // lease's job is still in flight is refused loudly — dispatching it
          // would overwrite `pending`, orphan the first job's promise for ever
          // and let the first job's timer terminate the worker job 2 is using.
          if (this.released || held !== this || pending) {
            return Promise.reject(new BusyTaskError(name));
          }
          return dispatch(payload, transferList).then(
            (result) => { armIdle(); return result; },
            (err) => { armIdle(); throw err; }
          );
        },
        release() {
          if (this.released) return;
          this.released = true;
          if (held === this) held = null;
        },
      };
      held = lease;
      return lease;
    },
    /** Terminates the worker and fails any in-flight job. */
    close() {
      clearIdle();
      const w = worker;
      const job = pending;
      worker = null;
      if (w) { try { w.terminate(); } catch (e) { /* ignore */ } }
      if (job) settle(job, job.reject, new TaskWorkerError(name, 'task closed'));
    },
  };
  return task;
}

module.exports = { createIsolatedTask, BusyTaskError, TaskTimeoutError, TaskWorkerError };
