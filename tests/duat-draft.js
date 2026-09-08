'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const Campaign=require('../js/duat/campaign.js');
const World=require('../js/duat/world.js');
const Conquest=require('../js/duat/conquest.js');
const Season=globalThis.App.TimeLeagueSeason;
const root=path.resolve(__dirname,'..');
const cards=JSON.parse(fs.readFileSync(path.join(root,'data/duat/player-cards.json'),'utf8'));
const logs=Season.parseGameLogCsv(fs.readFileSync(path.join(root,'data/duat/nflverse-game-logs.csv'),'utf8')).logs;
const data={cards,logIndex:Season.buildGameLogIndex(logs)};
const copy=value=>JSON.parse(JSON.stringify(value));
const input={id:'draft-fixture',name:'The Persian excavation',seed:'duat-human-draft-v2',createdAt:'2026-09-08T18:00:00.000Z',
    seasons:[2024,2023,2022,2021],hostFactionId:'persia'};
const create=overrides=>Campaign.createCampaign({...input,...overrides},data);
const act=(state,action,source=data)=>Campaign.applyAction(state,action,source);
let drafted;
function completeDraft(){
    if(drafted)return copy(drafted);
    let state=act(create(),{type:'start-draft',factionId:input.hostFactionId}),humanPicks=0;
    while(state.phase==='draft'){
        const turn=Campaign.draftTurn(state),candidate=Campaign.draftCandidates(state,data)[0];
        assert.equal(turn.factionId,input.hostFactionId);
        state=act(state,{type:'draft-pick',factionId:turn.factionId,playerId:candidate.id});humanPicks++;
        assert.equal(Campaign.validateCampaign(state),true);
    }
    assert.equal(humanPicks,32);drafted=state;return copy(state);
}
function revealAll(){let state=completeDraft();while(state.phase==='reveal')state=act(state,{type:'reveal-next',factionId:state.hostFactionId});return state;}
function claimHumans(state){
    for(const id of state.humanFactionIds)while(state.conquest.pendingClaims[id]>0){
        const territoryId=Conquest.eligibleTerritories(state.conquest,id)[0];if(!territoryId)break;
        state=act(state,{type:'claim',factionId:id,territoryId});
    }
    return state;
}

test('new campaigns start with empty draftable armies and fourteen selected world factions',()=>{
    const state=create();assert.equal(state.version,2);assert.equal(state.phase,'draft');assert.equal(state.draft.status,'waiting');
    assert.equal(state.factions.length,14);assert(state.factions.some(f=>f.id==='persia'));assert.equal(state.alliances.length,7);
    assert.equal(state.factions.flatMap(f=>f.armies.flatMap(a=>a.players)).length,0);
    assert.equal(state.conquest.worldId,World.WORLD_ID);assert.equal(Campaign.validateCampaign(state),true);
    assert.throws(()=>create({factionIds:World.FACTIONS.slice(0,13).map(f=>f.id)}),{code:'INVALID_FACTIONS'});
    assert.throws(()=>create({factionIds:Array(14).fill('persia')}),{code:'INVALID_FACTIONS'});
    assert.throws(()=>create({version:3}),{code:'INVALID_VERSION'});
    assert.throws(()=>create({factionIds:World.FACTIONS.slice(0,14).map(f=>f.id)}),{code:'INVALID_FACTIONS'});
    assert.throws(()=>act(state,{type:'start-draft',factionId:state.factions[1].id}),{code:'HOST_REQUIRED'});
    assert.throws(()=>act(state,{type:'reveal-next'}),{code:'INVALID_PHASE'});
});

test('human picks drive a real snake draft; AI stops at the next human and cannot steal a turn',()=>{
    const second='egypt';let state=act(create({humanFactionIds:[second]}),{type:'start-draft'});
    for(let i=0;i<8;i++){
        const turn=Campaign.draftTurn(state),other=state.humanFactionIds.find(id=>id!==turn.factionId);
        assert(state.humanFactionIds.includes(turn.factionId));
        const options=Campaign.draftCandidates(state,data);assert(options.length>20);
        const before=copy(state);
        assert.throws(()=>act(state,{type:'draft-pick',factionId:other,playerId:options[0].id}),{code:'DRAFT_TURN'});
        assert.throws(()=>act(state,{type:'draft-pick',factionId:turn.factionId,playerId:'forged:2024'}),{code:'INVALID_PICK'});
        assert.deepEqual(state,before);
        state=act(state,{type:'draft-pick',factionId:turn.factionId,playerId:options[0].id});
        assert(!Campaign.draftCandidates(state,data).some(p=>p.id===options[0].id));
        assert.equal(Campaign.validateCampaign(state),true);
    }
});

test('draft eligibility reserves legal quarterback and skill capacity; every completed army is distinct and playable',()=>{
    const state=completeDraft();assert.equal(state.draft.cursor,448);assert.equal(state.draft.picks.length,448);
    const players=state.factions.flatMap(f=>f.armies.flatMap(a=>a.players));assert.equal(new Set(players.map(p=>p.id)).size,448);
    for(const faction of state.factions)for(const army of faction.armies){
        assert.equal(army.players.length,8);assert(army.players.some(p=>p.position==='QB'));
        assert(army.players.filter(p=>p.position!=='QB').length>=4);
    }
    const altered=copy(state);altered.draft.picks[0].factionId=altered.draft.order[1];
    assert.throws(()=>Campaign.validateCampaign(altered),{code:'INVALID_CAMPAIGN'});
    const duplicate=copy(state);duplicate.factions[0].armies[0].players[0]=copy(duplicate.factions[1].armies[0].players[0]);
    assert.throws(()=>Campaign.validateCampaign(duplicate),{code:'INVALID_CAMPAIGN'});
});

test('draft choices and AI estimates never inspect the current or future season results',()=>{
    const changedCards=copy(cards);for(const card of changedCards.players)for(const season of card.seasons)if(season.season>=2024)season.points=999999;
    const changedLogs=new Map([...data.logIndex].map(([key,row])=>[key,{...row,stats:{...row.stats,passTd:999}}]));
    const changed={cards:changedCards,logIndex:changedLogs};
    const normal=act(create(),{type:'start-draft'});
    const altered=act(Campaign.createCampaign(input,changed),{type:'start-draft'},changed);
    assert.deepEqual(altered,normal);assert.deepEqual(Campaign.draftCandidates(altered,changed),Campaign.draftCandidates(normal,data));
    for(const player of Campaign.draftCandidates(normal,data)){
        assert(!('allocationWeight' in player));assert(!('fantasyPoints' in player));assert(!('stats' in player));
        assert(player.referenceSeason===null||player.referenceSeason<player.season);
    }
});

test('online draft projection hides rival picks and random seeds; only the active human receives safe candidates',()=>{
    const state=act(create({humanFactionIds:['egypt']}),{type:'start-draft'}),turn=Campaign.draftTurn(state);
    const active=Campaign.projectCampaign(state,turn.factionId,data),otherId=state.humanFactionIds.find(id=>id!==turn.factionId);
    const other=Campaign.projectCampaign(state,otherId,data);
    assert(active.draft.candidates.length);assert.deepEqual(other.draft.candidates,[]);
    for(const view of [active,other]){
        assert.equal(view.seed,undefined);assert.equal(view.conquest.seed,undefined);
        const own=view===active?turn.factionId:otherId;
        for(const f of view.factions)if(f.id!==own)assert.deepEqual(f.armies,[]);
        for(const pick of view.draft.picks)if(pick.factionId!==own){assert.equal(pick.sealed,true);assert.equal(pick.playerId,undefined);assert.equal(pick.playerName,undefined);}
    }
});

test('archaeology reveals exactly one team per host step and opens Week 1 only after all fourteen',()=>{
    let state=completeDraft();assert.equal(Campaign.revealProgress(state).revealedCount,0);
    assert.throws(()=>act(state,{type:'reveal-rulers'}),{code:'INVALID_PHASE'});
    for(let count=1;count<=14;count++){
        const nextId=Campaign.revealProgress(state).nextFactionId;
        state=act(state,{type:'reveal-next',factionId:state.hostFactionId});
        const progress=Campaign.revealProgress(state),latest=progress.latest;
        assert.equal(progress.revealedCount,count);assert.equal(latest.factionId,nextId);assert.equal(latest.players.length,8);
        assert(latest.narration.lines.length>=3);assert(state.seasons.includes(latest.season));
        assert.equal(state.phase,count===14?'season':'reveal');assert.equal(Campaign.validateCampaign(state),true);
        const view=Campaign.projectCampaign(state,state.hostFactionId,data);
        for(const faction of view.factions)if(faction.id!==state.hostFactionId){
            assert.equal(faction.armies.length,state.archaeology.revealedFactionIds.includes(faction.id)?4:0);
            assert.deepEqual(faction.lineup,[]);
        }
    }
    assert.equal(Campaign.revealProgress(state).complete,true);
    const projected=Campaign.projectCampaign(state,state.hostFactionId,data);projected.archaeology.progress.latest.players[0].name='Changed outside the save';
    assert.notEqual(state.archaeology.latest.players[0].name,'Changed outside the save');
    const malformed=copy(state);malformed.archaeology.latest.players=[];assert.throws(()=>Campaign.validateCampaign(malformed),{code:'INVALID_CAMPAIGN'});

    assert.throws(()=>act(state,{type:'reveal-next'}),{code:'INVALID_PHASE'});
});

test('drafted armies play seventeen actual-data weeks with AI country battles, fortification and conserved favor spending',()=>{
    let state=revealAll();
    while(state.week<=17){state=claimHumans(state);state=act(state,{type:'advance-week'});assert.equal(Campaign.validateCampaign(state),true);}
    assert.equal(state.phase,'complete');assert(state.championId);assert.equal(state.completedWeeks.length,17);assert.equal(state.playoffField.length,7);
    for(const week of state.completedWeeks)for(const faction of week.factions)for(const player of faction.players){
        const row=data.logIndex.get(Season.gameLogKey(player.identity,faction.season,week.week));
        assert.equal(player.basePoints,row?Season.scoreStatLine(row.stats,Campaign.SCORING,{}):0);
    }
    assert(state.conquest.events.some(e=>e.type==='battle'&&!state.humanFactionIds.includes(e.factionId)));
    assert(state.conquest.events.some(e=>e.type==='fortify'&&!state.humanFactionIds.includes(e.factionId)));
    for(const faction of state.factions)assert.equal(state.conquest.owners[state.conquest.homes[faction.id]],faction.id);
    const saved=JSON.parse(JSON.stringify(state));assert.equal(Campaign.validateCampaign(saved),true);
});
