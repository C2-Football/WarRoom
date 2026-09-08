'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'types', 'season', 'player-cards', 'engine', 'ai', 'actions', 'ui']) require(`../js/shared/time-league-${name}.js`);
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
const button = (tree, label) => all(tree).find(node => node.type === 'button' && content(node).includes(label));
const panel = (tree, type) => all(tree).find(node => node.type === type)?.props;
const render = () => { cursor = 0; const tree = TimeLeague({ onClose() {} }); const effects = pendingEffects; pendingEffects = []; effects.forEach(run => run()); return tree; };
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
    assert.equal(calls.get('data/time-league/nflverse-game-logs.csv'), 2, 'Failed game-log cache is retried');
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
    assert.equal(calls.get('data/time-league/nflverse-game-logs.csv'), 2);
    assert.equal(calls.get('data/time-league/era-factors.json'), 3, 'Reconnection retries only failed datasets');
    assert(!button(tree, 'Retry loading'));
    console.log('PASS: offline startup, retry/reconnection, successful cache reuse, failed creation, quota rollback, pending-save isolation, retry/discard and preserved draft time.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.Date = RealDate; });
