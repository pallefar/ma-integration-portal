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

const SynergyUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Initiative title is required.').max(NAME_MAX).optional(),
  category: z.string().trim().max(20).optional(),
  targetM: z.union([z.number(), z.string().max(20)]).optional(),
  realizedM: z.union([z.number(), z.string().max(20)]).optional(),
  owner: z.string().trim().max(NAME_MAX).optional(),
  workstreamId: z.string().trim().max(60).optional(),
  status: z.enum(SYN_STATUSES).optional(),
  notes: z.string().trim().max(TEXT_MAX).optional(),
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Initiative title is required.',
  path: ['title'],
});
registerSchema('POST', '/api/synergies', SynergyUpsertSchema);
registerSchema('DELETE', '/api/synergies/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// RAID entries — upsert (POST-create-only route; no id-present update path
// exists for RAID per server.js — kept consistent with the other three
// upsert-shaped lanes anyway since the handler DOES honor an incoming id).
// ---------------------------------------------------------------------------
const RAID_TYPES = ['risk', 'issue', 'decision', 'dependency'];
const RAID_LEVELS = ['low', 'medium', 'high'];
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
};
