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

test('whole artwork selections and original color mode survive a saved-spec round trip', () => {
    for (const artwork of Helmet.ARTWORKS) {
        const selected = Helmet.normalizeHelmet({ ...Helmet.presetHelmet('midnight'), assetId: artwork.id, artworkMode: 'original' });
        assert.strictEqual(selected.assetId, artwork.id);
        assert.strictEqual(selected.artworkMode, 'original');
        assert.deepStrictEqual(Helmet.normalizeHelmet(JSON.parse(JSON.stringify(selected))), selected);
        assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', artwork.src)));
        assert.ok(artwork.sourceUrl.startsWith('https://'));
        assert.strictEqual(artwork.license, 'CC0');
    }
});

test('legacy specs select complete artwork and untrusted asset paths are rejected', () => {
    const legacy = Helmet.normalizeHelmet({ color: 'navy', facemaskColor: '#111111' });
    assert.strictEqual(legacy.assetId, 'cyberscooty');
    assert.strictEqual(legacy.artworkMode, 'team-colors');
    assert.strictEqual(legacy.color, 'navy');
    const invalid = Helmet.normalizeHelmet({ assetId: 'https://example.test/tracking.svg', artworkMode: '<script>', src: 'javascript:alert(1)' });
    assert.strictEqual(invalid.assetId, 'cyberscooty');
    assert.strictEqual(invalid.artworkMode, 'team-colors');
    assert.strictEqual(invalid.src, undefined);
});

// Render the actual shared image and picker without a browser. The renderer
// must use one complete sourced image, regardless of saved legacy gear fields.
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
};
require('../js/shared/time-league-helmet-sources.js');
require('../js/shared/time-league-helmet-artwork.js');
require('../js/components/time-league-helmet.js');
function nodesFor(tree) {
    const nodes = [];
    function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(visit);
        if (typeof node.type === 'function') return visit(node.type({ ...node.props, children: node.children }));
        nodes.push(node);
        (node.children || []).forEach(visit);
    }
    visit(tree);
    return nodes;
}

test('icons render complete source images and never draw separate shells, masks or logos', () => {
    for (const artwork of Helmet.ARTWORKS) {
        const helmet = Helmet.normalizeHelmet({ assetId: artwork.id, artworkMode: 'original', shell: 'speed', facemask: 'power', paintStyle: 'winged', visor: 'ice', decal: 'wolf' });
        const icon = window.TimeLeagueHelmetIcon({ helmet, letter: 'VC', size: 80, title: 'Vault Club helmet' });
        assert.strictEqual(icon.type, 'img');
        assert.strictEqual(icon.props.src, App.TimeLeagueHelmetArtwork.imageFor(helmet));
        assert.strictEqual(icon.props['data-helmet-artwork'], artwork.id);
        assert.strictEqual(icon.props.alt, 'Vault Club helmet');
        assert.strictEqual(icon.props.width, 80);
        assert.strictEqual(icon.props.height, 80);
        assert.strictEqual(icon.children.length, 0);
    }
    const decorative = window.TimeLeagueHelmetIcon({ helmet: Helmet.defaultHelmet('VC') });
    assert.strictEqual(decorative.props.alt, '');
    assert.strictEqual(decorative.props['aria-hidden'], 'true');
});

test('picker uses original asset thumbnails and only exposes supported color controls', () => {
    const state = [];
    let cursor = 0;
    React.useState = initial => {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    };
    React.useRef = value => ({ current: value });
    React.useEffect = () => {};
    const render = () => {
        cursor = 0;
        return nodesFor(window.TimeLeagueHelmetPicker({ helmet: Helmet.defaultHelmet('Club'), name: 'Club', onChange: () => {} }));
    };
    let nodes = render();
    nodes.find(node => node.props['aria-label'] === 'Choose Club helmet').props.onClick();
    nodes = render();
    const choices = nodes.filter(node => node.type === 'button' && node.props.className === 'tl-artwork-choice');
    assert.strictEqual(choices.length, Helmet.ARTWORKS.length);
    for (const choice of choices) {
        const preview = nodesFor(choice).find(node => node.type === 'img');
        assert.strictEqual(preview.props['data-artwork-mode'], 'original');
    }
    const nav = nodes.find(node => node.props['aria-label'] === 'Helmet design controls');
    const tabs = nodesFor(nav).filter(node => node.type === 'button');
    assert.deepStrictEqual(tabs.map(node => node.children[0]), ['Helmets', 'Colors']);
    tabs[1].props.onClick();
    nodes = render();
    assert.deepStrictEqual(nodes.filter(node => node.type === 'input').map(node => node.props['aria-label']), ['Custom shell color', 'Custom stripe color', 'Custom facemask color']);
    const original = nodes.find(node => node.type === 'button' && node.children[0] === 'Original artwork');
    original.props.onClick();
    assert.strictEqual(render().filter(node => node.type === 'input').length, 0);
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((failure) => console.log('  - ' + failure.name + ': ' + failure.error.message));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
