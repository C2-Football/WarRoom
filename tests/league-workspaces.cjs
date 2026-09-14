const assert = require('node:assert/strict');
const test = require('node:test');
const W = require('../js/shared/league-workspaces.js');
test('six stable workspaces retain meaningful deep routes', () => {
    assert.deepEqual(W.navigation().filter(w => !w.utility).map(w => w.label), ['Home', 'My Team', 'Market', 'Draft', 'League', 'Research']);
    for (const [tab, group] of Object.entries({ lineup: 'team', strategy: 'team', decisions: 'team', fa: 'market', trades: 'market', calendar: 'league', trophies: 'league', stats: 'research', compare: 'research' })) {
        assert.equal(W.workspace(tab).id, group);
        assert.ok(W.views(group).some(v => v.tab === tab));
    }
});
test('legacy analytics links retain their selected report in its new home', () => {
    for (const [view, target] of Object.entries(W.analysisRoutes)) {
        assert.equal(W.resolve('analytics', { legacyAnalyticsView: view }).tab, target);
        assert.equal(W.resolve(target).analysis, view);
    }
    assert.equal(W.resolve('league').tab, 'research-players');
    assert.equal(W.resolve('alex').workspace, 'team');
    assert.equal(W.resolve('unknown-tab').tab, 'dashboard');
});
test('blocked deep links and navigation use the same format rules', () => {
    const chopped = { showTrades: false, showGmOffice: false, showGameDay: true, leagueType: 'chopped' };
    assert.equal(W.resolve('trades', chopped).tab, 'fa');
    assert.equal(W.resolve('strategy', chopped).tab, 'myteam');
    assert.equal(W.resolve('patterns', chopped).tab, 'myteam');
    assert.equal(W.views('market', chopped).some(v => v.tab === 'trades'), false);
    assert.equal(W.views('team', chopped).some(v => v.alex), false);
    assert.equal(W.resolve('lineup', { showGameDay: false }).tab, 'myteam');
    assert.equal(W.views('team', { showGameDay: false }).some(v => v.tab === 'lineup'), false);
});
test('callers cannot mutate shared routing metadata', () => {
    const route = W.resolve('calendar'); route.workspace = 'help';
    const nav = W.navigation(); nav[0].tab = 'trades';
    assert.equal(W.resolve('calendar').workspace, 'league');
    assert.equal(W.navigation()[0].tab, 'dashboard');
});
test('only an untouched previous starter layout receives the new defaults', () => {
    const defaults = [{ id: 'brief', key: 'intel-brief', size: 'xl' }];
    const league = [{ id: 'league-kpi', key: 'weekly-matchups', size: 'sm' }];
    const previous = [...league,
        { id: 'dw0', key: 'intel-brief', size: 'tall' },
        { id: 'dw1', key: 'roster-pulse', size: 'sm', primaryMetric: 'health-score' },
        { id: 'dw2', key: 'power-rankings', size: 'sm' },
        { id: 'dw3', key: 'roster-pulse', size: 'md', primaryMetric: 'elite-count' },
        { id: 'dw4', key: 'market-radar', size: 'md' },
    ];
    assert.deepEqual(W.upgradeStarter(previous, defaults, league), defaults);
    const resized = previous.map(w => ({ ...w })); resized[1].size = 'md';
    assert.equal(W.upgradeStarter(resized, defaults, league), resized);
    const reordered = [...previous].reverse();
    assert.equal(W.upgradeStarter(reordered, defaults, league), reordered);
    const removed = previous.slice(1);
    assert.equal(W.upgradeStarter(removed, defaults, league), removed);
    assert.equal(W.upgradeStarter(defaults, defaults, league), defaults);
});
