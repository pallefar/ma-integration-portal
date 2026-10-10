// Phase 9 gap closure (plan 09-14, R7 F-6 / GD-9 / D-08, SC7): every covered
// delete asks with the IN-APP confirm — the `.conflict-modal` shell — and a
// stale delete turns THAT SAME overlay into the stale-delete dialog. No
// browser-native confirm precedes or follows it. Scenario module loaded by
// scripts/uat/phase9-walk.js.
//
// Row identification rule (all Phase 9 scenario modules): assert dialog rows
// by their mine/theirs VALUES, never by label text.
//
// Every scenario asserts `nativeDialogs.length === 0` on the tab that deletes:
// the harness accepts a native dialog silently, so the count is the only proof
// that none was shown.

'use strict';

const STALE_TITLE_RE = /still delete it/;

// ------------------------------------------------------------------ helpers

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

function lastRequest(page, method, urlPart) {
  const all = page.requests.filter((r) => r.method === method && (!urlPart || r.url.indexOf(urlPart) !== -1));
  return all[all.length - 1];
}

async function waitStaleState(page) {
  await page.waitForFunction(() => {
    const t = document.querySelector('.conflict-modal-title');
    return !!t && /still delete it/.test(t.textContent);
  }, null, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 150));
}

// One delete through the in-app confirm.
//   page      the tab holding the record
//   clickSel  the page's own delete control
//   question  the page's existing question, verbatim
//   stale     true => the record was changed behind this tab's back
//   gone      async () => true when the record has left the DOM and the API
//   tag       label suffix
async function deleteThroughConfirm(ctx, page, o) {
  const nativeBefore = page.nativeDialogs.length;
  const deletesBefore = page.requests.filter((r) => r.method === 'DELETE').length;
  await page.click(o.clickSel);
  const confirm = await ctx.waitDialog(page);
  ctx.check(o.tag + ': in-app confirm titled "' + o.question + '"', !!confirm && confirm.title === o.question, confirm && confirm.title);
  ctx.check(o.tag + ': confirm offers Cancel + Delete', !!confirm && confirm.buttons.map((x) => x.text).join('|') === 'Cancel|Delete', confirm && confirm.buttons);
  ctx.check(o.tag + ': no DELETE sent before the confirm click', page.requests.filter((r) => r.method === 'DELETE').length === deletesBefore);

  await page.click('.conflict-modal .conflict-btn-delete');
  if (o.stale) {
    await waitStaleState(page);
    const dlg = await ctx.readDialog(page);
    ctx.check(o.tag + ': same overlay became the stale-delete state', !!dlg && dlg.overlays === 1 && STALE_TITLE_RE.test(dlg.title || ''), dlg && { title: dlg.title, overlays: dlg.overlays });
    ctx.check(o.tag + ': stale buttons Cancel + Delete anyway', !!dlg && dlg.buttons.map((x) => x.text).join('|') === 'Cancel|Delete anyway', dlg && dlg.buttons);
    ctx.check(o.tag + ': no "changed again" banner', !!dlg && !dlg.banner, dlg && dlg.banner);
    await page.click('.conflict-modal .conflict-btn-delete');
  }
  ctx.check(o.tag + ': dialog closes', await ctx.waitNoDialog(page));
  await ctx.sleep(500);
  ctx.check(o.tag + ': record gone from the DOM and the API', await o.gone(), null);
  ctx.check(o.tag + ': native dialogs: 0', page.nativeDialogs.length === nativeBefore, page.nativeDialogs);
  const sent = page.requests.filter((r) => r.method === 'DELETE').length - deletesBefore;
  ctx.check(o.tag + ': ' + (o.stale ? 'two DELETEs (409 then 2xx)' : 'one DELETE'), sent === (o.stale ? 2 : 1), sent);
}

// ------------------------------------------------------------------ RAID

async function seedRaid(ctx, title, stamp) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { title, type: 'risk', severity: 'high', owner: 'seed' });
  if (res.status !== 201 || !res.json || !res.json.entry) throw new Error('RAID seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  let entry = res.json.entry;
  if (stamp) {
    const st = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { id: entry.id, notes: 'stamp', version: 0 });
    if (st.status !== 200 || !st.json || !st.json.entry || st.json.entry.version !== 1) throw new Error('RAID stamp failed: ' + st.status);
    entry = st.json.entry;
  }
  return entry;
}

async function raidExists(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/raid');
  return (res.json || []).some((r) => r.id === id);
}

async function openRaidTab(ctx, viewport) {
  const page = await openTabPatient(ctx, { viewport: viewport || { width: 1440, height: 900 }, path: '/execution.html' });
  await page.click('.ex-tab[data-ex-tab="raid"]');
  return page;
}

// ------------------------------------------------------------------ tasks / synergy / org

async function seedTask(ctx, title) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/integration-tasks', { title, workstreamId: 'ws_imo', phase: 'd30' });
  if (res.status !== 201 || !res.json || !res.json.task) throw new Error('task seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  return res.json.task;
}

async function taskExists(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/integration-tasks');
  return (res.json || []).some((t) => t.id === id);
}

async function seedSynergy(ctx, title) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', { title, category: 'cost', owner: 'seed', targetM: 1.2, workstreamId: 'ws_imo' });
  if ((res.status !== 201 && res.status !== 200) || !res.json || !res.json.initiative) throw new Error('synergy seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  return res.json.initiative;
}

async function getSynergy(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/synergies');
  return (Array.isArray(res.json) ? res.json : []).find((s) => s.id === id);
}

async function seedPosition(ctx, title, extra) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/org/positions', Object.assign({ title, level: 'L3', state: 'current' }, extra || {}));
  if (res.status !== 201 || !res.json || !res.json.position) throw new Error('position seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  return res.json.position;
}

async function positionExists(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/org/positions?state=current');
  const list = Array.isArray(res.json) ? res.json : ((res.json && res.json.positions) || []);
  return list.some((p) => p.id === id);
}

const inDom = (page, sel) => page.evaluate((s) => !!document.querySelector(s), sel);

module.exports = {
  // SC7 tracer: a RAID entry through the in-app confirm, untouched and stale.
  async 'delete-confirm-raid'(ctx) {
    const untouched = await seedRaid(ctx, 'F-6 untouched entry', false);
    const stale = await seedRaid(ctx, 'F-6 stale entry', true);
    const page = await openRaidTab(ctx);
    await page.waitForSelector(`.raid-row[data-raid="${untouched.id}"]`, { timeout: 10000 });
    await page.waitForSelector(`.raid-row[data-raid="${stale.id}"]`, { timeout: 10000 });

    await deleteThroughConfirm(ctx, page, {
      tag: 'raid untouched', stale: false, question: 'Delete this entry?',
      clickSel: `.raid-row[data-raid="${untouched.id}"] .ex-del`,
      gone: async () => !(await inDom(page, `.raid-row[data-raid="${untouched.id}"]`)) && !(await raidExists(ctx, untouched.id)),
    });

    // Someone else changes the stale entry behind this tab's back (v1 -> v2).
    const behind = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { id: stale.id, notes: 'changed behind your back', version: 1 });
    ctx.check('stale entry edited behind the tab (v2)', behind.status === 200 && behind.json && behind.json.entry && behind.json.entry.version === 2, behind.status);
    await deleteThroughConfirm(ctx, page, {
      tag: 'raid stale', stale: true, question: 'Delete this entry?',
      clickSel: `.raid-row[data-raid="${stale.id}"] .ex-del`,
      gone: async () => !(await inDom(page, `.raid-row[data-raid="${stale.id}"]`)) && !(await raidExists(ctx, stale.id)),
    });
    ctx.check('no page errors', page.pageErrors.length === 0, page.pageErrors);
  },

  // The other four delete surfaces: task, initiative, cost entry, org position
  // — each untouched and stale — plus the org direct-reports refusal.
  async 'delete-confirm-surfaces'(ctx) {
    const taskU = await seedTask(ctx, 'F-6 task untouched');
    const taskS = await seedTask(ctx, 'F-6 task stale');
    const synU = await seedSynergy(ctx, 'F-6 initiative untouched');
    const synS = await seedSynergy(ctx, 'F-6 initiative stale');
    // Cost-entry holder: an initiative with two entries (one untouched-delete,
    // one stale-delete). Adding an entry stamps the initiative's version.
    const synC = await seedSynergy(ctx, 'F-6 cost entries');
    const addCost = async (note, version) => {
      const r = await ctx.api(ctx.seeder.cookie, 'POST', `/api/synergies/${synC.id}/cost-entries`, { date: '2026-01-15', amountM: 0.5, note, version });
      if (r.status !== 200 || !r.json || !r.json.initiative) throw new Error('cost entry seed failed: ' + r.status + ' ' + JSON.stringify(r.json));
      return r.json.initiative;
    };
    const afterOne = await addCost('F-6 cost A', 0);
    const afterTwo = await addCost('F-6 cost B', afterOne.version || 0);
    const costA = afterTwo.costEntries.find((e) => e.note === 'F-6 cost A');
    const costB = afterTwo.costEntries.find((e) => e.note === 'F-6 cost B');

    const page = await openTabPatient(ctx, { viewport: { width: 1440, height: 900 }, path: '/execution.html' });
    await page.waitForSelector(`.ex-task[data-task="${taskU.id}"] .ex-del`, { timeout: 10000 });

    // -- task
    await deleteThroughConfirm(ctx, page, {
      tag: 'task untouched', stale: false, question: 'Delete this task?',
      clickSel: `.ex-task[data-task="${taskU.id}"] .ex-del`,
      gone: async () => !(await inDom(page, `.ex-task[data-task="${taskU.id}"]`)) && !(await taskExists(ctx, taskU.id)),
    });
    const tb = await ctx.api(ctx.seeder.cookie, 'POST', '/api/integration-tasks', { id: taskS.id, status: 'doing', version: 0 });
    ctx.check('task edited behind the tab', tb.status === 200, tb.status);
    await deleteThroughConfirm(ctx, page, {
      tag: 'task stale', stale: true, question: 'Delete this task?',
      clickSel: `.ex-task[data-task="${taskS.id}"] .ex-del`,
      gone: async () => !(await inDom(page, `.ex-task[data-task="${taskS.id}"]`)) && !(await taskExists(ctx, taskS.id)),
    });

    // -- initiative
    await page.click('.ex-tab[data-ex-tab="synergy"]');
    await page.waitForSelector(`.syn-card[data-syn="${synU.id}"]`, { timeout: 10000 });
    await deleteThroughConfirm(ctx, page, {
      tag: 'initiative untouched', stale: false, question: 'Delete this initiative?',
      clickSel: `.syn-card[data-syn="${synU.id}"] .ex-del`,
      gone: async () => !(await inDom(page, `.syn-card[data-syn="${synU.id}"]`)) && !(await getSynergy(ctx, synU.id)),
    });
    const sb = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', { id: synS.id, notes: 'changed behind your back', version: 0 });
    ctx.check('initiative edited behind the tab', sb.status === 200, sb.status);
    await deleteThroughConfirm(ctx, page, {
      tag: 'initiative stale', stale: true, question: 'Delete this initiative?',
      clickSel: `.syn-card[data-syn="${synS.id}"] .ex-del`,
      gone: async () => !(await inDom(page, `.syn-card[data-syn="${synS.id}"]`)) && !(await getSynergy(ctx, synS.id)),
    });

    // -- cost entries (inside the expanded card)
    await page.click(`.syn-card[data-syn="${synC.id}"] .syn-expand-toggle`);
    await page.waitForSelector(`.syn-cost-row[data-cost-entry="${costA.id}"] .syn-cost-del`, { timeout: 10000 });
    const costGone = (eid) => async () => !(await inDom(page, `.syn-cost-row[data-cost-entry="${eid}"]`))
      && !((await getSynergy(ctx, synC.id)).costEntries || []).some((e) => e.id === eid);
    await deleteThroughConfirm(ctx, page, {
      tag: 'cost entry untouched', stale: false, question: 'Delete this cost entry?',
      clickSel: `.syn-cost-row[data-cost-entry="${costA.id}"] .syn-cost-del`,
      gone: costGone(costA.id),
    });
    // The first delete refreshed this tab's held version; now change the
    // initiative behind it and delete the second entry.
    const heldNow = (await getSynergy(ctx, synC.id));
    const cb = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', { id: synC.id, notes: 'changed behind your back', version: heldNow.version || 0 });
    ctx.check('cost-entry holder edited behind the tab', cb.status === 200, cb.status);
    await deleteThroughConfirm(ctx, page, {
      tag: 'cost entry stale', stale: true, question: 'Delete this cost entry?',
      clickSel: `.syn-cost-row[data-cost-entry="${costB.id}"] .syn-cost-del`,
      gone: costGone(costB.id),
    });
    ctx.check('execution page: no page errors', page.pageErrors.length === 0, page.pageErrors);

    // -- org positions
    const posU = await seedPosition(ctx, 'F-6 position untouched');
    const posS = await seedPosition(ctx, 'F-6 position stale');
    const posP = await seedPosition(ctx, 'F-6 position with a report');
    await seedPosition(ctx, 'F-6 the report', { reportsToId: posP.id });
    const org = await openTabPatient(ctx, { viewport: { width: 1440, height: 900 }, path: '/org.html' });
    const node = (id) => `article[data-position-id="${id}"]`;
    await org.waitForSelector(node(posU.id), { timeout: 10000 });
    await org.waitForSelector(node(posS.id), { timeout: 10000 });
    await org.waitForSelector(node(posP.id), { timeout: 10000 });
    const delSel = (id) => `${node(id)} .org-node-delete`;

    await deleteThroughConfirm(ctx, org, {
      tag: 'position untouched', stale: false, question: 'Delete position? This cannot be undone.',
      clickSel: delSel(posU.id),
      gone: async () => !(await inDom(org, node(posU.id))) && !(await positionExists(ctx, posU.id)),
    });
    const ob = await ctx.api(ctx.seeder.cookie, 'POST', '/api/org/positions', { id: posS.id, level: 'L5', version: 0 });
    ctx.check('position edited behind the tab', ob.status === 200, ob.status);
    await deleteThroughConfirm(ctx, org, {
      tag: 'position stale', stale: true, question: 'Delete position? This cannot be undone.',
      clickSel: delSel(posS.id),
      gone: async () => !(await inDom(org, node(posS.id))) && !(await positionExists(ctx, posS.id)),
    });

    // -- the direct-reports refusal: in-app confirm -> Delete -> the page's own
    // inline error shows the server's message; nothing is deleted.
    const nativeBefore = org.nativeDialogs.length;
    // A parent node also contains its children's delete controls; its own
    // control comes first in document order.
    await org.locator(delSel(posP.id)).first().click();
    const c = await ctx.waitDialog(org);
    ctx.check('refusal: in-app confirm shown', !!c && c.title === 'Delete position? This cannot be undone.', c && c.title);
    await org.click('.conflict-modal .conflict-btn-delete');
    ctx.check('refusal: dialog closes', await ctx.waitNoDialog(org));
    await ctx.sleep(400);
    const err = await org.evaluate(() => {
      const e = document.getElementById('org-delete-error');
      return e && e.style.display !== 'none' ? e.textContent : null;
    });
    ctx.check('refusal: inline error carries the server message', !!err && /direct report/.test(err), err);
    ctx.check('refusal: position still exists', (await inDom(org, node(posP.id))) && (await positionExists(ctx, posP.id)));
    ctx.check('refusal: native dialogs: 0', org.nativeDialogs.length === nativeBefore, org.nativeDialogs);
    ctx.check('org page: no page errors', org.pageErrors.length === 0, org.pageErrors);
  },

  // The confirm state and the stale state at desktop and phone width, with the
  // fit check; screenshots are the visual contract (orange never on the
  // destructive actions, 'Delete'/'Delete anyway' red).
  async 'confirm-widths'(ctx) {
    for (const vp of [{ width: 1440, height: 900, tag: '1440' }, { width: 390, height: 844, tag: '390' }]) {
      const entry = await seedRaid(ctx, 'F-6 widths entry (' + vp.tag + ')', true);
      const page = await openRaidTab(ctx, { width: vp.width, height: vp.height });
      await page.waitForSelector(`.raid-row[data-raid="${entry.id}"]`, { timeout: 10000 });
      const behind = await ctx.api(ctx.seeder.cookie, 'POST', '/api/raid', { id: entry.id, notes: 'changed behind your back', version: 1 });
      ctx.check('entry edited behind the tab (' + vp.tag + ')', behind.status === 200, behind.status);

      await page.click(`.raid-row[data-raid="${entry.id}"] .ex-del`);
      const confirm = await ctx.waitDialog(page);
      const fitC = await ctx.fitCheck(page);
      ctx.check('confirm state opens (' + vp.tag + ')', !!confirm && confirm.overlays === 1 && confirm.title === 'Delete this entry?', confirm && confirm.title);
      ctx.check('fit at ' + vp.tag + ' (confirm state)', fitC.noHorizontalScroll && fitC.dialogInside, fitC);
      await ctx.shot(page, 'delete-confirm-state-' + vp.tag + '.png');

      await page.click('.conflict-modal .conflict-btn-delete');
      await waitStaleState(page);
      const stale = await ctx.readDialog(page);
      const fitS = await ctx.fitCheck(page);
      ctx.check('stale state (' + vp.tag + ')', !!stale && stale.overlays === 1 && STALE_TITLE_RE.test(stale.title || ''), stale && stale.title);
      ctx.check('fit at ' + vp.tag + ' (stale state)', fitS.noHorizontalScroll && fitS.dialogInside, fitS);
      await ctx.shot(page, 'delete-stale-state-' + vp.tag + '.png');

      await page.click('.conflict-modal .conflict-btn-discard');
      ctx.check('Cancel closes (' + vp.tag + ')', await ctx.waitNoDialog(page));
      await ctx.sleep(400);
      ctx.check('entry survives Cancel (' + vp.tag + ')', await raidExists(ctx, entry.id));
      ctx.check('native dialogs: 0 (' + vp.tag + ')', page.nativeDialogs.length === 0, page.nativeDialogs);
    }
  },
};
