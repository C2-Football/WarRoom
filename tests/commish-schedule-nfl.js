#!/usr/bin/env node
// Unit tests for the NFL-style division schedule engine
// (commish-schedule-nfl.js): division rotation math, the inter-division
// bipartite pairing, prior-season ranking, the full season builder against
// REAL data from The Psycho League (real division assignments, real prior-
// season final standings — fetched live from Sleeper during design), and
// the post-week-11 flex step. Two of these tests are named regressions for
// bugs a hand-verification pass against that real data actually caught
// before this suite existed — see their comments.
'use strict';

const assert = require('assert');

require('../js/shared/commish-schedule.js');
const NFL = require('../js/shared/commish-schedule-nfl.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Real fixture: The Psycho League, 2026 season, 16 teams / 4 divisions.
// Division assignments and the previous (Year V) season's final standings
// were read live from Sleeper's real API while designing this format —
// not invented numbers. wins/fpts ties (7 vs 14 in division 2; 10 vs 16 in
// division 3) exercise the fpts tiebreak deliberately.
const TEAMS = [
  { id: '1', division: '4' }, { id: '2', division: '2' }, { id: '3', division: '1' }, { id: '4', division: '4' },
  { id: '5', division: '1' }, { id: '6', division: '3' }, { id: '7', division: '2' }, { id: '8', division: '2' },
  { id: '9', division: '3' }, { id: '10', division: '3' }, { id: '11', division: '4' }, { id: '12', division: '4' },
  { id: '13', division: '1' }, { id: '14', division: '2' }, { id: '15', division: '1' }, { id: '16', division: '3' },
];
const PRIOR_ROWS = [
  { teamId: '13', division: '1', wins: 12, losses: 2, fpts: 3236 }, { teamId: '15', division: '1', wins: 9, losses: 5, fpts: 2826 },
  { teamId: '3', division: '1', wins: 6, losses: 8, fpts: 2538 }, { teamId: '5', division: '1', wins: 6, losses: 8, fpts: 2797 },
  { teamId: '7', division: '2', wins: 8, losses: 6, fpts: 2708 }, { teamId: '14', division: '2', wins: 8, losses: 6, fpts: 2742 },
  { teamId: '2', division: '2', wins: 4, losses: 10, fpts: 2381 }, { teamId: '8', division: '2', wins: 2, losses: 12, fpts: 2119 },
  { teamId: '6', division: '3', wins: 10, losses: 4, fpts: 2823 }, { teamId: '10', division: '3', wins: 7, losses: 7, fpts: 2640 },
  { teamId: '16', division: '3', wins: 7, losses: 7, fpts: 2576 }, { teamId: '9', division: '3', wins: 4, losses: 10, fpts: 2640 },
  { teamId: '12', division: '4', wins: 10, losses: 4, fpts: 2925 }, { teamId: '4', division: '4', wins: 8, losses: 6, fpts: 2944 },
  { teamId: '11', division: '4', wins: 6, losses: 8, fpts: 2191 }, { teamId: '1', division: '4', wins: 5, losses: 9, fpts: 2529 },
];

function byDivision(teams) {
  const out = {};
  teams.forEach(t => { (out[t.division] = out[t.division] || []).push(t.id); });
  return out;
}
function meetingCounts(schedule, { excludeLottery } = {}) {
  const m = {};
  schedule.forEach(wk => {
    if (excludeLottery && wk.source === 'lottery') return;
    wk.matchups.forEach(([a, b]) => { const k = [a, b].sort().join('|'); m[k] = (m[k] || 0) + 1; });
  });
  return m;
}

// ── buildDivisionRotation ─────────────────────────────────────────
test('division rotation matches the owner\'s own worked example exactly', () => {
  const ids = ['1', '2', '3', '4'];
  assert.deepStrictEqual(NFL.buildDivisionRotation(ids, 2021).pairs, [['1', '2'], ['3', '4']]);
  assert.deepStrictEqual(NFL.buildDivisionRotation(ids, 2022).pairs, [['1', '3'], ['2', '4']]);
  assert.deepStrictEqual(NFL.buildDivisionRotation(ids, 2023).pairs, [['1', '4'], ['2', '3']]);
});

test('the 3-year cycle repeats exactly (2024 = 2021, 2025 = 2022, ...)', () => {
  const ids = ['1', '2', '3', '4'];
  assert.deepStrictEqual(NFL.buildDivisionRotation(ids, 2024).pairs, NFL.buildDivisionRotation(ids, 2021).pairs);
  assert.deepStrictEqual(NFL.buildDivisionRotation(ids, 2029).pairs, NFL.buildDivisionRotation(ids, 2023).pairs);
});

test('rotation is undefined for anything other than exactly 4 divisions', () => {
  assert.strictEqual(NFL.buildDivisionRotation(['1', '2', '3'], 2026), null);
  assert.strictEqual(NFL.buildDivisionRotation(['1', '2', '3', '4', '5'], 2026), null);
});

// ── buildInterDivisionBlock ─────────────────────────────────────────
test('inter-division block is a complete 4x4 sweep, each pair exactly once', () => {
  const rounds = NFL.buildInterDivisionBlock(['a', 'b', 'c', 'd'], ['w', 'x', 'y', 'z']);
  assert.strictEqual(rounds.length, 4);
  const seen = new Set();
  rounds.forEach(r => { assert.strictEqual(r.length, 4); r.forEach(([p, q]) => seen.add(p + '|' + q)); });
  assert.strictEqual(seen.size, 16, 'all 4x4=16 cross pairs occur, each exactly once');
});

// ── rankPriorSeason ─────────────────────────────────────────────────
test('ranks by wins desc, fpts as the tiebreak — matching the real tied rows', () => {
  const r = NFL.rankPriorSeason(PRIOR_ROWS);
  assert.deepStrictEqual(r['13'], { division: '1', rank: 1 });
  // 7 and 14 both went 8-6 in division 2; 14 had more points (2742 > 2708).
  assert.deepStrictEqual(r['14'], { division: '2', rank: 1 });
  assert.deepStrictEqual(r['7'], { division: '2', rank: 2 });
  // 10 and 16 both went 7-7 in division 3; 10 had more points (2640 > 2576).
  assert.deepStrictEqual(r['10'], { division: '3', rank: 2 });
  assert.deepStrictEqual(r['16'], { division: '3', rank: 3 });
});

// ── isEligible ────────────────────────────────────────────────────
test('eligible only for exactly 4 divisions of equal size', () => {
  assert.strictEqual(NFL.isEligible(TEAMS), true);
  assert.strictEqual(NFL.isEligible(TEAMS.slice(1)), false, 'uneven division sizes');
  assert.strictEqual(NFL.isEligible(TEAMS.map(t => ({ id: t.id, division: t.division === '4' ? '3' : t.division }))), false, '3 divisions only');
});

// ── buildNFLStyleSeason — structural correctness against real data ──
const priorStandings = NFL.rankPriorSeason(PRIOR_ROWS);
const built = NFL.buildNFLStyleSeason({ teams: TEAMS, priorStandings, seasonYear: 2026 });

test('produces exactly 14 weeks, each covering all 16 teams exactly once', () => {
  assert.strictEqual(built.schedule.length, 14);
  built.schedule.forEach(wk => {
    const flat = wk.matchups.flat();
    assert.strictEqual(flat.length, 16, 'week ' + wk.week);
    assert.strictEqual(new Set(flat).size, 16, 'week ' + wk.week + ' has a duplicate or missing team');
  });
});

test('weeks 8-9 and 10-11 are balanced at 8 games each — regression for a real bug', () => {
  // The first implementation assigned each team's two non-inter-division
  // opponents independently ("my leftover division #1 -> week 8, #2 ->
  // week 9"), which is not globally consistent: two different teams could
  // each believe the SAME pairing belongs to a DIFFERENT week, and
  // de-duplicating by whichever claimed it first produced week 8 with 9
  // games and week 9 with 7. Cross-matching by position within each
  // rotation pair (not caught until a full hand run against real league
  // data) is what fixes this — see the comment at the rankMatch call site.
  [8, 9, 10, 11].forEach(w => {
    assert.strictEqual(built.schedule.find(wk => wk.week === w).matchups.length, 8, 'week ' + w);
  });
});

test('every team plays exactly 14 games', () => {
  const games = {}; TEAMS.forEach(t => { games[t.id] = 0; });
  built.schedule.forEach(wk => wk.matchups.forEach(([a, b]) => { games[a]++; games[b]++; }));
  Object.entries(games).forEach(([id, n]) => assert.strictEqual(n, 14, 'team ' + id));
});

test('every division pair meets exactly twice (excluding lottery-week coincidences)', () => {
  const m = meetingCounts(built.schedule, { excludeLottery: true });
  const byDiv = byDivision(TEAMS);
  Object.values(byDiv).forEach(ids => {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      assert.strictEqual(m[[ids[i], ids[j]].sort().join('|')], 2, ids[i] + ' vs ' + ids[j]);
    }
  });
});

test('the full-division inter-division sweep is a complete 4x4, each pair exactly once', () => {
  const m = meetingCounts(built.schedule, { excludeLottery: true });
  const byDiv = byDivision(TEAMS);
  built.meta.divisionPairing.pairs.forEach(([d1, d2]) => {
    byDiv[d1].forEach(a => byDiv[d2].forEach(b => {
      assert.strictEqual(m[[a, b].sort().join('|')], 1, a + ' vs ' + b);
    }));
  });
});

test('rank-week opponents (8-9) always share the SAME prior-season rank', () => {
  const rankOf = (id) => (priorStandings[id] || {}).rank;
  [8, 9].forEach(w => {
    const wk = built.schedule.find(x => x.week === w);
    TEAMS.forEach(t => {
      const pair = wk.matchups.find(p => p.includes(t.id));
      assert.ok(pair, t.id + ' has no week ' + w + ' opponent');
      const opp = pair[0] === t.id ? pair[1] : pair[0];
      assert.strictEqual(rankOf(opp), rankOf(t.id), t.id + ' vs ' + opp + ' at week ' + w);
    });
  });
});

test('weeks 10-11 are marked lottery; every other week is planned', () => {
  built.schedule.forEach(wk => {
    assert.strictEqual(wk.source, (wk.week === 10 || wk.week === 11) ? 'lottery' : 'planned');
  });
});

test('a true first season (no prior standings) falls back honestly, not silently', () => {
  const fresh = NFL.buildNFLStyleSeason({ teams: TEAMS, priorStandings: null, seasonYear: 2026 });
  assert.strictEqual(fresh.meta.usedFallbackStandings, true);
  assert.strictEqual(fresh.schedule.length, 14);
  fresh.schedule.forEach(wk => assert.strictEqual(new Set(wk.matchups.flat()).size, 16));
});

test('an ineligible league (not 4 equal divisions) returns null, not a broken schedule', () => {
  assert.strictEqual(NFL.buildNFLStyleSeason({ teams: TEAMS.slice(1), priorStandings, seasonYear: 2026 }), null);
});

// ── retargetPairToWeek + flexFinalWeeks ──────────────────────────────
test('retargetPairToWeek requires candidateWeeks — the ambiguity it exists to remove', () => {
  const { ok, error } = NFL.retargetPairToWeek(built.schedule, ['13', '15', '5', '3'], 14, '13', '15', null);
  assert.strictEqual(ok, false);
  assert.match(error, /candidateWeeks is required/);
});

test('retargetPairToWeek only searches the given window — regression for a real bug', () => {
  // Division-mates play each other TWICE (weeks 1-3 AND 12-14), so an
  // unscoped search for "the week A plays B" is genuinely ambiguous: the
  // pair occurs once in EACH block. The first implementation searched the
  // whole schedule and silently grabbed the already-played block-A
  // occurrence, then swapped it with the still-open week 14 slot —
  // corrupting a week that had already happened. Restricting the search
  // to [12,13,14] is what a live hand-run against real data caught.
  const before1to11 = built.schedule.filter(wk => wk.week <= 11).map(wk => JSON.stringify(wk.matchups));
  const { schedule: next, ok } = NFL.retargetPairToWeek(built.schedule, ['13', '15', '5', '3'], 14, '13', '15', [12, 13, 14]);
  assert.strictEqual(ok, true);
  const after1to11 = next.filter(wk => wk.week <= 11).map(wk => JSON.stringify(wk.matchups));
  assert.deepStrictEqual(after1to11, before1to11, 'weeks 1-11 must never change from a flex operation');
});

test('retargetPairToWeek swaps the WHOLE matching, not just one of its two pairs', () => {
  // A week where a 4-team division plays itself holds TWO pairs (a
  // complete matching), not one. Swapping only the first pair found left
  // the second pair's teams behind — one team duplicated, one dropped.
  // Caught by a live hand-run: week 13 came back with team 9 appearing in
  // two different pairs and team 10 missing entirely.
  const teams4 = ['6', '9', '10', '16']; // division 3
  const target = NFL.retargetPairToWeek(built.schedule, teams4, 14, '6', '10', [12, 13, 14]);
  assert.strictEqual(target.ok, true);
  [12, 13, 14].forEach(w => {
    const wk = target.schedule.find(x => x.week === w);
    const flat = wk.matchups.flat();
    assert.strictEqual(new Set(flat).size, flat.length, 'week ' + w + ' has a duplicated team after the swap');
  });
  const wk14 = target.schedule.find(x => x.week === 14);
  assert.ok(wk14.matchups.some(([a, b]) => (a === '6' && b === '10') || (a === '10' && b === '6')));
});

test('retargeting to the week the pair is already on is a no-op', () => {
  // Division 1 and 2's target pairs already land on week 14 in this
  // particular built season, by construction coincidence — exercise it.
  const r = NFL.retargetPairToWeek(built.schedule, ['3', '5', '13', '15'], 3, '13', '3', [1, 2, 3]);
  assert.strictEqual(r.ok, true);
});

test('a pair outside the given window is reported, not guessed at', () => {
  const { ok, error } = NFL.retargetPairToWeek(built.schedule, ['13', '15', '5', '3'], 14, '13', '15', [1, 2, 3]);
  // 13 vs 15's block-B (weeks 12-14) occurrence is outside [1,2,3] as a
  // TARGET, but its block-A occurrence IS inside [1,2,3] as a SOURCE — so
  // this should actually succeed (source found within the window, target
  // week 14 is what's rejected as outside the window).
  assert.strictEqual(ok, false);
  assert.match(error, /outside candidateWeeks/);
});

test('flexFinalWeeks retargets every division\'s current #1-vs-#2 onto week 14', () => {
  // Deliberately picks CURRENT standings that contradict last season's —
  // proves the flex reads live results, not prior-season rank again.
  const currentStandings = {
    '13': { wins: 5, losses: 6, fpts: 900 }, '15': { wins: 4, losses: 7, fpts: 850 },
    '3': { wins: 9, losses: 2, fpts: 1400 }, '5': { wins: 8, losses: 3, fpts: 1300 },
    '7': { wins: 6, losses: 5, fpts: 1000 }, '14': { wins: 5, losses: 6, fpts: 950 },
    '2': { wins: 7, losses: 4, fpts: 1100 }, '8': { wins: 3, losses: 8, fpts: 800 },
    '6': { wins: 7, losses: 4, fpts: 1050 }, '10': { wins: 6, losses: 5, fpts: 1000 },
    '16': { wins: 5, losses: 6, fpts: 950 }, '9': { wins: 5, losses: 6, fpts: 900 },
    '12': { wins: 8, losses: 3, fpts: 1200 }, '4': { wins: 7, losses: 4, fpts: 1150 },
    '11': { wins: 5, losses: 6, fpts: 950 }, '1': { wins: 3, losses: 8, fpts: 800 },
  };
  const { schedule: flexed, notes } = NFL.flexFinalWeeks({ schedule: built.schedule, teams: TEAMS, currentStandings });
  assert.ok(notes.every(n => n.ok), JSON.stringify(notes));
  const wk14 = flexed.find(w => w.week === 14);
  [['3', '5'], ['2', '7'], ['6', '10'], ['12', '4']].forEach(([a, b]) => {
    assert.ok(wk14.matchups.some(p => p.includes(a) && p.includes(b)), a + ' vs ' + b + ' on week 14');
  });
  // Nobody vanished, nobody duplicated, and games 1-11 are untouched.
  flexed.forEach(wk => assert.strictEqual(new Set(wk.matchups.flat()).size, 16, 'week ' + wk.week));
  for (let w = 1; w <= 11; w++) {
    assert.deepStrictEqual(flexed.find(x => x.week === w).matchups, built.schedule.find(x => x.week === w).matchups);
  }
  // Meeting counts are unchanged by flexing — it only reorders WHICH week,
  // never WHO plays whom.
  assert.deepStrictEqual(meetingCounts(flexed, { excludeLottery: true }), meetingCounts(built.schedule, { excludeLottery: true }));
});

test('flexFinalWeeks reports, rather than silently fabricates, a division missing standings data', () => {
  // ids.slice().sort() always returns all input ids even when none of them
  // have real data — Number(undefined)-Number(undefined) is NaN, which a
  // sort comparator treats as "no preference," not an error — so an empty
  // currentStandings used to produce a plausible-looking #1/#2 (arbitrary
  // input order) instead of failing. Caught by this exact assertion.
  const { notes } = NFL.flexFinalWeeks({ schedule: built.schedule, teams: TEAMS, currentStandings: {} });
  assert.strictEqual(notes.length, 4);
  notes.forEach(n => {
    assert.strictEqual(n.ok, false);
    assert.match(n.reason, /no current-season standings data/);
  });
});

test('flexFinalWeeks flexes divisions WITH data even when others have none', () => {
  const partial = {
    '13': { wins: 5, losses: 6, fpts: 900 }, '15': { wins: 4, losses: 7, fpts: 850 },
    '3': { wins: 9, losses: 2, fpts: 1400 }, '5': { wins: 8, losses: 3, fpts: 1300 },
  }; // division 1 only
  const { notes } = NFL.flexFinalWeeks({ schedule: built.schedule, teams: TEAMS, currentStandings: partial });
  const d1 = notes.find(n => n.division === '1');
  assert.strictEqual(d1.ok, true);
  notes.filter(n => n.division !== '1').forEach(n => assert.strictEqual(n.ok, false));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.log('FAIL: ' + f.name));
  process.exit(1);
}
console.log('PASS commish-schedule-nfl');
