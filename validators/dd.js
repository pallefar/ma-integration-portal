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
const ID_MAX = 120;
const DUE_DATE_MAX = 10; // 'YYYY-MM-DD'

// IN-01 (04-REVIEW.md): `dueDate` was previously bounded by length only
// (max 10 chars), which accepts syntactically-shaped-but-invalid dates like
// '2024-13-40'. server.js's computeOverdue() guards its OWN read with a
// shape-only regex (DD_DUE_DATE_RE) and silently treats a non-matching
// string as never-overdue — so a malformed due date wouldn't crash anything,
// but it would silently and permanently suppress the overdue flag with no
// error surfaced anywhere. This schema-level check closes that at the
// source: an empty string (clearing the due date, per due-diligence.js's
// <input type="date"> UI) is still allowed; any non-empty value must be a
// real YYYY-MM-DD calendar date, month/day range checked (including leap
// years, via the Date.UTC(y, m, 0) "day 0 of next month" trick).
const DUE_DATE_SHAPE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isValidCalendarDate(value) {
  const m = DUE_DATE_SHAPE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

// D-14: the five-value request-item lifecycle.
const DD_STATUSES = ['open', 'requested', 'received', 'reviewed', 'closed'];

// DD-05/D-17: at most ONE data-room reference per item — never an array,
// never merged. `url`/`folderRef` are TE's own virtual-data-room pointer
// (a URL plus the data room's own folder or index identifier); `label` is a
// short optional human caption. Deliberately does NOT declare `updatedAt`/
// `updatedBy` — z.object(shape) strips unknown keys by default (D-13), so a
// caller-supplied value for either is dropped before the handler ever sees
// it; both are stamped server-side (server.js). `url` is constrained to an
// ABSOLUTE http/https URL: the bare `.url()` check alone accepts any URL
// scheme (including `javascript:`/`data:`), so the explicit .refine() below
// closes that gap — a data-room reference that is not a web URL is a
// mistake or an injection attempt, never valid input (T-04-27).
const VDR_URL_MAX = 2000;
const VDR_FOLDER_REF_MAX = 200;
const VDR_LABEL_MAX = 200;

const VdrLinkSchema = z.object({
  url: z.string().trim().min(1, 'Data room URL is required.').max(VDR_URL_MAX)
    .url('Data room URL must be a valid absolute URL.')
    .refine((val) => {
      try { const u = new URL(val); return u.protocol === 'http:' || u.protocol === 'https:'; }
      catch (e) { return false; }
    }, { message: 'Data room URL must use http or https.' }),
  folderRef: z.string().trim().min(1, 'Data room folder reference is required.').max(VDR_FOLDER_REF_MAX),
  label: z.string().trim().max(VDR_LABEL_MAX).optional(),
}).nullable().optional();

/** POST /api/dd/request-items — upsert-by-id. `text` and `area` are both
 * required on CREATE (no `id`); both become optional on UPDATE (`id`
 * present), enforced by the two refine()s below — mirroring
 * validators/workstream.js's TaskUpsertSchema.refine() shape. `area`, when
 * present on an update, additionally requires clearance for the NEW area —
 * that check is the route handler's job (db/accessPolicy.js), not this
 * schema's; this schema only proves the value is one of the eight valid ids.
 * `vdrLink` (DD-05/D-17) folds in here rather than a second route — an
 * explicit `null` clears the reference; an absent key leaves it untouched. */
const DdRequestItemUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  text: z.string().trim().min(1, 'Request item text is required.').max(TEXT_MAX).optional(),
  area: z.enum(DD_AREA_IDS).optional(),
  owner: z.string().trim().max(OWNER_MAX).optional(),
  status: z.enum(DD_STATUSES).optional(),
  dueDate: z.string().trim().max(DUE_DATE_MAX)
    .refine((val) => val === '' || isValidCalendarDate(val), {
      message: 'Due date must be a valid YYYY-MM-DD calendar date.',
    }).optional(),
  blocked: z.boolean().optional(),
  notes: z.string().trim().max(NOTES_MAX).optional(),
  // CONC-02 (Phase 9, Plan 04, Pitfall 2 recurrence): without this explicit
  // field zod v4 strips an incoming `version` key by default and the
  // route-level precheck (conflictIfStale()) silently never fires — see
  // validators/workstream.js's TaskUpsertSchema comment, the same trap on a
  // third schema.
  version: z.number().int().nonnegative().optional(),
  // WR-02 (04-REVIEW.md): `source` is deliberately NOT accepted on this
  // public upsert schema — it is server.js's own dedup key for
  // POST /api/dd/request-items/instantiate ('ddtemplate:<templateId>:<itemId>').
  // A caller-supplied `source` on manual create could collide with a future
  // template item's computed value, silently and permanently suppressing
  // that checklist item from ever being instantiated (no error surfaced to
  // the UI). z.object(shape) strips unknown keys by default (D-13), so
  // dropping this field here is enough — server.js never reads a caller
  // value for `source` on create, only the value it computes itself.
  vdrLink: VdrLinkSchema,
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
  // CONC-02 (Phase 9, Plan 04): see DdRequestItemUpsertSchema's identical
  // comment above — without this explicit field zod v4 strips an incoming
  // `version` key by default and the precheck silently never fires.
  version: z.number().int().nonnegative().optional(),
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
  // CONC-02 (Phase 9, Plan 04): this route mutates the finding's own
  // linkedTaskIds/linkedRaidIds, so it carries the same optimistic-lock
  // precondition as any other finding edit. Without this explicit field
  // zod v4 strips an incoming `version` key by default and the precheck
  // silently never fires.
  version: z.number().int().nonnegative().optional(),
}).refine((data) => data.toTask === true || data.toRaid === true, {
  message: 'At least one of toTask or toRaid must be true.',
  path: ['toTask'],
});

registerSchema('POST', '/api/dd/findings/:id/convert', DdFindingConvertSchema);

module.exports = {
  DdRequestItemUpsertSchema,
  DD_STATUSES,
  VdrLinkSchema,
  InstantiateDdRequestsSchema,
  DdFindingUpsertSchema,
  DD_FINDING_SEVERITIES,
  DD_FINDING_STATUSES,
  DdFindingConvertSchema,
};
