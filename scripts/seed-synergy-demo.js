#!/usr/bin/env node
// D-10/UI-SPEC "Demo Showcase Requirement": hand-tunes the five demo
// synergy-initiative seed rows (previously a mechanical stage-migration
// carry-over, scripts/migrate-synergy-stages.js) so the showcase exercises
// every surface this phase built — one initiative per confidence stage
// (with a fifth doubling one stage), a full 3-year phasing ramp on every
// row, a second baseline beneath the pinned deal case on one row, a
// deliberately stale confirmation stamp on one row, cost entries + a
// planned figure on one row, and task-lane-resolved taskIds on one row —
// plus the remaining new i18n label keys this phase's client
// (public/js/execution.js) references but no earlier plan's script landed.
//
// Follows scripts/migrate-synergy-stages.js's shape exactly: openDbFile() +
// prepared-statement rewrite inside one transaction + wal_checkpoint(TRUNCATE)
// + close, CLI defaulting to DEMO_DB_PATH, an explicit path argument for
// data/ma-portal.db (which has no exported path constant — db/dbFiles.js:38
// and this file's own precedent).
//
// Usage:
//   node scripts/seed-synergy-demo.js [path-to-db]
//   Defaults to db/dbFiles.js's DEMO_DB_PATH (data/demo.db) when run with no
//   argument. Pass data/ma-portal.db explicitly as the one CLI argument to
//   seed it too (it is chmod 444 — unlock/write/re-lock around the call,
//   mirroring scripts/migrate-synergy-stages.js's own Plan 02 precedent).
//
// Idempotent: every generated field (phasing rows, baseline/cost-entry ids,
// i18n additions) is DETERMINISTIC — no Date.now()/crypto.randomBytes()
// anywhere in this file — so running this script twice against the same
// starting file produces byte-identical output. Baseline and cost-entry ids
// are fixed strings derived from the initiative id + a sequence number
// (never server.js's real newId(), which embeds the wall clock), because a
// seed script's job is a reproducible fixture, not a request-shaped write.
//
// T-05-42 (this phase's own threat register): NO realized value is ever
// written into a phasing row whose month has not yet arrived — the seed
// script is a write path like any other and is bound by the identical
// forward-booking rule the server enforces on every live request.
'use strict';

const { openDbFile, DEAL_SCHEMA_PATH, DEMO_DB_PATH } = require('../db/dbFiles');

// --- Local replication of server.js's ramp math -------------------------
// Mirrors server.js:3077-3141 (RAMP_CURVES, roundSynergyMoney,
// generatePhasingRows, monthHasArrived) EXACTLY, so a seeded row is
// mathematically indistinguishable from a row a live "Generate phasing
// rows" click would produce for the same inputs. Deliberately NOT a
// `require('../server')` of the real module: server.js:664-672 calls
// initDb(DEMO_DB_PATH) and prunes expired sessions in runtime.db as a
// require()-time side effect (booting the whole request-context stack), so
// requiring it from a one-off script would reach into the REAL committed
// databases before this script's own `openDbFile()` call ever runs — the
// exact hazard scripts/migrate-synergy-stages.js already avoids by never
// requiring server.js either. A local copy is this codebase's own
// established convention for a shared pure-function idiom a script needs
// without pulling in a stateful module (validators/workstream.js's locally
// replicated isValidCalendarDate, Plan 04 05-04-SUMMARY.md).
const RAMP_CURVES = {
  cost: [0.30, 0.70, 1.00],
  revenue: [0.10, 0.40, 0.70],
  linear: [0.33, 0.67, 1.00],
};

function roundSynergyMoney(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : Math.max(0, Math.round(n * 10) / 10);
}

function generatePhasingRows(runRateM, startMonth, curveShape, horizonYears) {
  const checkpoints = RAMP_CURVES[curveShape] || RAMP_CURVES.linear;
  const [startYear, startMon] = String(startMonth).split('-').map(Number);
  const rate = roundSynergyMoney(runRateM);
  const totalRows = Math.max(0, horizonYears | 0) * 12;
  const rows = [];
  for (let i = 1; i <= totalRows; i++) {
    const absMonthIndex = (startMon - 1) + (i - 1);
    const rowYear = startYear + Math.floor(absMonthIndex / 12);
    const rowMonth = (absMonthIndex % 12) + 1;
    const month = rowYear + '-' + String(rowMonth).padStart(2, '0');

    const yearBucket = Math.ceil(i / 12);
    const monthWithinYear = i - (yearBucket - 1) * 12;
    const lastCheckpoint = checkpoints[checkpoints.length - 1];
    const prevCheckpoint = yearBucket === 1 ? 0 : (checkpoints[yearBucket - 2] !== undefined ? checkpoints[yearBucket - 2] : lastCheckpoint);
    const nextCheckpoint = checkpoints[yearBucket - 1] !== undefined ? checkpoints[yearBucket - 1] : lastCheckpoint;
    const attainment = prevCheckpoint + (nextCheckpoint - prevCheckpoint) * (monthWithinYear / 12);

    rows.push({
      month,
      targetM: roundSynergyMoney((attainment * rate) / 12),
      realizedM: 0,
    });
  }
  return rows;
}

function monthHasArrived(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return false;
  return month <= new Date().toISOString().slice(0, 7);
}

const HORIZON_YEARS = 3; // matches server.js's synergyHorizonYears() default fallback
// Every actor stamp below uses the demo's established Integration Leader
// persona (the hrbp-role account this project's other live verifications
// already use, e.g. 05-01-SUMMARY.md's ":3555 as karen" tracer walk) —
// baseline pushes are D-15-restricted to admin/hrbp, so this is also the
// only role that could plausibly have performed a real re-baseline.
const BASELINE_ACTOR = 'karen';

// --- The five hand-tuned demo seeds (D-10) -------------------------------
// Distribution across all four SYN-03 stages (idea/validated/committed/
// captured), one row doubling on `committed`, so all four stage-pill
// colours are visibly exercised without the viewer creating anything.
// `startMonth` is chosen in the PAST relative to today's real wall clock
// (never relative to the demo's 2026-04 close date — D-06's arrival gate is
// wall-clock-only, 05-CONTEXT.md/05-RESEARCH.md Finding A1) so every card's
// own 36-row grid straddles the current month: some already-arrived rows
// with realized value, most still locked in the future.
const INITIATIVE_SEEDS = [
  {
    id: 'syn_seed_1',
    seq: 0,
    title: 'Cross-sell NextGen sensors into TE automotive accounts',
    category: 'revenue',
    owner: 'Tom Becker',
    workstreamId: 'ws_sales',
    notes: 'First two design-wins logged with EU OEMs.',
    createdAt: '2026-04-25T09:00:00.000Z',
    stage: 'captured',
    runRateM: 12,
    startMonth: '2026-02',
    curveShape: 'revenue',
    realizedFillRatio: 0.95, // captured: strong evidence, real bookings in every arrived month
    dealCaseStage: 'idea',
    dealCaseAt: '2026-04-26T10:15:00.000Z',
    lastConfirmedAt: '2026-08-04T15:20:00.000Z', // fresh (2 days old)
    taskTitleSubstrings: [
      'Top-20 customers called',
      'Cross-sell opportunity map agreed',
      'Joint pipeline reviewed',
    ],
  },
  {
    id: 'syn_seed_2',
    seq: 1,
    title: 'Fold MEMS sensing IP into TE Sensor Solutions roadmap',
    category: 'revenue',
    owner: 'David Miller',
    workstreamId: 'ws_ops',
    notes: 'Roadmap integration workshop scheduled for day 45.',
    createdAt: '2026-04-25T09:00:00.000Z',
    stage: 'idea',
    runRateM: 15,
    startMonth: '2026-07',
    curveShape: 'revenue',
    realizedFillRatio: 0, // idea: nothing realized yet, by design
    dealCaseStage: 'idea',
    dealCaseAt: '2026-04-26T10:20:00.000Z',
    lastConfirmedAt: '2026-08-05T09:10:00.000Z', // fresh (1 day old)
  },
  {
    id: 'syn_seed_3',
    seq: 2,
    title: 'Consolidate procurement of wafers & packaging',
    category: 'cost',
    owner: 'Marc Weber',
    workstreamId: 'ws_finance',
    notes: 'Joint negotiation with top-2 suppliers underway; re-baselined in July after the Q2 supplier audit confirmed a higher achievable run-rate.',
    createdAt: '2026-04-25T09:00:00.000Z',
    stage: 'committed',
    runRateM: 5,
    startMonth: '2026-01',
    curveShape: 'cost',
    realizedFillRatio: 0.70, // committed: real but partial delivery
    dealCaseStage: 'validated',
    dealCaseAt: '2026-04-26T10:25:00.000Z',
    // D-12/D-13/D-14: this row carries a SECOND baseline beneath the pinned
    // deal case — the deal case pins the ORIGINAL (lower) run-rate estimate,
    // the current top-level fields carry the POST-re-baseline (higher)
    // figure the audit confirmed.
    rebaseline: {
      originalRunRateM: 4,
      originalStartMonth: '2026-01',
      originalCurveShape: 'cost',
      at: '2026-07-15T09:30:00.000Z',
      reason: 'Q2 supplier audit confirmed a higher achievable run-rate once target-company volumes are combined with TE’s existing wafer & packaging contracts — updated from $4.0M to $5.0M annual run-rate.',
    },
    lastConfirmedAt: '2026-08-01T11:00:00.000Z', // fresh (5 days old)
  },
  {
    id: 'syn_seed_4',
    seq: 3,
    title: 'Manufacturing footprint optimization (2 sites)',
    category: 'cost',
    owner: 'Jonas Petersen',
    workstreamId: 'ws_ops',
    notes: 'Feasibility study complete; works-council consultation pending.',
    createdAt: '2026-04-25T09:00:00.000Z',
    stage: 'validated',
    runRateM: 8,
    startMonth: '2026-05',
    curveShape: 'cost',
    realizedFillRatio: 0, // validated, not yet committed: nothing realized, real cost already incurred
    dealCaseStage: 'idea',
    dealCaseAt: '2026-04-26T10:30:00.000Z',
    lastConfirmedAt: '2026-07-28T14:00:00.000Z', // fresh (9 days old)
    // D-20: the cost-to-achieve section — a planned figure plus dated
    // actual entries. With zero realized value so far, this row's net
    // benefit is negative (cost incurred with nothing yet booked against
    // it) — UI-SPEC's documented "real, expected early-deal state, not an
    // error" case, exercised by real seed data rather than left theoretical.
    costPlannedM: 1.2,
    costExpectedMonth: '2026-11',
    costEntries: [
      { date: '2026-05-18', amountM: 0.15, note: 'Third-party feasibility study (site engineering).' },
      { date: '2026-07-02', amountM: 0.22, note: 'Works-council legal advisory retainer.' },
    ],
  },
  {
    id: 'syn_seed_5',
    seq: 4,
    title: 'Retire duplicate IT licences & data-center capacity',
    category: 'cost',
    owner: 'Priya Sharma',
    workstreamId: 'ws_it',
    notes: 'First licence tranche cancelled at renewal.',
    createdAt: '2026-04-25T09:00:00.000Z',
    stage: 'committed',
    runRateM: 3,
    startMonth: '2026-03',
    curveShape: 'cost',
    realizedFillRatio: 0.85, // committed: concrete, quick-to-execute savings already banked
    dealCaseStage: 'idea',
    dealCaseAt: '2026-04-26T10:35:00.000Z',
    // Deliberately stale (D-16/D-17/D-18/D-19): 66 days old against the
    // 30-day default threshold, so the badge, the rollup's unconfirmed
    // split, and the deal-home nudge all have something real to show.
    lastConfirmedAt: '2026-06-01T08:00:00.000Z',
  },
];

// --- The remaining new i18n label keys (UI-SPEC Copywriting Contract) ---
// Every key public/js/execution.js actually references (grep-verified
// against renderSynergy()/buildSynDetail()/renderBaselines()/
// renderCostSection()/renderTaskProgress()/renderSynRollup()) that no
// earlier plan's script landed — scripts/migrate-synergy-stages.js already
// carried the four syn.st_* stage labels and syn.cat_*/syn.of_target/
// syn.realized_lbl/syn.target_ph/syn.title_ph/syn.total_* predate this
// phase, so none of those are repeated here (idempotent no-op guard below
// would skip them anyway). The unconfirmed-split rollup sentence is
// deliberately NOT an i18n key (05-07-SUMMARY.md key-decision: a computed-
// number sentence must never carry a data-i18n attribute an i18n-hydration
// pass could silently overwrite) — there is no key for it to add here.
//
// Every language gets an EXPLICIT value — never left absent. Two of the
// four new stage-label keys were left absent for de/zh/cs by Plan 02's
// migration (a deliberate, DIFFERENT choice documented there), but THIS
// plan's own action text is explicit: "Where no translation is supplied
// for a language, use the English text... an explicit English value keeps
// the admin translation editor honest about what still needs translating."
// So every key below carries a real de/zh/cs translation; none rely on the
// English-fallback no-op.
const NEW_LABELS = {
  'syn.no_phasing': {
    en: 'No phasing rows yet',
    de: 'Noch keine Phasing-Zeilen',
    zh: '暂无阶段化数据行',
    cs: 'Zatím žádné řádky fázování',
  },
  'syn.no_phasing_body': {
    en: 'Enter a run-rate, start month and curve shape, then generate phasing rows to start tracking monthly targets.',
    de: 'Geben Sie eine Run-Rate, einen Startmonat und eine Kurvenform ein und generieren Sie dann Phasing-Zeilen, um monatliche Ziele zu verfolgen.',
    zh: '输入运行速率、开始月份和曲线形状，然后生成阶段化数据行以开始跟踪月度目标。',
    cs: 'Zadejte run-rate, počáteční měsíc a tvar křivky a poté vygenerujte řádky fázování pro sledování měsíčních cílů.',
  },
  'syn.grid_month': { en: 'Month', de: 'Monat', zh: '月份', cs: 'Měsíc' },
  'syn.grid_target': { en: 'Target $', de: 'Ziel $', zh: '目标 $', cs: 'Cíl $' },
  'syn.grid_realized': { en: 'Realized $', de: 'Realisiert $', zh: '已实现 $', cs: 'Realizováno $' },
  'syn.runrate_ph': { en: 'Run-rate $M', de: 'Run-Rate $M', zh: '运行速率（百万美元）', cs: 'Run-rate $M' },
  'syn.generate_btn': {
    en: 'Generate phasing rows',
    de: 'Phasing-Zeilen generieren',
    zh: '生成阶段化数据行',
    cs: 'Generovat řádky fázování',
  },
  'syn.rebaseline_btn': {
    en: 'Re-baseline this initiative',
    de: 'Diese Initiative neu basieren',
    zh: '重新设定此举措的基线',
    cs: 'Přebazovat tuto iniciativu',
  },
  'syn.baselines_heading': { en: 'Baseline history', de: 'Baseline-Verlauf', zh: '基线历史', cs: 'Historie baseline' },
  'syn.no_baseline': {
    en: 'No baseline yet — the deal case is created with the first phased target.',
    de: 'Noch keine Baseline — der Deal-Case wird beim ersten phasierten Ziel erstellt.',
    zh: '暂无基线——首次生成阶段化目标时将创建交易基准案例。',
    cs: 'Zatím žádná baseline — deal case se vytvoří s prvním fázovaným cílem.',
  },
  'syn.baseline_dealcase': { en: 'Deal case', de: 'Deal-Case', zh: '交易基准案例', cs: 'Deal case' },
  'syn.cost_planned_lbl': { en: 'Planned', de: 'Geplant', zh: '计划', cs: 'Plánováno' },
  'syn.cost_expected_lbl': { en: 'expected', de: 'erwartet', zh: '预计', cs: 'očekáváno' },
  'syn.no_costs': {
    en: 'No actual costs logged yet.',
    de: 'Noch keine tatsächlichen Kosten erfasst.',
    zh: '尚未记录实际成本。',
    cs: 'Zatím nejsou zaznamenány žádné skutečné náklady.',
  },
  'syn.cost_amount_ph': { en: 'Amount $M', de: 'Betrag $M', zh: '金额（百万美元）', cs: 'Částka $M' },
  'syn.cost_note_ph': { en: 'Note (optional)', de: 'Notiz (optional)', zh: '备注（可选）', cs: 'Poznámka (volitelné)' },
  'syn.cost_add_btn': {
    en: 'Add cost entry',
    de: 'Kosteneintrag hinzufügen',
    zh: '添加成本条目',
    cs: 'Přidat nákladovou položku',
  },
  'syn.cost_heading': { en: 'Cost to achieve', de: 'Kosten zur Erreichung', zh: '实现成本', cs: 'Náklady na dosažení' },
  'syn.no_tasks': {
    en: 'No tasks linked yet.',
    de: 'Noch keine Aufgaben verknüpft.',
    zh: '尚未关联任务。',
    cs: 'Zatím nejsou propojeny žádné úkoly.',
  },
  'syn.tasks_done': { en: 'tasks done', de: 'Aufgaben erledigt', zh: '项任务已完成', cs: 'úkolů hotovo' },
  'syn.tasks_of': { en: 'of', de: 'von', zh: '共', cs: 'z' },
  'syn.rollup_gross': { en: 'Gross realized', de: 'Brutto realisiert', zh: '总实现值', cs: 'Hrubě realizováno' },
  'syn.rollup_cost': { en: 'Cost incurred', de: 'Angefallene Kosten', zh: '已发生成本', cs: 'Vzniklé náklady' },
  'syn.rollup_net': { en: 'Net benefit', de: 'Nettonutzen', zh: '净收益', cs: 'Čistý přínos' },
  'syn.rollup_target': { en: 'Deal target', de: 'Deal-Ziel', zh: '交易目标', cs: 'Cíl transakce' },
  'syn.stale_badge': { en: 'Stale', de: 'Veraltet', zh: '过期', cs: 'Zastaralé' },
  'syn.confirm_current': {
    en: 'Confirm current',
    de: 'Aktuell bestätigen',
    zh: '确认为最新',
    cs: 'Potvrdit aktuálnost',
  },
};

/**
 * Resolves a list of DISTINCTIVE integration-task title substrings against
 * `conn`'s OWN integrationTasks table, returning the real ids matched — the
 * task ids landed on a seeded initiative are never hard-coded, so they can
 * never dangle (T-05-44) even if a future re-seed of the task lane changes
 * the literal id strings. Throws if any substring has no match, rather than
 * silently seeding a shorter list than the seed data intends.
 */
function resolveTaskIdsByTitleSubstrings(conn, substrings) {
  const rows = conn.prepare('SELECT id, data FROM integrationTasks').all();
  const tasks = rows.map((r) => ({ id: r.id, title: (JSON.parse(r.data) || {}).title || '' }));
  return substrings.map((substr) => {
    const match = tasks.find((t) => t.title.indexOf(substr) !== -1);
    if (!match) {
      throw new Error(
        `scripts/seed-synergy-demo.js: no integration task title contains "${substr}" — refusing to seed a dangling taskId.`
      );
    }
    return match.id;
  });
}

/**
 * Builds the full stored-row shape for one hand-tuned initiative: the ramp
 * (generated, then realized values filled ONLY into already-arrived months
 * per the caller-supplied fill ratio — T-05-42), the derived
 * targetM/realizedM rollup, and the baseline list (one entry, or two when
 * `cfg.rebaseline` is set). `resolvedTaskIds` is pre-resolved by the caller
 * (empty array when the config carries no task-linkage).
 */
function buildInitiativeData(cfg, resolvedTaskIds) {
  const phasing = generatePhasingRows(cfg.runRateM, cfg.startMonth, cfg.curveShape, HORIZON_YEARS);
  if (cfg.realizedFillRatio > 0) {
    for (const row of phasing) {
      if (monthHasArrived(row.month)) {
        row.realizedM = roundSynergyMoney(row.targetM * cfg.realizedFillRatio);
      }
    }
  }
  const targetM = roundSynergyMoney(phasing.reduce((a, r) => a + r.targetM, 0));
  const realizedM = roundSynergyMoney(phasing.reduce((a, r) => a + r.realizedM, 0));

  const baselines = [];
  if (cfg.rebaseline) {
    const rb = cfg.rebaseline;
    const originalPhasing = generatePhasingRows(rb.originalRunRateM, rb.originalStartMonth, rb.originalCurveShape, HORIZON_YEARS);
    baselines.push({
      id: 'bl_' + cfg.id + '_v1',
      version: 1,
      at: cfg.dealCaseAt,
      by: BASELINE_ACTOR,
      stage: cfg.dealCaseStage,
      runRateM: rb.originalRunRateM,
      startMonth: rb.originalStartMonth,
      curveShape: rb.originalCurveShape,
      targetCurve: originalPhasing.map((r) => ({ month: r.month, targetM: r.targetM })),
      reason: null,
    });
    baselines.push({
      id: 'bl_' + cfg.id + '_v2',
      version: 2,
      at: rb.at,
      by: BASELINE_ACTOR,
      stage: cfg.stage,
      runRateM: cfg.runRateM,
      startMonth: cfg.startMonth,
      curveShape: cfg.curveShape,
      targetCurve: phasing.map((r) => ({ month: r.month, targetM: r.targetM })),
      reason: rb.reason,
    });
  } else {
    baselines.push({
      id: 'bl_' + cfg.id + '_v1',
      version: 1,
      at: cfg.dealCaseAt,
      by: BASELINE_ACTOR,
      stage: cfg.dealCaseStage,
      runRateM: cfg.runRateM,
      startMonth: cfg.startMonth,
      curveShape: cfg.curveShape,
      targetCurve: phasing.map((r) => ({ month: r.month, targetM: r.targetM })),
      reason: null,
    });
  }

  const costEntries = (cfg.costEntries || []).map((e, idx) => ({
    id: 'cost_' + cfg.id + '_' + (idx + 1),
    date: e.date,
    amountM: e.amountM,
    note: e.note || '',
  }));

  return {
    id: cfg.id,
    title: cfg.title,
    category: cfg.category,
    targetM,
    realizedM,
    owner: cfg.owner,
    workstreamId: cfg.workstreamId,
    stage: cfg.stage,
    notes: cfg.notes,
    runRateM: cfg.runRateM,
    startMonth: cfg.startMonth,
    curveShape: cfg.curveShape,
    phasing,
    baselines,
    costPlannedM: cfg.costPlannedM != null ? cfg.costPlannedM : 0,
    costExpectedMonth: cfg.costExpectedMonth || '',
    costEntries,
    taskIds: resolvedTaskIds,
    lastConfirmedAt: cfg.lastConfirmedAt,
    createdAt: cfg.createdAt,
  };
}

/**
 * Seeds (or re-seeds) the five hand-tuned demo initiatives into `dbPath`'s
 * `synergyInitiatives` table, removes any OTHER row present there (dev-test
 * debris left over from live verification sessions must never ship inside
 * the maintained demo showcase — D-10 names exactly five), and lands
 * every remaining new i18n label key across all four shipped languages.
 * Opens `dbPath` through openDbFile() (creates the file / applies schema
 * idempotently if it predates this collection). Returns a one-line summary
 * object for the CLI.
 */
function seedSynergyDemo(dbPath) {
  const conn = openDbFile(dbPath, DEAL_SCHEMA_PATH);
  const summary = { rowsWritten: 0, rowsRemoved: 0, languagesTouched: 0, keysAdded: 0 };
  try {
    const run = conn.transaction(() => {
      // --- 1. Remove any synergyInitiatives row outside the five known
      // seed ids (T-05-42/D-10: dev-test debris must never ship inside the
      // maintained demo showcase; idempotent no-op once already clean). ---
      const knownIds = new Set(INITIATIVE_SEEDS.map((c) => c.id));
      const existingRows = conn.prepare('SELECT id FROM synergyInitiatives').all();
      const deleteStmt = conn.prepare('DELETE FROM synergyInitiatives WHERE id = ?');
      for (const row of existingRows) {
        if (!knownIds.has(row.id)) {
          deleteStmt.run(row.id);
          summary.rowsRemoved++;
        }
      }

      // --- 2. Rewrite each of the five hand-tuned rows. -------------------
      const upsertStmt = conn.prepare(
        'INSERT INTO synergyInitiatives (id, project_id, seq, data) VALUES (@id, @project_id, @seq, @data) '
        + 'ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, data = excluded.data'
      );
      for (const cfg of INITIATIVE_SEEDS) {
        const resolvedTaskIds = cfg.taskTitleSubstrings
          ? resolveTaskIdsByTitleSubstrings(conn, cfg.taskTitleSubstrings)
          : [];
        const data = buildInitiativeData(cfg, resolvedTaskIds);
        upsertStmt.run({ id: cfg.id, project_id: '', seq: cfg.seq, data: JSON.stringify(data) });
        summary.rowsWritten++;
      }

      // --- 3. Land the remaining new i18n label keys, EN + an explicit
      // value in every other shipped language (idempotent: a key already
      // present in a language is left untouched). ------------------------
      const i18nRow = conn.prepare("SELECT data FROM app_state WHERE key = 'i18n'").get();
      if (i18nRow) {
        const i18n = JSON.parse(i18nRow.data);
        i18n.strings = i18n.strings || {};
        const languages = Object.keys(i18n.strings);
        let anyTouched = false;
        for (const lang of languages) {
          const strings = i18n.strings[lang];
          let touchedThisLang = false;
          for (const [key, translations] of Object.entries(NEW_LABELS)) {
            if (Object.prototype.hasOwnProperty.call(strings, key)) continue; // idempotent no-op
            strings[key] = translations[lang] || translations.en;
            touchedThisLang = true;
            summary.keysAdded++;
          }
          if (touchedThisLang) { summary.languagesTouched++; anyTouched = true; }
        }
        if (anyTouched) {
          conn.prepare("UPDATE app_state SET data = ? WHERE key = 'i18n'").run(JSON.stringify(i18n));
        }
      }
    });
    run();

    // openDbFile() opens under WAL — without a checkpoint the write
    // lands only in the gitignored -wal sidecar, leaving the COMMITTED
    // dbPath file itself byte-unchanged on disk (the standing WAL trap
    // that has fired repeatedly across this project). A full TRUNCATE
    // checkpoint folds the write back into the main file and clears the
    // sidecar, so `git status`/`git diff` on dbPath sees this change
    // immediately.
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }
  return summary;
}

function main() {
  const target = process.argv[2] || DEMO_DB_PATH;
  const result = seedSynergyDemo(target);
  console.log(
    `Seeded ${target}: ${result.rowsWritten} synergyInitiatives row(s) rewritten, ${result.rowsRemoved} stray row(s) removed, `
    + `${result.keysAdded} i18n key(s) added across ${result.languagesTouched} language(s).`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { seedSynergyDemo, INITIATIVE_SEEDS, NEW_LABELS, generatePhasingRows, monthHasArrived, roundSynergyMoney };
