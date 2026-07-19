const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const compression = require('compression');
const aiService = require('./aiService');
const ragService = require('./ragService');


const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(compression());

// --- Security response headers -----------------------------------------------
// Behaviour-preserving hardening: no dependency, applied to every response
// (static assets + API). The CSP keeps 'unsafe-inline'/'unsafe-eval' because the
// app relies on inline scripts/styles and the vendored Transformers.js WASM
// runtime; it still blocks external script injection, arbitrary data exfil
// (connect-src), object/embed, base-tag hijack, framing and form hijack.
app.disable('x-powered-by');
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://www.youtube.com https://youtube.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com https://*.huggingface.co",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com",
  "media-src 'self' blob: data: https://*.youtube.com",
  "worker-src 'self' blob:"
].join('; ');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // HSTS is only meaningful behind TLS (terminated by the reverse proxy in the
  // internal deployment); enable it explicitly so the plain-HTTP local demo is
  // unaffected.
  if (process.env.ENABLE_HSTS === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// The app now starts on the M&A HR Integration Enablement overview (the executive
// slide deck embedded as an app page). The role-based showcase stays at /index.html,
// one click away via the overview's "Enter the Portal" CTA. Registered BEFORE the
// static middleware so it wins for exactly "/" (static's default would serve index.html).
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'overview.html'));
});

// Long-cache versioned static assets (JS/CSS/images already carry ?v= busting);
// always revalidate HTML so users never get a stale page pointing at old assets.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.wasm$/i.test(filePath)) {
      // Vendored Transformers.js ONNX runtime — needs the application/wasm MIME for
      // streaming compilation, and is safe to long-cache (versioned by vendor bump).
      res.setHeader('Content-Type', 'application/wasm');
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (/\.(js|css|png|jpe?g|svg|webp|ico|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    } else if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// --- Optional admin auth gate ------------------------------------------------
// Production locks down every state-changing endpoint (POST/PUT/DELETE) and the
// /api/admin/* routes behind a shared secret. Set ADMIN_TOKEN in the environment
// to enable it; when unset (e.g. the local demo) the gate stays OPEN but logs a
// warning, so the running demo is unaffected until you set the env var. The admin
// browser UI sends the secret via the X-Admin-Token header (fetch bridge in transitions.js).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
if (!ADMIN_TOKEN) {
  console.warn('[security] ADMIN_TOKEN not set — write/admin API endpoints are OPEN. Set ADMIN_TOKEN in production to require authentication.');
}
// Constant-time string comparison (hash to equal length first so timingSafeEqual
// never throws on mismatched lengths and the compare itself leaks no timing info).
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
app.use('/api', (req, res, next) => {
  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  const isAdminPath = req.path.startsWith('/admin'); // /api/admin/* (download-zip, migrate-db)
  if (!isWrite && !isAdminPath) return next();        // public read-only GETs stay open (visitor demo)
  if (!ADMIN_TOKEN) return next();                    // dev/demo: no token configured -> open
  // Header only — never accept the secret via query string (it would leak into
  // access logs, proxies and browser history). Constant-time compare over fixed
  // -length SHA-256 digests so the token can't be guessed via a timing side channel.
  const supplied = req.get('X-Admin-Token') || '';
  if (supplied && timingSafeEqualStr(supplied, ADMIN_TOKEN)) return next();
  return res.status(401).json({ error: 'Admin authentication required. Provide a valid X-Admin-Token.' });
});

// Lightweight health check for uptime monitors and platform probes
app.get('/healthz', (req, res) => {
  try { readDb(); res.json({ status: 'ok', ts: Date.now() }); }
  catch (e) { res.status(503).json({ status: 'degraded' }); }
});

// Helper functions for database I/O
// In-memory cache keyed on file mtime: a single page load fires ~30 read requests;
// re-parsing the ~300KB db.json each time is wasteful. Re-read only when the file changes.
let _dbCache = null;
let _dbMtime = 0;

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { settings: { geminiApiKey: "", targetCompany: "NewCo Ltd." }, questions: [], assessments: [], modules: [], employees: [], hrbps: [], alerts: [], pulses: [] };
    }
    const mtime = fs.statSync(DB_FILE).mtimeMs;
    if (_dbCache && mtime === _dbMtime) return _dbCache;
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(data);
    parsed.settings = parsed.settings || {};
    parsed.customSettings = parsed.customSettings || {};
    parsed.questions = parsed.questions || [];
    parsed.assessments = parsed.assessments || [];
    parsed.modules = parsed.modules || [];
    parsed.employees = parsed.employees || [];
    parsed.hrbps = parsed.hrbps || [];
    parsed.alerts = parsed.alerts || [];
    parsed.pulses = parsed.pulses || [];
    parsed.ragUploads = parsed.ragUploads || [];
    parsed.courses = parsed.courses || [];
    parsed.pages = parsed.pages || [];
    parsed.media = parsed.media || [];
    parsed.banners = parsed.banners || [];
    parsed.i18n = parsed.i18n || { languages: [{ code: 'en', label: 'English', flag: '🇬🇧', enabled: true }], defaultLang: 'en', strings: { en: {} } };
    parsed.menus = parsed.menus || { sidebar: [], groups: [], landingCards: [], bookmarks: [] };
    // Quick-Nav bookmarks (admin-authored page+section shortcuts) live inside menus,
    // so they ride the per-project cms bundle automatically.
    parsed.menus.bookmarks = parsed.menus.bookmarks || [];
    // Projects = top of the M&A hierarchy. The seeded demo is always project "proj_demo".
    parsed.projects = parsed.projects || [];
    if (!parsed.projects.some(p => p.id === 'proj_demo')) {
      const s = parsed.settings || {};
      parsed.projects.unshift({
        id: 'proj_demo', isDemo: true,
        name: s.targetCompany || 'NextGen Sensors Ltd.',
        targetCompany: s.targetCompany || 'NextGen Sensors Ltd.',
        sector: s.sector || '', size: s.size || '', hq: s.hq || '',
        acquisitionDate: s.acquisitionDate || '', synergyObjective: s.synergyObjective || '',
        intake: {}, createdAt: '2026-01-01T00:00:00.000Z'
      });
    }
    parsed.activeProjectId = parsed.activeProjectId || 'proj_demo';
    // Department modules = the functional integration tracks. Culture & Communication
    // are SHARED across all departments; only Systems & Trainings differ per department.
    parsed.departments = parsed.departments || [
      { id: 'dept_sales', name: 'Sales & Pipelines', icon: '📈', locked: true, phase: 'Phase 2',
        desc: 'Standardize customer distribution channels, pricing structures, and CRM transfers.',
        systems: [ { title: 'CRM Migration', desc: 'Consolidate the legacy CRM into TE Salesforce.' }, { title: 'Pricing Harmonization', desc: 'Align pricing books and quote-to-cash flows.' } ],
        trainings: [ { title: 'TE Sales Playbook', desc: 'Commercial process and tooling onboarding.' }, { title: 'Pipeline Hygiene', desc: 'Forecasting discipline and CRM data quality.' } ] },
      { id: 'dept_product', name: 'Product & Tech Transfer', icon: '🔧', locked: true, phase: 'Phase 2',
        desc: 'Migrate engineering documents, shared patents, and synchronize catalog parts directories.',
        systems: [ { title: 'PLM Integration', desc: 'Merge product-lifecycle and BOM systems.' }, { title: 'Catalog Sync', desc: 'Unify part numbering and product catalogs.' } ],
        trainings: [ { title: 'Engineering Standards', desc: 'TE design and documentation standards.' }, { title: 'IP & Patents', desc: 'Handling shared patents and IP transfer.' } ] },
      { id: 'dept_finance', name: 'Finance & Reporting', icon: '💶', locked: true, phase: 'Phase 3',
        desc: 'Harmonize fiscal accounts, tax structures, and migrate to TE Connectivity accounting ERPs.',
        systems: [ { title: 'ERP Migration', desc: 'Cut over to the TE accounting ERP.' }, { title: 'Chart of Accounts', desc: 'Map the legacy CoA to the TE standard.' } ],
        trainings: [ { title: 'Financial Controls', desc: 'SOX and TE reporting compliance.' }, { title: 'Close Process', desc: 'Monthly close and consolidation.' } ] }
    ];
    // Per-project process catalog (Sending org → Receiving org). Lives in the cms
    // bundle so it swaps on project switch, exactly like `departments`.
    parsed.processCatalog = parsed.processCatalog || [];
    // Admin-authored HTML slide launchers (project-scoped via the cms bundle).
    parsed.slides = parsed.slides || [];
    // Assessment Suite v2: templates are per-project CMS content; instances are
    // workspace data with the same demo/custom lane split as `assessments`.
    parsed.assessmentTemplates = parsed.assessmentTemplates || [];
    parsed.assessmentInstances = parsed.assessmentInstances || [];
    parsed.customAssessmentInstances = parsed.customAssessmentInstances || [];
    // Execution engine: checklist templates ride the cms bundle; live tasks are
    // lane-split workspace data like assessment instances.
    parsed.checklistTemplates = parsed.checklistTemplates || [];
    parsed.integrationTasks = parsed.integrationTasks || [];
    parsed.customIntegrationTasks = parsed.customIntegrationTasks || [];
    // Synergy tracker + RAID log — lane-split workspace data.
    parsed.synergyInitiatives = parsed.synergyInitiatives || [];
    parsed.customSynergyInitiatives = parsed.customSynergyInitiatives || [];
    parsed.raidEntries = parsed.raidEntries || [];
    parsed.customRaidEntries = parsed.customRaidEntries || [];
    _dbCache = parsed;
    _dbMtime = mtime;
    return parsed;
  } catch (error) {
    console.error('Error reading database file:', error);
    // Never silently hand back an EMPTY database when a real db.json exists — the
    // next writeDb() would then persist that empty skeleton over all the real data
    // (permanent wipe). Prefer the last good in-memory copy; if there is none but a
    // non-empty file is present, fail loudly so mutating endpoints 500 instead of
    // clobbering. Only fall back to a fresh skeleton when there is genuinely no data.
    if (_dbCache) return _dbCache;
    try {
      if (fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0) {
        throw new Error('db.json exists but could not be parsed; refusing to serve/overwrite it with an empty database.');
      }
    } catch (guardErr) {
      if (/refusing to serve/.test(guardErr.message)) throw guardErr;
    }
    return { settings: { geminiApiKey: "", targetCompany: "NewCo Ltd." }, questions: [], assessments: [], modules: [], employees: [], hrbps: [], alerts: [], pulses: [] };
  }
}

function writeDb(data) {
  // Best-effort rolling backup of the last good file before we overwrite it, so a
  // bad/truncated write or an accidental destructive call can be recovered from
  // db.json.bak. (For production, pair this with a scheduled off-box snapshot.)
  try {
    if (fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0) {
      fs.copyFileSync(DB_FILE, DB_FILE + '.bak');
    }
  } catch (e) { console.warn('db backup skipped:', e && e.message); }
  try {
    // Atomic write: serialize to a temp file, then rename over the real file.
    // rename() is atomic on the same filesystem, so a crash mid-write can never
    // leave db.json truncated/half-written (which would corrupt the whole DB).
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
    _dbCache = data;
    _dbMtime = fs.statSync(DB_FILE).mtimeMs;
    return true;
  } catch (error) {
    console.error('Error writing to database file:', error);
    // Surface the failure so Express returns a 500 via the error middleware,
    // instead of silently returning a falsy value that nearly every caller
    // ignores and then answers HTTP 200 on data that was never persisted.
    throw new Error('Failed to persist database');
  }
}

// Collision-resistant id: time-sortable base36 timestamp + random suffix. Two
// creates in the same millisecond used to mint identical `prefix_<Date.now()>`
// ids, which then corrupted each other on find/delete-by-id.
function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// Strip server-only secrets from any settings object before returning it to a
// client. The real API key / DB connection string must never leave the server;
// the client only needs to know WHETHER a key is configured.
function publicSettings(s) {
  const out = { ...(s || {}) };
  out.hasGeminiApiKey = !!(out.geminiApiKey && String(out.geminiApiKey).trim());
  delete out.geminiApiKey;
  if (out.databaseConfig && out.databaseConfig.connectionDetails) {
    out.databaseConfig = { ...out.databaseConfig };
    delete out.databaseConfig.connectionDetails;
  }
  return out;
}

// REST API Endpoints

// GET Portable Application Package Download (Dynamic ZIP creation)
app.get('/api/admin/download-zip', (req, res) => {
  try {
    const { execSync } = require('child_process');
    // Build the archive in the OS temp dir — NOT under public/, which express.static
    // would otherwise serve at /ma-app.zip to anyone. Exclude everything holding data
    // or secrets (db.json = API key + all records; .env; sent_emails). The downloaded
    // package boots with a fresh database. The temp file is deleted after sending.
    const zipPath = path.join(os.tmpdir(), `ma-app-${Date.now()}.zip`);
    execSync(`zip -r "${zipPath}" . -x "node_modules/*" ".git/*" ".gemini/*" "public/ma-app.zip" "ma-portal.zip" "looxmaxing/*" ".playwright-mcp/*" ".DS_Store" "*/.DS_Store" "db.json" "db.json.tmp" "db.json.bak" ".env" ".env.*" "public/sent_emails/*" "sent_emails/*"`, { cwd: __dirname });

    res.download(zipPath, 'te-ma-integration-portal.zip', (err) => {
      if (err) console.error('Error sending zip file to browser:', err);
      fs.unlink(zipPath, () => {}); // clean up the temp archive regardless
    });
  } catch (error) {
    console.error('Error generating zip archive dynamically:', error);
    res.status(500).json({ error: 'Failed to compile and zip the application package. Please ensure zip utility is available.' });
  }
});


// GET RAG Search of Playbook Snippets
app.get('/api/rag/search', (req, res) => {
  const query = req.query.q || '';
  try {
    const results = ragService.searchPlaybook(query, 3);
    res.json({ success: true, query, results });
  } catch (error) {
    console.error('Error during backend RAG search:', error);
    res.status(500).json({ success: false, error: 'Failed to search playbook database.' });
  }
});

// POST AI Model RAG PDF Training Upload & AI Insight Review
app.post('/api/rag/upload', async (req, res) => {
  try {
    const { fileName, fileData } = req.body;
    if (!fileName || !fileData) {
      return res.status(400).json({ success: false, error: 'Missing fileName or fileData' });
    }

    console.log(`Processing RAG PDF upload request: "${fileName}"...`);

    // Decode Base64 string
    const base64Data = fileData.replace(/^data:application\/pdf;base64,/, "");
    const pdfBuffer = Buffer.from(base64Data, 'base64');

    // Parse plain text from PDF (pdf-parse v2 class API)
    const { PDFParse } = require('pdf-parse');
    const pdfParser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
    const parsedPdf = await pdfParser.getText();
    const pdfText = parsedPdf.text || '';

    if (pdfText.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Could not extract any plain text from the uploaded PDF.' });
    }

    console.log(`Extracted ${pdfText.length} characters. Invoking AI Insight cognitive review...`);

    // Get current settings to retrieve the active Gemini API Key
    const db = readDb();
    const apiKey = db.settings.geminiApiKey || '';

    // Invoke AI Insight cognitive review
    const review = await aiService.reviewPdfContent({ pdfText, fileName, apiKey });

    console.log(`AI Insight review complete for "${fileName}". Dimension: ${review.dimension}. Chunks count: ${review.suggestedRags ? review.suggestedRags.length : 0}`);

    // Persist finding blocks to db.json
    db.ragUploads = db.ragUploads || [];
    const newUpload = {
      id: newId('upload'),
      fileName: fileName,
      summary: review.summary || '',
      dimension: review.dimension || 'General Compliance',
      keyFindings: review.keyFindings || [],
      suggestedRags: review.suggestedRags || [],
      timestamp: new Date().toISOString()
    };
    db.ragUploads.push(newUpload);
    writeDb(db);

    // Retrain memory RAG model instantly
    ragService.initializeRAG();

    res.json({
      success: true,
      upload: newUpload
    });
  } catch (error) {
    console.error('Error handling RAG PDF upload:', error);
    res.status(500).json({ success: false, error: 'Failed to process and train RAG model.' });
  }
});

// Ordered list of real lesson IDs from the course catalog (drives consistent
// time-travel seeding so scaled progress matches actual lessons).
function getCatalogLessonIds(db) {
  const ids = [];
  (db.courses || []).forEach(c => (c.modules || []).forEach(m => (m.lessons || []).forEach(l => ids.push(l.id))));
  // Fallback to the legacy 9-lesson set if the catalog is empty
  return ids.length ? ids : ['l1_1', 'l1_2', 'l1_3', 'l2_1', 'l2_2', 'l2_3', 'l3_1', 'l3_2', 'l3_3'];
}

// Helper for temporal employee scaling
function scaleEmployeesForDay(employees, day, lessonIds) {
  const pool = (lessonIds && lessonIds.length) ? lessonIds : ['l1_1', 'l1_2', 'l1_3', 'l2_1', 'l2_2', 'l2_3', 'l3_1', 'l3_2', 'l3_3'];
  const total = pool.length;
  return employees.map(emp => {
    const cloned = { ...emp };
    cloned.completedLessons = cloned.completedLessons || [];
    cloned.bonusPoints = cloned.bonusPoints || 0;

    if (day === 1) {
      cloned.completedLessons = [];
      cloned.bonusPoints = 0;
      cloned.points = 0;
      cloned.badge = "New Recruit";
    } else if (day === 30) {
      const n = Math.min(((cloned.name || '?').charCodeAt(0) % 2) + 1, total);
      cloned.completedLessons = pool.slice(0, n);
      cloned.points = cloned.completedLessons.length * 20 + Math.min(cloned.bonusPoints, 10);
      cloned.badge = calculateBadge(cloned.completedLessons.length);
    } else if (day === 60) {
      const n = Math.min(((cloned.name || '?').charCodeAt(0) % 3) + 3, total);
      cloned.completedLessons = pool.slice(0, n);
      cloned.points = cloned.completedLessons.length * 20 + Math.min(cloned.bonusPoints, 20);
      cloned.badge = calculateBadge(cloned.completedLessons.length);
    } else if (day === 90) {
      const n = Math.min(((cloned.name || '?').charCodeAt(0) % 3) + 6, total);
      cloned.completedLessons = pool.slice(0, n);
      cloned.points = cloned.completedLessons.length * 20 + Math.min(cloned.bonusPoints, 30);
      cloned.badge = calculateBadge(cloned.completedLessons.length);
    } else if (day >= 100) {
      cloned.completedLessons = pool.slice();
      cloned.points = total * 20 + cloned.bonusPoints;
      cloned.badge = "Ultimate Integrator";
    }
    return cloned;
  });
}

// Helper for temporal pulses feedback
function getPulsesForDay(day) {
  const pulseLibrary = {
    1: [
      { id: "p1", employeeName: "Alex Mercer", rating: 3, comment: "Excited but curious how TE systems will align with ours.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p2", employeeName: "Sarah Connor", rating: 2, comment: "Concerned about R&D patent pipeline migrations. Need more clear directives.", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p3", employeeName: "Michael Scott", rating: 3, comment: "Will we get new email logins on Day 1? Communication could be clearer.", timestamp: "2026-05-21T10:30:00Z" }
    ],
    30: [
      { id: "p4", employeeName: "Alex Mercer", rating: 4, comment: "SSO accounts are synced! Love the personalized portal.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p5", employeeName: "Sarah Connor", rating: 3, comment: "HR training was standard, just got my first Culture Champion badge!", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p6", employeeName: "Michael Scott", rating: 4, comment: "Nice town-hall sync last week. Payroll mapping is feeling steady.", timestamp: "2026-05-21T10:30:00Z" }
    ],
    60: [
      { id: "p7", employeeName: "Alex Mercer", rating: 4, comment: "IT credentials mapping is fully complete. Zero access delays.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p8", employeeName: "Sarah Connor", rating: 4, comment: "The peer group alignment has been really transparent. Great teamwork.", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p9", employeeName: "Michael Scott", rating: 4, comment: "Standard benefits migration went through flawlessly this week.", timestamp: "2026-05-21T10:30:00Z" }
    ],
    90: [
      { id: "p10", employeeName: "Alex Mercer", rating: 5, comment: "Standard playbook links are working beautifully. Outstanding documentation.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p11", employeeName: "Sarah Connor", rating: 4, comment: "Retention contract alignment was very reassuring. Happy to stay with TE.", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p12", employeeName: "Michael Scott", rating: 5, comment: "Fully aligned with our core values of accountability and innovation.", timestamp: "2026-05-21T10:30:00Z" }
    ],
    100: [
      { id: "p13", employeeName: "Alex Mercer", rating: 5, comment: "Outstanding M&A process, 5 stars! The best integration journey I've experienced.", timestamp: "2026-05-21T08:00:00Z" },
      { id: "p14", employeeName: "Sarah Connor", rating: 5, comment: "Full synergy capture achieved seamlessly! Excited for the future.", timestamp: "2026-05-21T09:15:00Z" },
      { id: "p15", employeeName: "Michael Scott", rating: 5, comment: "Felt extremely welcomed from Day 1 to Day 100! Complete organizational harmony.", timestamp: "2026-05-21T10:30:00Z" }
    ]
  };
  
  const targetDay = day >= 100 ? 100 : day >= 90 ? 90 : day >= 60 ? 60 : day >= 30 ? 30 : 1;
  return pulseLibrary[targetDay];
}

// Helper for temporal diagnostic scores scaling
function getScaledScores(latestScores, day) {
  if (!latestScores) {
    latestScores = { culture: 3.2, talent: 3.5, value: 3.0 };
  }
  if (day === 1) {
    return { culture: 2.0, talent: 2.2, value: 2.5 };
  } else if (day === 30) {
    return {
      culture: Math.min(Math.max(latestScores.culture, 3.0), 3.8),
      talent: Math.min(Math.max(latestScores.talent, 3.2), 4.0),
      value: Math.min(Math.max(latestScores.value, 3.0), 4.0)
    };
  } else if (day === 60) {
    return {
      culture: parseFloat(Math.min(Math.max(latestScores.culture * 1.15, 3.8), 4.5).toFixed(2)),
      talent: parseFloat(Math.min(Math.max(latestScores.talent * 1.15, 4.0), 4.5).toFixed(2)),
      value: parseFloat(Math.min(Math.max(latestScores.value * 1.15, 4.0), 4.6).toFixed(2))
    };
  } else if (day === 90) {
    return {
      culture: parseFloat(Math.min(Math.max(latestScores.culture * 1.3, 4.3), 4.8).toFixed(2)),
      talent: parseFloat(Math.min(Math.max(latestScores.talent * 1.3, 4.5), 4.8).toFixed(2)),
      value: parseFloat(Math.min(Math.max(latestScores.value * 1.3, 4.5), 4.9).toFixed(2))
    };
  } else {
    return { culture: 5.0, talent: 5.0, value: 5.0 };
  }
}

// POST Time Travel (Temporal Timeline Switch)
app.post('/api/settings/time-travel', (req, res) => {
  const { day } = req.body;
  if (day === undefined) {
    return res.status(400).json({ error: 'Timeline day is required.' });
  }
  
  const parsedDay = parseInt(day) || 30;
  const db = readDb();
  db.settings = db.settings || {};
  db.settings.timeTravelDay = parsedDay;
  if (db.customSettings) {
    db.customSettings.timeTravelDay = parsedDay;
  }
  writeDb(db);
  
  res.json({ success: true, timeTravelDay: parsedDay });
});

// POST Reorder Survey Questions
app.post('/api/questions/reorder', (req, res) => {
  const { questionIds } = req.body;
  if (!Array.isArray(questionIds)) {
    return res.status(400).json({ error: 'questionIds array is required.' });
  }
  
  const db = readDb();
  const questionsMap = {};
  db.questions.forEach(q => {
    questionsMap[q.id] = q;
  });
  
  const reordered = [];
  questionIds.forEach(id => {
    if (questionsMap[id]) {
      reordered.push(questionsMap[id]);
    }
  });
  
  db.questions.forEach(q => {
    if (!questionIds.includes(q.id)) {
      reordered.push(q);
    }
  });
  
  db.questions = reordered;
  writeDb(db);
  
  res.json({ success: true, questions: db.questions });
});

// POST Reorder Dashboard Widgets
app.post('/api/dashboard/reorder-widgets', (req, res) => {
  const { layoutOrder } = req.body;
  if (!Array.isArray(layoutOrder)) {
    return res.status(400).json({ error: 'layoutOrder array is required.' });
  }
  
  const db = readDb();
  db.settings = db.settings || {};
  db.settings.dashboardLayoutOrder = layoutOrder;
  writeDb(db);
  
  res.json({ success: true, dashboardLayoutOrder: layoutOrder });
});

// GET Settings
app.get('/api/settings', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    // Merge base settings under custom overrides so custom mode still exposes
    // shared fields (targetCompany, roleVisibility, ...) instead of a sparse object.
    const custom = { ...(db.settings || {}), ...(db.customSettings || {}), demoMode: false };
    custom.timeTravelDay = custom.timeTravelDay !== undefined ? custom.timeTravelDay : (db.settings.timeTravelDay || 30);
    res.json(publicSettings(custom));
  } else {
    res.json(publicSettings(db.settings || {}));
  }
});

// POST Settings
app.post('/api/settings', (req, res) => {
  const db = readDb();
  db.settings = db.settings || {};
  
  if (req.body.demoMode !== undefined) {
    db.settings.demoMode = req.body.demoMode === true || req.body.demoMode === 'true';
    if (db.settings.demoMode === false && !db.customSettings) {
      db.customSettings = { demoMode: false };
    }
    writeDb(db);
    return res.json({ success: true, settings: publicSettings(db.settings.demoMode ? db.settings : db.customSettings) });
  }

  // Copy incoming keys, but NEVER overwrite a stored API key with a blank value —
  // the client sends the field empty when it hasn't been re-entered (the real key
  // is no longer sent to the browser), so a blank means "leave it unchanged".
  const applySettings = (target) => {
    Object.keys(req.body).forEach(key => {
      if (key === 'geminiApiKey' && !String(req.body[key] || '').trim()) return;
      target[key] = req.body[key];
    });
  };

  if (db.settings.demoMode === false) {
    db.customSettings = db.customSettings || { demoMode: false };
    applySettings(db.customSettings);
  } else {
    applySettings(db.settings);
  }

  writeDb(db);
  res.json({ success: true, settings: publicSettings(db.settings.demoMode === false ? db.customSettings : db.settings) });
});

// POST Reset Custom M&A Wizard state
app.post('/api/settings/new-ma', (req, res) => {
  const db = readDb();
  db.customSettings = { demoMode: false };
  db.customEmployees = [];
  db.customHrbps = [];
  db.customAssessments = [];
  db.customAlerts = [];
  db.customCommunications = [];
  db.customAssessmentInstances = [];
  db.customIntegrationTasks = [];
  db.customSynergyInitiatives = [];
  db.customRaidEntries = [];
  
  // Wipe custom physical emails
  const emailDir = path.join(__dirname, 'public', 'sent_emails');
  if (fs.existsSync(emailDir)) {
    try {
      const files = fs.readdirSync(emailDir);
      files.forEach(file => {
        if (file.startsWith('comm_')) {
          fs.unlinkSync(path.join(emailDir, file));
        }
      });
    } catch (e) {
      console.warn("Could not wipe custom physical emails:", e);
    }
  }

  writeDb(db);
  res.json({ success: true, message: 'Custom M&A successfully reset.' });
});

// =====================================================================
// Projects — top of the M&A hierarchy (admin sets up each acquisition)
// =====================================================================
function findProject(db, id) { return (db.projects || []).find(p => p.id === id); }

// --- Per-project data isolation (phase 2) ---
// Each custom project owns its full workspace bundle (roster/assessment/leaders/comms/
// settings). The demo project uses the top-level demo collections and is never bundled.
function saveCustomLaneToProject(db, project) {
  if (!project) return;
  // The demo project is normally never bundled. EXCEPTION: if the app is in
  // Custom-M&A mode (demoMode:false) while the demo is still the active project, the
  // live custom collections belong to no project — persist them onto the demo's data
  // bundle so creating/switching a project can't silently wipe them (regression F1).
  const inCustomModeOnDemo = project.isDemo && db.settings && db.settings.demoMode === false && db.activeProjectId === project.id;
  if (project.isDemo && !inCustomModeOnDemo) return;
  project.data = {
    settings: db.customSettings || { demoMode: false },
    employees: db.customEmployees || [],
    hrbps: db.customHrbps || [],
    assessments: db.customAssessments || [],
    alerts: db.customAlerts || [],
    communications: db.customCommunications || [],
    assessmentInstances: db.customAssessmentInstances || [],
    integrationTasks: db.customIntegrationTasks || [],
    synergyInitiatives: db.customSynergyInitiatives || [],
    raidEntries: db.customRaidEntries || []
  };
}

// Load a project's bundle into the live custom lane. Intake fields always win for the
// company identity so switching visibly re-scopes the app to the acquired company.
function loadProjectIntoCustomLane(db, project) {
  const d = project.data || {};
  db.customSettings = {
    ...(d.settings || {}), demoMode: false,
    targetCompany: project.targetCompany, sector: project.sector, size: project.size,
    hq: project.hq, acquisitionDate: project.acquisitionDate, synergyObjective: project.synergyObjective
  };
  db.customEmployees = d.employees || [];
  db.customHrbps = d.hrbps || [];
  db.customAssessments = d.assessments || [];
  db.customAlerts = d.alerts || [];
  db.customCommunications = d.communications || [];
  db.customAssessmentInstances = d.assessmentInstances || [];
  db.customIntegrationTasks = d.integrationTasks || [];
  db.customSynergyInitiatives = d.synergyInitiatives || [];
  db.customRaidEntries = d.raidEntries || [];
}

// Persist whatever the live custom lane currently holds back to whichever custom
// project is active, so its in-progress work isn't lost when we switch away.
function stashActiveCustomProject(db) {
  const current = findProject(db, db.activeProjectId);
  // saveCustomLaneToProject() is a no-op for the demo project unless we're in
  // Custom-M&A mode with it active (see F1 guard there), so this is safe to call
  // unconditionally and preserves an orphaned custom lane before it gets overwritten.
  if (current) saveCustomLaneToProject(db, current);
}

// --- Per-project CMS content isolation (phase 3) ---
// The top-level courses/pages/menus/banners/departments ARE the ACTIVE project's live CMS.
// Each project (demo included) owns a `cms` snapshot; activate/create swaps it in/out.
// This keeps every CMS endpoint unchanged. i18n UI strings + media stay app-wide shared.
function snapshotCms(db) {
  const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));
  return {
    courses: clone(db.courses || []),
    pages: clone(db.pages || []),
    menus: clone(db.menus || { sidebar: [], groups: [], landingCards: [] }),
    banners: clone(db.banners || []),
    departments: clone(db.departments || []),
    processCatalog: clone(db.processCatalog || []),
    slides: clone(db.slides || []),
    assessmentTemplates: clone(db.assessmentTemplates || []),
    checklistTemplates: clone(db.checklistTemplates || [])
  };
}
function applyCmsToTopLevel(db, cms) {
  if (!cms) return;
  db.courses = cms.courses || [];
  db.pages = cms.pages || [];
  db.menus = cms.menus || { sidebar: [], groups: [], landingCards: [] };
  db.banners = cms.banners || [];
  db.departments = cms.departments || [];
  db.processCatalog = cms.processCatalog || [];
  db.slides = cms.slides || [];
  db.assessmentTemplates = cms.assessmentTemplates || [];
  db.checklistTemplates = cms.checklistTemplates || [];
}
// Save the live CMS back to whichever project is active (demo included) before switching.
function stashActiveProjectCms(db) {
  const cur = findProject(db, db.activeProjectId);
  if (cur) cur.cms = snapshotCms(db);
}
function loadProjectCms(db, project) {
  if (project && project.cms) applyCmsToTopLevel(db, project.cms);
}
// A new acquisition starts from the demo's default CMS structure, then tailors it.
function defaultCms(db) {
  const demo = findProject(db, 'proj_demo');
  return (demo && demo.cms) ? JSON.parse(JSON.stringify(demo.cms)) : snapshotCms(db);
}

app.get('/api/projects', (req, res) => {
  const db = readDb();
  // Strip the heavy per-project data + cms bundles from the list response.
  const list = (db.projects || []).map(({ data, cms, ...meta }) => meta);
  res.json({ projects: list, activeProjectId: db.activeProjectId || 'proj_demo' });
});

// Create a new acquisition project from the admin intake wizard (activates it).
app.post('/api/projects', (req, res) => {
  const db = readDb();
  const b = req.body || {};
  const name = String(b.name || b.targetCompany || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name / target company is required.' });
  const project = {
    id: newId('proj'), isDemo: false, name,
    targetCompany: String(b.targetCompany || name).trim(),
    sector: b.sector || '', size: b.size || '', hq: b.hq || '',
    acquisitionDate: b.acquisitionDate || '', synergyObjective: b.synergyObjective || '',
    intake: b.intake || {}, createdAt: new Date().toISOString(),
    data: { settings: { demoMode: false }, employees: [], hrbps: [], assessments: [], alerts: [], communications: [], assessmentInstances: [], integrationTasks: [], synergyInitiatives: [], raidEntries: [] }
  };
  db.projects = db.projects || [];
  // Preserve the currently-active project's work & CMS before switching to the new one.
  stashActiveCustomProject(db);
  stashActiveProjectCms(db);
  project.cms = defaultCms(db); // clone the default (demo) CMS structure to tailor
  db.projects.push(project);
  db.settings = db.settings || {};
  db.settings.demoMode = false;
  loadProjectIntoCustomLane(db, project); // fresh, empty workspace scoped to the intake
  applyCmsToTopLevel(db, project.cms);
  db.activeProjectId = project.id;
  writeDb(db);
  res.json({ success: true, project: (({ data, cms, ...m }) => m)(project), activeProjectId: project.id });
});

// Switch the active project (demo <-> a specific acquisition), isolating each workspace.
app.post('/api/projects/:id/activate', (req, res) => {
  const db = readDb();
  const target = findProject(db, req.params.id);
  if (!target) return res.status(404).json({ error: 'Project not found.' });
  db.settings = db.settings || {};
  if (target.id !== db.activeProjectId) { stashActiveCustomProject(db); stashActiveProjectCms(db); }
  if (target.isDemo) {
    db.settings.demoMode = true;
  } else {
    db.settings.demoMode = false;
    loadProjectIntoCustomLane(db, target);
  }
  loadProjectCms(db, target); // swap in the target project's CMS content
  db.activeProjectId = target.id;
  writeDb(db);
  res.json({ success: true, activeProjectId: target.id, demoMode: db.settings.demoMode });
});

app.delete('/api/projects/:id', (req, res) => {
  const db = readDb();
  const project = findProject(db, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  if (project.isDemo) return res.status(400).json({ error: 'The demo project cannot be deleted.' });
  const wasActive = db.activeProjectId === req.params.id;
  db.projects = (db.projects || []).filter(p => p.id !== req.params.id);
  // Deleting the active project falls back to the demo workspace (restore its CMS too).
  if (wasActive) {
    db.activeProjectId = 'proj_demo';
    db.settings = db.settings || {};
    db.settings.demoMode = true;
    loadProjectCms(db, findProject(db, 'proj_demo'));
  }
  writeDb(db);
  res.json({ success: true, activeProjectId: db.activeProjectId });
});

// =====================================================================
// Department modules — functional integration tracks (Sales, Product, ...)
// Culture & Communication are shared; Systems & Trainings are per-department.
// =====================================================================
app.get('/api/departments', (req, res) => {
  res.json(readDb().departments || []);
});

app.post('/api/departments', (req, res) => {
  const db = readDb();
  db.departments = db.departments || [];
  const d = req.body || {};
  const nameOk = d.name && String(d.name).trim();
  let stored;
  if (d.id) {
    const i = db.departments.findIndex(x => x.id === d.id);
    // Existing department: merge (partial updates like the lock toggle are allowed).
    if (i > -1) { db.departments[i] = { ...db.departments[i], ...d }; stored = db.departments[i]; }
    else {
      if (!nameOk) return res.status(400).json({ error: 'Department name is required.' });
      db.departments.push(d); stored = d;
    }
  } else {
    if (!nameOk) return res.status(400).json({ error: 'Department name is required.' });
    stored = { locked: true, systems: [], trainings: [], ...d, id: newId('dept') };
    db.departments.push(stored);
  }
  writeDb(db);
  res.json({ success: true, department: stored });
});

app.delete('/api/departments/:id', (req, res) => {
  const db = readDb();
  db.departments = (db.departments || []).filter(x => x.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// =====================================================================
// Process Integration & Transformation — the per-project Process Catalog.
// Models how each business process moves from the Sending org (the acquired
// company) to the Receiving org (TE), where it is adopted/harmonized/retired.
// Project-scoped via the cms bundle, so it swaps on project switch just
// like `departments`. Writes are behind the ADMIN_TOKEN gate + atomic writeDb.
// =====================================================================
app.get('/api/processes', (req, res) => {
  res.json(readDb().processCatalog || []);
});

app.post('/api/processes', (req, res) => {
  const db = readDb();
  db.processCatalog = db.processCatalog || [];
  const p = req.body || {};
  const nameOk = p.name && String(p.name).trim();
  let stored;
  if (p.id) {
    const i = db.processCatalog.findIndex(x => x.id === p.id);
    // Existing process: merge (allows partial updates like a status change).
    if (i > -1) { db.processCatalog[i] = { ...db.processCatalog[i], ...p }; stored = db.processCatalog[i]; }
    else {
      if (!nameOk) return res.status(400).json({ error: 'Process name is required.' });
      db.processCatalog.push(p); stored = p;
    }
  } else {
    if (!nameOk) return res.status(400).json({ error: 'Process name is required.' });
    stored = { domain: '', approach: 'Harmonize', status: 'not-started', risk: 'Medium', phase: '', notes: '', sending: {}, receiving: {}, ...p, id: newId('proc') };
    db.processCatalog.push(stored);
  }
  writeDb(db);
  res.json({ success: true, process: stored });
});

app.delete('/api/processes/:id', (req, res) => {
  const db = readDb();
  db.processCatalog = (db.processCatalog || []).filter(x => x.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// =====================================================================
// HTML Slides — admin-authored full-screen slide decks (pasted link OR an
// uploaded HTML file), launched from a per-page sidebar icon and shown as a
// full overlay. Project-scoped via the cms bundle, like departments/processes.
// =====================================================================
app.get('/api/slides', (req, res) => {
  res.json(readDb().slides || []);
});

app.post('/api/slides', (req, res) => {
  const db = readDb();
  db.slides = db.slides || [];
  const s = req.body || {};
  if (!s.url || !String(s.url).trim()) return res.status(400).json({ error: 'A slide link (url) is required.' });
  let stored;
  if (s.id) {
    const i = db.slides.findIndex(x => x.id === s.id);
    if (i > -1) { db.slides[i] = { ...db.slides[i], ...s }; stored = db.slides[i]; }
    else { db.slides.push(s); stored = s; }
  } else {
    stored = { icon: '🖥️', label: 'Slide', pages: 'all', ...s, id: newId('slide') };
    db.slides.push(stored);
  }
  writeDb(db);
  res.json({ success: true, slide: stored });
});

app.delete('/api/slides/:id', (req, res) => {
  const db = readDb();
  db.slides = (db.slides || []).filter(x => x.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});

// Upload an HTML slide file (raw HTML string) -> saved under public/uploads/slides/
// and returned as a servable URL. Behind the same admin-write gate as other writes.
app.post('/api/slides/upload', (req, res) => {
  const b = req.body || {};
  const content = typeof b.content === 'string' ? b.content : '';
  if (!content.trim()) return res.status(400).json({ error: 'No slide file content received.' });
  const base = String(b.filename || 'slide.html').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  const safe = /\.html?$/i.test(base) ? base : base + '.html';
  const dir = path.join(__dirname, 'public', 'uploads', 'slides');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fname = Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '_' + safe;
    fs.writeFileSync(path.join(dir, fname), content, 'utf8');
    res.json({ success: true, url: '/uploads/slides/' + fname });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save slide file.' });
  }
});

// =====================================================================
// CMS API — Courses/Lessons, i18n, Menus, Pages, Media
// =====================================================================

// ---- Courses & Lessons ----
app.get('/api/courses', (req, res) => {
  const db = readDb();
  res.json(db.courses || []);
});

// Create or update a whole course (upsert by id)
app.post('/api/courses', (req, res) => {
  const db = readDb();
  db.courses = db.courses || [];
  const course = req.body || {};
  let stored;
  if (course.id) {
    const idx = db.courses.findIndex(c => c.id === course.id);
    if (idx >= 0) { db.courses[idx] = { ...db.courses[idx], ...course }; stored = db.courses[idx]; }
    else {
      if (!course.title) return res.status(400).json({ error: 'Course title is required.' });
      db.courses.push(course); stored = course;
    }
  } else {
    if (!course.title) return res.status(400).json({ error: 'Course title is required.' });
    course.id = newId('course');
    course.modules = course.modules || [];
    db.courses.push(course);
    stored = course;
  }
  writeDb(db);
  res.json({ success: true, course: stored });
});

app.delete('/api/courses/:id', (req, res) => {
  const db = readDb();
  db.courses = (db.courses || []).filter(c => c.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, message: 'Course deleted.' });
});

// Upsert a single lesson within a course/module (keeps big payloads small)
app.post('/api/courses/:courseId/lessons', (req, res) => {
  const db = readDb();
  const course = (db.courses || []).find(c => c.id === req.params.courseId);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  const { moduleId, lesson } = req.body || {};
  const mod = (course.modules || []).find(m => m.id === moduleId);
  if (!mod) return res.status(404).json({ error: 'Module not found.' });
  if (!lesson) return res.status(400).json({ error: 'Lesson payload required.' });
  mod.lessons = mod.lessons || [];
  let stored;
  if (lesson.id) {
    const idx = mod.lessons.findIndex(l => l.id === lesson.id);
    if (idx >= 0) { mod.lessons[idx] = { ...mod.lessons[idx], ...lesson }; stored = mod.lessons[idx]; }
    else { mod.lessons.push(lesson); stored = lesson; }
  } else {
    lesson.id = newId('lesson');
    lesson.order = mod.lessons.length + 1;
    mod.lessons.push(lesson);
    stored = lesson;
  }
  writeDb(db);
  res.json({ success: true, lesson: stored });
});

app.delete('/api/courses/:courseId/lessons/:lessonId', (req, res) => {
  const db = readDb();
  const course = (db.courses || []).find(c => c.id === req.params.courseId);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  (course.modules || []).forEach(m => { m.lessons = (m.lessons || []).filter(l => l.id !== req.params.lessonId); });
  writeDb(db);
  res.json({ success: true, message: 'Lesson deleted.' });
});

// Flat lesson lookup used by the employee academy + completion validation
app.get('/api/lessons', (req, res) => {
  const db = readDb();
  const flat = [];
  (db.courses || []).forEach(c => (c.modules || []).forEach(m => (m.lessons || []).forEach(l => {
    flat.push({ ...l, courseId: c.id, courseTitle: c.title, moduleId: m.id, moduleTitle: m.title, moduleBadge: m.badge });
  })));
  res.json(flat);
});

// ---- i18n (translations) ----
app.get('/api/i18n', (req, res) => {
  const db = readDb();
  res.json(db.i18n || { languages: [], defaultLang: 'en', strings: {} });
});

// Merge partial strings/languages into the i18n store
app.post('/api/i18n', (req, res) => {
  const db = readDb();
  db.i18n = db.i18n || { languages: [], defaultLang: 'en', strings: {} };
  const body = req.body || {};
  if (Array.isArray(body.languages)) db.i18n.languages = body.languages;
  if (body.defaultLang) db.i18n.defaultLang = body.defaultLang;
  if (body.strings && typeof body.strings === 'object') {
    Object.keys(body.strings).forEach(lang => {
      db.i18n.strings[lang] = { ...(db.i18n.strings[lang] || {}), ...body.strings[lang] };
    });
  }
  // Single-key convenience: { lang, key, value }
  if (body.lang && body.key !== undefined) {
    db.i18n.strings[body.lang] = db.i18n.strings[body.lang] || {};
    db.i18n.strings[body.lang][body.key] = body.value;
  }
  writeDb(db);
  res.json({ success: true, i18n: db.i18n });
});

// ---- Menus (sidebar / groups / landing cards) ----
app.get('/api/menus', (req, res) => {
  const db = readDb();
  res.json(db.menus || { sidebar: [], groups: [], landingCards: [] });
});

app.post('/api/menus', (req, res) => {
  const db = readDb();
  db.menus = db.menus || { sidebar: [], groups: [], landingCards: [] };
  const body = req.body || {};
  if (Array.isArray(body.sidebar)) db.menus.sidebar = body.sidebar;
  if (Array.isArray(body.groups)) db.menus.groups = body.groups;
  if (Array.isArray(body.landingCards)) db.menus.landingCards = body.landingCards;
  if (Array.isArray(body.bookmarks)) db.menus.bookmarks = body.bookmarks;
  writeDb(db);
  res.json({ success: true, menus: db.menus });
});

// ---- Pages (CMS-authored page content) ----
app.get('/api/pages', (req, res) => {
  const db = readDb();
  if (req.query.slug) {
    const page = (db.pages || []).find(p => p.slug === req.query.slug);
    return res.json(page || null);
  }
  res.json(db.pages || []);
});

app.post('/api/pages', (req, res) => {
  const db = readDb();
  db.pages = db.pages || [];
  const page = req.body || {};
  if (page.id) {
    const idx = db.pages.findIndex(p => p.id === page.id);
    if (idx >= 0) db.pages[idx] = { ...db.pages[idx], ...page };
    else db.pages.push(page);
  } else {
    page.id = newId('page');
    db.pages.push(page);
  }
  writeDb(db);
  res.json({ success: true, page });
});

app.delete('/api/pages/:id', (req, res) => {
  const db = readDb();
  db.pages = (db.pages || []).filter(p => p.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, message: 'Page deleted.' });
});

// ---- Notification / alert banners (admin-configurable, per-page or global) ----
app.get('/api/banners', (req, res) => {
  const db = readDb();
  const all = db.banners || [];
  if (!req.query.slug) return res.json(all); // admin: full list
  const slug = req.query.slug;
  const now = Date.now();
  const applies = all.filter(b => {
    if (!b || b.active === false) return false;
    if (b.start && now < Date.parse(b.start)) return false;
    if (b.end && now > Date.parse(b.end)) return false;
    if (b.scope === 'global') return true;
    return Array.isArray(b.pages) && b.pages.indexOf(slug) > -1;
  });
  applies.sort((a, b) => (b.priority || 0) - (a.priority || 0)); // higher priority renders on top
  res.json(applies);
});

app.post('/api/banners', (req, res) => {
  const db = readDb();
  db.banners = db.banners || [];
  const b = req.body || {};
  const TYPES = ['info', 'success', 'warning', 'critical'];
  if (b.type && TYPES.indexOf(b.type) === -1) b.type = 'info';
  const nowIso = new Date().toISOString();
  if (b.id) {
    const idx = db.banners.findIndex(x => x.id === b.id);
    if (idx >= 0) db.banners[idx] = { ...db.banners[idx], ...b, updatedAt: nowIso };
    else db.banners.push({ ...b, updatedAt: nowIso });
  } else {
    b.id = newId('banner');
    b.createdAt = nowIso;
    b.updatedAt = nowIso;
    if (b.rev == null) b.rev = 1;
    db.banners.push(b);
  }
  const ok = writeDb(db);
  res.json({ success: ok, banner: db.banners.find(x => x.id === b.id) || b });
});

app.delete('/api/banners/:id', (req, res) => {
  const db = readDb();
  db.banners = (db.banners || []).filter(b => b.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, message: 'Banner deleted.' });
});

// ---- Media library (base64 upload to /public/uploads) ----
app.get('/api/media', (req, res) => {
  const db = readDb();
  res.json(db.media || []);
});

app.post('/api/media', (req, res) => {
  const db = readDb();
  db.media = db.media || [];
  const { fileName, fileData, kind } = req.body || {};
  if (!fileName || !fileData) return res.status(400).json({ error: 'fileName and fileData are required.' });
  try {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const m = /^data:([^;]+);base64,(.*)$/.exec(fileData);
    const b64 = m ? m[2] : fileData.replace(/^data:[^,]*,/, '');
    const safeName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const stored = `${Date.now()}_${safeName}`;
    fs.writeFileSync(path.join(uploadDir, stored), Buffer.from(b64, 'base64'));
    const item = { id: newId('media'), fileName: safeName, kind: kind || (m ? m[1] : 'application/octet-stream'), url: `/uploads/${stored}`, timestamp: new Date().toISOString() };
    db.media.push(item);
    writeDb(db);
    res.json({ success: true, media: item });
  } catch (e) {
    console.error('Media upload failed:', e);
    res.status(500).json({ error: 'Media upload failed.' });
  }
});

app.delete('/api/media/:id', (req, res) => {
  const db = readDb();
  const item = (db.media || []).find(m => m.id === req.params.id);
  if (item && item.url) {
    const p = path.join(__dirname, 'public', item.url.replace(/^\//, ''));
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignore */ }
  }
  db.media = (db.media || []).filter(m => m.id !== req.params.id);
  writeDb(db);
  res.json({ success: true, message: 'Media deleted.' });
});

// Helper function to generate high-fidelity SQL schemas
function generateSqlSchema(provider, db) {
  let ddl = "";
  let dml = "";

  // Dialect-specific types
  let jsonType = "JSON";
  
  if (provider === 'supabase' || provider === 'postgres') {
    jsonType = "JSONB";
  } else if (provider === 'azure') {
    jsonType = "NVARCHAR(MAX)";
  } else if (provider === 'aws' || provider === 'mysql') {
    jsonType = "JSON";
  }

  // 1. Settings Table DDL
  ddl += `-- -----------------------------------------------------\n`;
  ddl += `-- Target Provider Dialect: ${provider.toUpperCase()}\n`;
  ddl += `-- Table Structure for settings\n`;
  ddl += `-- -----------------------------------------------------\n`;
  if (provider === 'azure') {
    ddl += `CREATE TABLE settings (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  targetCompany NVARCHAR(255) NOT NULL,\n`;
    ddl += `  sector NVARCHAR(255),\n`;
    ddl += `  size NVARCHAR(100),\n`;
    ddl += `  hq NVARCHAR(255),\n`;
    ddl += `  acquisitionDate VARCHAR(50),\n`;
    ddl += `  synergyObjective NVARCHAR(MAX),\n`;
    ddl += `  browserModel NVARCHAR(100),\n`;
    ddl += `  timeTravelDay INT DEFAULT 1,\n`;
    ddl += `  doomGloballyEnabled BIT DEFAULT 1,\n`;
    ddl += `  doomUnlockXp INT DEFAULT 220,\n`;
    ddl += `  demoMode BIT DEFAULT 0\n`;
    ddl += `);\n\n`;
  } else {
    ddl += `CREATE TABLE settings (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  targetCompany VARCHAR(255) NOT NULL,\n`;
    ddl += `  sector VARCHAR(255),\n`;
    ddl += `  size VARCHAR(100),\n`;
    ddl += `  hq VARCHAR(255),\n`;
    ddl += `  acquisitionDate VARCHAR(50),\n`;
    ddl += `  synergyObjective TEXT,\n`;
    ddl += `  browserModel VARCHAR(100),\n`;
    ddl += `  timeTravelDay INT DEFAULT 1,\n`;
    ddl += `  doomGloballyEnabled BOOLEAN DEFAULT TRUE,\n`;
    ddl += `  doomUnlockXp INT DEFAULT 220,\n`;
    ddl += `  demoMode BOOLEAN DEFAULT FALSE\n`;
    ddl += `);\n\n`;
  }

  // Settings Active Row
  const settings = db.settings.demoMode === false ? (db.customSettings || { demoMode: false }) : db.settings;
  const targetCo = settings.targetCompany || "Apex Robotics Corp.";
  const sector = settings.sector || "Industrial Automation & AI";
  const size = settings.size || "120 Employees";
  const hq = settings.hq || "Zurich, Switzerland";
  const acqDate = settings.acquisitionDate || "2026-06-01";
  const objective = settings.synergyObjective || "Standardize systems and operations.";
  const browserModel = settings.browserModel || "simulated-duck";
  const timeTravelDay = settings.timeTravelDay || 1;
  const doomEnabled = settings.doomGloballyEnabled !== false ? 1 : 0;
  const doomUnlock = settings.doomUnlockXp || 220;

  if (provider === 'azure') {
    dml += `INSERT INTO settings (id, targetCompany, sector, size, hq, acquisitionDate, synergyObjective, browserModel, timeTravelDay, doomGloballyEnabled, doomUnlockXp, demoMode) VALUES (\n`;
    dml += `  'settings_active', N'${targetCo.replace(/'/g, "''")}', N'${sector.replace(/'/g, "''")}', N'${size.replace(/'/g, "''")}', N'${hq.replace(/'/g, "''")}', '${acqDate}', N'${objective.replace(/'/g, "''")}', N'${browserModel}', ${timeTravelDay}, ${doomEnabled}, ${doomUnlock}, 0\n`;
    dml += `);\n\n`;
  } else {
    const dBool = (doomEnabled === 1) ? 'TRUE' : 'FALSE';
    dml += `INSERT INTO settings (id, targetCompany, sector, size, hq, acquisitionDate, synergyObjective, browserModel, timeTravelDay, doomGloballyEnabled, doomUnlockXp, demoMode) VALUES (\n`;
    dml += `  'settings_active', '${targetCo.replace(/'/g, "''")}', '${sector.replace(/'/g, "''")}', '${size.replace(/'/g, "''")}', '${hq.replace(/'/g, "''")}', '${acqDate}', '${objective.replace(/'/g, "''")}', '${browserModel}', ${timeTravelDay}, ${dBool}, ${doomUnlock}, FALSE\n`;
    dml += `);\n\n`;
  }

  // 2. Employees Table DDL
  ddl += `-- Table Structure for employees\n`;
  ddl += `-- -----------------------------------------------------\n`;
  if (provider === 'azure') {
    ddl += `CREATE TABLE employees (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  name NVARCHAR(255) NOT NULL,\n`;
    ddl += `  role NVARCHAR(255) NOT NULL,\n`;
    ddl += `  department NVARCHAR(100) NOT NULL,\n`;
    ddl += `  company NVARCHAR(255),\n`;
    ddl += `  isLeader BIT DEFAULT 0,\n`;
    ddl += `  leaderRole NVARCHAR(255),\n`;
    ddl += `  buddyName NVARCHAR(255),\n`;
    ddl += `  buddyEmail NVARCHAR(255),\n`;
    ddl += `  completedLessons ${jsonType},\n`;
    ddl += `  points INT DEFAULT 0,\n`;
    ddl += `  badge NVARCHAR(100),\n`;
    ddl += `  bonusPoints INT DEFAULT 0\n`;
    ddl += `);\n\n`;
  } else {
    ddl += `CREATE TABLE employees (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  name VARCHAR(255) NOT NULL,\n`;
    ddl += `  role VARCHAR(255) NOT NULL,\n`;
    ddl += `  department VARCHAR(100) NOT NULL,\n`;
    ddl += `  company VARCHAR(255),\n`;
    ddl += `  isLeader BOOLEAN DEFAULT FALSE,\n`;
    ddl += `  leaderRole VARCHAR(255),\n`;
    ddl += `  buddyName VARCHAR(255),\n`;
    ddl += `  buddyEmail VARCHAR(255),\n`;
    ddl += `  completedLessons ${jsonType},\n`;
    ddl += `  points INT DEFAULT 0,\n`;
    ddl += `  badge VARCHAR(100),\n`;
    ddl += `  bonusPoints INT DEFAULT 0\n`;
    ddl += `);\n\n`;
  }

  const employees = db.settings.demoMode === false ? (db.customEmployees || []) : (db.employees || []);
  employees.forEach(emp => {
    const isLeader = emp.isLeader ? (provider === 'azure' ? 1 : 'TRUE') : (provider === 'azure' ? 0 : 'FALSE');
    const name = emp.name || '';
    const role = emp.role || '';
    const dept = emp.department || '';
    const comp = emp.company || '';
    const lRole = emp.leaderRole || 'None';
    const bName = emp.buddyName || '';
    const bEmail = emp.buddyEmail || '';
    const lessons = JSON.stringify(emp.completedLessons || []);
    const points = emp.points || 0;
    const badge = emp.badge || 'New Recruit';
    const bonus = emp.bonusPoints || 0;

    if (provider === 'azure') {
      dml += `INSERT INTO employees (id, name, role, department, company, isLeader, leaderRole, buddyName, buddyEmail, completedLessons, points, badge, bonusPoints) VALUES (\n`;
      dml += `  '${emp.id}', N'${name.replace(/'/g, "''")}', N'${role.replace(/'/g, "''")}', N'${dept.replace(/'/g, "''")}', N'${comp.replace(/'/g, "''")}', ${isLeader}, N'${lRole.replace(/'/g, "''")}', N'${bName.replace(/'/g, "''")}', N'${bEmail.replace(/'/g, "''")}', N'${lessons.replace(/'/g, "''")}', ${points}, N'${badge.replace(/'/g, "''")}', ${bonus}\n`;
      dml += `);\n`;
    } else {
      dml += `INSERT INTO employees (id, name, role, department, company, isLeader, leaderRole, buddyName, buddyEmail, completedLessons, points, badge, bonusPoints) VALUES (\n`;
      dml += `  '${emp.id}', '${name.replace(/'/g, "''")}', '${role.replace(/'/g, "''")}', '${dept.replace(/'/g, "''")}', '${comp.replace(/'/g, "''")}', ${isLeader}, '${lRole.replace(/'/g, "''")}', '${bName.replace(/'/g, "''")}', '${bEmail.replace(/'/g, "''")}', '${lessons.replace(/'/g, "''")}', ${points}, '${badge.replace(/'/g, "''")}', ${bonus}\n`;
      dml += `);\n`;
    }
  });

  // 3. Integration Leaders Table DDL
  ddl += `\n-- Table Structure for hrbps\n`;
  ddl += `-- -----------------------------------------------------\n`;
  if (provider === 'azure') {
    ddl += `CREATE TABLE hrbps (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  name NVARCHAR(255) NOT NULL,\n`;
    ddl += `  email NVARCHAR(255) NOT NULL,\n`;
    ddl += `  role NVARCHAR(100),\n`;
    ddl += `  assignedTracks ${jsonType},\n`;
    ddl += `  supportingTeams ${jsonType}\n`;
    ddl += `);\n\n`;
  } else {
    ddl += `CREATE TABLE hrbps (\n`;
    ddl += `  id VARCHAR(50) PRIMARY KEY,\n`;
    ddl += `  name VARCHAR(255) NOT NULL,\n`;
    ddl += `  email VARCHAR(255) NOT NULL,\n`;
    ddl += `  role VARCHAR(100),\n`;
    ddl += `  assignedTracks ${jsonType},\n`;
    ddl += `  supportingTeams ${jsonType}\n`;
    ddl += `);\n\n`;
  }

  const hrbps = db.settings.demoMode === false ? (db.customHrbps || []) : (db.hrbps || []);
  hrbps.forEach(h => {
    const name = h.name || '';
    const email = h.email || '';
    const role = h.role || 'hrbp';
    const tracks = JSON.stringify(h.assignedTracks || []);
    const teams = JSON.stringify(h.supportingTeams || []);

    if (provider === 'azure') {
      dml += `INSERT INTO hrbps (id, name, email, role, assignedTracks, supportingTeams) VALUES (\n`;
      dml += `  '${h.id}', N'${name.replace(/'/g, "''")}', N'${email.replace(/'/g, "''")}', N'${role.replace(/'/g, "''")}', N'${tracks.replace(/'/g, "''")}', N'${teams.replace(/'/g, "''")}'\n`;
      dml += `);\n`;
    } else {
      dml += `INSERT INTO hrbps (id, name, email, role, assignedTracks, supportingTeams) VALUES (\n`;
      dml += `  '${h.id}', '${name.replace(/'/g, "''")}', '${email.replace(/'/g, "''")}', '${role.replace(/'/g, "''")}', '${tracks.replace(/'/g, "''")}', '${teams.replace(/'/g, "''")}'\n`;
      dml += `);\n`;
    }
  });

  return ddl + dml;
}

// POST Migrate Database & Compile SQL Relational Schema
app.post('/api/admin/migrate-db', (req, res) => {
  const { provider, connectionDetails } = req.body;
  if (!provider) {
    return res.status(400).json({ error: 'Database provider is required.' });
  }

  const db = readDb();
  
  // 1. Generate full customized schema script
  const sqlSchema = generateSqlSchema(provider, db);

  // 2. Save active configuration persistently in setting metadata
  db.settings = db.settings || {};
  db.settings.databaseConfig = {
    enabled: true,
    provider,
    status: 'connected',
    connectionDetails: connectionDetails || {},
    timestamp: new Date().toISOString()
  };

  if (db.settings.demoMode === false) {
    db.customSettings = db.customSettings || { demoMode: false };
    db.customSettings.databaseConfig = db.settings.databaseConfig;
  }

  writeDb(db);

  res.json({
    success: true,
    message: `Database successfully migrated to ${provider.toUpperCase()} SQL Relational schema!`,
    schema: sqlSchema
  });
});

// GET AI Insight dynamic RAG portal insight
app.get('/api/ai/insight', async (req, res) => {
  const { portal } = req.query;
  if (!portal) {
    return res.status(400).json({ error: 'Portal parameter is required.' });
  }

  try {
    const db = readDb();
    
    // Check if we are running in Custom M&A Mode or Demo Mode
    const isCustom = db.settings && db.settings.demoMode === false;
    const apiKey = isCustom ? 
      ((db.customSettings && db.customSettings.geminiApiKey) || db.settings.geminiApiKey || '') : 
      (db.settings.geminiApiKey || '');

    // Invoke RAG-enabled AI insight service
    const aiService = require('./aiService');
    const insight = await aiService.generateSmolInsight({ portal, apiKey });

    res.json({
      success: true,
      portal,
      insight
    });
  } catch (error) {
    console.error('Error generating AI Insight dynamic insight:', error);
    res.status(500).json({ success: false, error: 'Failed to generate integration insight.' });
  }
});

  // GET Questions
app.get('/api/questions', (req, res) => {
  const db = readDb();
  res.json(db.questions || []);
});

// POST Question (Add New)
app.post('/api/questions', (req, res) => {
  const { text, dimension, weight } = req.body;
  if (!text || !dimension) {
    return res.status(400).json({ error: 'Text and dimension are required.' });
  }
  
  const db = readDb();
  const newQuestion = {
    id: newId('q'),
    dimension,
    text,
    weight: parseFloat(weight) || 1.0
  };
  
  db.questions.push(newQuestion);
  writeDb(db);
  res.status(201).json({ success: true, question: newQuestion });
});

// POST Question Update (Edit Existing)
app.post('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  const { text, dimension, weight } = req.body;
  
  const db = readDb();
  const q = db.questions.find(item => item.id === id);
  if (!q) {
    return res.status(404).json({ error: 'Question not found.' });
  }
  
  if (text !== undefined) q.text = text;
  if (dimension !== undefined) q.dimension = dimension;
  if (weight !== undefined) q.weight = parseFloat(weight) || 1.0;
  
  writeDb(db);
  res.json({ success: true, question: q });
});

// DELETE Question
app.delete('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const initialLength = db.questions.length;
  
  db.questions = db.questions.filter(q => q.id !== id);
  
  if (db.questions.length === initialLength) {
    return res.status(404).json({ error: 'Question not found.' });
  }
  
  writeDb(db);
  res.json({ success: true, message: 'Question deleted successfully.' });
});

// POST Assessment (Submit responses and trigger AI Plan generation)
app.post('/api/assessment', async (req, res) => {
  const { responses } = req.body; // e.g. { "q1": 4, "q2": 3 }
  if (!responses || Object.keys(responses).length === 0) {
    return res.status(400).json({ error: 'No survey responses provided.' });
  }
  
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");
  
  // Calculate average scores per dimension
  const sums = { culture: 0, talent: 0, value: 0 };
  const counts = { culture: 0, talent: 0, value: 0 };
  
  db.questions.forEach(q => {
    const score = parseFloat(responses[q.id]);
    if (!isNaN(score)) {
      sums[q.dimension] += score;
      counts[q.dimension]++;
    }
  });
  
  const scores = {
    culture: counts.culture > 0 ? parseFloat((sums.culture / counts.culture).toFixed(2)) : 3.0,
    talent: counts.talent > 0 ? parseFloat((sums.talent / counts.talent).toFixed(2)) : 3.0,
    value: counts.value > 0 ? parseFloat((sums.value / counts.value).toFixed(2)) : 3.0
  };
  
  const assessmentId = newId('assess');
  const timestamp = new Date().toISOString();
  
  // Generate the AI 100-Day Integration Plan
  let aiPlan = "";
  try {
    aiPlan = await aiService.generate100DayPlan({
      targetCompany,
      scores,
      responses,
      questions: db.questions,
      apiKey: (isCustom ? (db.customSettings.geminiApiKey || db.settings.geminiApiKey) : db.settings.geminiApiKey)
    });
  } catch (error) {
    console.error("AI Plan generation failed, falling back to local engine:", error);
    aiPlan = aiService.generateLocalFallbackPlan(targetCompany, scores);
  }
  
  const assessmentRecord = {
    id: assessmentId,
    timestamp,
    targetCompany,
    responses,
    scores,
    aiPlan
  };
  
  if (isCustom) {
    db.customAssessments = db.customAssessments || [];
    db.customAssessments.push(assessmentRecord);
  } else {
    db.assessments = db.assessments || [];
    db.assessments.push(assessmentRecord);
  }
  try {
    writeDb(db);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to save assessment.' });
  }

  res.status(201).json({ success: true, assessment: assessmentRecord });
});

// GET Latest Assessment
app.get('/api/assessment/latest', (req, res) => {
  const db = readDb();
  const day = db.settings.timeTravelDay || 30;
  const isCustom = db.settings && db.settings.demoMode === false;
  const assessments = isCustom && db.customAssessments && db.customAssessments.length > 0 ? db.customAssessments : (db.assessments || []);
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");
  
  if (!assessments || assessments.length === 0) {
    const mockAssessment = {
      id: 'mock_assess',
      timestamp: new Date().toISOString(),
      targetCompany: targetCompany,
      responses: {},
      scores: getScaledScores(null, day),
      aiPlan: aiService.generateLocalFallbackPlan(targetCompany, getScaledScores(null, day))
    };
    return res.json({ success: true, assessment: mockAssessment });
  }
  // Get the most recent assessment
  const latest = { ...assessments[assessments.length - 1] };
  latest.scores = getScaledScores(latest.scores, day);
  res.json({ success: true, assessment: latest });
});

// GET All Assessments (History)
app.get('/api/assessments', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    res.json(db.customAssessments && db.customAssessments.length > 0 ? db.customAssessments : (db.assessments || []));
  } else {
    res.json(db.assessments || []);
  }
});

// DELETE Assessment
app.delete('/api/assessments/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    db.customAssessments = (db.customAssessments || []).filter(a => a.id !== id);
  } else {
    db.assessments = (db.assessments || []).filter(a => a.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Assessment deleted.' });
});

// =====================================================================
// Assessment Suite v2 — template-driven readiness assessments
// (two-sided company readiness, Integration Leader readiness).
// Templates ride the per-project cms bundle; instances live in the
// demo/custom lane split like `assessments`. The legacy questions[] /
// POST /api/assessment survey engine stays untouched alongside.
// =====================================================================

function assessLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customAssessmentInstances = db.customAssessmentInstances || []; return db.customAssessmentInstances; }
  db.assessmentInstances = db.assessmentInstances || [];
  return db.assessmentInstances;
}

// Demo-lane instances carry an explicit `demoDay` (the day in the 100-day arc the
// record was "taken"); time travel reveals later seeded retakes instead of
// fabricating score inflation on a single record.
function visibleAssessInstances(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  const lane = assessLane(db);
  if (isCustom) return lane;
  const day = (db.settings && db.settings.timeTravelDay) || 30;
  return lane.filter(i => i.demoDay == null || i.demoDay <= day);
}

// Pure synchronous scorer — deliberately NO awaits between readDb and writeDb
// anywhere on the instance-submit path (file DB has no write concurrency).
function scoreAssessmentInstance(template, responses) {
  const scale = template.scale || { min: 1, max: 5 };
  const span = (scale.max - scale.min) || 4;
  const dimensionScores = {};
  const dimWeights = {};
  let expEarned = 0, expTotal = 0;
  (template.dimensions || []).forEach(dim => {
    let sum = 0, wsum = 0;
    (dim.questions || []).forEach(q => {
      const raw = responses ? responses[q.id] : undefined;
      if (q.type === 'checkbox') {
        // Experience-inventory evidence: counts toward experienceIndex, never banding.
        expTotal += (q.score || 1);
        if (raw === true || raw === 'true' || raw === 1) expEarned += (q.score || 1);
        return;
      }
      if (raw === undefined || raw === null || raw === '') return;
      let pct = null;
      if (q.type === 'sjt') {
        const opts = q.options || [];
        const idx = parseInt(raw, 10);
        const maxScore = opts.reduce((m, o) => Math.max(m, o.score || 0), 0) || 1;
        if (!isNaN(idx) && opts[idx]) pct = ((opts[idx].score || 0) / maxScore) * 100;
      } else if (q.type === 'maturity') {
        const v = parseFloat(raw);
        if (!isNaN(v)) pct = ((Math.min(Math.max(v, 1), 5) - 1) / 4) * 100;
      } else { // likert
        let v = parseFloat(raw);
        if (!isNaN(v)) {
          v = Math.min(Math.max(v, scale.min), scale.max);
          if (q.reverse) v = scale.max + scale.min - v;
          pct = ((v - scale.min) / span) * 100;
        }
      }
      if (pct == null) return;
      const w = q.weight || 1;
      sum += pct * w; wsum += w;
    });
    if (wsum > 0) { dimensionScores[dim.id] = Math.round(sum / wsum); dimWeights[dim.id] = dim.weight || 1; }
  });
  let osum = 0, owsum = 0;
  Object.keys(dimensionScores).forEach(id => { osum += dimensionScores[id] * dimWeights[id]; owsum += dimWeights[id]; });
  const overallScore = owsum > 0 ? Math.round(osum / owsum) : 0;
  const banding = template.banding || {};
  const bands = (banding.bands || []).slice().sort((a, b) => (b.min || 0) - (a.min || 0));
  const band = bands.find(b => overallScore >= (b.min || 0));
  const redFlagBelow = banding.redFlagBelow;
  const redFlags = (redFlagBelow == null) ? [] : Object.keys(dimensionScores).filter(id => dimensionScores[id] < redFlagBelow);
  const experienceIndex = expTotal > 0 ? Math.round((expEarned / expTotal) * 100) : null;
  return { dimensionScores, overallScore, bandId: band ? band.id : null, redFlags, experienceIndex };
}

// Raw answer maps never leave the server via list/status responses — target-company
// self-ratings and leader competency answers are the most sensitive records in the
// app, and these endpoints feed open dashboards.
function publicAssessInstance(inst) {
  if (!inst) return null;
  const { responses, ...rest } = inst;
  return rest;
}

function latestAssessInstanceFor(visible, tplId, rater) {
  let latest = null;
  visible.forEach(i => {
    if (i.templateId !== tplId) return;
    if (rater && (i.rater || 'self') !== rater) return;
    if (!latest) { latest = i; return; }
    const byDay = (i.demoDay || 0) - (latest.demoDay || 0);
    if (byDay > 0 || (byDay === 0 && String(i.timestamp) > String(latest.timestamp))) latest = i;
  });
  return latest;
}

// GET published assessment templates (active project's CMS); ?all=1 includes drafts
app.get('/api/assessment-templates', (req, res) => {
  const db = readDb();
  const all = req.query.all === '1';
  const list = (db.assessmentTemplates || [])
    .filter(t => all || t.published !== false)
    .slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(list);
});

// POST a completed assessment — server computes every score (client sends raw answers only)
app.post('/api/assessment-instances', (req, res) => {
  const { templateId, rater, respondentName, respondentRole, responses, retakeOf } = req.body || {};
  if (!templateId || !responses || typeof responses !== 'object' || Object.keys(responses).length === 0) {
    return res.status(400).json({ error: 'templateId and responses are required.' });
  }
  const db = readDb();
  const template = (db.assessmentTemplates || []).find(t => t.id === templateId);
  if (!template) return res.status(404).json({ error: 'Assessment template not found.' });
  const scoresBlock = scoreAssessmentInstance(template, responses);
  const instance = {
    id: newId('ainst'),
    templateId,
    templateVersion: template.version || 1,
    subject: template.subject || 'target-org',
    rater: (template.raterModes || ['self']).includes(rater) ? rater : 'self',
    respondentRole: String(respondentRole || '').slice(0, 60),
    respondentName: String(respondentName || '').slice(0, 120),
    responses,
    ...scoresBlock,
    status: 'submitted',
    timestamp: new Date().toISOString(),
    ...(retakeOf ? { retakeOf } : {})
  };
  // Demo-lane submissions belong to "today" in the 100-day demo arc: stamp the
  // current time-travel day so they order after (and outrank) earlier seeded
  // retakes, and disappear again when the demo rewinds before their day.
  if (!(db.settings && db.settings.demoMode === false)) {
    instance.demoDay = (db.settings && db.settings.timeTravelDay) || 30;
  }
  assessLane(db).push(instance);
  writeDb(db);
  res.status(201).json({ success: true, instance: publicAssessInstance(instance) });
});

// GET instances (lane-aware, time-travel-aware, answers stripped).
// When ADMIN_TOKEN is configured (production posture) this list is token-only:
// assessment records are the most sensitive data in the app.
app.get('/api/assessment-instances', (req, res) => {
  if (ADMIN_TOKEN) {
    const supplied = req.get('X-Admin-Token') || '';
    if (!(supplied && timingSafeEqualStr(supplied, ADMIN_TOKEN))) {
      return res.status(401).json({ error: 'Admin authentication required to list assessment records.' });
    }
  }
  const db = readDb();
  let list = visibleAssessInstances(db);
  if (req.query.templateId) list = list.filter(i => i.templateId === req.query.templateId);
  if (req.query.rater) list = list.filter(i => (i.rater || 'self') === req.query.rater);
  if (req.query.latest === '1') {
    const byKey = {};
    list.forEach(i => {
      const key = i.templateId + '|' + (i.rater || 'self');
      const cur = byKey[key];
      if (!cur) { byKey[key] = i; return; }
      const byDay = (i.demoDay || 0) - (cur.demoDay || 0);
      if (byDay > 0 || (byDay === 0 && String(i.timestamp) > String(cur.timestamp))) byKey[key] = i;
    });
    list = Object.values(byKey);
  }
  res.json(list.map(publicAssessInstance));
});

// DELETE an instance (admin cleanup)
app.delete('/api/assessment-instances/:id', (req, res) => {
  const db = readDb();
  const lane = assessLane(db);
  const filtered = lane.filter(i => i.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Instance not found.' });
  if (db.settings && db.settings.demoMode === false) db.customAssessmentInstances = filtered;
  else db.assessmentInstances = filtered;
  writeDb(db);
  res.json({ success: true });
});

// GET the readiness rollup — single source of truth for every gate point in the UI
app.get('/api/assessment-status', (req, res) => {
  const db = readDb();
  const templates = (db.assessmentTemplates || []).filter(t => t.published !== false);
  const visible = visibleAssessInstances(db);
  const required = [];
  const gatesSummary = {};
  const bySubject = {};
  // With ADMIN_TOKEN set, the open status rollup carries scores/bands only —
  // no respondent names (leader ratings are personal data).
  const statusInstance = (inst) => {
    const pub = publicAssessInstance(inst);
    if (pub && ADMIN_TOKEN) delete pub.respondentName;
    return pub;
  };
  templates.forEach(t => {
    const latest = latestAssessInstanceFor(visible, t.id, 'self');
    const entry = {
      templateId: t.id, slug: t.slug, subject: t.subject,
      required: !!t.required, gates: t.gates || [],
      satisfied: !!latest,
      latestInstance: statusInstance(latest)
    };
    bySubject[t.subject] = entry;
    if (t.required) required.push(entry);
    (t.gates || []).forEach(g => {
      gatesSummary[g] = gatesSummary[g] || { satisfied: true, blockedBy: [] };
      if (t.required && !latest) { gatesSummary[g].satisfied = false; gatesSummary[g].blockedBy.push(t.id); }
    });
  });

  // Compatibility per template pair (acquirer-org × target-org, joined on mirrorId).
  // Reported as two separate truths: per-company READINESS and profile ALIGNMENT
  // (100 − weighted mean gap). The fit band is the WORST of the alignment band and
  // both company bands — two equally weak companies must never read as a strong fit.
  const bandOf = (score) => score >= 80 ? 'ready' : score >= 60 ? 'support' : 'risk';
  const bandRank = { risk: 1, support: 2, ready: 3 };
  const pairs = {};
  templates.forEach(t => {
    if (!t.pairId) return;
    pairs[t.pairId] = pairs[t.pairId] || {};
    pairs[t.pairId][t.subject] = t;
  });
  const compatibility = [];
  Object.keys(pairs).forEach(pid => {
    const acqT = pairs[pid]['acquirer-org'], tgtT = pairs[pid]['target-org'];
    if (!acqT || !tgtT) return;
    const acqI = latestAssessInstanceFor(visible, acqT.id, 'self');
    const tgtI = latestAssessInstanceFor(visible, tgtT.id, 'self');
    if (!acqI || !tgtI) { compatibility.push({ pairId: pid, complete: false }); return; }
    const dims = [];
    (acqT.dimensions || []).forEach(d => {
      const mid = d.mirrorId || d.id;
      const td = (tgtT.dimensions || []).find(x => (x.mirrorId || x.id) === mid);
      if (!td) return;
      const a = (acqI.dimensionScores || {})[d.id];
      const tg = (tgtI.dimensionScores || {})[td.id];
      if (typeof a !== 'number' || typeof tg !== 'number') return;
      dims.push({ mirrorId: mid, label: d.label, labelKey: d.labelKey, icon: d.iconEmoji,
        acquirer: a, target: tg, gap: Math.abs(a - tg), weight: d.weight || 1 });
    });
    const wsum = dims.reduce((s, d) => s + d.weight, 0) || 1;
    const alignment = Math.round(100 - dims.reduce((s, d) => s + d.gap * d.weight, 0) / wsum);
    const fitBand = [bandOf(alignment), acqI.bandId || bandOf(acqI.overallScore), tgtI.bandId || bandOf(tgtI.overallScore)]
      .sort((a, b) => bandRank[a] - bandRank[b])[0];
    const topGaps = dims.slice().sort((a, b) => b.gap - a.gap).slice(0, 2).map(d => d.mirrorId);
    compatibility.push({
      pairId: pid, complete: true, alignment, fitBand,
      acquirer: { templateId: acqT.id, score: acqI.overallScore, bandId: acqI.bandId },
      target: { templateId: tgtT.id, score: tgtI.overallScore, bandId: tgtI.bandId },
      dims, topGaps
    });
  });

  const isCustomStatus = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustomStatus
    ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || '')
    : ((db.settings && db.settings.targetCompany) || '');
  res.json({ success: true, targetCompany, required, bySubject, gatesSummary, compatibility });
});

// =====================================================================
// Execution engine — Day-1/100-day checklists + workstream tasks in one
// task model. Checklist templates ride the cms bundle; live tasks are
// lane-split. Assessment remediation can create tasks (assessment → plan).
// =====================================================================

function taskLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customIntegrationTasks = db.customIntegrationTasks || []; return db.customIntegrationTasks; }
  db.integrationTasks = db.integrationTasks || [];
  return db.integrationTasks;
}

const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
const TASK_PHASES = ['pre', 'day1', 'd30', 'd60', 'd100'];

app.get('/api/integration-tasks', (req, res) => {
  const db = readDb();
  res.json(taskLane(db));
});

// Create or update a task (upsert by id, like departments/processes)
app.post('/api/integration-tasks', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = taskLane(db);
  if (b.id) {
    const task = lane.find(t => t.id === b.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    ['title', 'titleKey', 'workstreamId', 'phase', 'owner', 'due'].forEach(k => {
      if (b[k] !== undefined) task[k] = String(b[k] || '').slice(0, 300);
    });
    if (b.status !== undefined) {
      if (!TASK_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
      task.status = b.status;
      task.completedAt = b.status === 'done' ? (task.completedAt || new Date().toISOString()) : undefined;
      if (task.completedAt === undefined) delete task.completedAt;
    }
    writeDb(db);
    return res.json({ success: true, task });
  }
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Task title is required.' });
  const task = {
    id: newId('task'),
    title: title.slice(0, 300),
    ...(b.titleKey ? { titleKey: String(b.titleKey).slice(0, 120) } : {}),
    workstreamId: String(b.workstreamId || 'ws_imo').slice(0, 60),
    phase: TASK_PHASES.includes(b.phase) ? b.phase : 'd30',
    owner: String(b.owner || '').slice(0, 120),
    due: String(b.due || '').slice(0, 20),
    status: TASK_STATUSES.includes(b.status) ? b.status : 'todo',
    source: String(b.source || 'manual').slice(0, 160),
    createdAt: new Date().toISOString()
  };
  lane.push(task);
  writeDb(db);
  res.status(201).json({ success: true, task });
});

app.delete('/api/integration-tasks/:id', (req, res) => {
  const db = readDb();
  const lane = taskLane(db);
  const filtered = lane.filter(t => t.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Task not found.' });
  if (db.settings && db.settings.demoMode === false) db.customIntegrationTasks = filtered;
  else db.integrationTasks = filtered;
  writeDb(db);
  res.json({ success: true });
});

// Instantiate a checklist template: every item becomes a task once (source-deduped),
// so re-running after adding template items only creates the new ones.
app.post('/api/integration-tasks/instantiate', (req, res) => {
  const { checklistTemplateId } = req.body || {};
  const db = readDb();
  const tpl = (db.checklistTemplates || []).find(t => t.id === checklistTemplateId);
  if (!tpl) return res.status(404).json({ error: 'Checklist template not found.' });
  const lane = taskLane(db);
  const created = [];
  (tpl.items || []).forEach(item => {
    const source = 'template:' + tpl.id + ':' + item.id;
    if (lane.some(t => t.source === source)) return;
    const task = {
      id: newId('task'),
      title: item.text || item.id,
      ...(item.textKey ? { titleKey: item.textKey } : {}),
      workstreamId: item.workstreamId || 'ws_imo',
      phase: TASK_PHASES.includes(item.phase) ? item.phase : 'd30',
      owner: item.ownerHint || '',
      due: '',
      status: 'todo',
      source,
      createdAt: new Date().toISOString()
    };
    lane.push(task);
    created.push(task);
  });
  if (created.length) writeDb(db);
  res.json({ success: true, created: created.length });
});

// Assessment → plan: turn the latest instance's sub-80 remediation advice into
// tasks (source-deduped). This is the closing of the loop: readiness gaps
// become owned, trackable work.
const REMEDIATION_WS = {
  dim_governance: 'ws_imo', dim_people: 'ws_hr', dim_culture: 'ws_hr',
  dim_systems: 'ws_it', dim_commercial: 'ws_sales', dim_day1: 'ws_imo'
};
app.post('/api/integration-tasks/from-remediation', (req, res) => {
  const { assessmentTemplateId } = req.body || {};
  const db = readDb();
  const tpl = (db.assessmentTemplates || []).find(t => t.id === assessmentTemplateId);
  if (!tpl) return res.status(404).json({ error: 'Assessment template not found.' });
  const latest = latestAssessInstanceFor(visibleAssessInstances(db), tpl.id, 'self');
  if (!latest) return res.status(400).json({ error: 'No submitted assessment to derive tasks from.' });
  const lane = taskLane(db);
  const created = [];
  (tpl.remediation || []).forEach(r => {
    const score = (latest.dimensionScores || {})[r.dimensionId];
    if (typeof score !== 'number' || score >= 80) return;
    const source = 'remediation:' + tpl.id + ':' + r.dimensionId;
    if (lane.some(t => t.source === source)) return;
    const task = {
      id: newId('task'),
      title: r.advice || r.dimensionId,
      ...(r.adviceKey ? { titleKey: r.adviceKey } : {}),
      workstreamId: REMEDIATION_WS[r.dimensionId] || 'ws_imo',
      phase: 'd30',
      owner: '',
      due: '',
      status: 'todo',
      source,
      createdAt: new Date().toISOString()
    };
    lane.push(task);
    created.push(task);
  });
  if (created.length) writeDb(db);
  res.json({ success: true, created: created.length });
});

app.get('/api/checklist-templates', (req, res) => {
  res.json(readDb().checklistTemplates || []);
});

// =====================================================================
// Synergy tracker — initiatives with $M targets vs realized, lifecycle
// identified → validated → planned → executing → realized.
// =====================================================================
function synergyLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customSynergyInitiatives = db.customSynergyInitiatives || []; return db.customSynergyInitiatives; }
  db.synergyInitiatives = db.synergyInitiatives || [];
  return db.synergyInitiatives;
}
const SYN_STATUSES = ['identified', 'validated', 'planned', 'executing', 'realized'];

app.get('/api/synergies', (req, res) => {
  res.json(synergyLane(readDb()));
});

app.post('/api/synergies', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = synergyLane(db);
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.max(0, Math.round(n * 10) / 10); };
  if (b.id) {
    const item = lane.find(s => s.id === b.id);
    if (!item) return res.status(404).json({ error: 'Initiative not found.' });
    ['title', 'owner', 'workstreamId', 'notes'].forEach(k => { if (b[k] !== undefined) item[k] = String(b[k] || '').slice(0, 300); });
    if (b.category !== undefined) item.category = b.category === 'cost' ? 'cost' : 'revenue';
    if (b.targetM !== undefined) item.targetM = num(b.targetM);
    if (b.realizedM !== undefined) item.realizedM = num(b.realizedM);
    if (b.status !== undefined) {
      if (!SYN_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
      item.status = b.status;
    }
    writeDb(db);
    return res.json({ success: true, initiative: item });
  }
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Initiative title is required.' });
  const item = {
    id: newId('syn'),
    title: title.slice(0, 300),
    category: b.category === 'cost' ? 'cost' : 'revenue',
    targetM: num(b.targetM),
    realizedM: num(b.realizedM),
    owner: String(b.owner || '').slice(0, 120),
    workstreamId: String(b.workstreamId || 'ws_imo').slice(0, 60),
    status: SYN_STATUSES.includes(b.status) ? b.status : 'identified',
    notes: String(b.notes || '').slice(0, 600),
    createdAt: new Date().toISOString()
  };
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, initiative: item });
});

app.delete('/api/synergies/:id', (req, res) => {
  const db = readDb();
  const lane = synergyLane(db);
  const filtered = lane.filter(s => s.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Initiative not found.' });
  if (db.settings && db.settings.demoMode === false) db.customSynergyInitiatives = filtered;
  else db.synergyInitiatives = filtered;
  writeDb(db);
  res.json({ success: true });
});

// =====================================================================
// RAID log — risks / issues / decisions / dependencies.
// =====================================================================
function raidLane(db) {
  const isCustom = db.settings && db.settings.demoMode === false;
  if (isCustom) { db.customRaidEntries = db.customRaidEntries || []; return db.customRaidEntries; }
  db.raidEntries = db.raidEntries || [];
  return db.raidEntries;
}
const RAID_TYPES = ['risk', 'issue', 'decision', 'dependency'];
const RAID_LEVELS = ['low', 'medium', 'high'];
const RAID_STATUSES = ['open', 'mitigating', 'closed'];

app.get('/api/raid', (req, res) => {
  res.json(raidLane(readDb()));
});

app.post('/api/raid', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = raidLane(db);
  if (b.id) {
    const item = lane.find(r => r.id === b.id);
    if (!item) return res.status(404).json({ error: 'Entry not found.' });
    ['title', 'owner', 'workstreamId', 'notes'].forEach(k => { if (b[k] !== undefined) item[k] = String(b[k] || '').slice(0, 300); });
    if (b.type !== undefined && RAID_TYPES.includes(b.type)) item.type = b.type;
    if (b.severity !== undefined && RAID_LEVELS.includes(b.severity)) item.severity = b.severity;
    if (b.probability !== undefined && RAID_LEVELS.includes(b.probability)) item.probability = b.probability;
    if (b.status !== undefined) {
      if (!RAID_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
      item.status = b.status;
    }
    writeDb(db);
    return res.json({ success: true, entry: item });
  }
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Entry title is required.' });
  const item = {
    id: newId('raid'),
    type: RAID_TYPES.includes(b.type) ? b.type : 'risk',
    title: title.slice(0, 300),
    severity: RAID_LEVELS.includes(b.severity) ? b.severity : 'medium',
    ...(b.probability && RAID_LEVELS.includes(b.probability) ? { probability: b.probability } : {}),
    owner: String(b.owner || '').slice(0, 120),
    workstreamId: String(b.workstreamId || 'ws_imo').slice(0, 60),
    status: RAID_STATUSES.includes(b.status) ? b.status : 'open',
    notes: String(b.notes || '').slice(0, 600),
    createdAt: new Date().toISOString()
  };
  lane.push(item);
  writeDb(db);
  res.status(201).json({ success: true, entry: item });
});

app.delete('/api/raid/:id', (req, res) => {
  const db = readDb();
  const lane = raidLane(db);
  const filtered = lane.filter(r => r.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Entry not found.' });
  if (db.settings && db.settings.demoMode === false) db.customRaidEntries = filtered;
  else db.raidEntries = filtered;
  writeDb(db);
  res.json({ success: true });
});

// ==========================================
// NEW M&A INTEGRATION DECK CRUD ENDPOINTS
// ==========================================

// GET Modules
app.get('/api/modules', (req, res) => {
  const db = readDb();
  res.json(db.modules || []);
});

// POST Module (Add/Edit)
app.post('/api/modules', (req, res) => {
  const { id, title, dimension, urgency, minScore, maxScore, description, playbookLink, supportingTeams } = req.body;
  if (!title || !dimension || !urgency || !description) {
    return res.status(400).json({ error: 'Title, dimension, urgency, and description are required.' });
  }

  const db = readDb();
  db.modules = db.modules || [];

  if (id) {
    // Edit existing
    const idx = db.modules.findIndex(m => m.id === id);
    if (idx !== -1) {
      db.modules[idx] = {
        id,
        title,
        dimension,
        urgency,
        minScore: parseFloat(minScore) || 1.0,
        maxScore: parseFloat(maxScore) || 5.0,
        description,
        playbookLink: playbookLink || '',
        supportingTeams: supportingTeams || ''
      };
      writeDb(db);
      return res.json({ success: true, module: db.modules[idx] });
    }
  }

  // Create new
  const newModule = {
    id: newId('mod'),
    title,
    dimension,
    urgency,
    minScore: parseFloat(minScore) || 1.0,
    maxScore: parseFloat(maxScore) || 5.0,
    description,
    playbookLink: playbookLink || '',
    supportingTeams: supportingTeams || ''
  };

  db.modules.push(newModule);
  writeDb(db);
  res.status(201).json({ success: true, module: newModule });
});

// DELETE Module
app.delete('/api/modules/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  db.modules = (db.modules || []).filter(m => m.id !== id);
  writeDb(db);
  res.json({ success: true, message: 'Module deleted successfully.' });
});

// GET Employees
app.get('/api/employees', (req, res) => {
  const db = readDb();
  const day = db.settings.timeTravelDay || 30;
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  // Demo mode keeps the time-machine simulation (Day 1 = fresh org, Day 100 = fully
  // certified) so the org-wide ramp reads consistently. Custom mode shows REAL stored
  // progress so live lesson completions and +50 merit awards actually appear on the
  // leaderboard / dashboard roster / signage.
  const result = isCustom ? employeesList : scaleEmployeesForDay(employeesList, day, getCatalogLessonIds(db));
  res.json(result);
});

// POST Employee
app.post('/api/employees', (req, res) => {
  const { id, name, role, department, company, lang, isLeader, leaderRole, buddyName, buddyEmail } = req.body;
  if (!name || !role || !department) {
    return res.status(400).json({ error: 'Name, role, and department are required.' });
  }

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");

  let employee;
  const list = isCustom ? (db.customEmployees || []) : (db.employees || []);
  if (id) {
    employee = list.find(e => e.id === id);
  }

  if (employee) {
    employee.name = name;
    employee.role = role;
    employee.department = department;
    employee.company = company || targetCompany || 'Acquired Co.';
    employee.lang = lang || employee.lang || 'en';
    employee.isLeader = isLeader === true || isLeader === 'true';
    employee.leaderRole = leaderRole || 'None';
    employee.buddyName = buddyName || '';
    employee.buddyEmail = buddyEmail || '';
  } else {
    employee = {
      id: id || newId('emp'),
      name,
      role,
      department,
      company: company || targetCompany || 'Acquired Co.',
      lang: lang || 'en',
      isLeader: isLeader === true || isLeader === 'true',
      leaderRole: leaderRole || 'None',
      buddyName: buddyName || '',
      buddyEmail: buddyEmail || '',
      completedLessons: [],
      points: 0,
      badge: 'New Recruit',
      bonusPoints: 0
    };
    if (isCustom) {
      db.customEmployees = db.customEmployees || [];
      db.customEmployees.push(employee);
    } else {
      db.employees = db.employees || [];
      db.employees.push(employee);
    }
  }

  writeDb(db);
  res.status(id ? 200 : 201).json({ success: true, employee });
});

// DELETE Employee
app.delete('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    db.customEmployees = (db.customEmployees || []).filter(e => e.id !== id);
  } else {
    db.employees = (db.employees || []).filter(e => e.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Employee deleted successfully.' });
});

// Helper for Badge tier calculation
function calculateBadge(completedCount) {
  if (completedCount >= 9) return "Ultimate Integrator";
  if (completedCount >= 6) return "Synergy Scout";
  if (completedCount >= 3) return "Systems Scholar";
  if (completedCount >= 1) return "Culture Champion";
  return "New Recruit";
}

// GET or Create Employee (For tracking welcome page URLs & progress)
app.get('/api/employees/get-or-create', (req, res) => {
  const { empId, name, role, department, company, isLeader, leaderRole, buddyName, buddyEmail } = req.query;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const targetCompany = isCustom ? ((db.customSettings && db.customSettings.targetCompany) || db.settings.targetCompany || "NewCo Ltd.") : (db.settings.targetCompany || "NewCo Ltd.");
  
  let employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);

  let found = null;
  if (empId) {
    found = employeesList.find(e => e.id === empId);
  }
  if (!found && name) {
    found = employeesList.find(e => e.name && e.name.toLowerCase() === name.toLowerCase());
  }

  if (found) {
    let updated = false;
    if (!found.completedLessons) { found.completedLessons = []; updated = true; }
    if (found.points === undefined) { found.points = 0; updated = true; }
    if (found.badge === undefined) { found.badge = "New Recruit"; updated = true; }
    if (found.bonusPoints === undefined) { found.bonusPoints = 0; updated = true; }
    if (found.isLeader === undefined) { found.isLeader = false; updated = true; }
    if (found.leaderRole === undefined) { found.leaderRole = "None"; updated = true; }
    if (found.buddyName === undefined) { found.buddyName = ""; updated = true; }
    if (found.buddyEmail === undefined) { found.buddyEmail = ""; updated = true; }
    if (updated) {
      writeDb(db);
    }
    return res.json({ success: true, employee: found });
  }

  // Create new profile dynamically
  const newEmployee = {
    id: empId || newId('emp'),
    name: name || "Valued Team Member",
    role: role || "Specialist",
    department: department || "Operations",
    company: company || targetCompany || 'NextGen Sensors Ltd.',
    completedLessons: [],
    points: 0,
    badge: "New Recruit",
    bonusPoints: 0,
    isLeader: isLeader === true || isLeader === 'true' || false,
    leaderRole: leaderRole || 'None',
    buddyName: buddyName || '',
    buddyEmail: buddyEmail || ''
  };

  if (isCustom) {
    db.customEmployees = db.customEmployees || [];
    db.customEmployees.push(newEmployee);
  } else {
    db.employees = db.employees || [];
    db.employees.push(newEmployee);
  }
  writeDb(db);
  res.status(201).json({ success: true, employee: newEmployee });
});

// POST Complete Lesson
app.post('/api/employees/complete-lesson', (req, res) => {
  const { empId, lessonId } = req.body;
  if (!empId || !lessonId) {
    return res.status(400).json({ error: 'empId and lessonId are required.' });
  }

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  const employee = employeesList.find(e => e.id === empId);

  if (!employee) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  employee.completedLessons = employee.completedLessons || [];
  if (!employee.completedLessons.includes(lessonId)) {
    employee.completedLessons.push(lessonId);
    employee.bonusPoints = employee.bonusPoints || 0;
    employee.points = (employee.completedLessons.length * 20) + employee.bonusPoints;
    employee.badge = calculateBadge(employee.completedLessons.length);
    writeDb(db);
  }

  res.json({ success: true, employee });
});

// POST Uncomplete Lesson
app.post('/api/employees/uncomplete-lesson', (req, res) => {
  const { empId, lessonId } = req.body;
  if (!empId || !lessonId) {
    return res.status(400).json({ error: 'empId and lessonId are required.' });
  }

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  const employee = employeesList.find(e => e.id === empId);

  if (!employee) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  employee.completedLessons = employee.completedLessons || [];
  if (employee.completedLessons.includes(lessonId)) {
    employee.completedLessons = employee.completedLessons.filter(id => id !== lessonId);
    employee.bonusPoints = employee.bonusPoints || 0;
    employee.points = (employee.completedLessons.length * 20) + employee.bonusPoints;
    employee.badge = calculateBadge(employee.completedLessons.length);
    writeDb(db);
  }

  res.json({ success: true, employee });
});

// POST Award Merit Bonus (For Integration Leaders to award extra +50 XP points)
app.post('/api/employees/award-merit', (req, res) => {
  const { empId, points } = req.body;
  if (!empId) {
    return res.status(400).json({ error: 'empId is required.' });
  }

  const meritPoints = parseInt(points) || 50;

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const employeesList = isCustom ? (db.customEmployees || []) : (db.employees || []);
  const employee = employeesList.find(e => e.id === empId);

  if (!employee) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  employee.completedLessons = employee.completedLessons || [];
  employee.bonusPoints = (employee.bonusPoints || 0) + meritPoints;
  employee.points = (employee.completedLessons.length * 20) + employee.bonusPoints;
  employee.badge = calculateBadge(employee.completedLessons.length);
  writeDb(db);

  res.json({ success: true, employee });
});

// GET Integration Leaders
app.get('/api/hrbps', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    res.json(db.customHrbps || []);
  } else {
    res.json(db.hrbps || []);
  }
});

// POST Integration Leader
app.post('/api/hrbps', (req, res) => {
  const { id, name, email, assignedTracks, supportingTeams, role } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  
  let hrbp;
  const list = isCustom ? (db.customHrbps || []) : (db.hrbps || []);
  if (id) {
    hrbp = list.find(h => h.id === id);
  }

  if (hrbp) {
    hrbp.name = name;
    hrbp.email = email;
    hrbp.assignedTracks = Array.isArray(assignedTracks) ? assignedTracks : [];
    hrbp.supportingTeams = Array.isArray(supportingTeams) ? supportingTeams : [];
    hrbp.role = role || 'hrbp';
  } else {
    hrbp = {
      id: id || newId('hrbp'),
      name,
      email,
      assignedTracks: Array.isArray(assignedTracks) ? assignedTracks : [],
      supportingTeams: Array.isArray(supportingTeams) ? supportingTeams : [],
      role: role || 'hrbp'
    };
    if (isCustom) {
      db.customHrbps = db.customHrbps || [];
      db.customHrbps.push(hrbp);
    } else {
      db.hrbps = db.hrbps || [];
      db.hrbps.push(hrbp);
    }
  }

  writeDb(db);
  res.status(id ? 200 : 201).json({ success: true, hrbp });
});

// DELETE Integration Leader
app.delete('/api/hrbps/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    db.customHrbps = (db.customHrbps || []).filter(h => h.id !== id);
  } else {
    db.hrbps = (db.hrbps || []).filter(h => h.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Integration Leader deleted successfully.' });
});

// GET Alerts
app.get('/api/alerts', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    res.json(db.customAlerts || []);
  } else {
    res.json(db.alerts || []);
  }
});

// POST Alert
app.post('/api/alerts', (req, res) => {
  const { id, title, message, type } = req.body;
  if (!title || !message || !type) {
    return res.status(400).json({ error: 'Title, message, and type are required.' });
  }

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  
  let alertObj;
  const list = isCustom ? (db.customAlerts || []) : (db.alerts || []);
  if (id) {
    alertObj = list.find(a => a.id === id);
  }

  if (alertObj) {
    alertObj.title = title;
    alertObj.message = message;
    alertObj.type = type;
  } else {
    alertObj = {
      id: id || newId('alert'),
      title,
      message,
      type
    };
    if (isCustom) {
      db.customAlerts = db.customAlerts || [];
      db.customAlerts.push(alertObj);
    } else {
      db.alerts = db.alerts || [];
      db.alerts.push(alertObj);
    }
  }

  writeDb(db);
  res.status(id ? 200 : 201).json({ success: true, alert: alertObj });
});

// DELETE Alert
app.delete('/api/alerts/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    db.customAlerts = (db.customAlerts || []).filter(a => a.id !== id);
  } else {
    db.alerts = (db.alerts || []).filter(a => a.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Alert deleted successfully.' });
});

// GET Pulses
app.get('/api/pulses', (req, res) => {
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const day = (isCustom ? db.customSettings.timeTravelDay : db.settings.timeTravelDay) || db.settings.timeTravelDay || 30;
  const scaled = getPulsesForDay(day);
  // Append stored pulses (seeded + live submissions from the employee portal)
  // so POSTed feedback actually surfaces on the dashboard change curve.
  const stored = (db.pulses || []).filter(p => !scaled.some(s => s.id === p.id));
  res.json([...scaled, ...stored]);
});

// POST Pulse
app.post('/api/pulses', (req, res) => {
  const { employeeName, rating, comment, type } = req.body;
  if (!employeeName || !rating) {
    return res.status(400).json({ error: 'Employee name and rating are required.' });
  }

  const db = readDb();
  db.pulses = db.pulses || [];

  const newPulse = {
    id: newId('pulse'),
    employeeName,
    rating: parseInt(rating) || 3,
    comment: comment || '',
    timestamp: new Date().toISOString(),
    type: type || '30-day'
  };

  db.pulses.push(newPulse);
  writeDb(db);
  res.status(201).json({ success: true, pulse: newPulse });
});

// --- Unified Communications Hub Endpoints ---

// GET Communications Ledger
app.get('/api/communications', (req, res) => {
  const db = readDb();
  if (db.settings && db.settings.demoMode === false) {
    res.json(db.customCommunications || []);
  } else {
    res.json(db.communications || []);
  }
});

// POST Communication (Dispatches alert & compiles HTML email)
app.post('/api/communications/send', (req, res) => {
  const { sender, senderRole, recipientType, recipientId, recipientEmail, recipientName, subject, template, body } = req.body;
  
  if (!sender || !recipientEmail || !subject || !body) {
    return res.status(400).json({ error: 'Sender, recipient email, subject, and body are required.' });
  }

  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;

  const commId = newId('comm');
  const htmlFileName = `${commId}.html`;
  
  // Create dynamic directory if it doesn't exist
  const emailDir = path.join(__dirname, 'public', 'sent_emails');
  if (!fs.existsSync(emailDir)) {
    fs.mkdirSync(emailDir, { recursive: true });
  }

  // Compile rich HTML email content
  const htmlContent = compileHtmlEmail({
    sender,
    senderRole: senderRole || 'system',
    recipientName: recipientName || recipientEmail,
    recipientEmail,
    subject,
    template: template || 'custom',
    body
  });

  // Write HTML file persistently
  const htmlFilePath = path.join(emailDir, htmlFileName);
  fs.writeFileSync(htmlFilePath, htmlContent, 'utf8');

  const newComm = {
    id: commId,
    timestamp: new Date().toISOString(),
    sender,
    senderRole: senderRole || 'system',
    recipientType: recipientType || 'all',
    recipientId: recipientId || 'all',
    recipientName: recipientName || recipientEmail,
    recipientEmail,
    subject,
    template: template || 'custom',
    body,
    htmlEmailPath: `/sent_emails/${htmlFileName}`,
    status: 'Sent'
  };

  if (isCustom) {
    db.customCommunications = db.customCommunications || [];
    db.customCommunications.push(newComm);
  } else {
    db.communications = db.communications || [];
    db.communications.push(newComm);
  }
  writeDb(db);

  res.status(201).json({ success: true, communication: newComm });
});

// DELETE Communication from history
app.delete('/api/communications/:id', (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const isCustom = db.settings && db.settings.demoMode === false;
  const commsList = isCustom ? (db.customCommunications || []) : (db.communications || []);
  
  const comm = commsList.find(c => c.id === id);
  if (comm && comm.htmlEmailPath) {
    const filePath = path.join(__dirname, 'public', comm.htmlEmailPath);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn("Could not delete physical HTML email:", err);
      }
    }
  }

  if (isCustom) {
    db.customCommunications = (db.customCommunications || []).filter(c => c.id !== id);
  } else {
    db.communications = (db.communications || []).filter(c => c.id !== id);
  }
  writeDb(db);
  res.json({ success: true, message: 'Communication record deleted successfully.' });
});

// HTML Email Compiler Helper Function
function compileHtmlEmail({ sender, senderRole, recipientName, recipientEmail, subject, template, body }) {
  // Escape every caller-supplied field before it is interpolated into this HTML
  // document — the result is written to public/sent_emails/<id>.html and served
  // statically, so unescaped values are a stored-XSS vector. (\n -> <br> in the
  // body still works because escaping leaves newlines intact.)
  const escEmail = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  sender = escEmail(sender);
  senderRole = escEmail(senderRole);
  recipientName = escEmail(recipientName);
  subject = escEmail(subject);
  body = escEmail(body);
  let primaryColor = "#244C5A"; // Dark Teal
  let accentColor = "#E98300"; // TE Orange
  let typeLabel = "Welcome Announcement";
  let bannerColor = "rgba(36, 76, 90, 0.05)";
  
  if (template === "security") {
    primaryColor = "#B91C1C"; // Crimson
    accentColor = "#E98300"; // TE Orange
    typeLabel = "InfoSec Compliance Warning";
    bannerColor = "rgba(185, 28, 28, 0.05)";
  } else if (template === "synergy") {
    primaryColor = "#E98300"; // TE Orange
    accentColor = "#244C5A"; // Dark Teal
    typeLabel = "Values Synergy Workshop";
    bannerColor = "rgba(233, 131, 0, 0.05)";
  } else if (template === "custom") {
    primaryColor = "#374151"; // Charcoal
    accentColor = "#E98300"; // TE Orange
    typeLabel = "System Notice";
    bannerColor = "rgba(55, 65, 81, 0.05)";
  }

  const currentDate = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      background-color: #f1f5f9;
      color: #334155;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .email-container {
      max-width: 600px;
      margin: 2rem auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      border: 1px solid #e2e8f0;
    }
    .email-header {
      background: linear-gradient(135deg, ${primaryColor}, #1e293b);
      padding: 2rem;
      text-align: center;
      border-bottom: 4px solid ${accentColor};
    }
    .email-body {
      padding: 2.5rem 2rem;
    }
    .badge {
      display: inline-block;
      background-color: ${accentColor};
      color: #ffffff;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.25rem 0.6rem;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 800;
      color: ${primaryColor};
      margin: 0 0 1.25rem 0;
      line-height: 1.3;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 0.95rem;
      line-height: 1.6;
      color: #475569;
      margin: 0 0 1.5rem 0;
    }
    .salutation {
      font-size: 1.05rem;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 0.5rem;
    }
    .message-block {
      background-color: ${bannerColor};
      border-left: 4px solid ${accentColor};
      padding: 1.25rem;
      border-radius: 0 8px 8px 0;
      font-style: italic;
      font-size: 0.95rem;
      margin: 1.5rem 0;
      line-height: 1.6;
    }
    .cta-button {
      display: inline-block;
      background-color: ${primaryColor};
      color: #ffffff !important;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 700;
      padding: 0.75rem 1.75rem;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      margin-top: 1rem;
    }
    .email-footer {
      background-color: #f8fafc;
      padding: 1.5rem 2rem;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 0.75rem;
      color: #64748b;
      line-height: 1.5;
    }
    .footer-links {
      margin-top: 0.75rem;
      font-weight: 600;
    }
    .footer-links a {
      color: ${primaryColor};
      text-decoration: none;
      margin: 0 0.5rem;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <svg width="150" height="35" viewBox="0 0 160 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="40" height="40" rx="4" fill="#FFFFFF" />
        <text x="20" y="27" text-anchor="middle" font-family="-apple-system, sans-serif" font-weight="900" font-size="20" fill="${accentColor}">TE</text>
        <text x="48" y="26" font-family="-apple-system, sans-serif" font-weight="700" font-size="15" fill="#FFFFFF" letter-spacing="-0.03em">connectivity</text>
      </svg>
    </div>
    <div class="email-body">
      <span class="badge">${typeLabel}</span>
      <h1>${subject}</h1>
      
      <div class="salutation">Hello ${recipientName},</div>
      <p>
        This is an official communication broadcast regarding the ongoing <strong>TE Connectivity post-merger integration process</strong>.
      </p>
      
      <div class="message-block">
        ${body.replace(/\n/g, '<br>')}
      </div>
      
      <p>
        Please log into the M&A Integration Portal using your secure system Single Sign-On (SSO) credentials to review related milestones, complete required training modules, and track integration timelines.
      </p>
      
      <div style="text-align: center;">
        <a href="${PUBLIC_BASE_URL}/" class="cta-button">Launch Integration Workspace</a>
      </div>
    </div>
    <div class="email-footer">
      <p>
        <strong>Sender:</strong> ${sender} (${senderRole.toUpperCase()}) | <strong>Date:</strong> ${currentDate}
      </p>
      <p style="margin-top: 0.5rem;">
        This email was programmatically compiled and dispatched by the TE Connectivity Integration Management Office (IMO) System.
      </p>
      <p>
        CONFIDENTIALITY NOTICE: This message contains confidential information intended solely for the recipient's internal integration coordination purposes.
      </p>
      <div class="footer-links">
        <a href="${PUBLIC_BASE_URL}/">PMO Workspace</a> &bull; 
        <a href="${PUBLIC_BASE_URL}/playbook.html">M&A Playbook</a> &bull; 
        <a href="${PUBLIC_BASE_URL}/dashboard.html">Integration Leader Console</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Fallback for SPA routing/direct URLs
app.get('*', (req, res, next) => {
  // Unknown API routes get a real 404 (not the HTML fallback)
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Let express static handle real files
  const fileExt = path.extname(req.path);
  if (fileExt) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Final error handler — log server-side, return a generic message without internal details
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Keep the single process alive on unexpected errors rather than crashing silently.
// NOTE: for a supervised production deploy, switch uncaughtException to log-then-exit
// and let the supervisor (systemd/PM2/container) restart — resuming after an uncaught
// exception leaves the process in an undefined state. Left as log-only here so the
// unsupervised local/demo launcher doesn't die on a transient error.
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));

const server = app.listen(PORT, () => {
  console.log(`TE Connectivity M&A Portal server running on port ${PORT} (${PUBLIC_BASE_URL})`);
});

// Bound how long a single request may hold a socket — mitigates slow-request /
// slowloris resource exhaustion. headersTimeout must exceed requestTimeout.
server.requestTimeout = 60000;   // 60s to receive the full request body
server.headersTimeout = 65000;   // 65s to receive the request headers
server.keepAliveTimeout = 61000;

// Graceful shutdown: stop accepting new connections and let in-flight requests
// finish before exiting (so a deploy/restart doesn't drop live requests), with a
// hard fallback so a stuck connection can't block shutdown forever.
function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully...`);
  server.close(() => { console.log('HTTP server closed.'); process.exit(0); });
  setTimeout(() => { console.error('Forced shutdown after timeout.'); process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
