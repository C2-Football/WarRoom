#!/usr/bin/env node
// Unit tests for the Commissioner Schedule Builder engine: round-robin
// generation (circle method, even + odd team counts), pin placement
// (relabel rounds -> weeks, conflict reporting), ad hoc single-week force
// (matching-preserving, including bye transfer), validation (never
// auto-fixes, only states), division annotation (read-only), actuals
// fetch + merge (actuals always win over the plan), and text/CSV export.
// Pure-compute paths plus a stubbed fetch — no network ever.
'use strict';

const assert = require('assert');

globalThis.fetch = () => Promise.resolve({ ok: false });

const Schedule = require('../js/shared/commish-schedule.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const TEAMS6 = ['A', 'B', 'C', 'D', 'E', 'F'];
const TEAMS5 = ['A', 'B', 'C', 'D', 'E'];

function allPairs(teams) {
  const out = [];
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) out.push([teams[i], teams[j]].sort().join('|'));
  return out.sort();
}

// ── buildRoundRobin ─────────────────────────────────────────────────
test('even team count: N-1 rounds, no bye, every pair meets exactly once', () => {
  const { rounds, byeTeam } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  assert.strictEqual(byeTeam, null);
  assert.strictEqual(rounds.length, 5);
  const seen = [];
  rounds.forEach(r => {
    assert.strictEqual(r.length, 3, 'every round is a perfect matching of 6 teams into 3 pairs');
    r.forEach(([a, b]) => seen.push([a, b].sort().join('|')));
  });
  assert.deepStrictEqual(seen.sort(), allPairs(TEAMS6), 'all C(6,2)=15 pairs occur, each exactly once');
});

test('odd team count: a synthetic BYE seat keeps every round a perfect matching', () => {
  const { rounds, byeTeam } = Schedule.buildRoundRobin({ teamIds: TEAMS5, weeks: 5 });
  assert.strictEqual(byeTeam, Schedule.BYE);
  assert.strictEqual(rounds.length, 5);
  rounds.forEach(r => {
    const flat = r.flat();
    assert.strictEqual(new Set(flat).size, 6, 'each round covers all 5 teams + BYE exactly once');
    assert.ok(flat.includes(Schedule.BYE));
  });
});

test('weeks shorter than a full cycle truncates, not errors', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 2 });
  assert.strictEqual(rounds.length, 2);
});

test('weeks beyond one cycle repeats it (double round-robin = each pair meets twice)', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 10 });
  assert.strictEqual(rounds.length, 10);
  assert.deepStrictEqual(rounds[0], rounds[5], 'round 5 is round 0 of the second cycle');
});

test('fewer than 2 teams yields an empty, non-throwing result', () => {
  assert.deepStrictEqual(Schedule.buildRoundRobin({ teamIds: ['A'], weeks: 3 }), { rounds: [], byeTeam: null });
  assert.deepStrictEqual(Schedule.buildRoundRobin({ teamIds: [], weeks: 3 }), { rounds: [], byeTeam: null });
});

// ── applyPins ───────────────────────────────────────────────────────
test('a pin places the round already containing that pair onto the requested week', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule, conflicts } = Schedule.applyPins({ rounds, pins: [{ week: 4, teamA: 'A', teamB: 'B' }] });
  assert.strictEqual(conflicts.length, 0);
  const wk4 = schedule.find(w => w.week === 4);
  assert.ok(wk4.matchups.some(([a, b]) => (a === 'A' && b === 'B') || (a === 'B' && b === 'A')));
});

test('pinning never invents a pairing or drops a real one — schedule stays a valid round-robin', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [{ week: 4, teamA: 'A', teamB: 'B' }, { week: 1, teamA: 'C', teamB: 'D' }] });
  const seen = [];
  schedule.forEach(wk => wk.matchups.forEach(([a, b]) => seen.push([a, b].sort().join('|'))));
  assert.deepStrictEqual(seen.sort(), allPairs(TEAMS6));
});

test('two pins that would force the same round onto two different weeks: first wins, loser reported', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  // A-B and whichever pairs share A-B's round both target the SAME round;
  // find that round's other pairs so this is a genuine same-round clash.
  const roundIdx = rounds.findIndex(r => r.some(([a, b]) => (a === 'A' && b === 'B') || (a === 'B' && b === 'A')));
  const otherPair = rounds[roundIdx].find(([a, b]) => !(a === 'A' || b === 'A'));
  const { conflicts } = Schedule.applyPins({
    rounds,
    pins: [{ week: 2, teamA: 'A', teamB: 'B' }, { week: 3, teamA: otherPair[0], teamB: otherPair[1] }],
  });
  assert.strictEqual(conflicts.length, 1);
  assert.match(conflicts[0].reason, /already pinned to week 2/);
});

test('two pins targeting the same week with different rounds: second is rejected, not silently dropped', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { conflicts } = Schedule.applyPins({
    rounds,
    pins: [{ week: 1, teamA: 'A', teamB: 'B' }, { week: 1, teamA: 'A', teamB: 'C' }],
  });
  assert.strictEqual(conflicts.length, 1);
  assert.match(conflicts[0].reason, /already claimed/);
});

test('a pin naming a pair that never plays each other is reported, not silently ignored', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { conflicts } = Schedule.applyPins({ rounds, pins: [{ week: 1, teamA: 'A', teamB: 'ZZ' }] });
  assert.strictEqual(conflicts.length, 1);
  assert.match(conflicts[0].reason, /never occurs/);
});

test('a pin targeting a week outside the schedule length is reported', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { conflicts } = Schedule.applyPins({ rounds, pins: [{ week: 99, teamA: 'A', teamB: 'B' }] });
  assert.strictEqual(conflicts.length, 1);
  assert.match(conflicts[0].reason, /outside the 5-week schedule/);
});

test('no pins: weeks fill in original round order, deterministically', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  schedule.forEach((wk, i) => assert.deepStrictEqual(wk.matchups.map(p => p.slice()), rounds[i]));
});

// ── forcePairing ────────────────────────────────────────────────────
test('even league: forcing a pairing is a pure matching transposition (nobody vanishes)', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const wk1 = schedule.find(w => w.week === 1);
  const [a, oppA] = wk1.matchups[0];
  const [b, oppB] = wk1.matchups[1];
  const { schedule: next, ok, changed } = Schedule.forcePairing(schedule, 1, a, b);
  assert.ok(ok && changed);
  const newWk1 = next.find(w => w.week === 1);
  const flat = newWk1.matchups.flat();
  assert.strictEqual(new Set(flat).size, 6, 'all 6 teams still appear exactly once');
  assert.ok(newWk1.matchups.some(p => p.includes(a) && p.includes(b)), a + ' and ' + b + ' are now paired');
  assert.ok(newWk1.matchups.some(p => p.includes(oppA) && p.includes(oppB)), 'their old opponents are paired with each other');
});

test('odd league: forcing the bye team into a game transfers the bye, and validate() flags the resulting imbalance', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS5, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const wk1 = schedule.find(w => w.week === 1);
  const byeTeam = wk1.bye;
  const someOpponent = wk1.matchups[0][0];
  const { schedule: next } = Schedule.forcePairing(schedule, 1, byeTeam, someOpponent);
  const newWk1 = next.find(w => w.week === 1);
  assert.notStrictEqual(newWk1.bye, byeTeam, 'the original bye team now plays');
  assert.ok(newWk1.matchups.some(p => p.includes(byeTeam) && p.includes(someOpponent)));
  const v = Schedule.validateSchedule(next, TEAMS5);
  assert.ok(v.warnings.some(w => /play more games than others/.test(w)), 'the tool never silently absorbs the side effect');
});

test('forcing an already-true pairing is a no-op, not an error', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const wk1 = schedule.find(w => w.week === 1);
  const [a, b] = wk1.matchups[0];
  const { ok, changed } = Schedule.forcePairing(schedule, 1, a, b);
  assert.strictEqual(ok, true);
  assert.strictEqual(changed, false);
});

test('a team cannot be forced to play itself', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const { ok, error } = Schedule.forcePairing(schedule, 1, 'A', 'A');
  assert.strictEqual(ok, false);
  assert.match(error, /cannot play itself/);
});

test('forcing a team not scheduled that week at all errors instead of corrupting the week', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const { ok, error } = Schedule.forcePairing(schedule, 1, 'A', 'GHOST');
  assert.strictEqual(ok, false);
  assert.match(error, /not scheduled/);
});

test('forcing on a week that does not exist errors', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const { ok, error } = Schedule.forcePairing(schedule, 99, 'A', 'B');
  assert.strictEqual(ok, false);
  assert.match(error, /not found/);
});

// ── validateSchedule ────────────────────────────────────────────────
test('a fresh, unedited round-robin validates clean: even games, even byes, no warnings', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS5, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const v = Schedule.validateSchedule(schedule, TEAMS5);
  assert.strictEqual(v.minMeetings, 1);
  assert.strictEqual(v.maxMeetings, 1);
  TEAMS5.forEach(id => assert.strictEqual(v.byeCounts[id], 1));
  assert.deepStrictEqual(v.warnings, []);
});

test('a pair displaced to ZERO meetings by forcePairing is caught, not hidden by a sparse count', () => {
  // meetingCounts only holds pairs that met at least once, so a naive
  // Math.min(...Object.values(meetingCounts)) can never see a pair that
  // dropped to zero — it just silently isn't a key. minMeetings/maxMeetings
  // must be computed over the full pair universe instead.
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const wk1 = schedule.find(w => w.week === 1);
  const [a, oppA] = wk1.matchups[0];
  const [b, oppB] = wk1.matchups[1];
  const { schedule: forced } = Schedule.forcePairing(schedule, 1, a, b);
  const v = Schedule.validateSchedule(forced, TEAMS6);
  assert.strictEqual(v.minMeetings, 0, oppA + ' vs ' + oppB + ' no longer plays anywhere');
  assert.strictEqual(v.maxMeetings, 2, a + ' vs ' + b + ' now meets twice (week 1 forced + its natural round)');
  assert.ok(v.warnings.some(w => /meet 2 times/.test(w) && w.includes('never play')));
});

test('two consecutive byes for the same team are flagged (never auto-fixed)', () => {
  // Hand-built 3-week schedule where A sits out weeks 1 and 2 in a row.
  const schedule = [
    { week: 1, matchups: [['B', 'C']], bye: 'A' },
    { week: 2, matchups: [['B', 'C']], bye: 'A' },
    { week: 3, matchups: [['A', 'B']], bye: 'C' },
  ];
  const v = Schedule.validateSchedule(schedule, ['A', 'B', 'C']);
  assert.ok(v.warnings.some(w => /2 consecutive bye/.test(w)));
});

// ── annotateDivisions ───────────────────────────────────────────────
test('division annotation is read-only: it marks weeks, it never re-generates them', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const divisions = { A: 'East', B: 'East', C: 'West', D: 'West', E: 'North', F: 'North' };
  const { schedule: annotated, divisionMeetingCounts } = Schedule.annotateDivisions(schedule, divisions);
  const flags = annotated.flatMap(wk => wk.matchups.map(m => m.sameDivision));
  assert.ok(flags.includes(true) && flags.includes(false), 'both same- and cross-division weeks exist in a real schedule');
  const totalSameDiv = Object.values(divisionMeetingCounts).reduce((a, b) => a + b, 0);
  assert.strictEqual(totalSameDiv, flags.filter(Boolean).length);
});

test('no divisions given: schedule passes through unchanged', () => {
  const { rounds } = Schedule.buildRoundRobin({ teamIds: TEAMS6, weeks: 5 });
  const { schedule } = Schedule.applyPins({ rounds, pins: [] });
  const { schedule: out, divisionMeetingCounts } = Schedule.annotateDivisions(schedule, {});
  assert.strictEqual(out, schedule);
  assert.deepStrictEqual(divisionMeetingCounts, {});
});

// ── fetchActualMatchups + mergeActuals ──────────────────────────────



test('mergeActuals: a real result overwrites the plan for that week only', () => {
  const schedule = [
    { week: 1, matchups: [['A', 'B'], ['C', 'D']], bye: null, source: 'planned' },
    { week: 2, matchups: [['A', 'C'], ['B', 'D']], bye: null, source: 'planned' },
  ];
  const merged = Schedule.mergeActuals(schedule, { 1: [['A', 'D'], ['B', 'C']] });
  assert.strictEqual(merged[0].source, 'actual');
  assert.deepStrictEqual(merged[0].matchups, [['A', 'D'], ['B', 'C']]);
  assert.strictEqual(merged[1].source, 'planned', 'a week with no actual data is untouched');
});

// ── export ──────────────────────────────────────────────────────────
test('toText renders byes and resolves display names', () => {
  const schedule = [{ week: 1, matchups: [['A', 'B']], bye: 'C', source: 'planned' }];
  const text = Schedule.toText(schedule, id => ({ A: 'Alpha', B: 'Bravo', C: 'Charlie' }[id]));
  assert.match(text, /Alpha vs Bravo/);
  assert.match(text, /Charlie — BYE/);
});

test('toCSV escapes a comma in a team name', () => {
  const schedule = [{ week: 1, matchups: [['A', 'B']], bye: null, source: 'planned' }];
  const csv = Schedule.toCSV(schedule, id => ({ A: 'Smith, Jr.', B: 'Bravo' }[id]));
  assert.ok(csv.includes('"Smith, Jr."'));
});

async function asyncTests() {
  globalThis.fetch = (url) => {
    assert.match(url, /\/matchups\/3$/);
    return Promise.resolve({
      ok: true,
      json: async () => ([
        { roster_id: 1, matchup_id: 10 }, { roster_id: 2, matchup_id: 10 },
        { roster_id: 3, matchup_id: 11 }, { roster_id: 4, matchup_id: 11 },
      ]),
    });
  };
  const pairs = await Schedule.fetchActualMatchups('lg1', 3);
  test('fetchActualMatchups groups Sleeper matchup rows by matchup_id into pairs', () => {
    assert.strictEqual(pairs.length, 2);
    assert.deepStrictEqual(pairs.map(p => p.sort()).sort(), [['1', '2'], ['3', '4']]);
  });

  globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: async () => ([{ roster_id: 1, matchup_id: 10 }]), // lone row, no partner yet
  });
  const lonely = await Schedule.fetchActualMatchups('lg1', 1);
  test('fetchActualMatchups drops any non-pair group instead of guessing a partner', () => {
    assert.deepStrictEqual(lonely, []);
  });

  globalThis.fetch = () => Promise.resolve({ ok: false });
  const failed404 = await Schedule.fetchActualMatchups('lg1', 1);
  globalThis.fetch = () => Promise.reject(new Error('network down'));
  const failedThrow = await Schedule.fetchActualMatchups('lg1', 1);
  test('fetchActualMatchups never throws on a failed response or a network error', () => {
    assert.deepStrictEqual(failed404, []);
    assert.deepStrictEqual(failedThrow, []);
  });

  globalThis.fetch = () => Promise.resolve({ ok: false });
}

asyncTests().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.log('FAIL: ' + f.name));
    process.exit(1);
  }
  console.log('PASS commish-schedule');
});
