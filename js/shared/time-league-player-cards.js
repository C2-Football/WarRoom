// ══════════════════════════════════════════════════════════════════
// time-league-player-cards.js — tolerant loader/validator for the bundled
// per-player career cards (data/time-league/player-cards.json). The payload
// is untrusted at runtime — the file may be absent, stale, or hand-edited —
// so parsing skips malformed entries rather than failing the whole index.
//
// Ported from The Duat's app/player-cards.ts.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { normalizePlayerPosition } = App.TimeLeagueRoster;

    const finiteNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const nonEmptyString = (value) => (typeof value === "string" && value.trim() ? value : null);

    const SEASON_KEYS = ["season", "games", "passYd", "passTd", "passInt", "rushYd", "rushTd", "rec", "recYd", "recTd", "points"];
    const BIO_KEYS = ["college", "height", "weight", "birthDate", "draftTeam", "draftYear", "hofYear"];

    function parseCardSeason(value) {
        if (!value || typeof value !== "object") return null;
        const row = value;
        const season = {};
        for (const key of SEASON_KEYS) {
            const parsed = finiteNumber(row[key]);
            if (parsed === null) return null;
            season[key] = parsed;
        }
        return season;
    }

    function parseCardBio(value) {
        if (!value || typeof value !== "object") return undefined;
        const row = value;
        const bio = {};
        for (const key of BIO_KEYS) {
            const parsed = nonEmptyString(row[key]);
            if (parsed !== null) bio[key] = parsed;
        }
        return Object.keys(bio).length ? bio : undefined;
    }

    function parsePlayerCard(value) {
        if (!value || typeof value !== "object") return null;
        const row = value;
        const identity = nonEmptyString(row.identity);
        const name = nonEmptyString(row.name);
        const position = normalizePlayerPosition(row.position);
        if (!identity || !name || !position || !Array.isArray(row.seasons)) return null;
        const seasons = row.seasons
            .map(parseCardSeason)
            .filter((season) => season !== null)
            .sort((left, right) => left.season - right.season);
        // Peak is derived rather than trusted so it always matches the kept seasons.
        const peak = seasons.reduce((max, season) => Math.max(max, season.points), 0);
        const bio = parseCardBio(row.bio);
        const card = { identity, name, position, seasons, peak };
        return bio ? { ...card, bio } : card;
    }

    function buildPlayerCardIndex(payload) {
        const players = payload && typeof payload === "object" && Array.isArray(payload.players) ? payload.players : [];
        const index = new Map();
        for (const entry of players) {
            const card = parsePlayerCard(entry);
            if (card) index.set(card.identity, card);
        }
        return index;
    }

    async function loadPlayerCards() {
        try {
            const response = await fetch("data/time-league/player-cards.json");
            if (!response.ok) return new Map();
            return buildPlayerCardIndex(await response.json());
        } catch {
            return new Map();
        }
    }

    const api = { buildPlayerCardIndex, loadPlayerCards };
    App.TimeLeaguePlayerCards = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
