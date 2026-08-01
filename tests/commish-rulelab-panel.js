#!/usr/bin/env node
// Smoke tests for js/components/commish-rulelab-panel.js — the Rule Lab
// bench + per-league replay results (WrCommishRuleLabPanel). Same strategy
// as tests/commish-network-panel.js: Babel-transform the JSX, eval against a
// minimal React shim, walk the materialized tree asserting text/props.
// No DOM, no network, no real React. The panel is a controlled component
// (proposal in, onProposalChange out), so chip taps are asserted as callback
// payloads, not re-renders.
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
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    props = props || {};
    if (typeof type === 'function') return type({ ...props, children: children.length === 1 ? children[0] : children });
    return { type, props, children };
  },
};
function render(Comp, props) { return Comp(props); }

function walk(node, fn) {
  if (node == null || typeof node === 'boolean') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, fn)); return; }
  if (typeof node === 'string' || typeof node === 'number') { fn({ text: String(node) }); return; }
  fn(node);
  walk(node.children, fn);
}
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
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'commish-rulelab-panel.js'), 'utf8');
const compiled = Babel.transform(src, { presets: [['react']] }).code;
(0, eval)(compiled);

const Panel = window.WrCommishRuleLabPanel;

// ── Fixtures ────────────────────────────────────────────────────────
const PRESETS = [
  { key: 'std_rec', label: 'Standard (0 PPR)', overrides: { rec: 0 } },
  { key: 'half_ppr', label: 'Half PPR (0.5/rec)', overrides: { rec: 0.5 } },
  { key: 'full_ppr', label: 'Full PPR (1.0/rec)', overrides: { rec: 1.0 } },
  { key: 'te_premium_full', label: 'TE Premium (+1.0/rec)', overrides: { bonus_rec_te: 1.0 } },
  { key: 'six_pt_pass_td', label: '6-pt Passing TDs', overrides: { pass_td: 6 } },
];
const CAPTION = 'Both runs use identical as-played lineups rescored from raw stat lines — the diff is the rule change and nothing else. Playoffs were real games: we re-cut the field and seeds, we never re-crown a champion.';

// Full runProposal-shaped result: 12 teams, 10 moved / 2 unchanged (tests
// the cap-8 + "+N more moved · +N unchanged" note), teamDeltas 8 wide.
const teamNames = ['Team A', 'Team B', 'Team C', 'Team D', 'Team E', 'Team F', 'Team G', 'Team H', 'Team I', 'Team J', 'Team K', 'Team L'];
const standingsShift = teamNames.map((name, i) => ({
  rosterId: i + 1, name,
  baselineRank: i + 1,
  proposedRank: i < 10 ? (i % 2 === 0 ? i + 2 : i) : i + 1, // 10 moved, last 2 hold
  delta: i < 10 ? (i % 2 === 0 ? -1 : 1) : 0,
}));
const teamDeltas = [
  { rosterId: 1, name: 'Team A', baselinePts: 1500, proposedPts: 1530.5, delta: 30.5 },
  { rosterId: 2, name: 'Team B', baselinePts: 1400, proposedPts: 1420.1, delta: 20.1 },
  { rosterId: 3, name: 'Team C', baselinePts: 1300, proposedPts: 1310, delta: 10 },
  { rosterId: 4, name: 'Team D', baselinePts: 1200, proposedPts: 1205, delta: 5 },
  { rosterId: 5, name: 'Team E', baselinePts: 1100, proposedPts: 1102, delta: 2 },
  { rosterId: 6, name: 'Team F', baselinePts: 1000, proposedPts: 999, delta: -1 },
  { rosterId: 7, name: 'Team G', baselinePts: 950, proposedPts: 934.8, delta: -15.2 },
  { rosterId: 8, name: 'Team H', baselinePts: 900, proposedPts: 877.2, delta: -22.8 },
];
const playerDeltas = []
  .concat(Array.from({ length: 10 }, (_, i) => ({ pid: 'g' + i, name: 'Gainer' + i, pos: 'TE', delta: 50 - i })))
  .concat(Array.from({ length: 10 }, (_, i) => ({ pid: 'l' + i, name: 'Loser' + i, pos: 'QB', delta: -50 + i })));
const fullResult = {
  empty: false, seasonUsed: '2025', weeksCounted: 14,
  standingsShift,
  playoffField: { size: 6, in: ['Team G'], out: ['Team E'], unchanged: false },
  seedOneChanged: { from: 'Team A', to: 'Team B', fromRosterId: 1, toRosterId: 2 },
  teamDeltas, playerDeltas,
  proposerNote: { myRank: 1, line: 'Full disclosure: your own roster is the #1 gainer of 12 under this proposal.' },
};
const quietResult = {
  empty: false, seasonUsed: '2025', weeksCounted: 14,
  standingsShift: standingsShift.map(r => ({ ...r, proposedRank: r.baselineRank, delta: 0 })),
  playoffField: { size: 6, in: [], out: [], unchanged: true },
  seedOneChanged: null, teamDeltas: [], playerDeltas: [], proposerNote: null,
};
const results = [
  { leagueId: 'L1', leagueName: 'Alpha Dynasty', result: fullResult },
  { leagueId: 'L2', leagueName: 'Beta Keeper', result: quietResult },
  { leagueId: 'L3', leagueName: 'Gamma Redraft', result: { empty: true, reason: 'No completed weeks with real lineups to replay — the Rule Lab needs at least one played week.', seasonUsed: '2025', weeksCounted: 0 } },
];

const chipButtons = tree => findAll(tree, n => n.type === 'button').filter(b => PRESETS.some(p => textOf(b) === p.label));
const chipFor = (tree, label) => chipButtons(tree).find(b => textOf(b) === label);

// ── Proposal bench ──────────────────────────────────────────────────
console.log('WrCommishRuleLabPanel — proposal bench');

test('renders one chip per preset, no Clear when nothing staged', () => {
  const tree = render(Panel, { status: 'idle', proposal: {}, presets: PRESETS });
  assert.strictEqual(chipButtons(tree).length, PRESETS.length);
  const clears = findAll(tree, n => n.type === 'button').filter(b => textOf(b) === 'Clear');
  assert.strictEqual(clears.length, 0);
  assert.ok(textOf(tree).includes('no changes staged — current rules'));
});
test('active chip = gold border, value-matched (full PPR lit, half dark)', () => {
  const tree = render(Panel, { status: 'idle', proposal: { rec: 1 }, presets: PRESETS });
  const full = chipFor(tree, 'Full PPR (1.0/rec)');
  const half = chipFor(tree, 'Half PPR (0.5/rec)');
  assert.ok(String(full.props.style.border).includes('var(--gold'));
  assert.ok(!String(half.props.style.border).includes('var(--gold'));
});
test('chips COMPOSE: tapping TE premium on top of full PPR merges overrides', () => {
  let got = null;
  const tree = render(Panel, { status: 'idle', proposal: { rec: 1 }, presets: PRESETS, onProposalChange: p => { got = p; } });
  chipFor(tree, 'TE Premium (+1.0/rec)').props.onClick();
  assert.deepStrictEqual(got, { rec: 1, bonus_rec_te: 1 });
});
test('tapping an active chip toggles its keys OFF', () => {
  let got = null;
  const tree = render(Panel, { status: 'idle', proposal: { rec: 1, bonus_rec_te: 1 }, presets: PRESETS, onProposalChange: p => { got = p; } });
  chipFor(tree, 'Full PPR (1.0/rec)').props.onClick();
  assert.deepStrictEqual(got, { bonus_rec_te: 1 });
});
test('same-key preset retunes rather than stacking (half → full)', () => {
  let got = null;
  const tree = render(Panel, { status: 'idle', proposal: { rec: 0.5 }, presets: PRESETS, onProposalChange: p => { got = p; } });
  chipFor(tree, 'Full PPR (1.0/rec)').props.onClick();
  assert.deepStrictEqual(got, { rec: 1 });
});
test('summary line: baseline-aware "rec 0.5 → 1.0" + bonus "+1.0"', () => {
  const t = textOf(render(Panel, { status: 'idle', proposal: { rec: 1, bonus_rec_te: 1 }, presets: PRESETS, baselineScoring: { rec: 0.5 } }));
  assert.ok(t.includes('rec 0.5 → 1.0 · bonus_rec_te +1.0'));
});
test('summary line without baseline never invents a "from"', () => {
  const t = textOf(render(Panel, { status: 'idle', proposal: { pass_td: 6 }, presets: PRESETS }));
  assert.ok(t.includes('pass_td → 6.0'));
  assert.ok(!t.includes('4.0 → 6.0'));
});
test('Clear button appears with a staged proposal and empties it', () => {
  let got = null;
  const tree = render(Panel, { status: 'idle', proposal: { rec: 1 }, presets: PRESETS, onProposalChange: p => { got = p; } });
  const clear = findAll(tree, n => n.type === 'button').find(b => textOf(b) === 'Clear');
  assert.ok(clear, 'Clear button exists');
  clear.props.onClick();
  assert.deepStrictEqual(got, {});
});
test('presets fall back to the engine global when prop absent', () => {
  window.App = { Commish: { RuleLab: { PRESETS } } };
  const tree = render(Panel, { status: 'idle', proposal: {} });
  assert.strictEqual(chipButtons(tree).length, PRESETS.length);
  delete window.App;
});
test('no presets anywhere → honest engine-not-loaded line, no throw', () => {
  const t = textOf(render(Panel, { status: 'idle', proposal: {} }));
  assert.ok(t.includes('No proposal presets available'));
});
test('bare render with no props at all does not throw', () => {
  const t = textOf(render(Panel, {}));
  assert.ok(t.includes('Proposal Bench'.toUpperCase()) || t.includes('Proposal Bench'));
});

// ── Status states ───────────────────────────────────────────────────
console.log('WrCommishRuleLabPanel — status states');

test('loading names the season being replayed', () => {
  const t = textOf(render(Panel, { status: 'loading', seasonUsed: '2025', proposal: { rec: 1 }, presets: PRESETS }));
  assert.ok(t.includes('Replaying the 2025 season…'));
});
test('empty status → honest no-weeks line', () => {
  const t = textOf(render(Panel, { status: 'empty', proposal: { rec: 1 }, presets: PRESETS }));
  assert.ok(t.includes('No completed weeks to replay'));
});
test('error status → plain failure line', () => {
  const t = textOf(render(Panel, { status: 'error', proposal: { rec: 1 }, presets: PRESETS }));
  assert.ok(t.includes('could not be run'));
});
test('idle status → stage-a-proposal prompt', () => {
  const t = textOf(render(Panel, { status: 'idle', proposal: {}, presets: PRESETS }));
  assert.ok(t.includes('Stage a proposal'));
});
test('methodology caption is verbatim and present in every status', () => {
  ['idle', 'loading', 'ready', 'error', 'empty'].forEach(status => {
    const t = textOf(render(Panel, { status, proposal: {}, presets: PRESETS, results }));
    assert.ok(t.includes(CAPTION), 'caption missing in status=' + status);
  });
});

// ── Ready results ───────────────────────────────────────────────────
console.log('WrCommishRuleLabPanel — ready results');

const readyTree = render(Panel, { status: 'ready', proposal: { rec: 1 }, presets: PRESETS, results });
const readyText = textOf(readyTree);

test('per-league sections with season + weeks meta', () => {
  assert.ok(readyText.includes('Alpha Dynasty'));
  assert.ok(readyText.includes('Beta Keeper'));
  assert.ok(readyText.includes('2025 season · 14 weeks replayed'));
});
test('verdict: #1 seed flip line in gold', () => {
  assert.ok(readyText.includes('#1 seed flips: Team A → Team B'));
  const line = findAll(readyTree, n => n.props && n.props.style && String(n.props.style.color || '').includes('var(--gold') && textOf(n).includes('#1 seed flips'));
  assert.ok(line.length >= 1);
});
test('verdict: playoff field IN green / OUT red', () => {
  const ins = findAll(readyTree, n => n.props && n.props.style && String(n.props.style.color || '').includes('2ecc71') && textOf(n) === 'IN');
  const outs = findAll(readyTree, n => n.props && n.props.style && String(n.props.style.color || '').includes('e74c3c') && textOf(n) === 'OUT');
  assert.ok(ins.length >= 1 && outs.length >= 1);
  assert.ok(readyText.includes('Team G'));
  assert.ok(readyText.includes('Team E'));
});
test('quiet league: no-change verdict + field unchanged + standings hold', () => {
  assert.ok(readyText.includes('No change at the top'));
  assert.ok(readyText.includes('Playoff field unchanged (6-team cut).'));
  assert.ok(readyText.includes('Standings hold'));
});
test('standings shift: moved rows only, capped at 8, with the overflow note', () => {
  assert.ok(readyText.includes('+2 more moved · +2 unchanged'));
  // 12 teams, 10 moved → 8 rendered. Header + 8 rows carry the shift grid;
  // the quiet league (Beta) renders no table at all.
  const shiftNodes = findAll(readyTree, n => n.props && n.props.style && n.props.style.gridTemplateColumns === 'minmax(0,1.7fr) 0.55fr 0.55fr 0.7fr');
  assert.strictEqual(shiftNodes.length, 9, 'one header + eight capped rows');
  // The 9th/10th movers and the two unchanged teams never render anywhere:
  // Team I..L are absent from teamDeltas too, so text absence is meaningful.
  ['Team I', 'Team J', 'Team K', 'Team L'].forEach(nm => assert.ok(!readyText.includes(nm), nm + ' should be cut'));
});
test('standings Δ arrows: ▲ for climbs, ▼ for drops', () => {
  assert.ok(readyText.includes('▲1'));
  assert.ok(readyText.includes('▼1'));
});
test('team deltas: top 3 + bottom 3 only, one-decimal, middle teams cut', () => {
  assert.ok(readyText.includes('+30.5') && readyText.includes('−22.8'));
  assert.ok(readyText.includes('1530.5'));
  assert.ok(!readyText.includes('Team D') || standingsShift.some(r => r.name === 'Team D' && r.delta !== 0),
    'Team D only allowed via the standings table');
  assert.ok(readyText.includes('top 3 and bottom 3 of 8 teams shown'));
});
test('player movers: two columns, capped 8 each', () => {
  assert.ok(readyText.includes('Gainer0') && readyText.includes('Gainer7'));
  assert.ok(!readyText.includes('Gainer8'), '9th gainer cut');
  assert.ok(readyText.includes('Loser0') && readyText.includes('Loser7'));
  assert.ok(!readyText.includes('Loser8'), '9th loser cut');
  assert.ok(readyText.includes('+50.0') && readyText.includes('−50.0'));
});
test('proposer disclosure renders amber with the ballot line', () => {
  assert.ok(readyText.includes('Full disclosure: your own roster is the #1 gainer of 12'));
  assert.ok(readyText.includes('Attach this to the ballot'));
  const amber = findAll(readyTree, n => n.props && n.props.style && String(n.props.style.borderLeft || '').includes('var(--warn'));
  assert.ok(amber.length >= 1);
});
test('per-league empty result prints the engine reason verbatim', () => {
  assert.ok(readyText.includes('Gamma Redraft'));
  assert.ok(readyText.includes('needs at least one played week'));
});
test('ready with no leagues → honest line', () => {
  const t = textOf(render(Panel, { status: 'ready', proposal: {}, presets: PRESETS, results: [] }));
  assert.ok(t.includes('No leagues to replay yet.'));
});
test('tables sit inside overflowX wrappers', () => {
  const wraps = findAll(readyTree, n => n.props && n.props.style && n.props.style.overflowX === 'auto');
  assert.ok(wraps.length >= 2, 'standings + swing tables each wrapped');
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
  process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
