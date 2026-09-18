'use strict';
const assert=require('node:assert/strict');
const Tasks=require('../js/shared/commish-tasks.js');
const Treasury=require('../js/shared/commish-treasury.js');
const records=new Map();let fail=false,throws=false,writes=0;
global.App.AccountStorage={get:(key,fallback)=>records.has(key)?JSON.parse(records.get(key)):fallback,set:(key,value)=>{writes++;if(throws)throw Error('quota');if(fail)return false;records.set(key,JSON.stringify(value));return true;}};
try{
  for(const rejected of ['false','throw']){
    records.clear();fail=rejected==='false';throws=rejected==='throw';
    assert.throws(()=>Tasks.add({title:'Keep my task',note:'Private typed note',dueTs:null}),{code:'LOCAL_SAVE_FAILED'});
    assert.equal(Tasks.list().length,0);
    fail=throws=false;const task=Tasks.add({title:'Keep my task',note:'Private typed note',dueTs:null});
    assert.equal(task.dueTs,null,'an empty form date is unscheduled, never January 1970');
    fail=true;assert.throws(()=>Tasks.toggleDone(task.id),{code:'LOCAL_SAVE_FAILED'});assert.equal(Tasks.list()[0].done,false);
    assert.throws(()=>Tasks.remove(task.id),{code:'LOCAL_SAVE_FAILED'});assert.equal(Tasks.list()[0].note,'Private typed note');
    fail=false;Tasks.toggleDone(task.id);assert.equal(Tasks.list()[0].done,true);Tasks.remove(task.id);assert.equal(Tasks.list().length,0);
  }
  fail=false;Treasury.markPaid('league','existing',{paid:true,note:'Keep bookkeeping'});
  const before=JSON.stringify(Treasury.getLedger('league'));
  fail=true;
  for(const save of [()=>Treasury.markPaid('league','existing',{paid:false}),()=>Treasury.setLeagueSafeUrl('league','https://www.leaguesafe.com/league'),()=>Treasury.setSheetUrl('league','https://docs.google.com/spreadsheets/d/fixture')])assert.throws(save,{code:'LOCAL_SAVE_FAILED'});
  const parsed={matched:[{userId:'a',paid:true,note:'paid'},{userId:'b',paid:false,note:'due'}]};
  writes=0;assert.throws(()=>Treasury.applyCsv('league',parsed,{nowMs:50}),{code:'LOCAL_SAVE_FAILED'});assert.equal(writes,1);assert.equal(JSON.stringify(Treasury.getLedger('league')),before);
  fail=false;writes=0;assert.equal(Treasury.applyCsv('league',parsed,{nowMs:50}),2);assert.equal(writes,1,'entire CSV commits once');
  assert.equal(Treasury.getLedger('league').entries.existing.note,'Keep bookkeeping');assert.equal(Treasury.getLedger('league').entries.a.paid,true);assert.equal(Treasury.getLedger('league').entries.b.paid,false);
  assert.equal(Treasury.setLeagueSafeUrl('league','https://bad.example'),false,'invalid link is still a validation rejection');
  console.log('PASS task/dues writes report quota rejection, preserve saved work, retry once, and import the ledger atomically; undated tasks stay unscheduled');
}finally{delete global.App.AccountStorage;}

// Execute the actual container mutation callbacks and rendered task form.
const fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const office=fs.readFileSync('js/tabs/commissioner-office.js','utf8');
const hook=office.slice(office.indexOf('function useCommishLocalSave()'),office.indexOf('function CommissionerOffice('));
const taskCallbacks=office.slice(office.indexOf('    const changeTask ='),office.indexOf('    const rawQueue ='));
const duesCallbacks=office.slice(office.indexOf('    const changeDues ='),office.indexOf('    // Ruling card:'));
const slots=[];let cursor=0,navigation;
const c=vm.createContext({console,window:{App:{NavigationGuard:{register:fn=>{navigation=fn;return()=>{};}}},addEventListener(){},removeEventListener(){}},React:{
  useState(init){const i=cursor++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},
  useRef(init){const i=cursor++;if(!(i in slots))slots[i]={current:init};return slots[i];},
  useEffect(fn,deps){const i=cursor++;if(!(i in slots)){slots[i]=true;if(!deps.length)fn();}},
},C:{Tasks,Treasury},setTasksTick(){},setTreasuryTick(){},state:{graph:{people:{a:{userId:'a',name:'Alpha',leagueIds:['league']}}}}});
vm.runInContext(hook,c);vm.runInContext('function callbacks(localSave){'+taskCallbacks+duesCallbacks+';return {onAddTask,onToggleTask,onRemoveTask,onMarkPaid,onSetLeagueSafe,onSetSheet,onPasteCsv};}',c);
const render=()=>{cursor=0;return c.useCommishLocalSave();};
records.clear();fail=true;throws=false;global.App.AccountStorage={get:(k,d)=>records.has(k)?JSON.parse(records.get(k)):d,set:(k,v)=>{if(fail)return false;records.set(k,JSON.stringify(v));return true;}};
try{
  let ui=render(),actions=c.callbacks(ui);
  assert.equal(actions.onAddTask({title:'Typed task',note:'first note'}),false);ui=render();assert(ui.failure);assert.equal(navigation(),false);assert.equal(ui.canLeave(),false);
  assert.equal(actions.onSetLeagueSafe('league','https://www.leaguesafe.com/fixture'),null,'storage failure is distinct from invalid URL');
  fail=false;assert.equal(actions.onSetLeagueSafe('league','https://www.leaguesafe.com/fixture'),true);ui=render();assert.equal(navigation(),false,'an unrelated successful action cannot erase the failed task');
  assert.equal(actions.onAddTask({title:'Typed task',note:'newer note'}),true);ui=render();assert.equal(navigation(),true);assert.equal(ui.failure,null);assert.equal(Tasks.list()[0].note,'newer note');
  const doomed=Tasks.list()[0].id;fail=true;assert.equal(actions.onToggleTask(doomed),false);ui=render();assert.equal(navigation(),false);
  fail=false;assert.equal(actions.onRemoveTask(doomed),true);ui=render();assert.equal(ui.failure,null);assert.equal(navigation(),true,'removing the task resolves its now-unretryable failed toggle');
  fail=true;const csv=actions.onPasteCsv('league','name,paid\nAlpha,paid');assert(csv.error);ui=render();assert.equal(ui.canLeave(),false);
  const beforeDiscard=JSON.stringify(Treasury.getLedger('league'));const oldReset=ui.reset;ui.discard();ui=render();assert.equal(ui.canLeave(),true);assert.equal(ui.reset,oldReset+1);assert.equal(JSON.stringify(Treasury.getLedger('league')),beforeDiscard);

  const formSlots=[];let formCursor=0;
  const p=vm.createContext({window:{},React:{createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment',useState(init){const i=formCursor++;if(!(i in formSlots))formSlots[i]=init;return[formSlots[i],v=>formSlots[i]=typeof v==='function'?v(formSlots[i]):v];}}});
  vm.runInContext(Babel.transform(fs.readFileSync('js/components/commish-ops-panel.js','utf8'),{presets:['react']}).code,p);
  const form=()=>{formCursor=0;return p.WrCommishOpsPanel({drift:[],calendar:[],conflicts:[],leagues:[],onAddTask:actions.onAddTask});};
  const all=node=>{if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(all);return[node,...Object.values(node.props||{}).flatMap(all)];};
  let tree=form();all(tree).find(n=>n.type==='button'&&n.props.children.join('').includes('+ Add task')).props.onClick();tree=form();
  all(tree).find(n=>n.type==='input'&&n.props.placeholder?.startsWith('Title')).props.onChange({target:{value:'Keep this form'}});tree=form();
  all(tree).find(n=>n.type==='input'&&n.props.placeholder==='Note (optional)').props.onChange({target:{value:'Private unsaved text'}});tree=form();
  all(tree).find(n=>n.type==='button'&&n.props.children.join('').includes('Add to board')).props.onClick();tree=form();
  assert.equal(all(tree).find(n=>n.type==='input'&&n.props.placeholder?.startsWith('Title')).props.value,'Keep this form');
  assert.equal(all(tree).find(n=>n.type==='input'&&n.props.placeholder==='Note (optional)').props.value,'Private unsaved text');
  fail=false;all(tree).find(n=>n.type==='button'&&n.props.children.join('').includes('Add to board')).props.onClick();tree=form();
  assert(!all(tree).some(n=>n.type==='input'&&n.props.placeholder?.startsWith('Title')),'form closes only after confirmed save');
  assert.equal(Tasks.list().filter(t=>t.title==='Keep this form').length,1);
  formSlots.length=0;
  vm.runInContext(Babel.transform(fs.readFileSync('js/components/commish-governance-panel.js','utf8'),{presets:['react']}).code,p);
  const leagueSafeUrl='https://www.leaguesafe.com/existing',sheetUrl='https://docs.google.com/spreadsheets/d/existing';let savedLinks=[];
  const dues=()=>{formCursor=0;return p.WrCommishGovernancePanel({section:'dues',leagues:[{id:'league',name:'Alpha'}],treasuries:{league:{summary:{paid:0,total:1,pct:0},rows:[],leagueSafeUrl,sheetUrl}},onSetLeagueSafe:(lid,url)=>{savedLinks.push(url);return true;},onSetSheet:(lid,url)=>{savedLinks.push(url);return true;}});};
  tree=dues();all(tree).find(n=>n.type==='div'&&n.props.onClick).props.onClick();tree=dues();
  all(tree).find(n=>n.type==='button'&&n.props.children.join('')==='Save link').props.onClick();
  all(tree).find(n=>n.type==='button'&&n.props.children.join('')==='Save').props.onClick();
  assert.deepEqual(savedLinks,[leagueSafeUrl,sheetUrl],'saving untouched displayed links preserves them');
  all(tree).find(n=>n.type==='input'&&n.props.placeholder?.startsWith('https://www.leaguesafe.com')).props.onChange({target:{value:''}});tree=dues();
  all(tree).find(n=>n.type==='button'&&n.props.children.join('')==='Save link').props.onClick();assert.equal(savedLinks.at(-1),'','explicitly clearing a URL still removes it');
  console.log('PASS actual Commissioner callbacks retain errors until matching recovery, block navigation, distinguish validation/storage, and keep typed task form open until one durable save');
}finally{delete global.App.AccountStorage;}
