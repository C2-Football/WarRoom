// Observed comparison signals. Keep missing values distinct from reported zero,
// and keep each season's usage and fantasy average on the same source row.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const round = value => Number(value.toFixed(1));
    const yearOf = value => /^\d{4}$/.test(String(value ?? '')) ? Number(value) : null;
    const metadata = new Set(['gp', 'season', 'season_type', 'week', 'player_id', 'team_id', 'game_id']);

    function source(raw, expectedYear, calcPPG) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const native = raw._mflScoring;
        const reportedYear = yearOf(native?.season ?? raw.season);
        // A cache from another year must not acquire the requested year's label.
        if (reportedYear !== null && expectedYear !== null && reportedYear !== expectedYear) return null;
        if (native?.week != null || raw.week != null) return null;
        const games = finite(raw.gp);
        const hasRaw = Object.entries(raw).some(([key, value]) => !metadata.has(key) && finite(value) !== null);
        let ppg = null;
        if (native) {
            // MFL's native season average remains usable when GP is unreported.
            // Missing native scoring must not become a zero from raw NFL stats.
            ppg = finite(native.average);
            if (ppg === null && games > 0 && finite(native.points) !== null) ppg = native.points / games;
        } else if (games > 0 && hasRaw && typeof calcPPG === 'function') {
            try { ppg = finite(calcPPG(raw)); } catch (_) { /* unavailable */ }
        }
        if (ppg === null && games === null && !hasRaw && !native) return null;
        return { raw, ppg: ppg === null ? null : round(ppg), games, native: !!native, season: expectedYear };
    }

    function usageFor(raw, games, position) {
        if (!raw || !(games > 0)) return [];
        const pick = (...keys) => {
            for (const key of keys) { const value = finite(raw[key]); if (value !== null) return value; }
            return null;
        };
        const sum = (...values) => values.every(value => value !== null) ? values.reduce((a, b) => a + b, 0) : null;
        const pos = String(position || '').toUpperCase();
        const normalized = ({ DT: 'DL', DE: 'DL', NT: 'DL', EDGE: 'DL', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DST: 'DEF', 'D/ST': 'DEF' })[pos] || pos;
        const solo = pick('idp_tkl_solo', 'tkl_solo'), assists = pick('idp_tkl_ast', 'tkl_ast');
        const tackles = sum(solo, assists);
        const candidates = normalized === 'QB'
            ? [['Pass yards', pick('pass_yd')], ['Rush yards', pick('rush_yd')], ['Pass TDs', pick('pass_td')], ['Pass attempts', pick('pass_att')], ['Interceptions thrown', pick('pass_int')], ['Carries', pick('rush_att')], ['Rush TDs', pick('rush_td')]]
            : normalized === 'RB'
                ? [['Touches', sum(pick('rush_att'), pick('rec'))], ['Scrimmage yards', sum(pick('rush_yd'), pick('rec_yd'))], ['Rush yards', pick('rush_yd')], ['Carries', pick('rush_att')], ['Targets', pick('rec_tgt')], ['Receptions', pick('rec')], ['Rec yards', pick('rec_yd')], ['Rush TDs', pick('rush_td')], ['Rec TDs', pick('rec_td')]]
                : ['WR', 'TE'].includes(normalized)
                    ? [['Targets', pick('rec_tgt')], ['Rec yards', pick('rec_yd')], ['Receptions', pick('rec')], ['Rec TDs', pick('rec_td')]]
                    : ['DL', 'LB', 'DB'].includes(normalized)
                        ? [['Tackles', tackles], [normalized === 'DB' ? 'Passes defended' : 'Sacks', normalized === 'DB' ? pick('idp_pass_def', 'pass_def') : pick('idp_sack', 'sack')], ['Solo tackles', solo], ['Assisted tackles', assists], ['Interceptions', pick('idp_int', 'int')], ['Forced fumbles', pick('idp_ff', 'ff')]]
                        : normalized === 'DEF'
                            ? [['Sacks', pick('sack')], ['Interceptions', pick('int')], ['Forced fumbles', pick('ff')]]
                            : normalized === 'K'
                                ? [['FG made', pick('fgm')], ['FG attempts', pick('fga')], ['Extra points', pick('xpm')]] : [];
        return candidates.filter(([, value]) => value !== null)
            .map(([label, value]) => ({ label, value: round(value / games), unit: '/game' }));
    }

    function recentFor(pid, weeklyHistory) {
        if (typeof weeklyHistory !== 'function') return [];
        let history;
        try { history = weeklyHistory(pid); } catch (_) { return []; }
        if (!Array.isArray(history)) return [];
        const byWeek = new Map();
        history.forEach(game => {
            const week = finite(game?.week), pts = finite(game?.pts);
            if (week !== null && Number.isInteger(week) && week > 0 && week <= 18 && pts !== null) byWeek.set(week, { week, pts });
        });
        return [...byWeek.values()].sort((a, b) => a.week - b.week).slice(-5);
    }

    // calcPPG receives a raw row; callers bind league scoring to that callback.
    // weeklyHistory receives pid and must already scope completed games to the
    // active league/season, as App.WeeklyProj.weeklyHistory does.
    function summarize(options) {
        const { pid, statsData, priorData, season, priorStatsSeason, calcPPG, weeklyHistory, position } = options || {};
        const currentYear = yearOf(season);
        const priorYear = currentYear === null ? null : currentYear - 1;
        const current = source(statsData?.[pid], currentYear, calcPPG);
        const prior = priorStatsSeason != null && yearOf(priorStatsSeason) !== priorYear ? null : source(priorData?.[pid], priorYear, calcPPG);
        const selected = current?.ppg !== null && current?.ppg !== undefined ? current
            : prior?.ppg !== null && prior?.ppg !== undefined ? prior : current || prior;
        const selectedYear = selected?.season ?? currentYear;
        const ppg = selected?.ppg ?? null;
        const games = selected?.games ?? null;
        const fallback = selected === prior && !!prior;
        const yearLabel = selectedYear === null ? 'Season' : String(selectedYear);
        const sourceLabel = !selected ? 'Stats unavailable'
            : [yearLabel, games === null ? 'games unreported' : games + (games === 1 ? ' game' : ' games'),
                selected.native ? 'MFL scoring' : 'league scoring', fallback ? 'prior season' : null,
                ppg === null ? 'PPG unavailable' : null].filter(Boolean).join(' · ');
        const recentGames = recentFor(pid, weeklyHistory);
        const usageMetrics = usageFor(selected?.raw, games, position);
        return {
            ppg, season: selectedYear, games, ppgLabel: yearLabel + ' PPG', sourceLabel,
            // Model metadata uses zero both for flat and unavailable. Only
            // observed, adjacent-year PPG in this scoring format proves YoY.
            trend: current?.ppg != null && prior?.ppg > 0 && currentYear !== null
                ? Math.round((current.ppg - prior.ppg) / prior.ppg * 100) : null,
            recentGames,
            recentPPG: recentGames.length ? round(recentGames.reduce((sum, game) => sum + game.pts, 0) / recentGames.length) : null,
            usage: usageMetrics.slice(0, 2), usageMetrics,
        };
    }

    App.PlayerComparison = { summarize };
})(typeof window !== 'undefined' ? window : globalThis);
