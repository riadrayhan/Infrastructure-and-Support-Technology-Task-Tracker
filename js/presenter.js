/* presenter.js – user actions, navigation, filters, sign-in / roles, user management and boot
   Part of the MVP split: js/model.js · js/view.js · js/export.js · js/presenter.js (loaded in that order) */

/* ============================ PRESENTER ============================ */
const Presenter={
 TABS:[['overview','Overview'],['projects','Projects'],['recurring','Recurring'],['tasks','Tasks'],['team','Team']],
 PT:{projects:'Project',recurring:'Drive'},
 THEMES:[{id:'light',label:'Light',icon:'☀️',base:'light',swatch:'linear-gradient(135deg,#f3f5fb 45%,#6d28d9 45%,#ec008c)'},
         {id:'dark',label:'Dark',icon:'🌙',base:'dark',swatch:'linear-gradient(135deg,#0a0f1e 45%,#6d28d9 45%,#ec008c)'},
         {id:'ocean',label:'Ocean',icon:'🌊',base:'light',swatch:'linear-gradient(135deg,#e4f3f7 45%,#0e7490 45%,#22d3ee)'}],
 tab:'overview',SEL:'',
 gate:{kind:'loading',msg:''},   /* what is shown while nobody is signed in: loading | setup | login | blocked */
 F:{q:'',pri:'',who:'',st:''},TF:{q:'',who:'',st:'',n:100},
 USERSM:null,me:null,

 /* --- navigation --- */
 go(t){const changed=t!==this.tab;this.tab=t;if(changed)window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  if(!Model.session){View.nav([],'');View.gate(this.gate.kind,this.gate.msg,Model.store&&Model.store.kind);this.bindGate();return}
  View.nav(this.TABS,t);
  const bt=this.PT[t];
  View.page(bt?View.board(bt,this.F):{overview:()=>View.overview(),tasks:()=>View.tasks(this.TF),team:()=>View.team(this.SEL)}[t]());
  if(bt)this.bindBoard(bt);if(t==='tasks')this.bindTasks();if(t==='overview')View.countUp()},
 draw(){this.go(this.tab)},

 /* the filtered lists – shared by the page rendering and the export */
 boardList(type){const F=this.F;return Model.items.filter(p=>p.type===type&&(!F.q||(p.title+p.id+p.sh+p.ms).toLowerCase().includes(F.q))&&(!F.pri||p.pri===F.pri)&&(!F.who||own(p).includes(F.who))&&(!F.st||(F.st==='__over'?over(p):p.s===F.st)))},
 taskList(){const TF=this.TF;return Model.all().filter(t=>t.type==='Task'&&(!TF.q||(t.title+t.ms+t.sh).toLowerCase().includes(TF.q))&&(!TF.who||t.f1===TF.who)&&(!TF.st||t.s===TF.st))},
 bindBoard(type){const F=this.F;
  $('#fs').value=F.st;$('#fp').value=F.pri;$('#fw').value=F.who;$('#rs').onclick=()=>{this.F={q:'',pri:'',who:'',st:''};this.go(this.tab)};
  const sync=()=>{F.q=$('#q').value.toLowerCase();F.st=$('#fs').value;F.pri=$('#fp').value;F.who=$('#fw').value;this.bindBoard(type)};
  ['#q','#fs','#fp','#fw'].forEach(s=>$(s).oninput=sync);
  $('#res').innerHTML=View.boardResults(F,this.boardList(type))},
 bindTasks(){const TF=this.TF;
  $('#tw').value=TF.who;$('#ts').value=TF.st;
  const sync=()=>{TF.q=$('#tq').value.toLowerCase();TF.who=$('#tw').value;TF.st=$('#ts').value;TF.n=100;this.bindTasks()};
  ['#tq','#tw','#ts'].forEach(s=>$(s).oninput=sync);
  const L=this.taskList();
  $('#res').innerHTML=View.taskResults(TF,L);
  const m=$('#mr');if(m)m.onclick=()=>{TF.n+=200;this.bindTasks()}},

 /* --- item detail / status / delete --- */
 openItem(id){const x=Model.byId(id);if(!x)return;
  const w=Model.can('write',x.type)&&!x.arch;const m=View.detail(x,w);if(!w)return;
  m.querySelectorAll('[data-s]').forEach(b=>b.onclick=async()=>{try{await Model.setStatus(x.id,b.dataset.s);m.close();View.toast('Status → '+b.dataset.s)}catch(e){View.toast('Could not save: '+(e.code||e.message))}});
  m.querySelector('#ed').onclick=()=>{m.close();this.openForm(x)};
  m.querySelector('#dl').onclick=async()=>{if(!confirm('Delete "'+x.title+'"?'))return;try{await Model.remove(x.id);m.close();View.toast('Deleted')}catch(e){View.toast('Could not delete')}}},

 /* --- create / edit --- */
 openForm(x,type){
  const ty0=(x&&x.type)||type;
  if(!Model.can('write',ty0)){View.toast(Model.session?`Your role (${ROLE_LBL[Model.role()]}) cannot edit ${LBLS[ty0]||'this'}`:'Please sign in first');return}
  const edit=!!x;const AL=[ty0];
  x=x||{type:AL[0],pri:'Mid',f1:'',f2:'',title:'',ms:'',sd:today10(),e:'',sh:'',s:'Ongoing'};
  const m=View.form(x,AL,edit);let ty=x.type;m.querySelector('#f_p').value=x.pri||'Mid';
  m.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{ty=b.dataset.t;m.querySelector('#td').textContent=DEF[ty];m.querySelectorAll('[data-t]').forEach(z=>z.classList.toggle('on',z===b))});
  m.querySelector('#sb').onclick=async()=>{const v=i=>m.querySelector(i).value.trim();
   if(!v('#f_t')||!v('#f_1')){View.toast('Title and Focal-1 are required');return}
   const id=edit?x.id:Model.nextId(ty);
   const o={id,type:ty,pri:v('#f_p'),title:v('#f_t'),ms:v('#f_m'),f1:v('#f_1'),f2:v('#f_2'),s:edit?x.s:'Ongoing',sd:v('#f_sd'),e:v('#f_e'),sh:v('#f_h'),rm:x.rm||''};
   const btn=m.querySelector('#sb');btn.disabled=true;
   try{await Model.save(o);m.close();View.toast(edit?'Saved ✓':'Created ✓ – now in Ongoing')}catch(er){btn.disabled=false;View.toast('Could not save: '+(er.code||er.message))}}},

 /* --- export (PDF / Excel / Print) of what the current page shows --- */
 XCOLS:['ID','Type','Title','Status','Priority','Focal-1','Focal-2','Start','End','Stakeholder','Completion','Milestones / progress','Remarks'],
 xrow(p){return[p.id,LBL[p.type]||p.type,p.title,p.s,p.pri||'',p.f1||'',p.f2||'',fd(p.sd),fd(p.e),p.sh||'',p.type==='Project'&&Model.pct(p)!=null?Model.pct(p)+'%':'',splitMs(p.ms).join('; '),p.rm||'']},
 xsec(title,list,color){return{title,columns:this.XCOLS,rows:list.map(p=>this.xrow(p)),color}},
 xhex(h){return[1,3,5].map(i=>parseInt(h.slice(i,i+2),16))},
 xstatus(list){const by=ST.filter(s=>list.some(p=>p.s===s));return by.map(s=>this.xsec(s,list.filter(p=>p.s===s),this.xhex(COL[s])))},
 exportDoc(){const t=this.tab,day=today10(),base='Tracker';
  if(t==='overview'){const I=Model.items,A=Model.all();
   const sum={title:'Summary',columns:['Type',...ST,'Total'],rows:TY.map(ty=>{const L=(ty==='Task'?A:I).filter(p=>p.type===ty);return[LBLS[ty],...ST.map(s=>L.filter(p=>p.s===s).length),L.length]})};
   return{title:'Task and Project Tracker · All data',subtitle:`${I.filter(p=>p.type!=='Task').length+A.filter(p=>p.type==='Task').length} items`,file:`${base}-All-${day}`,
    sections:[sum,this.xsec('Projects',I.filter(p=>p.type==='Project'),[79,70,229]),this.xsec('Recurring',I.filter(p=>p.type==='Drive'),[8,145,178]),this.xsec('Tasks',A.filter(p=>p.type==='Task'),[234,88,12])]}}
  const bt=this.PT[t];
  if(bt){const F=this.F,L=this.boardList(bt),st=F.st?(F.st==='__over'?'Overdue':F.st):'';
   const fl=[st&&'Status: '+st,F.pri&&'Priority: '+F.pri,F.who&&'Person: '+F.who,F.q&&'Search: "'+F.q+'"'].filter(Boolean).join(' · ');
   return{title:LBLS[bt]+(st?' – '+st:''),subtitle:(fl||'All '+LBLS[bt].toLowerCase())+' · '+L.length+' items',file:`${base}-${LBLS[bt]}${st?'-'+Exporter.slug(st):''}-${day}`,sections:st?[this.xsec(LBLS[bt]+' – '+st,L,this.xhex(PAGES[bt].c))]:this.xstatus(L)}}
  if(t==='tasks'){const TF=this.TF,L=this.taskList();
   const fl=[TF.st&&'Status: '+TF.st,TF.who&&'Person: '+TF.who,TF.q&&'Search: "'+TF.q+'"'].filter(Boolean).join(' · ');
   return{title:'Tasks'+(TF.st?' – '+TF.st:''),subtitle:(fl||'All tasks')+' · '+L.length+' items',file:`${base}-Tasks${TF.st?'-'+Exporter.slug(TF.st):''}-${day}`,sections:TF.st?[this.xsec('Tasks – '+TF.st,L,[234,88,12])]:this.xstatus(L)}}
  if(t==='team'){if(this.SEL){const L=Model.all().filter(p=>own(p).includes(this.SEL));return{title:'Team – '+this.SEL,subtitle:L.length+' items where '+this.SEL+' is Focal-1 or Focal-2',file:`${base}-${Exporter.slug(this.SEL)}-${day}`,sections:this.xstatus(L)}}
   const cols=['Member',...TY.flatMap(ty=>['Ongoing','On Hold','Done'].map(s=>LBLS[ty]+' '+s))];
   return{title:'Team workload',subtitle:Model.people().length+' members',file:`${base}-Team-${day}`,sections:[{title:'Workload by member',columns:cols,rows:Model.people().map(n=>{const r=Model.counts(n);return[n,...TY.flatMap(ty=>[r[ty].Ongoing,r[ty]['On Hold'],r[ty].Done])]})}]}}
  return null},
 async export(kind){
  if(!Model.can('export')){View.toast('Your role (Viewer) cannot download or print');return}
  const doc=this.exportDoc();if(!doc)return;
  const n=doc.sections.reduce((a,s)=>a+s.rows.length,0);if(!n){View.toast('Nothing to export – no items match the current filter');return}
  try{if(kind==='pdf'){View.toast('Preparing PDF…');await Exporter.pdf(doc)}else if(kind==='xlsx'){View.toast('Preparing Excel file…');await Exporter.excel(doc)}else Exporter.print(doc)}
  catch(e){View.toast('Export failed: '+(e.message||e))}},

 /* --- share link --- */
 openShare(){const m=View.share(SHARE_URL);
  m.querySelector('#cp').onclick=async()=>{const i=m.querySelector('#sl');try{await navigator.clipboard.writeText(SHARE_URL)}catch(e){i.select();document.execCommand('copy')}View.toast('Link copied ✓')}},

 /* ======================= sign-in, session and roles ======================= */
 isLocal(){return Model.store&&Model.store.kind==='local'},
 isApi(){return Model.store&&Model.store.kind==='api'},
 /* both the browser-only mode and the Node.js backend sign people in with a password */
 usesPasswords(){return this.isLocal()||this.isApi()},
 setGate(kind,msg){this.gate={kind,msg:msg||''};this.draw()},
 signIn(u,remember){Model.session={email:u.email,name:u.name,role:u.role,id:u.id||'',owner:!!u.owner};
  if(remember&&this.isLocal())try{localStorage.setItem('tracker.session',u.email)}catch(e){}
  Model.start(e=>this.syncStatus(e));this.syncStatus();View.who(Model.session,this.usesPasswords());this.tab='overview';this.draw()},
 async signOut(){if(this.isApi()){try{await Model.store.logout()}catch(e){}}
  Model.session=null;try{localStorage.removeItem('tracker.session')}catch(e){}View.who(null,this.usesPasswords());this.setGate('login')},
 /* wire the gate screens (setup / login) after View.gate() rendered them */
 bindGate(){const k=this.gate.kind,b=$('#g_btn');if(!b)return;
  const v=i=>($(i)||{value:''}).value.trim();
  if(k==='setup')b.onclick=async()=>{const name=v('#g_name'),email=Model.uid(v('#g_email')),pw=v('#g_pw'),pw2=v('#g_pw2');
   if(!name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){View.toast('Enter a name and a valid email');return}
   if(pw.length<4){View.toast('Password must be at least 4 characters');return}if(pw!==pw2){View.toast('Passwords do not match');return}
   b.disabled=true;
   try{
    if(this.isApi()){const s=await Model.store.setup(name,email,pw);View.toast('Super admin account created ✓');this.signIn(s.user,false);await Model.store.refreshAll();return}
    const u={email,name,role:'superadmin',pw:await Model.hash(pw),at:today10(),by:'setup'};await Model.saveUser(u);View.toast('Super admin account created ✓');this.signIn(u,true)
   }catch(e){b.disabled=false;View.toast('Could not save: '+(e.message||e))}};
  if(k==='login')b.onclick=async()=>{const email=Model.uid(v('#g_email')),pw=v('#g_pw');
   if(this.isApi()){b.disabled=true;
    try{const s=await Model.store.login(email,pw);this.signIn(s.user,false);await Model.store.refreshAll()}
    catch(e){b.disabled=false;View.toast((e&&e.message)||'Email or password is not correct')}
    return}
   const u=Model.findUser(email);
   if(!u||u.pw!==await Model.hash(pw)){View.toast('Email or password is not correct');return}
   this.signIn(u,$('#g_rem')?$('#g_rem').checked:true)};
  const f=$('#g_pw')||$('#g_email');if(f)f.onkeydown=e=>{if(e.key==='Enter')b.click()}},

 /* local mode: first run creates the super admin, afterwards sign in with email + password */
 localGate(){
  if(!Model.users.length){if(Model.session)this.signOut();this.setGate('setup');return}
  if(Model.session){const u=Model.findUser(Model.session.email);
   if(!u){View.toast('Your account was removed');this.signOut();return}
   if(u.role!==Model.session.role){Model.session.role=u.role;View.who(Model.session,true);View.toast('Your role is now '+ROLE_LBL[u.role]);this.draw()}
   if(this.USERSM&&this.USERSM.isConnected)this.renderUsers(this.USERSM);return}
  let saved='';try{saved=localStorage.getItem('tracker.session')||''}catch(e){}
  const u=saved&&Model.findUser(saved);if(u){this.signIn(u,false);return}
  this.setGate('login')},

 /* backend mode: the Node.js server decides who you are and what your role is */
 async apiGate(health){const store=Model.store;
  let payload=null;try{payload=await store.me()}catch(e){}
  if(payload&&payload.user){this.signIn(payload.user,false);await store.refreshAll();return}
  if((payload&&payload.setupRequired)||(health&&health.setupRequired)){this.setGate('setup');return}
  this.setGate('login')},

 /* cloud mode: identity comes from the claude.ai account; the artifact owner is always super admin */
 async cloudGate(){const me=this.me;if(!me)return;
  let u=null;
  if(me.owner){u=Model.findUser(me.email)||{email:me.email||'owner',name:me.name||'Owner',role:'superadmin',id:me.id};u.role='superadmin';u.owner=true;
   if(me.email&&!Model.findUser(me.email))try{await Model.saveUser({email:me.email,name:u.name,role:'superadmin',id:me.id,at:today10(),by:'owner'})}catch(e){}}
  else{u=(me.email&&Model.findUser(me.email))||Model.findUserById(me.id);
   if(u&&me.id&&!u.id)try{await Model.updateUser(u.email,{id:me.id})}catch(e){}}
  if(u){if(!Model.session||Model.session.email!==u.email||Model.session.role!==u.role){const first=!Model.session;Model.session=null;this.signIn(u,false);if(!first)View.toast('Your role is now '+ROLE_LBL[u.role])}
   if(this.USERSM&&this.USERSM.isConnected)this.renderUsers(this.USERSM);return}
  if(Model.session){Model.session=null;View.who(null,false)}
  if(!me.id){this.setGate('blocked','Your account could not be identified, so access could not be checked. Please contact the super admin.');return}
  if(!this.gate.rq){this.gate.rq=true;try{await Model.store.set('requests',me.id,{id:me.id,email:me.email||'',name:me.name||'',at:today10()})}catch(e){}}
  this.setGate('blocked',`You do not have access yet. Ask the super admin to add you${me.email?' ('+me.email+')':''} as a user. This page opens automatically once a role is assigned.`)},

 /* ======================= user management (super admin only) ======================= */
 openUsers(){if(!Model.can('manage')){View.toast('Only the super admin can manage users');return}
  const m=View.users(this.usesPasswords());this.USERSM=m;this.renderUsers(m)},
 renderUsers(m){const box=m.querySelector('#ub');if(!box)return;const local=this.isLocal(),api=this.isApi(),pwMode=this.usesPasswords(),me=Model.session;
  const list=[...Model.users].sort((a,b)=>ROLES.indexOf(a.role)-ROLES.indexOf(b.role)||a.name.localeCompare(b.name));
  const pend=local?[]:Model.reqs.filter(r=>!(r.email&&Model.findUser(r.email))&&!Model.findUserById(r.id));
  View.usersPanel(box,list,pend,me,pwMode,local);
  const wr=async(f,msg)=>{try{await f();View.toast(msg)}catch(e){View.toast('Could not save: '+(e.message||e))}};
  const v=i=>(box.querySelector(i)||{value:''}).value.trim();
  box.querySelector('#u_add').onclick=async()=>{const name=v('#u_name'),email=Model.uid(v('#u_email')),role=v('#u_role'),pw=v('#u_pw');
   if(!name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){View.toast('Enter a name and a valid email');return}
   if(Model.findUser(email)){View.toast('This email already has an account');return}
   if(pwMode&&pw.length<4){View.toast('Set a password of at least 4 characters');return}
   const u={email,name,role,at:today10(),by:me.email};
   if(api)u.password=pw;else if(local)u.pw=await Model.hash(pw);
   wr(()=>Model.saveUser(u),name+' added as '+ROLE_LBL[role])};
  box.querySelectorAll('[data-r]').forEach(s=>s.onchange=()=>wr(()=>Model.updateUser(s.dataset.r,{role:s.value}),'Role updated → '+ROLE_LBL[s.value]));
  box.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>{const u=Model.findUser(b.dataset.x);if(u&&confirm('Remove '+u.name+' ('+u.email+')?'))wr(()=>Model.removeUser(u.email),'Removed')});
  box.querySelectorAll('[data-pw]').forEach(b=>b.onclick=async()=>{const pw=prompt('New password for '+b.dataset.pw+' (min 4 characters)');if(pw==null)return;if(pw.length<4){View.toast('Too short');return}wr(async()=>Model.updateUser(b.dataset.pw,api?{password:pw}:{pw:await Model.hash(pw)}),'Password reset ✓')});
  box.querySelectorAll('[data-ap]').forEach(b=>b.onclick=()=>{const r=Model.reqs.find(x=>x.id===b.dataset.ap);if(!r)return;const role=box.querySelector('[data-pr="'+r.id+'"]').value,email=Model.uid(box.querySelector('[data-pe="'+r.id+'"]').value)||('id-'+r.id);
   wr(async()=>{await Model.saveUser({email,name:r.name||email,role,id:r.id,at:today10(),by:me.email});await Model.store.remove('requests',r.id)},'Approved as '+ROLE_LBL[role])});
  box.querySelectorAll('[data-rj]').forEach(b=>b.onclick=()=>wr(()=>Model.store.remove('requests',b.dataset.rj),'Request removed'));
  const dl=box.querySelector('#u_dl');if(dl)dl.onclick=()=>{Exporter.saveText('users.js',View.usersFile(Model.users));View.toast('users.js downloaded – replace config/users.js in the repository')}},

 /* --- status line --- */
 syncStatus(err){
  if(err){View.status('Sync error: '+(err.code||''),false);return}
  const n=Model.items.length;
  if(this.isLocal()){View.status('Saved on this device · '+n+' items',false);return}
  if(this.isApi()){View.status('Live · '+n+' items synced',true);return}
  View.status((Model.platWrite?'Live · ':'Live · read-only · ')+n+' items synced',true)},

 /* --- theme: light | dark | ocean (remembered in this browser) --- */
 setTheme(id,save=true){const t=this.THEMES.find(x=>x.id===id)||this.THEMES[0],h=document.documentElement;
  h.classList.add('theming');h.setAttribute('data-theme',t.id);h.setAttribute('data-bs-theme',t.base);setTimeout(()=>h.classList.remove('theming'),450);
  if(save)try{localStorage.setItem('tracker.theme',t.id)}catch(e){}
  View.themeMenu(this.THEMES,t.id)},

 /* --- global events --- */
 bindEvents(){
  document.addEventListener('click',e=>{const t=e.target.closest('[data-a]');if(!t)return;const a=t.dataset.a,v=t.dataset.v;if(t.tagName==='A')e.preventDefault();
   if(a==='go')this.go(v);else if(a==='kpi'){this.F.st=v;this.go(this.PT[this.tab]?this.tab:'projects')}else if(a==='person'){this.SEL=v;this.go('team')}
   else if(a==='pf'){const[k,z]=v.split('|');if(k==='Task'){this.TF={q:'',who:'',st:z,n:100};this.go('tasks')}else{this.F={q:'',pri:'',who:'',st:z};this.go(PAGES[k].tab)}}
   else if(a==='open')this.openItem(v);else if(a==='new')this.openForm(null,v);else if(a==='export')this.export(v);else if(a==='theme')this.setTheme(v)
   else if(a==='users')this.openUsers();else if(a==='share')this.openShare();else if(a==='signout')this.signOut()});
  /* modals: backdrop click and Escape are handled by Bootstrap */
  this.setTheme(document.documentElement.getAttribute('data-theme')||'light',false);View.init();
  Model.onChange(()=>{if(Model.session)this.draw()})},

 /* --- boot: pick the storage backend, then gate on identity --- */
 async boot(){
  this.bindEvents();View.who(null,false);this.go('overview');

  /* 1. a backend wins when one answers: shared data and server-enforced roles.
        Either a Google Sheet (window.GAS_URL) or the Node.js server at /api/health. */
  let store=null,health=null;
  if(window.GAS_URL&&typeof GasStore!=='undefined'){const g=new GasStore();health=await g.probe();if(health)store=g}
  if(!store&&typeof ApiStore!=='undefined'){health=await ApiStore.probe();if(health)store=new ApiStore()}
  if(store&&health){
   Model.store=store;
   store.onAuthLost=()=>{if(Model.session){Model.session=null;View.who(null,true);View.toast('Your session ended – please sign in again')}this.setGate('login')};
   store.onNotice=msg=>View.toast(msg);
   store.onError=e=>{if(e&&e.status===0)View.status('Server unreachable – retrying…',false)};
   const redraw=()=>{if(this.USERSM&&this.USERSM.isConnected)this.renderUsers(this.USERSM)};
   Model.watchUsers(redraw);Model.watchReqs(redraw);
   await this.apiGate(health);
   return}

  /* 2. otherwise: the claude.ai shared database, or this browser's own storage */
  let db=null;
  try{if(window.claude){db=await claude.use('db');Model.user=await claude.use('user')}}catch(e){db=null}
  if(db){
   Model.store=new CloudStore(db);const u=Model.user;
   let me={};try{me=u?await u.me():{}}catch(e){}
   this.me={id:me.id||'',name:me.name||'',email:Model.uid(me.email||''),owner:u?await u.isOwner().catch(()=>false):false};
   try{Model.platWrite=u&&u.can?(await u.can('data.write'))!==false:true}catch(e){}
   Model.watchUsers(()=>this.cloudGate());Model.watchReqs(()=>{if(this.USERSM&&this.USERSM.isConnected)this.renderUsers(this.USERSM)});
  }else{
   Model.store=new LocalStore();View.status('Saved on this device',false);
   Model.watchUsers(()=>this.localGate());
  }}
};
window.__appReady=true;Presenter.boot();
