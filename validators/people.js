// VAL-01: the people/HR resource group — employees, the lesson complete/
// uncomplete routes, merit award, Integration Leaders (hrbps), alerts,
// pulses and communications-send.
'use strict';

const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');

const NAME_MAX = 200;
const ID_MAX = 120;
const TEXT_MAX = 4000;
const EMAIL_MAX = 320; // RFC 5321 practical max

// ---------------------------------------------------------------------------
// POST /api/employees — { id, name, role, department, company, lang,
// isLeader, leaderRole, buddyName, buddyEmail }. name/role/department are
// required by the handler's own `if (!name || !role || !department)` check.
// ---------------------------------------------------------------------------
const EmployeeUpsertSchema = z.object({
  id: z.string().trim().max(ID_MAX).optional(),
  name: z.string().trim().min(1, 'Name is required.').max(NAME_MAX),
  role: z.string().trim().min(1, 'Role is required.').max(NAME_MAX),
  department: z.string().trim().min(1, 'Department is required.').max(NAME_MAX),
  company: z.string().trim().max(NAME_MAX).optional(),
  lang: z.string().trim().max(10).optional(),
  isLeader: z.union([z.boolean(), z.string().max(10)]).optional(),
  leaderRole: z.string().trim().max(NAME_MAX).optional(),
  buddyName: z.string().trim().max(NAME_MAX).optional(),
  buddyEmail: z.string().trim().max(EMAIL_MAX).optional(),
});
registerSchema('POST', '/api/employees', EmployeeUpsertSchema);
registerSchema('DELETE', '/api/employees/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// POST /api/employees/complete-lesson and .../uncomplete-lesson — identical
// { empId, lessonId } shape, both required by the handler's own check.
// ---------------------------------------------------------------------------
const CompleteLessonSchema = z.object({
  empId: z.string().trim().min(1, 'empId is required.').max(ID_MAX),
  lessonId: z.string().trim().min(1, 'lessonId is required.').max(ID_MAX),
});
registerSchema('POST', '/api/employees/complete-lesson', CompleteLessonSchema);
registerSchema('POST', '/api/employees/uncomplete-lesson', CompleteLessonSchema);

// ---------------------------------------------------------------------------
// POST /api/employees/get-or-create — { empId, name, role, department,
// company, isLeader, leaderRole, buddyName, buddyEmail }. [security] D-11-04 /
// AUTHZ-04 (R3 F-2): this was `GET /api/employees/get-or-create?...` — a GET
// that creates roster rows, so it bypassed BOTH ROLE_WRITE_POLICY and
// validationMiddleware (each keyed on write methods) and was triggerable by a
// plain cross-site link or <img>. Every field is optional and bounded; unknown
// keys are stripped by zod's default object behaviour. The handler (not this
// schema) decides which supplied values it honours for a restricted caller.
// ---------------------------------------------------------------------------
const EmployeeGetOrCreateSchema = z.object({
  empId: z.string().trim().max(ID_MAX).optional(),
  name: z.string().trim().max(NAME_MAX).optional(),
  role: z.string().trim().max(NAME_MAX).optional(),
  department: z.string().trim().max(NAME_MAX).optional(),
  company: z.string().trim().max(NAME_MAX).optional(),
  isLeader: z.union([z.boolean(), z.string().max(10)]).optional(),
  leaderRole: z.string().trim().max(NAME_MAX).optional(),
  buddyName: z.string().trim().max(NAME_MAX).optional(),
  buddyEmail: z.string().trim().max(EMAIL_MAX).optional(),
});
registerSchema('POST', '/api/employees/get-or-create', EmployeeGetOrCreateSchema);

// ---------------------------------------------------------------------------
// POST /api/employees/award-merit — { empId, points }. The handler's own
// `parseInt(points) || 50` fallback means any value is tolerated at
// runtime; the schema narrows to what the UI sends (empId required, points
// numeric-or-numeric-string).
// ---------------------------------------------------------------------------
const AwardMeritSchema = z.object({
  empId: z.string().trim().min(1, 'empId is required.').max(ID_MAX),
  points: z.union([z.number(), z.string().max(10)]).optional(),
});
registerSchema('POST', '/api/employees/award-merit', AwardMeritSchema);

// ---------------------------------------------------------------------------
// POST /api/hrbps — { id, name, email, assignedTracks, supportingTeams,
// role }. name/email required by the handler's own check.
// ---------------------------------------------------------------------------
const HrbpUpsertSchema = z.object({
  id: z.string().trim().max(ID_MAX).optional(),
  name: z.string().trim().min(1, 'Name is required.').max(NAME_MAX),
  email: z.string().trim().min(1, 'Email is required.').max(EMAIL_MAX),
  assignedTracks: z.array(z.string().max(120)).max(100).optional(),
  supportingTeams: z.array(z.string().max(120)).max(100).optional(),
  role: z.string().trim().max(60).optional(),
});
registerSchema('POST', '/api/hrbps', HrbpUpsertSchema);
registerSchema('DELETE', '/api/hrbps/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// POST /api/alerts — { id, title, message, type }, all three (title,
// message, type) required by the handler's own check.
// ---------------------------------------------------------------------------
const AlertUpsertSchema = z.object({
  id: z.string().trim().max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Title is required.').max(NAME_MAX),
  message: z.string().trim().min(1, 'Message is required.').max(TEXT_MAX),
  type: z.string().trim().min(1, 'Type is required.').max(60),
});
registerSchema('POST', '/api/alerts', AlertUpsertSchema);
registerSchema('DELETE', '/api/alerts/:id', EmptyBodySchema);

// ---------------------------------------------------------------------------
// POST /api/pulses — { employeeName, rating, comment, type }. employeeName
// and rating are required by the handler's own check; rating is coerced via
// `parseInt(rating) || 3` at runtime, so the schema accepts number-or-string.
// ---------------------------------------------------------------------------
const PulseCreateSchema = z.object({
  employeeName: z.string().trim().min(1, 'Employee name is required.').max(NAME_MAX),
  rating: z.union([z.number(), z.string().max(10)]),
  comment: z.string().max(TEXT_MAX).optional(),
  type: z.string().trim().max(60).optional(),
});
registerSchema('POST', '/api/pulses', PulseCreateSchema);

// ---------------------------------------------------------------------------
// POST /api/communications/send — { sender, senderRole, recipientType,
// recipientId, recipientEmail, recipientName, subject, template, body }.
// sender/recipientEmail/subject/body required by the handler's own check.
// `body` is stored plain text — compileHtmlEmail() (server.js) escapes every
// field itself before writing the sent-email HTML file, so this is
// deliberately NOT an htmlField() (VAL-02: tagging an already-escaped field
// would double-encode it, not add safety).
// ---------------------------------------------------------------------------
const CommunicationSendSchema = z.object({
  sender: z.string().trim().min(1, 'Sender is required.').max(NAME_MAX),
  senderRole: z.string().trim().max(60).optional(),
  recipientType: z.string().trim().max(60).optional(),
  recipientId: z.string().trim().max(ID_MAX).optional(),
  recipientEmail: z.string().trim().min(1, 'Recipient email is required.').max(EMAIL_MAX),
  recipientName: z.string().trim().max(NAME_MAX).optional(),
  subject: z.string().trim().min(1, 'Subject is required.').max(NAME_MAX),
  template: z.string().trim().max(60).optional(),
  body: z.string().min(1, 'Body is required.').max(TEXT_MAX * 5),
});
registerSchema('POST', '/api/communications/send', CommunicationSendSchema);
registerSchema('DELETE', '/api/communications/:id', EmptyBodySchema);

module.exports = {
  EmployeeUpsertSchema,
  EmployeeGetOrCreateSchema,
  CompleteLessonSchema,
  AwardMeritSchema,
  HrbpUpsertSchema,
  AlertUpsertSchema,
  PulseCreateSchema,
  CommunicationSendSchema,
};
