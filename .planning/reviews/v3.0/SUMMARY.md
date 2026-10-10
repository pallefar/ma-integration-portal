# v3.0 Production-Readiness Review — synthesis

2026-10-10 · HEAD at review time `56ca821` · 7 parallel lanes (R1 security, R2 ops/data/deploy, R3 module
inventory + admin switch, R4 Integration-Leader journey, R5 quality, R6 domain research, R7 Phase-9 UAT)
· every lane ran against an isolated instance; reports are in this directory and are the evidence base.

## Verdict

The engineering of Phases 1–9 is careful and the concurrency work is real (0 acknowledged writes lost
across SIGTERM mid-burst; 503/409 contracts hold; audit-in-transaction intact). **The app is not
production-ready for MNPI on a shared host, and it is not yet the Integration Leader's tool.** Four
structural problems, each confirmed by more than one lane:

1. **There is no way to provision real people.** Four committed demo accounts share a password printed on
   the login page; there is no user create/disable/reset anywhere; a fresh host has *zero* users
   (R1-01, R2-05). BLOCKER.
2. **Every write rewrites and audits every row of the deal.** 99.96 % of audit rows in the real
   `audit.db` are byte-identical before/after; one click at realistic size appends 6,220 audit rows
   (3.6 MB) to an append-only log and stalls the single event loop (R1-07, R2-01, R2-02, R5-01). BLOCKER.
3. **Authorization is coarse and the config surface is writable by `pmo`/`hrbp`** — which is exactly
   where "admin can disable parts of the app" would live — and the clean-room has a write-path hole on
   tasks/RAID that Phase 9's 409 body turned into a disclosure oracle (R1-02, R1-05, R3 F-1). HIGH.
4. **The IL is not the product's persona.** After login she lands on the demo slide deck, ~70 % of her
   sidebar is showcase, the one deal-bound screen has no tasks/RAID/value/timeline, the overdue signal
   runs on the demo clock, and the 30 seeded tasks cannot be assigned in the UI (R4). HIGH.

Plus: Phase 9 is **not** closed — R7 reproduced a silent clobber on the first co-edit of any record that
was never edited (F-1), contradicting CONC-02/D-02.

## Cross-lane convergence (findings confirmed by ≥ 2 lanes)

| Finding | Lanes | Sev | Disposition |
|---|---|---|---|
| No user provisioning, published demo creds, zero-user lockout | R1-01, R2-05, R5-17 | BLOCKER | Ph10 ACCT-01..07 |
| Write/audit amplification, O(N) request path | R1-07, R2-01/02, R5-01/05 | BLOCKER | Ph12 DATA-01/02 |
| Static `sent_emails/` + `uploads/` unauthenticated, not deal-scoped | R1-06, R2-12, R3 F-3, R5-08 | MEDIUM→HIGH | Ph14 SAFE-04 |
| Throttle keyed on proxy IP; `Secure` coupled to HSTS; TRUST_PROXY undocumented | R1-08, R2-11 | MEDIUM | Ph10 ACCT-05, Ph20 OPS-05 |
| 50 MB bodies into sync whole-object writes | R1-10, R2-12 | MEDIUM | Ph14 SAFE-05 |
| Graceful shutdown keeps serving, exits 1; uncaught = log-and-continue | R2-04/13, R5-12 | HIGH | Ph20 OPS-04 |
| `download-zip` blocks server, ships gitignored files | R2-12, R5-06 | MEDIUM | Ph14 SAFE-08 |
| Gemini/HF egress switchable by non-admin; RAG upload dead | R1-16, R2-16, R5-07 | MEDIUM | Ph13 SAFE-06 |
| Stale boot banner / README / runbook; version 1.0.0 | R1-13, R5-13 | LOW | Ph21 REL-01 |
| `/healthz` full DB read, no readiness | R2-09, R5-16 | MEDIUM | Ph20 OPS-06 |
| Config/CMS/settings/menus writable by pmo/hrbp (cosmetic "hide" only) | R1-05, R3 F-1, R4 F18 | HIGH | Ph11 AUTHZ-02 → Ph15–16 MOD |
| Tests listen on `::` but connect to 127.0.0.1 (foreign servers answer) | R5-02, memory flake | MEDIUM | Ph12 DATA-06 |
| Phase 8/9 client code ships behind a 30-day JS cache without a stamp bump | R5-03 | HIGH | Ph9 closure + Ph12 QUAL-01 |

## Single-lane findings → disposition

| Finding | Lane | Sev | Disposition |
|---|---|---|---|
| Clean-room write bypass on tasks/RAID; 409 body discloses record | R1-02 | HIGH | Ph11 AUTHZ-03 |
| Sanitizer bypassed 4 ways; CSP `unsafe-inline` ⇒ pmo→admin stored XSS | R1-03 | HIGH | Ph13 SAFE-01/02 |
| Raw HTML slide upload, same-origin unsandboxed iframe | R1-04 | HIGH | Ph13 SAFE-03 |
| `employee` reads financials/RAID/roster/pulses; read policy absent | R1-05, R1-15 | HIGH | Ph11 AUTHZ-01 |
| Compression/proxy-addr/qs advisories | R1-09 | MEDIUM | Ph21 REL-02 |
| scrypt N=2¹⁴; omit-version bypass; no `no-store` | R1-11/12/14 | LOW | Ph10 ACCT-04, Ph9, Ph13 SAFE-07 |
| `GET /api/employees/get-or-create` writes | R3 F-2 | MEDIUM | Ph11 AUTHZ-04 |
| `/api/modules` name clash with app-module registry | R3 F-4 | LOW | Ph15 (use `/api/app-modules`) |
| CPU-bound pack/pdf-parse freezes process 2–4 s, any role | R2-03 | HIGH | Ph12 DATA-05 |
| DB files 0644, plaintext Gemini key | R2-06 | HIGH | Ph10 OPS-08, Ph20 OPS-07 |
| No boot/config validation; port-in-use exits 0 | R2-07 | MEDIUM | Ph20 OPS-05 |
| No schema versioning | R2-08 | MEDIUM | Ph12 DATA-03 |
| No backup/restore/integrity/retention; no MNPI purge | R2-10 | MEDIUM | Ph12 DATA-04, Ph21 DEPLOY-01 |
| Unbounded maps (throttle, connection cache) | R2-14 | LOW | Ph20 OPS-04 |
| Packaging ships `.planning/`, `db.json`, `test/`; glibc ≥ 2.38 | R2-15, R5-14 | LOW | Ph21 REL-01, DEPLOY-02 |
| DD page loses typed input on failed save | R5-09 | MEDIUM | Ph18 IL-10 |
| Real-deal screens EN-only; dictionary doesn't propagate | R5-10, R4 P8/F15 | MEDIUM | Ph19 UX-01 |
| a11y: unlabeled controls, dialog focus, live region, reduced motion, contrast | R5-11 | MEDIUM | Ph19 UX-02 |
| Cache-wipe kill-switch deletes legitimate caches | R5-15 | LOW | Ph13 SAFE-07 |
| "Reset custom M&A" wipes every deal's sent emails | R5-08 | MEDIUM | Ph14 SAFE-08 |
| No CI; release build unscripted | R5-14 | LOW | Ph12 DATA-06, Ph21 REL-01 |
| No deal-aware landing / cockpit; demo chrome + fabricated banners | R4 F1/F4, P1–P7 | HIGH | Ph15–16 + Ph17 IL-01/02 |
| Attention signals: demo clock, `critical` RAID never counted | R4 F2 | HIGH | Ph17 IL-03 |
| No UI to set owner/due/phase on existing tasks | R4 F3 | HIGH | Ph18 IL-08 |
| IL cannot manage membership | R4 F5 | MEDIUM | Ph22 COLLAB-01 |
| `$` hard-coded; `deal.currency` unused | R4 F6 | MEDIUM | Ph17 IL-05 |
| Timeline markers unused; "Day 30" demo badge | R4 F7 | MEDIUM | Ph17 IL-04 |
| No decision log (RAID decisions lack decider/date) | R4 F8 | MEDIUM | Ph18 IL-09 |
| DD workspace: 13 k-px unfiltered list | R4 F9 | MEDIUM | Ph18 IL-10 |
| `assessment-instances` 401 for IL; no own-record view | R4 F10 | MEDIUM | Ph18 IL-13 |
| Pack/exports omit DD, timeline, Day-1 readiness | R4 F11 | MEDIUM | Ph18 IL-11 |
| No "changed since I last looked" | R4 F12 | MEDIUM | Ph18 IL-12 |
| 390 px header stack ≈ 470 px of chrome | R4 F13 | MEDIUM | Ph19 UX-03 |
| IL painted as "IMO · System Admin" on admin.html | R4 F14 | LOW | Ph17 IL-06 |
| Demo `processCatalog` seeded into every real deal | R4 F16 | LOW | Ph17 IL-07 |
| Phase 9: F-1 first-co-edit clobber (HIGH), F-2 page not synced after Apply, F-3 diff mislabel, F-4 withheld-record copy, F-5 raw keys, F-6 double prompt, F-7 contradictory attribution | R7 | HIGH–LOW | Ph9 gap closure (CONC-02 reopened) |

**Accepted / not pursued in v3.0** (stated so nothing is silently dropped): monolith refactors of
`server.js`/`transitions.js` (R5-17 — no behavioural payoff this milestone; touched only where a phase
needs it); multi-host horizontal scaling / Postgres (REQUIREMENTS Future); TE SSO/HRIS (Out of Scope);
SQLCipher (Out of Scope — OS disk encryption + 0600/0700 now added); Express 5 migration (reassess at
REL-02 against the Express 4 support window).

## Decisions taken while synthesizing (recorded in PROJECT.md Key Decisions)

- **D-V3-1 Re-scope v2.2.0 → v3.0 in place.** Phases 8–9 stay; 10–13 are absorbed and re-ordered; nothing
  archived (all local/unreleased). REQUIREMENTS.md anticipated this bump.
- **D-V3-2 Module switch = instance ceiling + per-deal additive override, admin-only, non-destructive.**
  R3 recommended global-first; R4/R6 show an IMO needs per-deal control (org off until HR clearance,
  employee portal off pre-close). Static pages are guarded at instance level only (no deal context there);
  per-deal enforcement is API + client payload, which is where the data is.
- **D-V3-3 Foundation-first ordering is kept**: accounts → authorization → data layer → content safety →
  deal files → module switch (core, surfaces) → IL cockpit → IL tooling → language/a11y/mobile → ops →
  deployment → collaboration → certification (16 phases, 8–23). Security/data blockers precede every
  IL feature because MNPI is the project's non-negotiable constraint.
- **D-V3-4 IL membership management stays in the collaboration phase** (admin does it meanwhile, now
  that admin user CRUD exists) — keeps Phase 10 bounded.
- **D-V3-5 Real-deal screens get translated (EN/DE/ZH/CS), not hidden.** The user's own i18n investment
  and the DE/CZ/CN workstream leads argue for it; cost M.
- **D-V3-6 Human-verify gates are judged by Fable against the written contracts** (standing directive
  2026-08-08); outward/irreversible acts (push, release) stay user-confirmed.

## Plan-review amendments applied (PLAN-REVIEW.md, 2026-10-10)

An independent Fable read returned CONFORMANT WITH AMENDMENTS; the amendments are in REQUIREMENTS.md /
ROADMAP.md. The ones that changed shape: **explicit real-deal mode on its own gitignored data directory**
(PR-23 — also removes the risk of MNPI deal names landing in the committed `control.db`); DATA-04
rewritten as sealed, hash-chained per-deal audit partitions (supersedes AUD-02, PR-09); COLLAB-02 pulled
into Phase 10 because role is snapshotted in the session (PR-17); `/` fallback to deal home when the
showcase is off (PR-04); numeric performance budgets in the success criteria (PR-13); Phases 10, 12, 13
split into 10/11, 13/14, 15/16 (PR-19); smoke harness moved to Phase 12 (PR-20); IL-14/15 added so
CERT-04 is achievable (PR-01); CERT-06 security-decisions record (PR-08).

## Residual risk (what no lane could prove)

Multi-week memory/handle growth (only 2.5-min profiles); Windows/Linux boots not re-run here; no
screen-reader walkthrough; Phase-8 multi-process soak not re-run after Phase-9 (will be, Ph12/Ph23);
the remaining ~300 client `innerHTML` sinks beyond the named ones (SAFE-01/02 bound the class by CSP +
sanitizer replacement rather than by exhaustive audit); legal questions (which insider-list regime binds
TE; works-council treatment of named-employee data) are out of the code's reach.
