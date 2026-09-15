'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const walk = n => n == null || typeof n === 'boolean' ? [] : Array.isArray(n) ? n.flatMap(walk) : typeof n === 'object' ? [n, ...walk(n.children)] : [n];
const text = n => walk(n).filter(x => typeof x !== 'object').join('');
const find = (n, fn) => walk(n).find(x => typeof x === 'object' && fn(x));
const all = (n, fn) => walk(n).filter(x => typeof x === 'object' && fn(x));
let slots = [], index = 0, tree;
let width = 390;
const noop = () => {};
const React = {
  Fragment: 'fragment',
  useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
  useMemo(fn) { index++; return fn(); },
  useCallback(fn) { index++; return fn; },
  useRef(initial) { const i = index++; return slots[i] ||= { current: initial }; },
  useEffect: noop, useLayoutEffect: noop,
  createElement(type, props, ...children) {
    props ||= {};
    if (type === 'sheet' || type === 'filter-sheet') return props.open ? { type, props, children: [...(props.sections || []).map(s => s.node), props.footer, ...children] } : null;
    if (type === 'card-list') return { type, props, children: (props.groups || []).flatMap(g => g.rows) };
    return { type, props, children };
  },
};
const playersData = {
  starter: { full_name: 'Starter Receiver', position: 'WR', team: 'MIN', age: 25 },
  bench: { full_name: 'Bench Runner', position: 'RB', team: 'CHI', age: 30, injury_status: 'Questionable' },
  ir: { full_name: 'Reserve Receiver', position: 'WR', team: 'NYJ', age: 24, injury_status: 'IR' },
  taxi: { full_name: 'Taxi Quarterback', position: 'QB', team: 'ATL', age: 22, years_exp: 0 },
};
const myRoster = { roster_id: 1, players: Object.keys(playersData), starters: ['starter'], reserve: ['ir'], taxi: ['taxi'], settings: { wins: 0, losses: 0, ties: 0 } };
const root = {
  innerWidth: 390, addEventListener: noop, removeEventListener: noop,
  wrIsPro: () => true,
  WR: { useViewport: () => ({ width, isPhone: width < 768 }), GmMode: { useGmEffects: () => ({ mode: 'compete', modeLabel: 'Compete' }), getPreset: () => ({}) }, AssetRow: 'asset-row', CardList: 'card-list', FilterSheet: 'filter-sheet', Sheet: 'sheet' },
  App: { calcRawPts: s => s.pts || 0, normPos: p => p, POS_COLORS: {}, LI: { playerScores: { starter: 8000, bench: 100, ir: 4000, taxi: 2000 } }, NFLByes: { seasonFor: () => 2026, label: () => 'Bye 7', rosterWeeks: () => ({ weeks: [], unknown: [] }) } },
};
const context = { window: root, React, console, InlineCareerStats: 'career', getPlayerAnnotation: () => null, wrAlpha: color => color, setTimeout: fn => fn(), requestAnimationFrame: noop, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem: noop } };
vm.createContext(context);
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/my-team.js', 'utf8'), { presets: ['react'] }).code, context);
const props = {
  myRoster,
  currentLeague: { league_id: 'league', roster_positions: ['WR', 'RB', 'BN'], settings: { reserve_slots: 1, taxi_slots: 1 }, scoring_settings: {}, rosters: [myRoster] },
  leagueSkin: { type: 'dynasty', features: { showWeeklyVerdict: false, showFuturePicks: true, showTaxi: true } },
  playersData, statsData: {}, stats2025Data: {}, standings: [],
  rosterFilter: 'All', rosterSort: { key: 'name', dir: 1 }, visibleCols: ['pos', 'age', 'dhq', 'posRankLg', 'ppg', 'durability', 'peak', 'action', 'sos'], expandedPid: null, showColPicker: false, colPreset: 'default',
};
for (const key of ['rosterFilter', 'rosterSort', 'visibleCols', 'expandedPid', 'showColPicker', 'colPreset']) props['set' + key[0].toUpperCase() + key.slice(1)] = value => { props[key] = typeof value === 'function' ? value(props[key]) : value; };
function render() { index = 0; tree = context.MyTeamTab(props); return tree; }
const button = label => find(tree, n => n.type === 'button' && text(n) === label);
function click(label) { const b = button(label); assert(b, 'button ' + label); b.props.onClick(); render(); }
const rowPids = () => all(tree, n => n.props.className === 'wr-roster-mobile-player').map(n => n.props['data-wr-roster-pid']);
render();
assert.equal(tree.props.className, 'wr-roster-mobile');
assert(text(find(tree, n => n.props.className === 'wr-roster-mobile-summary')).includes('2 / 3'), 'IR and taxi do not consume active capacity');
assert(text(tree).includes('1 open'));
assert(text(tree).includes('0–0 record'), 'An actual zero record stays visible');
assert.equal(rowPids().length, 4);
assert(button('Starters1') && button('Bench1') && button('IR1') && button('Taxi1'));
assert(text(find(tree, n => n.props['data-wr-roster-pid'] === 'bench')).includes('Questionable'));
assert(text(find(tree, n => n.props['data-wr-roster-pid'] === 'ir')).includes('WR · NYJ · IR'));
assert(!text(find(tree, n => n.props['data-wr-roster-pid'] === 'ir')).includes('IR · IR'), 'Matching injury and roster statuses appear once');
playersData.ir.injury_status = 'PUP'; render(); assert(text(find(tree, n => n.props['data-wr-roster-pid'] === 'ir')).includes('IR · PUP'), 'Distinct injury status stays visible for a reserve player'); playersData.ir.injury_status = 'IR'; render();
assert(!text(tree).includes('Healthy'), 'Missing injury status is not converted to a health claim');
const content = find(tree, n => n.props.className === 'wr-roster-mobile-content');
const contentNodes = walk(content).filter(n => typeof n === 'object');
assert(contentNodes.findIndex(n => n.props.className === 'wr-roster-mobile-players') < contentNodes.findIndex(n => n.props.className === 'wr-roster-mobile-planning'), 'Player list precedes planning in DOM order');
for (const [label, pid] of [['Starters1', 'starter'], ['Bench1', 'bench'], ['IR1', 'ir'], ['Taxi1', 'taxi']]) { click(label); assert.deepEqual(rowPids(), [pid], label + ' reflects real roster membership'); }
click('All4');
const search = find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Search your roster');
search.props.onChange({ target: { value: 'Questionable' } }); render(); assert.equal(rowPids().length, 0, 'Search remains identity/team/position scoped');
click('Show all players'); assert.equal(rowPids().length, 4);
const bench = find(tree, n => n.props['data-wr-roster-pid'] === 'bench');
find(bench, n => n.props.className === 'wr-roster-mobile-player-trigger').props.onClick(); render();
assert.equal(props.expandedPid, 'bench'); assert(button('Trade Finder'), 'Existing roster actions are available in expanded detail');
click('Back to roster ↑'); assert.equal(props.expandedPid, null);
click('View & sort ⌄');
assert(find(tree, n => n.type === 'filter-sheet' && n.props.title === 'Roster view & sort'));
assert(find(tree, n => n.type === 'select' && n.props.title === 'Sort the roster'));
assert(find(tree, n => n.type === 'select' && n.props.title === 'Column preset'));
click('Full table'); click('Apply');
assert.equal(rowPids().length, 0); assert(text(tree).includes('Roster Board'), 'Full table remains an explicit reachable layout');
click('View & sort ⌄'); click('Player list'); click('Apply');
click('Starters1');
find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Search your roster').props.onChange({ target: { value: 'missing' } }); render();
const review = find(tree, n => n.props.className === 'wr-roster-mobile-review'); assert(review); review.props.onClick(); render();
const reviewRow = find(tree, n => n.type === 'asset-row' && n.props.key.startsWith('rv-')); assert(reviewRow); const reviewPid = reviewRow.props.pid; reviewRow.props.onClick(); render();
assert.equal(props.rosterFilter, 'All'); assert.equal(props.expandedPid, reviewPid); assert.equal(rowPids().length, 4, 'Review clears a hiding filter and search before opening the player');
props.expandedPid = null;
props.leagueSkin.features.showTaxi = false; render(); assert(!button('Taxi1'), 'Skin restrictions remove taxi scope');
props.myRoster = { ...myRoster, settings: {} }; props.currentLeague = { ...props.currentLeague, roster_positions: [] }; render();
const summary = text(find(tree, n => n.props.className === 'wr-roster-mobile-summary'));
assert(!summary.includes('record') && !summary.includes('open') && !summary.includes('full'), 'Unknown record and capacity stay unknown');
width = 1024; render(); assert.equal(tree.props.className, undefined); assert(!find(tree, n => n.props.className === 'wr-roster-mobile-players')); assert(text(tree).includes('Roster Board'), 'Desktop retains the full roster board');
console.log('PASS mobile roster: capacity, roster scopes, skin restrictions, search, existing details/actions, view controls, unknown facts, and desktop path');
