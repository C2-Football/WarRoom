#!/usr/bin/env node
// Unit tests for the Rule Lab (App.Commish.RuleLab): season replay under a
// proposed scoring change. Core honesty checks — zero diff for an empty
// proposal, TE premium touching only TEs, recorded points never entering
// the diff, a hand-built standings flip, playoff field in/out, player-delta
// signs, and empty-season truthfulness. calcFn is always injected (a simple
// key-multiply scorer) so nothing depends on the browser calcFantasyPts,
// and fetch is stubbed before any require — no network, no wall clock.
'use strict';

const assert = require('assert');

// Stub fetch BEFORE any require: a unit test must never touch the network.
globalThis.fetch = () => Promise.resolve({ ok: false });

require('../js/shared/luck-engine.js'); // RuleLab standings run through App.Luck
const RuleLab = require('../js/shared/commish-rulelab.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Injected scorer ─────────────────────────────────────────────────
// Position-blind key-multiply: pts = Σ statLine[k] × scoring[k]. Mirrors the
// shape of calcFantasyPts without its defaults, so every expected value in
// this file is hand-computable. TE premium must come ONLY from the engine's
// explicit bonus_rec_te handling — this scorer knows nothing about it.
function calc(stats, sc) {
  let pts = 0;
  for (const k of Object.keys(stats || {})) pts += (Number(stats[k]) || 0) * (Number(sc && sc[k]) || 0);
  return pts;
}

// ── Fixture: 4-team league, 2 weeks, one starter each ───────────────
// Matchups (1v2), (3v4) both weeks. Current scoring: pass_td 4, rec 0,
// rec_yd 0.1 — so baseline is trivially hand-checkable.
//   W1: R1(QB 3 tds)=12  R2(TE 8rec/60yd)=6   R3(WR 8rec/70yd)=7  R4(TE 2rec/20yd)=2
//   W2: R1(QB 2 tds)=8   R2(TE 10rec/50yd)=5  R3(WR 4rec/80yd)=8  R4(TE 3rec/30yd)=3
// Baseline: R1 2-0 pf20 (#1), R3 2-0 pf15 (#2), R2 0-2 pf11 (#3), R4 0-2 pf5 (#4).
const SCORING = { pass_td: 4, rec: 0, rec_yd: 0.1 };
const playersData = {
  101: { position: 'QB', full_name: 'QB Alpha' },
  201: { position: 'TE', full_name: 'TE Gold' },
  202: { position: 'TE', full_name: 'TE Iron' },
  301: { position: 'WR', full_name: 'WR Max' },
};
const seasonStats = {
  1: { 101: { pass_td: 3 }, 201: { rec: 8, rec_yd: 60 }, 301: { rec: 8, rec_yd: 70 }, 202: { rec: 2, rec_yd: 20 } },
  2: { 101: { pass_td: 2 }, 201: { rec: 10, rec_yd: 50 }, 301: { rec: 4, rec_yd: 80 }, 202: { rec: 3, rec_yd: 30 } },
};
const STARTERS = { 1: ['101'], 2: ['201'], 3: ['301'], 4: ['202'] };
// Recorded points are deliberate GARBAGE (999): the lab must never read
// them — both rulesets are rescored from raw stat lines and diffed.
function lineupWeek(matchups) {
  return matchups.flatMap(([a, b], i) => [
    { rosterId: a, matchupId: 'm' + i, points: 999, starters: STARTERS[a] },
    { rosterId: b, matchupId: 'm' + i, points: 999, starters: STARTERS[b] },
  ]);
}
const lineups = { 1: lineupWeek([[1, 2], [3, 4]]), 2: lineupWeek([[1, 2], [3, 4]]) };
const league = {
  league_id: 'L1', name: 'Fixture League', season: '2025',
  settings: { playoff_teams: 2 },
  scoring_settings: SCORING,
  rosters: [1, 2, 3, 4].map(id => ({ roster_id: id, owner_id: 'u' + id })),
  users: [1, 2, 3, 4].map(id => ({ user_id: 'u' + id, display_name: 'Team ' + id })),
};
function run(proposal, extra) {
  return RuleLab.runProposal(Object.assign({ league, seasonStats, lineups, proposal, playersData, calcFn: calc }, extra));
}

// ── Presets ─────────────────────────────────────────────────────────
test('presets: cover the canonical proposals and compose as plain objects', () => {
  const byKey = {};
  RuleLab.PRESETS.forEach(p => { byKey[p.key] = p; assert.ok(p.label && p.overrides, p.key + ' well-formed'); });
  assert.strictEqual(byKey.full_ppr.overrides.rec, 1.0);
  assert.strictEqual(byKey.te_premium_half.overrides.bonus_rec_te, 0.5);
  assert.strictEqual(byKey.six_pt_pass_td.overrides.pass_td, 6);
  assert.strictEqual(byKey.harsh_int.overrides.pass_int, -2);
  const combo = Object.assign({}, byKey.full_ppr.overrides, byKey.te_premium_full.overrides);
  assert.deepStrictEqual(combo, { rec: 1.0, bonus_rec_te: 1.0 }, 'presets compose by plain merge');
});

// ── scorePlayerWeek ─────────────────────────────────────────────────
test('scorePlayerWeek: TE premium applies only when position is TE', () => {
  const line = { rec: 6, rec_yd: 50 };
  const sc = { rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 };
  const te = RuleLab.scorePlayerWeek(line, sc, 'TE', calc);
  const wr = RuleLab.scorePlayerWeek(line, sc, 'WR', calc);
  assert.strictEqual(wr, 11, 'WR: 6 rec + 5 yd pts, no bonus');
  assert.strictEqual(te, 14, 'TE: same line + 0.5 × 6 rec premium');
});

test('scorePlayerWeek: missing stat line scores 0', () => {
  assert.strictEqual(RuleLab.scorePlayerWeek(undefined, SCORING, 'TE', calc), 0);
  assert.strictEqual(RuleLab.scorePlayerWeek(null, SCORING, 'QB', calc), 0);
});

// ── rescoreSeason ───────────────────────────────────────────────────
test('rescoreSeason: as-played roster-weeks match hand computation, garbage recorded points ignored', () => {
  const { weeklyScores } = RuleLab.rescoreSeason({ league, seasonStats, lineups, scoring: SCORING, playersData, calcFn: calc });
  const w1 = {}; weeklyScores[1].forEach(r => { w1[r.rosterId] = r.points; });
  assert.deepStrictEqual(w1, { 1: 12, 2: 6, 3: 7, 4: 2 });
  const w2 = {}; weeklyScores[2].forEach(r => { w2[r.rosterId] = r.points; });
  assert.deepStrictEqual(w2, { 1: 8, 2: 5, 3: 8, 4: 3 });
  assert.strictEqual(weeklyScores[1][0].matchupId, 'm0', 'matchup pairing preserved');
});

test('rescoreSeason: empty slots skipped; a started player missing from stats registers 0 in playerTotals', () => {
  const lu = { 1: [
    { rosterId: 1, matchupId: 'a', points: 999, starters: ['101', '0', '', '999999'] },
    { rosterId: 2, matchupId: 'a', points: 999, starters: ['201'] },
  ] };
  const { weeklyScores, playerTotals } = RuleLab.rescoreSeason({ league, seasonStats, lineups: lu, scoring: SCORING, playersData, calcFn: calc });
  assert.strictEqual(weeklyScores[1][0].points, 12, "empty slots and the unknown pid add nothing");
  assert.strictEqual(playerTotals['999999'], 0, 'started-but-statless player is on the record at 0');
  assert.strictEqual(playerTotals['0'], undefined, 'empty slot is not a player');
  assert.strictEqual(playerTotals['101'], 12);
});

// ── runProposal: the honesty core ───────────────────────────────────
test('runProposal: empty proposal → zero diff everywhere (rounding cancels by construction)', () => {
  const r = run({});
  assert.strictEqual(r.empty, false);
  assert.strictEqual(r.weeksCounted, 2);
  assert.strictEqual(r.seasonUsed, '2025');
  r.teamDeltas.forEach(t => assert.strictEqual(t.delta, 0, t.name + ' delta 0'));
  r.standingsShift.forEach(s => {
    assert.strictEqual(s.delta, 0);
    assert.strictEqual(s.baselineRank, s.proposedRank);
  });
  assert.strictEqual(r.seedOneChanged, null);
  assert.deepStrictEqual(r.playoffField, { size: 2, in: [], out: [], unchanged: true });
  assert.deepStrictEqual(r.playerDeltas, [], 'no player moved');
});

test('runProposal: TE premium moves only TEs', () => {
  const r = run({ bonus_rec_te: 0.5 });
  const byPid = {}; r.playerDeltas.forEach(p => { byPid[p.pid] = p; });
  assert.strictEqual(byPid['201'].delta, 9, 'TE Gold: 0.5 × (8+10) rec');
  assert.strictEqual(byPid['202'].delta, 2.5, 'TE Iron: 0.5 × (2+3) rec');
  assert.strictEqual(byPid['301'], undefined, 'WR untouched');
  assert.strictEqual(byPid['101'], undefined, 'QB untouched');
  r.playerDeltas.forEach(p => assert.strictEqual(p.pos, 'TE'));
});

test('runProposal: standings flip on the hand-built season (PPR + TE premium)', () => {
  // Proposed: rec 1 + bonus_rec_te 1. Hand-computed:
  //   W1: R1 12, R2 6+8+8=22, R3 7+8=15, R4 2+2+2=6 → R2, R3 win
  //   W2: R1 8,  R2 5+10+10=25, R3 8+4=12, R4 3+3+3=9 → R2, R3 win
  // Proposed order: R2 2-0 pf47, R3 2-0 pf27, R1 0-2 pf20, R4 0-2 pf15.
  const r = run({ rec: 1, bonus_rec_te: 1 });
  const shift = {}; r.standingsShift.forEach(s => { shift[s.rosterId] = s; });
  assert.deepStrictEqual([shift[1].baselineRank, shift[1].proposedRank, shift[1].delta], [1, 3, -2], 'R1 falls 1→3');
  assert.deepStrictEqual([shift[2].baselineRank, shift[2].proposedRank, shift[2].delta], [3, 1, 2], 'R2 climbs 3→1');
  assert.deepStrictEqual([shift[3].baselineRank, shift[3].proposedRank, shift[3].delta], [2, 2, 0], 'R3 holds');
  assert.deepStrictEqual([shift[4].baselineRank, shift[4].proposedRank, shift[4].delta], [4, 4, 0], 'R4 holds');
  assert.deepStrictEqual(r.seedOneChanged, { from: 'Team 1', to: 'Team 2', fromRosterId: 1, toRosterId: 2 });
});

test('runProposal: playoff field in/out is correct and named', () => {
  const r = run({ rec: 1, bonus_rec_te: 1 });
  assert.strictEqual(r.playoffField.size, 2);
  assert.deepStrictEqual(r.playoffField.in, ['Team 2'], 'newly IN');
  assert.deepStrictEqual(r.playoffField.out, ['Team 1'], 'newly OUT');
  assert.strictEqual(r.playoffField.unchanged, false);
});

test('runProposal: teamDeltas sorted by gain desc with exact values', () => {
  const r = run({ rec: 1, bonus_rec_te: 1 });
  assert.deepStrictEqual(r.teamDeltas.map(t => [t.rosterId, t.delta]),
    [[2, 36], [3, 12], [4, 10], [1, 0]]);
  const t2 = r.teamDeltas[0];
  assert.strictEqual(t2.baselinePts, 11);
  assert.strictEqual(t2.proposedPts, 47);
});

test('runProposal: playerDeltas carry the right signs (a nerf produces losers)', () => {
  const r = run({ pass_td: 2 }); // QB: (3+2) tds × (2−4) = −10
  assert.strictEqual(r.playerDeltas.length, 1);
  const qb = r.playerDeltas[0];
  assert.deepStrictEqual({ pid: qb.pid, name: qb.name, pos: qb.pos, delta: qb.delta },
    { pid: '101', name: 'QB Alpha', pos: 'QB', delta: -10 });
  // And gainers come first when both exist.
  const both = run({ pass_td: 2, bonus_rec_te: 1 });
  assert.ok(both.playerDeltas[0].delta > 0, 'gainers lead the list');
  assert.ok(both.playerDeltas[both.playerDeltas.length - 1].delta < 0, 'losers close it');
});

test('runProposal: proposerNote is the honest disclosure, only when myRosterId is supplied', () => {
  assert.strictEqual(run({ rec: 1, bonus_rec_te: 1 }).proposerNote, null, 'no roster, no note');
  const mine = run({ rec: 1, bonus_rec_te: 1 }, { myRosterId: 2 });
  assert.strictEqual(mine.proposerNote.myRank, 1, 'R2 is the biggest gainer');
  assert.ok(/#1/.test(mine.proposerNote.line), 'line names the rank');
  const other = run({ rec: 1, bonus_rec_te: 1 }, { myRosterId: 1 });
  assert.strictEqual(other.proposerNote.myRank, 4, 'R1 gains least');
  assert.strictEqual(run({}, { myRosterId: 99 }).proposerNote, null, 'unknown roster → no note');
});

test('runProposal: empty season is reported honestly, never fabricated', () => {
  const r = RuleLab.runProposal({ league, seasonStats, lineups: {}, proposal: { rec: 1 }, playersData, calcFn: calc });
  assert.strictEqual(r.empty, true);
  assert.strictEqual(r.weeksCounted, 0);
  assert.ok(r.reason && /week/i.test(r.reason), 'reason mentions played weeks');
  assert.strictEqual(r.standingsShift, undefined, 'no fabricated standings');
  // A single-roster "week" cannot form a matchup either.
  const solo = RuleLab.runProposal({ league, seasonStats, proposal: {}, playersData, calcFn: calc,
    lineups: { 1: [{ rosterId: 1, matchupId: 'a', points: 10, starters: ['101'] }] } });
  assert.strictEqual(solo.empty, true);
});

// ── Omnibus ─────────────────────────────────────────────────────────
test('runOmnibus: each league is diffed against its OWN current scoring', () => {
  // League B already has rec 1 baked in — full PPR is a no-op there, while
  // it moves league A. Same proposal, per-league baselines.
  const leagueB = { ...league, league_id: 'L2', name: 'Already PPR', scoring_settings: { ...SCORING, rec: 1 } };
  const out = RuleLab.runOmnibus({
    leagues: [league, leagueB],
    seasonStats,
    lineupsByLeague: { L1: lineups, L2: lineups },
    proposal: { rec: 1 },
    playersData,
    calcFn: calc,
    myRosterIdByLeague: { L1: 2 },
  });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].leagueId, 'L1');
  assert.ok(out[0].result.teamDeltas.some(t => t.delta > 0), 'full PPR moves league A');
  assert.ok(out[0].result.proposerNote, 'per-league myRosterId flows through');
  assert.ok(out[1].result.teamDeltas.every(t => t.delta === 0), 'no-op in the already-PPR league');
  assert.strictEqual(out[1].result.proposerNote, null);
});

// ── Fetch helpers (stubbed — no network) ────────────────────────────
(async () => {
  await testAsync('loadSeasonStats: one cached load per season, weeks keyed 1..18', async () => {
    let calls = 0;
    globalThis.fetch = (url) => {
      calls++;
      const wk = Number(String(url).split('/').pop());
      // Weeks 17–18 unplayed → empty bodies get dropped.
      const body = wk <= 16 ? { 101: { pass_td: wk } } : {};
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    };
    const a = await RuleLab.loadSeasonStats('2031');
    const b = await RuleLab.loadSeasonStats('2031');
    assert.strictEqual(calls, 18, 'exactly one pass over 18 weeks despite two calls');
    assert.strictEqual(a, b, 'second call served from the module cache');
    assert.strictEqual(Object.keys(a).length, 16, 'empty weeks dropped');
    assert.strictEqual(a[3]['101'].pass_td, 3);
    globalThis.fetch = () => Promise.resolve({ ok: false });
  });

  await testAsync('loadSeasonLineups: maps matchups and drops weeks without two real scores', async () => {
    globalThis.fetchMatchups = (lid, week) => {
      if (week === 1) return Promise.resolve([
        { roster_id: 1, matchup_id: 7, points: 101.2, starters: ['101', '0'] },
        { roster_id: 2, matchup_id: 7, points: 95.5, starters: ['201'] },
      ]);
      if (week === 2) return Promise.resolve([ // in progress: one real score
        { roster_id: 1, matchup_id: 7, points: 55, starters: ['101'] },
        { roster_id: 2, matchup_id: 7, points: 0, starters: ['201'] },
      ]);
      return Promise.resolve([]);
    };
    const out = await RuleLab.loadSeasonLineups('L1', [1, 2, 3]);
    assert.deepStrictEqual(Object.keys(out), ['1'], 'only the played week survives');
    assert.deepStrictEqual(out[1][0], { rosterId: 1, matchupId: 7, points: 101.2, starters: ['101', '0'], players: [] });
    delete globalThis.fetchMatchups;
    const none = await RuleLab.loadSeasonLineups('L1', [1]);
    assert.deepStrictEqual(none, {}, 'no fetcher → honest empty');
  });

  console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
    process.exit(1);
  }
})();

// ═══ v2: optimal mode, roster proposals, sweep, balance, ballot ═══
// The real start/sit solver, not a stub — optimal mode must be tested
// against the implementation the browser actually runs.
const StartSit = require('../js/shared/startsit-engine.js');

test('v2 optimal mode: refields the best lineup from the full roster', () => {
  // One roster, one week. Starters as played: qb1 + rb1. Bench holds rb2 who
  // outscores rb1 under this scoring. As-played must NOT see rb2; optimal must.
  const lineups = { 1: [
    { rosterId: 1, matchupId: 'a', starters: ['qb1', 'rb1'], players: ['qb1', 'rb1', 'rb2'] },
    { rosterId: 2, matchupId: 'a', starters: ['qb2', 'rb3'], players: ['qb2', 'rb3'] },
  ] };
  const seasonStats = { 1: { qb1: { pass_yd: 300 }, qb2: { pass_yd: 200 }, rb1: { rush_yd: 50 }, rb2: { rush_yd: 120 }, rb3: { rush_yd: 60 } } };
  const playersData = { qb1: { position: 'QB' }, qb2: { position: 'QB' }, rb1: { position: 'RB' }, rb2: { position: 'RB' }, rb3: { position: 'RB' } };
  const scoring = { pass_yd: 0.04, rush_yd: 0.1 };
  const asPlayed = RuleLab.rescoreSeason({ seasonStats, lineups, scoring, playersData, calcFn: calc });
  const optimal = RuleLab.rescoreSeason({ seasonStats, lineups, scoring, playersData, calcFn: calc, mode: 'optimal', rosterPositions: ['QB', 'RB'], startSit: StartSit });
  assert.strictEqual(asPlayed.weeklyScores[1][0].points, 17, 'as-played: 12 + 5');
  assert.strictEqual(optimal.weeklyScores[1][0].points, 24, 'optimal: 12 + rb2’s 12');
  assert.ok(optimal.playerTotals.rb2 === 12 && !optimal.playerTotals.rb1, 'optimal credits the counterfactual starter');
});

test('v2 roster proposal: superflex flips both runs to best-lineup and labels it', () => {
  const league = {
    league_id: 'L', name: 'L', scoring_settings: { pass_yd: 0.04, rush_yd: 0.1 },
    roster_positions: ['QB', 'RB', 'BN'], settings: { playoff_teams: 2 },
    rosters: [1, 2].map(id => ({ roster_id: id, owner_id: 'u' + id })),
    users: [1, 2].map(id => ({ user_id: 'u' + id, display_name: 'T' + id })),
  };
  const lineups = { 1: [
    { rosterId: 1, matchupId: 'a', starters: ['qb1', 'rb1'], players: ['qb1', 'qb1b', 'rb1'] },  // second QB on the bench
    { rosterId: 2, matchupId: 'a', starters: ['qb2', 'rb3'], players: ['qb2', 'rb3'] },
  ] };
  const seasonStats = { 1: { qb1: { pass_yd: 300 }, qb1b: { pass_yd: 250 }, qb2: { pass_yd: 200 }, rb1: { rush_yd: 50 }, rb3: { rush_yd: 60 } } };
  const playersData = { qb1: { position: 'QB' }, qb1b: { position: 'QB' }, qb2: { position: 'QB' }, rb1: { position: 'RB' }, rb3: { position: 'RB' } };
  const r = RuleLab.runProposal({
    league, seasonStats, lineups, proposal: {}, playersData, calcFn: calc,
    rosterProposal: { rosterPositions: ['QB', 'RB', 'SUPER_FLEX'] }, startSit: StartSit,
  });
  assert.strictEqual(r.methodology, 'best_lineup', 'structure change → best-lineup replay, said out loud');
  // Team 1's benched QB (10 pts) now starts in the superflex; team 2 has no
  // extra body, so the proposal widens the gap by exactly qb1b's line.
  const t1 = r.teamDeltas.find(t => String(t.rosterId) === '1');
  assert.strictEqual(t1.delta, 10, 'superflex pays the team with the spare QB');
});

test('v2 scoring-only proposals still run as-played', () => {
  const league = {
    league_id: 'L', name: 'L', scoring_settings: { rec: 0 }, roster_positions: ['WR'],
    settings: { playoff_teams: 2 },
    rosters: [1, 2].map(id => ({ roster_id: id, owner_id: 'u' + id })),
    users: [1, 2].map(id => ({ user_id: 'u' + id, display_name: 'T' + id })),
  };
  const lineups = { 1: [
    { rosterId: 1, matchupId: 'a', starters: ['wr1'], players: ['wr1', 'wr2'] },
    { rosterId: 2, matchupId: 'a', starters: ['wr3'], players: ['wr3'] },
  ] };
  const seasonStats = { 1: { wr1: { rec: 5, rec_yd: 50 }, wr2: { rec: 9, rec_yd: 20 }, wr3: { rec: 4, rec_yd: 60 } } };
  const playersData = { wr1: { position: 'WR' }, wr2: { position: 'WR' }, wr3: { position: 'WR' } };
  const r = RuleLab.runProposal({ league, seasonStats, lineups, proposal: { rec: 1 }, playersData, calcFn: calc });
  assert.strictEqual(r.methodology, 'as_played', 'no structure change → honest as-played');
});

test('v2 position share: TE premium moves TE relevance and says by how much', () => {
  const base = { te1: 100, wr1: 300 };
  const prop = { te1: 150, wr1: 300 };
  const playersData = { te1: { position: 'TE' }, wr1: { position: 'WR' } };
  const rows = RuleLab.positionShare(base, prop, playersData);
  const te = rows.find(r => r.pos === 'TE');
  assert.strictEqual(te.basePct, 25, 'TE owns 100/400');
  assert.ok(Math.abs(te.propPct - 33.3) < 0.15, 'TE owns 150/450 after');
  assert.ok(te.deltaPct > 8, 'delta carries the story');
});

test('v2 spearman: identity is 1, full reversal is -1', () => {
  assert.strictEqual(RuleLab.spearman({ a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 3 }), 1);
  assert.strictEqual(RuleLab.spearman({ a: 1, b: 2, c: 3 }, { a: 3, b: 2, c: 1 }), -1);
});

test('v2 sweep: finds the exact threshold where the league flips', () => {
  // Two teams; team 2 wins as fielded, but team 1's WR is a reception monster:
  // enough PPR flips the total-points leader while H2H record stays 1-0 —
  // sweep must report ranksMoved via the PF tiebreak... so build TWO weeks
  // with a split so the flip shows in the standings.
  const league = {
    league_id: 'L', name: 'L', scoring_settings: { rec: 0, rec_yd: 0.1 }, roster_positions: ['WR'],
    settings: { playoff_teams: 1 },
    rosters: [1, 2].map(id => ({ roster_id: id, owner_id: 'u' + id })),
    users: [1, 2].map(id => ({ user_id: 'u' + id, display_name: 'T' + id })),
  };
  const wk = (w, aRec, aYd, bRec, bYd) => [
    { rosterId: 1, matchupId: 'm', starters: ['wrA'], players: ['wrA'] },
    { rosterId: 2, matchupId: 'm', starters: ['wrB'], players: ['wrB'] },
  ] && { [w]: [
    { rosterId: 1, matchupId: 'm', starters: ['wrA'], players: ['wrA'] },
    { rosterId: 2, matchupId: 'm', starters: ['wrB'], players: ['wrB'] },
  ] };
  const lineups = Object.assign({}, wk(1), wk(2));
  const seasonStats = {
    1: { wrA: { rec: 12, rec_yd: 40 }, wrB: { rec: 2, rec_yd: 60 } },   // 0 PPR: A 4 < B 6 ; 1 PPR: A 16 > B 8
    2: { wrA: { rec: 12, rec_yd: 40 }, wrB: { rec: 2, rec_yd: 55 } },
  };
  const playersData = { wrA: { position: 'WR' }, wrB: { position: 'WR' } };
  const s = RuleLab.sweep({ league, seasonStats, lineups, playersData, calcFn: calc, key: 'rec', values: [0, 0.25, 0.5, 1] });
  assert.strictEqual(s.steps.length, 4);
  assert.ok(s.firstFlipAt != null && s.firstFlipAt <= 0.5, 'the flip threshold is found, at ' + s.firstFlipAt);
  const at0 = s.steps.find(x => x.value === 0);
  assert.ok(at0.isCurrent && !at0.seedFlips, 'the current value is marked and never counts as a flip');
});

test('v2 ballot: states methodology, the flip, and the proposer disclosure', () => {
  const fake = {
    empty: false, seasonUsed: 2025, weeksCounted: 14, methodology: 'as_played',
    seedOneChanged: { from: 'Alpha', to: 'Bravo' },
    playoffField: { size: 6, in: ['Bravo'], out: ['Echo'], unchanged: false },
    standingsShift: [{ name: 'Bravo', baselineRank: 2, proposedRank: 1, delta: 1 }, { name: 'Alpha', baselineRank: 1, proposedRank: 2, delta: -1 }],
    positionShare: [{ pos: 'TE', basePct: 8.1, propPct: 11.4, deltaPct: 3.3 }],
    balance: { volatilityDeltaPct: 4.2 },
    playerDeltas: [{ name: 'T. McBride', pos: 'TE', delta: 126 }],
    proposerNote: { myRank: 1, line: 'Full disclosure: your own roster is the #1 gainer of 12 under this proposal.' },
  };
  const t = RuleLab.ballotText('The Iron League', fake, 'TE premium +1.0');
  assert.ok(t.includes('#1 SEED FLIPS: Alpha → Bravo'));
  assert.ok(t.includes('TE 8.1%→11.4%'));
  assert.ok(t.includes('Full disclosure'));
  assert.ok(t.includes('never re-crowns a champion'));
});

test('v2 sweepValuesFor: brackets reality for fractional, integer, and unscored keys', () => {
  // Live half-PPR: proportional ladder 0 → 1.0, current value present.
  const rec = RuleLab.sweepValuesFor('rec', 0.5);
  assert.ok(rec.includes(0) && rec.includes(0.5) && rec.includes(1), 'half-PPR sweeps 0→2c: ' + rec.join(','));
  assert.ok(rec.every((v, i) => i === 0 || v > rec[i - 1]), 'sorted ascending');
  // TD-like integer: whole points around the current rule, not 0.5-steps.
  const td = RuleLab.sweepValuesFor('pass_td', 4);
  assert.deepStrictEqual(td, [0, 2, 3, 4, 5, 6], 'pass_td 4 sweeps the arguable neighborhood');
  // Unscored key: canonical fantasy increments.
  const te = RuleLab.sweepValuesFor('bonus_rec_te', 0);
  assert.deepStrictEqual(te, [0, 0.25, 0.5, 0.75, 1, 1.5, 2]);
  // Negative rules keep sign (turnovers).
  const int = RuleLab.sweepValuesFor('pass_int', -2);
  assert.ok(int.includes(-2) && int.every(v => v <= 0), 'negative rule stays negative: ' + int.join(','));
});

test('v2 mergeSweeps: consensus is the value every season agrees on', () => {
  const step = (v, o) => Object.assign({ value: v, isCurrent: v === 0, seedFlips: false, fieldMoves: 0, ranksMoved: 0 }, o);
  const merged = RuleLab.mergeSweeps([
    { season: 2024, perLeague: [{ leagueName: 'CSL', firstFlipAt: 1, steps: [step(0), step(0.5), step(1, { ranksMoved: 2 })] }] },
    { season: 2025, perLeague: [{ leagueName: 'CSL', firstFlipAt: 0.5, steps: [step(0), step(0.5, { seedFlips: true }), step(1, { seedFlips: true })] }] },
  ]);
  const csl = merged.find(m => m.leagueName === 'CSL');
  assert.strictEqual(csl.minFlip, 0.5, 'earliest movement anywhere');
  assert.strictEqual(csl.consensus, 1, 'consensus = max of per-season firstFlips (every season moves from here)');
  assert.strictEqual(csl.heldIn, 2); assert.strictEqual(csl.of, 2);
  const row1 = csl.rows.find(r => r.value === 1);
  assert.strictEqual(row1.bySeason[2024], '2 MV');
  assert.strictEqual(row1.bySeason[2025], 'SEED');
  assert.strictEqual(csl.rows.find(r => r.value === 0.5).bySeason[2024], 'HOLD');
});

test('v2 mergeSweeps: a never-moving season vetoes consensus; a no-data season does not', () => {
  const step = (v, o) => Object.assign({ value: v, isCurrent: false, seedFlips: false, fieldMoves: 0, ranksMoved: 0 }, o);
  const merged = RuleLab.mergeSweeps([
    { season: 2023, perLeague: [{ leagueName: 'A', firstFlipAt: null, steps: [{ value: 0, empty: true }] },      // no data: excluded
                               { leagueName: 'B', firstFlipAt: null, steps: [step(0), step(1)] }] },            // real data, never moves: veto
    { season: 2025, perLeague: [{ leagueName: 'A', firstFlipAt: 1, steps: [step(0), step(1, { fieldMoves: 2 })] },
                               { leagueName: 'B', firstFlipAt: 1, steps: [step(0), step(1, { fieldMoves: 2 })] }] },
  ]);
  const a = merged.find(m => m.leagueName === 'A');
  assert.strictEqual(a.of, 1, '2023 had zero counted weeks — not in the denominator');
  assert.deepStrictEqual(a.noData, [2023]);
  assert.strictEqual(a.consensus, 1, 'the single replayed season carries it');
  const b = merged.find(m => m.leagueName === 'B');
  assert.strictEqual(b.of, 2);
  assert.strictEqual(b.consensus, null, 'a replayed season with no movement anywhere vetoes consensus');
  assert.strictEqual(b.heldIn, 1);
});
