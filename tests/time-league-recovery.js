'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'types', 'season', 'player-cards', 'engine', 'ai', 'actions', 'ui', 'storage']) require(`../js/shared/time-league-${name}.js`);
const E = App.TimeLeagueEngine;
const disk = new Map(), events = new Map();
let failKey = null;
window.localStorage = {
    getItem: key => disk.get(key) ?? null,
    setItem: (key, value) => { if (key === failKey) throw new DOMException('Quota exceeded', 'QuotaExceededError'); disk.set(key, value); },
    removeItem: key => disk.delete(key),
};
window.addEventListener = (name, callback) => events.set(name, callback);
window.removeEventListener = (name, callback) => { if (events.get(name) === callback) events.delete(name); };
window.setInterval = () => 1; window.clearInterval = () => {};
window.requestAnimationFrame = () => 1;
const RealDate = Date;
let now = RealDate.parse('2026-09-07T00:00:00Z');
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
const calls = new Map(); let online = false, factorsOnline = false;
const card = { identity: 'player:qb:example', name: 'Example QB', position: 'QB', seasons: [{ season: 2000, games: 16, passYd: 2000, passTd: 20, passInt: 4, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0, points: 160 }] };
window.fetch = async url => {
    calls.set(url, (calls.get(url) || 0) + 1);
    if (!online || (url.endsWith('era-factors.json') && !factorsOnline)) throw new Error('Network unavailable');
    return { ok: true, json: async () => url.endsWith('player-cards.json') ? { players: [card] } : { factors: { '2000:QB': 1.1 } }, text: async () => 'player,pos,season,week,passing_yards,passing_tds\nExample QB,QB,2000,1,100,1' };
};
const hooks = []; let cursor = 0, pendingEffects = [];
const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
window.React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const slot = cursor++; hooks[slot] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[slot].value, next => { hooks[slot].value = typeof next === 'function' ? next(hooks[slot].value) : next; }]; },
    useRef: initial => { const slot = cursor++; hooks[slot] ??= { current: initial }; return hooks[slot]; },
    useMemo: (make, deps) => { const slot = cursor++; if (!equal(hooks[slot]?.deps, deps)) hooks[slot] = { value: make(), deps }; return hooks[slot].value; },
    useCallback: (fn, deps) => React.useMemo(() => fn, deps),
    useEffect: (fn, deps) => { const slot = cursor++; if (!equal(hooks[slot]?.deps, deps)) { hooks[slot]?.cleanup?.(); hooks[slot] = { deps }; pendingEffects.push(() => { hooks[slot].cleanup = fn(); }); } },
};
for (const name of ['Setup', 'Draft', 'Home', 'Team', 'Gamecast']) window[`WrTimeLeague${name}Panel`] = function Panel() {};
window.WrTimeLeagueWeekGates = function WeekGates() {};
require('../js/tabs/time-league.js');
const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.children)];
const content = node => JSON.stringify(node.children);
const button = (tree, label) => all(tree).find(node => node.type === 'button' && node.children.includes(label)) || all(tree).find(node => node.type === 'button' && content(node).includes(label));
const panel = (tree, type) => all(tree).find(node => node.type === type)?.props;
let closed = false;
const render = () => { cursor = 0; const tree = TimeLeague({ onClose() { closed = true; } }); const effects = pendingEffects; pendingEffects = []; effects.forEach(run => run()); return tree; };
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
const input = { name: 'Recovery league', seats: [{ name: 'Human', manager: 'human' }, { name: 'Friend', manager: 'human' }], settings: { rosterSlots: { QB: 1 }, maxQuarterbacks: 1, regularSeasonWeeks: 12, scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 }, eraRules: { mode: 'any-era', decades: [] }, draftPickSeconds: 60 } };
(async () => {
    let tree = render(); tree = await flush();
    assert(button(tree, 'Retry loading'), 'Offline startup presents recovery without reloading the page');
    const setup = panel(tree, WrTimeLeagueSetupPanel);
    failKey = App.TimeLeagueTypes.TIME_LEAGUE_INDEX_KEY;
    assert.throws(() => setup.onCreate(input), /could not save your league/);
    assert.equal([...disk.keys()].filter(key => key !== 'wr-time-league-ui-v1').length, 0, 'Failed creation leaves no game or phantom shelf entry');
    failKey = null; setup.onCreate(input); tree = render();
    let draft = panel(tree, WrTimeLeagueDraftPanel);
    assert.equal(draft, undefined, 'No draft board appears without the card archive');
    online = true; button(tree, 'Retry loading').props.onClick(); render(); tree = await flush();
    draft = panel(tree, WrTimeLeagueDraftPanel); assert(draft);
    assert.equal(calls.get('data/time-league/player-cards.json'), 2, 'Failed card cache is retried');
    assert.equal(calls.get('data/time-league/regular-season-game-logs.csv'), 2, 'Failed game-log cache is retried');

    // A second event queued from the same rendered view cannot replace the
    // first committed action, even before React renders the updated draft.
    const staleDraft = draft, sameView = staleDraft.league;
    assert.equal(await staleDraft.onUpdate(E.configureDraft(sameView, { draftAiSeconds: 1 }, new Date().toISOString())), true);
    const firstPaceSave = disk.get(App.TimeLeagueTypes.timeLeagueStorageKey(sameView.leagueId));
    assert.equal(await staleDraft.onUpdate(E.configureDraft(sameView, { draftAiSeconds: 4 }, new Date().toISOString())), false, 'A stale rendered callback cannot overwrite its first accepted action');
    assert.equal(disk.get(App.TimeLeagueTypes.timeLeagueStorageKey(sameView.leagueId)), firstPaceSave);
    tree = render(); draft = panel(tree, WrTimeLeagueDraftPanel);
    assert.equal(draft.league.settings.draftAiSeconds, 1);

    // Browser locks are asynchronous. Hold requests deliberately so overlapping
    // callbacks and a room switch happen before the queued write can run.
    const oldNavigator = Object.getOwnPropertyDescriptor(window, 'navigator');
    const oldDocument = Object.getOwnPropertyDescriptor(window, 'document');
    const heldLocks = [];
    Object.defineProperty(window, 'document', { configurable: true, value: {} });
    Object.defineProperty(window, 'navigator', { configurable: true, value: { locks: {
        request: (name, save) => new Promise((resolve, reject) => heldLocks.push(() => {
            try { resolve(save()); } catch (error) { reject(error); }
        })),
    } } });
    try {
        const lockedView = draft, lockBase = lockedView.league;
        const firstQueued = lockedView.onUpdate(E.configureDraft(lockBase, { draftAiSeconds: 2 }, new Date().toISOString()));
        const secondQueued = lockedView.onUpdate(E.configureDraft(lockBase, { draftAiSeconds: 8 }, new Date().toISOString()));
        assert.equal(heldLocks.length, 2);
        heldLocks.shift()();
        assert.equal(await firstQueued, true);
        const committedWhileQueued = disk.get(App.TimeLeagueTypes.timeLeagueStorageKey(lockBase.leagueId));
        heldLocks.shift()();
        assert.equal(await secondQueued, false, 'Only the first queued update from the same view can commit');
        assert.equal(disk.get(App.TimeLeagueTypes.timeLeagueStorageKey(lockBase.leagueId)), committedWhileQueued);
        tree = render(); draft = panel(tree, WrTimeLeagueDraftPanel);
        assert.equal(draft.league.settings.draftAiSeconds, 2);
        assert(!button(tree, 'Retry save'), 'A stale queued callback does not create a pending storage failure');

        const abandonedId = draft.league.leagueId;
        const abandonedKey = App.TimeLeagueTypes.timeLeagueStorageKey(abandonedId);
        const beforeSwitch = disk.get(abandonedKey);
        const abandoned = draft.onUpdate(E.configureDraft(draft.league, { draftAiSeconds: 8 }, new Date().toISOString()));
        const switchedFrom = draft;
        assert.equal(heldLocks.length, 1);
        button(tree, 'Switch league').props.onClick();
        assert.equal(await switchedFrom.onUpdate(E.configureDraft(switchedFrom.league, { draftAiSeconds: 1 }, new Date().toISOString())), false, 'A stale callback after switching away cannot queue another write');
        assert.equal(heldLocks.length, 1);
        tree = render();
        panel(tree, WrTimeLeagueSetupPanel).onCreate({ ...input, name: 'Another season while save waits' }); tree = render();
        const otherId = panel(tree, WrTimeLeagueDraftPanel).league.leagueId;
        const otherKey = App.TimeLeagueTypes.timeLeagueStorageKey(otherId), otherSaved = disk.get(otherKey);
        assert.notEqual(otherId, abandonedId);
        heldLocks.shift()();
        assert.equal(await abandoned, false, 'A queued save cannot commit after changing rooms');
        tree = render();
        assert.equal(panel(tree, WrTimeLeagueDraftPanel).league.leagueId, otherId, 'Completing an abandoned lock cannot reopen the old room');
        assert.equal(disk.get(abandonedKey), beforeSwitch);
        assert.equal(disk.get(otherKey), otherSaved, 'The newly opened room remains untouched');
        button(tree, 'Switch league').props.onClick(); tree = render();
        panel(tree, WrTimeLeagueSetupPanel).onOpen(abandonedId); tree = render(); draft = panel(tree, WrTimeLeagueDraftPanel);
        assert.equal(draft.league.settings.draftAiSeconds, 2);
    } finally {
        if (oldNavigator) Object.defineProperty(window, 'navigator', oldNavigator); else delete window.navigator;
        if (oldDocument) Object.defineProperty(window, 'document', oldDocument); else delete window.document;
    }

    // Another tab makes a real settings change. The current view must reload
    // that durable state before it can act; retrying never overwrites it.
    const externalKey = App.TimeLeagueTypes.timeLeagueStorageKey(draft.league.leagueId);
    const externalIndexKey = App.TimeLeagueTypes.TIME_LEAGUE_INDEX_KEY;
    const externalState = E.configureDraft(draft.league, { draftAiSeconds: 8 }, new Date().toISOString());
    App.TimeLeagueStorage.writeSnapshot(externalState, JSON.parse(disk.get(externalIndexKey)), { expectedSnapshot: disk.get(externalKey) });
    const externalGame = disk.get(externalKey), externalShelf = disk.get(externalIndexKey);
    assert.equal(await draft.onUpdate(E.configureDraft(draft.league, { draftAiSeconds: 2 }, new Date().toISOString())), false);
    tree = render();
    assert.equal(disk.get(externalKey), externalGame, 'A conflict cannot overwrite progress saved by another tab');
    assert.equal(disk.get(externalIndexKey), externalShelf);
    assert(all(tree).some(node => node.type === 'fieldset' && node.props.disabled), 'Conflict recovery locks stale gameplay controls');
    assert(button(tree, 'Load latest save'), 'Conflict recovery presents a reachable reload action');
    assert.equal(await button(tree, 'Load latest save').props.onClick(), true);
    tree = render(); draft = panel(tree, WrTimeLeagueDraftPanel);
    assert.equal(draft.league.settings.draftAiSeconds, 8, 'Recovery loads the committed action from the other tab');
    assert.equal(disk.get(externalKey), externalGame, 'Loading latest never writes the abandoned action');
    assert(!button(tree, 'Load latest save'));
    assert.equal(await draft.onUpdate(E.configureDraft(draft.league, { draftAiSeconds: 4 }, new Date().toISOString())), true, 'A fresh view can continue after conflict recovery');
    tree = render(); draft = panel(tree, WrTimeLeagueDraftPanel);

    const saved = draft.league, key = App.TimeLeagueTypes.timeLeagueStorageKey(saved.leagueId);
    const previousGame = disk.get(key), previousIndex = disk.get(App.TimeLeagueTypes.TIME_LEAGUE_INDEX_KEY);
    failKey = key;
    assert.equal(await draft.onUpdate(E.startDraft(saved, new Date().toISOString())), false);
    tree = render();
    assert.equal(disk.get(key), previousGame, 'Rejected move cannot replace the last saved game');
    assert.equal(disk.get(App.TimeLeagueTypes.TIME_LEAGUE_INDEX_KEY), previousIndex, 'Shelf metadata rolls back too');
    assert.equal(panel(tree, WrTimeLeagueDraftPanel).league.draftClock.status, 'waiting');
    assert(button(tree, 'Retry save')); assert(button(tree, 'Keep previous save'));
    assert(all(tree).some(node => node.type === 'fieldset' && node.props.disabled));
    assert.equal(await panel(tree, WrTimeLeagueDraftPanel).onUpdate({ ...saved, name: 'Overwritten' }), false, 'Later actions cannot overwrite the failed pending save');
    now += 120000; failKey = null;
    assert.equal(await button(tree, 'Retry save').props.onClick(), true); tree = render();
    const recovered = panel(tree, WrTimeLeagueDraftPanel).league;
    assert.equal(recovered.draftClock.status, 'running');
    assert.equal(Date.parse(recovered.draftClock.deadlineAt) - now, 60000, 'Storage recovery preserves the full next draft clock');
    assert.equal(E.normalizeTimeLeague(JSON.parse(disk.get(key))).draftClock.deadlineAt, recovered.draftClock.deadlineAt);
    assert(!button(tree, 'Retry save'));
    now += 20000;
    failKey = key;
    await panel(tree, WrTimeLeagueDraftPanel).onUpdate({ ...recovered, name: 'Never saved' }); tree = render();
    const beforeDiscard = disk.get(key);
    now += 120000;
    assert.equal(await button(tree, 'Retry save').props.onClick(), false); tree = render();
    now += 60000;
    assert.equal(button(tree, 'Keep previous save').props.onClick(), false, 'Discard cannot resume an expired draft while storage cannot save its pause'); tree = render();
    assert.equal(disk.get(key), beforeDiscard);
    assert(button(tree, 'Retry save'), 'Failed discard preserves the pending action and recovery choices');
    assert(all(tree).some(node => node.type === 'fieldset' && node.props.disabled));
    failKey = null;
    assert.equal(button(tree, 'Keep previous save').props.onClick(), true); tree = render();
    assert.equal(panel(tree, WrTimeLeagueDraftPanel).league.name, input.name); assert(!button(tree, 'Retry save'));
    const restoredPrevious = E.normalizeTimeLeague(JSON.parse(disk.get(key)));
    assert.equal(restoredPrevious.draftClock.status, 'paused', 'Discard durably pauses the original seat');
    assert.equal(restoredPrevious.draftClock.deadlineAt, null);
    assert.equal(restoredPrevious.draftClock.remainingMs, 40000, 'Repeated failed retries retain the original first-failure clock snapshot');
    assert.equal(E.expireDraftClock(restoredPrevious, new Map(), new Date(now + 60000).toISOString()), restoredPrevious, 'The draft driver cannot time out the restored paused seat');
    assert.equal(Date.parse(E.resumeDraft(restoredPrevious, new Date().toISOString()).draftClock.deadlineAt) - now, 40000);
    const adjusted = { ...recovered, phase: 'season', weekStage: 'ready', settings: { ...recovered.settings, eraAdjusted: true } };
    await panel(tree, WrTimeLeagueDraftPanel).onUpdate(adjusted); tree = render();
    button(tree, 'GAMEDAY').props.onClick(); tree = render();
    assert.equal(panel(tree, WrTimeLeagueWeekGates).dataReady, false, 'Era scoring does not silently fall back after its download fails');
    assert(button(tree, 'Retry loading'));
    factorsOnline = true; events.get('online')(); render(); tree = await flush();
    assert.equal(panel(tree, WrTimeLeagueWeekGates).dataReady, true);
    assert.equal(calls.get('data/time-league/player-cards.json'), 2, 'Successful heavy archives remain cached');
    assert.equal(calls.get('data/time-league/regular-season-game-logs.csv'), 2);
    assert.equal(calls.get('data/time-league/regular-season-era-factors.json'), 3, 'Reconnection retries only failed datasets');
    assert(!button(tree, 'Retry loading'));
    assert.equal(calls.get('data/time-league/nflverse-game-logs.csv'), undefined, 'New leagues do not download the heavy legacy archive');
    const legacy = { ...panel(tree, WrTimeLeagueGamecastPanel).league, settings: { ...adjusted.settings, gameDeckVersion: 0 } };
    await panel(tree, WrTimeLeagueGamecastPanel).onUpdate(legacy); tree = render();
    assert.equal(panel(tree, WrTimeLeagueWeekGates).dataReady, false, 'Switching archive versions cannot score with the previous dataset');
    tree = await flush();
    assert.equal(panel(tree, WrTimeLeagueWeekGates).dataReady, true);
    assert.equal(calls.get('data/time-league/nflverse-game-logs.csv'), 1, 'Legacy data is loaded only when a legacy league needs it');
    assert.equal(calls.get('data/time-league/regular-season-game-logs.csv'), 2, 'Switching leagues does not redownload the successful full archive');
    const beforeSeasonMove = panel(tree, WrTimeLeagueGamecastPanel).league;
    failKey = key;
    assert.equal(await panel(tree, WrTimeLeagueGamecastPanel).onUpdate({ ...beforeSeasonMove, weekStage: 'lineup' }), false); tree = render();
    const saveDock = panel(tree, WrTimeLeagueWeekGates);
    assert.equal(saveDock.saving, false, 'A rejected write is not still saving');
    assert.equal(saveDock.saveError, true);
    assert(!all(all(tree).find(node => node.type === 'fieldset')).some(node => node.type === WrTimeLeagueWeekGates), 'Retry dock stays outside the disabled gameplay fieldset');
    failKey = null;
    assert.equal(await saveDock.onRetrySave(), true); tree = render();
    assert.equal(panel(tree, WrTimeLeagueWeekGates).saveError, false);
    assert.equal(panel(tree, WrTimeLeagueGamecastPanel).league.weekStage, 'lineup');
    failKey = key;
    assert.equal(await panel(tree, WrTimeLeagueGamecastPanel).onUpdate({ ...beforeSeasonMove, name: 'Pending exit' }), false); tree = render();
    const beforeExit = disk.get(key);
    button(tree, 'Keep previous save & go back').props.onClick(); tree = render();
    assert(closed, 'A save error provides an explicit way back without silently accepting the failed move');
    assert.equal(disk.get(key), beforeExit, 'Leaving retains the last saved season');
    assert.equal(panel(tree, WrTimeLeagueWeekGates).saveError, false);
    console.log('PASS: offline startup, stale-view and cross-tab conflicts, queued browser locks and room switches, load-latest continuation, cache reuse, failed creation, quota rollback, pending-save isolation, retry/discard, preserved draft time, actionable recovery dock and safe back navigation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.Date = RealDate; });
