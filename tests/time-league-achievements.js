#!/usr/bin/env node
// Unit tests for js/shared/time-league-achievements.js — the Vault's
// achievement catalog, mirroring War Room's real achievements.js shape
// (catalog/computeStats/evaluate/tierLabel/tierColor).
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
const Roster = require('../js/shared/time-league-roster.js');
require('../js/shared/time-league-rules.js');
require('../js/shared/time-league-draft-room.js');
require('../js/shared/time-league-era-rules.js');
require('../js/shared/time-league-season.js');
// d352383 (team helmets): the engine seats leagues via
// App.TimeLeagueHelmet.defaultHelmet(), so this module must load before it.
require('../js/shared/time-league-helmet.js');
const Engine = require('../js/shared/time-league-engine.js');
const Achievements = require('../js/shared/time-league-achievements.js');
require('../js/shared/time-league-hidden-years.js');
const Public = require('../js/shared/time-league-public-state.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const SCORING = { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 };
const ROSTER_SLOTS = { QB: 1, RB: 1, WR: 1, FLEX: 1, BN: 3 };

function baseSettings(overrides = {}) {
    return {
        gameDeckVersion: 0, // Archive-independent achievement fixtures use legacy scoring.
        rosterSlots: ROSTER_SLOTS, scoring: SCORING, regularSeasonWeeks: 1, maxQuarterbacks: 1,
        eraRules: { mode: 'any-era', decades: [] }, eraAdjusted: false,
        waiversEnabled: true, waiverMode: 'priority', faabBudget: 100, tradesEnabled: true,
        ...overrides,
    };
}

function seats(count = 4) {
    return Array.from({ length: count }, (_, i) => ({ name: `Team ${i + 1}`, manager: i === 0 ? 'human' : 'ai' }));
}

function card(identity, name, position, seasons) {
    return { identity, name, position, seasons: seasons.map((s) => ({ ...s, games: 16, passYd: 0, passTd: 0, passInt: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0 })), peak: Math.max(...seasons.map((s) => s.points)) };
}

function samplePool() {
    const positions = ['QB', 'RB', 'WR', 'TE'];
    const cards = new Map();
    let n = 0;
    for (const pos of positions) {
        for (let i = 0; i < 12; i += 1) {
            n += 1;
            const identity = `player:${pos}:p${n}`;
            cards.set(identity, card(identity, `Player ${n}`, pos, [{ season: 2000 + (i % 20), points: 10 + i }]));
        }
    }
    return cards;
}

function draftFullRoster(state, cards) {
    let next = state;
    let guard = 0;
    while (next.phase === 'draft') {
        guard += 1;
        assert.ok(guard < 2000, 'draft did not complete');
        const picksBefore = next.draftPicks.length;
        const board = Engine.eraEligibleCards(next, cards);
        for (const candidate of board) {
            next = Engine.applyDraftPick(next, candidate, { madeBy: 'human', createdAt: '2026-01-01T00:00:00Z' });
            if (next.draftPicks.length > picksBefore) break;
        }
        assert.ok(next.draftPicks.length > picksBefore);
    }
    return next;
}

test('catalog covers all four tiers with unique ids', () => {
    const ids = new Set(Achievements.catalog.map((a) => a.id));
    assert.strictEqual(ids.size, Achievements.catalog.length, 'no duplicate ids');
    const tiers = new Set(Achievements.catalog.map((a) => a.tier));
    assert.deepStrictEqual([...tiers].sort(), ['desk', 'performance', 'roster', 'season']);
});

test('a fresh, undrafted league earns nothing', () => {
    const state = Engine.createTimeLeague({ name: 'Fresh', seed: 'ach-fresh', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    const stats = Achievements.computeStats(state, state.teams[0].teamId);
    const { earned } = Achievements.evaluate(stats);
    assert.strictEqual(earned.length, 0);
});

test('champion badge earns only for the crowned team after the season completes', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Champ', seed: 'ach-champ', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings({ regularSeasonWeeks: 1 }), seats: seats() });
    state = draftFullRoster(state, cards);
    state = Engine.finalizeCurrentWeek(state, new Map(), null, '2026-01-01T00:00:00Z');
    assert.strictEqual(state.phase, 'complete');
    for (const team of state.teams) {
        const stats = Achievements.computeStats(state, team.teamId);
        const { earned } = Achievements.evaluate(stats);
        const hasChampion = earned.some((b) => b.id === 'champion');
        assert.strictEqual(hasChampion, team.teamId === state.championTeamId);
    }
});

test('dealmaker progresses toward its target as trades are accepted', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Dealmaker', seed: 'ach-deal', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const [teamA, teamB] = state.teams;
    const position = teamA.roster.find((e) => e.position !== 'QB').position;
    const give = teamA.roster.find((e) => e.position === position);
    const receive = teamB.roster.find((e) => e.position === position);
    let before = Achievements.evaluate(Achievements.computeStats(state, teamA.teamId));
    assert.strictEqual(before.earned.some((b) => b.id === 'dealmaker'), false);
    state = Engine.proposeTrade(state, { fromTeamId: teamA.teamId, toTeamId: teamB.teamId, giveEntryIds: [give.entryId], receiveEntryIds: [receive.entryId], note: '' }, '2026-01-01T00:00:00Z');
    state = Engine.respondToTrade(state, state.trades[0].tradeId, true, '', '2026-01-01T00:00:00Z');
    const after = Achievements.evaluate(Achievements.computeStats(state, teamA.teamId));
    const dealmaker = [...after.earned, ...after.unearned].find((b) => b.id === 'dealmaker');
    assert.strictEqual(dealmaker.value, 1);
    assert.ok(dealmaker.progress > 0 && dealmaker.progress < 1, 'one of two trades should be partial progress, not earned');
});

function completionFixture() {
    const state = Engine.createTimeLeague({ name: 'Saved title', seed: 'saved-title', createdAt: '2026-01-01T00:00:00Z',
        settings: baseSettings({ rosterSlots: { WR: 1, BN: 2 }, regularSeasonWeeks: 1, playoffTeams: 4 }), seats: seats() });
    const result = (teamId, total) => ({ teamId, total, starters: [] });
    const match = (home, away, homePoints, awayPoints, winner) => ({ home, away, homePoints, awayPoints, winner });
    return { ...state, phase: 'complete', currentWeek: 4, weekStage: 'postgame', seasonsRevealed: true, championTeamId: 't3', finalizedWeeks: [
        { week: 1, results: [result('t1', 40), result('t2', 30), result('t3', 20), result('t4', 10)], matchups: [match('t1', 't4', 40, 10, 't1'), match('t2', 't3', 30, 20, 't2')], headlines: [] },
        { week: 2, results: [result('t1', 10), result('t4', 20), result('t2', 10), result('t3', 20)], matchups: [match('t1', 't4', 10, 20, 't4'), match('t2', 't3', 10, 20, 't3')], headlines: [] },
        { week: 3, results: [result('t3', 25), result('t4', 25)], matchups: [match('t3', 't4', 25, 25, 't3')], headlines: [] },
    ] };
}

test('Runner-Up follows the saved tied title winner rather than regular-season seeding, including reload', () => {
    const state = completionFixture(), before = JSON.stringify(state);
    assert.strictEqual(Engine.computeStandings(state)[1].teamId, 't2', 'The second regular seed lost a semifinal');
    for (const snapshot of [state, Engine.normalizeTimeLeague(JSON.parse(before))]) {
        assert(snapshot);
        for (const team of snapshot.teams) {
            const stats = Achievements.computeStats(snapshot, team.teamId);
            assert.strictEqual(stats.runnerUp, team.teamId === 't4');
            assert.strictEqual(Achievements.evaluate(stats).earned.some(badge => badge.id === 'runner_up'), team.teamId === 't4');
        }
    }
    assert.strictEqual(JSON.stringify(state), before, 'Reading trophies cannot change a saved tied result');
    assert.strictEqual(Achievements.computeStats({ ...state, phase: 'season' }, 't4').runnerUp, false);
});

test('Runner-Up supports standings-only legacy seasons without fabricating an incomplete playoff medal', () => {
    const complete = completionFixture();
    const regular = { ...complete, currentWeek: 2, championTeamId: 't1', settings: { ...complete.settings, playoffTeams: 0 }, finalizedWeeks: complete.finalizedWeeks.slice(0, 1) };
    assert.strictEqual(Achievements.computeStats(regular, 't2').runnerUp, true);
    const legacy = { ...regular, settings: { ...regular.settings } }; delete legacy.settings.playoffTeams;
    assert.strictEqual(Achievements.computeStats(legacy, 't2').runnerUp, true);
    const oldPlayoffs = { ...complete, settings: { ...complete.settings } }; delete oldPlayoffs.settings.playoffTeams;
    assert.strictEqual(Achievements.computeStats(oldPlayoffs, 't4').runnerUp, true, 'Saved postseason evidence takes priority over a missing old setting');
    for (const finalizedWeeks of [complete.finalizedWeeks.slice(0, 1), complete.finalizedWeeks.slice(0, 2),
        [...complete.finalizedWeeks.slice(0, 1), { ...complete.finalizedWeeks[1], matchups: [{ home: 't3', away: 't4', homePoints: 25, awayPoints: 25, winner: 't3' }] }],
        [...complete.finalizedWeeks.slice(0, 2), { ...complete.finalizedWeeks[2], matchups: [{ ...complete.finalizedWeeks[2].matchups[0], winner: null }] }]]) {
        const ambiguous = { ...complete, finalizedWeeks };
        assert(ambiguous.teams.every(team => !Achievements.computeStats(ambiguous, team.teamId).runnerUp));
    }
});

test('Wire Wizard survives actual accepted trades, another waiver drop and reload without summing overlapping evidence', () => {
    const stamp = '2026-01-01T00:00:00Z';
    let state = Engine.createTimeLeague({ name: 'Durable awards', seed: 'durable-awards', createdAt: stamp,
        settings: baseSettings({ rosterSlots: { WR: 1, BN: 2 }, regularSeasonWeeks: 2 }), seats: seats(2) });
    const entry = (number, slot, acquiredVia) => ({ entryId: `e${number}`, identity: `player:WR:award-${number}`, name: `Award ${number}`, position: 'WR', slot, drawnSeason: 2000, acquiredVia, acquiredWeek: 1 });
    state = { ...state, phase: 'season', weekStage: 'lineup', seasonsRevealed: true, teams: state.teams.map((team, index) => ({ ...team,
        roster: [entry(index * 3 + 1, 'WR', index ? 'draft' : 'waiver'), entry(index * 3 + 2, 'BN', index ? 'draft' : 'waiver'), entry(index * 3 + 3, 'BN', index ? 'draft' : 'waiver')] })),
        waiverResults: [1, 2, 3].map(number => ({ week: 1, identity: `player:WR:award-${number}`, name: `Award ${number}`, winnerTeamId: 't1', contenderTeamIds: ['t1'] })) };
    const badge = snapshot => Achievements.evaluate(Achievements.computeStats(snapshot, 't1')).earned.some(item => item.id === 'wire_wizard');
    assert.strictEqual(Achievements.computeStats(state, 't1').waiverAdds, 3, 'Three receipts and the same three roster entries mean three awards, not six');
    assert(badge(state));
    state = Engine.proposeTrade(state, { fromTeamId: 't1', toTeamId: 't2', giveEntryIds: ['e3'], receiveEntryIds: ['e6'] }, stamp);
    state = Engine.respondToTrade(state, state.trades[0].tradeId, true, '', stamp);
    assert.strictEqual(state.trades[0].status, 'accepted');
    assert.strictEqual(state.teams[0].roster.filter(row => row.acquiredVia === 'waiver').length, 2);
    state = Engine.normalizeTimeLeague(JSON.parse(JSON.stringify(state))); assert(state); assert(badge(state));
    assert.strictEqual(Achievements.computeStats(state, 't1').waiverAdds, 3);
    const replacement = card('player:WR:award-100', 'Replacement', 'WR', [{ season: 2000, points: 100 }]);
    state = Engine.submitWaiverClaim(state, { teamId: 't1', addIdentity: replacement.identity, addName: replacement.name, addPosition: 'WR', dropEntryId: 'e2' }, stamp);
    state = Engine.processWaivers(state, new Map([[replacement.identity, replacement]]), stamp);
    assert.strictEqual(state.waiverResults.length, 4);
    assert.strictEqual(Achievements.computeStats(state, 't1').waiverAdds, 4);
    assert(badge(Engine.normalizeTimeLeague(JSON.parse(JSON.stringify(state)))));
});

test('Wire Wizard ignores duplicate/foreign/invalid receipts and retains conservative no-receipt roster evidence', () => {
    const state = completionFixture(), own = { week: 1, identity: 'one-award', winnerTeamId: 't1' };
    const duplicated = { ...state, waiverResults: [own, { ...own }, { ...own }, { ...own, winnerTeamId: 't2' }, { ...own, week: -1 }, { ...own, identity: '' }] };
    assert.strictEqual(Achievements.computeStats(duplicated, 't1').waiverAdds, 1);
    assert(!Achievements.evaluate(Achievements.computeStats(duplicated, 't1')).earned.some(item => item.id === 'wire_wizard'));
    const legacy = { ...state, teams: state.teams.map((team, index) => index ? team : { ...team, roster: [1, 2, 3].map(number => ({ identity: `legacy-${number}`, acquiredVia: 'waiver', drawnSeason: 2000 })) }) };
    delete legacy.waiverResults;
    assert.strictEqual(Achievements.computeStats(legacy, 't1').waiverAdds, 3);
    assert(Achievements.evaluate(Achievements.computeStats(legacy, 't1')).earned.some(item => item.id === 'wire_wizard'));
    assert.strictEqual(Achievements.computeStats({ ...legacy, waiverResults: [own] }, 't1').waiverAdds, 3, 'Partial receipt and legacy roster evidence are not added together');
});

function milestoneDraft() {
    const stamp = '2026-01-01T00:00:00Z';
    let state = Engine.createTimeLeague({ name: 'Roster milestones', seed: 'roster-milestones', createdAt: stamp,
        settings: baseSettings({ rosterSlots: { WR: 1, BN: 3 }, regularSeasonWeeks: 2 }), seats: seats(2) });
    const counts = new Map();
    while (state.phase === 'draft') {
        const teamId = Engine.currentDraftSeat(state).teamId, index = counts.get(teamId) || 0;
        const year = teamId === 't1' ? [1970, 1990, 2000, 2010][index] : 2000;
        const candidate = card(`player:WR:${teamId}-${index}`, `${teamId} WR ${index}`, 'WR', [{ season: year, points: 100 }]);
        state = Engine.applyDraftPick(state, candidate, { madeBy: 'human', createdAt: stamp });
        counts.set(teamId, index + 1);
    }
    return state;
}
const earnedIds = (state, teamId = 't1') => Achievements.evaluate(Achievements.computeStats(state, teamId)).earned.map(badge => badge.id);

test('draft milestones survive a legal pregame trade and waiver drop before any saved game', () => {
    const stamp = '2026-01-01T00:00:00Z', drafted = milestoneDraft();
    assert.strictEqual(drafted.finalizedWeeks.length, 0); assert.strictEqual(drafted.teams[0].bestDecadeSpread, 4);
    assert.strictEqual(drafted.teams[0].preNinetyRostered, 1);
    assert(earnedIds(drafted).includes('time_traveler')); assert(earnedIds(drafted).includes('relic_hunter'));
    // A legacy save still has its current qualifying roster, but no counters.
    const legacy = JSON.parse(JSON.stringify(drafted));
    legacy.teams.forEach(team => { delete team.bestDecadeSpread; delete team.preNinetyRostered; });
    const give = legacy.teams[0].roster.find(entry => entry.drawnSeason === 1970), receive = legacy.teams[1].roster.find(entry => entry.slot === 'BN');
    let traded = Engine.proposeTrade(legacy, { fromTeamId: 't1', toTeamId: 't2', giveEntryIds: [give.entryId], receiveEntryIds: [receive.entryId] }, stamp);
    traded = Engine.respondToTrade(traded, traded.trades.at(-1).tradeId, true, '', stamp);
    assert.strictEqual(traded.trades.at(-1).status, 'accepted');
    assert.strictEqual(Engine.rosterMilestones(traded.teams[0].roster, traded.settings).bestDecadeSpread, 3);
    assert.strictEqual(Engine.rosterMilestones(traded.teams[0].roster, traded.settings).preNinetyRostered, 0);
    const reloaded = Engine.normalizeTimeLeague(JSON.parse(JSON.stringify(traded)));
    assert(earnedIds(reloaded).includes('time_traveler')); assert(earnedIds(reloaded).includes('relic_hunter'));
    const replacement = card('player:WR:milestone-replacement', 'Modern replacement', 'WR', [{ season: 2000, points: 100 }]);
    let waived = Engine.submitWaiverClaim(legacy, { teamId: 't1', addIdentity: replacement.identity, addName: replacement.name, addPosition: 'WR', dropEntryId: give.entryId }, stamp);
    waived = Engine.processWaivers(waived, new Map([[replacement.identity, replacement]]), stamp);
    assert.strictEqual(waived.teams[0].bestDecadeSpread, 4); assert.strictEqual(waived.teams[0].preNinetyRostered, 1);
    assert(earnedIds(Engine.normalizeTimeLeague(JSON.parse(JSON.stringify(waived)))).includes('relic_hunter'));
    assert.strictEqual(Engine.processWaivers(waived, new Map([[replacement.identity, replacement]]), stamp), waived);
});

test('old receipt-less Wire Wizard is captured before a trade then increments only for a new actual award', () => {
    const stamp = '2026-01-01T00:00:00Z'; let state = milestoneDraft();
    state.teams[0].roster = state.teams[0].roster.map((entry, index) => index < 3 ? { ...entry, acquiredVia: 'waiver' } : entry);
    state.waiverResults = []; delete state.teams[0].waiverClaimsLanded;
    assert(earnedIds(state).includes('wire_wizard'));
    const give = state.teams[0].roster[1], receive = state.teams[1].roster.find(entry => entry.slot === 'BN');
    state = Engine.proposeTrade(state, { fromTeamId: 't1', toTeamId: 't2', giveEntryIds: [give.entryId], receiveEntryIds: [receive.entryId] }, stamp);
    state = Engine.respondToTrade(state, state.trades.at(-1).tradeId, true, '', stamp);
    assert.strictEqual(state.teams[0].roster.filter(entry => entry.acquiredVia === 'waiver').length, 2);
    assert.strictEqual(state.teams[0].waiverClaimsLanded, 3);
    state = Engine.normalizeTimeLeague(JSON.parse(JSON.stringify(state))); assert(earnedIds(state).includes('wire_wizard'));
    const replacement = card('player:WR:legacy-next', 'New award', 'WR', [{ season: 2000, points: 100 }]);
    state = Engine.submitWaiverClaim(state, { teamId: 't1', addIdentity: replacement.identity, addName: replacement.name, addPosition: 'WR', dropEntryId: receive.entryId }, stamp);
    state = Engine.processWaivers(state, new Map([[replacement.identity, replacement]]), stamp);
    assert.strictEqual(state.teams[0].waiverClaimsLanded, 4); assert.strictEqual(state.waiverResults.length, 1);
    const once = JSON.stringify(state); assert.strictEqual(Engine.processWaivers(state, new Map([[replacement.identity, replacement]]), stamp), state);
    assert.strictEqual(JSON.stringify(state), once);
    assert.strictEqual(Achievements.computeStats(Engine.normalizeTimeLeague(JSON.parse(once)), 't1').waiverAdds, 4);
});

test('a reopened revealed Hidden Years save captures a new waiver peak before the next save', () => {
    const stamp = '2026-01-01T00:00:00Z'; let state = milestoneDraft();
    state = { ...state, settings: { ...state.settings, hiddenYears: true }, yearsRevealed: true,
        teams: state.teams.map(team => ({ ...team, bestDecadeSpread: 0, preNinetyRostered: 0,
            roster: team.roster.map(entry => ({ ...entry, drawnSeason: 2000, hiddenDecade: undefined })) })) };
    const replacement = card('player:WR:revealed-old-award', 'Public old season', 'WR', [{ season: 1970, points: 100 }]);
    state = Engine.submitWaiverClaim(state, { teamId: 't1', addIdentity: replacement.identity, addName: replacement.name, addPosition: 'WR', dropEntryId: state.teams[0].roster[1].entryId }, stamp);
    state = Engine.processWaivers(state, new Map([[replacement.identity, replacement]]), stamp);
    assert.strictEqual(state.teams[0].bestDecadeSpread, 2, 'The public old/new roster combination is recorded in the award transition');
    assert.strictEqual(state.teams[0].preNinetyRostered, 1);
    assert.strictEqual(Engine.normalizeTimeLeague(JSON.parse(JSON.stringify(state))).teams[0].bestDecadeSpread, 2);
});

test('legacy roster backfill uses each own saved starter cohort without inventing a cross-week or cross-owner roster', () => {
    let state = milestoneDraft();
    const snapshot = (number, year) => ({ entryId: `s${number}`, identity: `player:WR:s${number}`, name: `Snapshot ${number}`, position: 'WR', drawnSeason: year, slot: 'WR', points: 0, factor: 1, stats: null });
    state.teams = state.teams.map(team => ({ ...team, roster: team.roster.map(entry => ({ ...entry, drawnSeason: 2000 })) }));
    state.teams.forEach(team => { delete team.bestDecadeSpread; delete team.preNinetyRostered; });
    const allDecades = [1970, 1980, 1990, 2000].map((year, index) => snapshot(index, year));
    state.finalizedWeeks = [
        { week: 1, results: [{ teamId: 't1', total: 0, starters: allDecades.slice(0, 2) }, { teamId: 't2', total: 0, starters: allDecades }], matchups: [], headlines: [], playerProduction: allDecades },
        { week: 2, results: [{ teamId: 't1', total: 0, starters: allDecades.slice(2) }], matchups: [], headlines: [] },
    ];
    const before = JSON.stringify(state), partial = Engine.normalizeTimeLeague(JSON.parse(before));
    assert.strictEqual(partial.teams[0].bestDecadeSpread, 2); assert.strictEqual(partial.teams[0].preNinetyRostered, 2);
    assert(!earnedIds(partial).includes('time_traveler')); assert(earnedIds(partial).includes('relic_hunter'));
    const proven = Engine.normalizeTimeLeague({ ...state, finalizedWeeks: [...state.finalizedWeeks, { week: 3, results: [{ teamId: 't1', total: 0, starters: allDecades }], matchups: [], headlines: [] }] });
    assert.strictEqual(proven.teams[0].bestDecadeSpread, 4); assert(earnedIds(proven).includes('time_traveler'));
    assert.strictEqual(JSON.stringify(state), before);
    const unrecorded = Engine.normalizeTimeLeague({ ...state, finalizedWeeks: [], waiverResults: { malformed: true } });
    assert.strictEqual(unrecorded.teams[0].bestDecadeSpread, 1); assert(!earnedIds(unrecorded).includes('relic_hunter'), 'Unknown old bench or between-game history is not fabricated');
});

test('public draft omits all milestone counters and active Hidden Years never reads assigned seasons', () => {
    const drafted = milestoneDraft(), counters = ['bestDecadeSpread', 'preNinetyRostered', 'waiverClaimsLanded'];
    const state = { ...drafted, settings: { ...drafted.settings, gameDeckVersion: 1, hiddenYears: true }, phase: 'draft', seasonsRevealed: false,
        teams: drafted.teams.map(team => ({ ...team, bestDecadeSpread: 4, preNinetyRostered: 1, waiverClaimsLanded: 3, roster: team.roster.map(entry => {
            const safe = { ...entry, hiddenDecade: App.TimeLeagueEraRules.decadeOf(entry.drawnSeason) }; delete safe.drawnSeason;
            Object.defineProperty(safe, 'drawnSeason', { get() { throw Error('Milestones read a sealed assigned season'); } }); return safe;
        }) })) };
    const sealed = Public.projectPublicState(state, 't1');
    assert(sealed.teams.every(team => counters.every(key => !Object.hasOwn(team, key))));
    // Even unexpected counters sent by an old source cannot enter sealed state.
    const safe = Engine.normalizePublicTimeLeague({ ...sealed, teams: sealed.teams.map(team => ({ ...team, bestDecadeSpread: 4, preNinetyRostered: 1, waiverClaimsLanded: 3 })) });
    assert(safe.teams.every(team => counters.every(key => !Object.hasOwn(team, key))));
    const active = { ...state, phase: 'season', seasonsRevealed: true };
    assert.strictEqual(Achievements.computeStats(active, 't1').decadeSpread, 4);
    const visible = Public.projectPublicState(active, 't1');
    assert.strictEqual(visible.teams[0].bestDecadeSpread, 4); assert.strictEqual(visible.teams[0].waiverClaimsLanded, 3);
    assert.strictEqual(Engine.normalizePublicTimeLeague(visible).teams[0].preNinetyRostered, 1);
    const revealed = { ...drafted, settings: { ...drafted.settings, gameDeckVersion: 1, hiddenYears: true }, yearsRevealed: true, phase: 'season' };
    revealed.teams = revealed.teams.map(team => ({ ...team, bestDecadeSpread: 0, preNinetyRostered: 0, roster: team.roster.map(entry => ({ ...entry, hiddenDecade: undefined })) }));
    assert.strictEqual(Achievements.computeStats(revealed, 't1').decadeSpread, 4, 'Already revealed years remain valid evidence in a reopened old season');
});

test('tierLabel and tierColor cover every tier used by the catalog', () => {
    for (const badge of Achievements.catalog) {
        assert.strictEqual(typeof Achievements.tierLabel(badge.tier), 'string');
        assert.ok(Achievements.tierLabel(badge.tier).length > 0);
        assert.ok(Achievements.tierColor(badge.tier).length > 0);
    }
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
