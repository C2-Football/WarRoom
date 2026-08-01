#!/usr/bin/env node
// Unit tests for the Bylaws Desk (js/shared/commish-bylaws.js): structural
// clause parsing across every heading style (ARTICLE/SECTION/RULE, numbered,
// Roman, ALL-CAPS, markdown), the no-heading fallback, ranked tokenized
// search with snippet windowing, the grounded ruling-context block, and the
// amendment ledger. All storage goes through the engine's internal Map
// fallback (_mem) — no DhqStorage, no localStorage, no network.
'use strict';

const assert = require('assert');
const Bylaws = require('../js/shared/commish-bylaws.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

function reset() { Bylaws._mem.clear(); }

// ── Parser: realistic multi-Article constitution ────────────────────
const CONSTITUTION = [
  'This constitution governs the Dynasty League of Record.',
  '',
  'ARTICLE 1 — MEMBERSHIP',
  'The league consists of twelve franchises. Each franchise is held by one',
  'general manager in good standing.',
  '',
  'Article 1.2 Dues',
  'Dues are one hundred dollars per season, payable before the rookie draft.',
  'The commissioner tracks who has paid; the league treasury is external.',
  '',
  'ARTICLE 2 — TRADES',
  'Trades process immediately. There is no veto. The trade deadline is the',
  'Tuesday after week eleven games conclude.',
  '',
  'SECTION 3. Waivers',
  'Waivers run on a FAAB budget of one hundred dollars. Ties in waiver bids',
  'are broken by reverse standings order. Unclaimed waiver players become',
  'free agents after waivers clear on Wednesday morning.',
].join('\n');

test('parser: realistic constitution → ids, headings, order', () => {
  const cs = Bylaws.parseClauses(CONSTITUTION);
  assert.deepStrictEqual(cs.map(c => c.id), ['preamble', 'art-1', 'art-1.2', 'art-2', 'sec-3']);
  assert.deepStrictEqual(cs.map(c => c.index), [0, 1, 2, 3, 4], 'original order preserved via index');
  assert.strictEqual(cs[1].heading, 'ARTICLE 1 — MEMBERSHIP');
  assert.strictEqual(cs[2].heading, 'Article 1.2 Dues');
  assert.strictEqual(cs[4].heading, 'SECTION 3. Waivers');
  assert.ok(cs[0].body.startsWith('This constitution governs'), 'pre-heading text becomes the preamble');
  assert.ok(cs[3].body.includes('There is no veto.'), 'body text lands under its own heading');
  assert.ok(!cs[3].body.includes('Waivers run'), 'body stops at the next heading');
});

test('parser: ALL-CAPS lines ≤ 60 chars are headings', () => {
  const cs = Bylaws.parseClauses('DUES AND PAYOUTS\nDues are bookkeeping only.\n\nTHE VETO PROCESS\nThere is none.');
  assert.strictEqual(cs.length, 2);
  assert.strictEqual(cs[0].id, 'dues-and-payouts');
  assert.strictEqual(cs[0].heading, 'DUES AND PAYOUTS');
  assert.strictEqual(cs[0].body, 'Dues are bookkeeping only.');
  assert.strictEqual(cs[1].id, 'the-veto-process');
});

test('parser: an ALL-CAPS line over 60 chars stays body text', () => {
  const shout = 'THIS ENTIRE SENTENCE IS SHOUTED BUT IT IS FAR TOO LONG TO BE A SECTION HEADING LINE';
  const cs = Bylaws.parseClauses('RULES\n' + shout);
  assert.strictEqual(cs.length, 1);
  assert.strictEqual(cs[0].body, shout);
});

test('parser: numbered and Roman heading styles', () => {
  const cs = Bylaws.parseClauses('1. Scoring\nPPR scoring applies.\n2.4) Kickers\nNo kickers.\nIV. Trades\nNo vetoes.');
  assert.deepStrictEqual(cs.map(c => c.id), ['sec-1', 'sec-2.4', 'sec-4']);
  assert.strictEqual(cs[2].heading, 'IV. Trades');
  assert.strictEqual(cs[2].body, 'No vetoes.');
});

test('parser: Roman numerals convert in ARTICLE headings', () => {
  const cs = Bylaws.parseClauses('ARTICLE IX — PLAYOFFS\nSix teams qualify.');
  assert.strictEqual(cs[0].id, 'art-9');
});

test('parser: markdown # and ## headings', () => {
  const cs = Bylaws.parseClauses('# Constitution\nIntro text.\n## Article 3 Rosters\nRosters carry 25 players.');
  assert.strictEqual(cs.length, 2);
  assert.strictEqual(cs[0].heading, 'Constitution');
  assert.strictEqual(cs[1].id, 'art-3');
  assert.strictEqual(cs[1].heading, 'Article 3 Rosters');
  assert.strictEqual(cs[1].body, 'Rosters carry 25 players.');
});

test('parser: no headings at all → single doc clause', () => {
  const text = 'We play for fun.\nBe kind to each other.\nSet your lineups.';
  const cs = Bylaws.parseClauses(text);
  assert.strictEqual(cs.length, 1);
  assert.deepStrictEqual(cs[0], { id: 'doc', heading: 'Constitution', body: text, index: 0 });
});

test('parser: empty / null input → []', () => {
  assert.deepStrictEqual(Bylaws.parseClauses(''), []);
  assert.deepStrictEqual(Bylaws.parseClauses('   \n \n'), []);
  assert.deepStrictEqual(Bylaws.parseClauses(null), []);
});

test('parser: heading whitespace normalized, body kept verbatim', () => {
  const cs = Bylaws.parseClauses('ARTICLE   1    —   TAXI\r\n\r\n  Line one indented.\nLine two.\n\n');
  assert.strictEqual(cs[0].heading, 'ARTICLE 1 — TAXI', 'internal runs of spaces collapse in headings');
  assert.strictEqual(cs[0].body, '  Line one indented.\nLine two.', 'interior body whitespace untouched; blank edges trimmed');
});

test('parser: duplicate heading ids deduped in document order', () => {
  const cs = Bylaws.parseClauses('SECTION 1. Dues\nPay up.\nSECTION 1. Dues Again\nStill bookkeeping.');
  assert.deepStrictEqual(cs.map(c => c.id), ['sec-1', 'sec-1-2']);
});

// ── Search ──────────────────────────────────────────────────────────
const SEARCH_CLAUSES = Bylaws.parseClauses(CONSTITUTION);

test('search: heading match outranks body match', () => {
  const clauses = [
    { id: 'a', heading: 'Trade Deadline', body: 'nothing relevant here', index: 0 },
    { id: 'b', heading: 'Waivers', body: 'the trade deadline is week eleven and the trade window closes', index: 1 },
  ];
  const r = Bylaws.searchClauses(clauses, 'trade');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].clause.id, 'a', 'one heading hit (×3) beats two body hits');
  assert.ok(r[0].score > r[1].score);
});

test('search: term frequency ranks the waiver-dense clause first', () => {
  const r = Bylaws.searchClauses(SEARCH_CLAUSES, 'waiver');
  assert.ok(r.length >= 1);
  assert.strictEqual(r[0].clause.id, 'sec-3', 'clause that keeps saying waiver wins');
  assert.ok(r[0].snippet.toLowerCase().includes('waiver'), 'snippet centers on the hit');
});

test('search: word-start matching — waiver hits waivers, not mid-word', () => {
  const clauses = [{ id: 'x', heading: 'X', body: 'unwaivered nonsense', index: 0 }];
  assert.deepStrictEqual(Bylaws.searchClauses(clauses, 'waiver'), [], 'no mid-word hits');
  const r = Bylaws.searchClauses(SEARCH_CLAUSES, 'waivers');
  assert.strictEqual(r[0].clause.id, 'sec-3');
});

test('search: snippet windows ±120 chars with ellipses', () => {
  const pad = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do '.repeat(6);
  const body = pad + 'the KEYSTONE ruling applies here ' + pad;
  const clauses = [{ id: 'long', heading: 'Long', body, index: 0 }];
  const r = Bylaws.searchClauses(clauses, 'keystone');
  assert.strictEqual(r.length, 1);
  const s = r[0].snippet;
  assert.ok(s.includes('KEYSTONE'), 'snippet contains the hit');
  assert.ok(s.startsWith('…') && s.endsWith('…'), 'both sides truncated → both ellipses');
  assert.ok(s.length <= 2 * 120 + 'keystone'.length + 2, 'window stays ±120 around the hit, got ' + s.length);
});

test('search: heading-only hit falls back to the body lead as snippet', () => {
  const clauses = [{ id: 'p', heading: 'Playoff Seeding', body: 'Six teams. Two byes. Reseeding each round.', index: 0 }];
  const r = Bylaws.searchClauses(clauses, 'seeding');
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].snippet.startsWith('Six teams.'), 'no body hit → lead of body');
});

test('search: empty query or no hits → []', () => {
  assert.deepStrictEqual(Bylaws.searchClauses(SEARCH_CLAUSES, ''), []);
  assert.deepStrictEqual(Bylaws.searchClauses(SEARCH_CLAUSES, '   '), []);
  assert.deepStrictEqual(Bylaws.searchClauses(SEARCH_CLAUSES, 'zamboni'), []);
  assert.deepStrictEqual(Bylaws.searchClauses(null, 'trade'), []);
});

// ── Ruling context ──────────────────────────────────────────────────
test('ruling context: question, top clauses verbatim with ids, never-invent instruction', () => {
  const matches = Bylaws.searchClauses(SEARCH_CLAUSES, 'trade veto');
  const ctx = Bylaws.buildRulingContext({ clauses: SEARCH_CLAUSES, question: 'Can the league veto a trade?', matches });
  assert.ok(ctx.includes('QUESTION: Can the league veto a trade?'));
  assert.ok(ctx.includes('[art-2] ARTICLE 2 — TRADES'), 'top clause cited by id');
  assert.ok(ctx.includes('There is no veto.'), 'clause body quoted verbatim');
  assert.ok(ctx.includes(Bylaws.RULING_INSTRUCTION), 'framed with the grounding instruction');
  assert.ok(ctx.includes('never invent a rule'), 'the never-invent phrase is literally present');
});

test('ruling context: caps at top 3 matched clauses', () => {
  const clauses = [0, 1, 2, 3, 4].map(i => ({ id: 'sec-' + (i + 1), heading: 'Rule ' + (i + 1), body: 'ruling text ' + i, index: i }));
  const matches = clauses.map((c, i) => ({ clause: c, score: 10 - i, snippet: '' }));
  const ctx = Bylaws.buildRulingContext({ clauses, question: 'q', matches });
  assert.ok(ctx.includes('[sec-1]') && ctx.includes('[sec-2]') && ctx.includes('[sec-3]'));
  assert.ok(!ctx.includes('[sec-4]') && !ctx.includes('[sec-5]'), 'fourth and fifth matches dropped');
});

test('ruling context: derives matches itself when none are passed', () => {
  const ctx = Bylaws.buildRulingContext({ clauses: SEARCH_CLAUSES, question: 'How does the waiver budget work?' });
  assert.ok(ctx.includes('[sec-3]'), 'self-ran the search');
  assert.ok(ctx.includes('FAAB budget'));
});

test('ruling context: no matches still carries the instruction (silence stays silence)', () => {
  const ctx = Bylaws.buildRulingContext({ clauses: SEARCH_CLAUSES, question: 'zamboni protocol?' });
  assert.ok(ctx.includes('none matched'), 'says no clauses matched');
  assert.ok(ctx.includes(Bylaws.RULING_INSTRUCTION), 'instruction present so the AI declares silence');
});

// ── Amendment ledger ────────────────────────────────────────────────
test('amendments: append stamps ts and normalizes the row', () => {
  reset();
  const row = Bylaws.recordAmendment('L1', { path: 'scoring.rec', from: 1, to: 1.5, note: 'went full PPR', source: 'drift_ack', nowMs: 5000 });
  assert.deepStrictEqual(row, { ts: 5000, path: 'scoring.rec', from: 1, to: 1.5, note: 'went full PPR', source: 'drift_ack' });
  assert.ok(Bylaws._mem.has('commish_bylaws_L1'), 'persisted under commish_bylaws_<leagueId>');
});

test('amendments: newest first', () => {
  reset();
  Bylaws.recordAmendment('L1', { path: 'a', from: 1, to: 2, source: 'manual', nowMs: 1000 });
  Bylaws.recordAmendment('L1', { path: 'b', from: 2, to: 3, source: 'manual', nowMs: 2000 });
  const rows = Bylaws.amendments('L1');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].path, 'b', 'latest amendment first');
  assert.strictEqual(rows[1].path, 'a');
});

test('amendments: cap at 100, oldest pruned', () => {
  reset();
  for (let i = 1; i <= 105; i++) Bylaws.recordAmendment('L1', { path: 'p' + i, from: i, to: i + 1, source: 'manual', nowMs: i });
  const rows = Bylaws.amendments('L1');
  assert.strictEqual(rows.length, 100);
  assert.strictEqual(rows[0].ts, 105, 'newest kept');
  assert.strictEqual(rows[99].ts, 6, 'first five fell off');
});

test('amendments: unknown source normalizes to manual; drift_ack kept', () => {
  reset();
  assert.strictEqual(Bylaws.recordAmendment('L1', { path: 'x', nowMs: 1 }).source, 'manual');
  assert.strictEqual(Bylaws.recordAmendment('L1', { path: 'y', source: 'hacker', nowMs: 2 }).source, 'manual');
  assert.strictEqual(Bylaws.recordAmendment('L1', { path: 'z', source: 'drift_ack', nowMs: 3 }).source, 'drift_ack');
});

test('amendments: leagues isolated; empty/unknown league is safe', () => {
  reset();
  Bylaws.recordAmendment('L1', { path: 'a', nowMs: 1 });
  Bylaws.recordAmendment('L2', { path: 'b', nowMs: 2 });
  assert.strictEqual(Bylaws.amendments('L1').length, 1);
  assert.strictEqual(Bylaws.amendments('L1')[0].path, 'a');
  assert.deepStrictEqual(Bylaws.amendments('L404'), []);
  assert.strictEqual(Bylaws.recordAmendment('', { path: 'x', nowMs: 1 }), null, 'no league id → null, never a throw');
  assert.strictEqual(Bylaws.recordAmendment('L1', null), null);
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
