// @ts-nocheck
// Internal partner-network map. Data loads from /network-data.json,
// which (like this page) is Basic-Auth gated by middleware.ts on Vercel.
(async () => {
  const DATA = await (await fetch('/network-data.json')).json();
(function(){
  const D = DATA;
  const partners = D.partners;      // [lon,lat,rank,pop,name,city], sorted by rank asc
  const others   = D.others;        // [lon,lat,name]
  const munis     = D.munis;        // [lon,lat,pop]
  const TOTAL     = D.total_pop;
  const R_OPTS = [5,8,10,12];

  // ---- geometry ----
  const bb = (()=>{ let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
    for(const p of D.outline){ if(p[0]<x0)x0=p[0]; if(p[0]>x1)x1=p[0]; if(p[1]<y0)y0=p[1]; if(p[1]>y1)y1=p[1]; }
    return {x0,x1,y0,y1}; })();
  const lat0 = (bb.y0+bb.y1)/2, kx = Math.cos(lat0*Math.PI/180);
  // projected space: X = lon*kx, Y = -lat
  const px0 = bb.x0*kx, px1 = bb.x1*kx, py0 = -bb.y1, py1 = -bb.y0;
  function hav(la1,lo1,la2,lo2){ const R=6371,dLa=(la2-la1)*Math.PI/180,dLo=(lo2-lo1)*Math.PI/180,
    a=Math.sin(dLa/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
    return 2*R*Math.asin(Math.sqrt(a)); }

  // ---- precompute: smallest partner-rank that covers each muni, per radius ----
  const minRank={}, covPopByN={};
  for(const r of R_OPTS){
    const rk=new Int16Array(munis.length);
    for(let i=0;i<munis.length;i++){
      const m=munis[i]; let best=0;
      for(let k=0;k<partners.length;k++){
        const p=partners[k];
        if(Math.abs(m[1]-p[1])>0.16||Math.abs(m[0]-p[0])>0.22) continue;
        if(hav(m[1],m[0],p[1],p[0])<=r){ best=p[2]; break; }
      }
      rk[i]=best;
    }
    minRank[r]=rk;
    const buckets=new Float64Array(partners.length+2);
    for(let i=0;i<munis.length;i++){ const q=rk[i]; if(q>0) buckets[q]+=munis[i][2]; }
    const cum=new Float64Array(partners.length+1); let s=0;
    for(let n=1;n<=partners.length;n++){ s+=buckets[n]||0; cum[n]=s; }
    covPopByN[r]=cum;
  }

  // ---- canvas / projection to screen ----
  const cv=document.getElementById('map'), ctx=cv.getContext('2d');
  const tip=document.getElementById('tip');
  let W=0,H=0,dpr=1, sc=1, ox=0, oy=0, pxPerKm=1;
  function layout(){
    dpr=Math.min(window.devicePixelRatio||1,2);
    const rect=cv.getBoundingClientRect(); W=rect.width; H=rect.height;
    cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
    const pad=18;
    const sx=(W-2*pad)/(px1-px0), sy=(H-2*pad)/(py1-py0);
    sc=Math.min(sx,sy);
    ox=pad+((W-2*pad)-(px1-px0)*sc)/2;
    oy=pad+((H-2*pad)-(py1-py0)*sc)/2;
    pxPerKm=sc/111.32; // 1 deg lat \u2248 111.32 km, Y unit = degrees lat
  }
  function X(lon){ return ox+(lon*kx-px0)*sc; }
  function Y(lat){ return oy+((-lat)-py0)*sc; }
  function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  let N=150, R=8, showAll=false;

  function render(){
    const c=ctx; c.save(); c.scale(dpr,dpr); c.clearRect(0,0,W,H);
    const COL={ ink:css('--ink'), accent:css('--accent'), warn:css('--warn'),
      good:css('--good'), land:css('--land'), landStroke:css('--land-stroke'),
      shop:css('--slate-soft'), discFill:css('--accent-soft') };

    // land
    c.beginPath();
    const o=D.outline;
    c.moveTo(X(o[0][0]),Y(o[0][1]));
    for(let i=1;i<o.length;i++) c.lineTo(X(o[i][0]),Y(o[i][1]));
    c.closePath();
    c.fillStyle=COL.land; c.fill();
    c.lineJoin='round'; c.strokeStyle=COL.landStroke; c.lineWidth=1.1; c.stroke();
    c.save(); c.clip();

    // catchment discs for active partners
    c.globalCompositeOperation='source-over';
    c.fillStyle=COL.discFill;
    const rr=R*pxPerKm;
    for(let k=0;k<N && k<partners.length;k++){
      const p=partners[k]; c.beginPath(); c.arc(X(p[0]),Y(p[1]),rr,0,7); c.fill();
    }
    c.restore(); // stop clipping

    // municipalities: covered (faint green) vs uncovered (warn, sized by pop)
    const rk=minRank[R];
    for(let i=0;i<munis.length;i++){
      const m=munis[i]; const covered = rk[i]>0 && rk[i]<=N;
      if(covered){ c.fillStyle=COL.good; c.globalAlpha=.28;
        c.beginPath(); c.arc(X(m[0]),Y(m[1]),1.6,0,7); c.fill(); }
    }
    c.globalAlpha=1;
    // gaps drawn on top, sized by population
    for(let i=0;i<munis.length;i++){
      const m=munis[i]; if(!(rk[i]===0||rk[i]>N)) continue;
      const rad=Math.max(1.8,Math.min(6,Math.sqrt(m[2])/60));
      c.fillStyle=COL.warn; c.globalAlpha=.85;
      c.beginPath(); c.arc(X(m[0]),Y(m[1]),rad,0,7); c.fill();
    }
    c.globalAlpha=1;

    // other shops (context)
    if(showAll){
      c.fillStyle=COL.shop; c.globalAlpha=.55;
      for(const s of others){ c.beginPath(); c.arc(X(s[0]),Y(s[1]),1.5,0,7); c.fill(); }
      c.globalAlpha=1;
    }

    // active partner markers
    for(let k=0;k<N && k<partners.length;k++){
      const p=partners[k];
      c.beginPath(); c.arc(X(p[0]),Y(p[1]),3.2,0,7);
      c.fillStyle=COL.accent; c.fill();
      c.lineWidth=1.1; c.strokeStyle=css('--paper'); c.stroke();
    }
    c.restore();
  }

  // ---- stats + gap list ----
  const fmt=n=>Math.round(n).toLocaleString('en-US').replace(/,/g,"\u2019");
  const driveText={5:"\u2248 8-min drive",8:"\u2248 12-min drive",10:"\u2248 15-min drive",12:"\u2248 18-min drive"};
  function stats(){
    const cum=covPopByN[R]; const reached=cum[Math.min(N,partners.length)];
    document.getElementById('pct').textContent=(reached/TOTAL*100).toFixed(1);
    document.getElementById('reached').textContent=fmt(reached);
    document.getElementById('totalpop').textContent=fmt(TOTAL);
    document.getElementById('drive').textContent=driveText[R]+" \u00b7 "+R+" km";
    document.getElementById('pcount').textContent=N;
    const rk=minRank[R]; let gc=0,gp=0;
    for(let i=0;i<munis.length;i++){ if(rk[i]===0||rk[i]>N){ gc++; gp+=munis[i][2]; } }
    document.getElementById('gapct').textContent=fmt(gc);
    document.getElementById('gappop').innerHTML=fmt(gp)+' <small>'+(gp/TOTAL*100).toFixed(1)+'%</small>';
    document.getElementById('shopct').textContent="1\u2019438";
    // gap list (largest by pop)
    const gaps=[]; for(let i=0;i<munis.length;i++){ if(rk[i]===0||rk[i]>N) gaps.push(munis[i]); }
    gaps.sort((a,b)=>b[2]-a[2]);
    const ul=document.getElementById('gaplist'); ul.innerHTML='';
    if(!gaps.length){ ul.innerHTML='<li><span class="g-name">Full coverage \u2014 no gaps.</span></li>'; }
    for(const g of gaps.slice(0,7)){
      const li=document.createElement('li');
      li.innerHTML='<span class="g-name">'+nearestName(g)+'</span><span class="g-km">'+fmt(g[2])+' ppl</span>';
      ul.appendChild(li);
    }
    drawSpark();
  }
  // municipalities carry no name; label gaps by population rank instead
  function nearestName(g){ return fmt(g[2])+'-person town'; }

  // ---- coverage curve ----
  const spk=document.getElementById('spark'), sctx=spk.getContext('2d');
  function drawSpark(){
    const d=Math.min(window.devicePixelRatio||1,2);
    const w=spk.clientWidth,h=spk.clientHeight; spk.width=w*d; spk.height=h*d;
    const c=sctx; c.save(); c.scale(d,d); c.clearRect(0,0,w,h);
    const cum=covPopByN[R], max=partners.length, pad=2;
    c.beginPath();
    for(let n=0;n<=max;n++){ const x=pad+(n/max)*(w-2*pad); const y=h-pad-(cum[n]/TOTAL)*(h-2*pad);
      n===0?c.moveTo(x,y):c.lineTo(x,y); }
    c.lineTo(w-pad,h-pad); c.lineTo(pad,h-pad); c.closePath();
    c.fillStyle=css('--accent-soft'); c.fill();
    c.beginPath();
    for(let n=0;n<=max;n++){ const x=pad+(n/max)*(w-2*pad); const y=h-pad-(cum[n]/TOTAL)*(h-2*pad);
      n===0?c.moveTo(x,y):c.lineTo(x,y); }
    c.strokeStyle=css('--accent'); c.lineWidth=1.6; c.stroke();
    const nx=pad+(N/max)*(w-2*pad), ny=h-pad-(cum[Math.min(N,max)]/TOTAL)*(h-2*pad);
    c.strokeStyle=css('--hairline-strong'); c.lineWidth=1; c.beginPath(); c.moveTo(nx,pad); c.lineTo(nx,h-pad); c.stroke();
    c.fillStyle=css('--accent'); c.beginPath(); c.arc(nx,ny,3,0,7); c.fill();
    c.restore();
  }

  // ---- interaction ----
  const nrange=document.getElementById('nrange'), nlabel=document.getElementById('nlabel');
  let raf=0;
  function schedule(){ if(raf) return; raf=requestAnimationFrame(()=>{ raf=0; render(); stats(); }); }
  nrange.addEventListener('input',()=>{ N=+nrange.value; nlabel.textContent=N; schedule(); });
  document.querySelectorAll('.presets button').forEach(b=>b.addEventListener('click',()=>{
    N=+b.dataset.n; nrange.value=N; nlabel.textContent=N; schedule(); }));
  document.getElementById('chips').addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return; R=+b.dataset.r;
    document.querySelectorAll('#chips button').forEach(x=>x.classList.toggle('on',x===b)); schedule(); });
  document.getElementById('showall').addEventListener('change',e=>{ showAll=e.target.checked; schedule(); });

  // tooltip: nearest active partner (or shop) within a few px
  cv.addEventListener('pointermove',ev=>{
    const rect=cv.getBoundingClientRect(); const mx=ev.clientX-rect.left, my=ev.clientY-rect.top;
    let best=null,bd=110;
    for(let k=0;k<N&&k<partners.length;k++){ const p=partners[k];
      const dx=X(p[0])-mx,dy=Y(p[1])-my,d=dx*dx+dy*dy; if(d<bd){ bd=d; best={t:'p',p}; } }
    if(!best&&showAll){ for(const s of others){ const dx=X(s[0])-mx,dy=Y(s[1])-my,d=dx*dx+dy*dy;
      if(d<bd){ bd=d; best={t:'s',p:s}; } } }
    if(best){ const p=best.p;
      tip.style.left=X(p[0])+'px'; tip.style.top=Y(p[1])+'px'; tip.style.opacity='1';
      if(best.t==='p'){ tip.innerHTML='<div class="t-name">'+esc(p[4])+'</div><div class="t-meta">Partner #'+p[2]+(p[5]?' \u00b7 '+esc(p[5]):'')+' \u00b7 +'+fmt(p[3])+' reach</div>'; }
      else { tip.innerHTML='<div class="t-name">'+esc(p[2])+'</div><div class="t-meta">Bike shop</div>'; }
    } else tip.style.opacity='0';
  });
  cv.addEventListener('pointerleave',()=>tip.style.opacity='0');
  function esc(s){ return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

  // theme + resize
  const ro=new ResizeObserver(()=>{ layout(); render(); drawSpark(); }); ro.observe(cv);
  const mo=new MutationObserver(()=>{ render(); stats(); });
  mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  if(window.matchMedia) matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{render();stats();});

  layout(); render(); stats();
})();
})();
