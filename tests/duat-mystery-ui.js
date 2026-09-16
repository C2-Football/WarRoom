'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../js/duat/dynasty.js');
const Mystery=globalThis.App.DuatMystery,Season=globalThis.App.TimeLeagueSeason;
const player={id:'player:QB:fixture:veil:1:2025:2010',identity:'player:QB:fixture',name:'Archive Quarterback',position:'QB',season:2025,decade:2010,candidateYears:[2010,2011],mysteryCycle:1,referenceSeason:null};
const stats={...Season.emptyStatLine(),passYd:250,passTd:2};
const result={...player,stats,basePoints:18,effectivePoints:36,hasRecordedGame:true};
const campaign={version:4,era:{mode:'historical',hiddenYears:true},phase:'complete',week:18,scoring:{passingYd:.04,passTd:4},factions:[{id:'egypt'}],completedWeeks:[{week:1,factions:[{factionId:'egypt',players:[result]}]}],hiddenYearRevealAvailable:true};
const data={logIndex:new Map([[Season.gameLogKey(player.identity,2010,1),{stats}],[Season.gameLogKey(player.identity,2011,1),{stats:{...stats,passYd:190}}]])};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(' '):value==null||typeof value==='boolean'?'':typeof value==='object'?text(value.children):String(value);
function harness(){let states=[],cursor=0;const App={DuatMystery:Mystery},React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=value];}};vm.runInNewContext(fs.readFileSync('js/components/duat-mystery.js','utf8'),{React,window:{App}});return{App,render(name,props){cursor=0;return App.DuatMysteryUI[name](props);}};}
test('archive explorer compares only viewed game logs and discloses actual matching seasons without probabilities',()=>{
 const h=harness(),props={campaign,player,data,factionId:'egypt',throughWeek:0};let tree=h.render('Explorer',props);assert.match(text(tree),/2010s · 2 possible seasons/);assert(!text(tree).includes('250'));
 tree.props.onToggle({currentTarget:{open:true}});tree=h.render('Explorer',props);assert.match(text(tree),/No completed games have been revealed/);assert.equal(nodes(tree).filter(n=>n.type==='option').length,2);assert.equal(nodes(tree).filter(n=>n.type==='tr').length,18);assert(!text(tree).includes('ruled out'));
 tree=h.render('Explorer',{...props,throughWeek:1});assert.match(text(tree),/1 of 2 seasons still match/);assert.match(text(tree),/2011 · ruled out/);assert.match(text(tree),/After offerings: 36.00 points/);assert(!text(tree).includes('%'));
});
test('final reveal control appears only after Week17 recap and preserves every played card in the reveal',()=>{
 const h=harness(),actions=[],props={campaign,factionId:'egypt',data,throughWeek:16,onAction:a=>actions.push(a)};assert.equal(h.render('Recap',props),null);assert.equal(h.render('Recap',{...props,throughWeek:undefined}),null,'An omitted playback horizon must stay sealed');
 let tree=h.render('Recap',{...props,throughWeek:17});const button=nodes(tree).find(n=>n.type==='button');assert(button);button.props.onClick();assert.equal(actions[0].type,'reveal-years');assert(!text(tree).includes('Final reveal: 2010'));
 const revealed=JSON.parse(JSON.stringify(campaign));revealed.hiddenYearRevealAvailable=false;revealed.completedWeeks[0].factions[0].players[0].revealedSeason=2010;revealed.completedWeeks.push({week:17,factions:[{factionId:'egypt',players:[]}]});
 tree=h.render('Recap',{...props,campaign:revealed,throughWeek:17});assert.match(text(tree),/Archive Quarterback/);assert.match(text(tree),/2010s · 2010/);assert(!nodes(tree).some(n=>n.type==='button'));
});
test('public box scores strip source dates, numeric years and raw game identifiers',()=>{
 assert.deepEqual(Mystery.numericStats({...stats,season:2010,week:1,sourceGameId:2010090100,date:'2010-09-01',opponent:'NE'}),Mystery.numericStats(stats));
});
test('the real lineup panel renders player-decade identity and preserves the viewed-game explorer boundary',()=>{
 const App={DuatMystery:Mystery,DuatMysteryUI:{Explorer(){}},DuatCampaign:{activeArmy:faction=>faction.armies[0],settingsOf:()=>({roster:'test'}),ROSTERS:{test:{slots:['QB']}},legalLineup:()=>true,estimatePlayer:()=>({points:18,label:'2010s archive average'})}},React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
 const source=require('@babel/standalone').transform(fs.readFileSync('js/components/duat-weekly-flow.js','utf8'),{presets:['react']}).code;
 vm.runInNewContext(source,{window:{App},React});
 const view={...campaign,phase:'season',factions:[{id:'egypt',armies:[{players:[player]}]}]},tree=App.DuatWeeklyUI.Preparation({campaign:view,factionId:'egypt',lineup:[player.id],data,throughWeek:0,onChange(){}});
 assert.match(text(tree),/2010s · year hidden · 2010s archive average/);assert(!text(tree).includes('Historical player'));
 const explorer=nodes(tree).find(node=>node.type===App.DuatMysteryUI.Explorer);assert(explorer);assert.equal(explorer.props.player.id,player.id);assert.equal(explorer.props.throughWeek,0,'A prepared lineup cannot reveal simulated-but-unwatched games');
});
