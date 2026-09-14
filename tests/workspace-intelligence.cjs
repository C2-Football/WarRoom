'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');

const walk = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === 'object' ? [node, ...walk(node.children)] : [node];
const text = node => walk(node).filter(item => typeof item !== 'object').join('');
const find = (node, predicate) => walk(node).find(item => item && typeof item === 'object' && predicate(item));
const gm = { hasStrategy: true, mode: 'compete', modeLabel: 'Compete', targetPositions: new Set(['TE']), sellPositions: new Set(), untouchable: new Set() };
let hooks = [], cursor = 0;
const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment', useMemo: fn => fn(), useCallback: fn => fn, useContext: () => ({}), useEffect: () => {}, useRef: value => ({ current: value }),
    useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }]; },
};
const storage = new Map();
const root = {
    React, App: { LI: { playerScores: { freeTE: 4200, cutPlayer: 800 } }, SeasonContext: {}, posLabel: p => p, normPos: p => p },
    WR: { GmMode: { useGmEffects: () => gm }, useViewport: () => ({ isPhone: false }) },
    S: {}, location: { hash: '' }, wrIsPro: () => true,
    addEventListener() {}, removeEventListener() {},
};
const context = {
    window: root, React, console, setTimeout, clearTimeout,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { getElementById: () => true },
    wrAlpha: value => value,
};
vm.createContext(context);
function load(file) { vm.runInContext(Babel.transform(fs.readFileSync(file, 'utf8'), { presets: ['react'] }).code, context, { filename: file }); }
function render(component, props, fresh = true) { if (fresh) hooks = []; cursor = 0; return component(props); }
const league = { league_id: 'league-one', season: '2026', settings: {}, roster_positions: ['TE'], rosters: [{ roster_id: 1, players: ['cutPlayer'] }] };
const props = { currentLeague: league, myRoster: league.rosters[0], playersData: { freeTE: { position: 'TE', full_name: 'Available TE' }, cutPlayer: { position: 'WR', full_name: 'Marked Cut' } }, standings: [], statsData: {}, stats2025Data: {}, sleeperUserId: 'me', setActiveTab() {} };

load('js/tabs/analytics.js');
const analytics = { ...props, analyticsData: {}, analyticsTab: 'reports', setAnalyticsTab() {} };
for (const [view, expected] of [['roster', 'No roster data'], ['draft', 'Draft'], ['market', 'No trade data']]) {
    const tree = render(context.AnalyticsPanel, { ...analytics, workspaceView: view });
    assert(!find(tree, node => ['wr-module-strip', 'wr-seg'].includes(node.props.className)), 'Workspace owns the analytics navigation');
    assert(text(tree).includes(expected), view + ' selects its own evidence independently of legacy saved analyticsTab');
}
for (const [view, expected] of [['players', 'assets'], ['assets', 'assets'], ['reports', 'reports']]) {
    const tree = render(context.AnalyticsPanel, { ...analytics, workspaceView: view });
    assert.equal(find(tree, node => node.type === root.AnalyticsLeagueEmbed).props.analyticsTab, expected);
}
assert(find(render(context.AnalyticsPanel, analytics), node => node.props.className === 'wr-module-strip'), 'Legacy analytics links retain navigation');

load('js/tabs/alex-insights.js');
let tree = render(root.AlexInsightsTab, { ...props, workspaceView: 'strategy', leagueSkin: { type: 'redraft' } });
assert(find(tree, node => node.type?.name === 'StrategySubview'), 'Explicit Team Plan works in redraft');
assert(!find(tree, node => node.type?.name === 'OverviewView'), 'Team Plan does not silently become another overview');
tree = render(root.AlexInsightsTab, { ...props, workspaceView: 'history' });
assert(find(tree, node => node.type?.name === 'HistoryView'));
find(tree, node => node.type?.name === 'SubTabs').props.onChange('overview');
tree = render(root.AlexInsightsTab, { ...props, workspaceView: 'history' }, false);
assert(find(tree, node => node.type?.name === 'OverviewView'), 'Decision insights remain reachable inside review');
assert(!find(tree, node => node.type?.name === 'HistoryView'), 'Decision review shows one selected view at a time');
tree = render(root.AlexInsightsTab, { ...props, workspaceView: 'settings' }, false);
assert(find(tree, node => node.type?.name === 'SettingsView'), 'Changing workspace ignores previous review selection');

load('js/widgets/gap-plan.js');
const assessment = { rosterId: 1, tier: 'CONTENDER', posAssessment: { TE: { status: 'deficit', minQuality: 2, nflStarters: 1, ideal: 3, actual: 1 } } };
root.assessTeamFromGlobal = () => assessment;
root.assessAllTeamsFromGlobal = () => [assessment];
root._playerTags = { cutPlayer: 'cut' };
let acquisition;
root.WR.openAcquisition = value => { acquisition = value; };
tree = render(root.GapPlanWidget, { ...props, size: 'sm' });
tree.props.onClick({ stopPropagation() {} });
assert.equal(acquisition.position, 'TE');
assert.equal(acquisition.leagueId, 'league-one');
assert.equal(acquisition.source, 'gap-plan');
assert.equal(acquisition.dropPid, 'cutPlayer', 'Only an explicitly tagged cut is carried into the plan');
assert.match(acquisition.reason, /Need 1 more at TE/);
assert.equal(acquisition.pid, undefined, 'A position-level need does not invent an acquisition target');
tree = render(root.GapPlanWidget, { ...props, size: 'lg' });
find(tree, node => node.props.title === 'Plan adding Available TE').props.onClick({ stopPropagation() {} });
assert.equal(acquisition.pid, 'freeTE', 'Known waiver candidate survives the handoff');
assert.equal(acquisition.position, 'TE');
assert.deepEqual(league.rosters[0].players, ['cutPlayer'], 'Planning leaves the roster untouched');

load('js/shared/commish-calendar.js');
root.S.nflState = { season_start_date: '2026-09-10' };
load('js/tabs/calendar.js');
assert.equal(typeof root.CalendarTab, 'function');
tree = render(root.CalendarTab, props);
assert.match(text(tree), /Custom reminders are saved in this browser for this league/);
const calendarLeague = { ...league, draft_id: 'draft-one', settings: { trade_deadline: 10, playoff_week_start: 15, waiver_type: 2, waiver_day_of_week: 0 } };
let events = root.WrCalendar.build(calendarLeague, null, []);
const nowMs = Date.parse('2026-09-01T12:00:00Z');
for (const seasonStartDate of ['2026-09-10', '2026-09-08', null]) {
    const leagueEvents = root.WrCalendar.build(calendarLeague, null, [{ id: 'private', title: 'Personal reminder', date: '2026-10-01' }], { seasonStartDate, nowMs });
    const commissionerEvents = root.App.Commish.Calendar.buildCalendar({ leagues: [calendarLeague], seasonStartDate, nowMs });
    for (const [id, type] of [['trade-deadline', 'deadline'], ['playoffs', 'playoffs']]) {
        const personal = leagueEvents.find(event => event.id === id);
        const official = commissionerEvents.find(event => event.type === type);
        assert.equal(personal.date?.getTime() ?? null, official.ts, id + ' agrees for the same league and season anchor');
        assert.equal(personal.week, official.week);
        assert.equal(personal.estimated, official.approximate, 'Week-derived dates remain approximate on both surfaces');
        assert.equal(personal.tbd, official.ts == null, 'Missing season anchors stay TBD on both surfaces');
    }
    assert.equal(leagueEvents.find(event => event.id === 'season-start').date?.getTime() ?? null, root.App.Commish.Calendar.weekToDate(1, seasonStartDate));
    assert.equal(leagueEvents.find(event => event.id === 'championship').date?.getTime() ?? null, root.App.Commish.Calendar.weekToDate(17, seasonStartDate));
    assert(leagueEvents.find(event => event.id === 'private'));
    assert(!commissionerEvents.find(event => event.id === 'private'), 'Sharing date derivation does not publish personal reminders');
}
assert.equal(events.find(event => event.id === 'trade-deadline').date.getTime(), root.App.Commish.Calendar.buildCalendar({ leagues: [calendarLeague], seasonStartDate: root.S.nflState.season_start_date, nowMs }).find(event => event.type === 'deadline').ts, 'Default league rendering consumes the same NFL state as Commissioner');
for (const settings of [{ ...calendarLeague.settings, type: 3 }, { ...calendarLeague.settings, disable_trades: 1 }]) {
    const noTradeLeague = { ...calendarLeague, settings };
    const leagueEvents = root.WrCalendar.build(noTradeLeague, null, []);
    const commissionerEvents = root.App.Commish.Calendar.buildCalendar({ leagues: [noTradeLeague], seasonStartDate: root.S.nflState.season_start_date, nowMs });
    assert(!leagueEvents.find(event => event.id === 'trade-deadline'), 'League omits irrelevant trade deadlines');
    assert(!commissionerEvents.find(event => event.type === 'deadline'), 'Commissioner omits the same irrelevant trade deadline');
    assert(leagueEvents.find(event => event.id === 'draft'), 'Disabling trading preserves draft information');
    if (settings.disable_trades) assert(commissionerEvents.find(event => event.type === 'playoffs'), 'Disabling trading preserves playoff dates');
}
const pendingDraft = events.find(event => event.id === 'draft');
assert.equal(pendingDraft.date, null, 'Unscheduled drafts have no invented mid-August date');
assert.equal(pendingDraft.tbd, true);
for (const id of ['trade-deadline', 'playoffs', 'championship', 'waivers']) assert.equal(events.find(event => event.id === id).estimated, true, id + ' describes estimated calendar information');
assert.match(events.find(event => event.id === 'waivers').detail, /Sunday/, 'Sunday is a valid league waiver weekday');
events = root.WrCalendar.build({ ...calendarLeague, metadata: { draft_date: '2026-09-20T19:30:00Z' } }, null, []);
assert.equal(events.find(event => event.id === 'draft').date.toISOString(), '2026-09-20T19:30:00.000Z', 'Exact scheduled draft time is retained');
assert(!events.find(event => event.id === 'draft').estimated);
load('js/widgets/league-calendar.js');
let destination;
root.WrCalendar.getUpcoming = () => [pendingDraft];
tree = render(root.LeagueCalendarWidget, { ...props, size: 'sm' });
assert.match(text(tree), /TBD/);
assert.doesNotMatch(text(tree), /Aug 15|Today|Tomorrow/);
root.WrCalendar.getUpcoming = () => [{ title: 'Trade deadline', icon: '🗓️', date: new Date(Date.now() + 86400000) }];
tree = render(root.LeagueCalendarWidget, { ...props, size: 'sm', navigateWidget: value => { destination = value; } });
tree.props.onClick();
assert.equal(destination, 'calendar', 'Upcoming dates open the dedicated calendar');
assert.equal(root._wrTrophyView, undefined, 'Calendar does not leave a hidden Trophy Room override');

context.useState = React.useState;
context.useMemo = React.useMemo;
context.useEffect = React.useEffect;
root.App.LeagueSkin = { build: () => ({ type: 'dynasty' }) };
root.App.getFreeAgencyBriefTarget = () => ({ pid: 'freeTE', name: 'Available TE', pos: 'TE', dhq: 4200, why: 'Adds starter-quality TE depth.' });
root.assessTeamFromGlobal = () => ({ ...assessment, tier: 'REBUILDING', healthScore: 31, needs: ['TE'] });
root.App.WeeklyProj = { optimalForRoster: () => ({ week: 2, delta: { delta: 8, isOptimal: false, startInstead: [{ pid: 'freeTE', pos: 'TE', slot: 'TE' }] } }) };
load('js/tabs/flash-brief.js');
tree = render(root.IntelligenceBriefWidget, { ...props, myRoster: { ...props.myRoster, starters: ['cutPlayer'] }, size: 'xl', rankedTeams: [{ userId: 'me' }], briefDraftInfo: { status: 'pre_draft', start_time: Date.now() + 3600000 } });
const briefText = text(tree);
assert.match(briefText, /Current assessment: Rebuilding/);
assert.match(briefText, /YOUR PLAN/);
assert.match(briefText, /Compete/);
assert.doesNotMatch(briefText, /health score|ranked|pecking order|Rebuilding mode/i, 'Home does not repeat ranks or confuse roster assessment with the chosen plan');
const briefActions = walk(tree).filter(node => node?.type === 'button');
assert.match(text(briefActions[0]), /Draft is today/, 'Immediate draft deadline leads lower-priority market work');
assert.match(text(briefActions[1]), /Trade deadline/, 'Next calendar deadline remains visible');
find(tree, node => node.type === 'button' && text(node).includes('Available TE')).props.onClick();
assert.equal(acquisition.pid, 'freeTE');
assert.equal(acquisition.position, 'TE');
assert.equal(acquisition.source, 'home-briefing');

const tradingLeague = { ...league, rosters: [props.myRoster, { roster_id: 2, owner_id: 'rival', players: ['rivalTE'] }] };
root.assessTeamFromGlobal = rid => Number(rid) === 1 ? { ...assessment, needs: ['TE'], strengths: ['WR'] } : { rosterId: 2, ownerName: 'Complementary Rival', needs: ['WR'], strengths: ['TE'] };
root.WrCalendar.getUpcoming = () => [];
tree = render(root.IntelligenceBriefWidget, { ...props, currentLeague: tradingLeague, size: 'tall' });
assert.match(text(tree), /Complementary Rival looks like your best call/, 'Trading leagues retain concrete trade opportunities');
for (const settings of [{ type: 3 }, { disable_trades: 1 }]) {
    tree = render(root.IntelligenceBriefWidget, { ...props, currentLeague: { ...tradingLeague, settings }, size: 'tall' });
    assert.doesNotMatch(text(tree), /best call|sell rules|Open Deal HQ/, 'Chopped and disabled-trade leagues do not recommend trading');
}

load('js/components/chop-block-panel.js');
const survivor = { rosterId: 1, name: 'My Team', alive: true, chopThisWeekPct: 12, expWeeksLeft: 5.5, survivePct: 40, winPct: 20 };
const survival = { basis: 'projected', simCount: 10000, me: survivor, rows: [survivor, ...Array.from({ length: 17 }, (_, i) => ({ ...survivor, rosterId: i + 2, name: 'Field Team ' + i }))] };
hooks = [{ status: 'ready', sim: survival }];
let leagueOpened = false;
tree = render(root.WrChopBlock, { ...props, active: true, compact: true, onOpenLeague: () => { leagueOpened = true; } }, false);
assert(!find(tree, node => node.type === 'table'), 'Home survival summary does not repeat the full league table');
assert.match(text(tree), /12%/);
assert.match(text(tree), /40%/);
assert.match(text(tree), /20%/);
assert.match(text(tree), /18 teams remain/);
assert.doesNotMatch(text(tree), /Field Team/);
find(tree, node => node.type === 'button' && text(node).includes('Open League')).props.onClick();
assert(leagueOpened, 'Survival summary opens the full League field');
tree = render(root.WrChopBlock, { ...props, active: true }, false);
assert(find(tree, node => node.type === 'table'), 'The full survival view preserves all league rows');
assert.match(text(tree), /Field Team 16/);

console.log('PASS workspace intelligence: isolated views, acquisition continuity, shared agenda dates, format-aware actions, and compact Home survival');
