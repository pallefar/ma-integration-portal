#!/usr/bin/env node
// D-18 (06-08): hand-tunes the demonstration showcase's org lane over the
// five existing demo employees — a current organisation, a target design, a
// decision log spanning the five-value vocabulary (with one reversal), and a
// key-talent flight-risk register — so the most visual thing this phase
// produces is actually demonstrable, following scripts/seed-synergy-demo.js's
// structure exactly.
//
// Narrative (NextGen Sensors Ltd., acquired 2026-05-15): the Managing
// Director seat is vacant post-close pending a succession call; Sarah
// Jenkins (VP Engineering & R&D) and her Director of Sensor Platforms, Alex,
// run engineering; Michael Chang (VP Sales) and Emma Watson (VP Finance)
// round out the leadership team. The target design merges Sales and Finance
// into one Commercial function under Michael and removes the Director
// layer, folding the vacant Senior Engineer seat directly under Sarah — a
// real headcount reduction, not a cosmetic relabeling. Valued Team Member
// (Operations) is deliberately left unmapped to any position, so the
// unassigned-employees bucket has real content.
//
// Usage:
//   node scripts/seed-org-demo.js [path-to-db]
//   Defaults to db/dbFiles.js's DEMO_DB_PATH (data/demo.db) when run with no
//   argument.
//
// Idempotent: every id below is a DETERMINISTIC literal string carrying the
// 'orgseed_' prefix (never server.js's real newId(), which embeds the wall
// clock) — before inserting, every row whose id carries that prefix is
// deleted from all three tables, so a second run reproduces byte-identical
// output and cleans up any debris a prior version of this script left
// behind, mirroring scripts/seed-synergy-demo.js's own re-runnability
// discipline.
'use strict';

const { openDbFile, DEAL_SCHEMA_PATH, DEMO_DB_PATH } = require('../db/dbFiles');

// Real ids from data/demo.db's own `employees` table (settings.demoMode is
// true in the committed demo database, so employeeRosterLane() in server.js
// resolves the `employees` lane, never `customEmployees` — read directly
// rather than assumed, per this task's own read_first instruction).
const EMP_SARAH = 'emp_1'; // Sarah Jenkins, R&D
const EMP_MICHAEL = 'emp_2'; // Michael Chang, Sales
const EMP_EMMA = 'emp_3'; // Emma Watson, Finance
const EMP_ALEX = 'emp_gzgkhkp'; // Alex, R&D
// emp_hfy1yfj (Valued Team Member, Operations) is deliberately left
// unmapped to any position — the unassigned-employees bucket's content.

const BASELINE_ACTOR = 'karen'; // the demo's established Integration Leader persona

// --- Positions (D-06/D-07 identity model: current and target are separate
// records with no shared identity) -----------------------------------------
const POSITION_SEEDS = [
  // Current organisation.
  {
    id: 'orgseed_pos_root',
    title: 'Managing Director, NextGen Sensors',
    level: 'Executive',
    reportsToId: null,
    employeeId: null, // vacant — the prior MD departed at close; succession is an OPEN decision below
    state: 'current',
    createdAt: '2026-05-20T09:00:00.000Z',
  },
  {
    id: 'orgseed_pos_vpeng',
    title: 'VP Engineering & R&D',
    level: 'VP',
    reportsToId: 'orgseed_pos_root',
    employeeId: EMP_SARAH,
    state: 'current',
    createdAt: '2026-05-20T09:00:00.000Z',
  },
  {
    id: 'orgseed_pos_dirplatforms',
    title: 'Director, Sensor Platforms',
    level: 'Director',
    reportsToId: 'orgseed_pos_vpeng',
    employeeId: EMP_ALEX,
    state: 'current',
    createdAt: '2026-05-20T09:00:00.000Z',
  },
  {
    id: 'orgseed_pos_sreng',
    title: 'Senior Engineer, MEMS Sensing',
    level: 'IC',
    reportsToId: 'orgseed_pos_dirplatforms',
    employeeId: null, // vacant — the vacant-element treatment's content
    state: 'current',
    createdAt: '2026-05-20T09:00:00.000Z',
  },
  {
    id: 'orgseed_pos_vpsales',
    title: 'VP Sales',
    level: 'VP',
    reportsToId: 'orgseed_pos_root',
    employeeId: EMP_MICHAEL,
    state: 'current',
    createdAt: '2026-05-20T09:00:00.000Z',
  },
  {
    id: 'orgseed_pos_vpfinance',
    title: 'VP Finance',
    level: 'VP',
    reportsToId: 'orgseed_pos_root',
    employeeId: EMP_EMMA,
    state: 'current',
    createdAt: '2026-05-20T09:00:00.000Z',
  },
  // Target design — visibly different: the Director layer is removed (the
  // Senior Engineer seat reports straight to the VP), and Sales+Finance
  // merge into one Commercial function under Michael. Real headcount
  // reduction: 4 occupied current positions -> 2 occupied target positions.
  {
    id: 'orgseed_pos_tgt_root',
    title: 'Managing Director, NextGen Sensors',
    level: 'Executive',
    reportsToId: null,
    employeeId: null, // succession still open in the target design too
    state: 'target',
    createdAt: '2026-07-25T10:00:00.000Z',
  },
  {
    id: 'orgseed_pos_tgt_vpeng',
    title: 'VP Engineering & R&D',
    level: 'VP',
    reportsToId: 'orgseed_pos_tgt_root',
    employeeId: EMP_SARAH,
    state: 'target',
    createdAt: '2026-07-25T10:00:00.000Z',
  },
  {
    id: 'orgseed_pos_tgt_sreng',
    title: 'Senior Engineer, MEMS Sensing',
    level: 'IC',
    reportsToId: 'orgseed_pos_tgt_vpeng', // Director layer removed — reports straight to the VP now
    employeeId: null,
    state: 'target',
    createdAt: '2026-07-25T10:00:00.000Z',
  },
  {
    id: 'orgseed_pos_tgt_vpcommercial',
    title: 'VP Commercial (Sales & Finance)',
    level: 'VP',
    reportsToId: 'orgseed_pos_tgt_root',
    employeeId: EMP_MICHAEL, // Sales + Finance merged under Michael; Emma's seat does not carry into the target design
    state: 'target',
    createdAt: '2026-07-25T10:00:00.000Z',
  },
];

// --- Decisions (append-only log; D-13 derives the CURRENT decision per
// position as the latest entry by decidedAt, so a reversal is a NEW entry,
// never an edit) -------------------------------------------------------------
// All five ORG_DECISION_TYPES values are represented at least once. Two
// entries share orgseed_pos_dirplatforms (Alex) — an early 'in-selection'
// call, reversed later by a 'redeploy' decision once the July org-design
// workshop confirmed the Director layer's removal — so the history panel
// demonstrates a real reversal with both rationales intact.
const DECISION_SEEDS = [
  {
    id: 'orgseed_dec_vpeng_retain',
    positionId: 'orgseed_pos_vpeng',
    employeeId: EMP_SARAH,
    type: 'retain',
    rationale: 'Sarah’s platform depth and existing NextGen customer relationships make her the natural VP Engineering lead post-close. Retained at current compensation; TE’s existing sensor engineering team folds under her by day 60.',
    decidedBy: BASELINE_ACTOR,
    decidedAt: '2026-06-10T09:00:00.000Z',
    effectiveDate: '2026-06-10',
  },
  {
    id: 'orgseed_dec_dirplatforms_inselection',
    positionId: 'orgseed_pos_dirplatforms',
    employeeId: EMP_ALEX,
    type: 'in-selection',
    rationale: 'Holding a final call on whether the Director of Sensor Platforms layer survives the merge with TE’s existing sensor engineering org until the July org-design workshop confirms reporting lines.',
    decidedBy: BASELINE_ACTOR,
    decidedAt: '2026-06-15T10:00:00.000Z',
    effectiveDate: '',
  },
  {
    id: 'orgseed_dec_dirplatforms_redeploy',
    positionId: 'orgseed_pos_dirplatforms',
    employeeId: EMP_ALEX,
    type: 'redeploy',
    rationale: 'The July workshop confirmed the Director layer is removed in the target design, but Alex’s MEMS sensing expertise is scarce across the combined org — redeploying into TE Sensor Solutions’ platform architecture team rather than treating this as a redundancy.',
    decidedBy: BASELINE_ACTOR,
    decidedAt: '2026-07-22T14:30:00.000Z',
    effectiveDate: '2026-09-01',
  },
  {
    id: 'orgseed_dec_vpsales_retain',
    positionId: 'orgseed_pos_vpsales',
    employeeId: EMP_MICHAEL,
    type: 'retain',
    rationale: 'Retained to lead the combined Commercial function (Sales + Finance oversight), given his track record with the top-3 accounts flagged in the RAID log.',
    decidedBy: BASELINE_ACTOR,
    decidedAt: '2026-06-18T11:00:00.000Z',
    effectiveDate: '2026-06-18',
  },
  {
    id: 'orgseed_dec_vpfinance_redundant',
    positionId: 'orgseed_pos_vpfinance',
    employeeId: EMP_EMMA,
    type: 'redundant',
    rationale: 'Finance folds into the combined Commercial function under Michael; Emma’s controller-level responsibilities transfer to TE’s existing FP&A team. Standard TE severance package applies.',
    decidedBy: BASELINE_ACTOR,
    decidedAt: '2026-07-05T13:00:00.000Z',
    effectiveDate: '2026-09-30',
  },
  {
    id: 'orgseed_dec_root_open',
    positionId: 'orgseed_pos_root',
    employeeId: null,
    type: 'open',
    rationale: 'Leadership succession for the vacant Managing Director seat remains open pending TE’s call on retaining local country management versus consolidating under the existing regional lead. Revisit at day 45.',
    decidedBy: BASELINE_ACTOR,
    decidedAt: '2026-06-01T08:00:00.000Z',
    effectiveDate: '',
  },
];

// --- Flight-risk register (RAID_LEVELS reused verbatim: low/medium/high/
// critical). At least one critical and one high entry carry an EMPTY
// mitigation (the deal-home nudge and the tree border-accent's content);
// one entry is mitigated so both states are visible. orgseed_risk_alex is
// the retention counterpart of the seeded raid_seed_1 RAID risk ("Key
// sensing R&D engineers approached by competitors") — D-15's concrete
// justifying case — and is deliberately left with empty linkedRaidIds/
// linkedTaskIds so the conversion button is demonstrable rather than
// pre-clicked. -----------------------------------------------------------
const FLIGHT_RISK_SEEDS = [
  {
    id: 'orgseed_risk_alex',
    employeeId: EMP_ALEX,
    riskLevel: 'critical',
    owner: 'Karen Peterson',
    mitigation: '', // deliberately empty
    notes: 'Direct counterpart to the RAID log’s "Key sensing R&D engineers approached by competitors" risk — Alex has been named specifically by two recruiters since the acquisition announced. No counter-offer has been made yet.',
    linkedTaskIds: [],
    linkedRaidIds: [],
    createdAt: '2026-06-05T09:00:00.000Z',
  },
  {
    id: 'orgseed_risk_michael',
    employeeId: EMP_MICHAEL,
    riskLevel: 'high',
    owner: 'Karen Peterson',
    mitigation: '', // deliberately empty
    notes: 'Uncertainty over the combined Commercial function’s reporting line and comp structure is fueling flight risk — a competitor approached him directly in early June.',
    linkedTaskIds: [],
    linkedRaidIds: [],
    createdAt: '2026-06-12T10:30:00.000Z',
  },
  {
    id: 'orgseed_risk_sarah',
    employeeId: EMP_SARAH,
    riskLevel: 'medium',
    owner: 'Karen Peterson',
    mitigation: 'Retention bonus (18-month cliff) approved 2026-07-20; expanded scope confirmed in writing to include TE’s existing sensor engineering org.',
    notes: 'Flagged after an informal exit conversation in late June; the retention package and expanded mandate addressed her stated concerns.',
    linkedTaskIds: [],
    linkedRaidIds: [],
    createdAt: '2026-06-28T15:00:00.000Z',
  },
];

// --- The five decision-type translation keys (org.dec_*), all four shipped
// languages, every language carrying an EXPLICIT value — never left to the
// fallback-to-English contract, mirroring scripts/seed-synergy-demo.js's own
// NEW_LABELS precedent. Keys/format match public/js/org.js's
// orgDecisionI18nKey() ('org.dec_' + value.replace(/-/g, '_')) exactly.
const NEW_LABELS = {
  'org.dec_retain': { en: 'Retain', de: 'Halten', zh: '保留', cs: 'Ponechat' },
  'org.dec_redeploy': { en: 'Redeploy', de: 'Versetzen', zh: '调岗', cs: 'Přeřadit' },
  'org.dec_in_selection': { en: 'In Selection', de: 'Im Auswahlverfahren', zh: '甄选中', cs: 'Ve výběru' },
  'org.dec_redundant': { en: 'Redundant', de: 'Freigesetzt', zh: '裁减', cs: 'Nadbytečný' },
  'org.dec_open': { en: 'Open', de: 'Offen', zh: '待定', cs: 'Otevřeno' },
};

/**
 * Seeds (or re-seeds) the hand-tuned org lane and the five decision i18n
 * keys into `dbPath`. Opens `dbPath` through openDbFile() (creates the file/
 * applies schema idempotently if it predates these collections). Returns a
 * one-line summary object for the CLI.
 */
function seedOrgDemo(dbPath) {
  const conn = openDbFile(dbPath, DEAL_SCHEMA_PATH);
  const summary = { positions: 0, decisions: 0, flightRisks: 0, keysAdded: 0, languagesTouched: 0 };
  try {
    const run = conn.transaction(() => {
      // --- 1. Allowlist delete of this script's own prefixed ids before
      // re-insert (idempotent; also removes debris from an earlier version
      // of this script). -------------------------------------------------
      conn.prepare("DELETE FROM orgPositions WHERE id LIKE 'orgseed_%'").run();
      conn.prepare("DELETE FROM orgDecisions WHERE id LIKE 'orgseed_%'").run();
      conn.prepare("DELETE FROM orgFlightRisks WHERE id LIKE 'orgseed_%'").run();

      // --- 2. Positions. ---------------------------------------------------
      const posStmt = conn.prepare(
        'INSERT INTO orgPositions (id, project_id, seq, data) VALUES (@id, NULL, @seq, @data)'
      );
      POSITION_SEEDS.forEach((cfg, idx) => {
        const data = {
          id: cfg.id,
          title: cfg.title,
          level: cfg.level,
          reportsToId: cfg.reportsToId,
          employeeId: cfg.employeeId,
          state: cfg.state,
          createdAt: cfg.createdAt,
        };
        posStmt.run({ id: cfg.id, seq: idx, data: JSON.stringify(data) });
        summary.positions++;
      });

      // --- 3. Decisions. ----------------------------------------------------
      const decStmt = conn.prepare(
        'INSERT INTO orgDecisions (id, project_id, seq, data) VALUES (@id, NULL, @seq, @data)'
      );
      DECISION_SEEDS.forEach((cfg, idx) => {
        const data = {
          id: cfg.id,
          positionId: cfg.positionId,
          employeeId: cfg.employeeId,
          type: cfg.type,
          rationale: cfg.rationale,
          decidedBy: cfg.decidedBy,
          decidedAt: cfg.decidedAt,
          effectiveDate: cfg.effectiveDate,
        };
        decStmt.run({ id: cfg.id, seq: idx, data: JSON.stringify(data) });
        summary.decisions++;
      });

      // --- 4. Flight-risk entries. ------------------------------------------
      const riskStmt = conn.prepare(
        'INSERT INTO orgFlightRisks (id, project_id, seq, data) VALUES (@id, NULL, @seq, @data)'
      );
      FLIGHT_RISK_SEEDS.forEach((cfg, idx) => {
        const data = {
          id: cfg.id,
          employeeId: cfg.employeeId,
          riskLevel: cfg.riskLevel,
          owner: cfg.owner,
          mitigation: cfg.mitigation,
          notes: cfg.notes,
          linkedTaskIds: cfg.linkedTaskIds,
          linkedRaidIds: cfg.linkedRaidIds,
          createdAt: cfg.createdAt,
        };
        riskStmt.run({ id: cfg.id, seq: idx, data: JSON.stringify(data) });
        summary.flightRisks++;
      });

      // --- 5. The five decision-label i18n keys, EN + an explicit value in
      // every other shipped language (idempotent: a key already present in a
      // language is left untouched, matching seed-synergy-demo.js). --------
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

    // openDbFile() opens under WAL — without a checkpoint the write lands
    // only in the gitignored -wal sidecar, leaving the COMMITTED dbPath file
    // itself byte-unchanged on disk (the standing WAL trap that has fired
    // repeatedly across this project). A full TRUNCATE checkpoint folds the
    // write back into the main file and clears the sidecar, so
    // `git status`/`git diff` on dbPath sees this change immediately.
    conn.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    conn.close();
  }
  return summary;
}

function main() {
  const target = process.argv[2] || DEMO_DB_PATH;
  const result = seedOrgDemo(target);
  console.log(
    `Seeded ${target}: ${result.positions} orgPositions row(s), ${result.decisions} orgDecisions row(s), `
    + `${result.flightRisks} orgFlightRisks row(s) written, ${result.keysAdded} i18n key(s) added across `
    + `${result.languagesTouched} language(s).`
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

module.exports = { seedOrgDemo, POSITION_SEEDS, DECISION_SEEDS, FLIGHT_RISK_SEEDS, NEW_LABELS };
