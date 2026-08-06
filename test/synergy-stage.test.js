// SYN-03 / D-07 / D-11: proves the one-way lifecycle-vocabulary cutover —
// `stage` (idea/validated/committed/captured) replaces the retired
// `status` (identified/validated/planned/executing/realized) — across all
// three independent code copies, refused-not-coerced legacy values, and (in
// Task 3's extension below) the committed-database migration script.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/synergy-phasing.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/synergy-stage.test.js` (or `npm test`). Never `node --test test/`
// (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-synergy-stage-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');
const workstreamValidators = require('../validators/workstream.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/dd-findings.test.js).
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function freshDeal(id, overrides) {
  return {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides,
  };
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// --------------------------------------------------------- anti-drift --

// D-11: the mechanism that makes a one-copy-behind edit impossible to ship
// — reads all THREE independent copies (two via require(), the client's via
// fs.readFileSync + a regex extraction, since it is a browser-global IIFE
// never require()-able under node:test) and asserts all three are the
// identical ordered four-value array.
test('synergy-stage (a): server.js, validators/workstream.js and public/js/execution.js all hold the identical ordered SYN_STAGES vocabulary', () => {
  const expected = ['idea', 'validated', 'committed', 'captured'];

  assert.deepStrictEqual(app.SYN_STAGES, expected, 'server.js SYN_STAGES must be the exact ordered four-value vocabulary');
  assert.deepStrictEqual(workstreamValidators.SYN_STAGES, expected, 'validators/workstream.js SYN_STAGES must be the exact ordered four-value vocabulary');

  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
  const match = clientSrc.match(/var SYN_STAGES\s*=\s*(\[[^\]]*\]);/);
  assert.ok(match, 'public/js/execution.js must declare a var SYN_STAGES = [...] array literal');
  // eslint-disable-next-line no-eval
  const clientStages = JSON.parse(match[1].replace(/'/g, '"'));
  assert.deepStrictEqual(clientStages, expected, 'public/js/execution.js SYN_STAGES must be the exact ordered four-value vocabulary');

  // Cross-file agreement, not just each-matches-expected independently — this
  // is what actually fails if only ONE of the three is edited.
  assert.deepStrictEqual(app.SYN_STAGES, workstreamValidators.SYN_STAGES);
  assert.deepStrictEqual(workstreamValidators.SYN_STAGES, clientStages);
});

test('synergy-stage (b): the client label map and colour map each have exactly four keys matching the vocabulary array', () => {
  const expected = ['idea', 'validated', 'committed', 'captured'];
  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');

  const labelsMatch = clientSrc.match(/var SYN_LABELS\s*=\s*(\{[^}]*\});/);
  assert.ok(labelsMatch, 'public/js/execution.js must declare a var SYN_LABELS = {...} object literal');
  const labels = JSON.parse(labelsMatch[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  assert.deepStrictEqual(Object.keys(labels).sort(), [...expected].sort(), 'SYN_LABELS must have exactly the four vocabulary keys');

  const colorsMatch = clientSrc.match(/var SYN_COLORS\s*=\s*(\{[^}]*\});/);
  assert.ok(colorsMatch, 'public/js/execution.js must declare a var SYN_COLORS = {...} object literal');
  const colors = JSON.parse(colorsMatch[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  assert.deepStrictEqual(Object.keys(colors).sort(), [...expected].sort(), 'SYN_COLORS must have exactly the four vocabulary keys');
});

// -------------------------------------------------------- schema-level --

test('synergy-stage (c): SynergyUpsertSchema accepts a create with stage "idea" and rejects a retired legacy status value', () => {
  const ok = workstreamValidators.SynergyUpsertSchema.safeParse({ title: 'x', stage: 'idea' });
  assert.strictEqual(ok.success, true, 'a create carrying a valid stage value must parse successfully');

  const legacy = workstreamValidators.SynergyUpsertSchema.safeParse({ title: 'x', stage: 'identified' });
  assert.strictEqual(legacy.success, false, 'a create carrying a retired legacy status value must be REFUSED by the schema, never coerced');
});

// ------------------------------------------------------------- http --

test('synergy-stage (d): POST /api/synergies with no stage creates an initiative whose stage is the first ordered vocabulary value', async () => {
  const deal = freshDeal('deal_synsd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Stage-less create', category: 'cost' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.initiative.stage, 'idea', 'a stage-less create must default to the first vocabulary value');
    assert.strictEqual(body.initiative.status, undefined, 'the retired `status` key must not be present on a newly created initiative');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage (e): POST /api/synergies carrying a retired legacy stage value returns 400 and creates no row (D-11 — refusal, never coercion)', async () => {
  const deal = freshDeal('deal_synse');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should be refused', category: 'cost', stage: 'executing' }),
    });
    assert.strictEqual(res.status, 400);

    const listRes = await fetch(`${base}/api/synergies`, { headers: { Cookie: cookieHeader(karenToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, 0, 'a refused create must not add a row to the lane');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('synergy-stage (f): an existing initiative can be advanced through the update branch by writing `stage`, and a retired legacy value is refused there too', async () => {
  const deal = freshDeal('deal_synsf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Advance me', category: 'cost' }),
    });
    const { initiative } = await createRes.json();
    assert.strictEqual(initiative.stage, 'idea');

    const advanceRes = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: initiative.id, stage: 'validated' }),
    });
    assert.strictEqual(advanceRes.status, 200);
    const advanced = await advanceRes.json();
    assert.strictEqual(advanced.initiative.stage, 'validated');

    const legacyRes = await fetch(`${base}/api/synergies`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: initiative.id, stage: 'planned' }),
    });
    assert.strictEqual(legacyRes.status, 400, 'an update carrying a retired legacy stage value must also be refused, not coerced');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ------------------------------------------- Task 3: migration script --

const { migrateSynergyStages } = require('../scripts/migrate-synergy-stages.js');

const LEGACY_ROWS = [
  { id: 'syn_mig_1', status: 'identified' },
  { id: 'syn_mig_2', status: 'validated' },
  { id: 'syn_mig_3', status: 'planned' },
  { id: 'syn_mig_4', status: 'executing' },
  { id: 'syn_mig_5', status: 'realized' },
];
const LEGACY_I18N_LABELS = {
  en: { 'syn.st_identified': 'Identified', 'syn.st_validated': 'Validated', 'syn.st_planned': 'Planned', 'syn.st_executing': 'Executing', 'syn.st_realized': 'Realized', 'unrelated.key': 'Untouched' },
  de: { 'syn.st_identified': 'Identifiziert', 'syn.st_validated': 'Validiert', 'syn.st_planned': 'Geplant', 'syn.st_executing': 'In Umsetzung', 'syn.st_realized': 'Realisiert' },
  zh: { 'syn.st_identified': '已识别', 'syn.st_validated': '已验证', 'syn.st_planned': '已规划', 'syn.st_executing': '执行中', 'syn.st_realized': '已实现' },
  cs: { 'syn.st_identified': 'Identifikováno', 'syn.st_validated': 'Ověřeno', 'syn.st_planned': 'Naplánováno', 'syn.st_executing': 'V realizaci', 'syn.st_realized': 'Realizováno' },
};

function seedLegacyMigrationDb(dbPath) {
  const conn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  try {
    LEGACY_ROWS.forEach((row, i) => {
      const item = { id: row.id, title: 'Migration seed ' + row.id, category: 'cost', targetM: 1, realizedM: 0, status: row.status, createdAt: new Date().toISOString() };
      conn.prepare('INSERT INTO synergyInitiatives (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
        .run(row.id, null, i, JSON.stringify(item));
    });
    conn.prepare("INSERT INTO app_state (key, data) VALUES ('i18n', ?)")
      .run(JSON.stringify({ languages: [{ code: 'en' }, { code: 'de' }, { code: 'zh' }, { code: 'cs' }], defaultLang: 'en', strings: LEGACY_I18N_LABELS }));
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }
}

function readMigrationDb(dbPath) {
  const conn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  try {
    const rows = conn.prepare('SELECT id, data FROM synergyInitiatives ORDER BY id').all().map((r) => JSON.parse(r.data));
    const i18nRow = conn.prepare("SELECT data FROM app_state WHERE key = 'i18n'").get();
    return { rows, i18n: JSON.parse(i18nRow.data) };
  } finally {
    conn.close();
  }
}

test('synergy-stage (g): migrateSynergyStages rewrites every legacy row onto the four-stage vocabulary, deletes the retired `status` key, and migrates the i18n singleton per D-07\'s mechanical map', () => {
  const dbPath = path.join(TMP_DIR, 'migration-test-g.db');
  seedLegacyMigrationDb(dbPath);

  const result = migrateSynergyStages(dbPath);
  assert.strictEqual(result.rowsMigrated, 5);
  assert.strictEqual(result.rowsSkipped, 0);

  const { rows, i18n } = readMigrationDb(dbPath);
  const expectedStages = { syn_mig_1: 'idea', syn_mig_2: 'validated', syn_mig_3: 'committed', syn_mig_4: 'committed', syn_mig_5: 'captured' };
  rows.forEach((r) => {
    assert.strictEqual(r.stage, expectedStages[r.id], `row ${r.id} must map to ${expectedStages[r.id]} per D-07's mechanical map`);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r, 'status'), false, `row ${r.id} must have the retired status key deleted`);
  });

  ['en', 'de', 'zh', 'cs'].forEach((lang) => {
    const strings = i18n.strings[lang];
    ['syn.st_idea', 'syn.st_validated', 'syn.st_committed', 'syn.st_captured'].forEach((newKey) => {
      const isDirectPredecessor = newKey === 'syn.st_validated' || newKey === 'syn.st_captured';
      if (lang === 'en' || isDirectPredecessor) {
        assert.ok(strings[newKey], `${lang} must carry ${newKey}`);
      }
    });
    ['syn.st_identified', 'syn.st_planned', 'syn.st_executing', 'syn.st_realized'].forEach((retiredKey) => {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(strings, retiredKey), false, `${lang} must no longer carry the retired key ${retiredKey}`);
    });
  });
  // An untouched, unrelated key must survive the rewrite unchanged.
  assert.strictEqual(i18n.strings.en['unrelated.key'], 'Untouched');
});

test('synergy-stage (h): running migrateSynergyStages a second time is a full no-op — byte-identical result, zero rows migrated', () => {
  // Seed ONE database, then fs.copyFileSync it to two paths BEFORE either is
  // migrated — two independently-INSERTed SQLite files can differ at the
  // byte level even with identical logical content (page layout, freelist
  // state), so a true file copy is what makes byte-equality a meaningful
  // idempotency proof rather than an artifact of independent construction.
  const seedPath = path.join(TMP_DIR, 'migration-test-h-seed.db');
  const dbPathA = path.join(TMP_DIR, 'migration-test-h-a.db');
  const dbPathB = path.join(TMP_DIR, 'migration-test-h-b.db');
  seedLegacyMigrationDb(seedPath);
  fs.copyFileSync(seedPath, dbPathA);
  fs.copyFileSync(seedPath, dbPathB);

  migrateSynergyStages(dbPathA);
  migrateSynergyStages(dbPathB);
  const second = migrateSynergyStages(dbPathB);

  assert.strictEqual(second.rowsMigrated, 0, 'a second run must migrate zero rows');
  assert.strictEqual(second.rowsSkipped, LEGACY_ROWS.length, 'a second run must find every row already migrated');
  assert.strictEqual(second.languagesTouched, 0, 'a second run must touch zero i18n languages');

  const bytesA = fs.readFileSync(dbPathA);
  const bytesB = fs.readFileSync(dbPathB);
  assert.ok(bytesA.equals(bytesB), 'a single run and a run-twice result must be byte-identical on disk');
});
