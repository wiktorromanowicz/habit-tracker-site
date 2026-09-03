/* Wiktor-OS shared spreadsheet grid engine
   Features: editable cells, column/row resize, multi-cell range selection,
   undo/redo (Cmd/Ctrl+Z / Shift+Z), copy/paste TSV, per-cell formatting (bold,
   italic, text color, fill/label color). Persists to localStorage per key. */
(function(){
function makeGrid(mountId, opts){
  opts = opts || {};
  const mount = document.getElementById(mountId);
  const label0 = !!opts.label0;
  const DEFAULT_W = opts.defaultW || 130, FIRST_W = opts.firstW || DEFAULT_W;
  const DEFAULT_H = 34, MINW = 54, MINH = 26, GUT = 42;
  const S = {key:null, cols:[], rows:[], colW:[], rowH:[], fmt:{}, sel:null, editing:null, editOrig:null, undo:[], redo:[]};
  let colResize=null, rowResize=null, dragging=false;

  /* ---- persistence & undo ---- */
  function payload(){ return {cols:S.cols, rows:S.rows, colW:S.colW, rowH:S.rowH, fmt:S.fmt}; }
  function persist(){ try{ localStorage.setItem(S.key, JSON.stringify(payload())); }catch(e){} }
  function snap(){ return JSON.stringify(payload()); }
  function pushUndo(){ S.undo.push(snap()); if(S.undo.length>120) S.undo.shift(); S.redo.length=0; }
  function apply(str){ const d=JSON.parse(str); S.cols=d.cols; S.rows=d.rows; S.colW=d.colW||[]; S.rowH=d.rowH||[]; S.fmt=d.fmt||{}; }
  function doUndo(){ if(!S.undo.length) return; S.redo.push(snap()); apply(S.undo.pop()); S.editing=null; render(); persist(); }
  function doRedo(){ if(!S.redo.length) return; S.undo.push(snap()); apply(S.redo.pop()); S.editing=null; render(); persist(); }

  /* ---- helpers ---- */
  const esc = s => (s==null?'':(''+s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const cw = ci => S.colW[ci] || (ci===0&&label0?FIRST_W:DEFAULT_W);
  const fkey = (r,c) => r+','+c;
  function cstyle(r,c){ const f=S.fmt[fkey(r,c)]; if(!f) return '';
    let s=''; if(f.b)s+='font-weight:700;'; if(f.i)s+='font-style:italic;';
    if(f.color)s+='color:'+f.color+';'; if(f.bg)s+='background:'+f.bg+';'; return s; }
  function norm(sel){ if(!sel) return null;
    return {r1:Math.min(sel.r1,sel.r2), c1:Math.min(sel.c1,sel.c2), r2:Math.max(sel.r1,sel.r2), c2:Math.max(sel.c1,sel.c2), ar:sel.ar, ac:sel.ac}; }
  function cellEl(r,c){ return mount.querySelector('td.gc[data-r="'+r+'"][data-c="'+c+'"]'); }

  /* ---- render ---- */
  function render(){
    let h='<table class="gsheet"><colgroup><col style="width:'+GUT+'px">';
    S.cols.forEach((c,ci)=> h+='<col style="width:'+cw(ci)+'px">');
    h+='</colgroup><thead><tr><th class="corner"></th>';
    S.cols.forEach((c,ci)=> h+='<th class="colh" data-c="'+ci+'"><span class="colname">'+esc(c)+'</span><span class="rz-col" data-c="'+ci+'"></span></th>');
    h+='</tr></thead><tbody>';
    S.rows.forEach((row,ri)=>{
      const hstyle = S.rowH[ri] ? ' style="height:'+S.rowH[ri]+'px"' : '';
      const fixed = S.rowH[ri] ? ' rfix' : '';
      h+='<tr'+hstyle+'><td class="rownum" data-r="'+ri+'">'+(ri+1)+'<span class="rz-row" data-r="'+ri+'"></span></td>';
      S.cols.forEach((c,ci)=>{ const lbl=(label0&&ci===0)?' rowlabel':'';
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
    const {r,c}=S.editing, td=cellEl(r,c);
    if(td){ S.rows[r][c]=td.innerText.replace(/\n$/,''); td.setAttribute('contenteditable','false'); }
    S.editing=null; persist();
  }
  function cancelEdit(){
    if(!S.editing) return;
    const {r,c}=S.editing, td=cellEl(r,c);
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

  /* ---- format bar ---- */
  const fbar=document.createElement('div'); fbar.className='gfmt';
  fbar.innerHTML=
    '<button data-a="b" title="Bold"><b>B</b></button>'+
    '<button data-a="i" title="Italic"><i>I</i></button>'+
    '<span class="sep"></span>'+
    '<span class="sw" data-color="#2b2a26" style="background:#2b2a26" title="Text black"></span>'+
    '<span class="sw" data-color="#c1362c" style="background:#c1362c" title="Text red"></span>'+
    '<span class="sw" data-color="#12855a" style="background:#12855a" title="Text green"></span>'+
    '<span class="sw" data-color="#2563eb" style="background:#2563eb" title="Text blue"></span>'+
    '<span class="sep"></span>'+
    '<span class="sw" data-bg="#fde68a" style="background:#fde68a" title="Fill yellow"></span>'+
    '<span class="sw" data-bg="#bbf7d0" style="background:#bbf7d0" title="Fill green"></span>'+
    '<span class="sw" data-bg="#fecaca" style="background:#fecaca" title="Fill red"></span>'+
    '<span class="sw" data-bg="#bfdbfe" style="background:#bfdbfe" title="Fill blue"></span>'+
    '<span class="sw nofill" data-bg="" title="No fill"></span>'+
    '<span class="sep"></span>'+
    '<button data-a="clear" title="Clear formatting">⌫</button>';
  document.body.appendChild(fbar);
  fbar.addEventListener('mousedown', e=>{ e.preventDefault();
    const b=e.target.closest('button[data-a]');
    if(b){ const a=b.dataset.a; if(a==='b')applyFmt({b:true}); else if(a==='i')applyFmt({i:true}); else if(a==='clear')applyFmt({clear:true}); return; }
    const sw=e.target.closest('.sw');
    if(sw){ if(sw.hasAttribute('data-color')) applyFmt({color:sw.dataset.color}); else applyFmt({bg:sw.dataset.bg}); }
  });
  function positionFmt(){ const s=norm(S.sel);
    if(!s || S.editing){ fbar.classList.remove('show'); return; }
    const a=cellEl(s.r1,s.c1), b=cellEl(s.r2,s.c2); if(!a){ fbar.classList.remove('show'); return; }
    const ra=a.getBoundingClientRect(), rb=(b||a).getBoundingClientRect();
    fbar.style.left=Math.round((ra.left+rb.right)/2)+'px';
    fbar.style.top=Math.max(46,Math.round(ra.top-10))+'px';
    fbar.classList.add('show');
  }

  /* ---- resize ---- */
  function startColResize(e,ci){ e.preventDefault(); pushUndo(); colResize={ci,x:e.clientX,w:cw(ci)}; }
  function startRowResize(e,ri){ e.preventDefault(); pushUndo(); rowResize={ri,y:e.clientY,h:S.rowH[ri]||(cellEl(ri,0)?cellEl(ri,0).offsetHeight:DEFAULT_H)}; }

  /* ---- events ---- */
  mount.addEventListener('mousedown', e=>{
    const rzc=e.target.closest('.rz-col'); if(rzc){ startColResize(e,+rzc.dataset.c); return; }
    const rzr=e.target.closest('.rz-row'); if(rzr){ startRowResize(e,+rzr.dataset.r); return; }
    const colh=e.target.closest('.colh');
    if(colh){ if(S.editing) commitEdit(); const ci=+colh.dataset.c; S.sel={r1:0,c1:ci,r2:S.rows.length-1,c2:ci,ar:0,ac:ci}; paint(); e.preventDefault(); return; }
    const rn=e.target.closest('td.rownum');
    if(rn){ if(S.editing) commitEdit(); const ri=+rn.dataset.r; S.sel={r1:ri,c1:0,r2:ri,c2:S.cols.length-1,ar:ri,ac:0}; paint(); e.preventDefault(); return; }
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
      const col=mount.querySelector('.gsheet colgroup col:nth-child('+(colResize.ci+2)+')'); if(col) col.style.width=nw+'px'; return; }
    if(rowResize){ const nh=Math.max(MINH,rowResize.h+(e.clientY-rowResize.y)); S.rowH[rowResize.ri]=nh;
      const tr=mount.querySelectorAll('.gsheet tbody tr')[rowResize.ri]; if(tr){ tr.style.height=nh+'px'; tr.querySelectorAll('td.gc').forEach(td=>td.classList.add('rfix')); } return; }
    if(dragging){ const el=document.elementFromPoint(e.clientX,e.clientY); const gc=el&&el.closest?el.closest('td.gc'):null; if(gc) setSel(+gc.dataset.r,+gc.dataset.c,true); }
  });
  document.addEventListener('mouseup', ()=>{ if(colResize){colResize=null;persist();} if(rowResize){rowResize=null;persist();} dragging=false; });

  document.addEventListener('mousedown', e=>{
    if(!mount.contains(e.target) && !fbar.contains(e.target)){ if(S.editing) commitEdit(); if(S.sel){ S.sel=null; paint(); } fbar.classList.remove('show'); }
  }, true);

  document.addEventListener('keydown', e=>{
    const meta=e.metaKey||e.ctrlKey;
    if(meta && (e.key==='z'||e.key==='Z')){ e.preventDefault(); if(e.shiftKey) doRedo(); else doUndo(); return; }
    if(meta && (e.key==='y'||e.key==='Y')){ e.preventDefault(); doRedo(); return; }
    if(S.editing){
      if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); const {r,c}=S.editing; commitEdit(); setSel(Math.min(r+1,S.rows.length-1),c,false); }
      else if(e.key==='Escape'){ e.preventDefault(); cancelEdit(); }
      else if(e.key==='Tab'){ e.preventDefault(); const {r,c}=S.editing; commitEdit(); setSel(r,Math.min(c+1,S.cols.length-1),false); }
      return;
    }
    if(!S.sel || !mount.contains(document.activeElement)) return;
    const s=norm(S.sel);
    if(meta && (e.key==='c'||e.key==='C')){ const tsv=copySel(); try{ navigator.clipboard.writeText(tsv); }catch(x){} e.preventDefault(); return; }
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
  window.addEventListener('scroll', ()=>{ if(S.sel) positionFmt(); }, true);
  window.addEventListener('resize', ()=>{ if(S.sel) positionFmt(); });

  /* ---- public API ---- */
  return {
    load(key, cols, rows, minRows){
      S.key=key; let d=null; try{ d=JSON.parse(localStorage.getItem(key)); }catch(e){}
      if(d&&d.cols&&d.rows){ S.cols=d.cols; S.rows=d.rows; S.colW=d.colW||[]; S.rowH=d.rowH||[]; S.fmt=d.fmt||{}; }
      else { S.cols=cols.slice(); S.rows=(rows||[]).map(r=>r.slice()); S.colW=[]; S.rowH=[]; S.fmt={}; }
      while(S.rows.length<(minRows||0)) S.rows.push(S.cols.map(()=>''));
      S.sel=null; S.editing=null; S.undo=[]; S.redo=[]; render(); persist();
    },
    addRow(){ pushUndo(); S.rows.push(S.cols.map(()=>'')); render(); persist(); },
    addCol(){ const n=prompt('Column name:','New'); if(n===null)return; pushUndo(); S.cols.push(n||'New'); S.rows.forEach(r=>r.push('')); render(); persist(); }
  };
}
window.makeGrid = makeGrid;
})();
