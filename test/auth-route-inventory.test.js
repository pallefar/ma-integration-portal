// AUTH-01 (D-01/D-02): every registered /api/* route (GET reads included)
// rejects an unauthenticated request with 401, proven against a LIVE,
// programmatically-generated route inventory — not a hand-maintained list
// that would silently drift the moment a new endpoint is added without going
// through the consolidated gate. Also proves the DEMO_OPEN escape hatch
// (D-02) keeps a sample route open, and that unsetting it restores the
// fail-closed default (D-01) — this is the concrete "unauthorized read is the
// compliance event" guarantee this milestone's MNPI constraint rests on.
//
// Requires server.js's `module.exports = app` + `require.main === module`
// listen guard (Pitfall 1) — without it, `require('../server.js')` here would
// already have bound a real PORT as a side effect of module load.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.
// `node --test test/` does NOT work on this project's target Node version
// (v22.18.0) — it errors with "Cannot find module '.../test'".

const test = require('node:test');
const assert = require('node:assert');

const app = require('../server.js');

// The only /api paths reachable without a session — auth bootstrapping itself
// cannot require a session to already exist.
const PUBLIC_API_PATHS = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me']);

// Verified live against this repo's actually-installed express@4.22.2 (see
// 02-RESEARCH.md "Pattern 1: Route Inventory Mechanism"). This codebase
// registers every route as a top-level app.METHOD() call — no
// express.Router() sub-mounting exists today — so a recursive descent into
// layer.handle.stack for nested routers is NOT needed for THIS codebase. If a
// future phase introduces express.Router()-mounted sub-apps, this function
// must be extended to recurse into layer.handle.stack when
// layer.name === 'router' — flag as a known evolution point, not a bug.
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

test('AUTH-01: every /api/* route (read or write) rejects an unauthenticated request with 401', async () => {
  delete process.env.DEMO_OPEN; // defensive: prove the fail-closed default, not a leaked prior toggle
  const server = app.listen(0); // ephemeral port
  try {
    const { port } = server.address();
    const routes = listApiRoutes(app).filter((r) => !PUBLIC_API_PATHS.has(r.path));
    assert.ok(routes.length > 0, 'route inventory must not be empty — a 0-length list would make this test vacuously pass');
    for (const { method, path } of routes) {
      const url = `http://127.0.0.1:${port}${path.replace(/:[a-zA-Z0-9_]+/g, 'x')}`;
      const res = await fetch(url, { method });
      assert.strictEqual(res.status, 401, `${method} ${path} must 401 unauthenticated, got ${res.status}`);
    }
  } finally {
    server.close();
  }
});

test('AUTH-01/D-02: DEMO_OPEN=1 keeps a sample route open; unsetting it restores the fail-closed default', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const sampleUrl = `http://127.0.0.1:${port}/api/menus`;

    process.env.DEMO_OPEN = '1';
    const openRes = await fetch(sampleUrl);
    assert.notStrictEqual(openRes.status, 401, 'DEMO_OPEN=1 must keep a sample GET route open (non-401)');

    delete process.env.DEMO_OPEN;
    const closedRes = await fetch(sampleUrl);
    assert.strictEqual(closedRes.status, 401, 'unsetting DEMO_OPEN must restore the fail-closed default (AUTH-01)');
  } finally {
    delete process.env.DEMO_OPEN;
    server.close();
  }
});
