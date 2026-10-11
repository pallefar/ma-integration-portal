// [security] CR-B01 / WR-B04 (Phase 13 review, Part B): stored URL fields that
// the client writes into an `href`/`src` only ever hold a relative reference or
// an absolute http(s) URL, and a legacy unsafe value already in a store renders
// inert on the IL/admin dashboard.
//
//   * unit rows   — validators/index.js urlField(): the accept/refuse table;
//   * registry    — every registered URL-valued write field refuses the
//                   review's payloads (module + lesson playbookLink, sidebar /
//                   landing-card / bookmark targets, CMS block ctaHref/href,
//                   welcomeVideoUrl*);
//   * server rows — the real app on isolated MA_* temp stores (the committed
//                   data/*.db is never opened): a pmo POST /api/modules with the
//                   review's payloads answers 400 and writes nothing;
//   * render row  — a legacy payload inserted straight into the temp deal DB is
//                   served by GET /api/modules and run through the REAL
//                   dashboard.js renderActionModules() + the REAL safe-html.js
//                   under node:vm: the anchor's href falls back to the playbook,
//                   no HTML-string sink is touched. (The browser proof is the
//                   plan 13-12 runner's job.)
//
// node:test — run via `node --test test/url-field-safety.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-url-field-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const app = require('../server.js');
const { urlField, resolveSchema } = require('../validators');

const ROOT = path.join(__dirname, '..');
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const fixtureUsers = JSON.parse(fs.readFileSync(path.join(ROOT, 'db.json'), 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// The review's reproduction payloads plus the scheme/obfuscation family.
const REFUSED = [
  'x" ><img src=x onerror="window.__xss=1"><a href="',
  'javascript:window.__xss=1',
  'JaVaScRiPt:alert(1)',
  '  javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  '//attacker.example/reset',
  '/\\attacker.example/reset',
  '\\\\attacker.example',
  '/\t/attacker.example',
  'java\tscript:alert(1)',
  'mailto:x@example.test',
  'playbook.html',
];
const ACCEPTED = [
  '',
  '/playbook.html#culture',
  '/employee.html?name=Alex&role=R%26D%20Specialist&dept=R%26D',
  '/',
  '#survey-modal',
  '?tab=value',
  'https://www.youtube.com/watch?v=g7Qa2ZBOCNM',
  'HTTP://example.test/x',
  // Documented residual: an absolute http(s) URL is a legitimate link target;
  // the server rule cannot tell a lure from a real external reference.
  'https://attacker.example/reset-password',
];

test('urlField: refuses every non-http(s) scheme, protocol-relative forms, control characters and bare names', () => {
  const schema = urlField(2000);
  for (const v of REFUSED) {
    const r = schema.safeParse(v);
    assert.strictEqual(r.success, false, `must be refused: ${JSON.stringify(v)}`);
    assert.ok(r.error.issues.every((i) => !i.message.includes(v.trim())), 'the message never echoes the value');
  }
  for (const v of ACCEPTED) {
    assert.strictEqual(schema.safeParse(v).success, true, `must be accepted: ${JSON.stringify(v)}`);
  }
  assert.strictEqual(schema.safeParse('/' + 'a'.repeat(2000)).success, false, 'max length still applies');
  assert.strictEqual(schema.parse('  /playbook.html  '), '/playbook.html', 'the stored value is trimmed');
});

test('urlField alsoAllow: widens for exactly the named token shape (bare YouTube id), never a scheme', () => {
  const schema = urlField(2000, { alsoAllow: /^[\w-]{11}$/ });
  assert.strictEqual(schema.safeParse('g7Qa2ZBOCNM').success, true);
  assert.strictEqual(schema.safeParse('javascript:').success, false);
  assert.strictEqual(schema.safeParse('abc"def<ghi').success, false);
  assert.strictEqual(schema.safeParse('g7Qa2ZBOCNMx').success, false);
});

// Every URL-valued writable field, addressed through the REAL registry.
function lessonBody(v) { return { lesson: { playbookLink: v } }; }
const FIELDS = [
  { route: '/api/modules', label: 'modules.playbookLink', body: (v) => ({ title: 't', dimension: 'culture', urgency: 'High', description: 'd', playbookLink: v }), pick: (d) => d.playbookLink },
  { route: '/api/courses/:courseId/lessons', label: 'lesson.playbookLink', body: lessonBody, pick: (d) => d.lesson.playbookLink },
  { route: '/api/menus', label: 'menus.sidebar[].href', body: (v) => ({ sidebar: [{ href: v }] }), pick: (d) => d.sidebar[0].href },
  { route: '/api/menus', label: 'menus.landingCards[].href', body: (v) => ({ landingCards: [{ href: v }] }), pick: (d) => d.landingCards[0].href },
  { route: '/api/menus', label: 'menus.bookmarks[].page', body: (v) => ({ bookmarks: [{ page: v }] }), pick: (d) => d.bookmarks[0].page },
  { route: '/api/pages', label: 'pages.layout[].data.ctaHref', body: (v) => ({ layout: [{ id: 'b1', type: 'hero', data: { ctaHref: v } }] }), pick: (d) => d.layout[0].data.ctaHref },
  { route: '/api/pages', label: 'pages.layout[].data.href', body: (v) => ({ layout: [{ id: 'b1', type: 'cta', data: { href: v } }] }), pick: (d) => d.layout[0].data.href },
  ...['', '_en', '_de', '_zh', '_cs'].map((suf) => ({
    route: '/api/settings', label: `settings.welcomeVideoUrl${suf}`, body: (v) => ({ [`welcomeVideoUrl${suf}`]: v }), pick: (d) => d[`welcomeVideoUrl${suf}`],
  })),
];

test('registry: every URL-valued write field refuses the payloads and keeps legitimate values', () => {
  for (const f of FIELDS) {
    const schema = resolveSchema('POST', f.route);
    assert.ok(schema, `schema registered for POST ${f.route}`);
    for (const v of REFUSED) {
      assert.strictEqual(schema.safeParse(f.body(v)).success, false, `${f.label} must refuse ${JSON.stringify(v)}`);
    }
    for (const v of ACCEPTED) {
      const r = schema.safeParse(f.body(v));
      assert.strictEqual(r.success, true, `${f.label} must accept ${JSON.stringify(v)}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
      assert.strictEqual(f.pick(r.data), v.trim());
    }
  }
});

// ------------------------------------------------------------- server rows
function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`, members: ['admin', 'pmo'],
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, 0, deal.status, JSON.stringify(deal));
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}
function newSession(username, role, dealId) {
  const token = sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
  if (dealId) sessionsDb.bindSessionDeal(runtimeConn, token, dealId);
  return token;
}
const cookie = (token) => ({ Cookie: `ma_session=${token}` });

const DEAL = makeDeal('deal_urlfield');

test('server: pmo POST /api/modules with the review payloads answers 400 and stores nothing; a legitimate link is stored', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const pmo = newSession('pmo', 'pmo', DEAL.id);
    const before = await (await fetch(`${base}/api/modules`, { headers: cookie(pmo) })).json();
    const payloads = [
      'x" ><img src=x onerror="window.__xss=1"><a href="',
      'javascript:window.__xss=1',
      'data:text/html,<script>window.__xss=1</script>',
      '//attacker.example/reset',
    ];
    for (const playbookLink of payloads) {
      const res = await fetch(`${base}/api/modules`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, cookie(pmo)),
        body: JSON.stringify({ title: 'Recommended', dimension: 'culture', urgency: 'High', minScore: 0, maxScore: 5, description: 'd', playbookLink }),
      });
      assert.strictEqual(res.status, 400, `payload must be refused: ${playbookLink}`);
      const body = await res.json();
      assert.ok(/playbookLink: Link must be a relative path or http\(s\) URL/.test(body.error), body.error);
      assert.ok(!body.error.includes(playbookLink), 'the refusal never echoes the value');
    }
    const after = await (await fetch(`${base}/api/modules`, { headers: cookie(pmo) })).json();
    assert.strictEqual(after.length, before.length, 'nothing was written');

    const ok = await fetch(`${base}/api/modules`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie(pmo)),
      body: JSON.stringify({ title: 'Recommended', dimension: 'culture', urgency: 'High', description: 'd', playbookLink: '/playbook.html#culture' }),
    });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual((await ok.json()).module.playbookLink, '/playbook.html#culture');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// -------------------------------------------------------------- render row
// Extracts `function name(...) { ... }` from source by brace matching (the
// function body holds no brace inside a string or regex literal).
function extractFunction(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

// A minimal DOM: elements record attributes/children/text; any HTML-string
// sink throws so the row fails loudly if the render path regresses.
function makeDocument() {
  const sinks = [];
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.style = { cssText: '' }; this.className = ''; this._text = ''; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    appendChild(c) { this.children.push(c); return c; }
    replaceChildren(...c) { this.children = c; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set innerHTML(v) { sinks.push(['innerHTML', String(v)]); throw new Error('innerHTML sink reached'); }
    get innerHTML() { return ''; }
    set outerHTML(v) { sinks.push(['outerHTML', String(v)]); throw new Error('outerHTML sink reached'); }
    insertAdjacentHTML(p, v) { sinks.push(['insertAdjacentHTML', String(v)]); throw new Error('insertAdjacentHTML sink reached'); }
    querySelectorAll(sel) {
      const out = [];
      const tag = sel.toUpperCase();
      const walk = (n) => { (n.children || []).forEach((c) => { if (c.tagName === tag) out.push(c); walk(c); }); };
      walk(this);
      return out;
    }
  }
  const doc = {
    createElement: (t) => new El(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    write: (v) => { sinks.push(['document.write', String(v)]); throw new Error('document.write reached'); },
  };
  return { doc, El, sinks };
}

test('render: a legacy unsafe playbookLink inserted straight into the store renders inert through dashboard.js renderActionModules', async () => {
  // 1. Legacy rows that predate the validator, written below the API.
  const dealConn = store.getOrOpenConnection(dbFiles.dealDbPath(DEAL.id), dbFiles.DEAL_SCHEMA_PATH);
  const legacy = [
    { id: 'mod_legacy_xss', title: '<img src=x onerror=1>', dimension: 'culture', urgency: 'High', minScore: 0, maxScore: 5, description: 'legacy', playbookLink: 'x" ><img src=x onerror="window.__xss=1"><a href="' },
    { id: 'mod_legacy_js', title: 'js', dimension: 'culture', urgency: 'High', minScore: 0, maxScore: 5, description: 'legacy', playbookLink: 'javascript:window.__xss=1' },
    { id: 'mod_legacy_ok', title: 'ok', dimension: 'culture', urgency: 'Low', minScore: 0, maxScore: 5, description: 'fine', playbookLink: '/playbook.html#culture' },
  ];
  const seq0 = (dealConn.prepare('SELECT COALESCE(MAX(seq), -1) AS m FROM modules').get().m) + 1;
  legacy.forEach((m, i) => dealConn.prepare('INSERT INTO modules (id, project_id, seq, data) VALUES (?, ?, ?, ?)').run(m.id, null, seq0 + i, JSON.stringify(m)));

  // 2. Served unchanged by the real API (the defence is at render time for legacy rows).
  const server = await listenLocal(app);
  let modules;
  try {
    const admin = newSession('admin', 'admin', DEAL.id);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/modules`, { headers: cookie(admin) });
    assert.strictEqual(res.status, 200);
    modules = await res.json();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.ok(modules.some((m) => m.id === 'mod_legacy_xss'), 'the legacy row is served');

  // 3. The REAL render function + the REAL MASafeHtml, in a vm.
  const { doc, El, sinks } = makeDocument();
  const container = new El('div');
  const ctx = {
    document: doc,
    console: { error() {}, log() {} },
    URL,
    location: { origin: 'https://portal.test', href: 'https://portal.test/dashboard.html' },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(modules) }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'safe-html.js'), 'utf8'), ctx, { filename: 'safe-html.js' });
  assert.ok(ctx.MASafeHtml && typeof ctx.MASafeHtml.safeHref === 'function');
  const fnSrc = extractFunction(fs.readFileSync(path.join(ROOT, 'public', 'js', 'dashboard.js'), 'utf8'), 'renderActionModules');
  ctx.__container = container;
  const render = vm.runInContext(`(function () { const hrModulesContainer = __container; ${fnSrc}; return renderActionModules; })()`, ctx);
  render({ culture: 3, talent: 3, value: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepStrictEqual(sinks, [], 'no HTML-string sink is reached');
  const links = container.querySelectorAll('a');
  const byTitle = {};
  container.children.forEach((card) => {
    const h4 = card.querySelectorAll('h4')[0];
    const a = card.querySelectorAll('a')[0];
    if (h4 && a) byTitle[h4.textContent] = a.getAttribute('href');
  });
  assert.ok(links.length >= 3, `three legacy cards rendered (got ${links.length})`);
  // The attribute-breakout payload reaches the anchor through setAttribute (no
  // HTML parser), so it cannot leave the attribute: the browser reads it as a
  // same-origin relative path - inert, it navigates nowhere off-portal.
  const breakout = new URL(byTitle['<img src=x onerror=1>'], 'https://portal.test/dashboard.html');
  assert.strictEqual(breakout.origin, 'https://portal.test', 'attribute-breakout payload is a same-origin relative path');
  assert.strictEqual(byTitle.js, '/playbook.html', 'javascript: falls back to the playbook');
  assert.strictEqual(byTitle.ok, '/playbook.html#culture', 'a legitimate link is kept');
  for (const a of links) {
    const u = new URL(a.getAttribute('href'), 'https://portal.test/dashboard.html');
    assert.ok(u.protocol === 'https:' || u.protocol === 'http:', `inert href scheme: ${a.getAttribute('href')}`);
  }
  // Stored text stays text: no element was parsed out of the title.
  assert.strictEqual(container.querySelectorAll('img').length, 0);
});
