'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Babel=require('@babel/standalone');
const source=fs.readFileSync('js/app.js','utf8');
const wanted=new Set(['accountSessionCurrent','handleMFLConnect','handleESPNConnect','finalizeMFLConnect','populateEmpireWindowState','assessEmpirePortfolio']);
const nodes=[];
const selected=Babel.transform(source,{presets:['react'],plugins:[()=>({visitor:{FunctionDeclaration(path){if(wanted.has(path.node.id.name))nodes.push(path.node);},Program:{exit(path){path.node.body=nodes;}}}})]}).code;
const displayEffect=source.slice(source.indexOf('        // Cloud sync —'),source.indexOf('        const leagueMates ='));
const mflEffect=source.slice(source.indexOf('        // ── MFL rehydration'),source.indexOf('        function syncSleeperPortfolio'));
function storage(){const map=new Map();return{map,get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
function fixture(){
  const local=storage(),temporary=storage(),log=[],effects=[];
  const install=id=>{local.setItem('fw_session_v1',JSON.stringify({token:'fixture-'+id,user:{id}}));local.setItem('od_display_name',id+' name');local.setItem('mfl_league_id',id+' league');};
  install('a');
  const context=vm.createContext({console,atob,URL,setTimeout,clearTimeout,localStorage:local,sessionStorage:temporary,
    document:{getElementById:()=>({replaceChildren(){},textContent:''}),addEventListener(){}},addEventListener(){},location:{reload:()=>log.push('reload')},
    App:{},OD:{saveMflConnection:async value=>log.push(['saveMflConnection',value])},
    useEffect:effect=>effects.push(effect),MFL_SANDBOX_ACCESS:true,OWNER_MFL_TEAM:'Owner',sleeperUsername:'owner',selectedYear:'2026',
    platformAccessAllowed:()=>true,platformBetaMessage:()=>'',buildMflLeagueObj:(_result,id,franchise)=>({id,_mflLeagueId:id,franchise}),handleSelectLeague:value=>log.push(['select',value]),
    wrLog(){},sleeperUser:{user_id:'owner'},
    MFL:{fetchLeague:async()=>({leagueData:{league:{franchises:{franchise:[]}}}}),buildCrosswalk:()=>({}),mapToSleeperState:()=>({mapped:true})},
  });
  for(const key of ['setCustomDisplayName','setMflConnecting','setMflError','setMflPendingResult','setMflFranchises','setMflLeagues','setEspnConnecting','setEspnError','setEspnLeagues','setEmpireAssessReady'])context[key]=value=>log.push([key,value]);
  context.window=context;
  vm.runInContext(fs.readFileSync('js/shared/account-storage.js','utf8'),context);vm.runInContext(selected,context);
  return{context,local,temporary,log,effects,install};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const display=fixture(),name=deferred();display.context.OD.loadDisplayName=()=>name.promise;
  vm.runInContext(displayEffect,display.context);display.effects[0]();display.install('b');name.resolve('A cloud name');await flush();
  assert.equal(display.local.getItem('od_display_name'),'b name');assert(!display.log.some(v=>Array.isArray(v)&&v[0]==='setCustomDisplayName'));

  const hydrate=fixture(),connection=deferred();hydrate.local.removeItem('mfl_league_id');let fetches=0;
  hydrate.context.OD.loadMflConnection=()=>connection.promise;hydrate.context.MFL.fetchLeague=async()=>{fetches++;return{};};
  vm.runInContext(mflEffect,hydrate.context);hydrate.effects[0]();hydrate.install('b');connection.resolve({leagueId:'a cloud league',year:2026,franchiseId:'a-team'});await flush();
  assert.equal(hydrate.local.getItem('mfl_league_id'),'b league');assert.equal(fetches,0,'old connection cannot start provider fetch under new account');
  assert(!hydrate.log.some(v=>Array.isArray(v)&&v[0]==='saveMflConnection'));

  const raw={leagueData:{league:{franchises:{franchise:[{id:'team',name:'Team'}]}}}};
  for(const operation of ['manual','rehydrate']){
    const f=fixture(),response=deferred();f.context.MFL.fetchLeague=()=>response.promise;
    let pending;if(operation==='manual')pending=f.context.handleMFLConnect('a-new',2026,'a-secret');else{vm.runInContext(mflEffect,f.context);f.effects[0]();}
    f.install('b');response.resolve(raw);await pending;await flush();
    assert.equal(f.local.getItem('mfl_league_id'),'b league');assert.equal(f.temporary.getItem('mfl_api_key'),null);
    assert(!f.log.some(v=>Array.isArray(v)&&['setMflPendingResult','setMflFranchises','setMflLeagues','saveMflConnection'].includes(v[0])),operation+' cannot publish stale state');
    assert(f.log.includes('reload'));
  }
  const espn=fixture(),espnResult=deferred();espn.context.ESPN={connectLeague:()=>espnResult.promise};
  const espnWork=espn.context.handleESPNConnect('123','a-cookie','a-swid');espn.install('b');espnResult.resolve({league:{league_id:'123',name:'A ESPN'},rosters:[]});await espnWork;
  assert.equal(espn.temporary.getItem('espn_s2'),null);assert(!espn.log.some(v=>Array.isArray(v)&&v[0]==='setEspnLeagues'));

  const final=fixture();final.context.mflPendingResult={mapped:true};final.install('b');final.context.finalizeMFLConnect('a-team');
  assert.equal(final.local.getItem('mfl_franchise_id'),null);assert(!final.log.some(v=>Array.isArray(v)&&v[0]==='saveMflConnection'));
  const happy=fixture();await happy.context.handleMFLConnect('new-league',2026,'valid-secret');happy.context.mflPendingResult={mapped:true};happy.context.finalizeMFLConnect('team');
  assert.equal(happy.local.getItem('mfl_league_id'),'new-league');assert.equal(happy.local.getItem('mfl_franchise_id'),'team');assert.equal(happy.temporary.getItem('mfl_api_key'),'valid-secret');
  assert.equal(happy.log.filter(v=>Array.isArray(v)&&v[0]==='saveMflConnection').length,1);
  console.log('PASS actual display/provider hydration/connect/finalize callbacks cannot mutate another account; unchanged-account MFL flow persists normally');

  const empire=fixture(),picks=deferred();empire.context.fetch=()=>picks.promise;const league={id:'a-league',rosters:[]};
  const populate=empire.context.populateEmpireWindowState([league]);empire.install('b');empire.context.S={tradedPicks:['b-state']};picks.resolve({ok:true,json:async()=>[{pick:'a-private'}]});await populate;
  assert.equal(league.tradedPicks,undefined);assert.deepEqual(empire.context.S.tradedPicks,['b-state']);
  const dna=fixture(),saved=deferred(),requested=deferred();let txnFetches=0;
  dna.context.S={playerStats:{known:true}};dna.context.App.assessAllTeams=()=>[];dna.context.OD.loadDNA=()=>{requested.resolve();return saved.promise;};dna.context.WrTxns={fetchLeagueTxns:async()=>{txnFetches++;return[];}};
  const dnaLeague={id:'a-league'};const assessment=dna.context.assessEmpirePortfolio([dnaLeague],{});await requested.promise;dna.install('b');saved.resolve({private:'A note'});await assessment;
  assert.equal(txnFetches,0);assert.equal(dnaLeague.empireDna,undefined);assert(!dna.log.some(v=>Array.isArray(v)&&v[0]==='setEmpireAssessReady'));
  console.log('PASS actual Empire delayed picks/DNA stop before state publication or the next account-sensitive request');
})().catch(error=>{console.error(error);process.exitCode=1;});
