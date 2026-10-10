// VAL-01: the settings/admin/project-lifecycle resource group — app
// settings, the new-M&A intake reset, time-travel, projects and project
// activation, the RAG PDF upload route, the admin migrate-db and
// revoke-sessions routes, and self-service change-password (D-14: the same
// pipeline validates this route whether the caller is demo-bound or
// deal-bound — change-password itself never touches a deal database, but
// the schema-registry coverage requirement applies uniformly regardless).
'use strict';

const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');

const NAME_MAX = 300;
const TEXT_MAX = 4000;
const LARGE_BLOB_MAX = 70000000; // base64 payload text — bounded, not unbounded (D-13); the app-wide express.json 50mb limit is the practical ceiling

// ---------------------------------------------------------------------------
// POST /api/auth/change-password — the handler's own inline check
// (`typeof newPassword !== 'string' || newPassword.length < 8`) becomes this
// schema's rule; `currentPassword` stays untyped-but-bounded since the
// handler treats a wrong/absent value as an ordinary 401, not a 400.
// ---------------------------------------------------------------------------
const ChangePasswordSchema = z.object({
  currentPassword: z.string().max(500).optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.').max(500),
});
registerSchema('POST', '/api/auth/change-password', ChangePasswordSchema);

// ---------------------------------------------------------------------------
// POST /api/settings/time-travel — { day }, the handler's own
// `parseInt(day) || 30` fallback means ANY value is tolerated at runtime;
// the schema narrows to what the demo-day UI actually sends (an integer).
// ---------------------------------------------------------------------------
const TimeTravelSchema = z.object({
  day: z.union([z.number(), z.string().max(10)]),
});
registerSchema('POST', '/api/settings/time-travel', TimeTravelSchema);

// ---------------------------------------------------------------------------
// POST /api/settings — a config bag. The handler iterates EVERY key in
// req.body and assigns it verbatim onto the settings object (or routes
// geminiApiKey/databaseConfig.connectionDetails to runtime.db's secret
// store) — D-13 requires unknown keys stripped, so this schema enumerates
// every key the real admin UI (public/js/admin.js) is observed to send
// today. A future settings key needs a corresponding addition here — this
// is a known, intentional extension point (documented rather than opened
// with a catchall, which would defeat D-13's "nothing unvetted reaches
// storage" guarantee for this endpoint).
// ---------------------------------------------------------------------------
const RoleVisibilitySchema = z.object({
  pmo: z.boolean().optional(),
  hrbp: z.boolean().optional(),
  supporting: z.boolean().optional(),
  employee: z.boolean().optional(),
  leaders: z.boolean().optional(),
  admin: z.boolean().optional(),
}).optional();

const DatabaseConfigSchema = z.object({
  provider: z.string().trim().max(60).optional(),
  connectionDetails: z.string().max(LARGE_BLOB_MAX).optional(),
}).optional();

const SettingsUpdateSchema = z.object({
  demoMode: z.union([z.boolean(), z.string().max(10)]).optional(),
  targetCompany: z.string().max(NAME_MAX).optional(),
  sector: z.string().max(NAME_MAX).optional(),
  size: z.string().max(120).optional(),
  hq: z.string().max(NAME_MAX).optional(),
  acquisitionDate: z.string().max(40).optional(),
  synergyObjective: z.string().max(TEXT_MAX).optional(),
  geminiApiKey: z.string().max(500).optional(),
  browserModel: z.string().max(120).optional(),
  welcomeVideoType: z.string().max(20).optional(),
  welcomeVideoUrl: z.string().max(2000).optional(),
  welcomeVideoType_en: z.string().max(20).optional(),
  welcomeVideoUrl_en: z.string().max(2000).optional(),
  welcomeVideoType_de: z.string().max(20).optional(),
  welcomeVideoUrl_de: z.string().max(2000).optional(),
  welcomeVideoType_zh: z.string().max(20).optional(),
  welcomeVideoUrl_zh: z.string().max(2000).optional(),
  welcomeVideoType_cs: z.string().max(20).optional(),
  welcomeVideoUrl_cs: z.string().max(2000).optional(),
  roleVisibility: RoleVisibilitySchema,
  doomGloballyEnabled: z.boolean().optional(),
  doomUnlockXp: z.union([z.number(), z.string().max(10)]).optional(),
  floatingMenuEnabled: z.boolean().optional(),
  databaseConfig: DatabaseConfigSchema,
  // SYN-05/D-17: the per-deal staleness threshold, in days, read by
  // server.js's synergyStaleDays(). SYN-01/D-03: the per-deal phasing
  // horizon, in years, read by server.js's synergyHorizonYears() — schema
  // accepted since Plan 01 but never enumerated here, so it was silently
  // stripped by this schema's own explicit-enumeration rule (D-13) on every
  // write until now. Without both keys enumerated here, zod's object parse
  // silently strips them and the per-deal configurability D-03/D-17 promise
  // fails invisibly.
  // WR-03: capped at 365 days on the top end — an unbounded value had the
  // IDENTICAL effect synergyStaleDays()'s own comment warns against for the
  // near-zero direction (T-05-27): a huge configured value makes every
  // initiative read as fresh forever, permanently suppressing SYN-05's
  // governance signal. Deliberately NO floor added here (unlike CR-01's
  // synergyHorizonYears bound) — the reader's own `configured > 0` check
  // already handles the near-zero direction, and test/synergy-staleness.test.js
  // legitimately relies on sub-1-day thresholds to make a just-created item
  // read as stale without waiting real time. D-17's per-deal configurability
  // (any positive value) is preserved — only the ceiling is new.
  synergyStaleDays: z.union([z.number().max(365), z.string().max(10)]).optional(),
  // CR-01: bounded 1-15 years — an unbounded value let generatePhasingRows()
  // synchronously allocate horizonYears*12 rows on the request thread,
  // hanging/OOM-crashing the single-threaded process for every deal on the
  // shared host (CLAUDE.md: "the data layer must be concurrency-safe from
  // day one"). server.js's synergyHorizonYears() reader clamps defensively
  // too, since this schema alone cannot bound a value already stored before
  // this fix shipped.
  synergyHorizonYears: z.union([z.number().min(1).max(15), z.string().max(10)]).optional(),
});
registerSchema('POST', '/api/settings', SettingsUpdateSchema);

// ---------------------------------------------------------------------------
// GET /api/settings — the public (non-admin) subset. [security] D-11-02 /
// AUTHZ-02 / T-11-11 (Phase 11): an ALLOWLIST, not a blocklist — every
// non-admin caller (pmo, hrbp, employee, and the anonymous DEMO_OPEN showcase)
// receives ONLY these keys, so a future secret-ish settings key is withheld by
// default instead of leaking until someone remembers to add it to a delete
// list. The admin response is unchanged (server.js publicSettings()).
//
// Every entry names the non-admin reader that needs it (a key with no reader
// does not belong here). test/settings-public-subset.test.js scans the client
// code and fails when a page reads a settings key that is neither listed here
// nor declared admin-only there.
//   demoMode              pmo.js / admin.js mode toggle, wizard-vs-dashboard routing
//   targetCompany, sector,
//   size, hq,
//   acquisitionDate,
//   synergyObjective      app.js sidebar target card, transitions.js profile
//                         dropdown, dashboard.js coaching corner + process flow
//   welcomeVideoType,
//   welcomeVideoUrl and
//   the _en/_de/_zh/_cs
//   variants              employee.js welcome-video player
//   roleVisibility        index.html showcase cards, transitions.js role switcher
//   doomGloballyEnabled,
//   doomUnlockXp          employee.js TEd game gate (floating-menu XP unlock)
//   floatingMenuEnabled   transitions.js unified assistant Navigation tab
//   timeTravelDay,
//   timelineDay           transitions.js day badge, employee.js calendar,
//                         dashboard.js diagnostics, signage.js timeline, pmo.js
//   dashboardLayoutOrder  dashboard.js widget order (written by reorder-widgets)
//   pmoCustomSetupComplete pmo.js custom-deal setup gate
//   browserModel          transitions.js AI-Insight prompt: only whether a model
//                         is configured; a model identifier, not a credential
//   synergyStaleDays,
//   synergyHorizonYears   instance defaults for the synergy staleness/phasing
//                         readers (deal-level values live on the deal record)
//   egress                { gemini, huggingface, youtube } booleans (SAFE-06 / D-13-05):
//                         which third-party channels the admin has switched on -
//                         the AI-insight, browser-model and video clients read it
//                         to hide/disable the feature; booleans only, no secret
//   hasGeminiApiKey       boolean capability flag — admin.js hint; the value of
//                         the key itself is NEVER included
// Deliberately absent: geminiApiKey, databaseConfig (provider + connection
// details are admin-console only).
// ---------------------------------------------------------------------------
const PUBLIC_SETTINGS_KEYS = Object.freeze([
  'demoMode',
  'targetCompany', 'sector', 'size', 'hq', 'acquisitionDate', 'synergyObjective',
  'welcomeVideoType', 'welcomeVideoUrl',
  'welcomeVideoType_en', 'welcomeVideoUrl_en',
  'welcomeVideoType_de', 'welcomeVideoUrl_de',
  'welcomeVideoType_zh', 'welcomeVideoUrl_zh',
  'welcomeVideoType_cs', 'welcomeVideoUrl_cs',
  'roleVisibility',
  'doomGloballyEnabled', 'doomUnlockXp',
  'floatingMenuEnabled',
  'timeTravelDay', 'timelineDay',
  'dashboardLayoutOrder',
  'pmoCustomSetupComplete',
  'browserModel',
  'synergyStaleDays', 'synergyHorizonYears',
  'hasGeminiApiKey',
  'egress',
]);

registerSchema('POST', '/api/settings/new-ma', EmptyBodySchema);

// ---------------------------------------------------------------------------
// POST /api/projects — the admin intake wizard (public/js/admin-cms.js).
// ---------------------------------------------------------------------------
const ProjectCreateSchema = z.object({
  name: z.string().trim().min(1, 'Project name / target company is required.').max(NAME_MAX).optional(),
  targetCompany: z.string().trim().max(NAME_MAX).optional(),
  sector: z.string().trim().max(NAME_MAX).optional(),
  size: z.string().trim().max(120).optional(),
  hq: z.string().trim().max(NAME_MAX).optional(),
  acquisitionDate: z.string().trim().max(40).optional(),
  synergyObjective: z.string().trim().max(TEXT_MAX).optional(),
  sourceProjectId: z.string().trim().max(120).optional(),
  intake: z.record(z.string().max(60), z.string().max(2000)).optional(),
}).refine((data) => !!(data.name || '').trim() || !!(data.targetCompany || '').trim(), {
  message: 'name: Project name / target company is required.',
  path: ['name'],
});
registerSchema('POST', '/api/projects', ProjectCreateSchema);
registerSchema('POST', '/api/projects/:id/activate', EmptyBodySchema);
registerSchema('DELETE', '/api/projects/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// POST /api/rag/upload — metadata + the declared PDF payload (base64 text).
// Per the plan's own instruction: validate the metadata fields and the
// declared size/type, not the binary content itself — the existing 50mb
// express.json limit remains the practical ceiling; LARGE_BLOB_MAX exists so
// this string field is not literally unbounded (D-13), matching the
// app-wide size budget rather than re-deriving a tighter one.
// ---------------------------------------------------------------------------
const RagUploadSchema = z.object({
  fileName: z.string().trim().min(1, 'fileName is required.').max(300),
  fileData: z.string().min(1, 'fileData is required.').max(LARGE_BLOB_MAX),
});
registerSchema('POST', '/api/rag/upload', RagUploadSchema);

// ---------------------------------------------------------------------------
// POST /api/admin/migrate-db — { provider, connectionDetails }.
// ---------------------------------------------------------------------------
const MigrateDbSchema = z.object({
  provider: z.string().trim().min(1, 'Database provider is required.').max(60),
  connectionDetails: z.record(z.string().max(120), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).optional(),
});
registerSchema('POST', '/api/admin/migrate-db', MigrateDbSchema);

// ---------------------------------------------------------------------------
// POST /api/admin/egress — SAFE-06 / D-13-05: the instance egress switch. A
// STRICT object of optional booleans: an unknown key or a non-boolean is a 400,
// never silently stripped (a typo must not look like it worked).
// ---------------------------------------------------------------------------
const EgressUpdateSchema = z.object({
  gemini: z.boolean().optional(),
  huggingface: z.boolean().optional(),
  youtube: z.boolean().optional(),
}).strict();
registerSchema('POST', '/api/admin/egress', EgressUpdateSchema);

registerSchema('POST', '/api/admin/users/:username/revoke-sessions', EmptyBodySchema);

module.exports = {
  PUBLIC_SETTINGS_KEYS,
  ChangePasswordSchema,
  TimeTravelSchema,
  SettingsUpdateSchema,
  ProjectCreateSchema,
  RagUploadSchema,
  MigrateDbSchema,
  EgressUpdateSchema,
};
