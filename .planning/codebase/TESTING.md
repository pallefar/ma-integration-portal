# Testing Patterns

**Analysis Date:** 2026-07-18

## Test Framework

**Status:** No automated testing framework configured

**None Found:**
- No Jest, Vitest, Mocha, or other test runner in `package.json`
- No test configuration files (jest.config.js, vitest.config.ts, etc.)
- No test scripts in npm: package.json contains only `start` and `dev` scripts
- `dependencies`: compression, express, pdf-parse (no testing libraries)

**Result:** Testing is manual/browser-based only. There is no automated test suite.

## Test File Organization

**Current Structure:**
- No `.test.js` or `.spec.js` files found in the repository
- No `__tests__` directory
- No `tests/` or `test/` directory
- No fixtures or test helpers

**If Testing Were to be Added:**
- Recommended approach: co-locate with source files
  - `public/js/dashboard.js` → `public/js/dashboard.test.js`
  - `server.js` → `server.test.js` or `tests/server.test.js`
- Use Jest (default for Node.js projects) or Vitest (for ES modules + browser-like environments)

## Testing Approach

**Manual Testing Only:**
1. Browser-based testing of user interactions
2. Command-line verification of API endpoints (curl, Postman, or fetch)
3. Visual inspection of rendered output
4. Role-based access testing via localStorage role switching

**Verification Methods Observed in Code:**

**Server-side health check:**
```javascript
app.get('/healthz', (req, res) => {
  try { readDb(); res.json({ status: 'ok', ts: Date.now() }); }
  catch (e) { res.status(503).json({ status: 'degraded' }); }
});
```
Used for uptime monitoring — manually curl `/healthz` to verify service.

**Browser console logging:**
- Heavy use of `console.log()`, `console.error()`, `console.warn()`
- Manual inspection of browser console for errors during user workflows
- No test assertions or automated verification

**Example: RAG Upload Flow**
```javascript
console.log(`Processing RAG PDF upload request: "${fileName}"...`);
console.log(`Extracted ${pdfText.length} characters. Invoking AI Insight cognitive review...`);
console.log(`AI Insight review complete for "${fileName}". Dimension: ${review.dimension}. Chunks count: ${review.suggestedRags ? review.suggestedRags.length : 0}`);
```
Progress tracked via console output, not test assertions.

## Mocking

**Framework:** Not applicable (no testing framework)

**Fallback Strategy (Production Code):**
The codebase implements fallback behavior instead of mocking:

**Example: Gemini API Fallback**
```javascript
try {
  // Try live Gemini API with 15s timeout
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    ...
  });
  if (!response.ok) throw new Error(...);
  return result.candidates[0].content.parts[0].text;
} catch (error) {
  console.error("Gemini M&A Plan generation error:", error.message);
  console.log("Falling back to local expert engine...");
  return generateLocalFallbackPlan(targetCompany, scores, responses, questions, ragContext.snippets);
}
```

**What to Mock (if tests were added):**
- External APIs (Gemini, HuggingFace)
- File I/O (fs.readFileSync, fs.writeFileSync)
- Network calls (fetch)
- Environment variables (process.env.ADMIN_TOKEN, process.env.GEMINI_API_KEY)

**What NOT to Mock:**
- Core business logic (scoring, planning, RAG retrieval)
- Database operations (readDb, writeDb, newId)
- Role-based access control logic
- Security functions (timingSafeEqualStr)

## Fixtures and Factories

**No formal test fixtures or factories exist.**

**Seeded Demo Data Pattern (Production Substitute):**
The codebase uses seeded demo data instead of fixtures:

**Example: Department Seeding in readDb()**
```javascript
parsed.departments = parsed.departments || [
  { id: 'dept_sales', name: 'Sales & Pipelines', icon: '📈', locked: true, phase: 'Phase 2',
    desc: 'Standardize customer distribution channels, pricing structures, and CRM transfers.',
    systems: [ ... ], trainings: [ ... ] },
  { id: 'dept_product', name: 'Product & Tech Transfer', icon: '🔧', locked: true, phase: 'Phase 2', ... },
  { id: 'dept_finance', name: 'Finance & Reporting', icon: '💶', locked: true, phase: 'Phase 3', ... }
];
```

**Example: Time-Scaled Pulse Feedback (Dynamic Fixtures)**
```javascript
const pulseLibrary = {
  1: [
    { id: "p1", employeeName: "Alex Mercer", rating: 3, comment: "..." },
    { id: "p2", employeeName: "Sarah Connor", rating: 2, comment: "..." },
    ...
  ],
  30: [ ... ],
  60: [ ... ],
  90: [ ... ],
  100: [ ... ]
};

function getPulsesForDay(day) {
  const targetDay = day >= 100 ? 100 : day >= 90 ? 90 : ...;
  return pulseLibrary[targetDay];
}
```

**Test Data Location:**
- `db.json` - Primary persistent demo data
- In-memory constants in service modules (aiService.js, ragService.js)
- Seeding in readDb() for missing optional fields

## Coverage

**Coverage Requirements:** None enforced

**Reason:** No testing framework configured, so coverage cannot be measured.

**If Coverage Tools Were Added:**
- Recommended: Jest with `--coverage` flag
- Target: Aim for 80%+ on critical paths (auth, data persistence, API endpoints)
- Known gaps (if tests were written):
  - UI event handlers (dashboard.js, employee.js, admin.js)
  - Browser-specific APIs (localStorage, DOM manipulation)
  - Error paths in external API calls

## Test Types

**Unit Tests (if implemented):**
- Scope: Individual functions in isolation
- Approach: Test utility functions like `timingSafeEqualStr()`, `tokenize()`, `newId()`
- Example targets:
  - `ragService.js` tokenization and search ranking
  - `aiService.js` score analysis and categorization
  - `banners.js` role/language filtering logic

**Integration Tests (if implemented):**
- Scope: API endpoint + database interaction
- Approach: Make live requests to running server, verify state changes
- Critical paths to test:
  - POST /api/assessment → readDb/writeDb → file persisted
  - POST /api/rag/upload → PDF parsing + AI review + db.json update
  - GET /api/admin/download-zip → artifact generation without secrets

**E2E Tests:**
- Framework: Not configured (would use Playwright, Cypress)
- Recommended scope:
  - Full assessment flow (load → answer questions → submit → view dashboard)
  - Admin CRUD operations (create/edit/delete banners, processes, departments)
  - Role-based access control (login as different roles, verify page access)

## Common Patterns for Testing

If tests were to be added, follow these patterns from the codebase:

**Async Testing Pattern:**
```javascript
// Production code pattern (Promise chains)
fetch('/api/assessment')
  .then(res => res.json())
  .then(data => {
    if (!data.success || !data.assessment) {
      // No assessment taken yet
      mainView.style.display = 'none';
      return;
    }
    // Assessment found, populate dashboard
  })
  .catch(err => console.error("Error loading questions:", err));

// Test pattern (if Jest were available)
test('loads latest assessment and populates dashboard', async () => {
  const mockAssessment = { success: true, assessment: { ... } };
  global.fetch = jest.fn(() => Promise.resolve({ json: () => mockAssessment }));
  
  // Render component and wait for async load
  await screen.findByText('Culture (1/3)');  // Progress indicator updated
  
  expect(global.fetch).toHaveBeenCalledWith('/api/assessment/latest');
});
```

**Error Testing Pattern:**
```javascript
// Production fallback
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
} catch (error) {
  console.error("API call failed:", error.message);
  return generateLocalFallbackPlan(...);  // Graceful fallback
}

// Test pattern
test('falls back to local plan on API timeout', async () => {
  global.fetch = jest.fn(() => new Promise((_, reject) => 
    setTimeout(() => reject(new DOMException('timeout', 'AbortError')), 20)
  ));
  
  const plan = await generate100DayPlan({ ... });
  expect(plan).toContain('local expert engine');
});
```

**State Verification Pattern:**
```javascript
// Production code uses localStorage
localStorage.setItem('adminEditMode', 'true');
const isEditMode = localStorage.getItem('adminEditMode') === 'true';

// Test pattern (if Jest + jsdom available)
test('toggles edit mode state in localStorage', () => {
  localStorage.setItem('adminEditMode', 'true');
  expect(localStorage.getItem('adminEditMode')).toBe('true');
  
  localStorage.removeItem('adminEditMode');
  expect(localStorage.getItem('adminEditMode')).toBeNull();
});
```

## Running Tests (Future Setup)

**If Jest is added:**
```bash
npm install --save-dev jest @testing-library/dom
npm test                      # Run all tests
npm test -- --watch           # Watch mode
npm test -- --coverage        # Generate coverage report
```

**If Vitest is added (ES modules):**
```bash
npm install --save-dev vitest
npx vitest                    # Run with watch mode
npx vitest --coverage         # Coverage report
```

**Current Manual Testing:**
```bash
npm start                     # Start server on :3000
# Manually test in browser
curl http://localhost:3000/healthz  # Verify service is up
```

## Test Infrastructure Gaps

**Critical gaps (if tests were to be added):**

1. **No mocking library** - Would need jest.mock() or vi.mock() for external APIs
2. **No test database** - Tests would pollute production db.json; need isolated test fixture
3. **No test utilities** - No helpers for creating assessments, questions, employees
4. **No CI/CD test stage** - No GitHub Actions or similar to run tests on push
5. **No browser automation** - No Playwright/Cypress for E2E tests
6. **No performance testing** - No measurement of /api/assessment response time or RAG search speed

**Recommended additions:**
- Add jest.config.js for unit/integration testing
- Add playwright.config.js for E2E testing
- Add GitHub Actions workflow to run tests on PR
- Add test database fixture in `tests/fixtures/db.json.seed`
- Add test helpers in `tests/helpers/` (createAssessment, createQuestion, etc.)

---

*Testing analysis: 2026-07-18*
