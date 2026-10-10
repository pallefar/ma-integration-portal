// [security] SAFE-07 / D-13-06 (b)(c) (Phase 13, plan 13-04) — client-side
// storage hygiene for a possibly shared workstation.
//
//   clearOnLogout()        — the one logout path (account menu link in
//                            transitions.js, "Sign out" in change-password.js).
//                            Server logout, then drop sessionStorage, every
//                            localStorage key except the language preference,
//                            every Cache Storage entry and every service-worker
//                            registration. `Clear-Site-Data` on the logout
//                            response is honoured in secure contexts only (https
//                            or localhost); this clearing is the cross-context
//                            guarantee (T-13-31, T-13-34).
//   runLegacyCleanupOnce() — replaces the old per-page-load wipe that deleted
//                            EVERY Cache Storage entry (including the
//                            Transformers model cache) on every navigation
//                            (R5-15, T-13-32). Runs once per browser, touches
//                            only /sw.js registrations and LEGACY_CACHE_NAMES,
//                            and never a MODEL_CACHE_NAMES entry.
//
// Ordering matters in clearOnLogout: the language keys are SNAPSHOTTED before
// the logout request, because a `Clear-Site-Data: "storage"` response (secure
// contexts) wipes localStorage the moment it arrives — the snapshot is what is
// restored afterwards, even when the request fails. No innerHTML, no eval.
(function () {
  'use strict';

  // The only language preference key in the app (grep-proven across public/:
  // banners.js, inline-edit.js, transitions.js, employee page — all
  // 'employeeLanguage'). Survives logout so a returning visitor keeps the UI
  // language; it carries no deal data.
  var LANGUAGE_KEYS = Object.freeze(['employeeLanguage']);

  // Cache Storage names a previous release of THIS app created. Evidence
  // (git history search, plan 13-04 PD-20): no `caches.open(` ever existed in
  // public/sw.js, public/js/** or public/*.html at any commit — the old
  // service worker only ever DELETED caches — so the list is empty. A name is
  // added here only if a shipped release is proven to have created it.
  var LEGACY_CACHE_NAMES = Object.freeze([]);

  // Created by the vendored Transformers.js (env.cacheKey default). Never
  // deleted by the legacy clean-up; logout deliberately clears it too
  // (acceptance: Cache Storage empty after logout).
  var MODEL_CACHE_NAMES = Object.freeze(['transformers-cache']);

  var LEGACY_FLAG = 'ma.legacyCleanup.v1';
  var LOGOUT_TIMEOUT_MS = 5000;

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function localKeys() {
    return safe(function () {
      var out = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    }, []);
  }

  function cacheNames() {
    if (typeof caches === 'undefined' || !caches || typeof caches.keys !== 'function') return Promise.resolve([]);
    return Promise.resolve().then(function () { return caches.keys(); }).then(
      function (names) { return Array.isArray(names) ? names : []; },
      function () { return []; }
    );
  }

  function registrations() {
    var sw = safe(function () { return navigator.serviceWorker; }, null);
    if (!sw || typeof sw.getRegistrations !== 'function') return Promise.resolve([]);
    return Promise.resolve().then(function () { return sw.getRegistrations(); }).then(
      function (regs) { return regs ? Array.prototype.slice.call(regs) : []; },
      function () { return []; }
    );
  }

  function unregisterAll(regs) {
    return Promise.all(regs.map(function (r) {
      return Promise.resolve().then(function () { return r.unregister(); }).catch(function () { /* best effort */ });
    }));
  }

  function deleteCaches(names) {
    return Promise.all(names.map(function (n) {
      return Promise.resolve().then(function () { return caches.delete(n); }).catch(function () { /* best effort */ });
    }));
  }

  function postLogout() {
    if (typeof fetch !== 'function') return Promise.resolve();
    var timer = null;
    var request = Promise.resolve().then(function () {
      return fetch('/api/auth/logout', { method: 'POST' });
    }).catch(function () { /* a failed logout request still clears this browser */ });
    var wait = new Promise(function (resolve) {
      if (typeof setTimeout === 'function') timer = setTimeout(resolve, LOGOUT_TIMEOUT_MS);
    });
    return Promise.race([request, wait]).then(function () {
      if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
    });
  }

  function clearOnLogout() {
    // 1. Snapshot the language keys BEFORE anything can wipe them.
    var kept = {};
    LANGUAGE_KEYS.forEach(function (k) {
      var v = safe(function () { return localStorage.getItem(k); }, null);
      if (v !== null && v !== undefined) kept[k] = v;
    });

    // 2. Server logout (revokes the session; its Clear-Site-Data may wipe
    //    localStorage right here in a secure context). Never throws.
    return postLogout().then(function () {
      // 3. sessionStorage, 4. every localStorage key except the language keys.
      safe(function () { sessionStorage.clear(); });
      localKeys().forEach(function (k) {
        if (LANGUAGE_KEYS.indexOf(k) !== -1) return;
        safe(function () { localStorage.removeItem(k); });
      });
      // 5. every Cache Storage entry, 6. every service-worker registration.
      return cacheNames().then(deleteCaches)
        .then(registrations).then(unregisterAll);
    }).catch(function () { /* fall through to the restore */ }).then(function () {
      // 7. Restore the language keys (also when the request or a step failed).
      LANGUAGE_KEYS.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(kept, k)) {
          safe(function () { localStorage.setItem(k, kept[k]); });
        }
      });
    });
  }

  function scriptPath(reg) {
    var w = reg && (reg.active || reg.waiting || reg.installing);
    var url = w && w.scriptURL;
    if (!url) return '';
    return safe(function () { return new URL(String(url), 'http://localhost').pathname; }, '');
  }

  var legacyInFlight = null;

  // `opts.legacyCacheNames` exists for the unit test only (the shipped list is
  // empty); whatever is passed, a MODEL_CACHE_NAMES entry is never deleted.
  function runLegacyCleanupOnce(opts) {
    if (legacyInFlight) return legacyInFlight;
    if (safe(function () { return localStorage.getItem(LEGACY_FLAG); }, null) === '1') {
      return Promise.resolve();
    }
    var legacy = (opts && Array.isArray(opts.legacyCacheNames) ? opts.legacyCacheNames : LEGACY_CACHE_NAMES)
      .filter(function (n) { return MODEL_CACHE_NAMES.indexOf(n) === -1; });

    legacyInFlight = registrations().then(function (regs) {
      return unregisterAll(regs.filter(function (r) { return scriptPath(r) === '/sw.js'; }));
    }).then(cacheNames).then(function (names) {
      return deleteCaches(names.filter(function (n) { return legacy.indexOf(n) !== -1; }));
    }).catch(function () { /* best effort */ }).then(function () {
      safe(function () { localStorage.setItem(LEGACY_FLAG, '1'); });
      legacyInFlight = null;
    });
    return legacyInFlight;
  }

  var api = Object.freeze({
    LANGUAGE_KEYS: LANGUAGE_KEYS,
    LEGACY_CACHE_NAMES: LEGACY_CACHE_NAMES,
    MODEL_CACHE_NAMES: MODEL_CACHE_NAMES,
    clearOnLogout: clearOnLogout,
    runLegacyCleanupOnce: runLegacyCleanupOnce
  });
  window.MAClientStorage = api;

  // Run the one-time clean-up on load so ordering against transitions.js never
  // matters (it calls the same function; the flag + in-flight memo make a
  // second call a no-op).
  runLegacyCleanupOnce();
})();
