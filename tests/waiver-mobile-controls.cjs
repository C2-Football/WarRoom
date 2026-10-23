'use strict';
// Exercise the shipped Market selectors and handlers without provider requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const source = fs.readFileSync('js/free-agency.js', 'utf8');
const ast = Babel.packages.parser.parse(source, { plugins: ['jsx'] });
let sortNormalizationEffect, paginationResetEffect;
Babel.packages.traverse.default(ast, { CallExpression(p) {
    if (p.node.callee.name === 'useEffect' && source.slice(p.node.start, p.node.end).includes('metricPreference.selected.find')) sortNormalizationEffect = source.slice(p.node.start, p.node.end);
    if (source.slice(p.node.start, p.node.end).startsWith('React.useEffect') && source.slice(p.node.start, p.node.end).includes('setFaPhoneLimit(25)')) paginationResetEffect = source.slice(p.node.start, p.node.end);
} });
assert.ok(sortNormalizationEffect, 'Missing production visible-column sort normalization');
function declaration(name, kind = 'FunctionDeclaration') {
    let result;
    Babel.packages.traverse.default(ast, { [kind](p) {
        if (p.node.id?.name === name) result = source.slice(kind === 'VariableDeclarator' ? p.parentPath.node.start : p.node.start, kind === 'VariableDeclarator' ? p.parentPath.node.end : p.node.end);
    } });
    assert.ok(result, 'Missing production declaration: ' + name);
    return result;
}
const h = (type, props, ...children) => typeof type === 'function'
    ? type({ ...(props || {}), children })
    : { type, props: props || {}, children: children.flat(Infinity).filter(value => value != null && value !== false) };
const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(walk)] : [];
const text = node => node && typeof node === 'object' ? (node.children || []).map(text).join('') : String(node ?? '');
const plain = value => JSON.parse(JSON.stringify(value));
function button(tree, label) {
    const result = walk(tree).find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label));
    assert.ok(result, 'Missing button: ' + label);
    return result;
}
function fixture(overrides = {}) {
    const mutations = [], captured = [];
    const ctx = vm.createContext({ console, React: { createElement: h, Fragment: 'fragment' }, window: { App: {}, WR: {} },
        useMemo: fn => fn(), useEffect: (effect, deps) => { captured.push({ kind: 'effect', deps }); effect(); }, _faPhone: true,
        currentLeague: { league_id: 'league-a', season: 2026, scoring_settings: { rec: 1, rec_yd: .1 } },
        acquisitionLeagueId: 'league-a', marketSeason: '2026', marketWeek: 3, marketIsCurrent: true,
        faPhoneLimit: 75, faPanel: null, faSearch: '', faFilter: '', rookieOnly: false, rookieTeamFilter: '', rookieCollegeFilter: '', rookieSlotFilter: '',
        ppgWindow: 'season', faSort: { key: 'dhq', dir: -1 }, faActivePresetKey: 'custom', faColPreset: 'custom', showFaColPicker: false,
        visibleFaCols: ['pos','dhq','ppg'], shownFaCols: ['pos','dhq','ppg'],
        statsData: { a: { gp: 2, rec: 4 }, b: { gp: 2, rec: 20 }, z: { gp: 2, rec: 0 }, n: { gp: 2, rec: 0, rec_yd: -60 } },
        prevStatsData: { missing: { gp: 2, rec: 200 } }, priorStatsSeason: 2025,
        availablePlayers: [
            { pid: 'a', pos: 'WR', p: { full_name: 'Alpha', position: 'WR', team: 'SEA', age: 29 }, proj: 2, dhq: 10, matchup: 'A-' },
            { pid: 'b', pos: 'RB', p: { full_name: 'Beta', position: 'RB', team: 'BUF', age: 24 }, proj: 20, dhq: 20, matchup: 'B+' },
            { pid: 'z', pos: 'WR', p: { full_name: 'Zero', position: 'WR', team: 'LV', age: 27 }, proj: 0, dhq: 0, matchup: 'F' },
            { pid: 'n', pos: 'TE', p: { full_name: 'Negative', position: 'TE', team: 'KC', age: 31 }, proj: -1, dhq: -2, matchup: 'A+' },
            { pid: 'missing', pos: 'QB', p: { full_name: 'Missing', position: 'QB', team: 'NYJ' }, proj: null, dhq: null },
        ],
        leaguePositions: ['QB','RB','WR','TE','FLEX'], streamPosSet: new Set(), rookieFilterOptions: { teams: ['SEA'], colleges: ['Example'] },
        normPos: value => value, isRookiePlayer: (_pid, player) => player.age === 24,
        rookieTeamOf: row => row.p.team, rookieCollegeOf: row => row.p.college || '', rookieSlotMatch: () => true, prospectFor: () => null,
        statsSeason: 2026, marketDataVersion: 0, isPro: true, valueShortLabel: 'VALUE', valueLabel: 'Player value', myRoster: {},
        faSigStats: [], faColumns: {}, metricPreference: { key: 'account-a:league-a', selected: ['proj','ppg','dhq','age'], persistent: true }, ...overrides });
    ctx.window.React = ctx.React; ctx.React.useEffect = ctx.useEffect;
    ctx.window.S = { weeklyPlayerPointsLeagueId: 'league-a' };
    ctx.window.App.posLabel = value => value === 'FLEX' ? 'RB / WR / TE' : value;
    ctx.window.App.posMatchesFilter = (position, filter) => filter === 'FLEX' ? ['RB','WR','TE'].includes(position) : position === filter;
    ctx.window.App.WeeklyProj = { weeklyHistory: pid => ({
        a: [{ week: 1, pts: 15 }, { week: 2, pts: 5 }], b: [{ week: 1, pts: 3 }, { week: 2, pts: 1 }],
        z: [{ week: 1, pts: 0 }, { week: 2, pts: 0 }], n: [{ week: 1, pts: -2 }, { week: 2, pts: -4 }],
    })[pid] || [] };
    ctx.window.App.NFLByes = { weekForPlayer: player => ({ SEA: 9, BUF: 5, LV: 6, KC: 14 })[player.team] ?? null };
    for (const file of ['js/shared/league-stats.js','js/shared/fa-market-data.js','js/shared/player-metrics.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    ctx.window.WR.PlayerMetrics.Picker = props => { captured.push({ kind: 'columns', props }); return h('button', { type: 'button', className: 'fixture-columns' }, 'Columns · ' + props.preference.selected.length); };
    ctx.window.WR.FilterPill = props => h('button', { type: 'button', onClick: props.onClick }, props.label, props.value);
    ctx.window.WR.SavedViews = { SavedViewBar: props => { captured.push({ kind: 'saved', props }); return h('saved-view-bar', props); } };
    ctx.metricPreference && (ctx.metricPreference.setSelected = value => { mutations.push('sharedColumns'); ctx.metricPreference.selected = plain(value); });
    const setters = { FaPanel: 'faPanel', FaSearch: 'faSearch', FaFilter: 'faFilter', RookieOnly: 'rookieOnly', RookieTeamFilter: 'rookieTeamFilter', RookieCollegeFilter: 'rookieCollegeFilter', RookieSlotFilter: 'rookieSlotFilter', FaSort: 'faSort', PpgWindow: 'ppgWindow', VisibleFaCols: 'visibleFaCols', FaColPreset: 'faColPreset', ShowFaColPicker: 'showFaColPicker', FaPhoneLimit: 'faPhoneLimit' };
    for (const [suffix, key] of Object.entries(setters)) ctx['set' + suffix] = next => { mutations.push(key); ctx[key] = typeof next === 'function' ? next(ctx[key]) : next; };
    vm.runInContext(source.slice(source.indexOf('    const FA_COLUMNS ='), source.indexOf('    const ROOKIE_DRAFT_LOCK_STATUSES')), ctx);
    vm.runInContext('function faTierCols(cols) { return cols; }', ctx);
    // These are actual production readers, not a parallel copy of their math.
    for (const name of ['marketStatSource','marketPpgRead','mobileMarketValues','defaultFaSortDirection','handleFaSort']) vm.runInContext(declaration(name), ctx);
    vm.runInContext(declaration('compareMarketNumber', 'VariableDeclarator'), ctx);
    vm.runInContext(declaration('compareMarketText', 'VariableDeclarator'), ctx);
    vm.runInContext('faColumns = { ...FA_COLUMNS };', ctx);
    const sortSource = declaration('sortedPlayers', 'VariableDeclarator');
    const controlsStart = source.indexOf('            const _faTogglePanel');
    const controlsEnd = source.indexOf('            // Column picker sheet', controlsStart);
    assert.ok(controlsStart >= 0 && controlsEnd > controlsStart, 'Production controls boundary');
    vm.runInContext(Babel.transform('function renderControls() {\n' + source.slice(controlsStart, controlsEnd) + '\nreturn { panel: _faPanelEl, tools: _faToolsEl, toggle: _faTogglePanel };\n}', { presets: ['react'] }).code, ctx);
    vm.runInContext(declaration('_faMetricSlots', 'VariableDeclarator'), ctx);
    vm.runInContext(Babel.transform('function renderHeader(){'+declaration('_faHeaderColumns','VariableDeclarator')+declaration('_faMarketHeader','VariableDeclarator')+';return _faMarketHeader;}',{presets:['react']}).code,ctx);
    return { ctx, mutations, captured,
        sort(key, dir = -1) { ctx.faSort = { key, dir }; return vm.runInContext('(function(){' + sortSource + ';return sortedPlayers.map(row => row.pid);})()', ctx); },
        values(pid) { return ctx.mobileMarketValues(ctx.availablePlayers.find(row => row.pid === pid)); },
        slots(pid) { ctx.testRow = ctx.availablePlayers.find(row => row.pid === pid); return vm.runInContext('_faMetricSlots(testRow)', ctx); },
        header: () => ctx.renderHeader(),
        resetPagination() { assert(paginationResetEffect); vm.runInContext(paginationResetEffect,ctx); },
        normalizeSort() { vm.runInContext(sortNormalizationEffect, ctx); },
        panel(name) { ctx.faPanel = name; return ctx.renderControls().panel; },
        renderControls: () => ctx.renderControls(),
    };
}

// A seasonal average deliberately inverts the last-five order. The phone sort
// must follow its visible shared metric, regardless of the legacy PPG setting.
{
    const f = fixture();
    assert.deepEqual(plain(f.values('a')), { proj: 2, ppg: 10, dhq: 10, age: 29, season: 2, bye: 9, matchup: 'A-' });
    assert.deepEqual(plain(f.values('z')), { proj: 0, ppg: 0, dhq: 0, age: 27, season: 0, bye: 6, matchup: 'F' });
    assert.deepEqual(plain(f.values('n')), { proj: -1, ppg: -3, dhq: -2, age: 31, season: -3, bye: 14, matchup: 'A+' });
    assert.deepEqual(plain(f.values('missing')), { proj: null, ppg: null, dhq: null, age: null, season: null, bye: null, matchup: null }, 'Prior-year stats never masquerade as current season PPG');
    assert.deepEqual(plain(f.slots('a')).map(({ key, label, value }) => ({ key, label, value })), [
        { key: 'proj', label: 'PROJ', value: '2.0' }, { key: 'ppg', label: 'L5 PPG', value: '10.0' },
        { key: 'dhq', label: 'VALUE', value: '10' }, { key: 'age', label: 'AGE', value: '29' },
    ], 'The production row renderer consumes the same values as the comparator');
    assert.deepEqual(plain(f.slots('z')).map(row => row.value), ['0.0','0.0','0','27']);
    assert.deepEqual(plain(f.slots('missing')).map(row => row.value), ['—','—','—','—']);
    const orders = {
        proj: [['b','a','z','n','missing'], ['n','z','a','b','missing']],
        ppg: [['a','b','z','n','missing'], ['n','z','b','a','missing']],
        dhq: [['b','a','z','n','missing'], ['n','z','a','b','missing']],
        age: [['n','a','z','b','missing'], ['b','z','a','n','missing']],
        season: [['b','a','z','n','missing'], ['n','z','a','b','missing']],
        bye: [['n','a','z','b','missing'], ['b','z','a','n','missing']],
        matchup: [['n','a','b','z','missing'], ['z','b','a','n','missing']],
    };
    for (const [key, [descending, ascending]] of Object.entries(orders)) {
        assert.deepEqual(plain(f.sort(key, -1)), descending, key + ' descending keeps unknown last');
        assert.deepEqual(plain(f.sort(key, 1)), ascending, key + ' ascending keeps unknown last');
    }
    for (const legacyWindow of ['season','l3','l5']) {
        f.ctx.ppgWindow = legacyWindow;
        assert.deepEqual(plain(f.sort('ppg')), orders.ppg[0], 'Phone L5 is independent of legacy ' + legacyWindow);
    }
    f.ctx._faPhone = false; f.ctx.ppgWindow = 'season';
    assert.deepEqual(plain(f.sort('ppg')), ['missing','b','a','z','n'], 'Desktop retains its seasonal/prior-year reader');
}
// Tap the real shared column header into the production sort handler. Sorting
// preserves filtering, flips only that column, and resets the paginated slice.
{
    const f=fixture({faSearch:'a',faFilter:'FLEX',rookieOnly:false});
    const tap=label=>{const header=f.header(),control=walk(header).find(node=>node.type==='button'&&text(node).startsWith(label));assert(control,'Tappable '+label+' header');control.props.onClick({stopPropagation(){}});};
    assert.equal(walk(f.header()).filter(node=>node.type==='button').length,5,'Name and each displayed metric are tappable');
    tap('PROJ');assert.deepEqual(plain(f.ctx.faSort),{key:'proj',dir:-1});assert.deepEqual(plain(f.sort('proj',f.ctx.faSort.dir)),['b','a','n']);
    tap('PROJ');assert.deepEqual(plain(f.ctx.faSort),{key:'proj',dir:1});assert.deepEqual(plain(f.sort('proj',f.ctx.faSort.dir)),['n','a','b']);
    assert.deepEqual([f.ctx.faSearch,f.ctx.faFilter,f.ctx.rookieOnly],['a','FLEX',false],'Column sorting retains the current filters');
    tap('Player');assert.deepEqual(plain(f.ctx.faSort),{key:'name',dir:1});tap('Player');assert.deepEqual(plain(f.ctx.faSort),{key:'name',dir:-1});
    tap('AGE');assert.deepEqual(plain(f.ctx.faSort),{key:'age',dir:1},'A newly selected age header starts youngest first');
    f.ctx.faPhoneLimit=75;f.resetPagination();assert.equal(f.ctx.faPhoneLimit,25);assert(f.captured.at(-1).deps.includes(f.ctx.faSort),'The production pagination reset reacts to the same sort state');
    f.ctx.metricPreference.setSelected(['bye','season','matchup']);tap('BYE');assert.deepEqual(plain(f.ctx.faSort),{key:'bye',dir:1});
    tap('MATCH');assert.deepEqual(plain(f.ctx.faSort),{key:'matchup',dir:-1},'A new matchup sort starts with the strongest grade');
    f.ctx.isPro=false;assert.equal(f.values('a').matchup,null);assert(f.slots('a').find(slot=>slot.key==='matchup').value==='—','The free row never reveals a matchup grade through sorting');
    assert.deepEqual(plain(f.sort('matchup',-1)),['a','b','n'],'A gated grade cannot reorder filtered free rows');
}
// Display formatting must never become the sort input. Unknown names and
// numeric data stay last in either direction, including legacy desktop reads.
{
    const f=fixture();f.ctx.availablePlayers[0].dhq=1200;f.ctx.availablePlayers[1].dhq=950;
    assert.equal(f.slots('a').find(slot=>slot.key==='dhq').value,'1,200');
    assert.deepEqual(plain(f.sort('dhq',-1)),['a','b','z','n','missing'],'The raw 1200 value sorts above 950 despite comma formatting');
    f.ctx.availablePlayers[4].p.full_name='';assert.deepEqual(plain(f.sort('name',1)),['a','b','n','z','missing']);assert.deepEqual(plain(f.sort('name',-1)),['z','n','b','a','missing']);
    f.ctx._faPhone=false;
    assert.deepEqual(plain(f.sort('age',1)),['b','z','a','n','missing']);assert.deepEqual(plain(f.sort('age',-1)),['n','a','z','b','missing']);
    Object.assign(f.ctx.availablePlayers[0].p,{height:'73',weight:'250',college:'Alpha'});Object.assign(f.ctx.availablePlayers[1].p,{height:'70',weight:'99',college:'Beta'});
    for(const key of ['height','weight']){assert.deepEqual(plain(f.sort(key,1)),['b','a','z','n','missing']);assert.deepEqual(plain(f.sort(key,-1)),['a','b','z','n','missing']);}
    assert.deepEqual(plain(f.sort('college',1)),['a','b','z','n','missing']);assert.deepEqual(plain(f.sort('college',-1)),['b','a','z','n','missing']);
    const legacy=fixture({metricPreference:null});legacy.ctx._faSlotKeys=['dhq','faab','age'];
    const legacyHeading=legacy.header();assert.equal(walk(legacyHeading).filter(node=>node.type==='button').length,3,'A suggested bid range remains a static legacy label rather than an ineffective sort button');
}
// History from another league or an old season must not supply a plausible L5.
{
    const f = fixture();
    f.ctx.window.S.weeklyPlayerPointsLeagueId = 'league-b';
    assert.equal(f.values('a').ppg, null);
    assert.equal(f.slots('a')[1].value, '—');
    f.ctx.window.S.weeklyPlayerPointsLeagueId = 'league-a'; f.ctx.marketIsCurrent = false;
    assert.equal(f.values('a').ppg, null);
    f.ctx.marketIsCurrent = true; f.ctx.marketWeek = 8;
    f.ctx.window.App.WeeklyProj.weeklyHistory = () => [
        { week: 1, pts: 999 }, { week: 2, pts: 0 }, { week: 3, pts: -5 },
        { week: 4, pts: 10 }, { week: 5, pts: 15 }, { week: 6, pts: 20 },
        { week: 7, pts: 25 }, { week: 8, pts: 1000 }, { week: 9, pts: 2000 },
        { week: 7, pts: null },
    ];
    assert.equal(f.values('a').ppg, 13, 'Exactly the last five reported prior weeks contribute; zero/negative count and current/future/missing do not');
    Object.assign(f.ctx.availablePlayers[0], { proj: NaN, dhq: Infinity });
    f.ctx.availablePlayers[0].p.age = '29';
    assert.equal(f.values('a').proj, null); assert.equal(f.values('a').dhq, null); assert.equal(f.values('a').age, null);
}
// Filter actions operate on the shipped state setters, including flex-group
// semantics and rookie drilldowns. Clearing filters cannot reset presentation.
{
    const f = fixture({ faSearch: 'sea', faFilter: 'WR', rookieOnly: true, rookieTeamFilter: 'SEA', rookieCollegeFilter: 'Example', rookieSlotFilter: '1', ppgWindow: 'l3', faSort: { key: 'age', dir: 1 } });
    let panel = f.panel('filters');
    assert.equal(walk(panel).filter(node => node.type === 'input').length, 0, 'Search appears outside the filter panel only');
    assert.equal(button(panel, 'WR').props['aria-pressed'], true);
    button(panel, 'RB / WR / TE').props.onClick();
    assert.equal(f.ctx.faFilter, 'FLEX');
    f.ctx.faSearch = ''; f.ctx.rookieOnly = false;
    assert.deepEqual(plain(f.sort('name', 1)), ['a','b','n','z'], 'FLEX includes RB/WR/TE and excludes QB');
    panel = f.panel('filters'); button(panel, 'Rookies / UDFAs').props.onClick();
    assert.equal(f.ctx.rookieOnly, true);
    panel = f.panel('filters');
    const select = label => walk(panel).find(node => node.type === 'select' && node.props['aria-label'] === label);
    select('Rookie NFL team').props.onChange({ target: { value: 'BUF' } });
    select('Rookie college').props.onChange({ target: { value: 'School B' } });
    select('Rookie draft round').props.onChange({ target: { value: 'UDFA' } });
    assert.deepEqual([f.ctx.rookieTeamFilter,f.ctx.rookieCollegeFilter,f.ctx.rookieSlotFilter], ['BUF','School B','UDFA']);
    button(panel, 'Rookies / UDFAs · On').props.onClick();
    assert.equal(f.ctx.rookieOnly, false);
    assert.deepEqual([f.ctx.rookieTeamFilter,f.ctx.rookieCollegeFilter,f.ctx.rookieSlotFilter], ['','','']);
    Object.assign(f.ctx, { faSearch: 'Alpha', faFilter: 'WR', rookieOnly: true, rookieTeamFilter: 'SEA', rookieCollegeFilter: 'Example', rookieSlotFilter: '1' });
    const before = { sort: plain(f.ctx.faSort), columns: plain(f.ctx.visibleFaCols), shared: plain(f.ctx.metricPreference.selected), preset: f.ctx.faColPreset, ppg: f.ctx.ppgWindow };
    f.mutations.length = 0; button(f.panel('filters'), 'Clear filters').props.onClick();
    assert.deepEqual([f.ctx.faSearch,f.ctx.faFilter,f.ctx.rookieOnly,f.ctx.rookieTeamFilter,f.ctx.rookieCollegeFilter,f.ctx.rookieSlotFilter], ['','',false,'','','']);
    assert.deepEqual({ sort: plain(f.ctx.faSort), columns: plain(f.ctx.visibleFaCols), shared: plain(f.ctx.metricPreference.selected), preset: f.ctx.faColPreset, ppg: f.ctx.ppgWindow }, before);
    assert.deepEqual(f.mutations, ['faSearch','faFilter','rookieOnly','rookieTeamFilter','rookieCollegeFilter','rookieSlotFilter']);
    button(f.panel('filters'), 'Done').props.onClick(); assert.equal(f.ctx.faPanel, null);
}
// There is one search and one shared Columns trigger. Filters and sorting keep
// compact, truthful summaries and their real toolbar handlers toggle panels.
{
    const f = fixture();
    let rendered = f.renderControls();
    const searches = walk(rendered.tools).filter(node => node.type === 'input' && node.props.type === 'search');
    assert.equal(searches.length, 1); assert.equal(searches[0].props['aria-label'], 'Search available players');
    searches[0].props.onChange({ target: { value: 'BUF' } }); assert.equal(f.ctx.faSearch, 'BUF');
    assert.equal(walk(rendered.tools).filter(node => node.props.className === 'fixture-columns').length, 1);
    assert.equal(f.captured.filter(item => item.kind === 'columns').at(-1).props.preference, f.ctx.metricPreference);
    button(rendered.tools, 'FiltersAll').props.onClick(); assert.equal(f.ctx.faPanel, 'filters');
    assert.equal(button(f.renderControls().tools, 'FiltersAll').props['aria-expanded'], true);
    button(f.renderControls().tools, 'FiltersAll').props.onClick(); assert.equal(f.ctx.faPanel, null);
    button(f.renderControls().tools, 'SortVALUE ↓').props.onClick(); assert.equal(f.ctx.faPanel, 'sort');
    let panel = f.panel('sort');
    const picker = walk(panel).find(node => node.type === 'select');
    assert.deepEqual(walk(picker).filter(node => node.type === 'option').map(node => node.props.value), ['name','proj','ppg','dhq','age'], 'Sorting offers only visible shared columns and player name');
    assert(!text(panel).includes('PPG window'), 'Shared L5 does not offer a hidden legacy PPG setting');
    picker.props.onChange({ target: { value: 'name' } }); assert.deepEqual(plain(f.ctx.faSort), { key: 'name', dir: 1 });
    button(f.panel('sort'), 'Reverse player sort order').props.onClick(); assert.deepEqual(plain(f.ctx.faSort), { key: 'name', dir: -1 });
    walk(f.panel('sort')).find(node => node.type === 'select').props.onChange({ target: { value: 'name' } });
    assert.equal(f.ctx.faSort.dir, -1, 'Choosing the same metric retains direction');
    walk(f.panel('sort')).find(node => node.type === 'select').props.onChange({ target: { value: 'ppg' } });
    assert.deepEqual(plain(f.ctx.faSort), { key: 'ppg', dir: -1 });
    assert(button(f.renderControls().tools, 'SortL5 PPG ↓'));
    button(f.panel('sort'), 'Saved filters & sort →').props.onClick(); assert.equal(f.ctx.faPanel, 'view');
    assert.equal(button(f.renderControls().tools, 'SortL5 PPG ↓').props['aria-expanded'], true, 'Saved filters remain inside the Sort flow');
    button(f.panel('view'), 'Done').props.onClick(); assert.equal(f.ctx.faPanel, null);
}
// Applying a saved phone view restores only supported filters and sorting. A
// legacy columns payload must not mutate the shared account/league preference.
{
    const f = fixture({ faFilter: 'WR', faSearch: 'Alpha', rookieOnly: true, rookieTeamFilter: 'SEA', rookieCollegeFilter: 'Example', rookieSlotFilter: '1' });
    const panel = f.panel('view'), saved = f.captured.filter(item => item.kind === 'saved').at(-1).props;
    assert(!walk(panel).some(node => node.type === 'select'), 'The shared phone view has no competing legacy preset');
    assert(!text(panel).includes('Customize'));
    assert.equal(saved.surface, 'free_agency'); assert.equal(saved.leagueId, 'league-a');
    assert.deepEqual(plain(saved.currentState), { columns: [], sort: { key: 'dhq', dir: -1 }, filters: { faFilter: 'WR', faSearch: 'Alpha', rookieOnly: true, rookieTeamFilter: 'SEA', rookieCollegeFilter: 'Example', rookieSlotFilter: '1' } });
    saved.onApply({ columns: ['college','ht'], sort: { key: 'age', dir: 1 }, filters: { faFilter: 'FLEX', faSearch: 'Beta', rookieOnly: true, rookieTeamFilter: 'BUF', rookieCollegeFilter: 'School B', rookieSlotFilter: 'UDFA' } });
    assert.deepEqual(plain(f.ctx.faSort), { key: 'age', dir: 1 });
    assert.deepEqual([f.ctx.faFilter,f.ctx.faSearch,f.ctx.rookieOnly,f.ctx.rookieTeamFilter,f.ctx.rookieCollegeFilter,f.ctx.rookieSlotFilter], ['FLEX','Beta',true,'BUF','School B','UDFA']);
    assert.deepEqual(plain(f.ctx.metricPreference.selected), ['proj','ppg','dhq','age']);
    assert(!f.mutations.some(key => ['visibleFaCols','faColPreset','ppgWindow','sharedColumns'].includes(key)));
    saved.onApply({ sort: { key: 'college', dir: -1 }, filters: { faFilter: '', faSearch: '', rookieOnly: false, rookieTeamFilter: 'SEA', rookieCollegeFilter: 'Example', rookieSlotFilter: '1' } });
    assert.deepEqual(plain(f.ctx.faSort), { key: 'dhq', dir: -1 }, 'Unsupported legacy sort keys cannot create an ineffective phone sort');
    saved.onApply({ sort: { key: 'season', dir: 1 } });
    assert.deepEqual(plain(f.ctx.faSort), { key: 'dhq', dir: 1 }, 'An otherwise supported but hidden saved metric falls back to visible value');
    assert.deepEqual([f.ctx.rookieOnly,f.ctx.rookieTeamFilter,f.ctx.rookieCollegeFilter,f.ctx.rookieSlotFilter], [false,'','','']);
    const fallback = fixture({ metricPreference: null });
    assert(walk(fallback.panel('view')).some(node => node.type === 'select' && node.props['aria-label'] === 'Market column preset'), 'Older runtimes retain the legacy column controls');
    assert(text(fallback.panel('sort')).includes('PPG window'));
}
// Changing shared columns invalidates a removed sort. Exercise the actual hook
// and capture its dependencies, rather than maintaining a duplicate fallback.
{
    const f = fixture({ faSort: { key: 'ppg', dir: 1 } });
    f.normalizeSort(); assert.deepEqual(plain(f.ctx.faSort), { key: 'ppg', dir: 1 });
    const oldSelectionDependency = f.captured.filter(item => item.kind === 'effect').at(-1).deps[1];
    f.ctx.metricPreference.setSelected(['season','bye','age']); f.normalizeSort();
    assert.deepEqual(plain(f.ctx.faSort), { key: 'season', dir: -1 }, 'Removing the sorted metric selects a currently visible numeric metric');
    const newSelectionDependency = f.captured.filter(item => item.kind === 'effect').at(-1).deps[1];
    assert.notEqual(newSelectionDependency, oldSelectionDependency, 'Column selection changes are tracked by the production effect');
    assert.deepEqual(walk(f.panel('sort')).filter(node => node.type === 'option').map(node => node.props.value), ['name','age','season','bye']);
    assert(button(f.renderControls().tools, 'SortSZN PPG ↓'));
    f.panel('view'); const saved = f.captured.filter(item => item.kind === 'saved').at(-1).props;
    saved.onApply({ sort: { key: 'season', dir: 1 } });
    assert.deepEqual(plain(f.ctx.faSort), { key: 'season', dir: 1 }, 'A selected alternate metric remains a valid saved sort');
    saved.onApply({ sort: { key: 'dhq', dir: -1 } });
    assert.deepEqual(plain(f.ctx.faSort), { key: 'name', dir: -1 }, 'A hidden saved value sort uses the first available option when value is absent');
    f.ctx.faSort = { key: 'name', dir: 1 }; f.normalizeSort();
    assert.deepEqual(plain(f.ctx.faSort), { key: 'name', dir: 1 }, 'Player name stays supported regardless of columns');
    f.ctx.faSort = { key: 'season', dir: 1 }; f.ctx.metricPreference.setSelected(['proj','dhq','age']); f.normalizeSort();
    assert.deepEqual(plain(f.ctx.faSort), { key: 'dhq', dir: -1 }, 'Visible value is preferred after removing the active metric');
    f.ctx._faPhone = false; f.ctx.faSort = { key: 'college', dir: 1 }; f.normalizeSort();
    assert.deepEqual(plain(f.ctx.faSort), { key: 'college', dir: 1 }, 'Phone normalization cannot rewrite desktop sorts');
    f.ctx._faPhone = true; f.ctx.metricPreference = null; f.normalizeSort();
    assert.deepEqual(plain(f.ctx.faSort), { key: 'college', dir: 1 }, 'Legacy runtimes retain their own sort capabilities');
}
console.log('PASS mobile waiver controls: shared displayed/sorted values, scoped last-five history, zero/negative/unknown values, filter handlers and safe clearing, one Columns/search system, sorting and saved-view application');
