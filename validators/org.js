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
const { registerSchema } = require('./index');

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

module.exports = {
  OrgPositionUpsertSchema,
  ORG_STATE_CURRENT,
  ORG_STATE_TARGET,
  ORG_STATES,
};
