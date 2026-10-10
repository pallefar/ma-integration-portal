// D-11-04 / AUTHZ-04 (Phase 11, plan 11-06; PRD acceptance 4, second half):
// NO GET CHANGES STATE. A GET bypasses ROLE_WRITE_POLICY and validationMiddleware
// (both keyed on write methods) and a plain link or <img> can fire one
// cross-site, so a GET that writes is an authorization hole (R3 F-2 verified an
// employee creating roster rows with `GET /api/employees/get-or-create`).
//
// Method: statement-level instrumentation of better-sqlite3 (every SQL write on
// every database file — writeDb, the control-plane direct-SQL writers, the
// sessions table — funnels through Statement.prototype / Database#exec) plus a
// wrapper over the fs write APIs, installed BEFORE server.js loads. Then EVERY
// registered GET route (all /api GETs plus '/', '/healthz' and the '*'
// fallback) is driven sequentially as an admin bound to a real-deal fixture AND
// as an admin on the demo store, and any write recorded while a request is in
// flight fails the test, naming route + file + SQL.
//
// Allowed, by explicit rule (never a silent skip):
//   * the audit trail: INSERT-only into MA_AUDIT_DB_PATH. By-design read-audit
//     writers (db/auditHook.js recordSecurityEvent, Phases 4/6/7: org
//     positions/decisions/flight-risk, DD findings/request items, reports
//     export/pack) record WHO read MNPI; the append-only trail is not state.
//   * GET /api/admin/download-zip: builds a temp archive directly under
//     os.tmpdir() and deletes it after sending. The `zip` binary is replaced
//     by a one-file stub so the run stays fast and hermetic (the real binary
//     would archive the whole checkout); the handler's own temp-dir lifecycle
//     is what is under test and the leftover-file check below proves cleanup.
//
// Isolated MA_* temp trio — the committed data/*.db is never opened. Never
// calls POST /api/settings/new-ma (it deletes tracked public/sent_emails).
//
// node:test — run via `node --test test/no-get-mutates.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-no-get-mutates-'));
const AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = AUDIT_DB_PATH;
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

// Seed the demo store from the repo snapshot so the demo-lane handlers have real
// data (an empty demo.db makes several handlers 500 on missing settings, which
// would make their GET drive vacuous).
const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_DB_PATH = path.join(TMP, 'legacy-source.db');
runMigration(path.join(__dirname, '..', 'db.json'), SOURCE_DB_PATH);
const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP });

// ---------------------------------------------------------------------------
// Instrumentation — installed BEFORE server.js is required.
// ---------------------------------------------------------------------------
const state = {
  current: null, // { lane, url } while a GET is in flight (set by the driver)
  sqlWrites: [], // { lane, url, file, sql }
  fsWrites: [], // { lane, url, op, target }
  egress: [], // outbound (non-loopback) fetch URLs
};

const WRITE_VERB = /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|REINDEX|ATTACH|DETACH)\b/i;

const BetterSqlite3 = require('better-sqlite3');
const StatementProto = Object.getPrototypeOf((() => {
  const probe = new BetterSqlite3(':memory:');
  const st = probe.prepare('SELECT 1');
  probe.close();
  return st;
})());
for (const method of ['run', 'get', 'all', 'iterate']) {
  const original = StatementProto[method];
  StatementProto[method] = function instrumented(...args) {
    if (state.current && WRITE_VERB.test(this.source)) {
      let file = '?';
      try { file = this.database.name; } catch (e) { /* closed */ }
      state.sqlWrites.push({ ...state.current, file, sql: String(this.source).replace(/\s+/g, ' ').slice(0, 200) });
    }
    return original.apply(this, args);
  };
}
const DatabaseProto = BetterSqlite3.prototype;
const originalExec = DatabaseProto.exec;
DatabaseProto.exec = function instrumentedExec(sql) {
  if (state.current && WRITE_VERB.test(String(sql))) {
    state.sqlWrites.push({ ...state.current, file: this.name, sql: String(sql).replace(/\s+/g, ' ').slice(0, 200) });
  }
  return originalExec.call(this, sql);
};

function recordFs(op, target) {
  if (state.current) state.fsWrites.push({ ...state.current, op, target: String(target) });
}
for (const op of ['writeFileSync', 'appendFileSync', 'renameSync', 'copyFileSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'truncateSync', 'createWriteStream']) {
  const original = fs[op];
  fs[op] = function instrumentedFs(...args) {
    // renameSync/copyFileSync mutate their DESTINATION too; record both ends.
    recordFs(op, args[0]);
    if ((op === 'renameSync' || op === 'copyFileSync') && args[1] !== undefined) recordFs(op, args[1]);
    return original.apply(this, args);
  };
}
// mkdir of a directory that already exists is a no-op, not a state change.
const originalMkdirSync = fs.mkdirSync;
fs.mkdirSync = function instrumentedMkdir(p, ...rest) {
  if (state.current && !fs.existsSync(p)) recordFs('mkdirSync', p);
  return originalMkdirSync.call(this, p, ...rest);
};
for (const op of ['writeFile', 'appendFile', 'rename', 'copyFile', 'unlink', 'rm', 'rmdir', 'truncate', 'mkdtemp']) {
  const original = fs.promises[op];
  if (typeof original !== 'function') continue;
  fs.promises[op] = function instrumentedPromise(...args) {
    recordFs('promises.' + op, args[0]);
    return original.apply(this, args);
  };
}
for (const op of ['writeFile', 'appendFile', 'rename', 'copyFile', 'unlink', 'rm']) {
  const original = fs[op];
  fs[op] = function instrumentedCb(...args) {
    recordFs(op, args[0]);
    return original.apply(this, args);
  };
}

// No outbound network from a GET: the only allowed fetch target is the loopback
// server under test. /api/ai/insight must run with no provider key configured.
const realFetch = global.fetch;
global.fetch = function guardedFetch(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || String(input);
  if (!/^https?:\/\/127\.0\.0\.1[:/]/.test(url)) {
    state.egress.push(url);
    return Promise.reject(new Error('no-get-mutates: outbound network is not allowed during a GET drive'));
  }
  return realFetch(input, init);
};

// The download-zip handler shells out to `zip -r <path> . -x ...` in the repo
// root; replace the binary with a one-file stub (see header). The handler
// requires child_process lazily, so patching the module object takes effect.
const zipStubPaths = [];
const realExecSync = childProcess.execSync;
childProcess.execSync = function stubbedExecSync(cmd, ...rest) {
  const m = /^zip -r "([^"]+)"/.exec(String(cmd));
  if (m) {
    zipStubPaths.push(m[1]);
    fs.writeFileSync(m[1], 'PK stub archive for the no-get-mutates test');
    return Buffer.alloc(0);
  }
  return realExecSync.call(this, cmd, ...rest);
};

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------
const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const app = require('../server.js');
const { listApiRoutes } = require('./helpers/route-inventory');
const { createDealFixture, demoSession } = require('./helpers/deal-fixture');
const { DD_AREA_IDS } = require('../db/accessPolicy.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Classification — ONE function, exercised by the negative controls too.
// ---------------------------------------------------------------------------
const ZIP_NAME = /^ma-app-\d+\.zip$/;

function sqlWriteViolation(w) {
  const isAudit = path.resolve(String(w.file)) === path.resolve(AUDIT_DB_PATH);
  if (isAudit && /^\s*INSERT\b/i.test(w.sql)) return null; // append-only audit trail
  return `SQL write to ${w.file} during GET ${w.url} [${w.lane}]: ${w.sql}`;
}

function fsWriteViolation(w) {
  const target = path.resolve(w.target);
  const tmpArchive = path.dirname(target) === path.resolve(os.tmpdir()) && ZIP_NAME.test(path.basename(target));
  if (w.url.startsWith('/api/admin/download-zip') && tmpArchive) return null; // temp export, deleted after sending
  return `filesystem write (${w.op}) to ${w.target} during GET ${w.url} [${w.lane}]`;
}

function violations() {
  return [
    ...state.sqlWrites.map(sqlWriteViolation),
    ...state.fsWrites.map(fsWriteViolation),
  ].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Route inventory — every registered GET route, not only /api ones.
// ---------------------------------------------------------------------------
function listAllGetRoutes(expressApp) {
  const out = [];
  for (const layer of expressApp._router.stack) {
    if (layer.route && layer.route.methods.get && typeof layer.route.path === 'string') {
      out.push(layer.route.path);
    }
  }
  return out;
}

const INVENTORY = listAllGetRoutes(app);

const REPORT_DATASETS = ['workstreams', 'tasks', 'raid', 'synergies'];
const REPORT_FORMATS = ['csv', 'json'];

/** Concrete URLs to drive for one registered GET route pattern. */
function urlsFor(routePath, ids) {
  if (routePath === '*') return ['/zz-spa-fallback-route'];
  if (routePath === '/api/reports/export') {
    const urls = [];
    for (const d of REPORT_DATASETS) for (const f of REPORT_FORMATS) urls.push(`${routePath}?dataset=${d}&format=${f}`);
    return urls;
  }
  if (routePath === '/api/reports/pack') return [`${routePath}?lang=en`];
  if (routePath === '/api/rag/search') return [`${routePath}?q=integration%20playbook`];
  if (routePath === '/api/ai/insight') return [`${routePath}?portal=dashboard`];
  if (routePath === '/api/deals/:id/grants') return [routePath.replace(':id', ids.dealId)];
  if (routePath === '/api/dd/request-items/:id') return [routePath.replace(':id', ids.requestItemId || 'x')];
  if (routePath === '/api/dd/findings/:id') return [routePath.replace(':id', ids.findingId || 'x')];
  return [routePath.replace(/:[a-zA-Z0-9_]+/g, 'x')];
}

async function withServer(fn) {
  const server = await listenLocal(app);
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function drain() {
  // late fire-and-forget writes (audit append, unlink callbacks) land here
  await new Promise((resolve) => setTimeout(resolve, 15));
  await new Promise((resolve) => setImmediate(resolve));
}

async function postJson(base, cookie, url, body) {
  const res = await fetch(base + url, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, json, text };
}

/** Seed one DD finding + request item through the API (not instrumented). */
async function seedDd(base, cookie) {
  const finding = await postJson(base, cookie, '/api/dd/findings', { area: 'hr', title: 'No-GET-mutates seed finding', severity: 'high' });
  assert.ok(finding.status === 200 || finding.status === 201, `seed finding: ${finding.status} ${finding.text}`);
  const item = await postJson(base, cookie, '/api/dd/request-items', { text: 'No-GET-mutates seed request', area: 'hr' });
  assert.ok(item.status === 200 || item.status === 201, `seed request item: ${item.status} ${item.text}`);
  const findingId = (finding.json.finding || finding.json).id;
  const requestItemId = (item.json.item || item.json).id;
  assert.ok(findingId && requestItemId, 'seed ids present');
  // a RAID entry so the report pack has data to assemble (an empty deal is refused 409)
  const raid = await postJson(base, cookie, '/api/raid', { title: 'No-GET-mutates seed risk', type: 'risk', severity: 'high', probability: 'medium' });
  assert.ok(raid.status === 200 || raid.status === 201, `seed raid: ${raid.status} ${raid.text}`);
  return { findingId, requestItemId };
}

/** Drive every inventory route as `cookie`; returns { driven:Set<route>, statuses }. */
async function driveLane(base, laneName, cookie, ids) {
  const driven = new Set();
  const statuses = [];
  for (const routePath of INVENTORY) {
    for (const url of urlsFor(routePath, ids)) {
      state.current = { lane: laneName, url };
      let status;
      try {
        const res = await fetch(base + url, { headers: { cookie }, redirect: 'manual' });
        await res.arrayBuffer();
        status = res.status;
      } finally {
        await drain();
        state.current = null;
      }
      statuses.push({ routePath, url, status });
      driven.add(routePath);
    }
  }
  return { driven, statuses };
}

function assertExercised(statuses, laneName) {
  // A 5xx means the handler fell over before (or instead of) doing its work, so
  // its GET drive would be vacuous. 503 on the PDF pack is by design on hosts
  // without the vendored canvas binding.
  const bad = statuses.filter((s) => s.status >= 500 && !(s.routePath === '/api/reports/pack' && s.status === 503));
  assert.deepStrictEqual(bad, [], `[${laneName}] every GET must answer without a server error so its drive is not vacuous`);
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

test('inventory: every registered GET route is known (the /api subset matches the shared route inventory)', () => {
  const apiGets = listApiRoutes(app).filter((r) => r.method === 'GET').map((r) => r.path);
  for (const p of apiGets) assert.ok(INVENTORY.includes(p), `${p} is in the GET inventory`);
  for (const p of ['/', '/healthz', '*']) assert.ok(INVENTORY.includes(p), `non-/api GET ${p} is in the inventory`);
  assert.strictEqual(new Set(INVENTORY).size, INVENTORY.length, 'no duplicate GET registrations');
  assert.ok(INVENTORY.length >= 58, `expected at least the 58 GET routes known at plan time, saw ${INVENTORY.length}`);
});

test('no GET mutates: every registered GET route, real-deal admin AND demo-store admin, writes nothing outside the audit trail', async (t) => {
  const fx = createDealFixture({
    controlConn, runtimeConn, dealId: 'deal_nogetmut',
    // every DD area granted so the clearance-filtered readers return real records
    members: [{ username: 'ng-admin', role: 'admin', ddAreas: DD_AREA_IDS }],
  });
  const dealCookie = fx.cookie('ng-admin');
  const demoCookie = demoSession({ controlConn, runtimeConn, username: 'ng-demo-admin', role: 'admin' });

  await withServer(async (base) => {
    const dealIds = { dealId: fx.dealId, ...(await seedDd(base, dealCookie)) };
    // The demo store has no resolved deal, so DD clearance is [] for every role there
    // (db/accessPolicy.js grantedAreas fails closed on a null deal): nothing to seed,
    // and the DD by-id readers are driven with 'x' (they refuse, and must not write).
    const demoIds = { dealId: fx.dealId };

    state.sqlWrites.length = 0;
    state.fsWrites.length = 0;

    const dealRun = await driveLane(base, 'real-deal admin', dealCookie, dealIds);
    const demoRun = await driveLane(base, 'demo-store admin', demoCookie, demoIds);

    // no silent skips: every inventory route was driven in both lanes
    assert.strictEqual(dealRun.driven.size, INVENTORY.length, 'real-deal lane drove every GET route');
    assert.strictEqual(demoRun.driven.size, INVENTORY.length, 'demo lane drove every GET route');
    assertExercised(dealRun.statuses, 'real-deal admin');
    assertExercised(demoRun.statuses, 'demo-store admin');

    // no outbound network (ai/insight ran with no provider key)
    assert.deepStrictEqual(state.egress, [], 'no GET reached an external host');

    // the allowlists are live, not vacuous
    const auditWrites = state.sqlWrites.filter((w) => path.resolve(String(w.file)) === path.resolve(AUDIT_DB_PATH));
    assert.ok(auditWrites.length > 0, 'the by-design read-audit writers were observed (instrumentation sees audit.db)');
    assert.ok(state.fsWrites.some((w) => w.url.startsWith('/api/admin/download-zip')), 'the download-zip temp archive was observed');
    assert.ok(zipStubPaths.length >= 2, 'download-zip ran in both lanes');
    for (const p of zipStubPaths) assert.strictEqual(fs.existsSync(p), false, `temp archive ${p} was deleted after sending`);

    for (const [name, run] of [['real-deal admin', dealRun], ['demo-store admin', demoRun]]) {
      const hist = {};
      for (const s of run.statuses) hist[s.status] = (hist[s.status] || 0) + 1;
      t.diagnostic(`${name}: ${run.statuses.length} GETs over ${run.driven.size} routes, status histogram ${JSON.stringify(hist)}`);
      if (process.env.NO_GET_MUTATES_VERBOSE) {
        for (const s of run.statuses) t.diagnostic(`  ${name} ${s.status} ${s.url}`);
      }
    }
    t.diagnostic(`audit-trail INSERTs observed (allowed, by design): ${auditWrites.length}`);

    // THE assertion
    assert.deepStrictEqual(violations(), [], 'a GET route changed state');
  });
});

test('negative control (statement level): a write to the deal DB while a GET is "in flight" is detected', async () => {
  const dealConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_nogetmut'), dbFiles.DEAL_SCHEMA_PATH);
  dealConn.prepare('CREATE TABLE IF NOT EXISTS _no_get_mutates_probe (x)').run();
  state.sqlWrites.length = 0;
  state.fsWrites.length = 0;
  state.current = { lane: 'synthetic', url: '/api/zz-synthetic-get-writer' };
  try {
    dealConn.prepare('INSERT INTO _no_get_mutates_probe VALUES (1)').run();
  } finally {
    state.current = null;
  }
  const found = violations();
  assert.strictEqual(found.length, 1, 'exactly the synthetic write is reported');
  assert.match(found[0], /\/api\/zz-synthetic-get-writer/);
  assert.match(found[0], /deal_nogetmut/);
  assert.match(found[0], /INSERT INTO _no_get_mutates_probe/);
  state.sqlWrites.length = 0;

  // an INSERT into the audit trail is the allowed shape; an UPDATE/DELETE there is not
  assert.strictEqual(sqlWriteViolation({ lane: 'l', url: '/u', file: AUDIT_DB_PATH, sql: 'INSERT INTO audit_events VALUES (1)' }), null);
  assert.ok(sqlWriteViolation({ lane: 'l', url: '/u', file: AUDIT_DB_PATH, sql: 'UPDATE audit_events SET x = 1' }));
  assert.ok(sqlWriteViolation({ lane: 'l', url: '/u', file: AUDIT_DB_PATH, sql: 'DELETE FROM audit_events' }));
});

test('negative control (filesystem): a file write while a GET is "in flight" is detected; only the download-zip temp archive is allowed', () => {
  state.sqlWrites.length = 0;
  state.fsWrites.length = 0;
  state.current = { lane: 'synthetic', url: '/api/zz-synthetic-fs-writer' };
  try {
    fs.writeFileSync(path.join(TMP, 'synthetic-get-write.txt'), 'x');
  } finally {
    state.current = null;
  }
  const found = violations();
  assert.strictEqual(found.length, 1);
  assert.match(found[0], /synthetic-get-write\.txt/);
  state.fsWrites.length = 0;

  // the same temp-archive path is allowed ONLY for the download-zip route
  const archive = path.join(os.tmpdir(), 'ma-app-1700000000000.zip');
  assert.strictEqual(fsWriteViolation({ lane: 'l', url: '/api/admin/download-zip', op: 'writeFileSync', target: archive }), null);
  assert.ok(fsWriteViolation({ lane: 'l', url: '/api/settings', op: 'writeFileSync', target: archive }));
  assert.ok(fsWriteViolation({ lane: 'l', url: '/api/admin/download-zip', op: 'writeFileSync', target: path.join(TMP, 'ma-app-1.zip') }));
});

test('negative control (end to end): a GET handler that calls writeDb is caught through the real server', async () => {
  // Register a deliberately bad GET ahead of the '*' fallback, drive it as the
  // demo-store admin (the demo store is lenient for unlisted read paths), expect a
  // violation naming the route, then remove it again.
  const before = app._router.stack.length;
  app.get('/api/zz-no-get-mutates-control', (req, res) => {
    const data = store.readDb();
    store.writeDb(data); // UPDATE per stored row — a state-changing GET
    res.json({ ok: true });
  });
  const layer = app._router.stack.pop();
  const fallbackIdx = app._router.stack.findIndex((l) => l.route && l.route.path === '*');
  app._router.stack.splice(fallbackIdx, 0, layer);
  try {
    const demoCookie = demoSession({ controlConn, runtimeConn, username: 'ng-control-admin', role: 'admin' });
    await withServer(async (base) => {
      state.sqlWrites.length = 0;
      state.fsWrites.length = 0;
      const url = '/api/zz-no-get-mutates-control';
      state.current = { lane: 'demo-store admin', url };
      try {
        const res = await fetch(base + url, { headers: { cookie: demoCookie } });
        await res.text();
        assert.strictEqual(res.status, 200, 'the synthetic writer ran');
      } finally {
        await drain();
        state.current = null;
      }
      const found = violations();
      assert.ok(found.length > 0, 'the instrumented drive reports the synthetic GET writer');
      assert.ok(found.every((f) => f.includes(url)), 'every violation names the offending route');
      assert.ok(found.some((f) => /UPDATE|INSERT|DELETE/i.test(f)), 'the SQL statement is named');
    });
  } finally {
    const idx = app._router.stack.indexOf(layer);
    if (idx >= 0) app._router.stack.splice(idx, 1);
    assert.strictEqual(app._router.stack.length, before, 'the synthetic route was removed again');
    state.sqlWrites.length = 0;
  }
});

// ---------------------------------------------------------------------------
// Static complement: a handler registered with app.get() must not call writeDb().
// The runtime drive above cannot reach a write that sits behind data the seeded
// fixtures do not contain; this keeps that shape out of GET handlers by source.
// ---------------------------------------------------------------------------
test('static: no app.get() handler in server.js calls writeDb()', () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('\n');
  const offenders = [];
  let current = null;
  let checked = 0;
  lines.forEach((line, i) => {
    const start = /^app\.get\(\s*'([^']+)'/.exec(line);
    if (start) { current = start[1]; checked++; }
    if (current) {
      const code = line.replace(/\/\/.*$/, '');
      if (/\bwriteDb\s*\(/.test(code)) offenders.push(`GET ${current} (server.js:${i + 1}): ${line.trim()}`);
      if (/^\}\);?\s*$/.test(line)) current = null; // top-level handler close
    }
  });
  assert.ok(checked >= 58, `scanned ${checked} app.get handlers`);
  assert.deepStrictEqual(offenders, [], 'a GET handler calls writeDb() — state changes must be POST/PUT/PATCH/DELETE (AUTHZ-04)');
});
