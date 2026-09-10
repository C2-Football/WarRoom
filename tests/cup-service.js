const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const Cup=require('../js/shared/woeppel-cup.js');
const source=fs.readFileSync('supabase/functions/league-cup/index.ts','utf8').replace(/^import .*;\n/gm,'');
const code=Babel.transform(source,{presets:['typescript'],filename:'cup.ts'}).code;
let handler,owner=true,conflict=false,duplicate=false,record,identity='sleeper',activeSession=true,admin=false;
const query={insert(value){record=value;return this;},update(value){record=value;return this;},eq(){return this;},select(){return this;},async maybeSingle(){return duplicate?{data:null,error:{code:'23505'}}:conflict?{data:null,error:null}:{data:{...record},error:null};}};
const rosters=Array.from({length:64},(_,i)=>({roster_id:i+1}));
const context={WoeppelCup:Cup,Response,console,fetch:async url=>({ok:true,json:async()=>url.endsWith('/users')?[{user_id:'1',is_owner:owner}]:url.endsWith('/rosters')?rosters:{user_id:'1'}}),createClient:()=>({from:()=>query}),verifyJwtPayload:async()=>identity==='none'?null:identity==='oauth'?{sub:'oauth-user',app_metadata:{provider:'google'},user_metadata:{sleeper_username:'tester',user_id:'app-user'}}:{app_metadata:identity==='app'?{user_id:'app-user'}:{sleeper_username:'tester'}},requireActiveAppSession:async()=>activeSession?{userId:'app-user'}:null,hasAdminRole:async()=>admin,Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}}};
vm.runInNewContext(code,context);
const state=Cup.tournament.defaults({rosters:rosters.slice(0,5),settings:{playoff_week_start:15}});
const call=async(s=state,revision=0,action='save')=>{const r=await handler(new Request('http://localhost',{method:'POST',body:JSON.stringify({leagueId:'1234567890123',season:'2026',action,state:s,revision})}));return {status:r.status,body:await r.json()};};
const qualifying=format=>({...state,format,startWeek:1,groupWeeks:format==='round-robin'?5:2,knockoutStart:format==='round-robin'?6:3});
const direct=n=>({...state,format:'knockout',teams:rosters.slice(0,n).map(r=>String(r.roster_id)),startWeek:1,knockoutStart:1,groupWeeks:0,qualifierCount:n});
const survivor={...state,format:'survivor',startWeek:1,knockoutStart:1,groupWeeks:3,qualifierCount:1};
const scores=Object.fromEntries(state.teams.map(id=>[id,10]));
(async()=>{
 for(const format of ['points','round-robin','all-play','median']){const result=await call(qualifying(format));assert.equal(result.status,200,format+': '+JSON.stringify(result.body));}
 for(const n of [2,3,5,12,64]){const result=await call(direct(n));assert.equal(result.status,200,'knockout '+n+': '+JSON.stringify(result.body));}
 assert.equal((await call(survivor)).status,200);
 assert.equal(record.state.name,'League Cup');
 owner=false;assert.equal((await call()).status,403);assert.equal((await call(state,0,'load')).body.canManage,false);owner=true;
 identity='none';assert.equal((await call()).status,401);
 identity='oauth';assert.equal((await call()).status,401,'Client-editable profile metadata cannot grant commissioner identity');
 identity='app';activeSession=false;assert.equal((await call()).status,401);
 activeSession=true;assert.equal((await call()).status,403);admin=true;assert.equal((await call()).status,200);admin=false;identity='sleeper';
 for(const invalid of [
  {...state,format:'made-up'}, {...state,teams:['1','1']}, {...state,teams:['1','90']}, {...state,knockoutStart:18},
  {...state,weeks:{1:{scores:{},final:true}}}, {...state,weeks:{[state.startWeek]:{scores:{'1':10},final:true}}},
  {...state,weeks:{[state.startWeek]:{scores:{'90':10},final:false}}}, {...state,weeks:{[state.startWeek]:{scores:[],final:false}}},
  {...state,weeks:{['0'+state.startWeek]:{scores,final:false}}}, {...state,weeks:{[state.startWeek]:{scores:{'1':'10'},final:false}}},
  {...state,seedRuling:{reason:'',ids:['1','2','3','4']}}, {...state,seedRuling:{reason:'Evidence',ids:['1','2','3','90']}},
  {...state,tieRulings:[]}, {...state,tieRulings:{garbage:{winner:'1',reason:'Evidence'}}},
  {...state,tieRulings:{[state.knockoutStart+':1:2']:{winner:'3',reason:'Evidence'}}},
  {...state,tieRulings:{[state.startWeek+':1:2']:{winner:'1',reason:'Evidence'}}},
  {...state,tieRulings:{[state.knockoutStart+':1:2']:{winner:'1',reason:' '.repeat(4)}}},
  {...state,survivorRulings:{1:{ids:['1'],reason:'Evidence'}}},
  {...survivor,survivorRulings:[]}, {...survivor,survivorRulings:{19:{ids:['1'],reason:'Evidence'}}},
  {...survivor,survivorRulings:{1:{ids:['1','1'],reason:'Evidence'}}}, {...survivor,survivorRulings:{1:{ids:['90'],reason:'Evidence'}}},
  {...survivor,survivorRulings:{1:{ids:['1'],reason:''}}}, {...survivor,survivorRulings:{1:{ids:['1'],reason:'x'.repeat(1001)}}},
  {...survivor,seedRuling:{ids:['1'],reason:'Evidence'}}
 ]){const response=await call(invalid);assert.equal(response.status,400,'invalid state accepted: '+JSON.stringify(invalid)+' '+JSON.stringify(response.body));}
 // A finalized qualifying or survival week may legitimately await a ruling.
 const tiedQualifying={...qualifying('all-play'),weeks:{1:{scores,final:true},2:{scores,final:true}}};
 assert.equal((await call(tiedQualifying)).status,200,'Unresolved qualifying tie must save');
 const tiedSurvivor={...survivor,weeks:{1:{scores,final:true}}};
 assert.equal((await call(tiedSurvivor)).status,200,'Unresolved survivor cutoff must save');
 const ruledSurvivor={...tiedSurvivor,survivorRulings:{1:{ids:['1','2','3'],reason:'Agreed tie-break evidence'}}};
 assert.equal((await call(ruledSurvivor)).status,200,'Valid survivor ruling must save');
 assert.equal((await call({...tiedSurvivor,survivorRulings:{1:{ids:['1'],reason:'Wrong survivor count'}}})).status,400);
 const rankedSurvivor={...survivor,weeks:{1:{scores:{'1':50,'2':40,'3':30,'4':20,'5':10},final:true}},survivorRulings:{1:{ids:['1','2','5'],reason:'Cannot advance below cutoff'}}};
 assert.equal((await call(rankedSurvivor)).status,400,'Ruling cannot override scores outside a tied cutoff');
 const directFive=direct(5),contested=Cup.tournament.bracket(directFive).filter(pair=>pair[0]&&pair[1]).flat();
 const firstRoundScores=Object.fromEntries(contested.map(id=>[id,10]));
 assert.equal((await call({...directFive,weeks:{1:{scores:firstRoundScores,final:true}}})).status,200,'Bye recipients need no scores; unresolved contested ties save');
 assert.equal((await call({...directFive,weeks:{1:{scores:{},final:true}}})).status,400,'Contested knockout teams require scores');
 assert.equal((await call({...ruledSurvivor,weeks:{...ruledSurvivor.weeks,2:{scores:{'1':30,'2':20,'3':10},final:true}}})).status,200,'Eliminated survivor teams need no later scores');
 assert.equal((await call({...ruledSurvivor,weeks:{...ruledSurvivor.weeks,2:{scores:{'1':30,'2':20},final:true}}})).status,400,'Active survivor team cannot lack final score');
 assert.equal((await call(state,-1)).status,400);assert.equal((await call(state,'1')).status,400);
 conflict=true;assert.equal((await call(state,1)).status,409);conflict=false;
 duplicate=true;assert.equal((await call(state,0)).status,409);duplicate=false;
 console.log('Cup service: six formats, byes, permissions, scores, rulings, pending ties and revision conflicts passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
