'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../js/shared/league-stats.js');
require('../js/shared/scoring-visuals.js');
const score = globalThis.App.LeagueStats.score;
const source = fs.readFileSync(require.resolve('../js/components/roster-player-stats.js'), 'utf8');

function fixture(options = {}) {
    let hooks = [], index = 0, effects = [], effectState = [];
    const calls = [];
    const engine = {
        normalizePosition: globalThis.App.LeagueStats.normalizePosition,
        score(...args) { options.onScore?.(); return score(...args); },
        loadGameLog: async opts => {
            calls.push({ kind: 'weekly', ...opts });
            if (options.log) return options.log(opts);
            return [{ week: 1, raw: { rec_tgt: 0, rec: 0, rec_yd: 0, rec_td: 0 }, error: null }, { week: 2, raw: { rec_tgt: 2, rec: 1, rec_yd: -20 }, error: null }, { week: 3, raw: null, error: null }];
        },
        load: async opts => {
            calls.push({ kind: 'season', ...opts });
            if (options.load) return options.load(opts);
            return { statsByPid: { p: { gp: 2, rec_tgt: 8, rec: 4, rec_yd: 60, rec_td: 0 } } };
        }
    };
    const React = {
        Fragment: 'fragment',
        createElement(type, props, ...children) { return { type, props: props || {}, children }; },
        useState(initial) { const at = index++; if (!(at in hooks)) hooks[at] = typeof initial === 'function' ? initial() : initial; return [hooks[at], value => { hooks[at] = typeof value === 'function' ? value(hooks[at]) : value; }]; },
        useEffect(fn, deps) { const at = index++, previous = effectState[at]; if (!previous || deps.some((v, i) => v !== previous.deps[i])) effects.push(() => { previous?.cleanup?.(); effectState[at] = { deps, cleanup: fn() }; }); }
    };
    const context = { React, window: { S: { nflState: { season: 2026, week: 5, ...options.state } }, App: { LeagueStats: engine, ScoringVisuals: globalThis.App.ScoringVisuals }, MFL: options.mflAdapter } };
    vm.createContext(context); vm.runInContext(source, context);
    const props = { pid: options.pid || 'p', pos: 'TE', player: { position: 'TE', years_exp: 2, ...(options.mfl ? { _mfl_id: '123' } : {}) }, currentLeague: { league_id: options.mfl ? 'mfl_99_2026' : 'l', ...(options.mfl ? { _source: 'mfl' } : {}), season: 2026, scoring_settings: { rec: 1, bonus_rec_te: .5, rec_yd: .1 } }, leagueType: options.type || 'redraft', phone: true };
    return {
        calls, props, helpers: context.window.RosterPlayerStatsData,
        render(extra) { Object.assign(props, extra); index = 0; return context.window.RosterPlayerStats(props); },
        async flush() { effects.splice(0).forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); }
    };
}
const walk = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node !== 'object' ? [node] : [node, ...walk(node.children)];
const text = tree => walk(tree).filter(node => typeof node !== 'object').join('');
const find = (tree, predicate) => walk(tree).find(node => typeof node === 'object' && predicate(node));
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node) === label);
const bodyRows = tree => walk(find(tree, node => node.type === 'tbody')).filter(node => node.type === 'tr');
const values = row => row.children.map(text);

(async () => {
    const f = fixture(); let tree = f.render(); await f.flush(); tree = f.render();
    assert.equal(button(tree, 'Weekly').props['aria-pressed'], true, 'redraft opens weekly observations');
    assert.deepEqual(Array.from(f.calls[0].weeks), [1, 2, 3, 4, 5]);
    assert.deepEqual(values(bodyRows(tree)[0]), ['2', '-0.5', '2', '1', '-20', '—'], 'reported games appear first; negative points and missing touchdowns stay distinct');
    assert.deepEqual(values(bodyRows(tree)[1]), ['1', '0.0', '0', '0', '0', '0'], 'true zero stats and zero fantasy points remain visible');
    const missing = find(tree, n => n.type === 'details' && n.props.className === 'wr-player-unreported-weeks');
    assert(missing && !missing.props.open, 'unreported weeks are available in a closed disclosure');
    assert(text(missing).includes('1 week without statsWeek 3No stats reported'), 'missing week stays explicit without being shown as zero or assumed bye');
    assert(!find(missing, n => n.type === 'button'), 'an empty week does not offer a meaningless expanded stat line');
    const seasonSelect = find(tree, n => n.type === 'select');
    seasonSelect.props.onChange({ target: { value: '2025' } }); tree = f.render(); await f.flush(); tree = f.render();
    assert.equal(f.calls.at(-1).season, 2025);
    assert.equal(f.calls.at(-1).weeks.length, 18, 'historical year requests a full regular season');
    button(tree, 'Season').props.onClick(); tree = f.render(); await f.flush(); tree = f.render();
    assert.equal(f.calls.at(-1).kind, 'season');
    assert(text(tree).includes('FPTS12.0PPG6.0GP2'), 'season summary uses selected league scoring including TE bonus');
    button(tree, 'Career').props.onClick(); tree = f.render(); await f.flush(); tree = f.render();
    assert.deepEqual(bodyRows(tree).map(row => values(row)[0]), ['2025', '2024'], 'career respects selected season');
    assert.equal(text(tree).includes('2026'), true, 'current year remains available in the season selector');
    assert.equal(fixture({ type: 'chopped' }).render().children[1].children[0][0].props['aria-pressed'], true, 'Chopped defaults weekly');
    assert.equal(button(fixture({ type: 'dynasty' }).render(), 'Season').props['aria-pressed'], true, 'dynasty defaults season');
    assert.equal(button(f.render({ pid: 'other', leagueType: 'chopped' }), 'Weekly').props['aria-pressed'], true, 'new context resets view instead of leaking previous player state');

    let fail = true;
    const retry = fixture({ log: async () => [{ week: 5, raw: fail ? null : { rec: 0 }, error: fail ? 'Provider failed' : null }] });
    tree = retry.render(); await retry.flush(); tree = retry.render();
    assert(text(tree).includes('Some stats could not load.'));
    assert(text(tree).includes('No weekly stats loaded.') && !text(tree).includes('No weekly stats reported yet.'), 'provider failure never implies verified absence');
    fail = false; button(tree, 'Retry').props.onClick(); tree = retry.render(); await retry.flush(); tree = retry.render();
    assert.equal(retry.calls.at(-1).force, true);
    assert(!text(tree).includes('Some stats could not load.'));

    const visualLog = [10, 12, 20, 0, -1].map((value, index) => ({ week: index + 1, raw: { gp: 1, rec: 0, rec_yd: value * 10, rec_tgt: 4, rec_td: 0 }, error: null }));
    visualLog.push({ week: 6, raw: { rec: 0, rec_yd: 0, rec_tgt: 0, rec_td: 0 }, error: null }, { week: 7, raw: { gp: 1, rec_yd: 990, rec_tgt: 4 }, error: null }, { week: 8, raw: null, error: 'Not loaded' });
    const visual = fixture({ state: { week: 7, season_type: 'regular' }, log: async () => visualLog });
    tree = visual.render(); await visual.flush(); tree = visual.render();
    const strip = find(tree, n => n.type === 'figure' && n.props.className === 'wr-week-points');
    assert(strip, 'weekly points have their own compact visual strip');
    const weekButtons = walk(strip).filter(n => n.type === 'button');
    assert.deepEqual(weekButtons.map(n => text(n).slice(-2)), ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'], 'points strip runs chronologically; missing weeks do not offer an empty stat line');
    assert(text(strip).includes('10.0 median · 5 games'), 'baseline excludes current week, missing/error rows, and ambiguous zero shells');
    const weeklyCell = (week, column = 1) => bodyRows(tree).find(row => values(row)[0] === String(week)).children[column].children[0];
    assert.equal(weeklyCell(3).props['data-score-tone'], 'strong', 'productive complete week gets a stronger visual treatment');
    assert.equal(weeklyCell(2).props['data-score-tone'], 'typical', 'a week inside the median band is typical');
    assert.equal(weeklyCell(4).props['data-score-tone'], 'quiet', 'zero points with explicit participation can be compared');
    assert.equal(weeklyCell(5).props['data-score-tone'], 'quiet', 'negative points are displayed and graded without clipping to zero');
    assert.equal(weeklyCell(6).props['data-score-tone'], 'neutral', 'all-zero stat shells do not imply participation');
    assert.equal(weeklyCell(7).props['data-score-tone'], 'neutral', 'an unfinished current-week high score is not graded');
    assert.equal(weeklyCell(3, 2).props['data-score-tone'], 'neutral', 'targets remain usage rather than a good-or-bad judgment');
    weekButtons[2].props.onClick(); tree = visual.render();
    assert(find(tree, n => n.type === 'tr' && n.props.className === 'wr-player-stats-detail'), 'bar and week-row controls open the same detailed stat line');
    assert(find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Week 3 stat line').props['aria-expanded'], 'table disclosure reflects the selected points bar');
    const scoreForWeek = raw => score(raw, visual.props.currentLeague.scoring_settings, 'TE');
    const summaries = visual.helpers.weeklyVisuals(visualLog, 2026, { season: 2026, week: 7, season_type: 'regular' }, scoreForWeek, visual.helpers.columns('TE'));
    assert.equal(summaries.pointsSummary.count, 5);
    assert.equal(visual.helpers.weeklyVisuals(visualLog, 2026, { season: 2026, week: 1, season_type: 'pre' }, scoreForWeek, []).pointsSummary, null, 'preseason has no completed regular games to grade');
    assert.equal(visual.helpers.weeklyVisuals(visualLog, 2025, { season: 2026, week: 1, season_type: 'pre' }, scoreForWeek, []).pointsSummary.count, 6, 'historical-season observations remain complete in preseason');
    assert.equal(visual.helpers.weeklyVisuals(visualLog, 2026, { season: 2026, week: 1, season_type: 'post' }, scoreForWeek, []).pointsSummary.count, 6, 'postseason makes all regular-season observations complete');
    assert.equal(visual.helpers.weeksForSeason(2026, 2026, { week: 1, season_type: 'pre' }).length, 0, 'preseason does not request unplayed regular-season game logs');
    assert.equal(visual.helpers.weeksForSeason(2026, 2026, { week: 1, season_type: 'post' }).length, 18, 'postseason requests all regular-season game logs');
    assert.equal(visual.helpers.weeksForSeason(2026, 2026, { week: 7, display_week: 6 }).length, 6, 'requests follow the canonical displayed week at rollover');
    const rolloverRows = [...visualLog.filter(row => row.week !== 6), { week: 6, raw: { gp: 1, rec_yd: 990 } }];
    const rolloverVisual = visual.helpers.weeklyVisuals(rolloverRows, 2026, { season: 2026, week: 7, display_week: 6 }, scoreForWeek, []);
    assert.equal(rolloverVisual.pointGrade(rolloverRows.find(row => row.week === 6)).tone, 'neutral', 'the displayed current week never becomes a completed grade');
    assert.equal(visual.helpers.hasParticipation({ pts_allow: 0, yds_allow: 150 }), true, 'a defensive shutout with yardage evidence is a played game');
    const qbColumns = visual.helpers.columns('QB');
    const intRows = [0, 1, 1, 3].map((value, i) => ({ week: i + 1, raw: { pass_att: 20, pass_int: value } }));
    const intVisual = visual.helpers.weeklyVisuals(intRows, 2025, { season: 2026, week: 5 }, () => null, qbColumns);
    assert.equal(intVisual.columnGrade(intRows[3], 2).tone, 'quiet', 'more interceptions thrown has an unfavorable color');
    assert.equal(visual.helpers.columnDirection(visual.helpers.columns('DEF')[2]), 'lower', 'fewer points allowed is favorable');
    const defenseRows = [1, 5, 5, 20].map((value, i) => ({ week: i + 1, raw: { pts_allow: value } }));
    const defenseVisual = visual.helpers.weeklyVisuals(defenseRows, 2025, { season: 2026, week: 5 }, () => null, visual.helpers.columns('DEF'));
    assert.equal(defenseVisual.columnGrade(defenseRows[0], 2).tone, 'strong', 'low points allowed uses the favorable color');
    assert.equal(defenseVisual.columnGrade(defenseRows[3], 2).tone, 'quiet', 'high points allowed uses the unfavorable color');
    assert.equal(visual.helpers.weeksForSeason(2026, 2026, { week: 0, season_type: 'off' }).length, 18, 'offseason keeps the completed regular-season log available');

    const pending = [];
    const changing = fixture({ log: opts => new Promise(resolve => pending.push({ season: opts.season, resolve })) });
    tree = changing.render(); await changing.flush();
    find(tree, n => n.type === 'select').props.onChange({ target: { value: '2025' } }); changing.render(); await changing.flush();
    pending[1].resolve([{ week: 1, raw: { rec: 2, rec_yd: 50 }, error: null }]); await changing.flush();
    pending[0].resolve([{ week: 5, raw: { rec: 9, rec_yd: 900 }, error: null }]); await changing.flush(); tree = changing.render();
    assert.equal(values(bodyRows(tree)[0])[1], '8.0', 'late old-season request cannot replace the selected season');
    assert(text(tree).includes('2025 · League scoring'));

    let active = 0, maxActive = 0;
    const career = await f.helpers.loadCareer({ load: async ({ season }) => { active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; if (season === 2024) throw new Error('Failure'); return { statsByPid: { p: { gp: 0 } } }; } }, 'p', [2026, 2025, 2024, 2023, 2022], false);
    assert(maxActive <= 3 && maxActive > 1, 'career provider requests are bounded');
    assert.equal(career[2].error, 'Failure', 'career load failures remain distinguishable from no reported stats');
    assert.equal(career[0].raw.gp, 0);
    assert.equal(f.helpers.columns('DE')[0].value({ idp_tkl_solo: 0, idp_tkl_ast: 0 }), 0);
    assert.equal(f.helpers.columns('DE')[0].value({ idp_tkl_solo: 2 }), null, 'missing assisted tackles are not invented');

    const mflCalls = []; let reconstructed = 0;
    const mflAdapter = { loadPlayerStats: async (league, opts) => {
        mflCalls.push(opts);
        const pid = Object.keys(opts.players).find(id => opts.players[id]._mfl_id === '123');
        return { statsByPid: { [pid]: { gp: 2, rec: 9, rec_yd: 900, _mflScoring: {
            scoringKey: JSON.stringify(Object.entries(league.scoring_settings).sort(([a], [b]) => a.localeCompare(b))),
            season: String(opts.season), week: opts.week,
            points: opts.week == null ? -5 : ({ 1: 0, 2: -4.5, 3: null, 4: 11, 5: .75 })[opts.week],
            average: opts.week == null ? 2 : null
        } } }, error: opts.week === 4 ? 'NFL details are unavailable.' : null };
    } };
    const mfl = fixture({ mfl: true, mflAdapter, pid: 'mfl_123', onScore: () => reconstructed++ });
    delete mfl.props.player._mfl_id;
    tree = mfl.render(); await mfl.flush(); tree = mfl.render();
    assert.equal(values(bodyRows(tree).find(row => values(row)[0] === '1'))[1], '0.0', 'MFL authoritative zero stays visible');
    assert.equal(values(bodyRows(tree).find(row => values(row)[0] === '2'))[1], '-4.5', 'MFL authoritative negative points stay visible');
    assert.equal(values(bodyRows(tree).find(row => values(row)[0] === '3'))[1], '—', 'raw NFL stats do not replace missing MFL actuals');
    assert.equal(values(bodyRows(tree).find(row => values(row)[0] === '4'))[1], '11.0', 'available MFL points survive a partial detailed-stats failure');
    assert(mflCalls.every(call => call.players.mfl_123._mfl_id === '123'), 'adapter receives the native player snapshot');
    assert.deepEqual(mflCalls.map(call => call.week), [1, 2, 3, 4, 5], 'MFL weekly requests stay explicit');
    button(tree, 'Season').props.onClick(); mfl.render(); await mfl.flush(); tree = mfl.render();
    assert(text(tree).includes('FPTS-5.0PPG2.0GP2'), 'MFL YTD and AVG are authoritative; AVG is not reconstructed from YTD/GP');
    assert.equal(mflCalls.at(-1).week, null, 'season adapter request fetches its YTD and AVG sources');
    button(tree, 'Career').props.onClick(); mfl.render(); await mfl.flush(); tree = mfl.render();
    assert(bodyRows(tree).every(row => values(row)[2] === '2.0' && values(row)[3] === '-5.0'), 'career uses each season’s authoritative MFL totals/averages');
    assert.equal(reconstructed, 0, 'MFL actuals never enter the approximate scoring engine');
    const mflVisual = mfl.helpers.weeklyVisuals([{ week: 1, raw: { gp: 1, _mflScoring: { points: 0 } } }, { week: 2, raw: { gp: 1 } }, { week: 3, raw: { gp: 1 } }], 2026, { season: 2026, week: 5 }, raw => typeof raw?._mflScoring?.points === 'number' ? raw._mflScoring.points : null, []);
    assert.equal(mflVisual.pointsSummary, null, 'missing native MFL points cannot fill a benchmark from unrelated NFL raw stats');

    const unavailableMfl = fixture({ mfl: true, onScore: () => reconstructed++ });
    tree = unavailableMfl.render(); await unavailableMfl.flush(); tree = unavailableMfl.render();
    assert(bodyRows(tree).every(row => values(row)[1] === '—'), 'missing MFL adapter leaves points unknown even when raw stats are available');
    assert.equal(reconstructed, 0);
    assert.equal(f.helpers.nativeScore({ _mflScoring: { points: 99, scoringKey: 'wrong', season: '2026', week: null } }, {}, 2026, null), null, 'other scoring contexts are rejected');
    console.log('Roster player stats: visual weekly scoring, completed-game benchmarks, current/pre/post phases, zero/negative/missing observations, lower-is-better metrics, cancellation/retry and authoritative MFL weekly/YTD/AVG passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
