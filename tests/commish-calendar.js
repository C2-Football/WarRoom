#!/usr/bin/env node
// Unit tests for the Commissioner calendar engine: week→date math, cross-
// league event calendar, draft-overlap radar (with member-graph shared
// humans + shift solver), and deadline clustering. Pure-compute paths plus
// a stubbed loadDrafts — no network ever.
'use strict';

const assert = require('assert');

// Stub fetch defensively; nothing here should touch the network.
globalThis.fetch = () => Promise.resolve({ ok: false });

const Commish = require('../js/shared/commish-engine.js');
const Cal = require('../js/shared/commish-calendar.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const DAY = 86400000;
const H = 3600000;
const SEASON = '2026-09-10';
const SEASON_MS = Date.parse(SEASON);
const NOW = Date.parse('2026-08-01T00:00:00Z');
const AUG20 = Date.parse('2026-08-20T23:00:00Z'); // 7pm-ish US evening

// ── weekToDate ──────────────────────────────────────────────────────
test('weekToDate: week 1 lands on the season start itself', () => {
  assert.strictEqual(Cal.weekToDate(1, SEASON), SEASON_MS);
});

test('weekToDate: week N advances (N−1) × 7 days', () => {
  assert.strictEqual(Cal.weekToDate(5, SEASON), SEASON_MS + 4 * 7 * DAY);
  assert.strictEqual(Cal.weekToDate(12, SEASON), SEASON_MS + 11 * 7 * DAY);
});

test('weekToDate: bad week or unparsable start date → null, never a fake date', () => {
  assert.strictEqual(Cal.weekToDate(0, SEASON), null);
  assert.strictEqual(Cal.weekToDate('x', SEASON), null);
  assert.strictEqual(Cal.weekToDate(3, null), null);
  assert.strictEqual(Cal.weekToDate(3, 'not-a-date'), null);
});

// ── buildCalendar ───────────────────────────────────────────────────
const leagues = [
  { league_id: 'L1', name: 'Alpha', settings: { trade_deadline: 10, playoff_week_start: 15 } },
  { league_id: 'L2', name: 'Bravo', settings: { trade_deadline: 10 } },
  { league_id: 'L3', name: 'Charlie', settings: { trade_deadline: 0 } }, // 0 = no deadline
];
const draftsByLeague = {
  L1: [{ leagueId: 'L1', draftId: '100', status: 'pre_draft', startTime: AUG20 }],
  L2: [{ leagueId: 'L2', draftId: '200', status: 'pre_draft', startTime: AUG20 + 2 * H }],
  L3: [{ leagueId: 'L3', draftId: '300', status: 'pre_draft', startTime: null }],
};

test('calendar: emits drafts + deadlines + playoffs with correct shapes', () => {
  const events = Cal.buildCalendar({ leagues, draftsByLeague, seasonStartDate: SEASON, nowMs: NOW });
  const types = events.map(e => e.type).sort();
  assert.deepStrictEqual(types, ['deadline', 'deadline', 'draft', 'draft', 'draft', 'playoffs']);
  const d1 = events.find(e => e.type === 'draft' && e.leagueId === 'L1');
  assert.strictEqual(d1.ts, AUG20);
  assert.strictEqual(d1.approximate, false);
  assert.strictEqual(d1.week, null);
  const dl = events.find(e => e.type === 'deadline' && e.leagueId === 'L1');
  assert.strictEqual(dl.ts, Cal.weekToDate(10, SEASON));
  assert.strictEqual(dl.approximate, true);
  assert.strictEqual(dl.week, 10);
  assert.ok(dl.label.includes('Alpha') && dl.label.includes('Week 10'));
  // trade_deadline 0 must not fabricate an event
  assert.ok(!events.some(e => e.type === 'deadline' && e.leagueId === 'L3'));
});

test('calendar: sorted by ts, null-ts (TBD draft) sinks last', () => {
  const events = Cal.buildCalendar({ leagues, draftsByLeague, seasonStartDate: SEASON, nowMs: NOW });
  const ts = events.map(e => e.ts);
  const dated = ts.filter(t => t != null);
  for (let i = 1; i < dated.length; i++) assert.ok(dated[i] >= dated[i - 1], 'dated events ascending');
  assert.strictEqual(ts[ts.length - 1], null, 'TBD draft last');
  assert.strictEqual(events[events.length - 1].leagueId, 'L3');
});

test('calendar: no seasonStartDate → week events keep ts=null instead of guessing', () => {
  const events = Cal.buildCalendar({ leagues, draftsByLeague, seasonStartDate: null, nowMs: NOW });
  const dl = events.find(e => e.type === 'deadline');
  assert.strictEqual(dl.ts, null);
  assert.strictEqual(dl.week, 10, 'week number survives so the UI can still say "Week 10"');
});

// ── findConflicts: draft overlap radar ──────────────────────────────
// Synthetic member graph via the real buildMemberGraph: u9 = me (both
// leagues), u1 = Dax in BOTH L1+L2, u2 = Solo only in L1.
const graph = Commish.buildMemberGraph({
  myUserId: 'u9',
  leagues: [
    {
      league_id: 'L1', name: 'Alpha',
      users: [{ user_id: 'u9', display_name: 'Me' }, { user_id: 'u1', display_name: 'Dax' }, { user_id: 'u2', display_name: 'Solo' }],
      rosters: [{ roster_id: 1, owner_id: 'u9' }, { roster_id: 2, owner_id: 'u1' }, { roster_id: 3, owner_id: 'u2' }],
    },
    {
      league_id: 'L2', name: 'Bravo',
      users: [{ user_id: 'u9', display_name: 'Me' }, { user_id: 'u1', display_name: 'Dax' }],
      rosters: [{ roster_id: 1, owner_id: 'u9' }, { roster_id: 2, owner_id: 'u1' }],
    },
  ],
});

function draftEvent(lid, name, ts, draftId) {
  return { type: 'draft', leagueId: lid, leagueName: name, ts, week: null, approximate: false, draftId, status: 'pre_draft', label: name + ' draft' };
}

test('conflicts: two drafts 2h apart → draft_overlap', () => {
  const events = [draftEvent('L1', 'Alpha', AUG20, '100'), draftEvent('L2', 'Bravo', AUG20 + 2 * H, '200')];
  const out = Cal.findConflicts({ events, graph, nowMs: NOW });
  const ov = out.filter(c => c.kind === 'draft_overlap');
  assert.strictEqual(ov.length, 1);
  assert.strictEqual(ov[0].a.leagueId, 'L1', 'a = earlier draft');
  assert.strictEqual(ov[0].b.leagueId, 'L2');
});

test('conflicts: drafts 4h apart → no overlap', () => {
  const events = [draftEvent('L1', 'Alpha', AUG20, '100'), draftEvent('L2', 'Bravo', AUG20 + 4 * H, '200')];
  const out = Cal.findConflicts({ events, graph, nowMs: NOW });
  assert.strictEqual(out.filter(c => c.kind === 'draft_overlap').length, 0);
});

test('conflicts: sharedHumans = humans in BOTH leagues, excluding me and single-league members', () => {
  const events = [draftEvent('L1', 'Alpha', AUG20, '100'), draftEvent('L2', 'Bravo', AUG20 + 1 * H, '200')];
  const [ov] = Cal.findConflicts({ events, graph, nowMs: NOW });
  assert.deepStrictEqual(ov.sharedHumans, ['Dax']);
});

test('conflicts: suggestion targets the later-created draft (bigger snowflake id)', () => {
  // Bravo's draftId 200 > 100 → Bravo booked second, Bravo moves — even
  // though it starts EARLIER, creation order (not start order) picks the mover.
  const events = [draftEvent('L1', 'Alpha', AUG20 + 1 * H, '100'), draftEvent('L2', 'Bravo', AUG20, '200')];
  const [ov] = Cal.findConflicts({ events, graph, nowMs: NOW });
  assert.ok(ov.suggestion.includes('Bravo'), 'mover named: ' + ov.suggestion);
  assert.ok(!ov.suggestion.startsWith('Alpha'), 'keeper not proposed as mover');
});

test('conflicts: solver skips a +1-day slot already holding a draft, goes −1 day', () => {
  const events = [
    draftEvent('L1', 'Alpha', AUG20, '100'),
    draftEvent('L2', 'Bravo', AUG20 + 1 * H, '200'),         // mover (created later)
    draftEvent('L4', 'Delta', AUG20 + 1 * H + DAY, '50'),    // occupies Bravo's +1-day slot exactly
  ];
  const [ov] = Cal.findConflicts({ events, graph, nowMs: NOW });
  assert.ok(ov.suggestion.includes('a day earlier'), 'fell back to −1 day: ' + ov.suggestion);
});

test('conflicts: past overlaps are ignored (radar looks forward from nowMs)', () => {
  const past = NOW - 10 * DAY;
  const events = [draftEvent('L1', 'Alpha', past, '100'), draftEvent('L2', 'Bravo', past + 1 * H, '200')];
  const out = Cal.findConflicts({ events, graph, nowMs: NOW });
  assert.strictEqual(out.filter(c => c.kind === 'draft_overlap').length, 0);
});

test('conflicts: completed drafts and TBD (ts=null) drafts never conflict', () => {
  const events = [
    { ...draftEvent('L1', 'Alpha', AUG20, '100'), status: 'complete' },
    draftEvent('L2', 'Bravo', AUG20 + 1 * H, '200'),
    draftEvent('L3', 'Charlie', null, '300'),
  ];
  const out = Cal.findConflicts({ events, graph, nowMs: NOW });
  assert.strictEqual(out.filter(c => c.kind === 'draft_overlap').length, 0);
});

// ── findConflicts: deadline clustering ──────────────────────────────
test('conflicts: 2+ deadlines in the same NFL week cluster; lone deadline does not', () => {
  const events = Cal.buildCalendar({
    leagues: [
      { league_id: 'L1', name: 'Alpha', settings: { trade_deadline: 10 } },
      { league_id: 'L2', name: 'Bravo', settings: { trade_deadline: 10 } },
      { league_id: 'L3', name: 'Charlie', settings: { trade_deadline: 12 } },
    ],
    draftsByLeague: {}, seasonStartDate: SEASON, nowMs: NOW,
  });
  const clusters = Cal.findConflicts({ events, graph, nowMs: NOW }).filter(c => c.kind === 'deadline_cluster');
  assert.strictEqual(clusters.length, 1, 'only week 10 clusters');
  assert.strictEqual(clusters[0].week, 10);
  assert.deepStrictEqual(clusters[0].leagues.slice().sort(), ['Alpha', 'Bravo']);
  assert.ok(clusters[0].note.includes('Alpha') && clusters[0].note.includes('Bravo') && clusters[0].note.includes('10'));
});

// ── loadDrafts (stubbed fetcher) ────────────────────────────────────
async function asyncTests() {
  globalThis.fetchDrafts = async (lid) => {
    if (lid === 'L2') throw new Error('boom');
    return [{ draft_id: 987654321, status: 'pre_draft', start_time: AUG20 }, { draft_id: 111, status: 'complete', start_time: null }];
  };
  const map = await Cal.loadDrafts([
    { league_id: 'L1', name: 'Alpha' },
    { league_id: 'L2', name: 'Bravo' },
    { league_id: 'mfl_77', name: 'MFL' },
  ]);
  test('loadDrafts: maps Sleeper fields, failure → [], MFL skipped', () => {
    assert.deepStrictEqual(map.L1, [
      { leagueId: 'L1', draftId: '987654321', status: 'pre_draft', startTime: AUG20 },
      { leagueId: 'L1', draftId: '111', status: 'complete', startTime: null },
    ]);
    assert.deepStrictEqual(map.L2, [], 'fetch failure yields empty list, not a crash');
    assert.ok(!('mfl_77' in map), 'MFL leagues stay out of the Sleeper calendar');
  });
  delete globalThis.fetchDrafts;
}

asyncTests().then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.log('FAIL: ' + f.name));
    process.exit(1);
  }
  console.log('PASS commish-calendar');
});
