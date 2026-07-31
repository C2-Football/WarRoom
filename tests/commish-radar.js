#!/usr/bin/env node
// Unit tests for the Commissioner activity radar (App.Commish.Radar — the
// "Dave alarm"): txn attribution, the OK/WATCH/DARK per-team matrix incl. the
// offseason guard, DARK_ALL vs DARK_ONE person classification, worst-first
// sort, and check-in copy determinism. All pure paths — fetch is stubbed and
// nowMs is always passed explicitly, so nothing here touches the network or
// the wall clock.
'use strict';

const assert = require('assert');

// Stub fetch BEFORE any require: a unit test must never touch the network.
globalThis.fetch = () => Promise.resolve({ ok: false });

const Commish = require('../js/shared/commish-engine.js');
const Radar = require('../js/shared/commish-radar.js');

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
const NOW = 1770000000000;                     // fixed clock — no Date.now()
const daysAgo = n => NOW - n * 24 * 60 * 60 * 1000;

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
// Roster with N healthy starters plus whatever problem slots the test injects.
function roster(rid, starters) { return { roster_id: rid, starters, players: starters.filter(Boolean) }; }

const PLAYERS = {
  hp1: { injury_status: null, bye_week: 9 },
  hp2: { injury_status: 'Questionable', bye_week: 9 },   // questionable ≠ out
  out1: { injury_status: 'Out', bye_week: 9 },
  out2: { injury_status: 'IR', bye_week: 9 },
  bye1: { injury_status: null, bye_week: 5 },
  bye2: { injury_status: null, bye_week: 5 },
};

// Single-person radar run with everything defaulted to "healthy week 5".
function run(overrides) {
  const o = overrides || {};
  const g = o.graph || graphOf([person('u1', [team('L1', 1)])]);
  return Radar.buildRadar({
    graph: g,
    txnsByLeague: o.txnsByLeague || {},
    rostersByLeague: o.rostersByLeague || {},
    playersData: o.playersData || PLAYERS,
    week: o.week !== undefined ? o.week : 5,
    nowMs: o.nowMs !== undefined ? o.nowMs : NOW,
  });
}
const firstTeam = res => res.people[0].teams[0];

// ── Txn attribution ─────────────────────────────────────────────────
test('txn attribution: roster_ids reaches the right roster only', () => {
  const txns = [{ type: 'trade', status: 'complete', created: daysAgo(3), roster_ids: [2] }];
  assert.strictEqual(Radar.daysSinceTxn(txns, 2, NOW), 3, 'roster 2 transacted 3 days ago');
  assert.strictEqual(Radar.daysSinceTxn(txns, 1, NOW), null, 'roster 1 never transacted');
});

test('txn attribution: adds/drops maps attribute when roster_ids is silent', () => {
  const txns = [
    { type: 'waiver', status: 'complete', created: daysAgo(7), adds: { p99: 1 }, drops: null },
    { type: 'free_agent', status: 'complete', created: daysAgo(4), adds: null, drops: { p42: 3 } },
  ];
  assert.strictEqual(Radar.daysSinceTxn(txns, 1, NOW), 7, 'adds map attributes');
  assert.strictEqual(Radar.daysSinceTxn(txns, 3, NOW), 4, 'drops map attributes');
});

test('txn attribution: latest touch wins; string/number roster ids match', () => {
  const txns = [
    { type: 'waiver', status: 'complete', created: daysAgo(20), roster_ids: ['1'] },
    { type: 'waiver', status: 'complete', created: daysAgo(2), adds: { p1: '1' } },
  ];
  assert.strictEqual(Radar.daysSinceTxn(txns, 1, NOW), 2);
});

test('txn attribution: commissioner txns never reset a member clock', () => {
  const txns = [
    { type: 'commissioner', status: 'complete', created: daysAgo(1), roster_ids: [1] },
    { type: 'waiver', status: 'complete', created: daysAgo(30), roster_ids: [1] },
  ];
  assert.strictEqual(Radar.daysSinceTxn(txns, 1, NOW), 30, 'commish force-move ignored');
  assert.strictEqual(Radar.daysSinceTxn([txns[0]], 1, NOW), null, 'only commish txns = never');
});

test('txn attribution: future-dated txn clamps to 0, never negative', () => {
  const txns = [{ type: 'trade', status: 'complete', created: NOW + 60000, roster_ids: [1] }];
  assert.strictEqual(Radar.daysSinceTxn(txns, 1, NOW), 0);
});

// ── Per-team status: in-season matrix ───────────────────────────────
test('in-season: silent (>21d) + OUT starter → DARK', () => {
  const res = run({
    txnsByLeague: { L1: [{ type: 'waiver', status: 'complete', created: daysAgo(30), roster_ids: [1] }] },
    rostersByLeague: { L1: [roster(1, ['hp1', 'out1'])] },
  });
  assert.strictEqual(firstTeam(res).status, 'DARK');
  assert.strictEqual(firstTeam(res).signals.outStarters, 1);
});

test('in-season: never transacted + empty slot → DARK', () => {
  const res = run({ rostersByLeague: { L1: [roster(1, ['hp1', '0'])] } });
  assert.strictEqual(firstTeam(res).signals.daysSinceTxn, null);
  assert.strictEqual(firstTeam(res).signals.emptySlots, 1);
  assert.strictEqual(firstTeam(res).status, 'DARK');
});

test('in-season: silent (>21d) but clean lineup → WATCH, not DARK', () => {
  const res = run({
    txnsByLeague: { L1: [{ type: 'waiver', status: 'complete', created: daysAgo(30), roster_ids: [1] }] },
    rostersByLeague: { L1: [roster(1, ['hp1', 'hp2'])] },
  });
  assert.strictEqual(firstTeam(res).status, 'WATCH');
});

test('in-season: active but one OUT starter → WATCH', () => {
  const res = run({
    txnsByLeague: { L1: [{ type: 'waiver', status: 'complete', created: daysAgo(2), roster_ids: [1] }] },
    rostersByLeague: { L1: [roster(1, ['hp1', 'out2'])] },
  });
  assert.strictEqual(firstTeam(res).status, 'WATCH');
});

test('in-season: 2 bye starters → WATCH; 1 bye → OK', () => {
  const active = { L1: [{ type: 'waiver', status: 'complete', created: daysAgo(2), roster_ids: [1] }] };
  const two = run({ txnsByLeague: active, rostersByLeague: { L1: [roster(1, ['bye1', 'bye2', 'hp1'])] } });
  assert.strictEqual(firstTeam(two).signals.byeStarters, 2);
  assert.strictEqual(firstTeam(two).status, 'WATCH');
  const one = run({ txnsByLeague: active, rostersByLeague: { L1: [roster(1, ['bye1', 'hp1'])] } });
  assert.strictEqual(firstTeam(one).status, 'OK');
});

test('in-season: recent txn + healthy lineup → OK (Questionable does not count)', () => {
  const res = run({
    txnsByLeague: { L1: [{ type: 'trade', status: 'complete', created: daysAgo(5), roster_ids: [1] }] },
    rostersByLeague: { L1: [roster(1, ['hp1', 'hp2'])] },
  });
  assert.strictEqual(firstTeam(res).signals.outStarters, 0);
  assert.strictEqual(firstTeam(res).status, 'OK');
});

test('injury statuses: OUT/IR/PUP/SUS/NA/COV all count, case-insensitive', () => {
  for (const st of ['Out', 'IR', 'PUP', 'Sus', 'NA', 'COV', 'out']) {
    const sig = Radar.lineupSignals(roster(1, ['x']), { x: { injury_status: st } }, 5);
    assert.strictEqual(sig.outStarters, 1, st + ' should count as out');
  }
  const sig = Radar.lineupSignals(roster(1, ['x']), { x: { injury_status: 'Doubtful' } }, 5);
  assert.strictEqual(sig.outStarters, 0, 'Doubtful is a game-time call, not abandonment');
});

test('empty slots: falsy and "0" starters entries both count', () => {
  const sig = Radar.lineupSignals(roster(1, ['0', null, 'hp1']), PLAYERS, 5);
  assert.strictEqual(sig.emptySlots, 2);
});

// ── Per-team status: offseason guard ────────────────────────────────
test('offseason (week 0): lineup disaster is neutral; txn fuses are longer', () => {
  const wreck = { L1: [roster(1, ['out1', '0'])] };
  const at = n => run({
    week: 0, rostersByLeague: wreck,
    txnsByLeague: { L1: [{ type: 'waiver', status: 'complete', created: daysAgo(n), roster_ids: [1] }] },
  });
  assert.strictEqual(firstTeam(at(30)).status, 'OK', '30d silent + broken lineup is fine in June');
  assert.strictEqual(firstTeam(at(40)).status, 'WATCH', '>35d → WATCH');
  assert.strictEqual(firstTeam(at(70)).status, 'DARK', '>60d → DARK');
});

test('offseason: never transacted → DARK', () => {
  const res = run({ week: 0, rostersByLeague: { L1: [roster(1, ['hp1'])] } });
  assert.strictEqual(firstTeam(res).status, 'DARK');
});

test('no starters data in-season → offseason thresholds apply', () => {
  // Week 5, but rosters were never fetched: a missing lineup must not read
  // as an abandoned one.
  const res = run({
    week: 5, rostersByLeague: {},
    txnsByLeague: { L1: [{ type: 'waiver', status: 'complete', created: daysAgo(40), roster_ids: [1] }] },
  });
  assert.strictEqual(firstTeam(res).inSeason, false);
  assert.strictEqual(firstTeam(res).status, 'WATCH', '40d on the offseason fuse, not in-season DARK');
});

// ── Person classification ───────────────────────────────────────────
const darkTxns = lid => ({ [lid]: [] });                       // never transacted
const okTxns = lid => ({ [lid]: [{ type: 'waiver', status: 'complete', created: daysAgo(2), roster_ids: [1] }] });
const brokenRoster = lid => ({ [lid]: [roster(1, ['out1', 'hp1'])] });
const cleanRoster = lid => ({ [lid]: [roster(1, ['hp1', 'hp2'])] });

test('person: 2+ teams all DARK → DARK_ALL ("life happened")', () => {
  const g = graphOf([person('dave', [team('L1', 1), team('L2', 1)], { name: 'Dave' })]);
  const res = run({
    graph: g,
    txnsByLeague: { ...darkTxns('L1'), ...darkTxns('L2') },
    rostersByLeague: { ...brokenRoster('L1'), ...brokenRoster('L2') },
  });
  assert.strictEqual(res.people[0].status, 'DARK_ALL');
});

test('person: dark in one league, alive in the other → DARK_ONE', () => {
  const g = graphOf([person('dave', [team('L1', 1), team('L2', 1)], { name: 'Dave' })]);
  const res = run({
    graph: g,
    txnsByLeague: { ...darkTxns('L1'), ...okTxns('L2') },
    rostersByLeague: { ...brokenRoster('L1'), ...cleanRoster('L2') },
  });
  assert.strictEqual(res.people[0].status, 'DARK_ONE');
  const dark = res.people[0].teams.find(t => t.status === 'DARK');
  assert.strictEqual(dark.leagueId, 'L1', 'the dark team is the silent+broken one');
});

test('person: single-team person DARK → DARK_ONE, never DARK_ALL', () => {
  const res = run({ txnsByLeague: darkTxns('L1'), rostersByLeague: brokenRoster('L1') });
  assert.strictEqual(res.people[0].status, 'DARK_ONE');
});

test('person: WATCH only → FADING; all OK → ACTIVE with null checkin', () => {
  const fading = run({ txnsByLeague: okTxns('L1'), rostersByLeague: brokenRoster('L1') });
  assert.strictEqual(fading.people[0].status, 'FADING');
  assert.ok(fading.people[0].checkin, 'FADING still gets a nudge draft');
  const active = run({ txnsByLeague: okTxns('L1'), rostersByLeague: cleanRoster('L1') });
  assert.strictEqual(active.people[0].status, 'ACTIVE');
  assert.strictEqual(active.people[0].checkin, null);
});

test('sort: worst-first — DARK_ALL, DARK_ONE, FADING, ACTIVE', () => {
  const g = graphOf([
    person('a', [team('L1', 1)], { name: 'Active Al' }),
    person('f', [team('L2', 1)], { name: 'Fading Fred' }),
    person('d1', [team('L3', 1)], { name: 'Dark Dan' }),
    person('da', [team('L4', 1), team('L5', 1)], { name: 'Dave' }),
  ]);
  const res = run({
    graph: g,
    txnsByLeague: { ...okTxns('L1'), ...okTxns('L2'), ...darkTxns('L3'), ...darkTxns('L4'), ...darkTxns('L5') },
    rostersByLeague: {
      ...cleanRoster('L1'), ...brokenRoster('L2'), ...brokenRoster('L3'),
      ...brokenRoster('L4'), ...brokenRoster('L5'),
    },
  });
  assert.deepStrictEqual(res.people.map(p => p.status), ['DARK_ALL', 'DARK_ONE', 'FADING', 'ACTIVE']);
  assert.strictEqual(res.people[0].name, 'Dave');
});

// ── Check-in copy ───────────────────────────────────────────────────
test('checkin: deterministic — same inputs → identical text (template fallback)', () => {
  const build = () => run({ txnsByLeague: darkTxns('L1'), rostersByLeague: brokenRoster('L1') });
  const a = build().people[0].checkin, b = build().people[0].checkin;
  assert.ok(a && typeof a === 'string' && a.length > 10, 'non-empty draft');
  assert.strictEqual(a, b, 'same seed → same text');
});

test('checkin: DARK_ONE names the dark league; DARK_ALL stays human, no league name', () => {
  // Seeded stub standing in for AlexVoice — proves the pick path is used and
  // stays deterministic without depending on browser-only code.
  globalThis.AlexVoice = {
    pick: (seed, arr) => arr[String(seed).length % arr.length],
    _calls: 0,
  };
  try {
    const g2 = graphOf([person('dave', [team('L1', 1, 'Dynasty Empire'), team('L2', 1)], { name: 'Dave Smith' })]);
    const one = run({
      graph: g2,
      txnsByLeague: { ...darkTxns('L1'), ...okTxns('L2') },
      rostersByLeague: { ...brokenRoster('L1'), ...cleanRoster('L2') },
    });
    assert.ok(one.people[0].checkin.includes('Dynasty Empire'), 'DARK_ONE mentions the league: ' + one.people[0].checkin);
    assert.ok(one.people[0].checkin.includes('Dave'), 'addresses the person by first name');

    const all = run({
      graph: g2,
      txnsByLeague: { ...darkTxns('L1'), ...darkTxns('L2') },
      rostersByLeague: { ...brokenRoster('L1'), ...brokenRoster('L2') },
    });
    assert.strictEqual(all.people[0].status, 'DARK_ALL');
    assert.ok(!all.people[0].checkin.includes('Dynasty Empire'), 'DARK_ALL is a human check-in, not league talk');
    assert.ok(all.people[0].checkin.includes('Dave'));
    // Determinism through the AlexVoice path too.
    const again = run({
      graph: g2,
      txnsByLeague: { ...darkTxns('L1'), ...darkTxns('L2') },
      rostersByLeague: { ...brokenRoster('L1'), ...brokenRoster('L2') },
    });
    assert.strictEqual(all.people[0].checkin, again.people[0].checkin);
  } finally { delete globalThis.AlexVoice; }
});

test('checkin: never drafted for myself even when DARK', () => {
  const g = graphOf([person('me', [team('L1', 1)], { name: 'Me', isMe: true })]);
  const res = run({ graph: g, txnsByLeague: darkTxns('L1'), rostersByLeague: brokenRoster('L1') });
  assert.strictEqual(res.people[0].status, 'DARK_ONE', 'still classified');
  assert.strictEqual(res.people[0].checkin, null, 'but no message to myself');
});

// ── Seam: real member graph in, radar out ───────────────────────────
test('integration: buildMemberGraph output feeds buildRadar directly', () => {
  const league = {
    league_id: 'L9', name: 'Seam League',
    users: [
      { user_id: 'u1', display_name: 'Alpha', is_owner: true },
      { user_id: 'u2', display_name: 'Beta' },
    ],
    rosters: [
      { roster_id: 1, owner_id: 'u1', settings: { wins: 3, losses: 1 } },
      { roster_id: 2, owner_id: 'u2', settings: { wins: 1, losses: 3 } },
    ],
  };
  const graph = Commish.buildMemberGraph({ leagues: [league], myUserId: 'u1' });
  const res = Radar.buildRadar({
    graph,
    txnsByLeague: { L9: [{ type: 'waiver', status: 'complete', created: daysAgo(2), roster_ids: [2] }] },
    rostersByLeague: { L9: [roster(1, ['hp1']), roster(2, ['hp1'])] },
    playersData: PLAYERS, week: 5, nowMs: NOW,
  });
  assert.strictEqual(res.people.length, 2);
  const beta = res.people.find(p => p.userId === 'u2');
  assert.strictEqual(beta.teams[0].signals.daysSinceTxn, 2, 'txn attributed through the graph rosterId');
  const alpha = res.people.find(p => p.userId === 'u1');
  assert.strictEqual(alpha.isMe, true);
});

test('empty inputs: no graph, no txns → empty people, never a throw', () => {
  assert.deepStrictEqual(Radar.buildRadar({}), { people: [] });
  const res = run({ txnsByLeague: {}, rostersByLeague: {} });
  assert.strictEqual(res.people.length, 1, 'person still listed with honest null/zero signals');
  assert.strictEqual(firstTeam(res).signals.daysSinceTxn, null);
});

// ── Fetch helper (stubbed globals, no network) ──────────────────────
(async () => {
  await testAsync('fetchRadarInputs: uses stubbed global fetchers, skips mfl_', async () => {
    const fetched = { txns: [], rosters: [] };
    globalThis.fetchTransactions = (lid, w) => { fetched.txns.push(lid + ':' + w); return Promise.resolve(w === 1 ? [{ type: 'waiver', created: daysAgo(1), roster_ids: [1] }] : []); };
    globalThis.fetchRosters = lid => { fetched.rosters.push(lid); return Promise.resolve([roster(1, ['hp1'])]); };
    globalThis.fetchAllPlayers = () => Promise.resolve(PLAYERS);
    try {
      const g = graphOf([person('u1', [team('L1', 1), team('mfl_9', 1)])]);
      const inputs = await Radar.fetchRadarInputs({ graph: g });
      assert.strictEqual(inputs.txnsByLeague.L1.length, 1, 'one real txn kept');
      assert.ok(!('mfl_9' in inputs.txnsByLeague), 'mfl_ league skipped');
      assert.ok(fetched.rosters.includes('L1') && !fetched.rosters.includes('mfl_9'));
      assert.strictEqual(inputs.playersData.hp1.bye_week, 9, 'players map hydrated');
    } finally {
      delete globalThis.fetchTransactions; delete globalThis.fetchRosters; delete globalThis.fetchAllPlayers;
    }
  });

  await testAsync('fetchRadarInputs: no fetchers at all → empty maps, never a throw', async () => {
    const g = graphOf([person('u1', [team('L1', 1)])]);
    const inputs = await Radar.fetchRadarInputs({ graph: g });
    assert.deepStrictEqual(inputs.txnsByLeague, { L1: [] });
    assert.deepStrictEqual(inputs.rostersByLeague, { L1: [] });
    assert.deepStrictEqual(inputs.playersData, {});
    // And the radar downstream stays honest: never-transacted, no lineup data.
    const res = Radar.buildRadar({ graph: g, ...inputs, week: 5, nowMs: NOW });
    assert.strictEqual(res.people[0].teams[0].signals.daysSinceTxn, null);
    assert.strictEqual(res.people[0].teams[0].inSeason, false);
  });

  console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
    process.exit(1);
  }
})();
