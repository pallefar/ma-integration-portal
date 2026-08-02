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

/** POST /api/dd/request-items — Task 1's create shape (`text` and `area`
 * both required). Task 2 widens `id`/`text` for the update-by-id path via a
 * `.refine()`, mirroring validators/workstream.js's TaskUpsertSchema. */
const DdRequestItemUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  text: z.string().trim().min(1, 'Request item text is required.').max(TEXT_MAX),
  area: z.enum(DD_AREA_IDS),
  owner: z.string().trim().max(OWNER_MAX).optional(),
  status: z.enum(DD_STATUSES).optional(),
  dueDate: z.string().trim().max(DUE_DATE_MAX).optional(),
  blocked: z.boolean().optional(),
  notes: z.string().trim().max(NOTES_MAX).optional(),
  source: z.string().trim().max(SOURCE_MAX).optional(),
});

registerSchema('POST', '/api/dd/request-items', DdRequestItemUpsertSchema);
registerSchema('DELETE', '/api/dd/request-items/:id', EmptyBodySchema);

module.exports = { DdRequestItemUpsertSchema, DD_STATUSES };
