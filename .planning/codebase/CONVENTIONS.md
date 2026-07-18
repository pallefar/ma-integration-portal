# Coding Conventions

**Analysis Date:** 2026-07-18

## Naming Patterns

**Files:**
- JavaScript files: camelCase (e.g., `app.js`, `dashboard.js`, `transitions.js`, `banners.js`, `inline-edit.js`)
- HTML files: kebab-case (e.g., `admin.html`, `survey.html`, `employee.html`)
- Service modules: camelCase ending in "Service" (e.g., `aiService.js`, `ragService.js`)

**Functions:**
- camelCase, descriptive verb + noun pattern
- Examples: `rebuildQuestions()`, `updateSliderDisplay()`, `renderSurvey()`, `getSliderStatus()`, `openPlaybookSlide()`
- Async functions: same camelCase pattern (e.g., `generate100DayPlan()`)

**Variables:**
- camelCase for all local variables and parameters
- Descriptive names reflecting intent: `currentStep`, `questionsByDimension`, `loadingOverlay`, `fetchPromise`
- Boolean prefixes: `is`, `has`, `can`, `should` (e.g., `isEditMode`, `allAnswered`, `isAllowed`, `isPmoPage`)

**Constants:**
- UPPER_SNAKE_CASE for module-level constants
- Examples: `STOP_WORDS`, `ADMIN_TOKEN`, `PORT`, `PUBLIC_BASE_URL`, `DB_FILE`, `ICON`, `LANG_KEY`
- Long-lived API paths: UPPER_SNAKE_CASE (e.g., `CSP` for security headers)

**Database IDs and Keys:**
- Prefixed snake_case format: `{prefix}_{identifier}` or `{prefix}_{timestamp}_{hex}`
- Project IDs: `proj_demo`, `proj_*`
- Department IDs: `dept_sales`, `dept_product`, `dept_finance`
- Upload IDs: `upload_*` (collision-resistant: timestamp + random bytes)
- Lesson IDs: `l1_1`, `l1_2` (course_lesson pattern)
- Banner/storage keys: `banner_dismissed_{id}_r{revision}`

**HTML Element IDs:**
- kebab-case or camelCase for consistency
- Descriptive and functional: `dashboard-main-view`, `gauge-culture-fill`, `chk-local-hr-exists`
- Form inputs often use `chk-` prefix for checkboxes

**CSS Classes:**
- kebab-case: `page-banner`, `survey-question-box`, `slider-wrapper`, `edit-active-border`
- Modifier pattern: `{base}--{modifier}` (e.g., `page-banner--info`, `page-banner--warning`)
- State classes: `active`, `complete`, `pending`, `disabled`

## Code Style

**Formatting:**
- No automatic formatter configured (no Prettier, ESLint)
- 2-space indentation (observed in minified sections)
- Line length: variable (files up to 157KB committed)
- Semicolons: required at statement ends (CommonJS and client code)

**Linting:**
- No ESLint or formal linting setup
- Code follows implicit conventions observed across files
- Security comments inline (see "Comments" section)

**Import Organization:**

**Server-side (CommonJS):**
```javascript
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const compression = require('compression');
const aiService = require('./aiService');
const ragService = require('./ragService');
```
Order:
1. Node.js built-ins (fs, path, os, crypto)
2. Third-party packages (express, compression)
3. Local modules (aiService, ragService)

**Client-side:**
- No formal imports (vanilla JS, no module bundler)
- Files loaded via `<script>` tags in order of dependency
- Global namespace pollution accepted (window.* assignments)

**Path Aliases:**
- Not used; all requires are relative paths

## Error Handling

**Patterns:**
- Try/catch blocks for synchronous operations
- `.catch()` chains for Promise-based operations
- Two-tier logging: `console.error()` for internal errors, HTTP status codes for API responses

**Examples:**

```javascript
// Server-side: try/catch with error response
try {
  const data = fs.readFileSync(DB_FILE, 'utf8');
  const parsed = JSON.parse(data);
  return parsed;
} catch (error) {
  console.error('Error reading database file:', error);
  if (_dbCache) return _dbCache;  // Fallback to last good state
  throw new Error('db.json exists but could not be parsed; refusing to serve/overwrite it with an empty database.');
}

// Server-side: Promise chain with .catch()
fetch('/api/banners?slug=' + encodeURIComponent(slug))
  .then(r => r.json())
  .then(list => { cache = Array.isArray(list) ? list : []; render(cache); })
  .catch(() => {});  // Silent fail for non-critical banners

// Server-side: HTTP error responses
if (!fileName || !fileData) {
  return res.status(400).json({ success: false, error: 'Missing fileName or fileData' });
}
if (!response.ok) {
  const errText = await response.text();
  throw new Error(`Gemini API responded with status ${response.status}: ${errText}`);
}
```

**Fallback Strategy:**
- API failures gracefully degrade (e.g., Gemini API timeout → local expert engine)
- Missing database returns fresh skeleton rather than null
- Silent failures for non-critical data (banner loading)

**Error Logging:**
- `console.error()` for failures that halt execution or require action
- `console.warn()` for recoverable issues or security notes
- `console.log()` for informational messages (API calls, processing steps)

## Logging

**Framework:** `console` (native browser/Node.js)

**Patterns:**
- Informational: `console.log('Processing RAG PDF upload request: "${fileName}"...')`
- Warnings: `console.warn('[security] ADMIN_TOKEN not set — write/admin API endpoints are OPEN.')`
- Errors: `console.error('Error reading database file:', error)`
- Template strings with context included

**Levels:**
- `console.log()` - Processing steps, API calls, info
- `console.warn()` - Recoverable failures, security notes, missing optional config
- `console.error()` - Unrecoverable failures, exceptions

## Comments

**When to Comment:**
- JSDoc block at file header explaining module purpose and key concepts
- Inline comments above complex logic (security, performance, non-obvious algorithms)
- Inline comments explaining WHY, not WHAT (code should be self-documenting)

**File Header Pattern:**
```javascript
/**
 * TE Connectivity M&A Integration Portal — banners.js
 * Admin-configurable per-page / global notification & alert banners.
 * Loaded app-wide by transitions.js. Fetches /api/banners?slug=<page> (the server
 * filters by active + schedule window + page/global scope), then filters by role and
 * prior dismissal (localStorage), and mounts .page-banner elements at the top of the
 * main content. XSS-safe: title/message are set via textContent, never innerHTML.
 */
```

**Inline Comment Examples:**
```javascript
// Constant-time string comparison (hash to equal length first so timingSafeEqual
// never throws on mismatched lengths and the compare itself leaks no timing info).
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Never silently hand back an EMPTY database when a real db.json exists — the
// next writeDb() would then persist that empty skeleton over all the real data
// (permanent wipe). Prefer the last good in-memory copy; if there is none but a
// non-empty file is present, fail loudly so mutating endpoints 500 instead of
// clobbering.
```

**Security Comments:**
- Marked with `[security]` prefix
- Explain mitigation strategy, not just the risk
- Examples: CSP config, auth gates, XSS defenses, timing attacks

**JSDoc/TSDoc:**
- Not systematically used (no TypeScript)
- Function headers use plain comment blocks when significant
- No inline `@param`, `@return` tags observed

## Function Design

**Size:**
- Small utility functions: 5-20 lines (e.g., `pick()`, `roleOk()`, `getSliderStatus()`)
- Mid-sized handlers: 30-80 lines (e.g., `render()`, `updateGauge()`)
- Complex logic: split across multiple functions (e.g., survey rendering across `rebuildQuestions()`, `renderSurvey()`, `updateUI()`)

**Parameters:**
- Positional parameters for required args (1-3 typical)
- Object destructuring for config objects: `{ fileName, fileData } = req.body`
- No varargs (...args) observed; arrays used explicitly

**Return Values:**
- Explicit return statements; implicit `undefined` accepted for side-effect functions
- Falsy returns used to signal no-op (e.g., early returns in event handlers)
- Success/error objects for API responses: `{ success: true/false, data: ..., error: ... }`

**Async Functions:**
- `async`/`await` syntax used consistently in new code
- Promise chains (.then/.catch) used in legacy/simple paths
- Timeouts applied to external API calls:
  ```javascript
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),  // fail fast into fallback
    ...
  });
  ```

## Module Design

**Exports:**
- CommonJS on server: `module.exports = { functionName, anotherFunction };`
- Global window object on client: `window.openPlaybookSlide = openPlaybookSlide;`

**Pattern on Server (aiService.js):**
```javascript
// Single export with public API
async function generate100DayPlan({ targetCompany, scores, responses, questions, apiKey }) {
  // ...
}

// Fallback exported alongside
function generateLocalFallbackPlan(targetCompany, scores, responses, questions, ragSnippets) {
  // ...
}

// One export per module
module.exports = { generate100DayPlan, generateLocalFallbackPlan, /* other public functions */ };
```

**Barrel Files:**
- Not used; imports are direct

**IIFE Pattern (Client-side):**
- All client-side modules wrapped in `(function () { ... })()` to avoid global scope pollution
- Except where global API is intentional (e.g., `window.openPlaybookSlide = openPlaybookSlide;`)
- Example from `banners.js`:
  ```javascript
  (function () {
    if (window.__bannersLoaded) return;
    window.__bannersLoaded = true;
    // ... implementation ...
  })();
  ```

## State Management

**Client-side:**
- `localStorage` for persistent state (role, language, banners, edit mode, active assessment)
- `sessionStorage` for session-scoped state (dismissed banners, access denial messages)
- In-memory variables for page state (currentStep, responses, cache)
- No state management library (Redux, Zustand, etc.)

**Server-side:**
- In-memory cache with mtime invalidation (`_dbCache`, `_dbMtime`) for db.json
- Single source of truth: `db.json` file
- Atomic writes via temp file + rename to prevent corruption

**Data Persistence:**
```javascript
// Client: localStorage pattern
const LANG_KEY = 'employeeLanguage';
const getLang = () => localStorage.getItem(LANG_KEY) || 'en';

// Server: in-memory cache with file fallback
let _dbCache = null;
let _dbMtime = 0;
function readDb() {
  const mtime = fs.statSync(DB_FILE).mtimeMs;
  if (_dbCache && mtime === _dbMtime) return _dbCache;
  // ... reparse if file changed ...
}
```

## Security Patterns

**XSS Prevention:**
- Use `textContent` instead of `innerHTML` for user-controlled data
- Example: `el.textContent = title;` (never `el.innerHTML = title;`)
- URL validation before iframe assignment:
  ```javascript
  let safeUrl = '#';
  try {
    const u = new URL(url, window.location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = u.href;
  } catch (_) { safeUrl = '#'; }
  ```

**Authentication:**
- Header-only token passing: `X-Admin-Token` header (never query string)
- Timing-safe comparison using SHA-256 hash to fixed length
- Conditional gate: open in demo (no ADMIN_TOKEN set), required in production

**Secrets Management:**
- Secrets stripped from API responses before sending to client
- Example:
  ```javascript
  function publicSettings(s) {
    const out = { ...(s || {}) };
    out.hasGeminiApiKey = !!(out.geminiApiKey && String(out.geminiApiKey).trim());
    delete out.geminiApiKey;  // Never send API key to client
    return out;
  }
  ```

**Data Backup:**
- Rolling backup on every write: `db.json.bak` keeps last good state
- Atomic writes prevent truncation: write to `.tmp`, then rename

## API Response Format

**Consistent JSON Structure:**
```javascript
// Success
{ success: true, data: ..., results: ... }

// Error
{ success: false, error: 'Human-readable message' }

// API endpoint example
res.json({
  success: true,
  upload: newUpload,
  assessment: assessmentData
});
```

**HTTP Status Codes:**
- 200 OK - Success
- 400 Bad Request - Validation error
- 401 Unauthorized - Auth required
- 500 Internal Server Error - Server fault

---

*Convention analysis: 2026-07-18*
