// D-12-05 / DATA-05 / R2-03 (Phase 12, plan 12-04): CPU-bound work runs off the
// event loop behind a one-in-flight guard.
//
//   1. lib/isolatedTask.js unit contract, driven through a throwaway worker
//      fixture: lease semantics, a refused second caller, error / crash /
//      timeout -> worker discarded and the NEXT job gets a fresh one.
//   2. GET /api/reports/pack on a real deal: a valid PDF from the worker, the
//      audit event still written exactly once on the main thread, a second
//      CONCURRENT request refused 429 + Retry-After (never queued), the slot
//      released after completion, after the empty-deal 409 and after a worker
//      failure.
//   3. Source assertions: the worker modules require no database, filesystem,
//      network or child-process module (T-12-32); the crash hook is gated off
//      on a real-deal host (T-12-35).
//
// Boots the REAL requireable app against an ISOLATED temp control/runtime/demo/
// audit set (the MA_* overrides), the same pattern test/reports-pack.test.js
// uses. node:test — run via `node --test test/cpu-isolation.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const ROOT = path.join(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cpu-isolation-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-cpu-isolation-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const auditHook = require('../db/auditHook.js');
const { createDealFixture } = require('./helpers/deal-fixture.js');
const { createIsolatedTask, BusyTaskError, TaskTimeoutError, TaskWorkerError } = require('../lib/isolatedTask.js');

const app = require('../server.js');
require('./helpers/held-version.js').installHeldVersionFetch();

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 1. lib/isolatedTask.js unit contract
// ---------------------------------------------------------------------------
const FIXTURE_WORKER = path.join(TMP_DIR, 'fixture-worker.js');
fs.writeFileSync(FIXTURE_WORKER, [
  `const { serveWorker } = require(${JSON.stringify(path.join(ROOT, 'lib', 'workers', 'serve.js'))});`,
  'serveWorker(async (p) => {',
  "  if (p.op === 'echo') return { result: { echo: p.value } };",
  "  if (p.op === 'throw') throw new Error('boom');",
  "  if (p.op === 'exit') process.exit(3);",
  "  if (p.op === 'hang') return new Promise(() => {});",
  "  if (p.op === 'sleep') { await new Promise((r) => setTimeout(r, p.ms)); return { result: { slept: p.ms } }; }",
  "  throw new Error('unknown op');",
  '});',
].join('\n'));

function fixtureTask(extra) {
  return createIsolatedTask(Object.assign({ name: 'fixture', workerFile: FIXTURE_WORKER }, extra || {}));
}
async function runOnce(task, payload) {
  const lease = task.tryAcquire();
  assert.ok(lease, 'expected a free slot');
  try { return await lease.run(payload); } finally { lease.release(); }
}

test('isolatedTask: runs a job in a worker and returns its result', async () => {
  const task = fixtureTask();
  try {
    assert.deepStrictEqual(await runOnce(task, { op: 'echo', value: 41 }), { echo: 41 });
    assert.strictEqual(task.inFlight(), false);
    assert.strictEqual(task.spawnCount(), 1);
    // The persistent worker is reused, not respawned per job.
    assert.deepStrictEqual(await runOnce(task, { op: 'echo', value: 42 }), { echo: 42 });
    assert.strictEqual(task.spawnCount(), 1);
  } finally { task.close(); }
});

test('isolatedTask: a second tryAcquire while one is held is refused (never queued); release is idempotent and per-lease', async () => {
  const task = fixtureTask();
  try {
    const a = task.tryAcquire();
    assert.ok(a);
    assert.strictEqual(task.inFlight(), true);
    assert.strictEqual(task.tryAcquire(), null, 'a second caller must be refused, not queued');
    a.release();
    assert.strictEqual(task.inFlight(), false);
    const b = task.tryAcquire();
    assert.ok(b);
    a.release(); // a late double release must NOT free b's slot
    assert.strictEqual(task.inFlight(), true, 'a stale lease release must not free a newer lease');
    assert.strictEqual(task.tryAcquire(), null);
    await assert.rejects(a.run({ op: 'echo', value: 1 }), (e) => e instanceof BusyTaskError && e.code === 'TASK_BUSY');
    b.release();
  } finally { task.close(); }
});

test('isolatedTask: WR-B03 — a second run() on a lease whose job is in flight is refused without touching the first job', async () => {
  const task = fixtureTask({ timeoutMs: 5000 });
  try {
    const lease = task.tryAcquire();
    assert.ok(lease);
    const first = lease.run({ op: 'sleep', ms: 200 });
    await assert.rejects(lease.run({ op: 'echo', value: 2 }), (e) => e instanceof BusyTaskError && e.code === 'TASK_BUSY');
    assert.deepStrictEqual(await first, { slept: 200 }, 'the first job still settles with its own result');
    assert.strictEqual(task.spawnCount(), 1, 'the worker was never terminated');
    // Once the first job settled, the same lease may run again.
    assert.deepStrictEqual(await lease.run({ op: 'echo', value: 3 }), { echo: 3 });
    lease.release();
  } finally { task.close(); }
});

test('isolatedTask: a handler error rejects that job only — the worker survives', async () => {
  const task = fixtureTask();
  try {
    await assert.rejects(runOnce(task, { op: 'throw' }), (e) => e instanceof TaskWorkerError && /boom/.test(e.message));
    assert.deepStrictEqual(await runOnce(task, { op: 'echo', value: 7 }), { echo: 7 });
    assert.strictEqual(task.spawnCount(), 1, 'a reported handler error must not cost a respawn');
  } finally { task.close(); }
});

test('isolatedTask: a worker that dies mid-job rejects it and the next job gets a fresh worker', async () => {
  const task = fixtureTask();
  try {
    await assert.rejects(runOnce(task, { op: 'exit' }), (e) => e instanceof TaskWorkerError);
    assert.strictEqual(task.inFlight(), false);
    assert.deepStrictEqual(await runOnce(task, { op: 'echo', value: 9 }), { echo: 9 });
    assert.strictEqual(task.spawnCount(), 2, 'a crash must be followed by a respawn');
  } finally { task.close(); }
});

test('isolatedTask: a job past timeoutMs is terminated and the next job gets a fresh worker', async () => {
  const task = fixtureTask({ timeoutMs: 250 });
  try {
    await assert.rejects(runOnce(task, { op: 'hang' }), (e) => e instanceof TaskTimeoutError && e.code === 'TASK_TIMEOUT');
    assert.deepStrictEqual(await runOnce(task, { op: 'echo', value: 3 }), { echo: 3 });
    assert.strictEqual(task.spawnCount(), 2);
  } finally { task.close(); }
});

test('isolatedTask: an idle worker is terminated after idleMs and respawned on demand', async () => {
  const task = fixtureTask({ idleMs: 120 });
  try {
    await runOnce(task, { op: 'echo', value: 1 });
    await new Promise((r) => setTimeout(r, 400));
    await runOnce(task, { op: 'echo', value: 2 });
    assert.strictEqual(task.spawnCount(), 2);
  } finally { task.close(); }
});

test('isolatedTask: mode "process" is refused loudly rather than silently running in-process (PD-14)', () => {
  assert.throws(() => createIsolatedTask({ name: 'x', workerFile: FIXTURE_WORKER, mode: 'process' }), /not implemented/);
});

// ---------------------------------------------------------------------------
// 2. GET /api/reports/pack
// ---------------------------------------------------------------------------
function auditCount(action) {
  const conn = auditHook.getAuditConnection();
  return conn.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action).n;
}
function packGet(base, cookie, query) {
  return fetch(`${base}/api/reports/pack${query || ''}`, { headers: { Cookie: cookie } });
}
async function seedRaid(base, cookie, n) {
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${base}/api/raid`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `Isolation risk ${i}`, type: 'risk', severity: 'medium' }),
    });
    assert.strictEqual(res.status, 201, `seed RAID ${i}: ${await res.text()}`);
  }
}

test('reports-pack isolation (GET /api/reports/pack)', async (t) => {
  const server = await listenLocal(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());
  const fx = createDealFixture({
    controlConn, runtimeConn, dealId: 'deal_cpuiso', members: [{ username: 'admin', role: 'admin' }],
  });
  const cookie = fx.cookie('admin');
  const emptyFx = createDealFixture({
    controlConn, runtimeConn, dealId: 'deal_cpuisoempty', members: [{ username: 'admin', role: 'admin' }],
  });
  // createDealFixture mints a fresh admin session per deal — keep both cookies.
  const emptyCookie = emptyFx.cookie('admin');
  await seedRaid(base, cookie, 3);

  await t.test('(a) renders a real PDF through the worker; one audit event; same headers', async () => {
    const before = auditCount('report-pack-generated');
    const res = await packGet(base, cookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    assert.ok(/steerco-pack/.test(res.headers.get('content-disposition') || ''), 'filename discipline unchanged');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf.toString('binary', 0, 5), '%PDF-');
    assert.ok(buf.toString('binary', buf.length - 8).includes('%%EOF'));
    assert.strictEqual(auditCount('report-pack-generated') - before, 1, 'exactly one report-pack-generated event');
  });

  await t.test('(b) a second CONCURRENT request is refused 429 + Retry-After, never queued; a later request succeeds', async () => {
    const before = auditCount('report-pack-generated');
    const [r1, r2] = await Promise.all([packGet(base, cookie), packGet(base, cookie)]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepStrictEqual(statuses, [200, 429], `expected exactly one 200 and one 429, got ${statuses}`);
    const refused = r1.status === 429 ? r1 : r2;
    const served = r1.status === 200 ? r1 : r2;
    assert.strictEqual(refused.headers.get('retry-after'), '5');
    assert.deepStrictEqual(await refused.json(), {
      error: 'A steering committee pack is already being generated. Try again in a few seconds.',
    });
    const buf = Buffer.from(await served.arrayBuffer());
    assert.strictEqual(buf.toString('binary', 0, 5), '%PDF-');
    assert.strictEqual(auditCount('report-pack-generated') - before, 1, 'the refused request must not be audited as a generation');

    const again = await packGet(base, cookie);
    assert.strictEqual(again.status, 200, 'the guard must be released once the first render completes');
    await again.arrayBuffer();
  });

  await t.test('(c) an empty deal still answers the existing 409 and releases the slot', async () => {
    const res = await packGet(base, emptyCookie);
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.ok(body.error && /no data yet/.test(body.error));
    const next = await packGet(base, cookie);
    assert.strictEqual(next.status, 200, 'a 409 path must not leak the render slot');
    await next.arrayBuffer();
  });

  await t.test('(d) a worker failure answers a generic 500, releases the slot, and the next request succeeds (respawn)', async () => {
    const before = auditCount('report-pack-generated');
    process.env.MA_TEST_PACK_WORKER_THROW = '1';
    let res;
    try { res = await packGet(base, cookie); } finally { delete process.env.MA_TEST_PACK_WORKER_THROW; }
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.deepStrictEqual(body, { error: 'Failed to generate the steering committee pack.' });
    assert.ok(!/MA_TEST_PACK_WORKER_THROW|deliberate/.test(JSON.stringify(body)), 'no worker detail may reach the client');
    assert.strictEqual(auditCount('report-pack-generated') - before, 0, 'a failed render is not audited as generated');

    const next = await packGet(base, cookie);
    assert.strictEqual(next.status, 200);
    await next.arrayBuffer();
  });
});

// ---------------------------------------------------------------------------
// 2b. POST /api/rag/upload — pdf-parse in a worker, same guard (PD-14, W-9)
// ---------------------------------------------------------------------------
// Same minimal-but-valid single-page PDF test/rag-upload.test.js uses.
const MINIMAL_PDF = [
  '%PDF-1.4',
  '1 0 obj', '<< /Type /Catalog /Pages 2 0 R >>', 'endobj',
  '2 0 obj', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'endobj',
  '3 0 obj', '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>', 'endobj',
  '4 0 obj', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'endobj',
  '5 0 obj', '<< /Length 61 >>', 'stream',
  'BT /F1 24 Tf 100 700 Td (Integration Guidelines Test PDF) Tj ET',
  'endstream', 'endobj',
  'xref', '0 6', '0000000000 65535 f', 'trailer', '<< /Size 6 /Root 1 0 R >>', 'startxref', '0', '%%EOF',
].join('\n');
const dataUrl = (buf) => `data:application/pdf;base64,${Buffer.from(buf).toString('base64')}`;

test('PD-14 probe: pdf-parse loads and extracts text INSIDE a worker_thread (thread mode ships for rag-pdf)', async () => {
  const task = createIsolatedTask({ name: 'rag-pdf-probe', workerFile: path.join(ROOT, 'lib', 'workers', 'pdf-text-worker.js') });
  try {
    assert.strictEqual(task.mode, 'thread');
    const bytes = new Uint8Array(Buffer.from(MINIMAL_PDF, 'utf8'));
    const lease = task.tryAcquire();
    try {
      const out = await lease.run({ data: bytes.buffer }, [bytes.buffer]);
      assert.match(out.text, /Integration Guidelines Test PDF/);
    } finally { lease.release(); }
  } finally { task.close(); }
});

test('PD-14 probe: the pack renderer runs INSIDE a worker_thread (thread mode ships for report-pack)', async () => {
  const task = createIsolatedTask({ name: 'pack-probe', workerFile: path.join(ROOT, 'lib', 'workers', 'report-pack-worker.js') });
  try {
    assert.strictEqual(task.mode, 'thread');
    const lease = task.tryAcquire();
    try {
      const out = await lease.run({
        model: {
          deal: { name: 'Probe' }, language: 'en', generatedAt: '2026-01-01 00:00', generatedBy: 'probe',
          i18n: { strings: { en: {} } },
          rollup: { grossRealizedM: 0, unphasedRealizedM: 0, costIncurredM: 0, netBenefitM: 0, dealTargetM: 0, staleCount: 0 },
          workstreams: [], tasks: [], raid: [], synergies: [], staleThresholdDays: 30,
        },
      });
      assert.strictEqual(Buffer.from(out.pdf).toString('binary', 0, 5), '%PDF-');
    } finally { lease.release(); }
  } finally { task.close(); }
});

test('rag upload isolation (POST /api/rag/upload)', async (t) => {
  const server = await listenLocal(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());
  const fx = createDealFixture({
    controlConn, runtimeConn, dealId: 'deal_cpuisorag', members: [{ username: 'admin', role: 'admin' }],
  });
  const cookie = fx.cookie('admin');
  const upload = (name, fileData) => fetch(`${base}/api/rag/upload`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: name, fileData }),
  });

  await t.test('(a) a valid PDF behaves exactly as before (text extracted in the worker, row persisted)', async () => {
    const res = await upload('worker-policy.pdf', dataUrl(MINIMAL_PDF));
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.upload.fileName, 'worker-policy.pdf');
  });

  await t.test('(b) a second CONCURRENT upload is refused 429 + Retry-After with the fixed body; the slot is then free', async () => {
    const [r1, r2] = await Promise.all([
      upload('first.pdf', dataUrl(MINIMAL_PDF)),
      upload('second.pdf', dataUrl(MINIMAL_PDF)),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepStrictEqual(statuses, [200, 429], `expected exactly one 200 and one 429, got ${statuses}`);
    const refused = r1.status === 429 ? r1 : r2;
    assert.strictEqual(refused.headers.get('retry-after'), '5');
    assert.deepStrictEqual(await refused.json(), { success: false, error: 'Another PDF is being processed. Try again in a few seconds.' });
    (r1.status === 200 ? r1 : r2).arrayBuffer().catch(() => {});

    const again = await upload('third.pdf', dataUrl(MINIMAL_PDF));
    assert.strictEqual(again.status, 200, 'the guard must be released after the first upload completes');
  });

  await t.test('(c) bytes that are not a PDF fail inside the worker as the same generic 500 and release the slot', async () => {
    const res = await upload('garbage.pdf', dataUrl('this is definitely not a pdf'));
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.deepStrictEqual(body, { success: false, error: 'Failed to process and train RAG model.' });
    const next = await upload('after-garbage.pdf', dataUrl(MINIMAL_PDF));
    assert.strictEqual(next.status, 200, 'a failed parse must not leak the slot or wedge the worker');
  });
});

// ---------------------------------------------------------------------------
// 2c. The permanent "unavailable on this host" 503 carries retryable:false
// ---------------------------------------------------------------------------
test('GET /api/reports/pack on a host without the canvas binding -> 503 { error, retryable:false } (PD-15)', () => {
  const { spawnSync } = require('child_process');
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-cpu-isolation-503-'));
  try {
    const probe = [
      "const Module = require('module');",
      'const originalLoad = Module._load;',
      'Module._load = function (request) {',
      "  if (request === '@napi-rs/canvas') {",
      "    const err = new Error(\"Cannot find module './skia.linux-arm64-gnu.node'\");",
      "    err.code = 'MODULE_NOT_FOUND';",
      '    throw err;',
      '  }',
      '  return originalLoad.apply(this, arguments);',
      '};',
      "const store = require('./db/store.js');",
      "const dbFiles = require('./db/dbFiles.js');",
      "const sessionsDb = require('./db/sessions.js');",
      "const { ensureUser } = require('./test/helpers/seed-identity.js');",
      "const app = require('./server.js');",
      'const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);',
      'const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);',
      "ensureUser(controlConn, { username: 'admin', role: 'admin' });",
      "const token = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 3600000 });",
      "const server = app.listen(0, '127.0.0.1');",
      "server.once('listening', async () => {",
      '  const { port } = server.address();',
      "  const res = await fetch('http://127.0.0.1:' + port + '/api/reports/pack', { headers: { Cookie: 'ma_session=' + token } });",
      "  console.log('RESULT=' + JSON.stringify({ status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json() }));",
      '  server.close();',
      '  process.exit(0);',
      '});',
    ].join('\n');
    const env = Object.assign({}, process.env, {
      MA_CONTROL_DB_PATH: path.join(probeDir, 'control.db'),
      MA_RUNTIME_DB_PATH: path.join(probeDir, 'runtime.db'),
      MA_DEMO_DB_PATH: path.join(probeDir, 'demo.db'),
      MA_DEALS_DIR: path.join(probeDir, 'deals'),
      MA_AUDIT_DB_PATH: path.join(probeDir, 'audit.db'),
      ADMIN_TOKEN: 'gsd-cpu-isolation-503-token',
    });
    const result = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, encoding: 'utf8', env });
    assert.strictEqual(result.status, 0, `probe exited non-zero: stdout=${result.stdout} stderr=${result.stderr}`);
    const m = /RESULT=(.*)/.exec(result.stdout);
    assert.ok(m, `expected a RESULT line, got: ${result.stdout} / ${result.stderr}`);
    const out = JSON.parse(m[1]);
    assert.strictEqual(out.status, 503);
    assert.deepStrictEqual(out.body, {
      error: 'PDF pack generation is unavailable on this host platform',
      retryable: false,
    });
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. Source assertions (T-12-32, T-12-35, portability seam)
// ---------------------------------------------------------------------------
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, '')).join('\n');
}

test('worker modules require no database, filesystem, network or child-process module (T-12-32)', () => {
  const files = ['serve.js', 'report-pack-worker.js', 'pdf-text-worker.js'];
  const banned = /require\(\s*['"`](?:\.\.?\/)*(?:db\/[^'"`]*|fs|node:fs|fs\/promises|http|https|net|dgram|tls|child_process|node:child_process|worker_threads\/[^'"`]*|better-sqlite3|\.\.\/server|\.\.\/\.\.\/server)['"`]\s*\)/;
  for (const f of files) {
    const src = stripComments(fs.readFileSync(path.join(ROOT, 'lib', 'workers', f), 'utf8'));
    const m = banned.exec(src);
    assert.ok(!m, `lib/workers/${f} must not require ${m && m[0]}`);
    assert.ok(!/\bfetch\s*\(/.test(src), `lib/workers/${f} must not call fetch`);
  }
});

test('the pack-worker crash hook is ignored on a real-deal host (T-12-35)', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/MA_TEST_PACK_WORKER_THROW === '1' && process\.env\.MA_MODE !== 'real'/.test(server),
    'server.js must gate MA_TEST_PACK_WORKER_THROW on MA_MODE !== "real"');
  const worker = fs.readFileSync(path.join(ROOT, 'lib', 'workers', 'report-pack-worker.js'), 'utf8');
  assert.ok(/process\.env\.MA_MODE !== 'real'/.test(worker), 'the worker must repeat the real-mode gate');
});

test('server.js reaches lib/reportPack only through the lazy getter; the pack route renders via packTask (not buildPack in-process)', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = /app\.get\('\/api\/reports\/pack',\s*async \(req, res(?:, next)?\) => \{([\s\S]*?)\n\}\);/.exec(server);
  assert.ok(m, 'pack route located');
  assert.ok(!/\.buildPack\(/.test(m[1]), 'the route must not call buildPack on the main thread');
  assert.ok(/packTask\.tryAcquire\(\)/.test(server) && /lease\.run\(/.test(m[1]), 'the route must render through the isolated task');
});
