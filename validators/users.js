// D-10-03 (Phase 10): admin user-management write schemas — the
// /api/admin/users create / PATCH / reset-password routes and the self-service
// DELETE /api/auth/sessions/:id. Required from server.js for its
// registerSchema() side effect only.
//
// [security] Every schema is a plain z.object, so the validation pipeline
// STRIPS unknown keys (validators/index.js applies result.data, never the raw
// body): a client cannot mass-assign `hash`, `salt`, `mustChangePassword`,
// `username` (on PATCH), `createdBy` etc. through these routes (T-10-15).
'use strict';

const { z } = require('zod');
const { registerSchema, EmptyBodySchema } = require('./index');

// Usernames double as the control.db primary key and appear in audit actors
// ('cli:<os-user>' / 'system:*'), so the charset excludes ':' and whitespace
// and the break-glass / system identities are reserved (T-10-18).
const RESERVED_USERNAMES = ['admin-token', 'system'];
const USERNAME = z.string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'Username must be 3-40 characters: letters, digits, dot, underscore or hyphen.')
  .refine((u) => !RESERVED_USERNAMES.includes(u), { message: 'That username is reserved.' });

const ROLE = z.enum(['admin', 'hrbp', 'pmo', 'employee']);
const DISPLAY_NAME = z.string().trim().min(1, 'Name is required.').max(120);

// The password POLICY (length, published-demo-password refusal) is applied by
// the handler via lib/passwords.js checkNewPassword() because it depends on the
// resolved mode; the schema only bounds the shape.
const CreateUserSchema = z.object({
  username: USERNAME,
  name: DISPLAY_NAME,
  role: ROLE,
  tempPassword: z.string().max(500).optional(),
});
registerSchema('POST', '/api/admin/users', CreateUserSchema);

const PatchUserSchema = z.object({
  role: ROLE.optional(),
  name: DISPLAY_NAME.optional(),
  disabled: z.boolean().optional(),
}).refine((v) => v.role !== undefined || v.name !== undefined || v.disabled !== undefined, {
  message: 'Provide at least one of role, name or disabled.',
});
registerSchema('PATCH', '/api/admin/users/:username', PatchUserSchema);

const ResetPasswordSchema = z.object({
  tempPassword: z.string().max(500).optional(),
});
registerSchema('POST', '/api/admin/users/:username/reset-password', ResetPasswordSchema);

// Ending one of the caller's own sessions takes no body.
registerSchema('DELETE', '/api/auth/sessions/:id', EmptyBodySchema);

module.exports = { CreateUserSchema, PatchUserSchema, ResetPasswordSchema, RESERVED_USERNAMES };
