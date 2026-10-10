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

// Seeds a never-edited initiative (create only — an update would stamp a
// version and defeat the point). `stamp` additionally stamps it to version 1
// through the API seeder session.
async function seedSynergy(ctx, title, stamp) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', {
    title, category: 'cost', owner: 'seed', targetM: 1.2, workstreamId: 'ws_imo'
  });
  if ((res.status !== 201 && res.status !== 200) || !res.json || !res.json.initiative) {
    throw new Error('synergy seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  }
  let init = res.json.initiative;
  if (stamp) {
    const st = await ctx.api(ctx.seeder.cookie, 'POST', '/api/synergies', { id: init.id, notes: 'stamp', version: 0 });
    if (st.status !== 200 || !st.json || !st.json.initiative || st.json.initiative.version !== 1) {
      throw new Error('synergy stamp failed: ' + st.status + ' ' + JSON.stringify(st.json));
    }
    init = st.json.initiative;
  }
  return init;
}

async function getSynergy(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/synergies');
  return (Array.isArray(res.json) ? res.json : []).find((s) => s.id === id);
}

async function openSynergyTab(ctx, id, viewport) {
  const page = await openPage(ctx, '/execution.html', viewport);
  await page.click('.ex-tab[data-ex-tab="synergy"]');
  await page.waitForSelector(`.syn-card[data-syn="${id}"]`, { timeout: 10000 });
  return page;
}

// ---------------------------------------------------------------- DD items

async function seedDdItem(ctx, text) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/dd/request-items', { area: 'legal', text, owner: 'seed' });
  if (res.status !== 201 || !res.json || !res.json.item) throw new Error('DD item seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  return res.json.item;
}

async function getDdItem(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/dd/request-items?area=legal');
  return (Array.isArray(res.json) ? res.json : []).find((i) => i.id === id);
}

function ddSelect(page, text) {
  return page.locator('.dd-item', { has: page.locator('.dd-item-text', { hasText: text }) }).locator('.dd-item-meta select').first();
}

// ---------------------------------------------------------------- org

async function seedPosition(ctx, title) {
  const res = await ctx.api(ctx.seeder.cookie, 'POST', '/api/org/positions', { title, level: 'L3', state: 'current' });
  if (res.status !== 201 || !res.json || !res.json.position) throw new Error('position seed failed: ' + res.status + ' ' + JSON.stringify(res.json));
  return res.json.position;
}

async function getPosition(ctx, id) {
  const res = await ctx.api(ctx.seeder.cookie, 'GET', '/api/org/positions?state=current');
  const list = Array.isArray(res.json) ? res.json : ((res.json && res.json.positions) || []);
  return list.find((p) => p.id === id);
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

  // R7 F-1 on a synergy SUB-ROUTE (POST /api/synergies/:id/stage): both tabs
  // hold the never-edited initiative; A advances its stage through the UI
  // (version 0 -> 1); B's request must carry version 0, get 409 and ONE dialog,
  // and never also raise a native alert (WR-01).
  async 'synergy-stage-never-edited'(ctx) {
    const init = await seedSynergy(ctx, 'F-1 never-edited synergy (stage)', false);
    const a = await openSynergyTab(ctx, init.id);
    const b = await openSynergyTab(ctx, init.id);

    await a.click(`.syn-card[data-syn="${init.id}"] .syn-stage`);
    await ctx.sleep(700);
    const aReq = lastRequest(a, 'POST', '/stage');
    ctx.check('A stage request carries version 0 and is 200', !!aReq && aReq.request && aReq.request.version === 0 && aReq.status === 200,
      aReq && { status: aReq.status, version: aReq.request && aReq.request.version });

    await b.click(`.syn-card[data-syn="${init.id}"] .syn-stage`);
    const dlg = await ctx.waitDialog(b);
    const bReq = lastRequest(b, 'POST', '/stage');
    ctx.check('B request version 0', !!bReq && bReq.request && bReq.request.version === 0, bReq && bReq.request);
    ctx.check('B 409 + one overlay', !!bReq && bReq.status === 409 && bReq.response && bReq.response.conflict === true && !!dlg && dlg.overlays === 1,
      bReq && { status: bReq.status, conflict: bReq.response && bReq.response.conflict, overlays: dlg && dlg.overlays });
    ctx.check('no native alert alongside the dialog (WR-01)', b.nativeDialogs.length === 0, b.nativeDialogs);
    await ctx.shot(b, 'synergy-stage-never-edited-1440.png');

    const server = await getSynergy(ctx, init.id);
    ctx.check('server keeps A\'s stage change', !!server && server.stage === 'validated' && server.version === 1, server && { stage: server.stage, version: server.version });
  },

  // R7 F-2b: the header realized value. A sets it (1 -> 2), B (holding v1)
  // sets a different value -> dialog -> Apply -> B's card header shows B's
  // value and the API agrees.
  async 'synergy-realized-f2'(ctx) {
    const init = await seedSynergy(ctx, 'F-2b realized header synergy', true);
    const a = await openSynergyTab(ctx, init.id);
    const b = await openSynergyTab(ctx, init.id);
    const input = (p) => p.locator(`.syn-card[data-syn="${init.id}"] .syn-head .syn-realized-input`);

    await input(a).fill('1.5');
    // A real Tab keypress: the browser commits the value and fires exactly ONE
    // native change event (a synthetic dispatch plus the browser's own
    // commit-on-removal change produced two writes in an earlier draft).
    await input(a).press('Tab');
    await ctx.sleep(700);
    const aReq = lastRequest(a, 'POST', '/api/synergies');
    ctx.check('A header write 200 with version 1', !!aReq && aReq.status === 200 && aReq.request && aReq.request.version === 1,
      aReq && { status: aReq.status, version: aReq.request && aReq.request.version });

    await input(b).fill('2.5');
    await input(b).press('Tab');
    const dlg = await ctx.waitDialog(b);
    const bReq = lastRequest(b, 'POST', '/api/synergies');
    ctx.check('B 409 + one overlay', !!bReq && bReq.status === 409 && bReq.response && bReq.response.conflict === true && !!dlg && dlg.overlays === 1,
      bReq && { status: bReq.status, overlays: dlg && dlg.overlays });
    ctx.check('dialog carries mine/theirs values', !!dlg && dlg.rows.some((r) => /2\.5/.test(String(r.mine)) && /1\.5/.test(String(r.theirs))), dlg && dlg.rows);
    ctx.check('no native alert alongside the dialog (WR-01)', b.nativeDialogs.length === 0, b.nativeDialogs);

    await b.click('.conflict-modal .conflict-btn-apply');
    ctx.check('dialog closes after Apply', await ctx.waitNoDialog(b));
    await ctx.sleep(500);
    const bWrites = b.requests.filter((r) => r.method === 'POST' && r.url.indexOf('/api/synergies') === 0);
    ctx.check('B made exactly one conflicting write then one reapply',
      bWrites.length === 2 && bWrites[0].status === 409 && bWrites[1].status === 200 && bWrites[1].request.version === 2,
      bWrites.map((r) => [r.request && r.request.version, r.status]));
    const server = await getSynergy(ctx, init.id);
    const headerText = await b.evaluate((id) => {
      const card = document.querySelector(`.syn-card[data-syn="${id}"]`);
      const money = card && card.querySelector('.syn-money .syn-realized');
      const inp = card && card.querySelector('.syn-head .syn-realized-input');
      return { money: money ? money.textContent.trim() : null, input: inp ? inp.value : null };
    }, init.id);
    ctx.check('API holds B\'s value', !!server && server.realizedM === 2.5, server && { realizedM: server.realizedM, version: server.version });
    ctx.check('B\'s card header shows B\'s value', headerText.money === '$2.5M' && headerText.input === '2.5', headerText);
    await ctx.shot(b, 'synergy-realized-f2-1440.png');
  },

  // R7 F-2d: the due-diligence page must NOT re-fetch while the dialog is open
  // (the user's select keeps showing THEIR value), and after Apply it shows
  // the server's value. Also checked at 390x844.
  async 'dd-f2'(ctx) {
    await ddAt(ctx, { width: 1440, height: 900 }, '1440');
    await ddAt(ctx, { width: 390, height: 844 }, '390');
  },

  // R7 F-2c: position delete -> stale-delete dialog -> Delete anyway -> the
  // node is gone from B's DOM and from the API (native confirm still present
  // until 09-14; the harness accepts it).
  async 'org-delete-anyway-f2'(ctx) {
    const pos = await seedPosition(ctx, 'F-2c delete anyway position');
    const stamp = await ctx.api(ctx.seeder.cookie, 'POST', '/api/org/positions', { id: pos.id, level: 'L4', version: 0 });
    ctx.check('position stamped to version 1', stamp.status === 200 && stamp.json && stamp.json.position && stamp.json.position.version === 1,
      { status: stamp.status, version: stamp.json && stamp.json.position && stamp.json.position.version });

    const b = await openPage(ctx, '/org.html');
    const node = `article[data-position-id="${pos.id}"]`;
    await b.waitForSelector(node, { timeout: 10000 });

    // A edits it through the API (version 1 -> 2) while B holds version 1.
    const edit = await ctx.api(ctx.seeder.cookie, 'POST', '/api/org/positions', { id: pos.id, level: 'L5', version: 1 });
    ctx.check('A edit 200', edit.status === 200, edit.status);

    await b.locator(node).locator('.org-node-delete').first().click();
    const dlg = await ctx.waitDialog(b);
    const del = lastRequest(b, 'DELETE', '/api/org/positions');
    ctx.check('DELETE carries expectedVersion=1', !!del && /[?&]expectedVersion=1(&|$)/.test(del.url), del && del.url);
    ctx.check('409 stale-delete dialog', !!dlg && dlg.overlays === 1 && dlg.buttons.some((x) => /conflict-btn-delete/.test(x.cls)),
      dlg && { title: dlg.title, overlays: dlg.overlays });
    const errShown = await b.evaluate(() => !!document.querySelector('.org-delete-error') && document.querySelector('.org-delete-error').style.display !== 'none' && !!document.querySelector('.org-delete-error').textContent);
    ctx.check('no inline org error alongside the dialog (WR-02)', !errShown);
    await ctx.shot(b, 'org-delete-anyway-f2-1440.png');

    await b.click('.conflict-modal .conflict-btn-delete');
    ctx.check('dialog closes after Delete anyway', await ctx.waitNoDialog(b));
    await ctx.sleep(600);
    const inDom = await b.evaluate((sel) => !!document.querySelector(sel), node);
    const server = await getPosition(ctx, pos.id);
    ctx.check('node gone from DOM and API', !inDom && !server, { inDom, serverHasPosition: !!server });
  },

  // GD-1: from ONE tab, two writes in a row to a never-edited record on a
  // synergy sub-route and on a DD item both return 200 — the held version is
  // refreshed from each success, so a tab never conflicts with itself.
  async 'one-tab-no-self-conflict'(ctx) {
    const init = await seedSynergy(ctx, 'GD-1 one-tab synergy', false);
    const text = 'GD-1 one-tab DD item';
    const item = await seedDdItem(ctx, text);

    const s = await openSynergyTab(ctx, init.id);
    const btn = `.syn-card[data-syn="${init.id}"] .syn-confirm-btn`;
    await s.click(btn);
    await ctx.sleep(600);
    await s.click(btn);
    await ctx.sleep(600);
    const confirms = s.requests.filter((r) => r.method === 'POST' && r.url.indexOf('/confirm-current') !== -1);
    ctx.check('synergy sub-route twice: versions 0 then 1, both 200',
      confirms.length === 2 && confirms[0].status === 200 && confirms[1].status === 200
        && confirms[0].request.version === 0 && confirms[1].request.version === 1,
      confirms.map((r) => ({ status: r.status, version: r.request && r.request.version })));
    ctx.check('no overlay in the synergy tab', (await ctx.overlayCount(s)) === 0);

    const d = await openPage(ctx, '/due-diligence.html');
    await ddSelect(d, text).waitFor({ timeout: 10000 });
    await ddSelect(d, text).selectOption('requested');
    await ctx.sleep(900);
    await ddSelect(d, text).selectOption('received');
    await ctx.sleep(900);
    const posts = d.requests.filter((r) => r.method === 'POST' && r.url.indexOf('/api/dd/request-items') === 0);
    ctx.check('DD item twice: versions 0 then 1, both 200',
      posts.length === 2 && posts[0].status === 200 && posts[1].status === 200
        && posts[0].request.version === 0 && posts[1].request.version === 1,
      posts.map((r) => ({ status: r.status, version: r.request && r.request.version })));
    ctx.check('no overlay in the DD tab', (await ctx.overlayCount(d)) === 0);
    const server = await getDdItem(ctx, item.id);
    ctx.check('API holds the second write', !!server && server.status === 'received', server && server.status);
  },
};

async function ddAt(ctx, viewport, tag) {
  const text = 'F-2d DD item (' + tag + ')';
  const item = await seedDdItem(ctx, text);
  const b = await openPage(ctx, '/due-diligence.html', viewport);
  const sel = ddSelect(b, text);
  await sel.waitFor({ timeout: 10000 });
  const gets = watchGets(b, '/api/dd/request-items');

  // A (through the API, version 0 -> 1) sets 'requested' behind B's back.
  const aw = await ctx.api(ctx.seeder.cookie, 'POST', '/api/dd/request-items', { id: item.id, status: 'requested', version: 0 });
  ctx.check('A write 200 (' + tag + ')', aw.status === 200, aw.status);

  const before = gets.length;
  await sel.selectOption('received');
  const dlg = await ctx.waitDialog(b);
  await ctx.sleep(1000);
  const req = lastRequest(b, 'POST', '/api/dd/request-items');
  ctx.check('B request version 0 and 409 (' + tag + ')', !!req && req.request && req.request.version === 0 && req.status === 409 && req.response && req.response.conflict === true,
    req && { status: req.status, version: req.request && req.request.version });
  ctx.check('one overlay, no native alert (' + tag + ')', !!dlg && dlg.overlays === 1 && b.nativeDialogs.length === 0, dlg && { overlays: dlg.overlays, native: b.nativeDialogs });
  ctx.check('no re-fetch while the dialog is open (' + tag + ')', gets.length === before, { before, now: gets.length });
  ctx.check('B\'s select still shows B\'s value under the dialog (' + tag + ')', (await sel.inputValue()) === 'received', await sel.inputValue());
  const fit = await ctx.fitCheck(b);
  ctx.check('fit at ' + tag + ' (DD dialog)', fit.noHorizontalScroll && fit.dialogInside, fit);
  await ctx.shot(b, 'dd-f2-dialog-' + tag + '.png');

  await b.click('.conflict-modal .conflict-btn-apply');
  ctx.check('dialog closes after Apply (' + tag + ')', await ctx.waitNoDialog(b));
  await ctx.sleep(600);
  const server = await getDdItem(ctx, item.id);
  const shown = await ddSelect(b, text).inputValue();
  ctx.check('after Apply B\'s select shows the server value and the API holds it (' + tag + ')',
    !!server && server.status === 'received' && shown === 'received', { api: server && server.status, select: shown });
}
