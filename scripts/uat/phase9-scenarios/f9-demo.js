// Phase 9 gap closure (plan 09-16): demo-mode smoke. CLAUDE.md names the demo
// showcase a maintained deliverable and 09-CONTEXT D-09 keeps it lenient: an
// DEMO_OPEN=1 visitor (anonymous over the API, and a deal-less signed-in
// session in the browser) must be able to flip a RAID status and a task status
// with no conflict dialog and no `versionRequired` refusal. Scenario
// module loaded by scripts/uat/phase9-walk.js; it runs ONLY under --demo-open
// (the `__demo` export below) and is skipped by a normal real-deal walk.

'use strict';

const BODY_MARK = 'versionRequired';

function postsTo(page, urlPrefix, method) {
  return page.requests.filter((r) => r.method === method && r.url.split('?')[0] === urlPrefix);
}

module.exports = {
  __demo: ['demo-smoke'],

  async 'demo-smoke'(ctx) {
    // --- anonymous lane (no cookie at all), API level: version-less writes are
    // accepted (D-09 demo leniency) and never answered with versionRequired.
    const seedAnon = await ctx.api(null, 'POST', '/api/raid', { title: 'demo anon entry', type: 'risk', severity: 'high', owner: 'demo' });
    ctx.check('anonymous RAID create 201', seedAnon.status === 201 && !!(seedAnon.json && seedAnon.json.entry), { status: seedAnon.status, body: seedAnon.json });
    const anonUpd = await ctx.api(null, 'POST', '/api/raid', { id: seedAnon.json && seedAnon.json.entry && seedAnon.json.entry.id, status: 'mitigating' });
    ctx.check('anonymous version-less RAID update 200, no versionRequired', anonUpd.status === 200 && !(anonUpd.json && anonUpd.json.versionRequired), { status: anonUpd.status, body: anonUpd.json });
    const anonTasks = await ctx.api(null, 'GET', '/api/integration-tasks');
    const firstTask = Array.isArray(anonTasks.json) ? anonTasks.json[0] : null;
    ctx.check('anonymous task read 200 with demo tasks', anonTasks.status === 200 && !!firstTask, anonTasks.status);
    if (firstTask) {
      const tUpd = await ctx.api(null, 'POST', '/api/integration-tasks', { id: firstTask.id, status: 'doing' });
      ctx.check('anonymous version-less task update 200, no versionRequired', tUpd.status === 200 && !(tUpd.json && tUpd.json.versionRequired), { status: tUpd.status, body: tUpd.json });
    }

    // --- browser lane: deal-less signed-in demo session, real UI flips.
    const page = await ctx.openTab({ viewport: { width: 1440, height: 900 }, path: '/execution.html' });
    await ctx.sleep(800);
    ctx.check('/execution.html loaded (not bounced to login)', /\/execution\.html/.test(page.url()), page.url());
    ctx.check('no page error on load', page.pageErrors.length === 0, page.pageErrors);

    // --- task status flip (the Execution Hub default tab is the task list)
    await page.waitForSelector('.ex-task .ex-status', { timeout: 10000 });
    const taskCount = await page.evaluate(() => document.querySelectorAll('.ex-task').length);
    ctx.check('demo task list is populated', taskCount > 0, taskCount);
    const before = postsTo(page, '/api/integration-tasks', 'POST').length;
    await page.click('.ex-task .ex-status');
    await ctx.sleep(900);
    const taskPosts = postsTo(page, '/api/integration-tasks', 'POST').slice(before);
    const tp = taskPosts[taskPosts.length - 1];
    ctx.check('task status flip sent', !!tp, taskPosts.length);
    ctx.check('task status flip 200 success:true', !!tp && tp.status === 200 && tp.response && tp.response.success === true, tp && { status: tp.status, body: tp.response });
    ctx.check('no conflict dialog after the task flip', (await ctx.overlayCount(page)) === 0);
    await ctx.shot(page, 'demo-task-flip.png');

    // --- RAID status flip (seed one through the open API only if the demo has none)
    await page.click('.ex-tab[data-ex-tab="raid"]');
    let raidCount = 0;
    try {
      await page.waitForSelector('.raid-row .raid-status', { timeout: 4000 });
      raidCount = await page.evaluate(() => document.querySelectorAll('.raid-row').length);
    } catch (e) { /* no demo RAID rows — seed below */ }
    if (!raidCount) {
      const seeded = await ctx.api(null, 'POST', '/api/raid', { title: 'demo smoke entry', type: 'risk', severity: 'high', owner: 'demo' });
      ctx.check('seeded one RAID entry through the open demo API', seeded.status === 201 || seeded.status === 200, { status: seeded.status, body: seeded.json });
      await page.reload({ waitUntil: 'load' });
      await page.click('.ex-tab[data-ex-tab="raid"]');
      await page.waitForSelector('.raid-row .raid-status', { timeout: 10000 });
    }
    const rBefore = postsTo(page, '/api/raid', 'POST').length;
    await page.click('.raid-row .raid-status');
    await ctx.sleep(900);
    const raidPosts = postsTo(page, '/api/raid', 'POST').slice(rBefore);
    const rp = raidPosts[raidPosts.length - 1];
    ctx.check('RAID status flip sent', !!rp, raidPosts.length);
    ctx.check('RAID status flip 200', !!rp && rp.status === 200 && rp.response && !rp.response.error, rp && { status: rp.status, body: rp.response });
    ctx.check('no conflict dialog after the RAID flip', (await ctx.overlayCount(page)) === 0);
    await ctx.shot(page, 'demo-raid-flip.png');

    // --- the lenient demo contract: nothing in this session was refused for a
    // missing version, and nothing answered 409.
    const refused = page.requests.filter((r) => JSON.stringify(r.response || {}).indexOf(BODY_MARK) !== -1);
    ctx.check('no captured response carries versionRequired', refused.length === 0, refused.map((r) => r.url));
    ctx.check('no captured write answered 409', page.requests.every((r) => r.status !== 409), page.requests.map((r) => r.status));
    ctx.check('no page error during the smoke', page.pageErrors.length === 0, page.pageErrors);
    await page.context().close();
  },
};
