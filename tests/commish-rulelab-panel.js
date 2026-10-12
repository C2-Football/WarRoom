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
  // Render-only useState: initial value, setter is a no-op recorded for
  // assertions. Enough for a single synchronous render pass — these tests
  // never re-render.
  useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
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
const button = (tree, label) => findAll(tree, n => n.type === 'button' && textOf(n).trim() === label)[0];
const field = (tree, label) => findAll(tree, n => (n.type === 'input' || n.type === 'select') && n.props['aria-label'] === label)[0];
function withPanelState(initialProps, fn) {
  const original = React.useState, slots = []; let cursor = 0;
  let props = initialProps;
  React.useState = initial => {
    const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
  };
  const draw = updates => { props = { ...props, ...updates }; cursor = 0; return render(Panel, props); };
  try { fn(draw); } finally { React.useState = original; }
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
const CAPTION = 'Scoring comparisons use the same historical lineups and stats. Playoff game results are preserved; only qualification and seeding are recalculated.';

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
test('preset selection is value-matched and exposed to assistive technology', () => {
  const tree = render(Panel, { status: 'idle', proposal: { rec: 1 }, presets: PRESETS });
  const full = chipFor(tree, 'Full PPR (1.0/rec)');
  const half = chipFor(tree, 'Half PPR (0.5/rec)');
  assert.strictEqual(full.props['aria-pressed'], true);
  assert.strictEqual(half.props['aria-pressed'], false);
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
test('summary line names the rule and shows only a known baseline', () => {
  const t = textOf(render(Panel, { status: 'idle', proposal: { rec: 1, bonus_rec_te: 1 }, presets: PRESETS, baselineScoring: { rec: 0.5 } }));
  assert.ok(t.includes('Reception (PPR) 0.5 → 1.0 · TE reception premium → 1.0'));
});
test('summary line without baseline never invents a "from"', () => {
  const t = textOf(render(Panel, { status: 'idle', proposal: { pass_td: 6 }, presets: PRESETS }));
  assert.ok(t.includes('Passing TD → 6.0'));
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
  assert.ok(t.includes('Change the scoring') && t.includes('Replay impact'));
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
  const ins = findAll(readyTree, n => n.props && n.props.style && String(n.props.style.color || '').toLowerCase().includes('2ecc71') && textOf(n) === 'IN');
  const outs = findAll(readyTree, n => n.props && n.props.style && String(n.props.style.color || '').toLowerCase().includes('e74c3c') && textOf(n) === 'OUT');
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

// ── Wind Tunnel v2: any-key picker + every-season grid ──────────────
test('wind tunnel: key picker select renders grouped options from the baseline keys', () => {
  const tree = render(Panel, {
    status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5, pass_td: 4, fgm_50p: 5 },
  });
  const selects = findAll(tree, n => n.type === 'select' && n.props['aria-label'] === 'Scoring threshold rule');
  assert.strictEqual(selects.length, 1, 'the threshold picker is distinctly named');
  const opts = findAll(selects[0], n => n.type === 'option');
  const values = opts.map(o => o.props.value);
  assert.ok(values.includes('rec') && values.includes('pass_td') && values.includes('fgm_50p'), 'every baseline key is sweepable: ' + values.join(','));
  assert.ok(values.includes('bonus_rec_te'), 'bonus_rec_te addable even when unscored');
  const groups = findAll(tree, n => n.type === 'optgroup').map(g => g.props.label);
  assert.ok(groups.includes('Receiving') && groups.includes('Kicking'), 'grouped: ' + groups.join(','));
});

test('threshold comparison passes the selected key with null values and the allSeasons flag', () => {
  let got = null;
  const tree = render(Panel, {
    status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5 }, onSweep: (k, v, o) => { got = { k, v, o }; },
  });
  const btn = button(tree, 'Compare values');
  assert.ok(btn, 'Compare values button present');
  btn.props.onClick();
  assert.strictEqual(got.k, 'rec', 'default key is rec');
  assert.strictEqual(got.v, null, 'null values → container builds the ladder');
  assert.strictEqual(got.o.allSeasons, false, 'toggle defaults off');
});

test('threshold comparisons require previewed rules and never call unavailable data HOLD or NOW', () => {
  const threshold = tree => findAll(tree, n => n.type === 'details' && findAll(n, c => c.type === 'summary').some(c => textOf(c).startsWith('Find a scoring threshold')))[0];
  let tree = render(Panel, { status: 'ready', proposal: { rec: 1 }, results: [], hasUnanalyzedChanges: true });
  assert.ok(button(tree, 'Compare values').props.disabled);
  assert.ok(button(tree, 'PPR 0 → 1.5').props.disabled);
  assert.ok(textOf(threshold(tree)).includes('Preview changes before comparing values'));
  let retries = 0;
  tree = render(Panel, { status: 'ready', proposal: {}, results: [], onRetryReplay: () => retries++, sweepResult: { key: 'rec', perLeague: [{ leagueName: 'Missing week', firstFlipAt: null, steps: [{ value: 0, empty: true, isCurrent: true }, { value: 1, empty: true }] }] } });
  const unavailable = threshold(tree), message = textOf(unavailable);
  assert.ok(message.includes('Scoring threshold unavailable') && message.includes('no movement conclusion is available'));
  assert.ok(!message.includes('HOLD') && !message.includes('NOW') && !message.includes('No tested value changes'));
  button(unavailable, 'Retry replay').props.onClick(); assert.strictEqual(retries, 1);
  tree = render(Panel, { status: 'ready', proposal: {}, results: [], onRetryReplay() {}, sweepResult: { key: 'rec', perLeague: [{ leagueName: 'Partial range', firstFlipAt: null, steps: [{ value: 0, empty: true, isCurrent: true }, { value: 1, ranksMoved: 0, fieldMoves: 0 }] }] } });
  const partial = threshold(tree);
  assert.ok(textOf(partial).includes('Some values could not be replayed') && textOf(partial).includes('Available values do not change ranks'));
  assert.ok(findAll(partial, n => n.props.title === 'Replay data unavailable for this value.').every(n => textOf(n).includes('Data unavailable') && !textOf(n).includes('NOW')));
});

test('wind tunnel: Every season toggle only appears with 2+ available seasons', () => {
  const one = render(Panel, { status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5 }, seasons: [{ season: 2025, available: true }, { season: 2024, available: false }] });
  assert.ok(!textOf(one).includes('Every season'), 'hidden when only one season is reachable');
  const two = render(Panel, { status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5 }, seasons: [{ season: 2025, available: true }, { season: 2024, available: true }] });
  assert.ok(textOf(two).includes('Every season'), 'shown when the chain reaches 2+ seasons');
});

test('wind tunnel: multi-season result renders the season×value grid and the consensus verdict', () => {
  const tree = render(Panel, {
    status: 'ready', proposal: {}, presets: PRESETS, results: [], baselineScoring: { rec: 0.5 },
    seasons: [{ season: 2025, available: true }, { season: 2024, available: true }],
    sweepResult: { key: 'bonus_rec_te', multi: true, perLeague: [
      { leagueName: 'CSL', seasons: [2024, 2025], noData: [2023],
        rows: [
          { value: 0, isCurrent: true, bySeason: { 2024: 'HOLD', 2025: 'HOLD' } },
          { value: 1, isCurrent: false, bySeason: { 2024: 'SEED', 2025: '2 MV' } },
        ],
        minFlip: 1, consensus: 1, heldIn: 2, of: 2 },
      { leagueName: 'Test', seasons: [2025], noData: [],
        rows: [{ value: 0, isCurrent: true, bySeason: { 2025: 'HOLD' } }],
        minFlip: null, consensus: null, heldIn: 0, of: 1 },
    ] },
  });
  const t = textOf(tree);
  assert.ok(t.includes('CSL') && t.includes('TE reception premium'), 'league + human key label');
  assert.ok(t.includes('2024') && t.includes('2025'), 'season rows');
  assert.ok(t.includes('SEED') && t.includes('2 MV'), 'per-season cells');
  assert.ok(t.includes('every replayed season') && t.includes('(2 of 2)'), 'cross-season movement is disclosed without asserting an untested threshold');
  assert.ok(t.includes('no data: 2023'), 'no-data years disclosed');
  assert.ok(t.includes('No tested value changes ranks or playoff qualification in the replayed seasons'), 'honest null league');
  const tables = findAll(tree, n => n.type === 'table');
  assert.ok(tables.length >= 2, 'one grid table per league');
});

test('every-season threshold with no replayable seasons discloses missing data rather than unchanged rankings', () => {
  let retries = 0;
  const tree = render(Panel, { status: 'ready', proposal: {}, results: [], onRetryReplay: () => retries++,
    sweepResult: { key: 'rec', multi: true, perLeague: [{ leagueName: 'Unavailable history', seasons: [], rows: [], noData: [2024, 2025], consensus: null, minFlip: null, heldIn: 0, of: 0 }] } });
  assert.ok(textOf(tree).includes('No seasons could be replayed. Season data is unavailable; no movement conclusion is available.'));
  assert.ok(textOf(tree).includes('no data: 2024, 2025'));
  assert.ok(!textOf(tree).includes('No tested value changes ranks') && !textOf(tree).includes('every replayed season'));
  button(tree, 'Retry replay').props.onClick(); assert.strictEqual(retries, 1);
});


// ── League scope: one constitution at a time ────────────────────────
const SCOPE_LEAGUES = [{ id: 'L1', name: 'CTB The One' }, { id: 'L2', name: 'Psycho League' }];

test('scope: a chip per league plus an All-leagues omnibus, active one lit', () => {
  const tree = render(Panel, {
    status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5 }, leagues: SCOPE_LEAGUES, selectedLeagueId: 'L1',
  });
  const t = textOf(tree);
  assert.ok(t.includes('Amending'), 'scope row labelled');
  assert.ok(t.includes('CTB The One') && t.includes('Psycho League'));
  assert.ok(t.includes('All 2 leagues'), 'omnibus escape hatch offered');
  const btns = findAll(tree, n => n.type === 'button');
  const lit = btns.filter(b => b.props.style && String(b.props.style.color || '').includes('co-accent'));
  assert.ok(lit.some(b => textOf(b).includes('CTB The One')), 'selected league is the lit chip');
  assert.ok(!lit.some(b => textOf(b).includes('All 2 leagues')), 'omnibus not lit while scoped');
});

test('scope: a single league hides the picker (nothing to choose)', () => {
  const t = textOf(render(Panel, {
    status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5 }, leagues: [{ id: 'L1', name: 'Only League' }], selectedLeagueId: 'L1',
  }));
  assert.ok(!t.includes('Amending'), 'no scope row for a one-league commissioner');
});

test('scope: selecting a league reports its id', () => {
  let got = null;
  const tree = render(Panel, {
    status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5 }, leagues: SCOPE_LEAGUES, selectedLeagueId: 'L1',
    onSelectLeague: id => { got = id; },
  });
  const btns = findAll(tree, n => n.type === 'button');
  btns.find(b => textOf(b) === 'Psycho League').props.onClick();
  assert.strictEqual(got, 'L2');
  btns.find(b => textOf(b).includes('All 2 leagues')).props.onClick();
  assert.strictEqual(got, '__all', 'omnibus reports the sentinel');
});

test('editorKeys prop drives the editor, not just the baseline keys', () => {
  const tree = render(Panel, {
    status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5 }, editorKeys: ['rec', 'idp_sack', 'fgm_50p'],
    leagues: SCOPE_LEAGUES, selectedLeagueId: 'L1',
  });
  const opts = findAll(tree, n => n.type === 'option').map(o => o.props.value);
  assert.ok(opts.includes('idp_sack'), "a scoped league's IDP key is sweepable even though the baseline lacks it");
  assert.ok(opts.includes('fgm_50p') && opts.includes('rec'));
  assert.ok(opts.includes('bonus_rec_te'), 'TE premium always addable');
});

test('omnibus: warns that there is no single baseline to edit against', () => {
  const t = textOf(render(Panel, {
    status: 'ready', proposal: {}, presets: PRESETS, results: [],
    baselineScoring: null, editorKeys: ['rec', 'pass_td'],
    leagues: SCOPE_LEAGUES, selectedLeagueId: '__all',
  }));
  assert.ok(t.includes('every league at once'), 'omnibus banner present');
  assert.ok(t.includes('nothing resets to baseline'), 'states the editor consequence honestly');
});

test('summary line never invents a "from" value it does not know', () => {
  const scoped = textOf(render(Panel, {
    status: 'ready', proposal: { rec: 1 }, presets: PRESETS, results: [],
    baselineScoring: { rec: 0.5 }, leagues: SCOPE_LEAGUES, selectedLeagueId: 'L1',
  }));
  assert.ok(scoped.includes('Reception (PPR) 0.5 \u2192 1.0'), 'scoped shows the real from-value: ' + scoped.slice(0, 0));
  const omni = textOf(render(Panel, {
    status: 'ready', proposal: { rec: 1 }, presets: PRESETS, results: [],
    baselineScoring: null, leagues: SCOPE_LEAGUES, selectedLeagueId: '__all',
  }));
  assert.ok(omni.includes('Reception (PPR) \u2192 1.0') && !omni.includes('Reception (PPR) 0.5'), 'omnibus omits the from-value');
});

test('quick rule input stages negative/fractional values; steps and selected-rule reset commit only their intended override', () => {
  const staged = [], committed = [];
  withPanelState({ status: 'ready', results: [], proposal: { pass_td: 6 }, baselineScoring: { rec: 0.5, pass_td: 4 }, selectedLeagueId: 'L1',
    onProposalStage: next => staged.push(next), onProposalChange: next => committed.push(next) }, draw => {
    let tree = draw();
    const input = field(tree, 'Proposed value');
    assert.strictEqual(input.props.min, undefined, 'negative proposals are allowed');
    assert.strictEqual(input.props.max, undefined, 'arbitrary valid scoring values are allowed');
    input.props.onChange({ target: { value: '-0.25' } });
    assert.deepStrictEqual(staged, [{ pass_td: 6, rec: -0.25 }]);
    assert.deepStrictEqual(committed, [], 'typing does not run the replay');
    tree = draw({ proposal: staged[0], hasUnanalyzedChanges: true });
    assert.strictEqual(field(tree, 'Proposed value').props.value, '-0.25');
    findAll(tree, n => n.type === 'button' && n.props['aria-label'] === 'Increase Reception (PPR)')[0].props.onClick();
    assert.deepStrictEqual(committed.at(-1), { pass_td: 6, rec: 0 }, 'a deliberate step commits a zero override without dropping other rules');
    tree = draw({ proposal: committed.at(-1) });
    button(tree, 'Reset this rule').props.onClick();
    assert.deepStrictEqual(committed.at(-1), { pass_td: 6 }, 'reset selected rule preserves the other override');
    tree = draw({ proposal: { rec: 0.25, pass_td: 6 } });
    findAll(tree, n => n.type === 'button' && n.props['aria-label'] === 'Increase Reception (PPR)')[0].props.onClick();
    assert.deepStrictEqual(committed.at(-1), { pass_td: 6 }, 'stepping back to a known baseline removes just that override');
  });
});

test('in-progress numeric text stays editable and scope changes discard only its local display draft', () => {
  let staged;
  withPanelState({ status: 'ready', results: [], proposal: {}, baselineScoring: { rec: 0.5 }, selectedLeagueId: 'L1', onProposalStage: next => { staged = next; } }, draw => {
    let tree = draw();
    for (const raw of ['', '-', '-0.']) {
      field(tree, 'Proposed value').props.onChange({ target: { value: raw } });
      tree = draw({ proposal: staged });
      assert.strictEqual(field(tree, 'Proposed value').props.value, raw, 'the field must retain ' + JSON.stringify(raw));
    }
    tree = draw({ selectedLeagueId: 'L2', baselineScoring: { rec: 1 }, proposal: {} });
    assert.strictEqual(field(tree, 'Proposed value').props.value, 1, 'the old league draft does not follow the new scope');
  });
});

test('unknown baseline stays unknown until an explicit number; zero remains a real omnibus override', () => {
  let staged;
  withPanelState({ status: 'ready', results: [], proposal: {}, baselineScoring: null, selectedLeagueId: '__all', onProposalStage: next => { staged = next; } }, draw => {
    let tree = draw();
    const current = findAll(tree, n => n.props.className === 'co-rulelab-current-value')[0];
    assert.ok(textOf(current).includes('—') && textOf(current).includes('Varies by league'));
    assert.strictEqual(field(tree, 'Proposed value').props.value, '');
    const steps = findAll(tree, n => n.type === 'button' && /^(Increase|Decrease) /.test(n.props['aria-label'] || ''));
    assert.ok(steps.every(n => n.props.disabled), 'no invented zero is available to increment');
    field(tree, 'Proposed value').props.onChange({ target: { value: '0' } });
    assert.deepStrictEqual(staged, { rec: 0 });
    tree = draw({ proposal: staged });
    assert.ok(findAll(tree, n => n.type === 'button' && /^(Increase|Decrease) /.test(n.props['aria-label'] || '')).every(n => !n.props.disabled));
  });
});

test('Preview changes is explicit and sharing stays disabled while edits await preview', () => {
  let previews = 0;
  const props = { status: 'ready', proposal: { rec: 1 }, presets: PRESETS, results: [results[0]], onAnalyze: () => previews++, onCopyBallot() {}, onExportBallot() {} };
  let tree = render(Panel, { ...props, hasUnanalyzedChanges: false });
  assert.strictEqual(button(tree, 'Preview changes').props.disabled, true);
  button(tree, 'Preview changes').props.onClick(); assert.strictEqual(previews, 0);
  tree = render(Panel, { ...props, hasUnanalyzedChanges: true });
  assert.strictEqual(button(tree, 'Preview changes').props.disabled, false);
  assert.ok(textOf(tree).includes('This result still reflects your last preview'));
  assert.strictEqual(button(tree, 'Copy ballot text').props.disabled, true);
  assert.strictEqual(button(tree, 'Export PNG').props.disabled, true);
  button(tree, 'Preview changes').props.onClick(); assert.strictEqual(previews, 1);
});

test('advanced editors and detailed evidence start collapsed on phone and desktop', () => {
  for (const phone of [false, true]) {
    const tree = render(Panel, { status: 'ready', phone, proposal: {}, results: [results[0]], presets: PRESETS });
    for (const label of ['Starting lineup changes', 'All scoring rules', 'Find a scoring threshold', 'View details']) {
      const disclosure = findAll(tree, n => n.type === 'details' && findAll(n, c => c.type === 'summary').some(c => textOf(c).startsWith(label)))[0];
      assert.ok(disclosure, label + ' remains accessible');
      assert.ok(!disclosure.props.open, label + ' starts collapsed');
    }
    assert.ok(findAll(tree, n => n.props['data-testid'] === 'rulelab-controls').length === 1);
    assert.ok(findAll(tree, n => n.props['data-testid'] === 'rulelab-impact').length === 1);
    assert.ok(textOf(tree).includes('Teams changing rank10 of 12') && textOf(tree).includes('Largest points change+30.5 ptsTeam A'));
  }
});

test('View all teams reveals unchanged standings and middle point changes, then restores the compact evidence', () => {
  withPanelState({ status: 'ready', proposal: {}, results: [results[0]], presets: PRESETS }, draw => {
    let tree = draw();
    assert.ok(!textOf(tree).includes('Team K'));
    button(tree, 'View all teams').props.onClick(); tree = draw();
    for (const name of teamNames) assert.ok(textOf(tree).includes(name), name + ' remains available');
    const standings = findAll(tree, n => n.props['aria-label'] === 'Standings shift. Scroll for all columns.')[0];
    assert.ok(textOf(standings).includes('Team K1111—'), 'unchanged team is not described as moving');
    const points = findAll(tree, n => n.props['aria-label'] === 'Season points comparison. Scroll for all columns.')[0];
    assert.ok(textOf(points).includes('Team D1200.01205.0+5.0') && textOf(points).includes('Team E1100.01102.0+2.0'));
    button(tree, 'Show biggest changes').props.onClick(); tree = draw();
    assert.ok(!textOf(tree).includes('Team K'));
  });
});

test('replay recovery remains available for failed reads and is disabled during a threshold comparison', () => {
  let retries = 0;
  for (const status of ['empty', 'error']) {
    let tree = render(Panel, { status, proposal: {}, results: [], onRetryReplay: () => retries++ });
    button(tree, 'Retry replay').props.onClick();
    tree = render(Panel, { status, proposal: {}, results: [], sweepBusy: 'rec', onRetryReplay: () => retries++ });
    assert.strictEqual(button(tree, 'Retry replay').props.disabled, true);
  }
  const tree = render(Panel, { status: 'ready', proposal: {}, results: [results[2]], onRetryReplay: () => retries++ });
  button(tree, 'Retry replay').props.onClick();
  button(tree, 'Reload season data').props.onClick();
  assert.strictEqual(retries, 4);
});

test('compact feedback reports actual preview evidence and never invents zero movement for unavailable data', () => {
  const feedback = tree => findAll(tree, n => n.props.className === 'co-rulelab-feedback')[0];
  let tree = render(Panel, { status: 'ready', proposal: {}, results: [results[0]], hasUnanalyzedChanges: true });
  assert.ok(textOf(feedback(tree)).includes('Last preview10 of 12 teams change rank. 1 in, 1 out'));
  assert.ok(textOf(feedback(tree)).includes('#1 seed: Team A → Team B2025 · 14 weeks replayed'));
  tree = render(Panel, { status: 'ready', proposal: {}, results: [results[2]] });
  assert.ok(textOf(feedback(tree)).includes('Replay data is unavailable'));
  assert.ok(!textOf(feedback(tree)).includes('teams change rank') && !textOf(feedback(tree)).includes('#1 seed holds'));
  const impact = findAll(tree, n => n.props.id === 'wr-rulelab-impact')[0];
  assert.strictEqual(impact.props.tabIndex, -1, 'impact area is a focus destination');
  assert.strictEqual(button(tree, 'See replay impact').props['aria-controls'], impact.props.id);
  const workspace = findAll(tree, n => n.props.className === 'co-rulelab-workspace')[0];
  assert.deepStrictEqual(workspace.children.filter(n => n && n.props).map(n => n.props['data-testid'] || n.props.className), ['rulelab-controls', 'rulelab-impact', 'co-rulelab-save'], 'reading order follows controls, evidence, save');
});

test('a zero-point swing has no arbitrary biggest-gainer name and confirmed saves are announced', () => {
  const zeroResult = { ...quietResult, teamDeltas: [{ rosterId: 1, name: 'Alphabetical first', baselinePts: 100, proposedPts: 100, delta: 0 }] };
  const tree = render(Panel, { status: 'ready', proposal: {}, results: [{ leagueId: 'L1', result: zeroResult }], savedNotice: 'Saved “Reviewed rules” in this browser.' });
  const headline = findAll(tree, n => n.props.className === 'co-rulelab-impact-summary')[0];
  assert.ok(textOf(headline).includes('Largest points change0.0 pts'));
  assert.ok(!textOf(headline).includes('Alphabetical first'));
  const notice = findAll(tree, n => n.props.className === 'co-rulelab-saved-notice')[0];
  assert.strictEqual(notice.props.role, 'status');
  assert.strictEqual(textOf(notice), 'Saved “Reviewed rules” in this browser.');
});

test('proposal name stays available after failed save and clears only after success', () => {
  const original = React.useState, slots = []; let cursor = 0, allowed = false, savedNames = [];
  React.useState = initial => {
    const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value];
  };
  const draw = () => { cursor = 0; return render(Panel, { status: 'ready', proposal: { rec: 1 }, presets: [], results: [], saved: [], onSaveProposal: name => { savedNames.push(name); return allowed; } }); };
  const nameField = tree => findAll(tree, n => n.type === 'input' && n.props['aria-label'] === 'Proposal name')[0];
  const saveButton = tree => findAll(tree, n => n.type === 'button' && textOf(n).trim() === 'Save draft')[0];
  try {
    let tree = draw(); nameField(tree).props.onChange({ target: { value: 'Keep this proposal name' } }); tree = draw();
    saveButton(tree).props.onClick(); tree = draw(); assert.strictEqual(nameField(tree).props.value, 'Keep this proposal name');
    allowed = true; saveButton(tree).props.onClick(); tree = draw(); assert.strictEqual(nameField(tree).props.value, '');
    assert.deepStrictEqual(savedNames, ['Keep this proposal name', 'Keep this proposal name']);
  } finally { React.useState = original; }
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
  process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
