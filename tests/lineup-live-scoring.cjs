'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const ctx = { window: { App: {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/shared/nfl-context.js', 'utf8'), ctx);
const NC = ctx.window.App.NflContext;
const now = Date.parse('2026-09-13T17:00:00Z');
const future = { state: 'pre', kickoff: '2026-09-13T20:25:00Z' };
assert.equal(NC.gameStatus(future, now), 'upcoming');
assert.equal(NC.gameStatus({ ...future, kickoff: '2026-09-13T17:00:00Z' }, now), 'locked');
assert.equal(NC.gameStatus({ ...future, state: 'in' }, now), 'live');
assert.equal(NC.gameStatus({ ...future, completed: true }, now), 'final');
assert.equal(NC.gameStatus({ ...future, statusName: 'STATUS_POSTPONED' }, now), 'unknown');
assert.equal(NC.gameStatus({ state: 'pre' }, now), 'unknown');
assert.equal(NC.gameStatus(null, now), 'unknown');
assert.equal(NC.gameStatus({ state: 'post', completed: false, statusName: 'STATUS_CANCELED' }, now), 'unknown');
assert.equal(NC.gameStatus({ state: 'post', completed: true, statusName: 'STATUS_CANCELED' }, now), 'unknown');
assert.equal(NC.gameStatus({ state: 'post' }, now), 'unknown');
const parsed = NC.parseScores({ events: [{ date: '2026-09-13T20:25:00Z', competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: 'WSH' } }, { homeAway: 'away', team: { abbreviation: 'JAC' } }
], status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } } }] }] });
assert.equal(parsed[0].home, 'WAS');
assert.equal(parsed[0].away, 'JAX');
assert.equal(parsed[0].kickoff, future.kickoff);
assert.equal(NC.gameStatus(parsed[0], now), 'upcoming');
// Render the no-projection branch: actual scoring must remain available when
// projections haven't loaded; don't substitute working lineups or invent zero.
const h = (type, props, ...children) => ({ type, props, children });
ctx.React = { createElement: h, Fragment: 'fragment', useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {} };
ctx.window.WR = { useViewport: () => ({ width: 375, isPhone: true }) };
ctx.window.App.WeeklyProj = { optimalForRoster: () => null };
ctx.window.App.StartSit = { normSlot: s => s, FLEX_ALLOWED: {}, BASE_POSITIONS: new Set(['QB']) };
ctx.window.App.LeagueLiveScores = {
    currentWeek: () => 1,
    useScores: () => ({ rows: [{ roster_id: 1, starters: ['a', 'b', 'c'], players_points: { a: 0, b: -2.5 }, points: -2.5 }], supported: true, status: 'ready', updatedAt: now }),
    rosterPoints: row => row.points,
    playerPoints: (row, pid) => typeof row.players_points[pid] === 'number' ? row.players_points[pid] : null,
};
const source = babel.transform(fs.readFileSync('js/tabs/lineup.js', 'utf8'), { presets: ['react'] }).code;
vm.runInContext(source, ctx);
const out = ctx.LineupTab({ myRoster: { roster_id: 1, starters: ['other'] }, currentLeague: { league_id: '123', season: 2026, roster_positions: ['QB'] }, playersData: { a: { full_name: 'Zero Starter' }, b: { full_name: 'Negative Starter' }, c: { full_name: 'Missing Starter' } } });
const rendered = JSON.stringify(out);
assert.match(rendered, /Zero Starter/);
assert.match(rendered, /Negative Starter/);
assert.match(rendered, /Missing Starter/);
assert.match(rendered, /0.00/);
assert.match(rendered, /-2.50/);
assert.match(rendered, /SAVED PROJ/);
assert.match(rendered, /not an original pregame forecast/);
assert.doesNotMatch(rendered, /Player other/);
console.log('PASS lineup live scoring: kickoff locks, schedule aliases, and missing-projection scoring render');
