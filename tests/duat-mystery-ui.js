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
function openExplorer(h,props){let tree=h.render('Explorer',props);if(props.compact)nodes(tree).find(node=>node.type==='button').props.onClick();else tree.props.onToggle({currentTarget:{open:true}});return h.render('Explorer',props);}
const secondYearMatches={logIndex:new Map([[Season.gameLogKey(player.identity,2010,1),{stats:{...stats,passYd:190}}],[Season.gameLogKey(player.identity,2011,1),{stats}]])};
for(const compact of [false,true]){
 test(`${compact?'compact':'standard'} research identifies the sole public match and defaults to that year while preserving deliberate comparison`,()=>{
  const h=harness(),props={campaign,player,data:secondYearMatches,factionId:'egypt',throughWeek:1,compact};
  let tree=h.render('Explorer',props);assert.match(text(tree),/2011 · identified season/);assert.doesNotMatch(text(tree),/1 possible season|2025 · identified/);
  tree=openExplorer(h,props);assert.match(text(tree),/Identified season: 2011/);assert.doesNotMatch(text(tree),/Final reveal:/,'Logical identification does not impersonate the end-season reveal');
  assert.equal(nodes(tree).find(node=>node.type==='select').props.value,2011);assert.match(text(nodes(tree).find(node=>node.type==='caption')),/2011/);
  nodes(tree).find(node=>node.type==='select').props.onChange({target:{value:'2010'}});tree=h.render('Explorer',props);
  assert.equal(nodes(tree).find(node=>node.type==='select').props.value,2010);assert.match(text(tree),/Differs in campaign week 1/);assert.match(text(tree),/2011 · identified season/,'Comparing another year does not change the public inference');
 });
 test(`${compact?'compact':'standard'} research identifies a public singleton without archive access but respects a loaded zero-match result`,()=>{
  const singleton={...player,candidateYears:[2011]},h=harness(),props={campaign,player:singleton,data:null,factionId:'egypt',throughWeek:0,compact};
  let tree=h.render('Explorer',props);assert.match(text(tree),/2011 · identified season/,'The only public candidate is known before any comparison');
  tree=openExplorer(h,props);assert.match(text(tree),/Identified season: 2011/);assert.match(text(tree),/The candidate archive is loading/);assert.equal(nodes(tree).find(node=>node.type==='select').props.value,2011);assert.doesNotMatch(text(tree),/Matches the revealed campaign box scores/);
  tree=h.render('Explorer',{...props,data,throughWeek:1});assert.match(text(tree),/2010s · 0 possible seasons/);assert.doesNotMatch(text(tree),/identified season|Identified season:/,'A loaded contradiction takes precedence over the original singleton');
 });
 test(`${compact?'compact':'standard'} research keeps multiple, missing-archive and unwatched results uncertain, then updates its default after loading`,()=>{
  const h=harness(),props={campaign,player,data:null,factionId:'egypt',throughWeek:1,compact};
  let tree=openExplorer(h,props);assert.match(text(tree),/2010s · 2 possible seasons/);assert.doesNotMatch(text(tree),/identified season|Identified season:/);assert.equal(nodes(tree).find(node=>node.type==='select').props.value,2010);
  tree=h.render('Explorer',{...props,data:secondYearMatches});assert.match(text(tree),/2011 · identified season/);assert.equal(nodes(tree).find(node=>node.type==='select').props.value,2011,'The default follows the newly known year rather than sticking to the first archive entry');
  for(const throughWeek of [0,undefined,null,'1',NaN]){
   const hidden=harness(),hiddenProps={...props,data:secondYearMatches,throughWeek};const unopened=hidden.render('Explorer',hiddenProps);assert.match(text(unopened),/2010s · 2 possible seasons/);
   const opened=openExplorer(hidden,hiddenProps);assert.match(text(opened),/No completed games have been revealed/);assert.doesNotMatch(text(opened),/identified season|Identified season:|Week 1 · 18\.00 base points/,'Simulated results are not public before a valid viewed-week boundary');
  }
  const ambiguous={logIndex:new Map([[Season.gameLogKey(player.identity,2010,1),{stats}],[Season.gameLogKey(player.identity,2011,1),{stats}]])};
  tree=h.render('Explorer',{...props,data:ambiguous});assert.match(text(tree),/2010s · 2 possible seasons/);assert.doesNotMatch(text(tree),/identified season|Identified season:/);
 });
}
test('identified-year rendering does not read private assignments or seed and keeps the official final reveal distinct',()=>{
 const hiddenYears={revealedByFaction:{}};Object.defineProperty(hiddenYears,'assignments',{get(){throw new Error('Private assignments were read');}});
 const privateCampaign={...campaign,hiddenYears};Object.defineProperty(privateCampaign,'seed',{get(){throw new Error('Private seed was read');}});
 const props={campaign:privateCampaign,player,data:secondYearMatches,factionId:'egypt',throughWeek:1,compact:true},h=harness();
 let tree=openExplorer(h,props);assert.match(text(tree),/2011 · identified season/);assert.match(text(tree),/Identified season: 2011/);assert.doesNotMatch(text(tree),/Final reveal:/);
 tree=h.render('Explorer',{...props,player:{...player,revealedSeason:2011}});assert.match(text(tree),/Final reveal: 2011/);assert.doesNotMatch(text(tree),/Identified season:/,'The completed official reveal keeps its existing explicit label');
});
test('a singleton draft card places identified-year research beside neutral decade metadata',()=>{
 const h=harness(),candidate={...player,candidateYears:[2011]},raw=fs.readFileSync('js/components/duat-presentation.js','utf8');
 const source=require('@babel/standalone').transform(raw.slice(raw.indexOf('    function Draft('),raw.indexOf('    function DynastyArchaeology('))+'\nwindow.Draft=Draft;',{presets:['react']}).code;
 const view={...campaign,phase:'draft',dynastySeason:1,seasons:[2025],factions:[{id:'egypt',armies:[{id:'army',season:2025,rulerName:'Djoser',players:[]}]}],draft:{status:'active',cursor:0,totalPicks:64,picks:[],queue:[{factionId:'egypt'}]}};
 const Engine={draftTurn:()=>({factionId:'egypt',round:1,season:2025}),draftCandidates:()=>[candidate],rosterSize:()=>8,settingsOf:()=>({conquest:false,bench:3}),slotsOf:()=>['QB','FLEX','FLEX','FLEX','FLEX']};
 const window={},React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
 vm.runInNewContext(source,{window,App:h.App,React,useState:initial=>[initial,()=>{}],useMemo:fn=>fn(),useEffect(){},Engine,art:()=>'',nameOf:id=>id,Sigil:()=>null,number:n=>String(n)});
 const tree=window.Draft({campaign:view,factionId:'egypt',data,online:false,host:true,canAdvance:true,busy:false,onAction(){}}),row=nodes(tree).find(node=>node.props.className==='duat-draft-player');
 assert.match(text(row),/2010s/);assert.doesNotMatch(text(row),/year hidden/);
 const explorer=nodes(row).find(node=>node.type===h.App.DuatMysteryUI.Explorer);assert(explorer);assert.equal(explorer.props.throughWeek,0);
 assert.match(text(h.render('Explorer',explorer.props)),/2011 · identified season/);
});
test('archive explorer compares only viewed game logs and discloses actual matching seasons without probabilities',()=>{
 const h=harness(),props={campaign,player,data,factionId:'egypt',throughWeek:0};let tree=h.render('Explorer',props);assert.match(text(tree),/2010s · 2 possible seasons/);assert(!text(tree).includes('250'));
 tree.props.onToggle({currentTarget:{open:true}});tree=h.render('Explorer',props);assert.match(text(tree),/No completed games have been revealed/);assert.equal(nodes(tree).filter(n=>n.type==='option').length,2);assert.equal(nodes(tree).filter(n=>n.type==='tr').length,18);assert(!text(tree).includes('ruled out'));
 tree=h.render('Explorer',{...props,throughWeek:1});assert.match(text(tree),/1 of 2 seasons still match/);assert.match(text(tree),/2011 · ruled out/);assert.match(text(tree),/After offerings: 36.00 points/);assert(!text(tree).includes('%'));
});
for(const compact of [false,true])test(`${compact?'compact':'standard'} research waits for the archive before claiming a season matches`,()=>{
 const h=harness(),props={campaign,player,data:null,factionId:'egypt',throughWeek:1,compact};
 let tree=h.render('Explorer',props);
 if(compact)nodes(tree).find(n=>n.type==='button').props.onClick();
 else tree.props.onToggle({currentTarget:{open:true}});
 tree=h.render('Explorer',props);
 assert.match(text(tree),/Week 1 · 18\.00 base points/,'Already viewed results remain available while the archive loads');
 assert.equal(nodes(tree).filter(n=>n.type==='option').length,2,'Eligible seasons remain available');
 assert.match(text(tree),/The candidate archive is loading/);
 assert.doesNotMatch(text(tree),/Matches the revealed campaign box scores|Differs in campaign/,'No comparison result is claimed without archive data');
 assert.equal(nodes(tree).filter(n=>n.type==='table').length,0);
 tree=h.render('Explorer',{...props,data});
 assert.match(text(tree),/Matches the revealed campaign box scores/);
 assert.match(text(tree),/1 of 2 seasons still match/);
 assert.match(text(tree),/Week 1 · 18\.00 base points/);
 assert.equal(nodes(tree).filter(n=>n.type==='option').length,2);
 assert.equal(nodes(tree).filter(n=>n.type==='table').length,1);
 assert.equal(nodes(tree).filter(n=>n.type==='tr').length,18);
 assert.doesNotMatch(text(tree),/The candidate archive is loading/);
 nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'2011'}});
 tree=h.render('Explorer',{...props,data});
 assert.match(text(tree),/Differs in campaign week 1/,'A loaded nonmatching season reports its actual contradiction');
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
test('compact lineup research keeps the player identity, candidate count and viewed-game boundary without changing selection',()=>{
 const h=harness(),props={campaign,player,data,factionId:'egypt',throughWeek:0,compact:true};
 let tree=h.render('Explorer',props),button=nodes(tree).find(n=>n.type==='button');
 assert.match(text(tree),/Archive Quarterback.*2010s · 2 possible seasons/);
 assert.equal(button.props['aria-expanded'],false);
 assert(nodes(tree).some(n=>n.props.id===button.props['aria-describedby']&&text(n).includes('2010s · 2 possible seasons')),'Screen readers retain decade and remaining candidate count');
 assert(nodes(tree).some(n=>n.props.id===button.props['aria-controls']&&n.props.hidden));
 assert(!nodes(tree).some(n=>n.type==='input'),'Research has no lineup selection control');
 assert(!text(tree).includes('250'),'Unopened research cannot disclose a simulated result');
 button.props.onClick();tree=h.render('Explorer',props);
 assert.equal(nodes(tree).find(n=>n.type==='button').props['aria-expanded'],true);
 assert.match(text(tree),/No completed games have been revealed/);
 const panel=nodes(tree).find(n=>n.props.role==='region');assert(panel);
 panel.props.onKeyDown({key:'Escape',stopPropagation(){}});tree=h.render('Explorer',props);
 assert.equal(nodes(tree).find(n=>n.type==='button').props['aria-expanded'],false);
 assert(!nodes(tree).some(n=>n.type==='select'));
});
test('the real lineup panel renders player-decade identity and preserves the viewed-game explorer boundary',()=>{
 const App={DuatMystery:Mystery,DuatMysteryUI:{Explorer(){}},DuatCampaign:{activeArmy:faction=>faction.armies[0],settingsOf:()=>({roster:'test'}),ROSTERS:{test:{slots:['QB']}},legalLineup:()=>true,estimatePlayer:()=>({points:18,label:'2010s archive average'})}},React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
 const source=require('@babel/standalone').transform(fs.readFileSync('js/components/duat-weekly-flow.js','utf8'),{presets:['react']}).code;
 vm.runInNewContext(source,{window:{App},React});
 const view={...campaign,phase:'season',factions:[{id:'egypt',armies:[{players:[player]}]}]},tree=App.DuatWeeklyUI.Preparation({campaign:view,factionId:'egypt',lineup:[player.id],data,throughWeek:0,onChange(){}});
 const checkbox=nodes(tree).find(node=>node.type==='input');assert.equal(checkbox.props['aria-label'],'Archive Quarterback, QB, starting lineup');assert.equal(checkbox.props.checked,true);
 assert.match(text(tree),/Est\. PPG/);assert(nodes(tree).some(node=>node.props.title==='2010s archive average. Estimated points per game, not a weekly projection.'));
 assert(!text(tree).includes('Historical player'));
 const explorer=nodes(tree).find(node=>node.type===App.DuatMysteryUI.Explorer);assert(explorer);assert.equal(explorer.props.player.id,player.id);assert.equal(explorer.props.compact,true);assert.equal(explorer.props.throughWeek,0,'A prepared lineup cannot reveal simulated-but-unwatched games');
});
