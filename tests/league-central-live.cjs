'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
let hooks = [], index = 0, board, liveContext, requestedWeek, renderedComponentTypes = [];
const boundary = function ScoreboardBoundary() {};
const React = {
    Fragment: 'fragment',
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = index++; return hooks[i] ||= { current: initial }; },
    useMemo(fn) { index++; return fn(); }, useCallback(fn) { index++; return fn; }, useEffect() {},
    createElement(type, props, ...children) { if (typeof type === 'function') renderedComponentTypes.push(type); return typeof type === 'function' && type !== boundary ? type({ ...(props || {}), children }) : { type, props: props || {}, children }; }
};
const root = { App: { LeagueLiveScores: { currentWeek: () => 2, useScores: opts => { requestedWeek = opts.week; return board; } }, LeagueLiveTable: { useContext: () => liveContext }, DashboardLeagueLayout: { peek: () => null, leagueId: league => String(league.league_id || league.id || "") } }, WR: { useViewport: () => ({ isPhone: true }) }, LeagueLiveScoreboard: boundary };
const context = { window: root, React, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/league-live-standings.js', 'utf8'), context);
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/league-central.js', 'utf8'), { presets: ['react'] }).code, context);
const league = { league_id: '1234567890123456', season: 2026, name: 'League', settings: { playoff_week_start: 15 }, rosters: [
    { roster_id: 1, settings: { wins: 5, losses: 0, ties: 0, fpts: 500 } }, { roster_id: 2, settings: { wins: 0, losses: 5, ties: 0, fpts: 400 } },
] };
const prior = [{ week: 1, rows: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 80 }] }];
const props = { currentLeague: league, leagueSkin: { features: { showPlayoffOdds: false } }, myRoster: league.rosters[0], playersData: {}, standings: [{ rosterId: 1, teamName: 'Alpha', wins: 5, losses: 0, ties: 0 }, { rosterId: 2, teamName: 'Beta', wins: 0, losses: 5, ties: 0 }], transactions: [], getOwnerName: id => id === 1 ? 'Alpha' : 'Beta' };
const walk = n => n == null || typeof n === 'boolean' ? [] : Array.isArray(n) ? n.flatMap(walk) : typeof n === 'object' ? [n, ...walk(n.children)] : [n];
const text = n => walk(n).filter(n => typeof n !== 'object').join('');
const find = (tree, pred) => walk(tree).find(n => typeof n === 'object' && pred(n));
function render() { index = 0; renderedComponentTypes = []; return root.LeagueCentralTab(props); }
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
let scoreboard = find(tree, n => n.type === boundary);
assert.equal(scoreboard.props.selectedWeek, 2); assert.equal(typeof scoreboard.props.onWeekChange, 'function'); assert.equal(scoreboard.props.onRefresh, liveContext.refresh);
scoreboard.props.onWeekChange(1); tree = render(); scoreboard = find(tree, n => n.type === boundary);
assert.equal(scoreboard.props.selectedWeek, 1); assert.equal(requestedWeek, 1, 'Scoreboard picker and standings feed share the selected week');
reset({ historical: true, rows: [{ roster_id: 1, matchup_id: 1, points: 5 }, { roster_id: 2, matchup_id: 1, points: 200 }], started: ['1', '2'] });
tree = render(); assert(text(tree).includes('Through Week 2')); assert(!text(tree).includes('Leading'), 'Historical results render W/L rather than current lead language');
reset({ rows: [{ roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: 1, points: 0 }] });
board.week = 1; liveContext.history.priorWeeks = []; liveContext.currentWeek = 1;
tree = render(); assert(text(tree).includes('Entering Week 1')); assert(teamRows(tree).every(row => text(row).includes('0-0-0')));
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
