'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const Engine=require('../js/duat/dynasty.js'),Rituals=require('../js/duat/rituals.js'),Favors=require('../js/duat/favors.js');
const source=Babel.transform(fs.readFileSync('js/components/duat-rituals.js','utf8'),{presets:['react']}).code;
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(' '):t==null||typeof t==='boolean'?'':typeof t==='object'?text(t.children):String(t);
function fixture(){const players=['QB','RB','RB','WR','TE','WR'].map((position,i)=>({id:'p'+i,name:'Player '+i,position,identity:'p'+i,season:2025}));return {version:4,expansionVersion:1,dynastySeason:1,phase:'season',week:1,seasons:[2025],settings:{favors:true,bench:1},completedWeeks:[],factions:[{id:'egypt',roster:'duat',activeArmyId:'a',armies:[{id:'a',players,season:2025}],lineup:players.slice(0,5).map(p=>p.id),favorBalance:100,rituals:{ledger:[],cooldowns:{}}}]};}
function harness(props){const states=[],deps=[];let cursor=0,ec=0,effects=[],changed=false,tree;const actions=[];
    const React={createElement:(type,props,...children)=>({type,props:props||{},children}),useState(value){const i=cursor++;if(!(i in states))states[i]=typeof value==='function'?value():value;return[states[i],v=>{v=typeof v==='function'?v(states[i]):v;if(v!==states[i]){states[i]=v;changed=true;}}];},useEffect(fn,dep){const i=ec++;if(!deps[i]||dep.some((v,n)=>v!==deps[i][n]))effects.push(fn);deps[i]=dep;}};
    const window={App:{DuatCampaign:Engine,DuatRituals:Rituals,DuatFavors:Favors}};vm.runInNewContext(source,{React,window,location:{pathname:'/index.html'}});
    function draw(){for(let n=0;n<10;n++){cursor=ec=0;effects=[];changed=false;tree=window.App.DuatRitualsView({factionId:'egypt',onAction:a=>actions.push(a),...props});effects.forEach(fn=>fn());if(!changed)return tree;}throw Error('Render did not settle');}
    const button=label=>{const node=nodes(draw()).find(n=>n.type==='button'&&text(n).includes(label));assert(node,'Missing '+label);return node;};return{draw,button,actions};
}

test('guided Temple filters gods and variants, preserves direct invocation, and leaves the complete Temple available',()=>{
    const c=fixture(),page=harness({campaign:c,guided:true,eligibleIds:['summon-mahdi']});let t=page.draw();assert.match(text(t),/Summon the Mahdi/);assert(!text(t).includes('The Mahdi II'));assert(!text(t).includes('The Super Mahdi'));assert(!text(t).includes('THE LEDGER OF OFFERINGS'));
    assert.equal(nodes(t).filter(n=>n.props.className?.includes('duat-divinity-card')).length,0);page.button('Invoke Mahdi').props.onClick();assert.equal(page.actions[0].ritualId,'summon-mahdi');
    t=harness({campaign:c}).draw();assert.equal(nodes(t).filter(n=>n.props.className?.includes('duat-divinity-card')).length,12);assert.match(text(t),/The Mahdi II/);assert.match(text(t),/THE LEDGER OF OFFERINGS/);
});

test('guided pending recruit goes directly to a legal release choice and cannot accept an unconfirmed full-roster replacement',()=>{
    const c=fixture();c.factions[0].rituals.pendingMahdi={ritualId:'summon-mahdi',player:{id:'new',name:'New Recruit',position:'WR',season:2025},roll:8,rerolls:0};
    const page=harness({campaign:c,guided:true,eligibleIds:['mahdi-accept','mahdi-decline','mahdi-reroll']}),t=page.draw();assert.match(text(t),/New Recruit/);assert(!text(t).includes('The Mahdi II'));assert(page.button('Accept recruit').props.disabled);
    const select=nodes(t).find(n=>n.type==='select');assert(!nodes(select).some(n=>n.type==='option'&&n.props.value==='p0'),'The only QB cannot be released for a WR');select.props.onChange({target:{value:'p1'}});assert(page.button('Accept recruit').props.disabled);
    nodes(page.draw()).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});assert(!page.button('Accept recruit').props.disabled);page.button('Accept recruit').props.onClick();assert.equal(page.actions[0].replacementId,'p1');assert.equal(page.actions[0].ritualId,'mahdi-accept');assert(page.actions[0].confirmed);
});

test('guided weekly favors limit variants, targets and affordable wager choices',()=>{
    const c=fixture();c.week=5;c.factions[0].favorBalance=20;
    let page=harness({campaign:c,guided:true,eligibleIds:['kratos-1'],eligibleTargets:{'kratos-1':['p1']}}),t=page.draw();assert(!text(t).includes('Kratos’ Wrath II'));
    const options=nodes(t).filter(n=>n.type==='option'&&n.props.value);assert.deepEqual(options.map(n=>n.props.value),['p1']);page.button('Reserve favor').props.onClick();assert.equal(page.actions[0].playerId,'p1');
    page=harness({campaign:c,guided:true,eligibleIds:['ebisu']});t=page.draw();const wagers=nodes(t).filter(n=>n.type==='button'&&text(n).includes('win chance'));assert.equal(wagers.length,1);assert.match(text(wagers[0]),/10\s+points/);
});
