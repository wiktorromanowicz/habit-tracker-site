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
