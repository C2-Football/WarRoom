#!/usr/bin/env node
// Unit tests for the retro helmet identity model and legacy migration.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
require('../js/shared/time-league-roster.js');
const Helmet = require('../js/shared/time-league-helmet.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (error) { failed++; failures.push({ name, error }); console.log('  FAIL ' + name + '\n       ' + error.message); }
}

test('default helmets are deterministic and fully dressed', () => {
    const first = Helmet.defaultHelmet('Leatherheads');
    const second = Helmet.defaultHelmet('Leatherheads');
    assert.deepStrictEqual(first, second);
    assert.ok(Helmet.SHELL_STYLES.some((style) => style.id === first.shell));
    assert.ok(Helmet.DECAL_STYLES.some((style) => style.id === first.decal));
    assert.ok(Helmet.FACEMASK_COLORS.includes(first.facemaskColor));
    assert.ok(Helmet.STRIPE_STYLES.some((style) => style.id === first.stripeStyle));
});

test('legacy four-field helmets migrate without losing their chosen colors', () => {
    const migrated = Helmet.normalizeHelmet({ color: 'navy', facemask: 'double', stripe: true, stripeColor: '#FFFFFF' }, 'legacy-team');
    assert.strictEqual(migrated.color, 'navy');
    assert.strictEqual(migrated.facemask, 'double');
    assert.strictEqual(migrated.stripeStyle, 'single');
    assert.strictEqual(migrated.stripeColor, '#FFFFFF');
    assert.ok(migrated.shell);
    assert.ok(migrated.decal);
});

test('legacy stripe-off setting becomes the no-stripe style', () => {
    const migrated = Helmet.normalizeHelmet({ color: 'kelly', facemask: 'single', stripe: false }, 'no-stripe');
    assert.strictEqual(migrated.stripe, false);
    assert.strictEqual(migrated.stripeStyle, 'none');
});

test('presetHelmet returns independent complete preset specs', () => {
    const first = Helmet.presetHelmet('blue-horseshoe');
    const second = Helmet.presetHelmet('blue-horseshoe');
    first.color = 'black';
    assert.notStrictEqual(first.color, second.color);
    assert.strictEqual(second.stripe, false);
    assert.strictEqual(second.decal, 'horseshoe');
    assert.strictEqual(second.facemask, 'cage');
});

test('monogramFor uses both ends of a team name', () => {
    assert.strictEqual(Helmet.monogramFor('Warlord Kade'), 'WK');
    assert.strictEqual(Helmet.monogramFor('Commander'), 'CO');
    assert.strictEqual(Helmet.monogramFor(''), '?');
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((failure) => console.log('  - ' + failure.name + ': ' + failure.error.message));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
