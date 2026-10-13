#!/usr/bin/env node
// Contract tests for js/components/commish-people-panel.js (WrCommishPeoplePanel).
// The JSX is compiled with @babel/standalone and rendered against a stub React
// whose createElement builds a plain tree — function components are expanded by
// the walker, so assertions run on what would actually reach the DOM. No
// network, no real React, no browser.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const assert = require('assert');

// ── Harness ─────────────────────────────────────────────────────────
function makeCtx(extra) {
  const ctx = {
    console, Math, Number, String, Array, Object, JSON, Boolean, isNaN,
    setTimeout: () => 0, clearTimeout: () => {},
    window: null,
  };
  ctx.window = ctx;
  ctx.React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter(c => c != null && c !== false) };
    },
    Fragment: 'Fragment',
    useState(init) { return [init, () => {}]; },
    useRef(init) { return { current: init }; },
    useEffect() {},
  };
  Object.assign(ctx, extra || {});
  return vm.createContext(ctx);
}

function loadPanel(ctx) {
  const src = fs.readFileSync(path.join(ROOT, 'js/components/commish-people-panel.js'), 'utf8');
  const out = Babel.transform(src, { presets: [['react', { runtime: 'classic' }]], sourceType: 'script' }).code;
  vm.runInContext(out, ctx, { filename: 'commish-people-panel.js' });
  return ctx.window.WrCommishPeoplePanel;
}

// Expand function components so assertions see the real leaf tree.
function render(node) {
  if (node == null || typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(render);
  if (typeof node.type === 'function') {
    const merged = Object.assign({}, node.props, node.children.length ? { children: node.children } : {});
    return render(node.type(merged));
  }
  return { type: node.type, props: node.props, children: node.children.map(render) };
}
function textOf(node, acc) {
  acc = acc || [];
  if (node == null) return acc;
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc; }
  if (Array.isArray(node)) { node.forEach(n => textOf(n, acc)); return acc; }
  (node.children || []).forEach(n => textOf(n, acc));
  return acc;
}
function findAll(node, pred, acc) {
  acc = acc || [];
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, pred, acc)); return acc; }
  if (pred(node)) acc.push(node);
  (node.children || []).forEach(n => findAll(n, pred, acc));
  return acc;
}
const btnLabel = b => textOf(b).join('');

// ── Fixtures (radar ships people worst-first; the panel must not re-sort) ──
function fixtures() {
  const radar = { people: [
    { userId: 'u9', name: 'Dave', isMe: false, leagueCount: 2, status: 'DARK_ALL',
      checkin: 'Dave — no pressure on the leagues, just checking you are alright.',
      teams: [
        { leagueId: 'L1', leagueName: 'Dynasty One', rosterId: 1, inSeason: true, status: 'DARK', signals: { daysSinceTxn: 41, outStarters: 1, byeStarters: 0, emptySlots: 0 } },
        { leagueId: 'L2', leagueName: 'Empire', rosterId: 3, inSeason: true, status: 'DARK', signals: { daysSinceTxn: null, outStarters: 0, byeStarters: 0, emptySlots: 2 } },
      ] },
    { userId: 'u2', name: 'Bea', isMe: false, leagueCount: 2, status: 'DARK_ONE',
      checkin: 'Bea, your Empire squad has an OUT flag in the lineup — want a hand?',
      teams: [
        { leagueId: 'L1', leagueName: 'Dynasty One', rosterId: 2, inSeason: true, status: 'OK', signals: { daysSinceTxn: 2, outStarters: 0, byeStarters: 0, emptySlots: 0 } },
        { leagueId: 'L2', leagueName: 'Empire', rosterId: 4, inSeason: true, status: 'DARK', signals: { daysSinceTxn: 30, outStarters: 2, byeStarters: 0, emptySlots: 0 } },
      ] },
    { userId: 'u3', name: 'Cal', isMe: false, leagueCount: 1, status: 'FADING',
      checkin: 'should never render for FADING',
      teams: [{ leagueId: 'L1', leagueName: 'Dynasty One', rosterId: 5, inSeason: false, status: 'WATCH', signals: { daysSinceTxn: 20, outStarters: 0, byeStarters: 0, emptySlots: 0 } }] },
    { userId: 'me', name: 'Jake', isMe: true, leagueCount: 2, status: 'ACTIVE', checkin: null,
      teams: [
        { leagueId: 'L1', leagueName: 'Dynasty One', rosterId: 6, inSeason: true, status: 'OK', signals: { daysSinceTxn: 1, outStarters: 0, byeStarters: 0, emptySlots: 0 } },
        { leagueId: 'L2', leagueName: 'Empire', rosterId: 8, inSeason: true, status: 'OK', signals: { daysSinceTxn: 1, outStarters: 0, byeStarters: 0, emptySlots: 0 } },
      ] },
  ] };
  const seats = [{ leagueId: 'L2', leagueName: 'Empire', rosterId: 7, reason: 'owner_left' }];
  const benches = [[{ userId: 'u3', name: 'Cal', score: 4, reasons: ['active on radar', 'runs 2 leagues deep'], radarClass: 'ACTIVE' }]];
  const prospectuses = [{ leagueName: 'Empire', recordLine: '7-6', rosterSize: 25, topAssets: [], positionCounts: {}, pitch: 'Empire is a 12-team dynasty seat with a live playoff roster.' }];
  const folders = [{ leagueName: 'Empire', recruitName: 'Sam Rivera', sections: [
    { title: 'Welcome', body: 'Welcome to Empire.' },
    { title: 'House Rules', body: 'No constitution on file for this league yet.' },
  ] }];
  return { radar, seats, benches, prospectuses, folders };
}

console.log('\nWrCommishPeoplePanel contract');

// ── Full render ─────────────────────────────────────────────────────
(function full() {
  const copied = [];
  const ctx = makeCtx();
  const Panel = loadPanel(ctx);
  const fx = fixtures();
  const tree = render(Panel(Object.assign({}, fx, { onCopy: t => copied.push(t) })));
  const text = textOf(tree).join('|');

  test('component is assigned to window and renders a tree', () => {
    assert.strictEqual(typeof Panel, 'function');
    assert.ok(tree && typeof tree === 'object');
  });
  test('doctrine caption leads the Dave Alarm', () => {
    assert.ok(text.includes('Dark in one league means bored. Dark in all of them means life happened. Different conversations.'));
  });
  test('DARK_ALL chip reads DARK — ALL LEAGUES', () => {
    assert.ok(text.includes('DARK — ALL LEAGUES'));
  });
  test('DARK_ONE chip names the dark league', () => {
    assert.ok(text.includes('DARK — Empire'));
  });
  test('FADING and ACTIVE chips render, and people keep engine order (worst first)', () => {
    assert.ok(text.includes('FADING') && text.includes('ACTIVE'));
    assert.ok(text.indexOf('Dave') < text.indexOf('Bea') && assertIdx(text, 'Bea') < text.indexOf('Cal'));
    function assertIdx(t, s) { const i = t.indexOf(s); assert.ok(i >= 0, s + ' missing'); return i; }
  });
  test('check-in quote renders for DARK_* only', () => {
    assert.ok(text.includes('Dave — no pressure on the leagues'));
    assert.ok(text.includes('Bea, your Empire squad'));
    assert.ok(!text.includes('should never render for FADING'));
  });
  test('one status dot per team, tooltip explains the signals honestly', () => {
    const dots = findAll(tree, n => n.type === 'i' && n.props.style && n.props.style.borderRadius === '50%');
    assert.strictEqual(dots.length, 7); // 2+2+1+2 teams across the four people
    const titles = findAll(tree, n => n.props && typeof n.props.title === 'string').map(n => n.props.title);
    assert.ok(titles.some(t => t.includes('no transactions on record')), 'null daysSinceTxn wording');
    assert.ok(titles.some(t => t.includes('41d since last move') && t.includes('1 OUT in lineup')));
    assert.ok(titles.some(t => t.includes('offseason thresholds')), 'inSeason:false surfaced');
  });
  test('open seat shows league, reason, bench candidate with fit score + reason chips', () => {
    assert.ok(text.includes('Owner left'));
    assert.ok(text.includes('fit ') && text.includes('active on radar') && text.includes('runs 2 leagues deep'));
    assert.ok(!text.includes('Every seat is filled.'));
  });
  test('prospectus pitch renders with its own copy button', () => {
    assert.ok(text.includes('Empire is a 12-team dynasty seat'));
    const btns = findAll(tree, n => n.type === 'button');
    assert.ok(btns.some(b => btnLabel(b) === 'Copy pitch'));
  });
  test('day one folder renders every section title and body', () => {
    assert.ok(text.includes('Welcome to Empire.'));
    assert.ok(text.includes('House Rules'));
    assert.ok(!text.includes('Generates once a seat has a shortlist to draft one for.'));
  });
  // Sleeper never reports "this recruit accepted" — the folder is written for
  // the top shortlist candidate. It must never read as a settled hire.
  test('day one folder is labelled a draft and names who it was written for', () => {
    assert.ok(text.includes('Draft'), 'folder must be marked a draft');
    assert.ok(text.includes('Sam Rivera'), 'names the candidate it was written for');
    assert.ok(text.includes('Day One Folder') && text.includes('\u2014 Empire'), 'labels which league the folder is for');
  });
  test('a folder with no recruitName still says who it is for, without inventing a name', () => {
    const t = textOf(render(Panel({ folders: [{ leagueName: 'Empire', sections: [{ title: 'Welcome', body: 'Hi.' }] }] }))).join('|');
    assert.ok(t.includes('the top shortlist candidate'));
  });
  test('copy buttons pass their message to onCopy when navigator.clipboard is absent', () => {
    const btns = findAll(tree, n => n.type === 'button');
    const plainCopies = btns.filter(b => btnLabel(b) === 'Copy');
    assert.strictEqual(plainCopies.length, 2, 'one per dark check-in');
    plainCopies[0].props.onClick();
    assert.strictEqual(copied[copied.length - 1], fx.radar.people[0].checkin);
  });
  test('folder Copy all concatenates titles + bodies', () => {
    // Independent panel: the earlier check-in write is deliberately still
    // pending until the microtask turn, so a second tap there is refused.
    const folderTree = render(Panel({ ...fx, onCopy: t => copied.push(t) }));
    const btns = findAll(folderTree, n => n.type === 'button');
    const all = btns.find(b => btnLabel(b) === 'Copy all');
    assert.ok(all, 'Copy all button exists');
    all.props.onClick();
    assert.strictEqual(copied[copied.length - 1], 'WELCOME\nWelcome to Empire.\n\nHOUSE RULES\nNo constitution on file for this league yet.');
  });
})();

// ── Clipboard-present path ──────────────────────────────────────────
(function clipboard() {
  const written = [];
  const copied = [];
  const ctx = makeCtx({ navigator: { clipboard: { writeText: t => { written.push(t); return { catch: () => {} }; } } } });
  const Panel = loadPanel(ctx);
  const fx = fixtures();
  const tree = render(Panel(Object.assign({}, fx, { onCopy: t => copied.push(t) })));
  test('host onCopy is preferred over navigator.clipboard.writeText', () => {
    const btn = findAll(tree, n => n.type === 'button').find(b => btnLabel(b) === 'Copy pitch');
    btn.props.onClick();
    assert.strictEqual(copied[0], fx.prospectuses[0].pitch);
    assert.strictEqual(written.length, 0);
  });
})();

// ── Empty / missing-input states ────────────────────────────────────
(function empties() {
  const ctx = makeCtx();
  const Panel = loadPanel(ctx);

  test('no radar, no seats prop, no folders → honest empties, no crash', () => {
    const text = textOf(render(Panel({ onCopy: () => {} }))).join('|');
    assert.ok(text.includes("The radar hasn't swept yet"));
    assert.ok(text.includes("The seat scan hasn't run yet"), 'missing seats must NOT claim all seats filled');
    assert.ok(!text.includes('Every seat is filled.'));
    assert.ok(text.includes('Generates once a seat has a shortlist to draft one for.'));
  });
  test('seats: [] → the green all-clear line', () => {
    const text = textOf(render(Panel({ radar: { people: [] }, seats: [], benches: [], prospectuses: [], folders: [] }))).join('|');
    assert.ok(text.includes('Every seat is filled.'));
  });
  test('seat with no bench/prospectus computed → honest blanks, no crash', () => {
    const text = textOf(render(Panel({ seats: [{ leagueId: 'L9', leagueName: 'Ghost League', rosterId: 2, reason: 'unowned' }] }))).join('|');
    assert.ok(text.includes('Ghost League') && text.includes('Unowned'));
    assert.ok(text.includes('No recruits scored for this seat yet.'));
  });
  test('folder with empty sections → honest regenerate line', () => {
    const text = textOf(render(Panel({ folders: [{ sections: [] }] }))).join('|');
    assert.ok(text.includes('This folder came back empty'));
  });
})();

(function unavailableActivity() {
  const Panel = loadPanel(makeCtx());
  const person = {
    userId: 'unverified', name: 'Recent manager', status: 'UNKNOWN',
    checkin: 'Do not send an inactivity check-in for missing data.',
    teams: [{ leagueId: 'L1', leagueName: 'Dynasty One', rosterId: 1, inSeason: true,
      status: 'UNKNOWN', signals: { activityKnown: false, daysSinceTxn: null } }],
  };
  test('unavailable activity has neutral wording without claiming an empty history', () => {
    const tree = render(Panel({ radar: { people: [person] }, seats: [] }));
    const text = textOf(tree).join('|');
    const titles = findAll(tree, n => typeof n.props?.title === 'string').map(n => n.props.title).join('|');
    assert.ok(text.includes('Activity unavailable'));
    assert.ok(titles.includes('Recent activity could not be verified'));
    assert.ok(!titles.includes('no transactions on record'));
    assert.ok(!text.includes(person.checkin));
  });
  test('phone attention view retains unavailable people with an honest detail explanation', () => {
    const tree = render(Panel({ phone: true, radar: { people: [person] }, seats: [] }));
    const text = textOf(tree).join('|');
    assert.ok(text.includes('Recent manager') && text.includes('Activity unavailable'));
    assert.ok(text.includes('Recent activity could not be verified'));
    assert.ok(!text.includes('Nobody needs attention right now.'));
    assert.ok(!text.includes('no transactions on record'));
  });
})();

// ── Async copy outcomes (actual panel handlers + stateful rerenders) ──
function statefulCopy(props = {}, extra = {}) {
  const slots = [];
  const timers = new Map();
  const cleanups = [];
  let cursor = 0, timerId = 0, raw, writes = 0;
  const ctx = makeCtx({ ...extra, setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } });
  ctx.React.useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], next => { writes++; slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  };
  ctx.React.useRef = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  };
  ctx.React.useEffect = effect => {
    const index = cursor++;
    if (!(index in slots)) { slots[index] = true; cleanups.push(effect()); }
  };
  const Panel = loadPanel(ctx);
  const currentProps = { ...fixtures(), ...props };
  const ui = {
    render() { cursor = 0; raw = Panel(currentProps); return render(raw); },
    button(key = 'checkin:u9') {
      const found = findAll(ui.render(), node => node.type === 'button' && node.props['data-copy-key'] === key);
      assert.strictEqual(found.length, 1, 'one copy control for ' + key);
      return found[0];
    },
    identity(key = 'checkin:u9') {
      return findAll(raw, node => node.props?.copyKey === key)[0]?.type;
    },
    expire() { for (const fn of timers.values()) fn(); timers.clear(); },
    unmount() { cleanups.forEach(fn => fn?.()); },
    timerCount: () => timers.size,
    stateWrites: () => writes,
  };
  return ui;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const asyncCases = [];
const asyncTest = (name, run) => asyncCases.push({ name, run });

asyncTest('host copy stays pending, blocks duplicate taps and flashes only after true', async () => {
  const pending = deferred();
  const messages = [], native = [];
  const ui = statefulCopy({ onCopy: text => { messages.push(text); return pending.promise; } }, {
    navigator: { clipboard: { writeText: async text => native.push(text) } },
  });
  const button = ui.button();
  const identity = ui.identity();
  const result = button.props.onClick();
  assert.strictEqual(btnLabel(ui.button()), 'Copying…');
  assert.strictEqual(ui.button().props['aria-busy'], true);
  assert.strictEqual(ui.button().props['aria-disabled'], true);
  assert.strictEqual(ui.identity(), identity, 'copy state does not replace the focused component');
  assert.strictEqual(ui.button('pitch:L2:7').props.onClick(), false);
  assert.strictEqual(await button.props.onClick(), false, 'stale pre-render handler also refuses duplicate taps');
  assert.strictEqual(ui.timerCount(), 0, 'success timer cannot begin before confirmation');
  assert.deepStrictEqual(messages, [fixtures().radar.people[0].checkin]);
  assert.strictEqual(native.length, 0, 'host owns clipboard and fallback');
  pending.resolve(true);
  assert.strictEqual(await result, true);
  assert.strictEqual(btnLabel(ui.button()), 'Copied');
  assert.strictEqual(ui.button().props['aria-busy'], false);
  assert.strictEqual(ui.button().props['aria-disabled'], false);
  assert.strictEqual(ui.identity(), identity);
  assert.strictEqual(btnLabel(ui.button('pitch:L2:7')), 'Copy pitch', 'success belongs only to the copied message');
  ui.expire();
  assert.strictEqual(btnLabel(ui.button()), 'Copy');
});

for (const [label, host] of [
  ['false from the host/manual fallback', async () => false],
  ['undefined from a legacy void host', () => undefined],
  ['a rejected host write', async () => { throw new Error('Clipboard denied'); }],
]) asyncTest(label + ' never claims Copied or retries outside the host flow', async () => {
  let nativeCalls = 0;
  const ui = statefulCopy({ onCopy: host }, { navigator: { clipboard: { writeText: async () => { nativeCalls++; } } } });
  assert.strictEqual(await ui.button().props.onClick(), false);
  const button = ui.button();
  assert.strictEqual(btnLabel(button), 'Copy');
  assert.strictEqual(ui.timerCount(), 0);
  assert.strictEqual(nativeCalls, 0);
  const alerts = findAll(ui.render(), node => node.props?.role === 'alert');
  assert.strictEqual(alerts.length, 1);
  assert.ok(textOf(alerts[0]).join('').includes('Copy was not confirmed'));
  assert.strictEqual(button.props['aria-describedby'], alerts[0].props.id);
  assert.ok(textOf(ui.render()).join('').includes(fixtures().radar.people[0].checkin), 'original message remains available');
});

asyncTest('without a host, native write fulfillment confirms success only after settlement', async () => {
  const pending = deferred();
  const messages = [];
  const ui = statefulCopy({}, { navigator: { clipboard: { writeText: text => { messages.push(text); return pending.promise; } } } });
  const result = ui.button('folder:0').props.onClick();
  assert.strictEqual(btnLabel(ui.button('folder:0')), 'Copying…');
  assert.strictEqual(ui.timerCount(), 0);
  pending.resolve(); // Standard Clipboard API resolves void on confirmed success.
  assert.strictEqual(await result, true);
  assert.strictEqual(btnLabel(ui.button('folder:0')), 'Copied');
  assert.deepStrictEqual(messages, ['WELCOME\nWelcome to Empire.\n\nHOUSE RULES\nNo constitution on file for this league yet.']);
});

asyncTest('missing or rejected native clipboard shows local recovery and never Copied', async () => {
  for (const navigator of [undefined, {}, { clipboard: { writeText: async () => { throw new Error('Not allowed'); } } }]) {
    const ui = statefulCopy({}, navigator ? { navigator } : {});
    assert.strictEqual(await ui.button().props.onClick(), false);
    assert.strictEqual(btnLabel(ui.button()), 'Copy');
    assert.strictEqual(ui.timerCount(), 0);
    const alerts = findAll(ui.render(), node => node.props?.role === 'alert');
    assert.strictEqual(alerts.length, 1);
    assert.ok(textOf(alerts[0]).join('').includes('Select the message text to copy manually'));
  }
});

asyncTest('retry clears old failure and shows success only for the confirmed attempt', async () => {
  let calls = 0;
  const ui = statefulCopy({ onCopy: async () => ++calls > 1 });
  assert.strictEqual(await ui.button('pitch:L2:7').props.onClick(), false);
  assert.strictEqual(findAll(ui.render(), node => node.props?.role === 'alert').length, 1);
  const result = ui.button('pitch:L2:7').props.onClick();
  assert.strictEqual(findAll(ui.render(), node => node.props?.role === 'alert').length, 0);
  assert.strictEqual(btnLabel(ui.button('pitch:L2:7')), 'Copying…');
  assert.strictEqual(await result, true);
  assert.strictEqual(btnLabel(ui.button('pitch:L2:7')), 'Copied');
});

asyncTest('unmount abandons an outstanding result without state writes or timer', async () => {
  const pending = deferred();
  const ui = statefulCopy({ onCopy: () => pending.promise });
  const result = ui.button().props.onClick();
  ui.unmount();
  const writes = ui.stateWrites();
  pending.resolve(true);
  assert.strictEqual(await result, false);
  assert.strictEqual(ui.stateWrites(), writes);
  assert.strictEqual(ui.timerCount(), 0);
});

asyncTest('phone and desktop copy controls retain native keyboard semantics and 44px targets', async () => {
  for (const phone of [false, true]) {
    const ui = statefulCopy({ phone, onCopy: async () => true });
    const buttons = findAll(ui.render(), node => node.props?.['data-testid'] === 'people-copy-button');
    assert.ok(buttons.length >= 2);
    buttons.forEach(button => {
      assert.strictEqual(button.type, 'button');
      assert.strictEqual(button.props.type, 'button');
      assert.strictEqual(button.props.style.minWidth, '44px');
      assert.strictEqual(button.props.style.minHeight, '44px');
      assert.notStrictEqual(button.props.disabled, true, 'pending status can preserve focus without remounting or disabling the native element');
    });
  }
});

(async () => {
  for (const { name, run } of asyncCases) {
    try { await run(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
  }
  console.log('\n' + (failed ? 'FAIL' : 'PASS') + ': ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.error('  ' + f.name + ': ' + (f.e && f.e.stack || f.e)));
    process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
