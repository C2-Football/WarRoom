// ══════════════════════════════════════════════════════════════════
// time-league-ai.js — AI managers for Time League. Every function is pure
// and deterministic: randomness flows from createSeededRandom keyed off
// `state.seed` plus a stable context (overall pick, week, trade id), so a
// league replays exactly.
//
// Ported from The Duat's app/time-league-ai.ts.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { findOpenRosterSlot } = App.TimeLeagueDraftRoom;
    const { createSeededRandom, ROSTER_SLOT_IDS, SLOT_ELIGIBILITY } = App.TimeLeagueRoster;
    const {
        currentDraftSeat, eraEligibleCards, autoFillLineup, rosterCapacity, freeAgents,
        submitWaiverClaim, respondToTrade, proposeTrade,
    } = App.TimeLeagueEngine;

    const AI_PERSONAS = {
        warlord: { label: "The Warlord", aggression: 92, patience: 18, riskTolerance: 70, tell: "Pays up for proven week-winners. Hates waiting." },
        archivist: { label: "The Archivist", aggression: 28, patience: 88, riskTolerance: 22, tell: "Moves only when the ledger says value. Never chases." },
        gambler: { label: "The Gambler", aggression: 64, patience: 12, riskTolerance: 96, tell: "Swings at ceilings and thin odds. Variance is the plan." },
        steward: { label: "The Steward", aggression: 45, patience: 78, riskTolerance: 40, tell: "Balanced builds, measured trades. Protects the floor." },
    };

    const STARTER_SLOTS = ROSTER_SLOT_IDS.filter((slot) => slot !== "BN" && slot !== "IR" && slot !== "TAXI");
    const NEED_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

    const personaFor = (team) => AI_PERSONAS[team?.aiPersona ?? "steward"];

    /** Accept when incoming covers outgoing x threshold: bold personas take thin wins (~0.95), careful ones demand a premium (~1.04). */
    const acceptThreshold = (persona) => 1.08 - 0.16 * ((persona.aggression + persona.riskTolerance) / 200);

    /** Patient personas demand a bigger upgrade before spending a waiver claim. */
    const waiverMargin = (persona) => 1.05 + (persona.patience / 100) * 0.35;

    const pickPhrase = (seedKey, pool) => pool[Math.floor(createSeededRandom(seedKey)() * pool.length)];

    const pushActivity = (state, kind, message, createdAt) => {
        const last = state.activity.reduce((max, event) => {
            const value = Number(event.id.slice(1));
            return Number.isFinite(value) ? Math.max(max, value) : max;
        }, 0);
        return { ...state, activity: [...state.activity, { id: `a${last + 1}`, week: state.currentWeek, kind, message, createdAt }] };
    };

    function entryValueFromCard(card, drawnSeason) {
        if (!card) return 0;
        if (drawnSeason !== undefined) {
            const drawn = card.seasons.find((item) => item.season === drawnSeason);
            if (drawn) return drawn.points;
        }
        return card.peak;
    }

    const entryValue = (cards, entry) => entryValueFromCard(cards.get(entry.identity), entry.drawnSeason);
    const sumValue = (cards, entries) => entries.reduce((sum, entry) => sum + entryValue(cards, entry), 0);
    const bestName = (cards, entries, fallback) =>
        [...entries].sort((left, right) => entryValue(cards, right) - entryValue(cards, left))[0]?.name ?? fallback;

    const starterEligible = (settings, position) =>
        STARTER_SLOTS.some((slot) => (settings.rosterSlots[slot] ?? 0) > 0 && SLOT_ELIGIBILITY[slot].includes(position));

    function aiDraftChoice(state, cards) {
        const seat = state.phase === "draft" ? currentDraftSeat(state) : null;
        const team = seat ? state.teams.find((item) => item.teamId === seat.teamId) : undefined;
        if (!seat || !team) return null;
        const assignedSlots = team.roster.map((entry) => entry.slot);
        const positions = team.roster.map((entry) => entry.position);
        const openBySlot = new Map();
        for (const slot of STARTER_SLOTS) {
            const room = (state.settings.rosterSlots[slot] ?? 0) - assignedSlots.filter((assigned) => assigned === slot).length;
            if (room > 0) openBySlot.set(slot, room);
        }
        const noise = createSeededRandom(`${state.seed}:aidraft:${seat.overall}`);
        const amp = 0.2 + (personaFor(team).riskTolerance / 100) * 0.3;
        let best = null;
        // The era-eligible board is the whole world for an AI GM: undrafted cards
        // that the league's decades can actually field.
        for (const card of eraEligibleCards(state, cards)) {
            if (!findOpenRosterSlot(card.position, assignedSlots, state.settings.rosterSlots, state.settings.maxQuarterbacks, positions)) continue;
            let openStarters = 0;
            for (const [slot, room] of openBySlot) {
                if (SLOT_ELIGIBILITY[slot].includes(card.position)) openStarters += room;
            }
            const score = card.peak * (openStarters > 0 ? 1 + 0.5 * openStarters : 0.4) + noise() * amp;
            if (!best || score > best.score) best = { card, score };
        }
        return best?.card ?? null;
    }

    function aiPrepareWeek(state, cards) {
        return state.teams.reduce((next, team) => (team.manager === "ai" ? autoFillLineup(next, team.teamId, cards) : next), state);
    }

    function aiSubmitWaiverClaims(state, cards, createdAt) {
        if (state.phase !== "season" || !state.settings.waiversEnabled) return state;
        const capacity = rosterCapacity(state.settings);
        // freeAgents already drops era-ineligible cards, so the wire an AI reads
        // is exactly the wire a human sees.
        const pool = freeAgents(state, cards);
        return state.teams.reduce((next, team) => {
            if (team.manager !== "ai") return next;
            if (next.pendingClaims.some((claim) => claim.teamId === team.teamId && claim.week === next.currentWeek)) return next;
            const weakest = team.roster.reduce((low, entry) => {
                if (!starterEligible(next.settings, entry.position)) return low;
                const value = entryValue(cards, entry);
                return value < low ? value : low;
            }, Number.POSITIVE_INFINITY);
            const bar = (Number.isFinite(weakest) ? weakest : 0) * waiverMargin(personaFor(team));
            // Adds always land on the bench, so a full BENCH needs a drop even when
            // the roster itself is under capacity — otherwise the claim is doomed.
            const benchFull = team.roster.filter((entry) => entry.slot === "BN").length >= (next.settings.rosterSlots.BN ?? 0);
            const needsDrop = team.roster.length >= capacity || benchFull;
            const drop = needsDrop
                ? team.roster
                    .filter((entry) => entry.slot === "BN")
                    .sort((left, right) => entryValue(cards, left) - entryValue(cards, right) || left.entryId.localeCompare(right.entryId))[0]
                : undefined;
            if (needsDrop && !drop) return next;
            const quarterbacks = team.roster.filter((entry) => entry.position === "QB").length;
            const target = pool.find((card) => (
                card.seasons.length > 0
                && starterEligible(next.settings, card.position)
                && !(card.position === "QB" && quarterbacks >= next.settings.maxQuarterbacks)
                && card.peak >= bar
            ));
            if (!target) return next;
            return submitWaiverClaim(next, {
                teamId: team.teamId,
                addIdentity: target.identity,
                addName: target.name,
                addPosition: target.position,
                dropEntryId: drop?.entryId ?? "",
            }, createdAt);
        }, state);
    }

    function resolveAiTrade(state, trade, cards, createdAt) {
        const from = state.teams.find((team) => team.teamId === trade.fromTeamId);
        const to = state.teams.find((team) => team.teamId === trade.toTeamId);
        if (!from || !to || trade.status !== "pending") return state;
        const persona = personaFor(to);
        const incoming = trade.giveEntryIds.flatMap((id) => from.roster.find((entry) => entry.entryId === id) ?? []);
        const outgoing = trade.receiveEntryIds.flatMap((id) => to.roster.find((entry) => entry.entryId === id) ?? []);
        const complete = incoming.length === trade.giveEntryIds.length && outgoing.length === trade.receiveEntryIds.length;
        const accept = complete && sumValue(cards, incoming) >= sumValue(cards, outgoing) * acceptThreshold(persona);
        const inName = bestName(cards, incoming, "That package");
        const outName = bestName(cards, outgoing, "my starter");
        const note = accept
            ? pickPhrase(`${state.seed}:ainote:${trade.tradeId}`, [
                `${inName}'s ceiling beats ${outName}. Done.`,
                `${inName} starts for me. Send it.`,
                `Ledger clears — ${inName} over ${outName}. Accepted.`,
            ])
            : pickPhrase(`${state.seed}:ainote:${trade.tradeId}`, [
                "You're selling the floor I need. Pass.",
                `${outName} beats ${inName} straight up. Pass.`,
                "Light package. Bring real value or walk.",
            ]);
        const resolved = respondToTrade(state, trade.tradeId, accept, note, createdAt);
        return resolved === state ? state : pushActivity(resolved, "trade", `${to.name} — ${persona.label}: "${note}"`, createdAt);
    }

    function aiRespondToTrades(state, cards, createdAt) {
        return state.trades.reduce((next, trade) => {
            if (trade.status !== "pending") return next;
            const to = next.teams.find((team) => team.teamId === trade.toTeamId);
            if (!to || to.manager !== "ai") return next;
            const live = next.trades.find((item) => item.tradeId === trade.tradeId);
            return live ? resolveAiTrade(next, live, cards, createdAt) : next;
        }, state);
    }

    /** Total starter seats a position can occupy; FLEX-style slots count for every eligible position. */
    const positionDemand = (settings, position) =>
        STARTER_SLOTS.reduce((demand, slot) => {
            const count = settings.rosterSlots[slot] ?? 0;
            return demand + (count > 0 && SLOT_ELIGIBILITY[slot].includes(position) ? count : 0);
        }, 0);

    const teamNeed = (team, settings, cards) => {
        let need = null;
        let low = Number.POSITIVE_INFINITY;
        for (const position of NEED_ORDER) {
            if (positionDemand(settings, position) <= 0) continue;
            const best = team.roster.reduce((max, entry) => (entry.position === position ? Math.max(max, entryValue(cards, entry)) : max), 0);
            if (best < low) {
                low = best;
                need = position;
            }
        }
        return need;
    };

    const surplusEntries = (team, settings, cards, position, locked) =>
        team.roster
            .filter((entry) => entry.position === position && !locked.has(entry.entryId))
            .sort((left, right) => entryValue(cards, right) - entryValue(cards, left) || left.entryId.localeCompare(right.entryId))
            .slice(positionDemand(settings, position));

    const sameIdSet = (left, right) => {
        if (left.length !== right.length) return false;
        const sortedLeft = [...left].sort();
        const sortedRight = [...right].sort();
        return sortedLeft.every((id, index) => id === sortedRight[index]);
    };

    const isDuplicatePending = (trades, fromTeamId, toTeamId, giveIds, receiveIds) =>
        trades.some((trade) => (
            trade.status === "pending"
            && trade.fromTeamId === fromTeamId
            && trade.toTeamId === toTeamId
            && sameIdSet(trade.giveEntryIds, giveIds)
            && sameIdSet(trade.receiveEntryIds, receiveIds)
        ));

    function aiGenerateTrades(state, cards, createdAt) {
        if (state.phase !== "season" || !state.settings.tradesEnabled) return state;
        const random = createSeededRandom(`${state.seed}:aitrade:${state.currentWeek}`);
        const quota = random() < 0.6 ? 1 : 2;
        let next = state;
        let made = 0;
        for (const seat of state.teams) {
            if (made >= quota) break;
            if (seat.manager !== "ai") continue;
            const proposer = next.teams.find((team) => team.teamId === seat.teamId);
            if (!proposer) continue;
            const persona = personaFor(proposer);
            // Entries already committed to a pending offer are off the table.
            const locked = new Set(next.trades.filter((trade) => trade.status === "pending").flatMap((trade) => [...trade.giveEntryIds, ...trade.receiveEntryIds]));
            const myNeed = teamNeed(proposer, next.settings, cards);
            if (!myNeed) continue;
            for (const partner of next.teams) {
                if (partner.teamId === proposer.teamId) continue;
                const theirNeed = teamNeed(partner, next.settings, cards);
                if (!theirNeed || theirNeed === myNeed) continue;
                const givePool = surplusEntries(proposer, next.settings, cards, theirNeed, locked);
                const receivePool = surplusEntries(partner, next.settings, cards, myNeed, locked);
                if (!givePool.length || !receivePool.length) continue;
                const two = givePool.length > 1 && receivePool.length > 1 && random() < 0.35;
                const give = givePool.slice(0, two ? 2 : 1);
                const receive = receivePool.slice(0, two ? 2 : 1);
                if (sumValue(cards, receive) < sumValue(cards, give) * acceptThreshold(persona)) continue;
                const giveIds = give.map((entry) => entry.entryId);
                const receiveIds = receive.map((entry) => entry.entryId);
                if (isDuplicatePending(next.trades, proposer.teamId, partner.teamId, giveIds, receiveIds)) continue;
                const giveNames = give.map((entry) => entry.name).join(" + ");
                const receiveNames = receive.map((entry) => entry.name).join(" + ");
                const note = pickPhrase(`${state.seed}:aipitch:${state.currentWeek}:${proposer.teamId}:${partner.teamId}`, [
                    `${giveNames} for ${receiveNames}. You need ${theirNeed}, I need ${myNeed}. Clean swap.`,
                    `${giveNames} fixes your ${theirNeed}. ${receiveNames} fixes mine at ${myNeed}. Do it.`,
                    `Surplus for surplus — ${giveNames} out, ${receiveNames} back. Quick yes.`,
                ]);
                const before = next.trades.length;
                next = proposeTrade(next, { fromTeamId: proposer.teamId, toTeamId: partner.teamId, giveEntryIds: giveIds, receiveEntryIds: receiveIds, note }, createdAt);
                if (next.trades.length === before) continue;
                made += 1;
                next = pushActivity(next, "trade", `${proposer.name} — ${persona.label}: "${note}"`, createdAt);
                const placed = next.trades[next.trades.length - 1];
                if (partner.manager === "ai") next = resolveAiTrade(next, placed, cards, createdAt);
                break;
            }
        }
        return next;
    }

    const api = {
        AI_PERSONAS, entryValueFromCard, aiDraftChoice, aiPrepareWeek, aiSubmitWaiverClaims,
        aiRespondToTrades, aiGenerateTrades,
    };
    App.TimeLeagueAI = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
