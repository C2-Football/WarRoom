'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const source = babel.transform(fs.readFileSync('js/tabs/lineup.js', 'utf8'), { presets: ['react'] }).code;

// Render the real mobile branch with state/effects, so navigation and lock
// behavior are checked alongside score provenance and absent projections.
async function fixture({ upcoming = false, matchupId = 7, width = 390 } = {}) {
    const state = [], deps = [], pending = [];
    let cursor = 0, effectCursor = 0, changed = true, out;
    const h = (type, props, ...children) => typeof type === 'function'
        ? type({ ...(props || {}), children }) : { type, props: props || {}, children: children.flat(Infinity).filter(x => x != null && x !== false) };
    const React = {
        createElement: h, Fragment: 'fragment',
        useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
            return [state[index], update => { const next = typeof update === 'function' ? update(state[index]) : update; if (next !== state[index]) { state[index] = next; changed = true; } }];
        },
        useMemo: fn => fn(), useCallback: fn => fn,
        useEffect(fn, next = []) {
            const index = effectCursor++;
            if (!deps[index] || next.some((x, i) => x !== deps[index][i])) { deps[index] = next; pending.push(fn); }
        },
    };
    const projection = points => ({ available: true, points: { median: points, floor: points, ceiling: points }, matchupGrade: 'B' });
    const result = { week: 2, objective: 'median', mode: 'balanced', projections: { a: projection(0), b: projection(-2.5), c: { available: false, points: { median: 100, floor: 100, ceiling: 100 } }, d: projection(12) }, optimal: { total: 20, starters: [{ slot: 'QB', pid: 'a' }, { slot: 'RB', pid: 'b' }, { slot: 'WR', pid: 'c' }] } };
    const games = ['KC', 'BUF', 'ATL', 'NYJ'].map(team => ({ home: team, away: 'MIA', state: upcoming ? 'upcoming' : 'final', kickoff: new Date(Date.now() + 86400000).toISOString() }));
    const ctx = {
        React, console, setInterval: () => 1, clearInterval() {},
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        window: {
            S: { nflState: { season: 2026 } },
            WR: {
                useViewport: () => ({ width, isPhone: width < 768 }), HeroCard: true, AssetRow: true, CardList: true,
                Sheet: ({ open, children }) => open ? h('dialog', {}, children) : null,
                ActionBar: ({ visible, ...props }) => visible ? h('actionbar', props) : null,
            },
            App: {
                WeeklyProj: { optimalForRoster: () => result, formStats: pid => pid === 'c' ? null : { rollingPPG: pid === 'a' ? 0 : -2.5, high: 0, low: -2.5, games: 2, recentCount: 2 } },
                StartSit: { normSlot: s => s, FLEX_ALLOWED: {}, BASE_POSITIONS: new Set(['QB', 'RB', 'WR']) },
                NflContext: { loadScores: async () => games, gameStatus: game => game?.state || 'unknown' },
                LeagueLiveScores: {
                    currentWeek: () => 2,
                    useScores: () => ({ supported: true, status: 'ready', updatedAt: 1789484400000, rows: [
                        { roster_id: 1, matchup_id: matchupId, starters: ['a', 'b', 'c'], players_points: { a: 0, b: -2.5 }, points: -2.5 },
                        { roster_id: 2, matchup_id: matchupId, starters: ['d'], points: 0 },
                    ] }),
                    rosterPoints: row => row.points,
                    playerPoints: (row, pid) => typeof row.players_points[pid] === 'number' ? row.players_points[pid] : null,
                },
            },
        },
    };
    vm.createContext(ctx); vm.runInContext(source, ctx);
    const props = {
        myRoster: { roster_id: 1, starters: ['a', 'b', 'c'], players: ['a', 'b', 'c', 'd'] },
        currentLeague: { league_id: '123', season: 2026, roster_positions: ['QB', 'RB', 'WR'], rosters: [{ roster_id: 2, owner_id: 'owner2' }], users: [{ user_id: 'owner2', display_name: 'Opponent Name' }] },
        playersData: { a: { full_name: 'Zero Starter', team: 'KC', position: 'QB' }, b: { full_name: 'Negative Starter', team: 'BUF', position: 'RB' }, c: { full_name: 'Missing Starter', team: 'ATL', position: 'WR' }, d: { full_name: 'Bench Option', team: 'NYJ', position: 'QB' } },
    };
    async function render() {
        for (let cycle = 0; cycle < 12; cycle++) {
            changed = false; cursor = 0; effectCursor = 0;
            out = ctx.LineupTab(props);
            pending.splice(0).forEach(fn => fn());
            await Promise.resolve(); await Promise.resolve();
            if (!changed) return out;
        }
        throw Error('Render did not settle');
    }
    await render();
    return { get out() { return out; }, render };
}
const all = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(all)] : [];
const textOf = node => node == null ? '' : typeof node === 'object' ? (node.children || []).map(textOf).join('') : String(node);
const select = (out, predicate) => all(out).find(predicate);
const button = (out, label) => select(out, n => n.type === 'button' && textOf(n) === label);

(async () => {
    const active = await fixture();
    const board = select(active.out, n => n.props.className === 'gd-scoreboard');
    assert.match(textOf(board), /Week 2/);
    assert.match(textOf(board), /Opponent Name/);
    assert.match(textOf(board), /-2\.50/);
    assert.match(textOf(board), /0\.00/);
    assert.equal(all(active.out).filter(n => n.props.className === 'gd-score-player').length, 3);
    assert.equal(select(active.out, n => n.props.className === 'gd-working-lineup'), undefined, 'working lineup must not duplicate the submitted list by default');
    const scoredRows = all(active.out).filter(n => n.props.className === 'gd-score-player');
    assert.match(textOf(scoredRows[0]), /Zero Starter.*0\.00/);
    assert.match(textOf(scoredRows[1]), /Negative Starter.*-2\.50/);
    assert.match(textOf(scoredRows[2]), /Missing Starter.*—/);
    assert(scoredRows.every(n => n.type === 'details' && !n.props.open), 'saved projections and lock details start collapsed');
    assert(select(active.out, n => n.type === 'details' && textOf(n).includes('Scoring & lineup rules')));
    button(active.out, 'My plan').props.onClick(); await active.render();
    const plan = select(active.out, n => n.props.className === 'gd-working-lineup');
    assert(plan); assert.match(textOf(plan), /partial/);
    const missingRow = select(plan, n => n.type === 'button' && textOf(n).includes('Missing Starter'));
    assert.match(textOf(missingRow), /—Proj/); assert.doesNotMatch(textOf(missingRow), /100/);
    const starter = select(plan, n => n.type === 'button' && textOf(n).includes('Zero Starter'));
    assert.match(textOf(starter), /0\.0Proj0\.0L5 PPG/, 'projection and zero PPG are visible without opening the player');
    assert.match(textOf(missingRow), /—Proj—L5 PPG/, 'missing PPG stays unavailable');
    const negativeRow = select(plan, n => n.type === 'button' && textOf(n).includes('Negative Starter'));
    assert.match(textOf(negativeRow), /-2\.5Proj-2\.5L5 PPG/, 'negative PPG is preserved');
    starter.props.onClick(); await active.render();
    assert.equal(button(active.out, 'Empty this slot').props.disabled, true, 'started player must remain locked');
    assert(!all(active.out).some(n => n.type === 'button' && textOf(n).includes('Bench Option')), 'started-game picker cannot propose replacements');

    const pregame = await fixture({ upcoming: true });
    assert(select(pregame.out, n => n.props.className === 'gd-planning-focus'), 'verified pregame view leads with planning guidance');
    assert.equal(all(pregame.out).filter(n => n.props.className === 'gd-primary').length, 1, 'only one primary planning action');
    const scoreDetails = select(pregame.out, n => n.type === 'details' && textOf(n).startsWith('Submitted matchup score'));
    assert(scoreDetails && !scoreDetails.props.open, 'pregame actual scoring remains available on demand');

    const bye = await fixture({ matchupId: null });
    assert.doesNotMatch(textOf(select(bye.out, n => n.props.className === 'gd-scoreboard')), /Opponent Name/, 'unmatched bye rows must never be paired');
    const tablet = await fixture({ width: 768 });
    assert.equal(select(tablet.out, n => n.props.className === 'gd-mobile'), undefined, 'phone branch ends before tablet');
    console.log('PASS Game Day mobile: score provenance, missing and signed points, disclosures, local plan navigation, kickoff locks, pregame priority, bye isolation, tablet boundary');
})().catch(error => { console.error(error); process.exitCode = 1; });
