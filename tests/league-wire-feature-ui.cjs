'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/standalone');
const source = babel.transform(fs.readFileSync('js/components/league-wire-features.js', 'utf8'), { presets: ['react'] }).code;
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
    let cursor = 0, owner = 'account:a', tree;
    const slots = [], effects = [], timers = new Map(), calls = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
    };
    const window = { AbortController, App: { AccountStorage: { owner: () => owner } }, WrWireReading: { paragraphs: body => body.split('\n\n') }, WrWireDraftHistory: { load: args => new Promise((resolve, reject) => calls.push({ ...args, resolve, reject })) } };
    const ctx = { window, React, console, setTimeout: fn => { const id = {}; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
    vm.createContext(ctx); vm.runInContext(source, ctx);
    let props = { league: { league_id: '1', season: '2026' }, throughWeek: 4 };
    return { calls, ctx, render(update) { props = { ...props, ...update }; cursor = 0; tree = window.WrWireDraftReceipts(props); return tree; },
        effects() { while (effects.length) effects.shift()(); }, open() { nodes(tree).find(n => n.type === 'button').props.onClick(); },
        owner(value) { owner = value; }, timeout() { [...timers.values()].forEach(fn => fn()); }, unmount() { slots.forEach(s => s?.cleanup?.()); } };
}
(async () => {
    const app = harness(); let tree = app.render(); app.effects(); await settle();
    assert.equal(app.calls.length, 0, 'draft requests are explicit, not started by opening League life');
    app.open(); app.render(); app.effects(); await settle(); assert.equal(app.calls.length, 1); assert.equal(app.calls[0].force, false);
    app.calls[0].resolve({ status: 'ready', stories: [{ id: 'draft-1', text: 'A verified receipt', body: 'One paragraph.\n\nThe next paragraph.' }], coverage: ['Starting-lineup points only.'] }); await settle();
    tree = app.render(); assert.match(text(tree), /A verified receipt/); assert.match(text(tree), /Starting-lineup points only/);
    app.owner('account:b'); tree = app.render(); assert.doesNotMatch(text(tree), /A verified receipt/, 'new app account hides prior output before effects'); app.effects();
    app.open(); app.render(); app.effects(); await settle(); const pending = app.calls[1];
    tree = app.render({ throughWeek: 5 }); assert.doesNotMatch(text(tree), /A verified receipt/); app.effects(); assert(pending.signal.aborted, 'edition change cancels work');
    pending.resolve({ status: 'ready', stories: [{ id: 'old', text: 'Late old result', body: 'Stale' }] }); await settle(); assert.doesNotMatch(text(app.render()), /Late old result/);
    app.open(); app.render(); app.effects(); await settle(); app.timeout(); tree = app.render(); assert.match(text(tree), /took too long/); assert(app.calls[2].signal.aborted);
    app.open(); app.render(); app.effects(); await settle(); assert.equal(app.calls.length, 4, 'timeout is retryable'); app.unmount(); assert(app.calls[3].signal.aborted);
    const people = app.ctx.window.WrWirePeople({ participants: [{ ownerId: 'a', ownerName: 'Malcolm Wohler', teamName: 'Agamemnonmaxxing' }, { ownerId: 'a', ownerName: 'Malcolm Wohler', teamName: 'Agamemnonmaxxing' }, { ownerId: 'b', ownerName: null, teamName: 'Unknown owner team' }] });
    assert.match(text(people), /Malcolm Wohler Agamemnonmaxxing/); assert.equal(nodes(people).filter(n => n.type === 'li').length, 1);
    console.log('PASS Wire feature UI: explicit loading, owner and edition isolation, cancellation, timeout/retry, identity bylines');
})().catch(error => { console.error(error); process.exitCode = 1; });
