'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
let hooks = [], index = 0, board, liveContext, requestedWeek, currentBoardOverride, renderedComponentTypes = [], effects = [];
const storage = new Map();
const boundary = function ScoreboardBoundary() {};
const React = {
    Fragment: 'fragment',
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = index++; return hooks[i] ||= { current: initial }; },
    useMemo(fn) { index++; return fn(); }, useCallback(fn) { index++; return fn; }, useEffect(fn) { effects.push(fn); },
    createElement(type, props, ...children) { if (typeof type === 'function') renderedComponentTypes.push(type); return typeof type === 'function' && type !== boundary ? type({ ...(props || {}), children }) : { type, props: props || {}, children }; }
};
const root = { App: { LeagueLiveScores: { currentWeek: () => 2, useScores: opts => { if (opts.enabled === false) return { week: opts.week, rows: [], status: 'idle' }; requestedWeek = opts.week; return currentBoardOverride && opts.week === 2 ? currentBoardOverride : board; } }, LeagueLiveTable: { useContext: opts => opts.enabled === false ? { enabled: false } : liveContext }, DashboardLeagueLayout: { peek: () => null, leagueId: league => String(league.league_id || league.id || "") }, WrStorage: { get: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, set: (key, value) => storage.set(key, value) } }, WR: { useViewport: () => ({ isPhone: true }) }, LeagueLiveScoreboard: boundary };
let now = Date.parse('2026-10-19T12:00:00Z');
const context = { window: root, React, console, Date: class extends Date { static now() { return now; } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/league-live-standings.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/components/mobile-live-standings.js', 'utf8'), context);
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/league-central.js', 'utf8'), { presets: ['react'] }).code, context);
const league = { league_id: '1234567890123456', season: 2026, name: 'League', settings: { playoff_week_start: 15 }, rosters: [
    { roster_id: 1, settings: { wins: 5, losses: 0, ties: 0, fpts: 500 } }, { roster_id: 2, settings: { wins: 0, losses: 5, ties: 0, fpts: 400 } },
] };
const prior = [{ week: 1, rows: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 80 }] }];
const props = { currentLeague: league, leagueSkin: { features: { showPlayoffOdds: false } }, myRoster: league.rosters[0], playersData: {}, standings: [{ rosterId: 1, teamName: 'Alpha', wins: 5, losses: 0, ties: 0 }, { rosterId: 2, teamName: 'Beta', wins: 0, losses: 5, ties: 0 }], transactions: [], getOwnerName: id => id === 1 ? 'Alpha' : 'Beta' };
const walk = n => n == null || typeof n === 'boolean' ? [] : Array.isArray(n) ? n.flatMap(walk) : typeof n === 'object' ? [n, ...walk(n.children)] : [n];
const text = n => walk(n).filter(n => typeof n !== 'object').join('');
const find = (tree, pred) => walk(tree).find(n => typeof n === 'object' && pred(n));
function render() { index = 0; renderedComponentTypes = []; effects = []; return root.LeagueCentralTab(props); }
function assertAlexFirst(tree) {
    const children = tree.children.flat(Infinity).filter(Boolean);
    assert.equal(children[0].props.className, 'mc-overview-decisions', 'Alex Insights stays above every dynamic Overview card');
    assert.equal(walk(tree).filter(n => n?.props?.className === 'mc-overview-decisions').length, 1, 'Alex Insights renders once per Overview');
}
function reset({ status = 'ready', rows = [], updatedAt = 1000, historical = false, started = [] } = {}) { hooks = []; board = { status, rows, week: 2, updatedAt, supported: true }; liveContext = { enabled: true, historical, currentWeek: historical ? 3 : 2, history: { status: 'ready', priorWeeks: prior, updatedAt: 900 }, startedRosterIds: started, refresh() {} }; }
function table(tree) { return find(tree, n => (n.type === 'table' || n.props.className === 'la-standings') && /standings/.test(n.props['aria-label'] || '')); }
function teamRows(tree) { const container = table(tree); if (container.props.className === 'la-standings') return walk(container).filter(n => n.type === 'details' && n.props.className?.includes('la-report-row')); const body = find(container, n => n.type === 'tbody'); return walk(body).filter(n => n.type === 'tr'); }
for (const status of ['loading', 'error', 'ready']) {
    reset({ status, historical: true, updatedAt: status === 'ready' ? 1000 : null });
    const tree = render(); assert.equal(table(tree).props['aria-label'], 'Official standings');
    assert(!text(tree).includes('Through Week 2'), 'Absent ' + status + ' score feed never claims a completed historical table');
    assert(!text(tree).includes('As it stands'), 'Absent scores never produce live claims');
    assert(text(tree).includes('Official record'));
}
reset({ rows: [{ roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: 1, points: 0 }] });
let tree = render();
assert(text(tree).includes('Entering Week 2'));
assert.equal(table(tree).props['aria-label'], 'Week 2 live standings');
assert(teamRows(tree).some(row => text(row).includes('1-0-0')));
assert(teamRows(tree).every(row => !text(row).includes('Tied')), 'Pregame zero scores do not create phantom ties');
reset({ rows: [{ roster_id: 1, matchup_id: 1, points: 20 }, { roster_id: 2, matchup_id: 1, points: 10 }], started: ['1', '2'] });
tree = render(); assert(text(tree).includes('As it stands · Week 2')); assert(text(teamRows(tree)[0]).includes('Alpha')); assert(text(teamRows(tree)[0]).includes('2-0-0'), 'Live record reconstructs Week 1 plus current result without double-counting official totals');
assert(text(tree).includes('Leading') && text(tree).includes('Trailing'));
const source = find(tree, n => n.props['aria-label'] === 'Standings source');
find(source, n => n.type === 'button' && text(n) === 'Official').props.onClick(); tree = render();
assert.equal(table(tree).props['aria-label'], 'Official standings'); assert(text(teamRows(tree)[0]).includes('5-0-0'));
find(tree, n => n.type === 'button' && text(n) === 'Live').props.onClick(); tree = render();
assert.equal(table(tree).props['aria-label'], 'Week 2 live standings');
board = { ...board, rows: [{ roster_id: 1, matchup_id: 1, points: 5 }, { roster_id: 2, matchup_id: 1, points: 200 }], updatedAt: 2000 };
tree = render(); assert(text(teamRows(tree)[0]).includes('Beta'), 'Changed live results reorder the visible table');
assert(text(teamRows(tree)[0]).includes('1-1-0'));
find(tree, n => n.type === 'button' && text(n) === 'Scores').props.onClick(); tree = render();
let scoreboard = find(tree, n => n.type === boundary);
assert.equal(scoreboard.props.selectedWeek, 2); assert.equal(typeof scoreboard.props.onWeekChange, 'function'); assert.equal(scoreboard.props.onRefresh, liveContext.refresh);
scoreboard.props.onWeekChange(1); tree = render(); scoreboard = find(tree, n => n.type === boundary);
assert.equal(scoreboard.props.selectedWeek, 1); assert.equal(requestedWeek, 1, 'Scoreboard picker and standings feed share the selected week');
reset({ historical: true, rows: [{ roster_id: 1, matchup_id: 1, points: 5 }, { roster_id: 2, matchup_id: 1, points: 200 }], started: ['1', '2'] });
tree = render(); assert(text(tree).includes('Through Week 2')); assert(!text(tree).includes('Leading'), 'Historical results render W/L rather than current lead language');
reset({ rows: [{ roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: 1, points: 0 }] });
board.week = 1; liveContext.history.priorWeeks = []; liveContext.currentWeek = 1;
tree = render(); assert(text(tree).includes('Entering Week 1')); assert(teamRows(tree).every(row => text(row).includes('0-0-0')));
const cupTab = find(tree, n => n.type === 'button' && text(n) === 'Cup');
assert(cupTab, 'Cup starts as an optional League view');
assert(!find(tree, n => n.props.className === 'mc-league-leaders'), 'Mobile omits the extra stat leaders panel');
assert(!find(tree, n => n.type === 'button' && text(n) === 'Leaders'), 'Mobile tab strip only includes available views');
cupTab.props.onClick(); tree = render();
const cupViewMenu = find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Customize League views');
cupViewMenu.props.onClick(); tree = render();
find(tree, n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: false } }); tree = render();
assert(!find(tree, n => n.type === 'button' && text(n) === 'Cup'), 'Hidden Cup is removed from the phone tab strip');
assert.equal(storage.get('wr_league_cup_hidden_1234567890123456'), true, 'Cup visibility is stored per league and device');
const viewMenu = find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Customize League views');
const cupToggle = find(tree, n => n.type === 'input' && n.props.type === 'checkbox');
assert.equal(cupToggle.props.checked, false, 'The view menu accurately reflects hidden Cup state');
cupToggle.props.onChange({ target: { checked: true } }); tree = render();
assert(find(tree, n => n.type === 'button' && text(n) === 'Cup'), 'The view menu restores Cup without affecting shared league data');
console.log('PASS League Central live rendering: unavailable/empty feeds, pregame baselines, reconstructed records, score reorder, source toggle and shared week selection');

// React preserves native disclosure state only when enclosing component types stay
// identical. A closure used as <Panel /> or <StandingsTable /> fails this guard.
function assertRefreshKeepsComponentTypes() {
    render();
    const previous = [...renderedComponentTypes];
    board = { ...board, updatedAt: board.updatedAt + 1000 };
    const refreshed = render();
    assert.equal(renderedComponentTypes.length, previous.length);
    renderedComponentTypes.forEach((type, i) => assert.equal(type, previous[i], 'Score refresh must preserve the component type enclosing open details: ' + type.name));
    return refreshed;
}
assertRefreshKeepsComponentTypes();
props.leagueSkin.features.showPlayoffOdds = true;
tree = render();
find(tree, n => n.type === 'select' && n.props['aria-label'] === 'Standings view').props.onChange({ target: { value: 'odds' } });
tree = assertRefreshKeepsComponentTypes();
assert(text(tree).includes('First-round bye'), 'The same refresh guard covers expandable playoff fields');
console.log('PASS League Central disclosure component identity survives score refresh in standings and playoff views');

// Chopped Home has a survival outlook, never a meaningless head-to-head record.
let survivalProps;
root.WrChopBlock = value => { survivalProps = value; return React.createElement('section', { 'aria-label': 'Desktop survival widget on phone' }); };
root.App.Chopped = { isChopped: value => value.settings.type === 3 };
const destinations = [];
props.overview = true;
props.setActiveTab = destination => destinations.push(destination);
league.settings.type = 3;
reset(); tree = render();
assertAlexFirst(tree);
assert(find(tree, n => n.props['aria-label'] === 'Desktop survival widget on phone'));
assert.equal(survivalProps.compact, true);
assert.equal(survivalProps.phone, true);
assert.equal(survivalProps.currentLeague, league);
assert.equal(survivalProps.myRoster, props.myRoster);
assert(!find(tree, n => n.props.className === 'mc-overview-summary'), 'Chopped Home does not show 0–0 or all-team standing');
survivalProps.onOpenLeague();
find(tree, n => n.type === 'button' && text(n) === 'Explore waivers →').props.onClick();
assert.deepEqual(destinations, ['central', 'fa']);
const topLevel = tree.children.flat(Infinity).filter(Boolean);
assert(topLevel.indexOf(find(tree, n => n.type === boundary)) > topLevel.indexOf(find(tree, n => n.props['aria-label'] === 'Desktop survival widget on phone')), 'Survival outlook leads the live field');
props.overview = false;
reset(); tree = render();
assert(find(tree, n => n.props['aria-label'] === 'Desktop survival widget on phone'));
assert.equal(survivalProps.phone, true, 'Full survival panel receives phone branding');
assert(!table(tree), 'Chopped standings avoids a meaningless head-to-head table');
find(tree, n => n.type === 'button' && text(n) === 'Scores').props.onClick(); tree = render();
assert(find(tree, n => n.type === boundary), 'Scores opens the weekly scoreboard');
assert(!find(tree, n => n.props['aria-label'] === 'Desktop survival widget on phone'), 'Scores does not append the full simulation panels');
props.overview = true;
league.settings.type = 1;
reset(); tree = render();
assertAlexFirst(tree);
assert(find(tree, n => n.props.className === 'mc-overview-summary'), 'Head-to-head Home retains its record and standing');
assert(!find(tree, n => n.props['aria-label'] === 'Desktop survival widget on phone'));
console.log('PASS Chopped mobile Home reuses desktop survival, hides head-to-head summary, and preserves league and waiver navigation');

// Personal Cup visibility must follow the selected league even when React reuses Central.
props.overview = false;
storage.set('wr_league_cup_hidden_' + league.league_id, true);
render(); effects.find(fn => fn.toString().includes('cupVisibilityKey'))(); tree = render();
assert(!find(tree, n => n.type === 'button' && text(n) === 'Cup'));
props.currentLeague = { ...league, league_id: '9876543210123456' };
render(); effects.find(fn => fn.toString().includes('cupVisibilityKey'))(); tree = render();
assert(find(tree, n => n.type === 'button' && text(n) === 'Cup'), 'A league with visible Cup does not inherit another league’s hidden state');

// The Sunday home board is automatic and follows current scores independently
// of the scoreboard's history selection.
props.currentLeague = league; props.overview = true;
root.S = { nflState: { season: 2026, season_type: 'regular' } };
reset({ rows: [{ roster_id: 1, matchup_id: 1, points: 20 }, { roster_id: 2, matchup_id: 1, points: 10 }], started: ['1', '2'] });
liveContext.games = [{ kickoff: '2026-10-18T17:00:00Z', completed: true }];
tree = render();
const homeBoard = value => find(value, n => n.props.className === 'mc-live-standings');
assert(homeBoard(tree), 'Sunday/Monday home board opens automatically without a disclosure');
assert.match(text(homeBoard(tree)), /Live standings/);
assert.match(text(homeBoard(tree)), /2–0/);
const children = tree.children.flat(Infinity).filter(Boolean);
assertAlexFirst(tree);
assert(children.findIndex(n => n.props?.className === 'mc-overview-decisions') < children.indexOf(homeBoard(tree)), 'Alex advice leads live standings');
assert(children.indexOf(homeBoard(tree)) < children.findIndex(n => n.type === boundary), 'Live standings appear before the full scoreboard');
currentBoardOverride = { ...board };
find(tree, n => n.type === boundary).props.onWeekChange(1);
board = { ...board, week: 1, rows: [{ roster_id: 1, matchup_id: 1, points: 1 }, { roster_id: 2, matchup_id: 1, points: 100 }] };
tree = render();
assert.equal(find(tree, n => n.type === boundary).props.selectedWeek, 1, 'Historical scoreboard remains usable');
assert.match(text(homeBoard(tree)), /Week 2/);
assert.match(text(homeBoard(tree)), /2–0/, 'Historical browsing cannot change the current home standings');
assert.match(text(find(tree, n => n.props.className === 'mc-overview-summary')), /2–0/, 'Personal summary agrees with the current live board');
currentBoardOverride = { ...currentBoardOverride, status: 'stale', error: 'Refresh failed' };
tree = render(); assertAlexFirst(tree); assert.match(text(homeBoard(tree)), /Last available · Provisional/);
assert(!find(homeBoard(tree), n => n.props.className === 'mc-live-standings-dot'), 'Failed refresh cannot claim a fresh live feed');
now = Date.parse('2026-10-17T12:00:00Z'); tree = render(); assertAlexFirst(tree); assert(!homeBoard(tree), 'Saturday keeps normal mobile Overview');
now = Date.parse('2026-10-19T12:00:00Z');
props.leagueSkin = { type: 'chopped', features: { showPlayoffOdds: false } }; assert(!homeBoard(render()), 'Chopped keeps its existing survival board');
props.leagueSkin = { features: { showPlayoffOdds: false } }; liveContext.enabled = false;
assert(!homeBoard(render()), 'Unsupported providers cannot acquire an invented live standings board');
console.log('PASS automatic phone Overview standings: Sunday/Monday visibility, ordering, current-week independence, fresh/stale labels and format guards');
