'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');

const compiledLens = Babel.transform(fs.readFileSync('js/components/roster-lenses.js', 'utf8'), { presets: ['react'] }).code;
const compiledRoster = Babel.transform(fs.readFileSync('js/tabs/my-team.js', 'utf8'), { presets: ['react'] }).code;
const walk = value => value == null || typeof value === 'boolean' ? [] : Array.isArray(value) ? value.flatMap(walk) : typeof value === 'object' ? [value, ...walk(value.children)] : [value];
const text = node => walk(node).filter(value => typeof value !== 'object').join('');
const all = (node, predicate) => walk(node).filter(value => value && typeof value === 'object' && predicate(value));
const find = (node, predicate) => all(node, predicate)[0];
const noop = () => {};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

function candidate(id, incomingName, weekly, season, extra = {}) {
    return { id, pid: id, anchorPlayerId: 'bench', dropPid: 'bench',
        incoming: [{ pid: id, name: incomingName, position: 'RB', team: 'CHI', projection: 18 }],
        outgoing: [{ pid: 'bench', name: 'Bench Runner', position: 'RB', projection: 5 }],
        weekly: { status: 'ready', before: 100, after: 100 + weekly, delta: weekly },
        season: { status: 'ready', before: 500, after: 500 + season, delta: season },
        reason: 'Improves the best legal lineup.', cautions: ['Availability requires platform confirmation.'],
        ...extra };
}
const waiverCandidates = () => [candidate('add-a', 'Available Runner', 3, 10), candidate('add-b', 'Other Runner', 2, 20), candidate('add-c', 'Third Runner', 1, 30)];
const tradeCandidates = () => [candidate('trade-a', 'Trade Target', 2, 0, { season: { status: 'unavailable', reason: 'Load the full season.' }, price: { delta: -100, unit: 'DHQ' } }), candidate('trade-b', 'Other Trade Target', 12, 0)];
const ready = candidates => ({ status: 'ready', week: 6, candidates });

function harness({ integrated = false, pro = true } = {}) {
    const slots = [], pending = new Map(), events = [], listeners = new Map(), calls = [], seasonCalls = [], writes = [], navigations = [], acquisition = [];
    let index = 0, dirty = false, tree, lens, viewer = 'owner', saveFailure = false;
    const storage = new Map();
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
    const effect = (fn, deps) => {
        const i = index++, prior = slots[i];
        if (!prior || !same(prior.deps, deps)) { slots[i] = { deps, cleanup: prior?.cleanup }; pending.set(i, fn); }
    };
    const React = {
        Fragment: 'fragment',
        useState(initial) {
            const i = index++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
            return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
        },
        useMemo(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
        useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
        useRef(initial) { const i = index++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
        useEffect: effect, useLayoutEffect: effect,
        createElement(type, props, ...children) {
            props = { ...(props || {}), children };
            if (typeof type === 'function') return type(props);
            if (type === 'sheet' || type === 'filter-sheet') return props.open ? { type, props, children: [...(props.sections || []).map(section => section.node), props.footer, ...children] } : null;
            if (type === 'card-list') return { type, props, children: (props.groups || []).flatMap(group => group.rows) };
            return { type, props, children };
        },
    };
    const players = {
        starter: { full_name: 'Starter Receiver', position: 'WR', team: 'MIN', age: 25 },
        bench: { full_name: 'Bench Runner', position: 'RB', team: 'CHI', age: 30 },
        ir: { full_name: 'Reserve Receiver', position: 'WR', team: 'NYJ', age: 24, injury_status: 'IR' },
        taxi: { full_name: 'Taxi Quarterback', position: 'QB', team: 'ATL', age: 22, years_exp: 0 },
    };
    const roster = { roster_id: 1, owner_id: 'owner', players: Object.keys(players), starters: ['starter'], reserve: ['ir'], taxi: ['taxi'], settings: { wins: 0, losses: 0, ties: 0, waiver_budget_used: 25 } };
    const league = { league_id: 'one', season: '2026', roster_positions: ['WR', 'RB', 'BN'], settings: { type: 0, waiver_budget: 100, reserve_slots: 1, taxi_slots: 1 }, scoring_settings: { rec: 1 }, rosters: [roster] };
    const gm = { hasStrategy: true, mode: 'win_now', modeLabel: 'Win now', untouchable: new Set(), targetPositions: new Set(), sellPositions: new Set(), sellRules: [] };
    const plans = new Map([['add-a', { pid: 'add-a', dropPid: 'bench', bid: 7 }]]);
    const root = {
        innerWidth: 390, localStorage,
        S: { currentLeagueId: 'one', platform: 'sleeper', nflState: { season: '2026', week: 6 }, weeklyPlayerPointsScope: 'points:one' },
        addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        dispatchEvent(event) { events.push(event); for (const fn of listeners.get(event.type) || []) fn(event); },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        RosterPlayerStats: 'roster-stats', wrIsPro: () => pro,
        WR: {
            useViewport: () => ({ width: 390, isPhone: true }),
            GmMode: { useGmEffects: () => gm, getPreset: () => ({}) },
            AssetRow: 'asset-row', CardList: 'card-list', FilterSheet: 'filter-sheet', Sheet: 'sheet',
            WaiverPlans: { account: () => 'account:' + viewer, get: (_league, pid) => plans.get(pid), save: (currentLeague, plan) => { writes.push({ leagueId: currentLeague.league_id, ...plan }); return saveFailure ? null : { ...plan }; } },
            openAcquisition: context => acquisition.push(context),
        },
        App: {
            calcRawPts: stats => stats.pts || 0, normPos: position => position, POS_COLORS: {},
            LI: { playerScores: { starter: 8000, bench: 100, ir: 4000, taxi: 2000 } },
            NFLByes: { seasonFor: () => 2026, label: () => 'Bye 7', rosterWeeks: () => ({ weeks: [], unknown: [] }) },
            WeeklyProj: { currentWeek: () => 6, weeklyPointsScope: id => 'points:' + id, formStats: () => ({ rollingPPG: 11.5 }) },
            RosterWaiverLens: { load: options => { const next = deferred(); calls.push({ mode: 'waivers', options, ...next }); return next.promise; } },
            RosterTradeLens: {
                load: options => { const next = deferred(); calls.push({ mode: 'trades', options, ...next }); return next.promise; },
                loadSeason: options => { const next = deferred(); seasonCalls.push({ options, ...next }); return next.promise; },
                toBuilderContext: (move, result) => ({ kind: 'roster-lens-package', leagueId: 'one', candidateId: move.id, resultWeek: result.week, givePlayerIds: move.outgoing.map(asset => asset.pid), receivePlayerIds: move.incoming.map(asset => asset.pid) }),
            },
        },
    };
    const context = vm.createContext({ window: root, React, console, CustomEvent: root.CustomEvent, localStorage,
        InlineCareerStats: 'career', getPlayerAnnotation: () => null, wrAlpha: color => color,
        setTimeout: fn => fn(), requestAnimationFrame: noop, document: { querySelector: () => null } });
    vm.runInContext(compiledLens, context);
    const api = root.WR.RosterLens;
    const input = { league, roster, players, statsData: {}, priorData: {}, userId: 'owner', gm, skin: { type: 'redraft', features: { showTrades: true, showTaxi: true, showWeeklyVerdict: false } }, revision: 1, isPro: pro, setActiveTab: tab => navigations.push(tab) };
    let props;
    if (integrated) {
        vm.runInContext(fs.readFileSync('js/shared/roster-review.js', 'utf8'), context);
        vm.runInContext(compiledRoster, context);
        const useLens = api.useLens; api.useLens = options => (lens = useLens(options));
        props = { myRoster: roster, currentLeague: league, leagueSkin: input.skin, playersData: players,
            statsData: input.statsData, stats2025Data: input.priorData, standings: [], sleeperUserId: input.userId,
            rosterFilter: 'All', rosterSort: { key: 'name', dir: 1 }, visibleCols: ['pos', 'age', 'dhq', 'ppg'], expandedPid: null, showColPicker: false, colPreset: 'default', timeRecomputeTs: 1,
            setActiveTab: input.setActiveTab };
        for (const key of ['rosterFilter', 'rosterSort', 'visibleCols', 'expandedPid', 'showColPicker', 'colPreset']) props['set' + key[0].toUpperCase() + key.slice(1)] = value => { props[key] = typeof value === 'function' ? value(props[key]) : value; dirty = true; };
    }
    function render(commit = true) {
        let passes = 0;
        do {
            assert(++passes < 30, 'Hooks should reach a stable render');
            dirty = false; index = 0;
            if (integrated) tree = context.MyTeamTab(props);
            else {
                lens = api.useLens(input);
                tree = [api.Controls({ lens, inlinePids: new Set(['bench']) }), api.Row({ lens, pid: 'bench' })];
            }
            if (!commit) break;
            const effects = [...pending]; pending.clear();
            for (const [i, fn] of effects) { slots[i].cleanup?.(); slots[i].cleanup = fn(); }
        } while (dirty);
        return tree;
    }
    async function flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty) render(); } return tree; }
    const apiForTest = { root, api, input, props, calls, seasonCalls, writes, events, navigations, acquisition, plans, players, roster, league, gm, render, flush,
        get tree() { return tree; }, get lens() { return lens; },
        set viewer(value) { viewer = value; }, set saveFailure(value) { saveFailure = value; },
        click(label) { const button = find(tree, node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label)); assert(button, 'button: ' + label); button.props.onClick(); render(); return button; },
        change(label, value) { const control = find(tree, node => node.props['aria-label'] === label); assert(control, 'control: ' + label); control.props.onChange({ target: { value } }); render(); },
    };
    render(); return apiForTest;
}

async function loadWaivers(h, candidates = waiverCandidates()) { h.click('Waivers'); await h.flush(); const call = h.calls.at(-1); assert.equal(call.mode, 'waivers'); call.resolve(ready(candidates)); await h.flush(); return h.lens; }
async function loadTrades(h, candidates = tradeCandidates()) { h.click('Trades'); await h.flush(); const call = h.calls.at(-1); assert.equal(call.mode, 'trades'); call.resolve({ ...ready(candidates), week: 7, timing: { fromWeek: 7 } }); await h.flush(); return h.lens; }

test('lens is opt-in, read-only, and disabled without the existing recommendation entitlement', async () => {
    const h = harness(), before = JSON.stringify(h.roster), strategy = JSON.stringify(h.gm);
    await h.flush(); assert.equal(h.calls.length, 0); assert.equal(h.seasonCalls.length, 0); assert.equal(h.lens.mode, 'off');
    await loadWaivers(h); h.click('Lens off'); await h.flush();
    assert.equal(h.lens.mode, 'off'); assert(h.lens.selected == null); assert.equal(h.calls.length, 1);
    assert.equal(JSON.stringify(h.roster), before); assert.equal(JSON.stringify(h.gm), strategy); assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
    const free = harness({ pro: false }); free.lens.setMode('waivers'); free.render(); await free.flush();
    assert.equal(free.lens.enabled, false); assert.equal(free.tree.filter(Boolean).length, 0); assert.equal(free.calls.length, 0);
    const chopped = harness(); chopped.input.skin = { type: 'chopped', features: { showTrades: false } }; chopped.render();
    assert.equal(find(chopped.tree, node => node.type === 'button' && text(node) === 'Trades off').props.disabled, true);
});

test('same exact add/drop survives horizon reranking; auto-selection restores its saved bid', async () => {
    const h = harness(); await loadWaivers(h);
    assert.equal(h.lens.selected.id, 'add-a'); assert.equal(h.lens.ui.bid, '7');
    h.click('Season'); await h.flush();
    assert.equal(h.lens.options[0].id, 'add-c', 'Season alternatives rerank');
    assert.equal(h.lens.selected.id, 'add-a', 'The chosen move stays the same');
    assert.equal(h.lens.selected.dropPid, 'bench'); assert.equal(h.lens.ui.bid, '7'); assert.equal(h.calls.length, 1, 'Horizon is a view on the same snapshot');
    const choices = find(h.tree, node => node.type === 'select' && node.props['aria-label'] === 'Acquisition ideas for this roster spot');
    assert.equal(all(choices, node => node.type === 'option' && !node.props.disabled).length, 3, 'All same-anchor ideas are reachable');
    h.change('Acquisition ideas for this roster spot', 'add-c'); assert.equal(h.lens.selected.id, 'add-c'); assert.equal(h.lens.ui.bid, '');
    h.change('Acquisition ideas for this roster spot', 'add-a'); assert.equal(h.lens.ui.bid, '7');
    h.click('Review claim'); h.click('Save claim plan');
    assert.equal(h.writes.at(-1).bid, 7); assert.equal(h.writes.at(-1).pid, 'add-a'); assert.equal(h.writes.at(-1).dropPid, 'bench');
    assert.match(text(h.tree), /Private claim plan saved\. No claim has been submitted\./);
});

test('Chopped keeps waiver previews week-only instead of relabeling a survival window as the full season', async () => {
    const h = harness(); h.input.skin = { type: 'chopped', features: { showTrades: false } };
    h.input.league = { ...h.league, settings: { ...h.league.settings, type: 3 } }; h.render();
    await loadWaivers(h);
    assert(find(h.tree, node => node.type === 'button' && text(node) === 'This week'));
    assert(!find(h.tree, node => node.type === 'button' && text(node) === 'Season'), 'Chopped does not offer a misleading season scope');
    assert.equal(h.lens.ui.horizon, 'week');
    h.lens.setHorizon('season'); h.render(); await h.flush();
    assert.equal(h.lens.ui.horizon, 'week', 'A captured or programmatic season action cannot activate the unsupported horizon');
    assert.equal(h.lens.selected.id, 'add-a');
    assert(!text(h.tree).includes('Rest-of-season lineup points'));
    assert(!find(h.tree, node => String(node.props.className || '').includes('wr-lens-other-horizon')), 'No survival-window number appears as an alternate season forecast');
    assert.equal(h.seasonCalls.length, 0);
});

test('failed plan write is visible inline and never reported as a saved claim', async () => {
    const h = harness(); await loadWaivers(h); h.click('Review claim'); h.saveFailure = true; h.click('Save claim plan');
    const preview = find(h.tree, node => node.props['data-lens-preview'] === 'add-a');
    const review = find(preview, node => node.props.className === 'wr-lens-review');
    assert(review); assert.match(text(find(review, node => node.props.role === 'alert')), /could not be saved/);
    assert(!text(review).includes('Private claim plan saved'));
    h.lens.setBid('76'); h.render(); const count = h.writes.length; h.click('Save claim plan');
    assert.equal(h.writes.length, count, 'Over-budget values do not reach storage'); assert.match(text(h.tree), /\$0 to \$75/);
    h.input.league = { ...h.league, settings: { ...h.league.settings, waiver_budget: 0 } }; h.render(); await h.flush();
    assert(!find(h.tree, node => node.type === 'input' && node.props['aria-label'] === 'Planned maximum waiver bid'));
});

test('pending work cannot reactivate the lens after off, or leak into another account/league/season', async () => {
    const h = harness(); h.click('Waivers'); await h.flush(); const pending = h.calls[0];
    h.click('Lens off'); pending.resolve(ready(waiverCandidates())); await h.flush();
    assert.equal(h.lens.mode, 'off'); assert(h.lens.selected == null); assert.equal(h.calls.length, 1);
    await loadWaivers(h); const priorLens = h.lens, priorMove = priorLens.selected;
    h.input.revision = 2; h.render(); await h.flush(); const late = h.calls.at(-1);
    h.viewer = 'second-owner'; h.input.league = { ...h.league, league_id: 'two', season: '2027' }; h.root.S.currentLeagueId = 'two';
    h.render(false);
    assert.equal(h.lens.mode, 'off'); assert.equal(h.lens.result, null); assert(h.lens.selected == null, 'Prior scope is hidden before effects commit');
    priorLens.openModule(priorMove); priorLens.savePlan(priorMove);
    assert.equal(h.acquisition.length, 0); assert.equal(h.writes.length, 0, 'Captured actions reject a changed account');
    h.render(); late.resolve(ready([candidate('late', 'Wrong League Player', 100, 500)])); await h.flush();
    assert.equal(h.lens.mode, 'off'); assert(!text(h.tree).includes('Wrong League Player'));
});

test('a changed roster revision hides earlier results and rejects captured actions before replacement data arrives', async () => {
    const h = harness(); await loadWaivers(h); const prior = h.lens, move = prior.selected;
    h.input.roster = { ...h.roster, players: ['starter'] }; h.input.league = { ...h.league, rosters: [h.input.roster] };
    h.render(false); assert.equal(h.lens.loading, true); assert.equal(h.lens.options.length, 0); assert.equal(h.lens.selected, null);
    prior.openReview(move); prior.openModule(move); prior.savePlan(move);
    assert.equal(h.acquisition.length, 0); assert.equal(h.writes.length, 0);
    h.render(); await h.flush(); assert.equal(h.calls.length, 2);
});

test('each independent identity boundary hides old previews before effects and blocks old handoffs', async () => {
    const changes = {
        account: h => { h.viewer = 'new-account'; },
        platform: h => { h.root.S.platform = 'mfl'; },
        league: h => { h.input.league = { ...h.league, league_id: 'two' }; h.root.S.currentLeagueId = 'two'; },
        season: h => { h.input.league = { ...h.league, season: '2027' }; },
        roster: h => { h.input.roster = { ...h.roster, roster_id: 22 }; },
    };
    for (const [name, change] of Object.entries(changes)) {
        const h = harness(); await loadWaivers(h); const prior = h.lens, move = prior.selected;
        change(h); h.render(false);
        assert.equal(h.lens.mode, 'off', name + ' boundary'); assert(h.lens.selected == null, name + ' hides selected move');
        prior.openModule(move); prior.savePlan(move);
        assert.equal(h.acquisition.length, 0, name + ' denies captured handoff'); assert.equal(h.writes.length, 0, name + ' denies captured save');
    }
});

test('redraft season work is lazy and its selected clone reaches both impact and inline row', async () => {
    const h = harness(); await loadTrades(h);
    assert.equal(h.lens.selected.id, 'trade-a', 'Weekly trade ordering retains service strategy fit');
    assert.equal(h.seasonCalls.length, 0, 'Week-only trade browsing does no season simulation');
    h.click('Season'); await h.flush(); assert.equal(h.seasonCalls.length, 1);
    assert.equal(h.seasonCalls[0].options.candidateId, 'trade-a');
    assert.equal(h.seasonCalls[0].options.revision, h.calls[0].options.revision, 'Lazy model validation receives the same full data signature');
    assert.equal(h.lens.selected.id, 'trade-a'); assert.equal(h.lens.seasonLoading, true);
    h.seasonCalls[0].resolve({ season: { status: 'ready', before: 1000, after: 1042, delta: 42 } }); await h.flush();
    const row = find(h.tree, node => node.props.className === 'wr-lens-row');
    const impact = find(h.tree, node => node.props.className === 'wr-lens-impact');
    assert.match(text(row), /\+42\.0ROS pts/); assert(!text(row).includes('Load the full season'));
    assert.match(text(impact), /1,000\.0.*1,042\.0/); assert.equal(h.lens.selected.season.delta, 42);
    h.click('Next full week'); await h.flush(); h.click('Season'); await h.flush();
    assert.equal(h.seasonCalls.length, 1, 'Same scoped package reuses its season calculation');
});

test('late season result for a previous package cannot replace the newly selected package', async () => {
    const h = harness(); await loadTrades(h); h.click('Season'); await h.flush();
    const first = h.seasonCalls[0];
    h.lens.choose(h.lens.options.find(move => move.id === 'trade-b')); h.render(); await h.flush();
    assert.equal(h.seasonCalls.length, 2); const second = h.seasonCalls[1];
    second.resolve({ season: { status: 'ready', before: 1000, after: 1060, delta: 60 } }); await h.flush();
    first.resolve({ season: { status: 'ready', before: 1000, after: 1999, delta: 999 } }); await h.flush();
    assert.equal(h.lens.selected.id, 'trade-b'); assert.equal(h.lens.selected.season.delta, 60);
    assert(!text(h.tree).includes('+999.0')); assert.match(text(h.tree), /\+60\.0ROS pts/);
});

test('trade handoff carries both sides and rejects changed-account or wrong active-league actions', async () => {
    const h = harness(); const incoming = tradeCandidates()[0]; incoming.outgoing.push({ pid: 'starter', name: 'Starter Receiver' });
    await loadTrades(h, [incoming]); h.click('Review trade'); h.click('Open in Trade Builder');
    assert.equal(h.navigations.at(-1), 'trades'); assert.equal(h.events.at(-1).type, 'wr:open-trade-builder');
    assert.deepEqual(Array.from(h.events.at(-1).detail.givePlayerIds), ['bench', 'starter']); assert.deepEqual(Array.from(h.events.at(-1).detail.receivePlayerIds), ['trade-a']);
    assert.equal(h.events.at(-1).detail.returnTab, 'myteam');
    const prior = h.lens, count = h.events.length;
    h.viewer = 'someone-else'; prior.openModule(prior.selected); assert.equal(h.events.length, count);
    h.viewer = 'owner'; h.root.S.currentLeagueId = 'different'; prior.openModule(prior.selected); assert.equal(h.events.length, count);
    assert.equal(h.writes.length, 0);
});

test('actual My Roster places review inside its player row and restores untouched filters/sort on lens off', async () => {
    const h = harness({ integrated: true });
    const beforeRoster = JSON.stringify(h.roster), beforeSort = JSON.stringify(h.props.rosterSort), beforeColumns = JSON.stringify(h.props.visibleCols);
    const controls = find(h.tree, node => node.props['aria-label'] === 'Roster acquisition lenses');
    const playerSection = find(h.tree, node => node.props.className === 'wr-roster-mobile-players');
    const flat = walk(h.tree); assert(flat.indexOf(controls) < flat.indexOf(playerSection));
    await loadWaivers(h);
    const anchor = find(h.tree, node => node.props['data-wr-roster-pid'] === 'bench');
    const trigger = find(anchor, node => node.props.className === 'wr-roster-mobile-player-trigger');
    const preview = find(anchor, node => node.props['data-lens-preview'] === 'add-a');
    assert(preview); assert.equal(all(h.tree, node => node.props['data-lens-preview'] === 'add-a').length, 1, 'One visible copy of the selected preview');
    assert(walk(anchor).indexOf(trigger) < walk(anchor).indexOf(preview));
    h.click('Review claim'); assert(find(find(h.tree, node => node.props['data-wr-roster-pid'] === 'bench'), node => node.props.className === 'wr-lens-review'));
    assert(find(h.tree, node => node.type === 'details' && node.props.className === 'wr-lens-roster-settings'));
    h.props.rosterFilter = 'Starters'; h.render();
    assert(!find(h.tree, node => node.props['data-wr-roster-pid'] === 'bench'));
    assert(find(h.tree, node => node.props['data-lens-preview'] === 'add-a'), 'A filtered anchor keeps the selected comparison accessible above the list');
    h.click('Lens off'); await h.flush();
    assert.equal(h.props.rosterFilter, 'Starters'); assert.equal(JSON.stringify(h.props.rosterSort), beforeSort); assert.equal(JSON.stringify(h.props.visibleCols), beforeColumns);
    assert.equal(JSON.stringify(h.roster), beforeRoster); assert(!find(h.tree, node => node.props.className === 'wr-lens-roster-settings'));
    assert(!find(h.tree, node => node.props['data-lens-preview'])); assert(!text(h.tree).includes('Starting lineup'), 'Roster lenses do not mount a second Game Day lineup workflow');
});
