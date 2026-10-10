'use strict';
// R5-01 / R5-05 review-profile reconstruction (Phase 12, plan 12-02): seeds a real
// deal's database file to the volume the v3.0 review measured at — 1,000 tasks,
// 5,000 RAID entries, 200 org positions — so the write-amplification and read
// budgets are measured against a deal the size a live acquisition reaches, not a
// fresh one (a fresh deal made a create look free: 17 audit rows / 7.7 ms).
//
// Seeds bypass writeDb()/the audit hook ON PURPOSE: this is a fixture loading
// rows into a file, not a user write — routing 6,200 rows through the audited
// path would produce 6,200 audit rows and defeat the measurement it exists for.
//
// The lanes a real deal uses are chosen by the SAME rule as server.js
// taskLane()/raidLane(): `settings.demoMode === false` -> the custom* lanes,
// anything else (a deal's identity-only settings carry no demoMode at all) ->
// the standard lanes. R5 first seeded the wrong lane and had to move rows; this
// applies the deal's own settings so the volume lands where the handlers read.
//
// Shapes follow the R5 scratch `perf.js` profile (and the shapes POST /api/raid,
// POST /api/integration-tasks and POST /api/org/positions themselves create).
// No dependency beyond better-sqlite3 and node core.

const Database = require('better-sqlite3');

const TASK_STATUSES = ['todo', 'doing', 'done'];
const RAID_TYPES = ['risk', 'issue', 'decision', 'dependency'];
const RAID_LEVELS = ['low', 'medium', 'high'];

function pad(n, width) { return String(n).padStart(width, '0'); }

function nextSeq(conn, table) {
  const row = conn.prepare(`SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM ${table}`).get();
  return row.next;
}

/**
 * Insert `tasks` integration tasks, `raid` RAID entries and `positions` org
 * positions directly into the deal database at `dealDbPath`, into the lanes the
 * deal's own settings select, with `seq` continuing after the current max.
 *
 * @param {{ dealDbPath: string, tasks?: number, raid?: number, positions?: number }} o
 * @returns {{ taskLane: string, raidLane: string, positionLane: string, counts: { tasks: number, raid: number, positions: number } }}
 */
function seedVolumeDeal({ dealDbPath, tasks = 1000, raid = 5000, positions = 200 } = {}) {
  if (!dealDbPath) throw new Error('seedVolumeDeal: dealDbPath is required');
  const conn = new Database(dealDbPath, { fileMustExist: true });
  try {
    conn.pragma('busy_timeout = 5000');
    conn.pragma('journal_mode = WAL');

    const settingsRow = conn.prepare("SELECT data FROM app_state WHERE key = 'settings'").get();
    const settings = settingsRow ? JSON.parse(settingsRow.data) : {};
    const isCustom = settings && settings.demoMode === false;
    const taskLane = isCustom ? 'customIntegrationTasks' : 'integrationTasks';
    const raidLane = isCustom ? 'customRaidEntries' : 'raidEntries';
    const positionLane = 'orgPositions';

    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const stamp = (i) => new Date(base + i * 60000).toISOString();

    const insertTask = conn.prepare(`INSERT INTO ${taskLane} (id, project_id, seq, data) VALUES (?, NULL, ?, ?)`);
    const insertRaid = conn.prepare(`INSERT INTO ${raidLane} (id, project_id, seq, data) VALUES (?, NULL, ?, ?)`);
    const insertPos = conn.prepare(`INSERT INTO ${positionLane} (id, project_id, seq, data) VALUES (?, NULL, ?, ?)`);

    const seed = conn.transaction(() => {
      let seq = nextSeq(conn, taskLane);
      for (let i = 0; i < tasks; i++) {
        const id = `vol_task_${pad(i, 5)}`;
        insertTask.run(id, seq++, JSON.stringify({
          id,
          title: `Volume task ${i}`,
          workstreamId: 'ws_imo',
          phase: 'd30',
          owner: `Owner ${i % 20}`,
          due: `2026-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
          status: TASK_STATUSES[i % TASK_STATUSES.length],
          source: 'manual',
          createdAt: stamp(i),
        }));
      }

      seq = nextSeq(conn, raidLane);
      for (let i = 0; i < raid; i++) {
        const id = `vol_raid_${pad(i, 5)}`;
        insertRaid.run(id, seq++, JSON.stringify({
          id,
          type: RAID_TYPES[i % RAID_TYPES.length],
          title: `Volume RAID entry ${i}`,
          severity: RAID_LEVELS[i % RAID_LEVELS.length],
          probability: 'medium',
          owner: `Owner ${i % 30}`,
          workstreamId: 'ws_ops',
          status: 'open',
          notes: `Seeded for the Phase 12 volume profile — entry ${i}. Mitigation under review with the workstream lead.`,
          source: '',
          createdAt: stamp(i),
        }));
      }

      seq = nextSeq(conn, positionLane);
      for (let i = 0; i < positions; i++) {
        const id = `vol_pos_${pad(i, 4)}`;
        // Two trees (one per state): a position reports to a position of the
        // SAME state (positionGraphFailure() refuses a cross-state parent).
        const state = i % 2 === 0 ? 'current' : 'target';
        const g = Math.floor(i / 2);
        const parentIndex = g === 0 ? null : (Math.floor((g - 1) / 3) * 2) + (i % 2);
        insertPos.run(id, seq++, JSON.stringify({
          id,
          title: `Position ${i}`,
          level: `L${(i % 6) + 1}`,
          reportsToId: parentIndex === null ? null : `vol_pos_${pad(parentIndex, 4)}`,
          employeeId: null,
          state,
          createdAt: stamp(i),
        }));
      }
    });
    seed();

    // Fold the WAL into the main file so a later copy/size reading is honest
    // (the WAL trap: a write can sit only in the -wal sidecar).
    conn.pragma('wal_checkpoint(TRUNCATE)');

    return { taskLane, raidLane, positionLane, counts: { tasks, raid, positions } };
  } finally {
    conn.close();
  }
}

module.exports = { seedVolumeDeal };
