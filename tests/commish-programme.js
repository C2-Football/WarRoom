#!/usr/bin/env node
// Unit tests for the Matchday Programme composer (App.Commish.Programme).
// Pure compute only — scores and ledgers are hand-built fixtures in the
// luck-engine shapes; no network, no AlexVoice (the plain-template fallback
// path is what runs under Node, and it must be deterministic).
'use strict';

const assert = require('assert');

// Belt-and-braces: nothing here fetches, but a unit test must never touch
// the network even if a future edit adds a helper.
globalThis.fetch = () => Promise.resolve({ ok: false });

const Luck = require('../js/shared/luck-engine.js');
const Programme = require('../js/shared/commish-programme.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Fixture: 4 teams, 3 weeks, hand-checkable ───────────────────────
// Matchups (1v2), (3v4). Week 3 is the "latest": 1 beats 2 by 45 (blowout),
// 4 beats 3 by 2.5 (nail-biter). Team 1 posts the week's top score (140).
const league = {
  league_id: 'L1',
  name: 'Alpha League',
  rosters: [1, 2, 3, 4].map(id => ({ roster_id: id, owner_id: 'u' + id })),
  users: [1, 2, 3, 4].map(id => ({ user_id: 'u' + id, display_name: 'Team ' + id })),
};
const weeklyScores = {
  1: [{ rosterId: 1, points: 130, matchupId: 'a' }, { rosterId: 2, points: 100, matchupId: 'a' },
      { rosterId: 3, points: 120, matchupId: 'b' }, { rosterId: 4, points: 90, matchupId: 'b' }],
  2: [{ rosterId: 1, points: 80, matchupId: 'a' }, { rosterId: 2, points: 110, matchupId: 'a' },
      { rosterId: 3, points: 125, matchupId: 'b' }, { rosterId: 4, points: 85, matchupId: 'b' }],
  3: [{ rosterId: 1, points: 140, matchupId: 'a' }, { rosterId: 2, points: 95, matchupId: 'a' },
      { rosterId: 3, points: 97.5, matchupId: 'b' }, { rosterId: 4, points: 100, matchupId: 'b' }],
};
const ledger = Luck.buildLedger({ league, weeklyScores });

test('programme: composes from the latest counted week', () => {
  const p = Programme.buildProgramme({ league, ledger, weeklyScores });
  assert.strictEqual(p.empty, false);
  assert.strictEqual(p.week, 3, 'W = max(ledger.weeks)');
  assert.strictEqual(p.leagueName, 'Alpha League');
});

test('programme: pairing is correct — winners, losers, margins', () => {
  const p = Programme.buildProgramme({ league, ledger, weeklyScores });
  assert.strictEqual(p.results.length, 2, 'two matchups');
  const m1 = p.results.find(r => r.winnerName === 'Team 1');
  assert.ok(m1, 'team 1 won its game');
  assert.strictEqual(m1.loserName, 'Team 2');
  assert.strictEqual(m1.wPts, 140);
  assert.strictEqual(m1.lPts, 95);
  assert.strictEqual(m1.margin, 45);
  const m2 = p.results.find(r => r.winnerName === 'Team 4');
  assert.ok(m2, 'team 4 won the close one');
  assert.strictEqual(m2.loserName, 'Team 3');
  assert.strictEqual(m2.margin, 2.5);
  assert.strictEqual(m2.tie, false);
});

test('programme: nail-biter (margin < 6) outranks the blowout as headline', () => {
  const p = Programme.buildProgramme({ league, ledger, weeklyScores });
  assert.ok(p.headline.includes('Team 4'), 'headline names the close-game winner: ' + p.headline);
  assert.ok(p.headline.includes('Team 3'), 'headline names the close-game loser');
  assert.ok(p.headline.includes('2.5'), 'headline carries the real margin');
});

test('programme: with no close game, the biggest blowout is the headline', () => {
  const ws = {
    ...weeklyScores,
    3: [{ rosterId: 1, points: 140, matchupId: 'a' }, { rosterId: 2, points: 95, matchupId: 'a' },
        { rosterId: 3, points: 110, matchupId: 'b' }, { rosterId: 4, points: 90, matchupId: 'b' }],
  };
  const led = Luck.buildLedger({ league, weeklyScores: ws });
  const p = Programme.buildProgramme({ league, ledger: led, weeklyScores: ws });
  // Margins are 45 and 20 — headline must name the 45-point winner, Team 1.
  assert.ok(p.headline.includes('Team 1'), 'headline names the blowout winner: ' + p.headline);
  assert.ok(p.headline.includes('45'), 'headline carries the blowout margin');
});

test('programme: top score is the week high, named via the ledger', () => {
  const p = Programme.buildProgramme({ league, ledger, weeklyScores });
  assert.strictEqual(p.topScore.name, 'Team 1');
  assert.strictEqual(p.topScore.pts, 140);
});

test('programme: no matchupIds → headline falls back to the top score', () => {
  const ws = { 1: [{ rosterId: 1, points: 120 }, { rosterId: 2, points: 100 }, { rosterId: 3, points: 90 }, { rosterId: 4, points: 80 }] };
  const led = Luck.buildLedger({ league, weeklyScores: ws });
  const p = Programme.buildProgramme({ league, ledger: led, weeklyScores: ws });
  assert.strictEqual(p.results.length, 0, 'no pairings to report');
  assert.ok(p.headline.includes('Team 1'), 'headline names the top scorer: ' + p.headline);
  assert.ok(p.headline.includes('120'), 'headline carries the score');
});

test('programme: dead-tie game is flagged and never crowns a winner', () => {
  const ws = {
    1: [{ rosterId: 1, points: 100, matchupId: 'a' }, { rosterId: 2, points: 100, matchupId: 'a' },
        { rosterId: 3, points: 130, matchupId: 'b' }, { rosterId: 4, points: 90, matchupId: 'b' }],
  };
  const led = Luck.buildLedger({ league, weeklyScores: ws });
  const p = Programme.buildProgramme({ league, ledger: led, weeklyScores: ws });
  const tied = p.results.find(r => r.margin === 0);
  assert.ok(tied && tied.tie, 'zero-margin game carries tie: true');
  // Margin 0 < 6 → the tie IS the closest-game story.
  assert.ok(/dead|tie|Split/i.test(p.headline), 'headline reads as a tie: ' + p.headline);
});

test('programme: empty state when the ledger counted no weeks', () => {
  const led = Luck.buildLedger({ league, weeklyScores: {} });
  const p = Programme.buildProgramme({ league, ledger: led, weeklyScores: {} });
  assert.strictEqual(p.empty, true);
  assert.strictEqual(p.leagueName, 'Alpha League');
  assert.strictEqual(p.reason, 'no_counted_weeks');
});

test('programme: empty state when the counted week has no score rows', () => {
  // Ledger counted week 3 but the caller passed a scores map missing it.
  const p = Programme.buildProgramme({ league, ledger, weeklyScores: { 1: weeklyScores[1] , 2: weeklyScores[2] } });
  assert.strictEqual(p.empty, true);
  assert.strictEqual(p.reason, 'no_scores');
});

test('programme: luckNote picks the robbed team (allPlayPct ≥ .5, most negative luck)', () => {
  const rows = [
    { rosterId: 1, name: 'Team 1', wins: 5, losses: 1, ties: 0, pf: 700, allPlayPct: 0.8, luck: 0.6, weekly: [] },
    { rosterId: 2, name: 'Team 2', wins: 2, losses: 4, ties: 0, pf: 650, allPlayPct: 0.65, luck: -1.9, weekly: [] },
    { rosterId: 3, name: 'Team 3', wins: 1, losses: 5, ties: 0, pf: 400, allPlayPct: 0.2, luck: -0.2, weekly: [] },
  ];
  const led = { rows, weeks: [3] };
  const p = Programme.buildProgramme({ league, ledger: led, weeklyScores });
  assert.strictEqual(p.luckNote.name, 'Team 2', 'strong-but-unlucky team wins the note');
  assert.strictEqual(p.luckNote.kind, 'robbed');
  assert.ok(p.luckNote.text.includes('Team 2'), 'note copy names the team');
});

test('programme: luckNote falls back to the most positive luck when nobody was robbed', () => {
  const rows = [
    { rosterId: 1, name: 'Team 1', wins: 5, losses: 1, ties: 0, pf: 700, allPlayPct: 0.8, luck: 1.4, weekly: [] },
    { rosterId: 2, name: 'Team 2', wins: 3, losses: 3, ties: 0, pf: 600, allPlayPct: 0.55, luck: 0.3, weekly: [] },
    { rosterId: 3, name: 'Team 3', wins: 1, losses: 5, ties: 0, pf: 400, allPlayPct: 0.2, luck: -0.4, weekly: [] },
  ];
  const p = Programme.buildProgramme({ league, ledger: { rows, weeks: [3] }, weeklyScores });
  assert.strictEqual(p.luckNote.name, 'Team 1');
  assert.strictEqual(p.luckNote.kind, 'charmed');
});

test('programme: flat luck across the board → no luckNote (honest empty)', () => {
  const rows = [
    { rosterId: 1, name: 'Team 1', wins: 2, losses: 1, ties: 0, pf: 350, allPlayPct: 0.6, luck: 0, weekly: [] },
    { rosterId: 2, name: 'Team 2', wins: 1, losses: 2, ties: 0, pf: 300, allPlayPct: 0.4, luck: 0, weekly: [] },
  ];
  const p = Programme.buildProgramme({ league, ledger: { rows, weeks: [3] }, weeklyScores });
  assert.strictEqual(p.luckNote, null);
});

test('programme: standingsTop3 follows ledger order', () => {
  const p = Programme.buildProgramme({ league, ledger, weeklyScores });
  assert.strictEqual(p.standingsTop3.length, 3);
  assert.deepStrictEqual(p.standingsTop3.map(s => s.rosterId), ledger.rows.slice(0, 3).map(r => r.rosterId));
  assert.ok(p.standingsTop3[0].name, 'standings rows carry names');
});

test('programme: an explicitly pinned COUNTED week is honored; uncounted is not', () => {
  const p2 = Programme.buildProgramme({ league, ledger, weeklyScores, week: 2 });
  assert.strictEqual(p2.week, 2, 'rewind to a counted week');
  assert.strictEqual(p2.topScore.name, 'Team 3', 'week-2 high was Team 3 at 125');
  const p9 = Programme.buildProgramme({ league, ledger, weeklyScores, week: 9 });
  assert.strictEqual(p9.week, 3, 'uncounted week falls back to the latest');
});

test('programme: deterministic — identical inputs compose identical pages', () => {
  const a = Programme.buildProgramme({ league, ledger, weeklyScores, nowMs: 1000 });
  const b = Programme.buildProgramme({ league, ledger, weeklyScores, nowMs: 1000 });
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.generatedAtMs, 1000, 'nowMs is passed through, never Date.now()');
});

test('buildAll: one programme per league, input order, per-league honesty', () => {
  const league2 = { ...league, league_id: 'L2', name: 'Beta League' };
  const league3 = { ...league, league_id: 'L3', name: 'Ghost League' };
  const out = Programme.buildAll({
    leagues: [league, league2, league3],
    ledgers: { L1: ledger, L2: Luck.buildLedger({ league: league2, weeklyScores: {} }) },
    weeklyScoresByLeague: { L1: weeklyScores, L2: {} },
    nowMs: 5,
  });
  assert.strictEqual(out.length, 3, 'batch length matches leagues');
  assert.strictEqual(out[0].empty, false);
  assert.strictEqual(out[0].leagueName, 'Alpha League');
  assert.strictEqual(out[1].empty, true, 'no counted weeks → honest empty');
  assert.strictEqual(out[1].reason, 'no_counted_weeks');
  assert.strictEqual(out[2].empty, true, 'no ledger at all → honest empty');
  assert.strictEqual(out[2].reason, 'no_ledger');
  assert.strictEqual(out[2].leagueName, 'Ghost League');
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.log('FAIL ' + f.name + ': ' + (f.e && f.e.stack)));
  process.exit(1);
}
console.log('PASS commish-programme');
