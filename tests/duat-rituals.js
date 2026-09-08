const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../js/duat/rituals.js');
const F=require('../js/duat/favors.js');
const player=(id,position='WR',season=2020)=>({id:id+':'+season,identity:id,name:id,position,season,referenceSeason:season-1,referencePoints:10});
const army=(id,season=2020)=>({id,rulerName:id,season,players:['QB','RB','WR','TE','WR','RB','WR','TE'].map((p,i)=>player(id+'-'+i,p,season))});
function state(week=5){const a=army('alpha'),b=army('beta',2019);return{version:4,expansionVersion:1,dynastySeason:1,seed:'sourcebook',updatedAt:'2026-09-08T12:00:00Z',phase:'season',week,seasons:[2020,2019],settings:{favors:true,bench:3},factions:[{id:'f1',name:'Faction One',roster:'duat',favorBalance:100,armies:[a,b],activeArmyId:a.id,lineup:a.players.slice(0,5).map(p=>p.id),declaredFavor:null},{id:'f2',name:'Faction Two',roster:'duat',favorBalance:100,armies:[army('gamma')],activeArmyId:'gamma',lineup:[]}],completedWeeks:[],activity:[]};}
const pool=Array.from({length:30},(_,i)=>({...player('candidate-'+i,i%5===0?'QB':'WR'),futurePoints:9999,stats:{future:true}}));
const call=(s,id,fields={},context={})=>R.applyAction(s,{type:'ritual',ritualId:id,factionId:'f1',...fields},{pool,createdAt:s.updatedAt,...context});
function resultPlayers(){return['QB','RB','WR','WR','TE'].map((p,i)=>({...player('p'+i,p),starter:true,basePoints:i+5,effectivePoints:i+5,hasRecordedGame:true}));}

test('sourcebook exposes twelve illustrated gods and keeps old effects opt-in',()=>{
 assert.equal(R.DEITIES.length,12);assert.equal(new Set(R.DEITIES.map(d=>d.id)).size,12);assert.ok(R.DEITIES.every(d=>d.art));assert.equal(F.FAVORS.length,7);assert.equal(F.EXPANDED_FAVORS.length,10);assert.equal(F.getFavor('horus-1').floor,15);
 assert.throws(()=>F.validateDeclaration({favorId:'nyx',playerId:'p0:2020',week:5,players:resultPlayers(),balance:100}),/not supported/);
});
test('distinct starters can reserve multiple favors with one combined treasury',()=>{
 const players=resultPlayers(),declarations=[{favorId:'kratos-1',playerId:players[0].id},{favorId:'horus-1',playerId:players[1].id},{favorId:'nyx',playerId:players[2].id}];
 const applied=F.applyFavors({expansionVersion:1,declarations,playerResults:players,week:5,balance:45,history:[]});assert.equal(applied.cost,45);assert.equal(applied.events.length,3);assert.equal(applied.players[0].effectivePoints,10);assert.equal(applied.players[1].effectivePoints,15);assert.equal(applied.players[2].effectivePoints,17.5);assert.equal(players[0].effectivePoints,5);
 assert.throws(()=>F.validateDeclarations({expansionVersion:1,declarations,playerResults:players,week:5,balance:44}),/combined/);
 assert.throws(()=>F.validateDeclarations({expansionVersion:1,declarations:[declarations[0],declarations[0]],playerResults:players,week:5,balance:100}),/only one/);
});
test('Patecatl uses only observed prior games and genuine reference, refunds ineligible game',()=>{
 const players=resultPlayers();players[0].hasRecordedGame=false;players[0].basePoints=0;players[0].effectivePoints=0;
 const history=[{week:2,players:[{...players[0],hasRecordedGame:true,basePoints:6}]},{week:9,players:[{...players[0],hasRecordedGame:true,basePoints:1000}]}];
 const opts={expansionVersion:1,declarations:[{favorId:'patecatl-1',playerId:players[0].id}],playerResults:players,week:5,balance:100,history};
 assert.equal(F.applyFavors(opts).players[0].effectivePoints,6);assert.equal(F.applyFavors({...opts,declarations:[{favorId:'patecatl-2',playerId:players[0].id}]}).players[0].effectivePoints,10);
 assert.equal(F.applyFavors({...opts,history:[]}).players[0].effectivePoints,10);assert.equal(F.applyFavors({...opts,playerResults:resultPlayers()}).cost,0);
 assert.throws(()=>F.applyFavors({...opts,playerResults:players.map(p=>({...p,referenceSeason:null}))}),/prior-season/);
});
test('ritual gates preserve legacy campaigns and disabled favors',()=>{
 assert.throws(()=>call({...state(),expansionVersion:undefined},'midas'),/sourcebook/);assert.throws(()=>call({...state(),settings:{favors:false}},'midas'),/turned off/);assert.throws(()=>call(state(3),'mahdi'),/sacred/);assert.throws(()=>call(state(),'anubis'),/before Week 1/);
});
test('Midas makes a permanent auditable sacrifice and preserves legal lineup',()=>{
 const s=state(),p=s.factions[0].armies[0].players[7],before=JSON.stringify(s);assert.throws(()=>call(s,'midas',{playerId:p.id}),/Confirm/);
 const n=call(s,'midas',{playerId:p.id,confirmed:true});assert.equal(n.factions[0].favorBalance,101);assert.equal(n.factions[0].armies[0].players.length,7);assert.equal(n.factions[0].rituals.ledger[0].credit,1);assert.equal(JSON.stringify(s),before);
 assert.throws(()=>call(s,'midas',{playerId:s.factions[0].armies[0].players[0].id,confirmed:true}),/every starting slot/);
});
test('Mahdi only reveals a safe candidate, has one paid reroll, and requires a legal acceptance',()=>{
 const s=state(),n=call(s,'mahdi',{position:'WR'}),r=n.factions[0].rituals;assert.equal(r.pendingMahdi.player.position,'WR');assert.equal(r.pendingMahdi.player.futurePoints,undefined);assert.equal(r.pendingMahdi.player.stats,undefined);assert.ok(r.pendingMahdi.roll>=1&&r.pendingMahdi.roll<=20);assert.equal(n.factions[0].armies[0].players.length,8);
 assert.throws(()=>call(n,'ebisu',{wager:10}),/Accept or decline/);assert.throws(()=>call(n,'mahdi-accept'),/make room/);
 const rerolled=call(n,'mahdi-reroll');assert.equal(rerolled.factions[0].favorBalance,80);assert.equal(rerolled.factions[0].rituals.pendingMahdi.rerolls,1);assert.throws(()=>call(rerolled,'mahdi-reroll'),/Only one/);
 const accepted=call(rerolled,'mahdi-accept',{replacementId:s.factions[0].armies[0].players[7].id,confirmed:true});assert.equal(accepted.factions[0].rituals.pendingMahdi,null);assert.equal(accepted.factions[0].armies[0].players.length,8);assert.throws(()=>call(accepted,'mahdi'),/rest/);
 assert.deepEqual(call(s,'mahdi',{position:'WR'}),n);
});
test('Mahdi skips owned and banished cards and does not consult future result fields',()=>{
 const s=state();s.factions[0]=R.initializeFaction(s.factions[0]);s.factions[0].rituals.banishedPlayerIds=[pool[1].id];
 const list=R.playerPool(s,'f1',[...pool,...s.factions[0].armies[0].players],{position:'WR'});assert.ok(list.every(p=>p.id!==pool[1].id));assert.ok(list.every(p=>p.futurePoints===undefined));assert.equal(new Set(list.map(p=>p.id)).size,list.length);
});
test('Anubis retains the recruited player year and banishes the replaced player',()=>{
 const s=state(1),a=s.factions[0].armies[0],b=s.factions[0].armies[1],n=call(s,'anubis',{playerId:a.players[7].id,replacementId:b.players[7].id,confirmed:true});assert.equal(n.factions[0].armies[0].players.at(-1).season,2019);assert.equal(n.factions[0].armies[1].players.length,7);assert.ok(n.factions[0].rituals.banishedPlayerIds.includes(a.players[7].id));assert.throws(()=>call(n,'anubis',{playerId:a.players[6].id,replacementId:b.players[6].id,confirmed:true}),/one player per/);
});
test('Shiva destroys a ruler, preserves a playable army, and cannot destroy the last',()=>{
 const n=call(state(1),'shiva',{confirmed:true});assert.equal(n.factions[0].armies[0].destroyed,true);assert.equal(n.factions[0].activeArmyId,'beta');assert.equal(R.canField(n.factions[0],R.activeArmy(n.factions[0]).players),true);assert.throws(()=>call(n,'shiva',{confirmed:true}),/other legal buried army/);
});
test('Super Mahdi acceptance removes a buried player permanently',()=>{
 const s=state(),n=call(s,'super-mahdi',{position:'WR'}),accepted=call(n,'mahdi-accept',{replacementId:s.factions[0].armies[0].players[7].id,confirmed:true});assert.equal(accepted.factions[0].armies[1].players.length,7);assert.ok(accepted.factions[0].rituals.ledger.at(-1).sacrifice);assert.equal(accepted.factions[0].rituals.banishedPlayerIds.length,1);
});
test('Ebisu reserves worst-case loss, resolves once, and does not mutate the input',()=>{
 const s=state(),n=call(s,'ebisu',{wager:100});assert.equal(R.reservedBalance(n.factions[0]),100);assert.throws(()=>call(n,'mahdi-reroll'),/Summon/);
 let seed='';for(let i=0;i<100;i++){const candidate='lose'+i;if(![5,7].includes(R.seededRoll(candidate,'f1:1:5:ebisu-result'))){seed=candidate;break;}}
 const resolved=R.resolveEbisu({faction:n.factions[0],week:5,total:30,seed,cycle:1});assert.equal(resolved.total,0);assert.equal(resolved.cost,70);assert.equal(resolved.faction.favorBalance,30);assert.equal(n.factions[0].favorBalance,100);assert.equal(resolved.faction.rituals.ebisu,null);assert.equal(R.resolveEbisu({faction:resolved.faction,week:5,total:0,seed,cycle:1}).event,null);
 const repeat={...n,factions:[resolved.faction,n.factions[1]]};assert.throws(()=>call(repeat,'ebisu',{wager:10}),/already rolled/);
});
test('Amun is champion-only and success reserves the next-season player with exact debit',()=>{
 assert.throws(()=>call(state(),'amun',{playerId:pool[0].id}),/reigning/);
 let s;for(let i=0;i<1000;i++){const candidate={...state(18),phase:'complete',championId:'f1',seed:'amun'+i};if([5,7].includes(R.seededRoll(candidate.seed,'f1:1:18:0:amun'))){s=candidate;break;}}
 const n=call(s,'amun',{playerId:pool[0].id});assert.equal(n.factions[0].favorBalance,99);assert.equal(n.factions[0].rituals.amunClaim.id,pool[0].id);assert.throws(()=>call(n,'amun',{playerId:pool[1].id}),/already reserved/);
});
test('Plutus rolls only once and rollover cannot carry money spent after the roll',()=>{
 let s;for(let i=0;i<1000;i++){const candidate={...state(18),phase:'complete',championId:'f1',seed:'plutus'+i};if([5,7,10,12,14,15,17].includes(R.seededRoll(candidate.seed,'f1:1:18:0:plutus'))){s=candidate;break;}}
 const n=call(s,'plutus');assert.equal(n.factions[0].rituals.plutusCarry,100);assert.throws(()=>call(n,'plutus'),/one attempt/);n.factions[0].favorBalance=60;const next=R.rolloverFaction(n.factions[0],{favorBudget:125,cycle:2});assert.equal(next.favorBalance,185);assert.equal(next.rituals.plutusCarry,0);assert.equal(next.rituals.ledger.at(-1).credit,60);
});
test('Anubis banishment excludes another historical version of the same player',()=>{
 const s=state(1),a=s.factions[0].armies[0],b=s.factions[0].armies[1],n=call(s,'anubis',{playerId:a.players[7].id,replacementId:b.players[7].id,confirmed:true});
 const alternate=player(a.players[7].identity,'TE',2021);assert.deepEqual(R.playerPool(n,'f1',[alternate],{season:2021}),[]);
});
test('ritual save validation rejects forged reservations, dice and pending draws',()=>{
 const n=call(state(),'mahdi',{position:'WR'});assert.equal(R.validateFaction(n.factions[0],{cycle:1,week:5}),true);
 const forged=JSON.parse(JSON.stringify(n));forged.factions[0].rituals.pendingMahdi.roll=21;assert.throws(()=>R.validateFaction(forged.factions[0],{cycle:1,week:5}),/pending Mahdi/);
 const over=call(state(),'ebisu',{wager:100});over.factions[0].declaredFavors=[{favorId:'kratos-1',playerId:'alpha-0:2020',cost:10}];assert.throws(()=>R.validateFaction(over.factions[0],{cycle:1,week:5}),/exceed/);
 const receipt=JSON.parse(JSON.stringify(n));receipt.factions[0].rituals.ledger[0].cost=-100;assert.throws(()=>R.validateFaction(receipt.factions[0],{cycle:1,week:5}),/receipt/);
});
