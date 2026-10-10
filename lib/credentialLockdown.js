'use strict';
// D-10-08b (Phase 10, plan 05): the real-mode demo-credential lockdown.
//
// [security] Threat (T-10-34, critical). The committed data/control.db carries
// four demo accounts whose password is published in the repository. A real
// host started on a HAND COPY of that file (bypassing the account-less seed in
// db/realDataDir.js, which only runs when control.db is absent) would serve
// real acquisition data to anyone who read the repo. So in real-deal mode, as
// long as ANY enabled account still verifies a published demo password:
//
//   - the server answers only the login page and its assets
//     (LOCKDOWN_STATIC_ALLOWLIST), /api/auth/* (sign-in, change-password, me,
//     logout, mode) and /healthz;
//   - every other /api path answers 403 {credentialLockdown:true};
//   - everything else answers a fixed 403 HTML page.
//
// The remedy needs no admin route: sign in as each offending account (login
// forces mustChangePassword) and change the password — change-password
// clears that account from the offender set. The lockdown lifts when the set is
// empty. It is deliberately 403, never 503: the client silently retries 503
// writes as contention (plan 08), which would hide the condition.
//
// Detection happens twice: a boot scan (every enabled account verified against
// the published demo passwords, synchronously, before the app serves) and
// login time (a successful sign-in with a published password adds the account,
// covering an account that appears or is edited while the process runs).

// The ONE list of public static assets the locked host serves. lockdownMiddleware
// reads it; plan 10-09's cross-check test imports it to prove every asset the
// login and change-password pages reference is present and on disk. No other
// copy of this list may exist (server.js does not repeat any entry).
const LOCKDOWN_STATIC_ALLOWLIST = Object.freeze([
  '/login.html',
  '/change-password.html',
  '/js/login.js',
  '/js/change-password.js',
  '/css/style.css',
  '/te-logo.png',
  '/favicon.ico',
]);

const ALLOWLIST_SET = new Set(LOCKDOWN_STATIC_ALLOWLIST);
const { pathForms } = require('./requestPath');

const LOCKDOWN_API_MESSAGE =
  'This server is locked because an account still accepts a published demo password. ' +
  'Sign in with that account and change its password, or ask your administrator.';

// Fixed page: no user data, no echo of the request. The link target is itself
// on the allowlist.
const LOCKDOWN_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<title>Server locked</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  '<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;">' +
  '<h1>This server is locked</h1>' +
  '<p>An account on this host still accepts a published demo password, so the portal is closed until it is changed.</p>' +
  '<p><a href="/login.html">Sign in to change the password</a>, or ask your administrator.</p>' +
  '</body></html>';

function createLockdown({ enabled } = {}) {
  const on = enabled === true;
  const offenders = new Set();

  return {
    /**
     * Add every ENABLED account that verifies a published demo password.
     * `verifySync(password, account)` must return {ok}. Never logs or returns
     * a password.
     */
    scanAccounts(accounts, verifySync, demoPasswords) {
      if (!on) return [];
      const found = [];
      for (const account of Array.isArray(accounts) ? accounts : []) {
        if (!account || typeof account.username !== 'string' || account.disabled === true) continue;
        for (const demo of demoPasswords || []) {
          if (verifySync(demo, account).ok) {
            offenders.add(account.username);
            found.push(account.username);
            break;
          }
        }
      }
      return found;
    },
    noteDemoLogin(username) {
      if (on && typeof username === 'string' && username) offenders.add(username);
    },
    clear(username) {
      offenders.delete(username);
    },
    isActive() {
      return on && offenders.size > 0;
    },
    offenders() {
      return Array.from(offenders).sort();
    },
  };
}

// `onDenied(req, status)` (optional, D-11-05): told about every refusal the
// lockdown sends, immediately before it is sent, so server.js can record it as
// a rate-bounded `credential-lockdown` security event. This module keeps no
// audit dependency (same isolation rule as db/resolver.js and
// db/accessPolicy.js); a throw from the hook propagates to the error middleware.
function lockdownMiddleware(lockdown, onDenied) {
  return function credentialLockdownGate(req, res, next) {
    if (!lockdown.isActive()) return next();

    const method = req.method;
    const safeRead = method === 'GET' || method === 'HEAD';
    // req.path carries no query string; the match is exact, so neither a
    // `?v=` cache-buster nor a traversal suffix widens it.
    const reqPath = req.path;
    // [security] CR-01 (Phase 10 review): the allowlist is matched against the
    // canonical spellings of the path (lib/requestPath.js). A static entry is
    // served only when the request is spelled EXACTLY canonically (a case-
    // insensitive filesystem would otherwise serve `/LOGIN.html` from a
    // different spelling than the one listed); /api/auth/* passes only when
    // EVERY spelling stays under /api/auth/ — `/api/auth/..%2Fadmin/users` or
    // `/api/auth%2F..` cannot ride the prefix. Anything else fails closed.
    const shape = pathForms(reqPath);
    const canonical = shape.ok && shape.forms.length === 1 && shape.forms[0] === reqPath;

    if (safeRead && canonical && ALLOWLIST_SET.has(reqPath)) return next();
    if (safeRead && canonical && reqPath === '/healthz') return next();
    if (shape.ok && reqPath.startsWith('/api/auth/') && shape.forms.every((f) => f.startsWith('/api/auth/'))) return next();

    res.set('Cache-Control', 'no-store');
    if (typeof onDenied === 'function') onDenied(req, 403);
    if (reqPath === '/api' || reqPath.startsWith('/api/')) {
      return res.status(403).json({ error: LOCKDOWN_API_MESSAGE, credentialLockdown: true });
    }
    res.status(403).type('html').send(LOCKDOWN_HTML);
  };
}

module.exports = {
  LOCKDOWN_STATIC_ALLOWLIST,
  createLockdown,
  lockdownMiddleware,
};
