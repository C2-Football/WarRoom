'use strict';
const assert = require('node:assert/strict');
require('../js/shared/league-stats.js');
const Data = require('../js/shared/lens-data.js');
const Composition = require('../js/shared/lens-composition.js');
const score = global.App.LeagueStats.score;
const copy = value => JSON.parse(JSON.stringify(value));
const time = Date.UTC(2026, 9, 23, 18);
const league = { league_id: '1234567890123456789', name: 'C2 League', season: '2026', scoring_settings: { rec: 1, rec_yd: 0.1, rush_yd: 0.1 }, users: [{ user_id: 'me', display_name: 'My team' }, { user_id: 'bad', display_name: 'Losing team' }, { user_id: 'good', display_name: 'Winning team' }], rosters: [
    { roster_id: 1, owner_id: 'me', players: ['mine'], starters: ['mine'], settings: { wins: 1, losses: 5, ties: 0, fpts: 100 } },
    { roster_id: 2, owner_id: 'bad', players: ['best', 'zero', 'missing'], starters: ['best'], settings: { wins: 2, losses: 4, ties: 0, fpts: 300, fpts_decimal: 50 } },
    { roster_id: 3, owner_id: 'good', players: ['strong'], starters: ['strong'], settings: { wins: 5, losses: 1, ties: 0, fpts: 500 } },
] };
const players = { mine: { full_name: 'My Superstar', position: 'WR', team: 'CHI', age: 25 }, best: { full_name: 'Best Target', position: 'WR', team: 'BUF', age: 24, injury_status: 'Questionable' }, zero: { full_name: 'Zero Game', position: 'WR', team: 'NYG', age: 27 }, missing: { full_name: 'Unknown Line', position: 'RB', team: 'ATL' }, strong: { full_name: 'Winning Star', position: 'WR', team: 'SEA', age: 29 } };
const statsByPid = { mine: { gp: 2, rec: 80 }, best: { gp: 2, rec: 50 }, zero: { gp: 1, rec: 0 }, strong: { gp: 2, rec: 60 } };
const context = () => ({ currentLeague: copy(league), myRoster: copy(league.rosters[0]), playersData: copy(players), transactions: [], statsSnapshot: { season: '2026', week: null, statsByPid: copy(statsByPid), updatedAt: time } });
const reset = () => { global.App.LeagueStats = { score, load: async () => { throw Error('No stats fixture'); } }; global.App.AccountStorage = { owner: () => 'account:one' }; global.App.LI = {}; global.App.LI_LOADED = false; delete global.WrWireStories; global.fetch = async () => { throw Error('Unexpected network request'); }; };
let checks = 0;
async function test(name, run) { reset(); await run(); checks++; console.log('PASS ' + name); }
const query = (source, options = {}) => ({ id: 'result', source, ...options });
const first = async (source, options, ctx = context()) => (await Data.resolve([query(source, options)], ctx)).datasets[0];

(async () => {
    await test('catalog advertises twelve usable sources and defensive typed schemas', async () => {
        const catalog = Data.catalog(); assert.equal(catalog.length, 12);
        assert.ok(catalog.every(s => s.fields.length && s.fields.every(f => ['string', 'number', 'date', 'boolean'].includes(f.type))));
        catalog[0].fields[0].id = 'changed'; assert.equal(Data.catalog()[0].fields[0].id, 'playerId');
        const target = catalog.find(s => s.id === 'tradeTargets'); assert.ok(target.fields.some(f => f.id === 'teamWinPct' && f.unit === 'percent'));
    });
    await test('acceptance: best players from bad teams excludes mine and joins actual records before sorting', async () => {
        global.App.LI_LOADED = true; global.App.LI = { sourceLeagueId: league.league_id, playerScores: { best: 7000, zero: 0 } };
        const result = await Data.resolve([query('tradeTargets', { columns: ['name', 'teamName', 'teamRecord', 'teamRank', 'teamWinPct', 'ppg', 'positionRank', 'value', 'injuryStatus'], filters: [{ field: 'teamWinPct', op: 'lt', value: 50 }], sort: { field: 'ppg', direction: 'desc' } })], context());
        const data = result.datasets[0]; assert.equal(data.status, 'ready');
        assert.deepEqual(data.rows.map(r => r.name), ['Best Target', 'Zero Game', 'Unknown Line']);
        assert.equal(data.rows[0].ppg, 25); assert.equal(data.rows[0].positionRank, 3); assert.equal(data.rows[0].teamRecord, '2-4'); assert.equal(data.rows[0].teamRank, 2);
        assert.equal(data.rows[0].value, 7000); assert.equal(data.rows[1].value, 0); assert.equal(data.rows[1].ppg, 0); assert.equal(data.rows[2].ppg, null);
        assert.match(data.note, /willingness to trade/); assert.equal(result.sources.length, 3); assert.equal(data.asOf, new Date(time).toISOString());
        assert.ok(result.sources.some(s => s.url?.endsWith('/stats/nfl/regular/2026')));
        assert.doesNotThrow(() => Composition.validate({ version: 1, title: 'Trade targets', theme: { accent: '#63cbb5', style: 'analytic' }, datasets: result.datasets, sources: result.sources, blocks: [{ id: 'table', kind: 'table', title: 'Targets', datasetId: 'result', sourceIds: data.sourceIds }], research: { prompt: 'Trade targets', createdAt: new Date(time).toISOString() } }));
    });
    await test('missing records cannot fabricate losing teams or ranks', async () => {
        const ctx = context(); delete ctx.currentLeague.rosters[1].settings.losses;
        const data = await first('tradeTargets', { columns: ['name', 'teamRank', 'teamWinPct'], filters: [{ field: 'teamWinPct', op: 'lt', value: 50 }] }, ctx);
        assert.equal(data.status, 'empty'); assert.deepEqual(data.rows, []);
        assert.match(data.note, /unknown comparison fields/);
        const all = await first('standings', {}, ctx); assert.ok(all.rows.every(r => r.rank === null));
    });
    await test('unknown ranking retains useful metadata with a warning; unknown filters are unavailable', async () => {
        const ctx = context(); delete ctx.statsSnapshot;
        const data = await first('tradeTargets', { sort: { field: 'ppg', direction: 'desc' } }, ctx);
        assert.equal(data.status, 'ready'); assert.match(data.note, /ranking is unavailable/); assert.ok(data.rows.every(r => r.ppg === null));
        const filtered = await first('tradeTargets', { filters: [{ field: 'ppg', op: 'gt', value: 10 }] }, ctx);
        assert.equal(filtered.status, 'unavailable'); assert.match(filtered.note, /comparison needs a field/);
    });
    await test('own team identity is required and missing games never become zero', async () => {
        const ctx = context(); ctx.myRoster = { roster_id: 99 };
        assert.equal((await first('tradeTargets', {}, ctx)).status, 'unavailable');
        const roster = await first('leagueRoster', { columns: ['name', 'gamesPlayed', 'fantasyPoints', 'ppg'] });
        assert.equal(roster.rows.find(r => r.name === 'Unknown Line').gamesPlayed, null);
        assert.equal(roster.rows.find(r => r.name === 'Zero Game').fantasyPoints, 0);
    });
    await test('foreign valuation evidence, projected ages and projected values fail closed', async () => {
        global.App.LI_LOADED = true; global.App.LI = { sourceLeagueId: 'other', playerScores: { best: 9000 } };
        let data = await first('tradeTargets', { columns: ['name', 'value'] }); assert.equal(data.rows[0].value, null);
        global.App.LI.sourceLeagueId = league.league_id;
        const ctx = context(); ctx.playersData.best._projected = true; ctx.playersData.best.age = 45;
        data = await first('tradeTargets', { columns: ['name', 'age', 'value'] }, ctx); assert.equal(data.rows[0].age, null); assert.equal(data.rows[0].value, null);
    });
    await test('all dataset queries validate before any fetching and reject code, type and date errors', async () => {
        const invalid = [
            query('fetch'), query('roster', { script: 'alert(1)' }), query('roster', { columns: ['constructor'] }), query('roster', { columns: ['name', 'name'] }),
            query('roster', { filters: [{ field: 'age', op: 'gt', value: '20' }] }), query('roster', { filters: [{ field: 'age', op: 'contains', value: 2 }] }),
            query('roster', { params: { url: 'https://example.com' } }), query('roster', { limit: 201 }), query('roster', { limit: 1.5 }),
            query('matchups'), query('gameLogs', { params: { playerId: 'best' } }), query('weeklyPlayerStats', { params: { week: 19 } }),
            query('transactions', { filters: [{ field: 'createdAt', op: 'gte', value: '2026-02-30' }] }),
        ];
        for (const need of invalid) await assert.rejects(Data.resolve([need], context()));
        await assert.rejects(Data.resolve(Array.from({ length: 7 }, (_, i) => ({ ...query('roster'), id: 'data' + i })), context()));
        await assert.rejects(Data.resolve([query('roster'), query('standings')], context()));
    });
    await test('connected league and season scope gate sources before network requests', async () => {
        let calls = 0; global.fetch = async () => { calls++; throw Error('Should not fetch'); };
        const foreign = await first('matchups', { params: { leagueId: 'unconnected', week: 2 } }); assert.equal(foreign.status, 'unavailable');
        const wrongSeason = await first('matchups', { params: { season: '2025', week: 2 } }); assert.equal(wrongSeason.status, 'unavailable');
        const ctx = context(); ctx.currentLeague._platform = 'espn';
        const otherProvider = await first('matchups', { params: { week: 2 } }, ctx); assert.equal(otherProvider.status, 'unavailable'); assert.equal(calls, 0);
    });
    await test('scoped stats loads are deduplicated and stale raw globals are never used', async () => {
        let calls = 0; const ctx = context(); delete ctx.statsSnapshot; ctx.statsData = { best: { gp: 1, rec: 999 } };
        global.App.LeagueStats.load = async ({ season, week }) => { calls++; assert.equal(season, '2026'); assert.equal(week, undefined); return { season, week: null, statsByPid, updatedAt: time }; };
        const result = await Data.resolve([{ id: 'one', source: 'tradeTargets' }, { id: 'two', source: 'roster' }], ctx);
        assert.equal(calls, 1); assert.equal(result.datasets[0].rows[0].ppg, 25);
        ctx.statsSnapshot = { season: '2025', statsByPid: { best: { gp: 1, rec: 999 } } };
        assert.equal((await first('tradeTargets', {}, ctx)).rows[0].ppg, 25);
    });
    await test('mismatched loader season and postseason snapshot are rejected', async () => {
        const ctx = context(); delete ctx.statsSnapshot;
        global.App.LeagueStats.load = async () => ({ season: '2025', week: null, statsByPid, updatedAt: time });
        assert.equal((await first('playerStats', {}, ctx)).status, 'unavailable');
        global.App.LeagueStats.load = async () => ({ season: '2026', week: null, seasonType: 'post', statsByPid, updatedAt: time });
        assert.equal((await first('playerStats', {}, ctx)).status, 'unavailable');
    });
    await test('weekly stats and game logs preserve real zero and unknown weeks', async () => {
        global.App.LeagueStats.load = async ({ season, week }) => { if (week === 2) throw Error('week unavailable'); return { season, week, statsByPid: { best: { gp: 1, rec: 0, rec_yd: 0 } }, updatedAt: time }; };
        const weekly = await first('weeklyPlayerStats', { params: { week: 1 }, columns: ['name', 'week', 'fantasyPoints', 'receivingYards'] });
        assert.equal(weekly.status, 'ready'); assert.equal(weekly.rows[0].fantasyPoints, 0);
        const log = await first('gameLogs', { params: { playerId: 'best', weeks: [2, 1] }, columns: ['name', 'week', 'fantasyPoints'] });
        assert.deepEqual(log.rows.map(r => r.fantasyPoints), [0, null]); assert.match(log.note, /unknown weeks/);
        const unknown = await first('gameLogs', { params: { playerId: 'not-known', weeks: [1] } }); assert.equal(unknown.status, 'unavailable');
        const missing = await first('gameLogs', { params: { playerId: 'best', weeks: [2] } }); assert.equal(missing.status, 'unavailable');
    });
    await test('account switch, caller cancellation and changed league discard late results', async () => {
        for (const kind of ['account', 'signal', 'league', 'isCurrent']) {
            const ctx = context(); delete ctx.statsSnapshot;
            let owner = 'one', current = true; global.App.AccountStorage.owner = () => owner;
            const controller = new AbortController(); ctx.signal = controller.signal; ctx.isCurrent = () => current;
            global.App.LeagueStats.load = async ({ season }) => { if (kind === 'account') owner = 'two'; if (kind === 'signal') controller.abort(); if (kind === 'league') ctx.currentLeague.season = '2025'; if (kind === 'isCurrent') current = false; return { season, week: null, statsByPid }; };
            await assert.rejects(Data.resolve([query('tradeTargets')], ctx), { name: 'AbortError' });
        }
    });
    await test('matchups use actual commissioner-adjusted points with complete roster validation', async () => {
        global.fetch = async url => { assert.ok(url.endsWith('/matchups/2')); return { ok: true, json: async () => [{ roster_id: 1, matchup_id: 1, points: 90, custom_points: 0 }, { roster_id: 2, matchup_id: 1, points: -2 }, { roster_id: 3, matchup_id: null, points: null }] }; };
        let data = await first('matchups', { params: { week: 2 } }); assert.equal(data.rows[0].points, 0); assert.equal(data.rows[0].opponentPoints, -2); assert.equal(data.rows[2].opponentTeamId, null);
        global.fetch = async () => ({ ok: true, json: async () => [{ roster_id: 1, points: 5 }] });
        data = await first('matchups', { params: { week: 2 } }); assert.equal(data.status, 'unavailable');
    });
    await test('draft selections require a matching primary draft and preserve selection identity', async () => {
        global.fetch = async url => ({ ok: true, json: async () => url.endsWith('/drafts') ? [{ draft_id: 'draft1', league_id: league.league_id, season: '2026' }] : [{ round: 2, pick_no: 5, roster_id: 2, player_id: 'best' }] });
        let data = await first('draftPicks', {}); assert.equal(data.status, 'ready'); assert.equal(data.rows[0].name, 'Best Target'); assert.equal(data.rows[0].teamName, 'Losing team');
        global.fetch = async () => ({ ok: true, json: async () => [{ draft_id: 'foreign', league_id: 'different', season: '2026' }] });
        data = await first('draftPicks', {}); assert.equal(data.status, 'unavailable');
    });
    await test('linked history is explicit and labels incomplete coverage without activating global history', async () => {
        const historical = copy(league); historical.league_id = 'previous'; historical.season = '2025'; historical.rosters[0].owner_id = 'former';
        global.WrWireStories = { loadArchive: async ({ league: source, signal }) => { assert.equal(source.league_id, league.league_id); return { seasons: [{ league: historical }], complete: false, reason: 'One earlier year failed', at: time }; } };
        const result = await Data.resolve([query('leagueHistory', { columns: ['leagueId', 'season', 'ownerId', 'teamId'] })], context());
        assert.equal(result.datasets[0].status, 'ready'); assert.equal(result.datasets[0].rows[0].ownerId, 'former'); assert.equal(result.datasets[0].rows[0].season, '2025'); assert.ok(result.warnings.length);
    });
    await test('portfolio scopes colliding roster IDs by league and never assigns another provider owner by coincidence', async () => {
        const second = copy(league); second.league_id = 'second'; second.name = 'Other league'; second.rosters[0].owner_id = 'stranger'; second.rosters[1].owner_id = 'me';
        const espn = copy(second); espn.league_id = 'espn_1'; espn._platform = 'espn';
        const ctx = context(); ctx.allowedLeagues = [league, second, espn]; ctx.portfolioCoverage = { knownCount: 4 };
        const result = await Data.resolve([query('portfolio')], ctx); const rows = result.datasets[0].rows;
        assert.equal(rows.find(r => r.leagueId === league.league_id).teamId, '1'); assert.equal(rows.find(r => r.leagueId === 'second').teamId, '2'); assert.equal(rows.find(r => r.leagueId === 'espn_1').teamId, null); assert.ok(result.warnings.length);
    });
    await test('transaction sample handles dates chronologically and preserves missing counts', async () => {
        const ctx = context(); ctx.transactions = [{ transaction_id: 'tx1', type: 'trade', created: Date.parse('2026-10-23T12:00:00Z'), roster_ids: [1, 2], adds: {}, drops: null }];
        const data = await first('transactions', { filters: [{ field: 'createdAt', op: 'gt', value: '2026-10-23T09:00:00-02:00' }] }, ctx);
        assert.equal(data.rows.length, 1); assert.equal(data.rows[0].playersAdded, 0); assert.equal(data.rows[0].playersDropped, null); assert.match(data.note, /sample/);
    });
    await test('snapshots cap rows and progressive callbacks cannot mutate saved results', async () => {
        const ctx = context(); ctx.currentLeague.rosters[1].players = Array.from({ length: 500 }, (_, i) => 'p' + i); ctx.onProgress = data => { data.rows.length = 0; };
        const data = await first('leagueRoster', { limit: 200 }, ctx); assert.equal(data.rows.length, 200);
    });
    console.log(`Lens data: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
