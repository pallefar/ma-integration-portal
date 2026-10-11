(function(){
  if(window.self===window.top) return;               // only when framed
  var overlays=document.querySelectorAll('.overlay');
  function anyOpen(){ return Array.prototype.some.call(overlays,function(o){return o.classList.contains('open');}); }
  function ping(){ try{ parent.postMessage({type:'deck-overlay', open:anyOpen()}, '*'); }catch(e){} }
  var mo=new MutationObserver(ping);
  overlays.forEach(function(o){ mo.observe(o,{attributes:true, attributeFilter:['class']}); });
})();
// Agenda button on the home slide: when framed, ask the parent to open the agenda
// slide as a full-screen popover (like the Ask slides); standalone, just navigate.
(function(){
  var agBtn=document.getElementById('deck-agenda-btn');
  if(!agBtn) return;
  agBtn.addEventListener('click', function(){
    if(window.self!==window.top){ try{ parent.postMessage({type:'open-slide', url:'/overview-deck/agenda.html', label:'Agenda'}, '*'); }catch(e){} }
    else { window.location.href='agenda.html'; }
  });
})();
