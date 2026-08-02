// VAL-01: the assessment resource group — the legacy survey questions
// (+ reorder), the legacy assessment submission, and the Assessment Suite v2
// instances (templates are read-only via the CMS bundle — no POST route
// exists for them, so no schema is needed there).
'use strict';

const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');

const ID_MAX = 120;
const NAME_MAX = 200;

// ---------------------------------------------------------------------------
// POST /api/questions — { text, dimension, weight }, text+dimension
// required by the handler's own check.
// ---------------------------------------------------------------------------
const QuestionCreateSchema = z.object({
  text: z.string().trim().min(1, 'Text is required.').max(600),
  dimension: z.string().trim().min(1, 'Dimension is required.').max(60),
  weight: z.union([z.number(), z.string().max(10)]).optional(),
});
registerSchema('POST', '/api/questions', QuestionCreateSchema);

// POST /api/questions/:id — a partial update; the handler only applies keys
// that are `!== undefined`, so every field stays optional here (unlike
// create, where text/dimension are required).
const QuestionUpdateSchema = z.object({
  text: z.string().trim().min(1).max(600).optional(),
  dimension: z.string().trim().min(1).max(60).optional(),
  weight: z.union([z.number(), z.string().max(10)]).optional(),
});
registerSchema('POST', '/api/questions/:id', QuestionUpdateSchema);
registerSchema('DELETE', '/api/questions/:id', EmptyBodySchema);

// POST /api/questions/reorder — { questionIds: string[] }, required array.
const ReorderQuestionsSchema = z.object({
  questionIds: z.array(z.string().trim().max(ID_MAX)).max(2000, 'questionIds array is required.'),
});
registerSchema('POST', '/api/questions/reorder', ReorderQuestionsSchema);

// ---------------------------------------------------------------------------
// POST /api/assessment (legacy survey submission) — { responses: { [qId]:
// numeric-ish } }, non-empty required by the handler's own check.
// ---------------------------------------------------------------------------
const AssessmentSubmitSchema = z.object({
  responses: z.record(z.string().max(ID_MAX), z.union([z.number(), z.string().max(20)])).refine((obj) => Object.keys(obj).length > 0, {
    message: 'No survey responses provided.',
  }),
});
registerSchema('POST', '/api/assessment', AssessmentSubmitSchema);
registerSchema('DELETE', '/api/assessments/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// POST /api/assessment-instances (Assessment Suite v2) — { templateId,
// rater, respondentName, respondentRole, responses, retakeOf }. templateId +
// non-empty responses required by the handler's own check. `responses`
// values vary by question type (numeric likert/maturity, string sjt index,
// boolean checkbox) — bounded to a small union rather than z.any(), still
// no unbounded string.
// ---------------------------------------------------------------------------
const AssessmentInstanceSchema = z.object({
  templateId: z.string().trim().min(1, 'templateId and responses are required.').max(ID_MAX),
  rater: z.string().trim().max(60).optional(),
  respondentName: z.string().trim().max(120).optional(),
  respondentRole: z.string().trim().max(60).optional(),
  responses: z.record(z.string().max(ID_MAX), z.union([z.number(), z.string().max(200), z.boolean()])).refine((obj) => Object.keys(obj).length > 0, {
    message: 'templateId and responses are required.',
  }),
  retakeOf: z.string().trim().max(ID_MAX).optional(),
  // D-24/WIZ-01: an optional bounded id completing a PENDING instance
  // (assigned via POST /api/assessment-instances/assign below) in place —
  // see server.js's own handler comment for the full completion contract.
  instanceId: z.string().trim().max(ID_MAX).optional(),
});
registerSchema('POST', '/api/assessment-instances', AssessmentInstanceSchema);
registerSchema('DELETE', '/api/assessment-instances/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// POST /api/assessment-instances/assign (WIZ-01/D-24) — { templateId, owner,
// dueDate }. Creates a PENDING instance carrying no answers and no score at
// all — see server.js's handler for why the absence of a score field (not a
// zero) is what marks a row as pending.
// ---------------------------------------------------------------------------
const AssignAssessmentSchema = z.object({
  templateId: z.string().trim().min(1, 'templateId is required.').max(ID_MAX),
  owner: z.string().trim().min(1, 'owner is required.').max(120),
  dueDate: z.string().trim().min(1, 'dueDate is required.').max(10),
});
registerSchema('POST', '/api/assessment-instances/assign', AssignAssessmentSchema);

module.exports = {
  QuestionCreateSchema,
  QuestionUpdateSchema,
  ReorderQuestionsSchema,
  AssessmentSubmitSchema,
  AssessmentInstanceSchema,
  AssignAssessmentSchema,
};
