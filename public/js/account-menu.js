// Header-menu self-service: "Change password" and "My sessions"
// (Phase 10, plan 10-06, ACCT-06 / D-10-07 / D-10-10).
//
// Loaded once, app-wide, by public/js/transitions.js after /api/auth/me returns
// a user (the same id-guarded way deal-switcher.js is). Any signed-in role gets
// both items. They mount into the shared profile dropdown
// (#profile-dropdown-card .dropdown-body) and, next to the Logout link, into
// .sidebar-footer — so at least one is reachable at every width.
//
// accountsWritable gating (D-10-01): when GET /api/auth/mode does not say
// accountsWritable === true (the committed demo control.db is active, or the
// probe failed) "Change password" is rendered DISABLED with a one-line note, and
// "My sessions" lists sessions WITHOUT End-session buttons — dev/demo shows one
// consistent read-only account surface instead of a control that can only fail.
//
// Security (T-10-39): every node is built with createElement / textContent /
// setAttribute — session user agents, IPs and names come from the server and
// are never assigned as HTML. Modals reuse the .deal-modal shell from
// style.css; account.css only adds the menu items, the session rows and the
// <= 480px rules.
(function () {
  'use strict';
  if (window.__accountMenuLoaded) return;
  window.__accountMenuLoaded = true;

  var READ_ONLY_NOTE = 'Read-only demo accounts — password changes need a real-deal host (start-real-deal).';
  var MIN_LENGTH_REAL = 12;
  var MIN_LENGTH_OTHER = 8;
  var DEVICE_MAX = 80;

  var policy = {
    // Same truth table as maChangePasswordPolicy: only an explicit true.
    accountWritesAllowed: function (modeBody) {
      return !!modeBody && modeBody.accountsWritable === true;
    },
    minLength: function (modeBody) {
      return modeBody && modeBody.mode === 'real' ? MIN_LENGTH_REAL : MIN_LENGTH_OTHER;
    },
    // A session's device label: the user agent shortened to 80 characters.
    deviceLabel: function (userAgent) {
      var ua = typeof userAgent === 'string' ? userAgent.trim() : '';
      if (!ua) return 'Unknown device';
      return ua.length > DEVICE_MAX ? ua.slice(0, DEVICE_MAX - 1) + '…' : ua;
    }
  };
  window.maAccountMenuPolicy = policy;

  if (typeof document === 'undefined') return;

  var state = { writable: false, minLen: MIN_LENGTH_OTHER };

  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function formatTime(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  // ------------------------------------------------------------ modal shell
  var activeModal = null;

  function closeModal() {
    if (!activeModal) return;
    var m = activeModal;
    activeModal = null;
    document.removeEventListener('keydown', m.onKeydown, true);
    if (m.overlay.parentNode) m.overlay.parentNode.removeChild(m.overlay);
    if (m.trigger && typeof m.trigger.focus === 'function' && document.contains(m.trigger)) m.trigger.focus();
  }

  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.getAttribute('aria-hidden') !== 'true'; }
    );
  }

  // Opens the .deal-modal shell; returns { modal, body, close }. Escape and an
  // overlay click close it; focus moves into it and back to the trigger.
  function openModal(titleText, subText, trigger) {
    closeModal();
    // Tuck the profile dropdown away so it is not left open behind the scrim.
    var card = document.getElementById('profile-dropdown-card');
    if (card) card.classList.remove('show');
    var menu = document.querySelector('.user-profile-menu');
    if (menu) menu.classList.remove('open');
    var overlay = el('div', 'deal-modal-overlay am-overlay');
    var modal = el('div', 'deal-modal am-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    var title = el('h3', 'deal-modal-title', titleText);
    title.id = 'am-modal-title';
    modal.setAttribute('aria-labelledby', 'am-modal-title');
    modal.appendChild(title);
    if (subText) modal.appendChild(el('p', 'deal-modal-sub', subText));
    var body = el('div', 'am-modal-body');
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var onKeydown = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(modal);
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    activeModal = { overlay: overlay, trigger: trigger || null, onKeydown: onKeydown };
    return { modal: modal, body: body, close: closeModal };
  }

  function focusFirst(root) {
    var f = focusables(root);
    if (f.length) f[0].focus();
  }

  // ------------------------------------------------------ change password
  function openChangePassword(trigger) {
    if (!state.writable) return; // disabled control: never reachable, belt and braces
    var shell = openModal('Change password', 'Choose a new password for your account.', trigger);
    var form = el('form', 'deal-modal-form');
    form.setAttribute('novalidate', 'novalidate');
    var inputs = {};
    [
      ['current', 'Current password', 'current-password'],
      ['next', 'New password (at least ' + state.minLen + ' characters)', 'new-password'],
      ['confirm', 'Confirm new password', 'new-password']
    ].forEach(function (spec) {
      var label = el('label', 'deal-modal-field');
      label.appendChild(el('span', null, spec[1]));
      var input = document.createElement('input');
      input.type = 'password';
      input.setAttribute('autocomplete', spec[2]);
      label.appendChild(input);
      form.appendChild(label);
      inputs[spec[0]] = input;
    });
    var errorEl = el('p', 'deal-modal-error');
    errorEl.setAttribute('role', 'alert');
    errorEl.style.display = 'none';
    form.appendChild(errorEl);
    var okEl = el('p', 'am-success');
    okEl.setAttribute('role', 'status');
    okEl.style.display = 'none';
    form.appendChild(okEl);
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

    function showError(text) { errorEl.textContent = text; errorEl.style.display = ''; }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.style.display = 'none';
      var current = inputs.current.value;
      var next = inputs.next.value;
      if (!current) { showError('Enter your current password.'); return; }
      if (next.length < state.minLen) { showError('The new password must be at least ' + state.minLen + ' characters.'); return; }
      if (next !== inputs.confirm.value) { showError('The new password and its confirmation do not match.'); return; }
      save.disabled = true;
      var status = 0;
      fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      }).then(function (r) {
        status = r.status;
        return r.json().catch(function () { return null; });
      }).then(function (body) {
        if (status === 200 && body && body.success) {
          okEl.textContent = 'Password changed. Your other sessions were signed out.';
          okEl.style.display = '';
          Object.keys(inputs).forEach(function (k) { inputs[k].disabled = true; });
          cancel.textContent = 'Close';
          save.style.display = 'none';
          setTimeout(function () { if (activeModal && activeModal.overlay === shell.modal.parentNode) closeModal(); }, 1800);
          return;
        }
        save.disabled = false;
        if (status === 401) { showError('Current password is incorrect.'); return; }
        showError(body && typeof body.error === 'string' && body.error ? body.error : 'The password could not be changed. Try again.');
      }).catch(function () {
        save.disabled = false;
        showError('The password could not be changed. Try again.');
      });
    });
  }

  // ------------------------------------------------------------ my sessions
  function openSessions(trigger) {
    var shell = openModal('My sessions', 'Where your account is signed in right now.', trigger);
    if (!state.writable) shell.body.appendChild(el('p', 'am-note', READ_ONLY_NOTE));
    var errorEl = el('p', 'deal-modal-error');
    errorEl.setAttribute('role', 'alert');
    errorEl.style.display = 'none';
    shell.body.appendChild(errorEl);
    var list = el('div', 'am-sessions');
    shell.body.appendChild(list);
    var actions = el('div', 'deal-modal-actions');
    var close = el('button', 'btn btn-secondary', 'Close');
    close.type = 'button';
    close.addEventListener('click', shell.close);
    actions.appendChild(close);
    shell.body.appendChild(actions);
    focusFirst(shell.modal);

    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

    function render(rows) {
      clear(list);
      if (!rows.length) { list.appendChild(el('p', 'am-note', 'No active sessions.')); return; }
      rows.forEach(function (s) {
        var row = el('div', 'am-session');
        var info = el('div', 'am-session-info');
        var head = el('div', 'am-session-head');
        head.appendChild(el('span', 'am-session-device', policy.deviceLabel(s.userAgent)));
        if (s.current) head.appendChild(el('span', 'am-badge', 'This device'));
        info.appendChild(head);
        if (s.ip) info.appendChild(el('div', 'am-session-meta', 'IP ' + s.ip));
        var when = formatTime(s.createdAt);
        if (when) info.appendChild(el('div', 'am-session-meta', 'Signed in ' + when));
        var until = formatTime(s.expiresAt);
        if (until) info.appendChild(el('div', 'am-session-meta', 'Expires ' + until));
        row.appendChild(info);
        if (state.writable) {
          var end = el('button', 'btn btn-secondary am-session-end', 'End session');
          end.type = 'button';
          end.addEventListener('click', function () { endSession(s, end); });
          row.appendChild(end);
        }
        list.appendChild(row);
      });
    }

    function load() {
      return fetch('/api/auth/sessions', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('status ' + r.status)); })
        .then(function (rows) { render(Array.isArray(rows) ? rows : []); })
        .catch(function () {
          clear(list);
          errorEl.textContent = 'Your sessions could not be loaded. Try again.';
          errorEl.style.display = '';
        });
    }

    function endSession(s, button) {
      errorEl.style.display = 'none';
      button.disabled = true;
      var status = 0;
      // [security] WR-B01 (Phase 13 review, Part B) / D-13-06 (b): ending the
      // CURRENT session is a sign-out, so it clears the browser like the other
      // two sign-out paths (MAClientStorage.clearOnLogout). The server answers
      // that case with Clear-Site-Data, which can wipe localStorage as soon as
      // the DELETE response lands, so the language preference is snapshotted
      // BEFORE the request and put back before leaving.
      var langKeys = (window.MAClientStorage && window.MAClientStorage.LANGUAGE_KEYS) || ['employeeLanguage'];
      var keptLang = {};
      langKeys.forEach(function (k) {
        try { var v = localStorage.getItem(k); if (v !== null && v !== undefined) keptLang[k] = v; } catch (e) { /* storage unavailable */ }
      });
      fetch('/api/auth/sessions/' + encodeURIComponent(s.id), { method: 'DELETE' }).then(function (r) {
        status = r.status;
        return r.json().catch(function () { return null; });
      }).then(function (body) {
        if (status === 200 && body && body.success) {
          if (body.endedCurrent === true || s.current) {
            var leave = function () {
              Object.keys(keptLang).forEach(function (k) {
                try { localStorage.setItem(k, keptLang[k]); } catch (e) { /* storage unavailable */ }
              });
              window.location.href = '/login.html';
            };
            (window.MAClientStorage ? window.MAClientStorage.clearOnLogout() : Promise.resolve()).then(leave, leave);
            return;
          }
          return load();
        }
        button.disabled = false;
        errorEl.textContent = status === 404 ? 'That session has already ended.' : 'The session could not be ended. Try again.';
        errorEl.style.display = '';
        if (status === 404) return load();
      }).catch(function () {
        button.disabled = false;
        errorEl.textContent = 'The session could not be ended. Try again.';
        errorEl.style.display = '';
      });
    }

    load();
  }

  // ------------------------------------------------------------- menu items
  function buildItems(variant) {
    var wrap = el('div', 'am-menu am-menu--' + variant);
    var changeBtn = el('button', 'am-item', 'Change password');
    changeBtn.type = 'button';
    changeBtn.setAttribute('data-am', 'change-password');
    if (state.writable) {
      changeBtn.addEventListener('click', function () { openChangePassword(changeBtn); });
    } else {
      changeBtn.disabled = true;
      changeBtn.setAttribute('aria-disabled', 'true');
    }
    wrap.appendChild(changeBtn);
    if (!state.writable) wrap.appendChild(el('p', 'am-note', READ_ONLY_NOTE));
    var sessBtn = el('button', 'am-item', 'My sessions');
    sessBtn.type = 'button';
    sessBtn.setAttribute('data-am', 'my-sessions');
    sessBtn.addEventListener('click', function () { openSessions(sessBtn); });
    wrap.appendChild(sessBtn);
    return wrap;
  }

  function mount() {
    var tries = 0;
    var mounted = { dropdown: false, sidebar: false };
    (function attempt() {
      if (!mounted.dropdown) {
        var body = document.querySelector('#profile-dropdown-card .dropdown-body');
        if (body) { body.appendChild(buildItems('dropdown')); mounted.dropdown = true; }
      }
      if (!mounted.sidebar) {
        var foot = document.querySelector('.sidebar-footer');
        if (foot) { foot.appendChild(buildItems('sidebar')); mounted.sidebar = true; }
      }
      if (mounted.dropdown && mounted.sidebar) return;
      if (tries++ < 40) setTimeout(attempt, 250); // ~10 s, like the logout-link injection
    })();
  }

  function injectStyles() {
    if (document.getElementById('account-css')) return;
    var link = document.createElement('link');
    link.id = 'account-css';
    link.rel = 'stylesheet';
    link.href = '/css/account.css?v=1791700103';
    document.head.appendChild(link);
  }

  Promise.all([getJson('/api/auth/me'), getJson('/api/auth/mode')]).then(function (both) {
    var me = both[0];
    var modeBody = both[1];
    if (!me || !me.user) return; // signed out, or demo-open anonymous: nothing to manage
    state.writable = policy.accountWritesAllowed(modeBody);
    state.minLen = policy.minLength(modeBody);
    injectStyles();
    mount();
  });
})();
