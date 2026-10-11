# 13-QUICK datefix — Summary

- **Problem:** `test/read-sets-org-reports.test.js` export test pinned expected bytes at fixed `nowMs = 2026-10-10T12:00Z`, but `GET /api/reports/export` reads the live `Date.now()` for synergy `staleDays`, so it failed on any later day.
- **Fix (test only, assertion strength unchanged):** the test captures `Date.now()` once, freezes `Date.now` to that value for its duration (restored in `finally`), and passes the same instant as `nowMs` to `packCtx` (new optional third arg; the pack tests keep the fixed 2026-10-10 default). Route and expected side share one clock, so the byte-for-byte comparison is exact and cannot straddle midnight.
- **Verification:** the file alone ran 3x, 13/13 each time; the full `node --test` gave 1584 pass / 0 fail (EXIT=0), with no load flakes seen.
- **Scope:** only `test/read-sets-org-reports.test.js` changed (+13/-3); no `data/*.db`, `server.js`, STATE or ROADMAP edits.
- **Deviations:** none.
