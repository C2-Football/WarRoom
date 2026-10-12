'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');

const source = Babel.transform(fs.readFileSync('js/components/league-matchup-view.js', 'utf8'), { presets: ['react'] }).code;
const wrapper = Babel.transform(fs.readFileSync('js/tabs/lineup.js', 'utf8'), { presets: ['react'] }).code;
const walk = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(walk)];
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.children || []) : String(node);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && text(node) === label);
const byClass = (tree, name) => walk(tree).filter(node => String(node.props.className || '').split(/\s+/).includes(name));
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture({ deferred = false, direct = false, mutate } = {}) {
    const states = [], effectDeps = [], cleanups = [], effects = [], events = new Map(), timers = new Map();
    const calls = { scores: [], context: [], projections: [], ensure: [], scoreUse: [], navigation: [], optimizer: 0, storage: 0, writes: 0, refresh: 0 };
    let stateCursor = 0, effectCursor = 0, changed = false, out, nextTimer = 1;
    const h = (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : { type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) };
    const React = {
        createElement: h, Fragment: 'fragment',
        useState(initial) {
            const index = stateCursor++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [states[index], value => { const next = typeof value === 'function' ? value(states[index]) : value; if (next !== states[index]) { states[index] = next; changed = true; } }];
        },
        useMemo: fn => fn(), useCallback: fn => fn,
        useEffect(fn, deps = []) {
            const index = effectCursor++;
            if (!effectDeps[index] || deps.length !== effectDeps[index].length || deps.some((value, i) => value !== effectDeps[index][i])) {
                effectDeps[index] = deps;
                effects.push(() => { cleanups[index]?.(); cleanups[index] = fn(); });
            }
        },
    };
    const rosterRows = [
        { roster_id: 1, owner_id: 'own', starters: ['own'], players: ['own'] },
        { roster_id: 2, owner_id: 'left', starters: ['wrong-left'] },
        { roster_id: 3, owner_id: 'right', starters: ['wrong-right'] },
        { roster_id: 4, owner_id: 'second-left' }, { roster_id: 5, owner_id: 'second-right' },
    ];
    let board = { status: 'ready', supported: true, updatedAt: Date.parse('2026-10-12T19:00:00Z'), rows: [
        { roster_id: 1, matchup_id: 1, starters: ['own'], players_points: { own: 100 }, points: 100 },
        { roster_id: 2, matchup_id: 10, starters: ['zero'], players_points: { zero: 0 }, points: 999, custom_points: 0 },
        { roster_id: 3, matchup_id: 10, starters: ['negative'], players_points: { negative: -2.5 }, points: -2.5, custom_points: -7.25 },
        { roster_id: 4, matchup_id: 11, starters: ['future'], players_points: {}, points: 0 },
        { roster_id: 5, matchup_id: 11, starters: ['final'], players_points: { final: 5 }, points: 5 },
    ], refresh: () => { calls.refresh++; } };
    const games = [
        { home: 'KC', away: 'MIA', state: 'final' },
        { home: 'BUF', away: 'SEA', state: 'live' },
        { home: 'ATL', away: 'ARI', state: 'upcoming', kickoff: '2026-10-12T23:15:00Z' },
        { home: 'NE', away: 'DAL', state: 'final' },
    ];
    const pendingScores = [];
    const props = {
        matchupTarget: { leagueId: 'fixture', season: 2026, week: 5, rosterIds: ['2', 3] },
        currentLeague: { league_id: 'fixture', season: '2026', settings: { leg: 5 }, roster_positions: ['QB', 'BN', 'RESERVE'], scoring_settings: { rec: 0.5 }, rosters: rosterRows, users: [
            { user_id: 'own', display_name: 'My manager' }, { user_id: 'left', display_name: 'Left manager' }, { user_id: 'right', display_name: 'Right manager' },
            { user_id: 'second-left', display_name: 'Second left' }, { user_id: 'second-right', display_name: 'Second right' },
        ] },
        myRoster: rosterRows[0],
        playersData: {
            own: { full_name: 'My own player', team: 'KC', position: 'QB' },
            zero: { full_name: 'Zero actual starter', team: 'KC', position: 'QB' },
            negative: { full_name: 'Negative actual starter', team: 'BUF', position: 'QB' },
            future: { full_name: 'Future starter', team: 'ATL', position: 'QB' },
            final: { full_name: 'Completed starter', team: 'NE', position: 'QB' },
        },
        statsData: { fixtureStats: true }, stats2025Data: { fixturePrior: true },
        setActiveTab: (...args) => calls.navigation.push(args),
    };
    const ctx = {
        React, console,
        setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); },
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        window: {
            React, S: { nflState: { season: 2026, display_week: 5 } },
            addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
            removeEventListener(name, fn) { events.get(name)?.delete(fn); },
            localStorage: { getItem() { calls.storage++; throw Error('Spectators must not read plans'); }, setItem() { calls.storage++; throw Error('Spectators must not save plans'); } },
            WR: { PlayerMetrics: { useMetrics() { throw Error('Spectators must not mount planner hooks'); } } },
            App: {
                Chopped: { isChopped: league => league.settings?.type === 3 },
                NflContext: {
                    gameStatus: game => game?.state || 'unknown',
                    loadScores(week, season, type) { calls.scores.push([week, season, type]); return deferred ? new Promise(resolve => pendingScores.push(resolve)) : Promise.resolve(games); },
                    load: async (weeks, season) => { calls.context.push([weeks, season]); return {}; },
                },
                WeeklyProj: {
                    ensureWeekProjections: week => { calls.ensure.push(week); },
                    projectRoster(ids, options) { calls.projections.push({ ids: [...ids], options }); return Object.fromEntries(ids.map(pid => [pid, { available: true, points: { median: pid === 'negative' ? 12 : 20 }, statLine: { median: { pass_yd: 100 } } }])); },
                    optimalForRoster() { calls.optimizer++; throw Error('Spectators cannot optimize lineups'); },
                },
                MFL: { submitLineup() { calls.writes++; throw Error('Spectators cannot submit lineups'); } },
            },
        },
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('js/shared/league-live-scores.js', 'utf8'), ctx);
    ctx.window.App.LeagueLiveScores.useScores = options => { calls.scoreUse.push(clone(options)); return board; };
    vm.runInContext(source, ctx);
    vm.runInContext(wrapper, ctx);
    mutate?.({ props, board, ctx });
    async function render() {
        for (let cycle = 0; cycle < 12; cycle++) {
            changed = false; stateCursor = 0; effectCursor = 0;
            out = direct ? ctx.window.LeagueMatchupView(props) : ctx.window.LineupTab(props);
            effects.splice(0).forEach(effect => effect());
            await Promise.resolve(); await Promise.resolve(); await new Promise(setImmediate);
            if (!changed) return out;
        }
        throw Error('Spectator render did not settle');
    }
    await render();
    return { props, ctx, calls, games, pendingScores, render, get out() { return out; }, get board() { return board; }, set board(value) { board = value; },
        dispose() { cleanups.forEach(cleanup => cleanup?.()); },
        async emitProjection(detail) { events.get('wr:projections-loaded')?.forEach(fn => fn({ detail })); await render(); },
    };
}

(async () => {
    const game = await fixture();
    const names = byClass(game.out, 'gd-league-game-side').map(text);
    assert.match(names[0], /^Left manager0\.00Actual pointsProj\. finish 0\.00/);
    assert.match(names[1], /^Right manager-7\.25Actual pointsProj\. finish 7\.25/);
    assert.match(text(game.out), /Zero actual starter.*0\.00Actual0\.00Finish/);
    assert.match(text(game.out), /Negative actual starter.*-2\.50Actual12\.00Finish/);
    assert.doesNotMatch(text(game.out), /My own player|wrong-left|wrong-right|Win probability|optimal|Your biggest edge/);
    assert.equal(button(game.out, 'Matchup').props['aria-pressed'], true);
    assert.deepEqual(game.calls.scores[0], [5, 2026, 2]);
    assert.deepEqual(clone(game.calls.context[0]), [[5], 2026]);
    assert(game.calls.projections.length > 0);
    assert(game.calls.projections.every(call => JSON.stringify(call.ids) === '["zero","negative"]'), 'Only selected submitted starters are projected');
    assert.equal(game.calls.projections[0].options.statsData, game.props.statsData);
    assert.equal(game.calls.projections[0].options.priorData, game.props.stats2025Data);
    assert.equal(game.calls.projections[0].options.scoring, game.props.currentLeague.scoring_settings);
    assert.equal(game.calls.projections[0].options.week, 5);
    assert.equal(game.calls.optimizer + game.calls.storage + game.calls.writes, 0, 'The real LineupTab wrapper mounts no planner hooks, storage, optimizer or writes');
    const ownRoster = clone(game.props.myRoster);
    button(game.out, 'My lineup').props.onClick();
    button(game.out, 'All games').props.onClick();
    assert.deepEqual(game.calls.navigation, [['lineup'], ['dashboard']]);
    assert.deepEqual(clone(game.props.myRoster), ownRoster, 'Managed roster remains unchanged');
    button(game.out, 'Refresh scores').props.onClick(); await game.render();
    assert.equal(game.calls.refresh, 1); assert.equal(game.calls.scores.length, 2, 'Refresh updates both score and NFL context');

    game.props.getOwnerName = id => Number(id) === 2 ? 'Scoreboard manager name' : null;
    await game.render();
    assert.match(text(game.out), /Scoreboard manager name/);
    assert.doesNotMatch(text(game.out), /Left manager/, 'Manager naming matches the Overview helper');
    game.props.matchupTarget = { ...game.props.matchupTarget, rosterIds: [4, '5'] }; await game.render();
    assert.match(text(game.out), /Second left.*Future starter.*Second right/);
    assert.doesNotMatch(text(game.out), /Scoreboard manager name|Negative actual starter|Zero actual starter/);
    assert(game.calls.projections.slice(-1).every(call => JSON.stringify(call.ids) === '["future","final"]'));

    for (const change of [
        target => ({ ...target, leagueId: 'other-league' }),
        target => ({ ...target, season: 2025 }),
        target => ({ ...target, week: 4 }),
        target => ({ ...target, week: 6 }),
        target => ({ ...target, week: 5.5 }),
        target => ({ ...target, rosterIds: [2, '2'] }),
        target => ({ ...target, rosterIds: [2, 999] }),
        target => ({ ...target, rosterIds: [2] }),
    ]) {
        const invalid = await fixture({ mutate: ({ props }) => { props.matchupTarget = change(props.matchupTarget); } });
        assert.match(text(invalid.out), /no longer available/);
        assert.equal(invalid.calls.scores.length + invalid.calls.context.length + invalid.calls.projections.length + invalid.calls.ensure.length, 0);
        assert(invalid.calls.scoreUse.every(call => call.enabled === false), 'Invalid scopes never subscribe to scores');
        assert.equal(byClass(invalid.out, 'gd-league-game-side').length, 0);
        invalid.dispose();
    }
    for (const mutate of [
        ({ board }) => { board.rows.find(row => row.roster_id === 3).matchup_id = 999; },
        ({ board }) => { board.rows.find(row => row.roster_id === 3).matchup_id = null; },
        ({ board }) => { board.rows = board.rows.filter(row => row.roster_id !== 3); },
        ({ board }) => { board.rows.push({ roster_id: 9, matchup_id: 10 }); },
    ]) {
        const wrongPair = await fixture({ mutate });
        assert.match(text(wrongPair.out), /matchup is unavailable/);
        assert.equal(byClass(wrongPair.out, 'gd-league-game-side').length, 0, 'Invalid pair never falls back to own or another opponent');
        assert.equal(wrongPair.calls.projections.length, 0);
        wrongPair.dispose();
    }
    const chopped = await fixture({ mutate: ({ props }) => { props.currentLeague.settings.type = 3; } });
    assert.match(text(chopped.out), /no longer available/);
    assert.equal(chopped.calls.scores.length, 0);
    chopped.dispose();
    const archived = await fixture({ mutate: ({ props }) => { props.currentLeague.season = '2025'; props.matchupTarget.season = 2025; } });
    assert.match(text(archived.out), /no longer available/); archived.dispose();

    const stale = await fixture({ mutate: ({ board }) => { board.status = 'stale'; board.error = 'offline'; } });
    assert.match(text(stale.out), /last successful update/);
    assert.match(text(stale.out), /-7\.25Actual points/);
    stale.dispose();
    const loading = await fixture({ mutate: ({ board }) => { board.status = 'loading'; board.rows = []; } });
    assert.match(text(loading.out), /Loading this matchup/); loading.dispose();
    const unavailable = await fixture({ mutate: ({ board }) => { board.status = 'error'; board.error = 'offline'; board.rows = []; } });
    assert.match(text(unavailable.out), /Scores are unavailable/); unavailable.dispose();

    const missing = await fixture({ mutate: ({ board }) => { board.rows.find(row => row.roster_id === 2).starters = []; } });
    assert.match(text(missing.out), /Not reportedStarter not reported/);
    assert.doesNotMatch(text(missing.out), /No player submitted/);
    missing.dispose();
    const empty = await fixture({ mutate: ({ board }) => { board.rows.find(row => row.roster_id === 2).starters = ['0']; } });
    assert.match(text(empty.out), /Empty slotNo player submitted/); empty.dispose();
    const missingActual = await fixture({ mutate: ({ board }) => { board.rows.find(row => row.roster_id === 2).players_points = {}; } });
    assert.match(text(byClass(missingActual.out, 'gd-league-starter')[0]), /—Actual—Finish/, 'Final player without actual remains missing, never zero');
    missingActual.dispose();
    const missingProjection = await fixture({ mutate: ({ ctx }) => { ctx.window.App.WeeklyProj.projectRoster = () => ({}); } });
    assert.match(text(byClass(missingProjection.out, 'gd-league-game-side')[1]), /-7\.25Actual pointsProj\. finish —/, 'Actual scores remain visible when unfinished-player estimates are missing');
    assert.match(text(byClass(missingProjection.out, 'gd-league-starter')[1]), /-2\.50Actual—Finish/);
    missingProjection.dispose();
    const missingLiveActual = await fixture({ mutate: ({ board }) => { board.rows.find(row => row.roster_id === 3).players_points = {}; } });
    assert.match(text(byClass(missingLiveActual.out, 'gd-league-starter')[1]), /—Actual—Finish/, 'An unreported live player score never becomes a synthetic zero');
    missingLiveActual.dispose();
    const liveFloor = await fixture({ mutate: ({ board }) => { const row = board.rows.find(row => row.roster_id === 3); row.players_points.negative = 30; row.custom_points = 30; } });
    assert.match(text(byClass(liveFloor.out, 'gd-league-game-side')[1]), /30\.00Actual pointsProj\. finish 30\.00/);
    assert.match(text(byClass(liveFloor.out, 'gd-league-starter')[1]), /30\.00Actual30\.00Finish/, 'A live finish never drops below points already earned');
    liveFloor.dispose();
    const noContext = await fixture({ mutate: ({ ctx }) => { ctx.window.App.NflContext.loadScores = async () => []; } });
    assert.match(text(byClass(noContext.out, 'gd-league-game-side')[0]), /0\.00Actual pointsProj\. finish —/);
    assert.match(text(noContext.out), /Status unavailable/); noContext.dispose();

    const priorProjections = game.calls.projections.length;
    await game.emitProjection({ week: 4, season: 2026 });
    // A framework render may still recompute in this harness, but a foreign
    // event must not alter the selected week or request different starters.
    assert(game.calls.projections.slice(priorProjections).every(call => call.options.week === 5 && JSON.stringify(call.ids) === '["future","final"]'));

    const pending = await fixture({ deferred: true, direct: true });
    assert.match(text(pending.out), /Proj\. finish —/);
    pending.props.matchupTarget = { ...pending.props.matchupTarget, rosterIds: [4, 5] }; await pending.render();
    assert.equal(pending.pendingScores.length, 2);
    pending.pendingScores[1](pending.games); await pending.render();
    assert.match(text(pending.out), /Second left0\.00Actual pointsProj\. finish 20\.00/);
    pending.pendingScores[0]([{ home: 'ATL', away: 'ARI', state: 'final' }]); await pending.render();
    assert.match(text(pending.out), /Second left0\.00Actual pointsProj\. finish 20\.00/, 'Canceled old target response cannot replace current NFL context');
    assert.doesNotMatch(text(pending.out), /Zero actual starter|Left manager/);
    pending.props.currentLeague = { ...pending.props.currentLeague, league_id: 'another-league' }; await pending.render();
    assert.match(text(pending.out), /no longer available/);
    assert.equal(byClass(pending.out, 'gd-league-game-side').length, 0, 'League changes immediately hide prior target scores');
    pending.dispose(); game.dispose();
    console.log('PASS league matchup view: exact spectator targets, scoped async context, earned-aware scores and untouched lineup planner');
})().catch(error => { console.error(error); process.exitCode = 1; });
