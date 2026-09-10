'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const Cup = require('../js/shared/woeppel-cup.js');
const walk = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === 'object' ? [node, ...walk(node.children)] : [node];
const text = node => walk(node).filter(item => typeof item !== 'object').join('');
const find = (tree, predicate) => walk(tree).find(node => typeof node === 'object' && predicate(node));
const React = { createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
const root = { App: {}, WoeppelCup: Cup, setTimeout, clearTimeout };
const context = { window: root, React, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/dashboard-league-data.js', 'utf8'), context);
vm.runInContext(Babel.transform(fs.readFileSync('js/widgets/league-progress.js', 'utf8'), { presets: ['react'] }).code, context);
let live = { status: 'ready', supported: true, rows: [], groups: [], updatedAt: 1000, error: null };
let cupData = { status: 'ready', state: null, updatedAt: 1000, error: null };
let calls = [], navigated = [];
root.App.LeagueLiveScores = { currentWeek: () => 2, useScores: options => { calls.push({ service: 'scores', ...options }); return live; } };
root.App.DashboardLeagueData.useCup = options => { calls.push({ service: 'cup', ...options }); return cupData; };
const league = { league_id: '1234567890123456', season: 2026, rosters: [
    { roster_id: 1, settings: { wins: 1, losses: 1, ties: 0, fpts: 200, fpts_decimal: 25 } },
    { roster_id: 2, settings: { wins: 2, losses: 0, ties: 0, fpts: 220, fpts_decimal: 50 } },
    { roster_id: 3, settings: { wins: 0, losses: 2, ties: 0, fpts: 180 } },
], settings: { playoff_week_start: 15 } };
const props = { currentLeague: league, myRoster: { roster_id: 1 }, playersData: { a: { full_name: 'Zero Player', position: 'WR', team: 'BUF' }, b: { full_name: 'Negative Player', position: 'QB', team: 'CHI' } }, getOwnerName: id => 'Team ' + id, navigateWidget: target => navigated.push(target) };
function render(kind, size = 'md', extra = {}) { calls = []; return root.LeagueProgressWidget({ ...props, kind, size, ...extra }); }
const groups = [{ key: 'matchup:1', teams: [{ roster_id: 1, points: 33, custom_points: 0 }, { roster_id: 2, points: -5.25 }] }];
live = { ...live, rows: [{ roster_id: 1, players_points: { a: 0 } }, { roster_id: 2, players_points: { b: -2 } }], groups };
for (const kind of ['league-stats', 'league-cup', 'league-standings', 'weekly-matchups']) {
    for (const size of ['sm', 'md', 'lg']) {
        const tree = render(kind, size, { compact: size === 'sm' });
        assert(text(tree).length > 0, kind + ' renders in ' + size);
        assert.equal(calls.find(call => call.service === 'scores').enabled, ['league-stats', 'weekly-matchups'].includes(kind), 'Only scoring cards subscribe to scores');
        assert.equal(calls.find(call => call.service === 'cup').enabled, kind === 'league-cup', 'Only Cup card subscribes to Cup');
        const action = size === 'sm' ? tree : find(tree, node => node.type === 'button');
        assert.equal(action.type, 'button', 'Native button supports keyboard activation');
        action.props.onClick();
        assert.equal(navigated.at(-1), kind === 'league-stats' ? 'stats' : kind);
    }
}
let tree = render('league-stats', 'lg');
assert(text(tree).includes('Zero Player'));
assert(text(tree).includes('0.00'));
assert(text(tree).includes('-2.00'), 'Negative individual score is retained');
assert(text(tree).includes('Week 2 · Actual points'), 'Scoring leaders identify their exact weekly scope');
assert(text(render('weekly-matchups', 'sm')).includes('Wk 2 · Checked'));
assert(text(render('league-stats', 'sm')).includes('Wk 2 · Checked'));
tree = render('weekly-matchups');
assert(text(tree).includes('0.00 : -5.25'), 'Commissioner zero override and negative matchup score render');
assert(text(tree).includes('Your matchup vs Team 2'));
live = { ...live, status: 'stale', error: 'Network unavailable' };
tree = render('weekly-matchups');
assert(text(tree).includes('0.00 : -5.25'), 'Stale values remain visible');
assert(/delayed/i.test(text(tree)), 'Stale values are explicitly qualified');
live = { status: 'error', error: 'No scores', rows: [], groups: [], supported: true };
tree = render('league-stats');
assert(text(tree).includes('Weekly stats unavailable'));
assert(!text(tree).includes('0.00'), 'Missing feed never invents zero points');
live = { status: 'loading', rows: [], groups: [], supported: true };
assert(text(render('weekly-matchups')).includes('Loading league scores'));

const standings = render('league-standings');
assert(text(standings).includes('#2'));
assert(text(standings).includes('1–1 record · 200.25 PF'));
const partialRecord = { ...league, rosters: [{ roster_id: 1, settings: {} }, ...league.rosters.slice(1)] };
assert(!text(render('league-standings', 'md', { currentLeague: partialRecord })).includes('null'), 'Incomplete owner record never renders literal null');
const noResults = { ...league, rosters: league.rosters.map(roster => ({ ...roster, settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } })) };
assert(text(render('league-standings', 'md', { currentLeague: noResults })).includes('0–0'));
assert(text(render('league-standings', 'md', { currentLeague: noResults })).includes('Season record · No games final'));
assert(!text(render('league-standings', 'md', { currentLeague: noResults })).includes('#1'), 'Preseason rosters have no fabricated standing');

cupData = { status: 'error', state: null, updatedAt: null, error: 'A member sign-in is required.' };
tree = render('league-cup');
assert(text(tree).includes('Cup connection unavailable'));
assert(text(find(tree,node=>node.props?.className?.includes('lpw-headline'))).includes('Explore'));
assert(!text(tree).includes('Start a Cup'), 'An unavailable shared Cup is not represented as nonexistent');
const saved = { ...Cup.tournament.configure(league, 'knockout'), locked: true, enabled: true, name: 'Real League Cup' };
cupData = { status: 'ready', state: saved, updatedAt: 1000, error: null };
assert(text(render('league-cup')).includes('Real League Cup'));
cupData = { ...cupData, status: 'stale', error: 'Refresh failed' };
tree = render('league-cup');
assert(text(tree).includes('Real League Cup'));
assert(/delayed/i.test(text(tree)));
for (const week of Cup.tournament.schedule(saved)) saved.weeks[week] = { final: true, scores: Object.fromEntries(saved.teams.map((id, index) => [id, 150 - index * 10])) };
cupData = { status: 'ready', state: saved, updatedAt: 1000, error: null };
tree = render('league-cup', 'lg');
assert(text(tree).includes('Champion'));
assert(text(tree).includes('Team 1'));
assert(!text(tree).includes('Next Cup week'), 'Completed Cup does not invent another round');
assert(!find(tree, node => node.type === 'button' && /save|archive|finalize/i.test(text(node))), 'Widgets never expose Cup write actions');
console.log('PASS league KPI widgets: four kinds and three sizes/routes, subscription scope, exact scores, missing/stale states, standings, and read-only Cup results');
