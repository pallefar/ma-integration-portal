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
});
registerSchema('POST', '/api/settings', SettingsUpdateSchema);

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

registerSchema('POST', '/api/admin/users/:username/revoke-sessions', EmptyBodySchema);

module.exports = {
  ChangePasswordSchema,
  TimeTravelSchema,
  SettingsUpdateSchema,
  ProjectCreateSchema,
  RagUploadSchema,
  MigrateDbSchema,
};
