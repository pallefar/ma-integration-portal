// Phase 9 gap closure (plan 09-12, R7 F-1 / F-2, GD-1 / GD-5): the PAGE half of
// the version precondition and the page re-read after a conflict that did not
// apply the user's change. Scenario module loaded by scripts/uat/phase9-walk.js.
//
// Row identification rule (all Phase 9 scenario modules): assert dialog rows
// by their mine/theirs VALUES, never by label text — plan 09-13 changes the
// labels.

'use strict';

// ------------------------------------------------------------------ helpers

function lastRequest(page, method, urlPart) {
  const all = page.requests.filter((r) => r.method === method && (!urlPart || r.url.indexOf(urlPart) !== -1));
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

async function openPage(ctx, urlPath, viewport) {
  return openTabPatient(ctx, { viewport: viewport || { width: 1440, height: 900 }, path: urlPath });
}

// Counts GET requests a page issued, from now on, whose URL contains `part`.
function watchGets(page, part) {
  const seen = [];
  page.on('request', (req) => {
    if (req.method() === 'GET' && req.url().indexOf(part) !== -1) seen.push(req.url());
  });
  return seen;
}

// ---------------------------------------------------------------- tasks

async function seedTask(ctx, title) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/integration-tasks', { title, workstreamId: 'ws_imo', phase: 'd30' });
  if (res.status !== 201 || !res.json || !res.json.task) throw new Error('task seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  return res.json.task;
}

async function getTask(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/integration-tasks');
  return (res.json || []).find((t) => t.id === id);
}

async function taskStatusText(page, id) {
  return page.evaluate((tid) => {
    const el = document.querySelector(`.ex-task[data-task="${tid}"] .ex-status`);
    return el ? el.textContent.trim() : null;
  }, id);
}

// Two tabs on /execution.html both holding the never-edited task; A flips it
// twice (todo -> doing -> blocked), leaving the server at version 2.
async function twoTabsAFlipsTwice(ctx, title) {
  const task = await seedTask(ctx, title);
  const a = await openPage(ctx, '/execution.html');
  const b = await openPage(ctx, '/execution.html');
  await a.waitForSelector(`.ex-task[data-task="${task.id}"] .ex-status`, { timeout: 10000 });
  await b.waitForSelector(`.ex-task[data-task="${task.id}"] .ex-status`, { timeout: 10000 });

  await a.click(`.ex-task[data-task="${task.id}"] .ex-status`);
  await ctx.sleep(600);
  await a.click(`.ex-task[data-task="${task.id}"] .ex-status`);
  await ctx.sleep(600);
  const posts = a.requests.filter((r) => r.method === 'POST' && r.url.indexOf('/api/integration-tasks') === 0);
  return { task, a, b, aPosts: posts };
}

// ------------------------------------------------------------------ synergy

async function seedSynergy(ctx, name) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', {
    name, type: 'cost', owner: 'seed', targetM: 1.2, stage: 'idea', workstreamId: 'ws_imo'
  });
  if ((res.status !== 201 && res.status !== 200) || !res.json) throw new Error('synergy seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  const init = res.json.initiative || res.json.synergy || res.json;
  if (!init || !init.id) throw new Error('synergy seed returned no initiative: ' + JSON.stringify(res.json));
  return init;
}

module.exports = {
  // R7 F-1 (T4 exactly): both tabs hold a never-edited task. A flips twice
  // (200, 200); B flips once and must carry version 0, get 409 and ONE dialog;
  // the API still holds A's status.
  async 'task-f1-never-edited'(ctx) {
    const { task, a, b, aPosts } = await twoTabsAFlipsTwice(ctx, 'F-1 never-edited task');
    ctx.check('A flip #1 carries version 0 and is 200', !!aPosts[0] && aPosts[0].request && aPosts[0].request.version === 0 && aPosts[0].status === 200,
      aPosts[0] && { status: aPosts[0].status, version: aPosts[0].request && aPosts[0].request.version });
    ctx.check('A flip #2 carries version 1 and is 200', !!aPosts[1] && aPosts[1].request && aPosts[1].request.version === 1 && aPosts[1].status === 200,
      aPosts[1] && { status: aPosts[1].status, version: aPosts[1].request && aPosts[1].request.version });

    await b.click(`.ex-task[data-task="${task.id}"] .ex-status`);
    const dlg = await ctx.waitDialog(b);
    const bReq = lastRequest(b, 'POST', '/api/integration-tasks');
    ctx.check('B request version 0', !!bReq && bReq.request && bReq.request.version === 0, bReq && bReq.request);
    ctx.check('B 409 + one overlay', !!bReq && bReq.status === 409 && bReq.response && bReq.response.conflict === true && !!dlg && dlg.overlays === 1,
      bReq && { status: bReq.status, conflict: bReq.response && bReq.response.conflict, overlays: dlg && dlg.overlays });
    await ctx.shot(b, 'task-f1-never-edited-1440.png');

    const server = await getTask(ctx, task.id);
    const aStatus = aPosts[1] && aPosts[1].response && aPosts[1].response.task && aPosts[1].response.task.status;
    ctx.check('server keeps A\'s status', !!server && server.status === aStatus && server.version === 2, server && { status: server.status, version: server.version });
    ctx.check('no page errors', b.pageErrors.length === 0 && a.pageErrors.length === 0, b.pageErrors.concat(a.pageErrors));
  },

  // R7 F-2 / GD-5: B discards -> the dialog closes and, after the re-read,
  // B's row shows A's status; B's next flip carries the SERVER's version.
  async 'task-discard-keeps-theirs'(ctx) {
    const { task, a, b } = await twoTabsAFlipsTwice(ctx, 'F-2 discard keeps theirs task');
    const aLabel = await taskStatusText(a, task.id);
    const bBefore = await taskStatusText(b, task.id);

    await b.click(`.ex-task[data-task="${task.id}"] .ex-status`);
    await ctx.waitDialog(b);
    await b.click('.conflict-modal .conflict-btn-discard');
    ctx.check('dialog closes on Discard', await ctx.waitNoDialog(b));
    await ctx.sleep(600);

    const bAfter = await taskStatusText(b, task.id);
    ctx.check('after Discard row shows A\'s status', !!aLabel && bAfter === aLabel && bAfter !== bBefore, { aLabel, bBefore, bAfter });

    const server = await getTask(ctx, task.id);
    const before = b.requests.length;
    await b.click(`.ex-task[data-task="${task.id}"] .ex-status`);
    await ctx.sleep(800);
    const next = b.requests.slice(before).find((r) => r.method === 'POST');
    ctx.check('next flip 200 no overlay',
      !!next && next.status === 200 && next.request && next.request.version === server.version && (await ctx.overlayCount(b)) === 0,
      next && { status: next.status, sentVersion: next.request && next.request.version, serverVersion: server.version });
    ctx.check('no page errors', b.pageErrors.length === 0, b.pageErrors);
  },
};
