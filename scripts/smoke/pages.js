// Page registry for the browser smoke harness (scripts/smoke/run.js, QUAL-02).
//
// THIS is the only file a later phase edits to put a new page under smoke
// coverage: append one entry, never touch run.js.
//
// Entry shape:
//   name       short id, used by `--pages a,b` and the printed table
//   path       URL path served by the isolated real-deal server
//   as         'anonymous' | 'il' | 'admin'
//                anonymous  no session (login page)
//                il         an Integration Lead account (role hrbp), a member
//                           of the harness's synthetic deal, deal selected
//                admin      the bootstrap admin (rotated), no deal bound
//   widths     viewport widths to visit; height follows (1440 -> 900, 390 -> 844)
//   afterLoad  optional async (page) => void — drive the page to the state that
//              should be measured (open a tab, expand a panel) before axe runs
//   allow      optional [{ url: RegExp, status?: number }] — same-origin
//              responses >= 400 that are EXPECTED for this page. Empty by
//              default: every other 4xx/5xx raised by the page load fails the run.
//   allowConsole  optional [RegExp] — console.error texts that are EXPECTED for
//              this page (matched ones are reported as notes, not failures).
//              The shared KNOWN_CONSOLE list is merged in by withDefaults().
//   landmarks  optional CSS selectors that must each match something in the
//              rendered page. Default ['main'].
//
// The array is passed through withDefaults() at the bottom, which merges the shared
// KNOWN_CONSOLE allow-list into every entry — just append plain objects.

'use strict';

// Pre-existing, site-wide console errors the harness tolerates (each one is a
// finding owned by a later phase — delete the entry when the cause is fixed,
// so the harness starts failing on it again).
const KNOWN_CONSOLE = [
  // public/css/style.css @imports https://fonts.googleapis.com/..., which the
  // served CSP (server.js) rejects under connect-src: one console.error per
  // page load on every page. Tracked for the accessibility/UI phase; the
  // fonts fall back to the system stack.
  /fonts\.googleapis\.com[\s\S]*Content Security Policy/,
];

function withDefaults(entry) {
  return Object.assign({}, entry, { allowConsole: KNOWN_CONSOLE.concat(entry.allowConsole || []) });
}

module.exports = [
  {
    name: 'login',
    path: '/login.html',
    as: 'anonymous',
    widths: [1440, 390],
    // public/login.html ships no <main>/<header> landmark at all. That is a
    // finding for the accessibility phase (axe reports it as "landmark-one-main"
    // / "region"), not something this harness can paper over, so the landmark
    // requirement is empty here rather than failing every run.
    landmarks: [],
  },
  {
    // The deal home: dashboard.html loads deal-home.js for the signed-in IL.
    name: 'dashboard', path: '/dashboard.html', as: 'il', widths: [1440, 390],
  },
  { name: 'execution', path: '/execution.html', as: 'il', widths: [1440, 390] },
  { name: 'due-diligence', path: '/due-diligence.html', as: 'il', widths: [1440, 390] },
  { name: 'org', path: '/org.html', as: 'il', widths: [1440, 390] },
  {
    // admin.html opens on the Projects tab; the Users tab (ACCT-01) is what
    // gets measured: reveal it, then wait for its table.
    name: 'admin-users',
    path: '/admin.html',
    as: 'admin',
    widths: [1440, 390],
    afterLoad: async (page) => {
      await page.waitForSelector('#admin-tab-btn-users', { state: 'visible', timeout: 15000 });
      await page.click('#admin-tab-btn-users');
      await page.waitForSelector('#users-list .au-table', { timeout: 10000 });
      await page.waitForSelector('#tab-users.active', { timeout: 5000 });
    },
  },
].map(withDefaults);
