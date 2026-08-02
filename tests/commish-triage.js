#!/usr/bin/env node
// Unit tests for the Commissioner's Office triage queue —
// js/shared/commish-triage.js (App.Commish.Triage).
//
// Everything here is pure: buildQueue takes nowMs/week as parameters and
// never fetches, so a fixture pins the exact ranking. AlexVoice is absent in
// Node on purpose — say() falls back to variants[0], which is what the copy
// assertions below match byte-for-byte.
'use strict';

const assert = require('assert');
const Triage = require('../js/shared/commish-triage.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Fixture helpers ─────────────────────────────────────────────────
const DAY = 86400000;
const NOW = Date.UTC(2026, 7, 2);              // Aug 2 2026 — the owner's real desk today
const league = (id, name, extra) => Object.assign({ league_id: id, name }, extra || {});

// Three leagues named so their tags are distinct: DW / TG / SM.
const L3 = [
  league('L1', 'Dynasty Warlords'),
  league('L2', 'The Guillotine'),
  league('L3', 'Sunday Money'),
];

function radarPerson(uid, name, status, teams) {
  return { userId: uid, name, isMe: false, status, checkin: 'hey', teams };
}
function team(leagueId, leagueName, status, days) {
  return { leagueId, leagueName, rosterId: 1, status, signals: { daysSinceTxn: days } };
}
function graphOf(people) {
  const out = { people: {}, overlap: [], seats: [] };
  people.forEach(p => {
    out.people[p.userId] = {
      userId: p.userId, name: p.name, isMe: false,
      leagueIds: p.leagueIds, leagueCount: p.leagueIds.length, teams: [],
    };
  });
  return out;
}

// ── WEIGHTS export ──────────────────────────────────────────────────
test('WEIGHTS is exported and carries every documented base weight', () => {
  const W = Triage.WEIGHTS;
  assert.ok(W && typeof W === 'object', 'WEIGHTS exported');
  const expected = {
    open_seat_draft_within_14d: 92, person_DARK_ALL: 88, drift_scoring_or_deadline: 82,
    genesis_lt_50_draft_in_30d: 80, draft_unscheduled: 78, open_seat: 74,
    draft_collision_within_21d: 72, person_DARK_ONE: 62, renewal_AT_RISK: 58,
    drift_other_path: 55, deadline_cluster: 52, genesis_blockers_lt_60: 50,
    dues_zero_collected: 48, no_constitution: 44, renewal_WATCH: 34,
    programme_unpublished: 30, person_FADING: 28, drift_acked_no_note: 26,
  };
  Object.keys(expected).forEach(k => assert.strictEqual(W[k], expected[k], 'weight ' + k));
  assert.strictEqual(Object.keys(W).length, Object.keys(expected).length, 'no undocumented weights');
});

// ── Tier boundaries ─────────────────────────────────────────────────
test('tier boundaries: 70 = NOW, 69.9 = SOON, 40 = SOON, 39.9 = BACKLOG', () => {
  assert.strictEqual(Triage.tierFor(100), 'NOW');
  assert.strictEqual(Triage.tierFor(70), 'NOW', '70 is inclusive');
  assert.strictEqual(Triage.tierFor(69.9), 'SOON');
  assert.strictEqual(Triage.tierFor(40), 'SOON', '40 is inclusive');
  assert.strictEqual(Triage.tierFor(39.9), 'BACKLOG');
  assert.strictEqual(Triage.tierFor(0), 'BACKLOG');
});

test('tier boundary end-to-end: renewal_AT_RISK at p=0.20 scores exactly 70 → NOW', () => {
  // 58 + (0.5 − 0.20) × 40 = 70, single league so no blast multiplier.
  const q = Triage.buildQueue({
    renewal: { people: [{ userId: 'u9', name: 'Marcus Vale', probability: 0.2, band: 'AT_RISK', factors: ['bottom-quartile season'], plays: [] }] },
    graph: graphOf([{ userId: 'u9', name: 'Marcus Vale', leagueIds: ['L1'] }]),
    mine: [L3[0]], week: 5, nowMs: NOW,
  });
  const row = q.items.find(i => i.id === 'person:u9');
  assert.ok(row, 'renewal-only person still produces a row');
  assert.strictEqual(row.kind, 'renewal_AT_RISK');
  assert.strictEqual(row.score, 70, 'lands exactly on the NOW threshold');
  assert.strictEqual(row.tier, 'NOW');
  assert.deepStrictEqual(row.metric, { value: 0.2, unit: 'renewal odds', breach: true });
});

// ── Blast radius ────────────────────────────────────────────────────
test('blast radius: person weight × (1 + 0.08 × (leagueCount − 1))', () => {
  function fadingScore(leagueIds) {
    const teams = leagueIds.map((id, i) => team(id, 'League ' + id, i === 0 ? 'WATCH' : 'OK', 16));
    const q = Triage.buildQueue({
      radar: { people: [radarPerson('u1', 'Dana Reed', 'FADING', teams)] },
      graph: graphOf([{ userId: 'u1', name: 'Dana Reed', leagueIds }]),
      mine: leagueIds.map(id => league(id, 'League ' + id)),
      week: 5, nowMs: NOW,
    });
    return q.items.find(i => i.id === 'person:u1').score;
  }
  assert.strictEqual(fadingScore(['L1']), 28, '1 league → base, no multiplier');
  assert.strictEqual(fadingScore(['L1', 'L2']), 30.2, '28 × 1.08 = 30.24 → 30.2');
  assert.strictEqual(fadingScore(['L1', 'L2', 'L3', 'L4']), 34.7, '28 × 1.24 = 34.72 → 34.7');
});

test('blast radius clamps at 100 — a 3-league DARK_ALL cannot exceed the scale', () => {
  const teams = ['L1', 'L2', 'L3'].map(id => team(id, 'League ' + id, 'DARK', 44));
  const q = Triage.buildQueue({
    radar: { people: [radarPerson('u1', 'Dave Kohl', 'DARK_ALL', teams)] },
    graph: graphOf([{ userId: 'u1', name: 'Dave Kohl', leagueIds: ['L1', 'L2', 'L3'] }]),
    mine: L3, week: 5, nowMs: NOW,
  });
  const row = q.items.find(i => i.id === 'person:u1');
  // 88 × 1.16 = 102.08, clamped to the 0–100 scale.
  assert.strictEqual(row.score, 100);
  assert.strictEqual(row.tier, 'NOW');
});

test('conflicts take +2 per shared human on top of the base weight', () => {
  const draftTs = NOW + 5 * DAY;
  const conflict = {
    kind: 'draft_overlap',
    a: { type: 'draft', leagueId: 'L1', leagueName: 'Dynasty Warlords', ts: draftTs, status: 'pre_draft' },
    b: { type: 'draft', leagueId: 'L2', leagueName: 'The Guillotine', ts: draftTs + 2 * 3600000, status: 'pre_draft' },
    sharedHumans: ['Ana', 'Ben', 'Cy'],
    suggestion: 'slide The Guillotine a day later',
  };
  const q = Triage.buildQueue({ conflicts: [conflict], mine: L3, week: 0, nowMs: NOW });
  const row = q.items.find(i => i.kind === 'draft_collision_within_21d');
  assert.ok(row, 'collision inside 21 days is triage');
  assert.strictEqual(row.score, 78, '72 + 2 × 3 shared humans');
  assert.strictEqual(row.domain, 'operations');
  assert.strictEqual(row.hub, 'ops');
  assert.deepStrictEqual(row.leagueIds, ['L1', 'L2'], 'a collision belongs to both leagues');
  assert.strictEqual(row.dueTs, draftTs, 'due on the first of the two drafts');

  // Same collision 40 days out is a calendar entry, not a queue item.
  const far = JSON.parse(JSON.stringify(conflict));
  far.a.ts = NOW + 40 * DAY; far.b.ts = NOW + 40 * DAY + 2 * 3600000;
  const q2 = Triage.buildQueue({ conflicts: [far], mine: L3, week: 0, nowMs: NOW });
  assert.strictEqual(q2.items.filter(i => i.kind === 'draft_collision_within_21d').length, 0);
});

test('a deadline cluster is one row spanning every league in the week', () => {
  const wk9 = Date.UTC(2026, 10, 3);
  const q = Triage.buildQueue({
    conflicts: [{
      kind: 'deadline_cluster', week: 9,
      leagues: ['Dynasty Warlords', 'The Guillotine', 'Sunday Money'],
      events: [
        { type: 'deadline', leagueId: 'L1', leagueName: 'Dynasty Warlords', ts: wk9 + DAY, week: 9 },
        { type: 'deadline', leagueId: 'L2', leagueName: 'The Guillotine', ts: wk9, week: 9 },
        { type: 'deadline', leagueId: 'L3', leagueName: 'Sunday Money', ts: wk9 + 2 * DAY, week: 9 },
      ],
      note: 'Week 9 stacks 3 trade deadlines.',
    }],
    mine: L3, week: 5, nowMs: NOW,
  });
  const rows = q.items.filter(i => i.kind === 'deadline_cluster');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].score, 52, 'no shared-human bump — a cluster has none');
  assert.strictEqual(rows[0].tier, 'SOON');
  assert.deepStrictEqual(rows[0].leagueIds, ['L1', 'L2', 'L3']);
  assert.strictEqual(rows[0].dueTs, wk9, 'due on the earliest deadline in the stack');
  assert.strictEqual(rows[0].subjectName, 'Week 9');
  ['L1', 'L2', 'L3'].forEach(lid => assert.strictEqual(q.byCell[lid + ':operations'], 1, lid + ' counts the cluster once'));
});

// ── Offseason honesty clamp ─────────────────────────────────────────
test('offseason clamp: person items are ×0.55 and hard-capped at SOON', () => {
  const ids = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'];
  const teams = ids.map(id => team(id, 'League ' + id, 'DARK', 70));
  const inputs = week => ({
    radar: { people: [radarPerson('u1', 'Dave Kohl', 'DARK_ALL', teams)] },
    graph: graphOf([{ userId: 'u1', name: 'Dave Kohl', leagueIds: ids }]),
    mine: ids.map(id => league(id, 'League ' + id)),
    week, nowMs: NOW,
  });

  const inSeason = Triage.buildQueue(inputs(5)).items.find(i => i.id === 'person:u1');
  assert.strictEqual(inSeason.score, 100, 'in-season a 7-league DARK_ALL pins the scale');
  assert.strictEqual(inSeason.tier, 'NOW');

  const off = Triage.buildQueue(inputs(0)).items.find(i => i.id === 'person:u1');
  // 88 × 1.48 = 130.24 → × 0.55 = 71.632 → 71.6. Still above the NOW line…
  assert.strictEqual(off.score, 71.6, '×0.55 applied to the blast-scaled weight');
  // …and the hard cap is what actually keeps it out of NOW. Dark in August
  // is not an emergency.
  assert.strictEqual(off.tier, 'SOON', 'hard-capped at SOON despite scoring 71.6');
});

test('offseason clamp leaves non-person kinds alone', () => {
  const q = Triage.buildQueue({
    drift: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', result: { firstRun: false, changes: [{ path: 'scoring.rec', from: 0.5, to: 1, detectedAt: NOW }] } }],
    mine: L3, week: 0, nowMs: NOW,
  });
  const row = q.items.find(i => i.id === 'drift:L1');
  assert.strictEqual(row.score, 82, 'a silent scoring edit in August is still an 82');
  assert.strictEqual(row.tier, 'NOW');
});

test('offseason clamp does not touch renewal — August is exactly when it is fixable', () => {
  const q = Triage.buildQueue({
    renewal: { people: [{ userId: 'u9', name: 'Marcus Vale', probability: 0.1, band: 'AT_RISK', factors: [], plays: [] }] },
    graph: graphOf([{ userId: 'u9', name: 'Marcus Vale', leagueIds: ['L1'] }]),
    mine: [L3[0]], week: 0, nowMs: NOW,
  });
  const row = q.items.find(i => i.id === 'person:u9');
  assert.strictEqual(row.score, 74, '58 + (0.5 − 0.1) × 40 = 74, unclamped');
  assert.strictEqual(row.tier, 'NOW');
});

// ── Person rollup ───────────────────────────────────────────────────
test('person rollup: a 3-league dark human is ONE row carrying 3 league tags', () => {
  const teams = [
    team('L1', 'Dynasty Warlords', 'DARK', 44),
    team('L2', 'The Guillotine', 'DARK', 51),
    team('L3', 'Sunday Money', 'DARK', 39),
  ];
  const q = Triage.buildQueue({
    radar: { people: [radarPerson('u1', 'Dave Kohl', 'DARK_ALL', teams)] },
    // The same human ALSO shows up on the renewal wall — one fact, two
    // readings, still one row.
    renewal: { people: [{ userId: 'u1', name: 'Dave Kohl', probability: 0.15, band: 'AT_RISK', factors: ['dark everywhere'], plays: ['call him'] }] },
    graph: graphOf([{ userId: 'u1', name: 'Dave Kohl', leagueIds: ['L1', 'L2', 'L3'] }]),
    mine: L3, week: 5, nowMs: NOW,
  });

  const rows = q.items.filter(i => i.subjectName === 'Dave Kohl');
  assert.strictEqual(rows.length, 1, 'never ask the commissioner to message the same human 3×');
  const row = rows[0];
  assert.strictEqual(row.domain, 'people');
  assert.strictEqual(row.hub, 'people');
  assert.strictEqual(row.kind, 'person_DARK_ALL', 'worst status wins over the renewal reading (88 > 74)');
  assert.deepStrictEqual(row.leagueIds, ['L1', 'L2', 'L3']);
  assert.deepStrictEqual(row.leagueTags, ['DW', 'TG', 'SM'], 'one tag per league, all three shown');
  assert.strictEqual(row.leagueTags.length, new Set(row.leagueTags).size, 'tags are distinct');
  assert.strictEqual(row.metric.value, 51, 'metric reports the longest silence across the leagues');
  assert.strictEqual(row.action.kind, 'copy');
  assert.strictEqual(row.action.label, 'COPY MSG');
});

test('person rollup: ACTIVE + SAFE produces no row at all', () => {
  const q = Triage.buildQueue({
    radar: { people: [radarPerson('u2', 'Quiet Achiever', 'ACTIVE', [team('L1', 'Dynasty Warlords', 'OK', 2)])] },
    renewal: { people: [{ userId: 'u2', name: 'Quiet Achiever', probability: 0.93, band: 'SAFE', factors: [], plays: [] }] },
    graph: graphOf([{ userId: 'u2', name: 'Quiet Achiever', leagueIds: ['L1'] }]),
    mine: [L3[0]], week: 5, nowMs: NOW,
  });
  assert.strictEqual(q.items.filter(i => i.domain === 'people').length, 0, 'a healthy human is not an obligation');
});

// ── Rollup shape across the other domains ───────────────────────────
test('rollup: one row per league for genesis / drift / dues / constitution', () => {
  const q = Triage.buildQueue({
    drift: [{
      leagueId: 'L1', leagueName: 'Dynasty Warlords',
      result: {
        firstRun: false, changes: [
          { path: 'scoring.rec', from: 0.5, to: 1, detectedAt: NOW },
          { path: 'scoring.pass_td', from: 4, to: 6, detectedAt: NOW },
          { path: 'settings.trade_deadline', from: 11, to: 13, detectedAt: NOW },
          { path: 'name', from: 'A', to: 'B', detectedAt: NOW },
        ],
      },
    }],
    treasuries: { L1: { rows: [], summary: { paid: 0, total: 12, pct: 0 } } },
    constitutions: { L1: null, L2: { text: 'ARTICLE I. Stuff.', clauses: [{ id: 'art-1' }] }, L3: null },
    mine: L3, week: 5, nowMs: NOW,
  });

  const driftRows = q.items.filter(i => i.domain === 'operations' && i.id.indexOf('drift:') === 0);
  assert.strictEqual(driftRows.length, 1, 'four changes collapse into one league row');
  assert.strictEqual(driftRows[0].kind, 'drift_scoring_or_deadline', 'scoring/deadline outranks the cosmetic edit');
  assert.ok(/^4 changes · 3 scoring/.test(driftRows[0].detail), 'detail counts them: got ' + driftRows[0].detail);
  assert.strictEqual(driftRows[0].metric.value, 4);
  assert.strictEqual(driftRows[0].action.label, 'RATIFY');

  const dues = q.items.filter(i => i.kind === 'dues_zero_collected');
  assert.strictEqual(dues.length, 1);
  assert.strictEqual(dues[0].action.label, 'MARK PAID');

  const consts = q.items.filter(i => i.kind === 'no_constitution');
  assert.deepStrictEqual(consts.map(i => i.leagueIds[0]).sort(), ['L1', 'L3'], 'only the leagues with no text');
  assert.strictEqual(consts[0].domain, 'bylaws');
  assert.strictEqual(consts[0].hub, 'governance');
  assert.strictEqual(consts[0].action.label, 'UPLOAD');
});

test('an empty constitutions map means "we never looked", not "everyone is lawless"', () => {
  const q = Triage.buildQueue({ constitutions: {}, mine: L3, week: 5, nowMs: NOW });
  assert.strictEqual(q.items.filter(i => i.kind === 'no_constitution').length, 0);
});

test('drift_other_path is used when nothing scoring-shaped moved', () => {
  const q = Triage.buildQueue({
    drift: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', result: { firstRun: false, changes: [{ path: 'avatar', from: 'a', to: 'b', detectedAt: NOW }] } }],
    mine: L3, week: 5, nowMs: NOW,
  });
  const row = q.items.find(i => i.id === 'drift:L1');
  assert.strictEqual(row.kind, 'drift_other_path');
  assert.strictEqual(row.score, 55);
});

test('a first-run drift baseline is never a finding', () => {
  const q = Triage.buildQueue({
    drift: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', result: { firstRun: true, changes: [] } }],
    mine: L3, week: 5, nowMs: NOW,
  });
  assert.strictEqual(q.items.filter(i => i.id.indexOf('drift') === 0).length, 0);
});

test('Rule Lab contributes nothing — it is a tool, not an obligation', () => {
  const q = Triage.buildQueue({
    drift: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', result: { firstRun: false, changes: [{ path: 'scoring.rec', from: 0.5, to: 1, detectedAt: NOW }] } }],
    mine: L3, week: 5, nowMs: NOW,
  });
  assert.strictEqual(q.items.filter(i => i.domain === 'rulelab').length, 0);
  ['L1', 'L2', 'L3'].forEach(lid => assert.strictEqual(q.byCell[lid + ':rulelab'], 0, lid + ' rulelab cell is a real zero'));
});

// ── Seats ───────────────────────────────────────────────────────────
test('an open seat escalates to 92 when the draft is inside 14 days', () => {
  const soon = NOW + 9 * DAY;
  const events = [{ type: 'draft', leagueId: 'L1', leagueName: 'Dynasty Warlords', ts: soon, week: null, approximate: false, label: 'Draft', status: 'pre_draft' }];
  const q = Triage.buildQueue({
    calendar: { events }, seats: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', rosterId: 7, reason: 'no owner_id on the roster' }],
    mine: L3, week: 0, nowMs: NOW,
  });
  const row = q.items.find(i => i.id === 'seat:L1:7');
  assert.strictEqual(row.kind, 'open_seat_draft_within_14d');
  assert.strictEqual(row.score, 92);
  assert.strictEqual(row.tier, 'NOW');
  assert.strictEqual(row.dueTs, soon);
  assert.deepStrictEqual(row.metric, { value: 9, unit: 'days to draft', breach: true });
  assert.strictEqual(row.action.label, 'FILL SEAT');

  const q2 = Triage.buildQueue({
    calendar: { events: [Object.assign({}, events[0], { ts: NOW + 40 * DAY })] },
    seats: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', rosterId: 7, reason: 'no owner_id on the roster' }],
    mine: L3, week: 0, nowMs: NOW,
  });
  const row2 = q2.items.find(i => i.id === 'seat:L1:7');
  assert.strictEqual(row2.kind, 'open_seat');
  assert.strictEqual(row2.score, 74);
});

// ── Genesis ─────────────────────────────────────────────────────────
test('genesis: an unscheduled draft is one row and never doubles with the checklist row', () => {
  const q = Triage.buildQueue({
    genesis: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', pct: 33, items: [], blockers: ['Draft scheduled', 'All seats filled', 'Deadline set'] }],
    mine: [L3[0]], week: 0, nowMs: NOW,
  });
  const rows = q.items.filter(i => i.domain === 'genesis');
  assert.strictEqual(rows.length, 1, 'one genesis row per league, always');
  assert.strictEqual(rows[0].kind, 'draft_unscheduled');
  assert.strictEqual(rows[0].score, 78);
  assert.strictEqual(rows[0].dueTs, null, 'the missing date IS the problem — no fake dueTs');
  assert.strictEqual(rows[0].action.label, 'SCHEDULE');
  assert.ok(/\+2 more/.test(rows[0].detail), 'names the top blocker and counts the rest: ' + rows[0].detail);
});

test('genesis: a booked draft inside 30 days with <50% readiness scores 80', () => {
  const draftTs = NOW + 20 * DAY;
  const q = Triage.buildQueue({
    calendar: { events: [{ type: 'draft', leagueId: 'L1', leagueName: 'Dynasty Warlords', ts: draftTs, status: 'pre_draft' }] },
    genesis: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', pct: 44, items: [], blockers: ['All seats filled', 'Deadline set'] }],
    mine: [L3[0]], week: 0, nowMs: NOW,
  });
  const row = q.items.find(i => i.domain === 'genesis');
  assert.strictEqual(row.kind, 'genesis_lt_50_draft_in_30d');
  assert.strictEqual(row.score, 80);
  assert.strictEqual(row.dueTs, draftTs);
  assert.strictEqual(row.metric.value, 44);

  // Same league at 55% readiness drops to the blocker weight.
  const q2 = Triage.buildQueue({
    calendar: { events: [{ type: 'draft', leagueId: 'L1', leagueName: 'Dynasty Warlords', ts: draftTs, status: 'pre_draft' }] },
    genesis: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', pct: 55, items: [], blockers: ['Deadline set'] }],
    mine: [L3[0]], week: 0, nowMs: NOW,
  });
  assert.strictEqual(q2.items.find(i => i.domain === 'genesis').kind, 'genesis_blockers_lt_60');

  // 70% ready with a booked draft is not an obligation at all.
  const q3 = Triage.buildQueue({
    calendar: { events: [{ type: 'draft', leagueId: 'L1', leagueName: 'Dynasty Warlords', ts: draftTs, status: 'pre_draft' }] },
    genesis: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', pct: 70, items: [], blockers: ['Welcome note drafted'] }],
    mine: [L3[0]], week: 0, nowMs: NOW,
  });
  assert.strictEqual(q3.items.filter(i => i.domain === 'genesis').length, 0);
});

test('genesis never demands a draft date once the season is under way', () => {
  const q = Triage.buildQueue({ mine: L3, week: 5, nowMs: NOW });
  assert.strictEqual(q.items.filter(i => i.kind === 'draft_unscheduled').length, 0);
});

// ── byCell + notYet ─────────────────────────────────────────────────
test('byCell emits a value for EVERY league × domain pair (28 for 4 leagues)', () => {
  const four = L3.concat([league('L4', 'Zulu Nation')]);
  const q = Triage.buildQueue({
    radar: { people: [radarPerson('u1', 'Dave Kohl', 'DARK_ALL', [team('L1', 'Dynasty Warlords', 'DARK', 44), team('L2', 'The Guillotine', 'DARK', 51)])] },
    graph: graphOf([{ userId: 'u1', name: 'Dave Kohl', leagueIds: ['L1', 'L2'] }]),
    drift: [{ leagueId: 'L4', leagueName: 'Zulu Nation', result: { firstRun: false, changes: [{ path: 'scoring.rec', from: 0.5, to: 1, detectedAt: NOW }] } }],
    mine: four, week: 5, nowMs: NOW,
  });

  assert.strictEqual(Object.keys(q.byCell).length, 28, '4 leagues × 7 domains');
  ['L1', 'L2', 'L3', 'L4'].forEach(lid => {
    Triage.DOMAINS.forEach(d => {
      const k = lid + ':' + d;
      assert.ok(Object.prototype.hasOwnProperty.call(q.byCell, k), 'missing cell ' + k);
      assert.strictEqual(typeof q.byCell[k], 'number', k + ' must be a number, not undefined');
    });
  });
  // A person spanning two leagues lights BOTH people cells — and no others.
  assert.strictEqual(q.byCell['L1:people'], 1);
  assert.strictEqual(q.byCell['L2:people'], 1);
  assert.strictEqual(q.byCell['L3:people'], 0, 'an untouched cell is an explicit zero');
  assert.strictEqual(q.byCell['L4:operations'], 1);
  assert.strictEqual(q.byCell['L1:operations'], 0);
});

test('notYet marks coefficient + programmes in the offseason, and clears in season', () => {
  const off = Triage.buildQueue({ mine: L3, week: 0, nowMs: NOW });
  assert.strictEqual(Object.keys(off.notYet).length, 6, '3 leagues × 2 not-yet domains');
  ['L1', 'L2', 'L3'].forEach(lid => {
    assert.strictEqual(off.notYet[lid + ':coefficient'], true);
    assert.strictEqual(off.notYet[lid + ':programmes'], true);
  });
  assert.strictEqual(off.items.filter(i => i.domain === 'programmes').length, 0, 'nothing to publish before Week 1');

  const inSeason = Triage.buildQueue({ mine: L3, week: 5, nowMs: NOW });
  assert.deepStrictEqual(inSeason.notYet, {}, 'four scored weeks in the books');
  assert.strictEqual(inSeason.items.filter(i => i.kind === 'programme_unpublished').length, 3);
});

test('notYet is per league — a league whose own leg lags still reads not-yet', () => {
  const mixed = [league('L1', 'Dynasty Warlords', { settings: { leg: 5 } }), league('L2', 'The Guillotine', { settings: { leg: 1 } })];
  const q = Triage.buildQueue({ mine: mixed, week: 5, nowMs: NOW });
  assert.strictEqual(q.notYet['L1:programmes'], undefined, 'L1 has 4 scored weeks');
  assert.strictEqual(q.notYet['L2:programmes'], true, 'L2 has not scored a week yet');
  assert.strictEqual(q.notYet['L2:coefficient'], true);
});

test('scoredWeeks ignores a stale leg left over from last season', () => {
  assert.strictEqual(Triage.scoredWeeks({ settings: { leg: 17 } }, 0), 0, 'offseason has no scored weeks, whatever leg says');
  assert.strictEqual(Triage.scoredWeeks({ settings: { leg: 5 } }, 8), 4);
  assert.strictEqual(Triage.scoredWeeks({}, 8), 7);
  assert.strictEqual(Triage.scoredWeeks({}, 1), 0, 'Week 1 in progress = nothing scored');
});

// ── Sort determinism ────────────────────────────────────────────────
function busyInputs(order) {
  const drift = [
    { leagueId: 'L1', leagueName: 'Dynasty Warlords', result: { firstRun: false, changes: [{ path: 'scoring.rec', from: 0.5, to: 1, detectedAt: NOW }] } },
    { leagueId: 'L2', leagueName: 'The Guillotine', result: { firstRun: false, changes: [{ path: 'avatar', from: 'a', to: 'b', detectedAt: NOW }] } },
  ];
  const seats = [
    { leagueId: 'L3', leagueName: 'Sunday Money', rosterId: 4, reason: 'no owner' },
    { leagueId: 'L1', leagueName: 'Dynasty Warlords', rosterId: 9, reason: 'no owner' },
  ];
  const people = [
    radarPerson('u1', 'Dave Kohl', 'DARK_ALL', [team('L1', 'Dynasty Warlords', 'DARK', 44), team('L2', 'The Guillotine', 'DARK', 51)]),
    radarPerson('u2', 'Ana Ruiz', 'DARK_ONE', [team('L3', 'Sunday Money', 'DARK', 30)]),
    radarPerson('u3', 'Cy Booth', 'FADING', [team('L2', 'The Guillotine', 'WATCH', 16)]),
  ];
  const flip = a => (order === 'rev' ? a.slice().reverse() : a);
  return {
    radar: { people: flip(people) },
    graph: graphOf([
      { userId: 'u1', name: 'Dave Kohl', leagueIds: ['L1', 'L2'] },
      { userId: 'u2', name: 'Ana Ruiz', leagueIds: ['L3'] },
      { userId: 'u3', name: 'Cy Booth', leagueIds: ['L2'] },
    ]),
    drift: flip(drift),
    seats: flip(seats),
    treasuries: { L2: { rows: [], summary: { paid: 0, total: 10, pct: 0 } } },
    constitutions: { L1: { text: 'ARTICLE I.' }, L2: null, L3: null },
    mine: order === 'rev' ? L3.slice().reverse() : L3,
    week: 5, nowMs: NOW,
  };
}

test('sort is deterministic and independent of input ordering', () => {
  const a = Triage.buildQueue(busyInputs('fwd'));
  const b = Triage.buildQueue(busyInputs('fwd'));
  const c = Triage.buildQueue(busyInputs('rev'));
  assert.deepStrictEqual(a.items.map(i => i.id), b.items.map(i => i.id), 'same inputs → same order');
  assert.deepStrictEqual(a.items.map(i => i.id), c.items.map(i => i.id), 'reversed input arrays → same order');
  assert.deepStrictEqual(a.counts, c.counts);
  assert.deepStrictEqual(a.byCell, c.byCell);
  assert.strictEqual(a.diagnosis, c.diagnosis);
});

test('sort: score desc, then dueTs asc with nulls last, then league name, then id', () => {
  const q = Triage.buildQueue(busyInputs('fwd'));
  for (let i = 1; i < q.items.length; i++) {
    assert.ok(q.items[i - 1].score >= q.items[i].score, 'scores never increase down the queue');
  }
  // Two open seats, same weight (74), both undated → league name breaks the tie.
  const seatRows = q.items.filter(i => i.kind === 'open_seat');
  assert.strictEqual(seatRows.length, 2);
  assert.deepStrictEqual(seatRows.map(i => i.leagueNames[0]), ['Dynasty Warlords', 'Sunday Money'], 'alphabetical on league name');

  // Dated beats undated at equal score.
  const dueQ = Triage.buildQueue({
    calendar: {
      events: [
        { type: 'draft', leagueId: 'L1', leagueName: 'Dynasty Warlords', ts: NOW + 3 * DAY, status: 'pre_draft' },
        { type: 'draft', leagueId: 'L2', leagueName: 'The Guillotine', ts: NOW + 6 * DAY, status: 'pre_draft' },
      ],
    },
    seats: [
      { leagueId: 'L2', leagueName: 'The Guillotine', rosterId: 1, reason: 'no owner' },
      { leagueId: 'L1', leagueName: 'Dynasty Warlords', rosterId: 1, reason: 'no owner' },
    ],
    mine: L3, week: 0, nowMs: NOW,
  });
  const ids = dueQ.items.filter(i => i.kind === 'open_seat_draft_within_14d').map(i => i.id);
  assert.deepStrictEqual(ids, ['seat:L1:1', 'seat:L2:1'], 'earlier draft sorts first at equal score');

  assert.deepStrictEqual(
    { now: q.counts.now, soon: q.counts.soon, backlog: q.counts.backlog },
    q.items.reduce((acc, it) => {
      acc[it.tier === 'NOW' ? 'now' : it.tier === 'SOON' ? 'soon' : 'backlog']++;
      return acc;
    }, { now: 0, soon: 0, backlog: 0 }),
    'counts match the items they summarise');
});

// ── Diagnosis ───────────────────────────────────────────────────────
test('diagnosis: genesis form when the top NOW item is an unscheduled draft', () => {
  const four = L3.concat([league('L4', 'Zulu Nation')]);
  const q = Triage.buildQueue({ mine: four, week: 0, nowMs: NOW });
  assert.strictEqual(q.items.length, 4, 'one unscheduled-draft row per league');
  assert.strictEqual(q.items[0].domain, 'genesis');
  assert.strictEqual(q.counts.now, 4);
  assert.strictEqual(
    q.diagnosis,
    '4 of your 4 leagues still have no draft on the calendar — 4 things need you before Week 1 is even a question.');
});

test('diagnosis: people form when the top NOW item is a human', () => {
  const q = Triage.buildQueue({
    radar: {
      people: [
        radarPerson('u1', 'Dave Kohl', 'DARK_ALL', [team('L1', 'Dynasty Warlords', 'DARK', 44), team('L2', 'The Guillotine', 'DARK', 51), team('L3', 'Sunday Money', 'DARK', 39)]),
        radarPerson('u2', 'Ana Ruiz', 'DARK_ONE', [team('L3', 'Sunday Money', 'DARK', 30)]),
        radarPerson('u3', 'Cy Booth', 'ACTIVE', [team('L2', 'The Guillotine', 'OK', 3)]),
      ],
    },
    graph: graphOf([
      { userId: 'u1', name: 'Dave Kohl', leagueIds: ['L1', 'L2', 'L3'] },
      { userId: 'u2', name: 'Ana Ruiz', leagueIds: ['L3'] },
      { userId: 'u3', name: 'Cy Booth', leagueIds: ['L2'] },
    ]),
    seats: [
      { leagueId: 'L1', leagueName: 'Dynasty Warlords', rosterId: 3, reason: 'no owner' },
      { leagueId: 'L2', leagueName: 'The Guillotine', rosterId: 8, reason: 'no owner' },
    ],
    mine: L3, week: 5, nowMs: NOW,
  });
  assert.strictEqual(q.items[0].domain, 'people');
  assert.strictEqual(
    q.diagnosis,
    'Your leagues aren\'t fighting, they\'re going quiet — 2 of 3 humans have stopped showing up and 2 seats are empty.');
});

test('diagnosis: operations form when the top NOW item is settings drift', () => {
  const q = Triage.buildQueue({
    drift: [
      {
        leagueId: 'L1', leagueName: 'Dynasty Warlords',
        result: {
          firstRun: false, changes: [
            { path: 'scoring.rec', from: 0.5, to: 1, detectedAt: NOW },
            { path: 'scoring.pass_td', from: 4, to: 6, detectedAt: NOW },
            { path: 'settings.trade_deadline', from: 11, to: 13, detectedAt: NOW },
          ],
        },
      },
      {
        leagueId: 'L2', leagueName: 'The Guillotine',
        result: { firstRun: false, changes: [{ path: 'scoring.bonus_rec_te', from: 0, to: 0.5, detectedAt: NOW }] },
      },
    ],
    mine: L3, week: 5, nowMs: NOW,
  });
  assert.strictEqual(q.items[0].domain, 'operations');
  assert.strictEqual(
    q.diagnosis,
    'Someone\'s been editing settings you haven\'t signed off on — 4 changes across 2 leagues.');
});

test('diagnosis: empty queue names the next dated item instead of congratulating', () => {
  const two = [league('L1', 'Alpha League'), league('L2', 'Beta League')];
  const q = Triage.buildQueue({
    calendar: {
      events: [
        { type: 'draft', leagueId: 'L1', leagueName: 'Alpha League', ts: Date.UTC(2026, 7, 28, 23, 0), status: 'pre_draft' },
        { type: 'draft', leagueId: 'L2', leagueName: 'Beta League', ts: Date.UTC(2026, 8, 2, 1, 0), status: 'pre_draft' },
      ],
    },
    mine: two, week: 0, nowMs: NOW,
  });
  assert.strictEqual(q.items.length, 0, 'nothing outstanding');
  assert.deepStrictEqual(q.counts, { now: 0, soon: 0, backlog: 0 });
  assert.strictEqual(q.diagnosis, 'Nothing needs you across 2 leagues. Next dated item: Aug 28, Alpha League draft.');
});

test('diagnosis: empty queue with an empty calendar says so honestly', () => {
  const q = Triage.buildQueue({ mine: [league('L1', 'Alpha League', { status: 'in_season' })], week: 1, nowMs: NOW });
  assert.strictEqual(q.items.length, 0);
  assert.strictEqual(q.diagnosis, 'Nothing needs you across 1 league. Nothing dated on the calendar either.');
});

test('diagnosis: work with no NOW item does not get inflated into a crisis', () => {
  // Draft is booked (so no genesis row) and the only finding is a missing
  // constitution at 44 — real work, zero emergencies.
  const q = Triage.buildQueue({
    calendar: { events: [{ type: 'draft', leagueId: 'L1', leagueName: 'Dynasty Warlords', ts: NOW + 20 * DAY, status: 'pre_draft' }] },
    constitutions: { L1: null },
    mine: [L3[0]], week: 0, nowMs: NOW,
  });
  assert.strictEqual(q.items.length, 1);
  assert.deepStrictEqual(q.counts, { now: 0, soon: 1, backlog: 0 });
  assert.strictEqual(
    q.diagnosis,
    'Nothing is on fire across 1 league — 1 thing worth an hour this week, 0 that can wait.');
});

test('drift_acked_no_note fires only when ack history is actually supplied', () => {
  const silent = Triage.buildQueue({
    drift: [{ leagueId: 'L1', leagueName: 'Dynasty Warlords', result: { firstRun: false, changes: [] } }],
    mine: L3, week: 5, nowMs: NOW,
  });
  assert.strictEqual(silent.items.filter(i => i.domain === 'operations').length, 0,
    'an absent history field must never manufacture a finding');

  const withHistory = Triage.buildQueue({
    drift: [{
      leagueId: 'L1', leagueName: 'Dynasty Warlords',
      result: {
        firstRun: false, changes: [],
        history: [{ ackTs: NOW - DAY, changes: [], note: 'ratified at the owners meeting' }, { ackTs: NOW - 2 * DAY, changes: [] }],
      },
    }],
    mine: L3, week: 5, nowMs: NOW,
  });
  const row = withHistory.items.find(i => i.id === 'drift-note:L1');
  assert.ok(row, 'the un-noted ack is a finding');
  assert.strictEqual(row.kind, 'drift_acked_no_note');
  assert.strictEqual(row.score, 26);
  assert.strictEqual(row.tier, 'BACKLOG');
  assert.strictEqual(row.metric.value, 1, 'only the ack with no note counts');
});

// ── Contract shape ──────────────────────────────────────────────────
test('every item carries the full contract: domain, hub, action verb, metric', () => {
  const q = Triage.buildQueue(busyInputs('fwd'));
  const HUBS = ['network', 'people', 'ops', 'programmes', 'rulelab', 'genesis', 'governance'];
  const LABELS = ['SCHEDULE', 'FILL SEAT', 'RATIFY', 'RESOLVE', 'MARK PAID', 'UPLOAD', 'COPY MSG', 'OPEN'];
  assert.ok(q.items.length >= 6, 'fixture is busy enough to be worth checking');
  q.items.forEach(it => {
    assert.ok(Triage.DOMAINS.indexOf(it.domain) >= 0, 'domain in range: ' + it.domain);
    assert.strictEqual(it.hub, Triage.HUB_BY_DOMAIN[it.domain], 'hub matches domain for ' + it.id);
    assert.ok(HUBS.indexOf(it.hub) >= 0, 'hub in range: ' + it.hub);
    assert.ok(['deeplink', 'copy', 'inline'].indexOf(it.action.kind) >= 0, 'action kind: ' + it.action.kind);
    assert.ok(LABELS.indexOf(it.action.label) >= 0, 'action label is one of the eight verbs: ' + it.action.label);
    assert.ok(Array.isArray(it.leagueIds) && Array.isArray(it.leagueNames) && Array.isArray(it.leagueTags));
    assert.strictEqual(it.leagueTags.length, it.leagueIds.length, 'a tag per league on ' + it.id);
    assert.ok(typeof it.metric === 'object' && 'value' in it.metric && 'unit' in it.metric && 'breach' in it.metric);
    assert.ok(typeof it.headline === 'string' && it.headline.length > 0, 'headline on ' + it.id);
    assert.ok(typeof it.kicker === 'string' && it.kicker.length > 0, 'kicker on ' + it.id);
    assert.ok(it.score >= 0 && it.score <= 100, 'score clamped 0–100 on ' + it.id);
    assert.strictEqual(it.tier, ['NOW', 'SOON', 'BACKLOG'].filter(t => t === it.tier)[0]);
    assert.ok(it.dueTs === null || typeof it.dueTs === 'number');
  });
  assert.strictEqual(new Set(q.items.map(i => i.id)).size, q.items.length, 'ids are unique');
});

test('an empty desk still returns a well-formed envelope', () => {
  const q = Triage.buildQueue({});
  assert.deepStrictEqual(q.items, []);
  assert.deepStrictEqual(q.counts, { now: 0, soon: 0, backlog: 0 });
  assert.deepStrictEqual(q.byCell, {});
  assert.deepStrictEqual(q.notYet, {});
  assert.ok(typeof q.diagnosis === 'string' && q.diagnosis.length > 0);
  assert.doesNotThrow(() => Triage.buildQueue(undefined), 'no args must not throw');
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
