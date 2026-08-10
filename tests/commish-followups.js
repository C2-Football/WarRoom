#!/usr/bin/env node
'use strict';
const assert = require('assert');
global.App = {};
const F = require('../js/shared/commish-followups.js');
let passed = 0;
function test(name, fn) {
  try { F._reset(); fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const item = { id:'q1', headline:'League Alpha has no draft date.', leagueIds:['L1'], leagueNames:['League Alpha'], action:{ label:'Schedule' } };

test('default message is grounded in the item and league', () => {
  const m = F.defaultMessage(item);
  assert.ok(m.includes('League Alpha'));
  assert.ok(m.includes('no draft date'));
  assert.ok(m.includes('schedule'));
});
test('save preserves editable message, note and due date', () => {
  const r = F.save(item, { message:'Custom message', note:'Asked Pat.', dueAt:'2026-08-12' }, { nowMs:10 });
  assert.strictEqual(r.message, 'Custom message');
  assert.strictEqual(r.note, 'Asked Pat.');
  assert.strictEqual(F.get('q1').dueAt, '2026-08-12');
});
test('events append and drive reversible status', () => {
  F.record(item, 'opened', '', { nowMs:10 });
  F.record(item, 'done', 'Resolved', { nowMs:20 });
  assert.strictEqual(F.get('q1').status, 'DONE');
  F.record(item, 'restored', '', { nowMs:30 });
  const r = F.get('q1');
  assert.strictEqual(r.status, 'OPEN');
  assert.deepStrictEqual(r.history.map(e => e.type), ['OPENED','DONE','RESTORED']);
});
test('summary counts open, done and due follow-ups', () => {
  F.save(item, { dueAt:'2000-01-01' }, { nowMs:10 });
  const other = { ...item, id:'q2', headline:'Second item' };
  F.save(other, { status:'DONE' }, { nowMs:20 });
  assert.deepStrictEqual(F.summary(), { total:2, open:1, done:1, due:1 });
});

if (!process.exitCode) console.log('\nPASS ' + passed + ' tests');
