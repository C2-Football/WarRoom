'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
require('../js/duat/dynasty.js');
const M=globalThis.App.DuatMystery,S=globalThis.App.TimeLeagueSeason;
const player={id:'player:QB:scout:veil:1:2025:2020',identity:'player:QB:scout',name:'Archive QB',position:'QB',season:2025,decade:2020,candidateYears:[2023,2024],mysteryCycle:1};
const stats=passYd=>({...S.emptyStatLine(),passYd});
const state={week:4,scoring:{passingYd:.04,passTd:4,rushRecYd:.1,reception:.5,turnover:-1},completedWeeks:[{week:1,factions:[{factionId:'egypt',players:[{...player,stats:stats(100),hasRecordedGame:true,basePoints:4,effectivePoints:40}]}]}]};
const data={logIndex:new Map([[S.gameLogKey(player.identity,2023,1),{stats:stats(100)}],[S.gameLogKey(player.identity,2024,1),{stats:stats(200)}],[S.gameLogKey(player.identity,2023,2),{stats:stats(400)}],[S.gameLogKey(player.identity,2024,2),{stats:stats(50)}],[S.gameLogKey(player.identity,2023,17),{stats:stats(300)}]])};

test('weekly stars and remaining points follow viewed public candidates, never the hidden year or unwatched results',()=>{
 const privateState={...state};Object.defineProperty(privateState,'hiddenYears',{get(){throw Error('Private year read');}});Object.defineProperty(privateState,'seed',{get(){throw Error('Private seed read');}});
 const unknown=M.scouting(privateState,player,data,{throughWeek:0});assert.equal(unknown.week,1);assert.equal(unknown.knownYear,null);assert.equal(unknown.points,6);assert.equal(unknown.pointsLeft,21);assert.equal(unknown.exact,false);assert.deepEqual(unknown.remainingRange,[10,32]);assert(unknown.stars>=1&&unknown.stars<=5);
 const known=M.scouting(privateState,player,data,{throughWeek:1});assert.equal(known.week,2);assert.equal(known.knownYear,2023);assert.equal(known.points,16);assert.equal(known.pointsLeft,28);assert.equal(known.exact,true);assert.equal(known.stars,5);
 const changed=JSON.parse(JSON.stringify(state));changed.completedWeeks.push({week:2,factions:[{players:[{...player,stats:stats(-999),basePoints:-999,effectivePoints:999,hasRecordedGame:true}]}]});
 assert.deepEqual(M.scouting(changed,player,data,{throughWeek:1}),known,'Unwatched result cannot affect current scouting or year inference');
 for(const throughWeek of [undefined,null,'1',NaN])assert.deepEqual(M.scouting(privateState,player,data,{throughWeek}),unknown,'Invalid viewed boundary remains at opening week');
 const finalPlayer={...player,revealedSeason:2024},finalState={...state,week:18,phase:'complete',completedWeeks:[]};
 assert.equal(M.scouting(finalState,finalPlayer,data,{throughWeek:0}).knownYear,null,'Even the public final reveal waits for the manager’s completed recap');
 assert.equal(M.scouting(finalState,finalPlayer,data,{throughWeek:17}).knownYear,2024,'An acknowledged official reveal names its public season even with tied candidate fingerprints');
});

test('no archive, contradictory evidence, season completion, zero and negative base points remain truthful',()=>{
 assert.equal(M.scouting(state,player,null,{throughWeek:1}).available,false);
 const contradiction={...state,completedWeeks:[{week:1,factions:[{players:[{...player,stats:stats(999),hasRecordedGame:true}]}]}]};assert.equal(M.scouting(contradiction,player,data,{throughWeek:1}).available,false);
 const complete=M.scouting({...state,week:18},player,data,{throughWeek:17});assert.equal(complete.pointsLeft,0);assert.equal(complete.stars,null);assert.equal(complete.outlook,'Season complete');
 const negativeData={logIndex:new Map([[S.gameLogKey(player.identity,2023,1),{stats:stats(-100)}]])};const negative=M.scouting({...state,week:1}, {...player,candidateYears:[2023]},negativeData,{throughWeek:0});assert.equal(negative.points,-4);assert.equal(negative.pointsLeft,-4);assert.equal(negative.stars,1);
 const zero=M.scouting({...state,week:3,completedWeeks:[]}, {...player,candidateYears:[2023]},negativeData,{throughWeek:1});assert.equal(zero.points,0);assert.equal(zero.stars,1);
});

test('complete regular-season archive includes Week18 separately without changing Duat totals or ratings',()=>{
 const candidate=M.inspect(state,player,data,{throughWeek:1}).candidates[0],key=S.gameLogKey(player.identity,2023,18);
 const supplemental={...data,researchWeek18:{availableSeasons:[2023],statsByGame:{[key]:stats(1000)}}};
 const games=M.archiveGames(state,player,candidate,supplemental);assert.equal(games.length,18);assert.equal(games[17].points,40);assert.equal(games[17].inCampaign,false);
 assert.deepEqual(M.scouting(state,player,supplemental,{throughWeek:1}),M.scouting(state,player,data,{throughWeek:1}));
 const missing=M.archiveGames(state,player,candidate,data)[17];assert.equal(missing.available,false);assert.equal(missing.points,null,'Unavailable supplement cannot masquerade as a zero');
 const bye=M.archiveGames(state,player,candidate,{...data,researchWeek18:{availableSeasons:[2023],statsByGame:{}}})[17];assert.equal(bye.available,true);assert.equal(bye.hasRecordedGame,false);assert.equal(bye.points,0);
 const archive=JSON.parse(fs.readFileSync('data/duat/research-week18.json','utf8'));assert.deepEqual(archive.availableSeasons,[2021,2022,2023,2024,2025]);assert(Object.keys(archive.statsByGame).length>1500);assert(Object.keys(archive.statsByGame).every(key=>key.endsWith(':18')));
});
