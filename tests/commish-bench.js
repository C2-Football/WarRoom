#!/usr/bin/env node
// Unit tests for the Bench + Day One Folder engine (App.Commish.Bench):
// seat-candidate ranking, the prospectus sell sheet (including the honest
// no-values degrade), and the day-one folder sections. Pure compute — no
// network. The member graph fixture is built through the REAL
// buildMemberGraph so the input shape can never drift from the foundation.
'use strict';

const assert = require('assert');

// Stub fetch before any require — none of these modules should ever touch
// the network from a unit test, and this makes an accidental fetch fail loud.
globalThis.fetch = () => Promise.resolve({ ok: false });

const Commish = require('../js/shared/commish-engine.js');
const Bench = require('../js/shared/commish-bench.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Fixtures ────────────────────────────────────────────────────────
// Three commissioned leagues. L1 has the open seat (roster 4, no owner).
// u2 is in L1+L2, u4 in L2+L3 (multi-league citizen NOT in L1), u5 and u6
// single-league. Records: u4 winning in L2, u6 winning in L3, u5 losing.
function roster(id, ownerId, w, l, players) {
  return { roster_id: id, owner_id: ownerId, settings: { wins: w, losses: l, ties: 0, fpts: 1000 }, players: players || [] };
}
function user(id, isOwner) { return { user_id: id, display_name: 'User ' + id, is_owner: !!isOwner }; }

const leagues = [
  {
    league_id: 'L1', name: 'Alpha League', total_rosters: 4,
    scoring_settings: { rec: 1 },
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN'],
    settings: { waiver_day_of_week: 2, trade_deadline: 11 },
    users: [user('me', true), user('u2'), user('u3')],
    rosters: [
      roster(1, 'me', 5, 3),
      roster(2, 'u2', 4, 4),
      roster(3, 'u3', 3, 5),
      roster(4, null, 2, 6, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']),   // the open seat
    ],
  },
  {
    league_id: 'L2', name: 'Beta League',
    users: [user('me', true), user('u2'), user('u4'), user('u5')],
    rosters: [roster(1, 'me', 4, 4), roster(2, 'u2', 4, 4), roster(3, 'u4', 7, 1), roster(4, 'u5', 1, 7)],
  },
  {
    league_id: 'L3', name: 'Gamma League',
    users: [user('me', true), user('u4'), user('u6')],
    rosters: [roster(1, 'me', 2, 6), roster(2, 'u4', 5, 3), roster(3, 'u6', 6, 2)],
  },
];

const graph = Commish.buildMemberGraph({ leagues, myUserId: 'me' });
const seat = graph.seats.find(s => s.leagueId === 'L1');

const playersData = {
  p1: { full_name: 'Ace Quarter', position: 'QB' },
  p2: { first_name: 'Bo', last_name: 'Runner', position: 'RB' },
  p3: { full_name: 'Cal Runner', position: 'RB' },
  p4: { full_name: 'Dex Wideout', position: 'WR' },
  p5: { full_name: 'Eli Wideout', position: 'WR' },
  p6: { full_name: 'Fig Tightend', position: 'TE' },
  p7: { full_name: 'Gus Wideout', position: 'WR' },
};
const values = { p1: 9000, p2: 7000, p3: 3000, p4: 6500, p5: 1200, p6: 800, p7: 400 };

// ── candidatesForSeat ───────────────────────────────────────────────
test('bench: fixture sanity — open seat found, u4 spans two leagues', () => {
  assert.ok(seat, 'L1 open seat exists');
  assert.strictEqual(seat.rosterId, 4);
  assert.strictEqual(graph.people.u4.leagueCount, 2);
});

test('bench: candidates exclude the seat league members and me', () => {
  const c = Bench.candidatesForSeat({ graph, radar: {}, seat });
  const ids = c.map(x => x.userId);
  assert.ok(!ids.includes('me'), 'never recruit myself');
  assert.ok(!ids.includes('u2'), 'u2 already in L1');
  assert.ok(!ids.includes('u3'), 'u3 already in L1');
  assert.deepStrictEqual(ids.slice().sort(), ['u4', 'u5', 'u6'], 'everyone outside L1 is fair game');
});

test('bench: transparent scoring — every point has a stated reason', () => {
  const radar = { u4: 'ACTIVE', u5: 'FADING', u6: 'DARK_60' };
  const c = Bench.candidatesForSeat({ graph, radar, seat });
  const u4 = c.find(x => x.userId === 'u4');
  // ACTIVE +3, 2 leagues +1, winning record +1 = 5
  assert.strictEqual(u4.score, 5, 'u4 score');
  assert.strictEqual(u4.radarClass, 'ACTIVE');
  assert.ok(u4.reasons.some(r => r.includes('+3')), 'radar reason present');
  assert.ok(u4.reasons.some(r => r.includes('2 of your leagues')), 'multi-league reason present');
  assert.ok(u4.reasons.some(r => r.includes('7-1')), 'winning-record reason names the record');
  const u5 = c.find(x => x.userId === 'u5');
  assert.strictEqual(u5.score, 1, 'FADING +1 only (losing record, one league)');
  const u6 = c.find(x => x.userId === 'u6');
  assert.strictEqual(u6.score, 1, 'DARK gives 0; winning record +1');
  assert.ok(u6.reasons.some(r => r.includes('+0')), 'a dark radar still states itself');
});

test('bench: ranking order is score desc, name asc on ties; limit respected', () => {
  const radar = { u4: 'ACTIVE', u5: 'FADING', u6: 'DARK_60' };
  const c = Bench.candidatesForSeat({ graph, radar, seat });
  assert.deepStrictEqual(c.map(x => x.userId), ['u4', 'u5', 'u6'], 'u5/u6 tie at 1 → name order');
  const one = Bench.candidatesForSeat({ graph, radar, seat, limit: 1 });
  assert.strictEqual(one.length, 1);
  assert.strictEqual(one[0].userId, 'u4');
});

test('bench: multi-league bonus caps at +2', () => {
  // Hand-built graph person in 5 leagues, all losing records, no radar.
  const g = {
    people: {
      u9: {
        userId: 'u9', name: 'User 9', leagueCount: 5,
        leagueIds: ['A', 'B', 'C', 'D', 'E'],
        teams: [{ leagueId: 'A', leagueName: 'A', record: { w: 1, l: 8, t: 0 } }],
        isMe: false,
      },
    },
  };
  const c = Bench.candidatesForSeat({ graph: g, seat: { leagueId: 'Z', rosterId: 1 } });
  assert.strictEqual(c[0].score, 2, '5 leagues → capped +2, nothing else');
});

test('bench: no radar at all → radarClass null, score still computed', () => {
  const c = Bench.candidatesForSeat({ graph, seat });
  const u4 = c.find(x => x.userId === 'u4');
  assert.strictEqual(u4.radarClass, null);
  assert.strictEqual(u4.score, 2, 'multi-league +1 and winning +1 survive without radar');
});

test('bench: radar accepted as object-rows and as rows array', () => {
  const asObjects = { u4: { class: 'ACTIVE' } };
  const asArray = [{ userId: 'u4', class: 'ACTIVE' }];
  for (const radar of [asObjects, asArray]) {
    const u4 = Bench.candidatesForSeat({ graph, radar, seat }).find(x => x.userId === 'u4');
    assert.strictEqual(u4.radarClass, 'ACTIVE');
    assert.strictEqual(u4.score, 5);
  }
});

// ── buildProspectus ─────────────────────────────────────────────────
test('prospectus: with values → top-5 assets sorted desc, real facts', () => {
  const p = Bench.buildProspectus({ seat, league: leagues[0], graph, playersData, values });
  assert.strictEqual(p.leagueName, 'Alpha League');
  assert.strictEqual(p.recordLine, '2-6');
  assert.strictEqual(p.rosterSize, 7);
  assert.strictEqual(p.topAssets.length, 5, 'top 5 only');
  assert.deepStrictEqual(p.topAssets.map(a => a.pid), ['p1', 'p2', 'p4', 'p3', 'p5'], 'sorted by value desc');
  assert.strictEqual(p.topAssets[0].name, 'Ace Quarter');
  assert.strictEqual(p.topAssets[0].pos, 'QB');
  assert.deepStrictEqual(p.positionCounts, { QB: 1, RB: 2, WR: 3, TE: 1 });
  assert.ok(p.pitch.includes('Ace Quarter'), 'pitch leads with the strongest concrete fact (top asset)');
});

test('prospectus: no values → NO rankings, counts only, honest pitch', () => {
  const p = Bench.buildProspectus({ seat, league: leagues[0], graph, playersData });
  assert.deepStrictEqual(p.topAssets, [], 'no values map → no invented rankings');
  assert.deepStrictEqual(p.positionCounts, { QB: 1, RB: 2, WR: 3, TE: 1 }, 'position counts still real');
  assert.ok(typeof p.pitch === 'string' && p.pitch.length > 0, 'pitch exists');
  assert.ok(!p.pitch.includes('Ace Quarter'), 'pitch cannot name assets it was never given values for');
  assert.ok(p.pitch.includes('7'), 'pitch falls back to roster depth — a fact we do have');
});

test('prospectus: deterministic — same seat, same pitch every time', () => {
  const a = Bench.buildProspectus({ seat, league: leagues[0], graph, playersData, values });
  const b = Bench.buildProspectus({ seat, league: leagues[0], graph, playersData, values });
  assert.strictEqual(a.pitch, b.pitch);
  const sentences = a.pitch.split(/[.!?]['’]?(?:\s|$)/).filter(s => s.trim());
  assert.ok(sentences.length >= 2 && sentences.length <= 3, '2-3 sentences, got ' + sentences.length);
});

test('prospectus: missing roster degrades honestly, never throws', () => {
  const p = Bench.buildProspectus({ seat: { leagueId: 'L1', rosterId: 99 }, league: leagues[0], graph, playersData, values });
  assert.strictEqual(p.rosterSize, 0);
  assert.deepStrictEqual(p.topAssets, []);
  assert.strictEqual(p.recordLine, 'no record on file');
  assert.ok(p.pitch.length > 0, 'still produces a pitch');
});

// ── buildDayOneFolder ───────────────────────────────────────────────
test('folder: five sections, every title and body a non-empty string', () => {
  const f = Bench.buildDayOneFolder({ league: leagues[0], seat, recruitName: 'Sam', graph, playersData, values });
  assert.strictEqual(f.sections.length, 5);
  assert.deepStrictEqual(f.sections.map(s => s.title),
    ['Welcome', 'Your Roster', 'Your Rivals', 'First 90 Days', 'House Rules']);
  for (const s of f.sections) {
    assert.ok(typeof s.title === 'string' && s.title.length > 0, 'title non-empty');
    assert.ok(typeof s.body === 'string' && s.body.length > 0, s.title + ' body non-empty');
  }
});

test('folder: welcome detects full PPR + superflex + league size', () => {
  const f = Bench.buildDayOneFolder({ league: leagues[0], seat, graph, playersData, values });
  const w = f.sections[0].body;
  assert.ok(w.includes('Alpha League'));
  assert.ok(w.includes('4-team'));
  assert.ok(w.includes('full-PPR'), 'rec:1 → full-PPR');
  assert.ok(w.toLowerCase().includes('superflex'), 'SUPER_FLEX slot detected');
});

test('folder: half-PPR and standard scoring lines; no superflex when absent', () => {
  const half = { ...leagues[0], scoring_settings: { rec: 0.5 }, roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'] };
  let w = Bench.buildDayOneFolder({ league: half, seat, graph, playersData }).sections[0].body;
  assert.ok(w.includes('half-PPR'), 'rec:0.5 → half-PPR');
  assert.ok(!w.toLowerCase().includes('superflex'), 'no superflex claim without the slot');
  const std = { ...leagues[0], scoring_settings: { rec: 0 } };
  w = Bench.buildDayOneFolder({ league: std, seat, graph, playersData }).sections[0].body;
  assert.ok(w.includes('standard'), 'rec:0 → standard');
});

test('folder: roster section names assets with values, counts without', () => {
  const withVals = Bench.buildDayOneFolder({ league: leagues[0], seat, graph, playersData, values });
  assert.ok(withVals.sections[1].body.includes('Ace Quarter'), 'top asset named');
  const without = Bench.buildDayOneFolder({ league: leagues[0], seat, graph, playersData });
  assert.ok(!without.sections[1].body.includes('Ace Quarter'), 'no values → no named rankings');
  assert.ok(without.sections[1].body.includes('3 WR'), 'position counts stated instead');
});

test('folder: rivals list carries records and flags multi-league citizens', () => {
  const f = Bench.buildDayOneFolder({ league: leagues[0], seat, graph, playersData, values });
  const rivals = f.sections[2].body;
  assert.ok(rivals.includes('User u2') && rivals.includes('4-4'), 'u2 with record');
  assert.ok(rivals.includes('User u3') && rivals.includes('3-5'), 'u3 with record');
  assert.ok(/User u2[^\n]*2 of the commissioner/.test(rivals), 'u2 flagged as a 2-league citizen');
  assert.ok(/User me[^\n]*\(your commissioner\)/.test(rivals), 'my own line tagged as the commissioner');
  assert.ok(!rivals.includes('User u4'), 'u4 is not in this league');
});

test('folder: first-90-days picks up waiver day (Sleeper 2=Wednesday) and deadline', () => {
  const f = Bench.buildDayOneFolder({ league: leagues[0], seat, graph, playersData, values });
  const body = f.sections[3].body;
  assert.ok(body.includes('Wednesday'), 'waiver_day_of_week 2 → Wednesday');
  assert.ok(body.includes('week 11'), 'trade_deadline surfaced');
  // Without those settings the checklist still stands on its evergreen items.
  const bare = { ...leagues[0], settings: {} };
  const b2 = Bench.buildDayOneFolder({ league: bare, seat, graph, playersData }).sections[3].body;
  assert.ok(!b2.includes('Waivers process'), 'no waiver claim without the setting');
  assert.ok(!b2.includes('deadline is week'), 'no deadline claim without the setting');
  assert.ok(b2.includes('lineup every week'), 'evergreen items remain');
});

test('folder: trade_deadline sentinel 99 (no deadline) is not surfaced', () => {
  const noDl = { ...leagues[0], settings: { waiver_day_of_week: 2, trade_deadline: 99 } };
  const body = Bench.buildDayOneFolder({ league: noDl, seat, graph, playersData }).sections[3].body;
  assert.ok(!body.includes('week 99'), '99 means no deadline, never "week 99"');
});

test('folder: house rules verbatim when digest provided, honest line when not', () => {
  const digest = 'Rule 1: no vetoes. Rule 2: dues by week 1.';
  const withC = Bench.buildDayOneFolder({ league: leagues[0], seat, graph, playersData, constitutionDigest: digest });
  assert.strictEqual(withC.sections[4].body, digest, 'digest passes through verbatim');
  const without = Bench.buildDayOneFolder({ league: leagues[0], seat, graph, playersData });
  assert.ok(without.sections[4].body.toLowerCase().includes('no constitution on file'), 'honest empty state');
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
