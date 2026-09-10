'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const Babel = require('@babel/standalone');
let hooks = [], index = 0, board, tab;
const React = {
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
    useEffect() {},
    createElement(type, props, ...children) { return { type, props: props || {}, children }; }
};
const App = { LeagueLiveScores: {
    currentWeek: () => 2, useScores: () => board,
    rosterPoints: row => row.points ?? null,
    playerPoints: (row, pid) => row.players_points?.[pid] ?? null
}, Chopped: { isChopped: league => league.settings?.type === 3, isAliveInWeek: (row, week) => !row.settings?.eliminated || week <= row.settings.eliminated } };
const scope = { React, window: { App } };
vm.createContext(scope);
vm.runInContext(Babel.transform(fs.readFileSync(require('path').join(__dirname, '../js/components/league-live-scoreboard.js'), 'utf8'), { presets: ['react'] }).code, scope);
const rows = [
    { roster_id: 1, matchup_id: 1, points: 0, starters: ['p1'], players_points: { p1: 0 } },
    { roster_id: 2, matchup_id: 1, points: -2, starters: ['p2'], players_points: { p2: -2 } },
    { roster_id: 3, matchup_id: 2, points: null, starters: ['p3'] },
];
const props = { currentLeague: { league_id: 'A', season: '2026', rosters: rows }, myRoster: rows[2], getOwnerName: id => `Owner ${id}`, getPlayerName: id => id, setActiveTab: key => { tab = key; } };
function nodes(tree) { return tree == null || typeof tree === 'boolean' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [tree] : [tree, ...nodes(tree.children)]; }
function text(tree) { return nodes(tree).filter(n => typeof n !== 'object').join(''); }
function render(extra = {}) { index = 0; return scope.window.LeagueLiveScoreboard({ ...props, ...extra }); }
board = { status: 'ready', supported: true, rows, groups: [{ matchupId: 1, teams: rows.slice(0, 2) }, { matchupId: 2, teams: [rows[2]] }], updatedAt: Date.now() };
let tree = render();
let cards = nodes(tree).filter(n => n.type === 'article');
assert(text(cards[0]).includes('Owner 3'), 'Own matchup sorts first');
assert(text(tree).includes('0.00') && text(tree).includes('-2.00'), 'Zero and negative scores remain actual values');
assert(text(cards[0]).includes('—'), 'Missing score stays missing');
assert(text(cards[0]).includes('No opponent reported'), 'Unpaired team does not invent opponent');
nodes(tree).find(n => n.type === 'button' && text(n).includes('My Game Plan')).props.onClick();
assert.equal(tab, 'lineup');
nodes(tree).find(n => n.type === 'select').props.onChange({ target: { value: '7' } });
assert.equal(nodes(render()).find(n => n.type === 'select').props.value, 7);
assert.equal(nodes(render({ currentLeague: { ...props.currentLeague, league_id: 'B' } })).find(n => n.type === 'select').props.value, 2, 'Switching league resets week');
board = { ...board, status: 'stale', error: new Error('offline') };
assert(text(render()).includes('last successful update'), 'Stale scores are disclosed');
board = { ...board, status: 'ready', error: null };
hooks = [];
tree = render({ currentLeague: { ...props.currentLeague, settings: { type: 3 }, rosters: rows.map(r => ({ ...r, settings: r.roster_id === 3 ? { eliminated: 1 } : {} })) } });
assert(text(tree).includes('Weekly scoring race'));
assert.equal(nodes(tree).filter(n => n.type === 'article').length, 2, 'Previously chopped team excluded');
assert(!text(tree).includes('No opponent reported'), 'Chopped does not show head-to-head');
board = { supported: false, status: 'unsupported', rows: [], groups: [] };
assert(text(render()).includes('connected Sleeper leagues'));
console.log('League scoreboard render checks passed.');
