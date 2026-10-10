// Phase 9 gap closure (plan 09-11, R7 F-2 / GD-4): the fetch wrapper HOLDS the
// caller's promise while the conflict dialog is open and settles it with the
// outcome of the user's decision, so the page reflects the server's state with
// no per-page wiring. Scenario module loaded by scripts/uat/phase9-walk.js.
//
// Row identification rule (all Phase 9 scenario modules): assert dialog rows
// by their mine/theirs VALUES, never by label text — plan 09-13 changes the
// labels.

'use strict';

const RAID_LABEL = { open: 'Open', mitigating: 'Mitigating', closed: 'Closed' };

// Seeds a RAID entry and stamps it to version 1 through the API seeder
// session (the `version: 0` precondition is what the strict server wants).
async function seedStampedRaid(ctx, title) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { title, type: 'risk', severity: 'high', owner: 'seed' });
  if (res.status !== 201 || !res.json || !res.json.entry) throw new Error('RAID seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  const stamp = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { id: res.json.entry.id, notes: 'stamp', version: 0 });
  if (stamp.status !== 200 || !stamp.json || !stamp.json.entry || stamp.json.entry.version !== 1) {
    throw new Error('RAID stamp failed: ' + stamp.status + ' ' + JSON.stringify(stamp.json));
  }
  return stamp.json.entry;
}

async function getRaid(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/raid');
  return (res.json || []).find((r) => r.id === id);
}

function lastRequest(page, method) {
  const all = page.requests.filter((r) => r.method === method);
  return all[all.length - 1];
}

async function openRaidTab(ctx, opts) {
  const page = await ctx.openTab(Object.assign({ viewport: { width: 1440, height: 900 }, path: '/execution.html' }, opts || {}));
  await page.click('.ex-tab[data-ex-tab="raid"]');
  return page;
}

async function rowStatusText(page, id) {
  return page.evaluate((rid) => {
    const el = document.querySelector(`.raid-row[data-raid="${rid}"] .raid-status`);
    return el ? el.textContent.trim() : null;
  }, id);
}

module.exports = {
  // R7 F-2a: B flips a row A already changed -> dialog -> Apply. The dialog
  // closes, B's row shows the SERVER's resulting status, and B's next flip
  // carries the fresh version (no false self-conflict).
  async 'raid-f2-apply'(ctx) {
    const entry = await seedStampedRaid(ctx, 'F-2 apply entry');
    const a = await openRaidTab(ctx);
    const b = await openRaidTab(ctx);
    await a.waitForSelector(`.raid-row[data-raid="${entry.id}"]`, { timeout: 10000 });
    await b.waitForSelector(`.raid-row[data-raid="${entry.id}"]`, { timeout: 10000 });

    await a.click(`.raid-row[data-raid="${entry.id}"] .raid-status`);
    await ctx.sleep(600);
    const aReq = lastRequest(a, 'POST');
    ctx.check('A flip 200', !!aReq && aReq.status === 200, aReq && aReq.status);

    await b.click(`.raid-row[data-raid="${entry.id}"] .raid-status`);
    const dlg = await ctx.waitDialog(b);
    ctx.check('dialog shown', !!dlg && dlg.overlays === 1, dlg && dlg.overlays);
    await ctx.shot(b, 'raid-f2-apply-dialog-1440.png');

    const reqsBeforeApply = b.requests.length;
    await b.click('.conflict-modal .conflict-btn-apply');
    ctx.check('dialog closes after Apply', await ctx.waitNoDialog(b));
    await ctx.sleep(400);

    const server = await getRaid(ctx, entry.id);
    const expectedLabel = RAID_LABEL[server && server.status];
    const label = await rowStatusText(b, entry.id);
    ctx.check('after Apply row shows server status', !!server && !!expectedLabel && label === expectedLabel,
      { serverStatus: server && server.status, serverVersion: server && server.version, rowLabel: label });
    const applyReq = b.requests.slice(reqsBeforeApply).find((r) => r.method === 'POST');
    ctx.check('Apply reapplied with the fresh version', !!applyReq && applyReq.status === 200 && applyReq.request && applyReq.request.version === 2,
      applyReq && { status: applyReq.status, version: applyReq.request && applyReq.request.version });

    // The next flip in the SAME tab must carry the version the Apply produced.
    const before = b.requests.length;
    await b.click(`.raid-row[data-raid="${entry.id}"] .raid-status`);
    await ctx.sleep(700);
    const next = b.requests.slice(before).find((r) => r.method === 'POST');
    ctx.check('next flip 200 without overlay',
      !!next && next.status === 200 && next.request && next.request.version === server.version && (await ctx.overlayCount(b)) === 0,
      next && { status: next.status, sentVersion: next.request && next.request.version, serverVersion: server.version });
    ctx.check('no page errors', b.pageErrors.length === 0, b.pageErrors);
  },
};
