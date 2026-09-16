'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years', 'player-stats', 'public-state', 'ai', 'actions']) require('../js/shared/time-league-' + name + '.js');
const { TimeLeagueEngine: E, TimeLeagueSeason: S, TimeLeagueHiddenYears: H, TimeLeaguePlayerStats: Stats, TimeLeaguePublicState: Public, TimeLeagueActions: Actions } = App;
const stamp = '2026-09-15T12:00:00Z', scoring = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
const cards = new Map(), gameRows = [];
for (let player = 1; player <= 6; player++) {
    const seasons = [1991, 1992, 1993].map(season => {
        let points = 0;
        for (let week = 1; week <= 14; week++) {
            const stats = { ...S.emptyStatLine(), passYd: (season - 1990) * 100 + week * player, passInt: week === 1 ? 1 : 0 };
            points += S.scoreStatLine(stats, scoring);
            gameRows.push({ identity: `p${player}`, name: `Player ${player}`, position: 'QB', season, week, stats, sourceGameId: `${season}_secret_${week}`, source: `archive-${season}`, scheduledGames: 14 });
        }
        return { season, games: 14, points, passYd: 0, passTd: 0, passInt: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0, sourceWeeks: Array.from({ length: 14 }, (_, i) => i + 1) };
    });
    cards.set(`p${player}`, { identity: `p${player}`, name: `Player ${player}`, position: 'QB', peak: Math.max(...seasons.map(s => s.points)), seasons });
}
const index = S.buildGameLogIndex(gameRows);
const create = overrides => E.createTimeLeague({ name: 'Hidden years', seed: 'hidden-year-fixture', createdAt: stamp,
    seats: [{ name: 'One', manager: 'human' }, { name: 'Two', manager: 'human' }], settings: { gameDeckVersion: 1, regularSeasonWeeks: 3, playoffTeams: 0, maxQuarterbacks: 3,
        rosterSlots: { QB: 1, BN: 1 }, scoring, eraRules: { mode: 'selected-decades', decades: ['1990s'] }, tradesEnabled: true, waiversEnabled: true, ...overrides } });
const draft = state => [...cards.values()].slice(0, 4).reduce((next, card) => E.applyDraftPick(next, card, { madeBy: 'human', createdAt: stamp }), state);
let league = draft(create()), player = league.teams[0].roster[0];
assert.equal(league.settings.hiddenYears, true, 'New full-game seasons default to hidden years');
assert.equal(create({ hiddenYears: false }).settings.hiddenYears, false);
assert.equal(create({ gameDeckVersion: 0 }).settings.hiddenYears, false, 'Legacy calendar mode retains its rules');
const old = JSON.parse(JSON.stringify(league)); delete old.settings.hiddenYears;
assert.equal(E.normalizeTimeLeague(old).settings.hiddenYears, false, 'Loading a save never silently changes year visibility');
assert(league.teams.every(team => team.roster.every(entry => entry.editionId && entry.hiddenDecade === '1990s')));
assert.deepEqual(E.normalizeTimeLeague(JSON.parse(JSON.stringify(league))).teams, league.teams, 'Opaque edition identities survive reload');
assert(H.eligibleSeasons(league, cards.get(player.identity)).some(row => row.season === player.drawnSeason));

const hiddenGetter = { ...player }; Object.defineProperty(hiddenGetter, 'drawnSeason', { get() { throw new Error('The secret year was consulted'); } });
const before = H.read(league, hiddenGetter, cards, index);
assert.deepEqual(before.candidateYears, [1991, 1992, 1993]); assert.equal(before.average, null); assert.equal(before.games, 0);
assert.equal(before.concealed, true); assert(Number.isFinite(before.estimatedAverage));
assert.equal(Stats.signals(league, player, index).currentStars, null);
assert.equal(Stats.signals(league, player, index).currentAvailable, null);
assert.equal(S.weeklyStarOutlook(player, 1, 3, index, scoring, null, league), null, 'The actual current game can never provide a star clue in hidden-year mode');
const privateTrap = { ...league };
for (const key of ['privateGameSeed', 'privateGameDecks', 'privateDraws', 'hiddenYearAssignments']) Object.defineProperty(privateTrap, key, { get() { throw new Error('Private data was consulted: ' + key); } });
assert.deepEqual(H.read(privateTrap, hiddenGetter, cards, index), before, 'Candidate intelligence is independent of private draws and games');
assert.deepEqual(H.read({ ...league, seed: 'different-private-seed' }, hiddenGetter, cards, index), before);
const fillEntries = [player, league.teams[0].roster[1]].map((entry, i) => ({ ...entry, slot: 'BN', drawnSeason: i ? 1991 : 1993 }));
const fillState = { ...league, teams: league.teams.map((team, i) => i ? team : { ...team, roster: fillEntries }) };
const swappedYears = { ...fillState, teams: fillState.teams.map((team, i) => i ? team : { ...team, roster: team.roster.map(entry => ({ ...entry, drawnSeason: entry.drawnSeason === 1991 ? 1993 : 1991 })) }) };
assert.deepEqual(E.autoFillLineup(fillState, 't1', cards).teams[0].roster.map(entry => entry.slot), E.autoFillLineup(swappedYears, 't1', cards).teams[0].roster.map(entry => entry.slot), 'Human Auto-fill cannot secretly prefer the true higher-scoring edition');
assert.equal(E.waiverPreview(league, cards.get('p5'), index).drawnSeason, null);
assert.equal(E.waiverPreview(league, cards.get('p5'), index).totalPoints, null, 'The waiver tray cannot expose the selected season total');
for (let week = 1; week <= 14; week++) assert.equal(E.waiverSeason(league, cards.get(player.identity), week), player.drawnSeason, 'Dropping and reclaiming a player cannot reroll its fixed hidden year');
let noGameRelease = E.processWaivers(E.submitWaiverClaim(league, { teamId: 't1', addIdentity: 'p5', addName: 'Player 5', addPosition: 'QB', dropEntryId: player.entryId }, stamp), cards, stamp);
assert(!noGameRelease.teams[0].roster.some(entry => entry.identity === player.identity));
assert.equal(noGameRelease.finalizedWeeks.length, 0, 'This drop happens before any scored game can preserve its year');
noGameRelease = E.normalizeTimeLeague(JSON.parse(JSON.stringify(noGameRelease)));
const widenedCards = new Map(cards), originalCard = cards.get(player.identity);
widenedCards.set(player.identity, { ...originalCard, seasons: [...originalCard.seasons, ...[1988, 1994, 2001].map(season => ({ ...originalCard.seasons[0], season }))] });
assert.equal(E.waiverSeason(noGameRelease, widenedCards.get(player.identity)), player.drawnSeason, 'Saved private allocation survives archive expansion and a drop before scoring');
assert.deepEqual(H.read(noGameRelease, { identity: player.identity, position: 'QB', editionId: player.editionId }, widenedCards, index).candidateYears, [1991, 1992, 1993], 'The original public candidate pool also remains fixed after archive expansion');
const newAddition = noGameRelease.teams[0].roster.find(entry => entry.identity === 'p5');
const reacquired = E.processWaivers(E.submitWaiverClaim(noGameRelease, { teamId: 't1', addIdentity: player.identity, addName: player.name, addPosition: 'QB', dropEntryId: newAddition.entryId }, stamp), widenedCards, stamp);
const kept = reacquired.teams[0].roster.find(entry => entry.identity === player.identity);
assert.equal(kept.drawnSeason, player.drawnSeason); assert.equal(kept.editionId, player.editionId);
const missingCards = new Map(cards); missingCards.set(player.identity, { ...originalCard, seasons: originalCard.seasons.slice(0, 2) });
assert.deepEqual(H.read(noGameRelease, player, missingCards, index).candidateYears, [1991, 1992, 1993], 'A missing archive candidate is unknown, not silently eliminated');
assert.equal(H.read(noGameRelease, player, missingCards, index).estimatedAverage, null, 'Incomplete candidate totals do not fabricate an average');

league = E.finalizeCurrentWeek(league, index, null, stamp);
const one = H.read(league, hiddenGetter, cards, index);
assert.equal(one.observed.length, 1); assert.equal(one.games, 1);
assert.deepEqual(one.candidateYears, [player.drawnSeason], 'A distinctive exact stat line may honestly identify the year immediately');
assert.equal(one.average, league.finalizedWeeks[0].playerProduction.find(row => row.editionId === player.editionId).points);
assert.equal(H.read(league, hiddenGetter, cards, index, 0).average, null, 'Unwatched game production cannot enter the visible average');
assert.deepEqual(H.read(league, hiddenGetter, cards, index, 0).candidateYears, [1991, 1992, 1993]);
assert.deepEqual(H.read(league, hiddenGetter, cards, null).candidateYears, [1991, 1992, 1993], 'No archive means no invented elimination');
const incomplete = S.buildGameLogIndex(gameRows.filter(row => row.season !== 1991));
assert.deepEqual(H.read(league, hiddenGetter, cards, incomplete).candidateYears, [1991, 1992, 1993], 'A partial archive does not rule missing years out');

const project = (state, seat = 't1') => Public.projectPublicState(state, seat, [], cards, stamp, { logIndex: index });
const assertConcealed = state => {
    const json = JSON.stringify(state);
    for (const key of ['drawnSeason', 'sourceWeek', 'sourceGameId', 'privateDraws', 'privateGame', 'hiddenYearAssignments', '"factor"']) assert(!json.includes(key), `Concealed response cannot contain ${key}`);
    for (const report of Object.values(state.playerReports || {})) { assert.equal(report.currentStars, null); assert.equal(report.currentAvailable, null); assert.equal(report.maxRemainingStars, null); }
    assert.equal(state.waiverEditions, undefined, 'A hidden waiver allocation never leaves the server');
    assert.equal(state.yearsRevealed, false);
};
let pub = project(league); assertConcealed(pub);
assert.equal(pub.seasonExtensionLocked, false);
let partialDraft = create({ eraRules: { mode: 'position-roulette', decades: ['1990s'] } });
partialDraft = E.applyDraftPick(partialDraft, cards.get('p1'), { madeBy: 'human', createdAt: stamp });
const unrevealedDraft = project(partialDraft);
assert(unrevealedDraft.teams.every(team => team.roster.every(entry => !entry.hiddenDecade)), 'Hidden metadata cannot reveal a still-locked position decade');
assert.equal(unrevealedDraft.hiddenYearDecades, undefined); assert.equal(unrevealedDraft.hiddenYearCandidates, undefined);
const forgedDraft = JSON.parse(JSON.stringify(unrevealedDraft));
forgedDraft.teams.flatMap(team => team.roster).forEach(entry => { entry.hiddenDecade = '1990s'; });
assert(E.normalizePublicTimeLeague(forgedDraft).teams.every(team => team.roster.every(entry => !entry.hiddenDecade)), 'Public normalization also strips unrevealed draft metadata');
let restored = E.normalizePublicTimeLeague(pub); assert(restored, 'Concealed scored snapshots survive reconnect');
assertConcealed(restored);
const publicPlayer = restored.teams[0].roster[0];
assert.deepEqual(H.read(restored, publicPlayer, cards, index), H.read(league, player, cards, index), 'Solo and online managers receive the same evidence');
assert.equal(Stats.signals(restored, publicPlayer, null).average, one.average, 'Saved public stat lines do not depend on private source references');
const released = { ...league, teams: league.teams.map(team => ({ ...team, roster: team.roster.filter(entry => entry.identity !== player.identity) })) };
const wire = E.waiverPreview(released, cards.get(player.identity), index);
assert.equal(wire.editionId, player.editionId, 'A released player keeps the same public edition identity');
assert.equal(H.read(project(released), { ...publicPlayer, editionId: wire.editionId }, cards, index).average, one.average, 'A released player keeps its completed evidence on the public waiver wire');
const hostile = JSON.parse(JSON.stringify(pub));
hostile.hiddenYearAssignments = { [player.identity]: player.drawnSeason };
hostile.teams[0].roster[0].drawnSeason = player.drawnSeason;
hostile.finalizedWeeks[0].results[0].starters[0].sourceWeek = 18;
hostile.finalizedWeeks[0].results[0].starters[0].factor = 1.27;
hostile.playerReports['p1:1991'] = { week: 2, currentStars: 5, completed: [] };
hostile.waiverEditions = { week: 2, seasons: { p5: 1991 } };
assertConcealed(E.normalizePublicTimeLeague(hostile));

// Identical stat lines are evidence with multiplicity, not a reason to invent
// a distinct year. Each observed game requires its own archived appearance.
const same = { ...S.emptyStatLine(), passYd: 100 }, other = { ...S.emptyStatLine(), passYd: 200 };
const doubleCards = new Map([['p1', { ...cards.get('p1'), seasons: [{ season: 1991, games: 2, points: 12 }, { season: 1992, games: 2, points: 8 }] }]]);
const doubles = S.buildGameLogIndex([
    { identity: 'p1', season: 1991, week: 1, stats: same }, { identity: 'p1', season: 1991, week: 2, stats: other },
    { identity: 'p1', season: 1992, week: 1, stats: same }, { identity: 'p1', season: 1992, week: 2, stats: same },
]);
const seen = { ...league, hiddenYearCandidates: { p1: [1991, 1992] }, currentWeek: 3, finalizedWeeks: [1, 2].map(week => ({ week, playerProduction: [{ ...player, stats: same, points: 4 }], results: [] })) };
assert.deepEqual(H.read(seen, hiddenGetter, doubleCards, doubles, 1).candidateYears, [1991, 1992]);
assert.deepEqual(H.read(seen, hiddenGetter, doubleCards, doubles).candidateYears, [1992], 'No-repeat source pools constrain duplicate stat lines honestly');

const member = { seat_team_id: 't1', role: 'member' };
assert.throws(() => Actions.applyOnlineAction(league, { type: 'reveal-years' }, member, { cards }, stamp), /final season recap/);
const year = player.drawnSeason, seenSourceWeeks = new Set(league.finalizedWeeks[0].results[0].starters.map(row => row.sourceWeek));
while (league.phase === 'season') {
    league = E.finalizeCurrentWeek(league, index, null, stamp);
    assert.equal(league.teams[0].roster[0].drawnSeason, year, 'The assigned year never rerolls during a season');
    const sourceWeek = league.finalizedWeeks.at(-1).results[0].starters[0].sourceWeek;
    assert(!seenSourceWeeks.has(sourceWeek), 'The historical game pool still does not repeat'); seenSourceWeeks.add(sourceWeek);
}
assertConcealed(project(league)); assert(H.concealed(league), 'Phase complete is set before final replay and must not reveal the year');
const revealed = Actions.applyOnlineAction(league, { type: 'reveal-years' }, member, { cards }, stamp);
assert(revealed); assert.equal(H.concealed(revealed), false);
const myRecap = project(revealed, 't1'), theirUnwatched = project(revealed, 't2');
assert.equal(myRecap.yearsRevealed, true); assert.equal(myRecap.teams[0].roster[0].drawnSeason, year); assert(E.normalizePublicTimeLeague(myRecap));
assertConcealed(theirUnwatched); assertConcealed(E.normalizePublicTimeLeague(theirUnwatched));
assert.equal(theirUnwatched.seasonExtensionLocked, true, 'An unacknowledged viewer can see that adding playoffs is unavailable without learning a year');
assert.equal(theirUnwatched.yearReveals, undefined, 'The extension flag identifies no managers');
const unacknowledgedView = E.normalizePublicTimeLeague(theirUnwatched);
assert.equal(unacknowledgedView.seasonExtensionLocked, true);
assert.equal(E.startPlayoffs(unacknowledgedView, 2), unacknowledgedView, 'Public previews respect the authoritative extension lock');
assert.throws(() => Actions.applyOnlineAction(league, { type: 'reveal-years' }, { seat_team_id: 'stranger', role: 'member' }, { cards }, stamp), /league manager/);
assert.deepEqual(Actions.applyOnlineAction(revealed, { type: 'reveal-years' }, member, { cards }, stamp), revealed, 'Final recap acknowledgements are idempotent');
assert.equal(E.startPlayoffs(revealed, 2), revealed, 'A completed season cannot hide already-revealed years by adding playoffs');
console.log('PASS: fixed hidden years, honest candidate evidence, averages, no-repeat games, online leakage boundaries, per-seat final recap and legacy compatibility.');
