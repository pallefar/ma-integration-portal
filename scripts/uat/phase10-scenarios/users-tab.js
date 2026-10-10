// Phase 10 plan 10-07 Task 2: the whole admin -> user lifecycle (ACCT-01,
// D-10-03 / D-10-04) driven through the admin console Users tab in real
// Chromium, at 1440 and 390 px. Loaded by scripts/uat/phase10-walk.js.
//
// Real lane only: the admin session comes from ctx.adminLogin(). Every
// temporary password is masked in the DOM before a screenshot is taken
// (T-10-45): evidence shots never carry a credential.

'use strict';

const crypto = require('crypto');

function secret(prefix) {
  return prefix + crypto.randomBytes(12).toString('base64url');
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

async function openUsersTab(page, ctx) {
  await page.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
  await page.waitForSelector('#admin-tab-btn-users', { state: 'visible', timeout: 15000 });
  await page.click('#admin-tab-btn-users');
  await page.waitForSelector('#users-list .au-table', { timeout: 10000 });
  // admin.js fades the panel in (class .active after 10 ms + CSS transition):
  // let it settle so evidence shots are not taken mid-fade.
  await page.waitForSelector('#tab-users.active', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 600));
}

async function rowFor(page, username) {
  return page.$('#users-list tr[data-username="' + username + '"]');
}

async function rowActions(page, username) {
  return page.evaluate((u) => {
    const tr = document.querySelector('#users-list tr[data-username="' + u + '"]');
    if (!tr) return null;
    return Array.from(tr.querySelectorAll('.au-actions button')).map((b) => b.textContent);
  }, username);
}

async function clickRowAction(page, username, label) {
  const tr = await rowFor(page, username);
  if (!tr) throw new Error('no row for ' + username);
  const btn = await tr.$('.au-actions button:has-text("' + label + '")');
  if (!btn) throw new Error('no "' + label + '" action on ' + username);
  await btn.click();
}

async function rowCell(page, username, label) {
  return page.evaluate(({ u, l }) => {
    const td = document.querySelector('#users-list tr[data-username="' + u + '"] td[data-label="' + l + '"]');
    return td ? td.textContent : null;
  }, { u: username, l: label });
}

async function fits(page) {
  return page.evaluate(() => ({
    ok: document.documentElement.scrollWidth <= window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

// Reads the one-time password from the open modal, masks it in the DOM, and
// returns the secret. Never logs it.
async function takeTempPassword(page) {
  await page.waitForSelector('#au-temp-password', { timeout: 8000 });
  const pw = await page.$eval('#au-temp-password', (i) => i.value);
  await page.evaluate(() => { document.getElementById('au-temp-password').value = '••••'; });
  return pw;
}

module.exports = {
  __lanes: { usersTabLifecycle: ['real'] },

  async usersTabLifecycle(ctx) {
    const adminCookie = await ctx.adminLogin();
    const page = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height, cookies: [adminCookie] });
    await openUsersTab(page, ctx);

    // --- the tab lists accounts; the admin's own row has no Disable
    const adminRowActions = await rowActions(page, 'admin');
    ctx.check('the Users tab lists the bootstrap admin', Array.isArray(adminRowActions), adminRowActions);
    ctx.check('the signed-in admin’s own row offers Edit and Reset password but never Disable',
      Array.isArray(adminRowActions) && adminRowActions.includes('Edit') && adminRowActions.includes('Reset password') && !adminRowActions.includes('Disable'),
      adminRowActions);
    const heading = await page.evaluate(() => Array.from(document.querySelectorAll('#users-list th')).map((t) => t.textContent));
    ctx.check('table columns are Username/Name/Role/Status/Last sign-in/Actions',
      JSON.stringify(heading) === JSON.stringify(['Username', 'Name', 'Role', 'Status', 'Last sign-in', 'Actions']), heading);
    await ctx.shot(page, 'users-tab-1440');

    // --- create alice (pmo) through the modal; the temp password is shown once
    await page.click('#btn-users-add');
    await page.waitForSelector('#au-new-username', { timeout: 5000 });
    await page.fill('#au-new-username', 'alice');
    await page.fill('#au-new-name', 'Alice Example');
    await page.selectOption('#au-new-role', 'pmo');
    await page.click('.au-modal button[type="submit"]');
    const tempAlice = await takeTempPassword(page);
    ctx.check('a temporary password was generated and shown', typeof tempAlice === 'string' && tempAlice.length >= 12, { length: tempAlice.length });
    await ctx.shot(page, 'temp-password-modal-1440');
    // WR-C01: the one-time password survives an accidental Escape or scrim tap.
    await page.keyboard.press('Escape');
    await page.mouse.click(4, 4); // the overlay's corner, outside the modal box
    ctx.check('Escape and a scrim click leave the temp-password modal open with the value intact',
      (await page.$('.au-modal')) !== null && (await page.inputValue('#au-temp-password')) === tempAlice);
    await page.click('#au-temp-done');
    await page.waitForSelector('.au-modal', { state: 'detached', timeout: 5000 });
    await page.waitForSelector('#users-list tr[data-username="alice"]', { timeout: 8000 });
    ctx.check('alice appears in the list as Active + Must change password', /Active/.test(await rowCell(page, 'alice', 'Status')) && /Must change password/.test(await rowCell(page, 'alice', 'Status')),
      await rowCell(page, 'alice', 'Status'));
    ctx.check('alice’s role shows the display label PMO', (await rowCell(page, 'alice', 'Role')) === 'PMO', await rowCell(page, 'alice', 'Role'));
    ctx.check('the modal input no longer holds the password (Done clears it)', (await page.$('#au-temp-password')) === null);

    // --- alice signs in (second browser context) with the temp password and rotates
    const alice = await ctx.newPage({ width: ctx.viewports.desktop.width, height: ctx.viewports.desktop.height });
    await alice.goto(ctx.base + '/login.html', { waitUntil: 'load' });
    await alice.fill('#lg-user', 'alice');
    await alice.fill('#lg-pass', tempAlice);
    await alice.click('#login-form button[type="submit"]');
    const landed = await waitForPath(alice, /change-password\.html$/, 10000);
    ctx.check('alice’s temp-password login lands on /change-password.html', landed === '/change-password.html', landed);
    await alice.waitForFunction(() => { const el = document.getElementById('cp-current'); return el && !el.disabled; }, null, { timeout: 8000 });
    const aliceNew = secret('Alice-');
    await alice.fill('#cp-current', tempAlice);
    await alice.fill('#cp-new', aliceNew);
    await alice.fill('#cp-confirm', aliceNew);
    await alice.click('#cp-submit');
    const rotated = await waitForPath(alice, /^\/(index\.html)?$/, 10000);
    ctx.check('alice rotates her password and reaches the app', rotated === '/' || rotated === '/index.html', rotated);

    const meOf = (p) => p.evaluate(() => fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((b) => ({ status: r.status, role: b && b.user && b.user.role }))));
    const meBefore = await meOf(alice);
    ctx.check('alice’s session reports role pmo', meBefore.status === 200 && meBefore.role === 'pmo', meBefore);

    // --- admin edits alice -> Employee; effective on alice's NEXT request, no re-login
    await clickRowAction(page, 'alice', 'Edit');
    await page.waitForSelector('#au-edit-role', { timeout: 5000 });
    await page.selectOption('#au-edit-role', 'employee');
    await page.click('.au-modal button[type="submit"]');
    await page.waitForSelector('.au-modal', { state: 'detached', timeout: 8000 });
    await page.waitForFunction(() => {
      const td = document.querySelector('#users-list tr[data-username="alice"] td[data-label="Role"]');
      return td && td.textContent === 'Employee';
    }, null, { timeout: 8000 });
    ctx.check('the list shows alice as Employee after the edit', true);
    const meAfter = await meOf(alice);
    ctx.check('alice’s next API call reports role employee without re-login', meAfter.status === 200 && meAfter.role === 'employee', meAfter);

    // --- admin disables alice -> her next navigation ends on /login.html
    await clickRowAction(page, 'alice', 'Disable');
    await page.waitForSelector('.au-modal .au-confirm-text', { timeout: 5000 });
    const confirmText = await page.textContent('.au-modal .au-confirm-text');
    ctx.check('the disable dialog names the effect (signs out on next request)', /signs them out everywhere on their next request/.test(confirmText), confirmText);
    await page.click('.au-modal .deal-modal-actions .btn-primary');
    await page.waitForFunction(() => {
      const td = document.querySelector('#users-list tr[data-username="alice"] td[data-label="Status"]');
      return td && /Disabled/.test(td.textContent);
    }, null, { timeout: 8000 });
    ctx.check('the list shows alice as Disabled', true);
    await alice.goto(ctx.base + '/index.html', { waitUntil: 'load' }).catch(() => {});
    const afterDisable = await waitForPath(alice, /login\.html$/, 10000);
    ctx.check('alice’s next navigation ends on /login.html', afterDisable === '/login.html', afterDisable);

    // --- re-enable, then reset her password (one-time modal again)
    await clickRowAction(page, 'alice', 'Enable');
    await page.waitForSelector('.au-modal .au-confirm-text', { timeout: 5000 });
    await page.click('.au-modal .deal-modal-actions .btn-primary');
    await page.waitForFunction(() => {
      const td = document.querySelector('#users-list tr[data-username="alice"] td[data-label="Status"]');
      return td && /Active/.test(td.textContent);
    }, null, { timeout: 8000 });
    ctx.check('the list shows alice as Active again after Enable', true);
    await clickRowAction(page, 'alice', 'Reset password');
    await page.waitForSelector('.au-modal .au-confirm-text', { timeout: 5000 });
    await page.click('.au-modal .deal-modal-actions .btn-primary');
    const resetPw = await takeTempPassword(page);
    ctx.check('reset-password shows a new temporary password once', typeof resetPw === 'string' && resetPw.length >= 12 && resetPw !== tempAlice, { length: resetPw.length });
    await page.click('#au-temp-done');
    await page.waitForSelector('.au-modal', { state: 'detached', timeout: 5000 });
    const staleAlice = await ctx.api(null, 'POST', '/api/auth/login', { username: 'alice', password: aliceNew });
    ctx.check('alice’s previous password no longer signs in after the reset', staleAlice.status === 401, staleAlice.status);

    // --- the only admin cannot demote itself: the server's message is shown in the modal
    await clickRowAction(page, 'admin', 'Edit');
    await page.waitForSelector('#au-edit-role', { timeout: 5000 });
    await page.selectOption('#au-edit-role', 'employee');
    await page.click('.au-modal button[type="submit"]');
    await page.waitForSelector('.au-modal .deal-modal-error', { state: 'visible', timeout: 8000 });
    const lastAdmin = await page.textContent('.au-modal .deal-modal-error');
    ctx.check('demoting the only admin shows the last-admin message in the modal', /At least one enabled admin must remain/.test(lastAdmin), lastAdmin);
    ctx.check('the modal stays open (the refusal is not swallowed)', (await page.$('.au-modal')) !== null);
    await page.keyboard.press('Escape');
    ctx.check('no page error (admin)', page.pageErrors.length === 0, page.pageErrors);

    // --- 390 px: the tab and its modals fit a phone without horizontal scrolling
    const phone = await ctx.newPage({ width: ctx.viewports.phone.width, height: ctx.viewports.phone.height, cookies: [adminCookie] });
    await phone.goto(ctx.base + '/admin.html', { waitUntil: 'load' });
    await phone.waitForSelector('#admin-tab-btn-users', { state: 'attached', timeout: 15000 });
    await phone.waitForFunction(() => { const b = document.getElementById('admin-tab-btn-users'); return b && b.style.display !== 'none'; }, null, { timeout: 15000 });
    await phone.evaluate(() => document.getElementById('admin-tab-btn-users').click());
    await phone.waitForSelector('#users-list .au-table', { timeout: 10000 });
    await phone.waitForSelector('#users-list tr[data-username="alice"]', { timeout: 8000 });
    await phone.waitForSelector('#tab-users.active', { timeout: 5000 });
    await ctx.sleep(600);
    const tabFit = await fits(phone);
    ctx.check('390px: the Users tab has no horizontal overflow', tabFit.ok, tabFit);
    await phone.evaluate(() => { const t = document.getElementById('tab-users'); if (t) t.scrollIntoView(); });
    await ctx.shot(phone, 'users-tab-390');
    await phone.evaluate(() => document.getElementById('btn-users-add').click());
    await phone.waitForSelector('#au-new-username', { timeout: 5000 });
    const modalFit = await phone.evaluate(() => {
      const m = document.querySelector('.au-modal');
      const r = m.getBoundingClientRect();
      return {
        inside: r.left >= 0 && r.right <= window.innerWidth,
        left: r.left, right: r.right, vw: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    ctx.check('390px: the add-user modal sits inside the viewport', modalFit.inside && modalFit.scrollWidth <= modalFit.vw, modalFit);
    await ctx.shot(phone, 'add-user-modal-390');
    await phone.keyboard.press('Escape');
    ctx.check('no page error (phone)', phone.pageErrors.length === 0, phone.pageErrors);

    // --- every console action is attributed in the audit log (T-10-47)
    const audit = await ctx.api(adminCookie, 'GET', '/api/admin/audit?user=admin&limit=500');
    const rows = Array.isArray(audit.json) ? audit.json : [];
    const forAlice = rows.filter((r) => String(r.row_id) === 'alice' && r.actor_username === 'admin');
    const actions = Array.from(new Set(forAlice.map((r) => r.action)));
    ctx.check('audit log has user-create for alice with actor admin', actions.includes('user-create'), actions);
    ctx.check('audit log has user-update for alice with actor admin', actions.includes('user-update'), actions);
    ctx.check('audit log has user-password-reset for alice with actor admin', actions.includes('user-password-reset'), actions);
    const leak = JSON.stringify(rows).includes(tempAlice) || JSON.stringify(rows).includes(resetPw);
    ctx.check('no temporary password appears in any audit row', !leak);
  },
};
