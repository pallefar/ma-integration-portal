# API Coverage — Phase 3 (Deal Isolation, Audit Log & Write Validation)

No external API integration: this phase builds only in-process capability — SQLite file-per-deal
isolation, an `AsyncLocalStorage`-bound request resolver, an application-level audit log, and zod
schema validation over the app's own existing HTTP routes. The only new dependency is `zod`, a pure
in-process validation library with no network surface; `better-sqlite3` (Phase 1) is an embedded
driver, not a service client. No third-party API, SDK, service client or webhook is added, called or
wrapped anywhere in Plans 03-01 through 03-06.

The term "API" throughout this phase's artifacts refers exclusively to the application's own
`/api/*` Express routes, which are internal surface, not an external capability whose feature
matrix could be partially adopted.

*Declared at plan time, 2026-08-01.*
