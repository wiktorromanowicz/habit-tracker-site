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
function guessCat(text,rules){ rules=rules||{};
  const t=(text||'').trim().toLowerCase(); if(!t) return null;
  if(rules[t]) return rules[t];
  let best=null,bl=0; for(const k in rules){ if(k.length>bl && k.length>=3 && t.includes(k)){ best=rules[k]; bl=k.length; } }
  if(best) return best;
  const score={}; for(const c of PRIORITY){ score[c]=0; for(const w of LEX[c]){ if(t.includes(w)) score[c]+=w.length>=6?2:1; } }
  // "video editing" beats generic "working"; "watching youtube" is waste, "youtube video" is content
  if(score.waste&&score.content&&/watch/.test(t)) score.content=0;
  let top=null,ts=0; for(const c of PRIORITY){ if(score[c]>ts){ ts=score[c]; top=c; } }
  return top;
}

window.ApexTime={CATS,LEGACY,LEX,guessCat};
})();

/* ---- Fill the Time grid from Google Calendar (own calendars only) ----
   Shared by Time and Today. Never overwrites a slot that already has text;
   auto-filled slots are marked {a:1} so they can be refreshed later.
   opts: {from:Date, to:Date, onlyPast:bool}  →  {filled, kept, events} */
(function(){
  const START=5*60, STEP=30, ROWS=36, KEY='apexTime';
  const ls=(k,d)=>{ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } };
  const pad=n=>String(n).padStart(2,'0');
  const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const mondayOf=d=>{ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; };

  async function fillFromCalendar(opts){
    opts=opts||{};
    const out={filled:0,kept:0,events:0,ok:false,reason:''};
    const tok=ls('apexGTok',null);
    if(!tok||!tok.t||!(tok.e>Date.now())){ out.reason='no-token'; return out; }
    const cache=ls('apexCal',{calendars:[]}), prefs=ls('apexCalPrefs',{hidden:{}});
    const mine=c=>!(prefs.hidden&&prefs.hidden[c.id]) && (c.primary || !(/@/.test(c.id) && !/group\.calendar\.google\.com$|holiday|import\.calendar/.test(c.id)));
    const cals=(cache.calendars||[]).filter(mine);
    if(!cals.length){ out.reason='no-calendars'; return out; }
    const from=opts.from||new Date(new Date().setHours(0,0,0,0));
    const to=opts.to||new Date(from.getTime()+24*3600*1000);
    const evs=[];
    await Promise.all(cals.map(async c=>{
      try{
        const q='?singleEvents=true&orderBy=startTime&maxResults=250&timeMin='+encodeURIComponent(from.toISOString())+'&timeMax='+encodeURIComponent(to.toISOString());
        const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(c.id)+'/events'+q,{headers:{Authorization:'Bearer '+tok.t}});
        if(!r.ok) return;
        const j=await r.json();
        (j.items||[]).forEach(ev=>{
          if(ev.status==='cancelled'||!ev.start||!ev.start.dateTime) return;              // skip all-day (incl. the brief carrier)
          if(/^executive summary/i.test(ev.summary||'')) return;
          const me=(ev.attendees||[]).find(a=>a.self);
          if(me&&me.responseStatus==='declined') return;                                   // you said no → not your time
          evs.push({t:ev.summary||'(no title)', s:new Date(ev.start.dateTime), e:new Date(ev.end.dateTime)});
        });
      }catch(err){}
    }));
    out.ok=true; out.events=evs.length;
    if(!evs.length) return out;
    const S=ls(KEY,{weeks:{},rules:{}}); S.weeks=S.weeks||{}; S.rules=S.rules||{};
    const cutoff=opts.onlyPast===false?Infinity:Date.now();
    evs.forEach(ev=>{
      const wkKey=iso(mondayOf(ev.s)), w=S.weeks[wkKey]||(S.weeks[wkKey]={});
      const d=(ev.s.getDay()+6)%7;
      const sm=ev.s.getHours()*60+ev.s.getMinutes();
      const em=ev.e.getHours()*60+ev.e.getMinutes()+(ev.e.getDate()!==ev.s.getDate()?24*60:0);
      const r0=Math.max(0,Math.floor((sm-START)/STEP)), r1=Math.min(ROWS,Math.ceil((em-START)/STEP));
      for(let r=r0;r<r1;r++){
        const slotStart=new Date(ev.s); slotStart.setHours(0,0,0,0); slotStart.setMinutes(START+r*STEP);
        if(slotStart.getTime()>cutoff) continue;                                           // don't pre-fill the future
        const k=d+'_'+r, cur=w[k];
        if(cur&&cur.t&&!cur.a){ out.kept++; continue; }                                    // your own entry wins
        if(cur&&cur.t&&cur.a&&cur.t===ev.t) continue;                                      // already auto-filled with this event
        w[k]={t:ev.t,a:1};
        const c=window.ApexTime.guessCat(ev.t,S.rules)||'meet';
        w[k].c=c;
        out.filled++;
      }
    });
    if(out.filled) { try{ localStorage.setItem(KEY,JSON.stringify(S)); }catch(e){} }
    return out;
  }
  window.ApexTime.fillFromCalendar=fillFromCalendar;
})();
