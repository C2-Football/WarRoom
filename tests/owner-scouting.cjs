'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { read, infer, types } = require('../js/shared/owner-scouting.js');

const roster = { roster_id: 1, owner_id: 'owner-1' };
const league = { league_id: 'current', rosters: [roster, { roster_id: 2, owner_id: 'owner-2' }] };
const trade = (extra = {}) => ({ roster_ids: [1, 2], sides: { 1: { players: [], picks: [], totalValue: 100 }, 2: { players: [], picks: [], totalValue: 100 } }, ...extra });
const intel = (profile = {}, extra = {}) => ({ tradeHistory: [trade(), trade()], ownerProfiles: { 1: profile }, ...extra });

test('saved owner DNA wins over a different derived read, including explicit NONE', () => {
    const evidence = intel({ tradesWon: 2, avgValueDiff: 600 });
    assert.equal(infer({ rosterId: 1, intel: evidence }).key, 'FLEECER');
    const saved = read({ roster, league, intel: evidence, savedDna: 'ACCEPTOR', intelligence: {} });
    assert.equal(saved.key, 'ACCEPTOR');
    assert.equal(saved.source, 'saved');
    assert.equal(saved.label, types.ACCEPTOR.label);
    assert.equal(saved.confidence, null);
    const none = read({ roster, league, intel: evidence, savedDna: 'NONE', intelligence: {} });
    assert.equal(none.key, 'NONE');
    assert.equal(none.source, 'saved');
    assert.match(none.reasoning, /intentionally unset/);
    const invalid = read({ roster, league, intel: evidence, savedDna: 'INVALID', intelligence: {} });
    assert.equal(invalid.source, 'derived');
    assert.equal(invalid.key, 'FLEECER');
});

test('saved object retains its explicit confidence and reasoning', () => {
    const result = read({ roster, league, savedDna: { key: 'STALWART', confidence: 0, reasoning: 'My own scouting note.' }, intelligence: {} });
    assert.equal(result.key, 'STALWART');
    assert.equal(result.confidence, 0);
    assert.equal(result.reasoning, 'My own scouting note.');
    assert.match(result.approach, /not enough evidence/);
});

test('zero or one completed trade never becomes an inferred personality', () => {
    for (const history of [[], [trade()]]) {
        const result = read({ roster, league, intel: { tradeHistory: history, ownerProfiles: { 1: { trades: 99, avgValueDiff: 9000, tradesWon: 99 } } }, intelligence: {
            buildLeagueBehaviorBaselines() { throw new Error('Thin history must not build personality evidence'); },
            buildOwnerBehaviorProfile() { throw new Error('Thin history must not build personality evidence'); },
        } });
        assert.equal(result.key, 'NONE');
        assert.equal(result.source, 'none');
        assert.equal(result.tradeCount, history.length);
        assert.match(result.reasoning, history.length ? /Only 1 completed trade/ : /No completed trades/);
        assert.match(result.approach, /not enough evidence/);
    }
});

test('pending, failed, rejected and non-trade records do not count as completed history', () => {
    const evidence = intel({}, { tradeHistory: [
        trade({ status: 'pending' }), trade({ status: 'failed' }), trade({ status: 'rejected' }),
        trade({ type: 'waiver' }), trade({ completed: false }), trade({ is_completed: false }),
        trade({ status: 'complete' }),
    ] });
    assert.equal(infer({ rosterId: 1, intel: evidence }), null);
    assert.equal(read({ roster, league, intel: evidence, intelligence: {} }).tradeCount, 1);
});

test('normalized numeric and string IDs produce identical weighted scores', () => {
    const evidence = intel({ tradesWon: 2, avgValueDiff: 500 });
    const numeric = infer({ rosterId: 1, intel: evidence });
    const string = infer({ rosterId: '1', intel: { ...evidence, tradeHistory: evidence.tradeHistory.map(t => ({ ...t, roster_ids: ['1', '2'] })) } });
    assert.deepEqual(string, numeric);
    assert.equal(numeric.key, 'FLEECER');
    assert.equal(numeric.confidence, 92);
    assert.match(numeric.reasoning, /Wins 100%.*Avg \+500/);
    assert.equal(read({ roster: { ...roster, roster_id: '1' }, league, intel: evidence, intelligence: {} }).tradeCount, 2);
});

test('normalized other-side IDs preserve pick-flow inference', () => {
    const evidence = intel({}, { rosters: [roster], tradeHistory: [trade({ roster_ids: ['1', 2], sides: { 1: { picks: [] }, 2: { picks: ['pick1', 'pick2'] } } }), trade({ roster_ids: [1, '2'], sides: { 1: { picks: [] }, 2: { picks: [] } } })] });
    const result = infer({ rosterId: 1, intel: evidence });
    assert.equal(result.key, 'DOMINATOR');
    assert.match(result.reasoning, /Trades picks for players/);
});

test('negative and genuine zero grades retain their weighted meaning; missing grades do not become zero', () => {
    const losing = infer({ rosterId: 1, intel: intel({ tradesLost: 2, avgValueDiff: -500 }) });
    assert.equal(losing.key, 'DESPERATE');
    assert.equal(losing.confidence, 43);
    assert.match(losing.reasoning, /Avg -500 DHQ/);
    const balanced = infer({ rosterId: 1, intel: intel({ tradesFair: 2, avgValueDiff: 0 }) });
    assert.equal(balanced.key, 'STALWART');
    assert.equal(balanced.confidence, 44);
    assert.match(balanced.reasoning, /Balanced trade value/);
    const ungraded = infer({ rosterId: 1, intel: intel({}) });
    assert.doesNotMatch(ungraded.reasoning, /Balanced trade value/);
});

test('negative and zero side values are not discarded from late-season trade evidence', () => {
    for (const [myValue, theirValue] of [[-100, -50], [0, 100]]) {
        const evidence = intel({}, { rosters: [roster], tradeHistory: [trade({ week: 10, sides: { 1: { totalValue: myValue }, 2: { totalValue: theirValue } } }), trade({ week: 11, sides: { 1: { totalValue: myValue }, 2: { totalValue: theirValue } } })] });
        const result = infer({ rosterId: 1, intel: evidence });
        assert.equal(result.key, 'DESPERATE');
        assert.match(result.reasoning, /2 late-season panic trades/);
    }
    assert.equal(infer({ rosterId: 1, intel: intel({}, { rosters: [roster], tradeHistory: [trade({ week: 10, sides: { 1: {}, 2: { totalValue: 100 } } }), trade({ week: 11, sides: { 1: {}, 2: { totalValue: 100 } } })] }) }), null);
});

test('behavior builders receive only explicit current inputs and never stale cached owner profiles', () => {
    const previousLI = global.App.LI;
    global.App.LI = { ownerBehaviorProfiles: { 1: { observedFacts: [{ detail: 'STALE FACT' }], strategy: { offerFrame: 'STALE APPROACH' } } }, ownerProfiles: { 1: { trades: 900 } }, tradeHistory: [trade()] };
    try {
        const calls = [];
        const evidence = intel({ trades: 900, tradesFair: 2, avgValueDiff: 0 }, { ownerBehaviorProfiles: global.App.LI.ownerBehaviorProfiles });
        const before = JSON.stringify(evidence);
        const assessment = { rosterId: 1, ownerId: 'owner-1', ownerName: 'Current owner' };
        const fact = { code: 'trade_value', label: 'Value', detail: 'Explicit zero result.', value: 0, source: 'ownerProfiles' };
        const intelligence = {
            buildLeagueBehaviorBaselines(input) { calls.push(input); return { trade: { avgTradesPerOwner: 2 } }; },
            buildOwnerBehaviorProfile(input) { calls.push(input); return { observedFacts: [fact], strategy: { offerFrame: 'CURRENT APPROACH' } }; },
        };
        const result = read({ roster, assessment, league, ownerName: 'Explicit owner', intel: evidence, intelligence });
        assert.equal(calls.length, 2);
        assert.equal(calls[0].league, league);
        assert.equal(calls[0].rosters, league.rosters);
        assert.equal(calls[0].tradeHistory.length, 2);
        assert.equal(calls[0].ownerProfiles[1].trades, 2);
        assert.deepEqual(calls[0].draftOutcomes, []);
        assert.deepEqual(calls[0].faabTxns, []);
        assert.equal(calls[1].assessment, assessment);
        assert.equal(calls[1].ownerName, 'Explicit owner');
        assert.equal(calls[1].ownerProfile.avgValueDiff, 0);
        assert.equal(calls[1].manualDna, false);
        assert.deepEqual(result.facts, [fact]);
        assert.equal(result.approach, 'CURRENT APPROACH');
        assert.equal(JSON.stringify(evidence), before, 'Caller evidence is not mutated');
    } finally { global.App.LI = previousLI; }
});

test('unavailable grade does not surface a fabricated zero-value observed fact', () => {
    const intelligence = {
        buildLeagueBehaviorBaselines() { return {}; },
        buildOwnerBehaviorProfile() { return { observedFacts: [{ code: 'trade_value', detail: 'Average +0 DHQ.' }, { code: 'trade_volume', detail: '2 completed trades.' }], strategy: {} }; },
    };
    const result = read({ roster, league, intel: intel({}), intelligence });
    assert.deepEqual(result.facts.map(f => f.code), ['trade_volume']);
    assert.equal(result.approach, types[result.key].strategy);
});
