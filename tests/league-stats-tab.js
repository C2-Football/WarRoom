'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), Babel = require('@babel/standalone');
let hooks = [], hookIndex = 0, effects = [], effectDeps = [], blobs = [];
const React = {
    useState(initial) { const i = hookIndex++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], v => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }]; },
    useMemo(fn) { hookIndex++; return fn(); },
    useEffect(fn, deps) { const i = hookIndex++; if (!effectDeps[i] || deps.some((v, n) => v !== effectDeps[i][n])) { effects.push(fn); effectDeps[i] = deps; } },
    createElement(type, props, ...children) { return { type, props: props || {}, children }; }
};
const rows = Array.from({ length: 62 }, (_, i) => ({ pid: String(i), name: i === 0 ? '=Example' : 'Player ' + i, position: i % 2 ? 'WR' : 'QB', team: 'CHI', ownerIds: i < 3 ? ['1'] : [], ownerNames: i < 3 ? ['Owner'] : [], rostered: i < 3, fantasyPoints: 100 - i, gp: 2, raw: { pass_yd: i, pass_cmp: 6, pass_att: 10 } }));
const metrics = [{ key: 'fantasyPoints', label: 'League fantasy points', format: 'dec2' }, { key: 'gp', label: 'Games played', rate: true }, { key: 'raw:pass_yd', label: 'Passing yards', group: 'passing' }, { key: 'catalog:cmpPct', label: 'Completion %', format: 'pct', rate: true, group: 'passing' }];
const engine = {
    load: async () => ({ statsByPid: { 0: {} }, updatedAt: Date.now() }),
    buildRows: () => rows,
    metrics: () => metrics,
    filterMetrics: list => list,
    value: (row, m, opts) => { const v = m.key === 'catalog:cmpPct' ? .6 : m.key.startsWith('raw:') ? row.raw[m.key.slice(4)] : row[m.key]; return opts?.perGame && !m.rate ? v / row.gp : v; },
    PRESETS: { passing: ['raw:pass_yd', 'catalog:cmpPct'] }
};
const context = { React, window: { App: { LeagueStats: engine } }, console, setInterval: () => 1, clearInterval() {}, setTimeout: fn => fn(), URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Blob: class { constructor(parts) { blobs.push(parts.join('')); } }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, createElement: () => ({ click() {} }) } };
vm.createContext(context);
vm.runInContext(Babel.transform(fs.readFileSync(path.join(__dirname, '../js/tabs/stats.js'), 'utf8'), { presets: ['react'] }).code, context);
function walk(node) { return node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node !== 'object' ? [node] : [node, ...walk(node.children)]; }
function text(node) { return walk(node).filter(n => typeof n !== 'object').join(''); }
function find(tree, predicate) { return walk(tree).find(n => typeof n === 'object' && predicate(n)); }
function render() { hookIndex = 0; return context.window.LeagueStatsTab({ currentLeague: { league_id: 'L', season: '2025', rosters: [{ roster_id: 1 }] }, playersData: {}, getOwnerName: () => 'Owner' }); }
(async () => {
    let tree = render(); effects.splice(0).forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); tree = render();
    assert.equal(walk(tree).filter(n => n.type === 'tbody')[0].children[0].length, 50, 'First page includes 50 players');
    find(tree, n => n.type === 'button' && text(n) === 'Next').props.onClick(); tree = render();
    assert(text(tree).includes('51–62 of 62 players'), 'All players reachable after first page');
    find(tree, n => n.type === 'input' && n.props.placeholder?.startsWith('Search players')).props.onChange({ target: { value: '=Example' } }); tree = render();
    assert(text(tree).includes('1 players'), 'Player search applies');
    find(tree, n => n.type === 'select' && n.props['aria-label'] === 'Stat view preset').props.onChange({ target: { value: 'passing' } }); tree = render();
    assert(text(tree).includes('Completion %'), 'Stat preset selects rates');
    find(tree, n => n.type === 'button' && text(n) === 'Export CSV').props.onClick();
    assert(blobs[0].includes("'=Example"), 'CSV treats formula-like names as text');
    assert(blobs[0].includes('"60"'), 'CSV percentage uses human percentage units');
    assert(!blobs[0].includes('Player 1'), 'CSV exports filtered rows');
    find(tree, n => n.type === 'button' && text(n) === 'Stats & game log').props.onClick(); tree = render();
    assert(find(tree, n => n.type === 'aside'), 'Player detail works without global player card');
    console.log('Stats tab render checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
