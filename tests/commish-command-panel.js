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

// Narrow columns preserve full words; minmax(0,1fr) is the fluid desktop one.
const NARROW = '140px repeat(8, 112px)';
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

test('phone and tablet matrix exposes a labelled keyboard scroll region and visible sideways hint', () => {
  for (const layout of [{ phone: true }, { phone: false, narrowGrid: true }]) {
    const tree = render(layout);
    const scroller = findAll(tree, n => n.props['data-testid'] === 'commish-league-grid-scroll')[0];
    assert.strictEqual(scroller.props.role, 'region');
    assert.strictEqual(scroller.props['aria-label'], 'Workspaces across your leagues');
    assert.strictEqual(scroller.props.tabIndex, 0, 'keyboard users can focus and scroll the overflow region');
    const matrix = findAll(scroller, n => n.props.style?.gridTemplateColumns)[0];
    const pinnedWidth = parseInt(matrix.props.style.gridTemplateColumns, 10);
    const gap = parseInt(matrix.props.style.gap, 10);
    assert.ok(parseInt(scroller.props.style.scrollPaddingInlineStart, 10) >= pinnedWidth + gap,
      'native focus scrolling must leave enough space for the pinned league column and gap');
    const hint = findAll(tree, n => n.props['data-testid'] === 'commish-league-grid-scroll-hint')[0];
    assert.ok(hint, 'horizontal scrolling cannot rely on discovering a hidden scrollbar');
    assert.deepStrictEqual(hint.children, ['Scroll sideways for all ', 8, ' workspaces. League names stay in view.']);
    assert.notStrictEqual(hint.props.style.display, 'none');
  }
});

test('narrow matrix preserves words, touch header targets, all eight destinations and final-column filters', () => {
  const opened = [], filtered = [];
  const tree = render({ phone: false, narrowGrid: true, onOpenHub: (...args) => opened.push(args), onFilter: value => filtered.push(value) });
  const scroller = findAll(tree, n => n.props['data-testid'] === 'commish-league-grid-scroll')[0];
  const headers = findAll(scroller, n => n.type === 'button' && n.props.onMouseEnter && n.props.style?.alignSelf === 'end');
  assert.deepStrictEqual(headers.map(header => header.children[0]), DOMAINS.map(domain => domain.label), 'overflow must retain every workspace heading');
  headers.forEach(header => {
    assert.strictEqual(header.props.style.wordBreak, 'normal', 'never split Schedule/Builder into arbitrary fragments');
    assert.strictEqual(header.props.style.overflowWrap, 'normal');
    assert.ok(parseInt(header.props.style.minHeight, 10) >= 44, 'headings remain touch targets');
  });
  headers.at(-1).props.onClick();
  assert.deepStrictEqual(opened, [['governance', { leagueId: null }]], 'eighth heading still opens its workspace');
  const finalCells = findAll(scroller, n => n.type === 'button' && n.props.title?.includes(' · Bylaws + Dues'));
  assert.strictEqual(finalCells.length, grid.leagues.length, 'each league retains its eighth matrix cell');
  finalCells[0].props.onClick();
  assert.deepStrictEqual(filtered, [{ tier: null, leagueId: 'L1', domain: 'bylaws' }]);
});

function withMatrixFocus({ layout = { narrowGrid: true }, marked = true, keyboard = true,
  rect = { left: 129, right: 241 } } = {}, check) {
  const previousDocument = global.document;
  const previousFrame = window.requestAnimationFrame;
  const frames = [], revealed = [];
  const state = { keyboard, rect };
  const target = {
    matches(selector) {
      return selector === ':focus-visible' ? state.keyboard : marked && state.keyboard;
    },
    getBoundingClientRect() { return state.rect; },
    scrollIntoView(options) { revealed.push(options); },
  };
  const scroller = { getBoundingClientRect: () => ({ left: 29, right: 357 }) };
  try {
    global.document = { activeElement: target };
    window.requestAnimationFrame = callback => { frames.push(callback); };
    const region = findAll(render(layout), n => n.props['data-testid'] === 'commish-league-grid-scroll')[0];
    region.props.onFocusCapture({ target, currentTarget: scroller });
    check({ frames, revealed, state, target, flush: () => frames.splice(0).forEach(callback => callback()) });
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousFrame === undefined) delete window.requestAnimationFrame;
    else window.requestAnimationFrame = previousFrame;
  }
}

test('keyboard reveal covers all domain headings and counts, excluding pinned league controls', () => {
  const region = findAll(render({ narrowGrid: true }), n => n.props['data-testid'] === 'commish-league-grid-scroll')[0];
  const controls = findAll(region, n => n.type === 'button');
  const cells = controls.filter(n => n.props['data-commish-matrix-cell'] !== undefined);
  assert.strictEqual(cells.length, DOMAINS.length * (grid.leagues.length + 1), 'every domain heading and league count participates');
  assert.ok(cells.every(n => !n.props.title?.startsWith('Open ')), 'pinned league buttons must not trigger horizontal reveal');
  assert.strictEqual(controls.length - cells.length, grid.leagues.length);
});

test('reverse keyboard focus reveals the whole control when partly behind the pinned league', () => {
  withMatrixFocus({}, ({ frames, revealed, flush }) => {
    assert.strictEqual(frames.length, 1, 'wait for native focus scrolling before checking visibility');
    assert.deepStrictEqual(revealed, []);
    flush();
    assert.deepStrictEqual(revealed, [{ block: 'nearest', inline: 'end', behavior: 'instant' }]);
  });
  withMatrixFocus({ rect: { left: 300, right: 412 } }, ({ revealed, flush }) => {
    flush();
    assert.strictEqual(revealed.length, 1, 'forward focus beyond the right edge must also reveal the whole control');
  });
});

test('visible keyboard cells and cells already revealed by native scrolling do not jump', () => {
  withMatrixFocus({ rect: { left: 173, right: 285 } }, ({ revealed, flush }) => {
    flush();
    assert.deepStrictEqual(revealed, []);
  });
  withMatrixFocus({}, ({ state, revealed, flush }) => {
    state.rect = { left: 173, right: 285 };
    flush();
    assert.deepStrictEqual(revealed, [], 'use settled bounds, not the focus-event position');
  });
});

test('touch or mouse focus, pinned controls and wide matrices retain native scrolling', () => {
  for (const options of [{ keyboard: false }, { marked: false }, { layout: { narrowGrid: false } }]) {
    withMatrixFocus(options, ({ frames, revealed, flush }) => {
      flush();
      assert.deepStrictEqual(frames, []);
      assert.deepStrictEqual(revealed, []);
    });
  }
});

test('queued matrix reveal never scrolls an old or no-longer-keyboard focused control', () => {
  withMatrixFocus({}, ({ revealed, flush }) => {
    document.activeElement = {};
    flush();
    assert.deepStrictEqual(revealed, []);
  });
  withMatrixFocus({}, ({ state, revealed, flush }) => {
    state.keyboard = false;
    flush();
    assert.deepStrictEqual(revealed, []);
  });
});

test('desktop grid has no scroll wrapper and nothing pinned', () => {
  const tree = render({});
  const scrollers = findAll(tree, n => n.props && n.props.style && n.props.style.overflowX === 'auto');
  assert.strictEqual(scrollers.length, 0);
  const sticky = findAll(tree, n => n.props && n.props.style && n.props.style.position === 'sticky' && n.props.style.left === 0);
  assert.strictEqual(sticky.length, 0);
  assert.strictEqual(findAll(tree, n => n.props['data-testid'] === 'commish-league-grid-scroll-hint').length, 0);
  const matrix = findAll(tree, n => n.props['data-testid'] === 'commish-league-grid-scroll')[0];
  assert.strictEqual(matrix.props.tabIndex, undefined, 'wide desktop does not add an unnecessary scroll stop');
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

test('task action preserves league scope and action intent when opening a workspace', () => {
  const opened = [];
  const item = { id: 'draft-date', tier: 'NOW', hub: 'ops', headline: 'Set a draft date', leagueIds: ['league-42'], action: { label: 'Schedule', kind: 'draft-date' } };
  const tree = render({ phone: true, queue: { items: [item] }, onOpenHub: (...args) => opened.push(args) });
  const action = findAll(tree, n => n.type === 'button' && n.children?.includes('Schedule'))[0];
  action.props.onClick({ stopPropagation() {} });
  assert.deepStrictEqual(opened, [['ops', { leagueId: 'league-42', action: 'draft-date' }]]);
});

test('task review is a separate native button on phone and desktop', () => {
  for (const layout of [{ phone: true }, { phone: false, narrowGrid: true }, { phone: false }]) {
    const selected = [];
    const item = { id: 'draft-date', tier: 'NOW', headline: 'Set a draft date', leagueIds: ['league-42'] };
    const tree = render({ ...layout, queue: { items: [item] }, onSelectItem: it => selected.push(it.id) });
    const review = findAll(tree, n => n.type === 'button' && n.props['aria-label'] === 'Review Set a draft date')[0];
    assert.ok(review, 'keyboard-accessible review control');
    review.props.onClick({ stopPropagation() {} });
    assert.deepStrictEqual(selected, ['draft-date']);
    assert.equal(findAll(review.children, n => n.type === 'button').length, 0, 'no nested controls');
  }
});

const rowItems = ['NOW', 'SOON', 'BACKLOG'].map(tier => ({
  id: 'task-' + tier.toLowerCase(), tier, hub: 'ops', leagueIds: ['league-42'],
  headline: 'QA Empty Redraft has no draft on the calendar.',
  metric: { value: 2, unit: 'days' },
  action: { label: 'Open draft settings', kind: 'draft-date' },
}));
const taskRows = tree => findAll(tree, n => n.props['data-testid'] === 'commish-task-row');

test('tablet task rows use cards instead of desktop columns for every priority', () => {
  const tree = render({ phone: false, narrowGrid: true, queue: { items: rowItems } });
  const rows = taskRows(tree);
  assert.strictEqual(rows.length, 3);
  rows.forEach(row => {
    assert.strictEqual(row.props['data-layout'], 'card');
    assert.strictEqual(row.props.style.display, 'flex');
    assert.strictEqual(findAll(row, n => n.props.style?.gridTemplateColumns).length, 0,
      'fixed task columns must not squeeze the tablet headline to zero width');
    const review = findAll(row, n => n.type === 'button' && n.props['aria-label']?.startsWith('Review '))[0];
    assert.strictEqual(review.props.style.width, '100%');
    assert.strictEqual(review.props.style.minHeight, '44px');
    assert.strictEqual(review.props.style.WebkitLineClamp, 2, 'long headlines stay bounded');
    assert.strictEqual(review.props.title, rowItems[0].headline, 'full headline remains available');
  });
});

test('tablet direct actions keep 44px targets and do not open task review', () => {
  const opened = [], selected = [];
  const tree = render({ phone: false, narrowGrid: true, queue: { items: rowItems },
    onOpenHub: (...args) => opened.push(args), onSelectItem: item => selected.push(item.id) });
  const rows = taskRows(tree);
  const actions = findAll(rows, n => n.type === 'button' && n.children.includes('Open draft settings'));
  assert.strictEqual(actions.length, 2, 'NOW and SOON retain direct actions; backlog stays compact');
  let stopped = 0;
  actions.forEach(action => {
    assert.strictEqual(action.props.style.height, '44px');
    assert.strictEqual(action.props.style.width, '100%');
    action.props.onClick({ stopPropagation() { stopped++; } });
  });
  assert.strictEqual(stopped, 2);
  assert.deepStrictEqual(selected, []);
  assert.deepStrictEqual(opened, Array(2).fill(['ops', { leagueId: 'league-42', action: 'draft-date' }]));
});

test('wide desktop retains dense task columns and compact direct actions', () => {
  const tree = render({ phone: false, narrowGrid: false, queue: { items: rowItems } });
  const rows = taskRows(tree);
  assert.strictEqual(rows.length, 3);
  rows.forEach(row => {
    assert.strictEqual(row.props['data-layout'], 'table');
    assert.strictEqual(row.props.style.gridTemplateColumns, '3px 60px minmax(0,1fr) 120px 92px 112px 20px');
    const action = findAll(row, n => n.type === 'button' && n.children.includes('Open draft settings'))[0];
    assert.strictEqual(action.props.style.height, '28px');
  });
});

test('phone task cards remain readable even when narrowGrid is explicitly false', () => {
  const tree = render({ phone: true, narrowGrid: false, queue: { items: rowItems } });
  assert.ok(taskRows(tree).every(row => row.props['data-layout'] === 'card'));
});

test('1024px landscape matrix scrolls while desktop task and desk layouts remain dense', () => {
  const previousWidth = window.innerWidth;
  try {
    window.innerWidth = 1024;
    const tree = render({ phone: false, narrowGrid: false, queue: { items: rowItems } });
    assert.ok(gridTemplates(tree).includes(NARROW), 'landscape tablet must not inherit squeezed fluid matrix columns');
    assert.ok(taskRows(tree).every(row => row.props['data-layout'] === 'table'), 'matrix breakpoint does not change task rows');
    assert.ok(gridTemplates(tree).includes('repeat(4, 1fr)'), 'matrix breakpoint does not change desktop desk density');
    const region = findAll(tree, n => n.props['data-testid'] === 'commish-league-grid-scroll')[0];
    assert.strictEqual(region.props.role, 'region');
    assert.strictEqual(region.props.style.overflowX, 'auto');
    window.innerWidth = 1440;
    const wide = render({ phone: false, narrowGrid: false });
    assert.ok(gridTemplates(wide).includes(FLUID), 'wide desktop keeps the existing fluid density after a resize');
    assert.strictEqual(findAll(wide, n => n.props['data-testid'] === 'commish-league-grid-scroll-hint').length, 0);
  } finally {
    if (previousWidth === undefined) delete window.innerWidth;
    else window.innerWidth = previousWidth;
  }
});

console.log((failed ? 'FAIL' : 'PASS') + ': ' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.error('  ' + f.name + ': ' + (f.e && f.e.stack || f.e))); process.exit(1); }
