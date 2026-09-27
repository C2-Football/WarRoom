'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const compiled=Babel.transform(fs.readFileSync('js/components/duat-draft-room.js','utf8'),{presets:['react']}).code;
const qb={id:'qb:2025',identity:'qb',name:'Public Quarterback',position:'QB',season:2025,referenceSeason:2024,referencePoints:18};
const wr={id:'wr:2025',identity:'wr',name:'Public Receiver',position:'WR',season:2025,referenceSeason:2024,referencePoints:12};
const campaign={id:'workspace',version:4,dynastySeason:1,seasons:[2025],factions:[{id:'egypt',armies:[{id:'egypt:2025',season:2025,rulerName:'Djoser',players:[]}]},{id:'rome',armies:[]}],draft:{status:'active',cursor:0,totalPicks:16,turn:{factionId:'egypt',armyId:'egypt:2025',armyNumber:1,round:1,season:2025},queue:[{number:1,factionId:'egypt',armyId:'egypt:2025'},{number:2,factionId:'rome'},{number:3,factionId:'egypt',armyId:'egypt:2025'}],picks:[],candidates:[qb,wr],scouting:{version:1,armyId:'egypt:2025',season:2025,nextPick:1,rows:[{...qb,canDraft:false,researchOnly:true,availability:'unconfirmed'},{...wr,canDraft:false,researchOnly:true,availability:'unconfirmed'}]}}};
const clone=value=>JSON.parse(JSON.stringify(value));
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.children)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(' '):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.children):String(node);
function harness({storage=new Map(),onAction=()=>false}={}){
 let cursor=0,cells=[],effects=[],changed=false,current=clone(campaign),extra={},derivations=0;
 const state=(initial,ref=false)=>{const index=cursor++;if(!(index in cells))cells[index]=ref?{current:initial}:typeof initial==='function'?initial():initial;return ref?cells[index]:[cells[index],next=>{const value=typeof next==='function'?next(cells[index]):next;if(value!==cells[index])changed=true;cells[index]=value;}];};
 const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useState:state,useRef:initial=>state(initial,true),useMemo:fn=>fn(),useLayoutEffect(){},useEffect(fn,deps){const index=cursor++,old=cells[index];if(!old||deps.some((value,i)=>value!==old[i])){cells[index]=deps;effects.push(fn);}}};
 const Engine={draftTurn:state=>state.draft.turn,draftCandidates:()=>{derivations++;return[qb,wr];},draftScouting:state=>{derivations++;return state.draft.scouting;},rosterSize:()=>8,slotsOf:()=>['QB','FLEX','FLEX','FLEX','FLEX'],shortages:players=>({QB:players.some(p=>p.position==='QB')?0:1,FLEX:Math.max(0,4-players.filter(p=>p.position!=='QB').length)}),settingsOf:()=>({bench:3,conquest:false})};
 const App={DuatCampaign:Engine,DuatPresentation:{nameOf:id=>id,art:()=>'',Sigil:'sigil'},GameDraftTable:'board',DuatMystery:{enabled:()=>false}};
 const window={App,WR:{useViewport:()=>({isPhone:false})},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}};
 vm.runInNewContext(compiled,{React,window,document:{activeElement:null}});
 function render(state=current,props={}){current=state;extra={...extra,...props};let tree,count=0;do{changed=false;cursor=0;effects=[];tree=App.DuatDraftRoom({campaign:current,factionId:'egypt',data:{},online:true,host:true,canAdvance:true,busy:false,onAction,...extra});effects.forEach(fn=>fn());assert(++count<12,'Hooks settle');}while(changed);return tree;}
 return {render,App,storage,derivations:()=>derivations};
}
const board=tree=>nodes(tree).find(node=>node.type==='board');
test('off-turn scouting consumes only approved public research, remains non-draftable and preserves query/queue across reload',()=>{
 const off=clone(campaign);off.draft.turn.factionId='rome';off.draft.candidates=[{...qb,name:'PRIVATE_RIVAL_CANDIDATE'}];off.draft.picks=[{factionId:'rome',playerId:qb.id,playerName:'PRIVATE_RIVAL_PICK'}];
 const h=harness();let tree=h.render(off),table=board(tree);assert(table);assert.equal(table.props.countNoun,'scouting cards');assert.equal(h.derivations(),0,'Online never constructs its own research from the archive');
 assert.equal(table.props.rows.length,2);assert(table.props.rows.every(row=>!row.canDraft&&row.researchOnly));assert(!text(tree).includes('PRIVATE_RIVAL'));
 table.props.onToggleQueue(table.props.rows[0]);table.props.onQueryChange('Quarterback');tree=h.render();table=board(tree);assert.equal(table.props.query,'Quarterback');assert.deepEqual(Array.from(table.props.queuedIds),[qb.id]);
 const reloaded=board(harness({storage:h.storage}).render(off));assert.equal(reloaded.props.query,'Quarterback');assert.deepEqual(Array.from(reloaded.props.queuedIds),[qb.id]);
 const removed=clone(campaign);removed.draft.candidates=[wr];tree=h.render(removed);assert.equal(board(tree).props.queuedIds.length,0,'On-turn legal pool checks availability');assert.equal(board(tree).props.query,'Quarterback','Selection context survives turn changes');
 const oldServer=clone(off);delete oldServer.draft.scouting;assert.equal(board(h.render(oldServer)),undefined,'An older server cannot trigger reconstruction from private candidates');
});
test('scouting explanations label actual reference periods, baseline uncertainty and only own roster needs',()=>{
 const h=harness(),table=board(h.render()),report=table.props.scoutingForRow(table.props.rows[0]);assert.match(report.summary,/2024/);assert.match(report.reason,/QB starting/);assert.match(report.confidence,/sealed/);
 const mystery=h.App.DuatDraftBoard.scoutingForRow({...wr,decade:2010,candidateYears:[2011,2012],researchOnly:true},{needs:{FLEX:2},mystery:true});assert.match(mystery.summary,/calendar week.*2 eligible.*Weeks 1–17/);assert.match(mystery.reason,/flex/);assert.match(mystery.confidence,/not a probability/);
 const baseline=h.App.DuatDraftBoard.scoutingForRow({...qb,referenceSeason:null},{needs:{}});assert.match(baseline.confidence,/Limited evidence/);assert.match(baseline.summary,/baseline/);
});
test('picks latch once, report rejection honestly, retain the queue and confirm only from the owned roster',async()=>{
 let settle,actions=[];const h=harness({onAction:action=>{actions.push(action);return new Promise(resolve=>settle=resolve);}});let tree=h.render(),table=board(tree);
 table.props.onToggleQueue(table.props.rows[0]);tree=h.render();table=board(tree);
 const promise=table.props.onDraft(table.props.rows[0]);table.props.onDraft(table.props.rows[0]);assert.equal(actions.length,1,'Rapid or stale callbacks cannot double-submit');
 tree=h.render();assert.match(text(tree),/Saving Public Quarterback/);assert(board(tree).props.rows.every(row=>!row.canDraft));
 settle(false);await promise;tree=h.render(campaign,{actionError:'The draft advanced. Try another available player.'});assert.match(text(tree),/Pick not saved/);assert.match(text(tree),/The draft advanced/);assert.doesNotMatch(text(tree),/joined your army/);assert.deepEqual(Array.from(board(tree).props.queuedIds),[qb.id]);
 table=board(tree);const retry=table.props.onDraft(table.props.rows[0]);settle(true);await retry;tree=h.render();assert.match(text(tree),/Checking your saved pick/);assert.doesNotMatch(text(tree),/joined your army/,'HTTP success alone cannot invent an owned pick');
 const confirmed=clone(campaign);confirmed.factions[0].armies[0].players=[qb];confirmed.draft.picks=[{number:1,round:1,armyNumber:1,factionId:'egypt',playerId:qb.id,playerName:qb.name}];confirmed.draft.candidates=[wr];confirmed.draft.cursor=1;confirmed.draft.turn.factionId='rome';
 tree=h.render(confirmed);assert.match(text(tree),/Public Quarterback joined your army/);assert.match(text(tree),/Keep scouting and queueing/);assert.equal(board(tree).props.queuedIds.length,0);assert(nodes(tree).some(node=>node.props.className?.includes('is-new-pick')));
});
