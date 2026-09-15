'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
const walk = n => n == null || typeof n === 'boolean' ? [] : Array.isArray(n) ? n.flatMap(walk) : typeof n === 'object' ? [n, ...walk(n.children)] : [n];
const text = n => walk(n).filter(n => typeof n !== 'object').join('');
const find = (tree, pred) => walk(tree).find(n => typeof n === 'object' && pred(n));
const all = (tree, pred) => walk(tree).filter(n => typeof n === 'object' && pred(n));
let slots=[], deps=[], effects=[], index=0, dirty=true, tree, phone=true, opened=[];
const React = {
 Fragment:'fragment',
 useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{const next=typeof v==='function'?v(slots[i]):v;if(next!==slots[i]){slots[i]=next;dirty=true}}]},
 useMemo(fn){index++;return fn()},useRef(v){const i=index++;return slots[i]||={current:v}},
 useEffect(fn,next){const i=index++;if(!deps[i]||next.some((v,j)=>v!==deps[i][j])){deps[i]=next;effects.push(fn)}},
 createElement(type,props,...children){return{type,props:props||{},children}}
};
const primitive=()=>null;
const root={App:{},addEventListener(){},removeEventListener(){},WR:{useViewport:()=>({isPhone:phone}),Sheet:primitive,ActionBar:primitive,AssetRow:primitive,CardList:primitive,FilterSheet:primitive,openPlayerCard:(id,context)=>opened.push({id,context})}};
const ctx={window:root,React,console};vm.createContext(ctx);
for(const f of ['js/tabs/league-map.js','js/tabs/analytics.js','js/tabs/compare.js'])vm.runInContext(Babel.transform(fs.readFileSync(f,'utf8'),{presets:['react']}).code,ctx);
const rows=[{_groupHeader:true,_groupKey:'WR',_count:30},...Array.from({length:30},(_,i)=>({pid:'p'+i,name:'Full Player Name '+i,dhq:5000-i,age:24,owner:'Long Franchise Name',usageDelta:0,usageIsPct:true,ppgDelta:-2,snapPct:null})),{_groupHeader:true,_groupKey:'TE',_count:27},...Array.from({length:27},(_,i)=>({pid:'p'+(i+30),name:'Tight End Name '+i,dhq:3000-i,age:29,owner:'Other Owner',usageDelta:3,ppgDelta:0,snapPct:0}))];
const selected=['name','dhq','age','owner','usageDelta','ppgDelta','snapPct'];
const columns=selected.map(key=>({key,label:key}));
const report={id:'default_complete',name:'All selected fields',dataSource:'players',columns:selected,groupBy:'pos',filters:[],sort:{field:'dhq',dir:'desc'}};
let runCount=0;
const props={DEFAULT_REPORTS:[report,{...report,id:'teams',name:'Team context',dataSource:'teams'}],loadSavedReports:()=>null,saveReportsToStorage(){},runReport(config){runCount++;return{columns,rows:config.dataSource==='teams'?[{rosterId:2,teamName:'A long team name',dhq:100}]:rows}},sortBtnStyle:()=>({}),openTeamContext:(row,config)=>opened.push({row,config})};
function render(){for(let n=0;n<12&&dirty;n++){dirty=false;index=0;tree=ctx.ReportSubView(props);effects.splice(0).forEach(fn=>fn())}assert(!dirty,'render settles');return tree}
function click(label){const el=find(tree,n=>n.type==='button'&&text(n)===label);assert(el,'Button '+label);assert(!el.props.disabled);el.props.onClick();render()}
function results(){return all(tree,n=>n.type==='details'&&n.props.className==='la-report-row')}
render();find(tree,n=>n.props['data-report-id']===report.id).props.onClick();render();
assert.equal(results().length,25);assert.equal(all(results()[0],n=>n.type==='dt').length,selected.length,'Every selected report field renders, including text and later fields');
assert(text(results()[0]).includes('0pt'));assert(text(results()[0]).includes('-2%'));assert(text(results()[0]).includes('—'),'Unknown percentage remains unknown');
assert(!find(results()[0],n=>n.type==='summary').props.onClick,'Reading report detail does not launch a card');
click('Open player card');assert.equal(opened[0].id,'p0');assert.equal(opened[0].context.reportId,report.id);
click('Next');assert(text(tree).includes('26–50 of 57'));assert(text(tree).includes('WR'));assert(text(tree).includes('TE'));assert.equal(results().length,25);click('Next');assert.equal(results().length,7);
find(tree,n=>n.type==='select').props.onChange({target:{value:'age'}});render();assert(text(tree).includes('1–25 of 57'),'Changing report sort resets page');
click('Full table');assert.equal(all(tree,n=>n.props.className==='lm-rp-row is-clickable-report-row').length,57,'Full table retains all rows');assert.equal(all(find(tree,n=>n.props.className==='lm-rp-head'),n=>n.type==='span').length,selected.length);
click('Player / team rows');assert.equal(results().length,25);click('Back');find(tree,n=>n.props['data-report-id']==='teams').props.onClick();render();click('Open team');assert.equal(opened.at(-1).row.rosterId,2);assert.equal(opened.at(-1).config.id,'teams');
const flattened=[];for(let page=0;page<3;page++)flattened.push(...ctx.leagueReportPageRows(rows,page).rows.filter(r=>!r._groupHeader).map(r=>r.pid));assert.equal(new Set(flattened).size,57,'Grouped continuation has no missing or duplicate players');assert.equal(ctx.leagueReportPageRows(rows,99).page,2);assert.equal(ctx.leagueReportPageRows([],99).rows.length,0);
const child={type:'p',props:{},children:['Evidence']};assert.equal(ctx.AnalyticsPhonePanel({phone:true,active:false,children:child}),null);assert.equal(ctx.AnalyticsPhonePanel({phone:true,active:true,children:child}).type,'section');assert.equal(ctx.AnalyticsPhonePanel({phone:false,active:false,children:child}).type,'fragment','Desktop includes every analysis section');assert.equal(ctx.ComparePhoneSection({phone:true,title:'Details',children:child}).type,'details');assert.equal(ctx.ComparePhoneSection({phone:false,title:'Details',children:child}).type,'fragment');
console.log('PASS phone report field access, units, separate navigation, grouped pagination, sort reset, full table and selected/disclosed analysis contracts');
