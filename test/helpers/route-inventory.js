'use strict';
// Phase 11: the live route inventory, shared by the coverage suites.
//
// Verified live against this repo's installed express@4.x (02-RESEARCH.md
// "Pattern 1: Route Inventory Mechanism"). This codebase registers every route
// as a top-level app.METHOD() call — no express.Router() sub-mounting exists
// today — so descending into layer.handle.stack for nested routers is NOT
// needed. If a future phase introduces express.Router()-mounted sub-apps this
// function must be extended to recurse into layer.handle.stack when
// layer.name === 'router' — a known evolution point, not a bug.

/** @returns {{method:string, path:string}[]} every registered /api route. */
function listApiRoutes(expressApp) {
  const out = [];
  const stack = (expressApp._router && expressApp._router.stack) || [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const m of methods) {
        if (typeof layer.route.path === 'string' && layer.route.path.startsWith('/api')) {
          out.push({ method: m.toUpperCase(), path: layer.route.path });
        }
      }
    }
  }
  return out;
}

/** `/api/dd/findings/:id` -> `/api/dd/findings/x` */
function concretePath(routePath) {
  return routePath.replace(/:[a-zA-Z0-9_]+/g, 'x');
}

/**
 * GET routes (params concretised) that `readRuleFor` has no rule for, ignoring
 * `publicPaths` (a Set of full paths reachable without a session).
 */
function uncoveredGetRoutes(routes, readRuleFor, publicPaths) {
  const pub = publicPaths || new Set();
  return routes
    .filter((r) => r.method === 'GET' && !pub.has(r.path))
    .map((r) => ({ method: r.method, path: concretePath(r.path) }))
    .filter((r) => !readRuleFor(r.path));
}

module.exports = { listApiRoutes, concretePath, uncoveredGetRoutes };
