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
const scope = { React, window: { App, S: { nflState: { season: 2026 } } } };
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
const desktopChopped = render({ currentLeague: { ...props.currentLeague, settings: { type: 3 } }, myRoster: rows[1] });
assert(text(nodes(desktopChopped).find(n => n.type === 'article')).includes('Owner 1'), 'Desktop Chopped order remains score-ranked even when a lower-scoring team is mine');
// Phone initially shows the user's game, with all league scores reachable.
scope.window.WR = { useViewport: () => ({ isPhone: true }) };
hooks = [];
tree = render();
assert.equal(nodes(tree).filter(n => n.type === 'article').length, 1);
assert(text(nodes(tree).find(n => n.type === 'article')).includes('Owner 3'));
nodes(tree).find(n => n.type === 'button' && text(n) === 'All 2 games').props.onClick();
tree = render();
assert.equal(nodes(tree).filter(n => n.type === 'article').length, 2);
assert(text(tree).includes('0.00') && text(tree).includes('-2.00'));
// Full Overview/League board shows every matchup immediately and gives each a real destination.
hooks = [];
let teamTarget = null;
tree = render({ fullBoard: true, overview: true, onOpenTeam: id => { teamTarget = id; } });
assert.equal(nodes(tree).filter(n => n.type === 'article').length, 2);
assert(tree.props.className.includes('lls-expanded') && !tree.props.className.includes('lls-compact'), 'Full board must not use the compact horizontal scroller');
assert(!nodes(tree).some(n => n.type === 'button' && text(n).startsWith('All ')));
assert(text(tree).includes('League scoreboard'));
nodes(tree).find(n => n.props?.['aria-label'] === 'Open your matchup in Game Day').props.onClick();
assert.equal(tab, 'lineup');
const rival = nodes(tree).find(n => n.type === 'details' && n.props.className === 'mc-matchup-details');
assert(rival && text(rival).includes('p1') && text(rival).includes('-2.00'), 'Rival disclosure retains starter score evidence');
nodes(rival).find(n => n.type === 'button' && text(n) === 'Owner 2 →').props.onClick();
assert.equal(teamTarget, 2, 'Team action preserves selected roster');
// Past weeks and archived seasons stay in the selected score context, even for our own game.
for (const extra of [
    { selectedWeek: 1 },
    { selectedWeek: 2, currentLeague: { ...props.currentLeague, season: '2025' } },
]) {
    hooks = []; tab = null;
    const historic = render({ fullBoard: true, ...extra });
    assert(!nodes(historic).some(n => n.props?.['aria-label'] === 'Open your matchup in Game Day'), 'Historical own matchup does not jump to current lineup');
    const ownCard = nodes(historic).find(n => n.type === 'article' && n.props.className.includes('lls-card-own'));
    const ownDetails = nodes(ownCard).find(n => n.type === 'details' && n.props.className === 'mc-matchup-details');
    assert(ownDetails && text(ownDetails).includes('p3'), 'Historical own matchup exposes the selected week starter details');
    assert.equal(tab, null);
}
hooks = [];
const current = render({ fullBoard: true, selectedWeek: 2 });
nodes(current).find(n => n.props?.['aria-label'] === 'Open your matchup in Game Day').props.onClick();
assert.equal(tab, 'lineup', 'Current-season current-week own matchup retains Game Day shortcut');
// Real NFL states contextualize partial fantasy scores; totals never infer completion.
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../js/shared/nfl-context.js'), 'utf8'), scope);
App.NFLByes = { seasonFor: league => Number(league.season), weekForPlayer: player => player?.team === 'CHI' ? 2 : null };
const progressPlayers = { done: { team: 'BUF' }, alias: { team: 'WSH' }, live: { team: 'GB' }, later: { team: 'NYG' }, bye: { team: 'CHI' }, postponed: { team: 'LV' } };
const progressGames = [
    { home: 'BUF', away: 'WAS', completed: true, state: 'post' },
    { home: 'GB', away: 'MIN', completed: false, state: 'in' },
    { home: 'NYG', away: 'DAL', completed: false, state: 'pre', kickoff: '2099-10-07T20:00:00Z' },
    { home: 'LV', away: 'KC', completed: false, state: 'pre', statusName: 'STATUS_POSTPONED' },
];
const count = scope.leagueScoreboardStarterProgress({ starters: ['done', 'alias', 'live', 'later', 'bye', 'postponed', 'missing', '0'], points: -50 }, progressPlayers, progressGames, props.currentLeague, 2);
assert.equal(count.finished, 2); assert.equal(count.remaining, 2); assert.equal(count.bye, 1); assert.equal(count.unknown, 2); assert.equal(count.empty, 1);
assert.equal(count.text, '2 final · 2 left · 1 bye · 2 unknown · 1 empty', 'Final/live/scheduled/bye/postponed/unknown/empty stay distinct');
assert.equal(scope.leagueScoreboardStarterProgress({ starters: ['missing'], points: 250 }, progressPlayers, progressGames, props.currentLeague, 2).text, 'Game status unavailable', 'Large earned scores cannot imply all players finished');
assert.equal(scope.leagueScoreboardStarterProgress({ starters: ['done'] }, progressPlayers, [], props.currentLeague, 2).text, 'Game status unavailable', 'Absent schedule never claims progress');
assert.equal(scope.leagueScoreboardStarterProgress({ starters: ['done'] }, progressPlayers, [{ home: 'BUF', away: 'WAS', state: 'post', completed: false }], props.currentLeague, 2).text, 'Game status unavailable', 'Unconfirmed post state is not a final');
hooks = [];
let progressTree = render({ fullBoard: true, selectedWeek: 2, playersData: { p1: progressPlayers.done, p2: progressPlayers.live } });
assert(text(progressTree).includes('Game status unavailable'));
const nflStateIndex = hooks.findIndex(value => value && Array.isArray(value.games));
hooks[nflStateIndex] = { key: '2026|2', games: progressGames };
progressTree = render({ fullBoard: true, selectedWeek: 2, playersData: { p1: progressPlayers.done, p2: progressPlayers.live } });
assert(text(progressTree).includes('1 final · 0 left') && text(progressTree).includes('0 final · 1 left'), 'Loaded schedule progress renders beside each team score');
assert(text(progressTree).includes('0.00') && text(progressTree).includes('-2.00'), 'Progress leaves zero and negative actual points intact');
const pastProgress = render({ fullBoard: true, selectedWeek: 1, playersData: { p1: progressPlayers.done, p2: progressPlayers.live } });
assert(!nodes(pastProgress).some(n => n.props?.className === 'mc-score-progress'), 'Current player team metadata cannot invent historical progress');
board = { supported: false, status: 'unsupported', rows: [], groups: [] };
assert(text(render()).includes('connected Sleeper leagues'));
console.log('League scoreboard render checks passed.');
