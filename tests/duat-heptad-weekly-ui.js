'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const Weekly=require('../js/duat/weekly-flow.js'),Heptad=require('../js/duat/heptad.js');
const source=Babel.transform(fs.readFileSync('js/components/duat-heptad.js','utf8'),{presets:['react']}).code;
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(' '):t==null||typeof t==='boolean'?'':typeof t==='object'?text(t.children):String(t);
function render(campaign,factionId,week){
    const React={createElement:(type,props,...children)=>typeof type==='function'?type({...props,children}):({type,props:props||{},children})};
    const window={App:{DuatHeptad:Heptad,DuatWeeklyFlow:Weekly}};vm.runInNewContext(source,{React,window});return window.App.DuatHeptadUI.WeeklyRecap({campaign,factionId,week});
}
function fixture(week=2){
    const alliances=Array.from({length:4},(_,i)=>({id:'a'+i,name:'Alliance '+i,entry:i+1,teamIds:['f'+2*i,'f'+(2*i+1)]}));
    const match={week:2,bracket:'top',round:1,homeId:'a0',awayId:'a1',homeScore:123.45,awayScore:87.65,winnerId:'a0',loserId:'a1'};
    const c={version:4,settings:{leagueSize:8,playoffTeams:4},expansionSettings:{heptad:{}},alliances,factions:Array.from({length:8},(_,i)=>({id:'f'+i,name:'Faction '+i})),completedWeeks:[]};
    c.completedWeeks.push({week,factions:c.factions.map((f,i)=>({factionId:f.id,total:100-i,baseTotal:100-i,players:[]})),allianceScores:alliances.map(a=>({allianceId:a.id,total:60,contributors:[],mvp:null})),heptad:{matches:week===2?[match]:[],complete:false}});return c;
}
test('the compiled recap puts both actual match scores above a waiting alliance’s status',()=>{
    const c=fixture(),tree=render(c,'f4',2),content=text(tree);assert.match(content,/This week in the arena/);assert.match(content,/123\.45/);assert.match(content,/87\.65/);assert.match(content,/Winner/);assert.match(content,/Challenger path/);
    assert(content.indexOf('123.45')<content.indexOf('waiting to enter'));assert(content.indexOf('87.65')<content.indexOf('YOUR ALLIANCE'));
    assert.equal(nodes(tree).filter(n=>n.props.className==='duat-heptad-week-match').length,1);assert(!content.includes('Your match'));
    c.completedWeeks.push({...c.completedWeeks[0],week:3,heptad:{matches:[{week:3,bracket:'top',round:2,homeId:'a0',awayId:'a2',homeScore:9999,awayScore:8888,winnerId:'a2',loserId:'a0'}]}});assert(!text(render(c,'f4',2)).includes('9999'));
});
test('simultaneous paths, own-match highlighting and tied winner remain readable without hiding either scoreboard',()=>{
    const c=fixture(4);c.completedWeeks[0].heptad.matches=[{week:4,bracket:'top',round:3,homeId:'a0',awayId:'a3',homeScore:100,awayScore:80,winnerId:'a0',loserId:'a3'},{week:4,bracket:'bottom',round:1,homeId:'a1',awayId:'a2',homeScore:60.25,awayScore:60.25,winnerId:'a1',loserId:'a2'}];
    const tree=render(c,'f2',4),content=text(tree);assert.equal(nodes(tree).filter(n=>n.props.className?.startsWith('duat-heptad-week-match')).length,2);assert.equal(nodes(tree).filter(n=>n.props.className==='duat-heptad-week-match is-mine').length,1);
    assert.match(content,/Your match/);assert.match(content,/Redemption path/);assert.match(content,/100\.00/);assert.match(content,/80\.00/);assert.match(content,/60\.25/);assert.match(content,/Winner.*tiebreak/);assert.match(content,/Alliance 1 holds the arena/);
});
test('a week with no Heptad fixtures says so explicitly without fabricating a match',()=>{
    const tree=render(fixture(1),'f4',1);assert.match(text(tree),/No Heptad matches were played in Week/);assert.equal(nodes(tree).filter(n=>n.props.className?.startsWith('duat-heptad-week-match')).length,0);
});
