// storedXss - PRD acceptance 2 (report-only half), D-13-07 / PD-7 / PD-43.
//
// An AUTHOR stores the R1-03 payloads plus a corpus sample through the real
// write routes (page body, layout richtext + hero/cards/cta text, lesson body,
// an i18n `[data-i18n-html]` value, banner title/message, slide label); a VICTIM
// (a different session / account) then opens every enumerated render path in a
// real browser. Every payload carries an executable proof (`window.__xss=1` +
// a fetch to the canary origin): none may run, no dialog may open, the canary
// must see nothing, and neither violation source (in-page event, admin
// endpoint) may list anything. Each surface also carries a benign marker so a
// pass can never be a blank page.
//
// Lanes: dev (admin author, a second admin session + karen + employee-demo as
// victims), demo-open (the anonymous showcase visitor is author AND victim),
// real (a SECOND admin authors, a third admin / the Integration Lead / an
// employee are victims; the pmo write attempt is asserted 403).
'use strict';

const path = require('path');
const S = require('./_shared');
const { inertViolations } = require(path.join(S.REPO_ROOT, 'test', 'helpers', 'html-inert.js'));

const CMS_SLUG_BODY = 'capability-hub';          // legacy body path (page-cms.js / page-layout.js ladder)
const CMS_SLUG_LAYOUT = 'integration-excellence'; // layout-block path
const I18N_KEY = 'leaders.progress_heading';      // a real [data-i18n-html] key on leaders.html

const M = {
  body: 'P13MARK-body', layout: 'P13MARK-layout', lesson: 'P13MARK-lesson', i18n: 'P13MARK-i18n',
  banner: 'P13MARK-banner', slide: 'P13MARK-slide',
};

async function visit(ctx, page, p, label) {
  await page.goto(ctx.base + p, { waitUntil: 'load' });
  await ctx.settle(page, 1200);
  const landed = new URL(page.url()).pathname;
  ctx.check(`${label}: stays on ${p} (no bounce to login / change-password)`, landed === p, landed);
}

async function audit(ctx, page, selector, label, expectRoots) {
  const r = await page.evaluate(S.auditDom, { selector });
  ctx.check(`${label}: container ${selector} present`, r.roots >= (expectRoots || 1), { roots: r.roots, nodes: r.nodes });
  ctx.check(`${label}: no element/attribute an inert stored container must not hold`, r.problems.length === 0, r.problems.slice(0, 6));
  return r;
}

async function bodyHas(page, marker) {
  return page.evaluate((m) => document.body.innerText.indexOf(m) !== -1, marker);
}

async function storedXss(ctx) {
  const fx = await ctx.fixture();
  const author = fx.users.author.cookie;
  const canary = ctx.canary;
  canary.reset();

  // ---- the payload set (R1-03 a..d + every 7th corpus vector, armed) --------
  const vectors = S.sampleVectors(canary.origin, 7, 9000);
  const r103 = vectors.filter((v) => /^R1-03-/.test(v.id));
  ctx.check('payload set built: R1-03-a..d present and armed', r103.length === 4 && r103.every((v) => v.armed.indexOf('window.__xss') !== -1),
    { total: vectors.length, r103: r103.map((v) => v.id) });
  const wrap = (marker, list) => '<p>' + marker + '</p>' + list.map((v) => '<div>' + v.armed + '</div>').join('');
  const richHtml = (marker) => wrap(marker, vectors);                       // <= 20 000 (HTML_MAX)
  const shortHtml = (marker) => wrap(marker, r103);                         // i18n value <= 4 000 (TEXT_MAX)
  const expr = S.xssExpr(canary.origin);
  const oneLiner = '<img src=x onerror=' + expr + '>';                      // <= 300 (NAME_MAX)
  const undo = [];                                                           // cleanup actions, run in `finally`

  // ---- pmo write is refused (Phase 11 content-write policy) ---------------
  if (ctx.lane !== 'demo-open') {
    const probe = await ctx.api(fx.users.pmo.cookie, 'POST', '/api/pages', { slug: 'p13-pmo-probe', title: { en: 'x' }, body: { en: '<p>x</p>' }, published: true });
    ctx.check('pmo POST /api/pages is refused (403)', probe.status === 403, { status: probe.status });
    const list = await ctx.api(author, 'GET', '/api/pages');
    const leaked = Array.isArray(list.json) && list.json.some((p) => p && p.slug === 'p13-pmo-probe');
    ctx.check('the refused pmo write stored nothing', !leaked, { count: Array.isArray(list.json) ? list.json.length : null });
  }

  try {
    // ---- 1. author stores everything through the real routes ---------------
    const pagesNow = await ctx.api(author, 'GET', '/api/pages');
    ctx.check('author can read the page list', pagesNow.status === 200 && Array.isArray(pagesNow.json), { status: pagesNow.status });
    const existing = (slug) => (pagesNow.json || []).find((p) => p && p.slug === slug) || null;

    async function upsertPage(slug, patch) {
      const cur = existing(slug);
      if (cur) {
        const keep = { body: cur.body, published: cur.published, layout: cur.layout };
        const r = await ctx.api(author, 'POST', '/api/pages', Object.assign({ id: cur.id, slug }, patch));
        undo.push(() => ctx.api(author, 'POST', '/api/pages', Object.assign({ id: cur.id, slug }, keep)));
        return r;
      }
      const r = await ctx.api(author, 'POST', '/api/pages', Object.assign({ slug, title: { en: slug } }, patch));
      const id = r.json && r.json.page && r.json.page.id;
      if (id) undo.push(() => ctx.api(author, 'DELETE', '/api/pages/' + id));
      return r;
    }

    const rBody = await upsertPage(CMS_SLUG_BODY, { body: { en: richHtml(M.body) }, published: true });
    ctx.check('author stored the page body (legacy ladder)', rBody.status === 200 && rBody.json && rBody.json.success === true, { status: rBody.status });
    const storedBody = await ctx.api(author, 'GET', '/api/pages?slug=' + CMS_SLUG_BODY);
    // Structural, never regex-on-output: parse what the server kept with the
    // repo's own parser and walk it against the allowlist (test/helpers/html-inert.js).
    const atRest = (storedBody.json && storedBody.json.body && storedBody.json.body.en) || '';
    const restViolations = inertViolations(atRest);
    ctx.check('server stored the body already sanitised (structurally inert at rest)',
      atRest.length > 0 && restViolations.length === 0, { len: atRest.length, violations: restViolations.slice(0, 5) });

    const layout = [
      { id: 'p13-b1', type: 'richtext', order: 1, visible: true, data: { html: { en: richHtml(M.layout) } } },
      { id: 'p13-b2', type: 'hero', order: 2, visible: true, data: { title: { en: oneLiner }, subtitle: { en: oneLiner }, cta: { en: 'Go' }, ctaHref: 'javascript:' + expr } },
      // `items` is a plain "Title | description | icon" lines string (admin-cms.js sends it unlocalised).
      { id: 'p13-b3', type: 'cards', order: 3, visible: true, data: { heading: { en: oneLiner }, items: oneLiner + ' | ' + oneLiner + ' | x' } },
      { id: 'p13-b4', type: 'cta', order: 4, visible: true, data: { heading: { en: oneLiner }, text: { en: oneLiner }, button: { en: 'Open' }, href: 'javascript:' + expr } },
    ];
    const rLayout = await upsertPage(CMS_SLUG_LAYOUT, { layout, published: true });
    ctx.check('author stored the layout blocks (richtext + hero/cards/cta text + javascript: hrefs)', rLayout.status === 200, { status: rLayout.status });

    const course = {
      title: { en: 'P13 proof course' }, published: true,
      modules: [{ id: 'p13-m1', title: { en: 'P13 module' }, lessons: [{ id: 'p13-l1', title: { en: 'P13 lesson' }, description: { en: 'P13 description' }, body: { en: richHtml(M.lesson) } }] }],
    };
    const rCourse = await ctx.api(author, 'POST', '/api/courses', course);
    const courseId = rCourse.json && rCourse.json.course && rCourse.json.course.id;
    ctx.check('author stored the lesson body', rCourse.status === 200 && !!courseId, { status: rCourse.status });
    if (courseId) undo.push(() => ctx.api(author, 'DELETE', '/api/courses/' + courseId));

    const dict = await ctx.api(author, 'GET', '/api/i18n');
    const originalI18n = dict.json && dict.json.strings && dict.json.strings.en ? dict.json.strings.en[I18N_KEY] : undefined;
    const rI18n = await ctx.api(author, 'POST', '/api/i18n', { lang: 'en', key: I18N_KEY, value: shortHtml(M.i18n) });
    ctx.check('author stored the i18n html value (dictionary values are not server-sanitised, PD-5)', rI18n.status === 200, { status: rI18n.status });
    undo.push(() => ctx.api(author, 'POST', '/api/i18n', { lang: 'en', key: I18N_KEY, value: originalI18n === undefined ? '' : originalI18n }));

    const rBanner = await ctx.api(author, 'POST', '/api/banners', {
      type: 'info', title: { en: M.banner + ' ' + oneLiner }, message: { en: M.banner + ' ' + oneLiner },
      scope: 'global', active: true, dismissible: false, priority: 1000,
    });
    const bannerId = rBanner.json && rBanner.json.banner && rBanner.json.banner.id;
    ctx.check('author stored the banner title/message', rBanner.status === 200 && !!bannerId, { status: rBanner.status });
    if (bannerId) undo.push(() => ctx.api(author, 'DELETE', '/api/banners/' + bannerId));

    const rSlide = await ctx.api(author, 'POST', '/api/slides', { url: '/overview-deck/slide5.html', label: M.slide + ' ' + oneLiner, icon: '\u{1F5A5}️', pages: 'all' });
    const slideId = rSlide.json && rSlide.json.slide && rSlide.json.slide.id;
    ctx.check('author stored the slide label', rSlide.status === 200 && !!slideId, { status: rSlide.status });
    if (slideId) undo.push(() => ctx.api(author, 'DELETE', '/api/slides/' + slideId));

    // ---- 2. victims open every enumerated render path ----------------------
    // Victim admin: CMS body, layout blocks, i18n html value, inline-edit cancel.
    {
      const page = await ctx.newPage({ cookies: [fx.users.victim.cookie] });
      await visit(ctx, page, '/capability-hub.html', 'victim admin / page body');
      ctx.check('victim admin / page body: the benign marker rendered (not a blank region)', await bodyHas(page, M.body), null);
      await audit(ctx, page, '[data-cms-region]', 'victim admin / page body');
      await assertInertFull(ctx, page, 'victim admin / page body');
      await S_shot(ctx, page, 'p13-stored-' + ctx.lane + '-page-body');

      await visit(ctx, page, '/integration-excellence.html', 'victim admin / layout blocks');
      ctx.check('victim admin / layout blocks: the richtext marker rendered', await bodyHas(page, M.layout), null);
      await audit(ctx, page, '[data-cms-region]', 'victim admin / layout blocks');
      const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-cms-region] .pl-hero a.btn, [data-cms-region] .pl-cta a.btn')).map((a) => a.getAttribute('href')));
      ctx.check('victim admin / layout blocks: hero and cta javascript: hrefs became "#"', hrefs.length === 2 && hrefs.every((h) => h === '#'), hrefs);
      const cardText = await page.evaluate(() => (document.querySelector('.pl-card h4') || {}).textContent || '');
      ctx.check('victim admin / layout blocks: card title shows the payload as TEXT (not markup)', cardText.indexOf('<img') !== -1, cardText.slice(0, 40));
      await assertInertFull(ctx, page, 'victim admin / layout blocks');

      await visit(ctx, page, '/leaders.html', 'victim admin / i18n html value');
      ctx.check('victim admin / i18n html value: the benign marker rendered', await bodyHas(page, M.i18n), null);
      await audit(ctx, page, '[data-i18n-html="' + I18N_KEY + '"]', 'victim admin / i18n html value');
      await assertInertFull(ctx, page, 'victim admin / i18n html value');

      // inline-edit cancel round trip on a page-body region (13-09 finding).
      const editor = await ctx.newPage({ cookies: [fx.users.victim.cookie], localStorage: { adminEditMode: 'true' } });
      await visit(ctx, editor, '/capability-hub.html', 'inline-edit round trip');
      const btn = await editor.waitForSelector('.cms-page-editbar .pe-edit', { timeout: 12000 }).catch(() => null);
      ctx.check('inline-edit: the "Edit page body" control is offered to the admin', !!btn, null);
      if (btn) {
        const before = await editor.evaluate(() => (document.querySelector('[data-cms-region]') || {}).textContent || '');
        await btn.click();
        await editor.waitForSelector('.cms-editable-body', { timeout: 8000 });
        ctx.check('inline-edit: the editable body shows the stored marker', (await editor.evaluate(() => document.querySelector('.cms-editable-body').textContent)).indexOf(M.body) !== -1, null);
        await audit(ctx, editor, '.cms-editable-body', 'inline-edit editing view');
        await editor.click('.cms-page-editbar .pe-cancel');
        await editor.waitForSelector('[data-cms-region] .cms-authored', { timeout: 8000 });
        const after = await editor.evaluate(() => (document.querySelector('[data-cms-region]') || {}).textContent || '');
        ctx.check('inline-edit: Cancel restored the original region (text identical, no serialise/parse drift)', after === before, { before: before.length, after: after.length });
        await audit(ctx, editor, '[data-cms-region]', 'inline-edit after Cancel');
        const stillEditing = await editor.evaluate(() => !!document.querySelector('.cms-editable-body'));
        ctx.check('inline-edit: no editable body left after Cancel', stillEditing === false, null);
      }
      await assertInertFull(ctx, editor, 'inline-edit round trip');
    }

    // Victim (IL in dev/real, anonymous in demo-open): banner, slide label, chatbot.
    {
      const who = fx.users.il;
      const page = await ctx.newPage({ cookies: [who.cookie] });
      await visit(ctx, page, '/dashboard.html', `victim ${who.role} / banner + slide + chatbot`);
      await page.waitForSelector('.page-banner', { timeout: 10000 }).catch(() => {});
      ctx.check('banner: the benign marker rendered', await bodyHas(page, M.banner), null);
      const banner = await page.evaluate(() => {
        const t = document.querySelector('.page-banner-title');
        return t ? { text: t.textContent, children: t.children.length } : null;
      });
      ctx.check('banner: title is TEXT (payload visible literally, zero child elements)', !!banner && banner.children === 0 && banner.text.indexOf('<img') !== -1, banner);
      await audit(ctx, page, '.page-banner', 'banner');

      const link = await page.evaluate((mark) => {
        const l = Array.from(document.querySelectorAll('.sidebar-group[data-group="slides"] .sidebar-link-label')).find((x) => x.textContent.indexOf(mark) !== -1);
        return l ? { text: l.textContent, children: l.children.length } : null;
      }, M.slide);
      ctx.check('slide label: the sidebar launcher shows the payload as TEXT (zero child elements)', !!link && link.children === 0 && link.text.indexOf('<img') !== -1, link);
      if (link) {
        await page.locator('.sidebar-group[data-group="slides"] .sidebar-link', { hasText: M.slide }).first().click();
        await page.waitForSelector('#html-slide-overlay', { timeout: 6000 });
        const ov = await page.evaluate(() => {
          const o = document.getElementById('html-slide-overlay');
          const t = o.querySelector('.slide-overlay-title');
          const f = o.querySelector('iframe');
          return { title: t.textContent, titleChildren: t.children.length, sandbox: f.getAttribute('sandbox') };
        });
        ctx.check('slide overlay: title is TEXT and the frame is sandboxed', ov.titleChildren === 0 && ov.title.indexOf('<img') !== -1 && ov.sandbox === 'allow-scripts', ov);
        await ctx.settle(page, 800);
        await page.keyboard.press('Escape');
      }

      // chatbot: a message with a markdown javascript: link and a raw <img onerror>
      await page.click('#unified-fab');
      await page.click('.unified-tab[data-tab="chat"]');
      const msg = '[click me](javascript:' + expr + ') **bold** <img src=x onerror=' + expr + '> [ok](https://example.org/p13)';
      await page.fill('#teodor-global-input', msg);
      await page.press('#teodor-global-input', 'Enter');
      await page.waitForSelector('#teodor-global-history .teodor-bubble.user', { timeout: 8000 });
      await ctx.settle(page, 1500);
      const bubble = await page.evaluate(() => {
        const b = document.querySelector('#teodor-global-history .teodor-bubble.user');
        return {
          links: Array.from(b.querySelectorAll('a')).map((a) => ({ text: a.textContent, href: a.getAttribute('href'), rel: a.getAttribute('rel') })),
          imgs: b.querySelectorAll('img').length, strong: b.querySelectorAll('strong').length, text: b.textContent.slice(0, 60),
        };
      });
      const bad = bubble.links.find((l) => l.text === 'click me');
      const ok = bubble.links.find((l) => l.text === 'ok');
      ctx.check('chatbot: the javascript: markdown link lost its href (text kept)', !!bad && (bad.href === null || !/^javascript:/i.test(bad.href)), bad);
      ctx.check('chatbot: the https link keeps its href and gets rel="noopener noreferrer"', !!ok && ok.href === 'https://example.org/p13' && /noopener/.test(ok.rel || ''), ok);
      ctx.check('chatbot: a raw <img onerror> typed in a message is escaped text (no <img> element)', bubble.imgs === 0 && /<img/.test(bubble.text), bubble);
      ctx.check('chatbot: **bold** still renders as <strong>', bubble.strong >= 1, bubble.strong);
      await audit(ctx, page, '#teodor-global-history', 'chatbot history');
      await assertInertFull(ctx, page, `victim ${who.role} / banner + slide + chatbot`);
      await S_shot(ctx, page, 'p13-stored-' + ctx.lane + '-banner-chat');
    }

    // Victim employee: lesson modal.
    {
      const who = fx.users.emp;
      const page = await ctx.newPage({ cookies: [who.cookie] });
      await visit(ctx, page, '/employee.html', `victim ${who.role} / lesson modal`);
      const open = await page.waitForSelector('.academy-view-lesson', { timeout: 12000, state: 'attached' }).catch(() => null);
      ctx.check('lesson: the stored lesson is listed in the academy', !!open, null);
      if (open) {
        const target = page.locator('.academy-view-lesson[data-lesson="p13-l1"]').first();
        if (await target.count()) {
          await target.evaluate((el) => el.click());
          await page.waitForSelector('.cms-modal .lesson-body', { timeout: 6000 });
          ctx.check('lesson: the benign marker rendered in the modal body', await page.evaluate((m) => document.querySelector('.lesson-body').textContent.indexOf(m) !== -1, M.lesson), null);
          await audit(ctx, page, '.cms-modal .lesson-body', 'lesson modal');
          await S_shot(ctx, page, 'p13-stored-' + ctx.lane + '-lesson');
        } else {
          ctx.fail('lesson: the p13 lesson button was found', 'not listed');
        }
      }
      await assertInertFull(ctx, page, `victim ${who.role} / lesson modal`);
    }

    // ---- 3. the canary and the violation endpoint -------------------------
    ctx.check('canary server saw ZERO hits across the whole scenario', canary.hits().length === 0, canary.hits().slice(0, 5));
    const ev = await ctx.endpointViolations();
    ctx.check('GET /api/admin/csp-violations is empty after every path was opened', ev.count === 0, { mode: ev.mode, count: ev.count, tuples: ev.violations.slice(0, 5) });
    ctx.say(`storedXss@${ctx.lane} violations=${ev.count} canaryHits=${canary.hits().length}`);
  } finally {
    for (const fn of undo.reverse()) { try { await fn(); } catch (e) { /* best effort: the lane's data is a throw-away copy */ } }
  }
}

// assertInert + the endpoint-side view at this point in the walk (per page).
async function assertInertFull(ctx, page, label) {
  await S.assertInert(ctx, page, label);
}

async function S_shot(ctx, page, name) {
  try { await ctx.shot(page, name); } catch (e) { /* screenshots are evidence, not a gate */ }
}

module.exports = { storedXss, __lanes: { storedXss: ['dev', 'demo-open', 'real'] } };
