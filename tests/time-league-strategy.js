'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; global.App = {};
for (const name of ['roster','helmet','rules','draft-room','era-rules','season','player-cards','engine','hidden-years','strategy','rivals','ai']) require('../js/shared/time-league-' + name + '.js');
const { TimeLeagueEngine: E, TimeLeagueStrategy: S, TimeLeagueAI: AI } = App;
function stateAt(weeks, wins, persona = 'gambler') {
    const state = E.createTimeLeague({ name: 'Pressure', seed: 'same-decisions', createdAt: '2026-09-15T12:00:00Z',
        settings: { hiddenYears: false, gameDeckVersion: 1, regularSeasonWeeks: 12, playoffTeams: 2, rosterSlots: { RB: 1, BN: 1 }, maxQuarterbacks: 2,
            scoring: { passTd: 4, passingYd: .04, rushRecYd: .1, reception: .5, turnover: -2 }, eraRules: { mode: 'selected-decades', decades: ['1990s'] }, waiversEnabled: true, tradesEnabled: true, waiverMode: 'faab', faabBudget: 100 },
        seats: [{name:'Rival',manager:'ai',aiPersona:persona},{name:'You',manager:'human'},{name:'Third',manager:'ai'},{name:'Fourth',manager:'ai'}] });
    return { ...state, phase: 'season', seasonsRevealed: true, currentWeek: weeks + 1, weekStage: 'claims', finalizedWeeks: Array.from({length:weeks},(_,i)=>({
        week:i+1, results:[], matchups:[{home:'t1',away:'t2',homePoints:90,awayPoints:80,winner:i<wins?'t1':'t2'},
            {home:'t3',away:'t4',homePoints:80,awayPoints:70,winner:i%2?'t3':'t4'}] })) };
}
const chase = stateAt(8,3), secure = stateAt(9,9), early = stateAt(2,0);
assert.equal(S.forTeam(chase,'t1').status,'chasing');
assert.equal(S.forTeam(secure,'t1').status,'secured');
assert.equal(S.forTeam(early,'t1').status,'building');
assert.equal(S.forTeam(stateAt(10,0),'t1').status,'eliminated');
assert(S.forTeam(chase,'t1').spendMultiplier > S.forTeam(secure,'t1').spendMultiplier);
assert.equal(S.forTeam(chase,'t1',2).status,'building','Replay cannot expose the later playoff pressure');
const final = stateAt(12,9); assert.equal(S.forTeam(final,'t1').status,'playoffs');
const complete = {...final,phase:'complete',championTeamId:'t1'};
assert.equal(S.forTeam(complete,'t1').status,'champion');
assert.notEqual(S.forTeam(complete,'t1',11).status,'champion','The champion stance waits for the final result to be visible');
assert(!Object.keys(S.forTeam(chase,'t1')).some(key=>/probability|odds/i.test(key)),'Standings pressure must not pretend to be calibrated odds');
const guarded = {...chase};
for (const name of ['privateDraws','playerReports','gameDecks']) Object.defineProperty(guarded,name,{get(){throw new Error('Read hidden field '+name);}});
assert.deepEqual(S.forTeam(guarded,'t1'),S.forTeam(chase,'t1'));
assert.equal(new Set(Object.values(S.PROFILES).map(p=>p.goal)).size,E.AI_PERSONA_IDS.length,'Every persona has an individual goal');
for(const id of E.AI_PERSONA_IDS) for(const key of ['goal','fear','principle','tell','voice','pressure','secure','reflection']) assert(S.PROFILES[id][key]);
const gamble = AI.adaptivePersona(chase,{aiPersona:'gambler',teamId:'t1'}), grind = AI.adaptivePersona(chase,{aiPersona:'grinder',teamId:'t1'});
assert(gamble.riskTolerance > grind.riskTolerance + 50,'Urgency preserves individual temperament');
assert.equal(S.memoryFor(early,'t1','t2').week,2);
const memory = {...chase,trades:[{fromTeamId:'t1',toTeamId:'t2',week:7,respondedWeek:8,status:'accepted'}]};
assert.equal(S.memoryFor(memory,'t1','t2').kind,'trade');
assert(!S.memoryFor(memory,'t1','t2',2).text.includes('trade'),'Later deals do not enter an earlier recap');

const cards = new Map();
const entry = (id,points,slot='BN') => {
    cards.set(id,{identity:id,name:id,position:'RB',peak:points,seasons:[{season:1993,games:16,points},{season:1994,games:16,points:points*.6}]});
    return {identity:id,entryId:id,editionId:id,name:id,position:'RB',drawnSeason:1993,hiddenDecade:'1990s',slot};
};
const starter=entry('starter',20,'RB'), bench=entry('bench',10), target=entry('target',200);
function wire(state) { return {...state,teams:state.teams.map((t,i)=>({...t,faabRemaining:100,roster:i?[]:[starter,bench]}))}; }
const chasingBids=AI.aiSubmitWaiverClaims(wire(chase),cards,chase.createdAt), secureBids=AI.aiSubmitWaiverClaims(wire(secure),cards,secure.createdAt);
assert(chasingBids.pendingClaims.find(c=>c.teamId==='t1').bidAmount > secureBids.pendingClaims.find(c=>c.teamId==='t1').bidAmount,'Pressure changes real FAAB spending');
for(const state of [chasingBids,secureBids]) assert(state.pendingClaims.every(c=>c.bidAmount>=0&&c.bidAmount<=100));

const mystery = {...wire(chase),settings:{...chase.settings,hiddenYears:true}};
const secretEntry = source => {
    const safe={...source};delete safe.drawnSeason;
    Object.defineProperty(safe,'drawnSeason',{get(){throw new Error('AI inspected the assigned year');}});
    return safe;
};
mystery.teams=mystery.teams.map(t=>({...t,roster:t.roster.map(secretEntry)}));
Object.defineProperty(mystery,'privateDraws',{get(){throw new Error('AI inspected secret draws');}});
AI.aiPrepareWeek(mystery,cards,new Map());
AI.aiSubmitWaiverClaims(mystery,cards,chase.createdAt);
AI.aiGenerateTrades(mystery,cards,chase.createdAt,{humanOnly:true});
assert.equal(mystery.teams[0].roster.length,2);
const released=entry('released',8);
const knownWire={...mystery,finalizedWeeks:mystery.finalizedWeeks.map((week,index)=>index?week:{...week,playerProduction:[{editionId:'mystery:released',identity:'released',name:'released',position:'RB',points:80,stats:{rushYd:800}}]})};
const reclaimed=AI.aiSubmitWaiverClaims(knownWire,cards,chase.createdAt).pendingClaims.find(c=>c.teamId==='t1');
assert.equal(reclaimed.addIdentity,'released','The wire values a released player using their already revealed games');
const board=new Map([['modest',{identity:'modest',name:'Modest',position:'RB',peak:999999,seasons:[{season:1993,games:16,points:16},{season:2003,games:16,points:999999}]}],['strong',{identity:'strong',name:'Strong',position:'RB',peak:1600,seasons:[{season:1993,games:16,points:1600}]}]]);
const draftState={...stateAt(0,0),phase:'draft',settings:{...chase.settings,hiddenYears:true,eraRules:{mode:'selected-decades',decades:['1990s','2000s']}},hiddenYearDecades:{modest:'1990s',strong:'1990s'},hiddenYearCandidates:{modest:[1993],strong:[1993]}};
assert.equal(AI.aiDraftChoice(draftState,board).identity,'strong','Draft value uses the advertised decade, excluding a huge unrelated season');
const R=App.TimeLeagueRivals;
const visibleReply=R.sendMessage(chase,{teamId:'t2',toTeamId:'t1',tone:'neutral',text:'What is your next move?',messageId:'pressure-visible',seenThroughWeek:8},chase.createdAt).rivalMessages.at(-1).text;
assert(visibleReply.includes(S.profileFor(chase.teams[0]).pressure),'The saved voice reflects real playoff pressure');
assert(visibleReply.includes('Week 8'),'Conversation remembers an actual revealed meeting');
const earlyReply=R.sendMessage(chase,{teamId:'t2',toTeamId:'t1',tone:'neutral',text:'What is your next move?',messageId:'pressure-earlier',seenThroughWeek:1},chase.createdAt).rivalMessages.at(-1).text;
assert(!earlyReply.includes('Week 8')&&!earlyReply.includes(S.profileFor(chase.teams[0]).pressure),'Earlier playback cannot disclose later pressure or memories');
const thread=R.threadsFor(chase,'t2',{throughWeek:2}).find(t=>t.team.teamId==='t1');
assert(thread.profile.goal&&thread.strategy.status==='building');
console.log('PASS: distinct manager motives, factual memories, playoff pressure, budget adaptation, personality consistency, playback gates and information-limited hidden-year decisions.');
