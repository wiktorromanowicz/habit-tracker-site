/* Wiktor-OS shared spreadsheet grid engine
   editable cells, column/row resize, multi-cell range selection, undo/redo
   (Cmd/Ctrl+Z / Shift+Z), copy/cut/paste TSV, per-cell formatting, hide/unhide
   rows & columns, insert/delete rows & columns, and a right-click context menu.
   Persists to localStorage per key. */
(function(){
function makeGrid(mountId, opts){
  opts = opts || {};
  const mount = document.getElementById(mountId);
  const label0 = !!opts.label0;
  const DEFAULT_W = opts.defaultW || 130, FIRST_W = opts.firstW || DEFAULT_W;
  const DEFAULT_H = 34, MINW = 54, MINH = 26, GUT = 42;
  const S = {key:null, cols:[], rows:[], colW:[], rowH:[], fmt:{}, hideR:[], hideC:[], sel:null, editing:null, editOrig:null, undo:[], redo:[]};
  let colResize=null, rowResize=null, dragging=false;

  /* ---- persistence & undo ---- */
  function payload(){ return {cols:S.cols, rows:S.rows, colW:S.colW, rowH:S.rowH, fmt:S.fmt, hideR:S.hideR, hideC:S.hideC}; }
  function persist(){ try{ localStorage.setItem(S.key, JSON.stringify(payload())); }catch(e){} }
  function snap(){ return JSON.stringify(payload()); }
  function pushUndo(){ S.undo.push(snap()); if(S.undo.length>150) S.undo.shift(); S.redo.length=0; }
  function apply(str){ const d=JSON.parse(str); S.cols=d.cols; S.rows=d.rows; S.colW=d.colW||[]; S.rowH=d.rowH||[]; S.fmt=d.fmt||{}; S.hideR=d.hideR||[]; S.hideC=d.hideC||[]; }
  function doUndo(){ if(!S.undo.length) return; S.redo.push(snap()); apply(S.undo.pop()); S.editing=null; render(); persist(); }
  function doRedo(){ if(!S.redo.length) return; S.undo.push(snap()); apply(S.redo.pop()); S.editing=null; render(); persist(); }

  /* ---- helpers ---- */
  const esc = s => (s==null?'':(''+s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const cw = ci => S.colW[ci] || (ci===0&&label0?FIRST_W:DEFAULT_W);
  const fkey = (r,c) => r+','+c;
  const hiddenC = ci => S.hideC.indexOf(ci)>=0;
  const hiddenR = ri => S.hideR.indexOf(ri)>=0;
  function cstyle(r,c){ const f=S.fmt[fkey(r,c)]; if(!f) return '';
    let s=''; if(f.b)s+='font-weight:700;'; if(f.i)s+='font-style:italic;';
    if(f.color)s+='color:'+f.color+';'; if(f.bg)s+='background:'+f.bg+';'; return s; }
  function norm(sel){ if(!sel) return null;
    return {r1:Math.min(sel.r1,sel.r2), c1:Math.min(sel.c1,sel.c2), r2:Math.max(sel.r1,sel.r2), c2:Math.max(sel.c1,sel.c2), ar:sel.ar, ac:sel.ac}; }
  function cellEl(r,c){ return mount.querySelector('td.gc[data-r="'+r+'"][data-c="'+c+'"]'); }
  function remapFmt(fn){ const nf={}; for(const k in S.fmt){ const p=k.split(','); const nk=fn(+p[0],+p[1]); if(nk) nf[nk[0]+','+nk[1]]=S.fmt[k]; } S.fmt=nf; }

  /* ---- render ---- */
  function render(){
    let h='<table class="gsheet"><colgroup><col style="width:'+GUT+'px">';
    S.cols.forEach((c,ci)=>{ if(hiddenC(ci)) return; h+='<col data-c="'+ci+'" style="width:'+cw(ci)+'px">'; });
    h+='</colgroup><thead><tr><th class="corner"></th>';
    S.cols.forEach((c,ci)=>{ if(hiddenC(ci)) return;
      h+='<th class="colh" data-c="'+ci+'"><span class="colname">'+esc(c)+'</span><span class="rz-col" data-c="'+ci+'"></span></th>'; });
    h+='</tr></thead><tbody>';
    S.rows.forEach((row,ri)=>{ if(hiddenR(ri)) return;
      const hstyle = S.rowH[ri] ? ' style="height:'+S.rowH[ri]+'px"' : '';
      const fixed = S.rowH[ri] ? ' rfix' : '';
      h+='<tr data-r="'+ri+'"'+hstyle+'><td class="rownum" data-r="'+ri+'">'+(ri+1)+'<span class="rz-row" data-r="'+ri+'"></span></td>';
      S.cols.forEach((c,ci)=>{ if(hiddenC(ci)) return; const lbl=(label0&&ci===0)?' rowlabel':'';
        h+='<td class="gc'+lbl+fixed+'" tabindex="0" data-r="'+ri+'" data-c="'+ci+'" style="'+cstyle(ri,ci)+'">'+esc(row[ci])+'</td>'; });
      h+='</tr>';
    });
    h+='</tbody></table>';
    mount.innerHTML=h;
    paint();
  }
  function paint(){
    mount.querySelectorAll('td.gc.sel,td.gc.anchor').forEach(td=>td.classList.remove('sel','anchor'));
    const s=norm(S.sel);
    if(!s){ fbar.classList.remove('show'); return; }
    for(let r=s.r1;r<=s.r2;r++) for(let c=s.c1;c<=s.c2;c++){ const td=cellEl(r,c); if(td) td.classList.add('sel'); }
    const a=cellEl(s.ar,s.ac); if(a) a.classList.add('anchor');
    if(!S.editing && a && document.activeElement!==a) a.focus({preventScroll:true});
    positionFmt();
  }

  /* ---- selection ---- */
  function setSel(r,c,extend){
    if(extend && S.sel){ S.sel.r2=r; S.sel.c2=c; }
    else { S.sel={r1:r,c1:c,r2:r,c2:c,ar:r,ac:c}; }
    paint();
  }
  function selCol(ci){ S.sel={r1:0,c1:ci,r2:S.rows.length-1,c2:ci,ar:0,ac:ci}; paint(); }
  function selRow(ri){ S.sel={r1:ri,c1:0,r2:ri,c2:S.cols.length-1,ar:ri,ac:0}; paint(); }

  /* ---- editing ---- */
  function enterEdit(r,c,initial){
    if(S.editing) commitEdit();
    pushUndo();
    S.editing={r,c}; S.editOrig=S.rows[r][c]||'';
    const td=cellEl(r,c); if(!td) return;
    td.setAttribute('contenteditable','true');
    if(initial!=null) td.textContent=initial;
    td.focus();
    const rng=document.createRange(); rng.selectNodeContents(td); rng.collapse(false);
    const sel=getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  }
  function commitEdit(){
    if(!S.editing) return;
    const r=S.editing.r, c=S.editing.c, td=cellEl(r,c);
    if(td){ S.rows[r][c]=td.innerText.replace(/\n$/,''); td.setAttribute('contenteditable','false'); }
    S.editing=null; persist();
  }
  function cancelEdit(){
    if(!S.editing) return;
    const r=S.editing.r, c=S.editing.c, td=cellEl(r,c);
    if(td){ td.textContent=S.editOrig; td.setAttribute('contenteditable','false'); }
    S.editing=null; if(S.undo.length) S.undo.pop();
  }

  /* ---- clear / copy / paste ---- */
  function clearSelCells(){ const s=norm(S.sel); if(!s) return; pushUndo();
    for(let r=s.r1;r<=s.r2;r++) for(let c=s.c1;c<=s.c2;c++) S.rows[r][c]='';
    render(); persist(); }
  function copySel(){ const s=norm(S.sel); if(!s) return '';
    const out=[]; for(let r=s.r1;r<=s.r2;r++){ const line=[]; for(let c=s.c1;c<=s.c2;c++) line.push(S.rows[r][c]||''); out.push(line.join('\t')); }
    return out.join('\n'); }
  function pasteMatrix(text){ const s=norm(S.sel); const r0=s?s.ar:0, c0=s?s.ac:0;
    const mtx=text.replace(/\r/g,'').replace(/\n+$/,'').split('\n').map(l=>l.split('\t'));
    pushUndo();
    mtx.forEach((line,i)=>{ const ri=r0+i; while(S.rows.length<=ri) S.rows.push(S.cols.map(()=>''));
      line.forEach((v,j)=>{ const ci=c0+j; while(S.cols.length<=ci){ S.cols.push('Col '+(S.cols.length+1)); S.rows.forEach(rw=>rw.push('')); } S.rows[ri][ci]=v; }); });
    render(); persist(); }

  /* ---- formatting ---- */
  function applyFmt(prop){ const s=norm(S.sel); if(!s) return; pushUndo();
    let toggleOff=false;
    if(prop.b!==undefined){ const af=S.fmt[fkey(s.ar,s.ac)]; toggleOff=!!(af&&af.b); }
    if(prop.i!==undefined){ const af=S.fmt[fkey(s.ar,s.ac)]; toggleOff=!!(af&&af.i); }
    for(let r=s.r1;r<=s.r2;r++) for(let c=s.c1;c<=s.c2;c++){ const k=fkey(r,c);
      if(prop.clear){ delete S.fmt[k]; continue; }
      const f=Object.assign({},S.fmt[k]);
      if(prop.b!==undefined) f.b=!toggleOff;
      if(prop.i!==undefined) f.i=!toggleOff;
      if(prop.color!==undefined){ if(prop.color) f.color=prop.color; else delete f.color; }
      if(prop.bg!==undefined){ if(prop.bg) f.bg=prop.bg; else delete f.bg; }
      if(!f.b) delete f.b; if(!f.i) delete f.i;
      if(Object.keys(f).length) S.fmt[k]=f; else delete S.fmt[k];
    }
    render(); persist();
  }

  /* ---- structural ops ---- */
  function insertRow(i){ pushUndo(); S.rows.splice(i,0,S.cols.map(()=>'')); S.rowH.splice(i,0,undefined);
    remapFmt((r,c)=>[r>=i?r+1:r, c]); S.hideR=S.hideR.map(r=>r>=i?r+1:r); render(); persist(); }
  function insertCol(j){ pushUndo(); S.cols.splice(j,0,'New'); S.rows.forEach(r=>r.splice(j,0,'')); S.colW.splice(j,0,undefined);
    remapFmt((r,c)=>[r, c>=j?c+1:c]); S.hideC=S.hideC.map(c=>c>=j?c+1:c); render(); persist(); }
  function deleteRows(i1,i2){ if(S.rows.length<=(i2-i1+1)) return; pushUndo(); const n=i2-i1+1;
    S.rows.splice(i1,n); S.rowH.splice(i1,n);
    remapFmt((r,c)=> r<i1?[r,c]:(r>i2?[r-n,c]:null));
    S.hideR=S.hideR.filter(r=>r<i1||r>i2).map(r=>r>i2?r-n:r); render(); persist(); }
  function deleteCols(j1,j2){ if(S.cols.length<=(j2-j1+1)) return; pushUndo(); const n=j2-j1+1;
    S.cols.splice(j1,n); S.rows.forEach(r=>r.splice(j1,n)); S.colW.splice(j1,n);
    remapFmt((r,c)=> c<j1?[r,c]:(c>j2?[r,c-n]:null));
    S.hideC=S.hideC.filter(c=>c<j1||c>j2).map(c=>c>j2?c-n:c); render(); persist(); }
  function hideRows(i1,i2){ pushUndo(); for(let r=i1;r<=i2;r++) if(S.hideR.indexOf(r)<0) S.hideR.push(r); render(); persist(); }
  function hideCols(j1,j2){ pushUndo(); for(let c=j1;c<=j2;c++) if(S.hideC.indexOf(c)<0) S.hideC.push(c); render(); persist(); }
  function showAllRows(){ if(!S.hideR.length) return; pushUndo(); S.hideR=[]; render(); persist(); }
  function showAllCols(){ if(!S.hideC.length) return; pushUndo(); S.hideC=[]; render(); persist(); }

  /* ---- format bar ---- */
  const FILL=['#fde68a','#bbf7d0','#fecaca','#bfdbfe','#e9d5ff'], TEXT=['#2b2a26','#c1362c','#12855a','#2563eb'];
  function fillSwatches(){ return FILL.map(c=>'<span class="sw" data-bg="'+c+'" style="background:'+c+'"></span>').join('')+'<span class="sw nofill" data-bg="" title="No fill"></span>'; }
  function textSwatches(){ return TEXT.map(c=>'<span class="sw" data-color="'+c+'" style="background:'+c+'"></span>').join(''); }
  const fbar=document.createElement('div'); fbar.className='gfmt';
  fbar.innerHTML='<button data-a="b" title="Bold"><b>B</b></button><button data-a="i" title="Italic"><i>I</i></button>'+
    '<span class="sep"></span>'+textSwatches()+'<span class="sep"></span>'+fillSwatches()+
    '<span class="sep"></span><button data-a="clear" title="Clear formatting">⌫</button>';
  document.body.appendChild(fbar);
  fbar.addEventListener('mousedown', e=>{ e.preventDefault();
    const b=e.target.closest('button[data-a]');
    if(b){ const a=b.dataset.a; if(a==='b')applyFmt({b:true}); else if(a==='i')applyFmt({i:true}); else if(a==='clear')applyFmt({clear:true}); return; }
    const sw=e.target.closest('.sw'); if(sw){ if(sw.hasAttribute('data-color')) applyFmt({color:sw.dataset.color}); else applyFmt({bg:sw.dataset.bg}); }
  });
  function positionFmt(){ const s=norm(S.sel);
    if(!s || S.editing){ fbar.classList.remove('show'); return; }
    const a=cellEl(s.r1,s.c1), b=cellEl(s.r2,s.c2); if(!a){ fbar.classList.remove('show'); return; }
    const ra=a.getBoundingClientRect(), rb=(b||a).getBoundingClientRect();
    fbar.style.left=Math.round((ra.left+rb.right)/2)+'px';
    fbar.style.top=Math.max(46,Math.round(ra.top-10))+'px';
    fbar.classList.add('show');
  }

  /* ---- right-click context menu ---- */
  const menu=document.createElement('div'); menu.className='gmenu'; document.body.appendChild(menu);
  function hideMenu(){ menu.classList.remove('show'); }
  function buildMenu(){
    const rowN = S.sel ? (norm(S.sel).r2-norm(S.sel).r1+1) : 1;
    const colN = S.sel ? (norm(S.sel).c2-norm(S.sel).c1+1) : 1;
    const rs = rowN>1?' '+rowN+' rows':' row', csv = colN>1?' '+colN+' columns':' column';
    let h='<div class="gm-lbl">Fill</div><div class="gm-row">'+fillSwatches()+'</div>'+
      '<div class="gm-lbl">Text</div><div class="gm-row">'+textSwatches()+
      '<span class="sw" data-op="bold" style="background:#f3efe4;color:#2b2a26;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center">B</span>'+
      '<span class="sw" data-op="italic" style="background:#f3efe4;color:#2b2a26;font-style:italic;font-size:11px;display:flex;align-items:center;justify-content:center">I</span></div>'+
      '<div class="gm-sep"></div>'+
      '<button class="gm-item" data-op="copy">Copy</button>'+
      '<button class="gm-item" data-op="cut">Cut</button>'+
      '<button class="gm-item" data-op="paste">Paste</button>'+
      '<div class="gm-sep"></div>'+
      '<button class="gm-item" data-op="insRowA">Insert row above</button>'+
      '<button class="gm-item" data-op="insRowB">Insert row below</button>'+
      '<button class="gm-item" data-op="insColL">Insert column left</button>'+
      '<button class="gm-item" data-op="insColR">Insert column right</button>'+
      '<div class="gm-sep"></div>'+
      '<button class="gm-item" data-op="delRow">Delete'+rs+'</button>'+
      '<button class="gm-item" data-op="delCol">Delete'+csv+'</button>'+
      '<button class="gm-item" data-op="hideRow">Hide'+rs+'</button>'+
      '<button class="gm-item" data-op="hideCol">Hide'+csv+'</button>';
    if(S.hideR.length) h+='<button class="gm-item" data-op="showRows">Show all rows</button>';
    if(S.hideC.length) h+='<button class="gm-item" data-op="showCols">Show all columns</button>';
    h+='<div class="gm-sep"></div><button class="gm-item" data-op="clear">Clear contents</button>'+
      '<button class="gm-item" data-op="clearfmt">Clear formatting</button>';
    menu.innerHTML=h;
  }
  function showMenu(x,y){ buildMenu(); menu.style.left='0px'; menu.style.top='0px'; menu.classList.add('show');
    const w=menu.offsetWidth, hgt=menu.offsetHeight;
    menu.style.left=Math.min(x, innerWidth-w-8)+'px';
    menu.style.top=Math.min(y, innerHeight-hgt-8)+'px';
  }
  function runOp(op){ const s=norm(S.sel); if(!s && ['copy','cut','paste','clear','clearfmt'].indexOf(op)<0) return;
    switch(op){
      case 'copy': try{navigator.clipboard.writeText(copySel());}catch(e){} break;
      case 'cut': try{navigator.clipboard.writeText(copySel());}catch(e){} clearSelCells(); break;
      case 'paste': try{ navigator.clipboard.readText().then(t=>{ if(t!=null) pasteMatrix(t); }); }catch(e){} break;
      case 'bold': applyFmt({b:true}); break;
      case 'italic': applyFmt({i:true}); break;
      case 'insRowA': insertRow(s.r1); break;
      case 'insRowB': insertRow(s.r2+1); break;
      case 'insColL': insertCol(s.c1); break;
      case 'insColR': insertCol(s.c2+1); break;
      case 'delRow': deleteRows(s.r1,s.r2); setSel(Math.min(s.r1,S.rows.length-1),s.c1,false); break;
      case 'delCol': deleteCols(s.c1,s.c2); setSel(s.r1,Math.min(s.c1,S.cols.length-1),false); break;
      case 'hideRow': hideRows(s.r1,s.r2); break;
      case 'hideCol': hideCols(s.c1,s.c2); break;
      case 'showRows': showAllRows(); break;
      case 'showCols': showAllCols(); break;
      case 'clear': clearSelCells(); break;
      case 'clearfmt': applyFmt({clear:true}); break;
    }
  }
  menu.addEventListener('mousedown', e=>{ e.preventDefault();
    const sw=e.target.closest('.sw');
    if(sw){ if(sw.dataset.op==='bold')applyFmt({b:true}); else if(sw.dataset.op==='italic')applyFmt({i:true});
      else if(sw.hasAttribute('data-color'))applyFmt({color:sw.dataset.color}); else applyFmt({bg:sw.dataset.bg}); hideMenu(); return; }
    const it=e.target.closest('.gm-item'); if(it){ runOp(it.dataset.op); hideMenu(); }
  });
  mount.addEventListener('contextmenu', e=>{
    const colh=e.target.closest('.colh'), rn=e.target.closest('td.rownum'), gc=e.target.closest('td.gc');
    if(colh){ const ci=+colh.dataset.c; const s=norm(S.sel); if(!s||s.c1!==s.c2||s.c1!==ci||s.r1!==0) selCol(ci); }
    else if(rn){ const ri=+rn.dataset.r; const s=norm(S.sel); if(!s||s.r1!==s.r2||s.r1!==ri||s.c1!==0) selRow(ri); }
    else if(gc){ const r=+gc.dataset.r,c=+gc.dataset.c; const s=norm(S.sel);
      if(!s || r<s.r1||r>s.r2||c<s.c1||c>s.c2) setSel(r,c,false); }
    else return;
    e.preventDefault(); showMenu(e.clientX,e.clientY);
  });

  /* ---- resize ---- */
  function startColResize(e,ci){ e.preventDefault(); pushUndo(); colResize={ci,x:e.clientX,w:cw(ci)}; }
  function startRowResize(e,ri){ e.preventDefault(); pushUndo(); const c0=cellEl(ri,firstVisibleCol()); rowResize={ri,y:e.clientY,h:S.rowH[ri]||(c0?c0.offsetHeight:DEFAULT_H)}; }
  function firstVisibleCol(){ for(let c=0;c<S.cols.length;c++) if(!hiddenC(c)) return c; return 0; }

  /* ---- events ---- */
  mount.addEventListener('mousedown', e=>{
    if(e.button===2) return;
    const rzc=e.target.closest('.rz-col'); if(rzc){ startColResize(e,+rzc.dataset.c); return; }
    const rzr=e.target.closest('.rz-row'); if(rzr){ startRowResize(e,+rzr.dataset.r); return; }
    const colh=e.target.closest('.colh'); if(colh){ if(S.editing) commitEdit(); selCol(+colh.dataset.c); e.preventDefault(); return; }
    const rn=e.target.closest('td.rownum'); if(rn){ if(S.editing) commitEdit(); selRow(+rn.dataset.r); e.preventDefault(); return; }
    const gc=e.target.closest('td.gc');
    if(gc){ const r=+gc.dataset.r,c=+gc.dataset.c;
      if(S.editing && S.editing.r===r && S.editing.c===c) return;
      if(S.editing) commitEdit();
      setSel(r,c,e.shiftKey); dragging=true; e.preventDefault();
    }
  });
  mount.addEventListener('dblclick', e=>{
    const gc=e.target.closest('td.gc'); if(gc){ enterEdit(+gc.dataset.r,+gc.dataset.c); return; }
    const cn=e.target.closest('.colname');
    if(cn){ const th=cn.closest('.colh'), ci=+th.dataset.c; pushUndo();
      cn.setAttribute('contenteditable','true'); cn.focus(); document.execCommand('selectAll',false,null);
      const done=()=>{ cn.removeAttribute('contenteditable'); S.cols[ci]=cn.innerText.trim()||S.cols[ci]; cn.textContent=S.cols[ci]; persist(); cn.removeEventListener('blur',done); };
      cn.addEventListener('blur',done);
    }
  });
  document.addEventListener('mousemove', e=>{
    if(colResize){ const nw=Math.max(MINW,colResize.w+(e.clientX-colResize.x)); S.colW[colResize.ci]=nw;
      const col=mount.querySelector('.gsheet colgroup col[data-c="'+colResize.ci+'"]'); if(col) col.style.width=nw+'px'; return; }
    if(rowResize){ const nh=Math.max(MINH,rowResize.h+(e.clientY-rowResize.y)); S.rowH[rowResize.ri]=nh;
      const tr=mount.querySelector('.gsheet tbody tr[data-r="'+rowResize.ri+'"]'); if(tr){ tr.style.height=nh+'px'; tr.querySelectorAll('td.gc').forEach(td=>td.classList.add('rfix')); } return; }
    if(dragging){ const el=document.elementFromPoint(e.clientX,e.clientY); const gc=el&&el.closest?el.closest('td.gc'):null; if(gc) setSel(+gc.dataset.r,+gc.dataset.c,true); }
  });
  document.addEventListener('mouseup', ()=>{ if(colResize){colResize=null;persist();} if(rowResize){rowResize=null;persist();} dragging=false; });
  document.addEventListener('mousedown', e=>{
    if(!menu.contains(e.target)) hideMenu();
    if(!mount.contains(e.target) && !fbar.contains(e.target) && !menu.contains(e.target)){ if(S.editing) commitEdit(); if(S.sel){ S.sel=null; paint(); } fbar.classList.remove('show'); }
  }, true);
  document.addEventListener('keydown', e=>{
    const meta=e.metaKey||e.ctrlKey;
    if(e.key==='Escape'){ hideMenu(); }
    if(meta && (e.key==='z'||e.key==='Z')){ e.preventDefault(); if(e.shiftKey) doRedo(); else doUndo(); return; }
    if(meta && (e.key==='y'||e.key==='Y')){ e.preventDefault(); doRedo(); return; }
    if(S.editing){
      if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); const r=S.editing.r,c=S.editing.c; commitEdit(); setSel(Math.min(r+1,S.rows.length-1),c,false); }
      else if(e.key==='Escape'){ e.preventDefault(); cancelEdit(); }
      else if(e.key==='Tab'){ e.preventDefault(); const r=S.editing.r,c=S.editing.c; commitEdit(); setSel(r,Math.min(c+1,S.cols.length-1),false); }
      return;
    }
    if(!S.sel || !mount.contains(document.activeElement)) return;
    const s=norm(S.sel);
    if(meta && (e.key==='c'||e.key==='C')){ try{navigator.clipboard.writeText(copySel());}catch(x){} e.preventDefault(); return; }
    if(meta && (e.key==='x'||e.key==='X')){ try{navigator.clipboard.writeText(copySel());}catch(x){} clearSelCells(); e.preventDefault(); return; }
    if(e.key==='Backspace'||e.key==='Delete'){ e.preventDefault(); clearSelCells(); return; }
    if(e.key==='Enter'||e.key==='F2'){ e.preventDefault(); enterEdit(s.ar,s.ac); return; }
    if(e.key.indexOf('Arrow')===0){ e.preventDefault();
      let br=e.shiftKey?S.sel.r2:S.sel.ar, bc=e.shiftKey?S.sel.c2:S.sel.ac;
      if(e.key==='ArrowUp')br=Math.max(0,br-1); else if(e.key==='ArrowDown')br=Math.min(S.rows.length-1,br+1);
      else if(e.key==='ArrowLeft')bc=Math.max(0,bc-1); else if(e.key==='ArrowRight')bc=Math.min(S.cols.length-1,bc+1);
      setSel(br,bc,e.shiftKey); return; }
    if(!meta && !e.altKey && e.key.length===1){ enterEdit(s.ar,s.ac,e.key); e.preventDefault(); return; }
  });
  document.addEventListener('paste', e=>{
    if(!mount.contains(document.activeElement) || S.editing) return;
    const text=(e.clipboardData||window.clipboardData).getData('text/plain'); if(text==null) return;
    e.preventDefault(); pasteMatrix(text);
  });
  window.addEventListener('scroll', ()=>{ if(S.sel) positionFmt(); hideMenu(); }, true);
  window.addEventListener('resize', ()=>{ if(S.sel) positionFmt(); });

  /* ---- public API ---- */
  return {
    load(key, cols, rows, minRows){
      S.key=key; let d=null; try{ d=JSON.parse(localStorage.getItem(key)); }catch(e){}
      if(d&&d.cols&&d.rows){ S.cols=d.cols; S.rows=d.rows; S.colW=d.colW||[]; S.rowH=d.rowH||[]; S.fmt=d.fmt||{}; S.hideR=d.hideR||[]; S.hideC=d.hideC||[]; }
      else { S.cols=cols.slice(); S.rows=(rows||[]).map(r=>r.slice()); S.colW=[]; S.rowH=[]; S.fmt={}; S.hideR=[]; S.hideC=[]; }
      while(S.rows.length<(minRows||0)) S.rows.push(S.cols.map(()=>''));
      S.sel=null; S.editing=null; S.undo=[]; S.redo=[]; render(); persist();
    },
    addRow(){ pushUndo(); S.rows.push(S.cols.map(()=>'')); render(); persist(); },
    addCol(){ const n=prompt('Column name:','New'); if(n===null)return; pushUndo(); S.cols.push(n||'New'); S.rows.forEach(r=>r.push('')); render(); persist(); }
  };
}
window.makeGrid = makeGrid;
})();
