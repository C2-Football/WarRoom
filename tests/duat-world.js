'use strict';
/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');
const World = require('../js/duat/world.js');
const Rules = require('../js/duat/rules.js');

test('expanded choices preserve the fourteen original identities and give every faction a distinct home', () => {
    assert.equal(World.FACTIONS.length, 28);
    assert.equal(World.TERRITORIES.length, 175);
    assert.equal(new Set(World.FACTIONS.map(faction => faction.id)).size, 28);
    assert.equal(new Set(World.FACTIONS.map(faction => faction.homeTerritoryId)).size, 28);
    for (const original of Rules.FACTIONS) assert.deepEqual(World.factionById(original.id), original);
    for (const faction of World.FACTIONS) assert.equal(World.territoryById(faction.homeTerritoryId).homelandOf, faction.id);
    assert.equal(Rules.FACTIONS.length, 14, 'Expanding the chooser does not rewrite the original rules catalog.');
    assert.equal(Rules.TERRITORIES.length, 47);
});

test('every playing territory has sourced land geometry, area, and a clipped SVG outline', () => {
    assert.equal(World.SOURCE.sourceSha256, '2516c915867c7baf18ddec727aec46c315541a07cfb3d79a6559b05d5e94eee8');
    assert.match(World.SOURCE.boundaryNote, /not historical empire borders/);
    assert.equal(new Set(World.TERRITORIES.map(territory => territory.id)).size, 175);
    for (const territory of World.TERRITORIES) {
        assert.ok(['Polygon', 'MultiPolygon'].includes(territory.geometry.type));
        assert.ok(territory.geometry.coordinates.length > 0);
        assert.ok(territory.areaKm2 > 0);
        assert.ok(Math.abs(territory.longitude) <= 180 && Math.abs(territory.latitude) <= 90);
        assert.match(territory.path, /^M/);
        assert.ok(!/NaN|Infinity/.test(territory.path));
        const numbers = territory.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
        assert.ok(numbers.every((value, index) => value >= -0.01 && value <= (index % 2 ? 500.01 : 1000.01)));
    }
    const totalArea = World.TERRITORIES.reduce((total, territory) => total + territory.areaKm2, 0);
    assert.ok(totalArea > 130000000 && totalArea < 140000000, 'The board covers approximate world land outside Antarctica.');
    const fiji = World.territoryById('fiji');
    assert.ok(fiji.path.includes('M0,') && fiji.path.includes('1000,'), 'D3 clips Fiji at the antimeridian instead of drawing across the map.');
    assert.ok(World.territoryById('south-africa').path.split('Z').length > 2, 'The South Africa outline retains the enclosed Lesotho hole.');
    assert.throws(() => { World.TERRITORIES[0].areaKm2 = 0; }, TypeError);
});

test('land boundaries and navigable sea routes form one complete board without duplicate edges', () => {
    const ids = new Set(World.TERRITORIES.map(territory => territory.id)), keys = new Set();
    for (const route of World.ROUTES) {
        assert.ok(ids.has(route.from) && ids.has(route.to));
        assert.notEqual(route.from, route.to);
        const key = [route.from, route.to].sort().join(':');
        assert.ok(!keys.has(key)); keys.add(key);
        assert.ok(['land', 'sea'].includes(route.type));
    }
    const reached = new Set([World.TERRITORIES[0].id]), queue = [...reached];
    for (const id of queue) for (const route of World.ROUTES) {
        const neighbor = route.from === id ? route.to : route.to === id ? route.from : null;
        if (neighbor && !reached.has(neighbor)) { reached.add(neighbor); queue.push(neighbor); }
    }
    assert.equal(reached.size, ids.size);
    const routeBetween = (left, right) => World.ROUTES.find(route => [route.from, route.to].includes(left) && [route.from, route.to].includes(right));
    assert.equal(routeBetween('portugal', 'iberia').type, 'land');
    assert.equal(routeBetween('yamato', 'korea').type, 'sea');
    assert.equal(routeBetween('albion', 'gaul').name, 'English Channel');
});
