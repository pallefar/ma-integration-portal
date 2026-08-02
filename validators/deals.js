// VAL-01 (first instance) / D-12 / D-13: zod schema validation for the
// /api/deals control-plane routes — the first validator module this codebase
// had (03-RESEARCH.md: "zero sanitize/schema-validation references in
// server.js" before this phase). Plan 06 (validators/index.js) generalizes
// this exact validateBody()/formatIssues() pipeline across the remaining
// ~60 write endpoints and is now the CANONICAL home of that pipeline — this
// module re-exports validateBody()/formatIssues() from there rather than
// keeping its own copy, and registers its four schemas into the shared
// WRITE_SCHEMAS registry so the generic, path-resolved
// validators/index.js#validationMiddleware (mounted once in server.js's
// consolidated /api gate) covers these routes exactly like every other
// write route — server.js's per-route `dealValidators.validateBody(...)`
// wiring is retired for the same reason (one rejection path, not two).
//
// zod 4.4.3 is the installed/pinned version (package.json) — schemas below
// use z.object(shape), which STRIPS unknown keys by default in v4 (no
// .strict()/.passthrough() call needed for D-13's "strip unknown" rule; see
// 03-RESEARCH.md Pitfall 5). `.trim()` is a native zod v4 string transform
// (verified against the installed version, not assumed from v3-era memory).

const { z } = require('zod');
const { formatIssues, validateBody, registerSchema } = require('./index');
// DD_AREA_IDS is imported (never redeclared) so this schema's z.enum() stays
// the single source of truth's own list — db/accessPolicy.js (Plan 01).
const { DD_AREA_IDS } = require('../db/accessPolicy');

const NAME_MAX = 200;
const USERNAME_MAX = 64;
const DEAL_ID_MAX = 120; // generous bound over newId('deal')'s actual length; D-13/Task-2 "no unbounded string" — a regex alone does not cap length

// db/dbFiles.js's DEAL_ID_RE, duplicated here (not required from dbFiles.js)
// so this validator has no dependency on the storage layer — a schema module
// should be able to reject a malformed id shape before any file-path
// resolution is ever attempted downstream.
const DEAL_ID_PATTERN = /^deal_[a-z0-9]+$/i;

// WIZ-01/D-05: the wizard's six optional "basics" fields — bounds MUST stay
// identical to validators/wizard.js's WizardBasicsSchema (that module's own
// header names this the reason its schema exists at all: D-07's "one rule
// set, never two"). `dealSizeM` accepts a number or a bounded numeric
// string, matching the union style validators/workstream.js's synergy
// schema already uses for its own money fields (targetM/realizedM).
const DEAL_TYPES = ['acquisition', 'jv', 'merger'];
const DATE_MAX = 10; // 'YYYY-MM-DD'
const CURRENCY_MAX = 10;

/** POST /api/deals — D-02 (admin/hrbp only, enforced by ROLE_WRITE_POLICY,
 * not here) create-deal body. `members` defaults to an empty array — the
 * creator is always added server-side (db/controlStore.js's createDeal()),
 * so an omitted members list still leaves the creator with access. */
const CreateDealSchema = z.object({
  name: z.string().trim().min(1, 'Deal name is required.').max(NAME_MAX, `Deal name must be ${NAME_MAX} characters or fewer.`),
  targetCompany: z.string().trim().min(1, 'Target company is required.').max(NAME_MAX, `Target company must be ${NAME_MAX} characters or fewer.`),
  members: z.array(z.string().trim().min(1).max(USERNAME_MAX)).default([]),
  dealType: z.enum(DEAL_TYPES).optional(),
  signingDate: z.string().trim().max(DATE_MAX).optional(),
  expectedClose: z.string().trim().max(DATE_MAX).optional(),
  day1Date: z.string().trim().max(DATE_MAX).optional(),
  dealSizeM: z.union([z.number(), z.string().max(20)]).optional(),
  currency: z.string().trim().max(CURRENCY_MAX).optional(),
});

/** POST /api/deals/select — D-01. `dealId: null` is the explicit
 * return-to-demo signal (a MISSING field is a validation error; an explicit
 * `null` is not — these are deliberately different states). */
const SelectDealSchema = z.object({
  dealId: z.union([
    z.string().max(DEAL_ID_MAX).regex(DEAL_ID_PATTERN, 'must be a valid deal id'),
    z.null(),
  ]),
});

/** POST /api/deals/:id/members — admin-only (enforced inline in server.js,
 * see its own comment on why ROLE_WRITE_POLICY's flat-prefix matcher cannot
 * express "admin-only for this one dynamic-segment route" declaratively). */
const DealMembersSchema = z.object({
  members: z.array(z.string().trim().min(1).max(USERNAME_MAX)),
});

/** POST /api/deals/:id/grants — DD-04/D-02/T-04-12. `ddAreas` is constrained
 * to a `z.enum` over DD_AREA_IDS (imported, never duplicated) so an unknown
 * area id 400s here, before the route handler or db/controlStore.js ever see
 * it; the array is capped at the taxonomy's own size — the same eight-area
 * bound that makes an unbounded-length payload impossible regardless of the
 * enum constraint alone. */
const DealGrantsSchema = z.object({
  username: z.string().trim().min(1, 'Username is required.').max(USERNAME_MAX),
  ddAreas: z.array(z.enum(DD_AREA_IDS)).max(DD_AREA_IDS.length),
});

const VDR_REF_MAX = 300;
const VDR_NOTE_MAX = 500;

/** POST /api/deals/:id/vdr-grants — DD-05/D-18. A structured, audited
 * data-room access-grant record: who was granted access (`username`, must
 * be a current deal member — enforced by the ROUTE HANDLER, which has the
 * deal object this schema does not), which data-room area/folder
 * (`vdrRef`, an operator-typed free-text reference into TE's own VDR, not
 * a URL — the per-item vdrLink above already carries the URL), and an
 * optional note. The record itself lives ONLY in the audit log — there is
 * no separate collection this schema also validates. */
const VdrGrantSchema = z.object({
  username: z.string().trim().min(1, 'Username is required.').max(USERNAME_MAX),
  vdrRef: z.string().trim().min(1, 'Data room reference is required.').max(VDR_REF_MAX),
  note: z.string().trim().max(VDR_NOTE_MAX).optional(),
});

/** POST /api/admin/deals/:id/archive and DELETE /api/admin/deals/:id — D-02's
 * destructive guard: the caller must submit the deal's own id as an explicit
 * confirmation value. This schema only proves `confirm` is present and a
 * non-empty string; the ROUTE HANDLER compares it against req.params.id,
 * since the schema itself has no access to the deal id being confirmed. */
const DeleteConfirmSchema = z.object({
  confirm: z.string().trim().min(1, 'A confirmation value is required.').max(DEAL_ID_MAX),
});

// formatIssues()/validateBody() are now defined once in validators/index.js
// and re-exported here unchanged — see this file's header comment.

// Register every route this module owns into the shared WRITE_SCHEMAS
// registry, so validators/index.js#validationMiddleware (the generic,
// path-resolved gate-level middleware) covers them exactly like every other
// write route in the app, with no per-route middleware needed in server.js.
registerSchema('POST', '/api/deals', CreateDealSchema);
registerSchema('POST', '/api/deals/select', SelectDealSchema);
registerSchema('POST', '/api/deals/:id/members', DealMembersSchema);
registerSchema('POST', '/api/deals/:id/grants', DealGrantsSchema);
registerSchema('POST', '/api/deals/:id/vdr-grants', VdrGrantSchema);
registerSchema('POST', '/api/admin/deals/:id/archive', DeleteConfirmSchema);
registerSchema('DELETE', '/api/admin/deals/:id', DeleteConfirmSchema);

module.exports = {
  CreateDealSchema, SelectDealSchema, DealMembersSchema, DealGrantsSchema, VdrGrantSchema, DeleteConfirmSchema,
  validateBody, formatIssues, DEAL_ID_PATTERN,
};
