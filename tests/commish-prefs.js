#!/usr/bin/env node
// Tests for the office preference layer: managed leagues, alert prefs, and
// per-item state. The signature rule is the one that matters most — "done"
// must not blind the commissioner to a problem that later gets worse.
'use strict';

const assert = require('assert');
const Prefs = require('../js/shared/commish-prefs.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  Prefs._reset();
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const item = (over) => Object.assign({
  id: 'drift:L1', domain: 'operations', hub: 'ops', tier: 'NOW',
  leagueIds: ['L1'], metric: { value: 2, unit: 'changes', breach: true },
}, over || {});

// ── Managed leagues ─────────────────────────────────────────────────
test('leagues are managed by default (opt-out, never opt-in)', () => {
  assert.strictEqual(Prefs.isManaged('L1'), true, 'an unseen league is managed');
  const kept = Prefs.managedFilter([{ league_id: 'L1' }, { id: 'L2' }]);
  assert.strictEqual(kept.length, 2);
});

test('switching a league off removes it and persists', () => {
  Prefs.setManaged('L2', false);
  assert.strictEqual(Prefs.isManaged('L2'), false);
  assert.strictEqual(Prefs.isManaged('L1'), true, 'others untouched');
  const kept = Prefs.managedFilter([{ league_id: 'L1' }, { league_id: 'L2' }]);
  assert.deepStrictEqual(kept.map(l => l.league_id), ['L1']);
  Prefs.setManaged('L2', true);
  assert.strictEqual(Prefs.isManaged('L2'), true, 'and back on again');
});

// ── Alert preferences ───────────────────────────────────────────────
test('all domains alert by default at the lowest floor', () => {
  const a = Prefs.getAlerts();
  assert.strictEqual(a.floor, 'BACKLOG');
  Prefs.DOMAINS.forEach(d => assert.strictEqual(a.domains[d], true, d + ' on'));
});

test('a domain switched off is silenced; floor raises the bar', () => {
  Prefs.setDomainAlert('people', false);
  Prefs.setFloor('NOW');
  const a = Prefs.getAlerts();
  assert.strictEqual(a.domains.people, false);
  assert.strictEqual(a.domains.operations, true);
  assert.strictEqual(a.floor, 'NOW');
  Prefs.setFloor('nonsense');
  assert.strictEqual(Prefs.getAlerts().floor, 'BACKLOG', 'a bad tier falls back, never throws');
});

// ── Item state + the signature rule ─────────────────────────────────
test('done suppresses the item while the problem is unchanged', () => {
  const it = item();
  Prefs.markDone(it, { nowMs: 1000 });
  const { visible, suppressed } = Prefs.applyStates([it], { states: Prefs.allItemStates(), nowMs: 2000 });
  assert.strictEqual(visible.length, 0);
  assert.deepStrictEqual(suppressed[0].reasons, ['done']);
});

test('done RELEASES when the underlying number moves — the honesty rule', () => {
  const before = item({ metric: { value: 2, unit: 'changes' } });
  Prefs.markDone(before, { nowMs: 1000 });
  const worse = item({ metric: { value: 5, unit: 'changes' } });  // 2 changes became 5
  const { visible } = Prefs.applyStates([worse], { states: Prefs.allItemStates(), nowMs: 2000 });
  assert.strictEqual(visible.length, 1, 'a resolved item that got worse comes back as new work');
});

test('skip snoozes until its deadline, then returns on its own', () => {
  const it = item();
  Prefs.skip(it, { nowMs: 0, days: 7 });
  assert.strictEqual(Prefs.applyStates([it], { states: Prefs.allItemStates(), nowMs: 6 * 86400000 }).visible.length, 0, 'still snoozed on day 6');
  assert.strictEqual(Prefs.applyStates([it], { states: Prefs.allItemStates(), nowMs: 8 * 86400000 }).visible.length, 1, 'back on day 8');
});

test('hidden stays hidden regardless of age, but is recoverable', () => {
  const it = item();
  Prefs.hide(it, { nowMs: 0 });
  const far = Prefs.applyStates([it], { states: Prefs.allItemStates(), nowMs: 400 * 86400000 });
  assert.strictEqual(far.visible.length, 0);
  assert.strictEqual(far.suppressed[0].state, 'hidden');
  Prefs.restore(it.id);
  assert.strictEqual(Prefs.applyStates([it], { states: Prefs.allItemStates(), nowMs: 0 }).visible.length, 1, 'Settings can always bring it back');
});

// ── The filter ──────────────────────────────────────────────────────
test('filter suppresses by unmanaged league, domain switch and floor', () => {
  const rows = [
    item({ id: 'a', leagueIds: ['L1'], domain: 'operations', tier: 'NOW' }),
    item({ id: 'b', leagueIds: ['L2'], domain: 'operations', tier: 'NOW' }),
    item({ id: 'c', leagueIds: ['L1'], domain: 'people', tier: 'NOW' }),
    item({ id: 'd', leagueIds: ['L1'], domain: 'operations', tier: 'BACKLOG' }),
  ];
  const out = Prefs.applyStates(rows, {
    states: {}, nowMs: 0,
    managedIds: new Set(['L1']),
    alerts: { domains: { operations: true, people: false }, floor: 'SOON' },
  });
  assert.deepStrictEqual(out.visible.map(i => i.id), ['a']);
  const why = {};
  out.suppressed.forEach(s => { why[s.item.id] = s.reasons; });
  assert.deepStrictEqual(why.b, ['unmanaged']);
  assert.deepStrictEqual(why.c, ['domain-off']);
  assert.deepStrictEqual(why.d, ['below-floor']);
});

test('a multi-league item survives if ANY of its leagues is managed', () => {
  const it = item({ id: 'x', leagueIds: ['L1', 'L2'] });
  const out = Prefs.applyStates([it], { states: {}, nowMs: 0, managedIds: new Set(['L2']) });
  assert.strictEqual(out.visible.length, 1, 'a person dark in two leagues still matters if you manage one');
});

test('countTiers recounts over the filtered set, so pills match the rows', () => {
  const c = Prefs.countTiers([item({ tier: 'NOW' }), item({ tier: 'SOON' }), item({ tier: 'SOON' }), item({ tier: 'BACKLOG' })]);
  assert.deepStrictEqual(c, { now: 1, soon: 2, backlog: 1 });
});

test('filter never throws on junk input', () => {
  assert.deepStrictEqual(Prefs.applyStates(null, {}).visible, []);
  assert.deepStrictEqual(Prefs.applyStates(undefined, undefined).suppressed, []);
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
