// ══════════════════════════════════════════════════════════════════
// time-league-types.js — Time League localStorage key constants.
// Ported from The Duat's app/time-league-types.ts (that file is almost
// entirely TS type declarations; only these two runtime exports survive).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const TIME_LEAGUE_INDEX_KEY = "wr-time-leagues-v1";
    const timeLeagueStorageKey = (leagueId) => `wr-time-league-v1:${leagueId}`;

    const api = { TIME_LEAGUE_INDEX_KEY, timeLeagueStorageKey };
    App.TimeLeagueTypes = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
