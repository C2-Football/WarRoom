#!/usr/bin/env node
// Unit tests for Roster Cutdown Day (js/shared/roster-cutdown.js): rule
// get/set/clear round-trip, validation, days-until/near-window status, and
// the overage calculation My Roster's drop-alert engine relies on. All
// storage goes through the engine's internal Map fallback (_mem) — no
// DhqStorage, no localStorage, no network.
'use strict';

const assert = require('assert');
const Cutdown = require('../js/shared/roster-cutdown.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

function reset() { Cutdown._mem && Cutdown._mem.clear(); }

test('getRule returns null when unset', () => {
  reset();
  assert.strictEqual(Cutdown.getRule('L1'), null);
});

test('setRule persists and round-trips through getRule', () => {
  reset();
  const rec = Cutdown.setRule('L1', { activeSlots: 42, taxiSlots: 10, effectiveDate: '2026-09-02' }, 'commissioner');
  assert.ok(rec);
  assert.strictEqual(rec.activeSlots, 42);
  assert.strictEqual(rec.taxiSlots, 10);
  assert.strictEqual(rec.effectiveDate, '2026-09-02');
  assert.strictEqual(rec.setBy, 'commissioner');
  const got = Cutdown.getRule('L1');
  assert.deepStrictEqual(got, rec);
});

test('setRule defaults setBy to commissioner for any non-"owner" value', () => {
  reset();
  const rec = Cutdown.setRule('L1', { activeSlots: 42, taxiSlots: 10, effectiveDate: '2026-09-02' }, 'bogus');
  assert.strictEqual(rec.setBy, 'commissioner');
});

test('setRule tags owner-sourced records', () => {
  reset();
  const rec = Cutdown.setRule('L1', { activeSlots: 42, taxiSlots: 10, effectiveDate: '2026-09-02' }, 'owner');
  assert.strictEqual(rec.setBy, 'owner');
});

test('setRule rejects missing activeSlots or effectiveDate', () => {
  reset();
  assert.strictEqual(Cutdown.setRule('L1', { taxiSlots: 10, effectiveDate: '2026-09-02' }, 'owner'), null);
  assert.strictEqual(Cutdown.setRule('L1', { activeSlots: 42, taxiSlots: 10 }, 'owner'), null);
});

test('setRule floors negative/fractional slot counts', () => {
  reset();
  const rec = Cutdown.setRule('L1', { activeSlots: 42.7, taxiSlots: -3, effectiveDate: '2026-09-02' }, 'owner');
  assert.strictEqual(rec.activeSlots, 43); // Math.round(42.7)
  assert.strictEqual(rec.taxiSlots, 0);
});

test('clearRule removes the record', () => {
  reset();
  Cutdown.setRule('L1', { activeSlots: 42, taxiSlots: 10, effectiveDate: '2026-09-02' }, 'owner');
  Cutdown.clearRule('L1');
  assert.strictEqual(Cutdown.getRule('L1'), null);
});

test('rules are scoped per league', () => {
  reset();
  Cutdown.setRule('L1', { activeSlots: 42, taxiSlots: 10, effectiveDate: '2026-09-02' }, 'owner');
  assert.strictEqual(Cutdown.getRule('L2'), null);
});

test('status returns null with no rule', () => {
  assert.strictEqual(Cutdown.status(null, Date.now()), null);
});

test('status computes daysUntil, isPast, isNear', () => {
  const now = new Date('2026-08-20T12:00:00').getTime();
  const rule = { activeSlots: 42, taxiSlots: 10, effectiveDate: '2026-09-02' };
  const s = Cutdown.status(rule, now);
  assert.strictEqual(s.daysUntil, 13);
  assert.strictEqual(s.isPast, false);
  assert.strictEqual(s.isNear, true); // <= NEAR_DAYS (14)

  const farRule = { ...rule, effectiveDate: '2026-12-01' };
  const sFar = Cutdown.status(farRule, now);
  assert.strictEqual(sFar.isNear, false);

  const pastRule = { ...rule, effectiveDate: '2026-08-01' };
  const sPast = Cutdown.status(pastRule, now);
  assert.strictEqual(sPast.isPast, true);
  assert.strictEqual(sPast.isNear, true); // past counts as near
});

test('overage is 0 with no rule or when under the cap', () => {
  assert.strictEqual(Cutdown.overage(null, 60), 0);
  const rule = { activeSlots: 42, taxiSlots: 10 };
  assert.strictEqual(Cutdown.overage(rule, 52), 0);
  assert.strictEqual(Cutdown.overage(rule, 40), 0);
});

test('overage counts rostered players past activeSlots + taxiSlots', () => {
  const rule = { activeSlots: 42, taxiSlots: 10 };
  assert.strictEqual(Cutdown.overage(rule, 58), 6);
});

console.log('\nRoster Cutdown (js/shared/roster-cutdown.js)');
if (failed) {
  console.log(`\n${failed} FAILED, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n✓ ${passed} passed`);
}
