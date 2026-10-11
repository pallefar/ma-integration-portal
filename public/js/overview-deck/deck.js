function fit(slide){
  var stage=slide.closest('.stage'); if(!stage) return;
  var w=stage.clientWidth, h=stage.clientHeight; if(!w||!h) return;
  var s=Math.min(w/1280, h/720);
  slide.style.transform='translate(-50%,-50%) scale('+s+')';
}
function fitAll(){ document.querySelectorAll('.slide').forEach(function(sl){ if(sl.getClientRects().length) fit(sl); }); }

var overlays={}, openId=null;

document.querySelectorAll('.overlay').forEach(function(ov){
  var id=ov.id, max=+ov.dataset.max;
  var slide=ov.querySelector('.slide');
  var dotsWrap=ov.querySelector('.dots');
  var prev=ov.querySelector('.prev'), next=ov.querySelector('.next');
  for(var i=0;i<max;i++){ var d=document.createElement('span'); d.className='dot'; dotsWrap.appendChild(d); }
  var dots=Array.prototype.slice.call(dotsWrap.children);
  var step=0;
  function render(){
    slide.querySelectorAll('.rv').forEach(function(el){ el.classList.toggle('show',(+el.dataset.step)<=step); });
    dots.forEach(function(dt,i){ dt.classList.toggle('on', step>=i+1); });
    prev.disabled = step<=0; next.disabled = step>=max;
  }
  function set(n){ step=Math.max(0,Math.min(max,n)); render(); }
  var api={ov:ov,slide:slide,max:max,set:set,reset:function(){set(0);},next:function(){set(step+1);},prev:function(){set(step-1);}};
  overlays[id]=api;
  slide.addEventListener('click', function(e){ e.stopPropagation(); api.next(); });
  next.addEventListener('click', function(e){ e.stopPropagation(); api.next(); });
  prev.addEventListener('click', function(e){ e.stopPropagation(); api.prev(); });
  ov.querySelector('.ov-close').addEventListener('click', function(e){ e.stopPropagation(); closeOverlay(id); });
  ov.querySelector('.hud').addEventListener('click', function(e){ e.stopPropagation(); });
  ov.addEventListener('click', function(){ closeOverlay(id); });
});

function openOverlay(id){
  var api=overlays[id]; if(!api) return;
  openId=id; api.ov.classList.add('open'); api.reset(); fit(api.slide);
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ api.slide.classList.add('in'); }); });
}
function closeOverlay(id){
  var api=overlays[id]; if(!api) return;
  api.slide.classList.remove('in'); api.ov.classList.remove('open');
  if(openId===id) openId=null;
}

document.querySelectorAll('.fbox.clickable').forEach(function(b){
  b.addEventListener('click', function(){ openOverlay('ov'+b.dataset.open); });
  b.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openOverlay('ov'+b.dataset.open); } });
});

document.addEventListener('keydown', function(e){
  if(!openId) return;
  if(e.key==='Escape'){ closeOverlay(openId); }
  else if(e.key==='ArrowRight'||e.key===' '||e.key==='Enter'){ e.preventDefault(); overlays[openId].next(); }
  else if(e.key==='ArrowLeft'){ e.preventDefault(); overlays[openId].prev(); }
});

window.addEventListener('resize', fitAll);
window.addEventListener('load', fitAll);
fitAll();
