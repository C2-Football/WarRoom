'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Weekly=require('../js/duat/weekly-flow.js'),Heptad=require('../js/duat/heptad.js'),Rules=require('../js/duat/rules.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
    const factions=Array.from({length:8},(_,i)=>{
        const id='f'+i,players=['QB','RB','RB','WR','TE','WR'].map((position,n)=>({id:id+'p'+n,identity:id+'p'+n,name:id+' Player '+n,position,season:2025,referencePoints:12,referenceSeason:2024}));
        return {id,name:'Faction '+i,roster:'duat',activeArmyId:id+'a',armies:[{id:id+'a',season:2025,players},{id:id+'b',season:2024,players:players.map(p=>({...p,id:p.id+'b',season:2024}))}],lineup:players.slice(0,5).map(p=>p.id),favorBalance:100,declaredFavors:[],rituals:{ledger:[],cooldowns:{}}};
    });
    return {version:4,expansionVersion:1,dynastySeason:1,phase:'season',week:1,seasons:[2025,2024],settings:{leagueSize:8,mummyCount:2,bench:1,playoffTeams:4,favors:true,conquest:false},expansionSettings:{heptad:{pool:'starters',duplicates:'allow',favorPoints:false}},factions,
        alliances:Array.from({length:4},(_,i)=>({id:'a'+i,name:'Alliance '+i,entry:i+1,teamIds:['f'+2*i,'f'+(2*i+1)]})),completedWeeks:[]};
}
function record(campaign,week,totals=[80,90,100,70,60,50,40,30],allianceTotals){
    const factions=campaign.factions.map((f,i)=>({factionId:f.id,season:2025,total:totals[i],baseTotal:totals[i],players:f.armies[0].players.map((p,n)=>({...p,starter:n<5,basePoints:n===0?20:10,effectivePoints:n===0?20:10,hasRecordedGame:true}))}));
    const allianceScores=Heptad.scoreWeek(campaign.alliances,factions,['QB','FLEX','FLEX','FLEX','FLEX'],campaign.expansionSettings.heptad);
    if(allianceTotals)allianceScores.forEach((a,i)=>{a.total=allianceTotals[i];});
    const row={week,factions,allianceScores};campaign.completedWeeks.push(row);
    row.heptad=Rules.runHeptadGauntlet(campaign.alliances,(id,w)=>campaign.completedWeeks.find(r=>r.week===w)?.allianceScores.find(a=>a.allianceId===id)?.total??null,2);
    campaign.week=week+1;return row;
}

test('recap requires an explicit completed week and respects actual field totals, ties and negative scores',()=>{
    const c=fixture(),row=record(c,1);const prior=copy(c),r=Weekly.outcome(c,'f0',1);
    assert.equal(r.allPlay.headline,'Winning week · 5–2 against the field');assert.equal(r.allPlay.place,3);assert.equal(r.allPlay.fieldSize,8);assert.equal(r.allPlay.points,80);
    for(const week of [undefined,0,2,18,1.5,'1'])assert.equal(Weekly.outcome(c,'f0',week),null);
    assert.equal(Weekly.describe({campaign:c,factionId:'f0',preparationWeek:2}).result,null);assert.deepEqual(c,prior);
    row.factions[1].total=80;assert.equal(Weekly.outcome(c,'f0',1).allPlay.headline,'Winning week · 5–1 against the field · 1 tied rival');
    row.factions.forEach((f,i)=>{f.total=i===0?-3:-4;});assert.equal(Weekly.outcome(c,'f0',1).allPlay.wins,7);assert.equal(Weekly.outcome(c,'f0',1).allPlay.points,-3);
    row.finalized=false;assert.equal(Weekly.outcome(c,'f0',1),null);
});

test('historical alliance recap is not changed by later wins, elimination, current bracket or Pinnacle results',()=>{
    const c=fixture();record(c,1);const before=Weekly.outcome(c,'f0',1);
    record(c,2,undefined,[10,100,80,90]);record(c,3,undefined,[10,70,100,90]);record(c,4,undefined,[10,100,80,90]);
    c.heptad={complete:true,championId:'a0',matches:[{week:17,homeId:'a0',awayId:'a1',winnerId:'a0',loserId:'a1'}]};c.pinnacle={result:{week:12,homeId:'a0',awayId:'a1'}};
    assert.deepEqual(Weekly.outcome(c,'f0',1),before);assert.equal(before.heptad.status,'idle');assert.equal(before.heptad.lives,2);assert.equal(before.heptad.next.week,2);
    const loss=Weekly.outcome(c,'f0',2).heptad;assert.equal(loss.status,'lost');assert.equal(loss.lives,1);
    const eliminated=Weekly.outcome(c,'f0',4).heptad;assert.equal(eliminated.status,'lost');assert.equal(eliminated.entryStatus,'eliminated');assert.equal(eliminated.lives,0);assert.equal(eliminated.next,null);
});

test('alliance entry, redemption fixtures, tied match and best-ball receipts use saved games only',()=>{
    const c=fixture();record(c,1);const intro=Weekly.allianceIntro(c,'f6');assert.equal(intro.startWeek,2);assert.equal(intro.entranceWeek,4);assert.equal(intro.partners[0].id,'f7');
    assert.equal(Weekly.heptadOutcome(c,'f6',1).next.opponentId,null);
    record(c,2,undefined,[50,50,80,90]);const tied=Weekly.heptadOutcome(c,'f0',2);assert(tied.tied);assert.equal(tied.status,'won');assert.equal(tied.lives,2);
    record(c,3,undefined,[10,70,100,90]);const awaiting=Weekly.heptadOutcome(c,'f2',3);assert.equal(awaiting.status,'idle');assert.equal(awaiting.next.week,4);assert.equal(awaiting.next.bracket,'bottom');assert.equal(awaiting.next.opponentId,'a0');
    assert.equal(awaiting.contributors.length,5);assert.equal(awaiting.mvp.points,20);assert.equal(Weekly.heptadOutcome(c,'f0',2).matchMvp.points,20);
});

test('Heavenly recap distinguishes advancing, tie-break defeat, championship and third place',()=>{
    const c=fixture(),row=record(c,16);row.heavenly={field:[{teamId:'f0',seed:1},{teamId:'f1',seed:2}],matches:[{week:16,round:'semifinal',homeId:'f0',awayId:'f1',homeScore:60,awayScore:60,winnerId:'f0',loserId:'f1'}]};
    const win=Weekly.outcome(c,'f0',16).playoff,loss=Weekly.outcome(c,'f1',16).playoff;assert(win.advanced&&win.tied&&!win.champion);assert.match(win.label,/better seed/);assert(loss.eliminated&&loss.tied);
    assert.equal(Weekly.outcome(c,'f2',16).playoff.status,'not-qualified');
    const final=record(c,17);final.heavenly={...copy(row.heavenly),matches:[...row.heavenly.matches,{week:17,round:'championship',homeId:'f0',awayId:'f2',homeScore:90,awayScore:70,winnerId:'f0',loserId:'f2'},{week:17,round:'third-place',homeId:'f1',awayId:'f3',homeScore:30,awayScore:20,winnerId:'f1',loserId:'f3'}]};
    assert(Weekly.outcome(c,'f0',17).playoff.champion);const third=Weekly.outcome(c,'f1',17).playoff;assert.equal(third.status,'won');assert(!third.advanced&&!third.champion);
    assert.equal(Weekly.outcome(c,'f0',16).playoff.champion,false);
});

test('early weeks cannot reveal a later playoff field and idle playoff weeks are not a loss',()=>{
    const c=fixture(),row=record(c,1);c.heavenly={field:[{teamId:'f0',seed:1},{teamId:'f1',seed:2}],championId:'f1'};
    assert.equal(Weekly.outcome(c,'f0',1).playoff.status,'not-started');
    row.heavenly={field:[{teamId:'f0',seed:1}],matches:[]};assert.equal(Weekly.outcome(c,'f0',1).playoff.status,'idle');
});

test('favor receipt separates player adjustments and Ebisu faction points from Heptad contributors',()=>{
    const c=fixture(),row=record(c,5);const own=row.factions[0];own.baseTotal=60;own.players[0].effectivePoints=40;own.total=90;own.teamAdjustment=10;own.favorCost=10;own.favors=[{favorId:'kratos-1',cost:10,delta:20},{ritualId:'ebisu-result',cost:0,delta:10}];
    const r=Weekly.outcome(c,'f0',5);assert.equal(r.favors.playerDelta,20);assert.equal(r.favors.teamAdjustment,10);assert.equal(r.favors.totalDelta,30);assert.equal(r.favors.spent,10);assert.equal(r.heptad.score.total,60);assert.equal(r.heptad.mvp.points,20);
    c.pinnacle={result:{week:5,homeId:'a0',awayId:'a1',winnerId:'a0'}};assert(Weekly.outcome(c,'f0',5).pinnacle);assert.equal(Weekly.outcome(c,'f6',5).pinnacle,null);
});

test('preseason guidance exposes usable rituals only and works on a projected campaign without a seed',()=>{
    const c=fixture(),pool=[{id:'recruit',season:2025}];let p=Weekly.preparation(c,'f0',1,{ritualCandidates:pool});
    assert.deepEqual(p.eligibleFavorIds,[]);assert.deepEqual(p.eligibleRitualIds,['summon-mahdi','anubis','shiva']);assert(p.lineupValid&&p.hasUsableOptions&&p.preseason);assert(!p.eligibleIds.includes('super-mahdi'));
    c.factions[0].rituals.cooldowns={mahdi:18,anubis:1};c.factions[0].armies[1].destroyed=true;p=Weekly.preparation(c,'f0',1,{ritualCandidates:pool});assert(!p.hasUsableOptions);
    c.settings.favors=false;c.settings.conquest=false;p=Weekly.preparation(c,'f0',1,{ritualCandidates:pool});assert.deepEqual(p.eligibleIds,[]);assert(!p.claims.actionable);
    assert(!Weekly.preparation(c,'f0',2).hasUsableOptions);
});

test('sacred guidance respects current budget, reserved costs, history and per-player eligibility',()=>{
    const c=fixture();record(c,4);const f=c.factions[0];f.favorBalance=20;f.rituals.ebisu={wager:10};f.declaredFavors=[{favorId:'kratos-1',playerId:'f0p0',cost:10}];
    let p=Weekly.preparation(c,'f0',5);assert.equal(p.availableFavor,0);assert.equal(p.reservedFavor,20);assert.deepEqual(p.eligibleTargets['kratos-1'],['f0p0']);assert(!p.eligibleIds.includes('kratos-2'));assert(p.eligibleIds.includes('ebisu'));assert(!p.eligibleIds.includes('midas'));
    f.rituals.ebisu=null;f.declaredFavors=[];f.favorBalance=100;f.armies[0].players[0].referenceSeason=null;c.completedWeeks[0].factions[0].players[1].hasRecordedGame=false;
    p=Weekly.preparation(c,'f0',5);assert(!p.eligibleTargets['patecatl-1'].includes('f0p0'));assert(!p.eligibleTargets['janus-2'].includes('f0p1'));assert(p.eligibleTargets['janus-2'].includes('f0p0'));assert(p.eligibleRitualIds.includes('midas'));assert(!p.eligibleIds.includes('mahdi'),'No loaded pool means no pretend recruit button');
});

test('pending Mahdi is mandatory, reroll budget-aware, and champion rewards stay with the champion',()=>{
    const c=fixture(),f=c.factions[0];f.rituals.pendingMahdi={ritualId:'summon-mahdi',rerolls:0};f.favorBalance=19;
    let p=Weekly.preparation(c,'f0',1);assert(p.pendingMahdi);assert.deepEqual(p.eligibleRitualIds,['mahdi-accept','mahdi-decline']);assert.match(p.notes[0],/Accept or decline/);
    f.favorBalance=20;assert(Weekly.preparation(c,'f0',1).eligibleIds.includes('mahdi-reroll'));f.rituals.pendingMahdi=null;c.phase='complete';c.week=18;c.championId='f0';
    p=Weekly.preparation(c,'f0',18,{ritualCandidates:[{id:'new',season:2023}]});assert.deepEqual(p.eligibleRitualIds,['plutus','amun']);assert.deepEqual(Weekly.preparation(c,'f1',18,{ritualCandidates:[{id:'new'}]}).eligibleRitualIds,[]);
    f.rituals.ledger=[{ritualId:'plutus',cycle:1},{ritualId:'amun',cycle:1}];f.favorBalance=10;assert(!Weekly.preparation(c,'f0',18,{ritualCandidates:[{id:'new'}]}).hasUsableOptions);
});
