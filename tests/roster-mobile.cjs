'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const walk = n => n == null || typeof n === 'boolean' ? [] : Array.isArray(n) ? n.flatMap(walk) : typeof n === 'object' ? [n, ...walk(n.children)] : [n];
const text = n => walk(n).filter(x => typeof x !== 'object').join('');
const find = (n, fn) => walk(n).find(x => typeof x === 'object' && fn(x));
const all = (n, fn) => walk(n).filter(x => typeof x === 'object' && fn(x));
let slots = [], index = 0, tree, activeTab;
const events = [];
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
  innerWidth: 390, addEventListener: noop, removeEventListener: noop, dispatchEvent: event => events.push(event),
  RosterPlayerStats: 'roster-stats',
  wrIsPro: () => true,
  WR: { useViewport: () => ({ width, isPhone: width < 768 }), GmMode: { useGmEffects: () => ({ mode: 'compete', modeLabel: 'Compete' }), getPreset: () => ({}) }, AssetRow: 'asset-row', CardList: 'card-list', FilterSheet: 'filter-sheet', Sheet: 'sheet' },
  App: { calcRawPts: s => s.pts || 0, normPos: p => p, POS_COLORS: {}, LI: { playerScores: { starter: 8000, bench: 100, ir: 4000, taxi: 2000 } }, NFLByes: { seasonFor: () => 2026, label: () => 'Bye 7', rosterWeeks: () => ({ weeks: [], unknown: [] }) } },
};
const context = { window: root, React, console, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, InlineCareerStats: 'career', getPlayerAnnotation: () => null, wrAlpha: color => color, setTimeout: fn => fn(), requestAnimationFrame: noop, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem: noop } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/roster-review.js','utf8'),context);
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/my-team.js', 'utf8'), { presets: ['react'] }).code, context);
const props = {
  myRoster,
  currentLeague: { league_id: 'league', roster_positions: ['WR', 'RB', 'BN'], settings: { reserve_slots: 1, taxi_slots: 1 }, scoring_settings: {}, rosters: [myRoster] },
  leagueSkin: { type: 'dynasty', features: { showWeeklyVerdict: false, showFuturePicks: true, showTaxi: true } },
  playersData, statsData: {}, stats2025Data: {}, standings: [],
  rosterFilter: 'All', rosterSort: { key: 'name', dir: 1 }, visibleCols: ['pos', 'age', 'dhq', 'posRankLg', 'ppg', 'durability', 'peak', 'action', 'sos'], expandedPid: null, showColPicker: false, colPreset: 'default',
  setActiveTab: tab => activeTab = tab,
};
for (const key of ['rosterFilter', 'rosterSort', 'visibleCols', 'expandedPid', 'showColPicker', 'colPreset']) props['set' + key[0].toUpperCase() + key.slice(1)] = value => { props[key] = typeof value === 'function' ? value(props[key]) : value; };
function render() { index = 0; tree = context.MyTeamTab(props); return tree; }
const button = label => find(tree, n => n.type === 'button' && (text(n) === label || n.props['aria-label'] === label));
function click(label) { const b = button(label); assert(b, 'button ' + label); b.props.onClick(); render(); }
const rowPids = () => all(tree, n => n.props.className === 'wr-roster-mobile-player').map(n => n.props['data-wr-roster-pid']);
render();
assert.equal(tree.props.className, 'wr-roster-mobile');
assert(text(find(tree, n => n.props.className === 'wr-roster-mobile-summary')).includes('2 / 3'), 'IR and taxi do not consume active capacity');
assert(text(tree).includes('1 open'));
assert(text(tree).includes('0–0 record'), 'An actual zero record stays visible');
assert.equal(rowPids().length, 4);
const controls = find(tree, n => n.props.className === 'wr-roster-mobile-controls');
assert.equal(all(controls, n => n.type === 'input' && n.props.type === 'search').length, 1, 'The player controls contain one search');
assert.equal(all(controls, n => n.type === 'h3').length, 0, 'A repeated Players title does not consume a control row');
assert.equal(button('Roster view and sort').props.title, 'Position · Player A–Z', 'Current grouping and direction are visible before opening settings');
assert(button('Starters1') && button('Bench1') && button('IR1') && button('Taxi1'));
assert(text(find(tree, n => n.props['data-wr-roster-pid'] === 'bench')).includes('Questionable'));
assert(text(find(tree, n => n.props['data-wr-roster-pid'] === 'ir')).includes('NYJ · IR'));
assert.deepEqual(all(tree, n => n.props.className === 'wr-roster-position-icon').map(text), ['QB', 'RB', 'WR', 'WR'], 'Every phone row has a labeled position badge');
assert.equal(find(tree, n => n.props.className === 'wr-roster-position-icon').props.style['--wr-position-color'], '#e74c3c', 'Badge uses the established position palette when the shared palette is not populated');
assert(!text(find(tree, n => n.props['data-wr-roster-pid'] === 'ir')).includes('IR · IR'), 'Matching injury and roster statuses appear once');
playersData.ir.injury_status = 'PUP'; render(); assert(text(find(tree, n => n.props['data-wr-roster-pid'] === 'ir')).includes('IR · PUP'), 'Distinct injury status stays visible for a reserve player'); playersData.ir.injury_status = 'IR'; render();
assert(!text(tree).includes('Healthy'), 'Missing injury status is not converted to a health claim');
const content = find(tree, n => n.props.className === 'wr-roster-mobile-content');
const contentNodes = walk(content).filter(n => typeof n === 'object');
assert(contentNodes.some(n => n.props.className === 'wr-roster-mobile-players'), 'Mobile keeps the player list as the roster focus');
assert(!text(tree).includes('GM’s Desk · Roster Review'), 'Mobile removes the desktop GM desk planning panel');
assert(!find(tree,n=>n.props['data-wr-drop-flag']==='1'),'Under-capacity bench players do not become automatic drops');
for (const [label, pid] of [['Starters1', 'starter'], ['Bench1', 'bench'], ['IR1', 'ir'], ['Taxi1', 'taxi']]) { click(label); assert.deepEqual(rowPids(), [pid], label + ' reflects real roster membership'); }
click('All4');
const search = find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Search your roster');
search.props.onChange({ target: { value: 'Questionable' } }); render(); assert.equal(rowPids().length, 0, 'Search remains identity/team/position scoped');
click('Show all players'); assert.equal(rowPids().length, 4);
const bench = find(tree, n => n.props['data-wr-roster-pid'] === 'bench');
find(bench, n => n.props.className === 'wr-roster-mobile-player-trigger').props.onClick(); render();
assert.equal(props.expandedPid, 'bench');
assert(button('Build a trade') && button('Set lineup') && button('Ask Alex'), 'Primary player actions remain beside the expanded profile');
assert(!button('Trade Finder') && !button('COLLAPSE') && !button('Back to roster ↑'), 'Mobile detail removes duplicate lower controls');
assert(!text(tree).includes('Full player profile'), 'Mobile detail renders the player profile directly without a second disclosure');
assert.equal(find(tree, n => n.type === 'roster-stats').props.phone, true, 'Mobile mounts the compact stats views');
assert.equal(find(tree, n => n.type === 'roster-stats').props.leagueType, 'dynasty');
const phoneDetail = find(tree, n => n.props.className === 'wr-roster-mobile-detail');
const detailNodes = walk(phoneDetail).filter(n => typeof n === 'object');
assert.equal(all(phoneDetail, n => n.type === 'roster-stats').length, 1, 'An expanded phone player mounts one stats view');
assert.equal(all(phoneDetail, n => n.type === 'img').length, 0, 'The open row supplies identity without a duplicate dossier portrait');
assert(text(find(phoneDetail, n => n.props.className === 'wr-roster-player-bio')).includes('Age 30'), 'The compact dossier retains actual profile facts');
assert(detailNodes.indexOf(find(phoneDetail, n => n.type === 'roster-stats')) < detailNodes.indexOf(find(phoneDetail, n => n.props.className === 'wr-roster-player-signals-grid')));
assert(detailNodes.indexOf(find(phoneDetail, n => n.type === 'roster-stats')) < detailNodes.indexOf(find(phoneDetail, n => n.props.className === 'wr-roster-player-age-curve')), 'Scoring evidence precedes the longer age profile');
button('Build a trade').props.onClick(); assert.equal(activeTab, 'trades');
assert.equal(root._wrTradeBuilderTarget.pid, 'bench'); assert.equal(root._wrTradeBuilderTarget.returnTab, 'myteam');
assert.equal(events.at(-1).type, 'wr:open-trade-builder'); assert.equal(events.at(-1).detail.pid, 'bench');
button('Set lineup').props.onClick(); assert.equal(activeTab, 'lineup', 'Lineup planning remains owned by Game Day');
button('Ask Alex').props.onClick(); assert.equal(events.at(-1).type, 'wr:mission-alex-open'); assert.equal(events.at(-1).detail.pid, 'bench');
assert(!find(tree, n => n.props.className === 'wr-roster-mobile-detail-facts'), 'Mobile detail removes duplicate age and bye facts');
assert(!find(tree, n => n.props.className === 'wr-roster-mobile-detail-stats'), 'Mobile detail removes duplicate DHQ and scoring stats');
const expandedBench = find(tree, n => n.props['data-wr-roster-pid'] === 'bench');
find(expandedBench, n => n.props.className === 'wr-roster-mobile-player-trigger').props.onClick(); render();
assert.equal(props.expandedPid, null);
click('Roster view and sort');
assert(find(tree, n => n.type === 'filter-sheet' && n.props.title === 'Roster view & sort'));
assert(find(tree, n => n.type === 'select' && n.props.title === 'Sort the roster'));
find(tree, n => n.type === 'select' && n.props.title === 'Sort the roster').props.onChange({ target: { value: 'dhq' } }); render();
assert.deepEqual(rowPids(), ['starter', 'ir', 'taxi', 'bench'], 'DHQ sort orders the entire roster across positions and roster sections');
assert.equal(find(tree, n => n.type === 'select' && n.props.title === 'Sort the roster').props.value, 'dhq');
assert.equal(find(tree, n => n.type === 'select' && n.props.title === 'Group rows by').props.value, 'none', 'explicit sort clears position grouping');
find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort').props.onClick(); render();
assert.deepEqual(rowPids(), ['bench', 'taxi', 'ir', 'starter'], 'the direction control reverses the complete sorted roster');
assert.equal(button('Roster view and sort').props.title, 'Value ↑');
const priorDirection = props.rosterSort.dir;
find(tree, n => n.type === 'select' && n.props.title === 'Sort the roster').props.onChange({ target: { value: 'dhq' } }); render();
assert.equal(props.rosterSort.dir, priorDirection, 'Selecting the current sort does not unexpectedly reverse it');
assert(!find(tree, n => n.type === 'select' && n.props.title === 'Column preset'), 'Player list hides full-table column presets');
assert(!find(tree, n => n.type === 'select' && n.props.title === 'Row density'), 'Player list hides full-table row density');
assert(!find(tree, n => n.type === 'select' && n.props.title === 'Points-per-game window'), 'Shared list metrics do not expose a different table PPG window');
assert(find(tree, n => n.props.className === 'wr-roster-view-grid'), 'Core settings are grouped into a compact grid');
assert(!button('Apply') && button('Done'), 'Immediate settings close with Done');
const listColumns = props.visibleCols.slice();
find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Search your roster').props.onChange({ target: { value: 'missing' } }); props.expandedPid = 'bench'; render();
click('Reset'); assert.deepEqual(props.visibleCols, listColumns, 'Resetting list settings preserves hidden full-table columns');
assert.equal(rowPids().length, 4); assert.equal(props.expandedPid, null);
assert.equal(find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Search your roster').props.value, '', 'Reset clears the visible player search as well as scopes');
assert(text(find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort')).includes('A to Z'), 'Alphabetical order has an alphabetical label');
click('Full table');
assert(find(tree, n => n.type === 'select' && n.props.title === 'Column preset'), 'Full table retains all column presets');
assert(find(tree, n => n.type === 'select' && n.props.title === 'Row density'));
assert(find(tree, n => n.type === 'select' && n.props.title === 'Points-per-game window'));
assert(find(tree, n => n.type === 'button' && n.props.title === 'Add, remove, or reorder columns'));
click('Done');
assert.equal(rowPids().length, 0); assert(text(tree).includes('Roster Board'), 'Full table remains an explicit reachable layout');
click('Roster view and sort'); click('Player list'); click('Done');
root._playerTags={bench:'cut'}; render();
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
assert(text(tree).includes('GM’s Desk · Roster Review'), 'Desktop retains the GM desk planning panel');
console.log('PASS mobile roster: capacity, roster scopes, skin restrictions, search, direct player profile, view controls, unknown facts, and desktop path');
// Redraft points must never inherit the value rating's units, order, or fallback.
width = 390; slots = [];
props.leagueSkin = {type:'redraft',features:{showWeeklyVerdict:true,showTaxi:true},vocabulary:{valueLabel:'Season value',valueShortLabel:'Season value'}};
root._playerTags={};
root.getPlayerAction=pid=>({label:pid==='bench'?'Start':'Depth',action:'START',reason:'Weekly lineup role'});
props.myRoster = myRoster;
props.currentLeague.roster_positions = ['WR','RB','BN'];
props.rosterFilter = 'All'; props.rosterSort = {key:'dhq',dir:1}; props.visibleCols = ['dhq'];
root.App.PlayerValue = {getRosPoints: pid => ({starter:180,bench:240,ir:0})[pid] ?? null};
render();
assert(!find(tree,n=>n.props['data-wr-drop-flag']==='1'),'Redraft START and DEPTH bench roles are not drop evidence');
find(tree,n=>n.props.className==='wr-roster-mobile-review').props.onClick(); render();
assert(text(tree).includes('No roster reductions are required'));
assert(!find(tree,n=>n.type==='asset-row'&&n.props.key?.startsWith('rv-')),'No invented drop rows when no reduction is required');
assert(button('Compare waiver upgrades'));
const activeReview=find(tree,n=>n.type==='sheet'&&n.props.title==='Review roster'); activeReview.props.onClose(); render();
click('Roster view and sort');
find(tree, n => n.type === 'select' && n.props.title === 'Group rows by').props.onChange({target:{value:'none'}}); render();
click('Done');
assert.deepEqual(rowPids(),['bench','starter','ir','taxi'],'ROS pts sorts by displayed points, not the underlying value rating');
assert(text(tree).includes('ROS pts'),'mobile points label identifies its unit');
const taxiRow = find(tree,n=>n.props['data-wr-roster-pid']==='taxi');
assert(!text(taxiRow).includes('2,000'),'missing points cannot fall back to a rating');
width=1024; render();
const pointCells=all(tree,n=>n.props.title==='Projected fantasy points over the remaining season. Not a 0–10,000 value rating.');
assert.equal(pointCells.length,4);
assert.deepEqual(pointCells.map(text),['240','180','0','—']);
assert(pointCells.every(n=>!n.props.style.background),'point cells do not use rating tier colors');
console.log('PASS redraft ROS point labels, point sorting, neutral colors, zero, and missing evidence');

// Manual decisions keep their own reason and never compete with taxi advice.
width=390; slots=[]; props.expandedPid='bench'; props.rosterFilter='All';
props.leagueSkin={type:'dynasty',features:{showWeeklyVerdict:false,showTaxi:true,showFuturePicks:true}};
props.currentLeague={...props.currentLeague,roster_positions:['WR','RB','BN'],settings:{taxi_slots:2,taxi_years:1}};
playersData.bench.years_exp=0;
root._playerTags={}; render();
find(tree,n=>n.type==='button'&&n.props.title==='Tap to set your own call').props.onClick({stopPropagation:noop}); render();
button('Drop').props.onClick({stopPropagation:noop}); render();
find(tree,n=>n.props.className==='wr-roster-mobile-review').props.onClick(); render();
const plannedList=find(tree,n=>n.type==='card-list');
assert(plannedList.props.groups.some(group=>group.label==='Your planned drops'));
assert(!plannedList.props.groups.some(group=>group.label==='Taxi moves'),'Manual Drop overrides a taxi suggestion even after the cut tag clears');
const plannedRow=find(plannedList,n=>n.type==='asset-row');
assert.equal(text(plannedRow.props.verdict),'Your drop');
assert.equal(text(plannedRow.props.details),'You marked this player for a drop.');
assert(!text(plannedRow.props.verdict).includes('Start'),'Review badge describes its decision rather than a weekly role');
console.log('PASS roster review: no fabricated drops, manual decision reasons, and no contradictory taxi advice');

slots=[]; props.expandedPid=null; root._playerTags={};
props.currentLeague={...props.currentLeague,roster_positions:['WR'],settings:{taxi_slots:1,taxi_years:1}};
render(); find(tree,n=>n.props.className==='wr-roster-mobile-review').props.onClick(); render();
const roomList=find(tree,n=>n.type==='card-list');
assert(roomList.props.groups.some(group=>group.label==='Make room'));
const roomRow=find(roomList,n=>n.type==='asset-row');
assert.equal(text(roomRow.props.verdict),'Compare');
assert.match(text(roomRow.props.details),/Active roster is 1 over its 1-player limit/);
assert(!text(roomRow.props.verdict).includes('Start'));
console.log('PASS roster room-making review: action and visible reason match the real capacity requirement');

slots=[]; props.currentLeague.roster_positions=['WR','RB','BN']; props.currentLeague.settings={taxi_slots:1};
root.getPlayerAction=()=>({label:'Hold',action:'HOLD',reason:'Keep this player for lineup coverage.'});
root.WR.GmMode.useGmEffects=()=>({mode:'compete',sellPositions:vm.runInContext('new Set(["RB"])',context)});
props.leagueSkin={type:'redraft',features:{showWeeklyVerdict:true,showTaxi:false,showFuturePicks:false}};
render(); find(tree,n=>n.props.className==='wr-roster-mobile-review').props.onClick(); render();
assert(!find(tree,n=>n.type==='card-list'),'Local GM fallback cannot turn a real Hold read into a Sell badge with a Hold reason');


// Shared player-list columns control their own sorts, independently of full-table preferences.
vm.runInContext(fs.readFileSync('js/shared/player-metrics.js', 'utf8'), context);
const sharedMetrics = root.WR.PlayerMetrics;
let metricSelection = ['proj', 'ppg', 'dhq', 'age'];
root.WR.PlayerMetrics = { ...sharedMetrics, useMetrics: () => ({ selected: metricSelection }), Picker: 'metrics-picker' };
const l5Points = { starter: 12, bench: 0, ir: -2.5, taxi: null };
const projectionPoints = { starter: 15, bench: 0, ir: -3, taxi: null };
root.App.WeeklyProj = {
  optimalForRoster: () => ({ objective: 'ceiling', optimal: { starters: [] }, projections: Object.fromEntries(Object.keys(playersData).map(pid => [pid, { available: projectionPoints[pid] != null, points: { median: projectionPoints[pid], ceiling: -100 * projectionPoints[pid] } }])) }),
  formStats: (pid, window) => window === 5 && Number.isFinite(l5Points[pid]) ? { rollingPPG: l5Points[pid] } : null,
};
root.App.computeRollingPPG = () => 999;
root.App.NFLByes.weekForPlayer = player => ({ MIN: 10, CHI: 5, NYJ: null, ATL: 1 })[player.team];
root.WR.GmMode.useGmEffects = () => ({ mode: 'compete', modeLabel: 'Compete' });
root._playerTags = {};
width = 390; slots = [];
props.myRoster = myRoster;
props.currentLeague = { league_id: 'league', roster_positions: ['WR', 'RB', 'BN'], settings: {}, scoring_settings: {}, rosters: [myRoster] };
props.leagueSkin = { type: 'redraft', features: { showWeeklyVerdict: true, showTaxi: true } };
props.rosterFilter = 'All'; props.rosterSort = { key: 'name', dir: 1 }; props.expandedPid = null;
props.visibleCols = ['pos', 'peak', 'action'];
props.statsData = { starter: { gp: 1, pts: -1 }, bench: { gp: 1, pts: 3 }, ir: { gp: 1, pts: 0 } };
render(); click('Roster view and sort');
const sortSelect = () => find(tree, n => n.type === 'select' && n.props.title === 'Sort the roster');
const sortOptions = () => all(sortSelect(), n => n.type === 'option').map(n => ({ key: n.props.value, label: text(n) }));
const chooseSort = key => { sortSelect().props.onChange({ target: { value: key } }); render(); };
const metricText = (pid, metric) => text(find(find(tree, n => n.props['data-wr-roster-pid'] === pid), n => n.props.className === 'mc-roster-metrics').children[0].find(n => n.props.key === metric));
assert.deepEqual(sortOptions(), [
  { key: 'name', label: 'Player' }, { key: 'pos', label: 'Position' },
  { key: 'listproj', label: 'Projection' }, { key: 'l5ppg', label: 'Last 5 PPG' },
  { key: 'dhq', label: 'ROS points' }, { key: 'age', label: 'Age' },
], 'Player-list sort options follow its actual shared columns rather than hidden table Peak/Move fields');
props.rosterSort = { key: 'action', dir: 1 }; render();
assert.deepEqual(sortOptions().at(-1), { key: 'action', label: 'Move (saved sort)' }, 'An off-list persisted sort remains visible and clearly identified');
props.rosterSort = { key: 'name', dir: 1 }; render();
click('Full table');
assert.deepEqual(sortOptions().map(option => option.key), ['name', 'pos', 'peak', 'action'], 'Full table retains its own column sort options');
find(tree, n => n.type === 'select' && n.props.title === 'Points-per-game window').props.onChange({ target: { value: 'l3' } }); render();
click('Player list');
chooseSort('listproj');
assert.deepEqual(rowPids(), ['starter', 'bench', 'ir', 'taxi'], 'Projection follows the displayed median rather than the hidden table ceiling objective');
assert.equal(metricText('bench', 'proj'), '0.0PROJ');
assert.equal(metricText('ir', 'proj'), '-3.0PROJ');
assert.equal(metricText('taxi', 'proj'), '—PROJ');
find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort').props.onClick(); render();
assert.deepEqual(rowPids(), ['ir', 'bench', 'starter', 'taxi'], 'Unknown projections stay last after a negative projection in either direction');
chooseSort('l5ppg');
assert.deepEqual(rowPids(), ['starter', 'bench', 'ir', 'taxi'], 'Last-five sort uses the displayed observation, retaining positive, zero, negative, then unknown');
assert.equal(metricText('starter', 'ppg'), '12.0L5 PPG');
assert.equal(metricText('bench', 'ppg'), '0.0L5 PPG');
assert.equal(metricText('ir', 'ppg'), '-2.5L5 PPG');
assert.equal(metricText('taxi', 'ppg'), '—L5 PPG', 'Missing rolling data does not inherit seasonal points or the saved table rolling window');
assert(text(find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort')).includes('High to low'));
find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort').props.onClick(); render();
assert.deepEqual(rowPids(), ['ir', 'bench', 'starter', 'taxi'], 'Unknown L5 observations remain last when the direction reverses');
assert(text(find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort')).includes('Low to high'));
props.rosterSort = { key: 'ppg', dir: 1 }; render();
assert.deepEqual(sortOptions().at(-1), { key: 'ppg', label: 'Table PPG (saved sort)' }, 'A saved table PPG sort is not silently relabeled or migrated to L5');
metricSelection = ['season', 'bye', 'matchup']; props.rosterSort = { key: 'name', dir: 1 }; render();
assert.deepEqual(sortOptions(), [
  { key: 'name', label: 'Player' }, { key: 'pos', label: 'Position' },
  { key: 'seasonppg', label: 'Season PPG' }, { key: 'bye', label: 'Bye week' },
], 'Selection changes refresh the menu and omit matchup grades because no grade comparator is supported');
chooseSort('seasonppg');
assert.deepEqual(rowPids(), ['bench', 'ir', 'starter', 'taxi'], 'Season sort uses the displayed season PPG with valid zero and negative values');
assert.equal(metricText('bench', 'season'), '3.0SZN PPG');
assert.equal(metricText('ir', 'season'), '0.0SZN PPG');
assert.equal(metricText('taxi', 'season'), '—SZN PPG');
find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort').props.onClick(); render();
assert.deepEqual(rowPids(), ['starter', 'ir', 'bench', 'taxi'], 'Unknown season PPG remains last in both directions');
chooseSort('bye');
assert.deepEqual(rowPids(), ['taxi', 'bench', 'starter', 'ir'], 'Bye sort follows the shown week and keeps missing weeks last');
assert(text(find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort')).includes('Low to high'));
find(tree, n => n.type === 'button' && n.props.title === 'Reverse the sort').props.onClick(); render();
assert.deepEqual(rowPids(), ['starter', 'bench', 'taxi', 'ir']);
props.leagueSkin.type = 'dynasty'; metricSelection = ['proj', 'ppg', 'dhq', 'age']; props.rosterSort = { key: 'name', dir: 1 }; render();
assert(sortOptions().some(option => option.key === 'dhq' && option.label === 'Player value'), 'Dynasty sorts use the same value unit as the list');
chooseSort('l5ppg');
assert.equal(button('Roster view and sort').props.title, 'Last 5 PPG ↓', 'The closed toolbar identifies the actual shared metric rather than a saved table window');
const preservedTableColumns = props.visibleCols.slice();
find(tree, n => n.type === 'input' && n.props['aria-label'] === 'Search your roster').props.onChange({ target: { value: 'Reserve' } }); render();
click('Reset');
assert.deepEqual(metricSelection, ['proj','ppg','dhq','age'], 'Resetting the roster view cannot rewrite shared account/league columns');
assert.deepEqual(props.visibleCols, preservedTableColumns);
assert.equal(rowPids().length, 4);
click('Full table');
assert.equal(find(tree, n => n.type === 'select' && n.props.title === 'Points-per-game window').props.value, 'l3', 'A list reset leaves the separate table PPG window intact');
click('Player list'); click('Done');
props.expandedPid = 'bench'; root.getPlayerAction = () => ({ label: 'Hold', action: 'HOLD', reason: 'Keep this player for lineup coverage.' }); render();
assert.equal(text(find(tree, n => n.props.className === 'wr-roster-player-call')), 'Keep this player for lineup coverage.', 'The actual roster explanation stays visible before scoring evidence');
root._playerTags = { bench: 'cut' }; render();
assert.equal(text(find(tree, n => n.props.className === 'wr-roster-player-call')), 'Your call: Cut.', 'A manual call never inherits a contradictory engine explanation');
root.wrIsPro = () => false; render();
assert(!find(tree, n => n.props.className === 'wr-roster-player-call'), 'The compact dossier preserves the Pro boundary for roster explanations');
assert(find(tree, n => n.type === 'roster-stats'), 'Raw player statistics remain available without Pro');
root.wrIsPro = () => true; props.expandedPid = null; props.leagueSkin.type = 'chopped'; render();
assert(!text(find(tree, n => n.props.className === 'wr-roster-mobile-summary')).includes('record'), 'Chopped does not present an unrelated head-to-head record');
console.log('PASS shared roster metrics: visible-column sort options, separate table preferences, explicit saved sorts, L5/season/bye ordering, signed values and unavailable last in both directions');
// IDP aliases share a color family without changing the player's visible role.
const corePositionSource=fs.readFileSync('js/core.js','utf8');
root.App.POS_COLORS={QB:'#existing-quarterback'};
vm.runInContext(corePositionSource.slice(corePositionSource.indexOf('    // Position colors —'),corePositionSource.indexOf('    // Age curves default')),context);
delete root.App.normPos;
vm.runInContext(corePositionSource.slice(corePositionSource.indexOf('    window.App.normPos ='),corePositionSource.indexOf('    // posLabel —')),context);
assert.equal(root.App.POS_COLORS.QB,'#existing-quarterback','An imported offense palette is preserved');
for (const [family,aliases] of Object.entries({DL:['DL','DE','DT','NT','IDL','EDGE'],LB:['LB','OLB','ILB','MLB'],DB:['DB','CB','S','SS','FS'],IDP:['IDP','IDP_FLEX']})) {
  for(const alias of aliases) assert.equal(root.App.positionColor(alias.toLowerCase()),root.App.POS_COLORS[family],alias+' resolves to its defensive color family');
}
assert.equal(root.App.positionColor('UNKNOWN'),null,'Unknown roles do not inherit a defensive color');
slots=[];width=390;
const defenders={end:{full_name:'Edge Defender',position:'EDGE',team:'PIT'},mike:{full_name:'Middle Linebacker',position:'MLB',team:'SF'},safety:{full_name:'Strong Safety',position:'SS',team:'SEA'}};
props.playersData=defenders;props.statsData={};props.stats2025Data={};props.rosterFilter='All';props.rosterSort={key:'name',dir:1};props.expandedPid=null;
props.myRoster={roster_id:1,players:Object.keys(defenders),starters:Object.keys(defenders),reserve:[],taxi:[],settings:{}};
props.currentLeague={league_id:'idp-league',season:2026,roster_positions:['DL','LB','DB'],scoring_settings:{},settings:{type:2},rosters:[props.myRoster]};
props.leagueSkin={type:'dynasty',features:{showWeeklyVerdict:false,showFuturePicks:true,showTaxi:false}};
render();
const defensiveBadges=all(tree,n=>n.props.className==='wr-roster-position-icon');
assert.deepEqual(defensiveBadges.map(text),['EDGE','MLB','SS'],'Mobile roster preserves specific defensive position labels while grouping by canonical roles');
assert.deepEqual(defensiveBadges.map(n=>n.props.style['--wr-position-color']),['DL','LB','DB'].map(pos=>root.App.POS_COLORS[pos]));
assert.equal(root.App.normPos('EDGE'),'DL','Color labels do not change the existing roster eligibility normalizer');
console.log('PASS IDP roster icons: imported palettes, defensive family aliases, distinct groups, raw position labels and unchanged eligibility');
context.document.getElementById=()=>({});
vm.runInContext(Babel.transform(fs.readFileSync('js/components/wr-primitives.js','utf8'),{presets:['react']}).code,context);
const linebackerBadge=root.WR.Badge({label:'OLB',kind:'OLB'});
assert.equal(text(linebackerBadge),'OLB');assert.equal(linebackerBadge.props.style.color,root.App.POS_COLORS.LB,'Shared badges use the canonical defensive color without rewriting the label');
const secondaryAsset=root.WR.AssetRow({pos:'SS',name:'Strong Safety',slots:[]});
const secondaryAvatar=find(secondaryAsset,n=>n.props.className==='wr-asset-avatar');
assert.equal(text(secondaryAvatar),'SS');assert.equal(secondaryAvatar.props.style.color,root.App.POS_COLORS.DB,'Shared player tiles use the same secondary palette');
const quarterbackAsset=root.WR.AssetRow({pos:'QB',name:'Quarterback',slots:[]});
assert.equal(find(quarterbackAsset,n=>n.props.className==='wr-asset-avatar').props.style.color,'#F0997B','Existing offense tile colors stay unchanged');
