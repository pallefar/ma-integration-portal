// TEST INFRASTRUCTURE ONLY — CONC-02 gap closure (Phase 9, plan 09-08, GD-3).
//
// Why this exists: a request that edits or deletes an existing versioned
// record with NO version precondition is refused 400 `versionRequired` in
// every non-demo request (R7 F-1). A real client always sends the version it
// holds (`window.maVersionOf(record)`); suites whose SUBJECT is something
// else (DD findings, synergy staleness, write validation, ...) call the API
// directly and would have to hand-thread that version through hundreds of
// fixture writes. `installHeldVersionFetch()` supplies, for those suites only,
// exactly the precondition a real client would send: the record's stored
// version (or 0 for a never-edited one).
//
// What it must NOT do (T-09-40): it only fills an ABSENT precondition. An
// explicit `version` / `expectedVersion` is never touched, so a suite that
// tests a stale write still tests it. Explicit-contract suites
// (optimistic-locking-contract, optimistic-locking-precondition,
// optimistic-locking-cross-process, client-*) NEVER install it.
//
// The route table below is cross-checked against the live server.js source by
// a structural test (test/optimistic-locking-precondition.test.js, H1) in
// both directions, so it cannot drift from the handlers that call
// `conflictIfStale(`.
//
// All requires are lazy (inside functions) so this file is inert — and does
// not pin any MA_* path — when `node --test` executes it standalone.

'use strict';

// source: 'body'  -> the record id is `body.id` (create when absent)
//         'param' -> the record id is the first `:id` path parameter
const VERSIONED_WRITE_ROUTES = [
  { method: 'POST', route: '/api/raid', re: /^\/api\/raid$/, source: 'body' },
  { method: 'DELETE', route: '/api/raid/:id', re: /^\/api\/raid\/([^/]+)$/, source: 'param' },
  { method: 'POST', route: '/api/integration-tasks', re: /^\/api\/integration-tasks$/, source: 'body' },
  { method: 'DELETE', route: '/api/integration-tasks/:id', re: /^\/api\/integration-tasks\/([^/]+)$/, source: 'param' },
  { method: 'POST', route: '/api/synergies', re: /^\/api\/synergies$/, source: 'body' },
  { method: 'DELETE', route: '/api/synergies/:id', re: /^\/api\/synergies\/([^/]+)$/, source: 'param' },
  { method: 'POST', route: '/api/synergies/:id/cost-entries', re: /^\/api\/synergies\/([^/]+)\/cost-entries$/, source: 'param' },
  { method: 'DELETE', route: '/api/synergies/:id/cost-entries/:eid', re: /^\/api\/synergies\/([^/]+)\/cost-entries\/[^/]+$/, source: 'param' },
  { method: 'POST', route: '/api/synergies/:id/generate-phasing', re: /^\/api\/synergies\/([^/]+)\/generate-phasing$/, source: 'param' },
  { method: 'POST', route: '/api/synergies/:id/phasing/:month', re: /^\/api\/synergies\/([^/]+)\/phasing\/[^/]+$/, source: 'param' },
  { method: 'POST', route: '/api/synergies/:id/stage', re: /^\/api\/synergies\/([^/]+)\/stage$/, source: 'param' },
  { method: 'POST', route: '/api/synergies/:id/rebaseline', re: /^\/api\/synergies\/([^/]+)\/rebaseline$/, source: 'param' },
  { method: 'POST', route: '/api/synergies/:id/confirm-current', re: /^\/api\/synergies\/([^/]+)\/confirm-current$/, source: 'param' },
  { method: 'POST', route: '/api/org/positions', re: /^\/api\/org\/positions$/, source: 'body' },
  { method: 'DELETE', route: '/api/org/positions/:id', re: /^\/api\/org\/positions\/([^/]+)$/, source: 'param' },
  { method: 'POST', route: '/api/org/flight-risk', re: /^\/api\/org\/flight-risk$/, source: 'body' },
  { method: 'DELETE', route: '/api/org/flight-risk/:id', re: /^\/api\/org\/flight-risk\/([^/]+)$/, source: 'param' },
  { method: 'POST', route: '/api/org/flight-risk/:id/convert', re: /^\/api\/org\/flight-risk\/([^/]+)\/convert$/, source: 'param' },
  { method: 'POST', route: '/api/dd/request-items', re: /^\/api\/dd\/request-items$/, source: 'body' },
  { method: 'DELETE', route: '/api/dd/request-items/:id', re: /^\/api\/dd\/request-items\/([^/]+)$/, source: 'param' },
  { method: 'POST', route: '/api/dd/findings', re: /^\/api\/dd\/findings$/, source: 'body' },
  { method: 'DELETE', route: '/api/dd/findings/:id', re: /^\/api\/dd\/findings\/([^/]+)$/, source: 'param' },
  { method: 'POST', route: '/api/dd/findings/:id/convert', re: /^\/api\/dd\/findings\/([^/]+)\/convert$/, source: 'param' },
];

/**
 * The stored integer version of record `recordId` in deal `dealId`'s DB:
 * 0 when the row carries no version, `undefined` when no such row exists.
 * Looks the id up in every VERSIONED_COLLECTIONS table, through the cached
 * connection the app itself uses.
 */
function heldVersion(dealId, recordId) {
  if (!dealId || !recordId) return undefined;
  const store = require('../../db/store.js');
  const dbFiles = require('../../db/dbFiles.js');
  const { VERSIONED_COLLECTIONS } = require('../../db/collections.js');
  let conn;
  try {
    conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  } catch (e) {
    return undefined;
  }
  for (const table of VERSIONED_COLLECTIONS) {
    let row;
    try {
      row = conn.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(String(recordId));
    } catch (e) {
      continue; // a collection with no table in this DB — not an error here
    }
    if (row) {
      let rec = {};
      try { rec = JSON.parse(row.data); } catch (e) { /* treat as unversioned */ }
      return (typeof rec.version === 'number' && Number.isInteger(rec.version) && rec.version >= 0) ? rec.version : 0;
    }
  }
  return undefined;
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  if (typeof headers.get === 'function') return headers.get(name) || undefined;
  if (Array.isArray(headers)) {
    const hit = headers.find((p) => Array.isArray(p) && String(p[0]).toLowerCase() === lower);
    return hit ? hit[1] : undefined;
  }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
  return key ? headers[key] : undefined;
}

function sessionDealId(init) {
  const cookie = readHeader(init && init.headers, 'Cookie');
  if (!cookie) return null;
  const m = /(?:^|;\s*)ma_session=([^;]+)/.exec(String(cookie));
  if (!m) return null;
  const store = require('../../db/store.js');
  const dbFiles = require('../../db/dbFiles.js');
  const sessionsDb = require('../../db/sessions.js');
  try {
    const conn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
    const sess = sessionsDb.findSession(conn, decodeURIComponent(m[1]));
    return (sess && sess.dealId) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Returns `{ url, init }`, with the held-version precondition added when —
 * and only when — the request is a POST/DELETE to a table route, from a
 * deal-bound session, naming an existing record, and carrying no explicit
 * precondition. Everything else is returned unchanged.
 */
function withHeldPrecondition(url, init) {
  const unchanged = { url, init };
  try {
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (method !== 'POST' && method !== 'DELETE') return unchanged;
    if (typeof url !== 'string') return unchanged;
    let parsed;
    try { parsed = new URL(url, 'http://127.0.0.1'); } catch (e) { return unchanged; }
    const entry = VERSIONED_WRITE_ROUTES.find((r) => r.method === method && r.re.test(parsed.pathname));
    if (!entry) return unchanged;

    let body = null;
    if (method === 'POST') {
      if (!init || typeof init.body !== 'string') return unchanged;
      try { body = JSON.parse(init.body); } catch (e) { return unchanged; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return unchanged;
      if (Object.prototype.hasOwnProperty.call(body, 'version')) return unchanged;
    } else if (parsed.searchParams.has('expectedVersion')) {
      return unchanged;
    }

    let recordId;
    if (entry.source === 'body') {
      recordId = body && body.id;
    } else {
      const m = entry.re.exec(parsed.pathname);
      recordId = m && m[1] ? decodeURIComponent(m[1]) : undefined;
    }
    if (!recordId) return unchanged; // a create, or no id to look up

    const dealId = sessionDealId(init);
    if (!dealId) return unchanged; // demo-store session: the server is lenient
    const held = heldVersion(dealId, recordId);
    if (held === undefined) return unchanged; // unknown id: let the route 404

    if (method === 'POST') {
      return { url, init: Object.assign({}, init, { body: JSON.stringify(Object.assign({}, body, { version: held })) }) };
    }
    const sep = url.includes('?') ? '&' : '?';
    return { url: `${url}${sep}expectedVersion=${held}`, init };
  } catch (e) {
    return unchanged;
  }
}

/** Idempotently wraps globalThis.fetch with withHeldPrecondition. */
function installHeldVersionFetch() {
  if (globalThis.fetch && globalThis.fetch.__heldVersionInstalled) return;
  const orig = globalThis.fetch;
  const wrapped = function heldVersionFetch(input, init) {
    const target = input instanceof URL ? input.toString() : input;
    if (typeof target === 'string') {
      const r = withHeldPrecondition(target, init);
      return orig(r.url, r.init);
    }
    return orig(input, init);
  };
  wrapped.__heldVersionInstalled = true;
  globalThis.fetch = wrapped;
}

module.exports = { VERSIONED_WRITE_ROUTES, heldVersion, withHeldPrecondition, installHeldVersionFetch };
