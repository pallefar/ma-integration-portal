# Codebase Structure

**Analysis Date:** 2026-07-18

## Directory Layout

```
M&A/
├── server.js                     # Express.js REST API + static server (2415 lines)
├── aiService.js                  # Gemini API client + local fallback plan generator (26KB)
├── ragService.js                 # Playbook indexing + RAG retrieval service
├── db.json                        # File-based database (JSON; in-memory cache + atomic writes)
├── package.json                   # Node.js dependencies (express, compression, pdf-parse)
├── package-lock.json              # Locked dependency versions
│
├── public/                        # Static assets served by Express (http://localhost:3000/*)
│   ├── index.html                 # Landing page: role selector grid
│   ├── overview.html              # Home page: executive slide deck overlay
│   ├── dashboard.html             # Integration Leader portal (HRBP role)
│   ├── employee.html              # Acquired employee onboarding + academy
│   ├── pmo.html                   # PMO steering console
│   ├── admin.html                 # System admin console (settings, CMS, users)
│   ├── leaders.html               # Leaders portal (executive view)
│   ├── supporting.html            # Supporting teams (HR, payroll, legal)
│   ├── playbook.html              # Official HR M&A playbook + standards
│   ├── survey.html                # Multi-step assessment form
│   ├── signage.html               # Office/workplace signage content
│   ├── capability-hub.html        # TE Connectivity skills catalog
│   ├── insights.html              # M&A Insights page (Acquisition Radar, scenarios)
│   ├── integration-excellence.html # Integration quality metrics
│   │
│   ├── css/
│   │   └── style.css              # Single unified stylesheet (199KB, variables, grid, components)
│   │
│   ├── js/
│   │   ├── transitions.js          # Core: router, access control, SPA transitions, playbook/slide modals (3230 lines)
│   │   ├── app.js                  # Survey assessment flow control (454 lines)
│   │   ├── dashboard.js            # HRBP portal tabs + KPIs + roadmap + coaching (2337 lines)
│   │   ├── employee.js             # Employee portal: academy, progress, gamification (3608 lines)
│   │   ├── pmo.js                  # PMO Coordinator steering console (1403 lines)
│   │   ├── admin.js                # Admin console: settings, project setup, demo mode (2454 lines)
│   │   ├── admin-cms.js            # Admin: CMS editor (courses, pages, menus, i18n, slides) (1281 lines)
│   │   ├── leaders.js              # Leaders portal view (279 lines)
│   │   ├── supporting.js           # Supporting teams view (330 lines)
│   │   ├── signage.js              # Signage content builder (350 lines)
│   │   ├── synergy-quest.js        # Gamification: achievements, points, badges (2529 lines)
│   │   ├── banners.js              # Global notification/alert banner system (96 lines)
│   │   ├── inline-edit.js          # Click-to-edit inline content on live pages (176 lines)
│   │   ├── page-layout.js          # Block registry for CMS page builder (111 lines)
│   │   ├── page-cms.js             # Page content rendering from CMS (25 lines)
│   │   ├── ted-launcher.js         # Easter egg easter-egg modal (74 lines)
│   │   ├── capability-hub.js       # Capability hub content (41 lines)
│   │   └── integration-excellence.js # Integration metrics view (23 lines)
│   │
│   ├── images/
│   │   ├── te-logo.png            # TE Connectivity official logo (header)
│   │   ├── brand-logo-svg.svg     # Alternative branding assets
│   │   └── [...other logos/icons]
│   │
│   ├── playbook/
│   │   └── hr-ma-guidebook.pdf    # Official 52-slide HR M&A playbook (LibreOffice converted from PPTX)
│   │
│   ├── slides/
│   │   └── welcome-slide.html     # Demo custom HTML slide (admin can upload more)
│   │
│   ├── overview-deck/
│   │   ├── deck.html              # Embedded slide deck (Hero, Phases, Features)
│   │   ├── agenda.html            # Agenda slide + popover button
│   │   ├── working-in-a-matrix.html # Working in a Matrix scenario cards
│   │   ├── easter-egg.html        # Hidden singing rockstar + karaoke (Easter egg)
│   │   ├── slide5.html            # Narrative content slide
│   │   └── slide6.html            # Narrative content slide
│   │
│   ├── uploads/
│   │   └── slides/                # Directory for user-uploaded HTML slides via admin
│   │
│   ├── vendor/
│   │   └── transformers/          # Vendored Transformers.js (ONNX inference runtime for NLP tasks)
│   │       ├── transformers.min.js # Main library bundle
│   │       └── [*.wasm]           # ONNX model WebAssembly files
│   │
│   ├── sent_emails/               # Archive of admin-sent communications (HTML snapshots)
│   ├── doom/                      # Easter egg: DOS emulator assets (js-dos.js, wdosbox.js)
│   └── manifest.json              # PWA manifest
│
├── .planning/
│   └── codebase/                  # Codebase documentation (this directory)
│       ├── ARCHITECTURE.md        # Architecture pattern, layers, data flow
│       ├── STRUCTURE.md           # This file: directory layout, naming conventions
│       ├── CONVENTIONS.md         # Coding style, naming patterns
│       ├── TESTING.md             # Test patterns (none currently; no test framework)
│       ├── STACK.md               # Technology stack (Express, browser APIs)
│       ├── INTEGRATIONS.md        # External APIs (Gemini, YouTube, Hugging Face)
│       └── CONCERNS.md            # Technical debt, security considerations
│
├── looxmaxing/                    # Unused side project (Vue.js e-commerce demo; can be ignored)
│   ├── src/
│   ├── dist/
│   └── package.json
│
└── node_modules/                  # Committed dependencies (vendored)
    ├── express/
    ├── compression/
    ├── pdf-parse/
    └── [@napi-rs/canvas-*]/       # Platform-specific canvas bindings (PDF→RAG feature)
```

## Directory Purposes

**`public/`:**
- Purpose: Static assets served to browsers
- Contains: HTML pages, JavaScript, CSS, images, PDF playbook, vendor libraries
- Key files: Each `{role}.html` page + corresponding `public/js/{role}.js` controller
- Generated: `public/uploads/slides/` (user-uploaded HTML files) + `public/sent_emails/` (communication archives)

**`public/js/`:**
- Purpose: Client-side application logic, one file per major feature
- Contains: Event listeners, fetch API calls, DOM manipulation, state management (localStorage)
- Naming: `{feature}.js` (e.g., `dashboard.js`, `employee.js`, `admin.js`)
- Large files: `transitions.js` (router + core), `dashboard.js` (HRBP portal), `employee.js` (academy + gamification)

**`public/css/`:**
- Purpose: Unified styling for all pages and roles
- Contains: CSS custom properties (variables), grid/flexbox layouts, component classes, responsive media queries
- Pattern: Single 199KB file; componentized via class selectors (`.card`, `.btn`, `.dashboard-*`, `.card-glass`, etc.)

**`public/overview-deck/`:**
- Purpose: Interactive HTML slide deck for executive overview/onboarding
- Contains: Narrative slide decks, working-in-a-matrix scenarios, hidden easter egg
- Served: Via admin menu link or `public/overview.html` embedding

**`public/vendor/`:**
- Purpose: Vendored third-party libraries (no external CDN)
- Contains: Transformers.js (ONNX-based NLP inference) + WASM models
- Why vendored: App works offline; predictable startup; no CDN dependency

**`public/playbook/`:**
- Purpose: Official HR M&A guidebook PDF
- Contains: 52-slide LibreOffice PDF exported from PowerPoint
- Used by: Playbook modal overlay (transitions.js), admin dashboard links (data-playbook-slide attributes)

## Key File Locations

**Entry Points:**
- `server.js`: Backend startup (line 11: Express app init)
- `public/overview.html`: Home page (served by GET / at line 62–65 of server.js)
- `public/index.html`: Role selector landing
- `public/{role}.html`: Role-specific portals (dashboard, employee, pmo, admin, etc.)

**Configuration:**
- `db.json`: Application state (projects, users, CMS content, i18n strings, settings)
- `package.json`: Node.js dependencies + scripts
- `.env`: Optional environment variables (ADMIN_TOKEN, PORT, PUBLIC_BASE_URL) — not committed

**Core Logic:**
- `server.js`: All REST endpoints, database I/O, project isolation, temporal simulation
- `public/js/transitions.js`: Role-based router, access control, SPA transitions
- `public/js/dashboard.js`: HRBP dashboard + 7 tabs (KPIs, roadmap, coaching, culture, etc.)
- `public/js/employee.js`: Employee academy, progress tracking, gamification
- `public/js/admin.js`: Admin settings, demo/custom M&A mode toggle, project creation wizard
- `public/js/admin-cms.js`: CMS editors (courses, pages, menus, i18n, departments, processes, slides)

**Testing:**
- No test files present (no Jest/Vitest config); testing is manual via browser or Playwright

## Naming Conventions

**Files:**
- HTML pages: lowercase, no dash (e.g., `dashboard.html`, `employee.html`) — one page per major role/feature
- JavaScript: lowercase-dash for multi-word (e.g., `admin-cms.js`, `synergy-quest.js`)
- CSS: Single file `style.css` with nested component classes
- Service modules: camelCase (e.g., `aiService.js`, `ragService.js`)
- Database: `db.json` (always)

**Directories:**
- `public/`: Static assets only (no server code)
- `public/js/`: Frontend scripts (one per major feature + shared utilities)
- `public/css/`: Stylesheets
- `public/images/`: Images, logos, icons
- `public/playbook/`: PDF + guides
- `public/uploads/`: User-uploaded files (slides, media)
- `public/overview-deck/`: Slide deck HTML (separate from main pages)
- `public/vendor/`: Third-party vendored libraries

**CSS Class Naming (BEM-inspired):**
- Component: `.card`, `.btn`, `.dashboard-nav-btn`, `.slide-overlay`
- Modifier: `.btn-primary`, `.btn-secondary`, `.card-glass`, `.dashboard-nav-btn.active`
- Element: `.card-header`, `.btn-icon`, `.slide-overlay-bar`
- State: `.active`, `.disabled`, `.error`

**JavaScript Variable Naming:**
- Endpoints: `/api/{resource}` (e.g., `/api/projects`, `/api/courses/:id/lessons`)
- IDs: `prefix_<timestamp>_<random>` (e.g., `proj_1787654321abc`, `lesson_1787654321def`)
- DOM selectors: camelCase IDs (e.g., `#dashboard-target-name`, `#survey-target-sector-inline`)
- Event handlers: `on{Event}` (e.g., `onClick`, `onChange`)
- Fetch responses: Destructured per endpoint (e.g., `const { projects, activeProjectId } = await res.json()`)

**API Response Format:**
```javascript
// Success
{ success: true, resource: {...}, message?: "..." }
// Error
{ error: "Description", status?: 400 }
// List
{ items: [...], activeId?: "...", metadata?: {...} }
```

## Where to Add New Code

**New Feature (Page + Portal):**
- Primary code: `public/{feature}.html` (new HTML page) + `public/js/{feature}.js` (3-4KB script with event listeners + fetch calls)
- Tests: No test framework; manually verify in browser at http://localhost:3000/{feature}.html
- Styling: Add classes to `public/css/style.css` under a `/* {Feature Name} */` comment block
- Backend: Add REST endpoints to `server.js` (search for existing pattern, e.g., `/api/projects` at line 706)
- Access: Update page-access map in `public/js/transitions.js` (line 127–135) and link from index.html role grid (line 52–84)

**New Role/Portal:**
- Page: Copy `public/dashboard.html` → `public/{role}.html`, update role-specific sections
- Script: Copy `public/js/dashboard.js` → `public/js/{role}.js`, adapt tab structure
- CSS: Add role-specific classes to `public/css/style.css` (e.g., `.{role}-card`, `.{role}-container`)
- Router: Add entry to `public/js/transitions.js` (line 127–135 pageAccess + line 118–123 role detection)
- Landing: Add role card to `public/index.html` (line 52–84), update roleData object (line 132+)

**New Backend Resource (CMS, Admin CRUD):**
- Add GET endpoint: `app.get('/api/{resource}', (req, res) => { const db = readDb(); res.json(db.{resource} || []); })`
- Add POST endpoint: Validate body, upsert logic, call writeDb(db), return success + resource
- Add DELETE endpoint: Filter array, writeDb, return success
- Examples: `/api/departments` (line 783–815), `/api/processes` (line 824–856), `/api/slides` (line 863–909)
- Prefix with `/api/admin` if write-only or sensitive (e.g., `/api/admin/download-zip` line 264)

**New i18n String:**
- Add key to `db.json.i18n.strings.en` (e.g., `"dashboard.new_tab": "New Tab"`)
- Translate to all languages: `de`, `zh`, `cs` (POST `/api/i18n` or edit db.json directly)
- Use in DOM: `<h2 data-i18n="dashboard.new_tab">New Tab</h2>`
- Hydration: Global script (not shown) fills all `[data-i18n]` on page load

**New Modal or Overlay:**
- Follow pattern in `public/js/transitions.js` (playbook overlay line 43–70, HTML slide overlay line 75–109)
- Create DOM element, append to document.body
- Add close listener (Escape key + click outside)
- Example: `window.openPlaybookSlide(slideNum)` (line 43) or `window.openHtmlSlide(url, label)` (line 75)

**New Admin CMS Block Type:**
- Register in `page-layout.js` block registry (line ~50+, shows richtext/hero/cards/cta pattern)
- Add editor UI to `public/js/admin-cms.js` (search existing block editors)
- Add renderer in `public/js/page-layout.js` (renderBlock function, line ~80+)
- Example: Hero block (richtext + image), Card block (title + description), CTA block (button + link)

## Special Directories

**`public/uploads/`:**
- Purpose: User-uploaded files (HTML slides, media images, PDFs)
- Generated: Yes, at runtime via `/api/slides/upload` (line 894–909) and `/api/media` POST (line 1127–1148)
- Committed: No (`.gitignore` excludes `public/uploads/*`)
- Cleanup: Admin can delete files via DELETE endpoints; old files accumulate unless manually pruned

**`public/sent_emails/`:**
- Purpose: Archive of admin-sent communications (email snapshots saved as HTML files)
- Generated: Yes, when admin broadcasts a communication via `/api/communications`
- Committed: No (excluded by server.js download-zip exclude filter, line 272)
- Cleanup: Reset on `POST /api/settings/new-ma` (line 595–609); file glob pattern `comm_*.html`

**`node_modules/`:**
- Purpose: Vendored dependencies (committed, not fetched via npm install)
- Contents: express, compression, pdf-parse, @napi-rs/canvas (platform-specific)
- Committed: Yes (unusual but intentional; enables zero-install bundled release zips)
- Why: Release bundles ship portable Node.js runtime; installed modules included to avoid post-unzip npm install

**`.planning/codebase/`:**
- Purpose: Architecture + structure documentation (read-only, generated by `/gsd-map-codebase`)
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md
- Committed: Yes (reference for future work)
- Update: Manually by running `/gsd-map-codebase` after major changes

---

*Structure analysis: 2026-07-18*
