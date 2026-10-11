// Mode-aware sign-in page (Phase 10, plan 10-06, D-10-08c / D-10-10).
//
// [security] The published demo credentials are NOT in login.html. The panel is
// built here, from DOM nodes, and only when the unauthenticated
// GET /api/auth/mode probe says the host is a dev host or a demo-open host. A
// real-deal host (mode 'real'), a probe that failed, or any unrecognised body
// renders no panel at all (fail closed) — so a real host's page never displays
// a credential that would open a demo account.
//
// WINDOWS #4 / D-10-08: this page never redirects when there is no session, in
// any mode. The old page bounced to '/' whenever the probe said auth was
// disabled, which in a demo-open host with no cookie sent the tab
// '/' -> /api/deals 401 -> /login.html -> '/' forever. A signed-in user is
// still sent on.
(function () {
  'use strict';

  // The published demo password, kept as ONE constant. It is only ever put into
  // the DOM by the demo panel's fill buttons and hint line, which render only
  // when shouldShowDemoPanel() is true.
  var DEMO_PASSWORD = 'TEdemo!2026';
  var DEMO_ACCOUNTS = [
    { username: 'admin', label: 'Portal Admin' },
    { username: 'karen', label: 'Integration Leader' },
    { username: 'pmo', label: 'PMO Lead' }
  ];

  var policy = {
    // True only for a dev host or a demo-open host. Anything else — real mode,
    // a missing body (failed probe), an unknown mode — shows nothing.
    shouldShowDemoPanel: function (modeBody) {
      if (!modeBody || typeof modeBody !== 'object') return false;
      if (modeBody.mode === 'real') return false;
      return modeBody.mode === 'dev' || modeBody.demoOpen === true;
    },
    // Where a signed-in user goes: the forced change-password screen when the
    // account must rotate its password (D-10-05), the app otherwise.
    landingFor: function (user, mustChange) {
      return mustChange ? '/change-password.html' : '/';
    }
  };
  window.maLoginPolicy = policy;

  if (typeof document === 'undefined' || !document.getElementById('login-form')) return;

  var form = document.getElementById('login-form');
  var userInput = document.getElementById('lg-user');
  var passInput = document.getElementById('lg-pass');
  var notice = document.getElementById('lg-notice');
  var slot = document.getElementById('lg-demo-slot');

  function showNotice(text) {
    notice.textContent = text;
    notice.style.display = 'block';
  }
  function clearNotice() {
    notice.textContent = '';
    notice.style.display = 'none';
  }

  function buildDemoPanel(modeBody) {
    var wrap = document.createElement('div');
    wrap.className = 'lg-demo';
    var title = document.createElement('div');
    title.className = 'lg-demo-title';
    title.textContent = 'Demo accounts (for testing)';
    wrap.appendChild(title);
    DEMO_ACCOUNTS.forEach(function (acct) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lg-demo-row';
      b.setAttribute('data-user', acct.username);
      var strong = document.createElement('strong');
      strong.textContent = acct.username;
      b.appendChild(strong);
      b.appendChild(document.createTextNode(' · ' + acct.label));
      b.addEventListener('click', function () {
        userInput.value = acct.username;
        passInput.value = DEMO_PASSWORD;
        passInput.focus();
      });
      wrap.appendChild(b);
    });
    var hint = document.createElement('div');
    hint.className = 'lg-demo-pw';
    hint.appendChild(document.createTextNode('Password for all: '));
    var code = document.createElement('code');
    code.textContent = DEMO_PASSWORD;
    hint.appendChild(code);
    hint.appendChild(document.createTextNode(' — click an account to fill the form. Change these before real use.'));
    wrap.appendChild(hint);
    if (modeBody.demoOpen === true) {
      var open = document.createElement('a');
      open.className = 'lg-demo-open';
      open.href = '/';
      open.textContent = 'Open the demo without signing in';
      wrap.appendChild(open);
    }
    return wrap;
  }

  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  Promise.all([getJson('/api/auth/mode'), getJson('/api/auth/me')]).then(function (both) {
    var modeBody = both[0];
    var me = both[1];
    if (me && me.user) {
      window.location.href = policy.landingFor(me.user, me.user.mustChangePassword === true);
      return;
    }
    if (policy.shouldShowDemoPanel(modeBody) && slot) {
      slot.appendChild(buildDemoPanel(modeBody));
    }
  });

  var submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearNotice();
    if (submitBtn) submitBtn.disabled = true;
    var status = 0;
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: userInput.value, password: passInput.value })
    }).then(function (r) {
      status = r.status;
      return r.json().catch(function () { return null; });
    }).then(function (res) {
      if (status === 200 && res && res.success) {
        var must = res.mustChangePassword === true || !!(res.user && res.user.mustChangePassword === true);
        // [security] CR3-02/CR3-03: a successful sign-in is a new identity — drop
        // whatever the previous person left in this browser (expired session,
        // closed tab, no UI sign-out) before the app loads. Language preference
        // survives. Synchronous, so it always completes before the redirect.
        if (window.MAClientStorage && typeof window.MAClientStorage.clearForNewSession === 'function') {
          window.MAClientStorage.clearForNewSession();
        }
        window.location.href = policy.landingFor(res.user, must);
        return;
      }
      if (submitBtn) submitBtn.disabled = false;
      if (status === 429 && res && typeof res.error === 'string') showNotice(res.error);
      else showNotice('Invalid username or password.');
    }).catch(function () {
      if (submitBtn) submitBtn.disabled = false;
      showNotice('Invalid username or password.');
    });
  });
})();
