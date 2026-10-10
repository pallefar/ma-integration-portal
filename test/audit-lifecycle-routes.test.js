// D-12-04 (Phase 12, plan 12-12): the audit-partition lifecycle ROUTES under
// /api/admin/deals/:id/audit… — admin-only, control-plane, validated; every step
// a control-plane event; export round trip; the purge refusal matrix in its
// documented order; and a STRUCTURAL guard that nothing ever purges on a timer.
//
// Boots the real requireable app against an ISOLATED temp set; the committed
// data/*.db is never opened. `app.auditClock` (test-only, ignored in real mode)
// provides the "retention elapsed" clock. Sealed files are 0400 — tests restore
// 0600 before editing and the cleanup tolerates either mode.
//
// node:test — run via `node --test test/audit-lifecycle-routes.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-audit-lifecycle-routes-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'MA_AUDIT_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'MA_AUDIT_RETENTION_DAYS']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const resolver = require('../db/resolver.js');
const controlStore = require('../db/controlStore.js');
const auditHook = require('../db/auditHook.js');
const app = require('../server.js');
const { createDealFixture } = require('./helpers/deal-fixture');
const { sessionAs } = require('./helpers/seed-identity');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const POSIX = process.platform !== 'win32';
const DAY_MS = 24 * 60 * 60 * 1000;

const adminToken = sessionAs(runtimeConn, controlConn, { username: 'lcradmin', role: 'admin' });
let server = null;
let base = '';

test.before(async () => {
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  delete app.auditClock;
  delete process.env.MA_AUDIT_RETENTION_DAYS;
  if (server) server.close();
  try { app.denialAuditor.stopSweeper(); } catch (e) { /* ignore */ }
  try { auditHook.closeAuditConnection(); } catch (e) { /* ignore */ }
  try {
    const dir = dbFiles.AUDIT_DIR;
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      try { fs.chmodSync(path.join(dir, name), 0o600); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// --- fixtures / helpers -------------------------------------------------------

function newDealId() {
  return 'deal_lcr' + crypto.randomBytes(4).toString('hex');
}

function makeDealWithPartition(label, writes) {
  const dealId = newDealId();
  createDealFixture({ controlConn, runtimeConn, dealId, members: [{ username: 'karen', role: 'hrbp' }] });
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'karen', role: 'hrbp', dealId, sessionId: 'sess_karen' } };
  for (let i = 0; i < (writes || 2); i += 1) {
    const resolved = resolver.resolveDatabase(fakeReq);
    const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
    store.runWithDb({
      conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath,
      actor: { username: 'karen', role: 'hrbp', sessionId: 'sess_karen' }, request: { method: 'TEST', path: '/whatever', ip: null },
    }, () => {
      const db = store.readDb();
      db.alerts = db.alerts.concat([{ id: `alert_${label}_${i}`, title: `${label} routes marker ${i}`, severity: 'low' }]);
      store.writeDb(db);
    });
  }
  return dealId;
}

function headersFor(token, json) {
  const h = { Cookie: `ma_session=${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function call(method, urlPath, token, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: token ? headersFor(token, body !== undefined) : (body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON (an export) */ }
  return { status: res.status, headers: res.headers, text, json };
}

const seal = (id, token, body) => call('POST', `/api/admin/deals/${id}/audit/seal`, token || adminToken, body === undefined ? { confirm: id } : body);
const purge = (id, token, body) => call('POST', `/api/admin/deals/${id}/audit/purge`, token || adminToken, body === undefined ? { confirm: id } : body);
const exportJsonl = (id, token) => call('GET', `/api/admin/deals/${id}/audit/export`, token || adminToken);
const statusOf = (id, token) => call('GET', `/api/admin/deals/${id}/audit`, token || adminToken);

function events(dealId, action) {
  return auditHook.findControlEvents({ dealId, action });
}

function partitionFile(dealId) {
  return dbFiles.auditPartitionPath(dealId);
}

async function sealedDeal(label) {
  const id = makeDealWithPartition(label, 3);
  controlStore.archiveDeal(id);
  const res = await seal(id);
  assert.strictEqual(res.status, 200, res.text);
  return { id, seal: res.json };
}

function verifyCli(args) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'audit-verify.js'), ...args], {
    env: { ...process.env }, encoding: 'utf8',
  });
}

function flipByteIn(file, marker) {
  fs.chmodSync(file, 0o600);
  const buf = fs.readFileSync(file);
  const at = buf.indexOf(Buffer.from(marker));
  assert.ok(at > 0, `marker ${marker} present`);
  buf[at] = buf[at] ^ 0x01;
  fs.writeFileSync(file, buf);
  fs.chmodSync(file, 0o400);
}

// --- tests --------------------------------------------------------------------

test('routes (a): every lifecycle route is admin-only — non-admin roles 403, anonymous 401, nothing recorded', async () => {
  const id = makeDealWithPartition('a', 1);
  controlStore.archiveDeal(id);
  const tokens = {
    hrbp: sessionAs(runtimeConn, controlConn, { username: 'lcrhrbp', role: 'hrbp' }),
    pmo: sessionAs(runtimeConn, controlConn, { username: 'lcrpmo', role: 'pmo' }),
    employee: sessionAs(runtimeConn, controlConn, { username: 'lcremp', role: 'employee' }),
  };
  const requests = [
    ['GET', `/api/admin/deals/${id}/audit`, undefined],
    ['POST', `/api/admin/deals/${id}/audit/seal`, { confirm: id }],
    ['GET', `/api/admin/deals/${id}/audit/export`, undefined],
    ['POST', `/api/admin/deals/${id}/audit/purge`, { confirm: id }],
  ];
  for (const [method, url, body] of requests) {
    for (const [role, token] of Object.entries(tokens)) {
      const r = await call(method, url, token, body);
      assert.strictEqual(r.status, 403, `${role} ${method} ${url} -> ${r.status}`);
    }
    const anon = await call(method, url, null, body);
    assert.strictEqual(anon.status, 401, `anonymous ${method} ${url} -> ${anon.status}`);
  }
  for (const action of ['audit-partition-sealed', 'audit-partition-exported', 'audit-partition-purged']) {
    assert.strictEqual(events(id, action).length, 0, `${action}: nothing recorded by refused callers`);
  }
  assert.notStrictEqual(fs.existsSync(partitionFile(id)), false, 'the partition is untouched');
});

test('routes (b): status reports exists/rows/sealed/retention and flips after the seal', async () => {
  const id = makeDealWithPartition('b', 2);
  const pre = await statusOf(id);
  assert.strictEqual(pre.status, 200);
  assert.strictEqual(pre.headers.get('cache-control'), 'no-store');
  assert.strictEqual(pre.json.exists, true);
  assert.strictEqual(pre.json.sealed, false);
  assert.strictEqual(pre.json.dealState, 'active');
  assert.strictEqual(pre.json.retentionDays, null);
  assert.strictEqual(pre.json.purgeAllowed, false);

  controlStore.archiveDeal(id);
  const sealRes = await seal(id);
  assert.strictEqual(sealRes.status, 200);
  const post = await statusOf(id);
  assert.strictEqual(post.json.sealed, true);
  assert.strictEqual(post.json.dealState, 'archived');
  assert.strictEqual(post.json.sealedSha256, sealRes.json.sha256);
  assert.strictEqual(post.json.fileSha256, sealRes.json.sha256);
  assert.strictEqual(post.json.fileMatchesSeal, true);
  assert.strictEqual(post.json.purgeBlockedBy, 'no-sealed-export');
  assert.ok(post.json.events.some((e) => e.action === 'audit-partition-sealed'));

  // CR-01 (12-REVIEW): an id that is neither a registered deal nor an
  // exact-case partition file is the uniform 404 (was 200 `exists:false`) —
  // ids are resolved by file identity, never by the caller's spelling.
  const unknown = await statusOf('deal_nopartition1');
  assert.strictEqual(unknown.status, 404);
  assert.deepStrictEqual(unknown.json, { error: 'Not found' });
  // A registered deal with no partition file yet still reports exists:false.
  const fresh = newDealId();
  createDealFixture({ controlConn, runtimeConn, dealId: fresh, members: [{ username: 'karen', role: 'hrbp' }] });
  const freshStatus = await statusOf(fresh);
  assert.strictEqual(freshStatus.status, 200);
  assert.strictEqual(freshStatus.json.exists, false);
  assert.strictEqual((await statusOf('not_a_deal')).status, 400);
});

test('routes (c): export refuses an unsealed partition; a sealed export is NDJSON whose hash is the control event and verifies on its own', async () => {
  const unsealed = makeDealWithPartition('c1', 2);
  controlStore.archiveDeal(unsealed);
  const refused = await exportJsonl(unsealed);
  assert.strictEqual(refused.status, 409);
  assert.strictEqual(refused.json.reason, 'not-sealed');
  assert.strictEqual(events(unsealed, 'audit-partition-export-refused').length, 1);
  assert.strictEqual(events(unsealed, 'audit-partition-exported').length, 0);

  const { id, seal: sealJson } = await sealedDeal('c2');
  const res = await exportJsonl(id);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/x-ndjson/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="audit-deal_lcr[0-9a-f]+\.jsonl"$/);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');

  const lines = res.text.split('\n').filter((l) => l !== '');
  const header = JSON.parse(lines[0]);
  assert.strictEqual(header.type, 'ma-audit-export');
  assert.strictEqual(header.version, 1);
  assert.strictEqual(header.partition, id);
  assert.strictEqual(header.sealedSha256, sealJson.sha256);
  assert.strictEqual(header.rowCount, sealJson.rows);
  assert.strictEqual(header.headHash, sealJson.headHash);
  assert.strictEqual(lines.length - 1, sealJson.rows, 'one line per row');
  assert.strictEqual(JSON.parse(lines.at(-1)).action, 'partition-seal');

  const exported = events(id, 'audit-partition-exported');
  assert.strictEqual(exported.length, 1);
  assert.strictEqual(exported[0].after.exportSha256, crypto.createHash('sha256').update(res.text, 'utf8').digest('hex'));
  assert.strictEqual(exported[0].after.sealedSha256, sealJson.sha256);

  const file = path.join(TMP, `${id}.jsonl`);
  fs.writeFileSync(file, res.text);
  const ok = verifyCli(['--jsonl', file]);
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^OK .* jsonl partition=deal_lcr[0-9a-f]+ rows=\d+ head=[0-9a-f]{64} sha256=[0-9a-f]{64}/);

  const tampered = lines.slice();
  tampered[2] = tampered[2].replace('routes marker', 'routes Marker');
  fs.writeFileSync(file, tampered.join('\n') + '\n');
  const bad = verifyCli(['--jsonl', file]);
  assert.strictEqual(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /FAIL .* line=3 row-hash-mismatch/);

  const truncated = lines.slice(0, -1);
  fs.writeFileSync(file, truncated.join('\n') + '\n');
  assert.strictEqual(verifyCli(['--jsonl', file]).status, 1, 'a truncated export fails');
});

test('routes (d): purge refusal matrix in order, then a permitted purge records the event first and removes the partition', async () => {
  // not-sealed
  const unsealed = makeDealWithPartition('d0', 2);
  controlStore.archiveDeal(unsealed);
  let r = await purge(unsealed);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.reason, 'not-sealed');
  assert.strictEqual(events(unsealed, 'audit-partition-purge-refused').length, 1);

  // confirm mismatch / invalid id: 400, nothing recorded
  const { id, seal: sealJson } = await sealedDeal('d1');
  assert.strictEqual((await purge(id, null, { confirm: 'deal_other' })).status, 400);
  assert.strictEqual((await purge('not_a_deal', null, { confirm: 'not_a_deal' })).status, 400);
  const refusedBefore = events(id, 'audit-partition-purge-refused').length;

  // sealed, unmodified, but no sealed export
  r = await purge(id);
  assert.strictEqual(r.json.reason, 'no-sealed-export');

  // exported, retention unset => never
  assert.strictEqual((await exportJsonl(id)).status, 200);
  r = await purge(id);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.reason, 'retention-never');
  assert.strictEqual(r.json.error, 'No retention period is configured, so the audit trail is never purged.');

  // invalid / never spellings are 'never' too
  for (const v of ['never', 'NEVER', 'soon', '-5', '0', '1.5', '']) {
    process.env.MA_AUDIT_RETENTION_DAYS = v;
    r = await purge(id);
    assert.strictEqual(r.json.reason, 'retention-never', `MA_AUDIT_RETENTION_DAYS=${JSON.stringify(v)}`);
  }

  // retention 30 days, clock right after the seal => not elapsed
  process.env.MA_AUDIT_RETENTION_DAYS = '30';
  r = await purge(id);
  assert.strictEqual(r.json.reason, 'retention-not-elapsed');
  const sealedAt = Date.parse(events(id, 'audit-partition-sealed')[0].ts);
  assert.strictEqual(Date.parse(r.json.eligibleAt), sealedAt + 30 * DAY_MS);
  app.auditClock = () => new Date(sealedAt + 29 * DAY_MS);
  assert.strictEqual((await purge(id)).json.reason, 'retention-not-elapsed');
  assert.strictEqual(fs.existsSync(partitionFile(id)), true, 'refusals deleted nothing');
  assert.strictEqual(events(id, 'audit-partition-purge-refused').length, refusedBefore + 1 + 1 + 7 + 1 + 1);

  // 31 days after the seal => allowed
  app.auditClock = () => new Date(sealedAt + 31 * DAY_MS);
  const ok = await purge(id);
  assert.strictEqual(ok.status, 200, ok.text);
  assert.strictEqual(ok.json.purged, true);
  assert.strictEqual(ok.json.sealedSha256, sealJson.sha256);
  const purged = events(id, 'audit-partition-purged');
  assert.strictEqual(purged.length, 1);
  assert.strictEqual(purged[0].after.sealedSha256, sealJson.sha256);
  assert.strictEqual(purged[0].after.rows, sealJson.rows);
  for (const suffix of ['', '-wal', '-shm']) assert.strictEqual(fs.existsSync(partitionFile(id) + suffix), false, `file${suffix} removed`);

  const st = await statusOf(id);
  assert.strictEqual(st.json.exists, false);
  const viewer = auditHook.queryAudit({ dealId: id, limit: 200 });
  assert.ok(viewer.length > 0, 'the control events survive the purge');
  assert.ok(viewer.every((row) => row.partition === 'control'), 'the viewer no longer lists the purged partition');
  assert.strictEqual((await purge(id)).json.reason, 'no-partition', 'a second purge is refused, not an error');

  delete app.auditClock;
  delete process.env.MA_AUDIT_RETENTION_DAYS;
});

test('routes (e): a sealed file modified after the seal is refused for export and purge with a tamper event, even when retention has elapsed', async () => {
  const { id } = await sealedDeal('e');
  assert.strictEqual((await exportJsonl(id)).status, 200);
  flipByteIn(partitionFile(id), 'e routes marker 1');

  process.env.MA_AUDIT_RETENTION_DAYS = '1';
  const sealedAt = Date.parse(events(id, 'audit-partition-sealed')[0].ts);
  app.auditClock = () => new Date(sealedAt + 400 * DAY_MS);
  try {
    const p = await purge(id);
    assert.strictEqual(p.status, 409);
    assert.strictEqual(p.json.reason, 'modified-after-seal');
    assert.strictEqual(events(id, 'audit-partition-tamper-detected').length, 1);
    assert.strictEqual(fs.existsSync(partitionFile(id)), true, 'a tampered trail is never purged');

    const x = await exportJsonl(id);
    assert.strictEqual(x.status, 409);
    assert.strictEqual(x.json.reason, 'modified-after-seal');

    const st = await statusOf(id);
    assert.strictEqual(st.json.fileMatchesSeal, false);
    assert.strictEqual(st.json.purgeBlockedBy, 'modified-after-seal');
  } finally {
    delete app.auditClock;
    delete process.env.MA_AUDIT_RETENTION_DAYS;
  }
  if (POSIX) assert.strictEqual(fs.statSync(partitionFile(id)).mode & 0o777, 0o400);
});

test('routes (f): the route inventory — four lifecycle routes, none under /api/admin/audit*, validated schemas registered', () => {
  const stack = (app._router && app._router.stack) || [];
  const found = new Set();
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) found.add(`${m.toUpperCase()} ${layer.route.path}`);
  }
  for (const key of [
    'GET /api/admin/deals/:id/audit',
    'POST /api/admin/deals/:id/audit/seal',
    'GET /api/admin/deals/:id/audit/export',
    'POST /api/admin/deals/:id/audit/purge',
  ]) assert.ok(found.has(key), `${key} registered`);
  for (const key of found) {
    const [method, p] = key.split(' ');
    if (p.startsWith('/api/admin/audit')) assert.strictEqual(method, 'GET', `${key}: /api/admin/audit* stays GET-only`);
  }
  const { resolveSchema } = require('../validators/index.js');
  assert.ok(resolveSchema('POST', '/api/admin/deals/deal_x/audit/seal'), 'seal schema registered');
  assert.ok(resolveSchema('POST', '/api/admin/deals/deal_x/audit/purge'), 'purge schema registered');
});

// --- structural guard: nothing purges automatically (T-12-111) ------------------

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

function listJs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listJs(p, out);
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** The text of every call `name(...)` in `src` (balanced parentheses). */
function callTexts(src, name) {
  const texts = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(name + '(', from);
    if (at === -1) break;
    let depth = 0;
    let i = at + name.length;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    texts.push(src.slice(at, i + 1));
    from = at + name.length;
  }
  return texts;
}

test('routes (g, structural): purge is only reachable from its definition, the purge route and the CLI; no timer callback calls it', () => {
  const root = path.join(__dirname, '..');
  const files = [path.join(root, 'server.js'), ...listJs(path.join(root, 'db'), []), ...listJs(path.join(root, 'lib'), []), ...listJs(path.join(root, 'scripts'), [])];
  const callers = [];
  for (const file of files) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(root, file).split(path.sep).join('/');
    const n = (src.match(/\bpurgePartition(File)?\s*\(/g) || []).length;
    if (n > 0) callers.push({ rel, n });
    for (const timer of ['setInterval', 'setTimeout', 'setImmediate']) {
      for (const text of callTexts(src, timer)) {
        assert.ok(!/purge/i.test(text), `${rel}: a ${timer} callback references purge`);
      }
    }
  }
  const rels = callers.map((c) => c.rel).sort();
  assert.deepStrictEqual(rels, ['db/auditLifecycle.js', 'scripts/audit-admin.js', 'server.js']);
  assert.strictEqual(callers.find((c) => c.rel === 'server.js').n, 1, 'exactly one call site in server.js');
  assert.strictEqual(callers.find((c) => c.rel === 'scripts/audit-admin.js').n, 1, 'exactly one call site in the CLI');

  // The server's single call lives inside the purge route handler.
  const serverSrc = stripComments(fs.readFileSync(path.join(root, 'server.js'), 'utf8'));
  const at = serverSrc.indexOf('purgePartition(');
  const routeAt = serverSrc.lastIndexOf("app.post('/api/admin/deals/:id/audit/purge'", at);
  assert.ok(routeAt > 0 && at - routeAt < 1200, 'the call sits in the POST …/audit/purge handler');

  // The retention clock seam is ignored in real mode.
  assert.match(serverSrc, /!dbFiles\.IS_REAL_MODE && typeof app\.auditClock === 'function'/);
});

test('routes (h): CR-01 — a case variant of an ACTIVE deal id answers the uniform 404 everywhere, changes nothing, records nothing', async () => {
  // Minted ids are lowercase and the deal-id rule is case-sensitive.
  assert.match('deal_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'), dbFiles.DEAL_ID_RE);
  assert.ok(!dbFiles.DEAL_ID_RE.test('DEAL_abc') && !dbFiles.DEAL_ID_RE.test('deal_ABC'), 'DEAL_ID_RE is case-sensitive');

  const id = makeDealWithPartition('h', 2);
  const file = partitionFile(id);
  const sha = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const shaBefore = sha();
  const modeBefore = fs.statSync(file).mode & 0o777;
  const variants = [
    'D' + id.slice(1),
    'DEAL_' + id.slice(5),
    'deal_' + id.slice(5).toUpperCase(),
    id.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c)).join(''),
  ].filter((v) => v !== id);
  assert.ok(variants.length >= 3);
  for (const v of variants) {
    for (const r of [await statusOf(v), await seal(v), await exportJsonl(v), await purge(v)]) {
      assert.strictEqual(r.status, 404, `${v}: ${r.status} ${r.text}`);
      assert.deepStrictEqual(r.json, { error: 'Not found' });
    }
    assert.strictEqual(auditHook.findControlEvents({ dealId: v }).length, 0, `no event filed under ${v}`);
  }
  // The real deal is untouched and still active.
  assert.strictEqual(sha(), shaBefore, 'partition bytes unchanged');
  assert.strictEqual(fs.statSync(file).mode & 0o777, modeBefore, 'partition mode unchanged (not sealed)');
  for (const action of ['audit-partition-sealed', 'audit-partition-exported', 'audit-partition-purged']) {
    assert.strictEqual(events(id, action).length, 0, `${action}: nothing recorded for the real id`);
  }
  const st = await statusOf(id);
  assert.strictEqual(st.status, 200);
  assert.strictEqual(st.json.sealed, false);
  assert.strictEqual(st.json.dealState, 'active');
  assert.strictEqual((await seal(id)).json.reason, 'deal-active', 'the exact id still meets the deal-active refusal');

  // Unknown-but-well-formed ids are the same uniform 404; a non-id is still 400.
  assert.strictEqual((await statusOf('deal_nosuchdeal0')).status, 404);
  assert.strictEqual((await statusOf('LEGACY')).status, 404);
  assert.strictEqual((await statusOf('not_a_deal')).status, 400);

  // The CLIs apply the same file-identity rule.
  const adminCli = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'audit-admin.js'), 'seal', variants[0], '--confirm', variants[0]], {
    env: { ...process.env }, encoding: 'utf8',
  });
  assert.strictEqual(adminCli.status, 2, adminCli.stdout + adminCli.stderr);
  assert.match(adminCli.stderr, /Unknown partition id/);
  const verify = verifyCli(['--deal', variants[0]]);
  assert.strictEqual(verify.status, 2, verify.stdout + verify.stderr);
  assert.strictEqual(sha(), shaBefore, 'the CLIs changed nothing');
  assert.strictEqual(auditHook.findControlEvents({ dealId: variants[0] }).length, 0);
});
