// VAL-01 (DD-01): the due-diligence request-item write surface, following
// validators/deals.js's structure exactly (that file's own header names it
// the exemplar). zod 4.4.3 is the installed/pinned version — z.object(shape)
// strips unknown keys by default (D-13), no .strict() needed.
//
// D-13: every string field below carries an explicit maximum length — the
// repository-wide unbounded-string check (`grep -rn "z\.string()" validators/
// | grep -vc "max("`) is not scoped to this file's own additions, so a
// missing .max() anywhere in validators/ fails that check regardless of
// which module introduced it.
'use strict';

const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');
const { DD_AREA_IDS } = require('../db/accessPolicy');

const TEXT_MAX = 2000;
const OWNER_MAX = 120;
const NOTES_MAX = 2000;
const SOURCE_MAX = 160;
const ID_MAX = 120;
const DUE_DATE_MAX = 10; // 'YYYY-MM-DD'

// D-14: the five-value request-item lifecycle.
const DD_STATUSES = ['open', 'requested', 'received', 'reviewed', 'closed'];

/** POST /api/dd/request-items — upsert-by-id. `text` and `area` are both
 * required on CREATE (no `id`); both become optional on UPDATE (`id`
 * present), enforced by the two refine()s below — mirroring
 * validators/workstream.js's TaskUpsertSchema.refine() shape. `area`, when
 * present on an update, additionally requires clearance for the NEW area —
 * that check is the route handler's job (db/accessPolicy.js), not this
 * schema's; this schema only proves the value is one of the eight valid ids. */
const DdRequestItemUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  text: z.string().trim().min(1, 'Request item text is required.').max(TEXT_MAX).optional(),
  area: z.enum(DD_AREA_IDS).optional(),
  owner: z.string().trim().max(OWNER_MAX).optional(),
  status: z.enum(DD_STATUSES).optional(),
  dueDate: z.string().trim().max(DUE_DATE_MAX).optional(),
  blocked: z.boolean().optional(),
  notes: z.string().trim().max(NOTES_MAX).optional(),
  source: z.string().trim().max(SOURCE_MAX).optional(),
}).refine((data) => data.id || (data.text && data.text.trim()), {
  message: 'Request item text is required.',
  path: ['text'],
}).refine((data) => data.id || data.area, {
  message: 'Request item area is required.',
  path: ['area'],
});

registerSchema('POST', '/api/dd/request-items', DdRequestItemUpsertSchema);
registerSchema('DELETE', '/api/dd/request-items/:id', EmptyBodySchema);

/** POST /api/dd/request-items/instantiate — D-13. A single bounded required
 * `templateId`, mirroring validators/workstream.js's InstantiateTasksSchema
 * shape. GET /api/dd/request-templates needs no registration — it is a read
 * route with no body. */
const InstantiateDdRequestsSchema = z.object({
  templateId: z.string().trim().min(1, 'Template id is required.').max(ID_MAX),
});

registerSchema('POST', '/api/dd/request-items/instantiate', InstantiateDdRequestsSchema);

/** POST /api/dd/findings — upsert-by-id, same shape as
 * DdRequestItemUpsertSchema above: `title`/`area` unconditionally-present-on
 * -create, optional-on-update, enforced by two refine()s. D-26: `severity`
 * is a FOUR-level enum, independent of validators/workstream.js's
 * RAID_LEVELS until Plan 04's Task 2 extends that separate list to match —
 * a finding's severity is copied verbatim into a converted RAID entry. */
const DD_FINDING_SEVERITIES = ['low', 'medium', 'high', 'critical'];
// The same three-value lifecycle RaidUpsertSchema's RAID_STATUSES already uses.
const DD_FINDING_STATUSES = ['open', 'mitigating', 'closed'];

const DdFindingUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Finding title is required.').max(TEXT_MAX).optional(),
  area: z.enum(DD_AREA_IDS).optional(),
  severity: z.enum(DD_FINDING_SEVERITIES).optional(),
  status: z.enum(DD_FINDING_STATUSES).optional(),
  owner: z.string().trim().max(OWNER_MAX).optional(),
  notes: z.string().trim().max(NOTES_MAX).optional(),
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Finding title is required.',
  path: ['title'],
}).refine((data) => data.id || data.area, {
  message: 'Finding area is required.',
  path: ['area'],
});

registerSchema('POST', '/api/dd/findings', DdFindingUpsertSchema);
registerSchema('DELETE', '/api/dd/findings/:id', EmptyBodySchema);

/** POST /api/dd/findings/:id/convert — D-12: two optional booleans, with a
 * refine forbidding the no-op call (both false/absent). */
const DdFindingConvertSchema = z.object({
  toTask: z.boolean().optional(),
  toRaid: z.boolean().optional(),
}).refine((data) => data.toTask === true || data.toRaid === true, {
  message: 'At least one of toTask or toRaid must be true.',
  path: ['toTask'],
});

registerSchema('POST', '/api/dd/findings/:id/convert', DdFindingConvertSchema);

module.exports = {
  DdRequestItemUpsertSchema,
  DD_STATUSES,
  InstantiateDdRequestsSchema,
  DdFindingUpsertSchema,
  DD_FINDING_SEVERITIES,
  DD_FINDING_STATUSES,
  DdFindingConvertSchema,
};
