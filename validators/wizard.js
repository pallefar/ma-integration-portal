// WIZ-01/D-05/D-07: the new-deal setup wizard's own write surface, following
// validators/deals.js's structure exactly (that file's own header names it
// the exemplar validators/dd.js already follows too). zod 4.4.3 is the
// installed/pinned version — z.object(shape) strips unknown keys by default
// (D-13), no .strict() needed.
'use strict';

const { z } = require('zod');
const { registerSchema } = require('./index');

const NAME_MAX = 200;
const DATE_MAX = 10; // 'YYYY-MM-DD' — matches validators/dd.js's DUE_DATE_MAX precedent (bounded length, not a regex-enforced calendar format)
const CURRENCY_MAX = 10;
const DEAL_TYPES = ['acquisition', 'jv', 'merger'];

// D-07: WizardBasicsSchema declares EXACTLY the same field names and the
// same bounds validators/deals.js's CreateDealSchema uses for its own six
// basics fields — this is the WHOLE POINT of POST /api/deals/wizard/basics:
// the wizard's first step gets ONE server-side rule set, never a second,
// independently-drifting client-side copy (D-07). The two schemas are
// deliberately duplicated (not shared via import) because they validate two
// DIFFERENT routes with different persistence behaviour (validate-only vs.
// create) — but every field name and bound below must be kept in exact sync
// with CreateDealSchema's own basics fields; test/deal-wizard.test.js proves
// the two schemas parse/reject the same basics payload identically, as a
// standing anti-drift check.
const WizardBasicsSchema = z.object({
  name: z.string().trim().min(1, 'Deal name is required.').max(NAME_MAX, `Deal name must be ${NAME_MAX} characters or fewer.`),
  targetCompany: z.string().trim().min(1, 'Target company is required.').max(NAME_MAX, `Target company must be ${NAME_MAX} characters or fewer.`),
  dealType: z.enum(DEAL_TYPES).optional(),
  signingDate: z.string().trim().max(DATE_MAX).optional(),
  expectedClose: z.string().trim().max(DATE_MAX).optional(),
  day1Date: z.string().trim().max(DATE_MAX).optional(),
  dealSizeM: z.union([z.number(), z.string().max(20)]).optional(),
  currency: z.string().trim().max(CURRENCY_MAX).optional(),
});
registerSchema('POST', '/api/deals/wizard/basics', WizardBasicsSchema);

// D-05: the six wizard setup steps, in the wizard's own order — the SAME
// list db/controlStore.js's createDeal()/DEAL_SETUP_STEPS export declares
// (duplicated, not imported, so this validators-layer module has no
// dependency on the storage layer — a schema module should be able to
// reject an unknown step name before any database read is ever attempted).
const DEAL_SETUP_STEPS = ['basics', 'team', 'assessments', 'scope', 'timeline', 'ddKickoff'];

// `data` is a shallow, bounded free-form bag for whatever that ONE step
// wants to remember (e.g. which workstreams were selected for the scope
// step) — a small key -> string|number|boolean|null|string[] record,
// matching validators/workstream.js's TransformationSchema `sending`/
// `receiving` fields' own bounded-record shape rather than an unbounded
// z.any()/object(). The array branch is capped at 50 bounded-length string
// elements (D-13 — no unbounded string, no unbounded array).
const DealSetupDataSchema = z.record(
  z.string().max(60),
  z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.string().max(60)).max(50)])
).optional();

// G-04-10: `step` is now OPTIONAL — a completion-only post (no step name)
// is a distinct, legitimate intent from "stamp this one step", and the two
// must never be conflated at the source of truth (server.js's handler is
// what previously fused them). The `.refine()` below is the ONE place that
// enforces "name a step, OR mark completion with no step data" — a post
// naming neither would silently do nothing useful server-side, and a post
// carrying `data` with no `step` would have nowhere to store that data.
// zod 4.4.3 (installed/pinned): `.refine()` attaches as a check on the same
// object schema instance, so `.shape` still resolves for any caller that
// inspects it. An explicit `path: ['step']` is what lets
// validators/index.js's formatIssues() render this as a field-path issue
// the wizard's existing error renderer can place beside the step control.
//
// D-11-02 (Phase 11): `dealSettings` carries the deal-level values an
// Integration Lead edits on HER deal now that the instance settings singleton
// is admin-only — currency, Day-1 date, synergy target, staleness threshold
// and phasing horizon. The bounds mirror the instance-settings schema
// (validators/settings.js) so a deal can never accept a value the instance
// would refuse; the readers in server.js clamp again (belt and braces).
// `synergyStaleDays` is deliberately `.positive()`, not `>= 1`: the staleness
// suite legitimately uses sub-day thresholds (WR-03 note), and the reader's
// own ceiling handles the top end. `day1Date` keeps the wizard basics bound
// (a 10-char ISO calendar date), `currency` the basics' CURRENCY_MAX.
const DealSettingsSchema = z.object({
  currency: z.string().trim().max(CURRENCY_MAX).optional(),
  day1Date: z.string().trim().max(DATE_MAX).optional(),
  synergyTargetM: z.number().min(0).max(100000).optional(),
  synergyStaleDays: z.number().positive().max(365).optional(),
  synergyHorizonYears: z.number().int().min(1).max(15).optional(),
});

const DealSetupSchema = z.object({
  step: z.enum(DEAL_SETUP_STEPS).optional(),
  data: DealSetupDataSchema,
  complete: z.boolean().optional(),
  dealSettings: DealSettingsSchema.optional(),
}).refine(
  (body) => body.step !== undefined
    || body.dealSettings !== undefined
    || (body.complete === true && body.data === undefined),
  {
    message: 'Name the setup step to record, supply deal settings, or mark the setup complete with no step data.',
    path: ['step'],
  }
);
registerSchema('POST', '/api/deals/:id/setup', DealSetupSchema);

module.exports = { WizardBasicsSchema, DealSetupSchema, DealSettingsSchema, DEAL_SETUP_STEPS, DEAL_TYPES };
