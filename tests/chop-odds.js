#!/usr/bin/env node
// Unit tests for js/shared/chop-odds.js — the CHOPPED survival simulator.
// Deterministic (seeded RNG), so every assertion here is exact-repeatable.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = window.App || {};
require('../js/shared/chopped.js');
const ChopOdds = require('../js/shared/chop-odds.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const LEAGUE = {
  league_id: 'CHOP', name: 'Shootout', users: [],
  settings: { type: 3, last_chopped_leg: 6, waiver_budget: 10000 },
};
const REDRAFT = { league_id: 'RD', settings: { type: 0, playoff_week_start: 15 } };

const rosters = (ids, elim) => ids.map(id => ({
  roster_id: id, owner_id: 'u' + id, players: [],
  settings: (elim && elim[id]) ? { eliminated: elim[id], locked: 1 } : {},
}));
// Weekly rows: team 1 is clearly the worst, team 4 clearly the best.
const ledgerOf = spec => ({
  rows: Object.keys(spec).map(id => ({
    rosterId: Number(id),
    weekly: spec[id].map((pts, i) => ({ week: i + 1, pts })),
  })),
});

// ── Guards ──────────────────────────────────────────────────────────
test('returns null for a non-chopped league — this simulator has no business there', () => {
  assert.strictEqual(ChopOdds.simulate({ league: REDRAFT, rosters: rosters([1, 2]) }), null);
});
test('returns null with no rosters', () => {
  assert.strictEqual(ChopOdds.simulate({ league: LEAGUE, rosters: [] }), null);
});

// ── The core claim: the weakest team is the likeliest to be chopped ─
// Realistic weekly variance — real fantasy teams swing ~20-25 pts week to
// week, so the distributions OVERLAP and the weakest team is merely the most
// likely to go, not a certainty. (An earlier fixture had near-zero variance,
// which chopped teams 1 and 2 in literally every simulation and saturated
// every probability at 0 or 100.)
const SPEC = {
  1: [70, 95, 55, 82],       // mean ~75, worst
  2: [95, 70, 112, 84],      // mean ~90
  3: [110, 132, 94, 119],    // mean ~114
  4: [130, 108, 152, 138],   // mean ~132, best
};
// week 1 of a 6-leg league with 4 teams: enough chops to reduce to one winner,
// which is how a real chopped league is configured (18 teams, 17 legs).
const FULL = { league: LEAGUE, rosters: rosters([1, 2, 3, 4]), ledger: ledgerOf(SPEC), week: 1, sims: 4000 };

test('survival ranks inversely to scoring — the worst team is in most danger', () => {
  const sim = ChopOdds.simulate({ ...FULL, myRosterId: 1 });
  assert.ok(sim, 'simulated');
  const by = {}; sim.rows.forEach(r => { by[r.rosterId] = r; });
  assert.ok(by[1].survivePct < by[2].survivePct, '1 survives less than 2');
  assert.ok(by[2].survivePct < by[3].survivePct, '2 less than 3');
  assert.ok(by[3].survivePct < by[4].survivePct, '3 less than 4');
  const maxChop = Math.max(...sim.rows.map(r => r.chopThisWeekPct));
  assert.strictEqual(by[1].chopThisWeekPct, maxChop, 'the worst team carries the highest chop risk');
  assert.ok(by[1].chopThisWeekPct > 35 && by[1].chopThisWeekPct < 100, 'likely but never certain: ' + by[1].chopThisWeekPct);
  assert.strictEqual(sim.rows[0].rosterId, 1, 'sorted most-endangered first');
});
test('this-week chop probabilities sum to ~100% across living teams', () => {
  const sim = ChopOdds.simulate(FULL);
  const total = sim.rows.filter(r => r.alive).reduce((s, r) => s + r.chopThisWeekPct, 0);
  assert.ok(Math.abs(total - 100) < 1.5, 'exactly one team is chopped per week: ' + total);
});
test('win probabilities sum to ~100% and favour the best team', () => {
  const sim = ChopOdds.simulate(FULL);
  const total = sim.rows.reduce((s, r) => s + r.winPct, 0);
  assert.ok(Math.abs(total - 100) < 1.5, 'someone always survives: ' + total);
  const by = {}; sim.rows.forEach(r => { by[r.rosterId] = r; });
  assert.ok(by[4].winPct > by[1].winPct, 'the best team wins most often');
  assert.ok(by[4].winPct > 35, 'and by a clear margin: ' + by[4].winPct);
});
test('a truncated config (fewer legs than teams) leaves several alive, so nobody has won', () => {
  // week 5 of a 6-leg league = 2 chops among 4 teams → 2 survivors.
  const sim = ChopOdds.simulate({ league: LEAGUE, rosters: rosters([1, 2, 3, 4]), ledger: ledgerOf(SPEC), week: 5, sims: 2000 });
  assert.strictEqual(sim.rows.reduce((s, r) => s + r.winPct, 0), 0, 'winPct means LAST ONE STANDING — nobody is');
  const survive = sim.rows.reduce((s, r) => s + r.survivePct, 0);
  assert.ok(Math.abs(survive - 200) < 3, 'two teams expected to survive: ' + survive);
});
test('the winner is credited the full remaining calendar, not just to the clinching week', () => {
  const sim = ChopOdds.simulate({ ...FULL, myRosterId: 4 });
  const by = {}; sim.rows.forEach(r => { by[r.rosterId] = r; });
  // Team 4 wins most of the time; its expected weeks must approach the full
  // 6-week calendar rather than stopping at week 3 when the field clears.
  assert.ok(by[4].expWeeksLeft > 4, 'the likely winner plays out most of the season: ' + by[4].expWeeksLeft);
  assert.ok(by[4].expWeeksLeft <= sim.weeks.length);
});
test('deterministic: the same seed reproduces the same odds exactly', () => {
  const args = { league: LEAGUE, rosters: rosters([1, 2, 3, 4]), ledger: ledgerOf(SPEC), week: 5, sims: 800, seed: 7 };
  const a = ChopOdds.simulate(args), b = ChopOdds.simulate(args);
  assert.deepStrictEqual(a.rows.map(r => r.chopThisWeekPct), b.rows.map(r => r.chopThisWeekPct));
  const c = ChopOdds.simulate({ ...args, seed: 99 });
  assert.notDeepStrictEqual(a.rows.map(r => r.chopThisWeekPct), c.rows.map(r => r.chopThisWeekPct), 'a different seed moves them');
});

// ── Elimination handling ────────────────────────────────────────────
test('already-chopped teams are excluded from the sim and reported as dead', () => {
  const sim = ChopOdds.simulate({
    league: LEAGUE, rosters: rosters([1, 2, 3, 4], { 1: 2, 2: 3 }), ledger: ledgerOf(SPEC),
    week: 4, sims: 1000,
  });
  assert.strictEqual(sim.aliveCount, 2);
  const dead = sim.rows.filter(r => !r.alive);
  assert.strictEqual(dead.length, 2);
  dead.forEach(d => {
    assert.strictEqual(d.chopThisWeekPct, 0);
    assert.strictEqual(d.winPct, 0);
    assert.strictEqual(d.expWeeksLeft, 0);
    assert.ok(d.eliminatedWeek > 0, 'reports the week it went out');
  });
  const alive = sim.rows.filter(r => r.alive);
  assert.ok(Math.abs(alive.reduce((s, r) => s + r.winPct, 0) - 100) < 1.5, 'the two survivors split the title');
});
test('a lone survivor wins 100% and nothing is simulated', () => {
  const sim = ChopOdds.simulate({
    league: LEAGUE, rosters: rosters([1, 2], { 2: 3 }), ledger: ledgerOf({ 1: [100], 2: [80] }),
    week: 4, myRosterId: 1, sims: 500,
  });
  assert.strictEqual(sim.aliveCount, 1);
  assert.strictEqual(sim.me.winPct, 100);
  assert.ok(sim.me.expWeeksLeft > 0, 'still plays out the remaining weeks');
});

// ── Horizon ─────────────────────────────────────────────────────────
test('expWeeksLeft is shorter for a team likely to be chopped early', () => {
  const sim = ChopOdds.simulate({
    league: LEAGUE, rosters: rosters([1, 2, 3, 4]), ledger: ledgerOf(SPEC), week: 1, sims: 3000,
  });
  const by = {}; sim.rows.forEach(r => { by[r.rosterId] = r; });
  assert.ok(by[1].expWeeksLeft < by[4].expWeeksLeft, 'the worst team expects fewer weeks');
  assert.ok(by[4].expWeeksLeft <= sim.weeks.length, 'never more than the calendar');
  assert.ok(by[1].expWeeksLeft >= 1, 'you always play the current week');
});
test('survivalHorizon prefers the simulated horizon, falls back to the calendar', () => {
  const sim = ChopOdds.simulate({
    league: LEAGUE, rosters: rosters([1, 2, 3, 4]), ledger: ledgerOf(SPEC), week: 3, myRosterId: 1, sims: 1500,
  });
  assert.strictEqual(ChopOdds.survivalHorizon(sim, 12), sim.me.expWeeksLeft);
  assert.strictEqual(ChopOdds.survivalHorizon(null, 12), 12, 'no sim → calendar');
  assert.strictEqual(ChopOdds.survivalHorizon({ me: null }, 9), 9);
});
test('the survival curve decays and is capped at the last chopped leg', () => {
  const sim = ChopOdds.simulate({
    league: LEAGUE, rosters: rosters([1, 2, 3, 4]), ledger: ledgerOf(SPEC), week: 2, myRosterId: 1, sims: 2000,
  });
  const curve = sim.me.curve;
  assert.deepStrictEqual(curve.map(c => c.week), [2, 3, 4, 5, 6], 'runs to last_chopped_leg 6');
  assert.strictEqual(curve[0].alivePct, 100, 'alive right now by definition');
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].alivePct <= curve[i - 1].alivePct, 'survival never increases');
  }
  assert.ok(curve[curve.length - 1].alivePct < curve[0].alivePct, 'and it does decay');
});

// ── Preseason ───────────────────────────────────────────────────────
test('preseason: no games played → seeded from projected means, and says so', () => {
  const sim = ChopOdds.simulate({
    league: LEAGUE, rosters: rosters([1, 2, 3, 4]), ledger: { rows: [] },
    week: 1, myRosterId: 4, sims: 2000,
    seedMeans: { 1: 70, 2: 95, 3: 110, 4: 130 },
  });
  assert.strictEqual(sim.basis, 'projected', 'labelled honestly');
  const by = {}; sim.rows.forEach(r => { by[r.rosterId] = r; });
  assert.ok(by[1].chopThisWeekPct > by[4].chopThisWeekPct, 'projections still rank the danger');
  assert.strictEqual(by[1].basis, 'projected');
});
test('preseason with NO projections: nobody is singled out', () => {
  const sim = ChopOdds.simulate({
    league: LEAGUE, rosters: rosters([1, 2, 3, 4]), ledger: { rows: [] }, week: 1, sims: 3000,
  });
  const alive = sim.rows.filter(r => r.alive);
  alive.forEach(r => {
    assert.strictEqual(r.basis, 'league-average');
    assert.ok(Math.abs(r.chopThisWeekPct - 25) < 4, 'four identical teams ≈ 25% each, got ' + r.chopThisWeekPct);
  });
});

// ── fitDists ────────────────────────────────────────────────────────
test('fitDists weights recent weeks heavier and never returns a metronome', () => {
  const d = ChopOdds.fitDists([{ rosterId: 1, weekly: [
    { week: 1, pts: 80 }, { week: 2, pts: 80 }, { week: 3, pts: 80 },
    { week: 4, pts: 120 }, { week: 5, pts: 120 }, { week: 6, pts: 120 }, { week: 7, pts: 120 },
  ] }]);
  const flat = (80 * 3 + 120 * 4) / 7;
  assert.ok(d['1'].mean > flat, 'recency pulls the mean up: ' + d['1'].mean + ' vs flat ' + flat);
  const steady = ChopOdds.fitDists([{ rosterId: 2, weekly: [{ week: 1, pts: 100 }, { week: 2, pts: 100 }] }]);
  assert.ok(steady['2'].sd >= 8, 'sd floored so a "consistent" team still has variance');
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
  process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
