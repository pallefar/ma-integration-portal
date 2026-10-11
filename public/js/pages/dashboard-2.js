// Externalised from the inline block of dashboard.html (block 2: IL Academy tab) (SAFE-02 / D-13-03, plan 13-10) - moved verbatim, same position.
              (function(){
                var root = document.getElementById('tab-il-academy'); if(!root) return;
                var KEY = 'il_academy_progress_v1';
                var done = {};
                try { done = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e){ done = {}; }
                var mods = root.querySelectorAll('.ilac-mod');
                function refresh(){
                  var n = 0;
                  mods.forEach(function(m){
                    var id = m.getAttribute('data-mod');
                    var isDone = !!done[id];
                    m.classList.toggle('done', isDone);
                    var btn = m.querySelector('.ilac-complete');
                    if (btn){ btn.classList.toggle('done', isDone); btn.textContent = isDone ? 'Completed ✓' : 'Mark module complete ✓'; }
                    if (isDone) n++;
                  });
                  var fill = document.getElementById('ilac-progress-fill');
                  var count = document.getElementById('ilac-progress-count');
                  if (fill) fill.style.width = Math.round(n / mods.length * 100) + '%';
                  if (count) count.textContent = n;
                }
                mods.forEach(function(m){
                  var head = m.querySelector('.ilac-mod-head');
                  if (head) head.addEventListener('click', function(){ m.classList.toggle('open'); });
                  var btn = m.querySelector('.ilac-complete');
                  if (btn) btn.addEventListener('click', function(e){
                    e.stopPropagation();
                    var id = m.getAttribute('data-mod');
                    done[id] = !done[id];
                    try { localStorage.setItem(KEY, JSON.stringify(done)); } catch(err){}
                    refresh();
                  });
                });
                if (mods[0]) mods[0].classList.add('open');
                refresh();
              })();

// Former inline `onclick="window.print()"` on the Print Report button (dashboard.html):
// SAFE-02 replaces the handler attribute with data-action="print" + one delegated listener.
(function () {
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-action="print"]') : null;
    if (t) window.print();
  }, true); // capture: an inline attribute fired on the target itself, regardless of ancestor handlers
})();
