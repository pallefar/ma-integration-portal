// Phase 10 plan 10-07 Task 2: the whole admin -> user lifecycle (ACCT-01,
// D-10-03 / D-10-04) driven through the admin console Users tab in real
// Chromium, at 1440 and 390 px. Loaded by scripts/uat/phase10-walk.js.
//
// Real lane only: the admin session comes from ctx.adminLogin(). The one-time
// temporary password is read from the modal UNMASKED, so every assertion about
// the field (WR-C01 sticky contract, wiped on Done) runs against the real
// credential. It is masked in the DOM only inside shot(), which is the one way
// this module takes a screenshot (T-10-45): evidence shots never carry a
// credential, and a shot is refused unless the mask is proven to have taken.

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

const MASK = '••••';

// Reads the one-time password from the open modal. READ-ONLY: it does not touch
// the DOM, so the checks that follow assert against the real credential (the
// WR-C01 sticky check used to compare against a value this step had already
// masked, which can never be equal). Never logs it.
async function readTempPassword(page) {
  await page.waitForSelector('#au-temp-password', { timeout: 8000 });
  return page.$eval('#au-temp-password', (i) => i.value);
}

// How many places in the live DOM render `secret`: field values, text nodes and
// attribute values. -1 (fail closed) when there is no secret to look for. Only
// the count leaves the page.
function domHolders(page, secret) {
  if (typeof secret !== 'string' || secret.length < 8) return Promise.resolve(-1);
  return page.evaluate((s) => {
    let n = 0;
    document.querySelectorAll('input, textarea, select').forEach((f) => { if (String(f.value).includes(s)) n += 1; });
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { if (walker.currentNode.nodeValue.includes(s)) n += 1; }
    document.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((a) => { if (a.value.includes(s)) n += 1; });
    });
    return n;
  }, secret);
}

// T-10-45: the only way this module takes a screenshot. A one-time password
// field on the page is masked in the DOM first. When there was one, the shot
// goes ahead only if the field reads back as the mask AND none of `secrets` is
// left anywhere in the DOM; otherwise the check FAILs and no file is written,
// so a credential cannot reach the evidence directory. A page with no such
// field is shot as-is and adds no check row. Records counts only, never values.
async function shot(ctx, page, name, secrets) {
  const hadField = await page.evaluate((m) => {
    const f = document.getElementById('au-temp-password');
    if (!f) return false;
    f.value = m;
    return true;
  }, MASK);
  if (hadField) {
    const fieldReadsMask = (await page.inputValue('#au-temp-password')) === MASK;
    const left = [];
    for (const s of secrets || []) left.push(await domHolders(page, s));
    const masked = fieldReadsMask && left.length > 0 && left.every((n) => n === 0);
    ctx.check('the temporary password is masked in the DOM before the ' + name + ' screenshot (T-10-45)', masked,
      { fieldReadsMask, domCopiesLeft: left });
    if (!masked) return null;
  }
  return ctx.shot(page, name);
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
    await shot(ctx, page, 'users-tab-1440');

    // --- create alice (pmo) through the modal; the temp password is shown once
    await page.click('#btn-users-add');
    await page.waitForSelector('#au-new-username', { timeout: 5000 });
    await page.fill('#au-new-username', 'alice');
    await page.fill('#au-new-name', 'Alice Example');
    await page.selectOption('#au-new-role', 'pmo');
    await page.click('.au-modal button[type="submit"]');
    // The secret is captured BEFORE anything masks it. The one real value is
    // used four ways: the sticky check below, alice's sign-in, the DOM scans,
    // and the audit-log leak check at the end. Nothing is screenshotted until
    // shot() has masked the field.
    const tempAlice = await readTempPassword(page);
    ctx.check('a temporary password was generated and shown', typeof tempAlice === 'string' && tempAlice.length >= 12, { length: tempAlice.length });
    const renderedIn = await domHolders(page, tempAlice);
    ctx.check('shown once: the credential is rendered in exactly one place (the modal’s read-only field)', renderedIn === 1, { renderedIn });

    // WR-C01: the one-time password survives an accidental Escape or scrim tap.
    // Asserted against the REAL value (no mask exists yet), and only counted when
    // both dismissals demonstrably reached the page: "stays open" proves nothing
    // if the Escape or the scrim click never arrived.
    await page.evaluate(() => {
      const seen = { escape: 0, scrim: 0 };
      window.__uatDismissals = seen;
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') seen.escape += 1; }, true);
      document.addEventListener('click', (e) => {
        if (e.target && e.target.classList && e.target.classList.contains('au-overlay')) seen.scrim += 1;
      }, true);
    });
    await page.keyboard.press('Escape');
    await page.mouse.click(4, 4); // the overlay's corner, outside the modal box
    const dismissals = await page.evaluate(() => window.__uatDismissals);
    const modalOpen = (await page.$('.au-modal')) !== null;
    const valueIntact = modalOpen && (await page.inputValue('#au-temp-password')) === tempAlice;
    ctx.check('Escape and a scrim click leave the temp-password modal open with the value intact',
      dismissals.escape === 1 && dismissals.scrim === 1 && modalOpen && valueIntact,
      { escapeDelivered: dismissals.escape === 1, scrimDelivered: dismissals.scrim === 1, modalOpen, valueIntact });

    // T-10-45: masked in the DOM at the screenshot step (asserted inside shot()).
    await shot(ctx, page, 'temp-password-modal-1440', [tempAlice]);

    // Acknowledge. The field node is held across the click so the wipe is asserted
    // on the detached node itself: Done sets value = '' before the modal goes.
    const tempField = await page.$('#au-temp-password');
    await page.click('#au-temp-done');
    await page.waitForSelector('.au-modal', { state: 'detached', timeout: 5000 });
    await page.waitForSelector('#users-list tr[data-username="alice"]', { timeout: 8000 });
    ctx.check('alice appears in the list as Active + Must change password', /Active/.test(await rowCell(page, 'alice', 'Status')) && /Must change password/.test(await rowCell(page, 'alice', 'Status')),
      await rowCell(page, 'alice', 'Status'));
    ctx.check('alice’s role shows the display label PMO', (await rowCell(page, 'alice', 'Role')) === 'PMO', await rowCell(page, 'alice', 'Role'));
    const tempWiped = tempField ? await tempField.evaluate((i) => i.value === '' && !i.isConnected).catch(() => false) : false;
    ctx.check('the modal input no longer holds the password (Done clears it)',
      (await page.$('#au-temp-password')) === null && tempWiped, { fieldBlankedAndRemoved: tempWiped });
    // Shown once means never again: no later listing can re-deliver it.
    const listing = await ctx.api(adminCookie, 'GET', '/api/admin/users');
    const listed = listing.status === 200 && listing.json !== null;
    ctx.check('shown once: a fresh Users listing never carries the temporary password',
      listed && JSON.stringify(listing.json).indexOf(tempAlice) === -1, { status: listing.status, listed });

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
    const resetPw = await readTempPassword(page);
    ctx.check('reset-password shows a new temporary password once', typeof resetPw === 'string' && resetPw.length >= 12 && resetPw !== tempAlice, { length: resetPw.length });
    // No screenshot is taken in this modal, so the field is left UNMASKED and the
    // acknowledgement is asserted against the live credential: Done must blank
    // the field, remove it, and leave no copy anywhere in the DOM.
    const resetField = await page.$('#au-temp-password');
    const resetRenderedIn = await domHolders(page, resetPw);
    await page.click('#au-temp-done');
    await page.waitForSelector('.au-modal', { state: 'detached', timeout: 5000 });
    const resetWiped = resetField ? await resetField.evaluate((i) => i.value === '' && !i.isConnected).catch(() => false) : false;
    const resetCopiesLeft = await domHolders(page, resetPw);
    ctx.check('Done wipes the reset password: field blanked and removed, no copy left in the DOM',
      resetRenderedIn === 1 && resetWiped && resetCopiesLeft === 0 && (await page.$('#au-temp-password')) === null,
      { renderedBeforeDone: resetRenderedIn, fieldBlankedAndRemoved: resetWiped, copiesLeft: resetCopiesLeft });
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
    await shot(ctx, phone, 'users-tab-390');
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
    await shot(ctx, phone, 'add-user-modal-390');
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
