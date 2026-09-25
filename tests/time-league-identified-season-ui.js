'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years', 'player-stats', 'player-cards', 'ui', 'ai', 'gamecast']) require('../js/shared/time-league-' + name + '.js');
let cursor = 0, state = [];
global.React = { Fragment: 'fragment', useRef: value => ({ current: value }), useEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn,
    useState: value => { const id = cursor++; if (!(id in state)) state[id] = typeof value === 'function' ? value() : value; return [state[id], next => { state[id] = typeof next === 'function' ? next(state[id]) : next; }]; },
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }) };
window.WR = { useViewport: () => ({ isPhone: true }) };
for (const name of ['team', 'gamecast', 'home']) require('../js/components/time-league-' + name + '-panel.js');
require('../js/components/time-league-ceremony.js');
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason, G = App.TimeLeagueGamecast;
const scoring = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
const entries = ['Known', 'Ambiguous'].map((name, index) => ({ entryId: `e${index}`, editionId: `e${index}`, identity: `p${index}`, name, hiddenDecade: '1990s', position: 'QB', slot: 'QB',
    // Deliberately inconsistent private year: the UI must infer from public evidence.
    drawnSeason: 1999, acquiredVia: 'draft', acquiredWeek: 1 }));
const stats = yards => ({ ...S.emptyStatLine(), passYd: yards, passTd: 1 });
const cards = new Map(entries.map(entry => [entry.identity, { ...entry, seasons: [1992, 1993].map(season => ({ season, games: 1, points: 8 })) }]));
const logs = S.buildGameLogIndex(entries.flatMap((entry, index) => [1992, 1993].map(season => ({ identity: entry.identity, name: entry.name, position: 'QB', season, week: 1, stats: stats(index || season === 1992 ? 100 : 200) }))));
let league = E.createTimeLeague({ name: 'Identified evidence', seed: 'identified-ui', createdAt: '2026-09-25T12:00:00Z', seats: [{ name: 'Home', manager: 'human' }, { name: 'Away', manager: 'human' }],
    settings: { gameDeckVersion: 1, hiddenYears: true, regularSeasonWeeks: 12, rosterSlots: { QB: 1 }, scoring, eraRules: { mode: 'selected-decades', decades: ['1990s'] } } });
const week = { week: 1, headlines: [], matchups: [{ home: 't1', away: 't2', homePoints: 8, awayPoints: 8, winner: 't1' }],
    results: entries.map((entry, i) => ({ teamId: `t${i+1}`, total: 8, starters: [{ ...entry, points: 8, stats: stats(100) }] })),
    playerProduction: entries.map(entry => ({ ...entry, points: 8, factor: 1, stats: stats(100) })) };
league = { ...league, phase: 'season', currentWeek: 2, weekStage: 'claims', seasonsRevealed: true,
    teams: league.teams.map((team, i) => ({ ...team, roster: [entries[i]] })), finalizedWeeks: [week] };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
const classes = (tree, cls) => walk(tree).filter(node => node.props.className?.split(' ').includes(cls));
const render = (component, extra = {}, hooks = []) => { cursor = 0; state = hooks; return component({ league, cards, logIndex: logs, onUpdate() {}, onNavigate() {}, ...extra }); };
const player = (tree, id) => walk(tree).find(node => node.props['data-entry-id'] === id);
function assertLabels(tree, identified) {
    const known = player(tree, 'e0'), ambiguous = player(tree, 'e1');
    assert(known && ambiguous);
    assert.equal(text(known).includes('1992'), identified);
    assert.equal(text(known).includes('identified'), identified);
    assert(!/\b199[239]\b/.test(text(ambiguous)), 'Multiple candidates do not reveal a year');
    assert(!text(known).includes('1999'), 'Private assignment never overrides public evidence');
}
assertLabels(render(WrTimeLeagueGamecastPanel), true);
for (const throughWeek of [0, null, '1', NaN, -1]) assertLabels(render(WrTimeLeagueGamecastPanel, { throughWeek }), false);
assertLabels(render(WrTimeLeagueGamecastPanel, { logIndex: new Map() }), false);
assertLabels(render(WrTimeLeagueGamecastPanel, { autoPlayWeek: 1 }), false);
const timeline = G.buildGamecast({ week: 1, results: week.results, matchups: week.matchups, seed: league.seed, scoring });
const live = { timeline, weekData: week, finalized: league, live: true };
assertLabels(render(WrTimeLeagueGamecastPanel, {}, [live, 15, false, 300]), false);
assertLabels(render(WrTimeLeagueGamecastPanel, {}, [live, G.GAMECAST_END, false, 300]), true);
assertLabels(render(WrTimeLeagueGamecastPanel, {}, [{ ...live, live: false }, 0, false, 300]), true);
let tree = render(WrTimeLeagueGamecastPanel, {}, [null, 0, false, 300, true, null, 1]);
const boxes = classes(tree, 'tl-box-scores');
assert(text(boxes).includes('1992') && text(boxes).includes('1990s') && !text(boxes).includes('1999'));
tree = render(WrTimeLeagueHomePanel);
assert(text(tree).includes('1992 · identified'), 'Home leaders retain the known season');
const finale = { ...league, phase: 'complete', currentWeek: 14, championTeamId: 't1', finalizedWeeks: [{ ...week, week: 13 }] };
tree = render(WrTimeLeagueHomePanel, { league: finale });
assert(text(classes(tree, 'tl-ceremony')).includes('1992 · identified'), 'Home passes public evidence into championship honors');
tree = render(WrTimeLeagueCeremony, { league: finale, throughWeek: 0 });
assert(!text(tree).includes('1992') && !text(tree).includes('1999'), 'Ceremony honors respect the same evidence horizon');
console.log('PASS: identified-season consistency across live lineups, box scores, Home and championship; missing archive, ambiguity, pending/unfinished playback and replay boundaries.');
