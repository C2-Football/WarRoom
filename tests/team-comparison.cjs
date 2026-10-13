'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const context = vm.createContext({ window: { App: {} } });
vm.runInContext(fs.readFileSync('js/utils/team-comparison.js', 'utf8'), context);
const { summarize, rank, draftCapital, completedThroughWeek, meetingScore } = context.window.App.TeamComparison;
const plain = value => JSON.parse(JSON.stringify(value));
const playersData = { q: { position: 'QB', age: 30 }, r: { position: 'RB', age: 24 }, w: { position: 'WR' }, d: { position: 'DE', age: 0 } };
const roster = { roster_id: 1, players: ['q', 'r', 'w'], starters: ['q', 'r'], settings: { wins: 0, losses: 2, ties: 1, fpts: 0, fpts_decimal: 25, fpts_against: 315, fpts_against_decimal: 75 } };
const summarizeRoster = (extra = {}) => summarize({ roster, playersData, values: { q: 100, r: 0, w: 50 }, ...extra });
const inventory = { draftId: 'D', season: '2026', phase: 'pre_draft', rounds: 2, consumed: [] };
const league = { id: 'L', season: '2026', settings: { type: 2, draft_rounds: 2 }, rosters: [{ roster_id: 1 }, { roster_id: 2 }], tradedPicks: [], _pickFeedState: 'ready', _draftInventory: inventory, _draftInventoryState: 'ready' };
const capital = (extra = {}) => draftCapital({ roster, league, skin: { type: 'dynasty', features: { showFuturePicks: true } }, getPickValue: (_year, round) => round === 1 ? 100 : 0, ...extra });

test('roster totals distinguish zero from missing and negative model values', () => {
    const result = summarizeRoster();
    assert.equal(result.total, 150); assert.equal(result.starterTotal, 100); assert.equal(result.benchTotal, 50);
    assert.equal(result.playerCount, 3); assert.equal(result.knownValueCount, 3); assert.equal(result.complete, true); assert.equal(result.starterComplete, true);
    for (const missing of [undefined, null, NaN, Infinity, -1, '50']) {
        const partial = summarizeRoster({ values: { q: 100, r: 0, w: missing } });
        assert.equal(partial.total, 100); assert.equal(partial.complete, false); assert.equal(partial.knownValueCount, 2);
        assert.equal(partial.starterComplete, true); assert.equal(partial.posComplete.WR, false); assert.equal(partial.posComplete.QB, true);
    }
    const empty = summarizeRoster({ roster: { players: [], starters: [] } });
    assert.equal(empty.total, 0); assert.equal(empty.complete, false); assert.equal(empty.starterComplete, false); assert.equal(empty.averageAge, null);
});

test('submitted starter coverage rejects empty slots, duplicates, and players outside roster', () => {
    for (const starters of [[], ['q', '0'], ['q', null], ['q', 'q'], ['q', 'd']]) {
        const result = summarizeRoster({ roster: { ...roster, starters } });
        assert.equal(result.starterComplete, false); assert.equal(result.starterTotal, starters.length ? 100 : 0);
    }
    const missingStarter = summarizeRoster({ values: { r: 0, w: 50 } });
    assert.equal(missingStarter.starterComplete, false); assert.equal(missingStarter.starterTotal, 0);
    const duplicatedRoster = summarizeRoster({ roster: { ...roster, players: ['q', 'q', 'r', 'w'] } });
    assert.equal(duplicatedRoster.total, 150); assert.equal(duplicatedRoster.playerCount, 3);
});

test('known ages and actual normalized rooms support comparisons; unknown positions block room edges', () => {
    assert.equal(summarizeRoster().averageAge, 27);
    const defensive = summarizeRoster({ roster: { players: ['d'], starters: ['d'] }, values: { d: 0 } });
    assert.equal(defensive.posTotals.DL, 0); assert.equal(defensive.posComplete.DL, true); assert.equal(defensive.averageAge, null);
    const edge = summarizeRoster({ roster: { players: ['edge'] }, playersData: { edge: { position: 'EDGE' } }, values: { edge: 75 }, normPos: position => position });
    assert.equal(edge.posTotals.DL, 75); assert.equal(edge.posComplete.DL, true);
    const custom = summarizeRoster({ roster: { players: ['custom'] }, playersData: { custom: { position: 'CUSTOM' } }, values: { custom: 25 }, positions: ['CUSTOM'] });
    assert.equal(custom.posTotals.CUSTOM, 25); assert.equal(custom.posComplete.CUSTOM, true);
    const missing = summarizeRoster({ roster: { ...roster, players: ['q', 'unknown'] }, values: { q: 100, unknown: 75 } });
    assert.equal(missing.complete, true); assert(Object.values(missing.posComplete).every(value => value === false));
    assert.equal(missing.averageAge, 30);
});

test('official records retain ties and zero while scores include reported hundredths', () => {
    const result = summarizeRoster();
    assert.deepEqual(plain(result.record), { wins: 0, losses: 2, ties: 1 });
    assert.equal(result.pointsFor, 0.25); assert.equal(result.pointsAgainst, 315.75);
    const absent = summarizeRoster({ roster: { players: ['q'], settings: {} } });
    assert.deepEqual(plain(absent.record), { wins: null, losses: null, ties: null });
    assert.equal(absent.pointsFor, null); assert.equal(absent.pointsAgainst, null);
    assert.equal(summarizeRoster({ roster: { settings: { fpts: 0 } } }).pointsFor, 0);
    assert.equal(summarizeRoster({ roster: { settings: { fpts: -1, fpts_decimal: 50 } } }).pointsFor, -0.5);
});

test('ranking uses competition ties and puts incomplete metrics below complete zero', () => {
    const profiles = [{ id: 'partial', total: 1000, complete: false }, { id: 'a', total: 20, complete: true }, { id: 'b', total: 20, complete: true }, { id: 'c', total: 0, complete: true }, { id: 'missing', complete: false }];
    const result = rank(profiles);
    assert.deepEqual(plain(result.map(row => [row.profile.id, row.rank, row.tied])), [['a', 1, true], ['b', 1, true], ['c', 3, false], ['partial', null, false], ['missing', null, false]]);
    assert.equal(result[0].profile, profiles[1]);
    assert(rank([{ total: 0, complete: false }, { total: 0, complete: false }]).every(row => row.rank === null && row.tied === false));
    assert.equal(rank([{ starterTotal: 0, starterComplete: true }], 'starterTotal')[0].rank, 1);
    assert.equal(rank([{ totalAssets: 25, assetsComplete: false }], 'totalAssets')[0].rank, null);
    assert.equal(rank([{ totalAssets: 25, assetsComplete: true }], 'totalAssets')[0].rank, 1);
});

test('explicit imported empty transfers verify original rights; zero pick value is known', () => {
    const result = capital();
    assert.equal(result.count, 6); assert.equal(result.totalValue, 300); assert.equal(result.complete, true); assert.equal(result.valued, true);
    assert.deepEqual(plain(result.byRound), { 1: 3, 2: 3 }); assert.deepEqual(plain(result.byYear), { 2026: 2, 2027: 2, 2028: 2 });
    assert.equal(result.picks.find(pick => pick.round === 2).value, 0);
    assert.equal(capital({ getPickValue: () => 0 }).totalValue, 0);
    const absent = capital({ league: { ...league, tradedPicks: undefined } });
    assert.equal(absent.count, 0); assert.equal(absent.totalValue, null); assert.equal(absent.complete, false);
    assert.equal(capital({ league: { ...league, tradedPicks: undefined }, tradedPicks: [] }).complete, true);
});

test('completed draft omits current rights despite stale league pre-draft status', () => {
    const result = capital({ league: { ...league, status: 'pre_draft', _draftInventory: { ...inventory, phase: 'complete' } } });
    assert.equal(result.count, 4); assert.equal(result.totalValue, 200); assert.equal(result.complete, true);
    assert.equal(result.picks.some(pick => pick.year === 2026), false);
    const currentRounds = capital({ league: { ...league, _draftInventory: { ...inventory, rounds: 3 } } });
    assert.equal(currentRounds.byYear[2026], 3); assert.equal(currentRounds.byYear[2027], 2);
});

test('drafting consumes original slots, including an acquired pick, and deduplicates transfers', () => {
    const transfer = { season: '2026', round: 1, roster_id: 2, owner_id: 1, league_id: 'L' };
    const result = capital({ league: { ...league, tradedPicks: [transfer, transfer], _draftInventory: { ...inventory, phase: 'drafting', consumed: [{ round: 1, rosterId: '2', playerId: 'acquired' }, { round: 2, rosterId: '1', playerId: 'own' }] } } });
    assert.equal(result.count, 5); assert.equal(result.picks.some(pick => pick.year === 2026 && !pick.own), false);
    assert.equal(result.picks.some(pick => pick.year === 2026 && pick.round === 2), false); assert.equal(result.complete, true);
    const acquired = capital({ league: { ...league, tradedPicks: [transfer] }, getOwnerName: (_roster, fallback) => fallback });
    assert.equal(acquired.count, 7); assert.equal(acquired.picks.find(pick => !pick.own).from, 'Team 2');
    const away = capital({ league: { ...league, tradedPicks: [{ ...transfer, roster_id: 1, owner_id: 2 }] } });
    assert.equal(away.count, 5);
});

test('unknown or stale current progress never fabricates unused current rights', () => {
    for (const extra of [
        { _draftInventory: undefined }, { _draftInventoryState: 'stale' },
        { _draftInventory: { ...inventory, season: '2025' } },
        { _draftInventory: { ...inventory, draftId: undefined } },
        { draft_id: 'another-draft' },
        { _draftInventory: { ...inventory, phase: 'unknown' } },
        { _draftInventory: { ...inventory, phase: 'drafting', consumed: [{ round: 1, roster_id: '1', player_id: 'wrong-shape' }] } },
    ]) {
        const result = capital({ league: { ...league, ...extra } });
        assert.equal(result.complete, false); assert.equal(result.count, 4); assert.equal(result.totalValue, 200);
        assert.equal(result.picks.some(pick => pick.year === 2026), false); assert.match(result.note, /progress/);
    }
    const missingRounds = capital({ league: { ...league, settings: { type: 2 } } });
    assert.equal(missingRounds.count, 2); assert.equal(missingRounds.complete, false);
    const noKnownRights = capital({ league: { ...league, settings: { type: 2 }, _draftInventory: undefined } });
    assert.equal(noKnownRights.count, 0); assert.equal(noKnownRights.totalValue, null); assert.equal(noKnownRights.valued, false);
});

test('ownership conflicts, cross-league rows, and stale imports cannot produce complete capital', () => {
    const row = { season: '2027', round: 1, roster_id: 2, owner_id: 1 };
    for (const feed of [[row, { ...row, owner_id: 2 }], [{ ...row, league_id: 'another' }], [{ ...row, owner_id: 99 }], [null]]) {
        const result = capital({ league: { ...league, tradedPicks: feed } });
        assert.equal(result.complete, false); assert.equal(result.count, 0); assert.equal(result.totalValue, null);
    }
    const stale = capital({ league: { ...league, _pickFeedState: 'stale' } });
    assert.equal(stale.count, 6); assert.equal(stale.complete, false); assert.match(stale.note, /stale/);
    assert.equal(capital({ league: { ...league, _pickFeedState: 'unavailable' } }).count, 0);
});

test('seasonal formats exclude future capital and keeper rights remain unpriced regardless of tier', () => {
    for (const type of ['redraft', 'chopped']) {
        const result = capital({ skin: { type, features: { showFuturePicks: false } } });
        assert.equal(result.count, 0); assert.equal(result.totalValue, null); assert.equal(result.valued, false); assert.equal(result.disabled, true);
    }
    assert.equal(capital({ skin: { type: 'dynasty', features: { showFuturePicks: false } } }).count, 0);
    const keeper = capital({ skin: { type: 'keeper', features: { showFuturePicks: true } } });
    assert.equal(keeper.count, 6); assert.equal(keeper.complete, true); assert.equal(keeper.valued, false); assert.equal(keeper.totalValue, null); assert.equal(keeper.disabled, false); assert.match(keeper.note, /Keeper/);
    assert.equal(capital({ getPickValue: () => NaN }).totalValue, null);
    assert.deepEqual(plain(capital({ isPro: false })), plain(capital({ isPro: true })));
});

test('completed history uses season and NFL phase before the week counter', () => {
    assert.equal(completedThroughWeek({ season: '2025', nflState: { season: '2026', season_type: 'regular', week: 6 } }), 18);
    assert.equal(completedThroughWeek({ season: '2026', nflState: { season: '2026', season_type: 'post', week: 1 } }), 18);
    assert.equal(completedThroughWeek({ season: '2026', nflState: { season: '2026', season_type: 'pre', week: 4 }, leagueWeek: 6 }), 0);
    assert.equal(completedThroughWeek({ season: '2026', nflState: { season: '2026', season_type: 'regular', week: 6 } }), 5);
    assert.equal(completedThroughWeek({ season: '2026', nflState: { season: '2026', season_type: 'regular', week: 6 }, leagueWeek: 7 }), 6);
    assert.equal(completedThroughWeek({ season: '2027', nflState: { season: '2026', week: 6 }, leagueWeek: 6 }), 0);
    assert.equal(completedThroughWeek({ season: '2026', nflState: {} }), 0);
    assert.equal(completedThroughWeek({ season: '2026', nflState: null }), 0);
});

test('meeting scores preserve reported zero and negative overrides without creating missing points', () => {
    assert.equal(meetingScore({ points: 0 }), 0);
    assert.equal(meetingScore({ points: -1.5 }), -1.5);
    assert.equal(meetingScore({ points: 10, custom_points: 0 }), 0);
    assert.equal(meetingScore({ points: 10, custom_points: -5 }), -5);
    assert.equal(meetingScore({ points: 10, custom_points: null }), 10);
    for (const row of [null, {}, { points: null }, { points: '0' }, { points: NaN }, { points: 10, custom_points: NaN }]) assert.equal(meetingScore(row), null);
});

test('integrated H2H loader counts completed zero ties and negative scores, omitting live and missing scores', async () => {
    const source = fs.readFileSync('js/tabs/compare.js', 'utf8');
    const start = source.indexOf('        async function loadHistoricalH2H()');
    const end = source.indexOf('        setH2hState({ loading: true', start);
    assert(start >= 0 && end > start, 'actual H2H loader is available for this integration check');
    const pair = (a, b, extra = {}) => [{ roster_id: 1, matchup_id: 1, points: a, ...extra }, { roster_id: 2, matchup_id: 1, points: b }];
    const seasons = [{ leagueId: 'L', season: '2026', rosters: [{ roster_id: 1, owner_id: 'me' }, { roster_id: 2, owner_id: 'them' }], weeklyMatchups: [
        { week: 1, rows: pair(0, 0) }, { week: 2, rows: pair(-1, -2) }, { week: 3, rows: pair(100, 10, { custom_points: 0 }) },
        { week: 4, rows: pair(undefined, 10) }, { week: 5, rows: pair(10, 5) }, { week: 6, rows: pair(20, 10) },
    ] }];
    const loaderContext = vm.createContext({
        window: { App: { TeamComparison: context.window.App.TeamComparison }, S: { nflState: { season: '2026', season_type: 'regular', week: 6 } } },
        currentLeague: { season: '2026' }, rootLeagueId: 'L', myOwnerId: 'me', theirOwnerId: 'them',
        myRoster: { roster_id: 1 }, theirRoster: { roster_id: 2 }, sameId: (a, b) => String(a) === String(b),
        localStorage: { getItem: () => null, setItem() {} }, loadRawChain: async () => seasons,
    });
    vm.runInContext(source.slice(start, end), loaderContext);
    const meetings = await loaderContext.loadHistoricalH2H();
    assert.deepEqual(plain(meetings.map(row => [row.week, row.result, row.myPoints, row.theirPoints])), [[5, 'W', 10, 5], [3, 'L', 0, 10], [2, 'W', -1, -2], [1, 'T', 0, 0]]);
    seasons[0].season = '2025'; loaderContext.currentLeague.season = '2025';
    assert.equal((await loaderContext.loadHistoricalH2H()).length, 5, 'an archived selected league keeps all completed meetings');
});

function createHistoryCacheLoader({ compactCache, rawCache } = {}) {
    const source = fs.readFileSync('js/tabs/compare.js', 'utf8');
    const start = source.indexOf('        async function loadRawChain()');
    const end = source.indexOf('        setH2hState({ loading: true', start);
    assert(start >= 0 && end > start, 'actual raw and compact H2H loaders are available');
    const storageKey = 'wr_compare_h2h_v4_L_me_them';
    const stored = new Map(compactCache ? [[storageKey, JSON.stringify(compactCache)]] : []);
    let requests = 0;
    const rosters = [{ roster_id: 1, owner_id: 'me' }, { roster_id: 2, owner_id: 'them' }];
    const loaderContext = vm.createContext({
        window: {
            App: { TeamComparison: context.window.App.TeamComparison },
            S: { nflState: { season: '2026', season_type: 'regular', week: 6 } },
            _wrCompareRawCache: rawCache ? { L: rawCache } : {},
        },
        currentLeague: { season: '2026', rosters, settings: { playoff_week_start: 8 } },
        rootLeagueId: 'L', myOwnerId: 'me', theirOwnerId: 'them', myRoster: rosters[0], theirRoster: rosters[1],
        sameId: (a, b) => String(a) === String(b),
        localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) },
        fetchJson: async url => {
            requests += 1;
            const week = Number(url.match(/\/matchups\/(\d+)$/)?.[1]);
            return week ? [{ roster_id: 1, matchup_id: 1, points: 10 + week }, { roster_id: 2, matchup_id: 1, points: 5 }]
                : { season: '2026', settings: { playoff_week_start: 8 } };
        },
    });
    vm.runInContext(source.slice(start, end), loaderContext);
    return { loaderContext, requests: () => requests, stored, storageKey };
}

test('completed-week rollover refreshes both raw history and compact meetings before their TTL expires', async () => {
    const fixture = createHistoryCacheLoader();
    const first = await fixture.loaderContext.loadHistoricalH2H();
    assert.equal(first[0].week, 5); assert.equal(first.length, 5);
    const initialRequests = fixture.requests();
    assert(initialRequests > 0);
    await fixture.loaderContext.loadHistoricalH2H();
    assert.equal(fixture.requests(), initialRequests, 'same completed-week scope reuses the compact cache');
    fixture.loaderContext.window.S.nflState.week = 7;
    const rolledOver = await fixture.loaderContext.loadHistoricalH2H();
    assert.equal(rolledOver[0].week, 6); assert.equal(rolledOver.length, 6);
    assert(fixture.requests() > initialRequests, 'rollover refetches raw rows as well as rebuilding meetings');
    assert.equal(fixture.loaderContext.window._wrCompareRawCache.L.cutoffKey, '2026:6');
    assert.equal(JSON.parse(fixture.stored.get(fixture.storageKey)).cutoffKey, '2026:6');
});

test('v4 preloads require the actual completed-week stamp; unscoped legacy caches are refreshed', async () => {
    const meetings = [{ season: '2025', week: 1, result: 'T', myPoints: 0, theirPoints: 0 }];
    const seeded = createHistoryCacheLoader({
        compactCache: { ts: Date.now(), cutoffKey: '2026:5', meetings },
        rawCache: { ts: Date.now(), cutoffKey: '2026:5', seasons: [] },
    });
    assert.deepEqual(plain(await seeded.loaderContext.loadHistoricalH2H()), meetings);
    assert.equal(seeded.requests(), 0, 'the current v4 design fixture never fetches live history');
    seeded.loaderContext.window.S.nflState.week = 7;
    assert.equal((await seeded.loaderContext.loadHistoricalH2H())[0].week, 6);
    assert(seeded.requests() > 0, 'even seeded raw rows expire when the cutoff changes');
    const legacy = createHistoryCacheLoader({ compactCache: { ts: Date.now(), meetings }, rawCache: { ts: Date.now(), seasons: [] } });
    assert.equal((await legacy.loaderContext.loadHistoricalH2H())[0].week, 5);
    assert(legacy.requests() > 0, 'unknown legacy scope cannot mask newly completed meetings');
});
