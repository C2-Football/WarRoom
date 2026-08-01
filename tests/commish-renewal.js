#!/usr/bin/env node
// Unit tests for the Renewal Forecast (App.Commish.Renewal): exact factor
// arithmetic against the documented heuristic, clamping, band edges (the two
// exact boundary probabilities), the offseason forecastBasis flag + prepended
// honesty factor, riskiest-first ordering, isMe exclusion, and plays gating
// (WATCH/AT_RISK only, deterministic, grounded in the fired factors). All
// pure paths — fetch is stubbed before any require and no test reads the
// wall clock.
'use strict';

const assert = require('assert');

// Stub fetch BEFORE any require: a unit test must never touch the network.
globalThis.fetch = () => Promise.resolve({ ok: false });

const Luck = require('../js/shared/luck-engine.js');
const Renewal = require('../js/shared/commish-renewal.js');

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

// ── Fixtures ────────────────────────────────────────────────────────
function team(lid, rid, name) {
  return { leagueId: lid, leagueName: name || ('League ' + lid), rosterId: rid,
           record: { w: 0, l: 0, t: 0 }, pf: 0, isCommissioner: false };
}
function person(uid, teams, opts) {
  const leagueIds = [...new Set(teams.map(t => t.leagueId))];
  return { userId: uid, name: (opts && opts.name) || ('User ' + uid), teamNames: [],
           teams, leagueIds, leagueCount: leagueIds.length, isMe: !!(opts && opts.isMe) };
}
function graphOf(list) {
  const people = {};
  list.forEach(p => { people[p.userId] = p; });
  return { people, overlap: [], seats: [] };
}
// Radar result fragment for one person.
function radarPerson(uid, status, teams) {
  return { userId: uid, name: 'User ' + uid, isMe: false, leagueCount: 1,
           status, teams: teams || [] };
}
function radarOf(list) { return { people: list }; }
// Hand-built ledger: exact allPlayPct/luck, weeks counted.
function ledger(rows, weeks) {
  return { rows: rows.map(r => ({ rosterId: r[0], allPlayPct: r[1], luck: r[2] })),
           weeks: weeks || [1, 2, 3] };
}
// An 8-team season ledger. Ranked ascending by allPlayPct:
//   r8 .10 (bottom-quartile, floor(8/4)=2 → r8,r7), r7 .20, r6 .40, r5 .45,
//   r4 .55 (top half, floor(8/2)=4 → r4,r3,r2,r1), r3 .60, r2 .70, r1 .80
function seasonLedger() {
  return ledger([
    [1, 0.80, 1.0], [2, 0.70, 0.5], [3, 0.60, -1.5], [4, 0.55, 0.2],
    [5, 0.45, 0.0], [6, 0.40, 0.3], [7, 0.20, 0.4], [8, 0.10, -0.8],
  ]);
}
function run(o) {
  return Renewal.buildForecast({
    graph: o.graph, radar: o.radar || radarOf([]), ledgers: o.ledgers || {},
    week: o.week !== undefined ? o.week : null, nowMs: 1770000000000,
  });
}
const only = res => res.people[0];
const OFFSEASON = 'offseason read — behavior signals only';

// ── Baseline + isMe exclusion ───────────────────────────────────────
test('baseline: unknown-to-radar person with no ledgers sits at 0.85 SAFE', () => {
  const res = run({ graph: graphOf([person('u1', [team('L1', 1)])]) });
  assert.strictEqual(res.people.length, 1);
  assert.strictEqual(only(res).probability, 0.85);
  assert.strictEqual(only(res).band, 'SAFE');
  // Offseason honesty is the ONLY factor — nothing else moved the number.
  assert.deepStrictEqual(only(res).factors, [OFFSEASON]);
  assert.deepStrictEqual(only(res).plays, []);
});

test('isMe is excluded from the forecast entirely', () => {
  const res = run({ graph: graphOf([
    person('me', [team('L1', 1)], { isMe: true }),
    person('u2', [team('L1', 2)]),
  ]) });
  assert.strictEqual(res.people.length, 1);
  assert.strictEqual(only(res).userId, 'u2');
});

// ── Radar-status arithmetic (exact) ─────────────────────────────────
test('radar ACTIVE: 0.85 + 0.08 = 0.93, factor shown', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 1)])]),
    radar: radarOf([radarPerson('u1', 'ACTIVE')]),
  });
  assert.strictEqual(only(res).probability, 0.93);
  assert.ok(only(res).factors.some(f => f.includes('active everywhere (+0.08)')), 'factor names the move');
});

test('radar FADING: 0.85 - 0.10 = 0.75 — exactly on the SAFE edge', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 1)])]),
    radar: radarOf([radarPerson('u1', 'FADING')]),
  });
  assert.strictEqual(only(res).probability, 0.75);
  assert.strictEqual(only(res).band, 'SAFE', '>= .75 is SAFE (boundary inclusive)');
  assert.deepStrictEqual(only(res).plays, [], 'SAFE gets no plays even with a negative factor');
});

test('radar DARK_ONE: 0.85 - 0.20 = 0.65 WATCH, factor names the dark league', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 1, 'Dynasty Din'), team('L2', 3, 'Empire')])]),
    radar: radarOf([radarPerson('u1', 'DARK_ONE', [
      { leagueId: 'L2', status: 'DARK', signals: { daysSinceTxn: 70 } },
      { leagueId: 'L1', status: 'OK', signals: { daysSinceTxn: 2 } },
    ])]),
  });
  const p = only(res);
  // 0.85 - 0.20 + 0.04 (2 leagues) = 0.69
  assert.strictEqual(p.probability, 0.69);
  assert.strictEqual(p.band, 'WATCH');
  assert.ok(p.factors.some(f => f.includes('gone dark in Empire (-0.20)')), 'dark league named from the graph');
});

test('radar DARK_ALL: 0.85 - 0.35 = 0.50 — exactly on the WATCH edge', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 1)])]),
    radar: radarOf([radarPerson('u1', 'DARK_ALL')]),
  });
  assert.strictEqual(only(res).probability, 0.5);
  assert.strictEqual(only(res).band, 'WATCH', '>= .5 is WATCH (boundary inclusive)');
});

test('band AT_RISK below the .5 edge: DARK_ALL + bad-and-unlucky = 0.40', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 8)])]),
    radar: radarOf([radarPerson('u1', 'DARK_ALL')]),
    ledgers: { L1: seasonLedger() },
  });
  // 0.85 - 0.35 - 0.10 = 0.40
  assert.strictEqual(only(res).probability, 0.4);
  assert.strictEqual(only(res).band, 'AT_RISK');
});

// ── Season-arc arithmetic (exact, per team) ─────────────────────────
test('season: bottom-quartile with negative luck = -0.10 ("bad AND unlucky")', () => {
  const res = run({ graph: graphOf([person('u1', [team('L1', 8)])]), ledgers: { L1: seasonLedger() } });
  assert.strictEqual(only(res).probability, 0.75); // 0.85 - 0.10
  assert.ok(only(res).factors.some(f => f.includes('bad AND unlucky (-0.10)')));
});

test('season: bottom-quartile with luck >= 0 = -0.05 ("just bad")', () => {
  const res = run({ graph: graphOf([person('u1', [team('L1', 7)])]), ledgers: { L1: seasonLedger() } });
  assert.strictEqual(only(res).probability, 0.8); // 0.85 - 0.05
  assert.ok(only(res).factors.some(f => f.includes('just bad (-0.05)')));
});

test('season: top-half all-play = +0.05', () => {
  const res = run({ graph: graphOf([person('u1', [team('L1', 1)])]), ledgers: { L1: seasonLedger() } });
  assert.strictEqual(only(res).probability, 0.9); // 0.85 + 0.05
  assert.ok(only(res).factors.some(f => f.includes('top-half all-play season (+0.05)')));
});

test('season: middle of the pack (not bottom quartile, not top half) moves nothing', () => {
  const res = run({ graph: graphOf([person('u1', [team('L1', 5)])]), ledgers: { L1: seasonLedger() } });
  assert.strictEqual(only(res).probability, 0.85);
  assert.strictEqual(only(res).factors.length, 0, 'no season factor when nothing fired');
});

test('season: robbed (luck <= -1.5, allPlayPct >= .5) stacks with top-half: +0.05 - 0.08', () => {
  const res = run({ graph: graphOf([person('u1', [team('L1', 3, 'The Grind')])]), ledgers: { L1: seasonLedger() } });
  const p = only(res);
  assert.strictEqual(p.probability, 0.82); // 0.85 + 0.05 - 0.08
  assert.ok(p.factors.some(f => f.includes('unlucky season — rage-quit risk (-0.08)')), 'robbed factor uses the mandated phrase');
  assert.ok(p.factors.some(f => f.startsWith('The Grind:')), 'season factors carry the league name');
});

test('season: two teams each contribute their own arc', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 8), team('L2', 1)])]),
    ledgers: { L1: seasonLedger(), L2: seasonLedger() },
  });
  // 0.85 - 0.10 (L1 bad+unlucky) + 0.05 (L2 top-half) + 0.04 (2 leagues) = 0.84
  assert.strictEqual(only(res).probability, 0.84);
  assert.strictEqual(only(res).factors.length, 3);
});

test('season: league without a ledger (or person not in rows) contributes nothing', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 99), team('L9', 1)])]),
    ledgers: { L1: seasonLedger() }, // roster 99 not in rows; L9 has no ledger
  });
  // Only the 2-league bump fires: 0.85 + 0.04 = 0.89
  assert.strictEqual(only(res).probability, 0.89);
});

test('season: integrates with a real Luck.buildLedger (field-name compatibility)', () => {
  const league = {
    rosters: [1, 2, 3, 4].map(id => ({ roster_id: id, owner_id: 'u' + id })),
    users: [1, 2, 3, 4].map(id => ({ user_id: 'u' + id, display_name: 'Team ' + id })),
  };
  const weeklyScores = {
    1: [{ rosterId: 1, points: 130, matchupId: 'a' }, { rosterId: 2, points: 100, matchupId: 'a' },
        { rosterId: 3, points: 120, matchupId: 'b' }, { rosterId: 4, points: 90, matchupId: 'b' }],
    2: [{ rosterId: 1, points: 140, matchupId: 'a' }, { rosterId: 2, points: 95, matchupId: 'a' },
        { rosterId: 3, points: 60, matchupId: 'b' }, { rosterId: 4, points: 100, matchupId: 'b' }],
  };
  const led = Luck.buildLedger({ league, weeklyScores });
  const res = run({ graph: graphOf([person('u1', [team('L1', 1)])]), ledgers: { L1: led } });
  assert.strictEqual(res.forecastBasis, 'behavior+season');
  // Roster 1 is 6-0 all-play → top half: 0.85 + 0.05 = 0.90
  assert.strictEqual(only(res).probability, 0.9);
});

// ── Multi-league sunk identity ──────────────────────────────────────
test('multi-league: +0.04 for a second league, +0.08 for a third, capped there', () => {
  const two = run({ graph: graphOf([person('u1', [team('L1', 1), team('L2', 1)])]) });
  assert.strictEqual(only(two).probability, 0.89);
  const three = run({ graph: graphOf([person('u1', [team('L1', 1), team('L2', 1), team('L3', 1)])]) });
  assert.strictEqual(only(three).probability, 0.93);
  assert.ok(only(three).factors.some(f => f.includes('sunk identity (+0.08)')));
  const five = run({ graph: graphOf([person('u1', [team('L1', 1), team('L2', 1), team('L3', 1), team('L4', 1), team('L5', 1)])]) });
  assert.strictEqual(only(five).probability, 0.93, 'cap holds at +0.08');
});

// ── Clamping ────────────────────────────────────────────────────────
test('clamp floor: pile-on cannot go below 0.05', () => {
  const teams = [1, 2, 3, 4, 5, 6].map(i => team('L' + i, 8));
  const ledgers = {};
  teams.forEach(t => { ledgers[t.leagueId] = seasonLedger(); });
  const res = run({
    graph: graphOf([person('u1', teams)]),
    radar: radarOf([radarPerson('u1', 'DARK_ALL')]),
    ledgers,
  });
  // Raw: 0.85 - 0.35 - 6×0.10 + 0.08 = -0.02 → clamped
  assert.strictEqual(only(res).probability, 0.05);
  assert.strictEqual(only(res).band, 'AT_RISK');
});

test('clamp ceiling: stacked positives cannot exceed 0.98', () => {
  const teams = [1, 2, 3].map(i => team('L' + i, 1));
  const ledgers = {};
  teams.forEach(t => { ledgers[t.leagueId] = seasonLedger(); });
  const res = run({
    graph: graphOf([person('u1', teams)]),
    radar: radarOf([radarPerson('u1', 'ACTIVE')]),
    ledgers,
  });
  // Raw: 0.85 + 0.08 + 3×0.05 + 0.08 = 1.16 → clamped
  assert.strictEqual(only(res).probability, 0.98);
});

// ── Offseason basis ─────────────────────────────────────────────────
test('offseason: no ledgers at all → activity_only + honesty factor prepended to everyone', () => {
  const res = run({ graph: graphOf([person('u1', [team('L1', 1)]), person('u2', [team('L1', 2)])]) });
  assert.strictEqual(res.forecastBasis, 'activity_only');
  res.people.forEach(p => assert.strictEqual(p.factors[0], OFFSEASON, 'prepended, first for ' + p.userId));
});

test('offseason: ledgers present but zero counted weeks still reads activity_only', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 1)])]),
    ledgers: { L1: { rows: [], weeks: [] } },
  });
  assert.strictEqual(res.forecastBasis, 'activity_only');
  assert.strictEqual(only(res).factors[0], OFFSEASON);
});

test('in-season: any counted week → behavior+season, no honesty factor', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 5)])]),
    ledgers: { L1: seasonLedger() },
  });
  assert.strictEqual(res.forecastBasis, 'behavior+season');
  assert.ok(!only(res).factors.includes(OFFSEASON));
});

// ── Ordering + summary ──────────────────────────────────────────────
test('people sorted riskiest first; summary counts the bands', () => {
  const res = run({
    graph: graphOf([
      person('safe1', [team('L1', 1)]),                       // 0.85 SAFE
      person('risk1', [team('L1', 8)]),                       // AT_RISK below
      person('watch1', [team('L1', 5)]),                      // WATCH below
    ]),
    radar: radarOf([
      radarPerson('risk1', 'DARK_ALL'),                       // 0.85-0.35-0.10 = 0.40
      radarPerson('watch1', 'DARK_ONE', [{ leagueId: 'L1', status: 'DARK', signals: {} }]), // 0.65
    ]),
    ledgers: { L1: seasonLedger() },
  });
  assert.deepStrictEqual(res.people.map(p => p.userId), ['risk1', 'watch1', 'safe1']);
  assert.deepStrictEqual(res.summary, { safe: 1, watch: 1, atRisk: 1 });
});

// ── Plays ───────────────────────────────────────────────────────────
test('plays: only WATCH/AT_RISK get plays, capped at 2, grounded in fired factors', () => {
  const res = run({
    graph: graphOf([person('u1', [team('L1', 3, 'The Grind')])]),
    radar: radarOf([radarPerson('u1', 'DARK_ONE', [{ leagueId: 'L1', status: 'DARK', signals: {} }])]),
    ledgers: { L1: seasonLedger() },
  });
  // 0.85 - 0.20 + 0.05 - 0.08 = 0.62 WATCH; hooks: darkOne + robbed
  const p = only(res);
  assert.strictEqual(p.probability, 0.62);
  assert.strictEqual(p.band, 'WATCH');
  assert.ok(p.plays.length >= 1 && p.plays.length <= 2, '0-2 plays, got ' + p.plays.length);
  assert.ok(p.plays.some(x => x.includes('The Grind')), 'DARK_ONE play names THAT league');
  assert.ok(p.plays.some(x => /luck ledger|all-play table/.test(x)), 'robbed play points at the luck ledger');
});

test('plays: deterministic — same inputs, identical output twice', () => {
  const args = {
    graph: graphOf([person('u1', [team('L1', 8)]), person('u2', [team('L1', 3)])]),
    radar: radarOf([radarPerson('u1', 'DARK_ALL'), radarPerson('u2', 'DARK_ONE', [{ leagueId: 'L1', status: 'DARK', signals: {} }])]),
    ledgers: { L1: seasonLedger() },
  };
  assert.deepStrictEqual(run(args), run(args));
});

test('plays: AlexVoice.pick is used when present (seeded seam), fallback is variants[0]', () => {
  const graph = graphOf([person('u1', [team('L1', 1)])]);
  const radar = radarOf([radarPerson('u1', 'DARK_ALL')]);
  const noAV = run({ graph, radar });
  globalThis.AlexVoice = { pick: (seed, arr) => { assert.ok(String(seed).startsWith('commish-renewal:u1:')); return arr[arr.length - 1]; } };
  try {
    const withAV = run({ graph, radar });
    assert.notDeepStrictEqual(withAV.people[0].plays, noAV.people[0].plays, 'last-variant stub proves the seam is live');
  } finally { delete globalThis.AlexVoice; }
});

// ── Fetch helper ────────────────────────────────────────────────────
(async () => {
  await testAsync('fetchForecastInputs: builds a ledger per Sleeper league, skips mfl_ and failures', async () => {
    const calls = [];
    const App = globalThis.App;
    const origLuck = App.Luck;
    App.Luck = { build: async ({ league }) => {
      calls.push(league.league_id);
      if (league.league_id === 'Lboom') throw new Error('boom');
      return { rows: [], weeks: [1], weeklyScores: {} };
    } };
    try {
      const { ledgers } = await Renewal.fetchForecastInputs({ leagues: [
        { league_id: 'L1' }, { league_id: 'mfl_9' }, { league_id: 'Lboom' },
      ] });
      assert.deepStrictEqual(calls.sort(), ['L1', 'Lboom'], 'mfl_ never fetched');
      assert.ok(ledgers.L1, 'good league landed');
      assert.ok(!ledgers.Lboom, 'failed league skipped, not fabricated');
    } finally { App.Luck = origLuck; }
  });

  await testAsync('fetchForecastInputs: no App.Luck → empty ledgers, never a throw', async () => {
    const App = globalThis.App;
    const origLuck = App.Luck;
    delete App.Luck;
    try {
      const { ledgers } = await Renewal.fetchForecastInputs({ leagues: [{ league_id: 'L1' }] });
      assert.deepStrictEqual(ledgers, {});
    } finally { App.Luck = origLuck; }
  });

  console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
    process.exit(1);
  }
})();
