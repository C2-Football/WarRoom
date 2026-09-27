'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const listeners = new Map();
let timer, cleanup, state = [], cursor = 0;
const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useEffect(fn) { if (!cleanup) cleanup = fn(); },
};
const window = { navigator: { onLine: true }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), setInterval: fn => { timer = fn; return 1; }, clearInterval: () => { timer = null; } };
vm.runInNewContext(fs.readFileSync('js/components/game-room-status.js', 'utf8'), { window, React, Date });
const model = window.App.GameRoomStatusModel.statusOf;
assert.equal(model({ lastSyncedAt: 100, now: 101 }).state, 'synced');
assert.equal(model({ lastSyncedAt: 100, now: 15101 }).state, 'reconnecting');
assert.equal(model({ lastSyncedAt: 100, now: 101, error: true }).state, 'reconnecting');
assert.equal(model({ saving: true, error: true }).state, 'saving');
assert.equal(model({ offline: true, saving: true }).state, 'offline');
assert.equal(model({ authRequired: true, offline: true }).state, 'auth');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)];
let retries = 0;
const props = { lastSyncedAt: Date.now(), joined: 2, total: 3, ready: 1, onRetry: () => retries++ };
const render = () => { cursor = 0; return window.App.GameRoomStatus(props); };
let tree = render(); assert.equal(tree.props['data-state'], 'synced');
assert.equal(nodes(tree).find(node => node.props.role === 'status').props['aria-live'], 'polite');
assert(!nodes(tree).some(node => node.type === 'button'));
window.navigator.onLine = false; listeners.get('offline')();
tree = render(); assert.equal(tree.props['data-state'], 'offline');
window.navigator.onLine = true; listeners.get('online')(); props.error = true;
tree = render(); nodes(tree).find(node => node.type === 'button').props.onClick(); assert.equal(retries, 1);
props.error = false; props.lastSyncedAt = Date.now(); tree = render(); assert.equal(tree.props['data-state'], 'synced');
cleanup(); assert.equal(listeners.size, 0); assert.equal(timer, null);
console.log('PASS: room status reflects confirmed freshness, stale reads, saving, offline, auth recovery, accessible retry and listener cleanup.');
