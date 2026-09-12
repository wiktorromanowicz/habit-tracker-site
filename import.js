/* Apex — statement importer for the Net worth tab.
   Drop bank / card CSV or XLSX exports, PDF statements, or company P&L reports.
   It reads balances + transactions, categorises spending (QuickBooks-style, and
   learns from your corrections), shows a review panel, then updates the page. */
(function(){
  const $=id=>document.getElementById(id);
  const RULES_KEY='finRules';                       // learned keyword → category
  let learned=[]; try{ learned=JSON.parse(localStorage.getItem(RULES_KEY)||'[]')||[]; }catch(e){}

  /* ---------- categories ---------- */
  const CATS=[
    {id:'rent',      name:'Rent',           kw:['czynsz','najem','rent ','rent,','wynajem','landlord','mieszkani']},
    {id:'groceries', name:'Groceries',      kw:['biedronka','lidl','zabka','żabka','carrefour','auchan','kaufland','dino ','netto','aldi','whole foods','trader joe','walmart','costco','grocer','spozyw','spożyw','frisco','stokrotka','lewiatan','delikates','piekarnia','warzyw','market']},
    {id:'eatout',    name:'Eating out',     kw:['restaur','pizza','kfc','mcdonald','burger','sushi','kebab','cafe','caffe','coffee','starbucks','uber eats','ubereats','glovo','wolt','pyszne','bolt food','doordash','bistro','kawiarnia','bar ','pub ','grill','ramen','thai','tapas','deli','bakery','costa']},
    {id:'transport', name:'Transport',      kw:['uber','bolt','taxi','orlen','shell','bp ','circle k','moya','paliw','pkp','intercity','koleje','ztm','jakdojade','mpk','parking','autostrad','ryanair','wizz','lot ','lufthansa','airline','airways','lyft','tesla','fuel','gas station','delta air','united air','american air','southwest','jetblue','klm','air france','easyjet','emirates','qatar','chevron','exxon','freenow','free now','lime','veturilo','car rental','hertz','avis','booking','airbnb','hotel']},
    {id:'subs',      name:'Subscriptions',  kw:['netflix','spotify','youtube','google','apple.com','apple.pl','icloud','adobe','microsoft','openai','chatgpt','anthropic','claude','notion','figma','canva','slack','zoom','dropbox','amazon prime','prime video','hbo','disney','skool','gohighlevel','highlevel','vercel','github','supabase','subscri','abonament','orange','t-mobile','plus.pl','play.pl','upc','netia','vectra','chatgpt','midjourney','loom','calendly','zapier','twilio','google workspace','1password','setapp','strava','duolingo','audible','kindle']},
    {id:'other',     name:'Other',          kw:[]},
    {id:'income',    name:'Income',         kw:['wynagrodzenie','wyplata','wypłata','salary','payroll','dywidend','dividend','stripe payout','payout','faktura','invoice','umowa','zlecenie']},
    {id:'transfer',  name:'Transfer / skip',kw:['przelew wlasny','przelew własny','na konto wlasne','own transfer','transfer to','savings','oszcz','revolut','wise','paypal','spłata karty','splata karty','card payment','payment thank you','autopay','zwrot','refund']},
  ];
  const catName=id=>(CATS.find(c=>c.id===id)||{}).name||id;
  function norm(s){ return (s||'').toLowerCase().replace(/[ąćęłńóśźż]/g,c=>({ą:'a',ć:'c',ę:'e',ł:'l',ń:'n',ó:'o',ś:'s',ź:'z',ż:'z'})[c]).replace(/\s+/g,' ').trim(); }
  function categorize(desc, amount){
    const d=norm(desc)+' ';
    let cat=null;
    for(const r of learned.slice().sort((a,b)=>b.kw.length-a.kw.length)) if(d.includes(r.kw)){ cat=r.cat; break; }
    if(!cat) for(const c of CATS){ for(const k of c.kw) if(d.includes(norm(k))){ cat=c.id; break; } if(cat) break; }
    if(!cat) cat = amount>0 ? 'income' : 'other';
    if(cat==='income' && amount<0) cat='other';          // money going out is never income
    return cat;
  }
  const GENERIC=['zakup przy uzyciu karty','zakup przy uzyciu','platnosc karta','platnosc kartą','przelew zewnetrzny wychodzacy','przelew zewnetrzny','przelew przychodzacy','przelew wychodzacy','przelew','card purchase','debit card purchase','pos purchase','purchase','payment','platnosc','transakcja','operacja','debit','credit','ach','pos'];
  function learnKey(desc){
    const parts=String(desc||'').split(' · ').map(x=>norm(x)).filter(Boolean);
    let best=parts.length>1 ? parts.slice(1).concat(parts[0]) : parts;            // title / merchant first, bank prefix last
    for(let t of best){ GENERIC.forEach(g=>{ t=t.replace(g,' '); }); t=t.replace(/[0-9]{3,}/g,' ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); if(t.length>=3) return t.split(' ').slice(0,3).join(' '); }
    return '';
  }

  /* ---------- number / date helpers ---------- */
  function toNum(s){
    if(s==null) return NaN; s=String(s).replace(/[ \s]/g,'').replace(/(PLN|USD|EUR|zł|zl|\$|€)/gi,'');
    let neg=false; if(/^\(.*\)$/.test(s)){ neg=true; s=s.slice(1,-1); } if(/^-/.test(s)){ neg=true; s=s.slice(1); } if(/-$/.test(s)){ neg=true; s=s.slice(0,-1); }
    if(/,\d{1,2}$/.test(s)) s=s.replace(/\./g,'').replace(',','.');      // 1.234,56 / 1234,56
    else s=s.replace(/,/g,'');                                            // 1,234.56
    const n=parseFloat(s); return isNaN(n)?NaN:(neg?-n:n);
  }
  const DATE_RE=/\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{2})\.(\d{2})\.(\d{4})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
  function toDate(s, usOrder){
    const m=DATE_RE.exec(String(s||'')); if(!m) return null;
    let y,mo,d;
    if(m[1]){ y=+m[1]; mo=+m[2]; d=+m[3]; }
    else if(m[4]){ d=+m[4]; mo=+m[5]; y=+m[6]; }                         // dd.mm.yyyy (PL)
    else { if(usOrder===false){ d=+m[7]; mo=+m[8]; } else { mo=+m[7]; d=+m[8]; } y=+m[9]; if(y<100) y+=2000; if(mo>12){ const t=mo; mo=d; d=t; } }
    if(!y||!mo||!d||mo>12||d>31) return null;
    return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }
  function detectCurrency(text){ const t=text.toLowerCase(); if(/\bpln\b|zł|zl\b/.test(t)) return 'PLN'; if(/\busd\b|\$/.test(t)) return 'USD'; if(/\beur\b|€/.test(t)) return 'EUR'; return ''; }

  /* ---------- CSV / XLSX ---------- */
  function decodeBytes(buf){ try{ return new TextDecoder('utf-8',{fatal:true}).decode(buf); }catch(e){ try{ return new TextDecoder('windows-1250').decode(buf); }catch(_){ return new TextDecoder().decode(buf); } } }
  function parseCsv(text){
    const lines=text.replace(/\r/g,'').split('\n').filter(l=>l.trim().length);
    const sample=lines.slice(0,30).join('\n');
    const delim=[';','\t',',','|'].map(d=>({d,n:(sample.match(new RegExp('\\'+d,'g'))||[]).length})).sort((a,b)=>b.n-a.n)[0].d;
    const rows=lines.map(l=>{ const out=[]; let cur='',q=false; for(let i=0;i<l.length;i++){ const ch=l[i]; if(ch==='"'){ if(q&&l[i+1]==='"'){cur+='"';i++;} else q=!q; } else if(ch===delim&&!q){ out.push(cur); cur=''; } else cur+=ch; } out.push(cur); return out.map(c=>c.trim()); });
    return rows;
  }
  const H={ date:['data operacji','data transakcji','data ksiegowania','data księgowania','data','posting date','transaction date','post date','date','date (utc)','booking date','value date'],
            desc:['opis operacji','opis transakcji','opis','tytul','tytuł','dane kontrahenta','nadawca/odbiorca','odbiorca','description','memo','details','payee','name','merchant','narrative'],
            amount:['kwota transakcji','kwota operacji','kwota','amount','transaction amount','kwota transakcji (waluta rachunku)'],
            debit:['obciazenia','obciążenia','debit','withdrawal','money out','paid out','wydatki'],
            credit:['uznania','credit','deposit','money in','paid in','wplywy','wpływy'],
            balance:['saldo po operacji','saldo po transakcji','saldo','balance','running balance','ending balance'],
            currency:['waluta','currency'] };
  function findCols(header){
    const h=header.map(c=>norm(c).replace(/^#/,''));
    const pick=list=>{ for(const name of list){ const i=h.findIndex(x=>x===name); if(i>=0) return i; } for(const name of list){ const i=h.findIndex(x=>x.includes(name)); if(i>=0) return i; } return -1; };
    return { date:pick(H.date), desc:pick(H.desc), amount:pick(H.amount), debit:pick(H.debit), credit:pick(H.credit), balance:pick(H.balance), currency:pick(H.currency), title:h.findIndex(x=>x==='tytul'||x==='tytuł'||x==='memo') };
  }
  function rowsToDoc(rows, name){
    // header = first row with ≥2 known column names
    let hi=-1; for(let i=0;i<Math.min(rows.length,40);i++){ const c=findCols(rows[i]); if(c.date>=0 && (c.amount>=0||c.debit>=0||c.credit>=0)){ hi=i; break; } }
    const doc={name, kind:'transactions', txns:[], currency:'', endingBalance:null, notes:[]};
    const all=rows.map(r=>r.join(' ')).join('\n');
    doc.currency=detectCurrency(all);
    if(hi<0){ // no header: try positional (date, desc, amount)
      rows.forEach(r=>{ const d=r.map(c=>toDate(c)).find(Boolean); if(!d) return; const nums=r.map(toNum); const ai=nums.map((n,i)=>isNaN(n)?-1:i).filter(i=>i>=0&&!DATE_RE.test(r[i])); if(!ai.length) return; const amount=nums[ai[0]]; const desc=r.filter((c,i)=>!DATE_RE.test(c)&&isNaN(nums[i])).join(' · '); doc.txns.push({date:d,desc,amount}); });
      if(!doc.txns.length) doc.notes.push('Could not find a date + amount column in this file.');
    } else {
      const c=findCols(rows[hi]);
      // slash dates: month-first unless some row proves day-first (first number > 12)
      const slashDates=rows.slice(hi+1).map(r=>r[c.date]).filter(v=>/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(v||''));
      const usOrder=!slashDates.some(v=>+v.split('/')[0]>12);
      let lastBal=null,lastDate='';
      for(let i=hi+1;i<rows.length;i++){ const r=rows[i]; if(r.length<2) continue;
        const d=toDate(r[c.date],usOrder); if(!d){ // footer lines (e.g. mBank "#Saldo końcowe;1234,56")
          const line=norm(r.join(' ')); if(/saldo koncowe|ending balance|closing balance|saldo koñcowe/.test(line)){ const n=r.map(toNum).filter(x=>!isNaN(x)).pop(); if(n!=null) doc.endingBalance=n; } continue; }
        let amount=NaN;
        if(c.amount>=0) amount=toNum(r[c.amount]);
        if(isNaN(amount)&&(c.debit>=0||c.credit>=0)){ const de=c.debit>=0?toNum(r[c.debit]):0, cr=c.credit>=0?toNum(r[c.credit]):0; amount=(isNaN(cr)?0:cr)-(isNaN(de)?0:Math.abs(de)); }
        if(isNaN(amount)) continue;
        const parts=[c.desc,c.title].filter(i=>i>=0).map(i=>r[i]).filter(Boolean); const desc=parts.join(' · ')||r.filter((x,i)=>i!==c.date&&i!==c.amount&&i!==c.balance&&isNaN(toNum(x))).join(' · ');
        if(c.currency>=0&&r[c.currency]&&!doc.currency) doc.currency=r[c.currency].toUpperCase();
        if(c.balance>=0){ const b=toNum(r[c.balance]); if(!isNaN(b)&&d>=lastDate){ lastBal=b; lastDate=d; } }
        doc.txns.push({date:d,desc,amount});
      }
      if(lastBal!=null) doc.endingBalance=lastBal;
      // card exports (Amex-style) list charges as positive numbers and have no balance column
      if(c.balance<0 && doc.txns.length && doc.txns.every(t=>t.amount>=0) && /amex|american express|card member|reference/.test(norm(all))){ doc.txns.forEach(t=>t.amount=-t.amount); doc.notes.push('Card export: charges read as expenses.'); }
    }
    finish(doc); return doc;
  }
  function finish(doc){
    doc.txns.forEach(t=>{ t.cat=categorize(t.desc,t.amount); });
    const months={}; doc.txns.forEach(t=>{ const m=t.date.slice(0,7); months[m]=(months[m]||0)+1; });
    doc.months=Object.keys(months).sort(); doc.month=doc.months.length?doc.months.reduce((a,b)=>months[a]>=months[b]?a:b):'';
    if(!doc.currency) doc.currency= doc.name.match(/pln|zl|mbank|pko|ing|millennium/i)?'PLN':'USD';
  }

  /* ---------- PDF (statements + P&L) ---------- */
  function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
  async function pdfLines(buf){
    if(!window.pdfjsLib){ await loadScript('vendor/pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js'; }
    const pdf=await window.pdfjsLib.getDocument({data:buf}).promise; const lines=[];
    for(let p=1;p<=pdf.numPages;p++){ const page=await pdf.getPage(p); const tc=await page.getTextContent(); const rows={};
      tc.items.forEach(it=>{ const y=Math.round(it.transform[5]/3)*3; (rows[y]=rows[y]||[]).push({x:it.transform[4],s:it.str}); });
      Object.keys(rows).map(Number).sort((a,b)=>b-a).forEach(y=>{ lines.push(rows[y].sort((a,b)=>a.x-b.x).map(i=>i.s).join(' ').replace(/\s+/g,' ').trim()); }); }
    return lines.filter(Boolean);
  }
  const NUM_RE=/-?\(?\d{1,3}(?:[  .,]\d{3})*(?:[.,]\d{2})\)?-?|-?\d+[.,]\d{2}/g;
  function linesToDoc(lines, name){
    const text=lines.join('\n'), lo=norm(text);
    const doc={name, kind:'transactions', txns:[], currency:detectCurrency(text), endingBalance:null, notes:[], pnl:null};
    // P&L?
    const pl={}; const grab=(keys)=>{ for(const l of lines){ const n=norm(l); if(keys.some(k=>n.startsWith(k)||n.includes(' '+k))){ const nums=(l.match(NUM_RE)||[]).map(toNum).filter(x=>!isNaN(x)); if(nums.length) return nums[nums.length-1]; } } return null; };
    pl.revenue=grab(['total revenue','total income','revenue','przychody ogolem','przychody','sales','gross receipts']);
    pl.expenses=grab(['total expenses','total operating expenses','expenses','koszty ogolem','koszty']);
    pl.net=grab(['net income','net profit','net operating income','zysk netto','wynik netto','profit']);
    if(pl.net!=null||(pl.revenue!=null&&pl.expenses!=null)){ if(pl.net==null) pl.net=pl.revenue-pl.expenses; doc.kind='pnl'; doc.pnl=pl; }
    // ending balance
    for(const l of lines){ const n=norm(l); if(/saldo koncowe|saldo na koniec|ending balance|closing balance|new balance|statement balance|balance as of|current balance|saldo zamkniecia/.test(n)){ const nums=(l.match(NUM_RE)||[]).map(toNum).filter(x=>!isNaN(x)); if(nums.length){ doc.endingBalance=nums[nums.length-1]; break; } } }
    // transactions: a date + at least one amount on the line
    const slashDates=text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)||[]; const usOrder=!slashDates.some(v=>+v.split('/')[0]>12);
    lines.forEach(l=>{ const d=toDate(l,usOrder); if(!d) return; const nums=(l.match(NUM_RE)||[]).map(toNum).filter(x=>!isNaN(x)); if(!nums.length) return;
      const amount= nums.length>=2 ? nums[nums.length-2] : nums[0];   // last number is usually the running balance
      const desc=l.replace(DATE_RE,'').replace(NUM_RE,'').replace(/\s+/g,' ').trim(); if(desc.length<2) return;
      doc.txns.push({date:d,desc,amount}); });
    if(doc.kind!=='pnl'&&!doc.txns.length&&doc.endingBalance==null) doc.notes.push('No transactions or balance found — is this a scanned PDF? (needs text, not an image)');
    if(doc.kind==='transactions'&&doc.txns.length&&doc.txns.every(t=>t.amount>=0)) doc.notes.push('Amounts had no sign — check the categories; spending may show as income.');
    finish(doc); return doc;
  }

  /* ---------- file entry ---------- */
  async function parseFile(file){
    const buf=await file.arrayBuffer(); const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(ext==='pdf') return linesToDoc(await pdfLines(buf), file.name);
    if(ext==='xlsx'||ext==='xls'){ if(!window.XLSX) await loadScript('vendor/xlsx.full.min.js'); const wb=window.XLSX.read(buf,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]]; const rows=window.XLSX.utils.sheet_to_json(ws,{header:1,raw:false}).map(r=>r.map(c=>c==null?'':String(c).trim())); return rowsToDoc(rows,file.name); }
    const text=decodeBytes(buf);
    if(/^\s*%PDF/.test(text)) return linesToDoc(await pdfLines(buf), file.name);
    const lines=text.replace(/\r/g,'').split('\n');
    // plain-text P&L or statement pasted as .txt
    if(ext==='txt' && !/[;,\t].*[;,\t]/.test(lines.slice(0,5).join(''))) return linesToDoc(lines.filter(Boolean),file.name);
    return rowsToDoc(parseCsv(text), file.name);
  }

  /* ---------- review panel ---------- */
  const EXPCATS=['rent','groceries','eatout','transport','subs','other'];
  function targets(){ const t=[{k:'',n:'— don’t update a balance —'}]; assets.forEach(a=>{ if(a.k!=='skool') t.push({k:a.k,n:a.name+' ('+a.cur+')'}); }); t.push({k:'liab',n:'Owed to company (loan)'}); return t; }
  function guessTarget(doc){ const n=norm(doc.name+' '+doc.txns.slice(0,5).map(t=>t.desc).join(' ')); if(doc.currency==='USD'){ const u=assets.find(a=>a.k==='usbiz'); return u?u.k:''; } const c=assets.find(a=>a.k==='cash'); return c?c.k:''; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function money(n,cur){ return (n<0?'−':'')+Math.abs(n).toLocaleString(cur==='PLN'?'pl-PL':'en-US',{maximumFractionDigits:2})+' '+cur; }

  function review(doc){
    const old=$('impReview'); if(old) old.remove();
    const wrap=document.createElement('div'); wrap.id='impReview'; wrap.className='imp-overlay';
    const monthOpts=doc.months.map(m=>'<option value="'+m+'"'+(m===doc.month?' selected':'')+'>'+new Date(m+'-01').toLocaleDateString(undefined,{month:'long',year:'numeric'})+'</option>').join('');
    const tOpts=targets().map(t=>'<option value="'+t.k+'"'+(t.k===guessTarget(doc)?' selected':'')+'>'+esc(t.n)+'</option>').join('');
    let h='<div class="imp-card"><div class="imp-head"><div><div class="imp-title">Review import</div><div class="imp-sub">'+esc(doc.name)+' · '+(doc.kind==='pnl'?'P&amp;L report':doc.txns.length+' transactions')+(doc.currency?' · '+doc.currency:'')+'</div></div><button class="imp-x" data-a="close">✕</button></div>';
    if(doc.notes.length) h+='<div class="imp-note">'+doc.notes.map(esc).join('<br>')+'</div>';
    if(doc.kind==='pnl'){
      const p=doc.pnl;
      h+='<div class="imp-grid"><label>Revenue</label><b>'+(p.revenue!=null?money(p.revenue,doc.currency):'—')+'</b><label>Expenses</label><b>'+(p.expenses!=null?money(p.expenses,doc.currency):'—')+'</b><label>Net profit</label><b>'+money(p.net,doc.currency)+'</b></div>' +
         '<div class="imp-row"><label>Use net profit as</label><select id="impPnlTarget"><option value="biz">US company cash flow / month (USD)</option><option value="draw">Income drawn to personal (PLN)</option><option value="">— nothing, just looking —</option></select></div>';
    } else {
      h+='<div class="imp-row"><label>Ending balance</label><input type="number" id="impBal" step="0.01" value="'+(doc.endingBalance!=null?doc.endingBalance:'')+'" placeholder="not found in file"> <span class="imp-cur">'+esc(doc.currency)+'</span><label style="margin-left:14px">→ update</label><select id="impTarget">'+tOpts+'</select></div>';
      if(doc.txns.length){
        h+='<div class="imp-row"><label>Month for cash flow</label><select id="impMonth">'+monthOpts+'</select><label style="margin-left:14px"><input type="checkbox" id="impApplyFlow" checked> Update monthly cash flow from these categories</label></div>';
        h+='<div class="imp-totals" id="impTotals"></div>';
        h+='<div class="imp-tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th><th>Category</th></tr></thead><tbody>';
        doc.txns.forEach((t,i)=>{ h+='<tr data-i="'+i+'"><td>'+t.date+'</td><td class="d" title="'+esc(t.desc)+'">'+esc(t.desc)+'</td><td class="r '+(t.amount<0?'neg':'pos')+'">'+money(t.amount,doc.currency)+'</td><td><select data-i="'+i+'">'+CATS.map(c=>'<option value="'+c.id+'"'+(c.id===t.cat?' selected':'')+'>'+c.name+'</option>').join('')+'</select></td></tr>'; });
        h+='</tbody></table></div>';
      }
    }
    h+='<div class="imp-foot"><span class="imp-hint">Fix any category and I’ll remember it for next time.</span><button class="imp-btn ghost" data-a="close">Cancel</button><button class="imp-btn primary" data-a="apply">Apply to Net worth</button></div></div>';
    wrap.innerHTML=h; document.body.appendChild(wrap);
    const changed={};
    function totals(){ const box=$('impTotals'); if(!box) return; const m=$('impMonth').value; const sums={}; let income=0;
      doc.txns.forEach(t=>{ if(t.date.slice(0,7)!==m) return; if(t.cat==='income'){ income+=t.amount; return; } if(t.cat==='transfer') return; sums[t.cat]=(sums[t.cat]||0)+(t.amount<0?-t.amount:0); });
      box.innerHTML=EXPCATS.map(c=>'<span'+(sums[c]?'':' class="dim"')+'><b>'+catName(c)+'</b> '+money(sums[c]||0,doc.currency)+'</span>').join('')+(income?'<span><b>Income</b> '+money(income,doc.currency)+'</span>':'');
      doc._sums=sums; doc._income=income; }
    wrap.addEventListener('change',e=>{ const s=e.target.closest('select[data-i]'); if(s){ const t=doc.txns[+s.dataset.i]; t.cat=s.value; changed[t.desc]=s.value; } if(e.target.id==='impMonth'||s) totals(); });
    wrap.addEventListener('click',e=>{ const b=e.target.closest('[data-a]'); if(!b) return; if(b.dataset.a==='close'){ wrap.remove(); return; } if(b.dataset.a==='apply'){ apply(doc,changed); wrap.remove(); } });
    totals();
  }

  function apply(doc,changed){
    // remember corrections
    Object.keys(changed).forEach(desc=>{ const kw=learnKey(desc); if(!kw) return; learned=learned.filter(r=>r.kw!==kw); learned.push({kw,cat:changed[desc]}); });
    try{ localStorage.setItem(RULES_KEY,JSON.stringify(learned)); }catch(e){}
    const done=[];
    if(doc.kind==='pnl'){
      const t=$('impPnlTarget').value; if(t&&$(t)){ $(t).value=Math.round(doc.pnl.net); done.push((t==='biz'?'US company cash flow':'Income drawn')+' → '+money(doc.pnl.net,doc.currency)); }
    } else {
      const bal=parseFloat($('impBal').value), tk=$('impTarget').value;
      if(tk&&!isNaN(bal)){ if(tk==='liab'){ $('liab').value=Math.round(Math.abs(bal)); done.push('Owed to company → '+money(bal,doc.currency)); }
        else { const a=assets.find(x=>x.k===tk); if(a){ a.v=Math.round(bal*100)/100; const inp=document.querySelector('#assets input[data-ak="'+tk+'"]'); if(inp) inp.value=a.v; done.push(a.name+' → '+money(bal,doc.currency)+(a.cur!==doc.currency?' (note: account is in '+a.cur+')':'')); } } }
      if($('impApplyFlow')&&$('impApplyFlow').checked&&doc._sums){ EXPCATS.forEach(c=>{ if(doc._sums[c]!=null&&$(c)){ $(c).value=Math.round(doc._sums[c]); } });
        const flow=EXPCATS.filter(c=>doc._sums[c]).map(c=>catName(c)+' '+Math.round(doc._sums[c])).join(', '); if(flow) done.push('Cash flow ('+$('impMonth').value+'): '+flow); }
    }
    if(typeof calc==='function') calc(); if(typeof save==='function') save();
    toast(done.length?('Applied: '+done.join(' · ')):'Nothing to apply.');
  }
  function toast(msg){ let t=$('impToast'); if(!t){ t=document.createElement('div'); t.id='impToast'; t.className='imp-toast'; document.body.appendChild(t); } t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),7000); }

  /* ---------- drop zone ---------- */
  function mount(){
    const anchor=$('assets'); if(!anchor) return; const card=anchor.closest('.card'); if(!card) return;
    const z=document.createElement('div'); z.className='card full imp-zone-card';
    z.innerHTML='<h2>Import statements</h2><div class="imp-zone" id="impZone"><div class="imp-zone-in"><div class="imp-ico">⬇</div><div><b>Drop bank, card or company reports here</b><div class="imp-zone-sub">CSV / XLSX exports (mBank, PKO, ING, Millennium, Chase, Amex, Mercury…), PDF statements, P&amp;L reports · or <span class="imp-link">choose files</span></div></div></div><input type="file" id="impFile" multiple accept=".csv,.txt,.tsv,.xlsx,.xls,.pdf" hidden></div><div class="imp-status" id="impStatus"></div>';
    card.after(z);
    const zone=$('impZone'), inp=$('impFile');
    ['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{ e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{ e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop',e=>handle(e.dataTransfer.files));
    zone.addEventListener('click',()=>inp.click());
    inp.addEventListener('change',()=>{ handle(inp.files); inp.value=''; });
    // whole-page drop too
    document.addEventListener('dragover',e=>{ if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    document.addEventListener('drop',e=>{ if(zone.contains(e.target)) return; if(e.dataTransfer&&e.dataTransfer.files.length){ e.preventDefault(); handle(e.dataTransfer.files); } });
  }
  const queue=[];
  async function handle(files){
    const st=$('impStatus'); for(const f of files) queue.push(f);
    while(queue.length){ const f=queue.shift(); st.textContent='Reading '+f.name+'…';
      try{ const doc=await parseFile(f); st.textContent=''; review(doc); await new Promise(res=>{ const iv=setInterval(()=>{ if(!$('impReview')){ clearInterval(iv); res(); } },200); }); }
      catch(err){ st.textContent='Could not read '+f.name+': '+(err&&err.message||err); console.warn(err); } }
  }
  window.apexImport={ parseFile, categorize, rowsToDoc, linesToDoc, review };   // for testing
  const css=document.createElement('style'); css.textContent=`
  .imp-zone{border:2px dashed #d9d2c2;border-radius:12px;padding:18px;cursor:pointer;transition:all .15s;background:#fbf9f4}
  .imp-zone:hover,.imp-zone.over{border-color:#a9741f;background:#fff7e6}
  .imp-zone-in{display:flex;gap:14px;align-items:center;font-size:14px}
  .imp-ico{font-size:22px;width:40px;height:40px;border-radius:10px;background:#f3efe4;display:flex;align-items:center;justify-content:center;color:#a9741f}
  .imp-zone-sub{font-size:12px;color:#8c8474;margin-top:3px} .imp-link{color:#a9741f;text-decoration:underline}
  .imp-status{font-size:12px;color:#8c8474;margin-top:8px;min-height:14px}
  .imp-overlay{position:fixed;inset:0;z-index:97;background:rgba(30,28,22,.4);display:flex;align-items:center;justify-content:center;padding:18px}
  .imp-card{background:#fff;border-radius:16px;width:100%;max-width:860px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.35);color:#2b2a26;font-size:13px}
  .imp-head{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 20px 10px;border-bottom:1px solid #eee6d6}
  .imp-title{font-size:17px;font-weight:700} .imp-sub{font-size:12px;color:#8c8474;margin-top:2px}
  .imp-x{background:transparent;border:none;font-size:16px;color:#9aa1ad;cursor:pointer;padding:4px 8px;border-radius:6px} .imp-x:hover{background:#f3efe4;color:#2b2a26}
  .imp-note{margin:10px 20px 0;background:#fff7e6;border:1px solid #f0dfb3;color:#8a5a0f;border-radius:8px;padding:8px 12px;font-size:12px}
  .imp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 20px 0}
  .imp-row label{color:#6f6858;font-size:12px} .imp-row input[type=number]{width:140px;padding:6px 8px;border:1px solid #e0dacb;border-radius:8px;font:inherit}
  .imp-row select,.imp-tbl select{padding:5px 8px;border:1px solid #e0dacb;border-radius:8px;font:inherit;background:#fff;max-width:280px}
  .imp-cur{font-weight:600;color:#8c8474}
  .imp-grid{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;padding:14px 20px 4px;font-size:14px} .imp-grid label{color:#6f6858}
  .imp-totals{display:flex;gap:8px;flex-wrap:wrap;padding:10px 20px 4px} .imp-totals span{background:#f3efe4;border-radius:20px;padding:4px 11px;font-size:12px} .imp-totals span.dim{opacity:.45} .imp-totals b{color:#2b2a26;margin-right:4px}
  .imp-tbl{overflow:auto;margin:10px 20px 0;border:1px solid #eee6d6;border-radius:10px;flex:1;min-height:0}
  .imp-tbl table{width:100%;border-collapse:collapse} .imp-tbl th{position:sticky;top:0;background:#f3efe4;text-align:left;padding:7px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8c8474}
  .imp-tbl td{padding:6px 10px;border-top:1px solid #f3eee2;vertical-align:middle;white-space:nowrap} .imp-tbl td.d{white-space:normal;max-width:360px} .imp-tbl .r{text-align:right;font-variant-numeric:tabular-nums} .imp-tbl .neg{color:#c1362c} .imp-tbl .pos{color:#12855a}
  .imp-foot{display:flex;align-items:center;gap:8px;padding:14px 20px;border-top:1px solid #eee6d6;margin-top:10px} .imp-hint{flex:1;font-size:12px;color:#8c8474}
  .imp-btn{border:none;border-radius:9px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer} .imp-btn.primary{background:#a9741f;color:#fff} .imp-btn.primary:hover{background:#946417} .imp-btn.ghost{background:#f3efe4;color:#2b2a26}
  .imp-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);z-index:98;background:#2b2a26;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;max-width:90vw;opacity:0;pointer-events:none;transition:all .2s;box-shadow:0 8px 24px rgba(0,0,0,.25)} .imp-toast.show{opacity:1;transform:translate(-50%,0)}
  @media (max-width:640px){ .imp-tbl td.d{max-width:160px} }`;
  document.head.appendChild(css);
  if(document.readyState!=='loading') mount(); else document.addEventListener('DOMContentLoaded',mount);
})();
