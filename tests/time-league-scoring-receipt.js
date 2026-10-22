'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; global.App = {};
for (const name of ['roster', 'draft-room', 'season', 'gamecast']) require('../js/shared/time-league-' + name + '.js');
const S = App.TimeLeagueSeason;
const half = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
const line = values => ({ ...S.emptyStatLine(), ...values });
const reconciles = (stats, scoring, expected) => {
    const before = JSON.stringify({ stats, scoring });
    const receipt = S.scoringBreakdown(stats, scoring);
    assert.equal(receipt.total, expected);
    assert.equal(S.scoreStatLine(stats, scoring), expected);
    assert.equal(receipt.rows.reduce((sum, row) => sum + Math.round(row.points * 100), 0) + Math.round(receipt.rounding * 100), Math.round(expected * 100));
    assert.equal(JSON.stringify({ stats, scoring }), before, 'Receipts never mutate recorded production or league rules');
    return receipt;
};
const qb = line({ passYd: 300, passTd: 3, passInt: 2, rushYd: 20, rushTd: 1 });
reconciles(qb, half, 28); // 12 + 12 - 4 + 2 + 6
reconciles(line({ rec: 8, recYd: 127, recTd: 2 }), { ...half, reception: 1 }, 32.7);
const noPpr = reconciles(line({ rec: 8, recYd: 127 }), { ...half, reception: 0 }, 12.7);
assert.equal(noPpr.rows.find(row => row.stat === 'rec').weight, 0, 'A recorded stat worth zero remains explainable');
reconciles(line({ passInt: 3 }), half, -6);
const bonuses = reconciles(line({ passYd: 450 }), { ...half, bonuses: [{ stat: 'passYd', threshold: 300, points: 3 }, { stat: 'passYd', threshold: 400, points: 5 }] }, 26);
assert.equal(bonuses.rows.filter(row => row.group === 'bonus').length, 2, 'Reached bonuses stack under the real rules');
const custom = reconciles(line({ passTd: 2, passInt: 1, rushTd: 1 }), { ...half, stats: { passTd: 6, passInt: -3, rushTd: 8 } }, 17);
assert.equal(custom.rows.find(row => row.stat === 'passTd').weight, 6);
const kick = line({ extra: { fgm: 3, fgm_20_29: 2, fgm_50p: 1, fgmiss: 1, xpm: 4 } });
const kicker = reconciles(kick, half, 14); // 6 + 5 - 1 + 4; total FGM is not counted again
assert.equal(kicker.rows.find(row => row.stat === 'fgm').points, 0);
reconciles(kick, { ...half, extended: { fgm: 3, xpm: 1 } }, 13);
const rounding = reconciles(line({ passYd: 1, rushYd: 1 }), { ...half, stats: { passYd: .005, rushYd: .005 } }, .01);
assert.equal(rounding.rounding, -.01, 'Group rounding is shown rather than silently adjusting a stat');
reconciles(line({ extra: { sack: 2, int: 1, def_td: 1 } }), half, 10);
assert.equal(S.scoringBreakdown(null, half), null, 'Missing records are not a fabricated zero-stat line');

// Exercise the actual receipt renderer with no archive, private season, or seed.
global.React = { Fragment: 'fragment', createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }) };
require('../js/components/time-league-gamecast-panel.js');
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
const render = (starter, eraAdjusted = false) => text(WrTimeLeagueScoringReceipt({ starter, scoring: half, eraAdjusted }));
const player = { name: 'Recorded QB', stats: qb, points: 35, factor: 1.25 };
Object.defineProperty(player, 'drawnSeason', { get() { throw Error('Hidden year read'); } });
assert.match(render(player, true), /300 passing yards/);
assert.match(render(player, true), /Saved era factor.*1.25/);
assert.match(render(player, true), /Saved fantasy points.*35.00/);
assert(!render(player, true).includes('does not reconcile'));
const old = { ...player, points: 99 };
assert.match(render(old, true), /does not reconcile.*saved result is kept/);
assert.match(render(old, true), /Saved fantasy points.*99.00/, 'Old results are never repriced by opening an explanation');
assert.match(render({ name: 'No game', stats: null, points: 0 }), /No recorded game.*No injury or NFL bye is inferred/);
assert.match(render({ name: 'Old record', points: 0 }), /statistics are unavailable/);
assert(!render({ name: 'Old record', points: 0 }).includes('No recorded game'));
assert.match(render({ name: 'Partial source', stats: qb, points: 28, factor: 1, coverage: 'regular-season-missing-stats' }), /does not include fumbles lost or two-point conversions/);
assert.match(render({ name: 'Unknown adjustment', stats: qb, points: 35 }, true), /Saved era factor.*Unavailable/);
console.log('PASS: recorded scoring receipts reconcile known offense, turnovers, zero rates, custom weights, stacked bonuses, kicking/defense, group rounding and era factors; missing records, historical limits, hidden years and saved totals remain intact.');
