// SAFE-02 (D-13-03, plan 13-10): admin.html's two former inline handlers, now one delegated listener.
//   data-action="open-pmo"    was onclick="window.location.href='/pmo.html'"
//   data-action="launch-ted"  was onclick="window.launchDoomProtocol()"
// Loaded after /js/ted-launcher.js (which defines window.launchDoomProtocol); the handler resolves the
// function at click time, exactly as the inline attribute did.
(function () {
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!t) return;
    var action = t.getAttribute('data-action');
    if (action === 'open-pmo') {
      window.location.href = '/pmo.html';
    } else if (action === 'launch-ted') {
      window.launchDoomProtocol();
    }
  }, true); // capture: fires even if an ancestor handler stops propagation (an inline attribute fired on the target itself)
})();
