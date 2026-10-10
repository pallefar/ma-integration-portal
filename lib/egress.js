'use strict';
// SAFE-06 / D-13-05 (Phase 13, plan 13-02): the instance-level EGRESS switch.
//
// Three third-party channels exist in the portal and a real deal must use none
// of them unless an admin decides otherwise:
//   gemini       server -> Google Gemini (AI insight, PDF review, 100-day plan)
//   huggingface  browser -> Hugging Face (in-browser model weights)
//   youtube      browser -> YouTube (welcome-video embed + thumbnail)
//
// Effective value = mode default (real: everything OFF; dev/demo: everything ON
// so the showcase is unchanged) overlaid with the admin's stored booleans. The
// stored value lives in runtime.db (db/controlStore.js getEgressSettings), so
// every process of a shared host sees the same switch.
//
// PD-12 cache: current() runs on EVERY response (the CSP header is built from
// it), so it must be cheap and must never serve a stale value across processes.
// It re-reads the stored value only when the runtime connection's
// `PRAGMA data_version` changed (another connection committed) or the
// in-process generation counter did (this process's own write does not change
// its own data_version). One pragma per request, no restart, no timer.
//
// [security] fail-safe: if the stored value cannot be read the last good value
// (else the mode default - all OFF in real mode) is used; the header builder
// must never throw and take every response down with it.

const EGRESS_KINDS = Object.freeze(['gemini', 'huggingface', 'youtube']);

function modeDefaults(isReal) {
  const on = !isReal;
  const out = {};
  for (const k of EGRESS_KINDS) out[k] = on;
  return Object.freeze(out);
}

/** Overlay the stored booleans (only the known keys, only real booleans) on the defaults. */
function overlay(defaults, stored) {
  const out = {};
  for (const k of EGRESS_KINDS) {
    out[k] = stored && typeof stored[k] === 'boolean' ? stored[k] : defaults[k];
  }
  return Object.freeze(out);
}

/**
 * @param {object} deps
 * @param {() => any} deps.version  cheap change token (runtime.db PRAGMA data_version)
 * @param {boolean} deps.isReal     real-deal mode?
 * @param {() => object} deps.read  returns the stored { gemini?, huggingface?, youtube? }
 * @param {(patch: object) => object} deps.write persists a patch, returns the stored object
 */
function createEgress({ version, isReal, read, write }) {
  const defaults = modeDefaults(!!isReal);
  let generation = 0;
  let cache = null; // { v, gen, stored, effective }

  function load() {
    let v;
    try { v = version(); } catch (e) { v = undefined; }
    if (cache && cache.gen === generation && v !== undefined && cache.v === v) return cache;
    let stored;
    try {
      stored = read() || {};
    } catch (e) {
      if (cache) return cache;
      return { v, gen: generation, stored: {}, effective: defaults };
    }
    cache = { v, gen: generation, stored, effective: overlay(defaults, stored) };
    return cache;
  }

  return {
    kinds: EGRESS_KINDS,
    defaults,
    isReal: !!isReal,
    /** The effective { gemini, huggingface, youtube } booleans (frozen). */
    current() { return load().effective; },
    /** The raw stored booleans (what an admin explicitly chose). */
    stored() { return { ...load().stored }; },
    allows(kind) { return load().effective[kind] === true; },
    /** Persist a patch of known boolean keys; the next current() sees it. */
    set(patch) {
      const clean = {};
      for (const k of EGRESS_KINDS) {
        if (patch && typeof patch[k] === 'boolean') clean[k] = patch[k];
      }
      const stored = write(clean);
      generation += 1;
      cache = null;
      return stored;
    },
  };
}

module.exports = { EGRESS_KINDS, modeDefaults, overlay, createEgress };
