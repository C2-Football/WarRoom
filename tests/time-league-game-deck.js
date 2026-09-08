'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'player-stats', 'public-state']) require('../js/shared/time-league-' + name + '.js');
const { TimeLeagueEngine: E, TimeLeagueSeason: S, TimeLeaguePlayerStats: P, TimeLeaguePublicState: Public } = App;
const scoring = { passingYd: .04, passTd: 4, rushRecYd: .1, reception: .5, turnover: -2 };
const makeLeague = (seed = 'full-pool') => E.createTimeLeague({ name: 'Game deck', seed, createdAt: '2026-09-08T00:00:00Z', seats: [{ name: 'Home', manager: 'human' }, { name: 'Away', manager: 'ai' }], settings: { regularSeasonWeeks: 12, playoffTeams: 4, maxQuarterbacks: 3, rosterSlots: { QB: 1, BN: 2 }, scoring, eraRules: { mode: 'any-era', decades: [] }, gameDeckVersion: 1 } });
const entry = { identity: 'sample:QB', entryId: 'p1', name: 'Sample QB', position: 'QB', drawnSeason: 2023, slot: 'QB', acquiredVia: 'draft', acquiredWeek: 1 };
const logs = (count = 17, scheduledGames = 17) => S.buildGameLogIndex(Array.from({ length: count }, (_, i) => ({ identity: entry.identity, name: entry.name, position: 'QB', season: 2023, week: i === 16 ? 18 : i + 1, sourceGameId: 'game-' + i, source: 'test-regular-season', coverage: 'recorded-regular-season', scheduledGames, stats: { ...S.emptyStatLine(), passYd: (i + 1) * 25 } })));
let passed = 0;
function test(name, run) { run(); passed++; console.log('  ok ' + name); }
test('new leagues use a private full REG deck; normalized legacy saves keep original source week mapping', () => {
 const league = makeLeague(); assert.equal(league.settings.gameDeckVersion, 1);
 const old = JSON.parse(JSON.stringify(league)); delete old.settings.gameDeckVersion;
 const loaded = E.normalizeTimeLeague(old); assert.equal(loaded.settings.gameDeckVersion, 0);
 assert.equal(S.resolveGameLog(loaded, entry, 1, logs()).week, 1);
 const primary = logs(), legacy = logs(2); primary.legacyIndex = legacy;
 legacy.dataset = 'legacy-week-calendar';
 assert.throws(() => E.finalizeCurrentWeek({ ...league, phase: 'season' }, legacy, null, '2026-09-08'), /full game archive/, 'Never score a new deck against a stale legacy archive');
 assert.equal(S.resolveGameLog(loaded, entry, 3, primary), null);
});
test('all seventeen appearances, including NFL week18, are eligible without repetition in fourteen Vault weeks', () => {
 const index = logs(), seen = new Set();
 for (let seed = 0; seed < 100; seed++) {
  const selected = S.gameDeck(makeLeague('seed-' + seed), entry, index, 14).slice(0, 14);
  assert.equal(selected.length, 14); assert.equal(new Set(selected.map(row => row.sourceGameId)).size, 14);
  selected.forEach(row => seen.add(row.week));
 }
 assert.equal(seen.size, 17); assert(seen.has(18));
});
test('reconnect, trade, and reacquisition preserve an edition deck independent of owner and entry id', () => {
 const league = makeLeague(), index = logs();
 const original = S.gameDeck(league, entry, index, 14).map(row => row?.week);
 const loaded = E.normalizeTimeLeague(JSON.parse(JSON.stringify(league)));
 assert.deepEqual(S.gameDeck(loaded, { ...entry, entryId: 'waiver-99', acquiredWeek: 8, slot: 'BN' }, index, 14).map(row => row?.week), original);
 assert.notDeepEqual(S.gameDeck({ ...league, privateGameSeed: 'server-secret' }, entry, index, 14).map(row => row?.week), original);
});
test('short archives receive neutral shuffled records, with no forced empty tail or invented injury', () => {
 const index = logs(5, 0), positions = new Set();
 for (let seed = 0; seed < 40; seed++) {
  const deck = S.gameDeck(makeLeague('short-' + seed), entry, index, 14);
  assert.equal(deck.length, 14); assert.equal(deck.filter(Boolean).length, 5);
  deck.forEach((row, week) => { if (row) positions.add(week); });
 }
 assert.equal(positions.size, 14);
 const verified = S.gameDeck(makeLeague(), entry, logs(13, 16), 14);
 assert.equal(verified.length, 16); assert.equal(verified.filter(row => !row).length, 3);
 assert.deepEqual(S.gameDeck(makeLeague(), entry, index, 12), S.gameDeck(makeLeague(), entry, index, 14), 'Adding playoffs cannot reshuffle a short pool');
});
test('only the current availability and stars are visible; later dates have no point or availability signal', () => {
 const league = { ...makeLeague(), currentWeek: 5 }, index = logs(7, 17);
 const outlook = S.rosterOutlook(entry, 5, 14, index, scoring, null, league);
 const stars = S.weeklyStarOutlook(entry, 5, 14, index, scoring, null, league);
 assert.equal(outlook.remaining, 10); assert.equal(stars.remainingGames, 10);
 for (const row of outlook.schedule.filter(row => row.week > 5)) { assert.equal(row.available, null); assert.equal(row.points, null); }
 for (const row of stars.schedule.filter(row => row.week > 5)) { assert.equal(row.available, null); assert.equal(row.stars, null); }
 assert.equal(outlook.schedule[4].available, Boolean(S.resolveGameLog(league, entry, 5, index, 14)));
 assert(!JSON.stringify(outlook).includes('injury'));
 const gated = { ...league, weekStage: 'postgame' };
 assert.equal(S.rosterOutlook(entry, 5, 14, index, scoring, null, gated).schedule[4].available, null);
 assert.equal(S.weeklyStarOutlook(entry, 5, 14, index, scoring, null, gated).stars, null, 'Next-week clue waits for Advance Week');
});
test('scoring, bench production, YTD, and current hints resolve the same mapped game and survive saved reload', () => {
 const index = logs(), bench = { ...entry, entryId: 'bench', slot: 'BN' };
 let league = { ...makeLeague(), phase: 'season', seasonsRevealed: true };
 league.teams[0].roster = [entry]; league.teams[1].roster = [bench];
 const expected = S.resolveGameLog(league, entry, 1, index, 14);
 const settled = E.finalizeCurrentWeek(league, index, null, '2026-09-08T01:00:00Z');
 assert.equal(settled.finalizedWeeks[0].results[0].starters[0].stats.passYd, expected.stats.passYd);
 assert.equal(settled.finalizedWeeks[0].results[0].starters[0].sourceWeek, expected.week);
 const loaded = E.normalizeTimeLeague(JSON.parse(JSON.stringify(settled)));
 assert.deepEqual(loaded.finalizedWeeks, settled.finalizedWeeks.map(row => ({ ...row, playerProduction: row.playerProduction.map(({ acquiredVia, acquiredWeek, ...rest }) => rest) })));
 assert.equal(P.totals(loaded, bench, null, null, [1]).points, S.scoreStatLine(expected.stats, scoring));
});
test('public reports preserve bench and pre-acquisition YTD but never transmit the private plan', () => {
 const index = logs(), card = { ...entry, seasons: [{ season: 2023, games: 17, points: 153 }], peak: 153 }, cards = new Map([[entry.identity, card]]);
 let league = { ...makeLeague(), phase: 'season', seasonsRevealed: true, privateGameSeed: 'secret-never-public' };
 league.teams[0].roster = [entry];
 league = E.finalizeCurrentWeek(league, index, null, '2026-09-08T01:00:00Z');
 const pub = Public.projectPublicState(league, 't1', [], cards, '2026-09-08', { logIndex: index });
 assert.equal(pub.seed, undefined); assert.equal(pub.privateGameSeed, undefined);
 assert(pub.playerReports[S.editionKey(entry)].completed.every(row => row.week < pub.currentWeek), 'Source references are disclosed only for completed weeks');
 assert(!JSON.stringify(pub.playerReports).includes('schedule'), 'Public reports carry no future calendar');
 const loaded = E.normalizePublicTimeLeague(pub); assert(loaded);
 assert.deepEqual(P.totals(loaded, entry, null, null, [1]), P.totals(league, entry, index, null, [1]));
 assert.equal(S.weeklyStarOutlook(entry, 2, 14, null, scoring, null, loaded).stars, pub.playerReports[S.editionKey(entry)].currentStars);
 assert.equal(S.gameDeck(loaded, entry, index, 14), null);
});
test('postgame public free-agent YTD uses only completed source references and waits for archive loading', () => {
 const freeEntry = { ...entry, identity: 'free:QB', entryId: 'free', name: 'Free QB' };
 const index = S.buildGameLogIndex([...logs().values(), ...[...logs().values()].map(log => ({ ...log, identity: freeEntry.identity }))]);
 const cards = new Map([entry, freeEntry].map(row => [row.identity, { ...row, seasons: [{ season: 2023, games: 17, points: 153 }], peak: 153 }]));
 let league = { ...makeLeague(), phase: 'season', seasonsRevealed: true, privateGameSeed: 'postgame-private' };
 league.teams[0].roster = [entry];
 league = { ...E.finalizeCurrentWeek(league, index, null, '2026-09-08T01:00:00Z'), weekStage: 'postgame' };
 const pub = Public.projectPublicState(league, 't1', [], cards, '2026-09-08', { logIndex: index });
 const report = pub.playerReports[S.editionKey(freeEntry)];
 assert.equal(report.currentAvailable, null); assert.equal(report.currentStars, null);
 assert.equal(report.completed.length, 1); assert.equal(report.completed[0].week, 1);
 assert.equal(Object.hasOwn(report.completed[0], 'stats'), false, 'Stat lines are read from public NFL archive only after their source reference is disclosed');
 const loaded = E.normalizePublicTimeLeague(pub);
 assert.deepEqual(P.totals(loaded, freeEntry, index, null, [1]), P.totals(league, freeEntry, index, null, [1]));
 assert.equal(P.totals(loaded, freeEntry, null, null, [1]).points, null, 'No archive never implies a zero scoring game');
 const hostile = Public.sanitizePlayerReports({ x: { ...report, privateSeed: 'no', completed: [...report.completed, { week: 8, sourceWeek: 18, points: 42 }] } }, 2);
 assert.equal(hostile.x.completed.length, 1); assert.equal(hostile.x.privateSeed, undefined);
});
test('waiver projections show full edition totals and a calendar estimate, not future absences', () => {
 const league = { ...makeLeague(), phase: 'season', currentWeek: 5 }, index = logs(5, 17);
 const card = { ...entry, seasons: [{ season: 2023, games: 5, points: 15 }] };
 const preview = E.waiverPreview(league, card, index, null);
 assert.equal(preview.totalPoints, 15); assert.equal(preview.remainingWeeks, 9);
 assert.equal(preview.estimated, true); assert.equal(preview.remainingGames, null);
 assert.equal(preview.remainingPoints, Math.round(15 / 17 * 9 * 100) / 100);
});
test('archive parser retains trustworthy metadata and does not silently truncate beyond250k rows', () => {
 const header = 'player,pos,season,week,passyd,source_game_id,team,opponent,game_date,source,coverage,scheduled_games,source_week_kind';
 const parsed = S.parseGameLogCsv(header + '\nSample QB,QB,2023,18,80,g18,KC,BUF,2023-01-08,test,recorded-regular-season,17,nfl-week');
 assert.equal(parsed.logs[0].scheduledGames, 17); assert.equal(parsed.logs[0].sourceGameId, 'g18'); assert.equal(parsed.logs[0].sourceWeekKind, 'nfl-week');
 const many = S.parseGameLogCsv('player,pos,season,week,passyd\n' + 'Bad,,2023,1,1\n'.repeat(250001) + 'Last Guy,QB,2023,18,123\n');
 assert.equal(many.logs.length, 1); assert.equal(many.logs[0].stats.passYd, 123);
});
console.log(passed + ' game-deck scenarios passed.');
