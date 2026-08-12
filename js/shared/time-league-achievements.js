// ══════════════════════════════════════════════════════════════════
// js/shared/time-league-achievements.js — window.App.TimeLeagueAchievements
//
// Mirrors War Room's real achievement system (js/shared/achievements.js):
// a catalog of { id, tier, icon, label, description, target, eval(stats) }
// entries, evaluated fresh against derived stats rather than persisted as
// "unlocked" flags — same shape as WrAchievements.catalog/computeStats/
// evaluate/tierLabel/tierColor, consumed the same way (my-trophies.js's
// chip grid, trophy-room.js's renderAchievementsCard).
//
// War Room's real catalog draws stats from dhq_hist/HOF/championships,
// which track a roster across many seasons of one persistent league. Time
// League has no equivalent: each league is a single, self-contained 14-week
// season with no cross-league identity for a team to carry forward, so
// this catalog is scoped to one league's own state instead — standings,
// finalized weeks, roster, trades and waiver adds already produced by
// js/shared/time-league-engine.js.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // Each entry: { id, icon, label, description, tier, target, eval(stats) }
    //   tier: 'season' | 'performance' | 'roster' | 'desk'
    //   target: numeric goal used for progress bars
    //   eval(stats) → { value: number, progress: 0-1 }
    const CATALOG = [
        // ── Season ────────────────────────────────────────────────
        {
            id: 'champion', tier: 'season', icon: '👑',
            label: 'Champion', description: 'Won the league title',
            target: 1,
            eval: (s) => ({ value: s.champion ? 1 : 0, progress: s.champion ? 1 : 0 }),
        },
        {
            id: 'runner_up', tier: 'season', icon: '🥈',
            label: 'Runner-Up', description: 'Finished the season in 2nd place',
            target: 1,
            eval: (s) => ({ value: s.runnerUp ? 1 : 0, progress: s.runnerUp ? 1 : 0 }),
        },
        {
            id: 'undefeated', tier: 'season', icon: '⚡',
            label: 'Undefeated', description: 'Won every regular-season game',
            target: 1,
            eval: (s) => {
                const perfect = s.seasonComplete && s.wins > 0 && s.losses === 0 && s.ties === 0;
                return { value: perfect ? 1 : 0, progress: perfect ? 1 : 0 };
            },
        },
        {
            id: 'hot_streak', tier: 'season', icon: '🔥',
            label: 'Hot Streak', description: 'Rode a 4-game winning streak',
            target: 4,
            eval: (s) => ({ value: s.bestWinStreak, progress: Math.min(1, s.bestWinStreak / 4) }),
        },

        // ── Performance ───────────────────────────────────────────
        {
            id: 'ironclad', tier: 'performance', icon: '🛡️',
            label: 'Ironclad', description: 'Posted a 150+ point week',
            target: 150,
            eval: (s) => ({ value: s.seasonHigh, progress: Math.min(1, s.seasonHigh / 150) }),
        },
        {
            id: 'blowout_artist', tier: 'performance', icon: '💥',
            label: 'Blowout Artist', description: 'Won a matchup by 40+ points',
            target: 40,
            eval: (s) => ({ value: s.bestMargin, progress: Math.min(1, s.bestMargin / 40) }),
        },
        {
            id: 'thousand_club', tier: 'performance', icon: '📊',
            label: '1,000 Club', description: 'Cleared 1,000 total points for the season',
            target: 1000,
            eval: (s) => ({ value: s.pointsFor, progress: Math.min(1, s.pointsFor / 1000) }),
        },

        // ── Roster ────────────────────────────────────────────────
        {
            id: 'time_traveler', tier: 'roster', icon: '🕰️',
            label: 'Time Traveler', description: 'Rostered players from 4+ different decades at once',
            target: 4,
            eval: (s) => ({ value: s.decadeSpread, progress: Math.min(1, s.decadeSpread / 4) }),
        },
        {
            id: 'relic_hunter', tier: 'roster', icon: '🦴',
            label: 'Relic Hunter', description: 'Rostered a player from a season before 1990',
            target: 1,
            eval: (s) => ({ value: s.preNinetyEntries, progress: s.preNinetyEntries >= 1 ? 1 : 0 }),
        },

        // ── Desk ──────────────────────────────────────────────────
        {
            id: 'dealmaker', tier: 'desk', icon: '🤝',
            label: 'Dealmaker', description: 'Completed 2+ trades',
            target: 2,
            eval: (s) => ({ value: s.tradesAccepted, progress: Math.min(1, s.tradesAccepted / 2) }),
        },
        {
            id: 'wire_wizard', tier: 'desk', icon: '📡',
            label: 'Wire Wizard', description: 'Landed 3+ waiver claims',
            target: 3,
            eval: (s) => ({ value: s.waiverAdds, progress: Math.min(1, s.waiverAdds / 3) }),
        },
    ];

    /** Derives every stat the catalog needs from one league's own state, for one team. */
    function computeStats(league, teamId) {
        const Engine = App.TimeLeagueEngine;
        const EraRules = App.TimeLeagueEraRules;
        const standings = Engine.computeStandings(league);
        const standing = standings.find((s) => s.teamId === teamId) ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0 };
        const team = league.teams.find((t) => t.teamId === teamId);
        const seasonComplete = league.phase === 'complete';
        const champion = seasonComplete && league.championTeamId === teamId;
        const runnerUp = seasonComplete && !champion && standings[1]?.teamId === teamId;

        let bestWinStreak = 0, currentRun = 0, seasonHigh = 0, bestMargin = 0;
        for (const week of league.finalizedWeeks) {
            const result = week.results.find((r) => r.teamId === teamId);
            if (result) seasonHigh = Math.max(seasonHigh, result.total);
            const matchup = week.matchups.find((m) => m.home === teamId || m.away === teamId);
            if (!matchup) continue;
            const won = matchup.winner === teamId;
            if (won) {
                currentRun += 1;
                bestWinStreak = Math.max(bestWinStreak, currentRun);
                const margin = matchup.home === teamId ? matchup.homePoints - matchup.awayPoints : matchup.awayPoints - matchup.homePoints;
                bestMargin = Math.max(bestMargin, margin);
            } else {
                currentRun = 0;
            }
        }

        const decades = new Set();
        let preNinetyEntries = 0;
        for (const entry of (team?.roster ?? [])) {
            const decade = EraRules.decadeOf(entry.drawnSeason);
            if (decade) decades.add(decade);
            if (entry.drawnSeason < 1990) preNinetyEntries += 1;
        }

        const tradesAccepted = league.trades.filter((t) => t.status === 'accepted' && (t.fromTeamId === teamId || t.toTeamId === teamId)).length;
        const waiverAdds = (team?.roster ?? []).filter((e) => e.acquiredVia === 'waiver').length;

        return {
            champion, runnerUp, seasonComplete,
            wins: standing.wins, losses: standing.losses, ties: standing.ties, pointsFor: standing.pointsFor,
            bestWinStreak, seasonHigh, bestMargin,
            decadeSpread: decades.size, preNinetyEntries,
            tradesAccepted, waiverAdds,
        };
    }

    // ── Evaluate every achievement against stats ──────────────────
    // Returns { earned: [], unearned: [] } each [{ ...achievement, value, progress }]
    function evaluate(stats) {
        const earned = [];
        const unearned = [];
        CATALOG.forEach((a) => {
            const result = a.eval(stats);
            const item = { ...a, value: result.value, progress: result.progress };
            if (result.progress >= 1) earned.push(item);
            else unearned.push(item);
        });
        return { earned, unearned };
    }

    function tierLabel(tier) {
        return ({ season: 'Season', performance: 'Performance', roster: 'Roster', desk: 'Desk' })[tier] || tier;
    }

    function tierColor(tier) {
        return ({ season: 'var(--gold)', performance: 'var(--good)', roster: 'var(--info)', desk: '#9B8AFB' })[tier] || 'var(--gold)';
    }

    const api = { catalog: CATALOG, computeStats, evaluate, tierLabel, tierColor };
    App.TimeLeagueAchievements = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
