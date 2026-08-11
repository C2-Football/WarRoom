#!/usr/bin/env node
// Unit tests for js/shared/time-league-season.js — weekly game-log scoring,
// ported from The Duat's app/time-season-engine.ts.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
require('../js/shared/time-league-roster.js');
require('../js/shared/time-league-draft-room.js');
const Season = require('../js/shared/time-league-season.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const SCORING = { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 };

test('isStarterSlot excludes bench/IR/taxi', () => {
    assert.strictEqual(Season.isStarterSlot('BN'), false);
    assert.strictEqual(Season.isStarterSlot('IR'), false);
    assert.strictEqual(Season.isStarterSlot('TAXI'), false);
    assert.strictEqual(Season.isStarterSlot('RB'), true);
});

test('scoreStatLine prices core offensive stats correctly', () => {
    const stats = { ...Season.emptyStatLine(), passYd: 300, passTd: 2, rushYd: 20, rec: 5, recYd: 50, passInt: 1 };
    // 300*.04 + 2*4 + (20+50)*.1 + 5*.5 + 1*-2 = 12 + 8 + 7 + 2.5 - 2 = 27.5
    assert.strictEqual(Season.scoreStatLine(stats, SCORING, {}), 27.5);
});

test('scoreStatLine adds extended (K/DEF/IDP) surface on top of core', () => {
    const stats = { ...Season.emptyStatLine(), extra: { fgm_40_49: 2, xpm: 3 } };
    // reference weights: fgm_40_49=4, xpm=1 -> 2*4 + 3*1 = 11
    assert.strictEqual(Season.scoreStatLine(stats, SCORING), 11);
});

test('gameLogKey round-trips through buildGameLogIndex', () => {
    const log = { identity: 'player:qb:testguy', name: 'Test Guy', position: 'QB', season: 2005, week: 3, stats: Season.emptyStatLine() };
    const index = Season.buildGameLogIndex([log]);
    assert.strictEqual(index.get(Season.gameLogKey('player:qb:testguy', 2005, 3)), log);
});

test('parseGameLogCsv parses nflverse-style headers and sums split rows', () => {
    const csv = [
        'player,pos,season,week,passing_yards,passing_tds,interceptions',
        'Test Guy,QB,2005,3,150,1,0',
        'Test Guy,QB,2005,3,100,1,0',
    ].join('\n');
    const { logs, skippedRows } = Season.parseGameLogCsv(csv);
    assert.strictEqual(skippedRows, 0);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].stats.passYd, 250);
    assert.strictEqual(logs[0].stats.passTd, 2);
});

test('parseGameLogCsv skips rows missing required columns/values', () => {
    const csv = ['player,pos,season,week', 'No Position,,2005,3'].join('\n');
    const { logs, skippedRows } = Season.parseGameLogCsv(csv);
    assert.strictEqual(logs.length, 0);
    assert.strictEqual(skippedRows, 1);
});

test('buildRoundRobinSchedule gives every team one game per week (even team count)', () => {
    const schedule = Season.buildRoundRobinSchedule(['a', 'b', 'c', 'd'], 3);
    assert.strictEqual(schedule.length, 3);
    for (const week of schedule) {
        const teamsPlaying = week.pairs.flat();
        assert.strictEqual(new Set(teamsPlaying).size, 4);
    }
});

test('buildRoundRobinSchedule byes exactly one team with an odd count', () => {
    const schedule = Season.buildRoundRobinSchedule(['a', 'b', 'c'], 1);
    assert.strictEqual(schedule[0].pairs.length, 1);
    assert.ok(schedule[0].byeTeamId);
});

test('eraFactorFor defaults to 1 when no factors supplied', () => {
    assert.strictEqual(Season.eraFactorFor(null, 1985, 'RB'), 1);
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
