// [security] SAFE-07 / D-13-06 (c) / T-13-33 (Phase 13, plan 13-04): this file
// is a SELF-UNREGISTERING STUB. The portal has no offline mode and no worker
// of its own; an older release registered a worker here (and an even older one
// cached with a fetch handler). A browser that still holds that registration
// re-fetches this file on its update check, installs it, and it removes itself.
//
//   * NO fetch listener — a worker that intercepts requests could serve stale
//     or foreign content, so this one never sees a request;
//   * activate deletes ONLY the cache names a shipped release of this app
//     created (LEGACY_CACHE_NAMES below — empty: git history shows no
//     caches.open() was ever shipped) — never the Transformers model cache
//     ('transformers-cache'), which belongs to the page, not to a worker;
//   * then unregisters itself.
// public/js/client-storage.js keeps the same list for the page-side clean-up.
const LEGACY_CACHE_NAMES = [];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => LEGACY_CACHE_NAMES.indexOf(key) !== -1).map((key) => caches.delete(key))
      ))
      .then(() => self.registration.unregister())
  );
});
