# Phase 10 evidence (plan 10-09)

Reproduce: `PLAYWRIGHT_PATH=<playwright package dir> node scripts/uat/phase10-walk.js`
(all scenarios, all six lanes). Runner stdout is `phase10-walk.log`; machine form is
`results.json`. Last run: **184 PASS / 0 FAIL** (re-run after the post-verification
correction below), committed `data/demo.db` and `data/control.db` (+ `-wal`) sha256 identical
and `git status --porcelain -- data` empty before and after.

Every screenshot is a 60-quality JPEG of the viewport only. No screenshot or log carries a
real, temporary or rotated password or a session cookie (T-10-52): password inputs are empty
or masked in the DOM before capture, and log lines carry scenario names, statuses and counts
only. The Users-tab scenario takes its screenshots through `shot()`, which masks the
temporary-password field, proves the secret is nowhere in the DOM, and refuses to write the
file otherwise. The one password-like string in any shot is the published demo password
`TEdemo!2026` in the demo panel of the dev and demo-open login shots, shown there by design
(D-10-08; it is the evidence that the panel appears only in those modes).

**Post-verification correction.** `10-VERIFICATION.md` found the runner red on HEAD (179 PASS /
1 FAIL): the WR-C01 check in `users-tab.js` compared the temporary-password field with the
real secret after the scenario had masked it for the screenshot. Fixed in `e7a36bf`; every
screenshot, `results.json` and `phase10-walk.log` here are from the corrected re-run. The
scenario's check count is 33 (28 at the original sign-off, +1 WR-C01 sticky check added by the
review fix and repaired here, +4 added here).

| Screenshot | Scenario @ lane | Proves |
|------------|-----------------|--------|
| `acceptance1-login-real-1440.jpg`, `-390.jpg` | realEmptyDirBootstrap @ real | PRD acc. 1: real mode on an empty data dir, login page without demo credentials |
| `login-real-1440.jpg`, `-390.jpg` | realLoginHasNoDemoCredentials @ real | D-10-08c: no demo panel, no password in DOM |
| `acceptance3-lockdown-1440.jpg`, `-390.jpg` | handCopiedControlDbLockdown @ real-handcopied | PRD acc. 3: lockdown page on a hand-copied committed control.db |
| `acceptance3-login-under-lockdown-1440.jpg` | handCopiedControlDbLockdown | login page still served under lockdown |
| `acceptance3-change-password-under-lockdown-1440.jpg` | handCopiedControlDbLockdown | sign-in with the published password lands on the change-password page, remedy reachable |
| `forced-change-1440.jpg`, `-390.jpg` | forcedChangeLandsOnChangePassword @ real | PRD acc. 2 / D-10-05: forced change-password screen |
| `change-password-modal-390.jpg` | selfServiceSessions @ real | voluntary change password from the header menu at 390 |
| `sessions-1440.jpg`, `-390.jpg` | selfServiceSessions @ real | My sessions (This device marked, End session) |
| `users-tab-1440.jpg`, `-390.jpg` | usersTabLifecycle @ real | Admin Users tab at both widths |
| `temp-password-modal-1440.jpg`, `add-user-modal-390.jpg` | usersTabLifecycle @ real | one-time temporary-password modal (value masked), add-user modal at 390 |
| `committed-readonly-menu-1440.jpg`, `-390.jpg` | committedControlAccountWritesHidden @ dev-committed | accountsWritable:false: Change password disabled, My sessions without End buttons, note |
| `committed-readonly-users-1440.jpg`, `-390.jpg` | committedControlAccountWritesHidden @ dev-committed | Users tab lists accounts with no Add/Edit/Disable/Reset controls, note shown |
| `change-password-readonly-1440.jpg` | selfServiceReadOnly @ dev-committed | standalone change-password form disabled with note |
| `sessions-readonly-1440.jpg` | selfServiceReadOnly @ dev-committed | sessions list without End buttons |
| `demo-open-no-account-ui-1440.jpg`, `-390.jpg` | committedControlAccountWritesHidden @ demo-committed | DEMO_OPEN: no account menu item at all (server ignores the cookie) |
| `demo-open-anonymous-1440.jpg` | demoOpenAnonymousNoLoop @ demo-open | WINDOWS #4: cookie-less tab does not redirect-loop |
| `login-dev-1440.jpg`, `login-dev-committed-1440.jpg` | devLoginShowsDemoPanel @ dev, dev-committed | dev lane keeps the demo panel |
| `login-demo-open-1440.jpg`, `login-demo-committed-1440.jpg` | demoOpenLoginStays @ demo-open, demo-committed | demo-open login page stays put, "Open the demo" link |

## Regression runs recorded with this evidence (not committed as logs)

| Run | Result |
|-----|--------|
| `node --test` (once, post-verification re-run, clean tree) | 1055 tests, 1055 pass, 0 fail, 0 skipped (1038 / 1038 twice at the original sign-off, before the review fixes) |
| `npm run soak` (3 processes, 120 s) | PASS: 4288 acknowledged / 0 missing / 0 mismatched, audit 1:1, 21 bounded 503s, conflict lane 443 acked / 924 real 409s, version reconciles |
| `node scripts/uat/phase9-walk.js` | 350 PASS / 0 FAIL |
| `node scripts/uat/phase9-walk.js --demo-open` | 18 PASS / 0 FAIL |
