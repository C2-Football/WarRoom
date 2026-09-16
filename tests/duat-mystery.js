'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const E=require('../js/duat/dynasty.js'),M=globalThis.App.DuatMystery,S=globalThis.App.TimeLeagueSeason;
const data={cards:JSON.parse(fs.readFileSync('data/duat/player-cards.json')),manifest:JSON.parse(fs.readFileSync('data/duat/manifest.json'))};
data.logIndex=S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync('data/duat/nflverse-game-logs.csv','utf8')).logs);
const copy=value=>JSON.parse(JSON.stringify(value));
function create(overrides={}){return E.createCampaign({version:4,id:'mystery-test',name:'The Veiled Years',seed:'private-mystery-seed',createdAt:'2026-09-15T12:00:00Z',seasons:[2025,2024],hostFactionId:'egypt',humanFactionIds:['egypt','rome'],settings:{leagueSize:8,mummyCount:2,bench:1,playoffTeams:4,favors:false,conquest:false},era:{mode:'historical',hiddenYears:true},...overrides},data);}
let prepared;
function ready(){if(prepared)return copy(prepared);let state=E.applyAction(create(),{type:'start-draft'},data);while(state.phase==='draft'){const turn=E.draftTurn(state);state=E.applyAction(state,{type:'draft-pick',factionId:turn.factionId,playerId:E.draftCandidates(state,data)[0].id},data);}while(state.phase==='reveal')state=E.applyAction(state,{type:'reveal-next'},data);prepared=copy(state);return state;}
function walk(value,fn){if(!value||typeof value!=='object')return;fn(value);for(const item of Object.values(value))walk(item,fn);}

test('new mystery cards expose player and decade, real eligible archive years and seed-independent archive estimates',()=>{
 const base=create(),started=E.applyAction(base,{type:'start-draft'},data),candidates=E.draftCandidates(started,data);
 assert(candidates.length>1000);const patrick=candidates.find(p=>p.identity==='player:QB:patrickmahomes'&&p.decade===2010);assert(patrick);
 assert.deepEqual(patrick.candidateYears,[2017,2018,2019]);assert.equal(patrick.referenceSeason,null);assert.equal(patrick.season,2025,'The card retains only the ruler origin in its legacy season field');
 assert(patrick.id.includes(':veil:'));assert(!Object.hasOwn(patrick,'scoringSeason'));assert(!Object.hasOwn(patrick,'revealedSeason'));
 for(const year of patrick.candidateYears)assert(Array.from({length:17},(_,i)=>data.logIndex.has(S.gameLogKey(patrick.identity,year,i+1))).some(Boolean));
 const changed={...started,seed:'a-different-private-seed'};assert.deepEqual(E.draftCandidates(changed,data),candidates,'The draft never ranks by the selected secret year');
 assert(E.draftCandidates(started,data,{decade:2010}).every(p=>p.decade===2010));
});

test('fixed assignments survive reload, score the actual selected year, and reject reassignment or impossible candidates',()=>{
 const state=ready(),before=copy(state),next=E.applyAction(copy(state),{type:'advance-week'},data);assert.deepEqual(state,before);
 for(const result of next.completedWeeks[0].factions)for(const player of result.players){const year=state.hiddenYears.assignments[player.id].season,log=data.logIndex.get(S.gameLogKey(player.identity,year,1));assert.equal(player.basePoints,log?S.scoreStatLine(log.stats,state.scoring,{}):0);assert.deepEqual(player.stats,log?M.numericStats(log.stats):null);}
 assert.deepEqual(next.hiddenYears.assignments,state.hiddenYears.assignments);
 const forged=copy(state),id=Object.keys(forged.hiddenYears.assignments).find(id=>forged.hiddenYears.assignments[id].candidateYears.length>1),entry=forged.hiddenYears.assignments[id];entry.season=entry.candidateYears.find(year=>year!==entry.season);assert.throws(()=>E.validateCampaign(forged,data),/fixed hidden scoring year was changed/);
 const impossible=copy(state),p=impossible.factions[0].armies[0].players[0];p.candidateYears=[p.decade];assert.throws(()=>E.validateCampaign(impossible,data));
 assert.throws(()=>E.applyAction(state,{type:'reveal-years',factionId:'egypt'},data),/final season recap/);
});

test('public snapshots contain no assignment map, seed, selected-season fields or future-card reveal; inference uses only explicitly viewed games',()=>{
 const state=E.applyAction(ready(),{type:'advance-week'},data),view=E.projectCampaign(state,'egypt',data),player=E.activeArmy(view.factions.find(f=>f.id==='egypt')).players[0];
 assert.equal(view.hiddenYears,undefined);assert.equal(view.seed,undefined);assert.equal(view.conquest.seed,undefined);
 walk(view,value=>{assert(!Object.hasOwn(value,'revealedSeason'));assert(!Object.hasOwn(value,'assignments'));if(M.isCard(value))assert.equal(value.referenceSeason,null);});
 const none=M.inspect(view,player,data,{throughWeek:0});assert.deepEqual(none.remaining,player.candidateYears);assert.equal(none.observed.length,0);
 const observed=M.inspect(view,player,data,{throughWeek:1});assert.equal(observed.observed.length,1);const actual=state.hiddenYears.assignments[player.id].season;assert(observed.remaining.includes(actual));
 for(const candidate of observed.candidates){const real=data.logIndex.get(S.gameLogKey(player.identity,candidate.year,1)),line=observed.observed[0];assert.equal(candidate.compatible,Boolean(real)===line.hasRecordedGame&&JSON.stringify(M.numericStats(real?.stats))===JSON.stringify(line.stats));}
 const result=state.completedWeeks[0].factions.find(f=>f.factionId==='egypt').players.find(p=>p.id===player.id);result.effectivePoints+=1000;assert.deepEqual(M.inspect(state,player,data,{throughWeek:1}).remaining,observed.remaining,'Offerings are not historical fingerprint evidence');
});

test('final recap reveals only played cards after each manager acknowledges; buried future years and another manager stay sealed',()=>{
 let state=ready();for(let week=1;week<=17;week++)state=E.applyAction(state,{type:'advance-week'},data);assert.equal(state.phase,'complete');
 let view=E.projectCampaign(state,'egypt',data);assert.equal(view.hiddenYearRevealAvailable,true);walk(view,value=>assert(!Object.hasOwn(value,'revealedSeason')));
 const played=new Set(state.completedWeeks.flatMap(w=>w.factions.flatMap(f=>f.players.map(p=>p.id))));
 state=E.applyAction(state,{type:'reveal-years',factionId:'egypt'},data);view=E.projectCampaign(state,'egypt',data);assert.equal(view.hiddenYearRevealAvailable,false);
 walk(view,value=>{if(M.isCard(value))assert.equal(value.revealedSeason,played.has(value.id)?state.hiddenYears.assignments[value.id].season:undefined);});
 walk(E.projectCampaign(state,'rome',data),value=>assert(!Object.hasOwn(value,'revealedSeason')));
 const before=copy(state.hiddenYears.assignments);state=E.applyAction(state,{type:'next-season'},data);assert.equal(state.dynastySeason,2);for(const [id,entry]of Object.entries(before))assert.deepEqual(state.hiddenYears.assignments[id],entry,'Surviving and retired cards keep their original assignment');
 assert.equal(E.validateCampaign(copy(state),data),true);
});

test('ritual recruits retain decade identity and a fixed assignment through the pending draw and acceptance',()=>{
 let state=ready();state.settings.favors=true;for(const faction of state.factions){faction.favorBalance=100;faction.treasuryOpening=100;} // Fixture starts with no spent favor.
 const before=copy(state.hiddenYears.assignments);state=E.applyAction(state,{type:'ritual',ritualId:'summon-mahdi',factionId:'egypt'},data);
 const own=state.factions.find(f=>f.id==='egypt'),pending=own.rituals.pendingMahdi.player;assert(M.isCard(pending));assert(state.hiddenYears.assignments[pending.id]);
 const army=E.activeArmy(own),slots=E.slotsOf(own),replacement=army.players.find(player=>E.bestLineup(army.players.filter(p=>p.id!==player.id).concat(pending),slots).length===slots.length);assert(replacement);state=E.applyAction(state,{type:'ritual',ritualId:'mahdi-accept',factionId:'egypt',replacementId:replacement.id,confirmed:true},data);
 assert(E.activeArmy(state.factions.find(f=>f.id==='egypt')).players.some(p=>p.id===pending.id&&M.isCard(p)));for(const [id,entry]of Object.entries(before))assert.deepEqual(state.hiddenYears.assignments[id],entry);
});

test('legacy historical and Resurrection keep their existing contracts',()=>{
 const legacy=create({era:{mode:'historical'}});assert.equal(M.enabled(legacy),false);assert.equal(legacy.hiddenYears,undefined);assert.deepEqual(legacy.era,{mode:'historical',scoringSeason:null});
 assert.throws(()=>create({era:{mode:'resurrection',scoringSeason:2026,hiddenYears:true}}),/not hidden historical years/);
 assert.throws(()=>create({era:{mode:'historical',hiddenYears:'yes'}}),/whether Historical Replay/);
});
test('archive expansion preserves acquired candidate snapshots and fixed years across later actions and reacquisition',()=>{
 const identity='player:QB:patrickmahomes',oldCards=copy(data.cards),card=oldCards.players.find(p=>p.identity===identity);assert(card);
 card.seasons=card.seasons.filter(season=>season.season!==2019);
 const oldLogs=new Map([...data.logIndex].filter(([,log])=>!(log.identity===identity&&log.season===2019))),oldData={...data,cards:oldCards,logIndex:oldLogs};
 const factionIds=create().factions.map(f=>f.id);
 let state=E.createCampaign({version:4,id:'archive-growth',name:'Archive snapshot',seed:'archive-growth',createdAt:'2026-09-15T12:00:00Z',seasons:[2025],hostFactionId:factionIds[0],humanFactionIds:factionIds,factionIds,settings:{leagueSize:8,mummyCount:1,bench:1,playoffTeams:4,favors:false,conquest:false},era:{mode:'historical',hiddenYears:true}},oldData);
 state=E.applyAction(state,{type:'start-draft'},oldData);
 const turn=E.draftTurn(state),picked=E.draftCandidates(state,oldData).find(p=>p.identity===identity&&p.decade===2010);assert(picked);assert.deepEqual(picked.candidateYears,[2017,2018]);
 state=E.applyAction(state,{type:'draft-pick',factionId:turn.factionId,playerId:picked.id},oldData);const assignment=copy(state.hiddenYears.assignments[picked.id]);
 assert.equal(E.validateCampaign(state,data),true,'A new real archive season must not invalidate a saved campaign');
 const fresh=M.pool(state,data,picked.season).find(p=>p.id===picked.id);assert.deepEqual(fresh.candidateYears,[2017,2018,2019]);
 const reacquired=M.snapshotCard(state,fresh,data);assert.deepEqual(reacquired.candidateYears,picked.candidateYears);assert.equal(reacquired.referencePoints,picked.referencePoints);assert.equal(M.scoringSeason(state,reacquired),assignment.season);
 const nextTurn=E.draftTurn(state);state=E.applyAction(state,{type:'draft-pick',factionId:nextTurn.factionId,playerId:E.draftCandidates(state,data)[0].id},data);
 assert.deepEqual(state.hiddenYears.assignments[picked.id],assignment);assert.deepEqual(state.factions.find(f=>f.id===turn.factionId).armies[0].players[0].candidateYears,[2017,2018]);
});
