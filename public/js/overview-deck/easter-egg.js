(function(){
  var startEl=document.getElementById('start');
  var subs=["Better than all the rest — go integrate, superstar ✨","You take my heart... and my synergy targets 💛","Day 1 to Day 100 — simply the best! 🏆","Keep shining, integration hero 🌟"];
  var actx=null, playing=false, loopTimer=null, subTimer=null, confTimer=null, si=0, karTimers=[];
  // Original celebratory riff (NOT the copyrighted song) — a bright major-key loop.
  // [freq, seconds, karaoke word] — a bright ORIGINAL major-key riff the star "sings".
  var MELODY=[ [523.25,.34,"You're"],[659.25,.26,"sim-"],[783.99,.26,"ply"],[1046.5,.30,"the"],[880,.55,"best!"],[0,.18,"♪"],
               [698.46,.34,"Bet-"],[880,.26,"ter"],[1046.5,.26,"than"],[1174.7,.26,"all"],[1046.5,.26,"the"],[880,.65,"rest!"] ];
  var BASS=[130.81,130.81,174.61,174.61,196.0,196.0,174.61,174.61];
  function note(freq,t,dur,type,vol){
    if(!freq) return;
    var o=actx.createOscillator(), g=actx.createGain();
    o.type=type||'triangle'; o.frequency.value=freq;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol||.22,t+.02);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+dur+.02);
  }
  function vocal(freq,t,dur){ // voice-like sine with vibrato — the "singing" line
    if(!freq) return;
    var o=actx.createOscillator(), g=actx.createGain(), lfo=actx.createOscillator(), lg=actx.createGain();
    o.type='sine'; o.frequency.value=freq;
    lfo.type='sine'; lfo.frequency.value=5.5; lg.gain.value=freq*0.014; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.17,t+.05);
    g.gain.setValueAtTime(.17,t+dur*.7); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g); g.connect(actx.destination); o.start(t); lfo.start(t); o.stop(t+dur+.02); lfo.stop(t+dur+.02);
  }
  var kar=document.getElementById('kar');
  function renderKar(idx){ kar.innerHTML=MELODY.map(function(m,i){ return '<span class="w'+(i===idx?' on':'')+'">'+m[2]+'</span>'; }).join(' '); }
  renderKar(-1);
  function playLoop(){
    karTimers.forEach(clearTimeout); karTimers=[];
    var t=actx.currentTime+.1, off=0, beat=0;
    for(var i=0;i<MELODY.length;i++){
      var f=MELODY[i][0], d=MELODY[i][1];
      note(f,t,d,'triangle',.15); vocal(f,t,d);
      if(BASS[beat%BASS.length]) note(BASS[beat%BASS.length],t,.3,'sawtooth',.08);
      (function(idx,delay){ karTimers.push(setTimeout(function(){ renderKar(idx); }, delay*1000)); })(i, off);
      t+=d; off+=d; beat++;
    }
    loopTimer=setTimeout(playLoop, off*1000);
  }
  function confetti(){
    var c=document.createElement('div'); c.className='confetti';
    var cols=['#ffd34d','#F28D00','#e0338c','#167987','#fff'];
    c.style.left=(Math.floor(performance.now()*13)%100)+'vw';
    c.style.background=cols[Math.floor(performance.now())%cols.length];
    c.style.animationDuration=(2.5+ (performance.now()%1500)/1000)+'s';
    document.body.appendChild(c); setTimeout(function(){ c.remove(); }, 5000);
  }
  function start(){
    if(playing) return; playing=true;
    startEl.classList.add('hidden');
    try{ actx=new (window.AudioContext||window.webkitAudioContext)(); if(actx.state==='suspended') actx.resume(); playLoop(); }catch(e){}
    confTimer=setInterval(confetti,140);
    subTimer=setInterval(function(){ si=(si+1)%subs.length; document.getElementById('sub').textContent=subs[si]; }, 3200);
  }
  document.getElementById('go').addEventListener('click', start);
  startEl.addEventListener('click', start);
  // Stop audio when the popover/iframe is torn down
  window.addEventListener('pagehide', function(){ try{ clearTimeout(loopTimer); clearInterval(confTimer); clearInterval(subTimer); karTimers.forEach(clearTimeout); if(actx) actx.close(); }catch(e){} });
})();
