'use strict';
// Offline multiplayer contract coverage. PGlite serializes one connection;
// concurrent submissions prove CAS outcomes, not production connection load.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),Legacy=require('../js/duat/campaign.js');
const ids=require('../js/duat/world.js').FACTIONS.slice(0,8).map(f=>f.id);
const allYears=Array.from({length:24},(_,i)=>2025-i);
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(input={}){
 const selected=input.factionIds||ids,humans=input.humanFactionIds||selected.slice(0,2),host=input.hostFactionId||selected[0];
 return {version:4,expansionVersion:1,calendarVersion:2,id:input.id||'dynasty-fixture',name:input.name||'Sourcebook online',seed:input.seed||'secret-seed',createdAt:input.createdAt||'2026-09-08T12:00:00Z',updatedAt:input.createdAt||'2026-09-08T12:00:00Z',phase:'draft',week:1,seasons:input.seasons||[2020,2019],settings:{...Legacy.normalizeSettings({leagueSize:8,mummyCount:2}),...input.settings},scoring:input.scoring||Legacy.SCORING,expansionSettings:input.expansionSettings||{conquest:'original',world:'provinces',heptad:true},dynastySeason:1,dynasty:{cycle:1,seasons:[],retiredRulers:[],journal:[],honors:{}},hostFactionId:host,humanFactionIds:humans,factions:selected.map(id=>({id,name:id,armies:[{id:id+':2020',players:[{id:'sealed-'+id,name:'Hidden ruler player '+id}]}],lineup:[],rituals:{ledger:[],pendingMahdi:null}})),draft:{status:'waiting',cursor:0,totalPicks:2,order:selected,queue:[{factionId:selected[1],armyId:selected[1]+':2020'},{factionId:selected[0],armyId:selected[0]+':2020'}],picks:[]},archaeology:{order:selected,revealedFactionIds:[]},completedWeeks:[],conquest:{pendingClaims:{}}};
}
(async()=>{
 const db=new PGlite();let passed=0,serial=0;
 const check=async(name,run)=>{await run();console.log('ok '+(++passed)+' - '+name);};
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
  await db.exec("create role anon;create role authenticated;create role service_role;create table app_users(id uuid primary key);create function gen_random_bytes(n integer) returns bytea language sql as $$select substring(decode(repeat(md5(random()::text),n),'hex') from 1 for n)$$;");
  for(const name of ['20260908160000_duat_campaigns.sql','20260908180000_duat_draft_campaigns.sql','20260908210000_duat_campaign_settings.sql','20260908230000_duat_dynasties.sql']){const sql=fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');await db.exec(sql);await db.exec(sql);}
  const users=(await query('insert into app_users select gen_random_uuid() from generate_series(1,5) returning id')).map(r=>r.id);
  const create=async(input={})=>(await query('select create_duat_campaign($1,$2) id',[users[0],fixture(input)]))[0].id;
  const row=async id=>(await query('select * from duat_campaigns where id=$1',[id]))[0];
  const seats=id=>query('select * from duat_campaign_members where room_id=$1 order by faction_id',[id]);
  const write=async(id,state)=>query('update duat_campaigns set state=$2 where id=$1',[id,state]);
  const commit=async(id,user,revision,actionId,action,next=null)=>(await query('select commit_duat_campaign_action($1,$2,$3,$4,$5,$6) result',[user,id,revision,actionId,action,next]))[0].result;
  const claim=async(user,code)=>(await query('select claim_duat_campaign_invite($1,$2) id',[user,code]))[0].id;
  const joined=async()=>{const id=await create(),seat=(await seats(id)).find(s=>s.faction_id===ids[1]);await claim(users[1],seat.invite_code);return id;};
  const readyAll=async id=>{for(const user of users.slice(0,2))await commit(id,user,(await row(id)).revision,'ready-'+serial++,{type:'set-ready',ready:true});};

  await check('v4 migration replays and creates configured private factions without upgrading old contracts',async()=>{
   const id=await create();assert.equal((await seats(id)).length,2);assert.equal((await row(id)).state.version,4);
   await assert.rejects(()=>query('select create_duat_campaign($1,$2)',[users[0],{...fixture(),expansionVersion:2}]),/sourcebook/);
   await assert.rejects(()=>query('select create_duat_campaign($1,$2)',[users[0],{...fixture(),dynastySeason:2}]),/sourcebook/);
   const legacyIds=require('../js/duat/rules.js').FACTIONS.map(f=>f.id),old={...fixture(),version:1,phase:'preseason',hostFactionId:legacyIds[0],humanFactionIds:[legacyIds[0]],factions:legacyIds.map(id=>({id}))};
   assert.ok((await query('select create_duat_campaign($1,$2) id',[users[0],old]))[0].id);
  });
  await check('v4 draft authority follows its explicit queue and simultaneous picks have one winner',async()=>{
   const id=await joined(),before=await row(id),state={...before.state,draft:{...before.state.draft,status:'active'}};await write(id,state);
   const next={...state,draft:{...state.draft,cursor:1,picks:[{factionId:ids[1],playerId:'recruit'}]}};
   await assert.rejects(()=>commit(id,users[0],before.revision,'wrong-turn',{type:'draft-pick',playerId:'recruit'},next),/Wait for your faction/);
   const intent={type:'draft-pick',factionId:ids[1],playerId:'recruit'};
   const outcomes=await Promise.all([commit(id,users[1],before.revision,'pick-a',intent,next),commit(id,users[1],before.revision,'pick-b',intent,next)]);
   assert.equal(outcomes.filter(r=>r.ok).length,1);assert.equal(outcomes.filter(r=>r.conflict).length,1);
   assert.equal((await commit(id,users[1],before.revision,'pick-a',intent,next)).deduplicated,true);
   await assert.rejects(async()=>commit(id,users[1],(await row(id)).revision,'pick-a',{...intent,playerId:'forged'},next),/another intent/);
  });
  await check('pending Mahdi recruits block readiness and host progress atomically',async()=>{
   const id=await joined(),state=(await row(id)).state;state.phase='season';state.week=5;state.factions[0].rituals.pendingMahdi={player:{name:'Waiting recruit'}};await write(id,state);
   await assert.rejects(async()=>commit(id,users[0],(await row(id)).revision,'pending-ready',{type:'set-ready',ready:true}),/waiting Mahdi/);
   await commit(id,users[0],(await row(id)).revision,'unready',{type:'set-ready',ready:false});
   await query('update duat_campaign_members set ready=true where room_id=$1',[id]);
   await assert.rejects(async()=>commit(id,users[0],(await row(id)).revision,'pending-advance',{type:'advance-week'},{...state,week:6}),/waiting Mahdi/);
  });
  await check('ready factions cannot alter offerings, names, rituals or alliance decisions',async()=>{
   const id=await joined(),state=(await row(id)).state;state.phase='season';await write(id,state);await readyAll(id);
   for(const type of ['set-lineup','declare-favor','clear-favor','name-ruler','name-alliance','ritual','propose-pinnacle','approve-pinnacle','decline-pinnacle'])await assert.rejects(async()=>commit(id,users[0],(await row(id)).revision,'locked-'+type,{type},state),/unready/);
  });
  await check('immutable rules, ownership and cycle reject forged authoritative outputs',async()=>{
   const id=await joined(),state=(await row(id)).state;
   for(const [key,value]of [['seed','forged'],['settings',{leagueSize:16}],['scoring',{passTd:9}],['expansionSettings',{conquest:'off'}],['version',3],['dynastySeason',2],['seasons',[2025]],['hostFactionId',ids[1]]])await assert.rejects(async()=>commit(id,users[0],(await row(id)).revision,'immutable-'+key,{type:'name-ruler'}, {...state,[key]:value}),/authoritative|immutable|cycle|historical years/);
   await assert.rejects(async()=>commit(id,users[0],(await row(id)).revision,'actor',{type:'name-ruler',factionId:ids[1]},state),/own faction/);
  });
  await check('completed dynasties keep champion rituals and claims open, then require host and unanimous readiness',async()=>{
   const id=await joined(),state=(await row(id)).state;state.phase='complete';state.week=18;state.championId=ids[1];await write(id,state);
   await assert.rejects(async()=>commit(id,users[0],(await row(id)).revision,'not-champion',{type:'ritual',ritualId:'plutus'},state),/reigning champion/);
   await commit(id,users[1],(await row(id)).revision,'champion',{type:'ritual',ritualId:'plutus'},state);
   await commit(id,users[0],(await row(id)).revision,'final-claim',{type:'claim',territoryId:'province'},state);
   await assert.rejects(async()=>commit(id,users[0],(await row(id)).revision,'new-too-early',{type:'next-season'},state),/Every human/);
   await readyAll(id);
   const next={...state,phase:'draft',week:1,seasons:[2021,2020,2019],dynastySeason:2,dynasty:{...state.dynasty,cycle:2},draft:{...state.draft,status:'waiting'}};
   await assert.rejects(async()=>commit(id,users[1],(await row(id)).revision,'member-new',{type:'next-season'},next),/host/);
   await assert.rejects(async()=>commit(id,users[0],(await row(id)).revision,'skip-cycle',{type:'next-season'},{...next,dynastySeason:3}),/exactly one/);
   const before=await row(id),outcomes=await Promise.all([commit(id,users[0],before.revision,'new-a',{type:'next-season',season:2021},next),commit(id,users[0],before.revision,'new-b',{type:'next-season',season:2021},next)]);
   assert.equal(outcomes.filter(r=>r.ok).length,1);assert.equal(outcomes.filter(r=>r.conflict).length,1);assert.equal((await row(id)).state.dynastySeason,2);assert.ok((await seats(id)).every(s=>!s.ready));
  });
  await check('only service_role retains access to room mutations and private tables',async()=>{
   for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{for(const table of ['duat_campaigns','duat_campaign_members','duat_campaign_actions'])await assert.rejects(()=>query('select * from '+table),/permission denied/);await assert.rejects(()=>query('select create_duat_campaign($1,$2)',[users[0],fixture()]),/permission denied/);await assert.rejects(()=>query('select commit_duat_campaign_action($1,$2,$3,$4,$5,$6)',[users[0],webcrypto.randomUUID(),1,'no',{type:'set-ready',ready:true},null]),/permission denied/);}finally{await db.exec('reset role');}}
   assert.equal((await query("select has_function_privilege('service_role','public.commit_duat_campaign_action(uuid,uuid,integer,text,jsonb,jsonb)','EXECUTE') yes"))[0].yes,true);
  });

  class Read{
   constructor(table){this.table=table;this.filters=[];}select(fields){this.fields=fields;return this;}eq(key,value){this.filters.push({key,value});return this;}not(key,op,value){assert.equal(op,'is');assert.equal(value,null);this.notNull=key;return this;}maybeSingle(){this.one=true;return this.run();}single(){this.one=true;return this.run();}then(a,b){return this.run().then(a,b);}
   async run(){try{const where=this.filters.map((f,i)=>f.key+'=$'+(i+1));if(this.notNull)where.push(this.notNull+' is not null');const rows=await query('select * from '+this.table+(where.length?' where '+where.join(' and '):''),this.filters.map(f=>f.value));if(this.fields.includes('duat_campaigns('))for(const r of rows)r.duat_campaigns=await row(r.room_id);return{data:this.one?rows[0]||null:rows,error:null};}catch(error){return{data:null,error};}}
  }
  const rpcArgs={create_duat_campaign:['p_user_id','p_state'],claim_duat_campaign_invite:['p_user_id','p_code'],commit_duat_campaign_action:['p_user_id','p_room_id','p_expected_revision','p_action_id','p_action','p_next_state']};
  const admin={from:table=>new Read(table),rpc:async(name,args)=>{try{const values=rpcArgs[name].map(k=>args[k]);return{data:(await query('select '+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') result',values))[0].result,error:null};}catch(error){return{data:null,error};}}};
  const loadedYears=[];let engineCalls=0;
  const engine={...Legacy,expansionOptions:value=>value||{conquest:'original',world:'provinces',heptad:true},createCampaign:fixture,requiredYears:state=>state.seasons,unresolvedClaims:state=>state.actionableClaims||[],draftTurn:state=>state.draft.queue[state.draft.cursor],
   projectCampaign:(state,viewer,data)=>({id:state.id,version:state.version,name:state.name,phase:state.phase,week:state.week,dynastySeason:state.dynastySeason,viewer,ritualCandidates:data?[{id:'safe-candidate',name:'Known prior player'}]:[],nextSeasonYears:state.phase==='complete'?data?.years:undefined}),
   applyAction:(state,action)=>{engineCalls++;if(action.type==='next-season')return{...state,phase:'draft',week:1,seasons:[...new Set([...state.seasons,action.season||2021])],dynastySeason:state.dynastySeason+1,dynasty:{...state.dynasty,cycle:state.dynastySeason+1},draft:{...state.draft,status:'waiting'}};if(action.type==='claim'||action.type==='attack')return{...state,actionableClaims:[]};return copy(state);}};
  const sandbox={Request,Response,URL,crypto:webcrypto,console,createClient:()=>admin,handleOptions:()=>null,json:(_req,body,status=200)=>new Response(JSON.stringify(body),{status}),requireActiveAppSession:async(_db,req)=>req.headers.get('x-test-user')?{userId:req.headers.get('x-test-user')}:null,availableSeasons:allYears,loadData:async years=>{loadedYears.push(years);return{years};},App:{DuatRules:require('../js/duat/rules.js'),DuatWorld:require('../js/duat/world.js'),DuatCampaign:engine},Deno:{env:{get:()=>''},serve:fn=>sandbox.handler=fn}};
  let source=fs.readFileSync(path.join(root,'supabase/functions/duat/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');source=require('@babel/standalone').transform(source,{filename:'duat.ts',presets:['typescript']}).code;vm.runInNewContext(source,sandbox);
  const api=async(user,body)=>{const response=await sandbox.handler(new Request('https://qa.invalid/duat',{method:'POST',headers:user?{'x-test-user':user}:{},body:JSON.stringify(body)}));return{status:response.status,...await response.json()};};
  const load=async(id,user=users[0])=>(await api(user,{op:'load',roomId:id})).room;
  const action=async(id,user,intent,extra={})=>{const fresh=await load(id,user);return api(user,{op:'action',roomId:id,expectedRevision:fresh.revision,actionId:'api-'+serial++,action:intent,...extra});};
  let apiId;
  await check('actual Edge handler accepts sourcebook setup and rejects outcome/control injection before engine calls',async()=>{
   assert.equal((await api(null,{op:'list'})).status,401);
   const input={version:4,name:'API dynasty',seasons:[2020,2019],settings:{leagueSize:8,mummyCount:2},hostFactionId:ids[0],humanFactionIds:ids.slice(0,2),factionIds:ids,expansionSettings:{conquest:'original',world:'provinces',heptad:true}};
   const made=await api(users[0],{op:'create',input});assert.equal(made.ok,true,made.error);apiId=made.room.id;assert.equal(made.room.campaign.version,4);assert.equal(JSON.stringify(made).includes('secret-seed'),false);assert.equal(JSON.stringify(made).includes('Hidden ruler'),false);
   assert.equal((await api(users[0],{op:'create',input:{...input,seed:'chosen-random'}})).ok,false);
   const invitation=made.room.seats.find(s=>s.factionId===ids[1]).inviteCode;assert.equal((await api(users[1],{op:'claim',code:invitation})).ok,true);
   const before=engineCalls;
   for(const intent of [{type:'ritual',ritualId:'mahdi',roll:20},{type:'ritual',ritualId:'midas',favorBalance:500},{type:'ritual',ritualId:'shiva',confirmed:'yes'},{type:'next-season',season:1900},{type:'name-ruler',name:'x'.repeat(81)},{type:'set-ready',ready:true,nextState:{}}])assert.equal((await action(apiId,users[0],intent)).ok,false);
   assert.equal((await action(apiId,users[1],{type:'name-alliance',name:'Forged',factionId:ids[0]})).status,403);assert.equal(engineCalls,before);
  });
  await check('actual Edge projections load the correct years and keep completed rituals/readiness available',async()=>{
   const state=(await row(apiId)).state;state.phase='season';state.week=5;await write(apiId,state);loadedYears.length=0;
   const room=await load(apiId);assert.equal(room.campaign.ritualCandidates.length,1);assert.deepEqual(loadedYears.at(-1),state.seasons);
   state.phase='complete';state.week=18;state.championId=ids[1];await write(apiId,state);loadedYears.length=0;
   assert.equal((await load(apiId)).campaign.nextSeasonYears.length,24);assert.equal(loadedYears.at(-1).length,24);
   assert.equal((await action(apiId,users[1],{type:'ritual',ritualId:'plutus'})).ok,true);
   assert.equal((await action(apiId,users[0],{type:'ritual',ritualId:'plutus'})).ok,false);
   assert.equal((await action(apiId,users[0],{type:'set-ready',ready:true})).ok,true);assert.equal((await action(apiId,users[1],{type:'set-ready',ready:true})).ok,true);
   assert.equal((await action(apiId,users[1],{type:'next-season',season:2021})).status,403);
   const next=await action(apiId,users[0],{type:'next-season',season:2021});assert.equal(next.ok,true,next.error);assert.equal(next.room.campaign.dynastySeason,2);assert.ok(next.room.seats.filter(s=>s.controller==='human').every(s=>!s.ready));
  });
  await check('actual Edge blocks pending recruits and actionable final claims but allows the last claim',async()=>{
   const state=(await row(apiId)).state;state.phase='complete';state.week=18;state.championId=ids[0];state.factions[0].rituals.pendingMahdi={player:{name:'Secret pending recruit'}};await write(apiId,state);
   assert.equal((await action(apiId,users[0],{type:'set-ready',ready:true})).ok,false);assert.equal(JSON.stringify(await load(apiId,users[1])).includes('Secret pending recruit'),false);
   state.factions[0].rituals.pendingMahdi=null;state.actionableClaims=[ids[0]];await write(apiId,state);assert.equal((await action(apiId,users[0],{type:'set-ready',ready:true})).ok,false);assert.equal((await load(apiId)).canAdvance,false);
   const claimed=await action(apiId,users[0],{type:'claim',territoryId:'province'});assert.equal(claimed.ok,true,claimed.error);assert.equal((await action(apiId,users[0],{type:'set-ready',ready:true})).ok,true);
  });
  await check('generated runtime supports every archive year and actual v4 multiplayer play through annual succession',async()=>{
   require('node:child_process').execFileSync(process.execPath,[path.join(root,'scripts/build-duat-server.cjs')],{cwd:root,stdio:'pipe'});
   const runtime=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(root,'supabase/functions/duat/runtime.js'),'utf8')).toString('base64'));
   assert.equal(runtime.availableSeasons.length,24);
   const archive=await runtime.loadData(runtime.availableSeasons);assert(archive.cards.size>1000);assert(archive.logIndex.size>90000);
   await assert.rejects(()=>runtime.loadData([2025,2025]),/unique complete/);await assert.rejects(()=>runtime.loadData([]),/unique complete/);
   for(const name of ['DuatProvinces','DuatLore','DuatRituals','DuatHeptad'])assert(runtime.App[name],name+' must be bundled');
   sandbox.App=runtime.App;sandbox.loadData=runtime.loadData;sandbox.availableSeasons=runtime.availableSeasons;
   const made=await api(users[0],{op:'create',input:{version:4,name:'Real sourcebook dynasty',seasons:[2025],settings:{leagueSize:8,mummyCount:1,bench:1,conquest:false,favors:true,favorBudget:500},hostFactionId:ids[0],humanFactionIds:ids.slice(0,2),factionIds:ids,expansionSettings:{conquestMode:'original',worldScale:'provinces'}}});
   assert.equal(made.ok,true,made.error);const id=made.room.id;let room=made.room;
   assert.equal(room.campaign.expansionVersion,1);assert.equal(room.campaign.seed,undefined);
   assert.equal((await api(users[1],{op:'claim',code:room.seats.find(s=>s.factionId===ids[1]).inviteCode})).ok,true);
   const must=async(user,intent)=>{const result=await action(id,user,intent);assert.equal(result.ok,true,result.error);return result.room;};
   const ready=async()=>{await must(users[0],{type:'set-ready',ready:true});await must(users[1],{type:'set-ready',ready:true});};
   const draft=async()=>{
    await ready();room=await must(users[0],{type:'start-draft'});let count=0;
    while(room.campaign.phase==='draft'){
     assert(count++<200,'Draft must finish');const turn=room.campaign.draft.turn;const actor=users[ids.indexOf(turn.factionId)];assert(actor,'Turn belongs to a human seat');
     const own=await load(id,actor);assert(own.campaign.draft.candidates.length);
     room=await must(actor,{type:'draft-pick',playerId:own.campaign.draft.candidates[0].id});
    }
    await ready();while(room.campaign.phase==='reveal')room=await must(users[0],{type:'reveal-next'});
   };
   await draft();assert.equal(room.campaign.phase,'season');assert.equal(room.campaign.week,1);
   const walking=room.campaign.factions.find(f=>f.id===ids[0]).activeArmyId;
   room=await must(users[0],{type:'name-ruler',armyId:walking,name:'The River Crown'});assert.equal(room.campaign.factions.find(f=>f.id===ids[0]).armies.find(a=>a.id===walking).rulerName,'The River Crown');
   room=await must(users[0],{type:'ritual',ritualId:'summon-mahdi',position:'WR'});
   assert(room.campaign.factions.find(f=>f.id===ids[0]).rituals.pendingMahdi);
   assert.equal((await load(id,users[1])).campaign.factions.find(f=>f.id===ids[0]).rituals,null);
   assert.equal((await action(id,users[0],{type:'set-ready',ready:true})).ok,false);
   room=await must(users[0],{type:'ritual',ritualId:'mahdi-decline'});
   while(room.campaign.phase==='season'){
    if(room.campaign.week===5){
     const own=await load(id),starter=own.campaign.factions.find(f=>f.id===ids[0]).lineup[0];
     await must(users[0],{type:'declare-favor',playerId:starter,favorId:'kratos-1'});
     await must(users[0],{type:'clear-favor',playerId:starter});
     await must(users[0],{type:'declare-favor',playerId:starter,favorId:'kratos-1'});
    }
    await ready();room=await must(users[0],{type:'advance-week'});
   }
   assert.equal(room.campaign.completedWeeks.length,17);assert.equal(room.campaign.dynastySeason,1);assert(room.campaign.nextSeasonYears.length>0);
   assert.equal(room.campaign.completedWeeks.find(w=>w.week===5).factions.find(f=>f.factionId===ids[0]).favorCost,10);
   const nextYear=room.campaign.nextSeasonYears[0];await ready();room=await must(users[0],{type:'next-season',season:nextYear});
   assert.equal(room.campaign.dynastySeason,2);assert.equal(room.campaign.phase,'draft');assert(room.seats.filter(s=>s.controller==='human').every(s=>!s.ready));
   assert(runtime.App.DuatCampaign.validateCampaign((await row(id)).state));
   await draft();assert.equal(room.campaign.week,1);assert.equal(room.campaign.dynastySeason,2);
   assert(runtime.App.DuatCampaign.validateCampaign((await row(id)).state));
  });
  console.log(JSON.stringify({passed,offline:true,liveAccountsCreated:0,liveWrites:0}));
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
