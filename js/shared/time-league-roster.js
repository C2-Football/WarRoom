// ══════════════════════════════════════════════════════════════════
// time-league-roster.js — roster-slot primitives + seeded RNG for Time
// League. Ported from The Duat's app/roster-build.ts, trimmed to only the
// exports Time League actually uses (that source file also carries dynasty
// "army"/lottery/provider-import logic that has no bearing here).
// Pure, no browser/network/storage dependencies.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const ROSTER_SLOT_IDS = [
        "QB", "RB", "WR", "TE", "FLEX", "REC_FLEX", "SUPER_FLEX",
        "K", "DEF", "DL", "LB", "DB", "IDP_FLEX", "BN", "IR", "TAXI",
    ];

    const SLOT_ELIGIBILITY = {
        QB: ["QB"],
        RB: ["RB"],
        WR: ["WR"],
        TE: ["TE"],
        FLEX: ["RB", "WR", "TE"],
        REC_FLEX: ["WR", "TE"],
        SUPER_FLEX: ["QB", "RB", "WR", "TE"],
        K: ["K"],
        DEF: ["DEF"],
        DL: ["DL"],
        LB: ["LB"],
        DB: ["DB"],
        IDP_FLEX: ["DL", "LB", "DB"],
        BN: ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"],
        IR: ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"],
        TAXI: ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"],
    };

    const EMPTY_ROSTER_SLOTS = {
        QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, REC_FLEX: 0, SUPER_FLEX: 0,
        K: 0, DEF: 0, DL: 0, LB: 0, DB: 0, IDP_FLEX: 0, BN: 0, IR: 0, TAXI: 0,
    };

    const RESERVE_SLOTS = new Set(["IR", "TAXI"]);
    const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

    function finiteCount(value, maximum = 64) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        return Math.min(maximum, Math.max(0, Math.floor(number)));
    }

    function normalizeSlotName(value) {
        const raw = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
        const aliases = {
            BE: "BN", BENCH: "BN", RESERVE: "IR", DST: "DEF", "D/ST": "DEF",
            SUPERFLEX: "SUPER_FLEX", OP: "SUPER_FLEX", QB_FLEX: "SUPER_FLEX",
            WRRB_FLEX: "FLEX", WRRBTE_FLEX: "FLEX", "W/R/T": "FLEX", WRT: "FLEX", "W/R": "FLEX",
            REC: "REC_FLEX", IDP: "IDP_FLEX",
        };
        const normalized = aliases[raw] ?? raw;
        return ROSTER_SLOT_IDS.includes(normalized) ? normalized : null;
    }

    function normalizeRosterSlots(input) {
        const result = { ...EMPTY_ROSTER_SLOTS };
        if (Array.isArray(input)) {
            for (const raw of input) {
                const slot = normalizeSlotName(String(raw));
                if (slot) result[slot] += 1;
            }
            return result;
        }
        if (!input || typeof input !== "object") return result;
        for (const [raw, count] of Object.entries(input)) {
            const slot = normalizeSlotName(raw);
            if (slot) result[slot] = finiteCount(count);
        }
        return result;
    }

    function expandRosterSlots(input, options = {}) {
        const counts = normalizeRosterSlots(input);
        return ROSTER_SLOT_IDS.flatMap((slot) => {
            if (!options.includeReserveSlots && RESERVE_SLOTS.has(slot)) return [];
            return Array.from({ length: counts[slot] }, () => slot);
        });
    }

    function normalizePlayerPosition(value) {
        const raw = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
        const aliases = {
            DST: "DEF", "D/ST": "DEF", TEAM_DEFENSE: "DEF",
            DE: "DL", DT: "DL", NT: "DL", EDGE: "DL",
            CB: "DB", S: "DB", FS: "DB", SS: "DB",
            ILB: "LB", OLB: "LB", MLB: "LB",
            // Historical archives label the skill positions by their era's names.
            HB: "RB", FB: "RB", TB: "RB", FL: "WR", SE: "WR", PK: "K",
        };
        const normalized = aliases[raw] ?? raw;
        return POSITION_ORDER.includes(normalized) ? normalized : null;
    }

    /** FNV-1a plus Mulberry32: compact, deterministic, and suitable for UI simulation. */
    function createSeededRandom(seed) {
        const text = String(seed);
        let state = 0x811c9dc5;
        for (let index = 0; index < text.length; index += 1) {
            state ^= text.charCodeAt(index);
            state = Math.imul(state, 0x01000193);
        }
        state >>>= 0;
        return () => {
            state = (state + 0x6d2b79f5) >>> 0;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    const api = {
        ROSTER_SLOT_IDS,
        SLOT_ELIGIBILITY,
        normalizeRosterSlots,
        expandRosterSlots,
        normalizePlayerPosition,
        createSeededRandom,
    };
    App.TimeLeagueRoster = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
