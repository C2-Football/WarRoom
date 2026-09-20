'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const Drift=require('../js/shared/commish-drift.js'),Bylaws=require('../js/shared/commish-bylaws.js');
const records=new Map();let failKey=null,writes=[];
const storage={get:(key,fallback)=>records.has(key)?JSON.parse(records.get(key)):fallback,set(key,value){writes.push(key);if(key===failKey)return false;records.set(key,JSON.stringify(value));return true;}};
global.App.AccountStorage=storage;
const league={league_id:'L1',name:'Isolated league',scoring_settings:{rec:.5,pass_td:4},settings:{trade_deadline:10},roster_positions:['QB','RB']};
const source=fs.readFileSync('js/tabs/commissioner-office.js','utf8'),hook=source.slice(source.indexOf('function useCommishLocalSave()'),source.indexOf('function CommissionerOffice('));
const handlers=source.slice(source.indexOf('    const refreshDrift ='),source.indexOf('    const onCopy ='));
const slots=[];let cursor=0,guarded;
const c=vm.createContext({console,C:{Drift,Bylaws},window:{App:{AccountStorage:storage,NavigationGuard:{register:fn=>{guarded=fn;return()=>{};}}},addEventListener(){},removeEventListener(){}},setAckTick(){},React:{
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},
 useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
 useEffect(fn,deps){const i=cursor++;if(!(i in slots)){slots[i]=true;if(!deps.length)fn();}},
}});
c.state={status:'ready',mine:[league],drift:[{leagueId:'L1',leagueName:league.name,result:null}]};c.setState=fn=>{c.state=fn(c.state);};
vm.runInContext(hook+'\nfunction handlers(localSave){'+handlers+';return {onAcknowledge,onRetryDrift};}',c);
const render=()=>{cursor=0;const ui=c.useCommishLocalSave();return{ui,actions:c.handlers(ui)};};
try{
 failKey='commish_drift_L1';const missing=Drift.checkLeague(league,{nowMs:1000});assert(missing.storageError);assert.equal(missing.firstRun,false);assert.equal(records.size,0);
 let{ui,actions}=render();assert.equal(actions.onRetryDrift('L1'),false);({ui}=render());assert(ui.failure);assert.equal(guarded(),false);
 failKey=null;assert.equal(ui.failure.retry(),true);({ui}=render());assert.equal(ui.failure,null);assert.equal(c.state.drift[0].result.firstRun,true);
 league.scoring_settings.rec=1;league.settings.trade_deadline=12;
 failKey='commish_drift_L1';const unsaved=Drift.checkLeague(league,{nowMs:2000});assert.equal(unsaved.changes.length,2);assert(unsaved.storageError);assert.equal(storage.get(failKey).pending.length,0);
 assert.equal(actions.onAcknowledge('L1'),false);assert.equal(Bylaws.amendments('L1').length,0);
 failKey=null;Drift.checkLeague(league,{nowMs:2000});
 failKey='commish_bylaws_L1';assert.equal(actions.onAcknowledge('L1'),false);assert.equal(Drift.history('L1').length,0);assert.equal(storage.get('commish_drift_L1').pending.length,2);assert.equal(Bylaws.amendments('L1').length,0);
 failKey='commish_drift_L1';assert.equal(actions.onAcknowledge('L1'),false);assert.equal(Bylaws.amendments('L1').length,2);assert.equal(Drift.history('L1').length,0);assert.equal(storage.get('commish_drift_L1').pending.length,2);
 ({ui}=render());assert.match(ui.failure.message,/incomplete/);assert.equal(guarded(),false);
 failKey=null;writes=[];assert.equal(ui.failure.retry(),true);({ui}=render());assert.equal(ui.failure,null);assert.equal(guarded(),true);assert.equal(Bylaws.amendments('L1').length,2);assert.equal(Drift.history('L1').length,1);assert(!writes.includes('commish_bylaws_L1'));assert.equal(c.state.drift[0].result.changes.length,0);
 assert.equal(Drift.checkLeague(league,{nowMs:5000}).changes.length,0,'reopening the stored baseline stays quiet');
 c.window.App.AccountSession={isCurrent:()=>false};writes=[];assert.equal(actions.onAcknowledge('L1'),false);assert.equal(writes.length,0,'invalidated mounted account cannot write drift');
 const p=vm.createContext({window:{},React:{createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment',useState:init=>[init,()=>{}]}});
 vm.runInContext(Babel.transform(fs.readFileSync('js/components/commish-ops-panel.js','utf8'),{presets:['react']}).code,p);
 const all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...Object.values(n.props||{}).flatMap(all)];
 const text=n=>n==null?'':typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
 let retries=0;const tree=p.WrCommishOpsPanel({drift:[{leagueId:'L1',leagueName:league.name,result:missing}],calendar:[],conflicts:[],leagues:[],onRetryDrift:()=>{retries++;}});
 assert.match(text(tree),/not saved locally/);assert(!text(tree).includes('Settings match the last state'));assert(!text(tree).includes('Baseline recorded'));
 all(tree).find(n=>n.type==='button'&&text(n)==='Retry drift check').props.onClick();assert.equal(retries,1);
 console.log('PASS actual drift checks/acknowledgment/panel preserve failed baseline and pending state, commit ledger before baseline once, retry without duplicates, and reject stale-account writes');
}finally{delete global.App.AccountStorage;}
