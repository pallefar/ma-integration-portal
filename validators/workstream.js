// VAL-01: the delivery-surface resource group — integration tasks (+
// instantiate/from-remediation), RAID entries, synergies, departments,
// processes, modules, dashboard widget reordering. Registers every schema
// into the shared WRITE_SCHEMAS registry (validators/index.js) so
// validationMiddleware (mounted once in server.js's consolidated /api gate)
// covers these routes exactly like every other write route.
//
// Task 1 (tracer) landed ONLY DepartmentUpsertSchema here as the plan's
// representative end-to-end proof; Task 2 fills in the rest of this
// module's routes once the coverage reporter names them.
'use strict';

const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');

// D-13: every string field carries an explicit maximum — no exceptions,
// including free text (03-RESEARCH.md's Security Domain table: an unbounded
// field is an unbounded stored blob / DoS vector).
const NAME_MAX = 300;
const TEXT_MAX = 2000;
const ID_MAX = 120;

// ---------------------------------------------------------------------------
// Departments — public/js/admin-cms.js's editDepartment() always sends the
// FULL object (id?, name, icon, desc, phase, locked, systems[], trainings[])
// even for the lock-toggle-only save (it mutates the already-loaded list
// item in place before re-saving), so `name` required here matches every
// real UI flow — the handler's own ad hoc `if (!nameOk) return 400` check is
// removed below since this schema now owns that rule exclusively (Task 2's
// "one rejection path" principle, applied early here as the tracer proof).
// ---------------------------------------------------------------------------
const LineItemSchema = z.object({
  title: z.string().trim().max(200).default(''),
  desc: z.string().trim().max(TEXT_MAX).default(''),
});

const DepartmentUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  name: z.string().trim().min(1, 'Department name is required.').max(NAME_MAX),
  icon: z.string().trim().max(20).optional(),
  desc: z.string().trim().max(TEXT_MAX).optional(),
  phase: z.string().trim().max(120).optional(),
  locked: z.boolean().optional(),
  systems: z.array(LineItemSchema).max(200).optional(),
  trainings: z.array(LineItemSchema).max(200).optional(),
});

registerSchema('POST', '/api/departments', DepartmentUpsertSchema);
registerSchema('DELETE', '/api/departments/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// Processes — the sending→receiving transformation catalog
// (public/js/admin-cms.js's saveProcess()), one object per process, upsert
// by id, name required by the handler's own check.
// ---------------------------------------------------------------------------
const ProcessUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  name: z.string().trim().min(1, 'Process name is required.').max(NAME_MAX),
  domain: z.string().trim().max(120).optional(),
  approach: z.string().trim().max(60).optional(),
  status: z.string().trim().max(60).optional(),
  risk: z.string().trim().max(60).optional(),
  phase: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(TEXT_MAX).optional(),
  sending: z.record(z.string().max(60), z.union([z.string().max(TEXT_MAX), z.number(), z.boolean(), z.null()])).optional(),
  receiving: z.record(z.string().max(60), z.union([z.string().max(TEXT_MAX), z.number(), z.boolean(), z.null()])).optional(),
});
registerSchema('POST', '/api/processes', ProcessUpsertSchema);
registerSchema('DELETE', '/api/processes/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// Integration tasks — upsert by id (like departments/processes); on UPDATE
// (id present AND found) the handler itself already 400s for an
// out-of-enum status/phase, so this schema's enum constraint matches
// existing behaviour exactly rather than narrowing it. On CREATE the
// handler silently falls back to a default for an out-of-enum phase/status
// — the schema now rejects it instead (Rule 2: the real UI only ever sends
// a dropdown-derived valid value, so no working flow is affected).
// ---------------------------------------------------------------------------
const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
const TASK_PHASES = ['pre', 'day1', 'd30', 'd60', 'd100'];

const TaskUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Task title is required.').max(NAME_MAX).optional(),
  titleKey: z.string().trim().max(160).optional(),
  workstreamId: z.string().trim().max(60).optional(),
  phase: z.enum(TASK_PHASES).optional(),
  owner: z.string().trim().max(NAME_MAX).optional(),
  due: z.string().trim().max(30).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  source: z.string().trim().max(160).optional(),
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Task title is required.',
  path: ['title'],
});
registerSchema('POST', '/api/integration-tasks', TaskUpsertSchema);
registerSchema('DELETE', '/api/integration-tasks/:id', EmptyBodySchema);

const InstantiateTasksSchema = z.object({
  checklistTemplateId: z.string().trim().min(1, 'checklistTemplateId is required.').max(ID_MAX),
});
registerSchema('POST', '/api/integration-tasks/instantiate', InstantiateTasksSchema);

const FromRemediationSchema = z.object({
  assessmentTemplateId: z.string().trim().min(1, 'assessmentTemplateId is required.').max(ID_MAX),
});
registerSchema('POST', '/api/integration-tasks/from-remediation', FromRemediationSchema);

// ---------------------------------------------------------------------------
// Synergy initiatives — upsert by id, title required (create) / enum-checked
// status (update), same shape-preserving rationale as tasks above.
// ---------------------------------------------------------------------------
const SYN_STATUSES = ['identified', 'validated', 'planned', 'executing', 'realized'];

// SYN-01/D-24: month-shape validator mirroring validators/dd.js's
// isValidCalendarDate .refine() idiom — a phasing row's identity is its
// month string ('YYYY-MM'), so this is the ONE place both the row schema and
// the generate/per-month sub-route schemas anchor their month validation to.
// No day-of-month arithmetic, unlike the calendar-date validator.
const MONTH_SHAPE_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
function isValidMonth(value) {
  return typeof value === 'string' && MONTH_SHAPE_RE.test(value);
}

const SynMoneyUnion = z.union([z.number(), z.string().max(20)]);

// D-25: a phasing row's identity is its `month`; targetM/realizedM mirror
// the existing targetM/realizedM union style used elsewhere in this file.
const PhasingRowSchema = z.object({
  month: z.string().trim().refine(isValidMonth, { message: 'Phasing row month must be a valid YYYY-MM month.' }),
  targetM: SynMoneyUnion.optional(),
  realizedM: SynMoneyUnion.optional(),
});

// D-01/D-02/D-03/D-05/D-24: the ramp auto-fill input body for
// POST /api/synergies/:id/generate-phasing. runRateM is the steady-state
// ANNUAL figure (D-02, never the sum of the generated rows); startMonth
// anchors the generated horizon; curveShape selects one of the three fixed
// checkpoint tables server.js's RAMP_CURVES defines.
const GeneratePhasingSchema = z.object({
  runRateM: SynMoneyUnion,
  startMonth: z.string().trim().refine(isValidMonth, { message: 'Start month must be a valid YYYY-MM month.' }),
  curveShape: z.enum(['cost', 'revenue', 'linear']),
});

const SynergyUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Initiative title is required.').max(NAME_MAX).optional(),
  category: z.string().trim().max(20).optional(),
  targetM: SynMoneyUnion.optional(),
  realizedM: SynMoneyUnion.optional(),
  owner: z.string().trim().max(NAME_MAX).optional(),
  workstreamId: z.string().trim().max(60).optional(),
  status: z.enum(SYN_STATUSES).optional(),
  notes: z.string().trim().max(TEXT_MAX).optional(),
  // SYN-01/D-01: the ramp inputs, also stamped by the dedicated
  // generate-phasing route — accepted here too since the base upsert schema
  // is the one place every synergy field is validated; server.js's own
  // derived-rollup guard (D-04) is what actually prevents a client from
  // forging targetM/realizedM once phasing rows exist, not this schema.
  runRateM: SynMoneyUnion.optional(),
  startMonth: z.string().trim().refine((val) => val === '' || isValidMonth(val), {
    message: 'Start month must be a valid YYYY-MM month.',
  }).optional(),
  curveShape: z.enum(['cost', 'revenue', 'linear']).optional(),
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Initiative title is required.',
  path: ['title'],
});
registerSchema('POST', '/api/synergies', SynergyUpsertSchema);
registerSchema('DELETE', '/api/synergies/:id', EmptyBodySchema);
// SYN-01/Pitfall 4: schema registration lands in the SAME edit as the route
// (server.js) — an unregistered route 500s at request time regardless of
// how correct the handler itself is.
registerSchema('POST', '/api/synergies/:id/generate-phasing', GeneratePhasingSchema);

// ---------------------------------------------------------------------------
// RAID entries — upsert (POST-create-only route; no id-present update path
// exists for RAID per server.js — kept consistent with the other three
// upsert-shaped lanes anyway since the handler DOES honor an incoming id).
// ---------------------------------------------------------------------------
const RAID_TYPES = ['risk', 'issue', 'decision', 'dependency'];
// D-26: four levels — an INDEPENDENT COPY of server.js's own RAID_LEVELS
// (the RAID route handler's field guard), not a shared import. The two MUST
// move together: a partial change here without the matching server.js edit
// would make this validator's enum disagree with the handler's own guard
// about what a valid severity is. Also governs `probability` below (the
// SAME enum for both fields) — widening it is deliberate and strictly
// additive: a four-level probability scale accepts everything the previous
// three-level one did, plus `critical`.
const RAID_LEVELS = ['low', 'medium', 'high', 'critical'];
const RAID_STATUSES = ['open', 'mitigating', 'closed'];

const RaidUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Entry title is required.').max(NAME_MAX).optional(),
  type: z.enum(RAID_TYPES).optional(),
  severity: z.enum(RAID_LEVELS).optional(),
  probability: z.enum(RAID_LEVELS).optional(),
  owner: z.string().trim().max(NAME_MAX).optional(),
  workstreamId: z.string().trim().max(60).optional(),
  status: z.enum(RAID_STATUSES).optional(),
  notes: z.string().trim().max(TEXT_MAX).optional(),
  // D-12: the reverse half of a bidirectional DD-finding<->RAID link — see
  // server.js's POST /api/dd/findings/:id/convert.
  source: z.string().trim().max(160).optional(),
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Entry title is required.',
  path: ['title'],
});
registerSchema('POST', '/api/raid', RaidUpsertSchema);
registerSchema('DELETE', '/api/raid/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// Modules (legacy "NEW M&A INTEGRATION DECK" CRUD) — title, dimension,
// urgency, description all required by the handler's own check.
// ---------------------------------------------------------------------------
const ModuleUpsertSchema = z.object({
  id: z.string().trim().max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Title, dimension, urgency, and description are required.').max(NAME_MAX),
  dimension: z.string().trim().min(1).max(60),
  urgency: z.string().trim().min(1).max(60),
  minScore: z.union([z.number(), z.string().max(20)]).optional(),
  maxScore: z.union([z.number(), z.string().max(20)]).optional(),
  description: z.string().trim().min(1).max(TEXT_MAX),
  playbookLink: z.string().trim().max(2000).optional(),
  supportingTeams: z.string().trim().max(NAME_MAX).optional(),
});
registerSchema('POST', '/api/modules', ModuleUpsertSchema);
registerSchema('DELETE', '/api/modules/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// Dashboard widget reordering — { layoutOrder: string[] }, required array.
// ---------------------------------------------------------------------------
const ReorderWidgetsSchema = z.object({
  layoutOrder: z.array(z.string().trim().max(ID_MAX)).max(200, 'layoutOrder array is required.'),
});
registerSchema('POST', '/api/dashboard/reorder-widgets', ReorderWidgetsSchema);

module.exports = {
  LineItemSchema,
  DepartmentUpsertSchema,
  ProcessUpsertSchema,
  TaskUpsertSchema,
  InstantiateTasksSchema,
  FromRemediationSchema,
  SynergyUpsertSchema,
  RaidUpsertSchema,
  ModuleUpsertSchema,
  ReorderWidgetsSchema,
  RAID_LEVELS,
  MONTH_SHAPE_RE,
  isValidMonth,
  PhasingRowSchema,
  GeneratePhasingSchema,
};
