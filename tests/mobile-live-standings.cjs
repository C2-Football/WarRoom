'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {}, React: { createElement(type, props, ...children) { return { type, props: props || {}, children }; } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../js/components/mobile-live-standings.js'), 'utf8'), context);
const render = context.window.MobileLiveStandings;
const lastFive = context.window.MobileLiveStandingsData.lastFive;
const plain = value => JSON.parse(JSON.stringify(value));
const walk = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node !== 'object' ? [node] : [node, ...walk(node.children)];
const text = node => walk(node).filter(item => typeof item !== 'object').join('');
const find = (tree, predicate) => walk(tree).find(item => typeof item === 'object' && predicate(item));
const all = (tree, predicate) => walk(tree).filter(item => typeof item === 'object' && predicate(item));
const rows = tree => all(find(tree, node => node.type === 'tbody'), node => node.type === 'tr');
const cells = row => row.children.map(text);
const teams = [
    { rosterId: 1, rank: 1, baselineRank: 2, teamName: 'A long team name that must remain readable to assistive technology', wins: 3, losses: 1, ties: 0, currentPoints: 0, currentResult: 'W' },
    { rosterId: 2, rank: 2, baselineRank: 1, displayName: 'Team two', wins: 0, losses: 4, ties: 1, currentPoints: -2.5, currentResult: 'L' },
    { rosterId: 3, rank: 3, teamName: 'Missing points', wins: 1, losses: 3, ties: 0, currentPoints: null, currentResult: null },
    { rosterId: 4, rank: null, teamName: 'Missing record', wins: null, losses: null, currentPoints: NaN, currentResult: 'T' },
];
let opened = null, leagueOpened = false, refreshes = 0;
let tree = render({ teams, week: 6, myRosterId: '1', status: 'live', onOpenTeam(id, row) { opened = { id, row }; }, onOpenLeague() { leagueOpened = true; }, onRefresh() { refreshes++; } });
assert(text(tree).includes('Live standings') && text(tree).includes('As it stands · Provisional'));
assert.equal(rows(tree).length, teams.length, 'every team is visible without disclosure');
assert(!find(tree, node => node.type === 'details'), 'no extra opening step is required');
assert.equal(cells(rows(tree)[0])[3], '0.00Leading', 'authoritative zero stays visible');
assert.equal(cells(rows(tree)[1])[3], '-2.50Trailing', 'negative points stay visible');
assert.equal(cells(rows(tree)[1])[2], '0–4–1', 'ties remain in the record');
assert.equal(cells(rows(tree)[2])[3], '—', 'missing points are not replaced with zero');
assert.equal(cells(rows(tree)[3])[0], '—', 'absent engine rank is not invented from row order');
assert.equal(cells(rows(tree)[3])[2], '—', 'absent engine records are not reconstructed');
assert(rows(tree)[0].props.className.includes('is-own'), 'string and numeric roster IDs identify your row');
assert(text(rows(tree)[0]).includes('You') && text(rows(tree)[0]).includes('↑1'));
assert(text(rows(tree)[1]).includes('↓1'));
const teamButton = find(tree, node => node.type === 'button' && node.props.className === 'mc-live-standings-team-link');
assert.equal(teamButton.props.title, teams[0].teamName, 'long names retain their full accessible label');
let stopped = false;
teamButton.props.onClick({ stopPropagation() { stopped = true; } });
assert(stopped && opened.id === 1 && opened.row === teams[0], 'team profile opens without a double row action');
rows(tree)[1].props.onClick(); assert.equal(opened.id, 2, 'the whole compact row can open a profile');
find(tree, node => node.type === 'button' && text(node) === 'Full standings →').props.onClick();
assert(leagueOpened);
find(tree, node => node.type === 'button' && node.props['aria-label'] === 'Refresh standings').props.onClick();
assert.equal(refreshes, 1);
assert(find(tree, node => node.type === 'caption' && text(node).includes('Provisional records')));
tree = render({ teams, week: 6, status: 'live', stale: true });
assert(text(tree).includes('Last available · Provisional') && text(tree).includes('Saved scores'));
assert(!find(tree, node => node.props.className === 'mc-live-standings-dot'), 'stale results never promise a fresh live feed');

tree = render({ baselineRows: teams, week: 6, status: 'baseline' });
assert(text(tree).includes('Entering week 6 · Live results pending'));
assert.equal(rows(tree).length, teams.length, 'verified baseline survives missing live rows');
assert(!text(tree).includes('Leading') && !text(tree).includes('↑1'), 'baseline records have no provisional movement or result colors');
assert(!find(tree, node => node.type === 'button'), 'handlers are not replaced by dead controls');
tree = render({ teams, status: 'official', stale: true, week: 6, updatedAt: Date.UTC(2026, 9, 18, 12) });
assert.equal(text(find(tree, node => node.type === 'h2')), 'Standings');
assert(text(tree).includes('Official standings') && text(tree).includes('Last successful update'));
assert(!text(tree).includes('Leading') && !text(tree).includes('Provisional'));
assert(find(tree, node => node.props.role === 'status' && node.props.className.includes('is-stale')));
tree = render({ status: 'loading', onRefresh() {} });
assert(text(tree).includes('Standings are loading…'));
assert(find(tree, node => node.type === 'button' && node.props.disabled), 'refresh cannot queue repeated loads');
tree = render({ teams: [], status: 'baseline', stale: true });
assert(text(tree).includes('Standings are unavailable') && text(tree).includes('Showing last available standings'));
assert(!text(tree).includes('Week undefined'));
assert(!find(tree, node => node.type === 'table'), 'empty data does not fabricate standing rows');
console.log('Mobile live standings: all teams, provisional/baseline/official/loading states, accessible actions, zero/negative/missing data, own row and rank movement passed.');

// Completed form comes from the pre-week snapshot, not the current live result.
vm.runInContext(fs.readFileSync(require.resolve('../js/shared/league-live-standings.js'), 'utf8'), context);
const compute = context.window.App.LeagueLiveStandings.compute;
const scoreRows = values => values.map((value, index) => ({ roster_id: index + 1, matchup_id: Math.floor(index / 2) + 1, points: value }));
const priorWeeks = [[10, 0, 1, 2], [0, 10, 1, 2], [5, 5, 1, 2], [7, 3, 1, 2], [8, 2, 1, 2], [2, 8, 1, 2], [9, 1, 1, 2]]
    .map((values, index) => ({ week: index + 1, rows: scoreRows(values) }));
priorWeeks[3].rows[0].matchup_id = null;
priorWeeks[3].rows[1].matchup_id = null;
const standings = compute({
    league: { settings: { start_week: 1, playoff_week_start: 15, league_average_match: 1 }, rosters: [1, 2, 3, 4].map(roster_id => ({ roster_id })) },
    week: 8, priorWeeks, board: { week: 8, rows: scoreRows([0, 10, 1, 2]) }, started: true,
});
assert.equal(standings.status, 'live');
const liveTeam = standings.rows.find(row => row.rosterId === 1);
const baselineTeam = standings.baselineRows.find(row => row.rosterId === 1);
assert.equal(baselineTeam.form.length, 6, 'a bye does not become a seventh completed head-to-head game');
assert.equal(liveTeam.form.length, 7, 'the current provisional game is present only in live form');
assert.deepEqual(plain(lastFive(liveTeam, standings.baselineRows, 8)), ['L', 'T', 'W', 'L', 'W'], 'last five stay chronological, retain ties, exclude the bye, median outcomes and current week');
assert.deepEqual(plain(lastFive(baselineTeam, standings.baselineRows, 8)), ['L', 'T', 'W', 'L', 'W'], 'baseline and live views agree about completed form');
tree = render({ teams: standings.rows, baselineRows: standings.baselineRows, week: 8, status: 'live' });
const firstTeamRow = rows(tree).find(row => row.props.key === 1);
const formStrip = find(firstTeamRow, node => node.props.className === 'mc-live-standings-form');
assert.equal(text(formStrip), 'Last 5LTWLW');
assert.equal(formStrip.props['aria-label'], 'Last 5 completed head-to-head games, oldest to newest: Loss, Tie, Win, Loss, Win');
assert.deepEqual(all(formStrip, node => node.props.className === 'mc-live-standings-form-pill').map(node => node.props['data-result']), ['L', 'T', 'W', 'L', 'W'], 'color classes retain visible W/L/T text');
assert.equal(firstTeamRow.children.length, 4, 'form stays inside the team column instead of adding a narrow-screen column');

const officialTeam = { rosterId: 1, teamName: 'Official team', form: [
    { week: 5, result: 'L' }, { week: 3, result: 'W' }, { week: 1, result: 'T' },
    { week: 6, result: 'W' }, { week: 7, result: 'L' }, { week: NaN, result: 'W' },
    { week: 0, result: 'W' }, { week: -1, result: 'L' }, { week: '2', result: 'W' },
    { week: 2, result: 'BYE' }, { week: 4, result: null }, 'W', null,
] };
const officialBefore = JSON.stringify(officialTeam);
assert.deepEqual(plain(lastFive(officialTeam, [], 6)), ['T', 'W', 'L'], 'dated official form uses only validated completed earlier weeks and sorts oldest first');
assert.equal(JSON.stringify(officialTeam), officialBefore, 'sorting never mutates provider form');
assert.deepEqual(plain(lastFive(officialTeam, [], undefined)), [], 'an unknown displayed week cannot establish which official results are completed');
assert.deepEqual(plain(lastFive({ rosterId: 1, form: ['W', 'L'] }, [], 6)), [], 'undated current-team strings are never accepted as completed fallback results');
assert.deepEqual(plain(lastFive(officialTeam, [{ rosterId: '1', form: [] }], 6)), [], 'an authoritative empty baseline does not borrow later official results');
assert.deepEqual(plain(lastFive({ rosterId: 2 }, [{ rosterId: 2, form: ['W', 'T'] }], 3)), ['W', 'T'], 'a short season shows only games actually completed');
tree = render({ teams: [officialTeam], week: 6, status: 'official' });
assert.equal(text(find(tree, node => node.props.className === 'mc-live-standings-form')), 'Last 5TWL');
tree = render({ teams: [{ rosterId: 1, form: ['W', 'L'] }], week: 6, status: 'official' });
assert.equal(text(find(tree, node => node.props.className === 'mc-live-standings-form')), 'Last 5—', 'unavailable form stays a neutral dash');
assert(!find(tree, node => node.props.className === 'mc-live-standings-form-pill'), 'unknown history does not fabricate wins or losses');
console.log('Mobile live standings form: completed last five, chronological order, live-week exclusion, ties, byes, median leagues, short seasons and official missing data passed.');
