function fit(){var s=document.querySelector('.slide');var st=s.closest('.stage');var w=st.clientWidth,h=st.clientHeight;if(!w||!h)return;var sc=Math.min(w/1280,h/720);s.style.transform='translate(-50%,-50%) scale('+sc+')';}
window.addEventListener('resize',fit);window.addEventListener('load',fit);fit();
