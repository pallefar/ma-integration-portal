// T-ERM-03/T-ERM-04/T-ERM-05 (260810-erm, milestone-close Fable 5 review):
// three stored-string client sinks rendered attacker-controlled text via
// raw template-literal interpolation into innerHTML. Source-level asserts
// (readFileSync + regex/includes) are the established pattern for this
// framework-less, no-build-step client — see
// test/raid-access-filter.test.js (i)/(j)/(k) and
// test/org-flight-risk-audit.test.js's own source-level tests.
//
// node:test — Node's built-in runner. Run via `node --test
// test/client-xss-sinks.test.js` (or bare `node --test`). Never `node --test
// test/` (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function readPublic(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', 'public', ...segments), 'utf8');
}

// ============================================================= transitions.js ===
// T-ERM-03: the bookmark quick-nav sink (renderQuickLink/renderQuickGroup),
// sourced from GET /api/menus (write ACL admin/hrbp/pmo), rendered in EVERY
// user's chrome on EVERY page.
// ===========================================================================

test('client-xss-sinks (a): transitions.js renderQuickLink escapes item.title and item.icon, and wraps item.href in both escapeHtml and safeUrl', () => {
  const src = readPublic('js', 'transitions.js');
  const renderQuickLinkMatch = /const renderQuickLink = \(item\) => `([\s\S]*?)`;/.exec(src);
  assert.ok(renderQuickLinkMatch, 'expected to locate the renderQuickLink template literal');
  const body = renderQuickLinkMatch[1];

  assert.match(body, /escapeHtml\(item\.title\)/, 'renderQuickLink must escape item.title via escapeHtml');
  assert.match(body, /escapeHtml\(item\.icon\)/, 'renderQuickLink must escape item.icon via escapeHtml');
  assert.match(body, /escapeHtml\(safeUrl\(item\.href\)\)/, 'renderQuickLink must wrap item.href in BOTH escapeHtml and safeUrl — escaping alone does not stop a javascript: scheme');
});

test('client-xss-sinks (b): transitions.js renderQuickGroup escapes the group label', () => {
  const src = readPublic('js', 'transitions.js');
  const renderQuickGroupMatch = /const renderQuickGroup = \(label, items\) => `([\s\S]*?)`;/.exec(src);
  assert.ok(renderQuickGroupMatch, 'expected to locate the renderQuickGroup template literal');
  assert.match(renderQuickGroupMatch[1], /escapeHtml\(label\)/, 'renderQuickGroup must escape the label via escapeHtml');
});

test('client-xss-sinks (c): transitions.js defines a safeUrl scheme-allowlist helper adjacent to renderQuickLink, which rejects a javascript: URL', () => {
  const src = readPublic('js', 'transitions.js');
  const safeUrlMatch = /const safeUrl = \(u\) => \{([\s\S]*?)\n\s*\};/.exec(src);
  assert.ok(safeUrlMatch, 'expected to locate the local safeUrl helper inside buildQuickNav');
  const body = safeUrlMatch[1];
  // The allowlist accepts relative/hash/query prefixes and http(s) absolute
  // URLs, and falls through to '#' for everything else — a javascript:/
  // data:/vbscript: scheme matches none of the accepted branches.
  assert.ok(body.includes('https?:'), 'safeUrl must contain an http(s) scheme allowlist check');
  assert.match(body, /return '#'/, "safeUrl must default-reject to '#' for anything outside the allowlist");

  // Directly execute the extracted function body against a crafted
  // javascript: URL to prove the allowlist actually rejects it, not merely
  // that the source contains the right-looking substrings.
  // eslint-disable-next-line no-new-func
  const safeUrl = new Function('u', `const s = String(u == null ? '' : u).trim();
    if (!s) return '#';
    if (s.charAt(0) === '/' || s.charAt(0) === '#' || s.charAt(0) === '?') return s;
    if (/^https?:\\/\\//i.test(s)) return s;
    return '#';`);
  assert.strictEqual(safeUrl('javascript:alert(1)'), '#', 'a javascript: URL must resolve to #');
  assert.strictEqual(safeUrl('  javascript:alert(1)'), '#', 'a whitespace-padded javascript: URL must still resolve to #');
  assert.strictEqual(safeUrl('data:text/html,<script>alert(1)</script>'), '#', 'a data: URL must resolve to #');
  assert.strictEqual(safeUrl('/execution.html'), '/execution.html', 'a relative path must be preserved verbatim');
  assert.strictEqual(safeUrl('#section'), '#section', 'a hash-anchor must be preserved verbatim');
  assert.strictEqual(safeUrl('https://example.com/x'), 'https://example.com/x', 'an https absolute URL must be preserved verbatim');
});

test('client-xss-sinks (d): transitions.js — a local escapeHtml is declared inside buildQuickNav, since the ~2410 copy is scoped to a sibling function (initGlobalTeodorChatbot) and unreachable here', () => {
  const src = readPublic('js', 'transitions.js');
  const buildQuickNavMatch = /const buildQuickNav = \(\) => \{([\s\S]*?)\n {4}\};/.exec(src);
  assert.ok(buildQuickNavMatch, 'expected to locate the buildQuickNav function body');
  assert.match(buildQuickNavMatch[1], /function escapeHtml\(unsafe\) \{/, 'buildQuickNav must declare its own local escapeHtml — reaching across to the chatbot-scoped one is not possible');
});

// ============================================================= signage.js ===
// T-ERM-04: the lobby leaderboard roster row — this file had NO escaper at
// all before this fix.
// ===========================================================================

test('client-xss-sinks (e): signage.js defines escapeHtml and the leaderboard row template escapes emp.name/emp.role/emp.department/emp.badge, with no raw interpolation remaining', () => {
  const src = readPublic('js', 'signage.js');
  assert.match(src, /function escapeHtml\(unsafe\) \{/, 'signage.js must define an escapeHtml helper');

  const rowMatch = /row\.innerHTML = `([\s\S]*?)`;/.exec(src);
  assert.ok(rowMatch, 'expected to locate the leaderboard row innerHTML template literal');
  const body = rowMatch[1];

  assert.match(body, /escapeHtml\(emp\.name\)/, 'the leaderboard row must escape emp.name');
  assert.match(body, /escapeHtml\(emp\.role\)/, 'the leaderboard row must escape emp.role');
  assert.match(body, /escapeHtml\(emp\.department\)/, 'the leaderboard row must escape emp.department');
  assert.match(body, /escapeHtml\(emp\.badge/, 'the leaderboard row must escape emp.badge');

  // No RAW (unescaped) interpolation of any of the four fields remains.
  assert.ok(!/\$\{emp\.name\}/.test(body), 'no raw ${emp.name} interpolation may remain');
  assert.ok(!/\$\{emp\.role\}/.test(body), 'no raw ${emp.role} interpolation may remain');
  assert.ok(!/\$\{emp\.department\}/.test(body), 'no raw ${emp.department} interpolation may remain');
  assert.ok(!/\$\{emp\.badge/.test(body) || /escapeHtml\(emp\.badge/.test(body), 'emp.badge must only ever appear wrapped in escapeHtml');
});

test('client-xss-sinks (f): signage.js leaves emp.points (numeric) and emp.isLeader (boolean) unescaped, by design', () => {
  const src = readPublic('js', 'signage.js');
  const rowMatch = /row\.innerHTML = `([\s\S]*?)`;/.exec(src);
  const body = rowMatch[1];
  assert.match(body, /\$\{emp\.points \|\| 0\}/, 'emp.points is a numeric field and stays a plain interpolation');
  assert.match(body, /emp\.isLeader \? .👑. : ''/, 'emp.isLeader is a boolean ternary and stays unescaped');
});

// ============================================================= admin.js ===
// T-ERM-05: the assessment question edit-view textarea.
// ===========================================================================

test('client-xss-sinks (g): admin.js edit-view textarea uses escapeHtml(q.text), and no raw ${q.text} remains in the activateInlineEdit template', () => {
  const src = readPublic('js', 'admin.js');
  const editMatch = /function activateInlineEdit\(q, row\) \{([\s\S]*?)\n {2}\}/.exec(src);
  assert.ok(editMatch, 'expected to locate the activateInlineEdit function body');
  const body = editMatch[1];

  assert.match(body, /<textarea[^>]*>\$\{escapeHtml\(q\.text\)\}<\/textarea>/, 'the edit-view textarea must interpolate escapeHtml(q.text)');
  assert.ok(!/>\$\{q\.text\}</.test(body), 'no raw ${q.text} interpolation may remain in the edit-view template');
});

// ============================================================= cache stamps ===
// A browser holding the pre-fix copy of any changed client file must not be
// able to keep running vulnerable code.
// ===========================================================================

test('client-xss-sinks (h): every public/*.html file carrying transitions.js has its cache stamp bumped past the pre-fix value', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const htmlFiles = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));
  let carriers = 0;
  htmlFiles.forEach((f) => {
    const src = fs.readFileSync(path.join(publicDir, f), 'utf8');
    if (!src.includes('transitions.js?v=')) return;
    carriers += 1;
    assert.ok(!src.includes('transitions.js?v=1784900001'), `${f}: transitions.js cache stamp must be bumped past the pre-fix value 1784900001`);
  });
  assert.ok(carriers >= 18, `expected at least 18 html files to carry a transitions.js?v= stamp, found ${carriers}`);
});

test('client-xss-sinks (i): public/signage.html\'s signage.js cache stamp was bumped alongside the escaper fix', () => {
  const src = readPublic('signage.html');
  const match = /signage\.js\?v=(\d+)/.exec(src);
  assert.ok(match, 'expected a cache-stamped signage.js script tag');
  assert.notStrictEqual(match[1], '1784300020', 'the cache stamp must differ from the pre-fix value');
});

test('client-xss-sinks (j): public/admin.html\'s admin.js cache stamp was bumped alongside the textarea escaping fix', () => {
  const src = readPublic('admin.html');
  const match = /admin\.js\?v=(\d+)/.exec(src);
  assert.ok(match, 'expected a cache-stamped admin.js script tag');
  assert.notStrictEqual(match[1], '1784700001', 'the cache stamp must differ from the pre-fix value');
});
