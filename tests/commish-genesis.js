#!/usr/bin/env node
// Unit tests for Season Genesis (js/shared/commish-genesis.js): every AUTO
// check's edge cases (past vs future vs completed draft; drift null vs
// firstRun vs clean vs pending; seats; deadline bounds; rosters;
// constitution flag), manual-toggle persistence via the engine's internal
// Map fallback (_mem), pct math, blocker worst-first ordering, and
// buildAll's lowest-pct-first sort. No DhqStorage, no localStorage, no
// network, no Date.now() — every call passes nowMs.
'use strict';

const assert = require('assert');
const Genesis = require('../js/shared/commish-genesis.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const NOW = 1754000000000; // fixed "now" for every test

function mkLeague(over) {
  return Object.assign({
    league_id: 'L1',
    name: 'Dynasty Prime',
    settings: { trade_deadline: 10 },
    rosters: [{ roster_id: 1 }, { roster_id: 2 }],
  }, over || {});
}
function draftEvent(over) {
  return Object.assign({
    type: 'draft', leagueId: 'L1', leagueName: 'Dynasty Prime',
    ts: NOW + 86400000, week: null, approximate: false,
    draftId: 'd1', status: 'pre_draft', label: 'Dynasty Prime draft',
  }, over || {});
}
const CLEAN_DRIFT = { firstRun: false, changes: [], baselineTs: 1 };
function item(r, id) { return r.items.find(i => i.id === id); }
function ready(over) {
  // A fully-green baseline; individual tests break one dimension at a time.
  return Genesis.buildReadiness(Object.assign({
    league: mkLeague(),
    calendarEvents: [draftEvent()],
    driftResult: CLEAN_DRIFT,
    seats: [],
    constitutionOnFile: true,
    manual: { dues_noted: true, rules_reratified: true, welcome_drafted: true },
    nowMs: NOW,
  }, over || {}));
}
function reset() { Genesis._mem.clear(); }

// ── Shape ───────────────────────────────────────────────────────────
test('fully ready league scores 100 with no blockers', () => {
  const r = ready();
  assert.strictEqual(r.leagueId, 'L1');
  assert.strictEqual(r.leagueName, 'Dynasty Prime');
  assert.strictEqual(r.pct, 100);
  assert.deepStrictEqual(r.blockers, []);
  assert.strictEqual(r.items.length, 9, '6 auto + 3 manual');
  assert.ok(r.items.every(i => i.done));
});

test('items carry kind auto|manual and constitution item is always present', () => {
  const r = ready();
  const kinds = {};
  r.items.forEach(i => { kinds[i.kind] = (kinds[i.kind] || 0) + 1; });
  assert.strictEqual(kinds.auto, 6);
  assert.strictEqual(kinds.manual, 3);
  assert.ok(item(r, 'constitution_on_file'), 'constitution item present when true');
  const r2 = ready({ constitutionOnFile: false });
  assert.ok(item(r2, 'constitution_on_file'), 'constitution item present when false');
});

test('league without an id returns null — nothing honest to score', () => {
  assert.strictEqual(Genesis.buildReadiness({ league: { name: 'ghost' }, nowMs: NOW }), null);
});

// ── draft_scheduled ─────────────────────────────────────────────────
test('future scheduled draft counts done', () => {
  const it = item(ready(), 'draft_scheduled');
  assert.strictEqual(it.done, true);
  assert.ok(/scheduled/i.test(it.detail));
});

test('past scheduled draft that never completed is NOT done', () => {
  const r = ready({ calendarEvents: [draftEvent({ ts: NOW - 3600000 })] });
  const it = item(r, 'draft_scheduled');
  assert.strictEqual(it.done, false);
  assert.ok(/passed/i.test(it.detail));
});

test('completed draft counts done even in the past — detail says already drafted', () => {
  const r = ready({ calendarEvents: [draftEvent({ ts: NOW - 86400000, status: 'complete' })] });
  const it = item(r, 'draft_scheduled');
  assert.strictEqual(it.done, true);
  assert.ok(/already|complete/i.test(it.detail));
});

test('draft with ts null (time TBD) is NOT done', () => {
  const r = ready({ calendarEvents: [draftEvent({ ts: null })] });
  const it = item(r, 'draft_scheduled');
  assert.strictEqual(it.done, false);
  assert.ok(/no start time/i.test(it.detail));
});

test('no draft event at all is NOT done', () => {
  const it = item(ready({ calendarEvents: [] }), 'draft_scheduled');
  assert.strictEqual(it.done, false);
  assert.ok(/no draft/i.test(it.detail));
});

test('another league\'s draft never satisfies this league', () => {
  const r = ready({ calendarEvents: [draftEvent({ leagueId: 'L2' })] });
  assert.strictEqual(item(r, 'draft_scheduled').done, false);
});

test('non-draft calendar events (deadline/playoffs) are ignored', () => {
  const r = ready({ calendarEvents: [{ type: 'deadline', leagueId: 'L1', ts: NOW + 1, week: 10, label: 'x' }] });
  assert.strictEqual(item(r, 'draft_scheduled').done, false);
});

// ── settings_ratified ───────────────────────────────────────────────
test('driftResult null → not done, detail "not checked yet"', () => {
  const it = item(ready({ driftResult: null }), 'settings_ratified');
  assert.strictEqual(it.done, false);
  assert.strictEqual(it.detail, 'not checked yet');
});

test('firstRun drift counts done', () => {
  const it = item(ready({ driftResult: { firstRun: true, changes: [] } }), 'settings_ratified');
  assert.strictEqual(it.done, true);
});

test('clean drift (no pending changes) counts done', () => {
  assert.strictEqual(item(ready({ driftResult: CLEAN_DRIFT }), 'settings_ratified').done, true);
});

test('pending drift changes block, with the count in the detail', () => {
  const drift = { firstRun: false, changes: [{ path: 'scoring.rec' }, { path: 'positions' }], baselineTs: 1 };
  const it = item(ready({ driftResult: drift }), 'settings_ratified');
  assert.strictEqual(it.done, false);
  assert.ok(/2 unacknowledged settings changes/.test(it.detail));
});

// ── all_seats_filled ────────────────────────────────────────────────
test('no seats for this league counts done (other leagues\' seats ignored)', () => {
  const r = ready({ seats: [{ leagueId: 'L2', leagueName: 'Other', rosterId: 3, reason: 'unowned' }] });
  assert.strictEqual(item(r, 'all_seats_filled').done, true);
});

test('open seats block, with roster + reason in the detail', () => {
  const seats = [
    { leagueId: 'L1', leagueName: 'Dynasty Prime', rosterId: 3, reason: 'unowned' },
    { leagueId: 'L1', leagueName: 'Dynasty Prime', rosterId: 7, reason: 'owner_left' },
  ];
  const it = item(ready({ seats }), 'all_seats_filled');
  assert.strictEqual(it.done, false);
  assert.ok(/2 open seats/.test(it.detail));
  assert.ok(/roster 3 \(unowned\)/.test(it.detail));
  assert.ok(/roster 7 \(owner left\)/.test(it.detail));
});

// ── deadline_set ────────────────────────────────────────────────────
test('trade_deadline 1..18 counts done; 0 / missing / 19 do not', () => {
  assert.strictEqual(item(ready(), 'deadline_set').done, true, 'week 10');
  assert.strictEqual(item(ready({ league: mkLeague({ settings: { trade_deadline: 1 } }) }), 'deadline_set').done, true, 'week 1 edge');
  assert.strictEqual(item(ready({ league: mkLeague({ settings: { trade_deadline: 18 } }) }), 'deadline_set').done, true, 'week 18 edge');
  assert.strictEqual(item(ready({ league: mkLeague({ settings: { trade_deadline: 0 } }) }), 'deadline_set').done, false, 'Sleeper 0 = none');
  assert.strictEqual(item(ready({ league: mkLeague({ settings: { trade_deadline: 19 } }) }), 'deadline_set').done, false, 'out of range');
  assert.strictEqual(item(ready({ league: mkLeague({ settings: {} }) }), 'deadline_set').done, false, 'missing');
});

// ── rosters_present ─────────────────────────────────────────────────
test('rosters present vs absent', () => {
  assert.strictEqual(item(ready(), 'rosters_present').done, true);
  const empty = item(ready({ league: mkLeague({ rosters: [] }) }), 'rosters_present');
  assert.strictEqual(empty.done, false);
  const missing = item(ready({ league: mkLeague({ rosters: undefined }) }), 'rosters_present');
  assert.strictEqual(missing.done, false);
});

// ── constitution_on_file ────────────────────────────────────────────
test('constitution flag drives the item; false points at Settings → league docs', () => {
  assert.strictEqual(item(ready(), 'constitution_on_file').done, true);
  const it = item(ready({ constitutionOnFile: false }), 'constitution_on_file');
  assert.strictEqual(it.done, false);
  assert.ok(/Settings → league docs/.test(it.detail));
});

// ── Manual checklist ────────────────────────────────────────────────
test('manual items default to done:false with the canonical labels', () => {
  reset();
  const r = ready({ manual: undefined });
  const dues = item(r, 'dues_noted');
  const rules = item(r, 'rules_reratified');
  const welcome = item(r, 'welcome_drafted');
  assert.strictEqual(dues.done, false);
  assert.strictEqual(dues.label, 'Dues noted (tracked outside DHQ)');
  assert.strictEqual(rules.done, false);
  assert.strictEqual(rules.label, 'Constitution re-ratified for the season');
  assert.strictEqual(welcome.done, false);
  assert.strictEqual(welcome.label, 'Welcome broadcast drafted');
});

test('dues detail says DHQ never handles money — it is a note-to-self', () => {
  const it = item(ready(), 'dues_noted');
  assert.ok(/never handles or tracks money/.test(it.detail));
  assert.ok(/note-to-self/.test(it.detail));
});

test('toggleManual flips + persists via the Map fallback', () => {
  reset();
  const t = Genesis.toggleManual('L1', 'dues_noted', { nowMs: 5000 });
  assert.deepStrictEqual(t, { id: 'dues_noted', done: true, ts: 5000 });
  assert.ok(Genesis._mem.has('commish_genesis_L1'), 'persisted under commish_genesis_<leagueId>');
  const r = ready({ manual: undefined });
  assert.strictEqual(item(r, 'dues_noted').done, true, 'buildReadiness reads the stored toggle');
  assert.strictEqual(item(r, 'rules_reratified').done, false, 'other items untouched');
});

test('toggleManual twice returns to false and re-stamps ts', () => {
  reset();
  Genesis.toggleManual('L1', 'welcome_drafted', { nowMs: 5000 });
  const t = Genesis.toggleManual('L1', 'welcome_drafted', { nowMs: 6000 });
  assert.deepStrictEqual(t, { id: 'welcome_drafted', done: false, ts: 6000 });
  assert.strictEqual(item(ready({ manual: undefined }), 'welcome_drafted').done, false);
});

test('toggleManual rejects unknown items and missing league ids', () => {
  reset();
  assert.strictEqual(Genesis.toggleManual('L1', 'pay_the_pot', { nowMs: 5000 }), null, 'no invented items — and never money');
  assert.strictEqual(Genesis.toggleManual('', 'dues_noted', { nowMs: 5000 }), null);
  assert.ok(!Genesis._mem.has('commish_genesis_L1'), 'nothing persisted on rejection');
});

test('manual state is per-league — L2 toggles never bleed into L1', () => {
  reset();
  Genesis.toggleManual('L2', 'dues_noted', { nowMs: 5000 });
  assert.strictEqual(item(ready({ manual: undefined }), 'dues_noted').done, false);
});

test('manual param overrides storage when provided (test seam)', () => {
  reset();
  Genesis.toggleManual('L1', 'dues_noted', { nowMs: 5000 }); // storage says true
  const r = ready({ manual: { dues_noted: false, rules_reratified: true } });
  assert.strictEqual(item(r, 'dues_noted').done, false, 'param wins over storage');
  assert.strictEqual(item(r, 'rules_reratified').done, true);
  assert.strictEqual(item(r, 'welcome_drafted').done, false, 'unlisted param items read false');
});

test('manualDefaults returns fresh copies (mutations never leak)', () => {
  const a = Genesis.manualDefaults();
  a[0].label = 'HACKED';
  a[0].done = true;
  const b = Genesis.manualDefaults();
  assert.strictEqual(b[0].label, 'Dues noted (tracked outside DHQ)');
  assert.strictEqual(b[0].done, false);
});

// ── pct math ────────────────────────────────────────────────────────
test('pct = round(100 × done/total) across auto + manual', () => {
  reset();
  // All 6 auto done, 0 of 3 manual → 6/9 = 66.67 → 67.
  const r = ready({ manual: {} });
  assert.strictEqual(r.pct, 67);
  // 8 of 9 → 88.89 → 89.
  const r2 = ready({ manual: { dues_noted: true, rules_reratified: true } });
  assert.strictEqual(r2.pct, 89);
});

test('shell league blocks on everything except seats (no open-seat entries = filled)', () => {
  reset();
  const r = Genesis.buildReadiness({
    league: { league_id: 'L9', name: 'Shell', settings: {}, rosters: [] },
    calendarEvents: [], driftResult: null, seats: [], constitutionOnFile: false, nowMs: NOW,
  });
  // all_seats_filled reads done — the graph reported no open seats — so 1/9 = 11.
  assert.strictEqual(r.pct, 11);
  assert.strictEqual(r.blockers.length, 8);
  assert.ok(!r.blockers.includes('All seats filled'));
});

// ── Blockers: worst first ───────────────────────────────────────────
test('blockers order structure before paperwork', () => {
  reset();
  const r = Genesis.buildReadiness({
    league: { league_id: 'L1', name: 'Dynasty Prime', settings: {}, rosters: [] },
    calendarEvents: [],
    driftResult: null,
    seats: [{ leagueId: 'L1', leagueName: 'Dynasty Prime', rosterId: 3, reason: 'unowned' }],
    constitutionOnFile: false,
    manual: {},
    nowMs: NOW,
  });
  assert.deepStrictEqual(r.blockers, [
    'Rosters present',
    'All seats filled',
    'Draft scheduled',
    'Settings ratified (no unacknowledged drift)',
    'Trade deadline set',
    'Constitution on file',
    'Constitution re-ratified for the season',
    'Dues noted (tracked outside DHQ)',
    'Welcome broadcast drafted',
  ]);
});

test('a done item never appears among the blockers', () => {
  const r = ready({ constitutionOnFile: false });
  assert.deepStrictEqual(r.blockers, ['Constitution on file']);
});

// ── buildAll ────────────────────────────────────────────────────────
test('buildAll sorts lowest pct first — the neediest league leads', () => {
  reset();
  const good = mkLeague(); // L1, fully green below
  const bad = { league_id: 'L2', name: 'Abandoned', settings: {}, rosters: [] };
  const out = Genesis.buildAll({
    leagues: [good, bad],
    calendarEvents: [draftEvent()],
    driftByLeague: { L1: CLEAN_DRIFT, L2: null },
    seats: [],
    constitutionByLeague: { L1: true },
    nowMs: NOW,
  });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].leagueId, 'L2', 'worst league first');
  assert.ok(out[0].pct < out[1].pct);
});

test('buildAll routes per-league drift + constitution and skips id-less leagues', () => {
  reset();
  const l1 = mkLeague();
  const l2 = mkLeague({ league_id: 'L2', name: 'Second' });
  const out = Genesis.buildAll({
    leagues: [l1, l2, { name: 'ghost' }],
    calendarEvents: [draftEvent(), draftEvent({ leagueId: 'L2' })],
    driftByLeague: { L1: CLEAN_DRIFT, L2: { firstRun: false, changes: [{ path: 'scoring.rec' }] } },
    seats: [],
    constitutionByLeague: { L1: true, L2: false },
    nowMs: NOW,
  });
  assert.strictEqual(out.length, 2, 'ghost league skipped');
  const r1 = out.find(r => r.leagueId === 'L1');
  const r2 = out.find(r => r.leagueId === 'L2');
  assert.strictEqual(item(r1, 'settings_ratified').done, true);
  assert.strictEqual(item(r2, 'settings_ratified').done, false, 'L2 drift pending');
  assert.strictEqual(item(r1, 'constitution_on_file').done, true);
  assert.strictEqual(item(r2, 'constitution_on_file').done, false);
  assert.strictEqual(out[0].leagueId, 'L2', 'lower pct leads');
});

test('buildAll ties break alphabetically for a stable board', () => {
  reset();
  const a = { league_id: 'LA', name: 'Alpha', settings: {}, rosters: [] };
  const b = { league_id: 'LB', name: 'Beta', settings: {}, rosters: [] };
  const out = Genesis.buildAll({ leagues: [b, a], calendarEvents: [], driftByLeague: {}, seats: [], constitutionByLeague: {}, nowMs: NOW });
  assert.deepStrictEqual(out.map(r => r.leagueName), ['Alpha', 'Beta']);
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
