'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const Legacy=require('../js/duat/campaign.js');
const players=[{id:'qb',name:'Starting QB',position:'QB'},{id:'rb',name:'Starting RB',position:'RB'},{id:'wr',name:'Starting WR',position:'WR'},{id:'te',name:'Starting TE',position:'TE'},{id:'flex',name:'Starting Flex',position:'WR'},{id:'bench',name:'Bench Receiver',position:'WR'},{id:'qb2',name:'Bench QB',position:'QB'}];
const points={qb:15,rb:10,wr:11,te:8,flex:12,bench:20,qb2:5};
const lineup=['qb','rb','wr','te','flex'],faction={id:'egypt',roster:'duat',activeArmyId:'army',armies:[{id:'army',season:2025,players}]};
const campaign={id:'lineup-fixture',version:4,dynastySeason:1,week:3,factions:[faction],completedWeeks:[{week:1,factions:[{factionId:'egypt',players:[{id:'rb',effectivePoints:-2}]}]},{week:2,factions:[{factionId:'egypt',players:[{id:'rb',effectivePoints:999999}]}]}]};
function harness(mystery=true,available=true){
 const reads=[];const E={...Legacy,activeArmy:()=>faction.armies[0],estimatePlayer:(state,_faction,id)=>{assert(state.completedWeeks.every(result=>result.week<=1),'Unwatched results reached estimate model');return {points:points[id],label:'2024 reference + viewed games'};}};
 const App={DuatCampaign:E,DuatMystery:{enabled:()=>mystery,isCard:()=>true,scouting:(_campaign,player,_data,options)=>{reads.push(options.throughWeek);return {available,week:options.throughWeek+1,points:points[player.id],pointsLeft:points[player.id]*10,stars:3,exact:false,candidateCount:3};}}};
 const React={createElement(type,props,...children){return {type,props:props||{},children};},useRef(){},useEffect(){}};vm.runInNewContext(Babel.transform(fs.readFileSync('js/components/duat-weekly-flow.js','utf8'),{presets:['react']}).code,{window:{App},React});
 return {compare:throughWeek=>App.DuatWeeklyUI.lineupComparison(campaign,'egypt',lineup,{},throughWeek),reads};
}
test('lineup comparison uses only viewed evidence and explains a legal start/bench swap with actual public point difference',()=>{
 const h=harness(),comparison=h.compare(1);assert.deepEqual(h.reads,Array(players.length).fill(1));assert.equal(comparison.week,2);
 const bench=comparison.rows.find(player=>player.id==='bench'),report=comparison.scoutingForRow(bench);
 assert.match(report.reason,/Starting over Starting TE is legal and adds 12\.0 W2 base-point estimate/);
 assert.match(report.summary,/W2: 20\.0 estimated base points.*200\.0 estimated points remain/);
 assert.match(report.confidence,/3 public seasons.*not probabilities.*offerings/);
 const qb=comparison.scoutingForRow(comparison.rows.find(player=>player.id==='qb'));assert.doesNotMatch(qb.reason,/Bench Receiver/,'A receiver cannot replace the only required quarterback');
 const rb=comparison.rows.find(player=>player.id==='rb');assert.equal(rb.lastWeek,1);assert.equal(rb.lastPoints,-2);assert(!JSON.stringify(comparison.rows).includes('999999'));
 assert.deepEqual(lineup,['qb','rb','wr','te','flex'],'Comparison never changes the lineup');
});
test('missing scouting reports never produce a fabricated start recommendation or points-left total',()=>{
 const comparison=harness(true,false).compare(1),row=comparison.rows[0],report=comparison.scoutingForRow(row);
 assert.equal(row.comparisonPoints,null);assert.match(report.reason,/Scouting is unavailable/);assert.doesNotMatch(report.reason,/strongest|adds/);assert.match(report.summary,/Load the public archive/);
});
test('standard lineup comparison keeps PPG distinct from weekly and remaining points and validates viewed-week cutoff',()=>{
 const comparison=harness(false).compare(1),row=comparison.rows.find(player=>player.id==='rb'),report=comparison.scoutingForRow(row);
 assert.match(report.summary,/10\.0 estimated PPG/);assert.match(report.summary,/Weekly projection and remaining points are unavailable/);assert.equal(row.lastPoints,-2);
 for(const value of [undefined,null,'1',NaN,-1,18]){const h=harness();const unseen=h.compare(value);assert(h.reads.every(week=>week===0));assert(unseen.rows.every(player=>player.lastWeek===undefined));}
});

test('rendered preparation never shows an unwatched score or labels viewed evidence as a later week',()=>{
 const actualFaction=JSON.parse(JSON.stringify(faction));for(const player of actualFaction.armies[0].players){player.referencePoints=12;player.referenceSeason=2024;}
 const state={...campaign,settings:Legacy.normalizeSettings({mummyCount:1,bench:3}),factions:[actualFaction],completedWeeks:[{week:1,factions:[{factionId:'egypt',players:[{id:'rb',basePoints:18,effectivePoints:18}]}]},{week:2,factions:[{factionId:'egypt',players:[{id:'rb',basePoints:999999,effectivePoints:999999}]}]}]};
 const App={DuatCampaign:Legacy,DuatMystery:{enabled:()=>false}},React={createElement(type,props,...children){return {type,props:props||{},children};}};
 vm.runInNewContext(Babel.transform(fs.readFileSync('js/components/duat-weekly-flow.js','utf8'),{presets:['react']}).code,{window:{App},React});
 const comparison=App.DuatWeeklyUI.lineupComparison(state,'egypt',lineup,{},1),rb=comparison.rows.find(row=>row.id==='rb');assert.equal(rb.estimate.label,'Through Week 1');
 const tree=App.DuatWeeklyUI.Preparation({campaign:state,factionId:'egypt',lineup,onChange(){},previous:state.completedWeeks[1],throughWeek:1});
 const text=node=>node==null||node===false?'':Array.isArray(node)?node.map(text).join(' '):typeof node==='object'?text(node.children):String(node);
 assert.doesNotMatch(text(tree),/999999|Through Week 2|W2 shows/);assert.match(text(tree),/18\.0 W 1/);
 assert.equal(App.DuatWeeklyUI.lineupComparison({...state,week:1},'egypt',lineup,{},3).viewed,0,'Future cutoffs are clamped to the campaign public week');
});
