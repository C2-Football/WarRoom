'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const source = babel.transform(fs.readFileSync('js/tabs/lineup.js', 'utf8'), { presets: ['react'] }).code;

// Render the real mobile branch with state/effects, so navigation and lock
// behavior are checked alongside score provenance and absent projections.
async function fixture({ upcoming = false, matchupId = 7, width = 390, rosterView = false, noProjection = false, supported = true, stale = false, withMatchup = false, pro = true } = {}) {
    const state = [], deps = [], pending = [];
    const events = {};
    const loadedForm = {};
    let cursor = 0, effectCursor = 0, changed = true, out, refresh;
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
        React, console, setInterval: fn => { refresh = fn; return 1; }, clearInterval() {},
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        window: {
            addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener() {},
            wrIsPro: () => pro,
            S: { nflState: { season: 2026 } },
            WR: {
                useViewport: () => ({ width, isPhone: width < 768 }), HeroCard: true, AssetRow: true, CardList: true,
                Sheet: ({ open, children }) => open ? h('dialog', {}, children) : null,
                ActionBar: ({ visible, ...props }) => visible ? h('actionbar', props) : null,
            },
            App: {
                WeeklyProj: { optimalForRoster: () => noProjection ? null : result, formStats: (pid, win) => typeof loadedForm[pid] === 'function' ? loadedForm[pid](win) : loadedForm[pid] || (pid === 'c' ? null : { rollingPPG: pid === 'a' ? 0 : -2.5, high: 0, low: -2.5, games: 2, recentCount: 2 }) },
                StartSit: { normSlot: s => s, FLEX_ALLOWED: {}, BASE_POSITIONS: new Set(['QB', 'RB', 'WR']) },
                NflContext: { loadScores: async () => stale ? [] : games, gameStatus: game => game?.state || 'unknown' },
                LeagueLiveScores: {
                    currentWeek: () => 2,
                    useScores: () => ({ supported, status: 'ready', updatedAt: 1789484400000, rows: [
                        { roster_id: 1, matchup_id: matchupId, starters: ['a', 'b', 'c'], players_points: { a: 0, b: -2.5 }, points: upcoming ? 0 : -2.5 },
                        { roster_id: 2, matchup_id: matchupId, starters: ['d'], points: 0 },
                    ] }),
                    rosterPoints: row => row.points,
                    playerPoints: (row, pid) => typeof row.players_points[pid] === 'number' ? row.players_points[pid] : null,
                },
            },
        },
    };
    vm.createContext(ctx);
    delete ctx.window.App.StartSit;
    vm.runInContext(fs.readFileSync('js/shared/startsit-engine.js', 'utf8'), ctx);
    if (withMatchup) {
        vm.runInContext(fs.readFileSync('js/shared/matchup.js', 'utf8'), ctx);
        ctx.window.App.Matchup.resolveOpponentRosterId = async () => 2;
    }
    vm.runInContext(source, ctx);
    const props = {
        rosterView,
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
    return { get out() { return out; }, render, games, props, result, async loadForm(pid, value) { loadedForm[pid] = value; events['wr:weekly-points-loaded']({ detail: { leagueId: '123' } }); await render(); }, async kickoff(team) { games.find(g => g.home === team).state = 'live'; await refresh(); await render(); } };
}
const all = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(all)] : [];
const textOf = node => node == null ? '' : typeof node === 'object' ? (node.children || []).map(textOf).join('') : String(node);
const select = (out, predicate) => all(out).find(predicate);
const button = (out, label) => select(out, n => n.type === 'button' && textOf(n) === label);

(async () => {
    const active = await fixture();
    assert.equal(all(active.out).filter(n => n.props.className === 'gd-scoreboard').length, 1, 'one scoreboard in the existing lineup');
    assert.doesNotMatch(textOf(active.out), /FOLLOW YOUR LINEUP|Submitted starters/);
    const plan = select(active.out, n => n.props.className === 'gd-working-lineup');
    assert(plan); assert.match(textOf(plan), /partial/);
    assert(select(plan, n => n.props.className === 'gd-scoreboard'), 'live scores stay inside starting lineup');
    assert.match(textOf(plan), /Final · 0.00 pts · Locked/);
    assert.match(textOf(plan), /Final · -2.50 pts · Locked/);
    const missingRow = select(plan, n => n.type === 'button' && textOf(n).includes('Missing Starter'));
    assert.match(textOf(missingRow), /—Proj—L5 PPG/);
    const starter = select(plan, n => n.type === 'button' && textOf(n).includes('Zero Starter'));
    assert.match(textOf(starter), /0\.0Proj0\.0L5 PPG/, 'projection and zero PPG are visible without opening the player');
    assert.match(textOf(missingRow), /—Proj—L5 PPG/, 'missing PPG stays unavailable');
    const negativeRow = select(plan, n => n.type === 'button' && textOf(n).includes('Negative Starter'));
    assert.match(textOf(negativeRow), /-2\.5Proj-2\.5L5 PPG/, 'negative PPG is preserved');
    starter.props.onClick(); await active.render();
    assert.equal(button(active.out, 'Empty this slot').props.disabled, true);
    assert(!all(active.out).some(n => n.type === 'button' && textOf(n).includes('Bench Option')));

    const roster = await fixture({ rosterView: true });
    const board = select(roster.out, n => n.props.className === 'gd-scoreboard');
    assert.match(textOf(board), /Week 2.*Opponent Name/);
    assert.match(textOf(board), /-2\.50/);
    assert.match(textOf(board), /0\.00/);
    const rows = out => all(out).filter(n => n.props.className === 'roster-lineup-row');
    assert.equal(rows(roster.out).length, 3);
    assert(rows(roster.out).every(n => n.props.disabled));
    assert.match(textOf(rows(roster.out)[0]), /Final · Locked.*0\.00Actual/);
    assert.match(textOf(rows(roster.out)[1]), /-2\.50Actual/);
    assert.match(textOf(rows(roster.out)[2]), /—Actual/);
    assert(select(roster.out, n => n.type === 'details' && textOf(n).includes('Scoring & lineup rules')));

    await roster.loadForm('a', { rollingPPG: 8.3, high: 8.3, low: 8.3, games: 1, recentCount: 1 });
    assert.match(textOf(roster.out), /8\.3L5 PPG/, 'weekly history arrival updates roster PPG without leaving the page');
    const pregame = await fixture({ upcoming: true, rosterView: true });
    assert.equal(select(pregame.out, n => n.props.className === 'gd-scoreboard'), undefined, 'no scoreboard before kickoff');
    assert.doesNotMatch(textOf(pregame.out), /Actual|Saved proj/);
    assert(rows(pregame.out).every(n => !n.props.disabled));
    assert.match(textOf(rows(pregame.out)[0]), /0\.0Proj0\.0L5 PPG/);
    rows(pregame.out)[0].props.onClick(); await pregame.render();
    const replacement = rows(pregame.out).find(n => textOf(n).includes('Bench Option'));
    assert(replacement, 'pregame picker offers eligible bench player');
    replacement.props.onClick(); await pregame.render();
    assert.match(textOf(rows(pregame.out)[0]), /Bench Option.*Local plan/);
    await pregame.kickoff('KC');
    assert.match(textOf(rows(pregame.out)[0]), /Zero Starter.*Live · Locked/);
    assert(rows(pregame.out)[0].props.disabled, 'submitted starter replaces unsubmitted draft at kickoff');
    assert(!rows(pregame.out)[1].props.disabled, 'later game remains editable');
    assert(select(pregame.out, n => n.props.className === 'gd-scoreboard'), 'scoreboard appears automatically at kickoff');
    assert.match(textOf(rows(pregame.out)[1]), /—Actual/, 'later games are not misleading zero scores');

    const stale = await fixture({ upcoming: true, rosterView: true, stale: true });
    assert(rows(stale.out).every(n => n.props.disabled), 'unknown status cannot unlock players');
    const missing = await fixture({ rosterView: true, noProjection: true });
    assert.match(textOf(missing.out), /Zero Starter.*0\.00Actual/);
    const unsupported = await fixture({ rosterView: true, supported: false });
    assert.match(textOf(unsupported.out), /Scoring unavailable/);
    const bye = await fixture({ matchupId: null, rosterView: true });
    assert.doesNotMatch(textOf(select(bye.out, n => n.props.className === 'gd-scoreboard')), /Opponent Name/);
    const desktop = await fixture({ width: 1280 });
    assert.doesNotMatch(textOf(desktop.out), /FOLLOW YOUR LINEUP/);
    assert(select(select(desktop.out, n => n.props.id === 'gameday-starting-lineup'), n => n.props.className === 'gd-scoreboard'));
    const beforeKickoff = await fixture({ upcoming: true });
    assert(!select(beforeKickoff.out, n => n.props.className === 'gd-scoreboard'), 'no pregame score panel');
    const tablet = await fixture({ width: 768, rosterView: true });
    assert.match(textOf(tablet.out), /Starting lineup/);
    assert.equal(select(tablet.out, n => n.props.className === 'gd-mobile'), undefined);
    for (const width of [390, 1280]) {
        const forecast = await fixture({ width, withMatchup: true });
        const breakdown = select(forecast.out, n => n.props.className === 'gd-matchup');
        assert(breakdown, 'matchup is visible on both viewport branches');
        assert.match(textOf(breakdown), /Position strength.*Slot by slot/);
        assert(!all(forecast.out).some(n => ['details', 'dialog'].includes(n.type) && textOf(n).includes('Position strength')), 'analysis requires no expansion or sheet');
        assert.doesNotMatch(textOf(forecast.out), /view their lineup|View opponent breakdown/);
        const free = await fixture({ width, withMatchup: true, pro: false });
        assert(select(free.out, n => n.props.className === 'gd-matchup'));
        assert.doesNotMatch(textOf(free.out), /Your biggest edge|Win probability|Slot by slot/);
    }
    // Apply Optimal must follow the selected history window even when the
    // weekly projection ranks the two quarterbacks in the opposite order.
    for (const view of [{ rosterView: true, width: 390 }, { rosterView: true, width: 1280 }, { width: 390 }, { width: 1280 }]) {
        const f = await fixture({ ...view, upcoming: true });
        f.result.projections.c.available = true;
        f.props.playersData.b.injury_status = 'Questionable';
        f.props.playersData.c.injury_status = 'Doubtful';
        const form = value => ({ rollingPPG: value, high: value, low: value, games: 8, recentCount: 5 });
        await f.loadForm('a', win => form(({ 3: 5, 5: 20, 8: 6, season: 22 })[win]));
        await f.loadForm('d', win => form(({ 3: 30, 5: 10, 8: 25, season: 2 })[win]));
        await f.loadForm('c', form(0));
        assert(select(f.out, n => n.props.className === 'lineup-injury is-danger' && textOf(n) === 'Doubtful'));
        assert(select(f.out, n => n.props.className === 'lineup-injury is-caution' && textOf(n) === 'Questionable'));
        const apply = async () => {
            const applyButton = button(f.out, 'Apply Optimal') || button(f.out, 'Use optimal in my plan');
            if (applyButton) { assert(!applyButton.props.disabled); applyButton.props.onClick(); await f.render(); }
            const done = button(f.out, 'Done');
            if (done) { done.props.onClick(); await f.render(); }
        };
        const starterArea = () => select(f.out, n => n.props.className === (view.rosterView ? 'roster-lineup-players' : view.width === 390 ? 'gd-player-list' : 'lineup-slot-0'));
        const chosen = () => {
            if (view.rosterView || view.width === 390) return textOf(starterArea());
            // Desktop starter rows are the clickable divs above the bench table.
            return all(f.out).filter(n => n.type === 'div' && n.props.onClick && n.props.style?.cursor === 'pointer').map(textOf).join('|');
        };
        await apply();
        assert.match(chosen(), /Zero Starter/, 'default L5 keeps higher rolling average despite lower weekly projection');
        button(f.out, 'L3').props.onClick(); await f.render();
        await apply();
        assert.match(chosen(), /Bench Option/, 'L3 uses the quarterback leading over that window');
        assert.match(chosen(), /Negative Starter/, 'real negative PPG remains eligible');
        assert.match(chosen(), /Missing Starter/, 'real zero PPG remains eligible');
        button(f.out, 'L5').props.onClick(); await f.render();
        await apply();
        assert.match(chosen(), /Zero Starter/, 'changing the window recomputes the applied lineup');
        button(f.out, 'L8').props.onClick(); await f.render();
        await apply();
        assert.match(chosen(), /Bench Option/);
        button(f.out, 'SZN').props.onClick(); await f.render();
        await apply();
        assert.match(chosen(), /Zero Starter/);
        await f.kickoff('KC');
        const lockedApply = button(f.out, 'Apply Optimal');
        assert(!lockedApply || lockedApply.props.disabled, 'auto-fill cannot bypass kickoff locks');
    }

    const sorted = await fixture({ upcoming: true, rosterView: true });
    await sorted.loadForm('a', { rollingPPG: 20 });
    await sorted.loadForm('d', { rollingPPG: 10 });
    rows(sorted.out)[0].props.onClick(); await sorted.render();
    let picker = select(sorted.out, n => n.props.className === 'roster-lineup-picker');
    assert(textOf(picker).indexOf('Zero Starter') < textOf(picker).indexOf('Bench Option'), 'picker sorts highest average first, not projection');
    await sorted.loadForm('d', { rollingPPG: 30 });
    picker = select(sorted.out, n => n.props.className === 'roster-lineup-picker');
    assert(textOf(picker).indexOf('Bench Option') < textOf(picker).indexOf('Zero Starter'), 'new history reorders the picker');
    assert(button(sorted.out, 'Apply Optimal').props.disabled, 'missing history cannot silently become zero or blank a slot');
    assert.match(textOf(sorted.out), /More eligible players with game history/);
    const flex = await fixture({ upcoming: true, rosterView: true });
    flex.result.projections.c.available = true;
    flex.props.currentLeague.roster_positions = ['QB', 'RB', 'WR', 'SUPER_FLEX'];
    await flex.loadForm('a', { rollingPPG: 10 });
    await flex.loadForm('d', { rollingPPG: 20 });
    await flex.loadForm('c', { rollingPPG: 0 });
    assert(!button(flex.out, 'Apply Optimal').props.disabled);
    button(flex.out, 'Apply Optimal').props.onClick(); await flex.render();
    const flexRows = rows(flex.out);
    assert.equal(flexRows.length, 4);
    assert.match(textOf(flexRows[0]), /QB.*Bench Option/);
    assert.match(textOf(flexRows[3]), /SUPER FLEX.*Zero Starter/, 'remaining quarterback fills superflex without duplication');
    flex.props.myRoster.taxi = ['d']; await flex.render();
    assert(button(flex.out, 'Apply Optimal').props.disabled, 'taxi players cannot fill active slots');
    flex.props.myRoster.taxi = []; flex.props.myRoster.reserve = ['d']; await flex.render();
    assert(button(flex.out, 'Apply Optimal').props.disabled, 'reserve players cannot fill active slots');
    flex.props.myRoster.reserve = []; flex.props.playersData.d.injury_status = 'Out'; await flex.render();
    assert(button(flex.out, 'Apply Optimal').props.disabled, 'out players cannot fill active slots despite strong history');

    console.log('PASS roster and Game Day: pregame priority, signed/missing scores, projection fallback, kickoff reconciliation, per-player locks, later games, PPG, and responsive routes');
})().catch(error => { console.error(error); process.exitCode = 1; });
