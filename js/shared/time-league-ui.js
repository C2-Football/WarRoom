// ══════════════════════════════════════════════════════════════════
// js/shared/time-league-ui.js — small pure UI-derivation helpers shared
// across every Time League panel: team avatar (initials + deterministic
// color, stable per league regardless of team order changes) and the
// era-coded color/label used on player tiles. Eager, plain JS, no
// dependencies beyond the era-rules module already loaded before it.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const AVATAR_PALETTE = [
        '#D4AF37', '#e05a4e', '#5DADE2', '#F0A500', '#2ECC71', '#9B8AFB',
        '#4fb3a9', '#e0824f', '#7d9be0', '#c46fd1',
    ];

    /** Two letters: first letter of the first two words, or first two chars of a single word. */
    function initialsOf(name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return '??';
    }

    /** Stable per team regardless of draft/scoring order — keyed by teamId's position in the roster. */
    function avatarFor(team, allTeams) {
        const index = Math.max(0, (allTeams || []).findIndex((item) => item.teamId === team.teamId));
        return { initials: initialsOf(team.name), color: AVATAR_PALETTE[index % AVATAR_PALETTE.length] };
    }

    const ERA_COLORS = {
        '1970s': '#b08d57', '1980s': '#d97742', '1990s': '#3aa6a6',
        '2000s': '#4f7cbf', '2010s': '#5d8fe0', '2020s': '#d4af37',
    };
    const DECADE_LABEL = { '1970s': '70s', '1980s': '80s', '1990s': '90s', '2000s': '00s', '2010s': '10s', '2020s': '20s' };

    /** Falls back to the gold accent for anything outside the bundled corpus (pre-1970). */
    function eraColorOf(season) {
        const decade = App.TimeLeagueEraRules?.decadeOf(season);
        return (decade && ERA_COLORS[decade]) || '#D4AF37';
    }

    function decadeLabelOf(season) {
        const decade = App.TimeLeagueEraRules?.decadeOf(season);
        return (decade && DECADE_LABEL[decade]) || '';
    }

    /** Walks finalized weeks in chronological order; resets when the result type changes. */
    function streakFor(league, teamId) {
        let kind = null;
        let count = 0;
        for (const week of league.finalizedWeeks) {
            const matchup = week.matchups.find((m) => m.home === teamId || m.away === teamId);
            if (!matchup) continue;
            const result = matchup.winner === null ? 'T' : matchup.winner === teamId ? 'W' : 'L';
            if (result === kind) count += 1;
            else { kind = result; count = 1; }
        }
        return kind ? { kind, count } : null;
    }

    const api = { avatarFor, initialsOf, eraColorOf, decadeLabelOf, streakFor };
    App.TimeLeagueUI = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
