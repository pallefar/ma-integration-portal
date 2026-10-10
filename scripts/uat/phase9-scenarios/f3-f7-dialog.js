// Phase 9 gap closure (plan 09-13, R7 F-3 / F-4 / F-5 / F-7 / GD-6..GD-10): the
// conflict dialog tells the truth. Scenario module loaded by
// scripts/uat/phase9-walk.js.
//
// Wave note: plan 09-12 (client sweep) runs in the same wave and may not be
// merged into the worktree this module runs in, so a page may still omit the
// version precondition for a record that carries none — which the strict
// server answers with 400, not 409. Every record seeded here is therefore
// STAMPED to version >= 1 through the API before any tab loads it.

'use strict';

const NEUTRAL = 'This record changed since you loaded it.';
const RETIRED_SENTENCE = 'No conflicting fields';

// The server throttles /api/auth/login to 8 attempts per minute per source and
// every openTab() logs in, so a multi-tab scenario can legitimately meet a 429
// from the harness's own logins (not a product defect). Wait out the window
// and retry rather than failing the scenario (same approach as f2-wrapper.js).
async function openTabPatient(ctx, opts) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ctx.openTab(opts);
    } catch (e) {
      if (attempt >= 2 || !/\b429\b/.test(String(e && e.message))) throw e;
      await ctx.sleep(62000);
    }
  }
}

function lastRequest(page, method) {
  const all = page.requests.filter((r) => r.method === method);
  return all[all.length - 1];
}

// Creates an initiative through the API seeder session and stamps it to
// version >= 1. `phased: true` generates a phasing grid (which also stamps);
// otherwise a no-op notes write stamps it with the `version: 0` precondition.
async function seedSynergy(ctx, title, opts) {
  const o = opts || {};
  const created = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', { title, owner: 'karen', category: 'cost', targetM: 1 });
  if (created.status !== 201 || !created.json || !created.json.initiative) {
    throw new Error('synergy seed failed: ' + created.status + ' ' + JSON.stringify(created.json));
  }
  const id = created.json.initiative.id;
  let stamp;
  if (o.phased) {
    stamp = await ctx.api(ctx.seeder.cookie, 'POST', `/api/synergies/${encodeURIComponent(id)}/generate-phasing`,
      { runRateM: 2.4, startMonth: '2026-01', curveShape: 'linear', version: 0 });
  } else {
    stamp = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', { id, notes: 'stamp', version: 0 });
  }
  if (stamp.status !== 200) throw new Error('synergy stamp failed: ' + stamp.status + ' ' + JSON.stringify(stamp.json));
  const item = await getSynergy(ctx, id);
  if (!item || !(item.version >= 1)) throw new Error('synergy not stamped: ' + JSON.stringify(item && item.version));
  return item;
}

async function getSynergy(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/synergies');
  const list = Array.isArray(res.json) ? res.json : ((res.json && (res.json.initiatives || res.json.items)) || []);
  return list.find((s) => s.id === id);
}

async function openSynergyTab(ctx, id, opts) {
  const page = await openTabPatient(ctx, Object.assign({ viewport: { width: 1440, height: 900 }, path: '/execution.html' }, opts || {}));
  await page.click('.ex-tab[data-ex-tab="synergy"]');
  await page.waitForSelector(`.syn-card[data-syn="${id}"]`, { timeout: 10000 });
  return page;
}

// Whether the open dialog shows the neutral panel, and its whole text.
async function dialogFacts(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.conflict-modal');
    return {
      neutralPanels: document.querySelectorAll('.conflict-diff-empty').length,
      text: m ? m.textContent : '',
    };
  });
}

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

module.exports = {
  // R7 F-3: the stage route's payload says `targetStage`, the record says
  // `stage`. A advances the initiative two stages; B (stale, still `idea`)
  // requests the next stage and must see a 'Stage' row comparing the stage it
  // asked for with the one now on the server.
  async 'synergy-stage-f3'(ctx) {
    const item = await seedSynergy(ctx, 'F-3 stage conflict', { phased: true });
    const a = await openSynergyTab(ctx, item.id);
    const b = await openSynergyTab(ctx, item.id);

    await a.click(`.syn-card[data-syn="${item.id}"] .syn-stage`);
    await ctx.sleep(800);
    await a.click(`.syn-card[data-syn="${item.id}"] .syn-stage`);
    await ctx.sleep(800);
    const serverStage = (await getSynergy(ctx, item.id) || {}).stage;
    ctx.check('A advanced the initiative to committed', serverStage === 'committed', serverStage);

    await b.click(`.syn-card[data-syn="${item.id}"] .syn-stage`);
    const dlg = await ctx.waitDialog(b);
    const facts = await dialogFacts(b);
    const row = dlg && dlg.rows.find((r) => r.label === 'Stage');
    ctx.check('dialog opened (one overlay)', !!dlg && dlg.overlays === 1, dlg && dlg.overlays);
    ctx.check('Stage row present', !!row, dlg && dlg.rows);
    ctx.check('mine = the stage B asked for', !!row && row.mine === 'validated', row);
    ctx.check('theirs = server stage', !!row && row.theirs === serverStage, row);
    ctx.check('no neutral panel', facts.neutralPanels === 0, facts.neutralPanels);
    ctx.check('retired sentence absent', !facts.text.includes(RETIRED_SENTENCE), facts.text.slice(0, 120));
    await ctx.shot(b, 'synergy-stage-f3-1440.png');

    await b.click('.conflict-modal .conflict-btn-discard');
    ctx.check('dialog closes on Discard', await ctx.waitNoDialog(b));
    const after = await getSynergy(ctx, item.id);
    ctx.check('A\'s stage survived (no clobber)', !!after && after.stage === 'committed', after && after.stage);
  },
};
