#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');

const stored = new Map();
let writes = 0;
const localStorage = {
    get length() { return stored.size; }, key: n => [...stored.keys()][n],
    getItem: k => stored.get(k) ?? null,
    setItem: (k, v) => { writes++; stored.set(k, v); },
};
const events = [];
const navigations = [];
const listeners = new Map();
const window = {
    S: { currentLeagueId: '10', platform: 'sleeper', user: { user_id: 'alice' }, myRosterId: 1 },
    App: { WrStorage: { get: (k, fallback) => stored.has(k) ? JSON.parse(stored.get(k)) : fallback, set: (k, value) => localStorage.setItem(k, JSON.stringify(value)) } },
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatchEvent: event => { events.push(event); for (const listener of listeners.get(event.type) || []) listener(event); },
    wrNavigateTab: tab => navigations.push(tab),
};
const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: initial => ({ current: initial }), useMemo: fn => fn(), useCallback: fn => fn,
    Fragment: 'fragment',
};
const context = vm.createContext({ window, localStorage, React, console, setTimeout: () => {}, clearTimeout: () => {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    document: { readyState: 'loading', addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null },
});
function load(path, jsx = false) {
    const source = fs.readFileSync(path, 'utf8');
    vm.runInContext(jsx ? Babel.transform(source, { presets: ['react'] }).code : source, context, { filename: path });
}
load('js/shared/player-notebook.js');
const N = window.WR.PlayerNotebook;
assert.equal(N.update('p1', { note: 'My opinion', watch: true }, { scope: 'personal' }), true);
N.update('p1', { note: 'Offer a future second' }, { leagueId: '10' });
assert.equal(N.get('p1', { scope: 'personal' }).note, 'My opinion');
assert.equal(N.get('p1', { leagueId: '11' }).note, undefined);
assert.equal(N.isWatched('p1', '11'), true, 'personal watch follows the player across leagues');
window.S.user.user_id = 'bob';
assert.equal(N.list('10').length, 0, 'another owner cannot see personal or league research');
window.S.user.user_id = 'alice';
window.S.platform = 'mfl';
assert.equal(N.list('10').length, 0, 'unrelated provider player IDs cannot collide');
window.S.platform = 'sleeper';
let authenticatedUser = 'native-alice';
window.App.OD = { getCurrentUserId: () => authenticatedUser };
window.S.platform = 'mfl';
window.S.user.user_id = '0001';
N.update('mfl-player', { note: 'Same person across franchises' }, { scope: 'personal' });
window.S.user.user_id = '0099';
assert.equal(N.get('mfl-player', { scope: 'personal' }).note, 'Same person across franchises');
authenticatedUser = 'native-bob';
window.S.user.user_id = '0001';
assert.equal(N.get('mfl-player', { scope: 'personal' }).note, undefined, 'franchise 0001 cannot expose another native account’s notes');
delete window.App.OD;
window.S.platform = 'sleeper';
window.S.user.user_id = 'alice';

const legacy = { notes: { rookie: 'Loved the route running' }, tags: { rookie: 'target', avoid: 'avoid' }, myOrder: ['rookie', 'avoid'] };
localStorage.setItem('wr_bigboard_10_rookie', JSON.stringify(legacy));
localStorage.setItem('wr_bigboard_100_rookie', JSON.stringify({ notes: { leaked: 'Other league' } }));
N.migrateLeague('10');
assert.equal(N.get('rookie').note, legacy.notes.rookie);
assert.equal(N.get('rookie').watch, true);
assert.equal(N.get('avoid').watch, undefined, 'avoid remains a draft tag, not a target');
assert.equal(N.get('leaked').note, undefined, 'migration uses an exact league key boundary');
const afterImport = writes;
N.migrateLeague('10');
assert.equal(writes, afterImport, 'migration is idempotent');
N.update('rookie', { note: 'New opinion after camp', watch: false });
N.migrateLeague('10');
assert.equal(N.get('rookie').note, 'New opinion after camp');
assert.equal(N.get('rookie').watch, false, 'migration cannot re-watch a manually removed target');
assert.deepEqual(JSON.parse(stored.get('wr_bigboard_10_rookie')), legacy, 'legacy notes, tags and ordering remain intact');
N.update('rookie', { note: '' });
N.migrateLeague('10');
assert.equal(N.get('rookie').note, '', 'deleting a notebook note does not resurrect the legacy note');
window.S.user.user_id = 'bob';
N.migrateLeague('10');
assert.equal(N.get('rookie').note, undefined, 'an already imported legacy board cannot be copied to a second owner');
window.S.user.user_id = 'alice';

const league = { league_id: '10', name: 'Test League', settings: { type: 2 }, roster_positions: ['QB', 'RB', 'WR', 'TE'] };
const rosters = [{ roster_id: 1, players: ['mine'], taxi: ['taxi'], reserve: ['ir'] }, { roster_id: 2, players: ['other'] }];
const act = (pid, extra = {}) => N.resolveAction({ pid, league, rosters, myRosterId: '1', ...extra });
assert.equal(act('fa').kind, 'waiver');
assert.equal(act('other').kind, 'trade');
assert.equal(act('mine').mine, true);
assert.equal(act('taxi').mine, true);
assert.equal(act('ir').mine, true);
assert.equal(act('other', { features: { showTrades: false } }).kind, 'watch');
assert.equal(act('mine', { features: { showTrades: false } }).dropPid, 'mine');
assert.equal(act('other', { league: { settings: { type: 3 } } }).kind, 'watch');
assert.equal(act('other', { league: { settings: { disable_trades: 1 } } }).kind, 'watch');
assert.equal(act('other', { league: { settings: { player_copies: 2 } } }).kind, 'waiver', 'available second copy takes waiver path');
assert.equal(act('fa', { rosters: [{ roster_id: 1 }] }).kind, 'watch', 'incomplete ownership does not invent availability');
assert.equal(act('fa', { context: 'draft-board' }).kind, 'draft');
const pending = window.WR.openAcquisition({ pid: 123, position: 'TE', week: 7, dropPid: 'mine', reason: 'Cover the bye', source: 'game-day-bye-watch' });
assert.equal(navigations.at(-1), 'fa');
assert.equal(events.at(-1).type, 'wr:acquisition-context');
assert.equal(N.contextFor(pending, '10').pid, '123');
assert.equal(N.contextFor(pending, '11'), null);
assert.equal(pending.dropPid, 'mine');
assert.equal(pending.week, 7);
window.WR.openDraftPlayer({ pid: 'rookie' });
assert.equal(navigations.at(-1), 'draft');
assert.equal(window.WR.draftPlayerContext.pid, 'rookie');

// Render the actual shared card and click its primary action. This protects the
// call-site integration, not only the resolver's classification rules.
window.S.rosters = rosters;
window.S.leagues = [league];
window.S.season = '2026';
window.App.LI = { playerScores: { fa: 2000, other: 4000 }, playerMeta: {} };
window.App.PortfolioContext = { player: () => ({ count: 1, coveredLeagues: 3, leagues: [{ name: 'Another league' }] }) };
const playersData = Object.fromEntries(['fa', 'mine', 'other', 'rookie'].map(pid => [pid, { full_name: pid, position: 'TE', team: 'KC', age: 24, years_exp: 0 }]));
load('js/components/player-card.js');
function flatten(node) { return node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(flatten)] : []; }
function card(pid, more = {}) { return window.PlayerCard({ pid, playersData, statsData: {}, onClose: () => {}, ...more }); }
let tree = card('fa', { context: { source: 'free-agency', week: 9, dropPid: 'mine' } });
let button = flatten(tree).find(node => node.type === 'button' && node.children.includes('Plan waiver'));
assert.ok(button, 'a free-agent card offers a waiver plan, not a trade');
button.props.onClick();
assert.equal(window.WR.acquisitionContext.pid, 'fa');
assert.equal(window.WR.acquisitionContext.week, 9);
assert.equal(window.WR.acquisitionContext.dropPid, 'mine');
assert.ok(flatten(tree).some(node => node.children.some(value => typeof value === 'string' && value.includes('Owned in 1 of 3 synced leagues'))));
tree = card('other');
button = flatten(tree).find(node => node.type === 'button' && node.children.includes('Find trade'));
assert.ok(button);
button.props.onClick();
assert.equal(window._wrTradeFinderTarget.pid, 'other');
tree = card('rookie', { context: 'draft-board' });
button = flatten(tree).find(node => node.type === 'button' && node.children.includes('View on draft board'));
assert.ok(button);
button.props.onClick();
assert.equal(window.WR.draftPlayerContext.pid, 'rookie');
league.settings.disable_trades = 1;
tree = card('other');
assert.equal(flatten(tree).some(node => node.type === 'button' && node.children.includes('Find trade')), false);

// All consuming modules still compile in the same React-only production transform.
for (const file of ['js/free-agency.js', 'js/draft-room.js']) {
    assert.doesNotThrow(() => Babel.transform(fs.readFileSync(file, 'utf8'), { presets: ['react'] }));
}
console.log('PASS notebook owner/provider/league scopes, migration preservation, action capabilities, contextual handoffs and real player-card actions');

// Exercise the FA component's real effects when targets and waivers reuse the
// same mount. A route prop change must not hide the newly selected target plan.
let stateCursor = 0, effectCursor = 0;
const states = [], effectDeps = [], effectQueue = [];
React.useState = initial => {
    const index = stateCursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
};
React.useEffect = (fn, deps = []) => {
    const index = effectCursor++;
    const prev = effectDeps[index];
    if (!prev || deps.some((value, i) => value !== prev[i])) effectQueue.push(fn);
    effectDeps[index] = deps;
};
for (const hook of ['useState', 'useEffect', 'useMemo', 'useCallback', 'useRef']) context[hook] = (...args) => React[hook](...args);
window.App.normPos = p => p || '';
window.App.calcRawPts = () => 0;
window.App.POS_COLORS = { TE: '#fff' };
context.wrAlpha = value => value;
context.posColors = { TE: '#fff' };
context.fonts = {};
context.InlineCareerStats = () => null;
context.Tip = () => null;
league.rosters = rosters;
league.settings.waiver_budget = 100;
N.update('fa', { watch: true });
load('js/free-agency.js', true);
function faRender(initialView) {
    stateCursor = 0; effectCursor = 0;
    const result = context.FreeAgencyTab({ playersData, statsData: {}, prevStatsData: {}, myRoster: rosters[0], currentLeague: league, initialView, viewMode: 'analyst' });
    for (const fn of effectQueue.splice(0)) {
        if (fn.toString().includes('setFaSection')) fn();
    }
    return result;
}
faRender('targets');
tree = faRender('targets');
assert.ok(flatten(tree).some(node => node.type === 'h2' && node.children.includes('Saved targets')));
window.WR.openAcquisition({ pid: 'fa', position: 'TE', week: 7, dropPid: 'mine', source: 'saved-targets' });
faRender(null);
tree = faRender(null);
assert.ok(flatten(tree).some(node => node.props?.className === 'fa-acquisition-plan'), 'context survives a targets-to-waivers route change');
assert.ok(flatten(tree).some(node => node.props?.className === 'fa-market-shell' && node.props.hidden === false), 'filtered market remains visible after route prop effect');
assert.equal(window.WR.acquisitionContext.dropPid, 'mine');
faRender('targets');
tree = faRender('targets');
assert.ok(flatten(tree).some(node => node.type === 'h2' && node.children.includes('Saved targets')), 'explicit target navigation wins over a retained plan');
console.log('PASS saved-targets to waiver-plan mount reuse and view-prop effect ordering');
