'use strict';
// D-12-02 / PD-10 / PD-12 (Phase 12, plan 12-05): server-side list filtering and
// paging for the "big list" GET routes, with a NON-BREAKING default.
//
//   no list parameter  -> the legacy response: a bare JSON array, assembled from
//                         the stored raw JSON strings (byte-identical to
//                         res.json(parsedRows), see sendList below)
//   any filter, no limit -> the same bare array, narrowed
//   limit[/offset]       -> { items, total } where `total` is the count of rows
//                         the caller may see AFTER filtering, before paging
//
// The ORDER OF OPERATIONS is fixed and is a security property (T-12-40): the
// caller's visibility rule runs first, then filters, then `total`, then the
// page. A filter or a total computed over rows the caller may not see would be
// an existence oracle for restricted records, so visibility is never applied
// after any of them (the route does it before calling into this module).
//
// This module never touches SQL: every filter value is compared in JavaScript
// against values the route's projection already extracted (T-12-43).

const { z } = require('zod');

const LIMIT_MAX = 200;
const OWNER_MAX = 120;
const Q_MAX = 200;

class ListQueryError extends Error {
  constructor(message) {
    super(message || 'Invalid list query.');
    this.name = 'ListQueryError';
    this.status = 400;
  }
}

// A non-negative decimal integer written as digits only ('0', '10'): rejects
// '', '-1', '1.5', '1e2', ' 7', 'abc'. Express hands query values over as raw
// strings (or arrays/objects for repeated / bracketed keys, which z.string()
// rejects below).
const DIGITS = /^[0-9]{1,9}$/;

/**
 * `spec` describes what one route accepts:
 *   filters: { <queryKey>: <storedFieldName> }  exact-match filters, e.g.
 *            { status: 'status', owner: 'owner', workstream: 'workstreamId' }
 *   enums:   { <queryKey>: [allowed values] }   optional membership check
 *   search:  [<storedFieldName>, ...]           fields the `q` parameter scans
 * A query key the spec does not list is IGNORED (never an error), so adding a
 * list parameter to one route can never break a client of another.
 */
function recognisedKeys(spec) {
  const keys = ['limit', 'offset'];
  Object.keys((spec && spec.filters) || {}).forEach((k) => keys.push(k));
  if (spec && Array.isArray(spec.search) && spec.search.length) keys.push('q');
  return keys;
}

function parseListQuery(query, spec) {
  const q = query && typeof query === 'object' ? query : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(q, k);
  const present = recognisedKeys(spec).filter(has);
  if (!present.length) return { paged: false, filtered: false, filters: {}, q: null };

  const shape = {};
  if (has('limit')) {
    shape.limit = z.string().regex(DIGITS).transform(Number).pipe(z.number().int().min(1).max(LIMIT_MAX));
  }
  if (has('offset')) {
    shape.offset = z.string().regex(DIGITS).transform(Number).pipe(z.number().int().min(0));
  }
  const filterKeys = Object.keys((spec && spec.filters) || {}).filter(has);
  filterKeys.forEach((k) => {
    const allowed = spec.enums && spec.enums[k];
    shape[k] = Array.isArray(allowed)
      ? z.enum(allowed)
      : z.string().max(OWNER_MAX);
  });
  const searching = has('q') && spec && Array.isArray(spec.search) && spec.search.length > 0;
  if (searching) shape.q = z.string().max(Q_MAX);

  const picked = {};
  present.forEach((k) => { picked[k] = q[k]; });
  const result = z.object(shape).safeParse(picked);
  if (!result.success) throw new ListQueryError();
  const v = result.data;
  if (v.offset !== undefined && v.limit === undefined) throw new ListQueryError();

  const filters = {};
  filterKeys.forEach((k) => { filters[k] = v[k]; });
  return {
    paged: v.limit !== undefined,
    limit: v.limit,
    offset: v.offset || 0,
    filtered: filterKeys.length > 0 || searching,
    filters,
    q: searching ? v.q : null,
  };
}

/** The stored field names the route's projection must extract for `parsed`. */
function projectionFields(spec, parsed, base) {
  const out = new Set(base || []);
  Object.keys(parsed.filters || {}).forEach((k) => out.add(spec.filters[k]));
  if (parsed.q !== null && parsed.q !== undefined) (spec.search || []).forEach((f) => out.add(f));
  return [...out];
}

/**
 * Narrow projection rows (`{ id, seq, raw, f }`) by the parsed filters. Exact
 * match for the keyed filters; `q` is a case-insensitive substring match over
 * the spec's search fields, evaluated with JavaScript's own Unicode-aware
 * toLowerCase (never SQL LIKE). Row order is preserved.
 */
function applyListFilters(rows, parsed, spec) {
  if (!parsed.filtered) return rows;
  const exact = Object.keys(parsed.filters || {}).map((k) => [spec.filters[k], parsed.filters[k]]);
  const needle = parsed.q === null || parsed.q === undefined ? null : parsed.q.toLowerCase();
  const searchFields = (spec && spec.search) || [];
  return rows.filter((row) => {
    for (const [field, want] of exact) {
      if (row.f[field] !== want) return false;
    }
    if (needle !== null && needle !== '') {
      let hit = false;
      for (const field of searchFields) {
        const value = row.f[field];
        if (typeof value === 'string' && value.toLowerCase().includes(needle)) { hit = true; break; }
      }
      if (!hit) return false;
    }
    return true;
  });
}

/**
 * Send the (already visibility-filtered, already narrowed) rows.
 *
 * Unpaged: the body is the stored raw JSON strings joined into an array. Each
 * stored `data` value is exactly JSON.stringify(item) (db/store.js writes it),
 * so this equals `res.json(rows.map(JSON.parse))` byte for byte — without
 * parsing and re-serializing ~1.6 MB at 5k rows on every call (PD-10).
 * Content type and charset match what res.json() sends.
 *
 * Paged: `{ items, total }`; only the page's rows are parsed.
 */
function sendList(res, rows, parsed) {
  if (!parsed.paged) {
    return res.type('application/json').send('[' + rows.map((r) => r.raw).join(',') + ']');
  }
  const page = rows.slice(parsed.offset, parsed.offset + parsed.limit);
  return res.json({ items: page.map((r) => JSON.parse(r.raw)), total: rows.length });
}

module.exports = {
  LIMIT_MAX, ListQueryError, parseListQuery, projectionFields, applyListFilters, sendList,
};
