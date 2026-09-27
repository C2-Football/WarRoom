'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/standalone');
const source = babel.transform(fs.readFileSync('js/components/league-wire-nfl.js', 'utf8'), { presets: ['react'] }).code;
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const game = { id: '401772510', season: '2025', week: 1, seasontype: 2, home: 'PHI', away: 'DAL', homeScore: 24, awayScore: 20, completed: true, state: 'post', boxScoreUrl: 'https://www.espn.com/nfl/boxscore/_/gameId/401772510', homePeriods: [], awayPeriods: [] };
function harness() {
    let cursor = 0, props = { game }, tree;
    const slots = [], effects = [], calls = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
        useId: () => 'test',
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
    };
    const window = { AbortController, WrWireNfl: { recap: () => ({ headline: 'A verified result', body: 'A verified quarter swing.', spotlight: [] }), loadBoxScore: args => new Promise((resolve, reject) => calls.push({ ...args, resolve, reject })) } };
    const ctx = { React, window }; vm.createContext(ctx); vm.runInContext(source, ctx);
    return { calls, ctx, render(update) { props = { ...props, ...update }; cursor = 0; tree = window.WrNflGame(props); return tree; }, effects() { while (effects.length) effects.shift()(); }, toggle() { nodes(tree).find(n => n.props.className === 'wr-nfl-open-box').props.onClick(); }, unmount() { slots.forEach(s => s?.cleanup?.()); } };
}
(async () => {
    const h = harness(); let tree = h.render(); h.effects(); await settle(); assert.equal(h.calls.length, 0, 'scores do not auto-fetch player boxes');
    assert.match(text(tree), /verified quarter swing/);
    h.toggle(); tree = h.render(); h.effects(); await settle(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].force, false);
    assert.equal(nodes(tree).find(n => n.props.className === 'wr-nfl-open-box').props['aria-expanded'], true);
    h.calls[0].resolve({ status: 'ready', eventId: game.id, teams: [] }); await settle(); tree = h.render();
    assert(nodes(tree).some(n => n.type?.name === 'WrNflPlayerBox'));
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Refresh stats').props.onClick(); h.render(); h.effects(); await settle(); assert.equal(h.calls[1].force, true);
    h.calls[1].reject(Error('The latest player stats could not load.')); await settle(); tree = h.render(); assert.match(text(tree), /last available player box/); assert(nodes(tree).some(n => n.type?.name === 'WrNflPlayerBox'));
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Try again').props.onClick(); h.render(); h.effects(); await settle(); const pending = h.calls[2];
    h.toggle(); h.render(); h.effects(); assert(pending.signal.aborted, 'closing the box cancels its request');
    pending.resolve({ status: 'ready', eventId: 'late', teams: [] }); await settle(); assert(!nodes(h.render()).some(n => n.type?.name === 'WrNflPlayerBox'));
    h.toggle(); h.render(); h.effects(); await settle(); const old = h.calls[3];
    tree = h.render({ game: { ...game, id: '401772511', week: 2 } }); assert(!nodes(tree).some(n => n.type?.name === 'WrNflPlayerBox'), 'scope change hides stale data before effects'); h.effects(); assert(old.signal.aborted); h.unmount();
    const desk = h.ctx.window.WrNflDesk({ desk: { phase: { season: '2025', week: 1, seasontype: 2 }, current: { status: 'ready', games: [game], checkedAt: 1000 }, previousPhase: null, previous: { status: 'ready', games: [] } }, onRefresh() {} });
    assert.match(text(desk), /Refresh NFL scores/); assert.match(text(desk), /Feed checked/); assert.match(text(desk), /No earlier games/);
    const card = nodes(desk).find(n => n.type?.name === 'WrNflGame'); assert.equal(card.props.game.seasontype, 2); assert.equal(card.props.game.season, '2025');
    console.log('PASS NFL UI: explicit player loading, cancellation, scoped response isolation, retained stale boxes, retry, accessible controls and separate week navigation');
})().catch(error => { console.error(error); process.exitCode = 1; });
