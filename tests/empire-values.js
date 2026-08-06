#!/usr/bin/env node
// Unit tests for js/shared/empire-values.js — MARK TO LEAGUE.
// Hand-built leagues that differ ONLY in the ways the doctrine says may move a
// price (scoring, roster slots, team count), so every assertion is about the
// engine honouring those and nothing else.
'use strict';

const assert = require('assert');
globalThis.fetch = () => Promise.resolve({ ok: false });
global.window = globalThis;
window.S = { currentWeek: 1 };
window.App = {};
const StartSit = require('../js/shared/startsit-engine.js');
const WeeklyProj = require('../js/shared/weekly-proj.js');
window.App.StartSit = window.App.StartSit || StartSit;
window.App.WeeklyProj = window.App.WeeklyProj || WeeklyProj;
window.App.normPos = p => String(p || '').toUpperCase();
window.calcFantasyPts = (line, sc) => {
  let t = 0;
  for (const k in (sc || {})) if (typeof sc[k] === 'number' && line && line[k] != null) t += line[k] * sc[k];
  return Math.round(t * 10) / 10;   // mirror the real engine's tenth-point rounding
};
require('../js/utils/player-value.js');
const EV = require('../js/shared/empire-values.js');
const PV = window.App.PlayerValue;

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Fixtures ────────────────────────────────────────────────────────
// A realistic pool: the replacement-rank difference between a 1QB league
// (12 QBs start) and a superflex one (~21) only bites if enough quarterbacks
// EXIST to rank that deep. A three-QB fixture clamps both to the same worst
// player and the formats look identical — which is a fixture artifact, not
// engine behaviour.
const PLAYERS = {}, PROJ = {};
function addPool(prefix, pos, n, build) {
  for (let i = 1; i <= n; i++) {
    const id = prefix + i;
    PLAYERS[id] = { position: pos, full_name: pos + ' ' + i };
    PROJ[id] = Object.assign({ gp: 17 }, build(i));
  }
}
// Declining production down each positional ladder.
addPool('qb', 'QB', 32, i => ({ pass_yd: 5000 - i * 90, pass_td: 42 - i * 0.9, pass_int: 8 + i * 0.2, rush_yd: 520 - i * 14, rush_td: 7 - i * 0.18 }));
addPool('rb', 'RB', 60, i => ({ rush_yd: 1450 - i * 18, rush_td: 13 - i * 0.16, rec: 62 - i * 0.7, rec_yd: 520 - i * 6, rec_td: 3 }));
addPool('wr', 'WR', 80, i => ({ rec: 115 - i * 1.0, rec_yd: 1550 - i * 14, rec_td: 11 - i * 0.1 }));
addPool('te', 'TE', 30, i => ({ rec: 88 - i * 2.0, rec_yd: 1050 - i * 26, rec_td: 8 - i * 0.2 }));
const SCORES = {}; Object.keys(PLAYERS).forEach(p => { SCORES[p] = 1000; });

const BASE_SCORING = { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6 };
const oneQbRoster = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'];
const superflexRoster = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN'];

const league = (id, name, over) => Object.assign({
  league_id: id, name, total_rosters: 12,
  roster_positions: oneQbRoster,
  scoring_settings: { ...BASE_SCORING },
  settings: { type: 0, playoff_week_start: 15 },
}, over || {});

const runBuild = (leagues) => EV.build({
  leagues, playersData: PLAYERS, priorData: {}, projectionsData: PROJ,
  playerScores: SCORES, week: 1,
});

// ── Slot derivation (the mechanism superflex pricing rests on) ──────
test('slotsFromRoster: superflex creates real QB demand; bench is ignored', () => {
  const one = PV.slotsFromRoster(oneQbRoster);
  const sf = PV.slotsFromRoster(superflexRoster);
  assert.strictEqual(one.QB, 1, '1QB league starts one quarterback');
  assert.ok(sf.QB > one.QB, 'superflex starts more: ' + sf.QB);
  assert.ok(sf.QB >= 1.7 && sf.QB <= 1.8, 'SUPER_FLEX is overwhelmingly a QB slot: ' + sf.QB);
  assert.ok(!('BN' in one), 'bench slots never count as starters');
});

// ── The headline: same player, different books ─────────────────────
test('superflex prices quarterbacks above an otherwise identical 1QB league', () => {
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
  ]);
  assert.ok(out, 'built');
  const qbOne = out.priceOf('qb1', 'ONE'), qbSf = out.priceOf('qb1', 'SF');
  const rbOne = out.priceOf('rb1', 'ONE'), rbSf = out.priceOf('rb1', 'SF');
  assert.ok(qbSf > qbOne, `elite QB is worth more in superflex (${qbSf} vs ${qbOne})`);
  // And it is specifically a QB effect, not the whole board drifting.
  assert.ok((qbSf / qbOne) > (rbSf / rbOne), 'QBs gain relative to RBs, which is the actual difference between the formats');
});

test('a scoring change moves the position it touches — and only that position', () => {
  const out = runBuild([
    league('STD', 'Standard TE'),
    league('PREM', 'TE premium', { scoring_settings: { ...BASE_SCORING, bonus_rec_te: 1 } }),
  ]);
  const teStd = out.priceOf('te1', 'STD'), tePrem = out.priceOf('te1', 'PREM');
  const wrStd = out.priceOf('wr1', 'STD'), wrPrem = out.priceOf('wr1', 'PREM');
  assert.ok(tePrem > teStd, `TE premium lifts the TE (${tePrem} vs ${teStd})`);
  assert.ok((tePrem / teStd) > (wrPrem / wrStd), 'and lifts him relative to a receiver it does not touch');
});

test('identical leagues quote identical prices — nothing drifts on its own', () => {
  const out = runBuild([league('A', 'Alpha'), league('B', 'Bravo')]);
  Object.keys(PLAYERS).forEach(pid => {
    assert.strictEqual(out.priceOf(pid, 'A'), out.priceOf(pid, 'B'), pid + ' must price the same in two identical leagues');
  });
  assert.strictEqual(out.arbitrage.length, 0, 'and there is no arbitrage between identical books');
});

// ── Robust anchoring (the outlier defence) ─────────────────────────
test('one freak valuation cannot rescale a league board', () => {
  // A league that scores a single stat absurdly — the shape of the real
  // IDP-scored-team-defense artifact that compressed a whole board.
  const freakPlayers = { ...PLAYERS, freak: { position: 'K', full_name: 'Freak Kicker' } };
  const freakProj = { ...PROJ, freak: { gp: 17, fgm: 400 } };
  const out = EV.build({
    leagues: [
      league('CLEAN', 'Clean'),
      league('FREAK', 'Freak', { scoring_settings: { ...BASE_SCORING, fgm: 50 } }),
    ],
    playersData: freakPlayers, priorData: {}, projectionsData: freakProj,
    playerScores: { ...SCORES, freak: 1000 }, week: 1,
  });
  const a = out.byLeague.CLEAN, b = out.byLeague.FREAK;
  assert.ok(a && b, 'both priced');
  // The skill board must survive the outlier essentially intact.
  const ratio = b.values.rb1 / a.values.rb1;
  assert.ok(ratio > 0.8 && ratio < 1.25, 'the elite RB is not crushed by an unrelated freak: ratio ' + ratio.toFixed(2));
});

test('every league is re-anchored to the common scale', () => {
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
    league('DEEP', 'Deep', { total_rosters: 32 }),
  ]);
  Object.keys(out.byLeague).forEach(lid => {
    assert.ok(out.byLeague[lid].anchor > 0, lid + ' reports its anchor');
    assert.ok(out.byLeague[lid].rescale > 0, lid + ' reports its rescale factor');
  });
});

// ── Arbitrage board ────────────────────────────────────────────────
test('arbitrage names the high and low book and the capturable gap', () => {
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
  ]);
  assert.ok(out.arbitrage.length > 0, 'two genuinely different formats produce spreads');
  const row = out.arbitrage[0];
  assert.ok(row.high.value > row.low.value, 'high book really is higher');
  assert.strictEqual(row.gap, row.high.value - row.low.value, 'gap is the capturable difference');
  assert.ok(row.spreadPct >= EV.MIN_SPREAD_PCT, 'every row clears the noise floor');
  for (let i = 1; i < out.arbitrage.length; i++) {
    assert.ok(out.arbitrage[i - 1].gap >= out.arbitrage[i].gap, 'sorted by gap descending');
  }
});

test('the superflex premium lands on MARGINAL quarterbacks, not elite ones', () => {
  // The real economics, and a good guard against a naive "QBs are worth more"
  // implementation: in a 12-team 1QB league QB12 IS replacement level, so
  // superflex turns him into a starter and his price roughly doubles. An
  // elite QB was already valuable in both formats and barely moves.
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
  ]);
  const elite = out.spread('qb1'), marginal = out.spread('qb12');
  assert.ok(elite && marginal, 'both priced in both books');
  assert.strictEqual(marginal.high.name, 'Superflex', 'the marginal QB is worth more in superflex');
  assert.ok(marginal.spreadPct > elite.spreadPct * 3,
    `marginal QB moves far more than the elite one (${marginal.spreadPct}% vs ${elite.spreadPct}%)`);
  // And the other side of the same coin: superflex spends roster room on QBs,
  // so elite running backs are relatively CHEAPER there.
  const rb = out.spread('rb1');
  assert.strictEqual(rb.high.name, 'One QB', 'elite RB is worth more where QBs are not scarce');
});

test('spread() returns null for a player only one league prices', () => {
  const out = runBuild([league('A', 'Alpha')]);
  assert.strictEqual(out.spread('qb1'), null, 'one book is not a spread');
  assert.strictEqual(out.arbitrage.length, 0);
});

test('formatOf reads Sleeper league types, chopped included', () => {
  assert.strictEqual(EV.formatOf({ settings: { type: 0 } }), 'redraft');
  assert.strictEqual(EV.formatOf({ settings: { type: 1 } }), 'keeper');
  assert.strictEqual(EV.formatOf({ settings: { type: 2 } }), 'dynasty');
  assert.strictEqual(EV.formatOf({ settings: { type: 3 } }), 'chopped');
});

test('a league that cannot be priced is reported, not silently dropped', () => {
  const out = EV.build({
    leagues: [league('A', 'Alpha'), league('DEAD', 'No Data', { scoring_settings: {} })],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
  });
  assert.strictEqual(out.leagues.length, 2, 'both leagues appear in the manifest');
  out.leagues.forEach(l => assert.ok(typeof l.priced === 'boolean', l.id + ' declares whether it priced'));
});

test('build refuses gracefully with no leagues', () => {
  assert.strictEqual(EV.build({ leagues: [] }), null);
  assert.strictEqual(EV.build({}), null);
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
  process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
