'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync('js/utils/player-comparison.js', 'utf8'), context);
const summarize = options => JSON.parse(JSON.stringify(context.window.App.PlayerComparison.summarize({ pid: 'p', season: '2026', ...options })));
const score = raw => (raw.pts_ppr ?? 0) / raw.gp;

let result = summarize({ statsData: { p: { gp: 4, pts_ppr: 51, rec_tgt: 32, rec_yd: 280 } }, priorData: { p: { gp: 16, pts_ppr: 256 } }, calcPPG: score, position: 'WR', meta: { trend: 15 } });
assert.equal(result.ppg, 12.8);
assert.equal(result.season, 2026);
assert.equal(result.games, 4);
assert.equal(result.ppgLabel, '2026 PPG');
assert.match(result.sourceLabel, /2026.*4 games.*league scoring/);
assert.equal(result.trend, -20, 'observed scoring change takes precedence over model metadata');
assert.deepEqual(result.usage, [{ label: 'Targets', value: 8, unit: '/game' }, { label: 'Rec yards', value: 70, unit: '/game' }]);

result = summarize({ statsData: { p: { gp: 0, pts_ppr: 0, rec_tgt: 99 } }, priorData: { p: { gp: 10, pts_ppr: 150, rec_tgt: 80 } }, calcPPG: score, position: 'WR' });
assert.equal(result.ppg, 15);
assert.equal(result.season, 2025);
assert.equal(result.games, 10);
assert.match(result.sourceLabel, /2025.*prior season/);
assert.deepEqual(result.usage, [{ label: 'Targets', value: 8, unit: '/game' }], 'usage shares the PPG source season and denominator');

for (const points of [0, -4]) {
    result = summarize({ statsData: { p: { gp: 2, pts_ppr: points } }, priorData: { p: { gp: 16, pts_ppr: 320 } }, calcPPG: score });
    assert.equal(result.ppg, points / 2, 'current zero/negative average must not fall back to a better previous season');
    assert.equal(result.season, 2026);
}
result = summarize({ statsData: { p: { gp: 0, rec: 0 } }, calcPPG: () => 0, position: 'WR' });
assert.equal(result.games, 0);
assert.equal(result.ppg, null, 'zero games cannot establish per-game scoring');
assert.deepEqual(result.usage, []);
result = summarize({ statsData: { p: { gp: -1, rec_tgt: 4 } }, calcPPG: () => 0, position: 'WR' });
assert.equal(result.games, -1, 'retain the reported sample without using an invalid denominator');
assert.equal(result.ppg, null);
assert.deepEqual(result.usage, []);
result = summarize({ statsData: { p: {} }, calcPPG: () => 0 });
assert.equal(result.ppg, null, 'a scorer default of zero is not evidence of a reported line');
assert.equal(result.games, null);
assert.equal(result.sourceLabel, 'Stats unavailable');

for (const trend of [undefined, null, '', '15', NaN, Infinity, 0, -20]) assert.equal(summarize({ meta: { trend } }).trend, null, 'model metadata cannot prove an observed change');
assert.equal(summarize({}).trend, null);
const observedTrend = (current, prior) => summarize({ statsData: { p: { gp: 2, pts_ppr: current } }, priorData: { p: { gp: 2, pts_ppr: prior } }, calcPPG: score }).trend;
assert.equal(observedTrend(20, 20), 0, 'equal observed averages prove a flat trend');
assert.equal(observedTrend(30, 20), 50);
assert.equal(observedTrend(0, 20), -100, 'a reported zero current average still has an observed decline');
assert.equal(observedTrend(-20, 20), -200, 'negative current averages retain their change');
assert.equal(observedTrend(20, 0), null, 'a zero prior average cannot be a percentage denominator');
assert.equal(observedTrend(20, -20), null, 'a negative prior average does not support a meaningful percentage change');
assert.equal(summarize({ statsData: { p: { gp: 0, pts_ppr: 0 } }, priorData: { p: { gp: 2, pts_ppr: 20 } }, calcPPG: score }).trend, null, 'fallback to a prior season alone is not YoY evidence');

for (const [average, displayed] of [[0, 0], [-1.25, -1.3], [10.125, 10.1]]) {
    result = summarize({ statsData: { p: { _mflScoring: { average, points: 80, season: '2026', week: null } } }, calcPPG: () => 999 });
    assert.equal(result.ppg, displayed, 'native MFL average works without invented GP');
    assert.equal(result.games, null);
    assert.match(result.sourceLabel, /games unreported.*MFL scoring/);
    assert.deepEqual(result.usage, []);
}
result = summarize({ statsData: { p: { gp: 4, _mflScoring: { average: null, points: -8, season: '2026' } } } });
assert.equal(result.ppg, -2, 'reported native total can use actual reported games');
result = summarize({ statsData: { p: { gp: 4, pts_ppr: 999, _mflScoring: { average: null, points: null, season: '2026' } } }, calcPPG: score });
assert.equal(result.ppg, null, 'missing native MFL scoring cannot fall back to generic NFL fantasy fields');
result = summarize({ statsData: { p: { _mflScoring: { average: 99, season: '2025' } } }, priorData: { p: { gp: 2, pts_ppr: 8 } }, calcPPG: score });
assert.equal(result.ppg, 4);
assert.equal(result.season, 2025, 'a stale current-row cache cannot acquire the current year');
result = summarize({ statsData: { p: { gp: 1, _mflScoring: { average: 20, season: '2026', week: 3 } } } });
assert.equal(result.ppg, null, 'a weekly score is not a season average');

result = summarize({ statsData: { p: { gp: 2, pts_ppr: 8, rush_att: 10, rec: 0, rush_yd: -4, rec_yd: 0 } }, calcPPG: score, position: 'RB' });
assert.deepEqual(result.usage, [{ label: 'Touches', value: 5, unit: '/game' }, { label: 'Scrimmage yards', value: -2, unit: '/game' }]);
result = summarize({ statsData: { p: { gp: 2, rush_att: 10, rush_yd: 40 } }, calcPPG: () => null, position: 'RB' });
assert.deepEqual(result.usage, [{ label: 'Rush yards', value: 20, unit: '/game' }, { label: 'Carries', value: 5, unit: '/game' }], 'unknown receiving totals must not be silently treated as zero for combined stats');
result = summarize({ statsData: { p: { gp: 2, rec_tgt: 0 } }, calcPPG: () => null, position: 'TE' });
assert.deepEqual(result.usage, [{ label: 'Targets', value: 0, unit: '/game' }]);
result = summarize({ statsData: { p: { gp: 2, idp_tkl_solo: 0, tkl_solo: 6, idp_tkl_ast: 0, idp_sack: 0.5 } }, calcPPG: () => null, position: 'EDGE' });
assert.deepEqual(result.usage, [{ label: 'Tackles', value: 0, unit: '/game' }, { label: 'Sacks', value: 0.3, unit: '/game' }], 'reported primary zero takes precedence over another stat alias');
for (const gp of [undefined, null, 0, -2]) assert.deepEqual(summarize({ statsData: { p: { gp, rec_tgt: 12 } }, position: 'WR' }).usage, []);
assert.deepEqual(summarize({ statsData: { p: { gp: 3 } }, position: 'WR' }).usage, []);

let requestedPid;
result = summarize({ weeklyHistory: pid => { requestedPid = pid; return [{ week: 6, pts: -2 }, { week: 1, pts: 4 }, { week: 2, pts: 0 }, { week: 4, pts: 8 }, { week: 3, pts: 10 }, { week: 5, pts: 6 }, { week: 7, pts: null }, { week: 8, pts: '' }, { week: 9, pts: Infinity }]; } });
assert.equal(requestedPid, 'p');
assert.deepEqual(result.recentGames, [{ week: 2, pts: 0 }, { week: 3, pts: 10 }, { week: 4, pts: 8 }, { week: 5, pts: 6 }, { week: 6, pts: -2 }]);
assert.equal(result.recentPPG, 4.4);
for (const weeklyHistory of [undefined, () => { throw Error('unavailable'); }, () => null]) {
    result = summarize({ weeklyHistory });
    assert.deepEqual(result.recentGames, []);
    assert.equal(result.recentPPG, null);
}
result = summarize({ calcPPG: () => { throw Error('not ready'); }, statsData: { p: { gp: 3, rec: 2 } } });
assert.equal(result.ppg, null);
result = summarize({ season: '2025', priorStatsSeason: '2025', priorData: { p: { gp: 10, pts_ppr: 100 } }, calcPPG: score });
assert.equal(result.ppg, null, 'a fixed 2025 cache is not 2024 prior-season evidence');
result = summarize({ season: '2026', priorStatsSeason: '2024', statsData: { p: { gp: 2, pts_ppr: 20 } }, priorData: { p: { gp: 2, pts_ppr: 10 } }, calcPPG: score });
assert.equal(result.ppg, 10);
assert.equal(result.trend, null, 'YoY requires an actual adjacent-year source');
result = summarize({ position: 'WR', statsData: { p: { gp: 2, pts_ppr: 10, rec_tgt: 8, rec_yd: 60, rec: 4, rec_td: 0 } }, calcPPG: score });
assert.deepEqual(result.usageMetrics, [
    { label: 'Targets', value: 4, unit: '/game' }, { label: 'Rec yards', value: 30, unit: '/game' },
    { label: 'Receptions', value: 2, unit: '/game' }, { label: 'Rec TDs', value: 0, unit: '/game' },
], 'custom stats retain observed zeros and use the same actual sample as the cards');
assert.equal(result.usage.length, 2, 'the default card keeps two role stats');
console.log('PASS player comparison: season/source fallback, zero/negative values, MFL averages, sample denominators, observed usage, nullable trends, and recent-game history');
