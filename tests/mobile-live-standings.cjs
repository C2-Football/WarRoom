'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {}, React: { createElement(type, props, ...children) { return { type, props: props || {}, children }; } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../js/components/mobile-live-standings.js'), 'utf8'), context);
const render = context.window.MobileLiveStandings;
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
