'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Strategy=require('../js/duat/strategy.js'),Personalities=require('../js/duat/personalities.js'),Favors=require('../js/duat/favors.js');
function fixture(kind='bubble',name='Shaka'){
 const ids=['egypt','rome','greece','zulu','china','india','japan','nubia'];
 const factions=ids.map(id=>({id,controller:'ai',favorBalance:100,activeArmyId:id+'-army',armies:[{id:id+'-army',rulerName:id==='zulu'?name:'Custom '+id,rulerOrigin:id==='zulu'?'historical-reference':'player-named',rulerId:id+'-'+name,players:[]}]}));
 const completedWeeks=Array.from({length:13},(_,index)=>({week:index+1,factions:ids.map(id=>({factionId:id,total:kind==='secured'&&id==='zulu'?200:100,players:[{id:'low',basePoints:5,hasRecordedGame:true},{id:'high',basePoints:25,hasRecordedGame:true},{id:'middle',basePoints:18,hasRecordedGame:true}]}))}));
 return{version:4,calendarVersion:2,week:14,settings:{playoffTeams:4},factions,completedWeeks};
}
const own=state=>state.factions.find(f=>f.id==='zulu'),ranked=['high','middle','low'],cost=plan=>plan.reduce((sum,p)=>sum+Favors.getFavor(p.favorId,1).cost,0);
test('actual all-play results change pressure and spending without changing a ruler personality',()=>{
 const bubble=fixture(),secure=fixture('secured'); // Equal scores sort zulu outside the cutoff, still within reach.
 const chasing=Strategy.forFaction(bubble,'zulu'),safe=Strategy.forFaction(secure,'zulu');assert.equal(chasing.status,'chasing');assert.equal(safe.status,'secured');assert(chasing.urgency>safe.urgency);
 assert.deepEqual(Personalities.profileFor(own(bubble)).decisionTraits,Personalities.profileFor(own(secure)).decisionTraits);
 assert(cost(Strategy.favorPlan(bubble,own(bubble),ranked))>cost(Strategy.favorPlan(secure,own(secure),ranked)));
 assert.equal(Strategy.forFaction(bubble,'zulu',{throughWeek:0}).status,'building');assert.equal(Strategy.forFaction(bubble,'zulu',{throughWeek:0}).completedWeeks,0);
});
test('authored prudence and aggression produce different legal favor targets using known player history',()=>{
 const aggressive=fixture('bubble','Shaka'),cautious=fixture('bubble','Cetshwayo');const attack=Strategy.favorPlan(aggressive,own(aggressive),ranked),defend=Strategy.favorPlan(cautious,own(cautious),ranked);
 assert(attack.some(p=>p.favorId.startsWith('kratos')));assert(defend.some(p=>p.favorId.startsWith('horus')));assert.equal(defend[0].playerId,'low');assert.equal(attack[0].playerId,'high');
 for(const [state,plan]of [[aggressive,attack],[cautious,defend]]){const validated=Favors.validateDeclarations({declarations:plan,playerResults:ranked.map(id=>({id,starter:true,basePoints:0})),history:[],week:state.week,balance:own(state).favorBalance,expansionVersion:1});assert.equal(validated.length,plan.length);assert(cost(plan)<=own(state).favorBalance);assert.equal(new Set(plan.map(p=>p.playerId)).size,plan.length);}
});
test('strategy cannot read secret assignments or unrevealed games; treasuries and ordinary weeks bound plans',()=>{
 const state=fixture(),baseline=Strategy.favorPlan(state,own(state),ranked);Object.defineProperty(state,'hiddenYears',{get(){throw Error('Read hidden years');}});Object.defineProperty(state,'seed',{get(){throw Error('Read private seed');}});state.completedWeeks.push({week:14,get factions(){throw Error('Read future game');}});
 assert.deepEqual(Strategy.favorPlan(state,own(state),ranked),baseline);assert.equal(Strategy.forFaction(state,'zulu').completedWeeks,13);
 for(const balance of [0,9,10,19,20,35,100]){own(state).favorBalance=balance;const plan=Strategy.favorPlan(state,own(state),ranked);assert(cost(plan)<=balance);if(balance<10)assert.deepEqual(plan,[]);}
 state.week=13;assert.deepEqual(Strategy.favorPlan(state,own(state),ranked),[]);
});
