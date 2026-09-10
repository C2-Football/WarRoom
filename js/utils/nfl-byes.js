/* global module */
// Season-scoped NFL bye data. Verified 2026-09-08 against:
// https://www.nfl.com/news/2026-nfl-schedule-release-every-team-bye-week
// Never reuse an undated player bye field in a different season.
(function(root) {
    'use strict';
    const App = root.App = root.App || {};
    const schedules = {
        2026: {
            CAR: 5, KC: 5, CIN: 6, DET: 6, MIA: 6, MIN: 6,
            BUF: 7, JAX: 7, LAC: 7, WAS: 7, HOU: 8, NO: 8, NYG: 8, SF: 8,
            PIT: 9, TEN: 9, CHI: 10, DEN: 10, PHI: 10, TB: 10,
            ATL: 11, CLE: 11, GB: 11, LAR: 11, NE: 11, SEA: 11,
            BAL: 13, IND: 13, LV: 13, NYJ: 13, ARI: 14, DAL: 14,
        },
    };
    function seasonFor(league) {
        return Number(league?.season || root.S?.currentLeague?.season || root.S?.nflState?.season) || new Date().getFullYear();
    }
    function weekForPlayer(player, season = seasonFor()) {
        if (!player?.team) return null;
        const raw = String(player.team).trim().toUpperCase();
        const team = ({ LA: 'LAR', JAC: 'JAX', WSH: 'WAS', AZ: 'ARI', OAK: 'LV', SD: 'LAC' })[raw] || raw;
        const known = schedules[Number(season)]?.[team];
        if (known) return known;
        const field = Number(player.bye_week);
        return Number(player.bye_season) === Number(season) && Number.isInteger(field) && field >= 1 && field <= 18 ? field : null;
    }
    function label(player, season = seasonFor()) {
        const week = weekForPlayer(player, season);
        return week ? 'Bye W' + week : 'Bye —';
    }
    function rosterWeeks(roster, players, season, currentWeek = 1) {
        const groups = new Map();
        const unknown = [];
        for (const pid of new Set((roster?.players || []).map(String))) {
            const week = weekForPlayer(players?.[pid], season);
            if (!week) { unknown.push(pid); continue; }
            if (week < currentWeek) continue;
            if (!groups.has(week)) groups.set(week, { week, pids: [] });
            groups.get(week).pids.push(pid);
        }
        return { weeks: [...groups.values()].sort((a,b) => a.week - b.week), unknown };
    }
    App.NFLByes = { seasonFor, weekForPlayer, label, rosterWeeks };
    if (typeof module !== 'undefined' && module.exports) module.exports = App.NFLByes;
})(typeof window !== 'undefined' ? window : globalThis);
