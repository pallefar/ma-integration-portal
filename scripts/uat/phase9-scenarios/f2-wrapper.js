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

// The server throttles /api/auth/login to 8 attempts per minute per source and
// every openTab() logs in, so a multi-tab scenario can legitimately meet a 429
// from the harness's own logins (not a product defect). Wait out the window
// and retry rather than failing the scenario.
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

async function openRaidTab(ctx, opts) {
  const page = await openTabPatient(ctx, Object.assign({ viewport: { width: 1440, height: 900 }, path: '/execution.html' }, opts || {}));
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

  // R7 F-2c: B deletes a row A already changed -> stale-delete dialog ->
  // Delete anyway. The row leaves B's DOM and the API.
  async 'raid-f2-delete-anyway'(ctx) {
    await deleteAnywayAt(ctx, { width: 1440, height: 900 }, '1440');
    await deleteAnywayAt(ctx, { width: 390, height: 844 }, '390');
  },

  // R7 F-2 third writer: while B's dialog is open a third write lands. Apply
  // meets a fresh 409 -> the SAME overlay re-renders with the banner and the
  // newest 'theirs'; the next Apply resolves and the row shows server status.
  async 'third-writer'(ctx) {
    await thirdWriterAt(ctx, { width: 1440, height: 900 }, '1440');
    await thirdWriterAt(ctx, { width: 390, height: 844 }, '390');
  },

  // Two tabs flipping DIFFERENT records never conflict (version is per record).
  async 'different-records'(ctx) {
    const r2 = await seedStampedRaid(ctx, 'F-2 different records R2');
    const r3 = await seedStampedRaid(ctx, 'F-2 different records R3');
    const a = await openRaidTab(ctx);
    const b = await openRaidTab(ctx);
    await a.waitForSelector(`.raid-row[data-raid="${r2.id}"]`, { timeout: 10000 });
    await b.waitForSelector(`.raid-row[data-raid="${r3.id}"]`, { timeout: 10000 });

    await a.click(`.raid-row[data-raid="${r2.id}"] .raid-status`);
    await b.click(`.raid-row[data-raid="${r3.id}"] .raid-status`);
    await ctx.sleep(900);
    const aReq = lastRequest(a, 'POST');
    const bReq = lastRequest(b, 'POST');
    ctx.check('different records: both flips 200', !!aReq && !!bReq && aReq.status === 200 && bReq.status === 200,
      { a: aReq && aReq.status, b: bReq && bReq.status });
    ctx.check('different records: no overlay', (await ctx.overlayCount(a)) === 0 && (await ctx.overlayCount(b)) === 0);
  },
};

const BANNER_THIRD_WRITER = "That didn't go through — the record changed again. Your edits are still here; review the fresh values below and try again.";

async function deleteAnywayAt(ctx, viewport, tag) {
  const entry = await seedStampedRaid(ctx, 'F-2 delete anyway entry (' + tag + ')');
  const a = await openRaidTab(ctx);
  const b = await openRaidTab(ctx, { viewport });
  await a.waitForSelector(`.raid-row[data-raid="${entry.id}"]`, { timeout: 10000 });
  await b.waitForSelector(`.raid-row[data-raid="${entry.id}"]`, { timeout: 10000 });

  await a.click(`.raid-row[data-raid="${entry.id}"] .raid-status`);
  await ctx.sleep(600);

  // The harness accepts the native confirm (the in-app confirm replaces it in plan 09-14).
  await b.click(`.raid-row[data-raid="${entry.id}"] .ex-del`);
  const dlg = await ctx.waitDialog(b);
  const isStaleDelete = !!dlg && dlg.overlays === 1 && dlg.buttons.some((x) => /conflict-btn-delete/.test(x.cls));
  ctx.check('stale-delete dialog shown (' + tag + ')', isStaleDelete, dlg && { title: dlg.title, overlays: dlg.overlays });
  const fit = await ctx.fitCheck(b);
  ctx.check('fit at ' + tag + ' (stale-delete dialog)', fit.noHorizontalScroll && fit.dialogInside, fit);
  await ctx.shot(b, 'raid-f2-delete-anyway-' + tag + '.png');

  await b.click('.conflict-modal .conflict-btn-delete');
  ctx.check('dialog closes after Delete anyway (' + tag + ')', await ctx.waitNoDialog(b));
  await ctx.sleep(300);
  const inDom = await b.evaluate((rid) => !!document.querySelector(`.raid-row[data-raid="${rid}"]`), entry.id);
  const server = await getRaid(ctx, entry.id);
  ctx.check('row removed after Delete anyway (' + tag + ')', !inDom && !server, { inDom, serverHasEntry: !!server });
}

async function thirdWriterAt(ctx, viewport, tag) {
  const entry = await seedStampedRaid(ctx, 'F-2 third writer entry (' + tag + ')');
  const b = await openRaidTab(ctx, { viewport });
  await b.waitForSelector(`.raid-row[data-raid="${entry.id}"]`, { timeout: 10000 });

  // Writer A (through the API): closed, version 1 -> 2.
  const w1 = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { id: entry.id, status: 'closed', version: 1 });
  ctx.check('writer A 200 (' + tag + ')', w1.status === 200, w1.status);

  // B flips (open -> mitigating, holding version 1) -> conflict dialog.
  await b.click(`.raid-row[data-raid="${entry.id}"] .raid-status`);
  const first = await ctx.waitDialog(b);
  const firstOk = !!first && first.overlays === 1 && !first.banner
    && first.rows.some((r) => r.mine === 'mitigating' && r.theirs === 'closed');
  ctx.check('conflict dialog, no banner, theirs=closed (' + tag + ')', firstOk, first && { overlays: first.overlays, banner: first.banner, rows: first.rows });
  const fit1 = await ctx.fitCheck(b);
  ctx.check('fit at ' + tag + ' (edit dialog)', fit1.noHorizontalScroll && fit1.dialogInside, fit1);
  await ctx.shot(b, 'third-writer-dialog-' + tag + '.png');

  // Writer C lands while B's dialog is open: open, version 2 -> 3.
  const w2 = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { id: entry.id, status: 'open', version: 2 });
  ctx.check('third writer 200 (' + tag + ')', w2.status === 200, w2.status);

  // B applies -> meets a fresh 409 -> same overlay, banner, newest theirs.
  await b.click('.conflict-modal .conflict-btn-apply');
  await ctx.sleep(900);
  const second = await ctx.readDialog(b);
  ctx.check('banner on third writer (' + tag + ')', !!second && second.banner === BANNER_THIRD_WRITER, second && second.banner);
  ctx.check('one overlay throughout (' + tag + ')', !!second && second.overlays === 1, second && second.overlays);
  ctx.check('theirs refreshed, mine unchanged (' + tag + ')',
    !!second && second.rows.some((r) => r.mine === 'mitigating' && r.theirs === 'open'), second && second.rows);
  const fit2 = await ctx.fitCheck(b);
  ctx.check('fit at ' + tag + ' (banner state)', fit2.noHorizontalScroll && fit2.dialogInside, fit2);
  await ctx.shot(b, 'third-writer-banner-' + tag + '.png');

  // B applies again -> resolves; the row shows the server's status.
  await b.click('.conflict-modal .conflict-btn-apply');
  const closed = await ctx.waitNoDialog(b);
  await ctx.sleep(300);
  const server = await getRaid(ctx, entry.id);
  const label = await rowStatusText(b, entry.id);
  ctx.check('final Apply resolves and row shows server status (' + tag + ')',
    closed && !!server && label === RAID_LABEL[server.status] && server.status === 'mitigating',
    { closed, serverStatus: server && server.status, serverVersion: server && server.version, rowLabel: label });
}
