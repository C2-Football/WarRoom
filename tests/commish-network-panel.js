#!/usr/bin/env node
// Smoke tests for js/components/commish-network-panel.js — the two network
// panels (WrCommishCoefficientPanel / WrCommishProgrammePanel). Panels are
// pure render layers, so the test strategy is: Babel-transform the JSX, eval
// it against a minimal React shim (createElement expands function components
// into plain trees, useState is a real hook store so clicks re-render), then
// walk the tree asserting text/props. No DOM, no network, no real React.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Babel = require('@babel/standalone');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── React shim ──────────────────────────────────────────────────────
// Function components expand at createElement time, so render() returns a
// fully materialized tree of { type, props, children } nodes.
let hookStates = [], hookIdx = 0;
const React = {
  Fragment: Symbol('Fragment'),
  useState(init) {
    const i = hookIdx++;
    if (!(i in hookStates)) hookStates[i] = typeof init === 'function' ? init() : init;
    const set = v => { hookStates[i] = typeof v === 'function' ? v(hookStates[i]) : v; };
    return [hookStates[i], set];
  },
  createElement(type, props, ...children) {
    props = props || {};
    if (typeof type === 'function') return type({ ...props, children: children.length === 1 ? children[0] : children });
    return { type, props, children };
  },
};
function render(Comp, props) { hookIdx = 0; return Comp(props); }
function freshHooks() { hookStates = []; hookIdx = 0; }

function walk(node, fn) {
  if (node == null || typeof node === 'boolean') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, fn)); return; }
  if (typeof node === 'string' || typeof node === 'number') { fn({ text: String(node) }); return; }
  fn(node);
  walk(node.children, fn);
}
// Joined with '' because JSX splits `×{n}` / `h2h {rec}` into separate text
// children — a ' ' join would fabricate spaces the browser never renders.
function textOf(tree) {
  const parts = [];
  walk(tree, n => { if (n.text != null) parts.push(n.text); });
  return parts.join('');
}
function findAll(tree, pred) {
  const out = [];
  walk(tree, n => { if (n.text == null && pred(n)) out.push(n); });
  return out;
}

// ── Load the panel file ─────────────────────────────────────────────
global.window = globalThis;
global.React = React;
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'commish-network-panel.js'), 'utf8');
const compiled = Babel.transform(src, { presets: [['react']] }).code;
(0, eval)(compiled); // indirect eval → file assigns window.WrCommish* itself

const CoefPanel = window.WrCommishCoefficientPanel;
const ProgPanel = window.WrCommishProgrammePanel;

// ── Fixtures ────────────────────────────────────────────────────────
const coefficient = {
  gamesTotal: 81,
  rows: [
    {
      userId: 'u1', name: 'jacob', isMe: true, rating: 612, prevRating: 600, delta: 12,
      provisional: false, apRecord: '40-24', apGames: 64, leagueCount: 2, teamCount: 2,
      perLeague: [
        { leagueId: 'L1', leagueName: 'Alpha Dynasty', rating: 650, apRecord: '22-11', record: { w: 5, l: 2, t: 0 } },
        { leagueId: 'L2', leagueName: 'Beta Keeper', rating: 570, apRecord: '18-13', record: { w: 4, l: 3, t: 1 } },
      ],
    },
    {
      userId: 'u2', name: 'ben', isMe: false, rating: 480, prevRating: 490, delta: -10,
      provisional: true, apRecord: '8-9', apGames: 17, leagueCount: 2, teamCount: 2,
      perLeague: [{ leagueId: 'L1', leagueName: 'Alpha Dynasty', rating: 480, apRecord: '8-9', record: { w: 2, l: 5, t: 0 } }],
    },
    {
      userId: 'u3', name: 'zed', isMe: false, rating: null, prevRating: null, delta: null,
      provisional: true, apRecord: '0-0', apGames: 0, leagueCount: 1, teamCount: 1,
      perLeague: [{ leagueId: 'L3', leagueName: 'Gamma Redraft', rating: null, apRecord: null, record: { w: 0, l: 0, t: 0 } }],
    },
  ],
};
const graph = { people: {}, overlap: [{ userId: 'u2', name: 'ben', leagueCount: 2 }], seats: [] };

const fullProgramme = {
  leagueId: 'L1', leagueName: 'Alpha Dynasty', week: 6, empty: false,
  headline: 'Sharks survive Jets by 2.2 — the week’s nail-biter',
  results: [
    { winnerName: 'Sharks', loserName: 'Jets', wPts: 102.3, lPts: 100.1, margin: 2.2, tie: false },
    { winnerName: 'Crows', loserName: 'Owls', wPts: 130, lPts: 90, margin: 40, tie: false },
    { winnerName: 'Elks', loserName: 'Foxes', wPts: 99, lPts: 99, margin: 0, tie: true },
    { winnerName: 'Gulls', loserName: 'Hens', wPts: 88, lPts: 70, margin: 18, tie: false },
  ],
  topScore: { name: 'Crows', pts: 130 },
  luckNote: { name: 'Jets', luck: -1.4, allPlayPct: 0.6, kind: 'robbed', text: 'Jets keep winning the scoreboard and losing the schedule' },
  standingsTop3: [
    { rosterId: 1, name: 'Crows', wins: 5, losses: 1, ties: 0, pf: 801.5 },
    { rosterId: 2, name: 'Sharks', wins: 4, losses: 2, ties: 1, pf: 750.25 },
    { rosterId: 3, name: 'Jets', wins: 3, losses: 3, ties: 0, pf: 748.9 },
  ],
  generatedAtMs: 1234,
};
const programmes = [
  fullProgramme,
  { empty: true, leagueId: 'L2', leagueName: 'Beta Keeper', reason: 'no_scores' },
  { empty: true, leagueId: 'L3', leagueName: 'Gamma Redraft', reason: 'no_ledger' },
];

// ── Coefficient panel ───────────────────────────────────────────────
console.log('WrCommishCoefficientPanel');

freshHooks();
let tree = render(CoefPanel, { coefficient, graph });
let text = textOf(tree);

test('hero line + scale subtext render', () => {
  assert.ok(text.includes('One rating per human'));
  assert.ok(text.includes('0–1000 scale'));
});
test('meta counts humans and all-play games', () => {
  assert.ok(text.includes('3 humans'));
  assert.ok(text.includes('81'));
});
test('overlap strip: sentence + chip with league count', () => {
  assert.ok(text.includes('1 human plays in 2+ of your leagues'));
  assert.ok(text.includes('×2'));
});
test('ratings, movement arrows, provisional badge', () => {
  assert.ok(text.includes('612'));
  assert.ok(text.includes('▲') && text.includes('12'));
  assert.ok(text.includes('▼') && text.includes('10'));
  assert.ok(text.includes('(prov)'));
});
test('zero-game human shows dashes, never a fake 0-0', () => {
  assert.ok(!text.includes('0-0'));
});
test('me row is gold-highlighted and tagged (you)', () => {
  const meRows = findAll(tree, n => n.props && n.props.style && String(n.props.style.boxShadow || '').includes('inset 3px'));
  assert.strictEqual(meRows.length, 1);
  assert.ok(textOf(meRows[0]).includes('jacob'));
  assert.ok(text.includes('(you)'));
});
test('caption present', () => {
  assert.ok(text.includes('Discovered automatically from shared Sleeper accounts'));
});
test('per-league breakdown hidden until row click, shown after', () => {
  assert.ok(!text.includes('↳'));
  const row = findAll(tree, n => n.props && n.props.onClick && textOf(n).includes('jacob'))[0];
  assert.ok(row, 'clickable jacob row exists');
  row.props.onClick();
  tree = render(CoefPanel, { coefficient, graph }); // same hook store → expanded
  const t2 = textOf(tree);
  assert.ok(t2.includes('↳'));
  assert.ok(t2.includes('Alpha Dynasty'));
  assert.ok(t2.includes('h2h 5-2'));
  assert.ok(t2.includes('h2h 4-3-1')); // ties appended only when present
});
test('null-rating league line is honest, not numeric', () => {
  freshHooks();
  render(CoefPanel, { coefficient, graph });
  const row = findAll(render(CoefPanel, { coefficient, graph }), n => n.props && n.props.onClick && textOf(n).includes('zed'))[0];
  row.props.onClick();
  const t = textOf(render(CoefPanel, { coefficient, graph }));
  assert.ok(t.includes('no scored weeks yet'));
});
test('no rows at all → members empty state', () => {
  freshHooks();
  const t = textOf(render(CoefPanel, { coefficient: { rows: [], gamesTotal: 0 }, graph: { overlap: [] } }));
  assert.ok(t.includes('No members on the graph yet'));
});
test('rows without ratings → offseason empty state, network still shown', () => {
  freshHooks();
  const offRows = coefficient.rows.map(r => ({ ...r, rating: null, delta: null, apGames: 0 }));
  const t = textOf(render(CoefPanel, { coefficient: { rows: offRows, gamesTotal: 0 }, graph }));
  assert.ok(t.includes('No all-play games counted yet'));
  assert.ok(t.includes('2+ of your leagues')); // overlap survives offseason
  assert.ok(!t.includes('▲'));
});
test('missing coefficient/graph props degrade to empty state, no throw', () => {
  freshHooks();
  const t = textOf(render(CoefPanel, {}));
  assert.ok(t.includes('No members on the graph yet'));
});

// ── Programme panel ─────────────────────────────────────────────────
console.log('WrCommishProgrammePanel');

delete window.wrExport;
let called = 0;
freshHooks();
tree = render(ProgPanel, { programmes, onExportAll: () => { called++; } });
text = textOf(tree);

test('header tagline renders', () => {
  assert.ok(text.includes('One button. Every group chat.'));
});
test('card carries the export DOM id contract', () => {
  const withId = findAll(tree, n => n.props && n.props.id === 'wr-programme-L1');
  assert.strictEqual(withId.length, 1);
});
test('masthead: league name + WK n', () => {
  assert.ok(text.includes('Alpha Dynasty'));
  assert.ok(text.includes('WK') && text.includes('6'));
});
test('headline + results capped at 3 with honest overflow line', () => {
  assert.ok(text.includes('nail-biter'));
  assert.ok(text.includes('Sharks def. Jets'));
  assert.ok(text.includes('Elks ties Foxes'));       // tie flag respected — nobody crowned
  assert.ok(!text.includes('Gulls def. Hens'));      // 4th result cut
  assert.ok(text.includes('+1 more result'));
});
test('scores align via toFixed(1)', () => {
  assert.ok(text.includes('102.3') && text.includes('100.1'));
  assert.ok(text.includes('130.0')); // whole-number top score still prints .0
});
test('luck note + standings top-3 with tie-aware records', () => {
  assert.ok(text.includes('losing the schedule'));
  assert.ok(text.includes('5-1'));
  assert.ok(text.includes('4-2-1'));
  assert.ok(text.includes('801.5'));
});
test('empty programme cards print reason-specific copy', () => {
  assert.ok(text.includes('No scores posted for the latest counted week'));
  assert.ok(text.includes('Weekly scores could not be loaded'));
});
test('Export All fires the callback; per-card export absent without wrExport', () => {
  const btns = findAll(tree, n => n.type === 'button');
  assert.strictEqual(btns.length, 1); // Export All only — window.wrExport is absent
  btns[0].props.onClick();
  assert.strictEqual(called, 1);
});
test('per-card export appears with wrExport, only on non-empty cards', () => {
  window.wrExport = { capture() {} };
  freshHooks();
  const t = render(ProgPanel, { programmes, onExportAll: () => {} });
  const btns = findAll(t, n => n.type === 'button');
  assert.strictEqual(btns.length, 2); // Export All + 1 card (empties get none)
  delete window.wrExport;
});
test('no onExportAll fn / all-empty list → no Export All button', () => {
  freshHooks();
  let t = render(ProgPanel, { programmes });
  assert.strictEqual(findAll(t, n => n.type === 'button').length, 0);
  freshHooks();
  t = render(ProgPanel, { programmes: programmes.slice(1), onExportAll: () => {} });
  assert.strictEqual(findAll(t, n => n.type === 'button').length, 0);
});
test('empty programmes list → honest empty state', () => {
  freshHooks();
  const t = textOf(render(ProgPanel, { programmes: [] }));
  assert.ok(t.includes('No commissioned leagues to print'));
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
  process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
