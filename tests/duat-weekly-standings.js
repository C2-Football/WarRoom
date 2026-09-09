'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const Weekly=require('../js/duat/weekly-flow.js');
const React={createElement:(type,props,...children)=>({type,props:props||{},children}),useRef:()=>({current:null}),useEffect(){}};
const App={DuatPresentation:{nameOf:id=>id},DuatHeptadUI:{WeeklyRecap(){return null;}}};
vm.runInNewContext(Babel.transform(fs.readFileSync('js/components/duat-weekly-flow.js','utf8'),{presets:['react']}).code,{window:{App},React});
const UI=App.DuatWeeklyUI;
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.children)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join('');if(tree==null||typeof tree==='boolean')return '';return typeof tree==='object'?text(tree.children):String(tree);}
function rows(tree){return nodes(nodes(tree).find(node=>node.type==='tbody')).filter(node=>node.type==='tr');}
function fixture(totals){
    const factions=totals.map((_,i)=>({id:'f'+i,name:i===2?'Mesopotamia':'Faction '+i,record:{wins:90,losses:3,ties:1},pointsFor:5000}));
    return {version:4,expansionVersion:1,phase:'season',week:3,settings:{leagueSize:totals.length,playoffTeams:4},factions,alliances:[],completedWeeks:[{week:2,factions:totals.map((total,i)=>({factionId:'f'+i,total,baseTotal:999,players:[]}))}]};
}
function table(campaign,factionId='f2',week=2){const result=Weekly.outcome(campaign,factionId,week);return UI.WeeklyStandings({week,rows:result?.weeklyStandings,factionId});}

test('compiled standings show the complete weekly field, precise scores, tied ranks, and weekly W–L–T',()=>{
    const campaign=fixture([100.04,100.03,100.03,50,20,0,-2,-2.01]),tree=table(campaign),body=rows(tree);
    assert.equal(body.length,8);
    assert.deepEqual(body.map(row=>text(row.children[0])),['1','=2','=2','4','5','6','7','8']);
    assert.deepEqual(body.map(row=>text(row.children[2])),['100.04','100.03','100.03','50.00','20.00','0.00','-2.00','-2.01']);
    assert.deepEqual(body.map(row=>text(row.children[3])),['7–0–0','5–1–1','5–1–1','4–3–0','3–4–0','2–5–0','1–6–0','0–7–0']);
    assert.match(text(tree),/Week 2 standings/);assert.match(text(tree),/this week only/);assert(!text(tree).includes('90–3'));
    const own=body.filter(row=>row.props.className==='is-you');assert.equal(own.length,1);assert.match(text(own[0]),/MesopotamiaYou/);
    assert.equal(nodes(own[0]).find(node=>node.type==='th').props.scope,'row');
    assert.equal(nodes(own[0]).find(node=>node.props['aria-label'])?.props['aria-label'],'Tied for rank 2');
});

test('a sixteen-faction recap preserves every faction and uses finalized totals including team adjustments',()=>{
    const campaign=fixture(Array.from({length:16},(_,i)=>20.01-i*2));
    campaign.completedWeeks[0].factions[15].total=20.02;
    campaign.completedWeeks[0].factions[15].teamAdjustment=999;
    const tree=table(campaign,'f15'),body=rows(tree);
    assert.equal(body.length,16);assert.match(text(body[0]),/Faction 15You20.0215–0–0/);
    assert.equal(body.at(-1).children[2].children[0],'-7.99');
    assert.equal(nodes(tree).filter(node=>node.type==='button').length,0,'The table adds no competing navigation or actions.');
});

test('recap binds standings and Heptad to the selected result week even after later results arrive',()=>{
    const campaign=fixture([100.04,100.03,100.03,50,20,0,-2,-2.01]);
    const before=text(table(campaign));
    campaign.completedWeeks.push({week:3,factions:campaign.factions.map((f,i)=>({factionId:f.id,total:900+i,players:[]}))});campaign.week=4;
    const result=Weekly.outcome(campaign,'f2',2),tree=UI.Recap({campaign,factionId:'f2',week:2,result});
    const standings=nodes(tree).find(node=>node.type===UI.WeeklyStandings),heptad=nodes(tree).find(node=>node.type===App.DuatHeptadUI.WeeklyRecap);
    assert.equal(standings.props.week,2);assert.equal(heptad.props.week,2);
    assert(nodes(tree).indexOf(standings)<nodes(tree).indexOf(heptad),'The full standings immediately explain personal weekly place before the Heptad section.');
    assert.equal(text(UI.WeeklyStandings(standings.props)),before);
    assert.match(text(tree),/100.03/);assert(!text(tree).includes('902'));
    const frame=UI.Frame({stage:'recap',week:2,cycle:1,children:tree,primary:{label:'Continue to conquest',onClick(){}},favors:true,conquest:true});
    const buttons=nodes(frame).filter(node=>node.type==='button');assert.equal(buttons.length,1);assert.equal(text(buttons[0]),'Continue to conquest');
});

test('missing or unfinalized selected-week results never substitute the latest weekly table',()=>{
    const campaign=fixture([100,90,80,70,60,50,40,30]);campaign.completedWeeks[0].finalized=false;
    const tree=table(campaign);assert.equal(rows(tree).length,0);assert.match(text(tree),/No finalized scores/);
    const recap=UI.Recap({campaign,factionId:'f2',week:1,result:Weekly.outcome(campaign,'f2',1)});
    assert.equal(nodes(recap).filter(node=>node.type===UI.WeeklyStandings).length,0);assert.match(text(recap),/unavailable/);
});
