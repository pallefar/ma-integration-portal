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

module.exports = {
  OrgPositionUpsertSchema,
  OrgCopyToTargetSchema,
  ORG_STATE_CURRENT,
  ORG_STATE_TARGET,
  ORG_STATES,
};
