// Externalised from the inline block of signage.html (SAFE-02 / D-13-03, plan 13-10) - moved verbatim, same position.
    (function () {
      var params = new URLSearchParams(location.search);
      var lang = params.get('lang') || localStorage.getItem('employeeLanguage') || 'en';
      var dict = null;
      function pick(key) {
        if (!dict || !dict.strings) return null;
        var s = dict.strings;
        return (s[lang] && s[lang][key] != null ? s[lang][key] : (s.en && s.en[key])) ?? null;
      }
      function apply() {
        if (!dict) return;
        document.querySelectorAll('[data-i18n]').forEach(function (el) { var v = pick(el.getAttribute('data-i18n')); if (v != null) el.textContent = v; });
        document.querySelectorAll('[data-i18n-html]').forEach(function (el) { var v = pick(el.getAttribute('data-i18n-html')); if (v != null) { if (window.MASafeHtml) window.MASafeHtml.render(el, v); else el.textContent = v; } });
        document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { var v = pick(el.getAttribute('data-i18n-ph')); if (v != null) el.setAttribute('placeholder', v); });
        document.documentElement.setAttribute('lang', lang);
      }
      fetch('/api/i18n').then(function (r) { return r.json(); }).then(function (d) {
        dict = d;
        apply();
        // signage.js rebuilds some regions (calendar headers) on its own timers — re-apply.
        setTimeout(apply, 1500); setTimeout(apply, 4000);
        setInterval(apply, 15000);
      }).catch(function () {});
    })();
