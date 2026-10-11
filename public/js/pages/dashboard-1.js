// Externalised from the inline block of dashboard.html (block 1: employee feedback card) (SAFE-02 / D-13-03, plan 13-10) - moved verbatim, same position.
                (function(){
                  var card=document.getElementById('employee-feedback-card'); if(!card) return;
                  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
                  function setText(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; }
                  fetch('/api/pulses').then(function(r){return r.json();}).then(function(pulses){
                    var items=(Array.isArray(pulses)?pulses:[]).map(function(p){
                      return { name:p.employeeName||p.name||'Anonymous', rating:Number(p.rating)||0, comment:p.comment||'', ts:p.timestamp||'' };
                    }).filter(function(p){ return p.rating>0; });
                    var n=items.length;
                    var avg=n? items.reduce(function(s,p){return s+p.rating;},0)/n : 0;
                    var pos=items.filter(function(p){return p.rating>=4;}).length;
                    var att=items.filter(function(p){return p.rating<=2;}).length;
                    setText('ef-avg', n? avg.toFixed(1)+' / 5':'–');
                    setText('ef-count', n||'0');
                    setText('ef-positive', n? Math.round(pos/n*100)+'%':'–');
                    setText('ef-attention', att);
                    var co=document.getElementById('ef-callout');
                    if(n){
                      var msg = att>0 ? ('⚠️ '+att+' employee'+(att>1?'s':'')+' rated onboarding ≤2 — reach out directly to unblock them.')
                        : (avg>=4 ? ('✅ Sentiment is strong ('+avg.toFixed(1)+'/5). Keep the cadence and reinforce what’s working.')
                        : ('Sentiment is mixed ('+avg.toFixed(1)+'/5). Review the comments below for common themes.'));
                      co.textContent=msg; co.style.display='block';
                    }
                    var list=document.getElementById('ef-comments');
                    if(!n){ list.innerHTML='<p style="text-align:center;color:var(--text-dim);font-size:.85rem;padding:1rem;">No employee feedback submitted yet.</p>'; return; }
                    var shown=items.filter(function(p){return p.comment && p.comment.trim();});
                    if(!shown.length) shown=items;
                    shown.sort(function(a,b){ return a.rating-b.rating; });
                    list.innerHTML=shown.slice(0,12).map(function(p){
                      var r=Math.max(0,Math.min(5,p.rating));
                      var stars=Array(r+1).join('★')+Array(6-r).join('☆');
                      var tone=p.rating<=2?'#C2410C':(p.rating>=4?'#5C9654':'#C77700');
                      return '<div class="ef-comment" style="border-left:3px solid '+tone+';">'
                        +'<div class="ef-comment-head"><strong>'+esc(p.name)+'</strong><span class="ef-stars" style="color:'+tone+'">'+stars+' '+p.rating+'/5</span></div>'
                        +(p.comment?'<div class="ef-comment-body">'+esc(p.comment)+'</div>':'')
                        +'</div>';
                    }).join('');
                  }).catch(function(){ var l=document.getElementById('ef-comments'); if(l) l.innerHTML='<p style="color:var(--text-dim);font-size:.85rem;">Feedback unavailable.</p>'; });
                })();
