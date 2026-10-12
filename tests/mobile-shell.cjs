'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const workspaces = require('../js/shared/league-workspaces.js');
const source = fs.readFileSync('js/league-detail.js', 'utf8');
const compiled = babel.transform(source, { presets: ['react'] }).code;

function fixture({ open = false, phone = true, keyboard = false, activeTab = 'myteam', options = {} } = {}) {
    const updates = [], selections = [], events = {};
    const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
    let hook = 0;
    const context = {
        console,
        useState: initial => [hook++ === 0 ? open : typeof initial === 'function' ? initial() : initial, value => updates.push(value)],
        useRef: () => ({ current: null }),
        useEffect: fn => fn(),
        React: { createElement: h, Fragment: 'fragment' },
        window: { addEventListener: (name, fn) => { events[name] = fn; }, App: {}, WR: { LeagueWorkspaces: workspaces, Sheet: 'sheet', useViewport: () => ({ isPhone: phone, kbOpen: keyboard }) } },
    };
    vm.createContext(context);
    vm.runInContext(compiled, context);
    context.props = { activeTab, workspaceOptions: { ...options, isPhone: phone }, onSelectTab: tab => selections.push(tab) };
    vm.runInContext('props.navItems = buildLeagueNavItems(props.workspaceOptions)', context);
    const tree = vm.runInContext('PhoneDockInner(props)', context);
    const nodes = [];
    function walk(node) { if (!node || typeof node !== 'object') return; nodes.push(node); (node.children || []).forEach(walk); }
    walk(tree);
    const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
    return { context, nodes, text, updates, selections, events };
}

const closed = fixture();
const dock = closed.nodes.filter(n => n.type === 'button' && n.props.className?.includes('wr-dock-chip'));
assert.deepEqual(dock.map(closed.text), ['Overview', 'Roster', 'League', 'Game Day']);
assert.equal(dock.find(n => n.props['aria-current'] === 'page').children.map(closed.text).join(''), 'Roster');
closed.events['wr:phone-menu']();
assert.deepEqual(closed.updates, [false, true]);

const expanded = fixture({ open: true, activeTab: 'stats' });
for (const tab of ['fa', 'trades', 'draft', 'mock-draft', 'draft-review', 'wire', 'stats', 'compare', 'settings', 'gm-settings', 'legend']) {
    const expected = workspaces.resolve(tab,{isPhone:true}).label;
    assert.ok(expanded.nodes.some(n => n.type === 'button' && expanded.text(n) === expected + '›'), `More must retain ${expected}`);
}
for (const label of ['Team outlook','Market review','Players & picks','Custom reports']) assert(!expanded.nodes.some(n=>n.type==='button'&&expanded.text(n)===label+'›'),label+' is removed from phone navigation');
expanded.nodes.find(n => n.type === 'button' && expanded.text(n) === 'Waivers›').props.onClick();
assert.deepEqual(expanded.selections, ['fa']);
assert.deepEqual(expanded.updates, [false, false]);

const restricted = fixture({ open: true, options: { showTrades: false, showGmOffice: false, leagueType: 'chopped' } });
const labels = restricted.nodes.filter(n => n.type === 'button').map(restricted.text);
assert.ok(labels.includes('Waivers›'));
assert.ok(!labels.includes('Trade Desk›'));
assert.ok(!labels.includes('Alex preferences›'));

for (const opts of [{ phone: false }, { keyboard: true }]) {
    const f = fixture(opts);
    assert.equal(vm.runInContext('PhoneDock(props)', f.context), null);
}
console.log('PASS mobile shell: four destinations, retained routes, capability gates, and phone/keyboard visibility');

const headerSource = source.slice(source.indexOf('<div className="wr-mobile-workspace">'), source.indexOf('<div className="wr-workspace-heading">')).trim();
for (const activeTab of ['myteam', 'alex']) {
    const f = fixture({ activeTab });
    Object.assign(f.context, {
        workspaceRoute: workspaces.resolve(activeTab),
        workspace: workspaces.workspace(activeTab),
        workspaceViews: workspaces.views('team'),
        viewTab: activeTab,
        setActiveTab: tab => f.selections.push(tab),
    });
    const header = vm.runInContext(babel.transform('(' + headerSource + ')', { presets: ['react'] }).code, f.context);
    const title = header.children[0];
    assert.equal(title.type, 'h1');
    assert.equal(f.text(title), workspaces.resolve(activeTab).label);
    assert.ok(!title.children.some(node => node?.type === 'select'), 'Mobile shows a stable workspace title instead of a route selector');
}
assert.match(source, /viewTab !== 'dashboard' && \(!alexPhone \|\| viewTab === 'wire'\)/, 'Phones only mount Wire on its menu destination');
console.log('PASS mobile titles: stable route labels and My Team phone focus');
