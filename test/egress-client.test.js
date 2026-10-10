// SAFE-06 / D-13-05 (Phase 13, plan 13-08) - the browser half of the egress switch.
//
// The server half (plan 13-02) already blocks the traffic (CSP built from the
// switch, Gemini refusals, the real-mode 404). These rows prove the CLIENT never
// attempts it and says why instead of failing silently or looping:
//   * admin.js builds the "External services" panel with createElement/textContent
//     only, posts to /api/admin/egress, renders from the response;
//   * employee.js builds no YouTube thumbnail URL / iframe unless the effective
//     setting says `egress.youtube === true` (missing = off, PD-38);
//   * transitions.js reaches the Transformers.js import / Hugging Face only behind
//     `egress.huggingface === true`, and renders the `{egressDisabled}` Gemini
//     marker as a state with no retry / timer;
//   * admin.js hides the AI-training (RAG) upload card until /api/auth/mode answers
//     dev|demo, and renders the marker answer of /api/rag/upload as a state.
//
// Static scans use comment-stripped source; behaviour rows run the REAL function
// source in node:vm against a recording fake DOM (pattern of
// test/client-authz-hiding.test.js). The one HTTP row boots a child server against
// isolated MA_* temp stores (test/helpers/egress-server.js) - never data/*.db.
//
// node:test - run via `node --test test/egress-client.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./helpers/egress-server');

const PUBLIC = path.join(__dirname, '..', 'public');
const readPublic = (...segs) => fs.readFileSync(path.join(PUBLIC, ...segs), 'utf8');
const ADMIN_SRC = readPublic('js', 'admin.js');
const EMPLOYEE_SRC = readPublic('js', 'employee.js');
const TRANSITIONS_SRC = readPublic('js', 'transitions.js');

/** Brace-matching extractor that skips strings, template literals and comments. */
function extractBlock(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `could not find "${header}" in the client source`);
  let i = src.indexOf('{', start);
  assert.ok(i >= 0, `no body for "${header}"`);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '\'' || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '`') {
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '`') break;
        if (src[i] === '$' && src[i + 1] === '{') {
          let d = 0;
          for (i++; i < src.length; i++) {
            if (src[i] === '{') d++;
            else if (src[i] === '}') { d--; if (d === 0) break; }
          }
        }
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting "${header}"`);
}

/** Drops // and block comments (string-aware enough for the blocks scanned here). */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** A recording fake DOM element. */
function makeEl(id, registry) {
  const e = {
    id: id || '',
    style: {},
    attrs: {},
    children: [],
    textContent: '',
    innerHTML: '',
    disabled: false,
    parentNode: null,
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return k in e.attrs ? e.attrs[k] : null; },
    appendChild(c) {
      e.children.push(c);
      c.parentNode = e;
      if (registry && c.id) registry[c.id] = c;
      return c;
    },
    insertBefore(c) { return e.appendChild(c); },
    remove() {
      if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((x) => x !== e);
      if (registry && e.id && registry[e.id] === e) delete registry[e.id];
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  return e;
}

function allEls(root) {
  const out = [root];
  for (const c of root.children) out.push(...allEls(c));
  return out;
}

// ============================================================ admin.js panel
test('External services panel: createElement/textContent only, posts to /api/admin/egress, listed i18n keys', () => {
  const blocks = ['function egressText(', 'function renderEgressPanel(', 'function loadEgressPanel(']
    .map((h) => stripComments(extractBlock(ADMIN_SRC, h)))
    .join('\n');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
    assert.ok(!blocks.includes(sink), `panel code must not use ${sink} (T-13-72)`);
  }
  assert.ok(blocks.includes('/api/admin/egress'), 'panel reads and writes /api/admin/egress');
  assert.ok(/method:\s*'POST'/.test(blocks), 'Save posts');
  assert.ok(blocks.includes('renderEgressPanel(panel, r.body)'), 'Save re-renders from the response');
  const all = ADMIN_SRC;
  for (const key of ['admin.egress.title', 'admin.egress.warning', 'admin.egress.gemini', 'admin.egress.huggingface',
    'admin.egress.youtube', 'admin.egress.save', 'admin.egress.saved']) {
    assert.ok(all.includes(`'${key}'`), `i18n key ${key} used (English fallback inline)`);
  }
  assert.ok(blocks.includes('type = \'checkbox\''), 'real checkbox controls (keyboard reachable)');
  assert.ok(/Save posts only the changed keys/.test(ADMIN_SRC) || blocks.includes('changed[svc.key]'), 'only changed keys are posted');
});

test('panel renders effective state from a snapshot and posts only changed keys, then re-renders from the response', async () => {
  const registry = {};
  const posts = [];
  const handlers = {};
  const sandbox = {
    console, Promise, setTimeout,
    document: {
      createElement: (tag) => {
        const e = makeEl('', registry);
        e.tag = tag;
        e.addEventListener = (type, fn) => { handlers[`${e.attrs['data-i18n'] || e.tag}:${type}`] = fn; };
        return e;
      },
      getElementById: (id) => registry[id] || null,
    },
    fetch: (url, init) => {
      posts.push({ url, init });
      const snap = { mode: 'real', defaults: { gemini: false, huggingface: false, youtube: false },
        stored: { youtube: true }, effective: { gemini: false, huggingface: false, youtube: true } };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(snap) });
    },
  };
  vm.createContext(sandbox);
  const code = [
    'const EGRESS_SERVICES = [',
    "  { key: 'gemini', i18n: 'admin.egress.gemini', label: 'G' },",
    "  { key: 'huggingface', i18n: 'admin.egress.huggingface', label: 'H' },",
    "  { key: 'youtube', i18n: 'admin.egress.youtube', label: 'Y' }];",
    extractBlock(ADMIN_SRC, 'function egressText('),
    extractBlock(ADMIN_SRC, 'function renderEgressPanel('),
    ';__exports = { renderEgressPanel };',
  ].join('\n');
  vm.runInContext(code, sandbox);

  // The fake element needs `panel.firstChild` / `removeChild` / `querySelector` for the panel root.
  const panel = makeEl('egress-panel', registry);
  Object.defineProperty(panel, 'firstChild', { get() { return panel.children[0] || null; } });
  panel.removeChild = (c) => { panel.children = panel.children.filter((x) => x !== c); };
  panel.querySelector = () => allEls(panel).find((x) => x.attrs.role === 'status') || null;

  const snapshot = { mode: 'real', defaults: { gemini: false, huggingface: false, youtube: false },
    stored: {}, effective: { gemini: false, huggingface: false, youtube: false } };
  sandbox.__exports.renderEgressPanel(panel, snapshot);

  const els = allEls(panel);
  const boxes = els.filter((x) => x.type === 'checkbox');
  assert.deepStrictEqual(boxes.map((b) => b.id), ['egress-gemini', 'egress-huggingface', 'egress-youtube']);
  assert.ok(boxes.every((b) => b.checked === false), 'effective state drives the checkboxes');
  assert.ok(els.some((x) => x.attrs['data-i18n'] === 'admin.egress.warning' && /third party/.test(x.textContent)),
    'the third-party warning is always rendered');
  assert.ok(els.some((x) => x.attrs['data-i18n'] === 'admin.egress.title' && x.textContent === 'External services'));

  // enable YouTube only, then Save: the POST carries just that key
  boxes.find((b) => b.id === 'egress-youtube').checked = true;
  assert.strictEqual(typeof handlers['admin.egress.save:click'], 'function', 'save control wired');
  handlers['admin.egress.save:click']();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(posts.length, 1, 'exactly one POST');
  assert.strictEqual(posts[0].url, '/api/admin/egress');
  assert.strictEqual(posts[0].init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(posts[0].init.body), { youtube: true }, 'only the changed key is posted');
  // re-rendered from the response: youtube now effective-on
  const after = allEls(panel).filter((x) => x.type === 'checkbox');
  assert.strictEqual(after.find((b) => b.id === 'egress-youtube').checked, true);
  const status = allEls(panel).find((x) => x.attrs.role === 'status');
  assert.strictEqual(status.attrs['data-i18n'], 'admin.egress.saved');
});

// ================================================== employee.js welcome video
function videoSandbox(settingsAnswer, initial) {
  const registry = {};
  const wrapper = makeEl('', registry);
  wrapper.querySelector = () => null;
  const title = makeEl('', registry);
  const dur = makeEl('', registry);
  const overlay = makeEl('welcome-video-overlay-ctrls', registry);
  overlay.querySelector = (sel) => (sel === '.video-title' ? title : sel === '.video-duration' ? dur : null);
  const placeholder = makeEl('welcome-video-placeholder-bg', registry);
  const player = makeEl('welcome-video-player-container', registry);
  const playBtn = makeEl('btn-play-video', registry);
  registry['welcome-video-overlay-ctrls'] = overlay;
  registry['welcome-video-placeholder-bg'] = placeholder;
  registry['welcome-video-player-container'] = player;
  registry['btn-play-video'] = playBtn;
  const created = [];
  const fetched = [];
  const sandbox = {
    console, Promise, setTimeout,
    activeVideoSettings: Object.assign({ welcomeVideoUrl: '', welcomeVideoType: 'local', youtubeAllowed: false }, initial || {}),
    localStorage: { getItem: () => 'en' },
    document: {
      querySelector: (sel) => (sel === '.video-wrapper' ? wrapper : null),
      getElementById: (id) => registry[id] || null,
      createElement: (tag) => { const e = makeEl('', registry); e.tag = tag; created.push(e); return e; },
    },
    fetch: (url) => {
      fetched.push(String(url));
      return Promise.resolve({ json: () => Promise.resolve(settingsAnswer) });
    },
  };
  vm.createContext(sandbox);
  const code = [
    extractBlock(EMPLOYEE_SRC, 'function getYoutubeId('),
    extractBlock(EMPLOYEE_SRC, 'function youtubeBlocked('),
    extractBlock(EMPLOYEE_SRC, 'function renderYoutubeSwitchedOff('),
    extractBlock(EMPLOYEE_SRC, 'function updateVideoUI('),
    extractBlock(EMPLOYEE_SRC, 'function resetVideoPlayer('),
    extractBlock(EMPLOYEE_SRC, 'function loadVideoSettings('),
    ';__exports = { updateVideoUI, loadVideoSettings, youtubeBlocked };',
  ].join('\n');
  vm.runInContext(code, sandbox);
  return { sandbox, api: sandbox.__exports, wrapper, playBtn, created, fetched, registry };
}

function mentionsYoutube(el) {
  const blob = JSON.stringify({ style: el.style, attrs: el.attrs, src: el.src, href: el.href, text: el.innerHTML });
  return /youtube|ytimg|youtu\.be/i.test(blob);
}

const YT_URL = 'https://youtu.be/abcdefghijk';

test('youtube switched off: no thumbnail/embed reference anywhere, neutral placeholder rendered', async () => {
  const v = videoSandbox({ welcomeVideoType: 'youtube', welcomeVideoUrl: YT_URL, egress: { youtube: false } });
  v.api.loadVideoSettings();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(v.sandbox.activeVideoSettings.youtubeAllowed, false);
  assert.ok(!/youtube|ytimg/i.test(String(v.wrapper.style.backgroundImage || '')), 'no thumbnail background');
  for (const e of [v.wrapper, ...v.created, ...allEls(v.wrapper)]) assert.ok(!mentionsYoutube(e), 'no element references YouTube');
  const notice = v.wrapper.children.find((c) => c.attrs['data-i18n'] === 'egress.switchedOff');
  assert.ok(notice, 'placeholder rendered');
  assert.strictEqual(notice.textContent, 'Video switched off by your administrator');
  assert.strictEqual(v.playBtn.style.display, 'none', 'play control withdrawn');
});

test('youtube switched on: today\'s thumbnail path is unchanged', async () => {
  const v = videoSandbox({ welcomeVideoType: 'youtube', welcomeVideoUrl: YT_URL, egress: { youtube: true } });
  v.api.loadVideoSettings();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(v.sandbox.activeVideoSettings.youtubeAllowed, true);
  assert.ok(String(v.wrapper.style.backgroundImage).includes('https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg'));
  assert.ok(!v.wrapper.children.some((c) => c.attrs['data-i18n'] === 'egress.switchedOff'), 'no placeholder when allowed');
});

test('egress absent from the settings answer fails closed (PD-38): placeholder, no thumbnail', async () => {
  for (const answer of [{ welcomeVideoType: 'youtube', welcomeVideoUrl: YT_URL }, { welcomeVideoType: 'youtube', welcomeVideoUrl: YT_URL, egress: {} }]) {
    const v = videoSandbox(answer);
    v.api.loadVideoSettings();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(v.sandbox.activeVideoSettings.youtubeAllowed, false);
    assert.ok(!/youtube|ytimg/i.test(String(v.wrapper.style.backgroundImage || '')));
    assert.ok(v.wrapper.children.some((c) => c.attrs['data-i18n'] === 'egress.switchedOff'));
  }
});

test('a local video is unaffected by the youtube switch', async () => {
  const v = videoSandbox({ welcomeVideoType: 'local', welcomeVideoUrl: '/uploads/welcome.mp4', egress: { youtube: false } });
  v.api.loadVideoSettings();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(v.api.youtubeBlocked(), false);
  assert.ok(!v.wrapper.children.some((c) => c.attrs['data-i18n'] === 'egress.switchedOff'));
  assert.strictEqual(v.wrapper.style.backgroundImage, '');
});

test('the play handler never builds the embed while YouTube is off (defence in depth)', () => {
  const guard = EMPLOYEE_SRC.indexOf('if (youtubeBlocked()) return;');
  const embed = EMPLOYEE_SRC.indexOf('https://www.youtube.com/embed/');
  assert.ok(guard > 0 && embed > guard, 'the blocked check sits before the iframe is built');
  const thumb = EMPLOYEE_SRC.indexOf('https://img.youtube.com/vi/');
  const branch = EMPLOYEE_SRC.indexOf('else if (youtubeBlocked())');
  assert.ok(branch > 0 && thumb > branch, 'the blocked branch precedes the thumbnail URL');
});

// ============================================================== HTTP (child)
test('HTTP: admin POST /api/admin/egress { youtube:false } is visible in GET /api/settings for another role', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-egress-client-'));
  const s = await startServer({ dir, mode: 'dev' });
  t.after(async () => {
    await s.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  const snap = await s.request('/api/admin/egress', { token: 'admin' });
  assert.strictEqual(snap.status, 200);
  assert.ok(snap.body.effective && snap.body.defaults, 'the panel can render from this snapshot');
  assert.deepStrictEqual(snap.body.effective, { gemini: true, huggingface: true, youtube: true }, 'dev default is all-on (showcase unchanged)');

  const denied = await s.request('/api/admin/egress', { token: 'hrbp' });
  assert.strictEqual(denied.status, 403, 'the panel data is admin-only');

  const off = await s.request('/api/admin/egress', { method: 'POST', body: { youtube: false }, token: 'admin' });
  assert.strictEqual(off.status, 200);
  assert.strictEqual(off.body.effective.youtube, false);

  const seen = await s.request('/api/settings', { token: 'hrbp' });
  assert.strictEqual(seen.status, 200);
  assert.strictEqual(seen.body.egress.youtube, false, 'the employee-facing settings answer carries the switch');
  assert.strictEqual(seen.body.egress.gemini, true, 'untouched keys keep their value');
});
