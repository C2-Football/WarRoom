#!/usr/bin/env node
// Unit tests for the Treasury (js/shared/commish-treasury.js): dues
// BOOKKEEPING only — DHQ never handles, collects, or moves money; these
// tests cover who-is-marked-paid bookkeeping, link validation, and CSV
// mapping. All storage goes through the engine's internal Map fallback
// (_mem) — no DhqStorage, no localStorage, no network.
'use strict';

const assert = require('assert');
const Treasury = require('../js/shared/commish-treasury.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

function reset() { Treasury._mem.clear(); }

// Member-graph fixture in the App.Commish.buildMemberGraph shape (only the
// fields the Treasury reads: people keyed by userId, with name + leagueIds).
function mkGraph() {
  return {
    people: {
      u1: { userId: 'u1', name: 'Jake', leagueIds: ['L1', 'L2'], leagueCount: 2 },
      u2: { userId: 'u2', name: 'Sam Smith', leagueIds: ['L1'], leagueCount: 1 },
      u3: { userId: 'u3', name: 'Alexis', leagueIds: ['L1'], leagueCount: 1 },
      u4: { userId: 'u4', name: 'Elsewhere', leagueIds: ['L2'], leagueCount: 1 },
    },
    overlap: [], seats: [],
  };
}
function peopleOf(graph, lid) {
  return Object.values(graph.people).filter(p => p.leagueIds.includes(lid));
}

// ── URL validation ──────────────────────────────────────────────────
test('leaguesafe.com https URL is accepted and stored', () => {
  reset();
  assert.strictEqual(Treasury.setLeagueSafeUrl('L1', 'https://leaguesafe.com/pool/12345', { nowMs: 1000 }), true);
  assert.strictEqual(Treasury.getLedger('L1').leagueSafeUrl, 'https://leaguesafe.com/pool/12345');
  assert.strictEqual(Treasury.getLedger('L1').updatedAt, 1000);
});

test('www.leaguesafe.com is accepted (subdomains of the trusted host)', () => {
  reset();
  assert.strictEqual(Treasury.setLeagueSafeUrl('L1', 'https://www.leaguesafe.com/pool/12345', { nowMs: 1000 }), true);
  assert.strictEqual(Treasury.getLedger('L1').leagueSafeUrl, 'https://www.leaguesafe.com/pool/12345');
});

test('evil.com is rejected and NOTHING is stored', () => {
  reset();
  assert.strictEqual(Treasury.setLeagueSafeUrl('L1', 'https://evil.com/leaguesafe.com/pool', { nowMs: 1000 }), false);
  assert.strictEqual(Treasury.getLedger('L1').leagueSafeUrl, null);
  assert.ok(!Treasury._mem.has('commish_treasury_L1'), 'rejected URL never touches storage');
});

test('lookalike host evilleaguesafe.com is rejected (endsWith is not enough)', () => {
  reset();
  assert.strictEqual(Treasury.setLeagueSafeUrl('L1', 'https://evilleaguesafe.com/pool', { nowMs: 1000 }), false);
  assert.strictEqual(Treasury.getLedger('L1').leagueSafeUrl, null);
});

test('http:// (non-https) leaguesafe URL is rejected', () => {
  reset();
  assert.strictEqual(Treasury.setLeagueSafeUrl('L1', 'http://leaguesafe.com/pool/1', { nowMs: 1000 }), false);
  assert.strictEqual(Treasury.getLedger('L1').leagueSafeUrl, null);
});

test('unparseable URL is rejected, null clears an existing link', () => {
  reset();
  assert.strictEqual(Treasury.setLeagueSafeUrl('L1', 'not a url at all', { nowMs: 1000 }), false);
  Treasury.setLeagueSafeUrl('L1', 'https://leaguesafe.com/pool/1', { nowMs: 1000 });
  assert.strictEqual(Treasury.setLeagueSafeUrl('L1', null, { nowMs: 2000 }), true);
  assert.strictEqual(Treasury.getLedger('L1').leagueSafeUrl, null, 'null clears the link');
});

test('sheet URL: docs.google.com accepted, other Google hosts and http rejected', () => {
  reset();
  const pub = 'https://docs.google.com/spreadsheets/d/e/KEY/pub?output=csv';
  assert.strictEqual(Treasury.setSheetUrl('L1', pub, { nowMs: 1000 }), true);
  assert.strictEqual(Treasury.getLedger('L1').sheetUrl, pub);
  assert.strictEqual(Treasury.setSheetUrl('L1', 'https://drive.google.com/file/d/x', { nowMs: 1000 }), false);
  assert.strictEqual(Treasury.setSheetUrl('L1', 'http://docs.google.com/spreadsheets/d/e/KEY/pub', { nowMs: 1000 }), false);
  assert.strictEqual(Treasury.getLedger('L1').sheetUrl, pub, 'rejects leave the stored link untouched');
});

test('leagueSafe and sheet links live side by side in one ledger', () => {
  reset();
  Treasury.setLeagueSafeUrl('L1', 'https://leaguesafe.com/pool/1', { nowMs: 1000 });
  Treasury.setSheetUrl('L1', 'https://docs.google.com/spreadsheets/d/e/K/pub', { nowMs: 2000 });
  const led = Treasury.getLedger('L1');
  assert.strictEqual(led.leagueSafeUrl, 'https://leaguesafe.com/pool/1');
  assert.strictEqual(led.sheetUrl, 'https://docs.google.com/spreadsheets/d/e/K/pub');
  assert.strictEqual(led.updatedAt, 2000);
});

// ── markPaid upsert ─────────────────────────────────────────────────
test('markPaid creates an entry with paid/note/ts', () => {
  reset();
  const e = Treasury.markPaid('L1', 'u1', { paid: true, note: 'venmo 8/1', nowMs: 5000 });
  assert.deepStrictEqual(e, { paid: true, note: 'venmo 8/1', ts: 5000 });
  assert.deepStrictEqual(Treasury.getLedger('L1').entries.u1, { paid: true, note: 'venmo 8/1', ts: 5000 });
  assert.strictEqual(Treasury.getLedger('L1').updatedAt, 5000);
});

test('markPaid upsert: flipping paid keeps the existing note', () => {
  reset();
  Treasury.markPaid('L1', 'u1', { paid: true, note: 'venmo 8/1', nowMs: 5000 });
  const e = Treasury.markPaid('L1', 'u1', { paid: false, nowMs: 6000 });
  assert.deepStrictEqual(e, { paid: false, note: 'venmo 8/1', ts: 6000 }, 'note survives a paid-only update');
});

test('markPaid upsert: adding a note keeps the existing paid flag', () => {
  reset();
  Treasury.markPaid('L1', 'u1', { paid: true, nowMs: 5000 });
  const e = Treasury.markPaid('L1', 'u1', { note: 'confirmed on LeagueSafe', nowMs: 6000 });
  assert.deepStrictEqual(e, { paid: true, note: 'confirmed on LeagueSafe', ts: 6000 }, 'paid survives a note-only update');
});

test('markPaid with a missing leagueId or userId returns null, stores nothing', () => {
  reset();
  assert.strictEqual(Treasury.markPaid('', 'u1', { paid: true, nowMs: 1000 }), null);
  assert.strictEqual(Treasury.markPaid('L1', null, { paid: true, nowMs: 1000 }), null);
  assert.strictEqual(Treasury._mem.size, 0);
});

// ── buildTreasury (pure) ────────────────────────────────────────────
test('buildTreasury lists EVERY league member; unmarked appear paid:false', () => {
  reset();
  const out = Treasury.buildTreasury({ graph: mkGraph(), leagueId: 'L1', ledger: Treasury.getLedger('L1') });
  assert.strictEqual(out.rows.length, 3, 'u1,u2,u3 are in L1');
  for (const r of out.rows) {
    assert.strictEqual(r.paid, false);
    assert.strictEqual(r.note, '');
    assert.strictEqual(r.ts, null);
  }
  assert.deepStrictEqual(out.summary, { paid: 0, total: 3, pct: 0 });
});

test('buildTreasury excludes members of other leagues', () => {
  const out = Treasury.buildTreasury({ graph: mkGraph(), leagueId: 'L1', ledger: { entries: {} } });
  assert.ok(!out.rows.some(r => r.userId === 'u4'), 'u4 is L2-only');
  const l2 = Treasury.buildTreasury({ graph: mkGraph(), leagueId: 'L2', ledger: { entries: {} } });
  assert.deepStrictEqual(l2.rows.map(r => r.userId).sort(), ['u1', 'u4']);
});

test('buildTreasury sorts unpaid-first, then by name', () => {
  reset();
  Treasury.markPaid('L1', 'u3', { paid: true, note: 'cash', nowMs: 100 }); // Alexis paid
  const out = Treasury.buildTreasury({ graph: mkGraph(), leagueId: 'L1', ledger: Treasury.getLedger('L1') });
  assert.deepStrictEqual(out.rows.map(r => r.name), ['Jake', 'Sam Smith', 'Alexis'],
    'unpaid alphabetical first, paid Alexis last');
  assert.deepStrictEqual(out.rows[2], { userId: 'u3', name: 'Alexis', paid: true, note: 'cash', ts: 100 });
});

test('buildTreasury pct math: 1/3 → 33, 2/3 → 67', () => {
  reset();
  Treasury.markPaid('L1', 'u1', { paid: true, nowMs: 100 });
  let out = Treasury.buildTreasury({ graph: mkGraph(), leagueId: 'L1', ledger: Treasury.getLedger('L1') });
  assert.deepStrictEqual(out.summary, { paid: 1, total: 3, pct: 33 });
  Treasury.markPaid('L1', 'u2', { paid: true, nowMs: 200 });
  out = Treasury.buildTreasury({ graph: mkGraph(), leagueId: 'L1', ledger: Treasury.getLedger('L1') });
  assert.deepStrictEqual(out.summary, { paid: 2, total: 3, pct: 67 });
});

test('buildTreasury carries the links; empty league is total:0 pct:0', () => {
  const ledger = { leagueSafeUrl: 'https://leaguesafe.com/pool/1', sheetUrl: null, entries: {} };
  const out = Treasury.buildTreasury({ graph: mkGraph(), leagueId: 'L1', ledger });
  assert.strictEqual(out.leagueSafeUrl, 'https://leaguesafe.com/pool/1');
  assert.strictEqual(out.sheetUrl, null);
  const empty = Treasury.buildTreasury({ graph: { people: {} }, leagueId: 'L9', ledger: { entries: {} } });
  assert.deepStrictEqual(empty.summary, { paid: 0, total: 0, pct: 0 });
});

// ── parseDuesCsv ────────────────────────────────────────────────────
test('csv: "Team Name,Paid" header is detected and skipped', () => {
  const people = peopleOf(mkGraph(), 'L1');
  const r = Treasury.parseDuesCsv('Team Name,Paid\nJake,yes\nSam Smith,no\n', people);
  assert.deepStrictEqual(r.headerUsed, { nameCol: 0, paidCol: 1 });
  assert.strictEqual(r.matched.length, 2);
  assert.deepStrictEqual(r.matched[0], { userId: 'u1', name: 'Jake', paid: true, note: 'yes' });
  assert.deepStrictEqual(r.matched[1], { userId: 'u2', name: 'Sam Smith', paid: false, note: 'no' });
});

test('csv: reversed "Status,Owner" header maps nameCol:1 paidCol:0', () => {
  const people = peopleOf(mkGraph(), 'L1');
  const r = Treasury.parseDuesCsv('Status,Owner\nPaid,Jake\n,Alexis\n', people);
  assert.deepStrictEqual(r.headerUsed, { nameCol: 1, paidCol: 0 });
  assert.deepStrictEqual(r.matched, [
    { userId: 'u1', name: 'Jake', paid: true, note: 'Paid' },
    { userId: 'u3', name: 'Alexis', paid: false, note: '' },
  ]);
});

test('csv: headerless input defaults to columns 0/1 and keeps the first row', () => {
  const people = peopleOf(mkGraph(), 'L1');
  const r = Treasury.parseDuesCsv('Jake,$50\nAlexis,\n', people);
  assert.deepStrictEqual(r.headerUsed, { nameCol: 0, paidCol: 1 });
  assert.strictEqual(r.matched.length, 2, 'first row is data, not a header');
  assert.deepStrictEqual(r.matched[0], { userId: 'u1', name: 'Jake', paid: true, note: '$50' });
});

test('csv: a first ROW whose cell literally says "paid" is not eaten as a header', () => {
  const people = peopleOf(mkGraph(), 'L1');
  const r = Treasury.parseDuesCsv('Jake,paid\nSam Smith,no\n', people);
  assert.strictEqual(r.matched.length, 2, 'name cell resolves to a member → data row');
  assert.deepStrictEqual(r.matched[0], { userId: 'u1', name: 'Jake', paid: true, note: 'paid' });
});

test('csv: paid-truthy matrix', () => {
  const people = [{ userId: 'u1', name: 'Jake' }];
  const truthy = ['paid', 'PAID', 'yes', 'Y', 'y', 'true', 'x', '✓', '1', '$50', '50', '49.99', '$49.99'];
  const falsy = ['', 'no', 'unpaid', 'pending', 'owes', 'n', 'false', 'iou $50'];
  for (const v of truthy) {
    const r = Treasury.parseDuesCsv('Jake,' + v, people);
    assert.strictEqual(r.matched[0].paid, true, JSON.stringify(v) + ' should read as paid');
  }
  for (const v of falsy) {
    const r = Treasury.parseDuesCsv('Jake,' + v, people);
    assert.strictEqual(r.matched[0].paid, false, JSON.stringify(v) + ' should read as unpaid');
  }
});

test('csv: exact display-name match is case-insensitive', () => {
  const people = peopleOf(mkGraph(), 'L1');
  const r = Treasury.parseDuesCsv('SAM SMITH,paid\n', people);
  assert.deepStrictEqual(r.matched, [{ userId: 'u2', name: 'Sam Smith', paid: true, note: 'paid' }]);
});

test('csv: containment matches in either direction', () => {
  const people = peopleOf(mkGraph(), 'L1');
  // CSV name contains the member name ("Jake C" ⊇ "Jake") …
  const a = Treasury.parseDuesCsv('Jake C,paid\n', people);
  assert.deepStrictEqual(a.matched, [{ userId: 'u1', name: 'Jake', paid: true, note: 'paid' }]);
  // … and the member name contains the CSV name ("Sam" ⊆ "Sam Smith").
  const b = Treasury.parseDuesCsv('Sam,1\n', people);
  assert.deepStrictEqual(b.matched, [{ userId: 'u2', name: 'Sam Smith', paid: true, note: '1' }]);
});

test('csv: a name containing TWO members is ambiguous → unmatched, never guessed', () => {
  const people = peopleOf(mkGraph(), 'L1');
  const r = Treasury.parseDuesCsv('Jake & Sam Smith,paid\n', people);
  assert.deepStrictEqual(r.matched, []);
  assert.deepStrictEqual(r.unmatched, ['Jake & Sam Smith']);
});

test('csv: two members sharing a display name make an exact match ambiguous', () => {
  const people = [
    { userId: 'u1', name: 'Jake' },
    { userId: 'u9', name: 'jake' }, // duplicate display name, different human
  ];
  const r = Treasury.parseDuesCsv('Jake,paid\n', people);
  assert.deepStrictEqual(r.matched, [], 'never guess between two Jakes');
  assert.deepStrictEqual(r.unmatched, ['Jake']);
});

test('csv: quoted cells with commas parse; unknown names land in unmatched', () => {
  const people = peopleOf(mkGraph(), 'L1');
  const r = Treasury.parseDuesCsv('name,dues\n"Sam Smith, Esq.","paid, via venmo"\nTotally Unknown,yes\n"Smith, Sam",yes\n', people);
  assert.deepStrictEqual(r.matched, [{ userId: 'u2', name: 'Sam Smith', paid: false, note: 'paid, via venmo' }],
    'quoted comma cell is ONE cell; "paid, via venmo" is a note, not a bare paid token');
  assert.deepStrictEqual(r.unmatched, ['Totally Unknown', 'Smith, Sam'],
    'reordered "Smith, Sam" is NOT containment-matched — no token juggling, no guessing');
});

// ── applyCsv ────────────────────────────────────────────────────────
test('applyCsv marks every matched entry and returns the count', () => {
  reset();
  const people = peopleOf(mkGraph(), 'L1');
  const parsed = Treasury.parseDuesCsv('Jake,paid\nSam Smith,no\nTotally Unknown,yes\n', people);
  const n = Treasury.applyCsv('L1', parsed, { nowMs: 7000 });
  assert.strictEqual(n, 2, 'unmatched rows are never applied');
  const led = Treasury.getLedger('L1');
  assert.deepStrictEqual(led.entries.u1, { paid: true, note: 'paid', ts: 7000 });
  assert.deepStrictEqual(led.entries.u2, { paid: false, note: 'no', ts: 7000 });
  assert.strictEqual(led.updatedAt, 7000);
});

test('applyCsv with nothing matched (or nothing at all) returns 0', () => {
  reset();
  assert.strictEqual(Treasury.applyCsv('L1', { matched: [], unmatched: ['x'] }, { nowMs: 1 }), 0);
  assert.strictEqual(Treasury.applyCsv('L1', null, { nowMs: 1 }), 0);
  assert.strictEqual(Treasury._mem.size, 0);
});

// ── Storage semantics ───────────────────────────────────────────────
test('Map fallback stores JSON under commish_treasury_<leagueId>, no aliasing', () => {
  reset();
  Treasury.markPaid('L1', 'u1', { paid: true, nowMs: 100 });
  assert.ok(Treasury._mem.has('commish_treasury_L1'));
  const a = Treasury.getLedger('L1');
  a.entries.u1.paid = false; // mutate the returned copy…
  const b = Treasury.getLedger('L1');
  assert.strictEqual(b.entries.u1.paid, true, '…stored state is untouched (JSON round-trip)');
});

test('leagues are isolated: L2 bookkeeping never bleeds into L1', () => {
  reset();
  Treasury.markPaid('L1', 'u1', { paid: true, nowMs: 100 });
  Treasury.markPaid('L2', 'u1', { paid: false, note: 'still owes', nowMs: 200 });
  assert.strictEqual(Treasury.getLedger('L1').entries.u1.paid, true);
  assert.strictEqual(Treasury.getLedger('L2').entries.u1.paid, false);
  assert.strictEqual(Treasury.getLedger('L1').updatedAt, 100);
});

// ── fetchPublishedSheet (stubbed fetch — never the network) ─────────
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

(async () => {
  await testAsync('fetchPublishedSheet refuses non-docs.google.com and http URLs without fetching', async () => {
    let called = 0;
    globalThis.fetch = () => { called++; return Promise.resolve({ ok: true, text: () => Promise.resolve('') }); };
    assert.strictEqual(await Treasury.fetchPublishedSheet('https://evil.com/spreadsheets/pub'), null);
    assert.strictEqual(await Treasury.fetchPublishedSheet('http://docs.google.com/spreadsheets/d/e/K/pub'), null);
    assert.strictEqual(await Treasury.fetchPublishedSheet('not a url'), null);
    assert.strictEqual(called, 0, 'untrusted URLs must never be fetched');
  });

  await testAsync('fetchPublishedSheet appends output=csv to /pub links, leaves others as-is', async () => {
    const urls = [];
    globalThis.fetch = u => { urls.push(u); return Promise.resolve({ ok: true, text: () => Promise.resolve('a,b') }); };
    assert.strictEqual(await Treasury.fetchPublishedSheet('https://docs.google.com/spreadsheets/d/e/K/pub?gid=0'), 'a,b');
    assert.ok(urls[0].indexOf('output=csv') !== -1, 'pub link gains output=csv, got ' + urls[0]);
    await Treasury.fetchPublishedSheet('https://docs.google.com/spreadsheets/d/e/K/pub?output=csv');
    assert.strictEqual(urls[1], 'https://docs.google.com/spreadsheets/d/e/K/pub?output=csv', 'already-csv link untouched');
    await Treasury.fetchPublishedSheet('https://docs.google.com/spreadsheets/d/K/edit');
    assert.strictEqual(urls[2].indexOf('output=csv'), -1, 'non-pub/export link fetched as-is');
  });

  await testAsync('fetchPublishedSheet returns null on non-200 or a throwing fetch', async () => {
    globalThis.fetch = () => Promise.resolve({ ok: false });
    assert.strictEqual(await Treasury.fetchPublishedSheet('https://docs.google.com/spreadsheets/d/e/K/pub'), null);
    globalThis.fetch = () => Promise.reject(new Error('cors'));
    assert.strictEqual(await Treasury.fetchPublishedSheet('https://docs.google.com/spreadsheets/d/e/K/pub'), null,
      'CORS/network failure is a routine null — the office falls back to paste-CSV');
  });

  console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
    process.exit(1);
  }
})();
