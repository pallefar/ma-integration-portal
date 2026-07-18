# External Integrations

**Analysis Date:** 2026-07-18

## APIs & External Services

**Generative AI:**
- Google Gemini API (`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`)
  - What it's used for: M&A Integration Plan generation (100-day roadmap based on survey scores) via `generate100DayPlan()` in `aiService.js`; PDF RAG review and AI Insight categorization via `reviewPdfContent()` in `aiService.js`
  - SDK/Client: Native `fetch()` (no SDK package)
  - Auth: API key stored in `db.json` settings as `geminiApiKey`; never sent to client (stripped by `publicSettings()` in `server.js:250-259`)
  - Timeout: 15 seconds; fails gracefully to local fallback engine if API unreachable
  - Env var: Retrieved from database settings; no env var required

**ML Models:**
- Hugging Face (`https://huggingface.co`, `https://*.huggingface.co`, `https://cdn-lfs.huggingface.co`, `https://cdn-lfs-us-1.huggingface.co`)
  - What it's used for: Transformers.js text2text-generation models (local inference via vendored ONNX WASM runtime); used for SmolInsight narrative generation in admin dashboard
  - SDK/Client: Transformers.js locally vendored at `public/vendor/transformers/transformers.min.js` (browser client-side)
  - Auth: No authentication required (public model hosting)
  - Runtime: WASM-based, runs in browser; ONNX models downloaded on first use
  - Config: `transformers.env.allowLocalModels = false` (models stream from HF, not cached locally); `wasmPaths = '/vendor/transformers/'` for local WASM binary

**Video Hosting:**
- YouTube (`https://www.youtube.com`, `https://youtube.com`, `https://www.youtube-nocookie.com`, `https://img.youtube.com`, `https://i.ytimg.com`)
  - What it's used for: Employee welcome videos (per-language YouTube IDs in settings), embedded in `public/employee.html` and `public/overview-deck/*`
  - SDK/Client: Native `<iframe>` embeds with autoplay=1 gesture (no SDK)
  - Auth: No authentication required (public videos)
  - Config: Per-language video URLs stored in `db.json` settings as `welcomeVideoUrl_<lang>` and `welcomeVideoType_<lang>` (en, de, cs, zh)
  - CSP: Allows `https://www.youtube.com`, `https://youtube.com` for script + frame + media

## Data Storage

**Databases:**
- **Primary (Demo/Local):** File-based JSON at `db.json` (~300KB typical)
  - Connection: Local filesystem, no external connection
  - Client: Custom file I/O via Node.js `fs` module (`readDb()`, `writeDb()` in `server.js:121-237`)
  - Mtime-based in-memory cache to avoid re-parsing on every read
  - Atomic writes via temp file + rename (safe crash recovery)
  - Rolling backup: `db.json.bak` before each write
  - Data model: settings, questions, assessments, modules, employees, hrbps, alerts, pulses, courses, pages, media, banners, i18n, menus, projects, departments, processCatalog, slides, ragUploads

- **Production (Future):** Azure SQL Server connection string stored in `db.json` settings under `databaseConfig.connectionDetails.connectionString` (not currently used; placeholder for future migration)
  - Status in db: `databaseConfig.enabled`, `databaseConfig.provider`, `databaseConfig.status`, `databaseConfig.timestamp`

**File Storage:**
- Local filesystem only (`public/uploads/`, `public/sent_emails/`, `public/slides/`)
- User-uploaded PDFs: Base64-decoded and persisted to disk by RAG upload endpoint (`/api/rag/upload`)
- HTML slides: Uploaded via `/api/slides/upload` → `public/uploads/slides/`
- Excluded from exports: `db.json`, `.env`, `sent_emails/`, `node_modules/` (removed by `/api/admin/download-zip`)

**Caching:**
- In-memory mtime cache for `db.json` reads (no external cache service)
- HTTP cache headers: 30-day max-age for static assets (`.js`, `.css`, `.wasm`, images); `no-cache` for HTML

## Authentication & Identity

**Auth Provider:**
- Custom (file-based + env-gated token)
- Implementation: 
  - Demo mode (ADMIN_TOKEN unset): All endpoints open
  - Production mode (ADMIN_TOKEN set): POST/PUT/DELETE and `/api/admin/*` routes require `X-Admin-Token` header (constant-time SHA-256 comparison)
  - Role-based visibility: `settings.roleVisibility` object controls which roles appear in the UI (admin toggles)
  - Demo roles: pmo, hrbp, supporting, employee, leaders, admin

**User Sessions:**
- Stateless HTTP (no session cookies)
- Browser-side state: localStorage for UI preferences (theme, layout, settings), sessionStorage for temp dismissals
- Role selection: Stored in URL hash (e.g., `#/role/hrbp`) or localStorage

**SSO/OAuth:**
- Not implemented in current version (deferred for production hardening phase)
- Planned: Internal VPN + corporate SSO integration (noted in production roadmap)

## Monitoring & Observability

**Error Tracking:**
- Browser console only (no external error tracking service)
- Server console logs for API errors

**Logs:**
- Server: Console output via `console.log()`, `console.warn()`, `console.error()`
- Client: Browser DevTools console
- No persistent log storage (logs ephemeral)
- Key logged events: API calls, RAG operations, Gemini API requests, PDF uploads, database operations, security warnings

## CI/CD & Deployment

**Hosting:**
- Self-hosted Node.js application (internal VPN/SSO when production-hardened)
- GitHub releases: Turnkey bundles (v1.0.0+) with portable Node.js runtime for Windows/macOS (`ma-integration-portal/node/`)
- Launcher scripts: `start.bat` (Windows), `start.command` (macOS), or manual `node server.js`

**CI Pipeline:**
- None configured (single-developer repo, manual testing before merge to main)

**Release Process:**
- Git tag (e.g., `v1.5.1`); pushed to GitHub
- GitHub release with 3 turnkey `.zip` files (Windows, macOS, any-OS bundles)
- Bundles created outside git via `git archive --prefix=ma-integration-portal/ ... | zip` + Node binary injected into win/mac zips

## Environment Configuration

**Required env vars (production):**
- `ADMIN_TOKEN` - Shared secret for state-changing endpoints (mandatory for prod security)

**Optional env vars:**
- `PORT` - Server port (default: 3000)
- `PUBLIC_BASE_URL` - Public URL for absolute links (default: `http://localhost:3000`)
- `ENABLE_HSTS` - Set to '1' to enable HSTS header (only meaningful behind TLS)

**Secrets location:**
- Development: `db.json` settings (unencrypted; for demo only)
- Production: `db.json` settings loaded from environment via startup scripts
- Never committed: `.env`, `.env.*` files (listed in `.gitignore`)

**Critical stored secrets:**
- `geminiApiKey` - Stored in `db.json settings.geminiApiKey`; stripped before sending to client
- `ADMIN_TOKEN` - Env var only; never persisted to db
- Database connection string: Stored in `db.json` `settings.databaseConfig.connectionDetails.connectionString` (placeholder for future Azure SQL)

## Webhooks & Callbacks

**Incoming:**
- None configured

**Outgoing:**
- None configured
- Future: Process integration webhooks (when external system callbacks are implemented)

## Cross-Origin & API Security

**CORS:**
- Not configured (app serves all content from same origin; no cross-origin API calls from client)
- CSP blocks `connect-src` to external domains except Hugging Face (models) and YouTube (media)

**API Rate Limiting:**
- Not implemented (deferred for production hardening)

**Request Timeouts:**
- Gemini API: 15-second timeout (AbortSignal.timeout(15000))
- PDF parsing: No explicit timeout (blocking operation)
- Other endpoints: No explicit timeout (relies on HTTP keep-alive defaults)

---

*Integration audit: 2026-07-18*
