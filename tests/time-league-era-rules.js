#!/usr/bin/env node
// Unit tests for js/shared/time-league-draft-room.js, time-league-rules.js,
// and time-league-era-rules.js — ported from The Duat's
// app/draft-room-engine.ts and app/era-rules.ts.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
require('../js/shared/time-league-roster.js');
require('../js/shared/time-league-rules.js');
const DraftRoom = require('../js/shared/time-league-draft-room.js');
const EraRules = require('../js/shared/time-league-era-rules.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const teams = ['t1', 't2', 't3', 't4'];

test('canonicalPlayerIdentity strips suffixes/punctuation and lowercases', () => {
    assert.strictEqual(
        DraftRoom.canonicalPlayerIdentity({ name: 'Odell Beckham Jr.', position: 'WR' }),
        DraftRoom.canonicalPlayerIdentity({ name: 'odell beckham', position: 'WR' }),
    );
});

test('canonicalPlayerIdentity differs by position', () => {
    assert.notStrictEqual(
        DraftRoom.canonicalPlayerIdentity({ name: 'Same Name', position: 'WR' }),
        DraftRoom.canonicalPlayerIdentity({ name: 'Same Name', position: 'RB' }),
    );
});

test('snake draft order reverses on even rounds', () => {
    const order = DraftRoom.createDraftOrder(teams, 2, 'snake');
    assert.deepStrictEqual(order.slice(0, 4).map((seat) => seat.teamId), teams);
    assert.deepStrictEqual(order.slice(4, 8).map((seat) => seat.teamId), [...teams].reverse());
});

test('findOpenRosterSlot respects QB cap', () => {
    const rosterSlots = { QB: 1, SUPER_FLEX: 1, BN: 2 };
    const found = DraftRoom.findOpenRosterSlot('QB', [], rosterSlots, 1, ['QB']);
    assert.strictEqual(found, null);
});

test('findOpenRosterSlot finds an eligible slot', () => {
    const rosterSlots = { RB: 1, FLEX: 1, BN: 2 };
    const found = DraftRoom.findOpenRosterSlot('RB', [], rosterSlots, Infinity, []);
    assert.ok(found && found.slot === 'RB');
});

test('toggleDraftQueue adds then removes', () => {
    let queue = DraftRoom.toggleDraftQueue([], 'p1');
    assert.deepStrictEqual(queue, ['p1']);
    queue = DraftRoom.toggleDraftQueue(queue, 'p1');
    assert.deepStrictEqual(queue, []);
});

test('decadeOf buckets seasons correctly, null before the merger', () => {
    assert.strictEqual(EraRules.decadeOf(1973), '1970s');
    assert.strictEqual(EraRules.decadeOf(2021), '2020s');
    assert.strictEqual(EraRules.decadeOf(1965), null);
});

test('defaultEraDraftRules is any-era with no decades', () => {
    const rules = EraRules.normalizeEraDraftRules(undefined);
    assert.strictEqual(rules.mode, 'any-era');
    assert.deepStrictEqual(rules.decades, []);
});

test('any-era rules allow every season', () => {
    const rules = EraRules.normalizeEraDraftRules({ mode: 'any-era', decades: [] });
    assert.strictEqual(EraRules.seasonAllowed(rules, 'QB', 1971), true);
    assert.strictEqual(EraRules.seasonAllowed(rules, 'QB', 2024), true);
});

test('selected-decades restricts to the chosen decades', () => {
    const rules = EraRules.normalizeEraDraftRules({ mode: 'selected-decades', decades: ['1990s'] });
    assert.strictEqual(EraRules.seasonAllowed(rules, 'RB', 1995), true);
    assert.strictEqual(EraRules.seasonAllowed(rules, 'RB', 2015), false);
});

test('kicker/DEF/IDP availability starts at 2000s even if selected-decades picks earlier', () => {
    const rules = EraRules.normalizeEraDraftRules({ mode: 'selected-decades', decades: ['1970s'] });
    // Intersection with what K can field (2000s+) is empty -> unrestricted, never blocked.
    assert.strictEqual(EraRules.allowedDecadesFor(rules, 'K').length, 0);
    assert.strictEqual(EraRules.seasonAllowed(rules, 'K', 1975), true);
});

test('openDraftEra rolls position-roulette once and freezes it', () => {
    const base = EraRules.normalizeEraDraftRules({ mode: 'position-roulette', decades: [] });
    const rolled = EraRules.openDraftEra(base, 'league-seed', ['QB', 'RB', 'WR']);
    assert.ok(rolled.positionDecades && Object.keys(rolled.positionDecades).length > 0);
    const rolledAgain = EraRules.openDraftEra(rolled, 'league-seed', ['QB', 'RB', 'WR']);
    assert.deepStrictEqual(rolledAgain.positionDecades, rolled.positionDecades);
});

test('openDraftEra is deterministic for the same seed', () => {
    const base = EraRules.normalizeEraDraftRules({ mode: 'position-roulette', decades: [] });
    const a = EraRules.openDraftEra(base, 'same-seed', ['QB', 'RB', 'WR', 'TE']);
    const b = EraRules.openDraftEra(base, 'same-seed', ['QB', 'RB', 'WR', 'TE']);
    assert.deepStrictEqual(a.positionDecades, b.positionDecades);
});

test('eraEligibleCard survives when at least one season is draftable', () => {
    const rules = EraRules.normalizeEraDraftRules({ mode: 'selected-decades', decades: ['2010s'] });
    const card = { position: 'WR', seasons: [{ season: 1985 }, { season: 2015 }] };
    assert.strictEqual(EraRules.eraEligibleCard(card, rules), true);
    const deadCard = { position: 'WR', seasons: [{ season: 1985 }] };
    assert.strictEqual(EraRules.eraEligibleCard(deadCard, rules), false);
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
