'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Availability=require('../js/duat/favor-availability.js'),Engine=require('../js/duat/dynasty.js'),Rituals=require('../js/duat/rituals.js'),Favors=require('../js/duat/favors.js');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(){
    const players=['QB','RB','RB','WR','TE','WR'].map((position,i)=>({id:'p'+i,identity:'p'+i,name:'Player '+i,position,season:2025,referencePoints:12,referenceSeason:2024}));
    return {id:'availability',version:4,expansionVersion:1,dynastySeason:1,phase:'season',week:5,seasons:[2025,2024],settings:{favors:true,bench:1},completedWeeks:[],factions:[{id:'egypt',roster:'duat',activeArmyId:'a',armies:[{id:'a',players,season:2025},{id:'b',season:2024,players:players.map(p=>({...p,id:p.id+'b',season:2024}))}],lineup:players.slice(0,5).map(p=>p.id),favorBalance:100,declaredFavors:[],rituals:{ledger:[],cooldowns:{}}}]};
}
const recruits=()=>['WR','QB','RB'].map((position,i)=>({id:'new'+i,identity:'new'+i,name:'Recruit '+i,position,season:2025,referencePoints:10,referenceSeason:2024}));
const describe=(c,selection={},extra={})=>Availability.describe({campaign:c,factionId:'egypt',availablePlayers:recruits(),selection,...extra});
function record(c,week,changes={}){c.completedWeeks.push({week,factions:[{factionId:'egypt',players:c.factions[0].armies[0].players.map(p=>({...p,basePoints:10,hasRecordedGame:true,...changes[p.id]}))}]});}

test('browsing is pure, seed-free and never invokes a ritual or resolves future scores',()=>{
    const c=fixture();record(c,4);const before=copy(c),sandbox={App:{DuatCampaign:{...Engine,applyAction(){throw Error('Browsing must not change the campaign');}},DuatFavors:{...Favors,applyFavor(){throw Error('Browsing must not resolve scores');},applyFavors(){throw Error('Browsing must not resolve scores');}},DuatRituals:{...Rituals,applyAction(){throw Error('Browsing must not roll');},seededRoll(){throw Error('Browsing must not roll');}}}};
    vm.runInNewContext(fs.readFileSync('js/duat/favor-availability.js','utf8'),sandbox);
    const result=sandbox.App.DuatFavorAvailability.describe({campaign:c,factionId:'egypt',availablePlayers:recruits(),selection:{favorId:'mahdi',position:'WR'}});
    assert(result.selected.available);assert.deepEqual(c,before);assert.equal(c.seed,undefined);
    c.factions[0].armies[0].players.forEach(p=>{p.hasRecordedGame=true;});const recorded=describe(c).byId;
    c.factions[0].armies[0].players.forEach(p=>{p.hasRecordedGame=false;});assert.deepEqual(describe(c).byId,recorded,'Current archived attendance must not influence the planning screen');
    assert(recorded['horus-1'].available&&recorded['patecatl-1'].available);
    delete c.factions[0].armies[0].players[0].referenceSeason;assert(!describe(c).byId['patecatl-1'].targetIds.includes('p0'));
});

test('reservation replacement credits only the same starter in expanded games and the whole single favor in legacy games',()=>{
    const c=fixture(),f=c.factions[0];f.favorBalance=20;f.declaredFavors=[{favorId:'kratos-1',playerId:'p0',cost:999}];f.rituals.ebisu={wager:10};
    let result=describe(c,{favorId:'kratos-1',target:'p0'});assert.equal(result.reserved,20);assert.equal(result.availableFavor,0);assert(result.selected.available);assert.deepEqual(result.byId['kratos-1'].targetIds,['p0']);
    assert(!describe(c,{favorId:'kratos-1',target:'p1'}).selected.available);assert.deepEqual(result.byId.ebisu.wagerAmounts,[10]);assert(describe(c,{favorId:'ebisu',wager:10}).selected.available);
    assert(!describe(c,{favorId:'ebisu',wager:25}).selected.available);
    for(const version of [1,2,3]){const old=fixture();old.version=version;delete old.expansionVersion;old.factions[0].favorBalance=20;old.factions[0].declaredFavor={favorId:'kratos-2',playerId:'p0'};const legacy=describe(old,{favorId:'kratos-2',target:'p1'});assert(legacy.selected.available);assert.equal(legacy.reserved,20);assert.equal(Object.keys(legacy.byId).length,7);assert(!legacy.byId.mahdi&&!legacy.byId.nyx);}
});

test('Janus offers only the selected player’s exact finalized earlier records, including previous-week restrictions',()=>{
    const c=fixture();record(c,1);record(c,2,{p0:{hasRecordedGame:false}});record(c,3,{p0:{basePoints:NaN}});record(c,4,{p1:{hasRecordedGame:false}});record(c,5);record(c,6);
    let r=describe(c,{favorId:'janus-3',target:'p0',sourceWeek:1});assert(r.selected.available);assert.deepEqual(r.selected.sourceWeeks,[1,4]);assert.deepEqual(r.byId['janus-2'].sourceWeeksByTarget.p0,[4]);assert(!r.byId['janus-2'].targetIds.includes('p1'));
    assert(!describe(c,{favorId:'janus-3',target:'p0',sourceWeek:2}).selected.available);assert(!describe(c,{favorId:'janus-3',target:'p0',sourceWeek:5}).selected.available);
    c.completedWeeks[3].status='pending';assert(!describe(c).byId['janus-2'].available);c.completedWeeks[3].status='scheduled';assert(!describe(c).byId['janus-2'].available);delete c.completedWeeks[3].status;
    c.completedWeeks.push(copy(c.completedWeeks[3]));assert(!describe(c).byId['janus-2'].available,'Duplicate week records are ambiguous');
});

test('every controller and lifecycle lock disables invocation without hiding the catalog',()=>{
    const c=fixture();for(const flag of ['ready','busy','dirty','readOnly']){const r=describe(c,{favorId:'kratos-1',target:'p0'},{[flag]:true});assert(r.lockReason);assert(!r.selected.available);assert(Object.values(r.byId).every(x=>!x.available));}
    c.week=2;assert(!describe(c).byId['kratos-1'].available);assert(!describe(c).byId.mahdi.available);c.week=1;assert(describe(c).byId['summon-mahdi'].available);assert(!describe(c).byId.mahdi.available);
    c.settings.favors=false;assert(Object.values(describe(c).byId).every(x=>!x.available));
});

test('roster sacrifices and transfers expose legal options and require explicit permanent confirmation',()=>{
    const c=fixture();let r=describe(c,{favorId:'midas',target:'p0',confirmed:true});assert(!r.selected.available);assert(!r.selected.targetIds.includes('p0'));assert(describe(c,{favorId:'midas',target:'p1',confirmed:true}).selected.available);assert(!describe(c,{favorId:'midas',target:'p1'}).selected.available);
    c.week=1;r=describe(c,{favorId:'anubis',target:'p0',replacement:'p1b',confirmed:true});assert(!r.selected.available);assert.deepEqual(r.selected.replacementIds,['p0b']);assert(describe(c,{favorId:'anubis',target:'p0',replacement:'p0b',confirmed:true}).selected.available);
    c.factions[0].rituals.banishedPlayerIdentities=['p0'];assert(!describe(c).byId.anubis.targetIds.includes('p0'));c.factions[0].rituals.cooldowns.anubis=1;assert(!describe(c).byId.anubis.available);
    assert(describe(c,{favorId:'shiva',confirmed:true}).selected.available);c.factions[0].armies[1].players=[];assert(!describe(c).byId.shiva.available);
});

test('recruitment distinguishes loading, exhausted positions, cooldowns and Super Mahdi’s buried sacrifice',()=>{
    const c=fixture();assert.match(describe(c,{}, {availablePlayers:[],poolLoaded:false}).byId.mahdi.reason,/Loading/);assert.match(describe(c,{}, {availablePlayers:[],poolLoaded:true}).byId.mahdi.reason,/No eligible/);
    assert(describe(c,{favorId:'mahdi',position:'WR'}).selected.available);assert(!describe(c,{favorId:'mahdi',position:'TE'}).selected.available);
    c.factions[0].rituals.cooldowns.mahdi=22;assert.match(describe(c).byId.mahdi.reason,/season 2, Week 5/);c.dynastySeason=2;assert(describe(c).byId.mahdi.available);
    c.factions[0].armies[1].players=[];assert(!describe(c).byId['super-mahdi'].available);
});

test('pending Mahdi requires the stored available draw, legal release and confirmation, and never charges acceptance',()=>{
    const c=fixture(),f=c.factions[0],pool=recruits();f.rituals.pendingMahdi={ritualId:'mahdi',player:pool[0],position:'WR',season:2025,rerolls:0,poolIds:[pool[0].id]};
    let r=describe(c);assert(!r.pending.accept.available);assert(r.pending.decline.available&&r.pending.reroll.available);assert(!r.pending.releaseIds.includes('p0'));assert(!r.byId['kratos-1'].available);
    assert(!describe(c,{replacement:'p1'}).pending.accept.available);assert(describe(c,{replacement:'p1',confirmed:true}).pending.accept.available);assert(!describe(c,{replacement:'foreign',confirmed:true}).pending.accept.available);
    f.favorBalance=0;assert(describe(c,{replacement:'p1',confirmed:true}).pending.accept.available);assert(!describe(c).pending.reroll.available);
    f.favorBalance=20;f.declaredFavors=[{favorId:'kratos-1',playerId:'p0'}];assert(!describe(c).pending.reroll.available);assert.match(describe(c,{replacement:'p1',confirmed:true}).pending.accept.reason,/Clear starter favors/);assert(describe(c).pending.decline.available);f.declaredFavors=[];
    assert(!describe(c,{replacement:'p1',confirmed:true},{availablePlayers:[pool[1]]}).pending.accept.available);assert(!describe(c,{}, {poolLoaded:false}).pending.reroll.available);
    f.armies[0].players.pop();assert(describe(c).pending.accept.available,'An actual vacancy requires no release or confirmation');assert.deepEqual(describe(c).pending.releaseIds,[]);
    f.rituals.pendingMahdi.ritualId='super-mahdi';assert(!describe(c).pending.accept.available);assert(describe(c,{confirmed:true}).pending.accept.available);
    f.rituals.pendingMahdi.rerolls=1;assert(!describe(c).pending.reroll.available);
});

test('champion rewards retain zero-cost Plutus and the exact Amun first/second attempt treasury requirements',()=>{
    const c=fixture(),f=c.factions[0];c.phase='complete';c.week=18;c.championId='egypt';f.favorBalance=0;
    assert(describe(c,{favorId:'plutus'}).selected.available);assert(!describe(c,{favorId:'amun',target:'new0'}).selected.available);
    f.favorBalance=1;assert(describe(c,{favorId:'amun',target:'new0'}).selected.available);f.rituals.ledger=[{ritualId:'amun',cycle:1},{ritualId:'plutus',cycle:1}];assert(!describe(c).byId.plutus.available);
    f.favorBalance=10;assert(!describe(c).byId.amun.available);f.favorBalance=11;assert(describe(c).byId.amun.available);f.rituals.amunClaim={player:recruits()[0]};assert(!describe(c).byId.amun.available);
    delete f.rituals.amunClaim;c.championId='rome';assert(!describe(c).byId.plutus.available&&!describe(c).byId.amun.available);
});
