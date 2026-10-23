'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Babel = require('@babel/standalone');
const root = path.resolve(__dirname, '..');
const storage = new Map();
const window = { WR: {}, localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) } };
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
const ctx = vm.createContext({ window, React, console });
for (const file of ['js/shared/dashboard-view-data.js', 'js/shared/dashboard-builder.js', 'js/components/dashboard-view.js']) {
    vm.runInContext(Babel.transform(fs.readFileSync(path.join(root, file), 'utf8'), { presets: ['react'] }).code, ctx);
}
const clean = v => JSON.parse(JSON.stringify(v));
const api = window.WR.DashboardBuilder, catalog = api.catalog({ old: { label:'Old view', sizes:['md'], metrics:[] } });
const original = [{ id:'existing', key:'old', size:'md' }];
const slot = { id:'alex_age', key:'custom-view', size:'lg', title:'Roster age by position', view: { source:'roster', groupBy:'position', aggregate:{op:'avg',field:'age'}, columns:['position','value'], sort:{field:'value',direction:'desc'}, limit:20, display:'bar', x:'position', y:'value', appearance:{accent:'teal',density:'comfortable'} } };
const canonical = clean(api.validateLayout([slot], catalog));
assert.equal(canonical[0].view.aggregate.op, 'avg');
assert.equal(catalog.at(-1).key, 'custom-view');
for (const view of [
    { ...slot.view, source:'secret-dataset' },
    { ...slot.view, display:'html', html:'<script>' },
    { ...slot.view, y:'position' },
    { ...slot.view, display:'metric' },
    { ...slot.view, appearance:{accent:'red',density:'compact'} },
    { ...slot.view, columns:['position'], y:'value' },
    { ...slot.view, filters:[{field:'age',op:'gte',value:'25'}] },
    { ...slot.view, expression:'eval(1)' },
]) assert.throws(() => api.validateLayout([{...slot,view}],catalog));
assert.throws(() => api.validateLayout([{...slot,title:''}],catalog));
assert.throws(() => api.validateLayout([{...slot,primaryMetric:'age'}],catalog));
console.log('PASS flexible view validates query, selected chart fields, visual style and bounded schema');
const metric = {...slot,view:{source:'roster',aggregate:{op:'count'},columns:['value'],limit:1,display:'metric',y:'value',appearance:{accent:'gold',density:'compact'}}};
assert.equal(api.validateLayout([metric],catalog)[0].view.display,'metric');
api.save('account:league',[slot],catalog,original);
assert.deepEqual(clean(api.readSaved('account:league').layout),canonical);
assert.deepEqual(clean(api.undoSaved('account:league',catalog)),original);
console.log('PASS custom views persist and undo across legacy layout boundaries');
const longValues = Array.from({length:30},(_,index)=>String(index).padEnd(290,'x'));
const rich = {...slot,view:{source:'roster',columns:['name'],filters:[{field:'name',op:'in',value:longValues}],limit:20,display:'table',appearance:{accent:'gold',density:'compact'}}};
let previous = original;
for(let step=0;step<15;step++) {
    const next = Array.from({length:4},(_,i)=>({...rich,id:'alex_rich_'+i,title:'Rich view '+step}));
    const result=api.save('account:rich',next,catalog,previous);
    assert(api.readSaved('account:rich'), 'a reported save must remain readable');
    assert(JSON.stringify(result).length<=250000);
    previous=result.layout;
}
assert(api.readSaved('account:rich').history.length<10, 'large history is trimmed within readable storage budget');
assert.throws(()=>api.save('account:huge',Array.from({length:24},(_,i)=>({...rich,id:'alex_huge_'+i,view:{...rich.view,filters:[...rich.view.filters,...rich.view.filters]}})),catalog,[]),/too large/);
assert.equal(api.readSaved('account:huge'),null);
console.log('PASS large custom layouts retain readable history and reject oversize saves before writing');

const roster={roster_id:1,players:['one','two','three'],starters:['one']};
const context={currentLeague:{season:'2026',rosters:[roster]},myRoster:roster,playersData:{one:{full_name:'First <script>',position:'WR',age:20},two:{full_name:'Second',position:'WR',age:30},three:{full_name:'Third',position:'RB'}}};
const tree=window.WR.DashboardDataView({widget:slot,context});
const nodes=[];const walk=node=>{if (!node || typeof node!=='object') return;if(Array.isArray(node)) return node.forEach(walk);nodes.push(node);walk(node.children);};walk(tree);
const text=JSON.stringify(tree);
assert(text.includes('25'));
assert(text.includes('Unavailable'));
assert(nodes.some(node=>node.type==='i' && node.props.className==='alex-data-bar' && node.props.style.width==='100%'));
assert(!nodes.some(node=>'dangerouslySetInnerHTML' in node.props));
const percent={...slot,view:{source:'standings',columns:['name','winPct'],display:'bar',x:'name',y:'winPct',limit:10,appearance:{accent:'blue',density:'compact'}}};
const percentTree=window.WR.DashboardDataView({widget:percent,context:{currentLeague:{rosters:[{roster_id:1,settings:{wins:1,losses:1,ties:0,fpts:0}}]}}});
assert(JSON.stringify(percentTree).includes('50%'));
const points={...percent,view:{...percent.view,columns:['name','pointsFor'],y:'pointsFor'}};
const signed=window.WR.DashboardDataView({widget:points,context:{currentLeague:{rosters:[-10,0,10,null].map((value,i)=>({roster_id:i+1,settings:{wins:1,losses:1,ties:0,fpts:value}}))}}});
const signedNodes=[];const collect=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.forEach(collect);signedNodes.push(node);collect(node.children);};collect(signed);
const bars=signedNodes.filter(node=>node.props.className==='alex-data-bar');
assert.equal(bars.length,3,'missing points never become a bar');
assert.deepEqual(bars.map(node=>clean(node.props.style)),[{left:'0%',width:'50%'},{left:'50%',width:'0%'},{left:'50%',width:'50%'}]);

console.log('PASS real renderer shows grouped values, missing data, truthful percent units and escaped content');
(async()=>{
    let captured; window.OD={callAI:async options=>{captured=options;return {analysis:JSON.stringify({version:1,reply:'Average age by position makes the comparison clear.',layout:[slot]})};}};
    const result=await api.request({prompt:'Compare age by position',layout:original,catalog,league:{league_id:'1234567890123456789'}});
    assert.deepEqual(clean(result.layout),canonical);
    const envelope=JSON.parse(captured.context.messages.at(-1).content);
    assert(envelope.dataCatalog.some(source=>source.id==='leagueRoster'));
    assert(!JSON.stringify(envelope).includes('First <script>'));
    assert(captured.context.system.includes('Email and push are inactive'));
    console.log('PASS model receives semantic data catalog and returns a new view without requesting raw player data');
})().catch(error=>{console.error(error);process.exitCode=1;});
