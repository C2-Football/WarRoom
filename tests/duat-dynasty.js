'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const D=require('../js/duat/dynasty.js'), Legacy=require('../js/duat/campaign.js');
const R=require('../js/duat/rituals.js'), Conquest=require('../js/duat/conquest.js');
const Season=globalThis.App.TimeLeagueSeason;
const data={cards:JSON.parse(fs.readFileSync('data/duat/player-cards.json','utf8')),logIndex:Season.buildGameLogIndex(Season.parseGameLogCsv(fs.readFileSync('data/duat/nflverse-game-logs.csv','utf8')).logs)};
const clone=value=>JSON.parse(JSON.stringify(value));
function create(settings={},extra={}) {
    const rules=D.normalizeSettings({leagueSize:8,mummyCount:2,bench:1,playoffTeams:4,conquest:false,favors:false,...settings});
    return D.createCampaign({version:4,id:'dynasty-acceptance',seed:'dynasty-acceptance',name:'The continuing dynasty',createdAt:'2026-09-08T12:00:00Z',hostFactionId:'egypt',settings:rules,seasons:Array.from({length:rules.mummyCount},(_,i)=>2025-i),...extra},data);
}
const act=(state,action,source=data)=>D.applyAction(state,action,source);
function draft(state) {
    state=act(state,{type:'start-draft'});
    let guard=0;
    while(state.phase==='draft') {
        assert(guard++<5000,'Draft must finish within the configured pick count');
        const turn=D.draftTurn(state),pool=D.draftCandidates(state,data);assert(turn && pool.length,'Every pending army can still field a legal lineup');
        state=act(state,{type:'draft-pick',factionId:turn.factionId,playerId:pool[0].id});
    }
    return state;
}
function reveal(state) {while(state.phase==='reveal')state=act(state,{type:'reveal-next'});return state;}
const readyCache=new Map();
function ready(settings={},extra={}) {const id=JSON.stringify([settings,extra]);if(!readyCache.has(id))readyCache.set(id,reveal(draft(create(settings,extra))));return clone(readyCache.get(id));}
function claims(state) {for(const factionId of state.humanFactionIds){let guard=0;while(state.conquest.pendingClaims[factionId]>0){assert(guard++<100);const territoryId=Conquest.eligibleTerritories(state.conquest,factionId)[0];if(territoryId){state=act(state,{type:'claim',factionId,territoryId});continue;}const target=state.expansionSettings.conquestMode==='original'&&Conquest.attackableTerritories(state.conquest,factionId).find(id=>Conquest.previewAttack(state.conquest,{factionId,territoryId:id}).canAttack);if(!target)break;state=act(state,{type:'attack',factionId,territoryId:target});}}return state;}
function finish(state) {while(state.phase==='season')state=act(claims(state),{type:'advance-week'});assert.equal(state.phase,'complete');return state;}
function walk(state,id=state.hostFactionId) {return D.activeArmy(state.factions.find(f=>f.id===id));}
const endCache=new Map();
function ended(settings={},extra={}) {const id=JSON.stringify([settings,extra]);if(!endCache.has(id))endCache.set(id,finish(ready(settings,extra)));return clone(endCache.get(id));}

for(const leagueSize of [8,16])for(const mummyCount of [1,2,5])for(const roster of ['duat','classic','superflex']) {
    test(`v4 ${leagueSize} factions, ${mummyCount} mummies, ${roster}: complete real archive draft and scored opening week`,()=>{
        let state=ready({leagueSize,mummyCount,roster},{scoring:{passTd:6,reception:1,turnover:-2}});
        const expected=leagueSize*mummyCount*(D.ROSTERS[roster].slots.length+1);
        assert.equal(state.draft.cursor,expected);assert.equal(state.draft.queue.length,expected);
        assert.equal(state.dynasty.journal.length,leagueSize);assert(state.factions.every(f=>f.armies.every(a=>a.rulerName && !/^\d{4} Ruler$/.test(a.rulerName))));
        const oldWorld=clone(state.conquest);state=act(state,{type:'advance-week'});
        assert(D.validateCampaign(state));assert.deepEqual(state.conquest,oldWorld);
        for(const f of state.factions)assert(D.legalLineup(f,f.lineup));
        for(const f of state.completedWeeks[0].factions)for(const p of f.players)assert.equal(p.basePoints,p.stats?Season.scoreStatLine(p.stats,state.scoring,{}):0);
        assert(state.completedWeeks[0].factions.some(f=>f.total>0),'Real NFL games must produce nonzero scores');
    });
}

test('three complete dynasty seasons retire rulers permanently, preserve surviving tombs and archive actual champions',()=>{
    let state=ready(),allRetired=new Set();
    for(let cycle=1;cycle<=3;cycle++) {
        assert.equal(state.dynastySeason,cycle);
        for(const f of state.factions)assert(!allRetired.has(`${f.id}:${walk(state,f.id).rulerName}`),'A retired ruler may never return');
        const active=new Map(state.factions.map(f=>[f.id,clone(walk(state,f.id))]));
        const survivors=new Map(state.factions.map(f=>[f.id,clone(f.armies.filter(a=>a.id!==f.activeArmyId))]));
        state=finish(state);
        assert.equal(state.dynasty.seasons.length,cycle);assert.equal(state.dynasty.seasons.at(-1).championId,state.heavenly.championId);
        assert.equal(state.dynasty.seasons.at(-1).completedWeeks.length,17);
        assert.equal(state.heavenly.matches.find(m=>m.round==='championship').week,17);
        for(const f of state.factions)allRetired.add(`${f.id}:${active.get(f.id).rulerName}`);
        if(cycle===3)break;
        const before=clone(state);state=act(state,{type:'next-season'});
        assert.equal(before.phase,'complete','Continuing must not mutate the completed save');
        assert.equal(state.dynasty.retiredRulers.length,8*cycle);
        assert.equal(state.draft.totalPicks,8*D.rosterSize(state),'Only the new tomb needs a normal annual draft');
        for(const f of state.factions) {
            assert.equal(f.armies.length,2);
            for(const old of survivors.get(f.id))assert.deepEqual(f.armies.find(a=>a.id===old.id).players,old.players);
            assert(!f.armies.some(a=>a.id===active.get(f.id).id));
        }
        state=reveal(draft(state));assert.equal(state.dynasty.journal.length,8*(cycle+1));
    }
});

test('Shiva permanently shrinks the reserve, and the destroyed ruler cannot return in the following season',()=>{
    let state=ready({mummyCount:2,favors:true,bench:3}),original=clone(walk(state));
    state=act(state,{type:'ritual',ritualId:'shiva',confirmed:true});
    const faction=state.factions.find(f=>f.id===state.hostFactionId);
    assert.equal(faction.armies.find(a=>a.id===original.id).destroyed,true);assert.notEqual(faction.activeArmyId,original.id);
    assert.equal(D.livingArmies(faction).length,1);
    assert.throws(()=>act(state,{type:'ritual',ritualId:'shiva',confirmed:true}),/other legal buried army/);
    state=act(finish(state),{type:'next-season'});
    const next=state.factions.find(f=>f.id===state.hostFactionId);
    assert.equal(next.armies.length,1);assert(!next.armies.some(a=>a.rulerName===original.rulerName));
    assert(state.dynasty.retiredRulers.some(a=>a.id===original.id));
    state=reveal(draft(state));assert(D.validateCampaign(state));assert.equal(D.livingArmies(state.factions.find(f=>f.id===state.hostFactionId)).length,1);
});

test('Anubis transfers the actual player year, donor holes refill next draft, and scoring uses the transferred year',()=>{
    let state=ready({mummyCount:2,favors:true,bench:3}),faction=state.factions.find(f=>f.id===state.hostFactionId),active=walk(state),donor=faction.armies.find(a=>a.id!==active.id);
    const given=donor.players.find(p=>p.position!=='QB'),released=active.players.find(p=>!faction.lineup.includes(p.id));
    const donorId=donor.id,donorYear=donor.season;
    state=act(state,{type:'ritual',ritualId:'anubis',playerId:released.id,replacementId:given.id,confirmed:true});
    assert.equal(walk(state).players.find(p=>p.id===given.id).season,donorYear);
    assert.equal(state.factions.find(f=>f.id===faction.id).armies.find(a=>a.id===donorId).players.length,7);
    state=act(state,{type:'advance-week'});
    const result=state.completedWeeks[0].factions.find(f=>f.factionId===faction.id).players.find(p=>p.id===given.id);
    const actual=data.logIndex.get(Season.gameLogKey(given.identity,donorYear,1));
    assert.equal(result.basePoints,actual?Season.scoreStatLine(actual.stats,state.scoring,{}):0);
    state=act(finish(state),{type:'next-season'});
    assert.equal(state.draft.queue.filter(p=>p.armyId===donorId).length,1);
    assert.equal(state.draft.totalPicks,8*8+1);
    state=reveal(draft(state));
    const retained=state.factions.find(f=>f.id===faction.id).armies.find(a=>a.id===donorId);
    assert.equal(retained.players.length,8);assert(!retained.players.some(p=>p.id===released.id));assert(D.validateCampaign(state));
});

test('multiple offerings debit their exact shared treasury, preserve score receipts and cancel before changing targets',()=>{
    let state=ready({mummyCount:1,favors:true,favorBudget:100});while(state.week<5)state=act(state,{type:'advance-week'});
    const faction=state.factions.find(f=>f.id===state.hostFactionId),targets=faction.lineup.slice(0,2);
    state=act(state,{type:'declare-favor',favorId:'kratos-1',playerId:targets[0]});state=act(state,{type:'declare-favor',favorId:'horus-1',playerId:targets[1]});
    assert.equal(state.factions.find(f=>f.id===faction.id).declaredFavors.length,2);
    const before=clone(state);state=act(state,{type:'advance-week'});
    const result=state.completedWeeks.at(-1).factions.find(f=>f.factionId===faction.id);
    assert.equal(result.favors.length,2);assert.equal(result.favorCost,20);assert.equal(result.favorBalance,80);
    assert.equal(result.players.find(p=>p.id===targets[0]).effectivePoints,result.players.find(p=>p.id===targets[0]).basePoints*2);
    assert.equal(state.treasuryLedger.filter(e=>e.factionId===faction.id).at(-1).delta,-20);
    assert.equal(before.factions.find(f=>f.id===faction.id).favorBalance,100);
});

test('sealed multiplayer projections disclose no rival tomb names, player picks or pending Mahdi results',()=>{
    let state=create({mummyCount:2,favors:true},{humanFactionIds:['egypt','rome']});
    const waiting=D.projectCampaign(state,'rome',data);assert.equal(waiting.factions.find(f=>f.id==='egypt').armies.length,0);assert.equal(waiting.seed,undefined);assert.equal(waiting.conquest.seed,undefined);
    state=reveal(draft(state));
    state=act(state,{type:'ritual',ritualId:'summon-mahdi',factionId:'egypt',position:'WR'});
    const own=D.projectCampaign(state,'egypt',data),rival=D.projectCampaign(state,'rome',data),privatePlayer=own.factions.find(f=>f.id==='egypt').rituals.pendingMahdi.player;
    assert(privatePlayer);assert.equal(rival.factions.find(f=>f.id==='egypt').rituals,null);
    for(const army of rival.factions.find(f=>f.id==='egypt').armies.filter(a=>a.sealed)){assert.equal(army.players.length,0);assert.equal(army.rulerName,undefined);}
    assert(!rival.ritualCandidates.some(p=>p.id===privatePlayer.id),'A pending opponent draw must be reserved and not offered to another manager');
    assert(!rival.draft.picks.filter(p=>p.factionId==='egypt').some(p=>p.playerId || p.playerName));
    assert(!rival.activity.some(e=>e.type==='ritual'&&e.factionId==='egypt'));
});

test('simultaneous Mahdi draws reserve rival cards while the owner can accept the exact paid reroll once',()=>{
    let state=ready({mummyCount:2,favors:true,bench:3},{humanFactionIds:['egypt','rome']});
    const own=()=>state.factions.find(f=>f.id==='egypt'),rival=()=>state.factions.find(f=>f.id==='rome');
    state=act(state,{type:'ritual',ritualId:'summon-mahdi',factionId:'egypt',position:'WR'});
    state=act(state,{type:'ritual',ritualId:'summon-mahdi',factionId:'rome',position:'WR'});
    const rivalDraw=clone(rival().rituals.pendingMahdi),balance=own().favorBalance;
    state=act(state,{type:'ritual',ritualId:'mahdi-reroll',factionId:'egypt'});
    const finalDraw=clone(own().rituals.pendingMahdi),before=clone(state),ledgerLength=state.treasuryLedger.length;
    assert.equal(own().favorBalance,balance-20);assert.equal(finalDraw.rerolls,1);
    assert.notEqual(finalDraw.player.id,rivalDraw.player.id,'Simultaneous reservations cannot draw the same season card');
    assert(D.ritualCandidates(state,data,'egypt').some(p=>p.id===finalDraw.player.id),'The owner must retain access to the stored final draw');
    assert(!D.ritualCandidates(state,data,'rome').some(p=>p.id===finalDraw.player.id),'Rivals must not see or recruit the reserved card');
    assert(!D.ritualCandidates(state,data,'egypt').some(p=>p.id===rivalDraw.player.id));
    assert.throws(()=>act(state,{type:'ritual',ritualId:'mahdi-accept',factionId:'egypt',replacementId:walk(state,'rome').players[0].id,confirmed:true}),{code:'RITUAL_REPLACE'});
    assert.deepEqual(state,before,'An invalid release must leave both draws and treasuries untouched');
    const release=walk(state).players.find(p=>!own().lineup.includes(p.id));assert(release);
    const acceptance={type:'ritual',ritualId:'mahdi-accept',factionId:'egypt',replacementId:release.id,confirmed:true};
    state=act(state,acceptance);
    assert.equal(own().rituals.pendingMahdi,null);assert.deepEqual(rival().rituals.pendingMahdi,rivalDraw);
    assert(walk(state).players.some(p=>p.id===finalDraw.player.id&&p.season===finalDraw.season));
    assert(!walk(state).players.some(p=>p.id===release.id));assert(D.legalLineup(own(),own().lineup));
    assert.equal(own().favorBalance,balance-20);assert.equal(state.treasuryLedger.length,ledgerLength,'Acceptance must not debit the reroll again');
    assert.equal(state.factions.flatMap(f=>f.armies.flatMap(a=>a.players)).filter(p=>p.id===finalDraw.player.id).length,1);
    assert(!D.ritualCandidates(state,data,'rome').some(p=>p.id===finalDraw.player.id),'After acceptance, global roster ownership still excludes the card');
    assert.throws(()=>act(state,acceptance),{code:'MAHDI_PENDING'},'A second logical acceptance cannot add a second card');
    assert(D.validateCampaign(state));
});

test('malformed imports cannot rewrite future draft authority, reuse retired rulers or forge reveal dice',()=>{
    const waiting=create(),active=ready(),next=act(ended(),{type:'next-season'});
    const cases=[
        [waiting,s=>s.draft.queue[0].factionId='not-a-faction'],
        [waiting,s=>s.draft.queue[0].armyId=s.factions[1].armies[0].id],
        [active,s=>s.factions[0].rulerRoll=0],
        [active,s=>s.factions[0].armies[0].rollBand={min:1,max:20}],
        [next,s=>s.factions[0].armies.at(-1).rulerName=s.dynasty.retiredRulers.find(r=>r.factionId===s.factions[0].id).rulerName],
        [active,s=>s.treasuryLedger.push({factionId:'unknown',cycle:1,delta:500,balance:500})]
    ];
    for(const [base,change] of cases){const invalid=clone(base);change(invalid);assert.throws(()=>D.validateCampaign(invalid),{code:'INVALID_CAMPAIGN'});}
});

test('a missing entire historical-year dataset stops resolution instead of recording fabricated zero weeks',()=>{
    const state=ready(),incomplete={...data,logIndex:new Map()};
    assert.throws(()=>act(state,{type:'advance-week'},incomplete),error=>['INCOMPLETE_DATA','DATA_UNAVAILABLE','INVALID_DATA'].includes(error.code));
    assert.equal(state.completedWeeks.length,0);
    const required=D.requiredYears(state)[0],partial={...data,logIndex:new Map([...data.logIndex].filter(([,log])=>!(log.season===required&&log.week===17)))};
    assert(partial.logIndex.size>0&&partial.logIndex.size<data.logIndex.size,'Keep other real game data while removing only one required final week');
    assert.throws(()=>act(state,{type:'advance-week'},partial),{code:'INCOMPLETE_DATA'});
});

test('version three remains delegated to its prior reducer with no dynasty state or altered results',()=>{
    const input={version:3,id:'old-rules',seed:'old-rules',name:'Existing campaign',hostFactionId:'egypt',createdAt:'2026-09-08T12:00:00Z',settings:Legacy.normalizeSettings({leagueSize:8,mummyCount:1,bench:1,favors:false,conquest:false}),seasons:[2025]};
    const old=Legacy.createCampaign(input,data),throughNew=D.createCampaign(input,data);
    assert.deepEqual(throughNew,old);assert.equal(throughNew.dynasty,undefined);
    assert.deepEqual(D.applyAction(old,{type:'start-draft'},data),Legacy.applyAction(old,{type:'start-draft'},data));
});
test('final Original conquest remains playable, must settle before succession, and persists the actual finished domain',()=>{
    let state=create({mummyCount:1,conquest:true},{expansionSettings:{worldScale:'provinces',conquestMode:'original'}});
    state.humanFactionIds=state.factions.map(f=>f.id);state.factions.forEach(f=>f.controller='human');
    state=finish(reveal(draft(state)));const unresolved=D.unresolvedClaims(state);
    assert(unresolved.length,'At least the actual final winner must have an earned final conquest');
    assert.throws(()=>act(state,{type:'next-season'}),{code:'CLAIMS_PENDING'});
    const oldResults=clone(state.completedWeeks),oldSeason=clone(state.dynasty.seasons[0]);state=claims(state);
    assert.deepEqual(state.completedWeeks,oldResults,'Final conquest cannot change the football results');
    const finalLand=Object.fromEntries(state.factions.map(f=>[f.id,Object.values(state.conquest.owners).filter(id=>id===f.id).length]));
    assert.deepEqual(state.dynasty.seasons[0].landTotals,finalLand);assert.notDeepEqual(finalLand,oldSeason.landTotals);
    const owners=clone(state.conquest.owners);state=act(state,{type:'next-season'});
    assert.equal(state.dynastySeason,2);assert.deepEqual(state.conquest.owners,owners);assert.deepEqual(state.dynasty.seasons[0].landTotals,finalLand);
});
test('alliance names lock with the first scored week and jsonb object-key order preserves a valid save',()=>{
    let state=ready();state=act(state,{type:'name-alliance',name:'The Bronze Companions'});state=act(state,{type:'advance-week'});
    assert.throws(()=>act(state,{type:'name-alliance',name:'A rewritten history'}),{code:'NAME_LOCKED'});
    const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
    assert(D.validateCampaign(reorder(state)));assert(D.validateCampaign(reorder(ended())));
});
