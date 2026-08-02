// WIZ-01 (Phase 4 Plan 07): source-and-route-inspection proof for the
// full-page new-deal setup wizard — mirrors test/auth-route-inventory.test.js's
// own style (a LIVE, programmatically-generated Express route inventory,
// never a hand-maintained list that could silently drift). This suite makes
// no HTTP calls and touches no database — it inspects the checked-in source
// files (public/deal-wizard.html, public/js/deal-wizard.js,
// public/js/deal-switcher.js, public/js/transitions.js) plus the live
// `require('../server.js')` route table, so it needs none of the
// MA_*_DB_PATH temp-directory setup the integration suites use.
//
// Requires server.js's `module.exports = app` + `require.main === module`
// listen guard — `require('../server.js')` here must never bind a real
// PORT as a side effect of module load (test/auth-route-inventory.test.js's
// own header comment documents this same precondition).
//
// node:test — Node's built-in runner. Run via `node --test
// test/deal-wizard-page.test.js` (or `npm test`). Never `node --test test/`
// (the directory argument is mis-parsed on this Node version, v22.18.0).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WIZARD_HTML_PATH = path.join(ROOT, 'public', 'deal-wizard.html');
const WIZARD_JS_PATH = path.join(ROOT, 'public', 'js', 'deal-wizard.js');
const DEAL_SWITCHER_PATH = path.join(ROOT, 'public', 'js', 'deal-switcher.js');
const TRANSITIONS_PATH = path.join(ROOT, 'public', 'js', 'transitions.js');
const PUBLIC_JS_DIR = path.join(ROOT, 'public', 'js');

const wizardHtml = fs.readFileSync(WIZARD_HTML_PATH, 'utf8');
const wizardJs = fs.readFileSync(WIZARD_JS_PATH, 'utf8');
const dealSwitcherJs = fs.readFileSync(DEAL_SWITCHER_PATH, 'utf8');
const transitionsJs = fs.readFileSync(TRANSITIONS_PATH, 'utf8');

// Verified live against this repo's actually-installed express@4.22.2 — the
// SAME reflection test/auth-route-inventory.test.js's listApiRoutes() already
// uses. Duplicated here (not imported), matching this codebase's own
// "a schema/route-walking helper is duplicated across independent test
// files rather than shared" precedent (validators/wizard.js's own header
// comment documents the same choice for its DEAL_SETUP_STEPS constant).
function listApiRoutes(expressApp) {
  const out = [];
  const stack = (expressApp._router && expressApp._router.stack) || [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const m of methods) {
        if (layer.route.path.startsWith('/api')) {
          out.push({ method: m.toUpperCase(), path: layer.route.path });
        }
      }
    }
  }
  return out;
}

// Every endpoint the interface contract's key_links wires the wizard to.
// `path` is the Express ROUTE TEMPLATE (':id' placeholders intact, matching
// layer.route.path exactly) — for a dynamic path, the wizard script builds
// the runtime URL as `'/api/deals/' + state.dealId + '/setup'` (string
// concatenation, this file's own established style — never the literal
// ':id' string), so the source check below verifies the STATIC prefix and
// STATIC suffix around the dynamic segment both appear, with the suffix
// following the prefix closely enough to be the same statement, rather than
// requiring one single contiguous regex match (which a quoted-literal
// boundary would break).
const ENDPOINTS = [
  { method: 'POST', path: '/api/deals/wizard/basics' },
  { method: 'POST', path: '/api/deals' },
  { method: 'POST', path: '/api/deals/select' },
  { method: 'GET', path: '/api/assessment-templates' },
  { method: 'POST', path: '/api/assessment-instances/assign' },
  { method: 'POST', path: '/api/deals/:id/setup' },
  { method: 'GET', path: '/api/checklist-templates' },
  { method: 'POST', path: '/api/integration-tasks/instantiate' },
  { method: 'GET', path: '/api/dd/request-templates' },
  { method: 'POST', path: '/api/dd/request-items/instantiate' },
];

function sourceReferencesEndpoint(src, routePath) {
  if (!routePath.includes(':')) return src.includes(routePath);
  const segments = routePath.split('/');
  const dynIdx = segments.findIndex((s) => s.startsWith(':'));
  const prefix = segments.slice(0, dynIdx).join('/') + '/';
  const suffix = '/' + segments.slice(dynIdx + 1).join('/');
  let searchFrom = 0;
  for (;;) {
    const prefixIdx = src.indexOf(prefix, searchFrom);
    if (prefixIdx === -1) return false;
    const suffixIdx = src.indexOf(suffix, prefixIdx + prefix.length);
    if (suffixIdx !== -1 && suffixIdx - prefixIdx < 200) return true;
    searchFrom = prefixIdx + 1;
  }
}

// ---------------------------------------------------------------------------
// 1. The wizard page declares seven step panels and seven progress segments.
// ---------------------------------------------------------------------------
test('deal-wizard-page: the wizard file exists and declares seven step panels and seven progress segments', () => {
  assert.ok(fs.existsSync(WIZARD_HTML_PATH), 'public/deal-wizard.html must exist');
  for (let n = 1; n <= 7; n++) {
    assert.ok(wizardHtml.includes(`id="wizard-step-${n}"`), `wizard-step-${n} panel must be declared`);
    assert.ok(wizardHtml.includes(`id="wizard-step${n}-fill"`), `wizard-step${n}-fill progress segment must be declared`);
  }
  assert.ok(wizardHtml.includes('id="current-step-num"'), 'the step counter element must be declared');
});

// ---------------------------------------------------------------------------
// 2. The wizard script references every endpoint the interface contract
//    wires it to.
// ---------------------------------------------------------------------------
test('deal-wizard-page: the wizard script references every interface-contract endpoint', () => {
  ENDPOINTS.forEach(({ path: routePath }) => {
    assert.ok(
      sourceReferencesEndpoint(wizardJs, routePath),
      `public/js/deal-wizard.js must reference ${routePath}`
    );
  });
});

// ---------------------------------------------------------------------------
// 3. The wizard script assigns no markup sink — every operator-supplied
//    value (deal name, target company, member names, assessment owners) is
//    MNPI and must render as text only.
// ---------------------------------------------------------------------------
test('deal-wizard-page: the wizard script assigns no markup sink', () => {
  assert.strictEqual((wizardJs.match(/innerHTML/g) || []).length, 0, 'deal-wizard.js must never assign innerHTML');
  assert.strictEqual((wizardJs.match(/outerHTML/g) || []).length, 0, 'deal-wizard.js must never assign outerHTML');
  assert.strictEqual((wizardJs.match(/insertAdjacentHTML/g) || []).length, 0, 'deal-wizard.js must never call insertAdjacentHTML');
  assert.strictEqual((wizardJs.match(/document\.write/g) || []).length, 0, 'deal-wizard.js must never call document.write');
});

// ---------------------------------------------------------------------------
// 3b. Regression (checkpoint feedback): a show-path that clears an error
//     element's inline `display` to `''` merely falls back to the
//     stylesheet's own `display:none` default (public/deal-wizard.html's
//     `.wiz-field-error`/`.wizard-step-error`/`.wiz-row-error` rules) — the
//     message is correctly fetched and assigned to textContent, but the
//     operator never sees it. Every show-path must assign an EXPLICIT
//     non-empty display value; only a hide-path may assign `'none'`.
// ---------------------------------------------------------------------------
test('deal-wizard-page: no error-display show-path clears display to an empty string', () => {
  assert.strictEqual(
    (wizardJs.match(/\.style\.display\s*=\s*['"]['"]/g) || []).length,
    0,
    'a show-path must set an explicit non-empty display value, never clear to \'\' (falls back to the stylesheet\'s own display:none default)'
  );
  // Every error-class element (.wiz-field-error / .wiz-assess-field-error /
  // .wizard-step-error / .wiz-row-error) defaults to display:none in the
  // page's stylesheet — assert the corresponding show-paths in the script
  // assign a real, non-empty display value.
  const errorDisplayAssignments = wizardJs.match(/\.style\.display\s*=\s*(VISIBLE_ERROR_DISPLAY|['"][a-z-]+['"])/g) || [];
  const nonEmptyAssignments = errorDisplayAssignments.filter((a) => !/=\s*['"]none['"]/.test(a));
  assert.ok(nonEmptyAssignments.length >= 4, 'at least the 4 known show-paths (field error x2, step banner, row banner) must assign a visible display value');
  nonEmptyAssignments.forEach((assignment) => {
    assert.doesNotMatch(assignment, /=\s*['"]{2}$/, `show-path must not clear display to an empty string: ${assignment}`);
  });
});

// ---------------------------------------------------------------------------
// 4. The switcher navigates to the wizard page (D-06's ONE creation path).
// ---------------------------------------------------------------------------
test('deal-wizard-page: the header switcher navigates to the wizard page', () => {
  assert.ok(dealSwitcherJs.includes('/deal-wizard.html'), 'deal-switcher.js must navigate to /deal-wizard.html');
});

// ---------------------------------------------------------------------------
// 5. No file under public/ still calls the retired create-form global — a
//    second, unguided creation path is exactly what T-04-44 forbids.
//    Comment-only lines are excluded so a leftover explanatory comment
//    naming the retired function cannot invalidate this check.
// ---------------------------------------------------------------------------
test('deal-wizard-page: no executable line under public/js/ still calls the retired openCreateDealForm global', () => {
  const jsFiles = fs.readdirSync(PUBLIC_JS_DIR).filter((f) => f.endsWith('.js'));
  const offenders = [];
  jsFiles.forEach((file) => {
    const lines = fs.readFileSync(path.join(PUBLIC_JS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (!line.includes('openCreateDealForm')) return;
      if (line.trim().startsWith('//')) return; // comment-only line
      offenders.push(`${file}:${idx + 1}: ${line.trim()}`);
    });
  });
  assert.deepStrictEqual(offenders, [], `no executable reference to openCreateDealForm may remain: ${offenders.join(' | ')}`);
});

// ---------------------------------------------------------------------------
// 6. The page-access map lists the wizard page for admin + Integration
//    Lead (hrbp) only.
// ---------------------------------------------------------------------------
test('deal-wizard-page: the page-access map lists deal-wizard.html for admin and hrbp only', () => {
  const match = transitionsJs.match(/'deal-wizard\.html':\s*\[([^\]]*)\]/);
  assert.ok(match, 'transitions.js must declare a pageAccess entry for deal-wizard.html');
  const roles = match[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.deepStrictEqual(roles.slice().sort(), ['admin', 'hrbp'].slice().sort());
});

// ---------------------------------------------------------------------------
// 7. Every endpoint the wizard script references actually exists in the
//    LIVE Express route inventory — a typo in a wizard URL would otherwise
//    only surface in the browser.
// ---------------------------------------------------------------------------
test('deal-wizard-page: every endpoint the wizard script references exists in the live route inventory', () => {
  const app = require('../server.js');
  const routes = listApiRoutes(app);
  ENDPOINTS.forEach(({ method, path: routePath }) => {
    const found = routes.some((r) => r.method === method && r.path === routePath);
    assert.ok(found, `${method} ${routePath} must be a registered route`);
  });
});
