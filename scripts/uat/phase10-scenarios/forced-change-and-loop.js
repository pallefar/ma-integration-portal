// Phase 10 plan 10-06 Task 2: forced rotation is unavoidable in the browser
// (D-10-05 client half, T-10-41) and the demo-open redirect loop is gone
// (WINDOWS #4, D-10-08, T-10-40). Loaded by scripts/uat/phase10-walk.js.
//
// The server-side 403 gate that backs the forced rotation ships in plan 10-05;
// these scenarios only prove the CLIENT half (login routing, handshake
// redirect, the change screen). They never type a credential into a
// screenshot: shots are taken before any field is filled.

'use strict';

const crypto = require('crypto');

function secret(prefix) {
  return prefix + crypto.randomBytes(12).toString('base64url');
}

async function createForcedUser(ctx, adminCookie, username) {
  const created = await ctx.api(adminCookie, 'POST', '/api/admin/users', { username, name: 'Forced ' + username, role: 'pmo' });
  if (created.status !== 201 || !created.json || !created.json.tempPassword) {
    throw new Error('user create failed: ' + created.status + ' ' + JSON.stringify(created.json && Object.assign({}, created.json, { tempPassword: '<redacted>' })));
  }
  return created.json.tempPassword;
}

async function waitForPath(page, re, ms) {
  // page.url() (not page.evaluate) so a navigation mid-poll cannot destroy
  // the execution context under us.
  const pathOf = () => new URL(page.url()).pathname;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const p = pathOf();
    if (re.test(p)) return p;
    await new Promise((r) => setTimeout(r, 150));
  }
  return pathOf();
}

module.exports = {
  __lanes: {
    forcedChangeLandsOnChangePassword: ['real'],
    demoOpenAnonymousNoLoop: ['demo-open'],
  },

  async forcedChangeLandsOnChangePassword(ctx) {
    const adminCookie = await ctx.adminLogin();
    const temp = await createForcedUser(ctx, adminCookie, 'forced.one');

    // --- sign in through the real login form with the temporary password
    const page = await ctx.newPage(ctx.viewports.desktop);
    await page.goto(ctx.base + '/login.html', { waitUntil: 'load' });
    await page.fill('#lg-user', 'forced.one');
    await page.fill('#lg-pass', temp);
    await page.click('#login-form button[type="submit"]');
    const landed = await waitForPath(page, /change-password\.html$/, 8000);
    ctx.check('login with a temp password lands on /change-password.html', landed === '/change-password.html', landed);

    // Wait until the form is enabled (me + mode probes resolved), then shoot
    // BEFORE typing anything.
    await page.waitForFunction(() => { const el = document.getElementById('cp-current'); return el && !el.disabled; }, null, { timeout: 8000 });
    const heading = await page.evaluate(() => document.getElementById('cp-title').textContent);
    ctx.check('heading says the password must be changed', /must change your password/i.test(heading), heading);
    await ctx.shot(page, 'forced-change-1440');

    // --- the app is unreachable: opening /index.html bounces straight back
    await page.goto(ctx.base + '/index.html', { waitUntil: 'load' });
    const bounced = await waitForPath(page, /change-password\.html$/, 8000);
    ctx.check('opening /index.html directly bounces back to /change-password.html', bounced === '/change-password.html', bounced);

    // --- client-side checks run before any request
    await page.waitForFunction(() => { const el = document.getElementById('cp-current'); return el && !el.disabled; }, null, { timeout: 8000 });
    await page.fill('#cp-current', temp);
    await page.fill('#cp-new', 'short');
    await page.fill('#cp-confirm', 'short');
    await page.click('#cp-submit');
    const shortNotice = await page.evaluate(() => document.getElementById('cp-notice').textContent);
    ctx.check('a too-short password is refused client-side with the 12-char rule', /at least 12 characters/.test(shortNotice), shortNotice);

    // --- a valid change lands on the app
    const next = secret('Nw-');
    await page.fill('#cp-new', next);
    await page.fill('#cp-confirm', next);
    await page.click('#cp-submit');
    const after = await waitForPath(page, /^\/(index\.html)?$/, 10000);
    ctx.check('changing to a 12+ char password lands on /', after === '/' || after === '/index.html', after);
    // The old temp password no longer signs in; the new one does (and is not forced).
    const oldTry = await ctx.api(null, 'POST', '/api/auth/login', { username: 'forced.one', password: temp });
    ctx.check('the temporary password stops working', oldTry.status === 401, oldTry.status);
    const fresh = await ctx.loginFull('forced.one', next);
    ctx.check('the new password signs in and is no longer forced', fresh.mustChangePassword === false, fresh.mustChangePassword);
    ctx.check('no page error', page.pageErrors.length === 0, page.pageErrors);

    // --- 390 px: the change screen fits a phone, and a wrong current password reads plainly
    const temp2 = await createForcedUser(ctx, adminCookie, 'forced.two');
    const cookie2 = await ctx.login('forced.two', temp2);
    const phone = await ctx.newPage({ width: ctx.viewports.phone.width, height: ctx.viewports.phone.height, cookies: [cookie2] });
    await phone.goto(ctx.base + '/change-password.html', { waitUntil: 'load' });
    await phone.waitForFunction(() => { const el = document.getElementById('cp-current'); return el && !el.disabled; }, null, { timeout: 8000 });
    const fits = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    ctx.check('390px: change-password screen has no horizontal overflow', fits);
    await ctx.shot(phone, 'forced-change-390');
    await phone.fill('#cp-current', secret('Wrong-'));
    await phone.fill('#cp-new', secret('Nw-'));
    const same = await phone.evaluate(() => document.getElementById('cp-new').value);
    await phone.fill('#cp-confirm', same);
    await phone.click('#cp-submit');
    await phone.waitForFunction(() => document.getElementById('cp-notice').textContent !== '', null, { timeout: 8000 });
    const wrong = await phone.evaluate(() => document.getElementById('cp-notice').textContent);
    ctx.check('a wrong current password reads "Current password is incorrect."', wrong === 'Current password is incorrect.', wrong);
  },

  async demoOpenAnonymousNoLoop(ctx) {
    const page = await ctx.newPage(ctx.viewports.desktop); // NO cookie: the loop case
    await page.goto(ctx.base + '/execution.html', { waitUntil: 'load' });
    await ctx.sleep(6000);
    const pathNow = await page.evaluate(() => window.location.pathname);
    ctx.check('a cookie-less tab stays on /execution.html', pathNow === '/execution.html', pathNow);
    ctx.check('at most 2 document navigations in 6 s (the loop made dozens)', page.navigations <= 2, page.navigations);
    const dealCalls = page.apiRequests.filter((r) => r.url.split('?')[0] === '/api/deals');
    ctx.check('no /api/deals request without a session', dealCalls.length === 0, dealCalls);
    ctx.check('no page error', page.pageErrors.length === 0, page.pageErrors);
    await ctx.shot(page, 'demo-open-anonymous-1440');
  },
};
