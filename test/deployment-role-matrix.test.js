// AUTHZ-01/02 documentation guard (Phase 11, plan 11-08): the operator-facing
// role matrix in DEPLOYMENT.md ("Roles and what they can read") must say what the
// server actually enforces. Three tables are checked against the code:
//
//   1. the READ table against lib/readPolicy.js ROLE_READ_POLICY - row for row, in
//      order (first match wins, so order is part of the contract), identical
//      prefix, exact flag and role set;
//   2. the admin-only WRITE table against the live write gate
//      (roleAllowedForWrite from server.js);
//   3. the deal-level setup bounds against validators/wizard.js DealSettingsSchema.
//
// A comparator is exercised against deliberately drifted copies of the table, so
// "the guard fails on drift in either direction" is itself a tested property.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// server.js is required only to read its exported write-gate; every MA_* path is
// pointed at a throwaway directory first (the committed data/*.db is never
// opened, and the denial auditor's audit.db is isolated).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deployment-role-matrix-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = '';
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN']) delete process.env[key];

const { ROLE_READ_POLICY } = require('../lib/readPolicy.js');
const { DealSettingsSchema } = require('../validators/wizard.js');
const app = require('../server.js');

const DOC = fs.readFileSync(path.join(__dirname, '..', 'DEPLOYMENT.md'), 'utf8');
const ROLES = ['admin', 'hrbp', 'pmo', 'employee'];

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ------------------------------------------------------------- markdown parse
function sectionOf(md, heading) {
  const start = md.indexOf(heading);
  assert.ok(start !== -1, `DEPLOYMENT.md has no "${heading}" heading`);
  const level = /^#+/.exec(heading)[0].length;
  const rest = md.slice(start + heading.length);
  const next = new RegExp(`\\n#{1,${level}} `).exec(rest);
  return rest.slice(0, next ? next.index : rest.length);
}

/** Parses the first pipe table in `md` into { header: string[], rows: string[][] }. */
function firstTable(md) {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length && !/^\|.*\|\s*$/.test(lines[i])) i += 1;
  assert.ok(i < lines.length, 'no markdown table found');
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const header = cells(lines[i]);
  assert.ok(/^\|[\s|:-]+\|\s*$/.test(lines[i + 1]), 'table has no separator row');
  const rows = [];
  for (let j = i + 2; j < lines.length && /^\|.*\|\s*$/.test(lines[j]); j++) rows.push(cells(lines[j]));
  return { header, rows };
}

function parseReadTable() {
  const section = sectionOf(DOC, '## Roles and what they can read');
  const { header, rows } = firstTable(section);
  const col = (role) => header.findIndex((h) => h.toLowerCase().startsWith(role));
  const idx = {};
  for (const r of ROLES) {
    idx[r] = col(r);
    assert.ok(idx[r] > 0, `read table has no "${r}" column`);
  }
  assert.ok(/^route/i.test(header[0]), 'first column must be the route prefix');
  return rows.map((cells) => {
    const m = /^`([^`]+)`(\s+\(exact\))?$/.exec(cells[0]);
    assert.ok(m, `route cell must be \`prefix\` or \`prefix\` (exact): ${cells[0]}`);
    const roles = ROLES.filter((r) => {
      const v = cells[idx[r]].toLowerCase();
      assert.ok(v === 'yes' || v === 'no', `role cell must be yes|no, got "${cells[idx[r]]}" in ${cells[0]}`);
      return v === 'yes';
    });
    return { prefix: m[1], exact: !!m[2], roles, why: cells[cells.length - 1] };
  });
}

/** Problems between documented rows and the policy table (empty = in sync). */
function diffReadTable(docRows, policy) {
  const problems = [];
  const key = (r) => `${r.prefix}${r.exact ? ' (exact)' : ''}`;
  const policyKeys = policy.map((r) => key({ prefix: r.prefix, exact: !!r.exact }));
  docRows.forEach((d) => {
    if (!policyKeys.includes(key(d))) problems.push(`documented row has no policy rule: ${key(d)}`);
  });
  policy.forEach((p) => {
    const k = key({ prefix: p.prefix, exact: !!p.exact });
    if (!docRows.some((d) => key(d) === k)) problems.push(`policy rule is not documented: ${k}`);
  });
  const n = Math.min(docRows.length, policy.length);
  for (let i = 0; i < n; i++) {
    const d = docRows[i];
    const p = policy[i];
    if (key(d) !== key({ prefix: p.prefix, exact: !!p.exact })) {
      problems.push(`row ${i + 1} out of order: documented ${key(d)}, policy ${p.prefix}${p.exact ? ' (exact)' : ''}`);
      continue;
    }
    const want = ROLES.filter((r) => p.roles.includes(r)).join(',');
    const got = d.roles.join(',');
    if (want !== got) problems.push(`${key(d)}: documented roles [${got}] but the policy allows [${want}]`);
    if (!d.why) problems.push(`${key(d)}: the Why cell is empty`);
  }
  if (docRows.length !== policy.length) problems.push(`row count ${docRows.length} != policy rule count ${policy.length}`);
  return problems;
}

// ------------------------------------------------------------------- the read table
test('the documented read table matches lib/readPolicy.js row for row, in order', () => {
  const docRows = parseReadTable();
  assert.deepStrictEqual(diffReadTable(docRows, ROLE_READ_POLICY), []);
  assert.strictEqual(docRows.length, ROLE_READ_POLICY.length);
});

test('the comparator fails on drift in either direction (negative controls)', () => {
  const docRows = parseReadTable();
  const clone = () => docRows.map((r) => ({ ...r, roles: r.roles.slice() }));

  const missing = clone(); missing.splice(5, 1);
  assert.ok(diffReadTable(missing, ROLE_READ_POLICY).some((p) => /policy rule is not documented/.test(p)), 'a dropped row must be reported');

  const extra = clone(); extra.push({ prefix: '/api/zz-undocumented', exact: false, roles: ['admin'], why: 'x' });
  assert.ok(diffReadTable(extra, ROLE_READ_POLICY).some((p) => /documented row has no policy rule/.test(p)), 'an invented row must be reported');

  const widened = clone();
  const syn = widened.find((r) => r.prefix === '/api/synergies');
  syn.roles = ROLES.slice();
  assert.ok(diffReadTable(widened, ROLE_READ_POLICY).some((p) => /\/api\/synergies: documented roles/.test(p)), 'a widened role set must be reported');

  const narrowed = clone();
  narrowed.find((r) => r.prefix === '/api/courses').roles = ['admin'];
  assert.ok(diffReadTable(narrowed, ROLE_READ_POLICY).some((p) => /\/api\/courses: documented roles/.test(p)), 'a narrowed role set must be reported');

  const swapped = clone();
  [swapped[4], swapped[5]] = [swapped[5], swapped[4]];
  assert.ok(diffReadTable(swapped, ROLE_READ_POLICY).some((p) => /out of order/.test(p)), 'a reordering must be reported');

  const policyDrift = ROLE_READ_POLICY.map((r) => ({ ...r, roles: r.roles.slice() }));
  policyDrift.find((r) => r.prefix === '/api/hrbps').roles = ['admin', 'hrbp', 'pmo'];
  assert.ok(diffReadTable(docRows, policyDrift).some((p) => /\/api\/hrbps: documented roles/.test(p)), 'a policy change without a doc change must be reported');
});

test('the exact-flag rows are the two /api/deals rules and nothing is documented twice', () => {
  const docRows = parseReadTable();
  const keys = docRows.map((r) => r.prefix + (r.exact ? '|exact' : ''));
  assert.strictEqual(new Set(keys).size, keys.length, 'a rule is documented twice');
  assert.deepStrictEqual(docRows.filter((r) => r.exact).map((r) => r.prefix), ROLE_READ_POLICY.filter((r) => r.exact).map((r) => r.prefix));
});

// ----------------------------------------------------------- admin-only writes
test('every route in the documented admin-only write table is refused to non-admins for POST and DELETE, and allowed to admin', () => {
  const section = sectionOf(DOC, '### Configuration and content are admin-only to write');
  const { header, rows } = firstTable(section);
  assert.ok(/^write route/i.test(header[0]));
  const prefixes = rows.map((r) => {
    const m = /^`([^`]+)`$/.exec(r[0]);
    assert.ok(m, `write route cell must be a single code span: ${r[0]}`);
    return m[1];
  });
  assert.deepStrictEqual(prefixes.slice().sort(),
    ['/api/banners', '/api/courses', '/api/i18n', '/api/media', '/api/menus', '/api/pages', '/api/settings', '/api/slides'],
    'the documented write table lists exactly the admin-only configuration and content prefixes');
  const allowed = app.roleAllowedForWrite;
  assert.strictEqual(typeof allowed, 'function', 'server.js must export roleAllowedForWrite');
  for (const p of prefixes) {
    for (const method of ['POST', 'DELETE']) {
      assert.strictEqual(allowed('admin', p, method), true, `admin must be allowed ${method} ${p}`);
      for (const role of ['hrbp', 'pmo', 'employee']) {
        assert.strictEqual(allowed(role, p, method), false, `${role} must be refused ${method} ${p}`);
      }
    }
  }
  // the documented sub-routes ride the same rule
  for (const sub of ['/api/settings/new-ma', '/api/slides/upload', '/api/courses/c1/lessons']) {
    assert.strictEqual(allowed('pmo', sub, 'POST'), false, `pmo must be refused POST ${sub}`);
  }
  // the one documented exception
  assert.strictEqual(allowed('pmo', '/api/settings/time-travel', 'POST'), true, 'time-travel stays staff-writable (demo-only)');
});

// --------------------------------------------------------- deal-level settings
test('the documented deal-level bounds are the schema bounds', () => {
  const section = sectionOf(DOC, "### Deal-level values: the Integration Leader's route");
  const { header, rows } = firstTable(section);
  assert.ok(/^field/i.test(header[0]));
  const fields = rows.map((r) => /^`([^`]+)`$/.exec(r[0])[1]).sort();
  assert.deepStrictEqual(fields, ['currency', 'day1Date', 'synergyHorizonYears', 'synergyStaleDays', 'synergyTargetM']);
  assert.ok(/POST \/api\/deals\/:id\/setup/.test(section), 'the section names the route');

  const ok = (o) => DealSettingsSchema.safeParse(o).success;
  assert.ok(ok({ synergyTargetM: 0 }) && ok({ synergyTargetM: 100000 }) && !ok({ synergyTargetM: 100001 }) && !ok({ synergyTargetM: -1 }));
  assert.ok(ok({ synergyStaleDays: 365 }) && !ok({ synergyStaleDays: 366 }) && !ok({ synergyStaleDays: 0 }));
  assert.ok(ok({ synergyHorizonYears: 1 }) && ok({ synergyHorizonYears: 15 }) && !ok({ synergyHorizonYears: 16 }) && !ok({ synergyHorizonYears: 0 }) && !ok({ synergyHorizonYears: 2.5 }));
  assert.ok(ok({ currency: 'EUR' }) && !ok({ currency: 'X'.repeat(11) }));
  assert.ok(ok({ day1Date: '2026-12-01' }) && !ok({ day1Date: 'X'.repeat(11) }));
  const text = rows.map((r) => r.join(' ')).join('\n');
  assert.ok(/100000/.test(text) && /365/.test(text) && /1 to 15/.test(text) && /10 characters/.test(text), 'documented bounds name the schema numbers');
});

// ------------------------------------------------------- the prose obligations
test('the section documents pulses/hrbps limits, the clearance-404 rule and the denial-audit bound', () => {
  const section = sectionOf(DOC, '## Roles and what they can read');
  assert.ok(/### Personal data/.test(section));
  assert.ok(/\/api\/pulses/.test(section) && /aggregate row/i.test(section), 'pulse limits are documented');
  assert.ok(/\/api\/hrbps/.test(section) && /Integration Leader directory/.test(section), 'the hrbps limit is documented');
  assert.ok(/### Clean-room clearance reaches tasks and RAID entries/.test(section));
  assert.ok(/404 \{"error":"Not found"\}/.test(section), 'the clearance 404 body is quoted');
  assert.ok(/clearance-404/.test(section), 'the clearance-404 audit reason is named');
  assert.ok(/one audit row per account \+ method \+ route \+ reason per 60\s+seconds/.test(section), 'the denial-audit rate bound is stated');
  assert.ok(/### Controls the portal hides/.test(section));
  assert.ok(/PUBLIC_SETTINGS_KEYS/.test(section), 'the settings allowlist source is named');
});
