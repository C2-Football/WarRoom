#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sources = Object.fromEntries(['cyberscooty', 'simanek'].map((id) => [id, fs.readFileSync(path.join(__dirname, '../images/time-league/helmets/', id + '.svg'), 'utf8')]));
const cacheInstances = [];
class TrackedMap extends Map {
    constructor(...args) { super(...args); cacheInstances.push(this); }
}
const App = {
    TimeLeagueHelmetSources: sources,
    TimeLeagueHelmet: { shellColorFor: (spec) => spec?.shellColor },
};
const sandbox = { window: { App }, Map: TrackedMap };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/shared/time-league-helmet-artwork.js'), 'utf8'), sandbox);
const Artwork = App.TimeLeagueHelmetArtwork;
const stripColors = (svg) => svg.replace(/#[0-9a-f]{6}\b/gi, '#COLOR');
const sourceTag = (svg, id) => svg.match(new RegExp('<(?:path|stop)\\b[^>]*\\bid="' + id + '"[^>]*>'))?.[0];
let passed = 0;
function test(name, run) { run(); passed++; console.log('  ok  ' + name); }

for (const assetId of Object.keys(sources)) {
    test(assetId + ': original is the full, byte-identical source', () => {
        const spec = { assetId, artworkMode: 'original', shellColor: '#FF0000' };
        assert.strictEqual(Artwork.svgFor(spec), sources[assetId]);
        assert.strictEqual(Artwork.imageFor(spec), 'images/time-league/helmets/' + assetId + '.svg');
    });
    test(assetId + ': team colors preserve every element, path and source attribute', () => {
        const spec = { assetId, artworkMode: 'team-colors', shellColor: '#184B35', stripeColor: '#F0C43C', facemaskColor: '#E4E4E4' };
        const svg = Artwork.svgFor(spec);
        assert.notStrictEqual(svg, sources[assetId]);
        assert.strictEqual(stripColors(svg), stripColors(sources[assetId]));
        assert.ok(svg.includes('cc:license'));
        assert.ok(svg.includes('http://creativecommons.org/licenses/publicdomain/'));
        assert.strictEqual(decodeURIComponent(Artwork.imageFor(spec).split(',').slice(1).join(',')), svg);
    });
}

test('side-view shell, stripe and all native cage sections take the selected paint', () => {
    const svg = Artwork.svgFor({ assetId: 'cyberscooty', artworkMode: 'team-colors', shellColor: '#123456', stripeColor: '#ABCDEF', facemaskColor: '#FFFFFF' });
    assert.ok(sourceTag(svg, 'path2996').includes('fill:#123456'));
    assert.ok(sourceTag(svg, 'path3893').includes('fill:#ABCDEF'));
    assert.ok(sourceTag(svg, 'stop3922').includes('stop-color:#FFFFFF'));
    for (const id of ['path3043', 'path3051', 'stop3920']) assert.notStrictEqual(sourceTag(svg, id), sourceTag(sources.cyberscooty, id));
    for (const id of ['path2998', 'path3002', 'path3059', 'path3869', 'path3826', 'stop3843']) assert.strictEqual(sourceTag(svg, id), sourceTag(sources.cyberscooty, id));
});

test('three-quarter shading, stripe and cage all preserve the original depth', () => {
    const svg = Artwork.svgFor({ assetId: 'simanek', artworkMode: 'team-colors', shellColor: '#FFFFFF', stripeColor: '#112233', facemaskColor: '#FFFFFF' });
    assert.ok(sourceTag(svg, 'stop3840').includes('stop-color:#FFFFFF'));
    assert.ok(sourceTag(svg, 'stop3842').includes('stop-color:#CBCBCB'));
    assert.ok(sourceTag(svg, 'path3790').includes('fill:#112233'));
    assert.ok(sourceTag(svg, 'path3780').includes('fill:#FFFFFF'));
    assert.ok(sourceTag(svg, 'stop3846').includes('stop-color:#ACACAC'));
    for (const id of ['path4390', 'path3786', 'path3788', 'path3796', 'path3860', 'path3862']) assert.strictEqual(sourceTag(svg, id), sourceTag(sources.simanek, id));
});

test('untrusted values never become a source path, markup or CSS declaration', () => {
    const spec = { assetId: '../../evil', artworkMode: 'team-colors', shellColor: 'url(https://evil.test)', stripeColor: '#123456;stroke:red', facemaskColor: '"><script>alert(1)</script>' };
    const svg = Artwork.svgFor(spec);
    assert.strictEqual(stripColors(svg), stripColors(sources.cyberscooty));
    assert.ok(!svg.includes('evil.test'));
    assert.ok(!svg.includes('<script>'));
    assert.ok(!svg.includes('stroke:red'));
    assert.strictEqual(Artwork.imageFor({ assetId: 'https://evil.test', artworkMode: 'original' }), 'images/time-league/helmets/cyberscooty.svg');
});

test('unknown modes preserve the original artwork', () => {
    assert.strictEqual(Artwork.svgFor({ assetId: 'simanek', artworkMode: 'unexpected' }), sources.simanek);
});

test('many saved paint combinations stay within the 128-entry cache limit', () => {
    for (let index = 0; index < 200; index++) Artwork.imageFor({ assetId: 'cyberscooty', artworkMode: 'team-colors', shellColor: '#' + index.toString(16).padStart(6, '0') });
    assert.strictEqual(cacheInstances.length, 1);
    assert.ok(cacheInstances[0].size <= 128);
});

console.log('\n' + passed + ' helmet artwork tests passed.');
