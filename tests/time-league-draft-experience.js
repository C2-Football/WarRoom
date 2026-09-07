'use strict';
const assert = require('assert');
global.window = globalThis;
window.App = {};
for (const name of ['roster','rules','draft-room','era-rules','season','helmet','engine','ai']) require(`../js/shared/time-league-${name}.js`);
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useMemo: (fn) => fn(), useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: () => ({ current: null }), Fragment: 'fragment'
};
require('../js/components/time-league-draft-panel.js');
const Engine = App.TimeLeagueEngine;
const cards = new Map(Array.from({ length: 8 }, (_, i) => [`p${i}`, { identity: `p${i}`, name: `Player ${i}`, position: 'RB', peak: 100 + i,
    seasons: [{ season: 1980 + i, games: 14, points: 100 + i }] }]));
let league = Engine.createTimeLeague({ name: 'Grid test', seed: 'grid', createdAt: '2026-01-01',
    settings: { rosterSlots: { RB: 1, BN: 1 }, regularSeasonWeeks: 12, playoffTeams: 0, eraRules: { mode: 'any-era', decades: [] } },
    seats: [{ name: 'Alpha', manager: 'human' }, { name: 'Beta', manager: 'ai' }] });
for (const card of [...cards.values()].slice(0, 4)) league = Engine.applyDraftPick(league, card, { madeBy: 'human', createdAt: '2026-01-01' });
assert.equal(league.seasonsRevealed, true);
const SharedGrid = () => {};
window.DraftCC = { DraftGridPanel: SharedGrid };
const tree = window.WrTimeLeagueDraftPanel({ league, cards, onUpdate: () => {} });
function find(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap((child) => find(child, predicate))]; }
const shared = find(tree, (node) => node.type === SharedGrid)[0];
assert.ok(shared, 'Completed draft defaults to the actual DHQ grid');
assert.equal(shared.props.state.rounds, 2);
assert.equal(shared.props.state.leagueSize, 2);
for (const pick of shared.props.state.picks) assert.equal(league.teams[pick.teamIdx].teamId, pick.teamId, 'Snake order retains stable team columns');
assert.equal(find(tree, (node) => node.props.className === 'tl-card tl-draft-grade').length, 2, 'Every team has a letter grade');
assert.ok(JSON.stringify(shared.props.renderPick(shared.props.state.picks[0])).includes('1980'), 'Completed cells include drawn season');
delete window.DraftCC;
assert.ok(window.WrTimeLeagueDraftPanel({ league, cards, onUpdate: () => {} }), 'Fallback renders while DHQ loads');
console.log('Vault draft experience: shared grid, snake columns, grades, drawn seasons and loading fallback passed');
