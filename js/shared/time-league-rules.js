// ══════════════════════════════════════════════════════════════════
// time-league-rules.js — framework-free rule constants for Time League.
// Ported from The Duat's app/league-rules-types.ts (that file is almost
// entirely TS type declarations; only the runtime pieces below survive).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    function defaultEraDraftRules() {
        return { mode: "any-era", decades: [] };
    }

    const MAX_LOGO_BYTES = 64_000;
    const LOGO_EDGE_PX = 160;

    const api = { defaultEraDraftRules, MAX_LOGO_BYTES, LOGO_EDGE_PX };
    App.TimeLeagueRules = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
