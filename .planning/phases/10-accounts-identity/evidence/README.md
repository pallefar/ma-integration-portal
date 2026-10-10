# Phase 10 evidence (plan 10-09)

Reproduce: `PLAYWRIGHT_PATH=<playwright package dir> node scripts/uat/phase10-walk.js`
(all scenarios, all six lanes). Runner stdout is `phase10-walk.log`; machine form is
`results.json`. Last run: **179 PASS / 0 FAIL**, committed `data/demo.db` and
`data/control.db` (+ `-wal`) sha256 identical and `git status --porcelain -- data` empty
before and after.

Every screenshot is a 60-quality JPEG of the viewport only. No screenshot or log carries a
password, temporary password or session cookie (T-10-52): password inputs are empty or
masked in the DOM before capture, and log lines carry scenario names and statuses only.

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
| `node --test` (twice, clean tree) | 1038 tests, 1038 pass, 0 fail, both runs |
| `npm run soak` (3 processes, 120 s) | PASS: 4288 acknowledged / 0 missing / 0 mismatched, audit 1:1, 21 bounded 503s, conflict lane 443 acked / 924 real 409s, version reconciles |
| `node scripts/uat/phase9-walk.js` | 350 PASS / 0 FAIL |
| `node scripts/uat/phase9-walk.js --demo-open` | 18 PASS / 0 FAIL |
