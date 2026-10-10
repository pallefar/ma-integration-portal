// Phase 9 gap closure (plan 09-08, R7 F-1): never-edited RAID entry, first
// concurrent edit. Scenario module loaded by scripts/uat/phase9-walk.js.
//
// Row identification rule (all Phase 9 scenario modules): assert dialog rows
// by their mine/theirs VALUES, never by label text — plan 09-13 changes the
// labels.

'use strict';

// Seeds one never-edited RAID entry through the API seeder session (create
// only — an update would stamp a version and defeat the point).
async function seedRaid(ctx, title) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { title, type: 'risk', severity: 'high', owner: 'seed' });
  if (res.status !== 201 || !res.json || !res.json.entry) throw new Error('RAID seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  return res.json.entry;
}

async function getRaid(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/raid');
  return (res.json || []).find((r) => r.id === id);
}

function lastRequest(page, method) {
  const all = page.requests.filter((r) => r.method === method);
  return all[all.length - 1];
}

module.exports = {
  // R7 F-1: tab A and tab B both hold a never-edited entry; A flips status
  // (stamps version 1); B's flip must carry version 0 and get 409 + dialog.
  async 'raid-f1'(ctx) {
    const entry = await seedRaid(ctx, 'F-1 never-edited entry');
    const a = await ctx.openTab({ viewport: { width: 1440, height: 900 }, path: '/execution.html' });
    const b = await ctx.openTab({ viewport: { width: 1440, height: 900 }, path: '/execution.html' });
    await a.click('.ex-tab[data-ex-tab="raid"]');
    await b.click('.ex-tab[data-ex-tab="raid"]');
    await a.waitForSelector(`.raid-row[data-raid="${entry.id}"]`, { timeout: 10000 });
    await b.waitForSelector(`.raid-row[data-raid="${entry.id}"]`, { timeout: 10000 });

    await a.click(`.raid-row[data-raid="${entry.id}"] .raid-status`);
    await ctx.sleep(600);
    const aReq = lastRequest(a, 'POST');
    ctx.check('A request carries version 0', !!aReq && aReq.request && aReq.request.version === 0, aReq && aReq.request);
    ctx.check('A response 200', !!aReq && aReq.status === 200, aReq && aReq.status);

    await b.click(`.raid-row[data-raid="${entry.id}"] .raid-status`);
    const dlg = await ctx.waitDialog(b);
    const bReq = lastRequest(b, 'POST');
    ctx.check('B request carries version 0', !!bReq && bReq.request && bReq.request.version === 0, bReq && bReq.request);
    ctx.check('B response 409 conflict:true', !!bReq && bReq.status === 409 && bReq.response && bReq.response.conflict === true, bReq && { status: bReq.status, conflict: bReq.response && bReq.response.conflict });
    ctx.check('one overlay', !!dlg && dlg.overlays === 1, dlg && dlg.overlays);
    const aStatus = aReq && aReq.response && aReq.response.entry && aReq.response.entry.status;
    const statusRow = dlg && dlg.rows.find((r) => r.theirs === aStatus || r.mine === aStatus);
    ctx.check('status row present', !!statusRow, dlg && dlg.rows);
    await ctx.shot(b, 'raid-f1-1440.png');

    const after = await getRaid(ctx, entry.id);
    ctx.check('A\'s write survived (no silent clobber)', !!after && after.status === aStatus && after.version === 1, after && { status: after.status, version: after.version });

    // Same reproduction at 390x844 on a second never-edited entry.
    const entry2 = await seedRaid(ctx, 'F-1 never-edited entry (390)');
    const a2 = await ctx.openTab({ viewport: { width: 1440, height: 900 }, path: '/execution.html' });
    const m = await ctx.openTab({ viewport: { width: 390, height: 844 }, path: '/execution.html' });
    await a2.click('.ex-tab[data-ex-tab="raid"]');
    await m.click('.ex-tab[data-ex-tab="raid"]');
    await a2.waitForSelector(`.raid-row[data-raid="${entry2.id}"]`, { timeout: 10000 });
    await m.waitForSelector(`.raid-row[data-raid="${entry2.id}"]`, { timeout: 10000 });
    await a2.click(`.raid-row[data-raid="${entry2.id}"] .raid-status`);
    await ctx.sleep(600);
    await m.click(`.raid-row[data-raid="${entry2.id}"] .raid-status`);
    const dlgM = await ctx.waitDialog(m);
    const fit = await ctx.fitCheck(m);
    ctx.check('dialog opens at 390', !!dlgM && dlgM.overlays === 1, dlgM && dlgM.overlays);
    ctx.check('fit at 390', fit.noHorizontalScroll && fit.dialogInside, fit);
    await ctx.shot(m, 'raid-f1-390.png');
  },
};
