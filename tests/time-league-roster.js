#!/usr/bin/env node
// Unit tests for js/shared/time-league-roster.js — roster-slot primitives +
// seeded RNG ported from The Duat's app/roster-build.ts.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
const Roster = require('../js/shared/time-league-roster.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

test('createSeededRandom is deterministic for the same seed', () => {
    const a = Roster.createSeededRandom('duat:seed-1');
    const b = Roster.createSeededRandom('duat:seed-1');
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    assert.deepStrictEqual(seqA, seqB);
});

test('createSeededRandom diverges for different seeds', () => {
    const a = Roster.createSeededRandom('seed-a')();
    const b = Roster.createSeededRandom('seed-b')();
    assert.notStrictEqual(a, b);
});

test('createSeededRandom values stay in [0, 1)', () => {
    const random = Roster.createSeededRandom('range-check');
    for (let i = 0; i < 200; i += 1) {
        const value = random();
        assert.ok(value >= 0 && value < 1, `value ${value} out of range`);
    }
});

test('normalizeRosterSlots keeps recognized slots and drops unknown ones', () => {
    const result = Roster.normalizeRosterSlots({ QB: 1, RB: 2, BOGUS: 5 });
    assert.strictEqual(result.QB, 1);
    assert.strictEqual(result.RB, 2);
    assert.strictEqual(result.BOGUS, undefined);
});

test('normalizeRosterSlots accepts array-of-slot-names input', () => {
    const result = Roster.normalizeRosterSlots(['QB', 'RB', 'RB', 'BN']);
    assert.strictEqual(result.QB, 1);
    assert.strictEqual(result.RB, 2);
    assert.strictEqual(result.BN, 1);
});

test('expandRosterSlots excludes reserve slots by default', () => {
    const expanded = Roster.expandRosterSlots({ QB: 1, IR: 2, TAXI: 1 });
    assert.deepStrictEqual(expanded, ['QB']);
});

test('expandRosterSlots includes reserve slots when asked', () => {
    const expanded = Roster.expandRosterSlots({ QB: 1, IR: 2 }, { includeReserveSlots: true });
    assert.strictEqual(expanded.length, 3);
    assert.strictEqual(expanded.filter((slot) => slot === 'IR').length, 2);
});

test('normalizePlayerPosition maps historical/alias labels to canonical positions', () => {
    assert.strictEqual(Roster.normalizePlayerPosition('HB'), 'RB');
    assert.strictEqual(Roster.normalizePlayerPosition('DST'), 'DEF');
    assert.strictEqual(Roster.normalizePlayerPosition('MLB'), 'LB');
    assert.strictEqual(Roster.normalizePlayerPosition('qb'), 'QB');
});

test('normalizePlayerPosition returns null for unrecognized input', () => {
    assert.strictEqual(Roster.normalizePlayerPosition('ZZZ'), null);
    assert.strictEqual(Roster.normalizePlayerPosition(undefined), null);
});

test('ROSTER_SLOT_IDS and SLOT_ELIGIBILITY stay in sync', () => {
    for (const slot of Roster.ROSTER_SLOT_IDS) {
        assert.ok(Array.isArray(Roster.SLOT_ELIGIBILITY[slot]), `${slot} missing eligibility list`);
    }
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
