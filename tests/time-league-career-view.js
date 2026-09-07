'use strict';
const assert = require('assert');
global.window = globalThis;
global.App = {};
let userId = 'alice';
App.OD = { getCurrentUserId:()=>userId };
App.TimeLeagueCareer = require('../js/shared/time-league-career.js');
const league = { leagueId:'remote',name:'Alice private league',createdAt:'2026',phase:'complete',championTeamId:'a',settings:{regularSeasonWeeks:1},teams:[{teamId:'a',name:'Alice team',manager:'human'}],finalizedWeeks:[],draftPicks:[] };
const alice = App.TimeLeagueCareer.recordFor({league,mode:'multiplayer',seatTeamId:'a',rowId:'row'});
const solo = App.TimeLeagueCareer.recordFor({league:{...league,leagueId:'solo'},mode:'solo',seatTeamId:'a'});
App.TimeLeagueCareerStore = { read:scope=>scope==='solo:device'?[solo]:scope==='account:alice'?[{...alice,archived:true}]:[] };
window.TimeLeagueUtils = {readLeague:()=>null};
window.WrTimeLeagueCareerPanel = function Panel() {};
let hook = 0;
const cachedState = [{userId:'alice',records:[alice]},false,'',0];
let effects = 0;
global.React = {
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState:()=>[cachedState[hook++],()=>{}],
    useEffect:()=>{effects++;}, // Deliberately DO NOT run effects: inspect first render after account switch.
};
require('../js/components/time-league-career-view.js');
function renderedRecords(meta={userId:'alice',seatTeamId:'a',rowId:'row'}) {
    hook = 0;
    const view = window.WrTimeLeagueCareerView({league,onlineMeta:meta});
    return view.children.find(child=>child?.type===window.WrTimeLeagueCareerPanel).props.records;
}
let records = renderedRecords();
assert.equal(App.TimeLeagueCareer.summarize(records).multiplayer.leagues,1);
assert.equal(App.TimeLeagueCareer.summarize(records).trophies.filter(item=>item.mode==='multiplayer').length,1);
assert.equal(App.TimeLeagueCareer.summarize(records).leagues.find(item=>item.mode==='multiplayer').archived,false);
userId = 'bob';
records = renderedRecords();
assert.equal(records.filter(item=>item.mode==='multiplayer').length,0,'Previous account remote state, archive and active league must be absent BEFORE effects');
assert.equal(records.filter(item=>item.mode==='solo').length,1,'Device solo history remains available');
userId = null;
assert.equal(renderedRecords().filter(item=>item.mode==='multiplayer').length,0);
userId = 'alice';
records = renderedRecords({userId:'alice',rowId:'row'});
assert.equal(records.filter(item=>item.mode==='multiplayer').length,2,'Missing exact seat must not append a fallback current team');
assert(effects>=4);
console.log('Career view: first-render account isolation, logout isolation, exact-seat guard and archive/remote dedup passed.');
