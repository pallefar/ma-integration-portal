// Admin console "Users" tab (Phase 10, plan 10-07, ACCT-01 / D-10-03 / D-10-10).
//
// Loaded by public/admin.html right after admin.js. The tab button is revealed
// only for a session whose server-confirmed role is admin (window.__portalUser,
// the transitions.js /api/auth/me handshake); the server's /api/admin/users
// prefix remains the actual control for every method.
//
// accountsWritable gating (D-10-01): GET /api/auth/mode is probed on first open.
// Only an explicit accountsWritable === true enables writes; a failed probe is
// "not writable". When not writable the list is still shown (read-only) with a
// one-line note, and no Add user / row write action is rendered.
//
// Security (T-10-44, T-10-45): usernames, names and every server message are
// assigned through textContent / createElement only — there is no HTML-string
// sink in this file (test/admin-users-ui.test.js forbids one). The temporary
// password is shown ONCE in a read-only input, is never written to storage, and
// is cleared from the input when the modal closes by any path.
(function () {
  'use strict';

  var READ_ONLY_NOTE = 'Accounts are read-only on the demo database. Start a real-deal host (start-real-deal) to add or change users.';
  var ROLE_ORDER = ['admin', 'hrbp', 'pmo', 'employee'];
  var ROLE_LABELS = { admin: 'Admin', hrbp: 'Integration Leader', pmo: 'PMO', employee: 'Employee' };

  var policy = {
    // Only an explicit true enables account writes; a missing body (failed
    // probe) or any other shape is read-only. Same truth table as
    // maAccountMenuPolicy / maChangePasswordPolicy (10-06).
    accountWritesAllowed: function (modeBody) {
      return !!modeBody && modeBody.accountsWritable === true;
    },
    roleLabel: function (role) {
      return Object.prototype.hasOwnProperty.call(ROLE_LABELS, role) ? ROLE_LABELS[role] : String(role || '');
    }
  };
  window.maAdminUsersPolicy = policy;

  if (typeof document === 'undefined') return;
  if (window.__adminUsersLoaded) return;
  window.__adminUsersLoaded = true;

  var state = { writable: false, users: [], loaded: false, loading: false };

  // ------------------------------------------------------------- helpers
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function formatTime(iso) {
    if (!iso) return 'Never';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? 'Never' : d.toLocaleString();
  }

  function currentUsername() {
    return window.__portalUser && window.__portalUser.username;
  }

  // Resolves { status, body } and never rejects: a network failure is status 0.
  function request(method, url, payload) {
    var opts = { method: method, headers: { Accept: 'application/json' } };
    if (payload !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(payload);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        return { status: r.status, body: body };
      });
    }, function () { return { status: 0, body: null }; });
  }

  // The server's refusal, shown verbatim as text (never swallowed).
  function errorText(res, fallback) {
    var b = res && res.body;
    if (b && typeof b.error === 'string' && b.error) return b.error;
    if (b && typeof b.message === 'string' && b.message) return b.message;
    if (res && res.status === 403 && b && b.committedControlDb) {
      return 'Accounts are read-only on the demo database. Start a real-deal host (start-real-deal) to change users.';
    }
    if (res && res.status === 0) return 'Could not reach the server. Check the connection and try again.';
    return fallback + ' (HTTP ' + (res ? res.status : '?') + ').';
  }

  // ------------------------------------------------------------ modal shell
  var activeModal = null;

  function closeModal() {
    if (!activeModal) return;
    var m = activeModal;
    activeModal = null;
    document.removeEventListener('keydown', m.onKeydown, true);
    if (typeof m.onClose === 'function') m.onClose();
    if (m.overlay.parentNode) m.overlay.parentNode.removeChild(m.overlay);
    if (m.trigger && typeof m.trigger.focus === 'function' && document.contains(m.trigger)) m.trigger.focus();
    else if (typeof m.fallbackFocus === 'function') m.fallbackFocus();
  }

  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.getAttribute('aria-hidden') !== 'true'; }
    );
  }

  // Opens the shared .deal-modal shell. Escape / overlay click close it; Tab is
  // trapped; focus returns to the trigger (or opts.fallbackFocus() when the
  // trigger has left the DOM, e.g. a re-rendered table row). opts.onClose runs
  // on every close path. opts.sticky (WR-C01): Escape and overlay clicks do NOT
  // close it — only the modal's own explicit control does (the one-time
  // temporary password must not be lost to a stray tap on the scrim).
  function openModal(titleText, subText, trigger, opts) {
    var sticky = !!(opts && opts.sticky);
    closeModal();
    var overlay = el('div', 'deal-modal-overlay au-overlay');
    var modal = el('div', 'deal-modal au-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    var title = el('h3', 'deal-modal-title', titleText);
    title.id = 'au-modal-title';
    modal.setAttribute('aria-labelledby', 'au-modal-title');
    modal.appendChild(title);
    if (subText) modal.appendChild(el('p', 'deal-modal-sub', subText));
    var body = el('div', 'au-modal-body');
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var onKeydown = function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (sticky) { e.preventDefault(); return; }
        closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      var f = focusables(modal);
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', function (e) { if (e.target === overlay && !sticky) closeModal(); });
    activeModal = {
      overlay: overlay, trigger: trigger || null, onKeydown: onKeydown,
      onClose: opts && opts.onClose, fallbackFocus: opts && opts.fallbackFocus
    };
    return { modal: modal, body: body, close: closeModal };
  }

  function focusFirst(root) {
    var f = focusables(root);
    if (f.length) f[0].focus();
  }

  function errorLine() {
    var p = el('p', 'deal-modal-error');
    p.setAttribute('role', 'alert');
    p.style.display = 'none';
    return p;
  }

  function showError(p, text) { p.textContent = text; p.style.display = ''; }

  function fieldLabel(text, control, hint) {
    var label = el('label', 'deal-modal-field');
    label.appendChild(el('span', null, text));
    label.appendChild(control);
    if (hint) label.appendChild(el('small', 'au-hint', hint));
    return label;
  }

  function textInput(autocomplete) {
    var i = document.createElement('input');
    i.type = 'text';
    i.setAttribute('autocomplete', autocomplete || 'off');
    i.setAttribute('autocapitalize', 'off');
    i.spellcheck = false;
    return i;
  }

  function roleSelect(selected) {
    var s = document.createElement('select');
    s.className = 'au-select';
    ROLE_ORDER.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r;
      o.textContent = ROLE_LABELS[r];
      if (r === selected) o.selected = true;
      s.appendChild(o);
    });
    return s;
  }

  // ------------------------------------------------- one-time temp password
  // Shown once. The value lives only in this read-only input and is blanked
  // when the modal closes. WR-C01: the modal is STICKY — Escape and a click on
  // the scrim do nothing; the only way out is the explicit "I have saved it"
  // acknowledgement, so the credential cannot be lost to an accidental dismiss
  // (whose only recovery would be a second, side-effect-bearing reset). On close
  // focus returns to the trigger, or — when the list re-rendered under it — to
  // the user's row in the table, else the Add user button.
  function focusUserRow(username) {
    var rows = document.querySelectorAll('#users-list tr[data-username]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-username') === username) {
        var b = rows[i].querySelector('button');
        if (b) { b.focus(); return; }
      }
    }
    var add = document.getElementById('btn-users-add');
    if (add && typeof add.focus === 'function') add.focus();
  }

  function openTempPasswordModal(username, tempPassword, headline, trigger) {
    var input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.className = 'au-temp-input';
    input.id = 'au-temp-password';
    input.setAttribute('autocomplete', 'off');
    input.value = tempPassword;
    var shell = openModal(headline, 'Temporary password for ' + username + '.', trigger || null, {
      sticky: true,
      onClose: function () { input.value = ''; },
      fallbackFocus: function () { focusUserRow(username); }
    });
    shell.body.appendChild(fieldLabel('Temporary password', input));
    var warn = el('p', 'au-warning', 'Shown once. Copy it and share it securely — the user must change it at first sign-in. This window stays open until you confirm you have saved it.');
    warn.setAttribute('role', 'status');
    shell.body.appendChild(warn);
    var actions = el('div', 'deal-modal-actions');
    var copy = el('button', 'btn btn-secondary', 'Copy');
    copy.type = 'button';
    copy.id = 'au-temp-copy';
    var done = el('button', 'btn btn-primary', 'I have saved it');
    done.type = 'button';
    done.id = 'au-temp-done';
    actions.appendChild(copy);
    actions.appendChild(done);
    shell.body.appendChild(actions);
    copy.addEventListener('click', function () {
      var selectIt = function () { input.focus(); input.select(); };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(input.value).then(function () {
          copy.textContent = 'Copied';
        }, selectIt);
      } else {
        selectIt();
      }
    });
    done.addEventListener('click', function () { input.value = ''; shell.close(); });
    copy.focus();
  }
  // Test seam (test/admin-users-ui.test.js drives the sticky contract in a
  // node:vm fake DOM). Exposes nothing a console user could not already do.
  window.maAdminUsersModal = {
    openTempPasswordModal: openTempPasswordModal,
    isOpen: function () { return !!activeModal; },
    loadUsers: function () { return loadUsers(); }
  };

  // ------------------------------------------------------------ add user
  function openAddUser(trigger) {
    if (!state.writable) return;
    var shell = openModal('Add user', 'Create an account. The user signs in with a temporary password and must change it at first sign-in.', trigger);
    var form = el('form', 'deal-modal-form');
    form.setAttribute('novalidate', 'novalidate');
    var username = textInput('off');
    var name = textInput('off');
    var role = roleSelect('employee');
    var temp = document.createElement('input');
    temp.type = 'password';
    temp.setAttribute('autocomplete', 'new-password');
    username.id = 'au-new-username';
    name.id = 'au-new-name';
    role.id = 'au-new-role';
    temp.id = 'au-new-temp';
    form.appendChild(fieldLabel('Username', username, '3–40 characters: a–z, 0–9, dot, dash, underscore'));
    form.appendChild(fieldLabel('Full name', name));
    form.appendChild(fieldLabel('Role', role));
    form.appendChild(fieldLabel('Temporary password (optional)', temp, 'Leave blank to generate one'));
    var err = errorLine();
    form.appendChild(err);
    var actions = el('div', 'deal-modal-actions');
    var cancel = el('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    var save = el('button', 'btn btn-primary', 'Create user');
    save.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);
    shell.body.appendChild(form);
    cancel.addEventListener('click', shell.close);
    focusFirst(shell.modal);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.style.display = 'none';
      var payload = {
        username: username.value.trim().toLowerCase(),
        name: name.value.trim(),
        role: role.value
      };
      if (!payload.username) { showError(err, 'Enter a username.'); return; }
      if (!payload.name) { showError(err, 'Enter the user’s full name.'); return; }
      if (temp.value) payload.tempPassword = temp.value;
      save.disabled = true;
      request('POST', '/api/admin/users', payload).then(function (res) {
        save.disabled = false;
        if (res.status === 201 && res.body && res.body.user && typeof res.body.tempPassword === 'string') {
          var created = res.body.user.username || payload.username;
          var pw = res.body.tempPassword;
          temp.value = '';
          shell.close();
          loadUsers();
          openTempPasswordModal(created, pw, 'User created', trigger);
          return;
        }
        if (res.status === 409) {
          showError(err, errorText(res, 'That username is already taken') +
            ' If an earlier attempt timed out the account may already exist — use Reset password on it.');
          return;
        }
        showError(err, errorText(res, 'Could not create the user'));
      });
    });
  }

  // ------------------------------------------------------------- list view
  function badge(text, cls) { return el('span', 'au-badge ' + cls, text); }

  function renderList() {
    var host = document.getElementById('users-list');
    var addBtn = document.getElementById('btn-users-add');
    var note = document.getElementById('users-readonly-note');
    if (!host) return;
    if (addBtn) addBtn.style.display = state.writable ? '' : 'none';
    if (note) {
      note.textContent = state.writable ? '' : READ_ONLY_NOTE;
      note.style.display = state.writable ? 'none' : '';
    }
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!state.users.length) {
      host.appendChild(el('p', 'au-empty', 'No accounts yet.'));
      return;
    }
    var wrap = el('div', 'au-table-wrap');
    var table = el('table', 'au-table');
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Username', 'Name', 'Role', 'Status', 'Last sign-in', 'Actions'].forEach(function (h) {
      hr.appendChild(el('th', null, h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    state.users.forEach(function (u) { tbody.appendChild(renderRow(u)); });
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function cell(label, className) {
    var td = el('td', className || null);
    td.setAttribute('data-label', label);
    return td;
  }

  function renderRow(u) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-username', u.username);
    var c = cell('Username', 'au-username');
    c.textContent = u.username;
    tr.appendChild(c);
    c = cell('Name');
    c.textContent = u.name || '';
    tr.appendChild(c);
    c = cell('Role');
    c.textContent = policy.roleLabel(u.role);
    tr.appendChild(c);
    c = cell('Status');
    c.appendChild(badge(u.disabled ? 'Disabled' : 'Active', u.disabled ? 'au-badge-off' : 'au-badge-on'));
    if (u.mustChangePassword) c.appendChild(badge('Must change password', 'au-badge-warn'));
    tr.appendChild(c);
    c = cell('Last sign-in');
    c.textContent = formatTime(u.lastLoginAt);
    tr.appendChild(c);
    c = cell('Actions', 'au-actions');
    if (state.writable) renderRowActions(c, u);
    tr.appendChild(c);
    return tr;
  }

  // ------------------------------------------------------- row actions
  // Rendered only when accounts are writable (renderRow gates the call).
  function actionButton(label, onClick) {
    var b = el('button', 'btn btn-secondary', label);
    b.type = 'button';
    b.addEventListener('click', function () { onClick(b); });
    return b;
  }

  function renderRowActions(container, u) {
    var own = currentUsername() && u.username === currentUsername();
    container.appendChild(actionButton('Edit', function (b) { openEditUser(u, b); }));
    // The signed-in admin never gets a Disable on their own row (the server
    // refuses it too — 409 self-disable).
    if (!own) {
      if (u.disabled) {
        container.appendChild(actionButton('Enable', function (b) { openToggleDisabled(u, false, b); }));
      } else {
        container.appendChild(actionButton('Disable', function (b) { openToggleDisabled(u, true, b); }));
      }
    }
    container.appendChild(actionButton('Reset password', function (b) { openResetPassword(u, b); }));
  }

  function userUrl(username) { return '/api/admin/users/' + encodeURIComponent(username); }

  function openEditUser(u, trigger) {
    if (!state.writable) return;
    var shell = openModal('Edit user', 'Change the name or role for ' + u.username + '. A role change applies on their next request.', trigger);
    var form = el('form', 'deal-modal-form');
    form.setAttribute('novalidate', 'novalidate');
    var name = textInput('off');
    name.value = u.name || '';
    var role = roleSelect(u.role);
    name.id = 'au-edit-name';
    role.id = 'au-edit-role';
    form.appendChild(fieldLabel('Full name', name));
    form.appendChild(fieldLabel('Role', role));
    var err = errorLine();
    form.appendChild(err);
    var actions = el('div', 'deal-modal-actions');
    var cancel = el('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    var save = el('button', 'btn btn-primary', 'Save');
    save.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);
    shell.body.appendChild(form);
    cancel.addEventListener('click', shell.close);
    focusFirst(shell.modal);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.style.display = 'none';
      var patch = {};
      var newName = name.value.trim();
      if (!newName) { showError(err, 'Enter the user’s full name.'); return; }
      if (newName !== (u.name || '')) patch.name = newName;
      if (role.value !== u.role) patch.role = role.value;
      if (!Object.keys(patch).length) { shell.close(); return; }
      save.disabled = true;
      request('PATCH', userUrl(u.username), patch).then(function (res) {
        save.disabled = false;
        if (res.status === 200 && res.body && res.body.user) {
          shell.close();
          loadUsers();
          return;
        }
        showError(err, errorText(res, 'Could not update the user'));
      });
    });
  }

  // A small confirm dialog. run() returns a promise of {status, body}; success
  // is decided by isOk(res); the server's refusal text stays in the dialog.
  function openConfirm(opts) {
    var shell = openModal(opts.title, null, opts.trigger);
    shell.body.appendChild(el('p', 'au-confirm-text', opts.text));
    var err = errorLine();
    shell.body.appendChild(err);
    var actions = el('div', 'deal-modal-actions');
    var cancel = el('button', 'btn btn-secondary', 'Cancel');
    cancel.type = 'button';
    var go = el('button', 'btn btn-primary', opts.confirmLabel);
    go.type = 'button';
    actions.appendChild(cancel);
    actions.appendChild(go);
    shell.body.appendChild(actions);
    cancel.addEventListener('click', shell.close);
    go.focus();
    go.addEventListener('click', function () {
      err.style.display = 'none';
      go.disabled = true;
      opts.run().then(function (res) {
        go.disabled = false;
        if (opts.isOk(res)) { opts.onSuccess(res, shell); return; }
        showError(err, errorText(res, opts.failure));
      });
    });
  }

  function openToggleDisabled(u, disable, trigger) {
    if (!state.writable) return;
    openConfirm({
      title: disable ? 'Disable ' + u.username + '?' : 'Enable ' + u.username + '?',
      text: disable
        ? 'Disabling ' + u.username + ' signs them out everywhere on their next request and blocks sign-in. Their account and audit trail are kept; you can re-enable it later.'
        : 'Enabling ' + u.username + ' lets them sign in again. Any sessions they had were ended when the account was disabled, so they must sign in afresh.',
      confirmLabel: disable ? 'Disable user' : 'Enable user',
      failure: disable ? 'Could not disable the user' : 'Could not enable the user',
      trigger: trigger,
      run: function () { return request('PATCH', userUrl(u.username), { disabled: disable }); },
      isOk: function (res) { return res.status === 200 && !!(res.body && res.body.user); },
      onSuccess: function (res, shell) { shell.close(); loadUsers(); }
    });
  }

  function openResetPassword(u, trigger) {
    if (!state.writable) return;
    openConfirm({
      title: 'Reset password for ' + u.username + '?',
      text: 'This generates a new temporary password, signs ' + u.username + ' out everywhere, and requires them to choose a new password at their next sign-in. The temporary password is shown once.',
      confirmLabel: 'Reset password',
      failure: 'Could not reset the password',
      trigger: trigger,
      run: function () { return request('POST', userUrl(u.username) + '/reset-password', {}); },
      isOk: function (res) { return res.status === 200 && !!res.body && typeof res.body.tempPassword === 'string'; },
      onSuccess: function (res, shell) {
        var pw = res.body.tempPassword;
        var who = (res.body.user && res.body.user.username) || u.username;
        shell.close();
        loadUsers();
        openTempPasswordModal(who, pw, 'Password reset', trigger);
      }
    });
  }

  // IN-C03: a load requested while another is in flight is QUEUED, not dropped —
  // a create/edit/reset that lands during the initial (slow, 503-retried) load
  // would otherwise never be re-fetched. One trailing reload covers any number
  // of requests made meanwhile; it runs after the in-flight load settles.
  var inFlight = null;
  function loadUsers() {
    var host = document.getElementById('users-list');
    if (!host) return Promise.resolve();
    if (state.loading) {
      state.pending = true;
      return inFlight || Promise.resolve();
    }
    state.loading = true;
    state.pending = false;
    inFlight = request('GET', '/api/admin/users').then(function (res) {
      state.loading = false;
      inFlight = null;
      if (state.pending) { state.pending = false; return loadUsers(); }
      if (res.status === 200 && res.body) {
        state.users = Array.isArray(res.body) ? res.body : (Array.isArray(res.body.users) ? res.body.users : []);
        state.loaded = true;
        renderList();
        return;
      }
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(el('p', 'deal-modal-error', errorText(res, 'Could not load users')));
    });
    return inFlight;
  }

  // ---------------------------------------------------------------- boot
  // IN-C03: the first click probes the mode and loads; every later click on the
  // Users tab re-fetches the list, so the operator always has an in-page
  // refresh path without reloading the whole console.
  var opened = false;
  function openTab() {
    if (opened) { loadUsers(); return; }
    opened = true;
    request('GET', '/api/auth/mode').then(function (res) {
      state.writable = policy.accountWritesAllowed(res.status === 200 ? res.body : null);
      return loadUsers();
    });
  }

  (function init() {
    var btn = document.getElementById('admin-tab-btn-users');
    var add = document.getElementById('btn-users-add');
    if (!btn) return;
    btn.addEventListener('click', openTab);
    if (add) add.addEventListener('click', function () { openAddUser(add); });
    (function poll(tries) {
      if (!window.__portalUser && tries < 40) { setTimeout(function () { poll(tries + 1); }, 250); return; }
      if (window.__portalUser && window.__portalUser.role === 'admin') btn.style.display = '';
    })(0);
  })();
})();
