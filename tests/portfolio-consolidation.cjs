#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('ok ' + name); };
let slots = [], cursor = 0;
const namedSlots = new Map();
const React = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return typeof type === 'function' ? type({ ...props, children }) : { type, props: props || {}, children }; },
    __namedUseState(name, init) { namedSlots.set(name, cursor); return React.useState(init); },
    useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useMemo(fn) { return fn(); }, useCallback(fn) { return fn; }, useEffect() {}, useRef(value) { return { current: value }; },
};
const store = new Map();
const context = vm.createContext({ React, console, URLSearchParams, requestAnimationFrame: fn => fn(), location: { hostname: 'localhost', search: '' }, document: { querySelector: () => ({ scrollIntoView() {} }) }, localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) }, App: {}, S: {}, scrollTo() {} });
context.window = context;
// Address state by its declared meaning, never by hook order. Adding a journal
// hook must not accidentally inject market data into a different control.
const load = file => vm.runInContext(Babel.transform(read(file), { presets: ['react'], plugins: [({types:t}) => ({visitor:{
    VariableDeclarator(p) {
        const {id,init}=p.node;
        if (!t.isArrayPattern(id) || !t.isIdentifier(id.elements[0]) || !t.isCallExpression(init)) return;
        const c=init.callee;
        if (t.isIdentifier(c,{name:'useState'}) || (t.isMemberExpression(c) && t.isIdentifier(c.object,{name:'React'}) && t.isIdentifier(c.property,{name:'useState'}))) {
            init.callee=t.memberExpression(t.identifier('React'),t.identifier('__namedUseState'));
            init.arguments.unshift(t.stringLiteral(id.elements[0].name));
        }
    }
}})] }).code, context);
load('js/tabs/global-view.js');
context.OD = { getCurrentUserId: () => 'portfolio-fixture', getSessionToken: () => 'fixture-session' };
load('reconai-shared/storage.js');
load('js/shared/account-storage.js');
load('js/shared/empire-decisions.js');
load('js/components/commish-sidebar.js');
load('js/components/commish-governance-panel.js');
const app = read('js/app.js');
vm.runInContext(app.slice(app.indexOf('    function buildPortfolioPlayerContext'), app.indexOf('    window.App.PortfolioContext =')), context);
function all(tree, predicate) {
    const result = [];
    const walk = n => { if (n == null || typeof n === 'boolean') return; if (Array.isArray(n)) return n.forEach(walk); if (typeof n !== 'object') return; if (predicate(n)) result.push(n); walk(n.children); };
    walk(tree); return result;
}
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.children) : String(tree);
const button = (tree, label) => { const b = all(tree, n => n.type === 'button' && text(n) === label)[0]; assert.ok(b, 'Missing button: ' + label); return b; };
const fixture = { allLeagues: [{ id: 'L1', name: 'Alpha', settings: { type: 2, draft_rounds: 2 }, rosters: [{ owner_id: 'me', roster_id: 1, players: ['p1'], settings: { wins: 2, losses: 1 } }] }], sleeperUserId: 'me', playersData: { p1: { first_name: 'Test', last_name: 'Player', position: 'WR', age: 28 } }, onBack() {}, onEnterLeague() {} };
const render = () => { cursor = 0; return context.EmpireDashboard(fixture); };

test('ownership context counts IR/taxi once, excludes opponents, and preserves unknown coverage', () => {
    const leagues = [
        { id: 'one', name: 'One', rosters: [{ owner_id: 'me', roster_id: 1, players: ['p1'], reserve: ['p1'], taxi: ['p2'] }, { owner_id: 'other', roster_id: 2, players: ['p3'] }] },
        { id: 'two', name: 'Two', myRosterId: 7, rosters: [{ owner_id: 'platform-owner', roster_id: 7, players: ['p1'] }] },
        { id: 'unloaded' },
    ];
    const out = context.buildPortfolioPlayerContext(leagues, 'me', 'p1');
    assert.equal(out.count, 2); assert.equal(out.totalLeagues, 3); assert.equal(out.coveredLeagues, 2); assert.equal(out.complete, false);
    assert.equal(context.buildPortfolioPlayerContext(leagues, 'me', 'p2').count, 1);
    assert.equal(context.buildPortfolioPlayerContext(leagues, 'me', 'p3').count, 0);
    assert.equal(context.buildPortfolioPlayerContext([leagues[0], leagues[0]], 'me', 'p1').count, 1);
    assert.equal(context.buildPortfolioPlayerContext([], null, 'p1').coveredLeagues, 0);
});

test('hub resumes the last league and puts league work before portfolio and games', () => {
    Object.assign(context, {
        EMPIRE_FREE_PRELIVE: true, EMPIRE_ENABLED: true, COMMISH_ENABLED: true, TIME_LEAGUE_ENABLED: true,
        getUserTier: () => 'free', leagueQuery: '', hubAllLeagues: false, lastLeagueId: 'L1', hubSyncing: false, commishCount: 1,
        sleeperLeagues: fixture.allLeagues,
        sleeperUsername: 'owner', sleeperCoverage: { status: 'ready', knownCount: 1, loadedCount: 1 },
        leagueRouteStatus: { status: 'idle' },
        pendingInvite: false, error: null, distPrefix: '', ProTierIcon: () => null,
        leagueTeamName: l => 'Team ' + l.id, leagueFormat: () => 'Dynasty', leagueHealth: () => ({ wp: null }), initialsFor: () => 'A',
        setShowSettings() {}, setShowConnect() {}, setProMode() {}, openCommishOffice() {}, openTimeLeague() {}, openDuat() {},
        setAllWireOpen() {},
        setLeagueQuery: value => { context.leagueQuery = value; },
        setHubAllLeagues: value => { context.hubAllLeagues = value; },
    });
    const pickerSource = app.slice(app.indexOf('        function FranchisePicker('), app.indexOf('        function handleSelectLeague('));
    vm.runInContext(Babel.transform(pickerSource, { presets: ['react'] }).code, context);
    let selected;
    const tree = context.FranchisePicker({ leagues: fixture.allLeagues, onSelect: league => { selected = league.id; } });
    const resume = all(tree, n => n.type === 'button' && n.props.className === 'hub-resume')[0];
    assert.match(text(resume), /Resume Team L1/); resume.props.onClick(); assert.equal(selected, 'L1');
    const sections = all(tree, n => n.type === 'section').map(n => n.props.id);
    assert.deepEqual(sections, ['hub-leagues', 'hub-management', 'hub-games']);
    assert.match(text(tree), /The Vault/); assert.match(text(tree), /The Duat/);
});

test('real Sleeper IDs survive select, back and direct-link restore without crossing accounts', () => {
    // Use the production serialization wrapper: numeric-looking raw strings are
    // JSON-parsed, so a short synthetic league ID cannot catch this regression.
    const core = read('js/core.js');
    vm.runInContext(core.slice(core.indexOf('    const WR_KEYS ='), core.indexOf('    window.App.WrIDB =')), context);
    vm.runInContext(app.slice(app.indexOf('    const APP_WR_KEYS'), app.indexOf('    const WR_HOST')), context);
    const league = { ...fixture.allLeagues[0], id: '1389388885716385792', name: 'CTB Shootout' };
    let account = 'owner-a';
    Object.assign(context, {
        OD: { getCurrentUserId: () => account, getSessionToken: () => 'fixture-session' }, sleeperUser: { user_id: 'sleeper-a' },
        selectedLeague: null, activeTab: 'dashboard', proMode: false, showSettings: false, customDisplayName: '', leagueMates: [], allWireOverlay: null,
        isNavigatingRef: { current: false }, initialRouteAppliedRef: { current: false },
        linkedRouteRequestRef: { current: 0 }, linkedLeaguesRef: { current: new Map() },
        setLeagueRouteStatus: value => { context.leagueRouteStatus = value; },
        sleeperLeagues: [league], espnLeagues: [], mflLeagues: [], visibleEspnLeagues: [], visibleMflLeagues: [], loading: false,
        setSelectedLeague: value => { context.selectedLeague = value; },
        setActiveLeagueId: value => { context.activeLeagueId = value; },
        setActiveTab: value => { context.activeTab = value; },
        setTimeout: fn => fn(), handleTabChange() {}, ErrorBoundary: props => props.children,
        LeagueDetail: props => ({ type: 'league-detail', props, children: [] }),
    });
    context.location = { hostname: 'localhost', pathname: '/dist-preview/index.html', search: '?dev=true&user=bigloco', hash: '' };
    const changeRoute = (state, _title, url) => { context.history.state = state; context.location.hash = new URL(url, 'http://localhost').hash; };
    context.history = { state: null, pushState: changeRoute, replaceState: changeRoute };
    vm.runInContext(app.slice(app.indexOf('        function buildHash('), app.indexOf('        useEffect(() => {\n            if (sleeperUsername)')), context);
    vm.runInContext(app.slice(app.indexOf('        function handleSelectLeague('), app.indexOf('        function handleTabChange(')), context);
    const leagueRender = app.slice(app.indexOf('        // Show league detail if selected'), app.indexOf('        // ── Shared helpers ──'));
    vm.runInContext(Babel.transform('function renderLeagueRoute() {' + leagueRender + '\n}', { presets: ['react'] }).code, context);
    const hub = () => {
        context.lastLeagueId = context.readHubLastVisit(context.sleeperUser.user_id)?.id;
        return context.FranchisePicker({ leagues: [league], onSelect: context.handleSelectLeague });
    };
    assert.equal(all(hub(), n => n.props.className === 'hub-resume').length, 0);
    const leagueCard = all(hub(), n => n.type === 'button' && n.props.className?.includes('hub-league-card'))[0];
    assert.ok(leagueCard); leagueCard.props.onClick();
    assert.equal(context.selectedLeague.id, league.id);
    assert.equal(context.location.hash, '#league=' + league.id + '&tab=dashboard');
    all(context.renderLeagueRoute(), n => n.type === 'league-detail')[0].props.onBack();
    assert.equal(context.selectedLeague, null); assert.equal(context.location.hash, '');
    let tree = hub();
    assert.equal(context.lastLeagueId, league.id);
    assert.match(text(tree), /Resume Team 1389388885716385792/); assert.match(text(tree), /Last opened/);
    all(tree, n => n.props.className === 'hub-resume')[0].props.onClick();
    assert.equal(context.selectedLeague.id, league.id);

    // A bookmarked view retains its route and also becomes the next Resume.
    context.initialRouteAppliedRef.current = false;
    context.location.hash = '#league=' + league.id + '&tab=stats';
    const routeEffectStart = app.indexOf('        React.useEffect(() => {\n            if (initialRouteAppliedRef.current)');
    const routeEffectEnd = app.indexOf('        // Show Empire Dashboard', routeEffectStart);
    const originalEffect = React.useEffect; React.useEffect = fn => fn();
    try {
        // A known league whose provider details failed must retain the bookmark
        // until retry hydrates it, even if another league already loaded.
        context.sleeperLeagues = [{ ...league, id: 'other-league' }];
        context.sleeperCoverage = { status: 'partial', listVerified: true, knownLeagues: [{ id: league.id }] };
        vm.runInContext(app.slice(routeEffectStart, routeEffectEnd), context);
        assert.equal(context.initialRouteAppliedRef.current, false);
        context.sleeperLeagues = [league];
        context.sleeperCoverage = { status: 'ready', listVerified: true, knownCount: 1, loadedCount: 1 };
        vm.runInContext(app.slice(routeEffectStart, routeEffectEnd), context);
    } finally { React.useEffect = originalEffect; }
    assert.equal(context.activeTab, 'stats'); assert.equal(context.location.hash, '#league=' + league.id + '&tab=stats');
    all(context.renderLeagueRoute(), n => n.type === 'league-detail')[0].props.onBack();
    assert.match(text(hub()), /Last opened/);
    account = 'owner-b';
    assert.equal(all(hub(), n => n.props.className === 'hub-resume').length, 0);
    assert.equal(context.readHubLastVisit('sleeper-a'), null);
    account = null;
    context.rememberHubLastVisit(league, 'sleeper-a');
    assert.equal(context.readHubLastVisit('sleeper-a').id, league.id);
    assert.equal(context.readHubLastVisit('sleeper-b'), null);
    assert.equal(context.readHubLastVisit(null), null);
    account = 'owner-a';
    assert.equal(context.readHubLastVisit('sleeper-a').id, league.id);
});

test('Empire exposes four workspaces and every prior specialized view remains reachable', () => {
    let tree = render();
    const nav = all(tree, n => n.props['aria-label'] === 'Empire workspaces')[0];
    assert.deepEqual(all(nav, n => n.type === 'button').map(text), ['Overview', 'Actions', 'Leagues', 'Assets']);
    button(tree, 'Actions').props.onClick(); tree = render();
    for (const label of ['Priority queue', 'Trade opportunities', 'Decision journal', 'Trade Desk']) button(tree, label);
    button(tree, 'Leagues').props.onClick(); tree = render();
    for (const label of ['League overview', 'Competitive windows', 'Season outlook', 'Rivals', 'Map']) button(tree, label);
    button(tree, 'Competitive windows').props.onClick(); tree = render(); assert.match(text(tree), /War Table/);
    button(tree, 'Assets').props.onClick(); tree = render();
    for (const label of ['Allocation', 'Players & picks', 'Exposure', 'Market index', 'Rankings']) button(tree, label);
    button(tree, 'Rankings').props.onClick(); tree = render(); assert.match(text(tree), /Scout Board/);
});

test('full Priority Queue preserves preview records and tracks them into the journal', () => {
    context.buildEmpireActionQueue = () => [{ kind: 'need', type: 'need', title: 'Fill Alpha WR', detail: 'Upgrade the roster', why: 'Upgrade the roster', leagueId: 'L1', leagueName: 'Alpha', cta: 'Open league', severity: 'high' }];
    let tree = render(); button(tree, 'Overview').props.onClick(); tree = render(); assert.match(text(tree), /Fill Alpha WR/);
    button(tree, 'Actions').props.onClick(); tree = render();
    const queue = all(tree, n => n.props['data-testid'] === 'empire-full-priority-queue')[0];
    assert.match(text(queue), /Fill Alpha WR/);
    button(queue, 'Track decision').props.onClick(); tree = render();
    button(tree, 'Decision journal').props.onClick(); tree = render();
    const journal = all(tree, n => n.props['data-testid'] === 'empire-decision-journal')[0];
    assert.match(text(journal), /Fill Alpha WR/); assert.match(text(journal), /Alpha/);
    const status = all(journal, n => n.type === 'select')[0]; status.props.onChange({ target: { value: 'WORKING' } });
    tree = render(); assert.match(text(all(tree, n => n.props['data-testid'] === 'empire-decision-journal')[0]), /WORKING/);
});

test('Empire arbitrage and direct Trade Desk state respect Chopped and disabled-trade leagues', () => {
    const original = fixture.allLeagues;
    const base = original[0];
    fixture.allLeagues = [base,
        { ...base, id: 'chopped', name: 'CTB Shootout', settings: { type: 3 } },
        { ...base, id: 'disabled', name: 'No trades', settings: { type: 2, disable_trades: 1 } },
    ];
    context.App.EmpireValues = { build: () => ({ byLeague: {}, arbitrage: [{
        pid: 'p1', name: 'Test Player', pos: 'WR', spreadMine: true, spreadPct: 20, gap: 100,
        high: { name: 'CTB Shootout', value: 600 }, low: { name: 'Alpha', value: 500 }, note: 'Owned in these leagues',
        legs: fixture.allLeagues.map(l => ({ leagueId: l.id, name: l.name, mine: true })),
    }] }) };
    slots = []; cursor = 0; render();
    slots[namedSlots.get('markData')] = { stats: {}, prior: {}, proj: {} }; // settled market-data hook
    let tree = render();
    const arbitrage = all(tree, n => n.props['data-testid'] === 'empire-arbitrage')[0];
    assert.ok(arbitrage);
    const entries = all(arbitrage, n => n.type === 'button' && text(n).startsWith('Trade Desk'));
    assert.deepEqual(entries.map(text), ['Trade Desk · Alpha']);
    button(tree, 'Actions').props.onClick(); tree = render(); button(tree, 'Trade Desk').props.onClick(); tree = render();
    assert.doesNotMatch(text(tree), /CTB Shootout|No trades/);
    let tradeMounts = 0;
    context.TradeCalcTab = () => { tradeMounts++; return null; };
    for (const leagueId of ['chopped', 'disabled']) {
        slots[namedSlots.get('detail')] = { type: 'tradeDesk', leagueId, seedPid: 'p1' }; // restored/stale direct route
        tree = render(); assert.match(text(tree), /Trading is unavailable in this league/);
    }
    assert.equal(tradeMounts, 0, 'blocked league never mounts the trade builder');
    fixture.allLeagues = original; delete context.App.EmpireValues; slots = [];
});

test('Commissioner workspace selection preserves legacy desk routes and settings', () => {
    const office = read('js/tabs/commissioner-office.js');
    const groupDeclaration = office.slice(office.indexOf('    const HUB_GROUPS = ['), office.indexOf('    const scoredYet =', office.indexOf('    const HUB_GROUPS = [')));
    const groups = vm.runInNewContext(groupDeclaration + '\nHUB_GROUPS').map(g => ({ ...g, hubs: g.hubs.map(([hub, name]) => ({ hub, name })) }));
    let target;
    const props = { groups, counts: {}, active: 'command', onSelect: value => { target = value; }, onOpenSettings: () => { target = 'settings'; } };
    let tree = context.WrCommishSidebar(props);
    for (const group of groups) button(tree, group.name);
    button(tree, 'Rules').props.onClick(); assert.equal(target, 'rulelab');
    tree = context.WrCommishSidebar({ ...props, active: target }); button(tree, 'Bylaws & Amendments').props.onClick(); assert.equal(target, 'governance');
    button(tree, '⚙ Settings').props.onClick(); assert.equal(target, 'settings');
});

test('Bylaws and Dues reuse authorized controls while rendering only the selected workflow', () => {
    const props = { leagues: [{ id: 'L1', name: 'Alpha' }], constitutions: {}, amendments: {}, treasuries: {} };
    slots = []; cursor = 0; let tree = context.WrCommishGovernancePanel({ ...props, section: 'bylaws' });
    all(tree, n => n.type === 'div' && n.props.onClick)[0].props.onClick();
    cursor = 0; tree = context.WrCommishGovernancePanel({ ...props, section: 'bylaws' });
    assert.match(text(tree), /Bylaws desk/); assert.doesNotMatch(text(tree), /Treasury — dues bookkeeping/);
    slots = []; cursor = 0; tree = context.WrCommishGovernancePanel({ ...props, section: 'dues' });
    all(tree, n => n.type === 'div' && n.props.onClick)[0].props.onClick();
    cursor = 0; tree = context.WrCommishGovernancePanel({ ...props, section: 'dues' });
    assert.match(text(tree), /Treasury — dues bookkeeping/); assert.doesNotMatch(text(tree), /Bylaws desk/); assert.doesNotMatch(text(tree), /no constitution on file/);
});
console.log('PASS ' + passed + ' portfolio consolidation tests');
