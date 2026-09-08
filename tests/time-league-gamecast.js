#!/usr/bin/env node
// Unit tests for js/shared/time-league-gamecast.js and
// js/shared/time-league-player-cards.js — ported from The Duat's
// app/gamecast-engine.ts and app/player-cards.ts.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
require('../js/shared/time-league-roster.js');
require('../js/shared/time-league-draft-room.js');
const Season = require('../js/shared/time-league-season.js');
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

test('buildGamecast skips missing and empty lines, but preserves zero-net production', () => {
    const result = Gamecast.buildGamecast({
        week: 1,
        results: [{ teamId: 't1', total: 0, starters: [entry({ stats: null, points: 0 }), entry({ entryId: 'e2', points: 0, stats: { rushYd: 0 } })] }],
        matchups: [],
        seed: 'zero-seed',
    });
    assert.strictEqual(result.events.length, 0);
    const tied = Gamecast.buildGamecast({ week: 1, seed: 'zero-net', results: [{ teamId: 't1', total: 0, starters: [entry({ points: 0, stats: { passYd: 50, passInt: 1 } })] }] });
    assert(tied.events.some(event => event.points < 0));
    assert(tied.events.some(event => event.points > 0));
    assert.equal(tied.events.reduce((sum, event) => sum + Math.round(event.points * 100), 0), 0);
});

const scoring = { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 };
const castEntries = (entries, settings = scoring) => Gamecast.buildGamecast({ week: 1, seed: 'quarter-proof', scoring: settings, results: [{ teamId: 't1', total: entries.reduce((sum, entry) => sum + entry.points, 0), starters: entries }] });
function sameStats(actual, expected) {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
        if (key === 'extra') sameStats(actual.extra || {}, expected.extra || {});
        else assert.equal(actual[key] || 0, expected[key] || 0, `Conserve ${key}`);
    }
}

test('four extra points land as one kick in each quarter after the quarterback production', () => {
    const qb = entry({ position: 'QB', stats: { passYd: 320, passTd: 4 }, points: 28.8 });
    const kicker = entry({ entryId: 'k1', name: 'Test Kicker', position: 'K', stats: { extra: { xpm: 4 } }, points: 4 });
    const timeline = castEntries([qb, kicker]);
    assert.equal(timeline.duration, 60);
    assert.equal(timeline.quarters.length, 4);
    for (let quarter = 1; quarter <= 4; quarter++) {
        const kicks = timeline.events.filter(event => event.quarter === quarter && event.entryId === 'k1');
        assert.equal(kicks.length, 1);
        assert.equal(kicks[0].stats.extra.xpm, 1);
        assert.equal(kicks[0].points, 1);
        assert(kicks[0].t > timeline.events.find(event => event.quarter === quarter && event.stats.passTd === 1).t);
    }
    assert(!timeline.events.some(event => event.description.includes('extra points missed')));
    sameStats(timeline.events.filter(event => event.entryId === qb.entryId).reduce((sum, event) => Gamecast.addStats(sum, event.stats), {}), qb.stats);
    assert.deepStrictEqual(timeline, castEntries([qb, kicker]), 'Full timeline must replay deterministically');
});

test('custom scoring, bonuses and era factors land on accumulated stats and preserve exact cents', () => {
    const settings = { ...scoring, stats: { passTd: 6 }, bonuses: [{ stat: 'passYd', threshold: 300, points: 3 }], extended: { fgm: 0, fgm_40_49: 7, xpm: 2, xpmiss: -3, sack: 2.5 } };
    const stats = { passYd: 321, passTd: 3, passInt: 2, rushYd: -3, rec: 5, recYd: 77, recTd: 1, extra: { fgm: 2, fgm_40_49: 2, xpm: 4, xpmiss: 1, sack: 2.5 } };
    const factor = 1.17;
    const points = Math.round(Season.scoreStatLine(stats, settings) * factor * 100) / 100;
    const timeline = castEntries([entry({ stats, points, factor })], settings);
    const accumulated = {}; let cents = 0;
    for (const event of timeline.events) {
        Gamecast.addStats(accumulated, event.stats); cents += Math.round(event.points * 100);
        assert.equal(cents, Math.round(Season.scoreStatLine(accumulated, settings) * factor * 100));
        assert(event.t > (event.quarter - 1) * 15 && event.t < event.quarter * 15);
    }
    sameStats(accumulated, stats);
    assert.equal(cents, Math.round(points * 100));
    assert.equal(timeline.events.filter(event => event.stats.extra?.xpmiss).length, 1);
});

test('field goal bands and totals describe the same kicks without doubling commentary', () => {
    const stats = { extra: { fgm: 3, fgm_20_29: 1, fgm_50p: 2, fgmiss: 1, fgmiss_40_49: 1 } };
    const timeline = castEntries([entry({ position: 'K', stats, points: Season.scoreStatLine(stats, scoring) })]);
    assert.equal(timeline.events.length, 4);
    sameStats(timeline.events.reduce((sum, event) => Gamecast.addStats(sum, event.stats), {}), stats);
    assert(!timeline.events.some(event => event.description.includes('field goals made')));
});

test('a single receiving touchdown keeps its reception and yards together', () => {
    const stats = { rec: 1, recYd: 81, recTd: 1 };
    const timeline = castEntries([entry({ stats, points: Season.scoreStatLine(stats, scoring) })]);
    assert.equal(timeline.events.length, 1);
    sameStats(timeline.events[0].stats, stats);
});

test('quarter boundaries support pause-and-step without skipping or fabricating overtime', () => {
    assert.equal(Gamecast.nextQuarterEnd(0), 15);
    assert.equal(Gamecast.nextQuarterEnd(14.99), 15);
    assert.equal(Gamecast.nextQuarterEnd(15), 30);
    assert.equal(Gamecast.nextQuarterEnd(30), 45);
    assert.equal(Gamecast.nextQuarterEnd(45), 60);
    assert.equal(Gamecast.nextQuarterEnd(60), 60);
    assert.equal(Gamecast.clockLabel(0), 'Q1 · 15:00');
    assert.equal(Gamecast.clockLabel(15), 'END Q1');
    assert.equal(Gamecast.clockLabel(30), 'HALFTIME');
    assert.equal(Gamecast.clockLabel(60), 'FINAL');
    assert.equal(Gamecast.quarterAt(15.01), 2);
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
