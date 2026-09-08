const assert = require('node:assert/strict');
const test = require('node:test');
const F = require('../js/duat/favors.js');
const Rules = require('../js/duat/rules.js');

const players = () => [
    { id: 'qb', starter: true, basePoints: 12.34, effectivePoints: 12.34, hasRecordedGame: true, stats: { pass_yd: 200 } },
    { id: 'rb', starter: true, basePoints: 8, effectivePoints: 8, hasRecordedGame: true },
    { id: 'wr', starter: true, basePoints: 22, effectivePoints: 22, hasRecordedGame: true },
    { id: 'te', starter: true, basePoints: 0, effectivePoints: 0, hasRecordedGame: true },
    { id: 'flex', starter: true, basePoints: -2, effectivePoints: -2, hasRecordedGame: true },
    { id: 'bench', starter: false, basePoints: 50, effectivePoints: 50, hasRecordedGame: true }
];
const history = [
    { week: 2, players: [{ id: 'qb', basePoints: 9, effectivePoints: 31.5, hasRecordedGame: true }] },
    { week: 4, players: [{ id: 'qb', basePoints: 27.48, effectivePoints: 54.96, hasRecordedGame: true }] }
];
function invoke(favorId, playerId = 'qb', extra = {}) {
    return F.applyFavor({ week: 5, balance: 100, playerResults: players(), history, declaration: { favorId, playerId }, ...extra });
}
function declare(extra = {}) {
    return F.validateDeclaration({ week: 5, balance: 100, players: players(), history, favorId: 'kratos-1', playerId: 'qb', ...extra });
}

test('supported historical favors preserve catalog IDs, numeric prices and sacred windows', () => {
    assert.equal(F.STARTING_FAVOR_BALANCE, 100);
    assert.deepEqual(F.SACRED_WEEKS, [5, 7, 10, 14, 15, 16, 17]);
    assert.equal(F.SUPPORTED_IDS.length, 7);
    F.FAVORS.forEach(favor => assert.equal(favor.cost, Rules.FAVORS.find(item => item.id === favor.id).cost));
    assert.deepEqual(F.listAvailable({ week: 4, balance: 100 }), []);
    assert.equal(F.listAvailable({ week: 5, balance: 10 }).length, 2);
    assert.equal(F.listAvailable({ week: 17, balance: 30 }).length, 7);
    assert.deepEqual(F.listAvailable({ week: 5, balance: 9 }), []);
    assert.equal(F.SUPPORTED_IDS.includes('ebisu'), false);
    assert.equal(F.SUPPORTED_IDS.includes('nyx'), false);
    assert.throws(() => F.listAvailable({ week: 5, balance: NaN }), /balance/);
});

test('Kratos I, II and III apply their real multipliers and leave base scores for Heptad', () => {
    for (const [favorId, expected, cost] of [['kratos-1', 24.68, 10], ['kratos-2', 30.85, 20], ['kratos-3', 43.19, 30]]) {
        const result = invoke(favorId);
        assert.equal(result.players[0].effectivePoints, expected);
        assert.equal(result.players[0].basePoints, 12.34);
        assert.equal(result.total, Math.round((expected + 28) * 100) / 100);
        assert.equal(result.cost, cost);
        assert.equal(result.event.status, 'applied');
        assert.equal(result.players.at(-1).effectivePoints, 50);
    }
    assert.equal(invoke('kratos-1', 'flex').players[4].effectivePoints, -4);
});

test('Horus floors honor legitimate zero or negative games and do not reduce higher scores', () => {
    assert.equal(invoke('horus-1').players[0].effectivePoints, 15);
    assert.equal(invoke('horus-2', 'rb').players[1].effectivePoints, 20);
    assert.equal(invoke('horus-2', 'wr').players[2].effectivePoints, 22);
    assert.equal(invoke('horus-1', 'te').players[3].effectivePoints, 15);
    assert.equal(invoke('horus-2', 'flex').players[4].effectivePoints, 20);
});

test('Horus cannot invent scores for a missing game and unavailable resolution spends nothing', () => {
    const absent = players().map(player => player.id === 'qb' ? { ...player, basePoints: 0, effectivePoints: 0, hasRecordedGame: false } : player);
    assert.throws(() => declare({ favorId: 'horus-1', players: absent }), /without a recorded game/);
    const result = invoke('horus-1', 'qb', { playerResults: absent });
    assert.equal(result.cost, 0);
    assert.equal(result.total, 28);
    assert.equal(result.event.status, 'unavailable');
    assert.deepEqual(result.players, absent);
    const unknown = players().map(player => { const copy = { ...player }; delete copy.hasRecordedGame; return copy; });
    assert.equal(declare({ favorId: 'horus-1', players: unknown }).cost, 10);
    assert.equal(invoke('horus-1', 'qb', { playerResults: unknown }).cost, 0);
});

test('Janus II recalls only immediately previous finalized base points, without importing old favors', () => {
    const normalized = declare({ favorId: 'janus-2' });
    assert.equal(normalized.sourceWeek, 4);
    const result = invoke('janus-2');
    assert.equal(result.players[0].effectivePoints, 27.48);
    assert.equal(result.players[0].basePoints, 12.34);
    assert.equal(result.total, 55.48);
    assert.equal(result.event.sourceWeek, 4);
    assert.equal(result.cost, 20);
    assert.throws(() => declare({ favorId: 'janus-2', sourceWeek: 2 }), /immediately previous/);
});

test('Janus III imports any selected earlier recorded week and rejects current or future data', () => {
    const result = invoke('janus-3', 'qb', { declaration: { favorId: 'janus-3', playerId: 'qb', sourceWeek: 2 } });
    assert.equal(result.players[0].effectivePoints, 9);
    assert.equal(result.cost, 30);
    for (const sourceWeek of [0, 5, 6, 3.5, undefined]) assert.throws(() => declare({ favorId: 'janus-3', sourceWeek }), /previous week/);
    assert.throws(() => declare({ favorId: 'janus-3', sourceWeek: 3 }), /finalized record/);
    assert.throws(() => declare({ favorId: 'janus-2', history: [{ ...history[1], finalized: false }] }), /finalized previous/);
    assert.throws(() => declare({ favorId: 'janus-2', history: [{ week: 4, players: [{ id: 'qb', basePoints: 0, hasRecordedGame: false }] }] }), /recorded base score/);
    assert.throws(() => declare({ favorId: 'janus-2', history: [history[1], history[1]] }), /one finalized record/);
});

test('invalid declarations reject unsupported favors, inadequate funds, wrong weeks and wrong targets', () => {
    assert.throws(() => declare({ week: 6 }), /sacred weeks/);
    assert.throws(() => declare({ favorId: 'ebisu' }), /not supported/);
    assert.throws(() => declare({ balance: 9 }), /requires 10/);
    assert.throws(() => declare({ balance: -1 }), /balance/);
    assert.throws(() => declare({ playerId: 'missing' }), /starting five/);
    assert.throws(() => declare({ playerId: 'bench' }), /starting five/);
    assert.throws(() => declare({ players: [...players(), players()[0]] }), /unique player/);
    assert.throws(() => declare({ declaration: { favorId: 'kratos-1', playerId: 'qb', week: 7 } }), /different week/);
    const normalized = declare({ declaration: { favorId: 'kratos-3', playerId: 'qb', cost: -100 } });
    assert.equal(normalized.cost, 30);
    const rejected = invoke('kratos-3', 'qb', { balance: 20 });
    assert.equal(rejected.cost, 0);
    assert.equal(rejected.total, 40.34);
    assert.equal(rejected.event.status, 'unavailable');
});

test('favor resolution is deterministic, never mutates input and does not count bench points', () => {
    const input = { week: 5, balance: 100, declaration: { favorId: 'janus-2', playerId: 'qb' }, playerResults: players(), history };
    const before = JSON.stringify(input);
    const first = F.applyFavor(input);
    assert.deepEqual(F.applyFavor(input), first);
    assert.equal(JSON.stringify(input), before);
    assert.notEqual(first.players, input.playerResults);
    assert.notEqual(first.players[0], input.playerResults[0]);
    const ordinary = F.applyFavor({ playerResults: players() });
    assert.equal(ordinary.total, 40.34);
    assert.equal(ordinary.cost, 0);
    assert.equal(ordinary.event, null);
    assert.throws(() => F.applyFavor({ playerResults: [{ id: 'qb', starter: true, basePoints: NaN }] }), /finite/);
});
