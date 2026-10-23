'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const workspaces = require('../js/shared/league-workspaces.js');
const source = fs.readFileSync('js/league-detail.js', 'utf8');
const selections = [];
const context = vm.createContext({
    console,
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) },
    window: { App: {}, WR: { LeagueWorkspaces: workspaces } },
});
vm.runInContext(babel.transform(source, { presets: ['react'] }).code, context);
const plain = value => JSON.parse(JSON.stringify(value));
const groups = options => {
    context.options = options;
    return plain(vm.runInContext('buildLeagueCommandGroups(options)', context));
};
const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(walk)] : [];
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const allowedTabs = options => workspaces.navigation(options).flatMap(item => workspaces.views(item.workspace, options)).map(view => view.tab);
const tabs = result => result.flatMap(group => group.views.map(view => view.tab));

for (const options of [
    { isPhone: false, leagueType: 'dynasty' },
    { isPhone: false, leagueType: 'redraft', showTrades: false },
    { isPhone: false, leagueType: 'chopped', showTrades: false, showGmOffice: false, showGameDay: false },
    { isPhone: true, leagueType: 'dynasty' },
]) {
    const result = groups(options), actual = tabs(result);
    assert.deepEqual(result.map(group => group.label), ['Your team', 'Market & draft', 'League & research', 'Alex & tools']);
    assert.equal(new Set(actual).size, actual.length, 'Every allowed destination appears once');
    assert.deepEqual([...actual].sort(), allowedTabs(options).sort(), 'Groups retain every permitted route for this format and viewport');
}
const desktop = tabs(groups({ isPhone: false, leagueType: 'dynasty' }));
for (const tab of ['team-outlook', 'market-review', 'research-players', 'research-reports']) assert(desktop.includes(tab), 'Browser retains ' + tab);
assert(!desktop.includes('mock-draft'), 'Phone-only mock-draft stays out of browser navigation');
const chopped = tabs(groups({ isPhone: false, leagueType: 'chopped', showTrades: false, showGmOffice: false, showGameDay: false }));
for (const tab of ['trades', 'strategy', 'decisions', 'patterns', 'gm-settings', 'lineup']) assert(!chopped.includes(tab), 'Capability gate excludes ' + tab);

context.props = { activeTab: 'team-outlook', workspaceOptions: { isPhone: false }, onSelectTab: tab => selections.push(tab) };
const tree = vm.runInContext('DesktopCommandNav(props)', context);
assert.equal(tree.type, 'nav');
assert.equal(tree.props['aria-label'], 'Your command center');
const buttons = walk(tree).filter(node => node.type === 'button');
const current = buttons.filter(node => node.props['aria-current'] === 'page');
assert.equal(current.length, 1, 'Only the exact selected route is current');
assert.equal(text(current[0]), 'Team outlook');
assert(!buttons.find(node => text(node) === 'Roster').props['aria-current'], 'Another route in the active workspace is not marked current');
buttons.find(node => text(node) === 'Trade Desk').props.onClick();
assert.deepEqual(selections, ['trades'], 'Direct links select their route');

context.window.WR.LeagueWorkspaces = {
    navigation: options => [...workspaces.navigation(options), { workspace: 'future' }],
    views: (workspace, options) => workspace === 'future' ? [{ tab: 'future-report', label: 'Future report' }] : workspaces.views(workspace, options),
};
const future = groups({ isPhone: false });
assert(future.find(group => group.label === 'Alex & tools').views.some(view => view.tab === 'future-report'), 'New allowed destinations remain reachable');
assert.equal(tabs(future).filter(tab => tab === 'future-report').length, 1);
console.log('PASS desktop command center: shared task groups, complete permitted routes, format gates, exact selection, and direct navigation');
