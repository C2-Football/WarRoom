#!/usr/bin/env node
'use strict';

// Execute the actual JSX handlers and modal lifecycle. The browser acceptance
// suite separately exercises the native dialog's keyboard focus containment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const source = Babel.transform(fs.readFileSync('js/components/commish-sidebar.js', 'utf8'), { presets: ['react'] }).code;
const item = { id: 'task-fixture', headline: 'Confirm draft date', detail: 'Draft time is missing.', tier: 'NOW', score: 80, kind: 'DRAFT', leagueNames: ['Fixture League'], action: { label: 'Open calendar' } };

function harness() {
    const slots = [], effects = [], cleanup = [], events = {};
    let cursor = 0, focused = null, guard;
    const makeButton = (name, taskId) => ({
        tagName: 'BUTTON', tabIndex: 0, isConnected: true, disabled: false,
        focus() { focused = name; },
        closest(selector) { return selector === '[data-task-id]' && taskId != null ? { getAttribute() { return taskId; } } : null; },
    });
    const opener = makeButton('opener');
    const nextTask = makeButton('next-task', 'next-task');
    const reviews = [nextTask], fallbacks = [makeButton('menu')];
    const doc = {
        activeElement: opener,
        body: { tagName: 'BODY', tabIndex: -1, isConnected: true, style: { overflow: 'scroll' }, focus() { focused = 'body'; } },
        documentElement: { tagName: 'HTML', tabIndex: -1, isConnected: true, focus() { focused = 'html'; } },
        querySelectorAll(selector) { return selector.includes('commish-task-review') ? reviews : fallbacks; },
    };
    const React = {
        Fragment: 'fragment',
        createElement(type, props, ...children) {
            props = { ...props, children };
            if (typeof type === 'function') return type(props);
            if (props.ref && !props.ref.current) {
                props.ref.current = type === 'dialog' ? {
                    open: false, shows: 0, closes: 0,
                    showModal() { this.open = true; this.shows++; },
                    close() { this.open = false; this.closes++; },
                } : { focus() { focused = 'close-button'; } };
            }
            return { type, props };
        },
        useState(init) {
            const i = cursor++;
            if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
            return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
        },
        useRef(init) {
            const i = cursor++;
            if (!(i in slots)) slots[i] = { current: init };
            return slots[i];
        },
        useEffect(fn, deps) {
            const i = cursor++;
            if (!(i in slots) || deps.some((d, n) => d !== slots[i][n])) {
                slots[i] = deps;
                effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); });
            }
        },
    };
    const context = vm.createContext({ document: doc, window: { App: { NavigationGuard: { register(fn) { guard = fn; return () => {}; } } },
        addEventListener(name, fn) { events[name] = fn; }, removeEventListener(name, fn) { if (events[name] === fn) delete events[name]; } }, React });
    vm.runInContext(source, context);
    const render = (name, props) => {
        cursor = 0;
        const tree = context.window[name](props);
        while (effects.length) effects.shift()();
        return tree;
    };
    return { render, doc, opener, reviews, fallbacks, makeButton, events, focused: () => focused, guard: () => guard(), unmount() { cleanup.forEach(fn => fn?.()); } };
}
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
const button = (tree, name) => {
    const found = nodes(tree).find(n => n.type === 'button' && (n.props['aria-label'] === name || text(n) === name));
    assert(found, 'button: ' + name);
    return found;
};

{
    const h = harness(); let closes = 0;
    const props = { item, onClose() { closes++; }, onSaveFollowup() { return true; } };
    let tree = h.render('WrCommishActionPanel', props);
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(tree.type, 'dialog');
    assert.equal(tree.props['aria-modal'], 'true');
    assert.equal(tree.props.ref.current.shows, 1, 'showModal called once across rerenders');
    assert.equal(h.focused(), 'close-button');
    assert.equal(h.doc.body.style.overflow, 'hidden');
    let prevented = 0;
    tree.props.onCancel({ preventDefault() { prevented++; } });
    assert.equal(prevented, 1, 'Escape default close is controlled');
    assert.equal(closes, 1);
    nodes(tree).find(n => n.props?.['aria-label'] === 'Private note').props.onChange({ target: { value: 'Keep my note' } });
    tree = h.render('WrCommishActionPanel', props);
    tree.props.onCancel({ preventDefault() { prevented++; } });
    tree.props.onClick({ target: tree, currentTarget: tree });
    button(tree, 'Close').props.onClick();
    assert.equal(closes, 1, 'Escape, backdrop and close all respect unsaved edits');
    assert.equal(h.guard(), false);
    tree = h.render('WrCommishActionPanel', props);
    assert(text(tree).includes('Your edits are not saved'));
    button(tree, 'Discard unsaved edits').props.onClick();
    tree = h.render('WrCommishActionPanel', props);
    tree.props.onCancel({ preventDefault() {} });
    assert.equal(closes, 2);
    h.unmount();
    assert.equal(tree.props.ref.current.open, false);
    assert.equal(h.doc.body.style.overflow, 'scroll');
    assert.equal(h.focused(), 'opener');
    console.log('PASS native modal lifecycle, entry/restore focus, scroll restoration and guarded Escape/backdrop/close');
}

{
    // Task IDs can contain selector punctuation. Matching must use row
    // attributes, and must find the opening task rather than the first Review.
    const scopedItem = { ...item, id: 'task-"[league:two]' };
    for (const initialFocus of ['body', 'html', 'nonfocusable']) {
        const h = harness();
        const matching = h.makeButton('matching-task', scopedItem.id);
        h.reviews.push(matching);
        h.doc.activeElement = initialFocus === 'body' ? h.doc.body : initialFocus === 'html' ? h.doc.documentElement
            : { tagName: 'DIV', tabIndex: -1, isConnected: true, focus() { throw new Error('Nonfocusable opener must not be restored'); } };
        let closed = false;
        const tree = h.render('WrCommishActionPanel', { item: scopedItem, onClose() { closed = true; } });
        tree.props.onCancel({ preventDefault() {} });
        assert.equal(closed, true, 'clean Escape closes after a touch opener');
        h.unmount();
        assert.equal(h.focused(), 'matching-task', initialFocus + ' restores the same task Review, even when another task comes first');
    }
    const h = harness();
    h.doc.activeElement = h.doc.body;
    const removedReview = h.makeButton('removed-task', scopedItem.id);
    h.reviews.push(removedReview);
    h.render('WrCommishActionPanel', { item: scopedItem });
    removedReview.isConnected = false;
    h.unmount();
    assert.equal(h.focused(), 'next-task', 'Ignore removing the captured Review falls back to another connected task');
    const empty = harness();
    empty.doc.activeElement = empty.doc.body;
    const lastReview = empty.makeButton('last-task', scopedItem.id);
    empty.reviews.splice(0, 1, lastReview);
    empty.render('WrCommishActionPanel', { item: scopedItem });
    lastReview.isConnected = false;
    empty.unmount();
    assert.equal(empty.focused(), 'menu', 'removing the last task returns to the office menu');
    console.log('PASS touch body/HTML/nonfocusable opener restores matching Review; removed task falls back to task/menu');
}

{
    const h = harness(); let ignored = 0, saved = 0, prefOK = false, followupOK = false;
    const props = { item, onIgnore() { ignored++; return prefOK; }, onSaveFollowup(patch) { if (!followupOK) return false; saved++; assert.equal(patch.note, 'Private draft'); return true; } };
    let tree = h.render('WrCommishActionPanel', props);
    tree = h.render('WrCommishActionPanel', props);
    nodes(tree).find(n => n.props?.['aria-label'] === 'Private note').props.onChange({ target: { value: 'Private draft' } });
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(button(tree, 'Ignore task').props.onClick(), false);
    assert.equal(ignored, 0, 'failed follow-up save blocks preference change');
    assert.equal(h.guard(), false);
    followupOK = true;
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(button(tree, 'Ignore task').props.onClick(), false);
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(ignored, 1);
    assert.equal(tree.props.ref.current.open, true, 'failed preference cannot close native modal');
    assert.equal(nodes(tree).find(n => n.props?.['aria-label'] === 'Private note').props.value, 'Private draft');
    assert(text(tree).includes('not fully saved'));
    prefOK = true;
    assert.equal(button(tree, 'Ignore task').props.onClick(), true);
    assert.equal(ignored, 2);
    assert.equal(saved, 2);
    button(tree, 'Snooze 7 days');
    button(tree, '✓ Mark done');
    assert(!nodes(tree).some(n => n.type === 'button' && ['Hide', 'Skip 7d'].includes(text(n))));
    for (const n of nodes(tree).filter(n => n.type === 'button' || n.type === 'input')) assert(parseInt(n.props.style.minHeight, 10) >= 44, text(n) || n.props['aria-label']);
    h.opener.isConnected = false;
    h.unmount();
    assert.equal(h.focused(), 'next-task', 'removed task has a reachable office fallback');
    console.log('PASS ignore waits for confirmed saves, retains note/drawer on failure, and has distinct44px controls');
}

{
    const h = harness(), order = [], savedNotes = [];
    let followupOK = true, closes = 0;
    const props = { item, followup: { note: 'Original note' }, onIgnore() { order.push('ignore'); return false; },
        onSaveFollowup(patch) {
            order.push('save:' + patch.note);
            if (!followupOK) return false;
            savedNotes.push(patch.note); return true;
        } };
    let tree = h.render('WrCommishActionPanel', props);
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(button(tree, 'Ignore task').props.onClick(), false);
    props.saveFailure = { key: 'item-state:task-fixture', area: 'settings', retryLabel: 'Retry save', message: 'Preference not saved.', retry() { order.push('retry-preference'); closes++; return true; } };
    tree = h.render('WrCommishActionPanel', props);
    nodes(tree).find(n => n.props?.['aria-label'] === 'Private note').props.onChange({ target: { value: 'Newest note after failed Ignore' } });
    tree = h.render('WrCommishActionPanel', props);
    followupOK = false;
    assert.equal(button(tree, 'Retry save').props.onClick(), false);
    assert.equal(closes, 0, 'failed latest-note save must block a retry that closes the parent');
    assert(!order.includes('retry-preference'));
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(nodes(tree).find(n => n.props?.['aria-label'] === 'Private note').props.value, 'Newest note after failed Ignore');
    assert.equal(h.guard(), false);
    followupOK = true;
    assert.equal(button(tree, 'Retry save').props.onClick(), true);
    assert.equal(savedNotes.at(-1), 'Newest note after failed Ignore');
    assert.deepEqual(order.slice(-2), ['save:Newest note after failed Ignore', 'retry-preference']);
    assert.equal(closes, 1);
    h.unmount();
    console.log('PASS preference retry saves newest draft before parent close and stops when that save fails');
}

{
    const h = harness(); let retried = 0;
    const props = { item, onIgnore: () => false, onSaveFollowup: () => true };
    let tree = h.render('WrCommishActionPanel', props);
    tree = h.render('WrCommishActionPanel', props);
    button(tree, 'Ignore task').props.onClick();
    tree = h.render('WrCommishActionPanel', props);
    assert(text(tree).includes('not fully saved'));
    props.saveFailure = { key: 'activity:task-fixture:IGNORED', retryLabel: 'Retry activity save', message: 'Activity entry not saved.', retry() { retried++; return true; } };
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(button(tree, 'Retry activity save').props.onClick(), true);
    tree = h.render('WrCommishActionPanel', props);
    assert(!text(tree).includes('not fully saved'));
    nodes(tree).find(n => n.props?.['aria-label'] === 'Private note').props.onChange({ target: { value: 'New note after preference save' } });
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(button(tree, 'Retry activity save').props.onClick(), true);
    props.saveFailure = null;
    tree = h.render('WrCommishActionPanel', props);
    assert.equal(retried, 2);
    assert.equal(tree.props.ref.current.open, true, 'activity-only retry never closes the drawer');
    assert.equal(nodes(tree).find(n => n.props?.['aria-label'] === 'Private note').props.value, 'New note after preference save');
    assert.equal(h.guard(), false, 'activity retry cannot clear a newer follow-up draft');
    h.unmount();
    console.log('PASS confirmed activity retry clears stale error without closing or discarding newer edits');
}

{
    const h = harness(); const restored = [];
    const missing = { id: 'previous-task', headline: 'Previous season reminder' };
    const tree = h.render('WrCommishSettingsPanel', {
        leagues: [], isManaged: () => true, alerts: { domains: {}, floor: 'BACKLOG' }, domainLabels: [],
        ignored: [{ item, state: 'ignored' }, { item: missing, state: 'hidden', missing: true }],
        suppressed: [{ item: { id: 'done', headline: 'Already checked' }, state: 'done' }, { item, state: 'ignored' }],
        onRestore(id) { restored.push(id); return true; },
    });
    const region = nodes(tree).find(n => n.props?.['data-testid'] === 'commish-ignored-tasks');
    assert(region);
    assert(text(region).includes(item.headline));
    assert(text(region).includes(missing.headline));
    assert(text(region).includes('Not present in the latest league data'));
    assert(text(region).includes('across your signed-in devices'));
    assert(text(region).includes('Only in this browser'), 'legacy choices retain their actual scope');
    assert(!text(region).includes('Already checked'));
    const restores = nodes(region).filter(n => n.type === 'button');
    restores.forEach(n => { assert.equal(n.props.style.minHeight, '44px'); n.props.onClick(); });
    assert.deepEqual(restored, [item.id, missing.id]);
    assert.equal(text(tree).split(item.headline).length - 1, 1, 'ignored is not duplicated in done/snoozed list');
    console.log('PASS ignored Settings rows include missing/legacy tasks with restore and truthful account/browser scope');
}

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
(async () => {
    {
        const h = harness(), gate = deferred(); let calls = 0, closes = 0, saves = 0;
        const props = { item, onClose() { closes++; }, onSaveFollowup() { saves++; return true; }, onIgnore() { calls++; return gate.promise; } };
        let tree = h.render('WrCommishActionPanel', props);
        tree = h.render('WrCommishActionPanel', props);
        const ignore = button(tree, 'Ignore task').props.onClick;
        const waiting = ignore();
        assert.equal(calls, 1); assert.equal(saves, 1); assert.equal(closes, 0);
        assert.equal(ignore(), false, 'duplicate activation before rerender cannot start a second save or POST');
        assert.equal(saves, 1); assert.equal(calls, 1);
        assert.equal(h.guard(), false, 'registered navigation guard reads current pending state');
        tree = h.render('WrCommishActionPanel', props);
        for (const control of nodes(tree).filter(node => ['input', 'textarea'].includes(node.type))) assert.equal(control.props.disabled, true, 'editing cannot race the committed note during a POST');
        assert.equal(button(tree, 'Ignore task').props.disabled, true);
        tree.props.onCancel({ preventDefault() {} }); button(tree, 'Close').props.onClick();
        tree.props.onClick({ target: tree, currentTarget: tree });
        assert.equal(closes, 0, 'Escape, close and backdrop cannot abandon a pending cloud choice');
        let prevented = 0;
        const unload = { preventDefault() { prevented++; } };
        h.events.beforeunload(unload);
        assert.equal(prevented, 1); assert.equal(unload.returnValue, '', 'native page leave warns even after follow-up was saved');
        gate.resolve(true); assert.equal(await waiting, true);
        tree = h.render('WrCommishActionPanel', props);
        assert.equal(h.guard(), true);
        assert.equal(button(tree, 'Ignore task').props.disabled, false);
        assert.equal(nodes(tree).find(node => node.props?.['aria-label'] === 'Private note').props.disabled, false);
        h.unmount();
        console.log('PASS cloud choice waits for server truth, blocks duplicate activation/editing and guards all pending exits');
    }
    {
        const h = harness(), order = [], gate = deferred(); let followupOK = true, retries = 0;
        const props = { item, followup: { note: 'Original saved note' }, onIgnore: async () => false,
            onSaveFollowup(patch) { order.push('save:' + patch.note); return followupOK; },
            onRetrySync() { retries++; order.push('retry-cloud'); return gate.promise; } };
        let tree = h.render('WrCommishActionPanel', props); tree = h.render('WrCommishActionPanel', props);
        assert.equal(await button(tree, 'Ignore task').props.onClick(), false);
        props.taskSync = { status: 'failed', message: 'Task choice was not confirmed.' };
        tree = h.render('WrCommishActionPanel', props);
        assert(text(tree).includes('Task choice was not confirmed.'));
        nodes(tree).find(node => node.props?.['aria-label'] === 'Private note').props.onChange({ target: { value: 'Newest note after sync failed' } });
        tree = h.render('WrCommishActionPanel', props);
        followupOK = false;
        assert.equal(button(tree, 'Retry task sync').props.onClick(), false);
        assert.equal(retries, 0, 'quota rejection saves neither a newer note nor starts a cloud retry');
        assert.equal(h.guard(), false);
        followupOK = true;
        const waiting = button(tree, 'Retry task sync').props.onClick();
        assert.deepEqual(order.slice(-2), ['save:Newest note after sync failed', 'retry-cloud']);
        gate.resolve(true); assert.equal(await waiting, true);
        props.taskSync = null; tree = h.render('WrCommishActionPanel', props);
        assert.equal(nodes(tree).find(node => node.props?.['aria-label'] === 'Private note').props.value, 'Newest note after sync failed');
        assert.equal(h.guard(), true, 'latest note is committed before a retry may close the parent');
        h.unmount();
        console.log('PASS failed cloud retry first commits the newest note and quota failure aborts before any POST');
    }
    {
        const h = harness(), gate = deferred();
        const props = { item, onIgnore: () => gate.promise, onSaveFollowup: () => true };
        let tree = h.render('WrCommishActionPanel', props); tree = h.render('WrCommishActionPanel', props);
        const waiting = button(tree, 'Ignore task').props.onClick();
        gate.reject(new Error('Unknown transport outcome')); assert.equal(await waiting, false);
        tree = h.render('WrCommishActionPanel', props);
        assert(text(tree).includes('could not be confirmed'));
        assert.equal(tree.props.ref.current.open, true); assert.equal(button(tree, 'Ignore task').props.disabled, false);
        h.unmount();
        console.log('PASS rejected cloud promise keeps drawer editable and reports an unconfirmed outcome');
    }
    {
        const h = harness(), synced = [], restored = [];
        const ignored = [
            { item: { id: 'cloud', headline: 'Cloud choice' }, source: 'cloud', confirmed: true },
            { item: { id: 'cached', headline: 'Cached choice' }, source: 'cache', confirmed: false },
            { item: { id: 'local', headline: 'Legacy browser choice' }, source: 'local', confirmed: false, missing: true },
        ];
        const props = { leagues: [], isManaged: () => true, alerts: { domains: {}, floor: 'BACKLOG' }, domainLabels: [], ignored,
            onSyncChoice(value) { synced.push(value.id); }, onRestore(id) { restored.push(id); } };
        let tree = h.render('WrCommishSettingsPanel', props);
        const region = nodes(tree).find(node => node.props?.['data-testid'] === 'commish-ignored-tasks');
        assert(text(region).includes('Synced to your account'));
        assert(text(region).includes('Last known account choice · checking sync'));
        assert(text(region).includes('Only in this browser'));
        assert.deepEqual(synced, [], 'rendering legacy choices never uploads them');
        const syncButtons = nodes(region).filter(node => node.type === 'button' && text(node) === 'Sync choice');
        assert.equal(syncButtons.length, 1); assert.equal(syncButtons[0].props.style.minHeight, '44px'); syncButtons[0].props.onClick();
        assert.deepEqual(synced, ['local'], 'only explicit legacy-choice action requests a cloud save');
        const restores = nodes(region).filter(node => node.type === 'button' && text(node) === 'Restore');
        restores.forEach(control => control.props.onClick()); assert.deepEqual(restored, ['cloud', 'cached', 'local']);
        props.taskSync = { status: 'saving' }; tree = h.render('WrCommishSettingsPanel', props);
        const savingRegion = nodes(tree).find(node => node.props?.['data-testid'] === 'commish-ignored-tasks');
        for (const control of nodes(savingRegion).filter(node => node.type === 'button')) assert.equal(control.props.disabled, true);
        console.log('PASS Settings distinguishes cloud/cache/local choices and requires explicit legacy sync with guarded44px actions');
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
