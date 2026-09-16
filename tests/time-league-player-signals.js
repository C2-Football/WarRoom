'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'player-stats']) require('../js/shared/time-league-' + name + '.js');
const { TimeLeaguePlayerStats: P, TimeLeagueEngine: E, TimeLeagueSeason: S } = App;
const entry = { entryId: 'starter', identity: 'test:QB', name: 'Test QB', position: 'QB', drawnSeason: 2000, slot: 'QB', acquiredWeek: 3 };
const league = { ...E.createTimeLeague({ name: 'Visible signals', seed: 'visible-signals', seats: [{ name: 'Home', manager: 'human' }, { name: 'Away', manager: 'ai' }],
    settings: { gameDeckVersion: 0, regularSeasonWeeks: 12, rosterSlots: { QB: 1, BN: 2 }, scoring: { passingYd: .04, passTd: 6, rushRecYd: .1, reception: .5, turnover: -2 }, eraRules: { mode: 'any-era', decades: [] } } }),
    phase: 'season', weekStage: 'lineup', currentWeek: 4, seasonsRevealed: true,
    finalizedWeeks: [1, 2, 3].map(week => ({ week, results: [] })) };
const line = stats => ({ ...S.emptyStatLine(), ...stats });
const logs = S.buildGameLogIndex([
    { identity: entry.identity, season: 2000, week: 1, stats: line({ passYd: 200, passTd: 1 }) },
    { identity: entry.identity, season: 2000, week: 2, stats: line({ passInt: 2 }) },
    { identity: entry.identity, season: 2000, week: 4, stats: line({ passYd: 1000 }) },
]);
const read = (state = league, player = entry, index = logs, factors = null, throughWeek) => P.signals(state, player, index, factors, throughWeek);

const actual = read();
assert.equal(actual.points, 10); assert.equal(actual.games, 2); assert.equal(actual.average, 5, 'Completed actual games, not calendar weeks, divide custom-scored player production');
assert.equal(actual.status, 'ready'); assert.equal(actual.currentAvailable, true); assert.equal(actual.currentStars, 5);
assert.equal(read(league, { ...entry, entryId: 'waiver', acquiredWeek: 4, slot: 'BN' }).average, 5, 'Bench and pre-acquisition production remain comparable');
assert.equal(read(league, entry, logs, null, 1).average, 14, 'Playback averages stop at their visible completed week');
assert.equal(read(league, entry, logs, null, 1).currentStars, null, 'Playback cannot reveal the next assigned game rating');
assert.equal(read(league, entry, logs, null, 1).status, 'awaiting-week');

const saved = { ...league, finalizedWeeks: league.finalizedWeeks.map(row => row.week === 1 ? { ...row, playerProduction: [{ ...entry, points: 12, stats: line({ passYd: 200, passTd: 1 }) }] } : row) };
assert.equal(read(saved).average, 4, 'Saved finalized scoring wins over rescoring the archive');
const zeroLogs = S.buildGameLogIndex([{ identity: entry.identity, season: 2000, week: 1, stats: line({}) }]);
assert.equal(read(league, entry, zeroLogs).average, 0, 'A recorded scoreless game is a real zero average');
assert.equal(read(league, entry, zeroLogs).games, 1);
assert.equal(read(league, entry, zeroLogs).currentAvailable, false, 'A current no-record week stays distinct from a scoreless appearance');
assert.equal(read(league, entry, zeroLogs).currentStars, null);
assert.equal(read(league, entry, new Map()).average, null, 'No recorded appearances have no average');
assert.equal(read(league, entry, new Map()).games, 0);
assert.equal(read(league, entry, null).average, null, 'An unloaded archive is not a zero');
assert.equal(read(league, entry, null).games, null);
assert.equal(read(league, entry, null).status, 'unavailable');
const negative = read({ ...league, finalizedWeeks: [{ week: 2, results: [] }] });
assert.equal(negative.average, -4, 'Negative performance is retained');
assert.equal(read({ ...league, finalizedWeeks: [], currentWeek: 1 }).average, null, 'Week one does not imply an observed zero PPG');

const eraLeague = { ...league, settings: { ...league.settings, eraAdjusted: true } };
assert.equal(read(eraLeague).average, null, 'Adjusted averages wait for era factors');
assert.equal(read(eraLeague, entry, logs, new Map([['2000:QB', 1.3333]])).average, 6.67, 'Era rounding happens per game before averaging');
const legacyIndex = new Map(logs); legacyIndex.legacyIndex = zeroLogs;
assert.equal(read(league, entry, legacyIndex).average, 0, 'Legacy leagues retain their original archive');
const legacyFactors = new Map([['2000:QB', 5]]); legacyFactors.legacyFactors = new Map([['2000:QB', 2]]);
assert.equal(read(eraLeague, entry, logs, legacyFactors).average, 10, 'Legacy leagues retain their original era factors');

for (const state of [{ ...league, seasonsRevealed: false }, { ...league, phase: 'draft', seasonsRevealed: false }]) {
    assert.equal(read(state).status, 'sealed'); assert.equal(read(state).average, null); assert.equal(read(state).currentStars, null);
}
assert.equal(read(league, { ...entry, drawnSeason: null }).status, 'sealed', 'Unassigned online waiver editions stay sealed');
for (const state of [{ ...league, weekStage: 'postgame' }, { ...league, phase: 'complete' }, { ...league, currentWeek: 30 }]) {
    assert.equal(read(state).average, 5); assert.equal(read(state).currentStars, null); assert.equal(read(state).currentAvailable, null);
}

// Online free agents only have completed source references. Public reports
// authorize the current clue; the archive must never reconstruct a private deck.
const report = { week: 4, currentAvailable: true, currentStars: 3, completed: [
    { week: 1, sourceWeek: 1, points: 12 }, { week: 2, sourceWeek: 2, points: -4 }, { week: 3, sourceWeek: null, points: 0 },
] };
const online = { ...league, publicSnapshotVersion: 1, seed: undefined, settings: { ...league.settings, gameDeckVersion: 1 }, playerReports: { [S.editionKey(entry)]: report } };
const remote = read(online);
assert.equal(remote.average, 4); assert.equal(remote.games, 2); assert.equal(remote.currentStars, 3, 'Online current rating comes exclusively from the public report');
assert.equal(read(online, entry, null).average, null, 'Online free-agent references await archive data before reporting production');
assert.equal(read(online, entry, null).currentStars, 3, 'Authorized online current ratings do not require the local archive');
const missingReport = read({ ...online, playerReports: {} });
assert.equal(missingReport.currentAvailable, null); assert.equal(missingReport.currentStars, null); assert.equal(missingReport.average, null);
const stale = read({ ...online, playerReports: { [S.editionKey(entry)]: { ...report, week: 3 } } });
assert.equal(stale.status, 'unavailable'); assert.equal(stale.currentStars, null, 'A stale report cannot pretend to describe the current week');
const gated = read({ ...online, weekStage: 'postgame' });
assert.equal(gated.currentStars, null); assert.equal(gated.currentAvailable, null, 'Even a stale server clue cannot bypass the postgame gate');
assert.equal(read({ ...online, playerReports: { [S.editionKey(entry)]: { ...report, currentAvailable: false, currentStars: 5 } } }).currentStars, null);
assert.equal(read({ ...online, playerReports: { [S.editionKey(entry)]: { ...report, currentStars: 99 } } }).currentStars, null);
assert.deepEqual(Object.keys(remote).sort(), ['average', 'currentAvailable', 'currentStars', 'games', 'points', 'status'], 'Decision signals contain no future dates, source assignments or invented probabilities');
console.log('PASS: comparable player averages, zero and missing data, custom and legacy scoring, playback gates, and public current-game ratings.');
