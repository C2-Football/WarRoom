#!/usr/bin/env node
// Smoke tests for js/components/commish-command-panel.js — the office's
// front door (WrCommishCommandPanel). Same strategy as
// tests/commish-rulelab-panel.js: Babel-transform the JSX, eval against a
// minimal React shim, walk the materialized tree asserting props.
//
// The point of interest here is RESPONSIVE LAYOUT. The grid's eight domain
// columns are fluid on desktop and fixed-width-plus-scroll when narrow. That
// used to key off `phone` alone (<768px), which left portrait iPad — 208px
// sidebar plus eight fluid columns in ~500px — with ~36px headers that wrap
// one letter per line. `narrowGrid` is the seam, and these tests pin it so
// the tablet case cannot quietly regress back to the desktop layout.
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

// ── React shim ──────────────────────────────────────────────────
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    props = props || {};
    if (typeof type === 'function') return type({ ...props, children: children.length === 1 ? children[0] : children });
    return { type, props, children };
  },
  useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
  useRef(init) { return { current: init }; },
};
function walk(node, fn) {
  if (node == null || typeof node === 'boolean') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, fn)); return; }
  if (typeof node === 'string' || typeof node === 'number') { fn({ text: String(node) }); return; }
  fn(node);
  walk(node.children, fn);
}
function findAll(tree, pred) {
  const out = [];
  walk(tree, n => { if (n.text == null && pred(n)) out.push(n); });
  return out;
}
// Every gridTemplateColumns in the rendered tree, in document order.
function gridTemplates(tree) {
  return findAll(tree, n => n.props && n.props.style && n.props.style.gridTemplateColumns)
    .map(n => n.props.style.gridTemplateColumns);
}

// ── Load the panel file ─────────────────────────────────────────
global.window = globalThis;
global.React = React;
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'commish-command-panel.js'), 'utf8');
(0, eval)(Babel.transform(src, { presets: [['react']] }).code);
const Panel = window.WrCommishCommandPanel;

// ── Fixtures ────────────────────────────────────────────────────
const DOMAINS = [
  { key: 'coefficient', label: 'Coefficient', hub: 'network' },
  { key: 'people', label: 'People', hub: 'people' },
  { key: 'operations', label: 'Operations', hub: 'ops' },
  { key: 'programmes', label: 'Programmes', hub: 'programmes' },
  { key: 'rulelab', label: 'Rule Lab', hub: 'rulelab' },
  { key: 'schedule', label: 'Schedule Builder', hub: 'schedule' },
  { key: 'genesis', label: 'Season Setup', hub: 'genesis' },
  { key: 'bylaws', label: 'Bylaws + Dues', hub: 'governance' },
];
const grid = {
  leagues: [
    { leagueId: 'L1', tag: 'DW', name: 'Dynasty Warlords', pct: 80, openSeats: 0 },
    { leagueId: 'L2', tag: 'EM', name: 'Empire', pct: 55, openSeats: 1 },
  ],
  domains: DOMAINS,
  cell: (lid, key) => (lid === 'L2' && key === 'people' ? { n: 2, state: 'NOW' } : { n: 0, state: 'CLEAR' }),
};
const desks = [
  { group: 'OPEN THE SEASON', hub: 'genesis', name: 'Season Setup', badge: null, stat: '68%', unit: 'AVG READINESS', status: 'Lowest: Empire' },
  { group: 'OPEN THE SEASON', hub: 'ops', name: 'Operations', badge: null, stat: '0', unit: 'UNRATIFIED EDITS', status: 'Clear' },
  { group: 'HOLD THE ROOM', hub: 'people', name: 'People', badge: null, stat: '2', unit: 'FLAGGED DARK', status: 'Two owners quiet' },
  { group: 'THE BROADCAST', hub: 'network', name: 'The Coefficient', badge: null, stat: '—', unit: 'RANKED', status: 'Waiting on week 1' },
];
const base = {
  queue: { items: [], counts: { now: 0, soon: 0, backlog: 0 }, diagnosis: null },
  kpis: [], grid, desks,
  onOpenHub: () => {}, onFilter: () => {}, filter: null,
  onSelectItem: () => {}, onEnterLeague: () => {},
};
const render = (extra) => Panel({ ...base, ...extra });

// The 140px/56px template is the narrow one; minmax(0,1fr) is the fluid one.
const NARROW = '140px repeat(8, 56px)';
const FLUID = '190px repeat(8, minmax(0,1fr))';

console.log('Commissioner command panel — responsive grid');

test('desktop (no phone, no narrowGrid) keeps the fluid eight-column grid', () => {
  const cols = gridTemplates(render({}));
  assert.ok(cols.includes(FLUID), 'expected fluid template, got: ' + cols.join(' | '));
  assert.ok(!cols.includes(NARROW));
});

test('phone with no narrowGrid prop still gets the narrow grid (back-compat)', () => {
  const cols = gridTemplates(render({ phone: true }));
  assert.ok(cols.includes(NARROW), 'expected narrow template, got: ' + cols.join(' | '));
});

test('portrait tablet — narrowGrid true while phone is false — gets the narrow grid', () => {
  const cols = gridTemplates(render({ phone: false, narrowGrid: true }));
  assert.ok(cols.includes(NARROW), 'tablet must not fall back to fluid columns: ' + cols.join(' | '));
  assert.ok(!cols.includes(FLUID));
});

test('narrowGrid false overrides phone true — the prop wins when given', () => {
  const cols = gridTemplates(render({ phone: true, narrowGrid: false }));
  assert.ok(cols.includes(FLUID));
  assert.ok(!cols.includes(NARROW));
});

test('narrow grid scrolls horizontally and pins the league column', () => {
  const tree = render({ narrowGrid: true });
  const scrollers = findAll(tree, n => n.props && n.props.style && n.props.style.overflowX === 'auto');
  assert.ok(scrollers.length >= 1, 'narrow grid needs an overflowX:auto wrapper');
  const sticky = findAll(tree, n => n.props && n.props.style && n.props.style.position === 'sticky' && n.props.style.left === 0);
  assert.ok(sticky.length >= 1, 'league names must stay pinned while the columns scroll');
});

test('desktop grid has no scroll wrapper and nothing pinned', () => {
  const tree = render({});
  const scrollers = findAll(tree, n => n.props && n.props.style && n.props.style.overflowX === 'auto');
  assert.strictEqual(scrollers.length, 0);
  const sticky = findAll(tree, n => n.props && n.props.style && n.props.style.position === 'sticky' && n.props.style.left === 0);
  assert.strictEqual(sticky.length, 0);
});

test('desk cards go two-up when narrow, four-up on desktop', () => {
  assert.ok(gridTemplates(render({ narrowGrid: true })).includes('repeat(2, 1fr)'));
  assert.ok(gridTemplates(render({})).includes('repeat(4, 1fr)'));
});

test('every domain column renders a header button that opens its hub', () => {
  const opened = [];
  const tree = Panel({ ...base, onOpenHub: (hub) => opened.push(hub) });
  const headers = findAll(tree, n => n.type === 'button' && n.props.onMouseEnter && n.props.style && n.props.style.alignSelf === 'end');
  assert.strictEqual(headers.length, DOMAINS.length, 'one header per domain');
  headers.forEach(h => h.props.onClick());
  assert.deepStrictEqual(opened, DOMAINS.map(d => d.hub));
});

console.log((failed ? 'FAIL' : 'PASS') + ': ' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.error('  ' + f.name + ': ' + (f.e && f.e.stack || f.e))); process.exit(1); }
