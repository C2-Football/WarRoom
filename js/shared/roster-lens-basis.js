/* global module */
// Observed current-season averages are a comparison basis, never a forecast.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const number = value => value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim() || !Number.isFinite(Number(value)) ? null : Number(value);
    const normalize = basis => ['projected', 'average', 'idp-average'].includes(basis) ? basis : 'projected';
    const position = value => ({ DE: 'DL', DT: 'DL', EDGE: 'DL', NT: 'DL', IDL: 'DL', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DST: 'DEF', 'D/ST': 'DEF' })[String(value || '').toUpperCase()] || String(value || '').toUpperCase();
    const scoringKey = scoring => JSON.stringify(Object.entries(scoring || {}).sort(([a], [b]) => a.localeCompare(b)));
    const leagueId = opts => String(opts.league?.league_id || opts.league?.id || '');
    function describe(basis) {
        const id = normalize(basis);
        return { id, label: ({ projected: 'Projected', average: 'Avg points', 'idp-average': 'IDP avg' })[id],
            description: id === 'projected' ? 'League-scored weekly projections.' : id === 'average' ? 'Current-season points per game; a historical lineup comparison.' : 'Current-season average points for IDPs; offensive players and D/ST keep weekly projections.',
            seasonAvailable: id === 'projected' };
    }
    function sourceContext(opts) { return { leagueId: leagueId(opts), season: String(opts.league?.season || ''), scoringKey: scoringKey(opts.league?.scoring_settings) }; }
    function matches(context, opts) {
        const expected = sourceContext(opts);
        return !!context && ['leagueId', 'season', 'scoringKey'].every(key => String(context[key]) === expected[key]);
    }
    function currentAverage(pid, opts) {
        const league = opts.league || {}, season = String(league.season || ''), scoring = league.scoring_settings || {}, raw = opts.statsData?.[pid];
        const missing = { value: null, games: null, season, source: 'Current-season average unavailable' };
        if (!season || opts.statsSeason != null && String(opts.statsSeason) !== season) return missing;
        const native = raw?._mflScoring;
        if (native) {
            const average = number(native.average);
            if (String(native.season) === season && native.week == null && raw.week == null && native.scoringKey === scoringKey(scoring) && matches(opts.statsContext, opts) && average != null)
                return { value: average, games: number(native.games), season, source: 'MFL official season average' };
        }
        const WP = App.WeeklyProj, expected = WP?.weeklyPointsScope?.(leagueId(opts), season, scoring);
        if (expected && root.S?.weeklyPlayerPointsScope === expected) {
            const form = WP.formStats?.(pid, 'season'), value = number(form?.rollingPPG);
            if (value != null && number(form?.games) > 0) return { value, games: Number(form.games), season, source: 'Completed games · league scoring' };
        }
        if (native) return missing;
        if (!raw || typeof raw !== 'object' || raw.week != null || raw.season != null && String(raw.season) !== season) return missing;
        // Native MFL scoring cannot be reconstructed from the flattened NFL
        // rule approximation when its authoritative average is unavailable.
        if (league._mfl || String(league._platform || '') === 'mfl' || leagueId(opts).startsWith('mfl_')) return missing;
        const games = number(raw.gp), pos = position((opts.players || opts.playersData)?.[pid]?.position);
        const hasScoredData = Object.keys(raw).some(key => !['gp', 'season', 'season_type', 'week', 'player_id', 'team_id'].includes(key) && number(raw[key]) != null);
        if (!(games > 0) || !hasScoredData || !Object.keys(scoring).length) return missing;
        let points = null, average = null;
        try {
            if (typeof App.LeagueStats?.score === 'function') points = number(App.LeagueStats.score(raw, scoring, pos));
            else {
                if (typeof App.calcRawPts === 'function') points = number(App.calcRawPts(raw, scoring));
                if (typeof App.calcPPG === 'function') average = number(App.calcPPG(raw, scoring));
            }
        } catch (_) { return missing; }
        // Some legacy calcPPG implementations clamp negative performances.
        // Canonical signed raw points divided by the verified GP preserves them.
        const value = points != null ? points / games : average;
        return { value, games, season, source: 'Current-season stats · league scoring' };
    }
    function comparison(pid, opts) {
        const basis = normalize(opts.basis), player = (opts.players || opts.playersData)?.[pid], pos = position(player?.position);
        const average = basis === 'average' || basis === 'idp-average' && ['DL', 'LB', 'DB'].includes(pos);
        const projected = opts.projected;
        if (!average) {
            const value = number(typeof projected === 'object' ? projected?.points?.median ?? projected?.median : projected);
            return { ...(projected && typeof projected === 'object' ? projected : {}), available: projected?.available !== false && value != null,
                points: { ...(projected?.points || {}), median: value }, comparisonBasis: 'projected', averageGames: null, averageSeason: null, averageSource: null };
        }
        const observed = currentAverage(pid, opts), week = number(opts.week), bye = App.NFLByes?.weekForPlayer?.(player, Number(opts.league?.season));
        const status = String(player?.injury_status || '').toUpperCase();
        const unavailable = !player?.team || ['FA', 'FA*'].includes(player.team) || player.active === false || ['Inactive', 'Retired'].includes(player.status)
            || ['OUT', 'IR', 'PUP', 'SUS', 'SUSPENDED', 'DOUBTFUL', 'DNP', 'NA', 'COV'].includes(status) || week != null && bye === week;
        return { available: !unavailable && observed.value != null, injuryStatus: week != null && bye === week ? 'BYE' : status,
            points: { median: observed.value }, statLine: { median: observed.value == null ? null : { observedAverage: observed.value } },
            comparisonBasis: 'average', averageGames: observed.games, averageSeason: observed.season, averageSource: observed.source };
    }
    function adapt(opts) {
        if (normalize(opts.basis) === 'projected') return opts.projectionsByPid || {};
        return Object.fromEntries(Object.keys(opts.players || opts.playersData || {}).map(pid => [pid, comparison(pid, { ...opts, projected: opts.projectionsByPid?.[pid] })]));
    }
    async function prepare(opts) {
        if (normalize(opts.basis) === 'projected') return opts;
        const league = opts.league || {}, mfl = league._mfl || league._platform === 'mfl' || leagueId(opts).startsWith('mfl_');
        if (!mfl || matches(opts.statsContext, opts)) return opts;
        if (typeof root.MFL?.loadPlayerStats !== 'function') return opts;
        try {
            const response = await root.MFL.loadPlayerStats(league, { season: league.season, week: null, players: opts.players || opts.playersData || {} });
            if (response?.statsByPid) return { ...opts, statsData: response.statsByPid, statsSeason: league.season, statsContext: sourceContext(opts) };
        } catch (_) { /* unavailable stays distinct from zero */ }
        return opts;
    }
    const api = { normalize, position, describe, sourceContext, currentAverage, comparison, adapt, prepare };
    App.RosterLensBasis = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
