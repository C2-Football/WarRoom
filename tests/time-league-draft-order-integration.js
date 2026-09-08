'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
global.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai', 'actions', 'draft-clock', 'public-state']) {
    require(`../js/shared/time-league-${name}.js`);
}
const { TimeLeagueEngine: E, TimeLeagueActions: A, TimeLeagueDraftClock: Clock, TimeLeaguePublicState: Public } = App;
const stamp = ms => new Date(Date.UTC(2026, 8, 8, 12) + ms).toISOString();
const order = ['t3', 't2', 't1'];
const host = { seat_team_id: 't1', role: 'commissioner' };
const cards = new Map(Array.from({ length: 18 }, (_, i) => ({ identity: `RB${i}`, name: `Runner ${i}`, position: 'RB', peak: 200 - i,
    seasons: [1981, 1982].map(season => ({ season, games: 14, points: 200 - i, rushYd: 1000, rushTd: 10 })) })).map(card => [card.identity, card]));
function create(patch = {}, seed = 'order-integration') {
    return E.createTimeLeague({ name: 'Order integration', seed, createdAt: stamp(0),
        seats: [{ name: 'My Club', manager: 'human' }, { name: 'Middle Club', manager: 'ai' }, { name: 'First Club', manager: 'ai' }],
        settings: { rosterSlots: { RB: 1, BN: 1 }, maxQuarterbacks: 2, regularSeasonWeeks: 12,
            scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 },
            eraRules: { mode: 'any-era', decades: [] }, draftFormat: 'snake', draftPickSeconds: 60, draftAiSeconds: 2,
            draftOrderMode: 'manual', draftTeamOrder: order, ...patch } });
}
const run = (state, action, ms, member = host) => A.applyOnlineAction(state, action, member, { cards }, stamp(ms));
const restore = state => E.normalizeTimeLeague(JSON.parse(JSON.stringify(state)));
let count = 0;
const test = (name, fn) => { fn(); count++; console.log(`ok ${name}`); };
let completed;

test('a human drafting third can watch the AI open, pick the snake turn, and finish the room', () => {
    let state = create();
    assert.deepEqual(state.teams.map(team => team.teamId), ['t1', 't2', 't3'], 'Seat ownership stays stable');
    assert.deepEqual(E.draftTeamOrder(state), order);
    const schedule = JSON.stringify(state.schedule);
    state = run(state, { type: 'draft-clock-start' }, 0);
    assert.equal(Clock.nextAction(state, cards, Date.parse(stamp(1999))), null);
    assert.deepEqual(Clock.nextAction(state, cards, Date.parse(stamp(2000))), { type: 'draft-ai-step' });
    assert.throws(() => run(state, { type: 'draft', identity: 'RB0' }, 1000), /turn/, 'Creating the league does not grant pick one');
    let time = 0;
    while (state.phase === 'draft') {
        time += 2000;
        const seat = E.currentDraftSeat(state);
        if (seat.teamId === 't1') {
            const card = E.eraEligibleCards(state, cards).find(candidate => E.auctionCanBid(state, 't1', candidate));
            state = run(state, { type: 'draft', identity: card.identity }, time);
        } else {
            const next = Clock.nextAction(state, cards, Date.parse(stamp(time)));
            assert.deepEqual(next, { type: 'draft-ai-step' });
            state = run(state, next, time);
        }
        state = restore(state);
        assert.deepEqual(E.draftTeamOrder(state), order, 'Saving each turn preserves the assigned order');
    }
    assert.deepEqual(state.draftPicks.map(pick => pick.teamId), ['t3', 't2', 't1', 't1', 't2', 't3']);
    assert(state.teams.every(team => team.roster.length === 2));
    assert.equal(JSON.stringify(state.schedule), schedule, 'Draft order does not reorder league membership or matchups');
    completed = state;
});

test('manual linear drafts repeat the chosen order while existing saves retain their original order', () => {
    assert.deepEqual(create({ draftFormat: 'linear' }).draftOrder.map(seat => seat.teamId), [...order, ...order]);
    const legacy = create();
    delete legacy.settings.draftOrderMode;
    delete legacy.settings.draftTeamOrder;
    assert.deepEqual(E.draftTeamOrder(restore(legacy)), order);
    assert.deepEqual(restore(legacy).draftOrder, legacy.draftOrder, 'Migration reads the saved schedule and never rerolls it');
});

test('random order puts the creator in different slots and survives repeated loads', () => {
    const creatorSlots = new Set();
    for (let i = 0; i < 36; i++) {
        let state = create({ draftOrderMode: 'random', draftTeamOrder: undefined }, `random-order-${i}`);
        const savedOrder = E.draftTeamOrder(state);
        assert.deepEqual([...savedOrder].sort(), ['t1', 't2', 't3']);
        creatorSlots.add(savedOrder.indexOf('t1'));
        for (let read = 0; read < 3; read++) {
            state = restore(state);
            assert.deepEqual(E.draftTeamOrder(state), savedOrder);
        }
    }
    assert.deepEqual([...creatorSlots].sort(), [0, 1, 2]);
});

test('draft order changes require the commissioner and lock when the clock starts', () => {
    let state = create();
    const action = { type: 'draft-order-settings', draftOrderMode: 'manual', draftTeamOrder: ['t2', 't1', 't3'] };
    assert.throws(() => run(state, action, 0, { seat_team_id: 't1', role: 'member' }), /commissioner/);
    state = run(state, action, 0);
    assert.deepEqual(E.draftTeamOrder(state), action.draftTeamOrder);
    for (const invalid of [['t1', 't1', 't3'], ['t1', 't2'], ['t1', 't2', 'intruder']]) {
        assert.throws(() => run(state, { ...action, draftTeamOrder: invalid }, 0), /every team/);
    }
    state = run(state, { type: 'draft-clock-start' }, 0);
    assert.throws(() => run(state, action, 1), /locked/);
    state = run(state, { type: 'draft-clock-pause' }, 1000);
    assert.throws(() => run(state, action, 1000), /locked/, 'Pausing cannot reopen the order lottery');
});

test('changing draft pace before start leaves order editable and never starts its deadline', () => {
    let state = run(create(), { type: 'draft-clock-settings', draftPickSeconds: 120, draftAiSeconds: 4 }, 5000);
    assert.equal(state.draftClock.status, 'waiting');
    assert.equal(state.draftClock.startedAt, null);
    assert.equal(state.draftClock.deadlineAt, null);
    assert.equal(state.draftClock.remainingMs, 120000);
    const action = { type: 'draft-order-settings', draftOrderMode: 'manual', draftTeamOrder: ['t2', 't1', 't3'] };
    state = run(restore(state), action, 10000);
    assert.deepEqual(E.draftTeamOrder(state), action.draftTeamOrder);
    // Older builds stamped the settings edit as startedAt, while the clock
    // correctly remained waiting. Reconnecting must not treat that as a start.
    state = restore({ ...state, draftClock: { ...state.draftClock, startedAt: stamp(5000) } });
    assert(E.canConfigureDraftOrder(state));
    state = run(state, { ...action, draftTeamOrder: order }, 15000);
    state = run(state, { type: 'draft-clock-start' }, 20000);
    assert.equal(state.draftClock.deadlineAt, stamp(140000));
    assert.throws(() => run(state, action, 21000), /locked/);
    state = run(state, { type: 'draft-clock-pause' }, 25000);
    assert.throws(() => run(state, action, 26000), /locked/);
});

test('random draft order does not shift the independent position roulette assignment', () => {
    const patch = { eraRules: { mode: 'position-roulette', decades: [] } };
    const manual = create(patch);
    const random = create({ ...patch, draftOrderMode: 'random', draftTeamOrder: undefined });
    assert.deepEqual(random.settings.eraRules, manual.settings.eraRules);
    const reshuffled = run(random, { type: 'draft-order-settings', draftOrderMode: 'random' }, 10000);
    assert.deepEqual(reshuffled.settings.eraRules, manual.settings.eraRules);
});

test('auction nomination rotation follows the order, independent of the winning team', () => {
    let state = E.startDraft(create({ draftFormat: 'auction', draftPickSeconds: 15 }), stamp(0));
    let time = 0;
    const nominateAndAward = (nomination, winner, identity) => {
        assert.equal(E.currentDraftSeat(state).teamId, nomination);
        state = E.nominateAuctionPlayer(state, nomination, cards.get(identity), 1, stamp(time));
        assert.equal(state.draftAuction.nomination.nominatedBy, nomination);
        if (winner !== nomination) state = E.bidAuctionPlayer(state, winner, 2, stamp(time), cards);
        time += 15000;
        state = restore(E.expireDraftClock(state, cards, stamp(time)));
        assert.equal(state.draftPicks.at(-1).teamId, winner);
        assert.deepEqual(E.draftTeamOrder(state), order);
    };
    nominateAndAward('t3', 't1', 'RB0');
    nominateAndAward('t2', 't2', 'RB1');
    nominateAndAward('t1', 't1', 'RB2');
    nominateAndAward('t3', 't3', 'RB3');
    nominateAndAward('t2', 't2', 'RB4');
    assert.equal(E.currentDraftSeat(state).teamId, 't3', 'Filled teams are skipped without shifting the rotation');
    nominateAndAward('t3', 't3', 'RB5');
    assert.equal(state.phase, 'season');
    assert(state.teams.every(team => team.roster.length === 2));
});

test('sealed server snapshots disclose only the saved order, retaining it after reconnect', () => {
    let state = E.startDraft(create(), stamp(0));
    state = run(state, { type: 'draft-ai-step' }, 2000);
    const projected = Public.projectPublicState(state, 't1', [], cards, stamp(2000));
    const publicState = E.normalizePublicTimeLeague(JSON.parse(JSON.stringify(projected)));
    assert(publicState);
    assert.deepEqual(E.draftTeamOrder(publicState), order);
    assert.equal(E.currentDraftSeat(publicState).teamId, 't2');
    assert(!Object.hasOwn(publicState, 'seed'));
    assert(publicState.teams.every(team => team.roster.every(entry => !Object.hasOwn(entry, 'drawnSeason'))));
    assert.deepEqual(publicState.settings.draftTeamOrder, order);
});

// Render the actual Vault panel with the shared grid boundary intact. This
// catches a board that still puts the human in column one after order changes.
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useRef: value => ({ current: value }), useMemo: fn => fn(), useEffect: () => {}, Fragment: 'fragment',
};
global.localStorage = { getItem: () => null, setItem: () => {} };
require('../js/components/time-league-draft-panel.js');
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(walk)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(text).join(' ');
const SharedGrid = () => {};

test('shared and fallback recap grids use the selected columns and highlight the actual owner', () => {
    for (const format of ['snake', 'linear', 'auction']) {
        const league = { ...completed, settings: { ...completed.settings, draftFormat: format } };
        window.DraftCC = { DraftGridPanel: SharedGrid };
        let tree = WrTimeLeagueDraftPanel({ league, cards, onUpdate() {}, onlineMeta: { seatTeamId: 't1', role: 'commissioner' } });
        const shared = walk(tree).find(node => node.type === SharedGrid);
        assert(shared, `${format} renders the shared grid`);
        assert.equal(shared.props.state.userSlot, 3);
        for (const slot of shared.props.state.pickOrder) assert.equal(order[slot.teamIdx], slot.teamId);
        for (const pick of shared.props.state.picks) assert.equal(order[pick.teamIdx], pick.teamId);
        delete window.DraftCC;
        tree = WrTimeLeagueDraftPanel({ league, cards, onUpdate() {} });
        const fallback = walk(tree).find(node => node.props.className === 'tl-tbl tl-draft-fallback-grid');
        assert(fallback);
        const header = walk(fallback).find(node => node.type === 'thead');
        assert.deepEqual(walk(header).filter(node => node.type === 'th').slice(1).map(text), ['First Club', 'Middle Club', 'My Club']);
    }
});
console.log(`PASS: ${count} draft order integration scenarios`);
