'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const C=require('../js/duat/campaign.js'), Conquest=require('../js/duat/conquest.js');
const Season=globalThis.App.TimeLeagueSeason;
const data={cards:JSON.parse(fs.readFileSync('data/duat/player-cards.json','utf8')),logIndex:Season.buildGameLogIndex(Season.parseGameLogCsv(fs.readFileSync('data/duat/nflverse-game-logs.csv','utf8')).logs)};
const clone=x=>JSON.parse(JSON.stringify(x));
function create(settings={},scoring={}) {const rules=C.normalizeSettings(settings);return C.createCampaign({version:3,id:'rules-qa',seed:'rules-seed',name:'Custom rules',createdAt:'2026-09-08T21:00:00Z',hostFactionId:'egypt',settings:rules,scoring,seasons:Array.from({length:rules.mummyCount},(_,i)=>2025-i)},data);}
const act=(s,a)=>C.applyAction(s,a,data);
function draft(state){state=act(state,{type:'start-draft'});while(state.phase==='draft'){const turn=C.draftTurn(state),pool=C.draftCandidates(state,data);assert(pool.length,'A legal player must remain');state=act(state,{type:'draft-pick',factionId:turn.factionId,playerId:pool[0].id});}assert.equal(C.validateCampaign(state),true);return state;}
function reveal(state){while(state.phase==='reveal')state=act(state,{type:'reveal-next'});assert.equal(C.validateCampaign(state),true);return state;}
function claims(state){for(const id of state.humanFactionIds)while(state.conquest.pendingClaims[id]>0){const territoryId=Conquest.eligibleTerritories(state.conquest,id)[0];if(!territoryId)break;state=act(state,{type:'claim',factionId:id,territoryId});}return state;}
for(const [index,leagueSize] of [8,10,12,14,16].entries())for(const roster of ['duat','classic','superflex'])test(`${leagueSize} factions / ${roster}: complete draft, equal ruler odds, legal starters and custom scoring`,()=>{
    const mummyCount=[1,2,4,5,1][index], bench=index===4?6:1;
    let state=reveal(draft(create({leagueSize,mummyCount,roster,bench,favors:false,conquest:false},{reception:1,passTd:6,turnover:-2})));
    assert.equal(state.draft.cursor,leagueSize*mummyCount*(C.ROSTERS[roster].slots.length+bench));
    for(const f of state.factions){assert.equal(f.armies.length,mummyCount);assert(C.legalLineup(f,f.lineup));assert.equal(f.favorBalance,0);assert.equal(f.armies.reduce((sum,a)=>sum+a.rollBand.max-a.rollBand.min+1,0),20);assert(f.armies.every(a=>a.rollBand.max-a.rollBand.min+1===20/mummyCount));}
    assert.equal(state.alliances.length,leagueSize/2);
    const map=clone(state.conquest);state=act(state,{type:'advance-week'});assert.equal(C.validateCampaign(state),true);assert.deepEqual(state.conquest,map);
    for(const f of state.completedWeeks[0].factions)for(const p of f.players)assert.equal(p.basePoints,p.stats?Season.scoreStatLine(p.stats,state.scoring,{}):0);
});
for(const playoffTeams of [2,4,6,7,8])test(`${playoffTeams} playoff seeds resolve a complete 17-week season with both optional systems disabled`,()=>{
    let state=reveal(draft(create({leagueSize:8,mummyCount:1,roster:'superflex',bench:1,favors:false,conquest:false,playoffTeams})));
    const map=clone(state.conquest);while(state.phase==='season'){state=act(state,{type:'advance-week'});assert.equal(C.validateCampaign(state),true);assert.equal(state.playoffField.length,state.week>C.regularSeasonWeeks(state)?playoffTeams:0);}
    assert.equal(C.computeStandings(state)[0].wins+C.computeStandings(state)[0].losses,C.regularSeasonWeeks(state)*7);
    assert.equal(state.playoffField.length,playoffTeams);assert(state.heavenly.complete);assert.equal(state.heavenly.matches.find(m=>m.round==='championship').week,17);assert.deepEqual(state.conquest,map);assert(state.completedWeeks.every(w=>w.factions.every(f=>f.favorCost===0&&f.total===f.baseTotal)));
});
test('favor budgets fund humans and AI equally, spend exactly, and never regenerate',()=>{
    let state=reveal(draft(create({leagueSize:8,mummyCount:1,favorBudget:250,conquest:false})));
    assert(state.factions.every(f=>f.favorBalance===250));while(state.week<5)state=act(state,{type:'advance-week'});
    const faction=state.factions.find(f=>f.id===state.hostFactionId);
    state=act(state,{type:'declare-favor',factionId:faction.id,favorId:'kratos-3',playerId:faction.lineup[0]});state=act(state,{type:'advance-week'});
    const result=state.completedWeeks.at(-1).factions.find(f=>f.factionId===faction.id);
    assert.equal(state.factions.find(f=>f.id===faction.id).favorBalance,250-result.favorCost);assert(result.favorCost>0);assert(C.validateCampaign(state));
    const forged=clone(state);forged.factions[0].favorBalance++;assert.throws(()=>C.validateCampaign(forged),{code:'INVALID_CAMPAIGN'});
});
test('disabled mechanics reject direct actions; malformed settings and scoring cannot be saved',()=>{
    const state=reveal(draft(create({leagueSize:8,mummyCount:1,favors:false,conquest:false})));
    for(const type of ['declare-favor','clear-favor','claim','attack','fortify'])assert.throws(()=>act(state,{type,factionId:state.hostFactionId}),{code:type.includes('favor')?'FAVORS_DISABLED':'CONQUEST_DISABLED'});
    for(const settings of [{leagueSize:9},{mummyCount:3},{favorBudget:-1},{favorBudget:501},{bench:0},{favors:'false'},{conquest:null},{roster:'kickers'},{admin:true}])assert.throws(()=>create(settings),{code:'INVALID_SETTINGS'});
    for(const scoring of [{passTd:Infinity},{reception:-1},{turnover:2},{stats:{rec:100}}])assert.throws(()=>create({},scoring),{code:'INVALID_SCORING'});
    for(const change of [s=>s.settings.leagueSize=10,s=>s.settings.mummyCount=2,s=>s.factions[0].roster='classic',s=>s.scoring.reception=-1]){const broken=clone(state);change(broken);assert.throws(()=>C.validateCampaign(broken),{code:'INVALID_CAMPAIGN'});}
});
test('custom scoring changes only prior-year draft estimates and respects flex eligibility',()=>{
    const standard=act(create({leagueSize:8,mummyCount:1},{reception:0}),{type:'start-draft'}),ppr=act(create({leagueSize:8,mummyCount:1},{reception:1}),{type:'start-draft'});
    const a=C.draftCandidates(standard,data), b=C.draftCandidates(ppr,data);assert(a.some(p=>{const q=b.find(x=>x.id===p.id);return q&&q.referencePoints>p.referencePoints;}));assert(b.every(p=>p.referenceSeason===null||p.referenceSeason<2025));
    const players=[{id:'q1',position:'QB',points:30},{id:'q2',position:'QB',points:29},{id:'r1',position:'RB',points:5},{id:'r2',position:'RB',points:4},{id:'w1',position:'WR',points:8},{id:'w2',position:'WR',points:7},{id:'t',position:'TE',points:6},{id:'w3',position:'WR',points:9},{id:'w4',position:'WR',points:3}];
    assert.deepEqual(new Set(C.bestLineup(players,C.ROSTERS.superflex.slots,p=>p.points).map(p=>p.id)),new Set(['q1','q2','r1','r2','w1','w2','t','w3']));
});

test('initial v3 saves retain their original fourteen-week regular season',()=>{
    let state=create({leagueSize:8,mummyCount:1,playoffTeams:2,favors:false,conquest:false});delete state.calendarVersion;
    state=reveal(draft(state));assert.equal(C.regularSeasonWeeks(state),14);
    while(state.phase==='season'){state=act(state,{type:'advance-week'});assert.equal(C.validateCampaign(state),true);assert.equal(state.playoffField.length,state.week>14?2:0);}
    assert.equal(C.computeStandings(state)[0].wins+C.computeStandings(state)[0].losses,14*7);
});
