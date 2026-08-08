// ORG-01: the org-position write surface, following validators/dd.js's
// structure exactly. zod 4.4.3 is the installed/pinned version — z.object
// (shape) strips unknown keys by default (D-13), no .strict() needed.
//
// D-13: every string field below carries an explicit maximum length — the
// repository-wide unbounded-string check (`grep -rn "z\.string()" validators/
// | grep -vc "max("`) is not scoped to this file's own additions, so a
// missing .max() anywhere in validators/ fails that check regardless of
// which module introduced it.
'use strict';

const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');

const TEXT_MAX = 300;
const ID_MAX = 120;

// IN-01 (04-REVIEW.md) idiom, replicated locally rather than imported —
// validators/dd.js does not export isValidCalendarDate, mirroring
// validators/workstream.js's own established local-copy convention for the
// identical helper. An empty string is left to '' === '' below (clearing an
// optional date); any non-empty value must be a real YYYY-MM-DD calendar
// date, month/day range checked including leap years.
const CALENDAR_DATE_SHAPE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isValidCalendarDate(value) {
  const m = CALENDAR_DATE_SHAPE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

// D-06: a position's identity is its own newId('pos') id; `state` is a
// discriminator on ONE record, never a link between two. current/target are
// exported below so server.js and test/org-positions.test.js assert against
// this one declaration rather than re-typing the literal strings.
const ORG_STATE_CURRENT = 'current';
const ORG_STATE_TARGET = 'target';
const ORG_STATES = [ORG_STATE_CURRENT, ORG_STATE_TARGET];

/** POST /api/org/positions — upsert-by-id, mirroring
 * validators/dd.js's DdRequestItemUpsertSchema.refine() shape:
 * `title` is unconditionally required on CREATE (no `id`), optional on
 * UPDATE (`id` present). `level` is free text (D-08 — no enum). `reportsToId`
 * and `employeeId` are both optional/nullable id references; the graph
 * integrity check (self-parent / unknown parent / cross-state / cycle) is
 * server.js's positionGraphFailure(), not this schema's job — this schema
 * only proves the shape and bounds of each field. */
const OrgPositionUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Position title is required.').max(TEXT_MAX).optional(),
  level: z.string().trim().max(120).optional(),
  reportsToId: z.string().trim().max(ID_MAX).nullable().optional(),
  employeeId: z.string().trim().max(ID_MAX).nullable().optional(),
  state: z.enum(ORG_STATES).optional(),
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Position title is required.',
  path: ['title'],
});

registerSchema('POST', '/api/org/positions', OrgPositionUpsertSchema);

// POST /api/org/positions/copy-to-target (06-02) — the request body carries
// no fields at all (the server derives every clone from the already-stored
// current-state rows); an empty-object schema is the honest shape, matching
// EmptyBodySchema's own role for the other no-payload write routes below.
const OrgCopyToTargetSchema = z.object({});
registerSchema('POST', '/api/org/positions/copy-to-target', OrgCopyToTargetSchema);

// DELETE /api/org/positions/:id (06-02) — no request body; an unregistered
// write route fails closed with a 500 (VAL-01), so this registration is
// required for the route to ever return anything but that fail-closed 500.
registerSchema('DELETE', '/api/org/positions/:id', EmptyBodySchema);

// POST /api/org/positions/import (D-09/D-10) — the bulk paste importer's
// wire shape. Each row's `title` is REQUIRED (the key must be present) but
// deliberately carries no `.min()` floor here: an empty-after-trim title
// (e.g. an all-whitespace paste cell) is left for server.js's handler to
// catch as a `{row, message}` problem naming the offending row index — a
// schema-level `.min()` failure would 400 through the generic
// formatIssues() path with no row index, which is not the all-or-nothing
// contract's per-row error list this route promises. `reportsTo`/`name`/
// `email` are optional trimmed strings; resolution (title-keyed parent,
// email/name-keyed employee link) is entirely server.js's job, not this
// schema's. The 500-row cap is what stands between an operator's paste and
// an unbounded allocation (T-06-17) — it carries its own message so the
// coverage test can assert the limit is actually named in the 400 body.
const ORG_IMPORT_MAX_ROWS = 500;

const OrgImportRowSchema = z.object({
  title: z.string().trim().max(TEXT_MAX),
  level: z.string().trim().max(120).optional(),
  reportsTo: z.string().trim().max(TEXT_MAX).optional(),
  name: z.string().trim().max(TEXT_MAX).optional(),
  email: z.string().trim().max(TEXT_MAX).optional(),
});

const OrgPositionImportSchema = z.object({
  state: z.enum(ORG_STATES).optional(),
  rows: z.array(OrgImportRowSchema).max(ORG_IMPORT_MAX_ROWS, `A paste cannot exceed ${ORG_IMPORT_MAX_ROWS} rows.`),
});

registerSchema('POST', '/api/org/positions/import', OrgPositionImportSchema);

// D-14: the SECOND of three independent copies of the five-value decision
// vocabulary — server.js's own ORG_DECISION_TYPES is the first,
// public/js/org.js's client array is the third. Kept in sync by hand;
// test/org-decisions.test.js's anti-drift block proves all three agree.
const ORG_DECISION_TYPES = ['retain', 'redeploy', 'in-selection', 'redundant', 'open'];

const EFFECTIVE_DATE_MAX = 10; // 'YYYY-MM-DD'

/** POST /api/org/decisions (06-04, D-13/D-14) — deliberately does NOT
 * declare `decidedBy` or `decidedAt`: both are stamped server-side from the
 * resolved session and the server clock (server.js). z.object(shape) strips
 * unknown keys by default (D-13, this file's own header note), so a caller
 * that sends either key is silently stripped by the schema's own
 * fail-closed unknown-key behaviour rather than accepted and then ignored —
 * the governance record can never be back-dated or attributed to someone
 * else via this route. `type` is a closed enum (no free text) built from
 * this file's own vocabulary copy, matching D-14's "no rollup-breaking
 * free text" requirement. `rationale` is required and non-empty (trimmed)
 * — a rationale-less governance record is refused with 400, never saved. */
const OrgDecisionSchema = z.object({
  positionId: z.string().trim().min(1).max(ID_MAX),
  employeeId: z.string().trim().max(ID_MAX).nullable().optional(),
  type: z.enum(ORG_DECISION_TYPES),
  rationale: z.string().trim().min(1, 'A rationale is required to record a decision.').max(TEXT_MAX),
  effectiveDate: z.string().trim().max(EFFECTIVE_DATE_MAX)
    .refine((val) => val === '' || isValidCalendarDate(val), {
      message: 'effectiveDate must be a valid YYYY-MM-DD calendar date.',
    }).optional(),
});

registerSchema('POST', '/api/org/decisions', OrgDecisionSchema);

// ORG-03 (06-05, D-02/D-04/D-16) — the key-talent flight-risk register's
// write shape. `riskLevel` REUSES server.js's own RAID_LEVELS four-value
// vocabulary (this is a plain reuse of an existing enum, not a new
// vocabulary — no third copy and no new anti-drift test is introduced,
// following validators/workstream.js's own independent RAID_LEVELS copy
// precedent below). `mitigation`/`notes` are deliberately optional — this
// plan's objective resolves an internal UI-SPEC inconsistency in favor of
// an unmitigated entry being a first-class, representable state (D-22's
// owner nudge keys on exactly that state existing). Every field is
// `.optional()` at the object-shape level so an UPDATE (`id` present) can
// supply only the keys it means to change; the `.refine()` calls below
// enforce that employeeId/riskLevel are required on CREATE (no `id`) — the
// same "optional-in-shape, required-via-refine-on-create" pattern
// OrgPositionUpsertSchema above already establishes for `title`.
//
// WR-02 (06-REVIEW.md): `owner` deliberately carries NO `.min(1)` floor and
// NO required-on-create `.refine()` — a blank/whitespace/omitted owner is a
// valid shape at this layer, because server.js's write route now DEFAULTS
// it to the caller's own session identity (req.portalUser.username) rather
// than rejecting it. Free text is still accepted verbatim when the caller
// does supply one; this schema only proves the shape/bound, never requires
// the field.
const RAID_LEVELS = ['low', 'medium', 'high', 'critical'];

const FlightRiskUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  employeeId: z.string().trim().min(1).max(ID_MAX).optional(),
  riskLevel: z.enum(RAID_LEVELS).optional(),
  owner: z.string().trim().max(120).optional(),
  mitigation: z.string().trim().max(TEXT_MAX).optional(),
  notes: z.string().trim().max(TEXT_MAX).optional(),
}).refine((data) => !!(data.id || data.employeeId), {
  message: 'employeeId is required.',
  path: ['employeeId'],
}).refine((data) => !!(data.id || data.riskLevel), {
  message: 'riskLevel is required.',
  path: ['riskLevel'],
});

registerSchema('POST', '/api/org/flight-risk', FlightRiskUpsertSchema);
registerSchema('DELETE', '/api/org/flight-risk/:id', EmptyBodySchema);

// POST /api/org/flight-risk/:id/convert (06-06, D-15) — two optional
// booleans naming the task/RAID conversion targets, closed with a
// `.refine()` requiring at least one to be true — identical shape to
// validators/dd.js's DdFindingConvertSchema, the route this one mirrors.
const FlightRiskConvertSchema = z.object({
  toTask: z.boolean().optional(),
  toRaid: z.boolean().optional(),
}).refine((data) => data.toTask === true || data.toRaid === true, {
  message: 'At least one of toTask or toRaid must be true.',
  path: ['toTask'],
});

registerSchema('POST', '/api/org/flight-risk/:id/convert', FlightRiskConvertSchema);

module.exports = {
  OrgPositionUpsertSchema,
  OrgCopyToTargetSchema,
  OrgPositionImportSchema,
  ORG_IMPORT_MAX_ROWS,
  ORG_STATE_CURRENT,
  ORG_STATE_TARGET,
  ORG_STATES,
  OrgDecisionSchema,
  ORG_DECISION_TYPES,
  FlightRiskUpsertSchema,
  FlightRiskConvertSchema,
};
