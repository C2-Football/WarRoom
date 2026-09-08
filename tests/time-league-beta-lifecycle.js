'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'player-cards', 'engine', 'rivals', 'ai', 'actions', 'gamecast']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueActions: A, TimeLeagueAI: AI, TimeLeaguePlayerCards: P, TimeLeagueSeason: S, TimeLeagueGamecast: G } = App;
const data = {
    cards: P.buildPlayerCardIndex(JSON.parse(fs.readFileSync('data/time-league/player-cards.json'))),
    logIndex: S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync('data/time-league/nflverse-game-logs.csv', 'utf8')).logs),
    eraFactors: new Map(),
};
const host = { seat_team_id: 't1', role: 'commissioner' }, outsider = { seat_team_id: 'not-a-seat', role: 'member' };
const stamp = '2026-09-07T00:00:00Z';
let state = E.normalizeTimeLeague(E.createTimeLeague({
    name: 'Twelve-team beta lifecycle', seed: 'beta-full', createdAt: stamp,
    seats: [{ name: 'Human', manager: 'human' }, ...Array.from({ length: 11 }, (_, i) => E.defaultAiSeat(i + 1))],
    settings: {
        rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPER_FLEX: 1, K: 1, DEF: 1, BN: 3 }, maxQuarterbacks: 3,
        regularSeasonWeeks: 12, playoffTeams: 4, scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 },
        eraRules: { mode: 'position-roulette', decades: [] }, waiversEnabled: true, waiverMode: 'faab', faabBudget: 100,
        tradesEnabled: true, aiDifficulty: 'veteran', draftPickSeconds: 0,
    },
}));
let actions = 0;
const act = action => {
    const before = JSON.stringify(state);
    const next = A.applyOnlineAction(state, action, host, data, stamp);
    assert.equal(JSON.stringify(state), before, 'Game actions cannot mutate the last saved snapshot');
    state = E.normalizeTimeLeague(JSON.parse(JSON.stringify(next)));
    assert(state, 'Every action must survive a save and reload'); actions++;
    const identities = state.teams.flatMap(team => team.roster.map(entry => entry.identity));
    assert.equal(new Set(identities).size, identities.length, 'A player cannot be owned by two managers');
};
assert.equal(state.draftClock.status, 'waiting');
assert.equal(Object.keys(state.settings.eraRules.positionDecades).length, 6, 'Roulette deals only the six supported starting positions');
assert(!state.activity.some(event => /QB 19|QB 20|RB 19|RB 20/.test(event.message)), 'Founding activity keeps the sealed draw private');
act({ type: 'draft-clock-start' });
let draftPasses = 0;
while (state.phase === 'draft' && draftPasses++ < 157) {
    if (E.currentDraftSeat(state).teamId === host.seat_team_id) {
        const choice = AI.aiDraftChoice(state, data.cards); assert(choice, 'The human always has a legal available pick');
        act({ type: 'draft', identity: choice.identity });
    } else act({ type: 'ai-run' });
}
assert.equal(state.phase, 'season'); assert.equal(state.draftPicks.length, 156);
assert(state.teams.every(team => team.roster.length === 13 && E.lineupProblems(state, team.teamId).length === 0));
assert(state.teams.every(team => team.roster.some(entry => entry.position === 'K') && team.roster.some(entry => entry.position === 'DEF')));
const human = state.teams[0], drop = human.roster.find(entry => entry.slot === 'BN');
const target = E.freeAgents(state, data.cards).find(card => card.position === drop.position);
act({ type: 'claim', teamId: 't1', identity: target.identity, dropEntryId: drop.entryId, bidAmount: 7 });
assert.equal(state.teams[0].faabRemaining, 100, 'Planning stages reserve a bid without charging it');
assert(state.pendingClaims.some(claim => claim.addIdentity === target.identity));
const give = state.teams[0].roster.find(entry => entry.position === 'K'), receive = state.teams[1].roster.find(entry => entry.position === 'K');
act({ type: 'trade', teamId: 't1', toTeamId: 't2', giveEntryIds: [give.entryId], receiveEntryIds: [receive.entryId] });
const offerId = state.trades.at(-1).tradeId;
assert.throws(() => A.applyOnlineAction(state, { type: 'week' }, host, data, stamp), /planning/);
assert.throws(() => A.applyOnlineAction(state, { type: 'process-claims' }, outsider, data, stamp), /commissioner/);
let gates = 0, regularStandings = null;
while (state.phase === 'season' && gates++ < 60) {
    const stage = state.weekStage, week = state.currentWeek;
    if (stage === 'claims') {
        act({ type: 'process-claims' });
        assert.equal(state.pendingClaims.length, 0); assert.equal(state.weekStage, 'lineup');
        if (week === 1) {
            assert.notEqual(state.trades.find(trade => trade.tradeId === offerId).status, 'pending', 'AI responds only after claims settle');
            assert(state.activity.some(event => event.kind === 'waiver' && event.message.includes(target.name) && /lands|misses/.test(event.message)), 'The claim receives an explicit outcome');
        }
    } else if (stage === 'lineup') {
        act({ type: 'auto-lineup', teamId: 't1' });
        act({ type: 'finalize-rosters' }); assert.equal(state.weekStage, 'ready');
        assert.throws(() => A.applyOnlineAction(state, { type: 'auto-lineup', teamId: 't1' }, host, data, stamp), /locked/);
    } else if (stage === 'ready') {
        act({ type: 'week' }); assert.equal(state.weekStage, 'postgame');
        const result = state.finalizedWeeks.at(-1);
        assert.equal(result.week, week); assert.equal(state.currentWeek, week + 1);
        const timeline = G.buildGamecast({ ...result, seed: state.seed, scoring: state.settings.scoring });
        for (const team of result.results) {
            const cents = timeline.events.filter(event => event.teamId === team.teamId).reduce((sum, event) => sum + Math.round(event.points * 100), 0);
            assert.equal(cents, Math.round(team.total * 100), 'Quarter playback must reproduce the saved game score');
        }
        if (week === 12) {
            regularStandings = E.computeStandings(state);
            const seeds = regularStandings.slice(0, 4).map(team => team.teamId);
            assert.deepEqual(E.playoffPairs(state, 13), [[seeds[0], seeds[3]], [seeds[1], seeds[2]]]);
        }
        if (week > 12) {
            assert.deepEqual(E.computeStandings(state), regularStandings, 'Playoff games do not rewrite regular-season seeding');
            assert.equal(result.matchups.length, week === 13 ? 2 : 1);
        }
        const rosterBeforeReview = JSON.stringify(state.teams);
        assert.equal(JSON.stringify(E.normalizeTimeLeague(JSON.parse(JSON.stringify(state))).teams), rosterBeforeReview, 'Reviewing and reloading a final cannot process next-week moves');
    } else { act({ type: 'advance-week' }); assert.equal(state.weekStage, 'claims'); }
}
assert.equal(state.phase, 'complete'); assert.equal(state.finalizedWeeks.length, 14);
assert.equal(state.championTeamId, state.finalizedWeeks.at(-1).matchups[0].winner);
assert.equal(new Set(state.finalizedWeeks.map(week => week.week)).size, 14);
assert.throws(() => A.applyOnlineAction(state, { type: 'week' }, host, data, stamp), /planning/);
assert(state.teams.every(team => team.faabRemaining >= 0 && team.faabRemaining <= 100));
console.log(`PASS: ${actions} saved/reloaded actions across a 12-team, 156-pick real-data Roulette league, K/DEF/FLEX/Superflex, waivers/trades, four gates, exact quarter scores and a four-team championship.`);
