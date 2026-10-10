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
//              The shared KNOWN_CONSOLE list is merged in by page().
//   landmarks  optional CSS selectors that must each match something in the
//              rendered page. Default ['main'].
//
// Wrap entries in page({...}) so the shared KNOWN_CONSOLE allow-list applies.

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

function page(entry) {
  return Object.assign({}, entry, { allowConsole: KNOWN_CONSOLE.concat(entry.allowConsole || []) });
}

module.exports = [
  page({
    name: 'login',
    path: '/login.html',
    as: 'anonymous',
    widths: [1440, 390],
    // public/login.html ships no <main>/<header> landmark at all. That is a
    // finding for the accessibility phase (axe reports it as "landmark-one-main"
    // / "region"), not something this harness can paper over, so the landmark
    // requirement is empty here rather than failing every run.
    landmarks: [],
  }),
  page({
    name: 'execution',
    path: '/execution.html',
    as: 'il',
    widths: [1440, 390],
  }),
];
