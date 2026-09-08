'use strict';
/* global require */
const test = require('node:test');
const assert = require('node:assert/strict');
const Conquest = require('../js/duat/conquest.js');
const World = require('../js/duat/world.js');
const ids = ['rome', 'gaul', 'egypt', 'persia', 'mongols', 'korea', 'khmer', 'siam', 'majapahit', 'aztecs', 'inca', 'mali', 'aksum', 'zulu'];
const createdAt = '2026-09-08T20:00:00.000Z';
const copy = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const fresh = (seed = 'combat-0') => Conquest.createConquest({ season: 2025, factionIds: ids, worldId: World.WORLD_ID, seed });
const results = (score = 115) => ids.map((factionId, index) => ({ factionId, place: index + 1, score: index ? 101 - index : score }));
const week = (state, value, scores = results()) => Conquest.recordWeek(state, { week: value, results: scores, createdAt });
const claim = (state, factionId, territoryId) => Conquest.claimTerritory(state, { factionId, territoryId, createdAt });
const attack = state => Conquest.attackTerritory(state, { factionId: 'rome', territoryId: 'switzerland', createdAt });
const prepare = (seed, score) => claim(week(fresh(seed), 1, results(score)), 'gaul', 'switzerland');

test('selected factions use the expanded board and earn capped battle actions exactly once per week', () => {
    const initial = freeze(fresh()), first = week(initial, 1);
    assert.equal(first.version, 2);
    assert.equal(first.worldId, World.WORLD_ID);
    assert.equal(first.campaignActions.rome, 2);
    assert.ok(ids.filter(id => id !== 'rome').every(id => first.campaignActions[id] === 1));
    assert.equal(initial.campaignActions.rome, 0);
    assert.equal(week(first, 1), first, 'Replayed results cannot mint additional actions.');
    assert.deepEqual(Conquest.recordWeek(initial, { week: 1, results: [...results()].reverse(), createdAt }), first);
    let state = week(week(first, 2), 3);
    state = week(state, 4);
    assert.ok(ids.every(id => state.campaignActions[id] === 3));
    assert.throws(() => Conquest.createConquest({ season: 2025, factionIds: ids, worldId: World.WORLD_ID }), { code: 'INVALID_SEED' });
});

test('battle previews use completed football performance and match the explicit d20 chance without exposing rolls', () => {
    const state = prepare('combat-0'), preview = Conquest.previewAttack(state, { factionId: 'rome', territoryId: 'switzerland' });
    assert.equal(preview.offense, 29);
    assert.equal(preview.defense, 29);
    assert.equal(preview.attackerScore, 115);
    assert.equal(preview.defenderScore, 100);
    assert.equal(preview.winChance, 190 / 400, 'Equal strength wins only on the 190 strictly higher d20 outcomes.');
    assert.equal(preview.winChancePercent, 47.5);
    assert.equal(preview.attackerRoll, undefined);
    assert.equal(preview.defenderRoll, undefined);
    const projected = copy(state); delete projected.seed;
    assert.deepEqual(Conquest.previewAttack(projected, { factionId: 'rome', territoryId: 'switzerland' }), preview);
    assert.throws(() => attack(projected), { code: 'INVALID_SEED' });
    const stronger = Conquest.previewAttack(prepare('combat-0', 215), { factionId: 'rome', territoryId: 'switzerland' });
    assert.ok(stronger.offense > preview.offense && stronger.winChance > preview.winChance);
});

test('a reproducible victory transfers real land, spends one action and preserves both armies and all homes', () => {
    const state = freeze(prepare('combat-0')), before = copy(state), next = attack(state), battle = next.events.at(-1);
    assert.deepEqual(attack(state), next, 'Same authoritative state and seed produce the same auditable result.');
    assert.deepEqual(state, before);
    assert.equal(battle.attackerRoll, 14); assert.equal(battle.defenderRoll, 8);
    assert.equal(battle.captured, true);
    assert.equal(battle.attackerTotal, battle.offense + battle.attackerRoll);
    assert.equal(battle.defenderTotal, battle.defense + battle.defenderRoll);
    assert.equal(next.owners.switzerland, 'rome');
    assert.ok(next.claimOrder.rome.includes('switzerland'));
    assert.ok(!next.claimOrder['gaul'].includes('switzerland'));
    assert.equal(next.campaignActions.rome, state.campaignActions.rome - 1);
    assert.equal(next.campaignActions['gaul'], state.campaignActions['gaul']);
    assert.match(battle.narrative, /Rome captured Switzerland from Gaul/);
    for (const id of ids) assert.equal(next.owners[next.homes[id]], id);
    const land = Conquest.landTotals(next, 'rome');
    assert.equal(land.territoryCount, 2);
    assert.equal(land.areaKm2, World.territoryById('latium').areaKm2 + World.territoryById('switzerland').areaKm2);
    assert.ok(land.percent > 0 && land.percent < 100);
});

test('a failed assault costs its action but cannot change ownership or fortifications', () => {
    const state = freeze(prepare('combat-3')), next = attack(state), battle = next.events.at(-1);
    assert.equal(battle.captured, false);
    assert.deepEqual(next.owners, state.owners);
    assert.deepEqual(next.claimOrder, state.claimOrder);
    assert.deepEqual(next.fortifications, state.fortifications);
    assert.equal(next.campaignActions.rome, 1);
    assert.match(battle.narrative, /Gaul held Switzerland against Rome/);
});

test('equal battle totals hold for the defender', () => {
    const state = prepare('tie-28'), next = attack(state), battle = next.events.at(-1);
    assert.equal(battle.attackerTotal, battle.defenderTotal);
    assert.equal(battle.captured, false);
    assert.equal(next.owners.switzerland, 'gaul');
    assert.equal(next.campaignActions.rome, state.campaignActions.rome - 1);
});

test('fortification uses earned actions, strengthens defense, and cannot target rivals or protected homes', () => {
    let state = prepare('fortified');
    const plain = Conquest.previewAttack(state, { factionId: 'rome', territoryId: 'switzerland' });
    assert.throws(() => Conquest.fortifyTerritory(state, { factionId: 'rome', territoryId: 'switzerland', createdAt }), { code: 'INVALID_FORTIFICATION' });
    assert.throws(() => Conquest.fortifyTerritory(state, { factionId: 'rome', territoryId: 'latium', createdAt }), { code: 'INVALID_FORTIFICATION' });
    const before = freeze(state);
    state = Conquest.fortifyTerritory(before, { factionId: 'gaul', territoryId: 'switzerland', createdAt });
    assert.equal(before.fortifications.switzerland, undefined);
    assert.equal(state.fortifications.switzerland, 1);
    assert.equal(state.campaignActions['gaul'], 0);
    const fortified = Conquest.previewAttack(state, { factionId: 'rome', territoryId: 'switzerland' });
    assert.equal(fortified.defense, plain.defense + 4);
    assert.ok(fortified.winChance < plain.winChance);
    assert.throws(() => Conquest.fortifyTerritory(state, { factionId: 'gaul', territoryId: 'switzerland', createdAt }), { code: 'NO_ACTIONS' });
    for (const value of [2, 3]) {
        state = week(state, value);
        state = Conquest.fortifyTerritory(state, { factionId: 'gaul', territoryId: 'switzerland', createdAt });
    }
    state = week(state, 4);
    assert.equal(state.fortifications.switzerland, 3);
    assert.ok(!Conquest.fortifiableTerritories(state, 'gaul').includes('switzerland'));
    assert.throws(() => Conquest.fortifyTerritory(state, { factionId: 'gaul', territoryId: 'switzerland', createdAt }), { code: 'INVALID_FORTIFICATION' });
});

test('combat rejects homes, neutral land, remote enemies, missing results and exhausted currency', () => {
    const initial = fresh(), state = prepare('combat-3');
    assert.equal(Conquest.previewAttack(state, { factionId: 'rome', territoryId: state.homes['gaul'] }).code, 'HOMELAND_PROTECTED');
    assert.throws(() => Conquest.attackTerritory(state, { factionId: 'rome', territoryId: state.homes['gaul'], createdAt }), { code: 'HOMELAND_PROTECTED' });
    assert.throws(() => Conquest.attackTerritory(initial, { factionId: 'rome', territoryId: 'switzerland', createdAt }), { code: 'NOT_CONNECTED' });
    assert.throws(() => Conquest.attackTerritory(state, { factionId: 'rome', territoryId: 'australia', createdAt }), { code: 'NOT_CONNECTED' });
    const spent = { ...state, campaignActions: { ...state.campaignActions, rome: 0 } };
    assert.equal(Conquest.previewAttack(spent, { factionId: 'rome', territoryId: 'switzerland' }).canAttack, false);
    assert.throws(() => attack(spent), { code: 'NO_ACTIONS' });
    const noResults = { ...state, events: [] };
    assert.throws(() => attack(noResults), { code: 'NO_BATTLE_RESULTS' });
    assert.throws(() => Conquest.attackTerritory(state, { factionId: 'outsider', territoryId: 'switzerland', createdAt }), { code: 'UNKNOWN_FACTION' });
});

test('playoff football refreshes military strength without new neutral claims or a final-week action award', () => {
    let state = prepare('playoff');
    for (let value = 2; value <= 14; value++) state = week(state, value);
    const before = copy(state), changed = results().map(row => row.factionId === 'gaul' ? { ...row, place: 14, score: 10 }
        : row.place === 14 ? { ...row, place: 2, score: 100 } : row);
    state = week(state, 15, changed);
    assert.equal(state.owners.switzerland, 'gaul', 'Last place in the playoffs does not abandon land.');
    assert.deepEqual(state.pendingClaims, before.pendingClaims);
    assert.equal(Conquest.previewAttack(state, { factionId: 'rome', territoryId: 'switzerland' }).defenderScore, 10);
    state = week(state, 16);
    const balance = copy(state.campaignActions);
    state = week(state, 17);
    assert.deepEqual(state.campaignActions, balance);
    assert.ok(!state.events.some(event => event.type === 'actions' && event.week === 17));
    assert.throws(() => attack(state), { code: 'CAMPAIGN_COMPLETE' });
    assert.throws(() => week(state, 18), { code: 'INVALID_WEEK' });
});

test('original saves keep their original map and do not acquire warfare rules', () => {
    const state = Conquest.createConquest({ season: 1 });
    assert.equal(state.version, 1);
    assert.equal(state.worldId, undefined);
    assert.equal(state.campaignActions, undefined);
    assert.deepEqual(Conquest.attackableTerritories(state, 'rome'), []);
    assert.deepEqual(Conquest.fortifiableTerritories(state, 'rome'), []);
    assert.equal(Conquest.landTotals(state, 'rome').worldTerritoryCount, 47);
    assert.equal(Conquest.landTotals(state, 'rome').areaKm2, null);
    assert.throws(() => Conquest.attackTerritory(state, { factionId: 'rome', territoryId: 'gaul', createdAt }), { code: 'COMBAT_UNAVAILABLE' });
});
