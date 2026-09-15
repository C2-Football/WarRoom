'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const workspaces = require('../js/shared/league-workspaces.js');
const source = fs.readFileSync('js/league-detail.js', 'utf8');
const compiled = babel.transform(source, { presets: ['react'] }).code;

function fixture({ open = false, phone = true, keyboard = false, activeTab = 'myteam', options = {} } = {}) {
    const updates = [], selections = [];
    const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
    const context = {
        console,
        useState: () => [open, value => updates.push(value)],
        useRef: () => ({ current: null }),
        useEffect: () => {},
        React: { createElement: h, Fragment: 'fragment' },
        window: { App: {}, WR: { LeagueWorkspaces: workspaces, Sheet: 'sheet', useViewport: () => ({ isPhone: phone, kbOpen: keyboard }) } },
    };
    vm.createContext(context);
    vm.runInContext(compiled, context);
    context.props = { activeTab, workspaceOptions: options, onSelectTab: tab => selections.push(tab) };
    vm.runInContext('props.navItems = buildLeagueNavItems()', context);
    const tree = vm.runInContext('PhoneDockInner(props)', context);
    const nodes = [];
    function walk(node) { if (!node || typeof node !== 'object') return; nodes.push(node); (node.children || []).forEach(walk); }
    walk(tree);
    const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
    return { context, nodes, text, updates, selections };
}

const closed = fixture();
const dock = closed.nodes.filter(n => n.type === 'button' && n.props.className?.includes('wr-dock-chip'));
assert.deepEqual(dock.map(closed.text), ['Home', 'My Team', 'League', 'More']);
assert.equal(dock.find(n => n.props['aria-current'] === 'page').children.map(closed.text).join(''), 'My Team');
dock[3].props.onClick();
assert.deepEqual(closed.updates, [true]);

const expanded = fixture({ open: true, activeTab: 'stats' });
const more = expanded.nodes.find(n => n.type === 'button' && expanded.text(n) === 'More');
assert.equal(more.props['aria-current'], 'page');
assert.equal(more.props['aria-expanded'], true);
for (const tab of ['fa', 'trades', 'draft', 'draft-review', 'stats', 'compare', 'settings', 'gm-settings', 'legend']) {
    const expected = workspaces.resolve(tab).label;
    assert.ok(expanded.nodes.some(n => n.type === 'button' && expanded.text(n) === expected + '›'), `More must retain ${expected}`);
}
expanded.nodes.find(n => n.type === 'button' && expanded.text(n) === 'Waivers›').props.onClick();
assert.deepEqual(expanded.selections, ['fa']);
assert.deepEqual(expanded.updates, [false]);

const restricted = fixture({ open: true, options: { showTrades: false, showGmOffice: false, leagueType: 'chopped' } });
const labels = restricted.nodes.filter(n => n.type === 'button').map(restricted.text);
assert.ok(labels.includes('Waivers›'));
assert.ok(!labels.includes('Trades›'));
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
    const select = header.children[0].children[0];
    const option = select.children.find(node => node && node.props?.value === activeTab);
    assert.ok(option, `${activeTab} must have a matching title option`);
    assert.equal(f.text(option), workspaces.resolve(activeTab).label);
    select.props.onChange({ target: { value: 'lineup' } });
    assert.deepEqual(f.selections, ['lineup']);
}
console.log('PASS mobile titles: current and legacy routes retain their labels and navigation');
