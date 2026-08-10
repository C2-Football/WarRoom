#!/usr/bin/env node
'use strict';
const assert = require('assert');
global.App = {};
const D = require('../js/shared/empire-decisions.js');

let passed = 0;
function test(name, fn) {
  try { D._reset(); fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const move = { type:'sell', leagueId:'L1', leagueName:'Alpha', pid:'p1', ownerName:'Rival', title:'Sell Veteran to Rival', why:'Trim exposure.', accept:68, value:420 };

test('track captures recommendation context once', () => {
  const a = D.track(move, { nowMs:10 });
  const b = D.track(move, { nowMs:20 });
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(D.list().length, 1);
  assert.strictEqual(a.estimatedDelta, 420);
  assert.strictEqual(a.status, 'WATCHING');
});
test('update records workflow, review date, note and realized delta', () => {
  const a = D.track(move, { nowMs:10 });
  const b = D.update(a.id, { status:'won', reviewAt:'2026-09-01', note:'Closed.', actualDelta:'515' }, { nowMs:20 });
  assert.strictEqual(b.status, 'WON');
  assert.strictEqual(b.actualDelta, 515);
  assert.strictEqual(b.updatedAt, 20);
  assert.strictEqual(D.update(a.id, { actualDelta:null }).actualDelta, null);
});
test('summary separates active and terminal decisions', () => {
  const a = D.track(move, { nowMs:10 });
  const b = D.track({ ...move, pid:'p2', title:'Acquire Rookie' }, { nowMs:11 });
  D.update(a.id, { status:'WON', actualDelta:300 }, { nowMs:12 });
  D.update(b.id, { status:'LOST', actualDelta:-80 }, { nowMs:13 });
  assert.deepStrictEqual(D.summary(), { total:2, active:0, closed:2, won:1, lost:1, realizedDelta:220 });
});
test('remove is explicit and safe', () => {
  const a = D.track(move);
  assert.strictEqual(D.remove(a.id), true);
  assert.strictEqual(D.remove(a.id), false);
  assert.strictEqual(D.list().length, 0);
});

if (!process.exitCode) console.log('\nPASS ' + passed + ' tests');
