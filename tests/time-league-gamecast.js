#!/usr/bin/env node
// Unit tests for js/shared/time-league-gamecast.js and
// js/shared/time-league-player-cards.js — ported from The Duat's
// app/gamecast-engine.ts and app/player-cards.ts.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
require('../js/shared/time-league-roster.js');
const Gamecast = require('../js/shared/time-league-gamecast.js');
const PlayerCards = require('../js/shared/time-league-player-cards.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

function entry(overrides) {
    return {
        entryId: 'e1', identity: 'player:rb:test', name: 'Test Runner', position: 'RB',
        drawnSeason: 2015, slot: 'RB', points: 18.4, factor: 1,
        stats: { passYd: 0, passTd: 0, passInt: 0, rushYd: 92, rushTd: 2, rec: 3, recYd: 24, recTd: 0, fumblesLost: 0, twoPointConversions: 0 },
        ...overrides,
    };
}

test('buildGamecast events sum back to the entry total, exact to the cent', () => {
    const result = Gamecast.buildGamecast({
        week: 1,
        results: [{ teamId: 't1', total: 18.4, starters: [entry()] }],
        matchups: [],
        seed: 'gamecast-seed',
    });
    const centsSum = result.events.reduce((sum, e) => sum + Math.round(e.points * 100), 0);
    assert.strictEqual(centsSum, Math.round(18.4 * 100));
});

test('buildGamecast is deterministic for the same seed', () => {
    const input = { week: 1, results: [{ teamId: 't1', total: 18.4, starters: [entry()] }], matchups: [], seed: 'same-seed' };
    const a = Gamecast.buildGamecast(input);
    const b = Gamecast.buildGamecast(input);
    assert.deepStrictEqual(a.events.map((e) => e.description), b.events.map((e) => e.description));
});

test('buildGamecast skips entries with no stats or zero points', () => {
    const result = Gamecast.buildGamecast({
        week: 1,
        results: [{ teamId: 't1', total: 0, starters: [entry({ stats: null, points: 0 }), entry({ entryId: 'e2', points: 0 })] }],
        matchups: [],
        seed: 'zero-seed',
    });
    assert.strictEqual(result.events.length, 0);
});

test('buildGamecast prices special-teams-only lines (K/DEF/IDP) from the extra bag', () => {
    const kicker = entry({
        entryId: 'e3', position: 'K', points: 9,
        stats: { passYd: 0, passTd: 0, passInt: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0, fumblesLost: 0, twoPointConversions: 0, extra: { fgm_40_49: 2, xpm: 1 } },
    });
    const result = Gamecast.buildGamecast({ week: 1, results: [{ teamId: 't1', total: 9, starters: [kicker] }], matchups: [], seed: 'kicker-seed' });
    assert.ok(result.events.length > 0);
    const centsSum = result.events.reduce((sum, e) => sum + Math.round(e.points * 100), 0);
    assert.strictEqual(centsSum, 900);
});

test('weekHeadlines names the top scoring team and caps at 5 lines', () => {
    const results = [
        { teamId: 't1', total: 120, starters: [entry({ points: 40 })] },
        { teamId: 't2', total: 90, starters: [entry({ points: 20 })] },
    ];
    const matchups = [{ home: 't1', away: 't2', homePoints: 120, awayPoints: 90, winner: 't1' }];
    const headlines = Gamecast.weekHeadlines(results, matchups, (id) => (id === 't1' ? 'Team One' : 'Team Two'));
    assert.ok(headlines.length > 0 && headlines.length <= 5);
    assert.ok(headlines[0].includes('Team One'));
});

test('buildPlayerCardIndex keeps valid entries and skips malformed ones', () => {
    const payload = {
        players: [
            { identity: 'player:rb:ok', name: 'Good Runner', position: 'RB', seasons: [{ season: 2010, games: 16, passYd: 0, passTd: 0, passInt: 0, rushYd: 1200, rushTd: 10, rec: 0, recYd: 0, recTd: 0, points: 200 }] },
            { identity: 'player:rb:bad', name: 'Missing Seasons', position: 'RB' },
            null,
            'garbage',
        ],
    };
    const index = PlayerCards.buildPlayerCardIndex(payload);
    assert.strictEqual(index.size, 1);
    const card = index.get('player:rb:ok');
    assert.strictEqual(card.peak, 200);
});

test('buildPlayerCardIndex tolerates a non-object payload', () => {
    assert.strictEqual(PlayerCards.buildPlayerCardIndex(null).size, 0);
    assert.strictEqual(PlayerCards.buildPlayerCardIndex('nonsense').size, 0);
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
