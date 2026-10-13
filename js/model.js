/* model.js – data, business rules, roles and storage adapters (cloud / local)
   Part of the MVP split: js/model.js · js/view.js · js/export.js · js/presenter.js (loaded in that order) */

/* ============================== MODEL ============================== */
const ST=['Ongoing','On Hold','Listed','Closed','Done'];
const PS=['Ongoing','Done','On Hold','Listed','Closed'];
const COL={Ongoing:'#2563eb','On Hold':'#d97706',Listed:'#7c3aed',Closed:'#64748b',Done:'#16a34a'};
const PC={High:'#dc2626',Mid:'#d97706',Low:'#16a34a'};
const PO={High:0,Mid:1,Low:2};
const TY=['Project','Drive','Task'],PF={Project:'P',Drive:'D',Task:'T'};
const DEF={Project:'has a timeline and completion %',Drive:'continuous – every cycle',Task:'one-off – happens once, then done'};
const LBL={Project:'Project',Drive:'Recurring',Task:'Task'},LBLS={Project:'Projects',Drive:'Recurring',Task:'Tasks'};
const PAGES={Project:{tab:'projects',ic:'📁',c:'#2563eb'},Drive:{tab:'recurring',ic:'🔁',c:'#0891b2'}};
const IC={Total:'📊',Ongoing:'⚡','On Hold':'⏸️',Listed:'📝',Closed:'🔒',Done:'✅',Overdue:'⚠️'};
const SHARE_URL='https://sajalkumar-byte.github.io/Infrastructure-and-Support-Technology-Task-Tracker/';

/* ---- roles ----
   superadmin : everything + creates users and assigns roles (the only role that can)
   admin      : create / edit / delete / export everything
   superuser  : view everything; create / edit / delete TASKS only; export (PDF, Excel, print)
   viewer     : view only                                                                */
const ROLES=['superadmin','admin','superuser','viewer'];
const ROLE_LBL={superadmin:'Super admin',admin:'Admin',superuser:'Superuser',viewer:'Viewer'};
const ROLE_DESC={superadmin:'Full access, plus user and role management',admin:'Create, edit, delete and export everything',superuser:'View everything · create and edit Tasks · export',viewer:'View only'};
const ROLE_COL={superadmin:'#ec008c',admin:'#4f46e5',superuser:'#0891b2',viewer:'#64748b'};

const today=new Date();today.setHours(0,0,0,0);
const today10=()=>new Date().toISOString().slice(0,10);
const splitMs=s=>String(s||'').split(/\s*(?:\n|\*|•)\s*/).filter(Boolean);

/* ---- Storage adapters: same interface, two backends ---- */
/* CloudStore: claude.ai shared database (live for everyone with access) */
class CloudStore{
 constructor(db){this.db=db;this.kind='cloud'}
 watch(c,cb,err){return this.db.collection(c).onSnapshot(s=>cb(s.docs.map(d=>d.data())),err||(()=>{}))}
 set(c,id,o){return this.db.doc(c+'/'+id).set(o)}
 update(c,id,o){return this.db.doc(c+'/'+id).update(o)}
 remove(c,id){return this.db.doc(c+'/'+id).delete()}
}
/* LocalStore: browser storage fallback – works when the page is opened outside claude.ai */
class LocalStore{
 constructor(){this.kind='local';this.key='tracker.data.v1';this.subs={};this.data=this._load();this._seed();
  window.addEventListener('storage',e=>{if(e.key===this.key){this.data=this._load();Object.keys(this.subs).forEach(c=>this._emit(c))}})}
 _load(){try{let raw=localStorage.getItem(this.key);if(!raw){raw=localStorage.getItem('mftech.tracker.v1');if(raw)localStorage.setItem(this.key,raw)}return JSON.parse(raw)||{}}catch(e){return{}}}
 _save(){try{localStorage.setItem(this.key,JSON.stringify(this.data))}catch(e){}}
 /* accounts from config/users.js exist on every device; a local record with the same email wins, and a seed user removed here stays removed here */
 _seed(){const seed=window.SEED_USERS||[];if(!seed.length)return;const u=this.data.users=this.data.users||{},gone=this.data.gone||{};let n=0;
  seed.forEach(x=>{if(!x||!x.email)return;const e=String(x.email).trim().toLowerCase(),id=e.replace(/[^a-z0-9]+/g,'_');if(!u[id]&&!gone[id]){u[id]={...x,email:e};n++}});if(n)this._save()}
 _coll(c){return this.data[c]=this.data[c]||{}}
 _emit(c){(this.subs[c]||[]).forEach(f=>f(Object.values(this._coll(c))))}
 watch(c,cb){(this.subs[c]=this.subs[c]||[]).push(cb);cb(Object.values(this._coll(c)));return()=>{}}
 async set(c,id,o){this._coll(c)[id]=o;if(c==='users'&&this.data.gone)delete this.data.gone[id];this._save();this._emit(c)}
 async update(c,id,o){const d=this._coll(c)[id];if(!d)throw new Error('not-found');Object.assign(d,o);this._save();this._emit(c)}
 async remove(c,id){delete this._coll(c)[id];if(c==='users'){(this.data.gone=this.data.gone||{})[id]=true}this._save();this._emit(c)}
}

const Model={
 store:null,user:null,
 items:[],hist:[],
 users:[],reqs:[],
 session:null,      /* {email,name,role,id?,owner?} – who is signed in */
 platWrite:true,    /* false when the claude.ai platform forbids shared-data writes for this viewer */
 listeners:[],
 onChange(f){this.listeners.push(f)},
 notify(){this.listeners.forEach(f=>f())},

 /* --- queries / rules --- */
 all(){return this.items.concat(this.hist)},
 byId(id){return this.all().find(i=>i.id===id)},
 base:n=>String(n||'').replace(/\s*\(.*?\)/g,'').trim(),
 own(p){return[this.base(p.f1),this.base(p.f2)].filter(Boolean)},
 over:p=>p.s==='Ongoing'&&p.e&&new Date(p.e+'T00:00:00')<today,
 pct(p){const l=splitMs(p.ms);if(p.s==='Done')return 100;if(l.length<2)return null;return Math.round(l.filter(x=>/done|complete/i.test(x)).length/l.length*100)},
 people(){return[...new Set(this.all().map(p=>this.base(p.f1)).filter(Boolean))].sort()},
 counts(n){const r={};TY.forEach(t=>r[t]={Ongoing:0,'On Hold':0,Done:0,Listed:0,Closed:0});
  this.all().forEach(p=>{if(this.own(p).includes(n)&&r[p.type])r[p.type][p.s]++});return r},
 nextId(type){const pf=PF[type]+'-';const n=Math.max(0,...this.all().map(p=>String(p.id||'').startsWith(pf)?+String(p.id).slice(pf.length)||0:0))+1;return pf+n},

 /* --- permissions (the single place that defines what each role may do) --- */
 role(){return this.session?this.session.role:''},
 can(action,type){const r=this.role();if(!r||!this.store)return false;
  switch(action){
   case 'view':return true;
   case 'manage':return r==='superadmin';
   case 'export':return r!=='viewer';
   case 'write':return this.platWrite&&(r==='superadmin'||r==='admin'||(r==='superuser'&&type==='Task'));
   default:return false}},

 /* --- users --- */
 uid:e=>String(e||'').trim().toLowerCase(),
 docId(e){return this.uid(e).replace(/[^a-z0-9]+/g,'_')||'x'},
 findUser(email){const u=this.uid(email);return this.users.find(x=>x.email===u)||null},
 findUserById(id){return id?this.users.find(x=>x.id===id)||null:null},
 async saveUser(u){u.email=this.uid(u.email);await this.store.set('users',this.docId(u.email),u)},
 async updateUser(email,patch){await this.store.update('users',this.docId(email),patch)},
 async removeUser(email){await this.store.remove('users',this.docId(email))},
 async hash(s){const d=new TextEncoder().encode('tracker:'+s);
  if(window.crypto&&crypto.subtle){const b=await crypto.subtle.digest('SHA-256',d);return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
  let h=5381;for(const c of 'tracker:'+s)h=(h*33+c.charCodeAt(0))>>>0;return 'x'+h.toString(16)},
 watchUsers(cb){this.store.watch('users',rows=>{this.users=rows.filter(u=>u&&u.email);cb()},()=>cb())},
 watchReqs(cb){this.store.watch('requests',rows=>{this.reqs=rows.filter(r=>r&&r.id);cb()},()=>{})},

 /* --- item commands --- */
 async save(o){await this.store.set('items',o.id,o)},
 async setStatus(id,s){await this.store.update('items',id,{s})},
 async remove(id){await this.store.remove('items',id)},

 /* --- data subscription --- */
 started:false,loaded:false,
 start(onStatus){if(this.started)return;this.started=true;
  this.store.watch('items',rows=>{this.items=rows;this.loaded=true;onStatus();this.notify()},e=>onStatus(e));
  this.store.watch('taskhist',rows=>{this.hist=rows.flatMap(d=>(d.rows||[]).map(r=>({...r,arch:true})));this.notify()})}
};
