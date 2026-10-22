'use strict';
/* global require, global, WrTimeLeagueCeremony */
const assert = require('node:assert/strict');
global.window = global;
global.App = {};
global.React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useState: () => [false, () => {}],
};
require('../js/components/time-league-ceremony.js');
const story = App.TimeLeagueChampionshipStory;
const league = { phase: 'complete', championTeamId: 'a', settings: { regularSeasonWeeks: 12 }, teams: [{ teamId: 'a', name: 'Champ' }, { teamId: 'b', name: 'Runner' }], finalizedWeeks: [
    { week: 1, matchups: [{ home: 'a', away: 'b', homePoints: 10, awayPoints: 20, winner: 'b' }], results: [{ teamId: 'a', total: 10 }] },
    { week: 14, matchups: [{ home: 'a', away: 'b', homePoints: 30, awayPoints: 25, winner: 'a' }], results: [{ teamId: 'a', total: 30, starters: [{ name: 'Star', drawnSeason: 1984, points: 20 }, { name: 'Other', points: 10 }] }] }
] };
const before = JSON.stringify(league);
const result = story(league);
assert.equal(result.runner.name, 'Runner');
assert.equal(result.mvp.name, 'Star');
assert.equal(result.points, 40);
assert.deepEqual(result.record, { wins: 1, losses: 1, ties: 0 });
assert.equal(result.path.length, 1);
assert.equal(JSON.stringify(league), before);
assert.equal(story({ ...league, phase: 'season' }), null);
assert.equal(story({ ...league, championTeamId: 'missing' }), null);
const old = story({ ...league, finalizedWeeks: league.finalizedWeeks.slice(0, 1) });
assert.equal(old.runner, null);
assert.equal(old.mvp, null);
assert.equal(old.path.length, 0);
assert.equal(old.champion.name, 'Champ');
const copy = node => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(copy).join(' ') : copy(node.children);
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const closeFinal = { ...league, name: 'Close final', finalizedWeeks: [
    league.finalizedWeeks[0],
    { week: 14, matchups: [{ home: 'a', away: 'b', homePoints: 100.04, awayPoints: 100, winner: 'a' }],
        results: [{ teamId: 'a', total: 100.04, starters: [{ name: 'Precise Star', drawnSeason: 1984, points: 80.04 }, { name: 'Other', drawnSeason: 2000, points: 20 }] }] },
] };
const closeBefore = JSON.stringify(closeFinal); let navigated;
let tree = WrTimeLeagueCeremony({ league: closeFinal, onNavigate: tab => { navigated = tab; } });
assert(copy(tree).includes('Champ takes the title over Runner, 100.04–100.00.'));
assert(copy(tree).includes('Champ 100.04 — 100.00 Runner'), 'The playoff path keeps the actual saved margin visible');
assert(copy(tree).includes('110.04'), 'Saved season points retain their committed precision');
assert(copy(tree).includes('80.04 points'), 'The title MVP contribution retains its saved precision');
assert(!copy(tree).includes('tiebreaker'), 'A narrow score win is never explained as a seed tiebreak');
walk(tree).find(node => node.type === 'button' && copy(node).includes('RELIVE THE GAMES')).props.onClick();
assert.equal(navigated, 'gameday'); assert.equal(JSON.stringify(closeFinal), closeBefore, 'Rendering and replay navigation do not change the saved result');
const tiedFinal = { ...closeFinal, championTeamId: 'b', finalizedWeeks: [{ week: 14,
    matchups: [{ home: 'a', away: 'b', homePoints: 100.04, awayPoints: 100.04, winner: 'b' }],
    results: [{ teamId: 'b', total: 100.04, starters: [] }],
}] };
const tiedBefore = JSON.stringify(tiedFinal); tree = WrTimeLeagueCeremony({ league: tiedFinal });
assert(copy(tree).includes('Runner takes the title over Champ, 100.04–100.04. The higher seed wins the tiebreaker.'));
assert.equal(story(tiedFinal).champion.teamId, 'b', 'The saved away winner stays champion; the UI never chooses a winner from rounded scores');
assert.equal(JSON.stringify(tiedFinal), tiedBefore);
console.log('PASS ceremony: saved results, exact championship/path/MVP points, narrow wins, saved away tie winner, replay navigation, old league fallback and no mutation');
