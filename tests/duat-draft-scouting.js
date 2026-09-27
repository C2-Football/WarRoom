'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Legacy=require('../js/duat/campaign.js'),Engine=require('../js/duat/dynasty.js'),Season=globalThis.App.TimeLeagueSeason;
const data={cards:JSON.parse(fs.readFileSync('data/duat/player-cards.json','utf8')),manifest:JSON.parse(fs.readFileSync('data/duat/manifest.json','utf8'))};
data.logIndex=Season.buildGameLogIndex(Season.parseGameLogCsv(fs.readFileSync('data/duat/nflverse-game-logs.csv','utf8')).logs);
const clone=value=>JSON.parse(JSON.stringify(value));
const source=hiddenYears=>Engine.applyAction(Engine.createCampaign({version:4,id:'research-room',name:'Public scouting',seed:'private-seed',createdAt:'2026-09-26T12:00:00Z',hostFactionId:'egypt',humanFactionIds:['egypt','rome'],seasons:[2025,2024],settings:{leagueSize:8,mummyCount:2,bench:1,playoffTeams:4,conquest:false,favors:false},era:{mode:'historical',hiddenYears}},data),{type:'start-draft'},data);
for(const hiddenYears of [false,true])test(`between-pick ${hiddenYears?'mystery':'known-year'} research is invariant to rival identities, picks, private assignments and seed`,()=>{
 const state=source(hiddenYears),turn=Engine.draftTurn(state),viewer=state.humanFactionIds.find(id=>id!==turn.factionId);
 const before=Engine.draftScouting(state,viewer,data);assert(before.rows.length>100);assert.equal(before.availability,'unconfirmed');
 assert(before.rows.every(player=>player.researchOnly&&player.canDraft===false&&player.availability==='unconfirmed'));
 const altered=clone(state);altered.seed='a-different-private-seed';
 for(const faction of altered.factions)if(faction.id!==viewer){for(const army of faction.armies){army.players=[{...before.rows.at(-1),name:'PRIVATE_RIVAL_NAME',referencePoints:987654}];}faction.rituals={banishedPlayerIds:[before.rows[0].id]};}
 altered.draft.picks.push({number:999,factionId:turn.factionId,playerId:before.rows[0].id,playerName:'PRIVATE_RIVAL_NAME'});
 if(hiddenYears)altered.hiddenYears.assignments[before.rows[0].id]={season:before.rows[0].candidateYears.at(-1),candidateYears:[9999]};
 assert.deepEqual(Engine.draftScouting(altered,viewer,data),before,'Count, row order, ranks, fields and labels cannot encode private selections');
 const projected=Engine.projectCampaign(state,viewer,data);assert.deepEqual(projected.draft.candidates,[]);assert.deepEqual(projected.draft.scouting,before);
 assert.equal(projected.hiddenYears,undefined);assert.equal(projected.seed,undefined);
 const keys=new Set(['id','identity','name','position','season','referenceSeason','referencePoints','decade','candidateYears','mysteryCycle','researchOnly','availability','canDraft']);
 for(const row of projected.draft.scouting.rows)for(const key of Object.keys(row))assert(keys.has(key),'Unexpected scouting field '+key);
 assert(!JSON.stringify(projected.draft.scouting).includes('PRIVATE_RIVAL_NAME'));
 const noPrivateReads=clone(state);for(const key of ['seed','hiddenYears'])Object.defineProperty(noPrivateReads,key,{get(){throw new Error('Private '+key+' read');}});
 for(const faction of noPrivateReads.factions)if(faction.id!==viewer)Object.defineProperty(faction,'armies',{get(){throw new Error('Rival army read');}});
 assert.deepEqual(Engine.draftScouting(noPrivateReads,viewer,data),before);
});
test('historical research uses the next own army, excludes current/future results and never depends on rival availability',()=>{
 const state=source(false),viewer=state.hostFactionId,next=state.draft.queue.slice(state.draft.cursor).find(pick=>pick.factionId===viewer),research=Engine.draftScouting(state,viewer,data);
 assert.equal(research.armyId,next.armyId);assert.equal(research.nextPick,next.number);assert.equal(research.season,next.season);
 assert(research.rows.every(player=>player.referenceSeason===null||player.referenceSeason<research.season));
 const changed=clone(data.cards);for(const card of changed.players)for(const season of card.seasons)if(season.season>=research.season){season.points=999999;season.passTd=99999;}
 assert.deepEqual(Engine.draftScouting(state,viewer,{...data,cards:changed}),research);
 const previous=clone(state);previous.phase='reveal';assert.equal(Engine.draftScouting(previous,viewer,data),null);
 assert.equal(Engine.draftScouting(state,viewer,null),null);
 assert.throws(()=>Engine.draftScouting(state,'not-a-faction',data));
});
test('legacy campaigns receive the same public-only between-pick contract without changing legal candidates',()=>{
 const state=Legacy.applyAction(Legacy.createCampaign({id:'legacy-research',name:'Legacy research',seed:'private-seed',createdAt:'2026-09-26T12:00:00Z',seasons:[2024,2023,2022,2021],hostFactionId:'egypt',humanFactionIds:['egypt','rome']},data),{type:'start-draft'},data);
 const turn=Legacy.draftTurn(state),viewer=state.humanFactionIds.find(id=>id!==turn.factionId),research=Legacy.draftScouting(state,viewer,data),before=Legacy.draftCandidates(state,data);
 assert(research.rows.length>100);assert(research.rows.every(row=>row.canDraft===false&&(!row.referenceSeason||row.referenceSeason<research.season)));
 const changed=clone(state);for(const faction of changed.factions)if(faction.id!==viewer)for(const army of faction.armies)army.players=[];
 assert.deepEqual(Legacy.draftScouting(changed,viewer,data),research);
 const projected=Legacy.projectCampaign(state,viewer,data);assert.deepEqual(projected.draft.scouting,research);assert.deepEqual(projected.draft.candidates,[]);
 assert.deepEqual(Legacy.draftCandidates(state,data),before);
});
