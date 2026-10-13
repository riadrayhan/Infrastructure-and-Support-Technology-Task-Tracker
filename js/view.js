/* view.js – pure rendering: HTML templates, modals, status line, toasts
   Part of the MVP split: js/model.js · js/view.js · js/presenter.js (loaded in that order)
   UI framework: Bootstrap 5.3 (grid, cards, nav pills, forms, modals, toasts, badges, progress) */

/* ============================== VIEW =============================== */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fd=s=>s?new Date(s+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';
const badge=s=>`<span class="badge rounded-pill b" style="--c:${COL[s]||'#94a3b8'}">${esc(s)}</span>`;
const avc=n=>{let h=0;for(const ch of String(n))h=(h*31+ch.charCodeAt(0))%360;return `hsl(${h} 62% 46%)`};
const {base,over}=Model;const pct=p=>Model.pct(p);const own=p=>Model.own(p);
const bar=(g,c,h=4,live)=>`<div class="progress mt-2" style="height:${h}px"><div class="progress-bar ${live?'progress-bar-striped progress-bar-animated':''}" style="width:${g||0}%;background:${c}"></div></div>`;
const card=(c,body,cls='')=>`<div class="card tcard h-100 ${cls}" style="--c:${c}"><div class="card-body">${body}</div></div>`;
const sec=(c,t)=>`<h3 class="sec" style="--c:${c}">${t}</h3>`;
const empty=t=>`<p class="text-secondary small mb-0">${t}</p>`;
/* export buttons: what gets exported is decided by the Presenter from the current page + filters */
const xbtns=hint=>!Model.can('export')?'':`<div class="btn-group xp" role="group" aria-label="Export" title="${esc(hint||'Download or print the data shown on this page')}"><button class="btn btn-outline-secondary" data-a="export" data-v="pdf" data-bs-toggle="tooltip" title="Download as PDF">⬇ PDF</button><button class="btn btn-outline-secondary" data-a="export" data-v="xlsx" data-bs-toggle="tooltip" title="Download as Excel">⬇ Excel</button><button class="btn btn-outline-secondary" data-a="export" data-v="print" data-bs-toggle="tooltip" title="Print">🖨 Print</button></div>`;

const View={
 toast(m){const t=document.createElement('div');t.className='toast align-items-center text-bg-dark border-0';t.setAttribute('role','status');
  t.innerHTML=`<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  t.querySelector('.toast-body').textContent=m;$('#toasts').appendChild(t);t.addEventListener('hidden.bs.toast',()=>t.remove());new bootstrap.Toast(t,{delay:2200}).show()},
 status(t,ok){$('#snap').textContent=t;$('#lv').classList.toggle('off',!ok)},
 /* one-time behaviours: reveal-on-scroll for .a-up, click ripple on buttons, delegated Bootstrap tooltips */
 init(){
  const root=document.documentElement;
  if('IntersectionObserver' in window){
   const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.05,rootMargin:'0px 0px 40px 0px'});
   const scan=()=>document.querySelectorAll('.a-up:not(.in):not([data-io])').forEach(el=>{el.dataset.io=1;io.observe(el)});
   new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});scan()}
  else root.classList.add('no-io');
  document.addEventListener('pointerdown',e=>{const b=e.target.closest('.btn');if(!b||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
   const r=b.getBoundingClientRect(),d=Math.max(r.width,r.height),s=document.createElement('span');s.className='ripple';
   s.style.cssText=`width:${d}px;height:${d}px;left:${e.clientX-r.left-d/2}px;top:${e.clientY-r.top-d/2}px`;b.appendChild(s);setTimeout(()=>s.remove(),650)});
  if(window.bootstrap)new bootstrap.Tooltip(document.body,{selector:'[data-bs-toggle="tooltip"]',trigger:'hover',delay:{show:350,hide:0}})},
 /* theme picker (dropdown in the hero) */
 themeMenu(themes,cur){$('#thm').innerHTML=themes.map(t=>`<li><button class="dropdown-item d-flex align-items-center gap-2 ${t.id===cur?'active':''}" data-a="theme" data-v="${t.id}"><span class="sw" style="background:${t.swatch}"></span>${t.label}${t.id===cur?'<span class="ms-auto">✓</span>':''}</button></li>`).join('');
  const b=$('#th');if(b){const t=themes.find(x=>x.id===cur);b.textContent=(t?t.icon+' ':'')+'Theme'}},
 /* KPI numbers count up from 0 after the overview renders */
 countUp(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  document.querySelectorAll('.kpi b[data-n]').forEach(el=>{const n=+el.dataset.n||0;if(!n)return;const t0=performance.now(),D=700;
   const step=t=>{const k=Math.min(1,(t-t0)/D),e=1-Math.pow(1-k,3);el.textContent=Math.round(n*e);if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step)})},
 nav(tabs,cur){$('#nav').innerHTML=tabs.map(x=>`<li class="nav-item"><button class="nav-link ${x[0]===cur?'active':''}" data-a="go" data-v="${x[0]}">${x[1]}</button></li>`).join('')},
 page(html){document.querySelectorAll('.tooltip').forEach(t=>t.remove());$('#v').innerHTML='<div class="fade-in">'+html+'</div>'},
 /* --- gate screens shown while nobody is signed in --- */
 gate(kind,msg,storeKind){
  const fld=(lbl,html)=>`<div class="mb-3"><label class="form-label small fw-semibold text-secondary mb-1">${lbl}</label>${html}</div>`;
  const shell=(ic,title,sub,body,c)=>`<div class="card tcard gate mx-auto my-4 my-md-5 a-up" style="--c:${c}"><div class="card-body p-4"><div class="d-flex align-items-center gap-3 mb-3"><span class="pi" style="--c:${c}">${ic}</span><div><h2 class="h4 fw-bold mb-0">${title}</h2><p class="text-secondary small mb-0">${sub}</p></div></div>${body}</div></div>`;
  let h='';
  if(kind==='loading')h=shell('⏳','Connecting…','Checking who you are','<div class="progress" style="height:6px"><div class="progress-bar progress-bar-striped progress-bar-animated w-100"></div></div>','#4f46e5');
  else if(kind==='setup')h=shell('🛡️','Create the super admin','First run – this account manages all users and roles',
   fld('Your name','<input class="form-control" id="g_name" autocomplete="name">')+fld('Email','<input class="form-control" id="g_email" type="email" autocomplete="username">')+
   '<div class="row g-3">'+fld('Password','<input class="form-control" id="g_pw" type="password" autocomplete="new-password">').replace('mb-3','col-sm-6')+fld('Confirm password','<input class="form-control" id="g_pw2" type="password" autocomplete="new-password">').replace('mb-3','col-sm-6')+'</div>'+
   `<button class="btn btn-brand w-100 mt-3" id="g_btn">Create super admin account</button><p class="text-secondary small mt-3 mb-0">Accounts are kept in this browser${storeKind==='local'?'':' / the shared database'}. The super admin can add Admins, Superusers and Viewers afterwards.</p>`,'#ec008c');
  else if(kind==='login')h=shell('🔐','Sign in','Use the email and password the super admin gave you',
   fld('Email','<input class="form-control" id="g_email" type="email" autocomplete="username">')+fld('Password','<input class="form-control" id="g_pw" type="password" autocomplete="current-password">')+
   '<div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="g_rem" checked><label class="form-check-label small" for="g_rem">Keep me signed in on this device</label></div><button class="btn btn-brand w-100" id="g_btn">Sign in</button>'+
   `<div class="roles mt-4">${ROLES.map(r=>`<div class="d-flex gap-2 align-items-baseline small"><span class="badge rounded-pill b" style="--c:${ROLE_COL[r]}">${ROLE_LBL[r]}</span><span class="text-secondary">${ROLE_DESC[r]}</span></div>`).join('')}</div>`,'#4f46e5');
  else h=shell('🔒','Access restricted','',`<p class="mb-0">${esc(msg)}</p>`,'#dc2626');
  $('#v').innerHTML=h},
 /* --- signed-in person in the hero + which toolbar buttons they get --- */
 who(sess,local){const w=$('#who');
  w.classList.toggle('d-none',!sess);$('#us').classList.toggle('d-none',!(sess&&sess.role==='superadmin'));$('#so').classList.toggle('d-none',!(sess&&local));
  if(!sess){w.innerHTML='';return}
  w.innerHTML=`<span class="av av-sm" style="background:${avc(sess.name||'?')}">${esc((sess.name||'?')[0])}</span><span class="d-none d-sm-inline-block text-truncate" style="max-width:160px" title="${esc(sess.email)}">${esc(sess.name)}</span><span class="badge rounded-pill role" style="--c:${ROLE_COL[sess.role]}">${ROLE_LBL[sess.role]}</span>`},
 ph:(ic,t,sub,c,act)=>`<div class="ph d-flex align-items-center flex-wrap gap-3" style="--c:${c}"><span class="pi">${ic}</span><div><h2 class="mb-0">${t}</h2><p class="mb-0 text-secondary small">${sub}</p></div><div class="pa ms-auto d-flex flex-wrap gap-2">${act||''}</div></div>`,

 /* Bootstrap modal shell: returns the .modal element; el.close() hides it, it removes itself once hidden */
 modalShell({title,body,foot,c,size}){
  const el=document.createElement('div');el.className='modal fade';el.tabIndex=-1;
  el.innerHTML=`<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size||'modal-lg'}"><div class="modal-content" style="--c:${c||'#4f46e5'}">
   <div class="modal-header"><div class="me-3 flex-grow-1">${title}</div><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
   <div class="modal-body">${body}</div>${foot?`<div class="modal-footer justify-content-start gap-2">${foot}</div>`:''}</div></div>`;
  document.body.appendChild(el);const inst=new bootstrap.Modal(el);let shown=false,pending=false;
  el.addEventListener('shown.bs.modal',()=>{shown=true;if(pending)inst.hide()});el.addEventListener('hidden.bs.modal',()=>el.remove());
  el.close=()=>{if(shown)inst.hide();else pending=true};/* a close requested mid-animation is applied once the modal is fully shown */
  inst.show();return el},

 pie(c){const t=PS.reduce((x,k)=>x+(c[k]||0),0);if(!t)return '<svg class="pie-svg" viewBox="0 0 120 120" width="150" height="150"><circle cx="60" cy="60" r="56" fill="var(--bs-border-color)"/></svg>';
  let a=-Math.PI/2,o='';PS.filter(k=>c[k]).forEach(k=>{const f=c[k]/t;if(f>=.9999){o+=`<circle cx="60" cy="60" r="56" fill="${COL[k]}"/>`;return}
   const e=a+f*2*Math.PI,x1=60+56*Math.cos(a),y1=60+56*Math.sin(a),x2=60+56*Math.cos(e),y2=60+56*Math.sin(e);
   o+=`<path d="M60 60L${x1} ${y1}A56 56 0 ${f>.5?1:0} 1 ${x2} ${y2}Z" fill="${COL[k]}" stroke="var(--surface)" stroke-width="1.5"/>`;a=e});
  return `<svg class="pie-svg" viewBox="0 0 120 120" width="150" height="150">${o}</svg>`},
 pieCard(label,arr,key,col){const c={};arr.forEach(p=>c[p.s]=(c[p.s]||0)+1);
  return card(col,sec(col,`${label} · ${arr.length}`)+`<p class="text-secondary small mb-3">${DEF[key]}</p><div class="d-flex align-items-center flex-wrap gap-4">${this.pie(c)}<div>${PS.map(k=>`<div class="leg" style="--c:${COL[k]}" data-a="pf" data-v="${key}|${k}"><i></i>${k} <b>${c[k]||0}</b> <span class="text-secondary small">${arr.length?Math.round((c[k]||0)/arr.length*100):0}%</span></div>`).join('')}</div></div>`)},

 skeleton(){const k=n=>Array.from({length:n},(_,i)=>`<div class="col a-up" style="--i:${i}"><div class="card tcard placeholder-glow" style="--c:var(--bs-border-color)"><div class="card-body"><span class="placeholder col-5 rounded-pill mb-3"></span><span class="placeholder col-12 mb-2"></span><span class="placeholder col-8 mb-2"></span><span class="placeholder col-10"></span></div></div></div>`).join('');
  return this.ph('📊','Dashboard Overview','Loading live data…','#4f46e5')+`<div class="row row-cols-2 row-cols-sm-3 row-cols-md-4 row-cols-xl-7 g-2 mb-3">${k(7)}</div><div class="row row-cols-1 row-cols-lg-3 g-3">${k(3)}</div>`},
 overview(){
  if(!Model.loaded)return this.skeleton();
  const I=Model.items,c={};I.forEach(p=>c[p.s]=(c[p.s]||0)+1);const od=I.filter(over);
  const K=[['Total',I.length,'','#4f46e5'],...ST.map(s=>[s,c[s]||0,s,COL[s]]),['Overdue',od.length,'__over','#dc2626']];
  const kp=K.map((k,i)=>`<div class="col a-up" style="--i:${i}"><button class="card kpi w-100 text-start" style="--c:${k[3]}" data-a="kpi" data-v="${k[2]}"><span class="ki">${IC[k[0]]}</span><b data-n="${k[1]}">${k[1]}</b><span>${k[0]}</span></button></div>`).join('');
  const W={};I.forEach(p=>{const n=base(p.f1);if(!n)return;W[n]=W[n]||{Ongoing:0,'On Hold':0,Listed:0};if(W[n][p.s]!=null)W[n][p.s]++});
  const rows=Object.entries(W).map(([n,w])=>[n,w,w.Ongoing+w['On Hold']+w.Listed]).filter(r=>r[2]).sort((a,b)=>b[2]-a[2]);
  const mx=Math.max(...rows.map(r=>r[2]),1);
  const wl=rows.map(([n,w,t])=>`<div class="wr"><a href="#" class="fw-semibold text-body text-decoration-none text-truncate" data-a="person" data-v="${esc(n)}">${esc(n)}</a><div class="progress-stacked" style="width:${t/mx*100}%;height:10px">${['Ongoing','On Hold','Listed'].map(s=>`<div class="progress" style="width:${w[s]/t*100}%;height:10px"><div class="progress-bar" style="background:${COL[s]}"></div></div>`).join('')}</div><b>${t}</b></div>`).join('');
  const li=a=>a.map(p=>`<li class="list-group-item list-group-item-action d-flex justify-content-between gap-2 px-0" data-a="open" data-v="${esc(p.id)}"><span><span class="id">${esc(p.id)}</span> ${esc(p.title)}</span><em>${esc(base(p.f1))} · ${fd(p.e)}</em></li>`).join('')||'<li class="list-group-item px-0"><em>None 🎉</em></li>';
  const on=I.filter(p=>p.s==='Ongoing').sort((a,b)=>(a.e||'9')<(b.e||'9')?-1:1);
  const pl=on.slice(0,12).map(p=>{const g=pct(p);return `<li class="list-group-item list-group-item-action px-0" data-a="open" data-v="${esc(p.id)}"><div class="d-flex justify-content-between gap-2"><span><span class="id">${esc(p.id)} · ${LBL[p.type]||p.type}</span> ${esc(p.title)}</span><em>${esc(base(p.f1))}</em></div>${bar(g,'#2563eb',4,true)}<div class="d-flex justify-content-between text-secondary small mt-1"><span>${g==null?'no milestones':g+'% complete'}</span><span class="${over(p)?'od':''}">${p.e?(over(p)?'⚠ ':'')+fd(p.e):''}</span></div></li>`}).join('')||'<li class="list-group-item px-0"><em>No ongoing items</em></li>';
  const oh=I.filter(p=>p.s==='On Hold');
  return this.ph('📊','Dashboard Overview','Live status of every project, recurring item and task','#4f46e5',xbtns('Download or print ALL data – projects, recurring items and tasks'))+`<div class="row row-cols-2 row-cols-sm-3 row-cols-md-4 row-cols-xl-7 g-2 mb-3">${kp}</div>
  <div class="row g-3 mb-3"><div class="col-12 col-lg-4 a-up" style="--i:1">${this.pieCard('📁 Projects',I.filter(p=>p.type==='Project'),'Project','#4f46e5')}</div><div class="col-12 col-lg-4 a-up" style="--i:2">${this.pieCard('🔁 Recurring',I.filter(p=>p.type==='Drive'),'Drive','#0891b2')}</div><div class="col-12 col-lg-4 a-up" style="--i:3">${this.pieCard('✔️ Tasks',Model.all().filter(p=>p.type==='Task'),'Task','#ea580c')}</div></div>
  <div class="row g-3 mb-3"><div class="col-12 col-lg-6 a-up" style="--i:4">${card('#2563eb',sec('#2563eb',`⚡ Ongoing – progress (${on.length})`)+`<ul class="list-group list-group-flush">${pl}</ul>${on.length>12?`<p class="small mt-2 mb-0"><a href="#" data-a="kpi" data-v="Ongoing">View all ${on.length} →</a></p>`:''}`)}</div>
  <div class="col-12 col-lg-6 a-up" style="--i:5">${card('#7c3aed',sec('#7c3aed','👥 Active workload by Focal-1')+(wl||empty('No active items'))+`<p class="text-secondary small mt-2 mb-0"><span style="color:${COL.Ongoing}">■</span> Ongoing <span style="color:${COL['On Hold']}">■</span> On hold <span style="color:${COL.Listed}">■</span> Listed</p>`)}</div></div>
  <div class="row g-3 mb-3"><div class="col-12 col-lg-6 a-up" style="--i:6">${card('#dc2626',sec('#dc2626',`⚠️ Overdue – ongoing past end date (${od.length})`)+`<ul class="list-group list-group-flush">${li(od.sort((a,b)=>a.e<b.e?-1:1).slice(0,8))}</ul>`)}</div>
  <div class="col-12 col-lg-6 a-up" style="--i:7">${card('#d97706',sec('#d97706',`⏸️ On hold (${oh.length})`)+`<ul class="list-group list-group-flush">${li(oh.slice(0,8))}</ul>`)}</div></div>`},

 filters(items){return `<div class="row g-2 align-items-center my-2">${items.join('')}</div>`},
 board(type,F){
  const pg=PAGES[type],who=[...new Set(Model.items.filter(p=>p.type===type).flatMap(own))].sort();
  return this.ph(pg.ic,LBLS[type],DEF[type],pg.c,xbtns()+(Model.can('write',type)?`<button class="btn btn-brand" data-a="new" data-v="${type}">＋ Create ${LBL[type]}</button>`:''))+this.filters([
   `<div class="col-12 col-md"><input class="form-control" id="q" placeholder="Search title, ID, stakeholder…" value="${esc(F.q)}"></div>`,
   `<div class="col-6 col-md-auto"><select class="form-select" id="fs"><option value="">All status</option>${ST.map(s=>`<option>${s}</option>`).join('')}<option value="__over">Overdue</option></select></div>`,
   `<div class="col-6 col-md-auto"><select class="form-select" id="fp"><option value="">All priorities</option><option>High</option><option>Mid</option><option>Low</option></select></div>`,
   `<div class="col-6 col-md-auto"><select class="form-select" id="fw"><option value="">All people</option>${who.map(w=>`<option>${esc(w)}</option>`).join('')}</select></div>`,
   `<div class="col-6 col-md-auto"><button class="btn btn-outline-secondary w-100" id="rs">Reset</button></div>`])+`<div id="res"></div>`},
 boardResults(F,L){
  return `<p class="text-secondary small">${L.length} item${L.length===1?'':'s'}${F.st?` · Filter: <b>${F.st==='__over'?'Overdue':F.st}</b> <a href="#" data-a="kpi" data-v="">clear</a>`:''}</p><div class="bd">${ST.map(s=>{
   const a=L.filter(p=>F.st==='__over'?s==='Ongoing'&&over(p):p.s===s).sort((x,y)=>s==='Ongoing'?((x.e||'9')<(y.e||'9')?-1:1):((PO[x.pri]!=null?PO[x.pri]:3)-(PO[y.pri]!=null?PO[y.pri]:3)));
   return `<div class="kcol" style="--c:${COL[s]}"><h4 class="d-flex justify-content-between align-items-center">${IC[s]} ${s}<span class="badge rounded-pill" style="background:${COL[s]}">${a.length}</span></h4><div class="cb">${a.map((p,i)=>{const g=pct(p);return `<div class="card it a-up" style="--i:${i}" data-a="open" data-v="${esc(p.id)}"><div class="card-body p-2 px-3"><span class="id">${esc(p.id)} · ${esc(LBL[p.type]||p.type)}</span><div class="t">${esc(p.title)}</div><div class="m d-flex justify-content-between flex-wrap gap-1 text-secondary"><span>${p.pri?`<i class="pr" style="background:${PC[p.pri]}"></i>${p.pri} · `:''}${esc(base(p.f1))}${p.f2?' + '+esc(p.f2):''}</span><span class="${over(p)?'od':''}">${p.e?(over(p)?'⚠ ':'')+fd(p.e):''}</span></div>${p.type==='Project'?`<div class="m d-flex justify-content-between text-secondary mt-2"><span>📅 ${fd(p.sd)} → ${fd(p.e)}</span><b>${g==null?'no milestones yet':g+'% complete'}</b></div>${bar(g,COL[s],4,s==='Ongoing')}`:(g!=null?bar(g,COL[s],4,s==='Ongoing'):'')}</div></div>`}).join('')||empty('Nothing here')}</div></div>`}).join('')}</div>`},

 tasks(TF){
  const who=[...new Set(Model.all().filter(t=>t.type==='Task').map(t=>t.f1).filter(Boolean))].sort();
  return this.ph('✅','Tasks',DEF.Task,'#ea580c',xbtns()+(Model.can('write','Task')?'<button class="btn btn-brand" data-a="new" data-v="Task">＋ Create Task</button>':''))+this.filters([
   `<div class="col-12 col-md"><input class="form-control" id="tq" placeholder="Search tasks…" value="${esc(TF.q)}"></div>`,
   `<div class="col-6 col-md-auto"><select class="form-select" id="tw"><option value="">All people</option>${who.map(w=>`<option>${esc(w)}</option>`).join('')}</select></div>`,
   `<div class="col-6 col-md-auto"><select class="form-select" id="ts"><option value="">All status</option>${ST.map(s=>`<option>${s}</option>`).join('')}</select></div>`])+`<div id="res"></div>`},
 taskResults(TF,L){
  return `<p class="text-secondary small">${L.length} tasks</p><div class="card tcard" style="--c:#ea580c"><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>ID</th><th>Task</th><th>Owner</th><th>Priority</th><th>Status</th><th>Start</th><th>End</th></tr></thead><tbody>${L.slice(0,TF.n).map((t,i)=>`<tr class="c a-up" style="--i:${i}" data-a="open" data-v="${esc(t.id)}"><td>${esc(t.id)}</td><td>${esc(t.title)}</td><td>${esc(t.f1)}</td><td>${esc(t.pri)}</td><td>${badge(t.s)}</td><td>${fd(t.sd)}</td><td>${fd(t.e)}</td></tr>`).join('')}</tbody></table></div></div>${L.length>TF.n?`<p class="mt-3"><button class="btn btn-outline-secondary" id="mr">Show more</button></p>`:''}`},

 mt(r){return `<table class="table table-sm text-center mt mb-0"><thead><tr><th></th><th style="color:${COL.Ongoing}">Ongoing</th><th style="color:${COL['On Hold']}">On Hold</th><th style="color:${COL.Done}">Done</th></tr></thead><tbody>${TY.map(t=>`<tr><td class="text-start">${LBLS[t]}</td><td><b>${r[t].Ongoing}</b></td><td><b>${r[t]['On Hold']}</b></td><td><b>${r[t].Done}</b></td></tr>`).join('')}</tbody></table>`},
 person(n,size){return `<div class="d-flex gap-3 align-items-center mb-3"><span class="av" style="background:${avc(n)}">${esc(n[0])}</span><b class="${size||'fs-6'}">${esc(n)}</b></div>`},
 team(SEL){
  if(SEL){const r=Model.counts(SEL),A=Model.all().filter(p=>own(p).includes(SEL));
   const grp=s=>{const a=A.filter(p=>p.s===s);if(!a.length)return '';
    return `<details ${['Ongoing','On Hold','Listed'].includes(s)?'open':''}><summary style="color:${COL[s]}">${s} (${a.length})</summary><ul class="list-group list-group-flush">${a.sort((x,y)=>(y.e||'')<(x.e||'')?-1:1).slice(0,s==='Done'?60:200).map(p=>`<li class="list-group-item list-group-item-action d-flex justify-content-between gap-2 px-0" data-a="open" data-v="${esc(p.id)}"><span><span class="badge rounded-pill b" style="--c:#64748b">${LBL[p.type]||p.type}</span> ${esc(p.title)}</span><em>${base(p.f1)===SEL?'Lead':'Support'} · ${fd(p.e)}</em></li>`).join('')}</ul></details>`};
   return this.ph('👤',esc(SEL),'Projects, recurring items and tasks – Ongoing, On Hold and Done','#7c3aed',xbtns()+'<button class="btn btn-outline-secondary" data-a="person" data-v="">← All members</button>')+`<div class="row g-3"><div class="col-12 col-lg-5">${card('#7c3aed',this.person(SEL,'fs-5')+this.mt(r))}</div><div class="col-12 col-lg-7">${card('#7c3aed',ST.map(grp).join('')||empty('No items yet'))}</div></div>`}
  return this.ph('👥','Team','Workload of every member – click a card for the full list','#7c3aed',xbtns())+`<div class="row row-cols-1 row-cols-md-2 row-cols-xl-3 g-3">${Model.people().map((n,i)=>`<div class="col a-up" style="--i:${i}">${card(avc(n),this.person(n)+this.mt(Model.counts(n)),'pc" data-a="person" data-v="'+esc(n))}</div>`).join('')||'<div class="col">'+empty('No team members yet – create a project or task to get started.')+'</div>'}</div><p class="text-secondary small mt-3">Counts include items where the person is Focal-1 or Focal-2. Click a member for full list.</p>`},

 /* --- modals (return the element; Presenter wires the buttons) --- */
 detail(x,w){
  const ms=splitMs(x.ms);
  const rows=[['Owner (Focal-1)',x.f1],['Focal-2',x.f2],['Priority',x.pri],['Start',fd(x.sd)],['End',fd(x.e)],['Stakeholder',x.sh],['Completion',x.type==='Project'&&pct(x)!=null?pct(x)+'%':''],['Remarks',x.rm]].filter(r=>r[1]&&r[1]!=='—');
  return this.modalShell({c:COL[x.s],
   title:`<span class="id">${esc(x.id)} · ${esc(LBL[x.type]||x.type)}${x.arch?' · archive':''}</span><div class="text-secondary small">${esc(DEF[x.type]||'')}</div><h2 class="h5 fw-bold mt-1 mb-2">${esc(x.title)}</h2>${badge(x.s)} ${over(x)?'<span class="od small">⚠ Overdue</span>':''}`,
   body:`<dl class="row mb-0 small">${rows.map(r=>`<dt class="col-4 col-sm-3 text-secondary fw-normal">${r[0]}</dt><dd class="col-8 col-sm-9">${esc(r[1])}</dd>`).join('')}</dl>
   ${ms.length?`<b class="small">Milestones / progress</b><ul class="small mt-1 mb-0">${ms.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:''}
   ${w?`<p class="text-secondary small mt-3 mb-2">Change status</p><div class="seg btn-group flex-wrap w-100">${ST.map(s=>`<button type="button" class="btn ${x.s===s?'on':''}" style="--c:${COL[s]}" data-s="${s}">${s==='Done'?'✔ Done':s}</button>`).join('')}</div>`:''}`,
   foot:w?`<button class="btn btn-outline-secondary" id="ed">✎ Edit / add progress</button><button class="btn btn-outline-danger" id="dl">Delete</button>`:''})},
 form(x,AL,edit){
  const fld=(lbl,html,cls='col-sm-6')=>`<div class="${cls}"><label class="form-label small fw-semibold text-secondary mb-1">${lbl}</label>${html}</div>`;
  return this.modalShell({
   title:`<h2 class="h5 fw-bold mb-0">${edit?'Edit':'Create new'} ${LBL[x.type]||x.type}</h2>`,
   body:`<div class="row g-3">
   ${fld('Type',`<div class="seg btn-group w-100" id="ty">${AL.map(t=>`<button type="button" class="btn ${x.type===t?'on':''}" data-t="${t}">${LBL[t]||t}</button>`).join('')}</div><div class="form-text" id="td">${DEF[x.type]}</div>`,'col-12')}
   ${fld('Name / Title *',`<input class="form-control" id="f_t" value="${esc(x.title)}">`,'col-12')}
   ${fld('Start date',`<input type="date" class="form-control" id="f_sd" value="${x.sd||''}">`)}${fld('End date',`<input type="date" class="form-control" id="f_e" value="${x.e||''}">`)}
   ${fld('Focal-1 (lead) *',`<input class="form-control" id="f_1" list="pl" value="${esc(x.f1)}">`)}${fld('Focal-2',`<input class="form-control" id="f_2" list="pl" value="${esc(x.f2)}">`)}
   <datalist id="pl">${Model.people().map(p=>`<option value="${esc(p)}">`).join('')}</datalist>
   ${fld('Priority',`<select class="form-select" id="f_p"><option>High</option><option>Mid</option><option>Low</option></select>`)}${fld('Stakeholder',`<input class="form-control" id="f_h" value="${esc(x.sh)}">`)}
   ${fld('Milestone &amp; progress (one per line)',`<textarea class="form-control" id="f_m" rows="5" placeholder="Requirement analysis - Done&#10;Vendor selection - Ongoing">${esc(splitMs(x.ms).join('\n'))}</textarea>`,'col-12')}</div>`,
   foot:`<button class="btn btn-brand" id="sb">${edit?'Save changes':'Submit → goes to Ongoing'}</button><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>`})},
 share(url){
  return this.modalShell({c:'#ec008c',size:'',title:'<h2 class="h5 fw-bold mb-0">🔗 Share this tracker</h2>',
   body:`<label class="form-label small text-secondary mb-1">Page link</label><div class="input-group"><input class="form-control" id="sl" readonly value="${url}"><button class="btn btn-brand" id="cp">Copy link</button></div>
   <p class="text-secondary small mt-2 mb-0">Only people the super admin has added as users can open the data.</p>`})},
 /* --- user management modal (super admin) --- */
 users(local){return this.modalShell({c:'#ec008c',title:'<h2 class="h5 fw-bold mb-0">👥 Users &amp; roles</h2><div class="text-secondary small">Only the super admin can add people and assign roles</div>',body:'<div id="ub"></div>'})},
 usersFile(list){const keep=['email','name','role','pw','at','by','id'];const rows=list.map(u=>JSON.stringify(Object.fromEntries(keep.filter(k=>u[k]!=null).map(k=>[k,u[k]]))));
  return `/* Seed accounts – loaded by every device that opens this site, so the sign-in page always has users.\n   Generated ${new Date().toISOString().slice(0,16).replace('T',' ')} from the Users dialog. Replace config/users.js in the repository with this file to publish. */\nwindow.SEED_USERS=[\n ${rows.join(',\n ')}\n];\n`},
 usersPanel(box,list,pend,me,local){
  const opt=(cur,id)=>`<select class="form-select form-select-sm" ${id}>${ROLES.map(r=>`<option value="${r}" ${r===cur?'selected':''}>${ROLE_LBL[r]}</option>`).join('')}</select>`;
  const tbl=rows=>`<div class="table-responsive"><table class="table table-sm align-middle mb-0">${rows}</table></div>`;
  box.innerHTML=`<div class="roles mb-3">${ROLES.map(r=>`<div class="d-flex gap-2 align-items-baseline small"><span class="badge rounded-pill b" style="--c:${ROLE_COL[r]}">${ROLE_LBL[r]}</span><span class="text-secondary">${ROLE_DESC[r]}</span></div>`).join('')}</div>
  <p class="fw-semibold mb-1">Add a user</p>
  <div class="row g-2 align-items-end mb-3">
   <div class="col-12 col-sm-6 col-lg-3"><label class="form-label small text-secondary mb-1">Name</label><input class="form-control form-control-sm" id="u_name"></div>
   <div class="col-12 col-sm-6 col-lg-3"><label class="form-label small text-secondary mb-1">Email</label><input class="form-control form-control-sm" id="u_email" type="email"></div>
   <div class="col-6 col-sm-6 col-lg-2"><label class="form-label small text-secondary mb-1">Role</label>${opt('viewer','id="u_role"')}</div>
   ${local?'<div class="col-6 col-sm-6 col-lg-2"><label class="form-label small text-secondary mb-1">Password</label><input class="form-control form-control-sm" id="u_pw" type="text" autocomplete="off"></div>':''}
   <div class="col-12 col-lg-2"><button class="btn btn-brand btn-sm w-100" id="u_add">＋ Add user</button></div></div>
  <p class="text-secondary small">${local?'The person signs in on this page with the email and password you set here. You can reset a password at any time.':'The person opens this page with the claude.ai account that has this email; their role is applied automatically.'}</p>
  ${local?'<div class="alert alert-light border small py-2 px-3 d-flex flex-wrap align-items-center gap-2 mb-3"><button class="btn btn-outline-secondary btn-sm" id="u_dl">⬇ Download users.js</button><span>Accounts added here exist only in this browser until you put the downloaded file at <code>config/users.js</code> in the repository. Then every device gets the same sign-in list.</span></div>':''}
  ${pend.length?`<p class="fw-semibold mb-1 mt-3">Waiting for access (${pend.length})</p>${tbl(pend.map(r=>`<tr><td>${esc(r.name||'Unknown')}<br><span class="text-secondary small">${fd(r.at)}</span></td><td><input class="form-control form-control-sm" data-pe="${esc(r.id)}" value="${esc(r.email||'')}" placeholder="email"></td><td style="width:130px">${opt('viewer','data-pr="'+esc(r.id)+'"')}</td><td class="text-end text-nowrap"><button class="btn btn-brand btn-sm" data-ap="${esc(r.id)}">Approve</button> <button class="btn btn-outline-danger btn-sm" data-rj="${esc(r.id)}">✕</button></td></tr>`).join(''))}`:''}
  <p class="fw-semibold mb-1 mt-3">Users (${list.length})</p>
  ${tbl(`<thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>${list.map(u=>{const self=me&&u.email===me.email;return `<tr><td class="fw-semibold">${esc(u.name)}${self?' <span class="text-secondary small">(you)</span>':''}${u.owner||u.by==='owner'?' <span class="text-secondary small">· owner</span>':''}</td><td class="text-secondary">${esc(u.email)}</td><td style="width:140px">${self?`<span class="badge rounded-pill b" style="--c:${ROLE_COL[u.role]}">${ROLE_LBL[u.role]}</span>`:opt(u.role,'data-r="'+esc(u.email)+'"')}</td><td class="text-end text-nowrap">${local?`<button class="btn btn-outline-secondary btn-sm" data-pw="${esc(u.email)}" title="Reset password">🔑</button> `:''}${self?'':`<button class="btn btn-outline-danger btn-sm" data-x="${esc(u.email)}" title="Remove">✕</button>`}</td></tr>`}).join('')}</tbody>`)}`},
};
