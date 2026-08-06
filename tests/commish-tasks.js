#!/usr/bin/env node
// Tests for the commissioner's manual board: hand-added tasks, milestones
// and events layered onto the auto-derived Master Calendar.
'use strict';

const assert = require('assert');
const Tasks = require('../js/shared/commish-tasks.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  Tasks._reset();
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── add / list ───────────────────────────────────────────────────
test('add: rejects a blank title', () => {
  assert.strictEqual(Tasks.add({ title: '   ' }, { nowMs: 1 }), null);
  assert.strictEqual(Tasks.add({}, { nowMs: 1 }), null);
  assert.deepStrictEqual(Tasks.list(), []);
});

test('add: defaults type to task, trims title/note, unknown type falls back', () => {
  const item = Tasks.add({ title: '  Collect dues  ', note: '  by the 15th  ', type: 'bogus' }, { nowMs: 100 });
  assert.strictEqual(item.title, 'Collect dues');
  assert.strictEqual(item.note, 'by the 15th');
  assert.strictEqual(item.type, 'task');
  assert.strictEqual(item.done, false);
  assert.strictEqual(item.dueTs, null);
  assert.strictEqual(item.leagueId, null);
  assert.strictEqual(item.createdTs, 100);
});

test('add: accepts milestone/event types, a due date and a league scope', () => {
  const item = Tasks.add({ title: 'Vote on playoff format', type: 'milestone', dueTs: 5000, leagueId: 'L1' }, { nowMs: 1 });
  assert.strictEqual(item.type, 'milestone');
  assert.strictEqual(item.dueTs, 5000);
  assert.strictEqual(item.leagueId, 'L1');
});

test('list: newest add first', () => {
  Tasks.add({ title: 'first' }, { nowMs: 1 });
  Tasks.add({ title: 'second' }, { nowMs: 2 });
  const titles = Tasks.list().map(t => t.title);
  assert.deepStrictEqual(titles, ['second', 'first']);
});

// ── toggleDone / remove ────────────────────────────────────────────
test('toggleDone: flips done and stamps doneTs; unknown id is a no-op returning null', () => {
  const item = Tasks.add({ title: 'welcome email' }, { nowMs: 1 });
  const on = Tasks.toggleDone(item.id, { nowMs: 50 });
  assert.strictEqual(on.done, true);
  assert.strictEqual(on.doneTs, 50);
  const off = Tasks.toggleDone(item.id, { nowMs: 60 });
  assert.strictEqual(off.done, false);
  assert.strictEqual(off.doneTs, null);
  assert.strictEqual(Tasks.toggleDone('nope', { nowMs: 1 }), null);
});

test('remove: deletes the item and reports whether anything was removed', () => {
  const item = Tasks.add({ title: 'x' }, { nowMs: 1 });
  assert.strictEqual(Tasks.remove('nope'), false);
  assert.strictEqual(Tasks.remove(item.id), true);
  assert.deepStrictEqual(Tasks.list(), []);
});

// ── asEvents / mergeSorted ───────────────────────────────────────
test('asEvents: shapes items like Calendar.buildCalendar output, with custom:true', () => {
  Tasks.add({ title: 'Collect dues', type: 'task', dueTs: 1000, leagueId: 'L1', note: 'FAAB' }, { nowMs: 1 });
  Tasks.add({ title: 'Cross-league mixer', type: 'event' }, { nowMs: 2 }); // no league, no date
  const events = Tasks.asEvents(Tasks.list(), { leagueNameOf: id => (id === 'L1' ? 'Alpha' : null), nowMs: 2000 });
  const dues = events.find(e => e.label.startsWith('Collect dues'));
  assert.strictEqual(dues.type, 'task');
  assert.strictEqual(dues.leagueId, 'L1');
  assert.strictEqual(dues.leagueName, 'Alpha');
  assert.strictEqual(dues.ts, 1000);
  assert.strictEqual(dues.custom, true);
  assert.strictEqual(dues.past, true); // 1000 < nowMs 2000
  assert.strictEqual(dues.label, 'Collect dues — FAAB');
  const mixer = events.find(e => e.label === 'Cross-league mixer');
  assert.strictEqual(mixer.leagueId, null);
  assert.strictEqual(mixer.leagueName, 'All leagues');
  assert.strictEqual(mixer.ts, null);
  assert.strictEqual(mixer.past, false); // null ts never counts as past
});

test('asEvents: an unknown leagueId falls back to "League <id>" rather than null', () => {
  Tasks.add({ title: 'x', leagueId: 'L9' }, { nowMs: 1 });
  const [ev] = Tasks.asEvents(Tasks.list(), { leagueNameOf: () => null });
  assert.strictEqual(ev.leagueName, 'League L9');
});

test('mergeSorted: interleaves auto + manual by ts, null-ts sinks last', () => {
  const auto = [
    { type: 'draft', ts: 3000, label: 'draft' },
    { type: 'deadline', ts: 1000, label: 'deadline' },
    { type: 'draft', ts: null, label: 'tbd draft' },
  ];
  const manual = Tasks.asEvents([
    { id: 't1', title: 'mid task', type: 'task', dueTs: 2000, leagueId: null, done: false },
    { id: 't2', title: 'no date task', type: 'task', dueTs: null, leagueId: null, done: false },
  ], { leagueNameOf: () => null, nowMs: 0 });
  const merged = Tasks.mergeSorted(auto, manual);
  const dated = merged.filter(e => e.ts != null).map(e => e.ts);
  assert.deepStrictEqual(dated, [1000, 2000, 3000]);
  const nullTs = merged.filter(e => e.ts == null);
  assert.strictEqual(nullTs.length, 2);
});

// ── Summary ──────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.e && f.e.message}`));
  process.exit(1);
}
