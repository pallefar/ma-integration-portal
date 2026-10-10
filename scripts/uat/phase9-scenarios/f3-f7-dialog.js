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

// Fulfils any request matching `pattern` with the given JSON body. Used to time
// bodies a browser cannot otherwise produce on demand (the cross-process
// WHERE-layer 409 with a null record, a 403 on reapply, a deleted-record 409)
// — the same documented bodies R7 rendered by hand.
async function fulfillJson(page, pattern, status, body) {
  await page.route(pattern, (route) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body),
  }));
}

// Fires a write from inside the page through the REAL wrapped window.fetch
// without awaiting it (the promise is held while the dialog is open).
async function fireWrite(page, url, payload, method) {
  await page.evaluate(([u, p, m]) => {
    window.__heldWrite = window.fetch(u, {
      method: m || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: p === null ? undefined : JSON.stringify(p),
    });
  }, [url, payload, method || 'POST']);
}

const conflictBody = (over) => Object.assign({
  conflict: true, conflictKind: 'version', currentVersion: 9, error: 'Conflict',
  currentRecord: { id: 'x' }, changedBy: 'karen', changedAt: new Date().toISOString(),
}, over || {});

// Writes through the seeder's API session — the "other user" in scenarios where
// a second browser tab adds nothing but a login.
async function apiBump(ctx, id, patch, version) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', Object.assign({ id, version }, patch));
  if (res.status !== 200) throw new Error('api bump failed: ' + res.status + ' ' + JSON.stringify(res.json));
  return res.json && res.json.initiative;
}

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

  // R7 F-3 / GD-6: a `{version}`-only payload names no record field. The old
  // dialog claimed the change "did not affect anything you edited"; the
  // neutral panel says only that the record changed — once — and Apply stays.
  async 'confirm-current-neutral-f3'(ctx) {
    const item = await seedSynergy(ctx, 'F-3 confirm-current conflict');
    const b = await openSynergyTab(ctx, item.id);
    // The other user advances the stage (stamps a new version) after B loaded.
    const bumped = await apiBump(ctx, item.id, { notes: 'edited by someone else' }, item.version);
    ctx.check('other user stamped a newer version', !!bumped && bumped.version > item.version, bumped && bumped.version);

    await b.click(`.syn-card[data-syn="${item.id}"] .syn-confirm-btn`);
    const dlg = await ctx.waitDialog(b);
    const facts = await dialogFacts(b);
    const req = lastRequest(b, 'POST');
    ctx.check('request was confirm-current with only a version', !!req && /confirm-current$/.test(req.url) && Object.keys(req.request || {}).join(',') === 'version', req && { url: req.url, body: req.request });
    ctx.check('409 conflict:true', !!req && req.status === 409 && req.response && req.response.conflict === true, req && req.status);
    ctx.check('no diff rows', !!dlg && dlg.rows.length === 0, dlg && dlg.rows);
    ctx.check('neutral sentence exactly once', countOf(facts.text, NEUTRAL) === 1, countOf(facts.text, NEUTRAL));
    ctx.check('Apply my changes anyway present', !!dlg && dlg.buttons.some((x) => /conflict-btn-apply/.test(x.cls)), dlg && dlg.buttons);
    ctx.check('retired sentence absent', !facts.text.includes(RETIRED_SENTENCE) && !facts.text.includes('without affecting anything you edited'), facts.text.slice(0, 160));
    await ctx.shot(b, 'confirm-current-neutral-f3-1440.png');
    await b.click('.conflict-modal .conflict-btn-discard');
    ctx.check('dialog closes on Discard', await ctx.waitNoDialog(b));
  },

  // R7 F-3 (code-traced only until now): a per-month phasing conflict must
  // compare the month CELL, never the initiative's total of the same name.
  async 'phasing-month-f3'(ctx) {
    const item = await seedSynergy(ctx, 'F-3 phasing month conflict', { phased: true });
    const month = '2026-01';
    const cell = `.syn-card[data-syn="${item.id}"] .syn-detail .syn-grid-row .syn-target-input[data-syn-month="${month}"]`;
    const a = await openSynergyTab(ctx, item.id);
    const b = await openSynergyTab(ctx, item.id);
    for (const page of [a, b]) {
      await page.click(`.syn-card[data-syn="${item.id}"] .syn-expand-toggle`);
      await page.waitForSelector(cell, { timeout: 10000 });
    }

    await a.fill(cell, '7');
    await a.press(cell, 'Tab'); // blur fires the one natural change event
    await ctx.sleep(800);
    const aReq = lastRequest(a, 'POST');
    ctx.check('A month write 200', !!aReq && aReq.status === 200 && /\/phasing\/2026-01$/.test(aReq.url), aReq && { url: aReq.url, status: aReq.status });
    const total = (await getSynergy(ctx, item.id) || {}).targetM;

    await b.fill(cell, '9');
    await b.press(cell, 'Tab'); // one natural change event (a synthetic one would fire a second on blur)
    const dlg = await ctx.waitDialog(b);
    const row = dlg && dlg.rows.find((r) => r.label === 'Target (M) · ' + month);
    ctx.check('one overlay', !!dlg && dlg.overlays === 1, dlg && dlg.overlays);
    ctx.check('row labelled with the month', !!row, dlg && dlg.rows);
    ctx.check('mine = B\'s cell value', !!row && row.mine === '9', row);
    ctx.check('theirs = A\'s cell value, not the total', !!row && row.theirs === '7' && String(row.theirs) !== String(total), { row, total });
    await ctx.shot(b, 'phasing-month-f3-1440.png');
    await b.click('.conflict-modal .conflict-btn-discard');
    ctx.check('dialog closes on Discard', await ctx.waitNoDialog(b));
  },

  // R7 F-5: display labels, not JSON keys — on two real surfaces.
  async 'labels-f5'(ctx) {
    // (a) the header Realized input of an un-phased initiative.
    const item = await seedSynergy(ctx, 'F-5 labels realized');
    const b = await openSynergyTab(ctx, item.id);
    const realized = `.syn-card[data-syn="${item.id}"] .syn-head .syn-realized-input`;
    await b.waitForSelector(realized, { timeout: 10000 });
    const bumped = await apiBump(ctx, item.id, { realizedM: 3 }, item.version);
    ctx.check('other user stamped realized 3', !!bumped && bumped.realizedM === 3, bumped && bumped.realizedM);
    await b.fill(realized, '5');
    await b.press(realized, 'Tab');
    const dlg = await ctx.waitDialog(b);
    const row = dlg && dlg.rows.find((r) => r.label === 'Realized (M)');
    ctx.check('Realized (M) label', !!row, dlg && dlg.rows);
    ctx.check('values mine 5 / theirs 3', !!row && row.mine === '5' && row.theirs === '3', row);
    await ctx.shot(b, 'labels-f5-realized-1440.png');
    await b.click('.conflict-modal .conflict-btn-discard');
    ctx.check('realized dialog closes', await ctx.waitNoDialog(b));

    // (b) a due-diligence request item's due date.
    const created = await ctx.api(ctx.seeder.cookie, 'POST', '/api/dd/request-items', { area: 'legal', text: 'F-5 DD due-date item', owner: 'seed' });
    if (created.status !== 201) throw new Error('DD item seed failed: ' + created.status + ' ' + JSON.stringify(created.json));
    const ddId = created.json.item.id;
    const stamp = await ctx.api(ctx.seeder.cookie, 'POST', '/api/dd/request-items', { id: ddId, notes: 'stamp', version: 0 });
    if (stamp.status !== 200) throw new Error('DD item stamp failed: ' + stamp.status + ' ' + JSON.stringify(stamp.json));
    const dd = await openTabPatient(ctx, { viewport: { width: 1440, height: 900 }, path: '/due-diligence.html' });
    const due = dd.locator('.dd-item', { hasText: 'F-5 DD due-date item' }).locator('input[type="date"]');
    await due.waitFor({ timeout: 10000 });
    const other = await ctx.api(ctx.seeder.cookie, 'POST', '/api/dd/request-items', { id: ddId, dueDate: '2026-12-01', version: stamp.json.item.version });
    ctx.check('other user set due date', other.status === 200, other.status);
    await due.fill('2026-12-15');
    const dlg2 = await ctx.waitDialog(dd);
    const row2 = dlg2 && dlg2.rows.find((r) => r.label === 'Due date');
    ctx.check('Due date label', !!row2, dlg2 && dlg2.rows);
    ctx.check('values mine 2026-12-15 / theirs 2026-12-01', !!row2 && row2.mine === '2026-12-15' && row2.theirs === '2026-12-01', row2);
    await ctx.shot(dd, 'labels-f5-duedate-1440.png');
    await dd.click('.conflict-modal .conflict-btn-discard');
    ctx.check('due-date dialog closes', await ctx.waitNoDialog(dd));
  },

  // R7 F-4: a withheld record (documented WHERE-layer body, currentRecord null)
  // shows attribution + the clearance sentence, never a diff, never Apply.
  async 'withheld-f4'(ctx) {
    const item = await seedSynergy(ctx, 'F-4 withheld record');
    const b = await openSynergyTab(ctx, item.id);
    await fulfillJson(b, '**/api/synergies/*/stage', 409, conflictBody({ currentRecord: null, currentVersion: item.version + 1 }));
    await b.click(`.syn-card[data-syn="${item.id}"] .syn-stage`);
    const dlg = await ctx.waitDialog(b);
    const facts = await dialogFacts(b);
    ctx.check('one overlay', !!dlg && dlg.overlays === 1, dlg && dlg.overlays);
    ctx.check('title is the edit title', !!dlg && dlg.title === 'Someone else updated this', dlg && dlg.title);
    ctx.check('attribution still shown', !!dlg && /Changed by karen/.test(dlg.attribution || ''), dlg && dlg.attribution);
    ctx.check('withheld sentence shown', facts.text.includes('This record is no longer within your clearance; your change cannot be applied.'), facts.text.slice(0, 200));
    ctx.check('no diff rows', !!dlg && dlg.rows.length === 0, dlg && dlg.rows);
    ctx.check('no Apply / Delete anyway', !!dlg && !dlg.buttons.some((x) => /conflict-btn-apply|conflict-btn-delete/.test(x.cls)), dlg && dlg.buttons);
    ctx.check('exactly one button, Close', !!dlg && dlg.buttons.length === 1 && dlg.buttons[0].text === 'Close', dlg && dlg.buttons);
    ctx.check('retired sentence absent', !facts.text.includes(RETIRED_SENTENCE), facts.text.slice(0, 120));
    await ctx.shot(b, 'withheld-f4-1440.png');
    await b.click('.conflict-modal .conflict-btn-discard');
    ctx.check('Close closes the dialog', await ctx.waitNoDialog(b));
  },

  // R7 F-4: a real first 409, then the reapply is refused with 403 {error}. The
  // banner must carry the server's reason, not "a network error occurred".
  async 'reapply-4xx-f4'(ctx) {
    const item = await seedSynergy(ctx, 'F-4 reapply refused');
    const b = await openSynergyTab(ctx, item.id);
    const bumped = await apiBump(ctx, item.id, { notes: 'moved on' }, item.version);
    ctx.check('other user stamped a newer version', !!bumped && bumped.version > item.version, bumped && bumped.version);
    await b.click(`.syn-card[data-syn="${item.id}"] .syn-stage`);
    const dlg = await ctx.waitDialog(b);
    ctx.check('real first 409 -> dialog with an Apply', !!dlg && dlg.buttons.some((x) => /conflict-btn-apply/.test(x.cls)), dlg && dlg.buttons);

    const reason = 'You are not cleared for that due-diligence area.';
    await fulfillJson(b, '**/api/synergies/*/stage', 403, { error: reason });
    await b.click('.conflict-modal .conflict-btn-apply');
    await ctx.sleep(700);
    const after = await ctx.readDialog(b);
    ctx.check('banner shows the server reason', !!after && after.banner === "That didn't go through — You are not cleared for that due-diligence area. Your edits are still here; review the fresh values below and try again.", after && after.banner);
    ctx.check('banner is not a network error', !!after && !/network error/.test(after.banner || ''), after && after.banner);
    ctx.check('dialog still open, still one overlay', !!after && after.overlays === 1, after && after.overlays);
    await ctx.shot(b, 'reapply-4xx-f4-1440.png');
    await b.unroute('**/api/synergies/*/stage');
    await b.click('.conflict-modal .conflict-btn-discard');
    ctx.check('dialog closes on Discard', await ctx.waitNoDialog(b));
  },

  // R7 F-7: the deleted variant — new title, existing intro, no attribution.
  async 'deleted-variant-f7'(ctx) {
    const item = await seedSynergy(ctx, 'F-7 deleted variant');
    const b = await openSynergyTab(ctx, item.id);
    await fulfillJson(b, '**/api/synergies/*/stage', 409, conflictBody({ conflictKind: 'deleted', currentRecord: null, changedBy: null, changedAt: null }));
    await b.click(`.syn-card[data-syn="${item.id}"] .syn-stage`);
    const dlg = await ctx.waitDialog(b);
    const facts = await dialogFacts(b);
    const attributionCount = await b.evaluate(() => document.querySelectorAll('.conflict-modal-attribution').length);
    ctx.check('title is "Someone else deleted this"', !!dlg && dlg.title === 'Someone else deleted this', dlg && dlg.title);
    ctx.check('no attribution element', attributionCount === 0, attributionCount);
    ctx.check('intro kept', facts.text.includes('Someone else deleted this record before your change could be saved.'), facts.text.slice(0, 200));
    ctx.check('contradictory fallback line absent', !facts.text.includes(NEUTRAL), facts.text.slice(0, 200));
    ctx.check('exactly one button, Close', !!dlg && dlg.buttons.length === 1 && dlg.buttons[0].text === 'Close', dlg && dlg.buttons);
    await ctx.shot(b, 'deleted-variant-f7-1440.png');
    await b.click('.conflict-modal .conflict-btn-discard');
    ctx.check('Close closes the dialog', await ctx.waitNoDialog(b));
  },

  // Visual contract: edit (with labels), withheld and deleted variants at
  // desktop and phone widths — each must fit the viewport with no horizontal
  // scroll. One tab, bodies fulfilled by route so the variants are exact.
  async 'dialog-widths'(ctx) {
    const item = await seedSynergy(ctx, 'F-5 widths', { phased: true });
    const page = await openSynergyTab(ctx, item.id);
    const pattern = '**/api/synergies/**';
    const variants = [
      {
        name: 'edit',
        url: `/api/synergies/${item.id}/phasing/2026-01`,
        payload: { targetM: 9.5, realizedM: 2, version: item.version },
        body: conflictBody({ currentRecord: { id: item.id, phasing: [{ month: '2026-01', targetM: 0.2, realizedM: 0 }] } }),
        expect: (d) => d.rows.length === 2 && d.rows.every((r) => / · 2026-01$/.test(r.label)),
      },
      {
        name: 'withheld',
        url: `/api/synergies/${item.id}/stage`,
        payload: { targetStage: 'validated', version: item.version },
        body: conflictBody({ currentRecord: null }),
        expect: (d) => d.rows.length === 0 && d.buttons.length === 1,
      },
      {
        name: 'deleted',
        url: `/api/synergies/${item.id}/stage`,
        payload: { targetStage: 'validated', version: item.version },
        body: conflictBody({ conflictKind: 'deleted', currentRecord: null, changedBy: null, changedAt: null }),
        expect: (d) => d.title === 'Someone else deleted this' && d.buttons.length === 1,
      },
    ];
    for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await ctx.sleep(300);
      for (const v of variants) {
        await fulfillJson(page, pattern, 409, v.body);
        await fireWrite(page, v.url, v.payload);
        const dlg = await ctx.waitDialog(page);
        const fit = await ctx.fitCheck(page);
        ctx.check(`${v.name} @${size.width}: variant content`, !!dlg && v.expect(dlg), dlg && { title: dlg.title, rows: dlg.rows, buttons: dlg.buttons.length });
        ctx.check(`${v.name} @${size.width}: fits the viewport`, fit.noHorizontalScroll && fit.dialogInside, fit);
        await ctx.shot(page, `dialog-widths-${v.name}-${size.width}.png`);
        await page.click('.conflict-modal .conflict-btn-discard');
        await ctx.waitNoDialog(page, 400);
        await page.unroute(pattern);
      }
    }
  },
};
