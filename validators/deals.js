// VAL-01 (first instance) / D-12 / D-13: zod schema validation for the
// /api/deals control-plane routes — the first validator module this codebase
// has (03-RESEARCH.md: "zero sanitize/schema-validation references in
// server.js" before this phase). Plan 06 generalizes this exact
// validateBody()/formatIssues() pipeline across the remaining ~60 write
// endpoints, so its shape here is the reusable contract, not a one-off.
//
// zod 4.4.3 is the installed/pinned version (package.json) — schemas below
// use z.object(shape), which STRIPS unknown keys by default in v4 (no
// .strict()/.passthrough() call needed for D-13's "strip unknown" rule; see
// 03-RESEARCH.md Pitfall 5). `.trim()` is a native zod v4 string transform
// (verified against the installed version, not assumed from v3-era memory).

const { z } = require('zod');

const NAME_MAX = 200;
const USERNAME_MAX = 64;

// db/dbFiles.js's DEAL_ID_RE, duplicated here (not required from dbFiles.js)
// so this validator has no dependency on the storage layer — a schema module
// should be able to reject a malformed id shape before any file-path
// resolution is ever attempted downstream.
const DEAL_ID_PATTERN = /^deal_[a-z0-9]+$/i;

/** POST /api/deals — D-02 (admin/hrbp only, enforced by ROLE_WRITE_POLICY,
 * not here) create-deal body. `members` defaults to an empty array — the
 * creator is always added server-side (db/controlStore.js's createDeal()),
 * so an omitted members list still leaves the creator with access. */
const CreateDealSchema = z.object({
  name: z.string().trim().min(1, 'Deal name is required.').max(NAME_MAX, `Deal name must be ${NAME_MAX} characters or fewer.`),
  targetCompany: z.string().trim().min(1, 'Target company is required.').max(NAME_MAX, `Target company must be ${NAME_MAX} characters or fewer.`),
  members: z.array(z.string().trim().min(1).max(USERNAME_MAX)).default([]),
});

/** POST /api/deals/select — D-01. `dealId: null` is the explicit
 * return-to-demo signal (a MISSING field is a validation error; an explicit
 * `null` is not — these are deliberately different states). */
const SelectDealSchema = z.object({
  dealId: z.union([
    z.string().regex(DEAL_ID_PATTERN, 'must be a valid deal id'),
    z.null(),
  ]),
});

/** POST /api/deals/:id/members — admin-only (enforced inline in server.js,
 * see its own comment on why ROLE_WRITE_POLICY's flat-prefix matcher cannot
 * express "admin-only for this one dynamic-segment route" declaratively). */
const DealMembersSchema = z.object({
  members: z.array(z.string().trim().min(1).max(USERNAME_MAX)),
});

/** POST /api/admin/deals/:id/archive and DELETE /api/admin/deals/:id — D-02's
 * destructive guard: the caller must submit the deal's own id as an explicit
 * confirmation value. This schema only proves `confirm` is present and a
 * non-empty string; the ROUTE HANDLER compares it against req.params.id,
 * since the schema itself has no access to the deal id being confirmed. */
const DeleteConfirmSchema = z.object({
  confirm: z.string().trim().min(1, 'A confirmation value is required.'),
});

/** Collapses a zod SafeParseError into ONE display string of
 * `path: message` segments — the existing single-string `{ error }` 400
 * shape every other endpoint in this codebase already uses (never an array).
 * Every message below is a zod built-in ("Too big: ...", "Invalid input:
 * expected string, received number", …) or one of the custom strings above —
 * none of them echo the submitted VALUE, only the field path and the rule it
 * broke, so a rejected field (which may carry MNPI, e.g. a target company
 * name) is never reflected back into a message that could be logged or
 * displayed out of context. */
function formatIssues(error) {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/** Express middleware factory: safeParse()s req.body against `schema`. On
 * failure, responds 400 with the existing `{ error: '...' }` shape (matching
 * server.js's ad hoc checks, e.g. "Department name is required."). On
 * success, REPLACES req.body with the parsed/stripped result — unknown keys
 * are already gone by the time the route handler runs (D-13), so a handler
 * that spreads `req.body` onto a stored record can never persist a field no
 * schema vetted. */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      return res.status(400).json({ error: formatIssues(result.error) });
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  CreateDealSchema, SelectDealSchema, DealMembersSchema, DeleteConfirmSchema,
  validateBody, formatIssues, DEAL_ID_PATTERN,
};
