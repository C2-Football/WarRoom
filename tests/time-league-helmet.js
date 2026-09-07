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

test('club marks and custom initials survive a saved-spec round trip', () => {
    for (const decal of Helmet.DECAL_STYLES) {
        const spec = Helmet.normalizeHelmet({ ...Helmet.presetHelmet('ice-wolves'), decal: decal.id, monogram: 'n7!' }, 'saved-team');
        const restored = Helmet.normalizeHelmet(JSON.parse(JSON.stringify(spec)), 'saved-team');
        assert.strictEqual(restored.decal, decal.id);
        assert.strictEqual(restored.monogram, 'N7');
        assert.deepStrictEqual(restored, spec);
    }
    assert.strictEqual(Helmet.normalizeHelmet({ monogram: 'abcd' }).monogram, 'ABC');
});

test('editing a complete legacy helmet preserves its chosen identity', () => {
    const legacy = { ...Helmet.presetHelmet('midnight'), accentColor: '#ABCDEF', stripeColor: '#123456', facemask: 'double', facemaskColor: '#F0C43C' };
    const normalized = Helmet.normalizeHelmet(legacy, 'existing-team');
    for (const [key, value] of Object.entries(legacy)) assert.strictEqual(normalized[key], value, key);
    assert.strictEqual(normalized.monogram, '');
});

test('modern gear, full-shell paint and custom colors survive a saved-spec round trip', () => {
    const source = { ...Helmet.presetHelmet('copperhead'), shellColor: '#21907a', facemaskColor: '#7E54C9', visor: 'ice', paintStyle: 'winged' };
    const saved = Helmet.normalizeHelmet(source, 'modern-team');
    assert.deepStrictEqual(Helmet.normalizeHelmet(JSON.parse(JSON.stringify(saved)), 'modern-team'), saved);
    assert.strictEqual(saved.shell, 'impact');
    assert.strictEqual(saved.facemask, 'power');
    assert.strictEqual(saved.visor, 'ice');
    assert.strictEqual(saved.paintStyle, 'winged');
    assert.strictEqual(saved.facemaskColor, '#7E54C9');
    assert.strictEqual(Helmet.shellColorFor(saved), '#21907a');
    assert.strictEqual(Helmet.shellColorFor({ ...saved, shellColor: '' }), Helmet.colorById(saved.color).hex);
});

test('legacy designs acquire no surprise paint or visor and invalid custom values are discarded', () => {
    const legacy = Helmet.normalizeHelmet({ color: 'navy', shell: 'round-70', decal: 'star', facemask: 'cage', stripe: false }, 'old-team');
    assert.strictEqual(legacy.paintStyle, 'solid');
    assert.strictEqual(legacy.visor, 'none');
    assert.strictEqual(legacy.shellColor, '');
    const invalid = Helmet.normalizeHelmet({ ...legacy, shellColor: 'url(https://example.com)', visor: 'unknown', paintStyle: 'unknown' });
    assert.strictEqual(invalid.shellColor, '');
    assert.strictEqual(invalid.visor, 'none');
    assert.strictEqual(invalid.paintStyle, 'solid');
});

// Render the real component tree without a browser. This catches a previous
// regression where the saved shell/mask controls had no effect on SVG geometry.
let renderId = 0;
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useId: () => `helmet-test-${++renderId}`,
    Fragment: 'fragment',
};
require('../js/components/time-league-helmet.js');
function helmetNodes(helmet) {
    const nodes = [];
    function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(visit);
        if (typeof node.type === 'function') return visit(node.type({ ...node.props, children: node.children }));
        nodes.push(node);
        (node.children || []).forEach(visit);
    }
    visit(window.TimeLeagueHelmetIcon({ helmet, letter: 'VC' }));
    return nodes;
}

test('each shell and facemask choice changes real rendered geometry', () => {
    const base = Helmet.presetHelmet('blue-horseshoe');
    const contours = Helmet.SHELL_STYLES.map(({ id }) => {
        const nodes = helmetNodes({ ...base, shell: id });
        return nodes.find(node => node.props['data-helmet-shell'] === id)?.props.d;
    });
    assert.ok(contours.every(Boolean));
    assert.strictEqual(new Set(contours).size, Helmet.SHELL_STYLES.length);
    const masks = Helmet.FACEMASK_STYLES.map(({ id }) => helmetNodes({ ...base, facemask: id }).filter(node => node.type === 'path').map(node => node.props.d).join('|'));
    assert.strictEqual(new Set(masks).size, Helmet.FACEMASK_STYLES.length);
    const heritage = helmetNodes(base).filter(node => node.type === 'path');
    assert.ok(heritage.some(node => node.props.d.startsWith('m771.53 369.88c-16.945')), 'native heritage cage geometry remains intact');
    assert.ok(!helmetNodes({ ...base, facemask: 'none' }).some(node => node.props.d?.startsWith('m771.53 369.88c-16.945')), 'open shell removes the cage');
});

test('paint and visor choices add visible layers while legacy defaults remain clean', () => {
    const base = Helmet.presetHelmet('blue-horseshoe');
    assert.ok(!helmetNodes(base).some(node => node.props['data-helmet-paint'] || node.props['data-helmet-visor']));
    for (const { id } of Helmet.PAINT_STYLES.filter(style => style.id !== 'solid')) {
        const layer = helmetNodes({ ...base, paintStyle: id }).find(node => node.props['data-helmet-paint'] === id);
        assert.ok(layer?.children.length, id + ' has actual painted artwork');
    }
    for (const { id } of Helmet.VISOR_STYLES.filter(style => style.id !== 'none')) {
        const layer = helmetNodes({ ...base, visor: id }).find(node => node.props['data-helmet-visor'] === id);
        assert.ok(layer?.children.length, id + ' has a lens');
    }
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((failure) => console.log('  - ' + failure.name + ': ' + failure.error.message));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
