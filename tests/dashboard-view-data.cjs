'use strict';
const assert = require('node:assert/strict');
require('../js/shared/league-stats.js');
const Data = require('../js/shared/dashboard-view-data.js');
let checks = 0;
function check(label, fn) { fn(); checks++; console.log('PASS ' + label); }
const league = { league_id: '1234567890123456789', season: '2026', scoring_settings: { pass_yd: 0.04, pass_int: -2, rec: 1 }, users: [
    { user_id: 'owner-a', display_name: 'Alex', metadata: { team_name: 'The Owls' } },
    { user_id: 'owner-b', display_name: 'Brooke' },
], rosters: [
    { roster_id: '1234567890123456789', owner_id: 'owner-a', players: ['a', 'b', 'c', 'd', 'a', '0'], starters: ['a', 'd'], reserve: ['b'], taxi: ['c'], settings: { wins: 2, losses: 1, ties: 0, fpts: 100, fpts_decimal: 25 } },
    { roster_id: 2, owner_id: 'owner-b', players: ['e'], starters: [], settings: { wins: 2, losses: 1, ties: 0, fpts: 100, fpts_decimal: 25 } },
    { roster_id: 3, players: [], settings: { wins: 1, losses: 1, ties: 1, fpts: 120 } },
] };
const context = { currentLeague: league, myRoster: league.rosters[0], playersData: {
    a: { full_name: 'Avery Alpha', position: 'QB', team: 'CHI', age: 26 },
    b: { full_name: 'Blake Beta', position: 'WR', team: 'BUF', age: 23 },
    c: { full_name: 'Casey Gamma', position: 'WR', team: null },
    d: { first_name: 'Devon', last_name: 'Delta', position: 'WR', age: 29 },
    e: { full_name: 'Ellis Epsilon', position: 'RB', team: 'ATL', age: 24 },
} };
const roster = query => Data.resolve({ source: 'roster', ...query }, context);

check('catalog is safe to customize and advertises only connected datasets and typed operations', () => {
    const catalog = Data.catalog();
    assert.deepEqual(catalog.map(source => source.id), ['roster', 'leagueRoster', 'standings', 'transactions']);
    assert.ok(catalog.every(source => source.fields.every(field => ['string', 'number', 'date', 'boolean'].includes(field.type))));
    catalog[0].fields[0].id = 'broken';
    assert.equal(Data.catalog()[0].fields[0].id, 'playerId');
    assert.ok(Data.catalog().find(source => source.id === 'transactions').description.includes('not a complete season'));
});
check('roster rows preserve exact IDs, missing metadata and actual roster slots', () => {
    const result = roster({ columns: ['playerId', 'name', 'age', 'slot', 'teamId', 'teamName', 'nflTeam'] });
    assert.equal(result.status, 'ready');
    assert.equal(result.rows.length, 4, 'duplicate and empty starter IDs are not extra players');
    assert.deepEqual(result.rows.map(row => row.slot), ['Starter', 'IR', 'Taxi', 'Starter']);
    assert.equal(result.rows[0].teamId, league.rosters[0].roster_id);
    assert.equal(result.rows[0].teamName, 'The Owls');
    assert.equal(result.rows[2].age, null);
    assert.equal(result.rows[2].nflTeam, null);
    assert.equal(result.rows[3].name, 'Devon Delta');
    assert.equal(result.source.season, '2026');
    assert.deepEqual(Data.resolve({ source: 'leagueRoster', columns: ['name', 'teamName'] }, context).rows.at(-1), { name: 'Ellis Epsilon', teamName: 'Brooke' });
    const missingSlots = Data.resolve({ source: 'roster', columns: ['slot'] }, { ...context, myRoster: { players: ['a'] } });
    assert.equal(missingSlots.rows[0].slot, null, 'missing starter list is not evidence of bench membership');
});
check('projected ages never masquerade as reported metadata or confident counts', () => {
    const projectedContext = { ...context, playersData: Object.fromEntries(Object.entries(context.playersData).map(([id, player]) => [id, { ...player, age: 40, _projected: true, _delta: 5 }])) };
    const mixed = Data.resolve({ source: 'roster', columns: ['name', 'age'] }, projectedContext);
    assert.equal(mixed.status, 'ready');
    assert.ok(mixed.rows.every(row => row.age === null));
    assert.match(mixed.note, /projected player metadata/);
    for (const query of [
        { aggregate: { op: 'avg', field: 'age' } },
        { filters: [{ field: 'age', op: 'gt', value: 30 }], aggregate: { op: 'count' } },
        { columns: ['age'] },
    ]) assert.equal(Data.resolve({ source: 'roster', ...query }, projectedContext).status, 'unavailable');
});
check('unknown sources, code-shaped fields and typed-invalid filters are rejected', () => {
    for (const query of [
        { source: 'constructor' }, { source: 'roster', columns: ['__proto__'] },
        { source: 'roster', script: 'window.alert(1)' }, { source: 'roster', columns: ['age', 'age'] },
        { source: 'roster', limit: -1 }, { source: 'roster', limit: 101 }, { source: 'roster', limit: 2.5 },
        { source: 'roster', filters: [{ field: 'age', op: 'gt', value: '24' }] },
        { source: 'roster', filters: [{ field: 'age', op: 'contains', value: 24 }] },
        { source: 'roster', filters: [{ field: 'age', op: 'eq', value: null }] },
        { source: 'roster', filters: [{ field: 'age', op: 'in', value: [24, '27'] }] },
        { source: 'roster', filters: [{ field: 'name', op: 'eq', value: 'x', eval: 'x' }] },
        { source: 'roster', sort: { field: 'age', direction: 'random' } },
        { source: 'roster', aggregate: { op: 'avg', field: 'name' } },
        { source: 'roster', aggregate: { op: 'sum' } },
        { source: 'roster', aggregate: { op: 'count', field: 'constructor' } },
        { source: 'roster', groupBy: 'position' },
        { source: 'roster', aggregate: { op: 'avg', field: 'age' }, columns: ['name'] },
        { source: 'transactions', filters: [{ field: 'createdAt', op: 'gte', value: '2026-02-30' }] },
        { source: 'transactions', filters: [{ field: 'createdAt', op: 'eq', value: '2026-02-29T09:00:00-06:00' }] },
        JSON.parse('{"source":"roster","__proto__":{"polluted":true}}'),
    ]) {
        assert.throws(() => Data.validate(query));
        assert.equal(Data.resolve(query, context).status, 'invalid');
    }
    assert.equal({}.polluted, undefined);
});
check('filters run before sorting and limits, with missing values excluded unless requested', () => {
    const filtered = roster({ columns: ['name', 'age'], filters: [{ field: 'position', op: 'eq', value: 'wr' }, { field: 'age', op: 'gte', value: 23 }], sort: { field: 'age', direction: 'desc' }, limit: 1 });
    assert.deepEqual(filtered.rows, [{ name: 'Devon Delta', age: 29 }]);
    const missing = roster({ columns: ['name'], filters: [{ field: 'age', op: 'isMissing' }] });
    assert.deepEqual(missing.rows, [{ name: 'Casey Gamma' }]);
    assert.equal(roster({ filters: [{ field: 'age', op: 'neq', value: 26 }] }).rows.length, 2);
    assert.equal(roster({ filters: [{ field: 'position', op: 'in', value: ['qb', 'rb'] }] }).rows.length, 1);
    assert.equal(roster({ filters: [{ field: 'name', op: 'contains', value: 'BETA' }] }).rows[0].name, 'Blake Beta');
    for (const direction of ['asc', 'desc']) assert.equal(roster({ columns: ['age'], sort: { field: 'age', direction } }).rows.at(-1).age, null);
});
check('aggregation creates new grouped comparisons without turning missing observations into zero', () => {
    const grouped = roster({ groupBy: 'position', aggregate: { field: 'age', op: 'avg' }, sort: { field: 'value', direction: 'asc' } });
    assert.deepEqual(grouped.rows, [{ position: 'QB', value: 26 }, { position: 'WR', value: 26 }]);
    assert.deepEqual(grouped.fields.map(field => [field.id, field.type]), [['position', 'string'], ['value', 'number']]);
    assert.equal(grouped.fields[1].unit, 'years');
    assert.match(grouped.note, /1 missing reported age value was excluded/);
    assert.equal(roster({ aggregate: { op: 'count' } }).rows[0].value, 4);
    assert.equal(roster({ aggregate: { field: 'age', op: 'count' } }).rows[0].value, 3);
    assert.equal(roster({ filters: [{ field: 'name', op: 'eq', value: 'not on roster' }], aggregate: { op: 'count' } }).rows[0].value, 0);
    assert.equal(roster({ filters: [{ field: 'age', op: 'isMissing' }], aggregate: { field: 'age', op: 'sum' } }).rows[0].value, null);
    assert.equal(roster({ aggregate: { field: 'age', op: 'min' } }).rows[0].value, 23);
    assert.equal(roster({ aggregate: { field: 'age', op: 'max' } }).rows[0].value, 29);
    const missingPoints = Data.resolve({ source: 'standings', aggregate: { field: 'pointsFor', op: 'sum' } }, { currentLeague: { rosters: [{ roster_id: 1, settings: { fpts: 0 } }, { roster_id: 2, settings: {} }] } });
    assert.equal(missingPoints.rows[0].value, 0, 'a reported zero is included');
    assert.match(missingPoints.note, /playoff tiebreakers/);
    assert.match(missingPoints.note, /1 missing points for value was excluded/);
    const query = Data.validate({ source: 'roster', groupBy: 'position', aggregate: { op: 'count' } });
    assert.deepEqual(query.columns, ['position', 'value']);
    assert.equal(query.limit, 50);
    assert.deepEqual(Data.fieldsFor(query).map(field => field.id), query.columns);
});
check('unavailable and loaded-empty datasets remain distinct, including aggregate counts', () => {
    for (const source of ['roster', 'leagueRoster', 'standings', 'transactions']) assert.equal(Data.resolve({ source }, {}).status, 'unavailable', source);
    assert.equal(Data.resolve({ source: 'roster', aggregate: { op: 'count' } }, {}).rows.length, 0);
    assert.equal(Data.resolve({ source: 'roster' }, { myRoster: { players: [] } }).status, 'empty');
    assert.equal(Data.resolve({ source: 'transactions' }, { transactions: [] }).status, 'empty');
    assert.equal(Data.resolve({ source: 'leagueRoster' }, { currentLeague: { rosters: [{ roster_id: 1 }] } }).status, 'unavailable');
});
check('season scores require verified season provenance and authoritative league scoring', () => {
    const query = { source: 'roster', columns: ['name', 'gamesPlayed', 'fantasyPoints', 'ppg'] };
    const statsByPid = { a: { pass_yd: 250, pass_int: 1, gp: 2 }, b: { rec: 0, gp: 2 }, c: { rec: 3, gp: 0 }, d: { gp: 3 } };
    const unsafe = Data.resolve(query, { ...context, statsData: statsByPid, prevStatsData: statsByPid });
    assert.ok(unsafe.rows.every(row => row.ppg === null && row.fantasyPoints === null));
    assert.match(unsafe.note, /matching-season/);
    for (const snapshot of [{ season: '2025', statsByPid }, { season: '2026', week: 3, statsByPid }, { season: '2026', seasonType: 'post', statsByPid }]) assert.ok(Data.resolve(query, { ...context, statsSnapshot: snapshot }).rows.every(row => row.ppg === null));
    const scored = Data.resolve(query, { ...context, statsSnapshot: { season: '2026', statsByPid, updatedAt: 12345 } });
    assert.equal(scored.updatedAt, 12345);
    assert.equal(scored.rows[0].fantasyPoints, 8);
    assert.equal(scored.rows[0].ppg, 4);
    assert.equal(scored.rows[1].fantasyPoints, 0);
    assert.equal(scored.rows[1].ppg, 0);
    assert.equal(scored.rows[2].ppg, null, 'zero games do not produce a made-up rate');
    assert.equal(scored.rows[3].fantasyPoints, null, 'games-only metadata is not an observed score of zero');
    const negative = Data.resolve(query, { ...context, statsSnapshot: { season: '2026', statsByPid: { a: { pass_int: 2, gp: 1 } } } });
    assert.equal(negative.rows[0].ppg, -4);
    const absentScorer = Data.resolve(query, { ...context, leagueStats: {}, statsSnapshot: { season: '2026', statsByPid } });
    assert.equal(absentScorer.rows[0].fantasyPoints, null);
    assert.match(absentScorer.note, /scoring.*verified/);
    for (const scoring_settings of [undefined, {}]) {
        let calls = 0;
        const noRules = Data.resolve(query, { ...context, currentLeague: { ...league, scoring_settings }, statsSnapshot: { season: '2026', statsByPid }, leagueStats: { score: () => { calls++; return 100; } } });
        assert.equal(calls, 0, 'do not call a scoring helper that could choose default rules');
        assert.ok(noRules.rows.every(row => row.fantasyPoints === null));
    }
});
check('unloaded stats cannot become confident filtered counts, groups or ordered results', () => {
    for (const query of [
        { filters: [{ field: 'fantasyPoints', op: 'gt', value: 10 }], aggregate: { op: 'count' } },
        { filters: [{ field: 'ppg', op: 'isMissing' }], aggregate: { op: 'count' } },
        { aggregate: { op: 'count', field: 'gamesPlayed' } },
        { aggregate: { op: 'avg', field: 'ppg' } },
        { groupBy: 'fantasyPoints', aggregate: { op: 'count' } },
        { columns: ['name'], sort: { field: 'fantasyPoints', direction: 'desc' } },
        { columns: ['fantasyPoints', 'ppg'] },
    ]) {
        const result = roster(query);
        assert.equal(result.status, 'unavailable');
        assert.deepEqual(result.rows, [], 'never invent a count of zero or a sorted order');
    }
    const mixed = roster({ columns: ['name', 'fantasyPoints'] });
    assert.equal(mixed.status, 'ready');
    assert.equal(mixed.rows[0].name, 'Avery Alpha');
    assert.equal(mixed.rows[0].fantasyPoints, null);
    const observed = Data.resolve({ source: 'roster', filters: [{ field: 'gamesPlayed', op: 'gt', value: 0 }], aggregate: { op: 'count' } }, {
        ...context, leagueStats: {}, statsSnapshot: { season: '2026', statsByPid: { a: { gp: 2 } } },
    });
    assert.equal(observed.status, 'ready', 'reported games played do not require fantasy scoring rules');
    assert.equal(observed.rows[0].value, 1);
});
check('standings retain tied ranks and zero points while unknown records prevent false ranks', () => {
    const query = { source: 'standings', columns: ['teamId', 'wins', 'losses', 'ties', 'pointsFor', 'winPct', 'rank', 'isMine'] };
    const result = Data.resolve(query, context);
    assert.deepEqual(result.rows.map(row => row.rank), [1, 1, 3]);
    assert.equal(result.rows[0].pointsFor, 100.25);
    assert.equal(result.rows[2].winPct, 50);
    assert.equal(result.rows[0].isMine, true);
    const incompleteLeague = { rosters: [...league.rosters, { roster_id: 4, settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } }] };
    const incomplete = Data.resolve(query, { currentLeague: incompleteLeague });
    assert.ok(incomplete.rows.every(row => row.rank === null));
    assert.equal(incomplete.rows[3].pointsFor, 0);
    assert.equal(incomplete.rows[3].winPct, null);
    assert.equal(Data.resolve(query, { currentLeague: { rosters: [{ roster_id: 1, settings: {} }] } }).rows[0].pointsFor, null);
});
check('activity preserves source details and exposes its sample boundary for grouped counts', () => {
    const activityContext = { ...context, transactions: [
        { transaction_id: '1234567890123456789', type: 'trade', status: 'complete', created: Date.parse('2026-10-20T12:00:00Z'), leg: 7, roster_ids: ['1234567890123456789', 2], adds: { a: 2 }, drops: {}, draft_picks: [] },
        { transaction_id: '1234567890123456789', type: 'trade', status: 'complete' },
        { transaction_id: '2', type: 'waiver', status: 'complete', created: Date.parse('2026-10-21T12:00:00Z'), leg: 7, roster_ids: [2], adds: {}, drops: {} },
        { transaction_id: '3', type: 'trade', status: 'complete' },
    ] };
    const result = Data.resolve({ source: 'transactions', columns: ['transactionId', 'createdAt', 'teams', 'playersAdded', 'playersDropped', 'picksMoved'], sort: { field: 'createdAt', direction: 'desc' } }, activityContext);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[1].transactionId, '1234567890123456789');
    assert.equal(result.rows[1].teams, 'The Owls, Brooke');
    assert.equal(result.rows[1].playersDropped, 0);
    assert.equal(result.rows[1].picksMoved, 0);
    assert.equal(result.rows[2].createdAt, null);
    assert.equal(result.rows[2].playersAdded, null);
    assert.equal(result.rows[2].picksMoved, null);
    assert.match(result.note, /not a complete season history/);
    const counts = Data.resolve({ source: 'transactions', groupBy: 'type', aggregate: { op: 'count' }, sort: { field: 'value', direction: 'desc' } }, activityContext);
    assert.deepEqual(counts.rows, [{ type: 'trade', value: 2 }, { type: 'waiver', value: 1 }]);
    const dated = Data.resolve({ source: 'transactions', filters: [{ field: 'createdAt', op: 'gte', value: '2026-10-21' }] }, activityContext);
    assert.equal(dated.rows.length, 1);
    const calendarDates = Data.resolve({ source: 'transactions', columns: ['createdAt'] }, { transactions: [
        { created: '2026-02-30T09:00:00-06:00' }, { created: '2024-02-29T23:00:00-06:00' },
    ] });
    assert.equal(calendarDates.rows[0].createdAt, null, 'calendar overflow never silently shifts an event');
    assert.equal(calendarDates.rows[1].createdAt, '2024-03-01T05:00:00.000Z', 'valid leap days and timezone offsets remain valid');
    assert.doesNotThrow(() => Data.validate({ source: 'transactions', filters: [{ field: 'createdAt', op: 'gte', value: '2024-02-29T23:00:00-06:00' }] }));
});
check('queries never mutate caller-owned rosters or metadata', () => {
    const before = JSON.stringify(context);
    roster({ columns: ['name', 'age'], sort: { field: 'age', direction: 'desc' } });
    Data.resolve({ source: 'standings', sort: { field: 'wins', direction: 'desc' } }, context);
    assert.equal(JSON.stringify(context), before);
});
console.log('Dashboard view data: ' + checks + ' checks passed.');
