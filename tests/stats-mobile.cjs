'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
const walk = n => n == null || typeof n === 'boolean' ? [] : Array.isArray(n) ? n.flatMap(walk) : typeof n === 'object' ? [n, ...walk(n.children)] : [n];
const text = n => walk(n).filter(x => typeof x !== 'object').join('');
const find = (tree, test) => walk(tree).find(n => typeof n === 'object' && test(n));
const all = (tree, test) => walk(tree).filter(n => typeof n === 'object' && test(n));
let slots = [], deps = [], effects = [], cleanups = [], index = 0, dirty = true, tree, fullCardCalls = [], loads = [], aiCalls = [], saves = [], reportSyncs = [];
const React = {
    Fragment: 'fragment',
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (next !== slots[i]) { slots[i] = next; dirty = true; } }]; },
    useMemo(fn) { index++; return fn(); },
    useRef(initial) { const i = index++; return slots[i] ||= { current: initial }; },
    useEffect(fn, next) { const i = index++; if (!deps[i] || next.some((v, n) => deps[i][n] !== v)) { deps[i] = next; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
    createElement(type, props, ...children) { if (type === context.LeagueStatsMobileSheet) return props.open ? { type: 'sheet', props, children } : null; return { type, props: props || {}, children }; }
};
const localReport = { id: 'local', title: 'Device stat report', content: 'Saved local result', kind: 'stats-report' };
const remoteReport = { id: 'remote', title: 'Remote stat report', content: 'Saved result from another device', kind: 'stats-report' };
const root = { App: {}, setTimeout, clearTimeout, WR: { useViewport: () => ({ isPhone: true, width: 491, height: 900 }), openPlayerCard: (pid, options) => fullCardCalls.push({ pid, options }), SavedReports: { save: async (leagueId, report) => { saves.push({ leagueId, report }); }, listLocal: () => [localReport], syncFromServer: async leagueId => { reportSyncs.push(leagueId); return [localReport, remoteReport, { id: 'draft', kind: 'draft-report', title: 'Draft-only report' }]; } } } };
const context = { window: root, React, console, setInterval: () => 1, clearInterval() {}, setTimeout: fn => fn(), document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } };
vm.createContext(context);
const savedStorage = new Map();
root.App.WrStorage = { get: (key, fallback) => savedStorage.has(key) ? savedStorage.get(key) : fallback, set: (key, value) => savedStorage.set(key, value) };
vm.runInContext(fs.readFileSync('js/shared/saved-views.js', 'utf8'), context);
for (const file of ['js/shared/stat-catalog.js', 'js/shared/league-stats.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const playersData = {}, statsByPid = {};
for (let i = 0; i < 53; i++) { const id = 'p' + i; playersData[id] = { full_name: i === 0 ? 'Zero Player' : i === 1 ? 'Negative Player' : i === 2 ? 'Missing Player' : 'Player ' + i, position: i % 2 ? 'QB' : 'WR', team: 'CHI' }; if (i !== 2) statsByPid[id] = { gp: 2, rec: i === 0 || i === 1 ? 0 : i, rec_yd: i * 10, rec_tgt: i + 3, pass_yd: i * 20, pass_att: 10, pass_cmp: 6, fum_lost: i === 1 ? 1 : 0 }; }
root.App.LeagueStats.load = async opts => { loads.push(opts); return { statsByPid, updatedAt: 1000 }; };
root.App.LeagueStats.loadGameLog = async () => [{ week: 1, raw: { gp: 2, rec: 4, rec_yd: 30 }, error: null }, { week: 2, raw: null, error: null }];
root.App.LeagueLiveScores = { currentWeek: () => 2 };
const props = { currentLeague: { league_id: '123', season: 2025, scoring_settings: { rec: 1, fum_lost: -2 }, rosters: [{ roster_id: 1, players: ['p0'] }] }, myRoster: { roster_id: 1 }, playersData, getOwnerName: () => 'Owner' };
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/stats.js', 'utf8'), { presets: ['react'] }).code, context);
async function flush() { for (let n = 0; n < 12; n++) { if (dirty) { index = 0; dirty = false; tree = root.LeagueStatsTab(props); effects.splice(0).forEach(fn => fn()); } await new Promise(resolve => setImmediate(resolve)); if (!dirty) return tree; } throw Error('render did not settle'); }
async function click(label, inTree = tree) { const node = find(inTree, n => n.type === 'button' && text(n) === label); assert(node, 'Button ' + label + ' exists'); assert(!node.props.disabled); node.props.onClick(); return flush(); }
async function change(node, value) { assert(node, 'Input exists'); node.props.onChange({ target: { value } }); return flush(); }
const labelledSelect = (label, inTree = tree) => { const wrapper = find(inTree, n => n.type === 'label' && text(n).startsWith(label)); return find(wrapper, n => n.type === 'select'); };
const sheet = () => find(tree, n => n.type === 'sheet');
const search = () => find(tree, n => n.type === 'input' && n.props.placeholder === 'Search players, teams, positions');
(async () => {
    await flush();
    assert(find(tree, n => n.props['aria-label'] === 'Player stats results'));
    assert(!find(tree, n => n.type === 'table'), 'Mobile defaults to a compact scan table without a duplicated wide ledger');
    assert.equal(all(tree, n => n.props.className === 'mc-research-row').length, 50);
    assert.equal(all(find(tree, n => n.props.className === 'mc-research-heading'), n => n.type === 'button').length, 5, 'Player plus four pinned stats are visible together');
    assert(search()); assert(!find(tree, n => n.props['aria-label'] === 'Sort players by'), 'Sort stays in Stat view'); assert(!find(tree, n => n.props['aria-label'] === 'Filter by position'), 'Positions stay in Filters without a duplicate strip');
    assert(!sheet()); assert(!labelledSelect('NFL team'), 'Advanced filters stay out of the results flow');
    await click('Next'); assert(text(tree).includes('51–53 of 53'));
    await click('Stat view'); await change(find(sheet(), n => n.props['aria-label'] === 'Sort players by'), 'name');
    assert(text(all(tree, n => n.props.className === 'mc-research-row')[0]).includes('Missing Player'), 'Sort choice applies and resets pagination');
    find(tree, n => n.props['aria-label'] === 'Sort descending').props.onClick(); await flush();
    assert(text(all(tree, n => n.props.className === 'mc-research-row')[0]).includes('Zero Player'), 'Sort direction changes the visible order'); await click('Done', sheet());
    await click('Filters'); assert.equal(sheet().props.title, 'Filter players');
    await change(labelledSelect('Availability', sheet()), 'rostered'); await click('Show 1 players', sheet());
    assert(!sheet()); assert.equal(all(tree, n => n.props.className === 'mc-research-row').length, 1); assert(text(tree).includes('Zero Player'));
    await click('Filters (1)'); await click('Reset filters', sheet()); sheet().props.onClose(); await flush();
    await change(find(tree, n => n.props['aria-label'] === 'Stats period'), '2'); assert.equal(loads.at(-1).week, 2); assert(text(tree).includes('Week 2'));
    await click('Filters'); await change(labelledSelect('Position', sheet()), 'WR'); assert(all(tree, n => n.props.className === 'mc-research-row').every(n => text(n).includes('WR')));
    await change(labelledSelect('Position', sheet()), ''); sheet().props.onClose(); await flush();
    for (const [name, expected] of [['Zero Player', '0.00'], ['Negative Player', '-2.00'], ['Missing Player', '—']]) {
        await change(search(), name); const row = find(tree, n => n.props.className === 'mc-research-row'); assert(row); assert(text(find(row, n => n.props.className === 'mc-research-score')).includes(expected), name + ' scoring stays distinct');
    }
    await change(search(), 'Zero Player');
    await click('Stat view'); await change(labelledSelect('Display', sheet()), 'game'); await click('Done', sheet());
    const row = find(tree, n => n.props.className === 'mc-research-row'); row.props.onClick(); await flush();
    assert.equal(fullCardCalls.length, 1, 'Tapping a result opens the normal full player card directly');
    assert.equal(fullCardCalls[0].pid, 'p0'); assert.equal(fullCardCalls[0].options.scoringSettings.fum_lost, -2, 'Player card retains this league’s scoring');
    assert(!sheet(), 'No alternate stats mini-profile opens over the normal player card');
    await click('Stat view');
    await click('Use 3 columns', sheet());
    await click('Done', sheet());
    assert.equal(all(find(tree, n => n.props.className === 'mc-research-heading'), n => n.type === 'button').length, 4, 'Player plus three chosen stats');
    await click('Stat view'); await change(labelledSelect('Layout', sheet()), 'table'); await click('Done', sheet());
    assert(find(tree, n => n.type === 'table'), 'Explicit Table layout exposes full columns');
    assert(!find(tree, n => n.props['aria-label'] === 'Player stats results'), 'Only one results representation renders');
    assert(all(tree, n => n.type === 'th').length > 3, 'Table keeps selected stats beyond the three mobile highlights');
    await click('Stat view');
    const viewBar = find(sheet(), n => n.type === root.WR.SavedViews.SavedViewBar);
    assert(viewBar, 'Research exposes the real saved-view control');
    const saved = root.WR.SavedViews.save(viewBar.props.surface, viewBar.props.leagueId, { name: 'Decision view', ...viewBar.props.currentState });
    assert.equal(root.WR.SavedViews.list('research', '123').length, 1, 'Research is a supported persistence surface');
    assert.equal(saved.sort.dir, -1, 'Descending sort is preserved by the shared store');
    const restored = root.WR.SavedViews.get('research', '123', saved.id);
    await change(labelledSelect('Layout', sheet()), 'dense');
    await change(find(sheet(), n => n.props['aria-label'] === 'Sort players by'), 'fantasyPoints');
    viewBar.props.onApply(restored); await flush();
    assert.equal(labelledSelect('Layout', sheet()).props.value, 'table', 'Saved layout restores');
    assert.equal(find(sheet(), n => n.props['aria-label'] === 'Sort players by').props.value, 'name', 'Saved sort column restores');
    assert(find(tree, n => n.props['aria-label'] === 'Sort ascending'), 'Saved descending order restores');
    assert.equal(restored.filters.scope, 'week'); assert.equal(restored.filters.week, 2, 'Saved period is retained with the metric view');
    await click('Done', sheet());
    await change(search(), '');
    await click('Filters'); await change(labelledSelect('Availability', sheet()), 'rostered'); await click('Show 1 players', sheet());
    await click('Ask AI');
    assert(!find(tree, n => n.props['aria-label'] === 'Player stats results'), 'Ask AI owns its view without a duplicate results ledger');
    assert(text(tree).includes('Using Rostered players'), 'Ask AI shows the exact inherited player scope');
    await click('Clear player filters'); assert(text(tree).includes('Using all players in this league’s stat ledger.'), 'Filters can be cleared directly from Ask AI before a free-agent report');
    assert.equal(reportSyncs.at(-1), '123'); assert(text(tree).includes('Remote stat report'), 'Stats view loads reports saved on other devices through the shared sync API');
    assert(!text(tree).includes('Draft-only report'), 'Only stat reports appear in the Stats hub saved list');
    const plan = { title: 'Scoring report', metrics: ['fantasyPoints', 'raw:pass_yd'], sort: { metric: 'fantasyPoints', direction: 'asc' }, perGame: false, limit: 30, filters: {} };
    let resolveAI;
    root.OD = { callAI: args => { aiCalls.push(args); return new Promise(resolve => { resolveAI = resolve; }); } };
    await change(find(tree, n => n.type === 'textarea'), 'Lowest fantasy point totals');
    find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
    assert(text(tree).includes('Alex is building your report'), 'Pending report has a visible status');
    assert(find(tree, n => n.type === 'button' && text(n) === 'Building…').props.disabled, 'Duplicate request is disabled');
    resolveAI(JSON.stringify(plan)); await flush();
    assert.equal(aiCalls[0].context.leagueId, '123'); assert.equal(aiCalls[0].context.callType, 'stats-report'); assert.equal(aiCalls[0].context.useWebSearch, false);
    assert(aiCalls[0].context.messages[0].content.includes('"period":"Week 2"'), 'Report context uses the selected stats period');
    const report = find(tree, n => n.props['aria-label'] === 'Generated stats report');
    assert(report); assert(text(report).includes('Negative Player')); assert(text(report).includes('-2.00')); assert(text(report).includes('Zero Player'));
    assert(text(report).includes('1 without a reported'), 'Missing ranking data stays unavailable instead of becoming a zero');
    await click('Save report');
    assert.equal(saves.length, 1); assert.equal(saves[0].leagueId, '123'); assert.equal(saves[0].report.kind, 'stats-report'); assert(saves[0].report.content.includes('-2.00'));
    assert(text(tree).includes('Saved ✓'));
    // The report engine executes against every loaded row, beyond the UI page.
    const topPlan = root.WR.StatsReports.parsePlan(JSON.stringify({ ...plan, sort: { metric: 'raw:rec', direction: 'desc' }, metrics: ['raw:rec', 'fantasyPoints'], limit: 1 }), root.App.LeagueStats.metrics(statsByPid));
    const computed = root.WR.StatsReports.run(topPlan, { rows: root.App.LeagueStats.buildRows({ statsByPid, playersData, league: props.currentLeague }), metrics: root.App.LeagueStats.metrics(statsByPid), engine: root.App.LeagueStats, myRosterId: 1 });
    assert.equal(computed.rows[0].pid, 'p52', 'Report ranking uses the full dataset, including players beyond page one');
    assert.throws(() => root.WR.StatsReports.parsePlan('{"metrics":["madeUp"],"sort":{"metric":"madeUp","direction":"desc"}}', root.App.LeagueStats.metrics(statsByPid)), /not available/);
    root.OD.callAI = async () => { throw Error('Sign in to use AI.'); };
    find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
    assert(text(tree).includes('Sign in to use AI.')); assert.equal(find(tree, n => n.type === 'textarea').props.value, 'Lowest fantasy point totals', 'An error keeps the request editable');
    root.OD.callAI = async () => ({ analysis: JSON.stringify(plan) }); await click('Try again'); assert(find(tree, n => n.props['aria-label'] === 'Generated stats report'), 'Retry builds actual results');
    root.OD.callAI = () => new Promise(resolve => { resolveAI = resolve; });
    find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await flush();
    await change(find(tree, n => n.props['aria-label'] === 'Report stats period'), 'season');
    resolveAI(JSON.stringify(plan)); await flush();
    assert(!find(tree, n => n.props['aria-label'] === 'Generated stats report'), 'Late responses cannot appear under a new period');
    root.WR.SavedReports.syncFromServer = async () => { throw Error('network'); };
    await click('All players'); await click('Ask AI');
    assert(text(tree).includes('Saved reports could not sync')); assert(text(tree).includes('Device stat report'), 'Remote sync failure preserves device saves');
    console.log('PASS mobile Stats hub: full player card, complete ledger/filter/scoring behavior, Ask AI report execution, save, retry and stale-period guard');
})().catch(error => { console.error(error); process.exitCode = 1; });
