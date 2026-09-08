const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../js/duat/rules.js');
const Conquest = require('../js/duat/conquest.js');
const createdAt = '2026-09-08T16:00:00.000Z';
const fresh = () => Conquest.createConquest({ season: 1 });
const record = (state, factionId, week, place, score = 100) => {
    const places = Array.from({ length: state.factionIds.length }, (_, index) => index + 1).filter(rank => rank !== place);
    const results = state.factionIds.map(id => id === factionId ? { factionId, place, score }
        : { factionId: id, place: places.shift(), score: 90 });
    if (!state.factionIds.includes(factionId)) results[0].factionId = factionId;
    return Conquest.recordWeek(state, { week, results, createdAt });
};
const claim = (state, factionId, territoryId) => Conquest.claimTerritory(state, { factionId, territoryId, createdAt });

test('a new campaign has fourteen equal homelands and no legacy records', () => {
    const state = fresh();
    assert.equal(state.factionIds.length, 14);
    assert.equal(Object.keys(state.owners).length, 14);
    assert.equal(state.events.length, 0);
    for (const id of state.factionIds) {
        assert.equal(state.owners[state.homes[id]], id);
        assert.deepEqual(state.claimOrder[id], [state.homes[id]]);
        assert.equal(state.pendingClaims[id], 0);
    }
});

test('weekly ranks award two claims to first, one to the top half and none below', () => {
    const state = fresh();
    const factionId = state.factionIds.find(id => Conquest.eligibleTerritories(state, id).length >= 2);
    assert.ok(factionId);
    for (const [place, claims] of [[1, 2], [2, 1], [7, 1], [8, 0], [13, 0], [14, 0]]) {
        const next = record(state, factionId, 1, place);
        assert.equal(next.pendingClaims[factionId], claims);
        assert.equal(state.events.length, 0, 'input remains unchanged');
    }
});

test('claims require earned currency and connected unoccupied territory', () => {
    const state = fresh();
    const factionId = state.factionIds.find(id => Conquest.eligibleTerritories(state, id).length);
    const target = Conquest.eligibleTerritories(state, factionId)[0];
    assert.throws(() => claim(state, factionId, target), { code: 'NO_CLAIMS' });
    const awarded = record(state, factionId, 1, 1);
    const next = claim(awarded, factionId, target);
    assert.equal(next.owners[target], factionId);
    assert.equal(next.pendingClaims[factionId], 1);
    assert.equal(awarded.owners[target], undefined);
    assert.throws(() => claim(next, factionId, target), { code: 'NOT_CONNECTED' });
    assert.throws(() => claim(next, factionId, 'invented-territory'), { code: 'NOT_CONNECTED' });
    const rival = state.factionIds.find(id => id !== factionId);
    assert.throws(() => claim(next, factionId, state.homes[rival]), { code: 'NOT_CONNECTED' });
});

test('last place releases the newest conquest and protects every homeland', () => {
    const initial = fresh();
    const factionId = initial.factionIds.find(id => Conquest.eligibleTerritories(initial, id).length);
    let state = record(initial, factionId, 1, 1);
    const target = Conquest.eligibleTerritories(state, factionId)[0];
    state = claim(state, factionId, target);
    state = record(state, factionId, 2, 14);
    assert.equal(state.owners[target], undefined);
    assert.equal(state.owners[state.homes[factionId]], factionId);
    state = record(state, factionId, 3, 14);
    assert.equal(state.events.find(event => event.factionId === factionId && event.week === 3).outcome, 'homeland-held');
});

test('replayed results do not award twice and mismatched replays are rejected', () => {
    const initial = fresh(), factionId = initial.factionIds[0];
    const state = record(initial, factionId, 1, 1, 121);
    assert.equal(record(state, factionId, 1, 1, 121), state);
    assert.throws(() => record(state, factionId, 1, 2, 121), { code: 'RESULT_CONFLICT' });
    assert.throws(() => record(state, factionId, 3, 1), { code: 'WEEK_ORDER' });
    assert.throws(() => record(state, factionId, 15, 1), { code: 'INVALID_WEEK' });
});

test('a smaller custom campaign can lose a conquered homeland of an absent faction', () => {
    let state = Conquest.createConquest({ season: 1, factionIds: ['rome', 'egypt'] });
    state = record(state, 'rome', 1, 1);
    state = claim(state, 'rome', 'aegean');
    state = record(state, 'rome', 2, 2);
    assert.equal(state.owners.aegean, undefined);
    assert.equal(state.owners.latium, 'rome');
});

test('unknown factions, unavailable scores and impossible places cannot alter conquest', () => {
    const state = fresh(), factionId = state.factionIds[0];
    assert.throws(() => record(state, 'outsider', 1, 1), { code: 'INCOMPLETE_WEEK' });
    assert.throws(() => record(state, factionId, 1, 15), { code: 'INVALID_RESULT' });
    assert.throws(() => record(state, factionId, 1, 1, NaN), { code: 'INVALID_RESULT' });
    assert.throws(() => Conquest.createConquest({ season: 1, factionIds: [factionId, factionId] }), { code: 'INVALID_FACTIONS' });
    assert.equal(state.events.length, 0);
});

test('a closed frontier never promises unusable new claims', () => {
    const state = fresh(), factionId = state.factionIds[0], rival = state.factionIds[1];
    state.owners = Object.fromEntries(Rules.TERRITORIES.map(territory => [territory.id, state.owners[territory.id] || rival]));
    const next = record(state, factionId, 1, 1);
    assert.equal(next.pendingClaims[factionId], 0);
    assert.equal(next.events.find(event => event.factionId === factionId).outcome, 'realm-complete');
});

test('fourteen factions can record a complete deterministic conquest season', () => {
    const run = () => {
        let state = fresh();
        for (let week = 1; week <= 14; week += 1) {
            state = Conquest.recordWeek(state, { week, createdAt, results: state.factionIds.map((factionId, index) =>
                ({ factionId, place: ((index + week) % 14) + 1, score: 120 - index })) });
            for (const factionId of state.factionIds) {
                while (state.pendingClaims[factionId] > 0) {
                    const target = Conquest.eligibleTerritories(state, factionId)[0];
                    if (!target) break;
                    state = claim(state, factionId, target);
                }
            }
        }
        return state;
    };
    const state = run();
    assert.deepEqual(run(), state);
    assert.equal(state.events.filter(event => event.type === 'result').length, 14 * 14);
    for (const factionId of state.factionIds) assert.equal(state.owners[state.homes[factionId]], factionId);
    assert.ok(Object.keys(state.owners).length <= Rules.TERRITORIES.length);
});

test('weekly losses open the frontier before rewards regardless of result delivery order', () => {
    let state = record(fresh(), 'vikings', 1, 1);
    state = claim(state, 'vikings', 'albion');
    const rivals = state.factionIds.filter(id => !['vikings', 'inis-fail'].includes(id));
    const results = [
        { factionId: 'inis-fail', place: 1, score: 150 },
        { factionId: 'vikings', place: 14, score: 50 },
        ...rivals.map((factionId, index) => ({ factionId, place: index + 2, score: 140 - index })),
    ];
    const next = Conquest.recordWeek(state, { week: 2, results, createdAt });
    assert.deepEqual(Conquest.recordWeek(state, { week: 2, results: [...results].reverse(), createdAt }), next);
    assert.equal(next.owners.albion, undefined);
    assert.equal(next.pendingClaims['inis-fail'], state.pendingClaims['inis-fail'] + 2);
    assert.throws(() => Conquest.recordWeek(state, { week: 2, results: results.slice(1), createdAt }), { code: 'INCOMPLETE_WEEK' });
});
