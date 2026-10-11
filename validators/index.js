// VAL-01/VAL-02: the shared validation pipeline every write route in this
// codebase goes through. Promoted out of validators/deals.js (Plan 04, the
// first module this codebase had) — that module's own
// validateBody()/formatIssues() shape is the reusable contract this file
// generalizes across the remaining ~60 write endpoints (validators/deals.js
// now re-exports from here rather than keeping its own copy).
//
// zod 4.4.3 is the installed/pinned version. `z.object(shape)` STRIPS
// unknown keys by default in v4 (D-13) — verified against the installed
// version, not assumed from v3-era memory (03-RESEARCH.md Pitfall 5).
//
// String length limits below (and in every validators/*.js module) are
// measured in JavaScript string units (UTF-16 code units) — this is what
// zod's `.max()` applies to a string schema. A multi-byte character (e.g. an
// emoji outside the BMP) counts as 1-2 UTF-16 code units, NOT by UTF-8 byte
// length — see test/write-validation.test.js's encoding case for a
// non-ASCII fixture proving this.
'use strict';

const { z } = require('zod');
const { sanitizeHtml } = require('../lib/sanitizeHtml');

// ---------------------------------------------------------------------------
// formatIssues / validationMiddleware — the single-string `{ error }` 400
// shape every existing handler in this codebase already used before this
// phase (never an array). Every zod issue message below is either a zod
// built-in ("Too big: ...", "Invalid input: expected string, received
// number", …) or a schema-authored custom string — NONE of them echo the
// submitted VALUE, only the field path and the rule it broke (T-03-34), so a
// rejected field — which may carry MNPI (a target company name, a valuation)
// — is never reflected back into a message that could be logged, screenshot
// or displayed out of context.
// ---------------------------------------------------------------------------
function formatIssues(error) {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/**
 * Express middleware factory for a SINGLE schema, kept for call sites (e.g.
 * validators/deals.js's historical export surface) that still want a
 * per-route middleware rather than the generic path-resolved
 * validationMiddleware below. safeParse()s req.body; on failure responds 400
 * with the `{ error }` shape; on success REPLACES req.body with the
 * parsed/stripped/sanitized result.
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      return res.status(400).json({ error: formatIssues(result.error) });
    }
    req.body = applySanitization(schema, result.data);
    next();
  };
}

// ---------------------------------------------------------------------------
// htmlField / applySanitization — D-15's HTML-bearing field tagging. A
// schema field wrapped in htmlField() is sanitized (lib/sanitizeHtml.js) at
// write time; every other field is stored as the plain string it was parsed
// as — deliberately NOT run through the sanitizer, because silently
// mangling a plain-text field (a target company name containing an
// ampersand, a finding note containing an angle bracket) would itself be a
// data-integrity bug. The existing client-side render-time textContent/
// sanitize() discipline (public/js/page-layout.js, public/js/banners.js,
// …) is unchanged and stays in place as defence in depth (D-15).
//
// Tagging works on the SCHEMA object identity via a WeakSet, so it survives
// being embedded inside a z.object()/z.array()/z.record() shape — the
// convention this codebase follows is to apply htmlField() as the OUTERMOST
// wrapper for a field (e.g. `body: htmlField(i18nRecord(HTML_MAX)).optional()`
// — htmlField() wraps the base schema BEFORE `.optional()`/`.nullable()`
// chains onto it), and applySanitization()'s isHtmlTagged() unwraps through
// those chains to find it either way.
// ---------------------------------------------------------------------------
const HTML_TAGGED = new WeakSet();

// ---------------------------------------------------------------------------
// TAGGED-FIELD INVENTORY (VAL-02/D-15) — every field passed to htmlField()
// anywhere in this codebase, so a reviewer can see the full HTML-bearing
// write surface in one place instead of hunting through each validators/*.js
// module. Update this list whenever a new htmlField() call is added.
//
//   validators/cms.js LessonSchema.body
//     — public/js/employee.js's openLessonModal() renders `l.body` raw into
//       innerHTML; `title`/`description` on the same schema are plain text
//       (rendered via cmsEsc()) and are NOT tagged.
//   validators/cms.js PageBlockDataSchema.html
//     — the `richtext` layout block's content; public/js/page-layout.js's
//       REGISTRY renders ONLY this one field raw (`sanitize(L(d.html))`);
//       every other block-data field (title/subtitle/heading/items/text/
//       button/cta/href/ctaHref) is rendered via esc() and is NOT tagged.
//   validators/cms.js PageUpsertSchema.body
//     — the legacy CMS page body; page-layout.js's fallback ladder renders
//       it raw (`sanitize(body)`) when a page has no `layout` blocks yet.
//
// Every field NOT in this list is stored as the plain string it was parsed
// as, deliberately unsanitized — mangling a plain-text field (a target
// company name with an ampersand, a finding note with an angle bracket)
// would itself be a data-integrity bug (D-15).
// ---------------------------------------------------------------------------

/** Tag `schema` as HTML-bearing (D-15). Returns the SAME schema instance. */
function htmlField(schema) {
  HTML_TAGGED.add(schema);
  return schema;
}

// ---------------------------------------------------------------------------
// urlField — [security] CR-B01 / WR-B04 (Phase 13 review, Part B): the ONE
// write-time rule for every stored value the client later writes into an
// `href`/`src` (module + lesson playbookLink, menu/landing-card/bookmark
// targets, CMS block ctaHref/href, welcomeVideoUrl*). Escaping at render time
// stops attribute breakout but not a `javascript:` scheme, so the store only
// ever holds a same-origin relative reference (`/path`, `#frag`, `?query`) or
// an absolute http(s) URL. Refused: every other scheme (`javascript:`,
// `data:`, `vbscript:`, …), protocol-relative `//host` AND its backslash
// spelling `/\host` (browsers read `\` as `/` in http URLs), and any value
// carrying a control character (the URL parser drops tab/CR/LF anywhere, so
// `/<TAB>/host` would otherwise become `//host` in the browser). The client
// keeps its own render-time check (MASafeHtml.safeHref) as the second layer.
// `alsoAllow` widens the rule for ONE field-specific non-URL token shape
// (e.g. a bare 11-character YouTube id) — never a scheme. The empty string is
// accepted (an unset link). The message never echoes the value (T-03-34).
// ---------------------------------------------------------------------------
const SAFE_LINK_RE = /^(?:\/(?![/\\])|#|\?|https?:\/\/)/i;
const URL_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
function urlField(max, opts) {
  const alsoAllow = opts && opts.alsoAllow instanceof RegExp ? opts.alsoAllow : null;
  return z.string().trim().max(max).refine(
    (v) => v === '' || (!URL_CONTROL_RE.test(v) && (SAFE_LINK_RE.test(v) || (alsoAllow !== null && alsoAllow.test(v)))),
    'Link must be a relative path or http(s) URL'
  );
}

// Follows zod's wrapper-type chain (optional/nullable/default/readonly/catch)
// down to whatever's inside, checking membership in HTML_TAGGED at every
// level — so `htmlField(z.string().max(N)).optional()` and
// `htmlField(z.string().max(N).optional())` are both recognized.
const WRAPPER_TYPES = new Set(['optional', 'nullable', 'default', 'readonly', 'catch']);
function isHtmlTagged(schema) {
  let s = schema;
  const seen = new Set();
  while (s && typeof s === 'object' && !seen.has(s)) {
    seen.add(s);
    if (HTML_TAGGED.has(s)) return true;
    const def = s._def;
    if (!def || !WRAPPER_TYPES.has(def.type) || !def.innerType) break;
    s = def.innerType;
  }
  return false;
}
function unwrapToBase(schema) {
  let s = schema;
  const seen = new Set();
  while (s && typeof s === 'object' && !seen.has(s)) {
    seen.add(s);
    const def = s._def;
    if (!def || !WRAPPER_TYPES.has(def.type) || !def.innerType) return s;
    s = def.innerType;
  }
  return s;
}

/**
 * Recursively walks `value` alongside `schema`, sanitizing exactly the
 * fields tagged htmlField() (directly, or via an ancestor container that was
 * itself tagged — tagging an object/array/record propagates to every string
 * leaf beneath it). Handles fields nested inside arrays/objects/records
 * (VAL-02's "including fields nested inside arrays and objects").
 *
 * A null, absent or non-string value AT A TAGGED LEAF becomes an empty
 * string — never a stringified placeholder (String(5) === '5' would be a
 * placeholder; this function returns '' instead for any non-string leaf).
 */
function sanitizeValue(schema, value, forceHtml) {
  const tagged = forceHtml || isHtmlTagged(schema);
  const base = unwrapToBase(schema);
  const type = base && base._def && base._def.type;

  if (type === 'object') {
    const shape = base.shape || (typeof base._def.shape === 'function' ? base._def.shape() : base._def.shape) || {};
    const srcIsObj = value !== null && typeof value === 'object' && !Array.isArray(value);
    const out = srcIsObj ? { ...value } : (tagged ? {} : value);
    Object.keys(shape).forEach((key) => {
      const fieldSchema = shape[key];
      const present = srcIsObj && Object.prototype.hasOwnProperty.call(value, key);
      if (present) {
        out[key] = sanitizeValue(fieldSchema, value[key], tagged);
      } else if (tagged || isHtmlTagged(fieldSchema) || isHtmlTagged(unwrapToBase(fieldSchema))) {
        // A tagged field the caller omitted entirely still resolves to ''
        // (VAL-02's "absent" case), not left undefined.
        out[key] = sanitizeValue(fieldSchema, undefined, true);
      }
    });
    return out;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) return value;
    const el = base._def.element;
    return value.map((item) => sanitizeValue(el, item, tagged));
  }

  if (type === 'record') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return tagged ? {} : value;
    }
    const vt = base._def.valueType;
    const out = {};
    Object.keys(value).forEach((k) => { out[k] = sanitizeValue(vt, value[k], tagged); });
    return out;
  }

  if (type === 'union') {
    // A CMS text field is commonly `z.union([string, i18n-record])`
    // (validators/cms.js's i18nOrString()) — pick the union MEMBER whose
    // own declared shape matches the value's ACTUAL runtime shape (the
    // member zod itself would have matched during parsing) and recurse
    // into it, rather than treating the whole union as an opaque leaf
    // (which would collapse an i18n object down to a single '').
    const options = base._def.options || [];
    let candidate;
    if (typeof value === 'string') {
      candidate = options.find((o) => (unwrapToBase(o)._def || {}).type === 'string');
    } else if (Array.isArray(value)) {
      candidate = options.find((o) => (unwrapToBase(o)._def || {}).type === 'array');
    } else if (value !== null && typeof value === 'object') {
      candidate = options.find((o) => ['record', 'object'].includes((unwrapToBase(o)._def || {}).type));
    }
    if (candidate) return sanitizeValue(candidate, value, tagged);
    // No member matches the runtime shape (e.g. value is null/undefined/a
    // number) — fall through to the leaf handling below.
  }

  // Leaf (string/number/boolean/union/enum/...).
  if (tagged) {
    return typeof value === 'string' ? sanitizeHtml(value) : '';
  }
  return value;
}

/** Applies sanitizeValue() at the schema's top level. */
function applySanitization(schema, data) {
  return sanitizeValue(schema, data, false);
}

// ---------------------------------------------------------------------------
// WRITE_SCHEMAS — the method+path → schema registry. Keyed on an Express
// ROUTE TEMPLATE (e.g. '/api/deals/:id/members', matching layer.route.path
// exactly as test/auth-route-inventory.test.js's listApiRoutes() already
// reads it) rather than the runtime path — resolveSchema() below converts
// each registered template into a boundary-safe regex ONCE and matches
// against it, so it works identically whether it's handed a REAL runtime
// path (real ids substituted, used by validationMiddleware at request time)
// or the literal template string with its ":id" placeholders still in it
// (used by findUnvalidatedWriteRoutes()'s coverage check) — a placeholder
// token like ":id" contains no "/" so it satisfies the same `[^/]+` segment
// regex a real id would.
// ---------------------------------------------------------------------------
const WRITE_SCHEMAS = [];

function templateToRegex(template) {
  const escaped = template
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${escaped}$`);
}

/**
 * Registers `schema` for `method METHOD` at route template `template`.
 * @param {string} method e.g. 'POST'
 * @param {string} template e.g. '/api/deals/:id/members'
 * @param {import('zod').ZodType} schema
 */
function registerSchema(method, template, schema) {
  WRITE_SCHEMAS.push({ method: method.toUpperCase(), template, matcher: templateToRegex(template), schema });
}

/** Looks up the schema registered for `method fullPath` (real or template form). */
function resolveSchema(method, fullPath) {
  const entry = WRITE_SCHEMAS.find((e) => e.method === method.toUpperCase() && e.matcher.test(fullPath));
  return entry ? entry.schema : undefined;
}

// A bodyless write (every DELETE, and a few POSTs that take no payload) still
// needs a registry entry so the coverage gate can prove it was DELIBERATELY
// reviewed rather than silently missing — z.object({}) strips any body a
// caller sends (D-13) rather than accepting it unvetted.
const EmptyBodySchema = z.object({});

// The 2 auth-bootstrap write routes that NEVER reach the generic
// validationMiddleware below — server.js's consolidated /api gate returns
// `next()` for PUBLIC_API_PATHS BEFORE the resolver/role-check/validation
// chain runs at all (login has no session yet to validate against; logout
// needs none either). Mirrored here (not imported from server.js) to avoid a
// circular require — server.js requires this module, not the other way
// round. Excluded from the coverage requirement for the SAME reason
// test/auth-route-inventory.test.js excludes them from its own AUTH-01 check.
const UNVALIDATED_BY_DESIGN = new Set(['POST /api/auth/login', 'POST /api/auth/logout']);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Walks the live Express route table (the SAME `app._router.stack`
 * reflection test/auth-route-inventory.test.js's listApiRoutes() already
 * uses — not a second, independent walking mechanism) and returns every
 * registered write route for which resolveSchema() finds nothing, excluding
 * UNVALIDATED_BY_DESIGN. Used by BOTH scripts/list-unvalidated-routes.js (a
 * reporter) and test/write-validation-coverage.test.js (the permanent gate)
 * so the two never drift out of sync with each other.
 * @param {import('express').Express} app
 * @returns {{method:string, path:string}[]}
 */
function findUnvalidatedWriteRoutes(app) {
  const out = [];
  const stack = (app._router && app._router.stack) || [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
    for (const m of methods) {
      const method = m.toUpperCase();
      if (!WRITE_METHODS.has(method)) continue;
      if (!layer.route.path.startsWith('/api')) continue;
      const key = `${method} ${layer.route.path}`;
      if (UNVALIDATED_BY_DESIGN.has(key)) continue;
      if (!resolveSchema(method, layer.route.path)) out.push({ method, path: layer.route.path });
    }
  }
  return out;
}

/**
 * The generic, path-resolved validation middleware — mounted ONCE inside the
 * consolidated /api gate in server.js, AFTER the resolver binding and AFTER
 * the role check (an unauthorized/wrongly-bound caller never has their
 * payload parsed). Resolves the schema for the matched route via
 * resolveSchema(); a MISS fails CLOSED (a missing schema is a loud
 * server-side bug, never a silent pass-through — VAL-01's "absence of a
 * schema must break the build rather than default to permissive"); a parse
 * failure 400s with the single-string shape; success replaces req.body with
 * the parsed, unknown-key-stripped, sanitized result.
 */
function validationMiddleware(req, res, next) {
  const method = req.method.toUpperCase();
  if (!WRITE_METHODS.has(method)) return next();
  const fullPath = (req.baseUrl || '') + (req.path || '');
  const key = `${method} ${fullPath}`;
  // Match UNVALIDATED_BY_DESIGN by exact key too, defensively — these two
  // routes never actually reach this middleware (PUBLIC_API_PATHS returns
  // before the gate's role-check/validation chain), but a future refactor of
  // that gate must not accidentally start rejecting them here.
  if (UNVALIDATED_BY_DESIGN.has(key)) return next();
  let schema = resolveSchema(method, fullPath);
  // [security] IN-04 (Phase 11 review): the consolidated gate decides on the
  // CANONICAL path (lib/requestPath.js), so a non-canonical spelling of a real
  // write route used to pass the gate and then meet a 500 "no registered
  // schema" here (a loud error log per request and an "unvalidated write"
  // oracle). Two cases, mirroring exactly what the router itself will do:
  //   1. trailing slash(es): Express routing is non-strict, so the router WILL
  //      serve the canonical route — validate with that route's schema, i.e.
  //      behave exactly like the canonical spelling;
  //   2. any other variant (case, `//`, percent-encoded static segment) whose
  //      canonical form names a real write route: the case-sensitive router
  //      serves no handler for it, so answer the router's own 404 here — never
  //      a 500 and never a body validated against a schema the router will not
  //      run behind it.
  // A path whose canonical form has no schema either is still the loud
  // fail-closed 500 below (a genuinely unregistered write route is a bug).
  if (!schema && fullPath.length > 1 && fullPath.endsWith('/')) {
    const trimmed = fullPath.replace(/\/+$/, '');
    if (trimmed) schema = resolveSchema(method, trimmed);
  }
  if (!schema) {
    const canonical = typeof req.gatePathCanonical === 'string' ? req.gatePathCanonical : '';
    if (canonical && canonical !== fullPath && resolveSchema(method, canonical)) {
      return res.status(404).json({ error: 'Not found' });
    }
  }
  if (!schema) {
    console.error(`[validation] No schema registered for ${key} — refusing rather than passing an unvalidated write through (VAL-01).`);
    return res.status(500).json({ error: 'This write route has no registered validation schema.' });
  }
  const result = schema.safeParse(req.body || {});
  if (!result.success) {
    return res.status(400).json({ error: formatIssues(result.error) });
  }
  req.body = applySanitization(schema, result.data);
  next();
}

module.exports = {
  formatIssues,
  validateBody,
  htmlField,
  urlField,
  applySanitization,
  WRITE_SCHEMAS,
  registerSchema,
  resolveSchema,
  validationMiddleware,
  findUnvalidatedWriteRoutes,
  EmptyBodySchema,
  UNVALIDATED_BY_DESIGN,
};
