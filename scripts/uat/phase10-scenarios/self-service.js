// Phase 10 plan 10-06 Task 3: any signed-in user changes their password and
// ends their own sessions from the shared header menu, at 1440 and 390 px
// (ACCT-06 UI, D-10-07). Loaded by scripts/uat/phase10-walk.js.
//
// Real lane only: the admin session comes from ctx.adminLogin() (the bootstrap
// admin's forced rotation is performed once per lane run by the runner). The
// change-password modal is submitted for a THROWAWAY user, never the shared
// admin, so scenarios that share the lane keep a working admin password.

'use strict';

const crypto = require('crypto');

function secret(prefix) {
  return prefix + crypto.randomBytes(12).toString('base64url');
}

// Opens one account-menu item. Tries the profile dropdown first, then the
// sidebar-footer copy; returns which mount was reachable ('dropdown' | 'sidebar').
async function openAccountItem(page, which) {
  const sel = (root) => `${root} [data-am="${which}"]`;
  await page.waitForSelector(sel('#profile-dropdown-card'), { state: 'attached', timeout: 15000 });
  const trigger = await page.$('#profile-menu-trigger');
  if (trigger && (await trigger.isVisible())) {
    await trigger.click();
    const item = await page.$(sel('#profile-dropdown-card'));
    if (item && (await item.isVisible())) {
      await item.click();
      await page.waitForSelector('.am-modal', { timeout: 5000 });
      return 'dropdown';
    }
  }
  const side = await page.$(sel('.sidebar-footer'));
  if (side && (await side.isVisible())) {
    await side.click();
    await page.waitForSelector('.am-modal', { timeout: 5000 });
    return 'sidebar';
  }
  return null;
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

async function modalInsideViewport(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.am-modal');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { inside: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0, left: r.left, right: r.right, top: r.top, vw: window.innerWidth };
  });
}

async function sessionRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.am-session')).map((r) => ({
    device: (r.querySelector('.am-session-device') || {}).textContent || '',
    current: !!r.querySelector('.am-badge'),
    canEnd: !!r.querySelector('.am-session-end'),
  })));
}

async function waitForPathname(page, re, ms) {
  const deadline = Date.now() + ms;
  const pathOf = () => new URL(page.url()).pathname;
  while (Date.now() < deadline) {
    if (re.test(pathOf())) return pathOf();
    await new Promise((r) => setTimeout(r, 150));
  }
  return pathOf();
}

module.exports = {
  __lanes: {
    selfServiceSessions: ['real'],
    selfServiceReadOnly: ['dev-committed'],
  },

  // accountsWritable:false (committed control.db active): dev/demo never offers
  // a control that can only fail (D-10-01, D-10-07). Sign-in writes only the
  // temp runtime.db; the runner's control.db + -wal guard proves nothing else.
  async selfServiceReadOnly(ctx) {
    const cookie = await ctx.login('karen', 'TEdemo!2026');
    const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [cookie] });
    await page.goto(ctx.base + '/execution.html', { waitUntil: 'load' });
    await page.waitForSelector('#profile-dropdown-card [data-am="change-password"]', { state: 'attached', timeout: 15000 });
    const disabled = await page.evaluate(() => {
      const b = document.querySelector('#profile-dropdown-card [data-am="change-password"]');
      const note = document.querySelector('#profile-dropdown-card .am-note');
      return { disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'), note: note ? note.textContent : null };
    });
    ctx.check('Change password is disabled with aria-disabled', disabled.disabled === true && disabled.ariaDisabled === 'true', disabled);
    ctx.check('the one-line note names start-real-deal', /start-real-deal/.test(disabled.note || ''), disabled.note);
    await page.click('#profile-menu-trigger');
    await page.click('#profile-dropdown-card [data-am="my-sessions"]');
    await page.waitForSelector('.am-session', { timeout: 8000 });
    const rows = await sessionRows(page);
    ctx.check('My sessions lists sessions without End-session buttons', rows.length > 0 && rows.every((r) => !r.canEnd), rows);
    const note = await page.locator('.am-modal .am-note').first().textContent();
    ctx.check('the sessions modal repeats the read-only note', /start-real-deal/.test(note || ''), note);
    await ctx.shot(page, 'sessions-readonly-1440');
    await page.keyboard.press('Escape');

    // The standalone change-password screen is disabled too.
    await page.goto(ctx.base + '/change-password.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('cp-readonly').textContent !== '', null, { timeout: 8000 });
    const form = await page.evaluate(() => ({
      note: document.getElementById('cp-readonly').textContent,
      current: document.getElementById('cp-current').disabled,
      next: document.getElementById('cp-new').disabled,
      submit: document.getElementById('cp-submit').disabled,
    }));
    ctx.check('change-password page: form disabled with the start-real-deal note', form.current && form.next && form.submit && /start-real-deal/.test(form.note), form);
    await ctx.shot(page, 'change-password-readonly-1440');
    ctx.check('no page error', page.pageErrors.length === 0, page.pageErrors);
  },

  async selfServiceSessions(ctx) {
    // ------------------------------------------------ 1440: list + end other
    const adminCookie = await ctx.adminLogin();
    const desk = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [adminCookie] });
    await desk.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
    const mount = await openAccountItem(desk, 'my-sessions');
    ctx.check('1440px: My sessions is reachable from the header menu', mount !== null, mount);
    await desk.waitForSelector('.am-session', { timeout: 8000 });
    let rows = await sessionRows(desk);
    ctx.check('1440px: exactly one session is marked "This device"', rows.filter((r) => r.current).length === 1, rows);
    ctx.check('1440px: every row has an End-session button (real mode is writable)', rows.length > 0 && rows.every((r) => r.canEnd), rows);
    await ctx.shot(desk, 'sessions-1440');

    // A second browser context signs in as the same admin.
    const otherCookie = await ctx.login('admin', ctx.adminPasswordNow());
    const other = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [otherCookie] });
    await other.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
    await ctx.sleep(800);
    ctx.check('second context is signed in (stays on /admin.html)', new URL(other.url()).pathname === '/admin.html', other.url());

    // The first context re-opens the list and ends the OTHER session.
    await desk.click('.am-modal .deal-modal-actions .btn');
    await desk.waitForSelector('.am-modal', { state: 'detached', timeout: 3000 });
    await openAccountItem(desk, 'my-sessions');
    await desk.waitForFunction(() => document.querySelectorAll('.am-session').length >= 2, null, { timeout: 8000 });
    rows = await sessionRows(desk);
    ctx.check('the list now shows both sessions', rows.length >= 2, rows.length);
    const idx = rows.findIndex((r) => !r.current);
    await desk.locator('.am-session').nth(idx).locator('.am-session-end').click();
    await desk.waitForFunction((n) => document.querySelectorAll('.am-session').length === n, rows.length - 1, { timeout: 8000 });
    rows = await sessionRows(desk);
    ctx.check('ending the other session removes exactly that row; this device remains', rows.some((r) => r.current), rows);

    // The other context's next navigation lands on /login.html.
    await other.goto(ctx.base + '/admin.html', { waitUntil: 'load' }).catch(() => {});
    const otherPath = await waitForPathname(other, /login\.html$/, 8000);
    ctx.check('the ended session is bounced to /login.html on its next navigation', otherPath === '/login.html', otherPath);
    ctx.check('no page error (1440)', desk.pageErrors.length === 0, desk.pageErrors);

    // --------------------------------------------------- 390: modals fit
    const phoneCookie = await ctx.login('admin', ctx.adminPasswordNow());
    const phone = await ctx.newPage({ width: ctx.viewports.phone.width, height: ctx.viewports.phone.height, cookies: [phoneCookie] });
    await phone.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
    const phoneMount = await openAccountItem(phone, 'my-sessions');
    ctx.check('390px: My sessions is reachable (' + phoneMount + ')', phoneMount !== null, phoneMount);
    await phone.waitForSelector('.am-session', { timeout: 8000 });
    const s390 = await noHorizontalScroll(phone);
    ctx.check('390px: no horizontal scroll with the sessions modal open', s390.fits && s390.scrollWidth <= 390, s390);
    const m390 = await modalInsideViewport(phone);
    ctx.check('390px: the sessions modal lies inside the viewport', !!m390 && m390.inside, m390);
    await ctx.shot(phone, 'sessions-390');
    await phone.keyboard.press('Escape');
    await phone.waitForSelector('.am-modal', { state: 'detached', timeout: 3000 });
    ctx.pass('390px: Escape closes the modal');

    // --------------------------- 390: change-password modal on a throwaway user
    const created = await ctx.api(adminCookie, 'POST', '/api/admin/users', { username: 'self.service', name: 'Self Service', role: 'pmo' });
    if (created.status !== 201) throw new Error('throwaway user create failed: ' + created.status);
    const temp = created.json.tempPassword;
    const first = await ctx.loginFull('self.service', temp);
    const known = secret('Kn-');
    const rotated = await ctx.api(first.cookie, 'POST', '/api/auth/change-password', { currentPassword: temp, newPassword: known });
    if (rotated.status !== 200) throw new Error('throwaway rotation failed: ' + rotated.status);
    const userCookie = await ctx.login('self.service', known);
    const up = await ctx.newPage({ width: ctx.viewports.phone.width, height: ctx.viewports.phone.height, cookies: [userCookie] });
    await up.goto(ctx.base + '/dashboard.html', { waitUntil: 'load' });
    const cpMount = await openAccountItem(up, 'change-password');
    ctx.check('390px: Change password is reachable for a non-admin (' + cpMount + ')', cpMount !== null, cpMount);
    const cp390 = await noHorizontalScroll(up);
    ctx.check('390px: no horizontal scroll with the change-password modal open', cp390.fits && cp390.scrollWidth <= 390, cp390);
    const cpBox = await modalInsideViewport(up);
    ctx.check('390px: the change-password modal lies inside the viewport', !!cpBox && cpBox.inside, cpBox);
    await ctx.shot(up, 'change-password-modal-390');

    const inputs = up.locator('.am-modal input[type="password"]');
    await inputs.nth(0).fill(known);
    await inputs.nth(1).fill(secret('Nw-'));
    await inputs.nth(2).fill('does-not-match');
    await up.click('.am-modal button[type="submit"]');
    const mismatch = await up.locator('.am-modal .deal-modal-error').textContent();
    ctx.check('a mismatched confirmation is refused before any request', /do not match/.test(mismatch || ''), mismatch);

    const next = secret('Nx-');
    await inputs.nth(1).fill(next);
    await inputs.nth(2).fill(next);
    await up.click('.am-modal button[type="submit"]');
    await up.waitForSelector('.am-success', { state: 'visible', timeout: 8000 });
    const okText = await up.locator('.am-success').textContent();
    ctx.check('success reads "Password changed. Your other sessions were signed out."', okText === 'Password changed. Your other sessions were signed out.', okText);
    await up.waitForSelector('.am-modal', { state: 'detached', timeout: 5000 });
    ctx.pass('the modal closes itself after success');
    const relogin = await ctx.api(null, 'POST', '/api/auth/login', { username: 'self.service', password: next });
    ctx.check('the new password signs in', relogin.status === 200, relogin.status);
    ctx.check('no page error (390)', phone.pageErrors.length === 0 && up.pageErrors.length === 0, phone.pageErrors.concat(up.pageErrors));
  },
};
