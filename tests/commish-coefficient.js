#!/usr/bin/env node
// Unit tests for THE COEFFICIENT (App.Commish.Coefficient): cross-league
// all-play aggregation per human, weekly movement (delta vs the rating with
// each ledger's latest week excluded), provisional threshold, and null-rating
// ordering. Ledgers are built through the real luck engine from hand-checkable
// synthetic scores so the shapes can never drift apart. Pure compute — no
// network (fetch stubbed defensively).
'use strict';

const assert = require('assert');

globalThis.fetch = () => Promise.resolve({ ok: false });

const Luck = require('../js/shared/luck-engine.js');
const Coefficient = require('../js/shared/commish-coefficient.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Fixture ─────────────────────────────────────────────────────────
// League A: 4 teams, 3 weeks (includes a week-2 tie between r1 and r4).
// League B: 4 teams, 2 weeks. Human u1 owns roster 1 in BOTH leagues.
//
// Hand computation (all-play, 3 opponents per counted week):
//   u1 in A: W1 130→3-0, W2 80→0-2-1 (ties r4's 80), W3 140→3-0  = 6-2-1
//   u1 in B: W1 100→3-0, W2 130→3-0                              = 6-0
//   u1 aggregate: 12-2-1, 15 games → (12+0.5)/15 = .8333 → rating 833
//   u1 prev (drop A wk3, B wk2): 3-2-1 + 3-0 = 6-2-1, 9 games
//     → (6+0.5)/9 = .7222 → 722; delta = 833-722 = +111
//   u2 in A: W1 100→1-2, W2 110→2-1, W3 95→1-2 = 4-5 → 444
//     prev (wks 1-2): 3-3 → 500; delta = -56
//   u5 in B: W1 90→2-1, W2 120→2-1 = 4-2 → 667; prev 2-1 → 667; delta 0
function mkLeague(n) {
  return {
    league_id: n,
    rosters: [1, 2, 3, 4].map(id => ({ roster_id: id, owner_id: n + 'u' + id })),
    users: [1, 2, 3, 4].map(id => ({ user_id: n + 'u' + id, display_name: n + ' Team ' + id })),
  };
}
const scoresA = {
  1: [{ rosterId: 1, points: 130 }, { rosterId: 2, points: 100 }, { rosterId: 3, points: 120 }, { rosterId: 4, points: 90 }],
  2: [{ rosterId: 1, points: 80 }, { rosterId: 2, points: 110 }, { rosterId: 3, points: 125 }, { rosterId: 4, points: 80 }],
  3: [{ rosterId: 1, points: 140 }, { rosterId: 2, points: 95 }, { rosterId: 3, points: 60 }, { rosterId: 4, points: 100 }],
};
const scoresB = {
  1: [{ rosterId: 1, points: 100 }, { rosterId: 2, points: 90 }, { rosterId: 3, points: 80 }, { rosterId: 4, points: 70 }],
  2: [{ rosterId: 1, points: 130 }, { rosterId: 2, points: 120 }, { rosterId: 3, points: 110 }, { rosterId: 4, points: 60 }],
};
const ledgers = {
  A: Luck.buildLedger({ league: mkLeague('A'), weeklyScores: scoresA }),
  B: Luck.buildLedger({ league: mkLeague('B'), weeklyScores: scoresB }),
};

function person(uid, name, teams, isMe) {
  return {
    userId: uid, name, isMe: !!isMe,
    teamNames: teams.map(t => name),
    teams,
    leagueIds: [...new Set(teams.map(t => t.leagueId))],
    leagueCount: new Set(teams.map(t => t.leagueId)).size,
  };
}
function team(leagueId, rosterId, w, l) {
  return { leagueId, leagueName: 'League ' + leagueId, rosterId, record: { w, l, t: 0 }, pf: 100, isCommissioner: false };
}
const graph = {
  people: {
    u1: person('u1', 'Alpha', [team('A', 1, 2, 1), team('B', 1, 1, 1)], true),
    u2: person('u2', 'Bravo', [team('A', 2, 1, 2)]),
    u5: person('u5', 'Echo', [team('B', 2, 1, 1)]),
    u8: person('u8', 'Aardvark', [team('C', 1, 0, 0)]), // league C has no ledger
  },
  overlap: [], seats: [],
};
const result = Coefficient.buildCoefficient({ graph, ledgers });

test('aggregate: cross-league all-play totals match hand computation', () => {
  const u1 = result.rows.find(r => r.userId === 'u1');
  assert.strictEqual(u1.rating, 833, 'u1 rating (12-2-1 over 15 games)');
  assert.strictEqual(u1.apRecord, '12-2-1');
  assert.strictEqual(u1.apGames, 15);
  assert.strictEqual(u1.teamCount, 2);
  assert.strictEqual(u1.leagueCount, 2);
  assert.strictEqual(u1.isMe, true);
  assert.strictEqual(u1.name, 'Alpha');
});

test('per-league: each seat rated on its own ledger, record passed through', () => {
  const u1 = result.rows.find(r => r.userId === 'u1');
  const a = u1.perLeague.find(x => x.leagueId === 'A');
  const b = u1.perLeague.find(x => x.leagueId === 'B');
  assert.strictEqual(a.rating, 722, 'A: (6+0.5)/9');
  assert.strictEqual(a.apRecord, '6-2-1');
  assert.strictEqual(b.rating, 1000, 'B: perfect 6-0');
  assert.strictEqual(b.apRecord, '6-0');
  assert.deepStrictEqual(a.record, { w: 2, l: 1, t: 0 }, 'H2H record from the graph, untouched');
});

test('delta: rating minus rating-with-latest-week-excluded (tie reconstructed)', () => {
  const u1 = result.rows.find(r => r.userId === 'u1');
  // prev = 6-2-1 → 722; the week-2 tie only survives if reconstruction from
  // weekly rows (which lack allPlayT) is exact. 6-2 → 750, 6-3 → 667: both wrong.
  assert.strictEqual(u1.prevRating, 722);
  assert.strictEqual(u1.delta, 111, 'a big week moves the rating up');
  const u2 = result.rows.find(r => r.userId === 'u2');
  assert.strictEqual(u2.rating, 444);
  assert.strictEqual(u2.prevRating, 500);
  assert.strictEqual(u2.delta, -56, 'a bad week moves it down');
  const u5 = result.rows.find(r => r.userId === 'u5');
  assert.strictEqual(u5.rating, 667);
  assert.strictEqual(u5.delta, 0, 'steady week → zero movement, not null');
});

test('delta: null when there is no prior week anywhere', () => {
  const oneWeek = { A: Luck.buildLedger({ league: mkLeague('A'), weeklyScores: { 1: scoresA[1] } }) };
  const g = { people: { u1: person('u1', 'Alpha', [team('A', 1, 1, 0)]) }, overlap: [], seats: [] };
  const r = Coefficient.buildCoefficient({ graph: g, ledgers: oneWeek }).rows[0];
  assert.strictEqual(r.rating, 1000, 'week 1 still rates');
  assert.strictEqual(r.prevRating, null);
  assert.strictEqual(r.delta, null);
});

test('provisional: under 20 counted games flags, 20+ does not', () => {
  for (const r of result.rows) assert.strictEqual(r.provisional, true, r.userId + ' has <20 games');
  // Hand-built ledger shape: 21 games clears the bar.
  const bigLedger = {
    rows: [{ rosterId: 1, name: 'T1', wins: 5, losses: 2, ties: 0, allPlayW: 15, allPlayL: 6, allPlayT: 0, allPlayPct: 0.714, expWins: 5, luck: 0, pf: 900, weekly: [] }],
    weeks: [1, 2, 3, 4, 5, 6, 7],
  };
  const g = { people: { u9: person('u9', 'Grinder', [team('D', 1, 5, 2)]) }, overlap: [], seats: [] };
  const r = Coefficient.buildCoefficient({ graph: g, ledgers: { D: bigLedger } }).rows[0];
  assert.strictEqual(r.provisional, false, '21 all-play games is a real sample');
  assert.strictEqual(r.rating, 714);
});

test('ordering: rating desc, null ratings last regardless of name', () => {
  assert.deepStrictEqual(result.rows.map(r => r.userId), ['u1', 'u5', 'u2', 'u8'],
    'Aardvark (null) sorts last despite alphabetical head start');
});

test('missing ledger / unmatched seat: skipped honestly, never fabricated', () => {
  const u8 = result.rows.find(r => r.userId === 'u8');
  assert.strictEqual(u8.rating, null);
  assert.strictEqual(u8.delta, null);
  assert.strictEqual(u8.apGames, 0);
  assert.strictEqual(u8.perLeague[0].rating, null);
  assert.strictEqual(u8.perLeague[0].apRecord, null, 'no ledger → no record, not a fake 0-0');
  // Seat not present in an existing ledger behaves the same way.
  const g = { people: { ux: person('ux', 'Ghost', [team('A', 99, 0, 0)]) }, overlap: [], seats: [] };
  const rx = Coefficient.buildCoefficient({ graph: g, ledgers }).rows[0];
  assert.strictEqual(rx.rating, null);
});

test('gamesTotal: sums counted all-play games across all humans', () => {
  assert.strictEqual(result.gamesTotal, 30, '15 (u1) + 9 (u2) + 6 (u5) + 0 (u8)');
});

test('empty inputs: no people → empty rows, zero games', () => {
  const r = Coefficient.buildCoefficient({});
  assert.deepStrictEqual(r.rows, []);
  assert.strictEqual(r.gamesTotal, 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.log('FAIL: ' + f.name + '\n  ' + (f.e && f.e.stack)));
  process.exit(1);
}
console.log('PASS commish-coefficient');
