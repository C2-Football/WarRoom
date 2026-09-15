'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
const walk = n => n == null || typeof n === 'boolean' ? [] : Array.isArray(n) ? n.flatMap(walk) : typeof n === 'object' ? [n, ...walk(n.children)] : [n];
const text = n => walk(n).filter(x => typeof x !== 'object').join('');
const find = (tree, test) => walk(tree).find(n => typeof n === 'object' && test(n));
const all = (tree, test) => walk(tree).filter(n => typeof n === 'object' && test(n));
let slots = [], deps = [], effects = [], index = 0, dirty = true, tree, fullCardCalls = 0, loads = [];
const React = {
    Fragment: 'fragment',
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (next !== slots[i]) { slots[i] = next; dirty = true; } }]; },
    useMemo(fn) { index++; return fn(); },
    useRef(initial) { const i = index++; return slots[i] ||= { current: initial }; },
    useEffect(fn, next) { const i = index++; if (!deps[i] || next.some((v, n) => deps[i][n] !== v)) { deps[i] = next; effects.push(fn); } },
    createElement(type, props, ...children) { if (type === context.LeagueStatsMobileSheet) return props.open ? { type: 'sheet', props, children } : null; return { type, props: props || {}, children }; }
};
const root = { App: {}, setTimeout, clearTimeout, WR: { useViewport: () => ({ isPhone: true, width: 491, height: 900 }), openPlayerCard: () => fullCardCalls++ } };
const context = { window: root, React, console, setInterval: () => 1, clearInterval() {}, setTimeout: fn => fn(), document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } };
vm.createContext(context);
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
    assert(!find(tree, n => n.type === 'table'), 'Mobile defaults to player rows without a duplicated wide table');
    assert.equal(all(tree, n => n.props.className === 'dhs-mobile-player').length, 50);
    assert(search()); assert(!find(tree, n => n.props['aria-label'] === 'Sort players by'), 'Sort stays in Stat view'); assert(!find(tree, n => n.props['aria-label'] === 'Filter by position'), 'Positions stay in Filters without a duplicate strip');
    assert(!sheet()); assert(!labelledSelect('NFL team'), 'Advanced filters stay out of the results flow');
    await click('Next'); assert(text(tree).includes('51–53 of 53'));
    await click('Stat view'); await change(find(sheet(), n => n.props['aria-label'] === 'Sort players by'), 'name');
    assert(text(all(tree, n => n.props.className === 'dhs-mobile-player')[0]).includes('Missing Player'), 'Sort choice applies and resets pagination');
    find(tree, n => n.props['aria-label'] === 'Sort descending').props.onClick(); await flush();
    assert(text(all(tree, n => n.props.className === 'dhs-mobile-player')[0]).includes('Zero Player'), 'Sort direction changes the visible order'); await click('Done', sheet());
    await click('Filters'); assert.equal(sheet().props.title, 'Filter players');
    await change(labelledSelect('Availability', sheet()), 'rostered'); await click('Show 1 players', sheet());
    assert(!sheet()); assert.equal(all(tree, n => n.props.className === 'dhs-mobile-player').length, 1); assert(text(tree).includes('Zero Player'));
    await click('Filters (1)'); await click('Reset filters', sheet()); sheet().props.onClose(); await flush();
    await change(find(tree, n => n.props['aria-label'] === 'Stats period'), '2'); assert.equal(loads.at(-1).week, 2); assert(text(tree).includes('Week 2'));
    await click('Filters'); await change(labelledSelect('Position', sheet()), 'WR'); assert(all(tree, n => n.props.className === 'dhs-mobile-player').every(n => text(n).includes('WR')));
    await change(labelledSelect('Position', sheet()), ''); sheet().props.onClose(); await flush();
    for (const [name, expected] of [['Zero Player', '0.00'], ['Negative Player', '-2.00'], ['Missing Player', '—']]) {
        await change(search(), name); const row = find(tree, n => n.props.className === 'dhs-mobile-player'); assert(row); assert(text(find(row, n => n.props.className === 'dhs-player-score')).includes(expected), name + ' scoring stays distinct');
    }
    await change(search(), 'Zero Player');
    await click('Stat view'); await change(labelledSelect('Display', sheet()), 'game'); await click('Done', sheet());
    const row = find(tree, n => n.props.className === 'dhs-mobile-player'); row.props.onClick(); await flush();
    assert.equal(sheet().props.title, 'Player stats'); assert.equal(fullCardCalls, 0, 'Tapping a result only opens the Stats sheet');
    assert(find(sheet(), n => n.props.className === 'dhs-detail-metrics'), 'Overview is the initial detail');
    await click('Game log', sheet());
    assert(text(sheet()).includes('Weekly totals'));
    const firstWeek = find(sheet(), n => n.type === 'details' && text(n).startsWith('Week 1'));
    assert(text(find(firstWeek, n => n.type === 'summary')).includes('4.00'), 'Game log uses weekly totals even while main view is per game');
    assert(text(sheet()).includes('No stats reported'));
    await click('All stats', sheet());
    await change(find(sheet(), n => n.type === 'input' && n.props.placeholder?.startsWith('Search yards')), 'complet');
    const detailStats = all(sheet(), n => n.props.className === 'dhs-detail-stat'); assert(detailStats.length); assert(detailStats.every(n => /complet/i.test(text(n))), 'Player stat search narrows the full breakdown');
    sheet().props.onClose(); await flush(); assert(!sheet());
    await click('Stat view'); await change(labelledSelect('Layout', sheet()), 'table'); await click('Done', sheet());
    assert(find(tree, n => n.type === 'table'), 'Explicit Table layout exposes full columns');
    assert(!find(tree, n => n.props['aria-label'] === 'Player stats results'), 'Only one results representation renders');
    assert(all(tree, n => n.type === 'th').length > 3, 'Table keeps selected stats beyond the three mobile highlights');
    console.log('PASS mobile Stats: focused results, filtering/scope/sort controls, pagination, sheets, detail views, scoring semantics and optional full table');
})().catch(error => { console.error(error); process.exitCode = 1; });
