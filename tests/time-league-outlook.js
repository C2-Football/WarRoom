const assert = require('assert');
global.window = globalThis; window.App = {};
require('../js/shared/time-league-roster.js');
require('../js/shared/time-league-rules.js');
require('../js/shared/time-league-draft-room.js');
const S = require('../js/shared/time-league-season.js');
const entry = { identity: 'test', drawnSeason: 2000, position: 'RB' };
const scoring = { passingYd: .04, passTd: 4, rushRecYd: .1, reception: 1, turnover: -2 };
const index = new Map();
for (let week = 1; week <= 7; week++) {
    if (week === 6) continue;
    const log = { stats: { ...S.emptyStatLine(), rushYd: week * 10 } };
    if (week >= 6) Object.defineProperty(log, 'stats', { get() { throw Error('Future score leaked'); } });
    index.set(S.gameLogKey(entry.identity, 2000, week), log);
}
const outlook = S.rosterOutlook(entry, 6, 7, index, scoring, null);
assert.strictEqual(outlook.remaining, 2);
assert.strictEqual(outlook.estimatedRemaining, 6);
assert.strictEqual(outlook.signal, 'No recorded game');
assert.strictEqual(outlook.schedule[6].points, null);
assert.strictEqual(S.rosterOutlook(entry, 8, 7, new Map(), scoring, null).remaining, 0);
assert.strictEqual(S.rosterOutlook(entry, 1, 7, null, scoring, null), null);
assert.strictEqual(S.rosterOutlook(entry, 1, 7, index, scoring, null).estimatedRemaining, null);
console.log('PASS: outlook availability, pace, boundaries, and future-score isolation');

// Star clues intentionally use historical ranks, while pace above remains blind.
const starIndex = new Map();
for (let week = 1; week <= 14; week++) {
    if (week === 4) continue;
    starIndex.set(S.gameLogKey(entry.identity, 2000, week), { stats: { ...S.emptyStatLine(), rushYd: (15 - week) * 10 } });
}
const stars = S.weeklyStarOutlook(entry, 1, 14, starIndex, scoring, null);
assert.strictEqual(stars.stars, 5);
assert.strictEqual(stars.schedule.filter(row => row.stars === 5).length, 1);
assert.strictEqual(stars.schedule.filter(row => row.stars === 1).length, 0);
assert.strictEqual(stars.schedule[3].stars, null);
assert(stars.schedule.slice(1).every(row => row.available === null && row.stars === null), 'All future dates stay sealed');
const historical = S.weeklyStarOutlook(entry, 15, 14, starIndex, scoring, null);
assert.equal(historical.schedule.filter(row => row.stars === 5).length, 3);
assert.equal(historical.schedule.filter(row => row.stars === 1).length, 3);
assert.strictEqual(S.weeklyStarOutlook(entry, 4, 14, starIndex, scoring, null).maxRemainingStars, 4);
assert.strictEqual(S.weeklyStarOutlook(entry, 15, 14, starIndex, scoring, null).maxRemainingStars, null);
assert.strictEqual(S.weeklyStarOutlook(entry, 1, 14, null, scoring, null), null);
assert.ok(stars.schedule.every(row => !Object.hasOwn(row, 'points')));
const bonusScoring = { ...scoring, bonuses: [{stat:'rushYd', threshold:100, points:3}, {stat:'rushYd', threshold:200, points:2}] };
assert.strictEqual(S.scoreStatLine({...S.emptyStatLine(),rushYd:99}, bonusScoring), 9.9);
assert.strictEqual(S.scoreStatLine({...S.emptyStatLine(),rushYd:100}, bonusScoring), 13);
assert.strictEqual(S.scoreStatLine({...S.emptyStatLine(),rushYd:200}, bonusScoring), 25);
console.log('PASS: fixed star tiers, missing weeks, spent ceiling, and cumulative stat bonuses');
