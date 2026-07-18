# Technology Stack

**Analysis Date:** 2026-07-18

## Languages

**Primary:**
- JavaScript (Node.js) - Server backend and shared utilities
- HTML5/CSS3 - Frontend pages and UI templates (`public/*.html`)
- JavaScript (Client-side) - Frontend interactivity and page logic (`public/js/*.js`)

**Secondary:**
- JSON - Data storage and configuration (`db.json`, CMS bundles)

## Runtime

**Environment:**
- Node.js >=20 (minimum requirement per `package.json`; currently v22.18.0 in use)
- Cross-platform: Windows (win32-x64-msvc), macOS (darwin-x64, darwin-arm64), Linux (linux-x64-gnu, linux-arm64-gnu)

**Package Manager:**
- npm (v10.9.3)
- Lockfile: `package-lock.json` present
- **Dependencies committed:** `node_modules/` is intentionally committed (not ignored) to enable zero-install: `node server.js` runs with no `npm install`

## Frameworks

**Core:**
- Express.js 4.19.2 - Web server and REST API framework (`server.js`)

**Frontend:**
- Vanilla JavaScript - No framework; direct DOM manipulation and custom page modules
- HTML templating - Static `.html` files served from `public/`

**Testing:**
- Not detected - No test runner configuration (jest, vitest, playwright, etc.)

**Build/Dev:**
- No build tool - Static asset serving via Express `express.static()` with cache headers
- Development: `npm run dev` opens browser + starts `node server.js`
- Production: `npm run start` runs `node server.js`

## Key Dependencies

**Critical:**
- `express` 4.19.2 - HTTP server, routing, static middleware
- `compression` 1.8.1 - gzip compression middleware for response optimization
- `pdf-parse` 2.4.5 - PDF text extraction for RAG training uploads

**Infrastructure:**
- `@napi-rs/canvas` v0.1.80 (multi-platform binaries: win32-x64-msvc, darwin-x64, darwin-arm64, linux-x64-gnu, linux-arm64-gnu) - Canvas rendering for PDF export features (admin only)

**Vendored/Committed:**
- Transformers.js - Locally vendored at `public/vendor/transformers/` (transformers.min.js + 4 ONNX WASM files; repointed from CDN to `/vendor/transformers/transformers.min.js` in `public/js/dashboard.js` and `public/js/transitions.js`)

## Configuration

**Environment Variables:**
- `PORT` - Server port (default: 3000)
- `PUBLIC_BASE_URL` - Public base URL for links (default: `http://localhost:${PORT}`)
- `ADMIN_TOKEN` - Shared secret for state-changing API endpoints (POST/PUT/DELETE) and `/api/admin/*` routes. When unset (dev/demo), write endpoints are open; when set (production), requires `X-Admin-Token` header via constant-time SHA-256 comparison
- `ENABLE_HSTS` - Set to '1' to enable HSTS header (production behind TLS only)

**Build Configuration:**
- No build tool config (webpack, vite, rollup, etc.)
- Static asset serving via Express middleware with conditional cache headers:
  - `.wasm` files: 30-day max-age cache
  - `.js`, `.css`, images: 30-day max-age cache
  - `.html` files: `no-cache` to avoid serving stale pages

**Database Configuration:**
- Default: File-based JSON storage at `db.json` (~300KB)
- In-memory cache keyed on file mtime to avoid re-parsing on every request (~30 reads per page load)
- Atomic writes via temp file + rename to prevent corruption on crash
- Rolling backup: `db.json.bak` preserved before each write

**Security Headers:**
- Content-Security-Policy (CSP) - Allows 'unsafe-inline'/'unsafe-eval' for inline scripts + Transformers.js WASM; blocks external script injection, data exfil, object/embed, framing, form hijack
- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: Disables geolocation, microphone, camera
- HSTS: Optional (controlled by `ENABLE_HSTS` env var, meaningful only behind TLS)

## Platform Requirements

**Development:**
- Node.js >=20
- npm (bundled with Node.js)
- macOS/Windows/Linux; zip utility required for admin `/api/admin/download-zip` feature
- Optional: Git (for version control)

**Production:**
- Node.js >=20
- No additional system dependencies; Canvas binaries are pre-compiled in node_modules for win32-x64, darwin-x64, darwin-arm64, linux-x64-gnu
- ~150MB disk space for committed node_modules
- TLS termination recommended (for HSTS + secure deployments; app runs plain HTTP by default)

**Deployment Targets:**
- Self-hosted Node.js servers (internal VPN/SSO with ADMIN_TOKEN)
- Turnkey releases: Windows + macOS bundles with portable Node.js v22.23.1 in `ma-integration-portal/node/` (built outside git via `git archive`)

---

*Stack analysis: 2026-07-18*
