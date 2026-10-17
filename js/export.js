/* export.js – file export service (PDF / Excel / Print) for the Task and Project Tracker
   Part of the MVP split. The Presenter decides WHAT to export (title, filters, sections);
   this module only knows HOW to turn sections into a PDF, an .xlsx workbook or a print job.
   A "section" is {title, columns:[...], rows:[[...],...], color?}.
   Libraries (SheetJS, jsPDF, jsPDF-AutoTable) are loaded lazily from the CDN on first use. */

const Exporter={
 /* each entry: [local copy in vendor/, CDN fallback] */
 LIBS:{
  xlsx:[['vendor/xlsx.full.min.js','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js']],
  pdf:[['vendor/jspdf.umd.min.js','https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],['vendor/jspdf.plugin.autotable.min.js','https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js']]},
 _loaded:{},
 _script(src){return new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>{s.remove();fail(new Error('Could not load '+src.split('/').pop()))};document.head.appendChild(s)})},
 load(srcs){const k=srcs[0];return this._loaded[k]||(this._loaded[k]=(async()=>{let err;for(const u of srcs){try{await this._script(u);return}catch(e){err=e}}delete this._loaded[k];throw err})())},
 async libs(kind){for(const pair of this.LIBS[kind])await this.load(pair)},
 stamp(){const d=new Date();return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})},
 slug(s){return String(s).replace(/[^\w]+/g,'-').replace(/^-|-$/g,'')},
 clean(v){return String(v==null?'':v).replace(/[\u{1F000}-\u{1FFFF}☀-➿️]/gu,'').trim()},

 /* ---------- small text file (used for config/users.js) ---------- */
 saveText(name,text,type='text/javascript'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)},

 /* ---------- Excel (.xlsx): one sheet per section ---------- */
 async excel(doc){
  await this.libs('xlsx');
  const wb=XLSX.utils.book_new(),used={};
  doc.sections.forEach(sec=>{
   const ws=XLSX.utils.aoa_to_sheet([[doc.title],[doc.subtitle||''],[],sec.columns,...sec.rows]);
   ws['!cols']=sec.columns.map((c,i)=>({wch:Math.min(60,Math.max(String(c).length,...sec.rows.map(r=>String(r[i]==null?'':r[i]).length))+2)}));
   ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:Math.max(0,sec.columns.length-1)}}];
   let name=this.clean(sec.title).replace(/[\\/?*\[\]:]/g,' ').slice(0,28)||'Sheet';if(used[name])name+=' '+(++used[name]);else used[name]=1;
   XLSX.utils.book_append_sheet(wb,ws,name)});
  XLSX.writeFile(wb,doc.file+'.xlsx')},

 /* ---------- the dashboard's charts, drawn into the PDF ----------

    Drawn rather than photographed. A screenshot would carry the page's dark theme, its
    scroll position and whatever was on screen at the time, and would blur when printed;
    these are real vectors from the same figures the dashboard shows, so they stay sharp at
    any zoom and the numbers cannot disagree with the tables underneath. */

 rgb(hex){const h=String(hex||'#888').replace('#','');
  return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]},

 /* jsPDF has no arc, so a slice is a polygon: the centre, then a point every two degrees
    around the edge. One closed shape per slice, rather than a fan of separate triangles -
    a fan leaves hairline seams where the edges meet, which print as a faint swirl. */
 _pie(d,cx,cy,r,slices){
  const total=slices.reduce((a,s)=>a+(s.value||0),0);
  if(!total){d.setFillColor(228,230,237);d.circle(cx,cy,r,'F');return}
  const real=slices.filter(s=>s.value>0);
  if(real.length===1){const[R,G,B]=this.rgb(real[0].color);d.setFillColor(R,G,B);d.circle(cx,cy,r,'F');return}

  let a=-Math.PI/2;const step=Math.PI/90;
  real.forEach(s=>{
   const end=a+(s.value/total)*Math.PI*2,[R,G,B]=this.rgb(s.color);
   const pts=[[cx,cy]];
   for(let t=a;t<end;t+=step)pts.push([cx+r*Math.cos(t),cy+r*Math.sin(t)]);
   pts.push([cx+r*Math.cos(end),cy+r*Math.sin(end)]);
   const deltas=[];
   for(let i=1;i<pts.length;i++)deltas.push([pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]]);
   d.setFillColor(R,G,B);
   d.lines(deltas,pts[0][0],pts[0][1],[1,1],'F',true);
   a=end;
  });
 },

 _bar(d,x,y,w,h,parts,total){
  d.setFillColor(238,240,245);d.roundedRect(x,y,w,h,h/2,h/2,'F');
  if(!total)return;
  let at=x;
  parts.filter(p=>p.value>0).forEach(p=>{
   const seg=w*(p.value/total),[R,G,B]=this.rgb(p.color);
   d.setFillColor(R,G,B);d.rect(at,y,seg,h,'F');at+=seg;
  });
 },

 /** Draw every visual the document carries. Returns the y to carry on from. */
 _visuals(d,doc,y){
  if(!doc.visuals||!doc.visuals.length)return y;
  const W=d.internal.pageSize.getWidth(),H=d.internal.pageSize.getHeight(),L=14,right=W-14;
  const room=need=>{if(y+need>H-14){d.addPage();y=14}};
  const heading=t=>{room(14);d.setFont('helvetica','bold');d.setFontSize(11);d.setTextColor(0);
   d.text(this.clean(t),L,y);y+=5};

  for(const v of doc.visuals){
   if(v.kind==='kpis'){
    room(24);
    const gap=3,w=(right-L-gap*(v.items.length-1))/v.items.length;
    v.items.forEach((k,i)=>{
     const x=L+i*(w+gap),[R,G,B]=this.rgb(k.color);
     d.setFillColor(R,G,B);d.roundedRect(x,y,w,18,2,2,'F');
     d.setTextColor(255);d.setFont('helvetica','bold');d.setFontSize(15);
     d.text(String(k.value),x+w/2,y+9,{align:'center'});
     d.setFont('helvetica','normal');d.setFontSize(7.5);
     d.text(this.clean(k.label),x+w/2,y+14.5,{align:'center'});
    });
    d.setTextColor(0);y+=24;
   }

   else if(v.kind==='pies'){
    room(56);
    if(v.title)heading(v.title);
    const colW=(right-L)/v.charts.length,r=17;
    const top=y;
    v.charts.forEach((ch,i)=>{
     const x=L+i*colW,cx=x+r+2,cy=top+r+6;
     d.setFont('helvetica','bold');d.setFontSize(9);d.setTextColor(0);
     d.text(this.clean(ch.title)+'  ('+ch.total+')',x,top+3);
     this._pie(d,cx,cy,r,ch.slices);
     let ly=top+8;
     d.setFont('helvetica','normal');d.setFontSize(7.5);
     ch.slices.forEach(sl=>{
      const [R,G,B]=this.rgb(sl.color);
      d.setFillColor(R,G,B);d.rect(cx+r+5,ly-2.2,2.6,2.6,'F');
      d.setTextColor(60);
      const share=ch.total?Math.round(sl.value/ch.total*100):0;
      d.text(this.clean(sl.label)+'   '+sl.value+'   '+share+'%',cx+r+9.5,ly);
      ly+=5;
     });
    });
    d.setTextColor(0);y=top+2*r+16;
   }

   else if(v.kind==='bars'){
    if(!v.rows.length)continue;
    room(20);heading(v.title);
    const labelW=50,countW=10,trackW=right-L-labelW-countW-4;
    const max=Math.max(...v.rows.map(r=>r.total),1);
    v.rows.forEach(row=>{
     room(8);
     d.setFont('helvetica','normal');d.setFontSize(8);d.setTextColor(0);
     d.text(this.clean(row.label).slice(0,34),L,y+2.6);
     this._bar(d,L+labelW,y,trackW*(row.total/max),3.4,row.parts,row.total);
     d.setFont('helvetica','bold');d.text(String(row.total),right,y+2.6,{align:'right'});
     y+=6.4;
    });
    y+=1;
    d.setFont('helvetica','normal');d.setFontSize(7.5);
    let lx=L+labelW;
    (v.legend||[]).forEach(g=>{
     const [R,G,B]=this.rgb(g.color);
     d.setFillColor(R,G,B);d.rect(lx,y-2,2.6,2.6,'F');
     d.setTextColor(90);d.text(this.clean(g.label),lx+4,y+0.2);
     lx+=this.clean(g.label).length*1.7+12;
    });
    d.setTextColor(0);y+=8;
   }

   else if(v.kind==='progress'){
    if(!v.rows.length)continue;
    room(20);heading(v.title+'  ('+v.rows.length+')');
    const [R,G,B]=this.rgb(v.color||'#2563eb');
    v.rows.forEach(row=>{
     room(10);
     d.setFont('helvetica','normal');d.setFontSize(8);d.setTextColor(0);
     d.text(this.clean(row.label).slice(0,78),L,y+2.6);
     d.setFontSize(7);d.setTextColor(row.over?200:120);
     if(row.over){d.setTextColor(190,30,45)}
     d.text(this.clean(row.note),right,y+2.6,{align:'right'});
     d.setFillColor(238,240,245);d.roundedRect(L,y+4,right-L,2.6,1.3,1.3,'F');
     if(row.value>0){d.setFillColor(R,G,B);d.roundedRect(L,y+4,(right-L)*(row.value/100),2.6,1.3,1.3,'F');}
     y+=9.5;
    });
    d.setTextColor(0);y+=3;
   }
  }
  return y+2;
 },

 /* ---------- PDF: landscape A4, one table per section ---------- */
 async pdf(doc){
  await this.libs('pdf');
  const {jsPDF}=window.jspdf;const d=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const W=d.internal.pageSize.getWidth();
  d.setFont('helvetica','bold');d.setFontSize(15);d.text(this.clean(doc.title),14,14);
  d.setFont('helvetica','normal');d.setFontSize(9);d.setTextColor(100);
  d.text(this.clean((doc.subtitle?doc.subtitle+'  ·  ':'')+'Generated '+this.stamp()),14,20);d.setTextColor(0);
  let y=this._visuals(d,doc,26);
  doc.sections.forEach((sec,i)=>{
   /* Room for the heading and a few rows, or start the page now. The check used to skip the
      first section, which was fine when it began at the top; with charts above it, it no
      longer does, and the heading was being left behind at the foot of the page. */
   if(y>d.internal.pageSize.getHeight()-40){d.addPage();y=14}
   d.setFont('helvetica','bold');d.setFontSize(11);d.text(this.clean(sec.title)+(sec.rows.length?'  ('+sec.rows.length+')':''),14,y);
   d.autoTable({startY:y+3,head:[sec.columns.map(c=>this.clean(c))],body:sec.rows.length?sec.rows.map(r=>r.map(v=>this.clean(v))):[[{content:'No items',colSpan:sec.columns.length,styles:{textColor:120,fontStyle:'italic'}}]],
    styles:{fontSize:7.5,cellPadding:1.6,overflow:'linebreak',valign:'top'},headStyles:{fillColor:sec.color||[79,70,229],textColor:255,fontStyle:'bold'},alternateRowStyles:{fillColor:[245,246,250]},
    margin:{left:14,right:14},tableWidth:W-28,didDrawPage:h=>{d.setFontSize(8);d.setTextColor(130);d.text('Page '+d.internal.getNumberOfPages(),W-14,d.internal.pageSize.getHeight()-6,{align:'right'});d.setTextColor(0)}});
   y=d.lastAutoTable.finalY+10});
  d.save(doc.file+'.pdf')},

 /* ---------- the same charts, as HTML, so print and PDF show the same thing ---------- */
 _visualsHtml(doc,esc){
  if(!doc.visuals||!doc.visuals.length)return '';
  const slice=(cx,cy,r,from,to,fill)=>{
   if(to-from>=Math.PI*2-1e-6)return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
   const x1=cx+r*Math.cos(from),y1=cy+r*Math.sin(from),x2=cx+r*Math.cos(to),y2=cy+r*Math.sin(to);
   return `<path d="M${cx} ${cy}L${x1} ${y1}A${r} ${r} 0 ${to-from>Math.PI?1:0} 1 ${x2} ${y2}Z" fill="${fill}" stroke="#fff" stroke-width="1"/>`;
  };
  const pie=ch=>{
   if(!ch.total)return `<svg viewBox="0 0 120 120" width="110" height="110"><circle cx="60" cy="60" r="56" fill="#e7e9f0"/></svg>`;
   let a=-Math.PI/2,out='';
   ch.slices.filter(s=>s.value>0).forEach(s=>{const e=a+(s.value/ch.total)*Math.PI*2;out+=slice(60,60,56,a,e,s.color);a=e});
   return `<svg viewBox="0 0 120 120" width="110" height="110">${out}</svg>`;
  };
  return doc.visuals.map(v=>{
   if(v.kind==='kpis')return `<div class="kpis">${v.items.map(k=>
     `<div class="kpi" style="background:${k.color}"><b>${esc(k.value)}</b><span>${esc(k.label)}</span></div>`).join('')}</div>`;
   if(v.kind==='pies')return `<h2>${esc(v.title||'')}</h2><div class="pies">${v.charts.map(ch=>
     `<div class="piebox"><h3>${esc(ch.title)} (${ch.total})</h3><div class="pierow">${pie(ch)}<ul class="legend">${
      ch.slices.map(s=>`<li><i style="background:${s.color}"></i>${esc(s.label)} <b>${s.value}</b> <em>${ch.total?Math.round(s.value/ch.total*100):0}%</em></li>`).join('')
     }</ul></div></div>`).join('')}</div>`;
   if(v.kind==='bars'&&v.rows.length){
    const max=Math.max(...v.rows.map(r=>r.total),1);
    return `<h2>${esc(v.title)}</h2><table class="plain">${v.rows.map(r=>
      `<tr><td class="who">${esc(r.label)}</td><td class="track"><span class="bar" style="width:${r.total/max*100}%">${
        r.parts.filter(p=>p.value>0).map(p=>`<i style="width:${p.value/r.total*100}%;background:${p.color}"></i>`).join('')
      }</span></td><td class="num">${r.total}</td></tr>`).join('')}</table>
      <p class="legend-row">${(v.legend||[]).map(g=>`<span><i style="background:${g.color}"></i>${esc(g.label)}</span>`).join('')}</p>`;
   }
   if(v.kind==='progress'&&v.rows.length)return `<h2>${esc(v.title)} (${v.rows.length})</h2>${v.rows.map(r=>
     `<div class="prog"><div class="progtop"><span>${esc(r.label)}</span><em class="${r.over?'od':''}">${esc(r.note)}</em></div>
      <span class="bar"><i style="width:${r.value}%;background:${v.color||'#2563eb'}"></i></span></div>`).join('')}`;
   return '';
  }).join('');
 },

 /* ---------- Print: a clean document in a hidden iframe, then the browser's print dialog ---------- */
 print(doc){
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
   body{font:11px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;margin:16mm 12mm}
   h1{font-size:18px;margin:0 0 2px}.sub{color:#666;font-size:11px;margin:0 0 14px}h2{font-size:13px;margin:18px 0 6px;page-break-after:avoid}
   table{width:100%;border-collapse:collapse;font-size:10px;page-break-inside:auto}tr{page-break-inside:avoid}
   th{background:#4f46e5;color:#fff;text-align:left;padding:4px 5px;font-weight:600}td{padding:4px 5px;border-bottom:1px solid #ddd;vertical-align:top}
   tr:nth-child(even) td{background:#f5f6fa}.empty{color:#888;font-style:italic}@page{size:A4 landscape;margin:10mm}
   .kpis{display:flex;gap:4px;margin:0 0 14px}.kpi{flex:1;border-radius:4px;color:#fff;padding:7px 4px;text-align:center}
   .kpi b{display:block;font-size:17px;line-height:1.1}.kpi span{font-size:9px;opacity:.92}
   .pies{display:flex;gap:10px;page-break-inside:avoid}.piebox{flex:1}.piebox h3{font-size:11px;margin:0 0 4px}
   .pierow{display:flex;align-items:center;gap:8px}.legend{list-style:none;margin:0;padding:0;font-size:10px}
   .legend li{margin:2px 0}.legend i,.legend-row i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}
   .legend em{color:#777;font-style:normal}
   table.plain{width:100%;border-collapse:collapse;font-size:10px}table.plain td{border:0;padding:2px 4px}
   td.who{width:150px}td.num{width:30px;text-align:right;font-weight:700}
   .bar{display:flex;height:7px;border-radius:4px;background:#eceef4;overflow:hidden}.bar i{display:block;height:7px}
   .track .bar{min-width:2px}
   .prog{margin:5px 0;page-break-inside:avoid}.progtop{display:flex;justify-content:space-between;gap:10px;font-size:10px}
   .progtop em{color:#777;font-style:normal}.progtop em.od{color:#c81e2d}
   .legend-row span{margin-right:14px;font-size:10px;color:#666}
   @media print{thead{display:table-header-group}}</style></head><body>
   <h1>${esc(doc.title)}</h1><p class="sub">${esc((doc.subtitle?doc.subtitle+'  ·  ':'')+'Generated '+this.stamp())}</p>
   ${this._visualsHtml(doc,esc)}
   ${doc.sections.map(sec=>`<h2>${esc(sec.title)}${sec.rows.length?' ('+sec.rows.length+')':''}</h2>${sec.rows.length?`<table><thead><tr>${sec.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${sec.rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p class="empty">No items</p>'}`).join('')}
   </body></html>`;
  document.querySelectorAll('iframe.print-frame').forEach(f=>f.remove());
  const f=document.createElement('iframe');f.className='print-frame';f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);const w=f.contentWindow;w.document.open();w.document.write(html);w.document.close();
  const go=()=>{try{w.focus();w.print()}catch(e){}setTimeout(()=>f.remove(),60000)};
  if(w.document.readyState==='complete')setTimeout(go,150);else w.onload=()=>setTimeout(go,150)}
};
