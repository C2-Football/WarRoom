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
assert.strictEqual(outlook.remaining, 1);
assert.strictEqual(outlook.estimatedRemaining, 3);
assert.strictEqual(outlook.signal, 'No game log');
assert.strictEqual(outlook.schedule[6].points, null);
assert.strictEqual(S.rosterOutlook(entry, 8, 7, new Map(), scoring, null).remaining, 0);
assert.strictEqual(S.rosterOutlook(entry, 1, 7, null, scoring, null), null);
assert.strictEqual(S.rosterOutlook(entry, 1, 7, index, scoring, null).estimatedRemaining, null);
console.log('PASS: outlook availability, pace, boundaries, and future-score isolation');
