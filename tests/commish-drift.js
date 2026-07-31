#!/usr/bin/env node
// Unit tests for the Drift Sentinel (js/shared/commish-drift.js): baseline
// capture, leaf diffing with the volatile-counter ignore list, pending
// merge/dedupe semantics, acknowledge folding, and the history cap. All
// storage goes through the engine's internal Map fallback (_mem) — no
// DhqStorage, no localStorage, no network.
'use strict';

const assert = require('assert');
const Drift = require('../js/shared/commish-drift.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

function mkLeague() {
  return {
    league_id: 'L1',
    settings: { leg: 3, last_scored_leg: 3, last_report: 2, trade_deadline: 10, playoff_teams: 6, waiver_budget: 100 },
    scoring_settings: { rec: 1, pass_td: 4, bonus_rec_te: 0.5 },
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
  };
}
function reset() { Drift._mem.clear(); }

// ── Baseline ────────────────────────────────────────────────────────
test('first run stores a baseline and reports no changes', () => {
  reset();
  const r = Drift.checkLeague(mkLeague(), { nowMs: 1000 });
  assert.strictEqual(r.firstRun, true);
  assert.deepStrictEqual(r.changes, []);
  assert.ok(Drift._mem.has('commish_drift_L1'), 'baseline persisted under commish_drift_<leagueId>');
});

test('unchanged re-check is quiet and carries baselineTs', () => {
  reset();
  Drift.checkLeague(mkLeague(), { nowMs: 1000 });
  const r = Drift.checkLeague(mkLeague(), { nowMs: 2000 });
  assert.strictEqual(r.firstRun, false);
  assert.deepStrictEqual(r.changes, []);
  assert.strictEqual(r.baselineTs, 1000);
});

test('unhydrated league (no settings, no scoring) refuses to baseline', () => {
  reset();
  assert.strictEqual(Drift.checkLeague({ league_id: 'L9' }, { nowMs: 1000 }), null);
  assert.ok(!Drift._mem.has('commish_drift_L9'), 'nothing stored — hydration later must not read as total drift');
  assert.strictEqual(Drift.checkLeague({ settings: { leg: 1 } }, { nowMs: 1000 }), null, 'no league id → null');
});

// ── Detection ───────────────────────────────────────────────────────
test('scoring mutation is detected with exact from/to', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  l.scoring_settings.rec = 1.5;
  const r = Drift.checkLeague(l, { nowMs: 3000 });
  assert.strictEqual(r.changes.length, 1);
  assert.deepStrictEqual(r.changes[0], { path: 'scoring.rec', from: 1, to: 1.5, detectedAt: 3000 });
});

test('volatile counters (leg / last_scored_leg / last_report) are ignored', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  l.settings.leg = 4;
  l.settings.last_scored_leg = 4;
  l.settings.last_report = 3;
  const r = Drift.checkLeague(l, { nowMs: 2000 });
  assert.deepStrictEqual(r.changes, [], 'week counters tick on their own — not commissioner edits');
});

test('settings and roster_positions changes both surface', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  l.settings.trade_deadline = 12;
  l.roster_positions.push('BN');
  const r = Drift.checkLeague(l, { nowMs: 2000 });
  const byPath = {};
  r.changes.forEach(c => { byPath[c.path] = c; });
  assert.strictEqual(r.changes.length, 2);
  assert.deepStrictEqual(byPath['settings.trade_deadline'], { path: 'settings.trade_deadline', from: 10, to: 12, detectedAt: 2000 });
  assert.strictEqual(byPath.positions.from, 'QB,RB,RB,WR,WR,TE,FLEX,BN');
  assert.strictEqual(byPath.positions.to, 'QB,RB,RB,WR,WR,TE,FLEX,BN,BN');
});

test('added leaf has from:null, removed leaf has to:null', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  delete l.scoring_settings.bonus_rec_te;
  l.scoring_settings.bonus_rec_wr = 0.5;
  const r = Drift.checkLeague(l, { nowMs: 2000 });
  const byPath = {};
  r.changes.forEach(c => { byPath[c.path] = c; });
  assert.strictEqual(r.changes.length, 2);
  assert.deepStrictEqual(byPath['scoring.bonus_rec_wr'], { path: 'scoring.bonus_rec_wr', from: null, to: 0.5, detectedAt: 2000 });
  assert.deepStrictEqual(byPath['scoring.bonus_rec_te'], { path: 'scoring.bonus_rec_te', from: 0.5, to: null, detectedAt: 2000 });
});

// ── Pending merge semantics ─────────────────────────────────────────
test('pending dedupe keeps ORIGINAL from across two successive edits', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  l.scoring_settings.rec = 1.5;
  Drift.checkLeague(l, { nowMs: 2000 });
  l.scoring_settings.rec = 2;
  const r = Drift.checkLeague(l, { nowMs: 3000 });
  assert.strictEqual(r.changes.length, 1, 'one pending entry per path');
  assert.deepStrictEqual(r.changes[0], { path: 'scoring.rec', from: 1, to: 2, detectedAt: 3000 },
    'from stays the acknowledged baseline (1), latest edit wins the to');
});

test('re-detecting the same drift preserves the original detectedAt', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  l.scoring_settings.rec = 1.5;
  Drift.checkLeague(l, { nowMs: 2000 });
  const r = Drift.checkLeague(l, { nowMs: 5000 }); // no further edit
  assert.strictEqual(r.changes.length, 1, 'still pending until acknowledged');
  assert.strictEqual(r.changes[0].detectedAt, 2000, 'detectedAt = when the change was FIRST seen');
});

test('a leaf edited back to baseline before ack drops out of pending', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  l.scoring_settings.rec = 1.5;
  Drift.checkLeague(l, { nowMs: 2000 });
  l.scoring_settings.rec = 1;
  const r = Drift.checkLeague(l, { nowMs: 3000 });
  assert.deepStrictEqual(r.changes, [], 'nothing net changed — nothing to report');
});

// ── Acknowledge + history ───────────────────────────────────────────
test('acknowledge folds pending into baseline and grows history', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  l.scoring_settings.rec = 1.5;
  Drift.checkLeague(l, { nowMs: 2000 });
  const group = Drift.acknowledge('L1', { nowMs: 2500 });
  assert.strictEqual(group.ackTs, 2500);
  assert.strictEqual(group.changes[0].path, 'scoring.rec');
  const r = Drift.checkLeague(l, { nowMs: 3000 });
  assert.deepStrictEqual(r.changes, [], 'folded baseline matches the league now');
  assert.strictEqual(r.baselineTs, 2500, 'baseline re-stamped at ack time');
  const h = Drift.history('L1');
  assert.strictEqual(h.length, 1);
  assert.deepStrictEqual(h[0].changes, [{ path: 'scoring.rec', from: 1, to: 1.5, detectedAt: 2000 }]);
});

test('acknowledge folds a removed leaf out of the baseline', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  delete l.scoring_settings.bonus_rec_te;
  Drift.checkLeague(l, { nowMs: 2000 });
  Drift.acknowledge('L1', { nowMs: 2500 });
  const r = Drift.checkLeague(l, { nowMs: 3000 });
  assert.deepStrictEqual(r.changes, [], 'deleted key must not re-flag as drift after ack');
});

test('acknowledge with nothing pending returns null and leaves history alone', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  assert.strictEqual(Drift.acknowledge('L1', { nowMs: 2000 }), null);
  assert.deepStrictEqual(Drift.history('L1'), []);
  assert.strictEqual(Drift.acknowledge('L404', { nowMs: 2000 }), null, 'unknown league → null, never a throw');
});

test('history caps at 50 groups, newest first', () => {
  reset();
  const l = mkLeague();
  Drift.checkLeague(l, { nowMs: 1000 });
  for (let i = 1; i <= 55; i++) {
    l.scoring_settings.rec = 1 + i;
    Drift.checkLeague(l, { nowMs: 10000 + i });
    Drift.acknowledge('L1', { nowMs: 10000 + i });
  }
  const h = Drift.history('L1');
  assert.strictEqual(h.length, 50, 'oldest groups pruned at 50');
  assert.strictEqual(h[0].ackTs, 10055, 'newest first');
  assert.strictEqual(h[49].ackTs, 10006, 'first five groups fell off');
});

test('leagues are isolated: L2 drift never bleeds into L1', () => {
  reset();
  const l1 = mkLeague();
  const l2 = { ...mkLeague(), league_id: 'L2', scoring_settings: { rec: 1, pass_td: 4, bonus_rec_te: 0.5 } };
  Drift.checkLeague(l1, { nowMs: 1000 });
  Drift.checkLeague(l2, { nowMs: 1000 });
  l2.scoring_settings.pass_td = 6;
  const r2 = Drift.checkLeague(l2, { nowMs: 2000 });
  const r1 = Drift.checkLeague(l1, { nowMs: 2000 });
  assert.strictEqual(r2.changes.length, 1);
  assert.deepStrictEqual(r1.changes, []);
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
