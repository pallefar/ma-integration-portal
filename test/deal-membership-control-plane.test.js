'use strict';
// [security] F-1 (v3.0.0-rc.1 whole-codebase review; generalises Phase 11
// T-11-13): every `/api/deals/:id*` route is CONTROL-PLANE (db/resolver.js), so
// the resolver's bind-time membership refusal never runs for it and the gate's
// '/api/deals' role rules prove only the ROLE. server.js's mount-level
// `app.use('/api/deals/:id', ...)` rule adds the missing membership check ONCE.
//
// Proves, for a deal A whose members are an hrbp, a pmo and an employee:
//   - the live route inventory under `/api/deals/:id` is exactly the classified
//     table below (a new sibling route fails this suite until it is classified);
//   - a NON-MEMBER hrbp (bound to another deal B, or unbound, or just removed
//     from A) gets `404 {"error":"Deal not found."}` on every route — the bytes a
//     missing deal id gets — with A's registry row byte-identical, its sessions
//     untouched and NO audit row written anywhere;
//   - a non-member pmo / employee gets the gate's id-independent role refusal,
//     byte-identical to what a MEMBER of the same role and a missing id get,
//     with A unchanged;
//   - the deal's own hrbp and an admin keep their documented statuses;
//   - no spelling of the path (case variant, percent-encoding, encoded slash,
//     `//`, dot segment, trailing slash) reaches a handler for a non-member;
//   - a member's POST response carries nothing the same caller could not read
//     through GET /api/deals (lib/dealProjection.js), and GET /api/deals list
//     semantics are unchanged.
//
// Boots the REAL app against ISOLATED MA_* temp paths (never committed data/*.db).
// Run: `node --test test/deal-membership-control-plane.test.js` (or `npm test`).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deal-membership-cp-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = '';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const auditHook = require('../db/auditHook.js');
const controlStore = require('../db/controlStore.js');
const { projectDealForRole } = require('../lib/dealProjection.js');
const { createDealFixture } = require('./helpers/deal-fixture.js');
const { sessionAs } = require('./helpers/seed-identity.js');
const { listApiRoutes } = require('./helpers/route-inventory.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const DEAL_A = 'deal_fmcpa';
const DEAL_B = 'deal_fmcpb';
const MISSING = 'deal_fmcpmissing';
const NOT_FOUND_BODY = '{"error":"Deal not found."}';

const fixA = createDealFixture({
  controlConn, runtimeConn, dealId: DEAL_A,
  members: [
    { username: 'fm_il_a', role: 'hrbp' },
    { username: 'fm_il_a2', role: 'hrbp' },
    { username: 'fm_pmo_a', role: 'pmo', ddAreas: ['legal'] },
    { username: 'fm_emp_a', role: 'employee' },
  ],
});
const fixB = createDealFixture({
  controlConn, runtimeConn, dealId: DEAL_B,
  members: [
    { username: 'fm_il_b', role: 'hrbp' },
    { username: 'fm_pmo_b', role: 'pmo' },
    { username: 'fm_emp_b', role: 'employee' },
  ],
});
const tok = {
  ...fixA.tokens,
  ...fixB.tokens,
  fm_admin: sessionAs(runtimeConn, controlConn, { username: 'fm_admin', role: 'admin' }),
  // An hrbp with NO deal binding and no membership anywhere.
  fm_il_c: sessionAs(runtimeConn, controlConn, { username: 'fm_il_c', role: 'hrbp' }),
};
const cookie = (u) => `ma_session=${tok[u]}`;

// The classified `/api/deals/:id*` surface. `body(dealId)` is a VALID body for
// the route, so a refusal is never a validation 400 in disguise.
const ROUTES = [
  { method: 'GET', tpl: '/api/deals/:id/grants', suffix: '/grants', body: null, member: 200, admin: 200 },
  { method: 'POST', tpl: '/api/deals/:id/grants', suffix: '/grants',
    body: () => ({ username: 'fm_pmo_a', ddAreas: ['legal', 'tax', 'hr'] }), member: 200, admin: 200 },
  { method: 'POST', tpl: '/api/deals/:id/vdr-grants', suffix: '/vdr-grants',
    body: () => ({ username: 'fm_emp_a', vdrRef: 'VDR-folder-7' }), member: 200, admin: 200 },
  { method: 'POST', tpl: '/api/deals/:id/setup', suffix: '/setup',
    body: () => ({ dealSettings: { currency: 'EUR' } }), member: 200, admin: 200 },
  // Membership edits stay admin-only (inline isAdminRequest) — a member hrbp keeps its 403.
  { method: 'POST', tpl: '/api/deals/:id/members', suffix: '/members',
    body: () => ({ members: controlStore.getDeal(DEAL_A).members.slice() }), member: 403, admin: 200 },
];

/** Exact-bytes request over node:http — no WHATWG URL normalisation of the path. */
function raw(port, method, p, user, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const headers = { Cookie: cookie(user) };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: buf }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function registryRow(id) {
  const r = controlConn.prepare('SELECT status, data FROM deals WHERE id = ?').get(id);
  return r ? `${r.status}|${r.data}` : null;
}
function boundSessions(id) {
  return runtimeConn.prepare('SELECT COUNT(*) AS n FROM sessions WHERE deal_id = ?').get(id).n;
}
function snapshot() {
  return {
    row: registryRow(DEAL_A),
    sessions: boundSessions(DEAL_A),
    auditA: auditHook.countAudit({ dealId: DEAL_A }),
    auditAll: auditHook.countAudit({}),
  };
}

// Strings that must never appear in a refusal: A's roster and target company.
const A_SECRETS = ['fm_il_a', 'fm_pmo_a', 'fm_emp_a', `${DEAL_A} Co`, 'memberGrants'];
function assertNoLeak(res, label) {
  for (const s of A_SECRETS) assert.ok(!res.text.includes(s), `${label}: response must not carry "${s}" (got ${res.text.slice(0, 200)})`);
}

let server;
let port;
test.before(async () => {
  server = await listenLocal(app);
  port = server.address().port;
});
test.after(() => {
  if (server) server.close();
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('F-1 inventory: every registered /api/deals/:id route is classified by this suite', () => {
  const live = listApiRoutes(app)
    .filter((r) => r.path === '/api/deals/:id' || r.path.startsWith('/api/deals/:id/'))
    .map((r) => `${r.method} ${r.path}`).sort();
  const classified = ROUTES.map((r) => `${r.method} ${r.tpl}`).sort();
  assert.deepStrictEqual(live, classified,
    'a new /api/deals/:id route must be added to ROUTES (and inherits the mount-level membership rule)');
});

test('F-1 (a): a NON-MEMBER hrbp (bound elsewhere, unbound) gets the missing-deal 404 on every route — no state change, no audit row', async () => {
  for (const user of ['fm_il_b', 'fm_il_c']) {
    for (const r of ROUTES) {
      const body = r.body ? r.body() : null;
      const before = snapshot();
      const res = await raw(port, r.method, `/api/deals/${DEAL_A}${r.suffix}`, user, body);
      const label = `${user} ${r.method} ${r.tpl}`;
      assert.strictEqual(res.status, 404, `${label}: non-member must be 404`);
      assert.strictEqual(res.text, NOT_FOUND_BODY, `${label}: body must be the fixed missing-deal body`);
      assertNoLeak(res, label);
      assert.deepStrictEqual(snapshot(), before, `${label}: registry row, sessions and audit must be unchanged`);

      // Byte-identical to a deal id that does not exist at all (anti-enumeration).
      const missing = await raw(port, r.method, `/api/deals/${MISSING}${r.suffix}`, user, body);
      assert.deepStrictEqual(missing, res, `${label}: non-member and missing deal must be indistinguishable`);
    }
  }
});

test('F-1 (b): a non-member pmo / employee gets the id-independent role refusal (identical to a member of the same role and to a missing id), A unchanged', async () => {
  for (const [nonMember, member] of [['fm_pmo_b', 'fm_pmo_a'], ['fm_emp_b', 'fm_emp_a']]) {
    for (const r of ROUTES) {
      const body = r.body ? r.body() : null;
      const label = `${nonMember} ${r.method} ${r.tpl}`;
      const before = snapshot();
      const res = await raw(port, r.method, `/api/deals/${DEAL_A}${r.suffix}`, nonMember, body);
      assert.ok(res.status === 403 || res.status === 404, `${label}: must be refused (got ${res.status})`);
      assertNoLeak(res, label);
      const after = snapshot();
      assert.strictEqual(after.row, before.row, `${label}: registry row must be byte-identical`);
      assert.strictEqual(after.sessions, before.sessions, `${label}: sessions bound to A must be untouched`);
      assert.strictEqual(after.auditA, before.auditA, `${label}: no audit row may be attributed to deal A`);

      const missing = await raw(port, r.method, `/api/deals/${MISSING}${r.suffix}`, nonMember, body);
      const asMember = await raw(port, r.method, `/api/deals/${DEAL_A}${r.suffix}`, member, body);
      assert.deepStrictEqual(missing, res, `${label}: must not differ from a missing deal id`);
      assert.deepStrictEqual(asMember, res, `${label}: must not differ from a MEMBER of the same role (no membership oracle)`);
    }
  }
});

test('F-1 (c): the deal\'s own hrbp and an admin keep their documented statuses on every route', async () => {
  for (const r of ROUTES) {
    const m = await raw(port, r.method, `/api/deals/${DEAL_A}${r.suffix}`, 'fm_il_a', r.body ? r.body() : null);
    assert.strictEqual(m.status, r.member, `member hrbp ${r.method} ${r.tpl}: expected ${r.member}, got ${m.status} ${m.text.slice(0, 120)}`);
    const a = await raw(port, r.method, `/api/deals/${DEAL_A}${r.suffix}`, 'fm_admin', r.body ? r.body() : null);
    assert.strictEqual(a.status, r.admin, `admin ${r.method} ${r.tpl}: expected ${r.admin}, got ${a.status} ${a.text.slice(0, 120)}`);
  }
  // An unknown id is still the plain missing-deal 404 for admin (handler branch).
  const a = await raw(port, 'GET', `/api/deals/${MISSING}/grants`, 'fm_admin');
  assert.strictEqual(a.status, 404);
  assert.strictEqual(a.text, NOT_FOUND_BODY);
});

test('F-1 (d): no spelling of the path lets a non-member hrbp reach a handler', async () => {
  const enc = (id) => id.replace(/^d/, '%64'); // percent-encoded first character
  const encId = enc(DEAL_A);
  const variants = (suffix, id) => [
    { p: `/api/deals/${id}${suffix}/`, gate: true },                       // trailing slash
    { p: `/api/deals/${enc(id)}${suffix}`, gate: true },                   // percent-encoded id
    { p: `/api/deals/${id}%2F${suffix.slice(1)}`, gate: true },            // encoded slash
    { p: `/api/deals/${id.toUpperCase()}${suffix}`, gate: true },          // id case variant
    { p: `/api/Deals/${id}${suffix}` },                                    // prefix case variant
    { p: `/API/deals/${id}${suffix}` },
    { p: `/api/deals/${id}${suffix.toUpperCase()}`, gate: true },          // suffix case variant
    { p: `/api//deals/${id}${suffix}` },                                   // doubled slashes
    { p: `/api/deals//${id}${suffix}` },
    { p: `/api/deals/x/../${id}${suffix}` },                               // dot segments
    { p: `/api/deals/x/%2e%2e/${id}${suffix}` },
    { p: `/api/deals/${id}${suffix}?id=${DEAL_B}` },                       // query cannot re-point the id
  ];
  const scrub = (text, id) => text.split(id).join('<ID>').split(id.toUpperCase()).join('<ID>');
  for (const r of ROUTES) {
    const body = r.body ? r.body() : null;
    const missingVariants = variants(r.suffix, MISSING);
    for (const [i, v] of variants(r.suffix, DEAL_A).entries()) {
      const label = `fm_il_b ${r.method} ${v.p}`;
      const before = snapshot();
      const res = await raw(port, r.method, v.p, 'fm_il_b', body);
      assert.ok(res.status >= 400 && res.status < 500, `${label}: must be refused, got ${res.status}`);
      assertNoLeak(res, label);
      if (v.gate) {
        // Reaches the router as a `/api/deals/:id` form: refused 404 with an
        // id-independent body (the membership 404, or the validator's router-404
        // for a write spelling no handler serves).
        assert.strictEqual(res.status, 404, `${label}: expected 404`);
        assert.ok(res.text === NOT_FOUND_BODY || res.text === '{"error":"Not found"}', `${label}: fixed body, got ${res.text}`);
      }
      // Whatever the spelling, the answer must not depend on whether the deal exists.
      const missing = await raw(port, r.method, missingVariants[i].p, 'fm_il_b', body);
      assert.deepStrictEqual({ status: missing.status, text: scrub(missing.text, MISSING) },
        { status: res.status, text: scrub(res.text, DEAL_A) },
        `${label}: must not differ from the same spelling with a missing deal id`);
      const after = snapshot();
      assert.strictEqual(after.row, before.row, `${label}: registry row must be byte-identical`);
      assert.strictEqual(after.sessions, before.sessions, `${label}: sessions must be untouched`);
      assert.strictEqual(after.auditA, before.auditA, `${label}: no audit row for deal A`);
    }
  }
  // Positive control: the SAME decoded-id spellings still reach the handler for a member.
  for (const p of [`/api/deals/${encId}/grants`, `/api/deals/${DEAL_A}/grants/`]) {
    const res = await raw(port, 'GET', p, 'fm_il_a');
    assert.strictEqual(res.status, 200, `member GET ${p} must still be 200`);
  }
});

test('F-1 (e): an hrbp REMOVED from the deal loses all reach on the very next request', async () => {
  const before = await raw(port, 'GET', `/api/deals/${DEAL_A}/grants`, 'fm_il_a2');
  assert.strictEqual(before.status, 200, 'precondition: a member hrbp reads the grants');
  const remaining = controlStore.getDeal(DEAL_A).members.filter((u) => u !== 'fm_il_a2');
  const rm = await raw(port, 'POST', `/api/deals/${DEAL_A}/members`, 'fm_admin', { members: remaining });
  assert.strictEqual(rm.status, 200, 'admin removes fm_il_a2');
  for (const r of ROUTES) {
    const snap = snapshot();
    const res = await raw(port, r.method, `/api/deals/${DEAL_A}${r.suffix}`, 'fm_il_a2', r.body ? r.body() : null);
    assert.strictEqual(res.status, 404, `removed hrbp ${r.method} ${r.tpl} must be 404`);
    assert.strictEqual(res.text, NOT_FOUND_BODY);
    assert.deepStrictEqual(snapshot(), snap, `removed hrbp ${r.method} ${r.tpl}: no state change, no audit row`);
  }
});

test('F-1 (f): a member\'s POST response carries nothing the caller cannot read via GET /api/deals; list semantics unchanged', async () => {
  const listFor = async (user) => JSON.parse((await raw(port, 'GET', '/api/deals', user)).text);
  for (const user of ['fm_il_a', 'fm_admin']) {
    const role = user === 'fm_admin' ? 'admin' : 'hrbp';
    const grant = await raw(port, 'POST', `/api/deals/${DEAL_A}/grants`, user,
      { username: 'fm_pmo_a', ddAreas: user === 'fm_admin' ? ['legal'] : ['legal', 'financial'] });
    assert.strictEqual(grant.status, 200);
    const grantBody = JSON.parse(grant.text);
    const listed = (await listFor(user)).find((d) => d.id === DEAL_A);
    assert.ok(listed, `${user} must see deal A in GET /api/deals`);
    assert.deepStrictEqual(grantBody.deal, listed, `${user} POST grants echo must equal the GET /api/deals record`);
    assert.deepStrictEqual(grantBody.deal, projectDealForRole(controlStore.getDeal(DEAL_A), role));

    const setup = JSON.parse((await raw(port, 'POST', `/api/deals/${DEAL_A}/setup`, user, { dealSettings: { currency: 'USD' } })).text);
    assert.deepStrictEqual(setup.deal, (await listFor(user)).find((d) => d.id === DEAL_A), `${user} POST setup echo must equal the GET /api/deals record`);

    const vdr = JSON.parse((await raw(port, 'POST', `/api/deals/${DEAL_A}/vdr-grants`, user, { username: 'fm_emp_a', vdrRef: 'VDR-2' })).text);
    assert.deepStrictEqual(Object.keys(vdr).sort(), ['grant', 'success']);
    assert.deepStrictEqual(Object.keys(vdr.grant).sort(), ['grantedAt', 'grantedBy', 'note', 'username', 'vdrRef'],
      'the vdr-grant echo carries only the grant, never the registry record');

    const grantsGet = JSON.parse((await raw(port, 'GET', `/api/deals/${DEAL_A}/grants`, user)).text);
    assert.deepStrictEqual(Object.keys(grantsGet), ['members']);
  }

  // GET /api/deals: unchanged membership filtering + per-role projection.
  assert.ok(!(await listFor('fm_il_b')).some((d) => d.id === DEAL_A), 'a non-member hrbp does not list deal A');
  assert.ok(!(await listFor('fm_il_c')).some((d) => d.id === DEAL_A), 'an unbound non-member hrbp does not list deal A');
  const pmoA = (await listFor('fm_pmo_a')).find((d) => d.id === DEAL_A);
  assert.deepStrictEqual(Object.keys(pmoA).sort(), ['id', 'name', 'status', 'targetCompany']);
  const empA = (await listFor('fm_emp_a')).find((d) => d.id === DEAL_A);
  assert.deepStrictEqual(Object.keys(empA).sort(), ['id', 'name', 'status']);
  assert.ok((await listFor('fm_admin')).some((d) => d.id === DEAL_A) && (await listFor('fm_admin')).some((d) => d.id === DEAL_B));
});
