#!/usr/bin/env node
// Stateful presentation contracts for Season Setup. The actual Genesis
// engine supplies readiness; JSX is rendered with a small hook/tree harness.
// These checks exercise user callbacks and prop-driven save outcomes without
// a browser, network, or external storage writes.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');
const Genesis = require('../js/shared/commish-genesis.js');
const compiled = Babel.transform(fs.readFileSync(path.join(__dirname, '../js/components/commish-genesis-panel.js'), 'utf8'), {
  presets: [['react', { runtime: 'classic' }]], sourceType: 'script',
}).code;

let passed = 0;
let failed = 0;
function test(name, run) {
  Genesis._mem.clear();
  try { run(); passed++; console.log('  ok  ' + name); }
  catch (error) { failed++; console.error('  FAIL ' + name + '\n' + error.stack); }
}
function harness(initial) {
  const slots = [];
  let cursor = 0;
  let props = initial;
  let raw;
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  ctx.React = {
    Fragment: 'Fragment',
    createElement(type, attributes, ...children) {
      return { type, props: attributes || {}, children: children.flat(Infinity).filter(child => child != null && child !== false) };
    },
    useState(initialValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
  };
  vm.runInContext(compiled, ctx, { filename: 'commish-genesis-panel.js' });
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  };
  return {
    render(next) {
      if (next) props = { ...props, ...next };
      cursor = 0;
      raw = ctx.WrCommishGenesisPanel(props);
      return expand(raw);
    },
    sectionIdentity: () => raw.type,
  };
}
function findAll(node, predicate, includeHidden = false, matches = []) {
  if (!node || typeof node !== 'object' || (!includeHidden && node.props.hidden)) return matches;
  if (predicate(node)) matches.push(node);
  node.children.forEach(child => findAll(child, predicate, includeHidden, matches));
  return matches;
}
function text(node) {
  if (node == null) return '';
  if (typeof node !== 'object') return String(node);
  return node.children.map(text).join(' ');
}
function byLabel(tree, label) {
  const found = findAll(tree, node => node.type === 'button' && node.props['aria-label'] === label);
  assert.strictEqual(found.length, 1, 'one visible control: ' + label);
  return found[0];
}
function expandLeague(ui, leagueName) {
  const header = byLabel(ui.render(), 'Season setup for ' + leagueName);
  header.props.onClick();
  return ui.render();
}
const NOW = 1754000000000;
const manualIds = ['dues_noted', 'rules_reratified', 'welcome_drafted'];
function ready(leagueId = 'L1', leagueName = 'Dynasty Prime', overrides = {}) {
  return Genesis.buildReadiness({
    league: { league_id: leagueId, name: leagueName, settings: { trade_deadline: 10 }, rosters: [{ roster_id: 1 }, { roster_id: 2 }] },
    calendarEvents: [{ type: 'draft', leagueId, ts: NOW + 86400000, status: 'pre_draft' }],
    driftResult: { firstRun: false, changes: [] }, seats: [], constitutionOnFile: true,
    manual: Object.fromEntries(manualIds.map(id => [id, true])), nowMs: NOW, ...overrides,
  });
}
const autoActions = {
  draft_scheduled: 'Open Sleeper for draft date', settings_ratified: 'Review settings',
  all_seats_filled: 'View open seats', deadline_set: 'Open Sleeper for deadline',
  rosters_present: 'View rosters', constitution_on_file: 'View bylaws',
};

test('every 100% league remains inspectable beside the success status', () => {
  const ui = harness({ readiness: [ready(), ready('L2', 'Second League')], onToggle() {} });
  let tree = ui.render();
  assert.match(text(findAll(tree, node => node.props.role === 'status')[0]), /Every league is opening-day ready/);
  assert.strictEqual(findAll(tree, node => node.props['data-testid'] === 'genesis-league').length, 2);
  assert.strictEqual(findAll(tree, node => node.type === 'button' && 'aria-pressed' in node.props).length, 0, 'collapsed checks stay out of keyboard flow');
  tree = expandLeague(ui, 'Dynasty Prime');
  assert.strictEqual(findAll(tree, node => node.props['data-item-id']).length, 9, 'all six automatic and three manual checks remain visible');
  const header = byLabel(tree, 'Season setup for Dynasty Prime');
  assert.strictEqual(header.props['aria-expanded'], true);
  assert.strictEqual(findAll(tree, node => node.props.id === header.props['aria-controls']).length, 1);
  tree = expandLeague(ui, 'Second League');
  assert.strictEqual(findAll(tree, node => node.props['data-item-id']).length, 18, 'league expansion is independent');
  header.props.onClick();
  tree = ui.render();
  assert.strictEqual(byLabel(tree, 'Season setup for Second League').props['aria-expanded'], true);
});

test('a completed manual check can be saved incomplete and reopened without losing the list', () => {
  manualIds.forEach(id => Genesis.toggleManual('L1', id, { nowMs: NOW }));
  const args = { manual: undefined };
  const toggles = [];
  const ui = harness({ readiness: [ready('L1', 'Dynasty Prime', args)], onToggle(lid, id) {
    toggles.push([lid, id]); Genesis.toggleManual(lid, id, { nowMs: NOW + 1 });
  } });
  let tree = expandLeague(ui, 'Dynasty Prime');
  const section = ui.sectionIdentity();
  const label = 'Mark Dues noted (tracked outside DHQ) as incomplete for Dynasty Prime';
  byLabel(tree, label).props.onClick();
  assert.strictEqual(byLabel(ui.render(), label).props['aria-pressed'], true, 'no optimistic done-state before new props');
  tree = ui.render({ readiness: [ready('L1', 'Dynasty Prime', args)] });
  assert.deepStrictEqual(toggles, [['L1', 'dues_noted']]);
  assert.strictEqual(ui.sectionIdentity(), section, 'stable section avoids remounting the focused checklist');
  assert.strictEqual(findAll(tree, node => node.props.role === 'status').length, 0);
  assert.strictEqual(byLabel(tree, 'Season setup for Dynasty Prime').props['aria-expanded'], true);
  assert.strictEqual(byLabel(tree, 'Mark Dues noted (tracked outside DHQ) as complete for Dynasty Prime').props['aria-pressed'], false);
  byLabel(tree, 'Season setup for Dynasty Prime').props.onClick();
  tree = expandLeague(ui, 'Dynasty Prime');
  assert.strictEqual(findAll(tree, node => node.props['data-item-id']).length, 9);
});

test('a rejected manual save leaves confirmed completion and success status intact', () => {
  const ui = harness({ readiness: [ready()], onToggle: () => false });
  let tree = expandLeague(ui, 'Dynasty Prime');
  const label = 'Mark Welcome broadcast drafted as incomplete for Dynasty Prime';
  byLabel(tree, label).props.onClick();
  tree = ui.render();
  assert.strictEqual(byLabel(tree, label).props['aria-pressed'], true);
  assert.strictEqual(findAll(tree, node => node.props.role === 'status').length, 1);
});

test('all six unfinished automatic checks open the correct league and exact check without toggling', () => {
  const r = ready('L2', 'Needs Setup');
  r.items.forEach(item => { if (item.kind === 'auto') item.done = false; });
  r.pct = 33; r.blockers = r.items.filter(item => !item.done).map(item => item.label);
  const opened = [];
  let toggles = 0;
  const ui = harness({ readiness: [r], onOpen: (lid, id) => opened.push([lid, id]), onToggle: () => toggles++ });
  const tree = expandLeague(ui, 'Needs Setup');
  Object.entries(autoActions).forEach(([id, label]) => {
    const control = byLabel(tree, label + ' for Needs Setup');
    assert.strictEqual(text(control), label);
    control.props.onClick();
    const row = findAll(tree, node => node.props['data-item-id'] === id)[0];
    assert.strictEqual(findAll(row, node => node.type === 'button' && 'aria-pressed' in node.props).length, 0);
  });
  assert.deepStrictEqual(opened, Object.keys(autoActions).map(id => ['L2', id]));
  assert.strictEqual(toggles, 0, 'navigation never checks off provider readiness');
});

test('completed automatic checks and unknown checks never advertise a dead Fix action', () => {
  const r = ready();
  r.items.push({ id: 'future_auto_check', kind: 'auto', done: false, label: 'Future check' });
  const ui = harness({ readiness: [r], onOpen() {}, onToggle() {} });
  const tree = expandLeague(ui, 'Dynasty Prime');
  assert.strictEqual(findAll(tree, node => node.type === 'button' && !('aria-pressed' in node.props) && !('aria-expanded' in node.props)).length, 0);
});

test('optional callbacks leave automatic status readable and disable unavailable manual writes', () => {
  const r = ready(); r.items[0].done = false;
  const ui = harness({ readiness: [r] });
  const tree = expandLeague(ui, 'Dynasty Prime');
  assert.strictEqual(findAll(tree, node => node.type === 'button').length, 4, 'header plus three manual checks only');
  findAll(tree, node => node.type === 'button' && 'aria-pressed' in node.props).forEach(button => assert.strictEqual(button.props.disabled, true));
  assert.strictEqual(findAll(tree, node => node.props.role === 'img' && node.props['aria-label'] === 'Needs attention').length, 1);
});

test('all checklist controls are native buttons with 44px targets and wrapped action text', () => {
  const r = ready(); r.items.forEach(item => { item.done = false; });
  const ui = harness({ readiness: [r], onOpen() {}, onToggle() {} });
  const tree = expandLeague(ui, 'Dynasty Prime');
  const buttons = findAll(tree, node => node.type === 'button');
  assert.strictEqual(buttons.length, 10);
  buttons.forEach(button => {
    assert.strictEqual(button.props.type, 'button', 'keyboard buttons must not submit a parent form');
    assert.strictEqual(button.props.style.minHeight, '44px');
    assert.ok(button.props['aria-label']);
    if (!('aria-pressed' in button.props) && !('aria-expanded' in button.props)) {
      assert.strictEqual(button.props.style.maxWidth, '100%');
      assert.strictEqual(button.props.style.whiteSpace, 'normal');
    }
  });
});

test('unknown and empty readiness remain honest and never announce success', () => {
  for (const readiness of [null, []]) {
    const tree = harness({ readiness }).render();
    assert.strictEqual(findAll(tree, node => node.props.role === 'status').length, 0);
    assert.strictEqual(findAll(tree, node => node.type === 'button').length, 0);
    assert.match(text(tree), readiness ? /No commissioned leagues/ : /hasn't run yet/);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
