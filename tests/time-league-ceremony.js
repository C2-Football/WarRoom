'use strict';
const assert = require('node:assert/strict');
global.window = global;
global.App = {};
global.React = { createElement() {} };
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
console.log('PASS ceremony: saved results, title MVP, record, old league fallback, no mutation');
