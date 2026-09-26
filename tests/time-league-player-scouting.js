'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years', 'player-stats', 'public-state']) require('../js/shared/time-league-' + name + '.js');
const { TimeLeagueEngine: E, TimeLeagueSeason: S, TimeLeaguePlayerStats: P, TimeLeaguePublicState: Public } = App;
const identity = 'scout:QB', line = overrides => ({ ...S.emptyStatLine(), ...overrides });
const logs = S.buildGameLogIndex([[-4, 0, 8], [-2, 0, 4]].flatMap((scores, year) => scores.map((points, i) => ({
    identity, season: 2000 + year, week: i + 1, historicalWeek: i + 1, gameDate: `${2000 + year}-09-0${i + 1}`,
    team: 'HOM', opponent: 'AWY', scheduledGames: 14, stats: points < 0 ? line({ passInt: -points / 2 }) : line({ passYd: points * 25 }),
}))));
const card = { identity, name: 'Scout QB', position: 'QB', seasons: [{ season: 2000, games: 3, points: 4 }, { season: 2001, games: 3, points: 2 }] };
const cards = new Map([[identity, card]]);
const entry = { identity, name: card.name, position: 'QB', entryId: 'p1', editionId: `mystery:${identity}`, drawnSeason: 2000, slot: 'QB' };
const base = E.createTimeLeague({ name: 'Public scouting', seed: 'private-seed', seats: [{ name: 'Home', manager: 'human' }, { name: 'Away', manager: 'human' }],
    settings: { scoring: { passingYd: .04, passTd: 4, rushRecYd: .1, reception: .5, turnover: -2 }, gameDeckVersion: 1, hiddenYears: true, regularSeasonWeeks: 3, playoffTeams: 0, rosterSlots: { QB: 1, BN: 1 }, eraRules: { mode: 'any-era', decades: [] } } });
const state = { ...base, phase: 'season', seasonsRevealed: true, currentWeek: 2, weekStage: 'lineup',
    hiddenYearCandidates: { [identity]: [2000, 2001] }, hiddenYearDecades: { [identity]: '2000s' },
    teams: base.teams.map((team, i) => ({ ...team, roster: i ? [] : [entry] })),
    privateGameDecks: { [S.editionKey(entry)]: [1, 2, 3, ...Array(11).fill(null)] },
    finalizedWeeks: [{ week: 1, results: [], playerProduction: [{ ...entry, points: -4, stats: line({ passInt: 2 }) }] }],
};
const scout = (league = state, player = entry, index = logs, factors = null, throughWeek) => P.scouting(league, player, cards, index, factors, throughWeek);
const identified = scout();
assert.equal(identified.identifiedYear, 2000, 'Distinctive completed production identifies the public candidate');
assert.equal(identified.currentAvailable, true); assert(identified.currentStars >= 1 && identified.currentStars <= 5);
assert.equal(identified.average, -4); assert.equal(identified.games, 1);
const missingPoints = { ...state, finalizedWeeks: [{ week: 1, results: [], playerProduction: [{ ...entry, points: null, stats: line({ passInt: 2 }) }] }] };
assert.equal(scout(missingPoints).average, null); assert.equal(scout(missingPoints).points, null, 'Missing completed scores cannot pretend to be a zero');
assert.equal(identified.archivePoints, 4); assert.equal(identified.archiveGames, 3);
assert.equal(identified.remainingPoints, 8, 'A consumed negative game increases the unused pool; it is never clamped');
assert.equal(identified.remainingEstimated, false); assert.equal(identified.remainingBasis, 'unused archive');
assert.equal(identified.remainingGames, 2); assert.equal(identified.remainingWeeks, 2);
assert.equal(identified.playableRemaining, 1.23, 'Playable expectation includes unused documented no-record slots, without consulting their assignment');
assert.equal(identified.playableRemainingEstimated, true);
assert.deepEqual(identified.archive.map(row => row.observed), [true, false, false]);
assert.deepEqual(identified.archive.map(row => row.points), [-4, 0, 8], 'Archive includes scored zero and negative appearances');
assert.equal(identified.archive[0].opponent, 'AWY'); assert.equal(identified.archive[0].historicalWeek, 1);
assert(!JSON.stringify(identified).includes('private-seed'));
assert(!Object.hasOwn(identified, 'drawnSeason')); assert(!Object.hasOwn(identified, 'schedule'));

const replay = scout(state, entry, logs, null, 0);
assert.equal(replay.currentStars, null); assert.equal(replay.currentAvailable, null);
assert.equal(replay.identifiedYear, null); assert.equal(replay.archive.length, 0);
assert.equal(replay.remainingBasis, 'candidate archive estimate'); assert.equal(replay.remainingPoints, 3);
assert.equal(replay.remainingEstimated, true, 'Ambiguous years stay explicitly estimated');
assert.equal(replay.games, 0); assert.equal(replay.average, null);
assert.equal(scout(state, entry, null).remainingPoints, -8, 'Without an archive, completed production can only supply a labelled estimate');
assert.equal(scout(state, entry, null).remainingBasis, 'completed-game estimate');
const noEvidence = { ...state, currentWeek: 1, finalizedWeeks: [] };
assert.equal(scout(noEvidence, entry, null).remainingPoints, null, 'Reference-scored metadata is never passed off as a league-scored estimate');
assert.equal(scout({ ...state, settings: { ...state.settings, eraAdjusted: true } }).archive.length, 0, 'Adjusted archive values require factors');
const adjusted = scout({ ...state, settings: { ...state.settings, eraAdjusted: true } }, entry, logs, new Map([['2000:QB', 1.5], ['2001:QB', 1.5]]));
assert.equal(adjusted.remainingPoints, 12); assert.equal(adjusted.archivePoints, 6);

const wireEntry = { ...entry }; delete wireEntry.drawnSeason;
const released = { ...state, teams: state.teams.map(team => ({ ...team, roster: [] })) };
assert.deepEqual(scout(released, wireEntry), identified, 'Solo free-agent clues use the same fixed edition without exposing its private year');
const releasedPublic = Public.projectPublicState(released, 't1', [], cards, '2026-09-26T12:00:00Z', { logIndex: logs });
assert.equal(scout(releasedPublic, wireEntry).currentStars, identified.currentStars, 'Online wire reports preserve current clue parity');

const publicState = Public.projectPublicState(state, 't1', [], cards, '2026-09-26T12:00:00Z', { logIndex: logs });
const publicEntry = publicState.teams[0].roster[0];
for (const key of ['privateGameSeed', 'privateGameDecks', 'privateDraws', 'hiddenYearAssignments', 'seed']) Object.defineProperty(publicState, key, { get() { throw new Error('Private data read: ' + key); } });
Object.defineProperty(publicEntry, 'drawnSeason', { get() { throw new Error('Private year read'); } });
const online = scout(publicState, publicEntry);
assert.deepEqual(online, identified, 'Solo and online scouting use the same current public clue and public archive evidence');
assert.equal(P.signals(publicState, publicEntry, null).currentStars, identified.currentStars, 'Current public clues work before archive loading');
const report = publicState.playerReports[entry.editionId];
assert.deepEqual(Object.keys(report).sort(), ['average', 'completed', 'currentAvailable', 'currentStars', 'estimatedRemaining', 'maxRemainingStars', 'remaining', 'week']);
assert.equal(report.maxRemainingStars, null);
for (const key of ['sourceWeek', 'sourceGameId', 'drawnSeason', 'stars']) assert(!report.completed.some(row => Object.hasOwn(row, key)));
const stale = { ...publicState, playerReports: { [entry.editionId]: { ...report, week: 1 } } };
assert.equal(P.signals(stale, publicEntry, logs).currentStars, null, 'Expired online clues cannot become this week predictions');
const bad = Public.sanitizePlayerReports({ [entry.editionId]: { ...report, currentStars: 99, currentAvailable: true, sourceWeek: 3 } }, 2, true);
assert.equal(bad[entry.editionId].currentStars, null); assert(!Object.hasOwn(bad[entry.editionId], 'sourceWeek'));
const staleSafe = Public.sanitizePlayerReports({ [entry.editionId]: { ...report, week: 1 } }, 2, true);
assert.equal(staleSafe[entry.editionId].currentStars, null); assert.equal(staleSafe[entry.editionId].currentAvailable, null);

for (const gate of [{ seasonsRevealed: false }, { phase: 'draft' }, { weekStage: 'postgame' }, { phase: 'complete' }]) {
    const gated = { ...state, ...gate };
    const signal = scout(gated);
    assert.equal(signal.currentStars, null); assert.equal(signal.currentAvailable, null);
    if (gate.phase === 'draft' || gate.seasonsRevealed === false) { assert.equal(signal.identifiedYear, null); assert.equal(signal.remainingPoints, null); assert.equal(signal.archive.length, 0); }
    const projected = Public.projectPublicState(gated, 't1', [], cards, '2026-09-26T12:00:00Z', { logIndex: logs });
    assert(Object.values(projected.playerReports || {}).every(row => row.currentStars == null && row.currentAvailable == null));
}
const ended = scout({ ...state, phase: 'complete', currentWeek: 4, finalizedWeeks: state.finalizedWeeks });
assert.equal(ended.remainingPoints, 8, 'Unused archive remains inspectable after a short season');
assert.equal(ended.playableRemaining, 0, 'No playable points are promised after the Vault season');

// A shared stat line may prove that one copy was consumed, never its date.
const twinRows = [1, 2].map(week => ({ identity, season: 2000, week, stats: line({ passYd: 100 }) }));
const twinCards = new Map([[identity, { ...card, seasons: [{ season: 2000, games: 2, points: 8 }] }]]);
const twinState = { ...state, publicSnapshotVersion: 1, hiddenYearCandidates: { [identity]: [2000] }, playerReports: {},
    finalizedWeeks: [{ week: 1, playerProduction: [{ ...entry, stats: line({ passYd: 100 }), points: 4 }], results: [] }] };
const twins = P.scouting(twinState, entry, twinCards, S.buildGameLogIndex(twinRows));
assert.deepEqual(twins.archive.map(row => row.observed), [null, null]); assert.equal(twins.remainingPoints, 4);
console.log('PASS: current-only mystery scouting, public evidence identity, signed archive remainder, playable estimates, duplicate ambiguity, playback and reconnect gates.');
