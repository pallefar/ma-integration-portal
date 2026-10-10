// Standalone change-password screen (Phase 10, plan 10-06, D-10-05 client half).
//
// A user whose account carries mustChangePassword is sent here by the login
// page, the /api/auth/me handshake in transitions.js and the 403
// {mustChangePassword:true} marker; the server gate (plan 10-05) is the real
// control, this page is the way through it. Standalone on purpose (no
// transitions.js): a forced user must not be able to navigate the app from it.
//
// accountsWritable gating (D-10-01): when GET /api/auth/mode does not say
// accountsWritable === true — the committed demo control.db is active, or the
// probe failed — the form is disabled with one explanatory line instead of
// offering a submit that could only be refused with 403 {committedControlDb}.
//
// Every string reaches the DOM through textContent (D-10-10, T-10-39).
(function () {
  'use strict';

  var MIN_LENGTH_REAL = 12;
  var MIN_LENGTH_OTHER = 8;
  var READ_ONLY_NOTE = 'Accounts are read-only on the demo database. Start a real-deal host (start-real-deal) to change passwords.';

  var policy = {
    // True only for an explicit accountsWritable === true; a failed probe, a
    // missing key or any other value is "not writable".
    accountWritesAllowed: function (modeBody) {
      return !!modeBody && modeBody.accountsWritable === true;
    },
    // The server is authoritative; this is only the client-side early check.
    minLength: function (modeBody) {
      return modeBody && modeBody.mode === 'real' ? MIN_LENGTH_REAL : MIN_LENGTH_OTHER;
    }
  };
  window.maChangePasswordPolicy = policy;

  if (typeof document === 'undefined' || !document.getElementById('cp-form')) return;

  var form = document.getElementById('cp-form');
  var title = document.getElementById('cp-title');
  var intro = document.getElementById('cp-intro');
  var readonlyNote = document.getElementById('cp-readonly');
  var hint = document.getElementById('cp-hint');
  var notice = document.getElementById('cp-notice');
  var submitBtn = document.getElementById('cp-submit');
  var signoutBtn = document.getElementById('cp-signout');
  var fields = {
    current: document.getElementById('cp-current'),
    next: document.getElementById('cp-new'),
    confirm: document.getElementById('cp-confirm')
  };

  var minLen = MIN_LENGTH_OTHER;
  var writable = false;

  function showNotice(text) {
    notice.textContent = text;
    notice.style.display = 'block';
  }
  function clearNotice() {
    notice.textContent = '';
    notice.style.display = 'none';
  }
  function setFormEnabled(on) {
    fields.current.disabled = !on;
    fields.next.disabled = !on;
    fields.confirm.disabled = !on;
    submitBtn.disabled = !on;
  }

  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // Disabled until we know who the user is and whether writes are possible.
  setFormEnabled(false);

  Promise.all([getJson('/api/auth/me'), getJson('/api/auth/mode')]).then(function (both) {
    var me = both[0];
    var modeBody = both[1];
    if (!me || !me.user) { window.location.href = '/login.html'; return; }
    if (me.user.mustChangePassword === true) {
      title.textContent = 'You must change your password';
      intro.textContent = 'Your password was set by an administrator. Choose a new password to continue.';
    }
    minLen = policy.minLength(modeBody);
    hint.textContent = 'At least ' + minLen + ' characters.';
    writable = policy.accountWritesAllowed(modeBody);
    if (!writable) {
      readonlyNote.textContent = READ_ONLY_NOTE;
      readonlyNote.style.display = 'block';
      setFormEnabled(false);
      return;
    }
    setFormEnabled(true);
    fields.current.focus();
  });

  signoutBtn.addEventListener('click', function () {
    // [security] SAFE-07 / D-13-06 (b): the server logout runs inside
    // clearOnLogout, which then clears client storage/caches (language key
    // preserved). A missing module (script blocked) still signs out.
    var leave = function () { window.location.href = '/login.html'; };
    if (window.MAClientStorage && typeof window.MAClientStorage.clearOnLogout === 'function') {
      window.MAClientStorage.clearOnLogout().then(leave, leave);
    } else {
      fetch('/api/auth/logout', { method: 'POST' }).then(leave, leave);
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!writable) return;
    clearNotice();
    var current = fields.current.value;
    var next = fields.next.value;
    var confirm = fields.confirm.value;
    if (!current) { showNotice('Enter your current password.'); return; }
    if (next.length < minLen) { showNotice('The new password must be at least ' + minLen + ' characters.'); return; }
    if (next !== confirm) { showNotice('The new password and its confirmation do not match.'); return; }
    submitBtn.disabled = true;
    var status = 0;
    fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next })
    }).then(function (r) {
      status = r.status;
      return r.json().catch(function () { return null; });
    }).then(function (body) {
      if (status === 200 && body && body.success) { window.location.href = '/'; return; }
      submitBtn.disabled = false;
      if (status === 401 && body && body.authRequired) { window.location.href = '/login.html'; return; }
      if (status === 401) { showNotice('Current password is incorrect.'); return; }
      var text = body && typeof body.error === 'string' && body.error ? body.error : 'The password could not be changed. Try again.';
      showNotice(text);
    }).catch(function () {
      submitBtn.disabled = false;
      showNotice('The password could not be changed. Try again.');
    });
  });
})();
