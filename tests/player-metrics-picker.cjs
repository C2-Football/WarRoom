'use strict';
// Interaction/hook fixtures; shared WR.Sheet owns the real DOM focus trap and scroll lock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/shared/player-metrics.js', 'utf8');
const array = value => Array.from(value);
function realm() {
    const disk = new Map(), listeners = new Map(), documentListeners = new Map();
    let blocked = false, writes = 0;
    const add = (map, name, fn) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); };
    const remove = (map, name, fn) => map.get(name)?.delete(fn);
    const root = {
        localStorage: { getItem: key => disk.get(key) || null, setItem: (key, value) => { writes++; if (blocked) throw Error('Blocked'); disk.set(key, value); } },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
        addEventListener: (name, fn) => add(listeners, name, fn), removeEventListener: (name, fn) => remove(listeners, name, fn),
        dispatchEvent: event => [...(listeners.get(event.type) || [])].forEach(fn => fn(event)),
        document: { activeElement: null, addEventListener: (name, fn) => add(documentListeners, name, fn), removeEventListener: (name, fn) => remove(documentListeners, name, fn) },
    };
    vm.runInNewContext(source, { window: root });
    return { root, M: root.WR.PlayerMetrics, disk, setBlocked: value => { blocked = value; }, writes: () => writes,
        documentEvent: (type, event) => [...(documentListeners.get(type) || [])].forEach(fn => fn(event)) };
}
function nodes(tree, predicate) {
    const found = [];
    function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object' || !node.props) return; if (predicate(node)) found.push(node); walk(node.children); }
    walk(tree); return found;
}
function hookHarness(env, renderComponent, initialProps = {}) {
    const hooks = [], layouts = [], effects = [], handles = new Map();
    let cursor = 0, props = initialProps, tree;
    const React = {
        createElement(type, props, ...children) { return typeof type === 'function' ? type({ ...props, children }) : { type, props: props || {}, children }; },
        useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }]; },
        useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index]; },
        useEffect: (fn, deps) => schedule(effects, fn, deps), useLayoutEffect: (fn, deps) => schedule(layouts, fn, deps),
    };
    function schedule(queue, fn, deps) {
        const index = cursor++, previous = hooks[index];
        if (!previous || !deps || deps.some((value, i) => !Object.is(previous.deps[i], value))) {
            hooks[index] = { deps, cleanup: previous?.cleanup };
            queue.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = fn(); });
        }
    }
    function focusable(id) {
        if (!handles.has(id)) handles.set(id, { id, captured: null, focus() { env.root.document.activeElement = this; },
            setPointerCapture(pointerId) { this.captured = pointerId; }, hasPointerCapture(pointerId) { return this.captured === pointerId; }, releasePointerCapture() { this.captured = null; } });
        return handles.get(id);
    }
    function mountRefs() {
        const selected = nodes(tree, node => node.type === 'li' && node.props['data-metric-selected'] === 'true');
        const selectedNodes = selected.map((node, index) => ({ getBoundingClientRect: () => ({ top: index * 52 + 100, bottom: (index + 1) * 52 + 100, left: 12, right: 308, height: 52 }) }));
        nodes(tree, node => !!node.props.ref).forEach(node => {
            const ref = node.props.ref;
            let target;
            if (node.type === 'ul') target = { querySelectorAll: () => selectedNodes };
            else if (node.type === 'button') target = focusable(node.props['aria-label']?.split(', column ')[0] || 'trigger');
            else target = { contains: target => !!target?.inside };
            if (typeof ref === 'function') ref(target); else ref.current = target;
        });
    }
    return {
        render(nextProps = props) { props = nextProps; cursor = 0; env.root.React = React; tree = renderComponent(props); mountRefs(); while (layouts.length) layouts.shift()(); while (effects.length) effects.shift()(); return tree; },
        unmount() { hooks.forEach(hook => hook?.cleanup?.()); }, focusable,
    };
}
function pickerFixture(phone = true) {
    const env = realm();
    env.root.WR.useViewport = () => ({ isPhone: phone });
    env.root.WR.FilterSheet = props => props.open ? env.root.React.createElement('div', { className: 'fixture-sheet', onClose: props.onClose }, props.sections.map(section => section.node), props.footer) : null;
    const commits = [];
    let preference = { key: 'account-a:league-a', selected: array(env.M.defaults), persistent: true, setSelected(next) { commits.push(array(next)); preference.selected = array(next); } };
    const harness = hookHarness(env, props => env.M.Picker(props), { preference });
    let tree = harness.render();
    const render = () => (tree = harness.render({ preference }));
    const find = predicate => nodes(tree, predicate);
    const button = label => { const result = find(node => node.type === 'button' && node.props['aria-label'] === label)[0]; assert.ok(result, label); return result; };
    const trigger = () => find(node => node.props.className === 'mc-columns-button')[0];
    function open() { trigger().props.onClick(); return render(); }
    function grip(metric) { const title = env.M.definitions.find(def => def.key === metric).name; return find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Reorder ' + title + ','))[0]; }
    function pointer(node, type, y, extra = {}) {
        const name = node.props['aria-label']?.split(', column ')[0];
        node.props[type]({ pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: y, currentTarget: harness.focusable(name), preventDefault() {}, ...extra });
    }
    return { ...env, harness, render, find, button, trigger, open, grip, pointer, commits,
        preference: () => preference, switchScope(next) { preference = { ...preference, ...next }; return render(); } };
}
{
    const f = pickerFixture(); f.open();
    assert.equal(f.find(node => node.type === 'ul').length, 1, 'one list, without duplicate order and checkbox sections');
    assert.equal(f.find(node => node.type === 'li').length, 7);
    assert.deepEqual(f.find(node => node.type === 'li').map(node => node.props['data-metric-key']), ['proj','ppg','dhq','age','season','bye','matchup']);
    const checkbox = name => f.find(node => node.type === 'input' && node.props['aria-label'] === name)[0];
    assert.equal(checkbox('Bye week').props.disabled, true, 'four-column maximum explained and enforced');
    checkbox('Age').props.onChange(); f.render();
    assert.deepEqual(f.preference().selected, ['proj','ppg','dhq']);
    assert.equal(checkbox('Weekly projection').props.disabled, true, 'three-column minimum enforced');
    checkbox('Bye week').props.onChange(); f.render();
    assert.deepEqual(f.preference().selected, ['proj','ppg','dhq','bye']);
    const footer = f.find(node => node.props.className === 'mc-metric-footer')[0];
    nodes(footer, node => node.type === 'button')[0].props.onClick(); f.render();
    assert.deepEqual(f.preference().selected, ['proj','ppg','dhq','age']);
    nodes(footer, node => node.type === 'button')[1].props.onClick(); f.render();
    assert.equal(f.trigger().props['aria-expanded'], false);
    f.open(); assert.deepEqual(f.preference().selected, ['proj','ppg','dhq','age']);
    f.harness.unmount();
}
{
    const f = pickerFixture(); f.open();
    let handle = f.grip('proj');
    f.pointer(handle, 'onPointerDown', 126);
    f.pointer(handle, 'onPointerMove', 282); f.render();
    assert.equal(f.commits.length, 0, 'pointer hover never persists an intermediate order');
    assert.deepEqual(f.find(node => node.type === 'li' && node.props['data-metric-selected'] === 'true').map(node => node.props['data-metric-key']), ['proj','ppg','dhq','age'], 'DOM order stays stable throughout the captured gesture');
    handle = f.grip('proj');
    f.pointer(handle, 'onPointerUp', 282); f.render();
    assert.deepEqual(f.preference().selected, ['ppg','dhq','age','proj']);
    assert.equal(f.commits.length, 1, 'one commit for a touch/pointer reorder');
    assert.equal(f.root.document.activeElement.id, 'Reorder Weekly projection', 'focus returns to the moved keyed grip');
    assert.match(f.find(node => node.props['aria-live'] === 'polite')[0].children[0], /column 4 of 4/);
    for (const cancel of ['onPointerCancel','onLostPointerCapture']) {
        handle = f.grip('ppg'); f.pointer(handle, 'onPointerDown', 126); f.pointer(handle, 'onPointerMove', 230); f.render();
        f.pointer(f.grip('ppg'), cancel, 230); f.pointer(f.grip('ppg'), 'onPointerUp', 230); f.render();
        assert.equal(f.commits.length, 1, cancel + ' does not save');
    }
    handle = f.grip('ppg'); f.pointer(handle, 'onPointerDown', 126); f.pointer(handle, 'onPointerMove', 230); f.render();
    f.pointer(f.grip('ppg'), 'onPointerUp', 230, { clientX: 400 }); f.render();
    assert.equal(f.commits.length, 1, 'release outside the list cancels');
    handle = f.grip('ppg'); f.pointer(handle, 'onPointerDown', 126); f.pointer(handle, 'onPointerMove', 230, { pointerId: 88 });
    f.pointer(handle, 'onPointerUp', 230, { pointerId: 88 });
    assert.equal(f.commits.length, 1, 'a second pointer cannot reorder');
    f.pointer(handle, 'onPointerCancel', 230);
    for (const type of ['scroll','resize','blur']) {
        handle = f.grip('ppg'); f.pointer(handle, 'onPointerDown', 126); f.pointer(handle, 'onPointerMove', 230);
        f.root.dispatchEvent({ type });
        f.pointer(handle, 'onPointerUp', 230); f.render();
        assert.equal(f.commits.length, 1, type + ' cancels stale drag geometry');
    }
    handle = f.grip('ppg'); f.pointer(handle, 'onPointerDown', 126); f.pointer(handle, 'onPointerMove', 230);
    f.switchScope({ selected: ['age','dhq','proj','ppg'] });
    f.pointer(handle, 'onPointerUp', 230); f.render();
    assert.equal(f.commits.length, 1, 'a same-scope external order update cancels the old gesture');
    handle = f.grip('age'); f.pointer(handle, 'onPointerDown', 126); f.pointer(handle, 'onPointerMove', 230);
    f.harness.unmount(); f.pointer(handle, 'onPointerUp', 230);
    assert.equal(f.commits.length, 1, 'unmount releases capture without saving');
}
{
    const f = pickerFixture(); f.open();
    f.button('Move Weekly projection down').props.onClick(); f.render();
    assert.deepEqual(f.preference().selected, ['ppg','proj','dhq','age']);
    f.grip('proj').props.onKeyDown({ key: 'End', preventDefault() {} }); f.render();
    assert.deepEqual(f.preference().selected, ['ppg','dhq','age','proj']);
    f.grip('proj').props.onKeyDown({ key: 'ArrowUp', preventDefault() {} }); f.render();
    assert.deepEqual(f.preference().selected, ['ppg','dhq','proj','age']);
    f.grip('proj').props.onKeyDown({ key: 'Home', preventDefault() {} }); f.render();
    assert.deepEqual(f.preference().selected, ['proj','ppg','dhq','age']);
    const count = f.commits.length;
    const handle = f.grip('proj'); f.pointer(handle, 'onPointerDown', 126); f.pointer(handle, 'onPointerMove', 230);
    f.switchScope({ key: 'account-b:league-b', selected: ['bye','age','season'] });
    assert.equal(f.trigger().props['aria-expanded'], false, 'a new scope closes the old editor immediately');
    f.pointer(handle, 'onPointerUp', 230); f.render();
    assert.equal(f.commits.length, count, 'a stale account/league gesture never writes');
    assert.deepEqual(f.preference().selected, ['bye','age','season']);
    f.open();
    let nextHandle = f.grip('bye'); f.pointer(nextHandle, 'onPointerDown', 126); f.pointer(nextHandle, 'onPointerMove', 230);
    f.find(node => node.props.className === 'fixture-sheet')[0].props.onClose(); f.render();
    f.pointer(nextHandle, 'onPointerUp', 230); assert.equal(f.commits.length, count, 'shared sheet Escape/backdrop close cancels the gesture');
    f.harness.unmount();
}
{
    const f = pickerFixture(false); f.open();
    assert.equal(f.find(node => node.props.className === 'mc-metric-popover').length, 1, 'desktop retains a compact popover');
    f.documentEvent('keydown', { key: 'Escape' }); f.render();
    assert.equal(f.trigger().props['aria-expanded'], false);
    assert.equal(f.root.document.activeElement.id, 'trigger');
    f.open(); f.documentEvent('pointerdown', { target: { inside: false } }); f.render();
    assert.equal(f.trigger().props['aria-expanded'], false);
    f.harness.unmount();
}
{
    const env = realm(), M = env.M;
    const a = hookHarness(env, props => M.useMetrics(props.account, props.league), { account: 'a', league: 'l1' });
    const sibling = hookHarness(env, props => M.useMetrics(props.account, props.league), { account: 'a', league: 'l1' });
    let pref = a.render(), other = sibling.render();
    pref.setSelected(['age','bye','proj']);
    pref = a.render(); other = sibling.render();
    assert.deepEqual(array(other.selected), ['age','bye','proj'], 'same-scope lists synchronize');
    const staleSetter = pref.setSelected, writes = env.writes();
    pref = a.render({ account: 'b', league: 'l2' });
    staleSetter(['proj','season','age']);
    assert.equal(env.writes(), writes, 'a retained setter cannot write after the account/league changes');
    assert.deepEqual(array(a.render().selected), array(M.defaults));
    env.setBlocked(true); other.setSelected(['bye','age','dhq']);
    other = sibling.render(); assert.equal(other.persistent, false);
    const remount = hookHarness(env, props => M.useMetrics(props.account, props.league), { account: 'a', league: 'l1' });
    assert.equal(remount.render().persistent, false, 'blocked-storage notice survives remounts and synchronized pickers');
    const second = hookHarness(env, props => M.useMetrics(props.account, props.league), { account: 'a', league: 'l1' });
    second.render(); other.setSelected(['proj','dhq','bye']);
    assert.equal(second.render().persistent, false, 'event refresh retains storage status');
    env.setBlocked(false); env.disk.set(M.scope('a','l1'), JSON.stringify(['season','age','bye']));
    env.root.dispatchEvent({ type: 'storage', key: M.scope('a','l1') });
    assert.deepEqual(array(sibling.render().selected), ['season','age','bye']);
    assert.equal(sibling.render().persistent, true);
    assert.deepEqual(array(a.render().selected), array(M.defaults), 'unrelated storage events do not cross scopes');
    a.unmount(); sibling.unmount(); remount.unmount(); second.unmount();
}
console.log('PASS player metrics picker: single list, 3–4 limits, pointer/keyboard ordering, cancellation, scoped handlers, synchronization and storage fallback');
