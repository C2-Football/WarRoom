#!/usr/bin/env node
'use strict';
const assert = require('assert');
global.window = globalThis; global.App = {};
for (const module of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai', 'ui']) require('../js/shared/time-league-' + module + '.js');
let states = [], cursor = 0;
global.React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props, children }),
    useMemo: fn => fn(), useState: value => { const i = cursor++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], next => { states[i] = next; }]; },
    useRef: () => ({ current: null }), useEffect: () => {}, Fragment: 'fragment',
};
global.TimeLeagueHelmetIcon = () => null;
for (const module of ['standings', 'home', 'team']) require('../js/components/time-league-' + module + '-panel.js');
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason;
let league = E.createTimeLeague({ name: 'UI smoke', seed: 'ui', createdAt: '2026-01-01', settings: { rosterSlots: { QB: 1, BN: 1 }, regularSeasonWeeks: 12, playoffTeams: 4, scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 } }, seats: Array.from({ length: 4 }, (_, i) => ({ name: 'Team ' + i, manager: i ? 'ai' : 'human' })) });
league = { ...league, phase: 'season', weekStage: 'lineup', seasonsRevealed: true, currentWeek: 7 };
const render = fn => { cursor = 0; return fn(); };
const home = JSON.stringify(render(() => WrTimeLeagueHomePanel({ league, onNavigate: () => {} })));
assert(home.includes('Playoff Hunt')); assert(!home.includes('League briefing')); assert(!home.includes('Command Central'));
states = [];
assert(!JSON.stringify(render(() => WrTimeLeagueHomePanel({ league: { ...league, currentWeek: 1 }, onNavigate: () => {} }))).includes('Playoff Hunt'));
const entries = [{ entryId: 'start', identity: 'qb:a', name: 'Starter', position: 'QB', drawnSeason: 2000, slot: 'QB' }, { entryId: 'bench', identity: 'qb:b', name: 'Reserve', position: 'QB', drawnSeason: 2000, slot: 'BN' }];
league.teams[0].roster = entries;
const cards = new Map(entries.map(entry => [entry.identity, { identity: entry.identity, seasons: [{ season: 2000, points: 100 }] }]));
const index = new Map();
for (const entry of entries) for (let week = 1; week <= 14; week++) index.set(S.gameLogKey(entry.identity, 2000, week), { stats: { ...S.emptyStatLine(), passYd: week * 10 } });
let applied;
states = [];
const roster = () => render(() => WrTimeLeagueTeamPanel({ league, cards, section: 'roster', activeTeamId: league.teams[0].teamId, onSelectTeam: () => {}, onUpdate: (next, action) => { applied = { next, action }; }, logIndex: index }));
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
let tree = roster();
assert(JSON.stringify(tree).includes('Remaining ceiling:')); assert(JSON.stringify(tree).includes('A dash means no archived game log'));
let rows = walk(tree).filter(node => node.props?.draggable);
assert.equal(rows.length, 2);
rows[1].props.onDragStart({ dataTransfer: { setData: () => {} } });
rows = walk(roster()).filter(node => node.props?.draggable);
rows[0].props.onDrop({ preventDefault: () => {} });
assert.equal(applied.action.targetEntryId, 'start');
assert.equal(applied.next.teams[0].roster.find(entry => entry.entryId === 'bench').slot, 'QB');
assert.equal(applied.next.teams[0].roster.find(entry => entry.entryId === 'start').slot, 'BN');
league = { ...league, weekStage: 'ready' };
assert.equal(walk(roster()).filter(node => node.props?.draggable).length, 0);
states = [];
const finalWeek = { week: 6, headlines: [], results: league.teams.map(team => ({ teamId: team.teamId, total: 20, starters: [], bench: [] })), matchups: [{ home: league.teams[0].teamId, away: league.teams[1].teamId, homePoints: 20, awayPoints: 10, winner: league.teams[0].teamId }] };
const finalHome = JSON.stringify(render(() => WrTimeLeagueHomePanel({ league: { ...league, weekStage: 'postgame', finalizedWeeks: [finalWeek] }, onNavigate: () => {} })));
assert(finalHome.includes('FINAL')); assert(finalHome.includes('WK 6')); assert(!finalHome.includes('UPCOMING')); assert(finalHome.includes('The final is in.'));
console.log('PASS: unified Home, halfway Playoff Hunt, star rendering, exact drop swap, and game-day roster lock');
