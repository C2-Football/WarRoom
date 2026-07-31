#!/usr/bin/env node
// Foundation tests for the Commissioner's Office: commissioned-league
// discovery (is_owner) and the member graph (global user_id join). Pure paths
// only — hydrateCommissioned is a browser fetch helper and is not tested here.
'use strict';

const assert = require('assert');
const Commish = require('../js/shared/commish-engine.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

function league(id, name, users, rosters) {
  return { league_id: id, name, users, rosters };
}
function user(id, opts) { return { user_id: id, display_name: 'U' + id, ...(opts || {}) }; }
function roster(rid, ownerId, w, l) {
  return { roster_id: rid, owner_id: ownerId, settings: { wins: w, losses: l, ties: 0, fpts: 100 * w } };
}

const L1 = league('A', 'Alpha', [user('me', { is_owner: true }), user('dave'), user('sam')],
  [roster(1, 'me', 4, 2), roster(2, 'dave', 3, 3), roster(3, 'sam', 1, 5)]);
const L2 = league('B', 'Beta', [user('me', { is_owner: true }), user('dave', { is_owner: true }), user('pat')],
  [roster(1, 'dave', 5, 1), roster(2, 'pat', 2, 4), roster(3, 'me', 3, 3)]);
const L3 = league('C', 'Gamma', [user('other', { is_owner: true }), user('me')],
  [roster(1, 'other', 2, 2), roster(2, 'me', 2, 2)]);

test('discovery: only leagues where MY user carries is_owner', () => {
  const mine = Commish.discoverCommissioned({ leagues: [L1, L2, L3], myUserId: 'me' });
  assert.deepStrictEqual(mine.map(l => l.league_id), ['A', 'B'], 'C is played-in, not commissioned');
});

test('discovery: no user id → nothing (never guess)', () => {
  assert.deepStrictEqual(Commish.discoverCommissioned({ leagues: [L1] }), []);
});

test('graph: joins one human across leagues on user_id', () => {
  const g = Commish.buildMemberGraph({ leagues: [L1, L2], myUserId: 'me' });
  const dave = g.people['dave'];
  assert.ok(dave, 'dave exists');
  assert.strictEqual(dave.leagueCount, 2, 'dave spans both leagues');
  assert.strictEqual(dave.teams.length, 2);
  assert.ok(dave.teams.some(t => t.leagueId === 'B' && t.isCommissioner), 'dave co-commissions Beta');
  assert.ok(g.people['me'].isMe, 'me flagged');
});

test('graph: overlap lists 2+-league humans, excludes me, desc order', () => {
  const g = Commish.buildMemberGraph({ leagues: [L1, L2], myUserId: 'me' });
  assert.deepStrictEqual(g.overlap.map(o => o.userId), ['dave'], 'only dave overlaps (me excluded)');
});

test('graph: open seats — unowned roster and departed owner', () => {
  const L4 = league('D', 'Delta',
    [user('me', { is_owner: true }), user('sam')],
    [roster(1, 'me', 1, 1), roster(2, null, 0, 2), roster(3, 'ghost', 0, 2)]); // ghost not in users[]
  const g = Commish.buildMemberGraph({ leagues: [L4], myUserId: 'me' });
  assert.strictEqual(g.seats.length, 2);
  assert.deepStrictEqual(g.seats.map(s => s.reason).sort(), ['owner_left', 'unowned']);
  assert.ok(g.seats.every(s => s.leagueName === 'Delta'));
});

test('graph: records and pf carried per team', () => {
  const g = Commish.buildMemberGraph({ leagues: [L1, L2], myUserId: 'me' });
  const daveB = g.people['dave'].teams.find(t => t.leagueId === 'B');
  assert.deepStrictEqual(daveB.record, { w: 5, l: 1, t: 0 });
  assert.strictEqual(daveB.pf, 500);
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
