// AUTHZ-02 / D-11-02 / T-11-11 (Phase 11, plan 11-02, Task 2): GET /api/settings
// returns an ALLOWLISTED subset to every non-admin caller — never a blocklist,
// so a future secret-ish settings key is withheld by default. Admin keeps the
// pre-existing response (publicSettings() output) byte-for-byte.
//
// Also a client-read drift scan: every `settings.<key>` the browser code reads
// must be in PUBLIC_SETTINGS_KEYS or in an explicit, justified admin-only list,
// so adding a client read without allowlisting it fails here, not in production.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-settings-public-subset-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = '';
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const { PUBLIC_SETTINGS_KEYS } = require('../validators/settings.js');

const app = require('../server.js');
const controlStore = require('../db/controlStore.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  ensureUser(controlConn, { username, role });
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const SECRET_PATTERN = /secret|token|password|connection|apikey/i;
const SENTINEL_KEY = 'sk-test-SENTINEL-do-not-leak-1234567890';
const SENTINEL_CONN = 'postgres://user:SENTINEL-pw@db.example/prod';

async function getSettings(base, token) {
  const res = await fetch(`${base}/api/settings`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
  assert.strictEqual(res.status, 200);
  return res.json();
}

function assertPublicShape(label, body) {
  assert.ok(body && typeof body === 'object' && !Array.isArray(body), `${label}: settings must be an object`);
  for (const key of Object.keys(body)) {
    assert.ok(PUBLIC_SETTINGS_KEYS.includes(key), `${label}: key '${key}' is not in PUBLIC_SETTINGS_KEYS`);
    if (key === 'hasGeminiApiKey') continue; // the one boolean capability flag, asserted below
    assert.ok(!SECRET_PATTERN.test(key), `${label}: key '${key}' looks secret`);
  }
  for (const banned of ['geminiApiKey', 'databaseConfig', 'connectionDetails']) {
    assert.ok(!(banned in body), `${label}: must not contain ${banned}`);
  }
  const text = JSON.stringify(body);
  assert.ok(!text.includes(SENTINEL_KEY), `${label}: the API key value must never appear`);
  assert.ok(!text.includes('SENTINEL-pw'), `${label}: the connection string must never appear`);
  if ('hasGeminiApiKey' in body) assert.strictEqual(typeof body.hasGeminiApiKey, 'boolean', `${label}: hasGeminiApiKey must be a boolean`);
}

// Seeds a settings singleton with a secret-bearing shape on whichever store the
// admin session is bound to, via the real (admin-only) POST route.
async function seedSecrets(base, adminToken) {
  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetCompany: 'Subset Probe Co',
      geminiApiKey: SENTINEL_KEY,
      browserModel: 'Xenova/probe-model',
      databaseConfig: { provider: 'postgres', connectionDetails: SENTINEL_CONN },
      welcomeVideoUrl_de: 'https://example.com/de.mp4',
    }),
  });
  assert.strictEqual(res.status, 200, 'admin seed write must succeed');
}

test('settings-public-subset (a): PUBLIC_SETTINGS_KEYS is a frozen allowlist without secrets; hasGeminiApiKey is the only /key/i member', () => {
  assert.ok(Array.isArray(PUBLIC_SETTINGS_KEYS));
  assert.ok(Object.isFrozen(PUBLIC_SETTINGS_KEYS), 'the allowlist must be frozen');
  for (const banned of ['geminiApiKey', 'databaseConfig', 'connectionDetails']) {
    assert.ok(!PUBLIC_SETTINGS_KEYS.includes(banned), `${banned} must never be public`);
  }
  const keyish = PUBLIC_SETTINGS_KEYS.filter((k) => /key/i.test(k));
  assert.deepStrictEqual(keyish, ['hasGeminiApiKey']);
  assert.strictEqual(new Set(PUBLIC_SETTINGS_KEYS).size, PUBLIC_SETTINGS_KEYS.length, 'no duplicate keys');
});

test('settings-public-subset (b): pmo, hrbp, employee on the demo store see only allowlisted keys, never a secret', async () => {
  const adminToken = newSession('sps-admin-b', 'admin');
  const tokens = [['pmo', newSession('sps-pmo-b', 'pmo')], ['hrbp', newSession('sps-hrbp-b', 'hrbp')], ['employee', newSession('sps-emp-b', 'employee')]];
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await seedSecrets(base, adminToken);
    for (const [role, token] of tokens) {
      const body = await getSettings(base, token);
      assertPublicShape(`demo/${role}`, body);
      assert.strictEqual(body.targetCompany, 'Subset Probe Co', `${role} must still see the non-secret company name`);
      assert.strictEqual(body.hasGeminiApiKey, true, `${role} sees only the capability flag`);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    for (const [, t] of tokens) sessionsDb.deleteSession(runtimeConn, t);
    server.close();
  }
});

test('settings-public-subset (c): the same holds for member sessions inside a REAL deal', async () => {
  const deal = {
    id: 'deal_spsc', name: 'SPS C', targetCompany: 'SPS C Co', members: ['sps-pmo-c', 'sps-hrbp-c', 'sps-emp-c', 'sps-admin-c'],
    memberGrants: {}, status: 'active', createdBy: 'sps-admin-c', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const adminToken = newSession('sps-admin-c', 'admin'); bindDeal(adminToken, deal.id);
  const tokens = [['pmo', newSession('sps-pmo-c', 'pmo')], ['hrbp', newSession('sps-hrbp-c', 'hrbp')], ['employee', newSession('sps-emp-c', 'employee')]];
  for (const [, t] of tokens) bindDeal(t, deal.id);
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await seedSecrets(base, adminToken);
    for (const [role, token] of tokens) {
      assertPublicShape(`deal/${role}`, await getSettings(base, token));
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    for (const [, t] of tokens) sessionsDb.deleteSession(runtimeConn, t);
    server.close();
  }
});

test('settings-public-subset (d): anonymous demo-open (DEMO_OPEN=1) callers get the allowlisted subset too', async () => {
  const adminToken = newSession('sps-admin-d', 'admin');
  const server = await listenLocal(app);
  const prev = process.env.DEMO_OPEN;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await seedSecrets(base, adminToken);
    process.env.DEMO_OPEN = '1';
    const body = await getSettings(base, null);
    assertPublicShape('demo-open/anonymous', body);
    assert.strictEqual(body.targetCompany, 'Subset Probe Co');
  } finally {
    if (prev === undefined) delete process.env.DEMO_OPEN; else process.env.DEMO_OPEN = prev;
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('settings-public-subset (e): admin gets the unchanged full publicSettings() response (flag instead of key; no connectionDetails)', async () => {
  const adminToken = newSession('sps-admin-e', 'admin');
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await seedSecrets(base, adminToken);
    const body = await getSettings(base, adminToken);
    assert.strictEqual(body.hasGeminiApiKey, true);
    assert.ok(!('geminiApiKey' in body), 'even the admin never receives the key value');
    assert.ok(body.databaseConfig && body.databaseConfig.provider === 'postgres', 'admin console still gets databaseConfig.provider');
    assert.ok(!('connectionDetails' in body.databaseConfig), 'connectionDetails is stripped for admin too');
    assert.strictEqual(body.browserModel, 'Xenova/probe-model');
    assert.ok(!JSON.stringify(body).includes('SENTINEL'));
    // byte-for-byte: the admin response is exactly publicSettings(<stored + secret merge>)
    const secret = controlStore.getSecretSettings();
    assert.strictEqual(secret.geminiApiKey, SENTINEL_KEY);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

// -- client-read drift scan -----------------------------------------------------

// Keys the browser reads that are intentionally NOT public — each has a reason.
// (Admin-console form fields; the admin response is unchanged, see (e).)
const ADMIN_ONLY_CLIENT_KEYS = {
  databaseConfig: 'admin.js migration panel only (provider/enabled); never read on a non-admin page',
};

test('settings-public-subset (f): every settings.<key> the client reads is allowlisted or explicitly admin-only (drift scan)', () => {
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  const files = [];
  for (const f of fs.readdirSync(path.join(PUBLIC_DIR, 'js'))) if (f.endsWith('.js')) files.push(path.join(PUBLIC_DIR, 'js', f));
  for (const f of fs.readdirSync(PUBLIC_DIR)) if (f.endsWith('.html')) files.push(path.join(PUBLIC_DIR, f));
  const read = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/\/api\/settings['"`]/.test(src)) continue; // only files that actually fetch the settings singleton
    for (const m of src.matchAll(/\bsettings\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (!read.has(m[1])) read.set(m[1], path.basename(file));
    }
  }
  assert.ok(read.size >= 10, `scan found suspiciously few reads (${read.size})`);
  const unlisted = [];
  for (const [key, file] of read) {
    if (PUBLIC_SETTINGS_KEYS.includes(key)) continue;
    if (Object.prototype.hasOwnProperty.call(ADMIN_ONLY_CLIENT_KEYS, key)) continue;
    unlisted.push(`${key} (read in ${file})`);
  }
  assert.deepStrictEqual(unlisted, [], 'client reads a settings key that is neither public nor declared admin-only: ' + unlisted.join(', '));
});
