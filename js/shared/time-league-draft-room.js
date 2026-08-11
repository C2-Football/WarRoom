// ══════════════════════════════════════════════════════════════════
// time-league-draft-room.js — draft-order + roster-slot-assignment
// primitives for Time League. Ported from The Duat's
// app/draft-room-engine.ts, trimmed to the exports Time League actually
// uses (that source file also serves Duat's main dynasty draft room, which
// this feature has no connection to).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { expandRosterSlots, SLOT_ELIGIBILITY } = App.TimeLeagueRoster;

    /** Stable across provider/fallback IDs and harmless punctuation differences. */
    function canonicalPlayerIdentity(player) {
        const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
        const normalizedName = player.name
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim()
            .split(/\s+/)
            .filter((part) => part && !suffixes.has(part))
            .join("");
        return `player:${player.position}:${normalizedName}`;
    }

    /**
     * Creates the complete seat schedule up front. Time League only uses
     * snake drafts, but the `type` param is kept for parity with the source.
     */
    function createDraftOrder(teamIds, rounds, type) {
        const cleanTeams = teamIds.filter(Boolean);
        const cleanRounds = Math.max(0, Math.floor(Number(rounds) || 0));
        const order = [];
        for (let round = 1; round <= cleanRounds; round += 1) {
            const reversed = type === "snake" && round % 2 === 0;
            const roundTeams = reversed ? [...cleanTeams].reverse() : [...cleanTeams];
            roundTeams.forEach((teamId, index) => {
                const originalSlot = cleanTeams.indexOf(teamId) + 1;
                order.push({
                    overall: order.length + 1,
                    round,
                    pickInRound: index + 1,
                    teamId,
                    originalSlot,
                });
            });
        }
        return order;
    }

    function findOpenRosterSlot(position, assignedSlots, rosterSlots, maxQuarterbacks = Number.POSITIVE_INFINITY, draftedPositions = []) {
        if (position === "QB" && draftedPositions.filter((item) => item === "QB").length >= maxQuarterbacks) return null;
        const openSlots = expandRosterSlots(rosterSlots);
        const used = new Map();
        assignedSlots.forEach((slot) => used.set(slot, (used.get(slot) ?? 0) + 1));
        const slot = openSlots.find((candidate) => (
            (used.get(candidate) ?? 0) < openSlots.filter((item) => item === candidate).length
            && SLOT_ELIGIBILITY[candidate].includes(position)
        ));
        return slot ? { slot, slotIndex: openSlots.indexOf(slot) } : null;
    }

    function toggleDraftQueue(queue, playerId) {
        if (!playerId) return [...queue];
        return queue.includes(playerId) ? queue.filter((id) => id !== playerId) : [...queue, playerId];
    }

    const api = { canonicalPlayerIdentity, createDraftOrder, findOpenRosterSlot, toggleDraftQueue };
    App.TimeLeagueDraftRoom = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
