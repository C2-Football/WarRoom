'use strict';
// The browser receives the real server projection, never a manufactured local
// league with a placeholder seed or guessed player editions.
const assert = require('node:assert/strict');
global.window = globalThis;
global.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai', 'draft-clock', 'public-state']) {
    require(`../js/shared/time-league-${name}.js`);
}
const { TimeLeagueEngine: E, TimeLeagueAI: AI, TimeLeaguePublicState: Public, TimeLeagueDraftClock: Clock } = App;
const stamp = milliseconds => new Date(Date.UTC(2026, 8, 8, 12) + milliseconds).toISOString();
const cards = new Map(['QB', 'RB'].flatMap(position => Array.from({ length: 8 }, (_, i) => ({
    identity: `${position}${i}`, name: `${position} Archive ${i}`, position, peak: 9999,
    seasons: [1977, 1981, 1985, 1992, 1996].map((season, index) => ({ season, games: 14,
        points: index === 0 ? 9999 : 250 - i * 10 - index,
        passYd: 2000, passTd: 20, passInt: 5, rushYd: 500, rushTd: 4, rec: 20, recYd: 200, recTd: 2 })),
}))).map(card => [card.identity, card]));
function create(format) {
    return E.createTimeLeague({ name: `Public ${format}`, seed: `private-server-seed-${format}`, createdAt: stamp(0),
        seats: [{ name: 'Host', manager: 'human' }, { name: 'Friend', manager: 'human' }],
        settings: { draftFormat: format, rosterSlots: { QB: 1, RB: 1, BN: 1 }, maxQuarterbacks: 2,
            scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 },
            draftPickSeconds: 15, draftAiSeconds: 2, regularSeasonWeeks: 12,
            eraRules: { mode: 'position-roulette', decades: [], positionDecades: { QB: '1980s', RB: '1990s' } } } });
}
const projection = (state, seat = 't1') => {
    const readyAt = Math.max(Date.parse(state.draftClock?.startedAt) || 0, Date.parse(state.draftAuction?.lastAiAt) || 0) + (state.settings.draftAiSeconds ?? 2) * 1000;
    return Public.projectPublicState(state, seat, [], cards, new Date(readyAt).toISOString());
};
const decoded = (state, seat = 't1') => {
    const raw = projection(state, seat);
    const safe = E.normalizePublicTimeLeague(JSON.parse(JSON.stringify(raw)));
    assert(safe, 'A source-real public snapshot must survive the same normalizer used on reconnect');
    return safe;
};
function assertSealed(snapshot) {
    assert.equal(snapshot.publicSnapshotVersion, 1);
    assert(!Object.hasOwn(snapshot, 'seed'), 'Private randomness never reaches the browser');
    assert(!Object.hasOwn(snapshot, 'draftEraReveals'), 'Another seat’s reveal state stays private');
    assert(!JSON.stringify(snapshot).includes('private-server-seed'));
    for (const entry of snapshot.teams.flatMap(team => team.roster)) {
        assert(!Object.hasOwn(entry, 'drawnSeason'), 'A drafted edition is omitted rather than replaced by a fake year');
    }
}
function draftOne(state, time) {
    const card = AI.aiDraftChoice(state, cards);
    assert(card, 'Fixture has a legal pick');
    if (state.settings.draftFormat === 'auction') {
        const nominated = E.nominateAuctionPlayer(state, E.currentDraftSeat(state).teamId, card, 1, stamp(time));
        return E.expireDraftClock(nominated, cards, nominated.draftClock.deadlineAt);
    }
    return E.applyDraftPick(state, card, { madeBy: 'human', createdAt: stamp(time) });
}

let current;
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
const local = new Map();
window.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
global.React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => {
        const ctx = current, index = ctx.si++;
        if (!(index in ctx.states)) ctx.states[index] = typeof initial === 'function' ? initial() : initial;
        return [ctx.states[index], value => { ctx.states[index] = typeof value === 'function' ? value(ctx.states[index]) : value; }];
    },
    useRef: initial => { const ctx = current, index = ctx.ri++; return ctx.refs[index] ||= { current: initial }; },
    useMemo: fn => fn(),
    useEffect: (fn, deps) => {
        const ctx = current, index = ctx.ei++;
        if (!same(ctx.effects[index]?.deps, deps)) {
            const old = ctx.effects[index]; ctx.effects[index] = { deps };
            ctx.pending.push(() => { old?.cleanup?.(); ctx.effects[index].cleanup = fn(); });
        }
    },
};
require('../js/components/time-league-draft-panel.js');
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const words = node => node == null || node === false ? '' : Array.isArray(node) ? node.map(words).join(' ') : typeof node === 'object' ? words(node.children) : String(node);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || words(node).trim() === label));
const byClass = (tree, name) => walk(tree).filter(node => node.props.className?.split(' ').includes(name));
function mount(getProps) {
    const ctx = { states: [], refs: [], effects: [] };
    return () => {
        current = ctx; ctx.si = ctx.ri = ctx.ei = 0; ctx.pending = [];
        const tree = WrTimeLeagueDraftPanel(getProps()); ctx.pending.forEach(fn => fn()); return tree;
    };
}

(async () => {
    // A slow or failed response cannot open an archive, start the clock, or
    // duplicate a reveal. Even success waits for the authoritative row update.
    let waitingState = create('snake'), waitingView = decoded(waitingState), settle;
    let revealCalls = 0;
    const waitingReadiness = [];
    const waitingRender = mount(() => ({ league: waitingView, cards,
        onlineMeta: { seatTeamId: 't1', role: 'commissioner', draftStarted: true },
        onRevealReadyChange: value => waitingReadiness.push(value),
        onRevealEra: () => { revealCalls++; return new Promise(resolve => { settle = resolve; }); },
    }));
    let waitingTree = waitingRender();
    const pending = button(waitingTree, 'Reveal QB era').props.onClick();
    await button(waitingTree, 'Reveal QB era').props.onClick();
    waitingTree = waitingRender();
    assert.equal(revealCalls, 1, 'A repeated click while saving does not send another intent');
    assert(button(waitingTree, 'Reveal QB era').props.disabled && button(waitingTree, 'Reveal all').props.disabled);
    assert(words(waitingTree).includes('Opening archive') && !words(waitingTree).includes('1980s'));
    assert.equal(waitingReadiness.at(-1), false);
    settle(true); await pending; waitingTree = waitingRender();
    assert(!words(waitingTree).includes('1980s'), 'A successful response alone cannot guess an undisclosed assignment');
    waitingState = Public.revealPositions(waitingState, 't1', 'QB'); waitingView = decoded(waitingState);
    waitingTree = waitingRender();
    assert(words(waitingTree).includes('1980s'));
    const failed = button(waitingTree, 'Reveal RB era').props.onClick(); settle(false); await failed;
    waitingTree = waitingRender();
    assert(walk(waitingTree).some(node => node.props.role === 'alert'));
    assert(!button(waitingTree, 'Reveal RB era').props.disabled && !words(waitingTree).includes('1990s'), 'Failed reveals remain sealed and can be retried');
    assert.equal(Clock.nextAction(waitingView, cards, stamp(60000), false), null, 'A pending reveal never drives a timed pick');

    for (const format of ['snake', 'linear', 'auction']) {
        let state = create(format);
        state.teams[0].queue = ['QB1']; state.teams[1].queue = ['RB2'];
        const initialJson = JSON.stringify(state);
        let view = decoded(state);
        assertSealed(view);
        assert.deepEqual(view.settings.eraRules.positionDecades || {}, {}, 'Undisclosed assignments are absent from transport');
        assert.deepEqual(view.draftVisibility.allPositions, ['QB', 'RB']);
        assert.deepEqual(view.draftVisibility.revealedPositions, []);
        assert.deepEqual(view.teams[0].queue, ['QB1']);
        assert.deepEqual(view.teams[1].queue, [], 'Opponent queues do not reveal draft targets');
        assert.equal(JSON.stringify(state), initialJson, 'Projection and normalization leave private state unchanged');
        assert.equal(E.normalizeTimeLeague({ ...state, seed: undefined }), null, 'A malformed private save cannot masquerade as a public snapshot');
        assert.equal(E.normalizeTimeLeague(view), null, 'A network snapshot cannot be saved as authoritative offline state');

        // Stale local reveal flags cannot manufacture a server disclosure.
        local.set(`wr-tl-era-reveal:${state.leagueId}`, JSON.stringify(['QB', 'RB']));
        local.set(`wr-tl-era-entered:${state.leagueId}`, '1');
        const intents = [], readiness = [];
        const props = () => ({ league: view, cards, onlineMeta: { seatTeamId: 't1', role: 'commissioner', draftStarted: true },
            onRevealReadyChange: ready => readiness.push(ready),
            onDraftAction: async action => { intents.push(action); return true; },
            onRevealEra: async position => {
                intents.push({ type: 'reveal-era', position });
                state = Public.revealPositions(state, 't1', position); view = decoded(state);
                return view;
            },
            onUpdate: (_next, action) => { intents.push(action); return true; },
        });
        const render = mount(props);
        let tree = render();
        assert(button(tree, 'Reveal QB era') && button(tree, 'Reveal RB era'), 'A fully sealed snapshot still renders both reveal controls');
        assert(!words(tree).includes('1980s') && !words(tree).includes('1990s') && !words(tree).includes('Archive 0'));
        assert.equal(readiness.at(-1), false);
        await button(tree, 'Reveal QB era').props.onClick(); tree = render();
        assert.equal(intents.at(-1).type, 'reveal-era');
        assert.deepEqual(view.draftVisibility.revealedPositions, ['QB']);
        assert.deepEqual(projection(state, 't2').draftVisibility.revealedPositions, [], 'Revealing does not disclose the room to another seat');
        assert(words(tree).includes('1980s') && !words(tree).includes('1990s'));
        assert.equal(readiness.at(-1), false);
        assert.equal(byClass(tree, 'tl-era-headliner').length, 3);
        const scout = byClass(tree, 'tl-era-headliner')[0];
        scout.props.onClick({ currentTarget: { focus() {} } }); tree = render();
        const dialog = walk(tree).find(node => node.props.role === 'dialog');
        assert(dialog, 'A disclosed era opens its historical scout on mobile');
        const table = byClass(dialog, 'tl-scout-seasons')[0];
        assert(words(table).includes('1981') && words(table).includes('1985'), 'Eligible history remains useful without a selected edition');
        assert(!words(table).includes('1977') && !words(table).includes('1992') && !words(table).includes('9999'), 'Scouting excludes history outside the disclosed draw');
        assert(!JSON.stringify(dialog).includes('private-server-seed'));
        button(tree, '← Back to draft').props.onClick(); tree = render();
        await button(tree, 'Reveal all').props.onClick(); tree = render();
        if (button(tree, 'Enter draft →')) { button(tree, 'Enter draft →').props.onClick(); tree = render(); }
        assert.equal(readiness.at(-1), true);
        assert(words(tree).includes('Find your next legend'));

        state = E.startDraft(state, stamp(0));
        state = draftOne(state, 1);
        view = decoded(state);
        assertSealed(view);
        const poisoned = { ...state, seasonsRevealed: true, futureDraws: { QB0: 1981 },
            draftPicks: state.draftPicks.map(pick => ({ ...pick, drawnSeason: 1981 })),
            activity: [...state.activity, { id: 'private-server-seed', week: 1, kind: 'league', createdAt: stamp(0), message: 'Secret era assignments and player edition 1981' }] };
        const closed = projection(poisoned);
        assertSealed(closed);
        assert.equal(closed.seasonsRevealed, false, 'An inconsistent reveal flag cannot override the draft phase');
        assert(!Object.hasOwn(closed, 'futureDraws') && !JSON.stringify(closed.activity).includes('Secret era assignments'));
        assert(closed.draftPicks.every(pick => !Object.hasOwn(pick, 'drawnSeason')), 'Pick records do not provide a second route to the edition');
        assert.equal(view.draftPicks.length, 1);
        assert.equal(view.teams.flatMap(team => team.roster).length, 1, 'A sealed entry remains present for roster capacity and position limits');
        assert.equal(E.currentDraftSeat(view).overall, 2);
        assert.deepEqual(view.draftClock, state.draftClock, 'Reconnect preserves the canonical clock deadline');
        const reconnect = mount(props);
        tree = reconnect();
        assert(words(tree).includes('Find your next legend'), 'Per-seat disclosures survive a fresh component without private state');
        assert(!byClass(tree, 'tl-draft-grade').length, 'A partial draft cannot reveal grades or drawn-season totals');
        const queue = walk(tree).find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Queue '));
        assert(queue); queue.props.onClick();
        assert.equal(intents.at(-1).type, 'queue', 'Queue changes remain intents rather than guessing private draws');
        assert.equal(Clock.nextAction(view, cards, Date.parse(view.draftClock.deadlineAt)).type, 'draft-timeout');

        if (format === 'auction') {
            const active = decoded({ ...state, teams: state.teams.map((team, i) => i ? { ...team, manager: 'ai', aiPersona: 'warlord' } : team) });
            const before = AI.aiAuctionStep;
            AI.aiAuctionStep = () => { throw new Error('Browser attempted private auction valuation'); };
            try {
                assert.equal(Clock.nextAction(active, cards, Date.parse(active.draftClock.startedAt) + 3000)?.type, 'auction-ai-step', 'Public auction clocks request server evaluation without running private AI locally');
            } finally { AI.aiAuctionStep = before; }
        }
        let steps = 1;
        while (state.phase === 'draft') { assert(steps < 10); state = draftOne(state, steps * 15000 + 1); steps++; }
        view = decoded(state);
        assert.equal(view.seasonsRevealed, true);
        assert(!Object.hasOwn(view, 'seed'), 'Draft completion does not expose future private draws');
        assert.deepEqual(view.teams.map(team => team.roster.map(entry => entry.drawnSeason)), state.teams.map(team => team.roster.map(entry => entry.drawnSeason)));
        tree = mount(props)();
        assert.equal(byClass(tree, 'tl-draft-grade').length, 2, 'Both completed teams receive actual drawn-season grades');
        assert(words(tree).includes('Team report cards'));
        console.log(`ok ${format}: public transport, server reveals, scout, reconnect, queue, clock and completed recap`);
    }
    console.log('PASS: public draft browser snapshots preserve playability without private seeds or drawn editions');
})().catch(error => { console.error(error); process.exitCode = 1; });
