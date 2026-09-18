'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const P = require('../js/shared/commish-prefs.js');
const F = require('../js/shared/commish-followups.js');
const records = new Map();
let rejected = null, throwWrite = false, writes = [], clipboardFails = false;
global.App.AccountStorage = {
    get: (key, fallback) => records.has(key) ? JSON.parse(records.get(key)) : fallback,
    set(key, value) {
        writes.push(key);
        if (rejected === '*' || rejected === key) { if (throwWrite) throw Error('quota'); return false; }
        records.set(key, JSON.stringify(value)); return true;
    },
};
const item = { id: 'followup-fixture', headline: 'Review draft date', tier: 'NOW', leagueIds: ['league'], leagueNames: ['Fixture'], action: { label: 'Calendar' }, hub: 'ops' };
const office = fs.readFileSync('js/tabs/commissioner-office.js', 'utf8');
const hook = office.slice(office.indexOf('function useCommishLocalSave()'), office.indexOf('function CommissionerOffice('));
const callbacks = office.slice(office.indexOf('    const bumpPrefs ='), office.indexOf('    const onExportAll ='));
let slots = [], cursor = 0, closeCount = 0, navigation;
const context = vm.createContext({ console, P, F, rawQueue: { items: [item] }, actionItem: item,
    window: { App: { NavigationGuard: { register: fn => { navigation = fn; return () => {}; } } }, addEventListener() {}, removeEventListener() {} },
    navigator: { clipboard: { async writeText() { if (clipboardFails) throw Error('denied'); } } },
    setPrefTick() {}, setFollowTick() {}, setActionItem(value) { if (value === null) closeCount++; }, openHub() {},
    React: {
        useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = init; return [slots[i], value => slots[i] = typeof value === 'function' ? value(slots[i]) : value]; },
        useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; },
        useEffect(fn, deps) { const i = cursor++; if (!(i in slots)) { slots[i] = true; if (!deps.length) fn(); } },
    },
});
vm.runInContext(hook + '\nfunction actions(localSave) {' + callbacks + '\nreturn {onToggleLeague,onToggleDomain,onSetFloor,onSaveFollowup,onRemoveFollowup,onItemDone,onItemRestore,onCopyFollowup};}', context);
const renderHook = () => { cursor = 0; return context.useCommishLocalSave(); };

(async () => {
try {
    for (const throwing of [false, true]) {
        rejected = '*'; throwWrite = throwing;
        assert.throws(() => F.save(item, { note: 'Do not lose' }, { recordSaved: true }), { code: 'LOCAL_SAVE_FAILED' });
        assert.equal(F.get(item.id), null);
        assert.throws(() => P.setManaged('league', false), { code: 'LOCAL_SAVE_FAILED' });
        assert.equal(P.isManaged('league'), true);
    }
    rejected = null; throwWrite = false; writes = [];
    F.save(item, { message: 'Typed message', note: 'Saved note', dueAt: '2026-10-01' }, { recordSaved: true, nowMs: 40 });
    assert.deepEqual(writes, ['commish_followups_v1'], 'draft and SAVED activity commit together');
    assert.equal(F.get(item.id).history[0].type, 'SAVED');
    let ui = renderHook(), actions = context.actions(ui);
    rejected = '*'; assert.equal(actions.onToggleLeague('league', false), false); ui = renderHook(); assert.equal(navigation(), false);
    rejected = null; assert.equal(actions.onToggleLeague('league', false), true); ui = renderHook(); assert.equal(ui.failure, null); assert.equal(P.isManaged('league'), false, 'false is a valid persisted preference value');
    rejected = 'commish_followups_v1';
    const before = JSON.stringify(F.get(item.id));
    assert.equal(actions.onSaveFollowup(item, { note: 'Typed unsaved note' }), false); assert.equal(JSON.stringify(F.get(item.id)), before);
    assert.equal(actions.onItemDone(item), false); ui = renderHook(); assert.equal(closeCount, 0); assert.equal(P.stateOf(item.id).state, 'done');
    assert.match(ui.failure.message, /queue state was saved locally/); assert.equal(JSON.stringify(F.get(item.id)), before);
    rejected = null; writes = []; ui.failure.retry();
    assert.deepEqual(writes, ['commish_followups_v1'], 'activity retry does not replay queue state or stale notes');
    assert.equal(F.get(item.id).note, 'Saved note');
    assert.equal(actions.onSaveFollowup(item, { note: 'Newest note' }), true); ui = renderHook(); assert.equal(ui.failure, null); assert.equal(navigation(), true);
    clipboardFails = true; const historyCount = F.get(item.id).history.length;
    assert.equal((await actions.onCopyFollowup(item, 'message')).copied, false); assert.equal(F.get(item.id).history.length, historyCount, 'failed clipboard write never records COPIED');
    clipboardFails = false; assert.equal((await actions.onCopyFollowup(item, 'message')).copied, true); assert.equal(F.get(item.id).history.at(-1).type, 'COPIED');
    rejected = 'commish_followups_v1'; assert.equal(actions.onItemRestore(item.id), false); ui = renderHook(); assert(ui.failure.retry);
    rejected = null; assert.equal(actions.onItemDone(item), true); ui = renderHook(); assert.equal(ui.failure, null, 'new successful state supersedes obsolete failed state history');
    console.log('PASS actual preference/follow-up callbacks report rejected writes, save notes/activity together, preserve partial-state truth, retry only activity, and verify clipboard success');

    // Render actual drawer with state/effect semantics; exercise its real JSX handlers.
    const panelSlots = [], effects = []; let panelCursor = 0, leave = 0, done = 0, copy = 0, panelReject = true, guard;
    let followup = { message: 'Original draft', note: 'Original private note', dueAt: '', updatedAt: 1 }, saveFailure = null;
    const p = vm.createContext({ console, window: { App: { NavigationGuard: { register: fn => { guard = fn; return () => {}; } } }, addEventListener() {}, removeEventListener() {} }, React: {
        Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(init) { const i = panelCursor++; if (!(i in panelSlots)) panelSlots[i] = init; return [panelSlots[i], value => panelSlots[i] = typeof value === 'function' ? value(panelSlots[i]) : value]; },
        useRef(init) { const i = panelCursor++; if (!(i in panelSlots)) panelSlots[i] = { current: init }; return panelSlots[i]; },
        useEffect(fn, deps) { const i = panelCursor++; if (!panelSlots[i] || deps.some((value, index) => value !== panelSlots[i][index])) { panelSlots[i] = deps; effects.push(fn); } },
    } });
    vm.runInContext(Babel.transform(fs.readFileSync('js/components/commish-sidebar.js', 'utf8'), { presets: ['react'] }).code, p);
    const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...Object.values(node.props || {}).flatMap(all)];
    const button = (tree, label) => { const found = all(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || node.props.children.join('') === label)); assert(found, label); return found; };
    const render = () => {
        panelCursor = 0;
        const tree = p.window.WrCommishActionPanel({ item, followup, saveFailure, onDismissFailure: () => { saveFailure = null; }, onClose: () => { if (!saveFailure) leave++; }, onDone: () => done++, onSaveFollowup: patch => { if (panelReject) return false; followup = { ...followup, ...patch, updatedAt: followup.updatedAt + 1 }; return true; }, onCopyMessage: async () => { copy++; return { copied: false, error: 'Clipboard denied' }; } });
        while (effects.length) effects.shift()(); return tree;
    };
    render(); let tree = render();
    all(tree).find(node => node.type === 'input' && node.props.placeholder === 'Private note').props.onChange({ target: { value: 'Newer private note' } }); tree = render();
    button(tree, 'Save follow-up').props.onClick(); tree = render();
    assert.equal(all(tree).find(node => node.type === 'input' && node.props.placeholder === 'Private note').props.value, 'Newer private note');
    assert.equal(guard(), false); button(tree, 'Close').props.onClick(); button(tree, '✓ Mark done').props.onClick(); assert.equal(leave, 0); assert.equal(done, 0);
    assert.equal(followup.note, 'Original private note');
    followup = { ...followup, updatedAt: 2, history: [{ type: 'OPENED' }] }; tree = render();
    assert.equal(all(tree).find(node => node.type === 'input' && node.props.placeholder === 'Private note').props.value, 'Newer private note', 'activity updates cannot overwrite typed edits');
    panelReject = false; button(tree, 'Save follow-up').props.onClick(); tree = render(); assert.equal(guard(), true); assert.equal(followup.note, 'Newer private note');
    assert(all(tree).some(node => node.props?.role === 'status' && node.props.children.join('').includes('Saved locally')));
    await button(tree, 'Copy message').props.onClick(); tree = render(); assert.equal(copy, 1); assert(all(tree).some(node => node.props?.role === 'alert' && node.props.children.join('').includes('Clipboard denied')));
    all(tree).find(node => node.type === 'input' && node.props.placeholder === 'Private note').props.onChange({ target: { value: 'Discard only this edit' } }); tree = render();
    button(tree, 'Discard unsaved edits').props.onClick(); tree = render(); assert.equal(followup.note, 'Newer private note'); assert.equal(guard(), true);
    button(tree, 'Close').props.onClick(); assert.equal(leave, 1);
    panelSlots.length = 0; followup = null; tree = render();
    // An empty editor can bail out of its hydration state setters; the first
    // edit must not mutate the saved snapshot through an aliased ref object.
    all(tree).find(node => node.type === 'input' && node.props.placeholder === 'Private note').props.onChange({ target: { value: 'First unsaved note' } });
    button(tree, 'Close').props.onClick(); assert.equal(leave, 1); assert.equal(guard(), false);
    // Opening a clean drawer can fail to record OPENED; a permanent quota
    // failure must not trap the user behind a backdrop with no discard action.
    panelSlots.length = 0; followup = null; saveFailure = { key: 'activity:' + item.id + ':OPENED', message: 'Opening activity was not saved.', retry() {} };
    tree = render(); button(tree, 'Close').props.onClick(); assert.equal(leave, 1);
    button(tree, 'Leave activity unrecorded').props.onClick(); tree = render(); button(tree, 'Close').props.onClick(); assert.equal(leave, 2);
    saveFailure = { key: 'activity:' + item.id + ':OPENED', message: 'Opening activity was not saved.' }; tree = render();
    all(tree).find(node => node.type === 'input' && node.props.placeholder === 'Private note').props.onChange({ target: { value: 'Keep edits while dismissing activity' } }); tree = render();
    button(tree, 'Leave activity unrecorded').props.onClick(); tree = render();
    assert.equal(all(tree).find(node => node.type === 'input' && node.props.placeholder === 'Private note').props.value, 'Keep edits while dismissing activity');
    button(tree, 'Close').props.onClick(); assert.equal(leave, 2, 'dismissing activity never discards typed edits or bypasses their guard');
    console.log('PASS actual follow-up drawer retains failed inputs, prevents close/navigation/actions, preserves edits across activity refresh, retries, discards only edits, and reports clipboard failure');
} finally { delete global.App.AccountStorage; }
})().catch(error => { console.error(error); process.exitCode = 1; });
