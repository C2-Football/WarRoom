#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const byes = require('../js/utils/nfl-byes.js');
assert.equal(byes.weekForPlayer({ team: 'PHI', bye_week: 9 }, 2026), 10, 'season schedule overrides stale player field');
assert.equal(byes.weekForPlayer({ team: 'DAL' }, 2026), 14);
assert.equal(byes.weekForPlayer({ team: 'ARI' }, 2026), 14);
assert.equal(byes.weekForPlayer({ team: 'DET' }, 2026), 6);
assert.equal(byes.weekForPlayer({ team: 'LA' }, 2026), 11);
assert.equal(byes.weekForPlayer({ team: 'JAC' }, 2026), 7);
assert.equal(byes.weekForPlayer({ team: null, bye_week: 10 }, 2026), null);
assert.equal(byes.weekForPlayer({ team: 'PHI', bye_week: 10 }, 2027), null, 'never leak current schedule into another season');
assert.equal(byes.weekForPlayer({ team: 'PHI', bye_week: 8, bye_season: 2027 }, 2027), 8);
assert.equal(byes.weekForPlayer({ team: 'PHI', bye_week: 99, bye_season: 2027 }, 2027), null);
const teams = 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
assert.equal(teams.filter(team => byes.weekForPlayer({ team }, 2026)).length, 32);
const players = { hurts: { team: 'PHI' }, barkley: { team: 'PHI' }, love: { team: 'ARI' }, javonte: { team: 'DAL' }, unknown: {} };
const roster = { players: ['hurts', 'barkley', 'love', 'javonte', 'unknown', 'hurts'] };
assert.deepEqual(byes.rosterWeeks(roster, players, 2026, 10), {
    weeks: [{ week: 10, pids: ['hurts', 'barkley'] }, { week: 14, pids: ['love', 'javonte'] }],
    unknown: ['unknown'],
});
assert.equal(byes.rosterWeeks(roster, players, 2026, 11).weeks.length, 1, 'past byes excluded');
assert.equal(byes.label({}, 2026), 'Bye —');
global.S = { nflState: { season: '2026', week: 10 } };
global.fetch = async () => ({ ok: false });
global.calcFantasyPts = s => Number(s.rush_yd || 0) * 0.1;
require('../js/shared/startsit-engine.js');
const WP = require('../js/shared/weekly-proj.js');
const opts = { playersData: { rb: { team: 'PHI', position: 'RB' } }, priorData: { rb: { gp: 17, rush_yd: 1700 } }, scoring: { rush_yd: 0.1 }, week: 10 };
const off = WP.projectPlayer('rb', opts);
assert.equal(off.injuryStatus, 'BYE');
assert.equal(off.available, false, 'player with missing bye field still unavailable');
const on = WP.projectPlayer('rb', { ...opts, week: 11 });
assert.equal(on.available, true, 'available again after bye');
console.log('PASS NFL byes: all teams, aliases, season isolation, shared byes, unknowns, weekly availability');
