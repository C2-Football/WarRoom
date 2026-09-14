#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const context = vm.createContext({ window: { App: {} }, console });
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/global-view.js', 'utf8'), { presets: ['react'] }).code, context);
const model = {
    provinces: [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta', canTrade: false }, { id: 'C', name: 'Gamma', league: { settings: { type: 3 } } }],
    assets: [
        { pid: 'p', name: 'Shared', pos: 'WR', team: 'BUF', dhq: 1000, leagueId: 'A' },
        { pid: 'q', name: 'Anchor', pos: 'QB', team: 'BUF', dhq: 3000, leagueId: 'A' },
        { pid: 'p', name: 'Shared', pos: 'WR', team: 'BUF', dhq: 1000, leagueId: 'B' },
        { pid: 'r', name: 'Unknown', pos: 'RB', team: 'FA', dhq: 0, leagueId: 'C' },
    ],
};
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok ' + name); };
const run = options => context.buildEmpireScenario(model, options);
test('player shock conserves value and ranks proportional league impact', () => {
    const before = JSON.stringify(model);
    const r = run({ target: 'p', drop: 30 });
    assert.equal(r.total, 5000); assert.equal(r.loss, 600); assert.equal(r.after, 4400); assert.equal(r.lossPct, 12);
    assert.equal(r.rows[0].province.id, 'B'); assert.equal(r.rows[0].lossPct, 30); assert.equal(r.rows[1].lossPct, 7.5);
    assert.equal(r.rows.reduce((n, row) => n + row.loss, 0), r.loss);
    assert.equal(JSON.stringify(model), before);
});
test('team correlation aggregates different players and positions across leagues', () => {
    const r = run({ kind: 'team', target: 'BUF', drop: 50 });
    assert.equal(r.exposed, 5000); assert.equal(r.loss, 2500); assert.equal(r.rows.length, 2);
    assert.equal(r.choices.length, 1); // Free agents do not form an NFL team.
    assert.equal(run({ kind: 'position', target: 'WR', drop: 100 }).loss, 2000);
});
test('guardrails round down whole league ownership and include unvalued players', () => {
    const r = run({ cap: 50 });
    assert.equal(r.allowed, 1); assert.equal(r.breaches.length, 1); assert.equal(r.breaches[0].excess, 1);
    assert.equal(run({ cap: 100 }).breaches.length, 0);
    assert.equal(run({ cap: 0 }).breaches.length, 3);
});
test('zero, total loss, invalid inputs, stale target and missing values stay honest', () => {
    assert.equal(run({ drop: 0 }).loss, 0);
    assert.equal(run({ kind: 'team', drop: 150 }).after, 0);
    assert.equal(run({ drop: NaN }).drop, 30);
    assert.ok(run({ target: 'removed' }).selected);
    const r = run({ target: 'r' });
    assert.equal(r.rows[0].lossPct, null); assert.equal(r.rows[0].unknown, 1);
    const empty = context.buildEmpireScenario({ provinces: [], assets: [] });
    assert.equal(empty.lossPct, null); assert.equal(empty.selected, null); assert.equal(empty.breaches.length, 0);
});
test('duplicates and excluded league assets cannot inflate the scenario', () => {
    const r = context.buildEmpireScenario({ ...model, assets: [...model.assets, model.assets[0], { ...model.assets[0], leagueId: 'excluded' }] }, { target: 'p' });
    assert.equal(r.total, 5000); assert.equal(r.rows.length, 2); assert.equal(r.breaches[0].count, 2);
});
test('scenario action capability excludes Chopped and disabled trading', () => {
    assert.equal(context.canOpenEmpireTradeDesk(model.provinces[0]), true);
    assert.equal(context.canOpenEmpireTradeDesk(model.provinces[1]), false);
    assert.equal(context.canOpenEmpireTradeDesk(model.provinces[2]), false);
});
test('interactive controls recompute results and route trading and non-trading leagues', () => {
    let slots = [], cursor = 0, opened;
    context.React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = init; return [slots[i], value => { slots[i] = value; }]; },
        useMemo: fn => fn(),
    };
    context.window.scrollTo = () => {};
    const render = () => { cursor = 0; return context.EmpirePortfolioLab({ model, onOpen: detail => { opened = detail; } }); };
    const all = (tree, predicate) => {
        const out = [];
        const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; if (predicate(n)) out.push(n); walk(n.children); };
        walk(tree); return out;
    };
    const text = n => n == null ? '' : Array.isArray(n) ? n.map(text).join('') : typeof n === 'object' ? text(n.children) : String(n);
    let tree = render();
    const select = all(tree, n => n.type === 'select')[1];
    select.props.onChange({ target: { value: 'p' } }); tree = render();
    assert.match(text(tree), /12.0%/);
    all(tree, n => n.props['aria-label'] === 'Value drop')[0].props.onChange({ target: { value: '50' } });
    tree = render(); assert.match(text(tree), /20.0%/);
    all(tree, n => n.type === 'button' && text(n) === 'Review trade options')[0].props.onClick();
    assert.equal(opened.type, 'tradeDesk'); assert.equal(opened.seedPid, 'p'); assert.equal(opened.leagueId, 'A');
    all(tree, n => n.type === 'button' && text(n) === 'Review roster')[0].props.onClick();
    assert.equal(opened.type, 'league'); assert.equal(opened.leagueId, 'B');
    all(tree, n => n.props['aria-label'] === 'Maximum player exposure')[0].props.onChange({ target: { value: '100' } });
    assert.match(text(render()), /Within your exposure target/);
});
console.log('PASS ' + passed + ' scenario tests');
