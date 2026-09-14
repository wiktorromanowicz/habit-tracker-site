/* Apex time categories — shared by Time and Today */
(function(){
const CATS=[
  {id:'work',    name:'Work',     color:'#1a4fa3', key:'1'},
  {id:'meet',    name:'Meetings', color:'#7c3aed', key:'2'},
  {id:'content', name:'Content',  color:'#c8850f', key:'3'},
  {id:'life',    name:'Life',     color:'#16a34a', key:'4'},
  {id:'sleep',   name:'Sleep',    color:'#0284c7', key:'5'},
  {id:'waste',   name:'Wasted',   color:'#8a8a8a', key:'6'},
];
const LEGACY={admin:'work',gym:'life',rest:'life',personal:'life'};
const LEX={
  sleep:  ['sleep','sleeping','nap','asleep','in bed','bed'],
  waste:  ['wast','scroll','doomscroll','tiktok','instagram','reels','netflix','procrast','nothing','watching youtube','youtube shorts','phone','browsing','random','distracted','twitter','x feed'],
  meet:   ['talk','talking','call','meeting','sync','1:1','1-1','standup','stand-up','interview','zoom','google meet','discussion','onboarding call','coaching','with the team','csm team','ftf team','q&a','demo','sales call','client call','catch up','catching up','chat with'],
  content:['content','video','script','research','writing','write','editing','edit','post','youtube','thumbnail','film','filming','record','recording','podcast','newsletter','blog','tweet','hook','title','outline','b-roll','shooting','skool post','carousel'],
  work:   ['working','work','build','building','coding','dev','apex','design','funnel','ads','campaign','planning','plan','strategy','review','analysis','analys','sop','hiring','recruit','cfo','finance','emails','email','messages','dms','slack','admin','invoice','organiz','responding','outreach','sales','offer','proposal','deck','spreadsheet','notion','crm','pipeline','context switching','deep work','focus'],
  life:   ['wake','waking','morning routine','routine','eating','eat','lunch','dinner','breakfast','coffee','break','coming back','commute','preparing','prepare','shower','gym','workout','training','run','running','walk','lift','stretch','sauna','family','friends','date','partner','home','travel','driving','shopping','groceries','cleaning','cooking','reading','relax','chill','doctor','errand','church','massage','haircut','nap','rest'],
};
const PRIORITY=['sleep','waste','meet','content','work','life'];
// short words must match whole words, so "Board Seat Inquiry" isn't "eat" → Life
const RX={};
function hit(t,w){
  if(w.length>4||/[^a-z]/.test(w)) return t.includes(w);
  const r=RX[w]||(RX[w]=new RegExp('\\b'+w+'\\b'));
  return r.test(t);
}
function guessCat(text,rules){ rules=rules||{};
  const t=(text||'').trim().toLowerCase(); if(!t) return null;
  if(rules[t]) return rules[t];
  let best=null,bl=0; for(const k in rules){ if(k.length>bl && k.length>=3 && t.includes(k)){ best=rules[k]; bl=k.length; } }
  if(best) return best;
  const score={}; for(const c of PRIORITY){ score[c]=0; for(const w of LEX[c]){ if(hit(t,w)) score[c]+=w.length>=6?2:1; } }
  // "video editing" beats generic "working"; "watching youtube" is waste, "youtube video" is content
  if(score.waste&&score.content&&/watch/.test(t)) score.content=0;
  let top=null,ts=0; for(const c of PRIORITY){ if(score[c]>ts){ ts=score[c]; top=c; } }
  return top;
}

window.ApexTime={CATS,LEGACY,LEX,guessCat};
})();

/* ---- Fill the Time grid from Google Calendar (own calendars only) ----
   Shared by Time and Today. Two sources, in order:
     1. the event cache the Calendar tab keeps in `apexCal` — works with no token and no network
     2. a live fetch, when the Google token is still valid (more up to date)
   Never overwrites a slot you typed yourself; auto-filled slots are marked {a:1}.
   opts: {from:Date, to:Date, onlyPast:bool}  →  {filled, kept, events, ok, source, reason} */
(function(){
  const START=5*60, STEP=30, ROWS=36, KEY='apexTime';
  const ls=(k,d)=>{ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } };
  const pad=n=>String(n).padStart(2,'0');
  const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const mondayOf=d=>{ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; };
  const isMine=(c,prefs)=>!(prefs.hidden&&prefs.hidden[c.id]) && (c.primary || !(/@/.test(c.id) && !/group\.calendar\.google\.com$|holiday|import\.calendar/.test(c.id)));
  const usable=ev=>ev && !ev.allDay && ev.start && ev.end && !/^executive summary/i.test(ev.title||ev.t||'') && ev.status!=='declined';

  /* events the Calendar tab has already cached, for any range overlapping [from,to) */
  function cachedEvents(from,to){
    const cache=ls('apexCal',{calendars:[],events:{}}), prefs=ls('apexCalPrefs',{hidden:{}});
    const cals=(cache.calendars||[]).filter(c=>isMine(c,prefs));
    if(!cals.length) return null;                                  // Calendar tab never opened → nothing to go on
    const mineIds={}; cals.forEach(c=>mineIds[c.id]=1);
    const seen={}, out=[];
    Object.keys(cache.events||{}).forEach(k=>{
      (cache.events[k]||[]).forEach(ev=>{
        if(!usable(ev)) return;
        if(ev.calId && !mineIds[ev.calId]) return;
        const s=new Date(ev.start), e=new Date(ev.end);
        if(!(s>=from && s<to)) return;
        const id=(ev.id||ev.title)+'@'+s.getTime(); if(seen[id]) return; seen[id]=1;
        out.push({t:ev.title||'(no title)', s, e});
      });
    });
    return out;
  }

  async function liveEvents(from,to){
    const tok=ls('apexGTok',null);
    if(!tok||!tok.t||!(tok.e>Date.now())) return null;
    const cache=ls('apexCal',{calendars:[]}), prefs=ls('apexCalPrefs',{hidden:{}});
    const cals=(cache.calendars||[]).filter(c=>isMine(c,prefs));
    if(!cals.length) return null;
    const out=[]; let anyOk=false;
    await Promise.all(cals.map(async c=>{
      try{
        const q='?singleEvents=true&orderBy=startTime&maxResults=250&timeMin='+encodeURIComponent(from.toISOString())+'&timeMax='+encodeURIComponent(to.toISOString());
        const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(c.id)+'/events'+q,{headers:{Authorization:'Bearer '+tok.t}});
        if(!r.ok) return;
        anyOk=true;
        const j=await r.json();
        (j.items||[]).forEach(ev=>{
          if(ev.status==='cancelled'||!ev.start||!ev.start.dateTime) return;
          if(/^executive summary/i.test(ev.summary||'')) return;
          const me=(ev.attendees||[]).find(a=>a.self);
          if(me&&me.responseStatus==='declined') return;
          out.push({t:ev.summary||'(no title)', s:new Date(ev.start.dateTime), e:new Date(ev.end.dateTime)});
        });
      }catch(err){}
    }));
    return anyOk?out:null;
  }

  function write(evs,onlyPast){
    const res={filled:0,kept:0};
    const S=ls(KEY,{weeks:{},rules:{}}); S.weeks=S.weeks||{}; S.rules=S.rules||{};
    const cutoff=onlyPast===false?Infinity:Date.now();
    evs.forEach(ev=>{
      const wkKey=iso(mondayOf(ev.s)), w=S.weeks[wkKey]||(S.weeks[wkKey]={});
      const d=(ev.s.getDay()+6)%7;
      const sm=ev.s.getHours()*60+ev.s.getMinutes();
      const em=ev.e.getHours()*60+ev.e.getMinutes()+(ev.e.getDate()!==ev.s.getDate()?24*60:0);
      const r0=Math.max(0,Math.floor((sm-START)/STEP)), r1=Math.min(ROWS,Math.max(r0+1,Math.ceil((em-START)/STEP)));
      for(let r=r0;r<r1;r++){
        const slotStart=new Date(ev.s); slotStart.setHours(0,0,0,0); slotStart.setMinutes(START+r*STEP);
        if(slotStart.getTime()>cutoff) continue;                   // don't pre-fill slots that haven't started
        const k=d+'_'+r, cur=w[k];
        if(cur&&cur.t&&!cur.a){ res.kept++; continue; }             // your own entry always wins
        if(cur&&cur.t&&cur.a&&cur.t===ev.t) continue;
        w[k]={t:ev.t, a:1};
        w[k].c=window.ApexTime.guessCat(ev.t,S.rules)||'meet';
        res.filled++;
      }
    });
    if(res.filled){ try{ localStorage.setItem(KEY,JSON.stringify(S)); }catch(e){} }
    return res;
  }

  // don't write before the cloud copy has landed, or a stale slot could overwrite what you typed elsewhere
  async function syncSettled(){
    try{
      const t0=Date.now();                                        // sync.js is injected by pwa.js, so wait for it to appear
      while(!window.apexSyncReady && Date.now()-t0<3000) await new Promise(r=>setTimeout(r,100));
      if(window.apexSyncReady) await Promise.race([window.apexSyncReady, new Promise(r=>setTimeout(r,6000))]);
    }catch(e){}
  }

  async function fillFromCalendar(opts){
    opts=opts||{};
    await syncSettled();
    const from=opts.from||new Date(new Date().setHours(0,0,0,0));
    const to=opts.to||new Date(from.getTime()+864e5);
    const out={filled:0,kept:0,events:0,ok:false,source:'',reason:''};
    let evs=await liveEvents(from,to);
    if(evs){ out.source='google'; }
    else { evs=cachedEvents(from,to); if(evs) out.source='cache'; }
    if(!evs){ out.reason=ls('apexGTok',null)?'no-calendars':'not-connected'; return out; }
    out.ok=true; out.events=evs.length;
    if(evs.length){ const r=write(evs,opts.onlyPast); out.filled=r.filled; out.kept=r.kept; }
    return out;
  }

  window.ApexTime.fillFromCalendar=fillFromCalendar;
})();
