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

    const AI_PERSONAS = App.TimeLeagueEngine.AI_PERSONAS;

    const STARTER_SLOTS = ROSTER_SLOT_IDS.filter((slot) => slot !== "BN" && slot !== "IR" && slot !== "TAXI");
    const NEED_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

    const personaFor = (team) => AI_PERSONAS[team?.aiPersona] || AI_PERSONAS.steward;
    const relationshipFor = (state, owner, other) => App.TimeLeagueRivals?.relationshipFor(state, owner, other) || { heat: 0, tradePremium: 0 };
    const hottestRival = (state, owner) => App.TimeLeagueRivals?.hottestRelationship(state, owner) || { heat: 0, aggressionDelta: 0 };
    // A provoked manager spends and negotiates more assertively. These bounded
    // effects use past correspondence only, never hidden bids or future scores.
    const waiverPersona = (state, team) => {
        const base = personaFor(team), rivalry = hottestRival(state, team.teamId);
        return { ...base, aggression: Math.min(100, base.aggression + rivalry.aggressionDelta), patience: Math.max(0, base.patience - rivalry.aggressionDelta) };
    };

    /**
     * Difficulty tunes HOW SHARP the AI's decisions are, not its rosters or
     * scoring — persona flavor (aggression/patience/risk) stays the same at
     * every difficulty. "veteran" is the baseline, and older saves retain it
     * unless their manager explicitly chooses another difficulty.
     */
    const DIFFICULTY_TUNING = {
        rookie: { noiseMult: 1.8, marginBonus: 0.12, thresholdDelta: -0.06, bidMult: 0.7 },
        veteran: { noiseMult: 1, marginBonus: 0, thresholdDelta: 0, bidMult: 1 },
        allpro: { noiseMult: 0.35, marginBonus: -0.1, thresholdDelta: 0.07, bidMult: 1.25 },
    };
    const difficultyFor = (state) => DIFFICULTY_TUNING[state.settings.aiDifficulty] ?? DIFFICULTY_TUNING.veteran;

    const AI_DIFFICULTY_LABELS = {
        rookie: { label: 'Rookie', blurb: 'Sloppier picks, easier to fleece in a trade, slower off the wire.' },
        veteran: { label: 'Veteran', blurb: "Today's baseline GM — solid value reads, fair trades, competitive claims." },
        allpro: { label: 'All-Pro', blurb: 'Sharp draft boards, demands real value in trades, wins contested waivers.' },
    };

    /** Accept when incoming covers outgoing x threshold: bold personas take thin wins (~0.95), careful ones demand a premium (~1.04). */
    const acceptThreshold = (persona, difficulty) => {
        const base = 1.08 - 0.16 * ((persona.aggression + persona.riskTolerance) / 200);
        return Math.max(0.75, Math.min(1.35, base + (difficulty ? difficulty.thresholdDelta : 0)));
    };

    /** Patient personas demand a bigger upgrade before spending a waiver claim. */
    const waiverMargin = (persona, difficulty) => {
        const base = 1.05 + (persona.patience / 100) * 0.35;
        return Math.max(1.0, base + (difficulty ? difficulty.marginBonus : 0));
    };

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
    const bestName = (cards, entries, fallback) =>
        [...entries].sort((left, right) => entryValue(cards, right) - entryValue(cards, left))[0]?.name ?? fallback;

    const starterEligible = (settings, position) =>
        STARTER_SLOTS.some((slot) => (settings.rosterSlots[slot] ?? 0) > 0 && SLOT_ELIGIBILITY[slot].includes(position));

    function draftValue(state, card, persona) {
        const seasons = App.TimeLeagueEraRules.filterSeasonsForEra(card.seasons, state.settings.eraRules, card.position);
        if (!seasons.length) return 0;
        const mean = seasons.reduce((sum, season) => sum + season.points, 0) / seasons.length;
        const peak = Math.max(...seasons.map(season => season.points));
        return (mean * (1 - persona.peakWeight) + peak * persona.peakWeight) * (persona.positionBias[card.position] || 1);
    }
    const tradeValue = (cards, entries, persona) => entries.reduce((sum, entry) =>
        sum + entryValue(cards, entry) * (1 + ((persona.positionBias[entry.position] || 1) - 1) * 0.5), 0);

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
        const persona = personaFor(team);
        const amp = (0.2 + (persona.riskTolerance / 100) * 0.3) * difficultyFor(state).noiseMult;
        let best = null;
        // The era-eligible board is the whole world for an AI GM: undrafted cards
        // that the league's decades can actually field.
        for (const card of eraEligibleCards(state, cards)) {
            if (!findOpenRosterSlot(card.position, assignedSlots, state.settings.rosterSlots, state.settings.maxQuarterbacks, positions)) continue;
            let openStarters = 0;
            for (const [slot, room] of openBySlot) {
                if (SLOT_ELIGIBILITY[slot].includes(card.position)) openStarters += room;
            }
            const score = draftValue(state, card, persona) * (openStarters > 0 ? 1 + persona.needWeight * openStarters : 0.4) * (1 + (noise() - 0.5) * amp * 0.18);
            if (!best || score > best.score) best = { card, score };
        }
        return best?.card ?? null;
    }

    /** Auction rivals price only the visible, era-eligible board, never the mystery draw. */
    function aiAuctionStep(state, cards, stamp) {
        const E = App.TimeLeagueEngine;
        if (state.phase !== 'draft' || state.settings.draftFormat !== 'auction' || state.draftClock?.status !== 'running') return state;
        const n = state.draftAuction?.nomination;
        if (!n) {
            const seat = currentDraftSeat(state), team = state.teams.find(t => t.teamId === seat?.teamId);
            if (team?.manager !== 'ai') return state;
            const card = team.queue.map(id => cards.get(id)).find(c => E.auctionCanBid(state, team.teamId, c)) || aiDraftChoice(state, cards);
            return card ? E.nominateAuctionPlayer(state, team.teamId, card, 1, stamp) : state;
        }
        const card = cards.get(n.identity);
        if (!card) return state;
        const board = eraEligibleCards(state, cards);
        const visibleValue = player => {
            const seasons = App.TimeLeagueEraRules.filterSeasonsForEra(player.seasons, state.settings.eraRules, player.position);
            return seasons.length ? seasons.reduce((sum, season) => sum + season.points, 0) / seasons.length : 0;
        };
        const peak = Math.max(1, ...board.map(visibleValue));
        const value = visibleValue(card);
        const contenders = state.teams.filter(t => t.manager === 'ai' && t.teamId !== n.highTeamId && E.auctionCanBid(state, t.teamId, card));
        const random = createSeededRandom(`${state.seed}:auction:${n.identity}:${n.highBid}`);
        const ranked = contenders.map(team => {
            const persona = personaFor(team);
            const max = E.auctionMaxBid(state, team.teamId);
            const average = (state.settings.draftAuctionBudget || 200) / Math.max(1, rosterCapacity(state.settings));
            const preference = draftValue(state, card, persona) / Math.max(1, value);
            const factor = 0.55 + (value / peak) * preference * 2.25 + persona.aggression / 200;
            const limit = Math.min(max, Math.max(1, Math.round(average * factor * difficultyFor(state).bidMult)));
            return { team, limit, order: random() };
        }).filter(item => item.limit > n.highBid).sort((a, b) => a.order - b.order);
        if (!ranked.length) return state;
        const bidder = ranked[0];
        const next = E.bidAuctionPlayer(state, bidder.team.teamId, n.highBid + 1, stamp, cards);
        return next === state ? state : { ...next, draftAuction: { ...next.draftAuction, lastAiAt: stamp } };
    }

    function aiPrepareWeek(state, cards) {
        return state.teams.reduce((next, team) => (team.manager === "ai" ? autoFillLineup(next, team.teamId, cards) : next), state);
    }

    function aiSubmitWaiverClaims(state, cards, createdAt) {
        if (state.phase !== "season" || !state.settings.waiversEnabled) return state;
        const capacity = rosterCapacity(state.settings);
        const faab = state.settings.waiverMode === "faab";
        const difficulty = difficultyFor(state);
        // freeAgents already drops era-ineligible cards, so the wire an AI reads
        // is exactly the wire a human sees.
        const pool = freeAgents(state, cards);
        return state.teams.reduce((next, team) => {
            if (team.manager !== "ai") return next;
            if (next.pendingClaims.some((claim) => claim.teamId === team.teamId && claim.week === next.currentWeek)) return next;
            if (faab && (team.faabRemaining ?? 0) <= 0) return next;
            const weakest = team.roster.reduce((low, entry) => {
                if (!starterEligible(next.settings, entry.position)) return low;
                const value = entryValue(cards, entry);
                return value < low ? value : low;
            }, Number.POSITIVE_INFINITY);
            const bar = (Number.isFinite(weakest) ? weakest : 0) * waiverMargin(waiverPersona(next, team), difficulty);
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
            const target = pool.filter((card) => (
                card.seasons.length > 0
                && starterEligible(next.settings, card.position)
                && !(card.position === "QB" && quarterbacks >= next.settings.maxQuarterbacks)
                && card.peak >= bar
            )).sort((left, right) => draftValue(next, right, personaFor(team)) - draftValue(next, left, personaFor(team)) || left.identity.localeCompare(right.identity))[0];
            if (!target) return next;
            let bidAmount;
            if (faab) {
                const persona = waiverPersona(next, team);
                const remaining = team.faabRemaining ?? 0;
                const noise = createSeededRandom(`${state.seed}:aibid:${state.currentWeek}:${team.teamId}`)();
                // Aggressive personas spend a bigger slice of what's left; a touch
                // of noise keeps two same-persona teams from bidding identically.
                const aggressionFactor = (0.08 + (persona.aggression / 100) * 0.25 + noise * 0.05) * difficulty.bidMult;
                bidAmount = Math.max(1, Math.min(remaining, Math.round(remaining * aggressionFactor)));
            }
            return submitWaiverClaim(next, {
                teamId: team.teamId,
                addIdentity: target.identity,
                addName: target.name,
                addPosition: target.position,
                dropEntryId: drop?.entryId ?? "",
                ...(faab ? { bidAmount } : {}),
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
        const accept = complete && tradeValue(cards, incoming, persona) >= tradeValue(cards, outgoing, persona) * (acceptThreshold(persona, difficultyFor(state)) + relationshipFor(state, to.teamId, from.teamId).tradePremium);
        const inName = bestName(cards, incoming, "That package");
        const outName = bestName(cards, outgoing, "my starter");
        const note = accept ? `${persona.accept} ${inName} for ${outName}.` : `${persona.reject} ${outName} stays for now.`;
        const resolved = respondToTrade(state, trade.tradeId, accept, note, createdAt);
        return resolved === state ? state : pushActivity(resolved, "trade", `${to.name} — ${persona.label}: "${note}"`, createdAt);
    }

    function aiRespondToTrades(state, cards, createdAt) {
        return state.trades.reduce((next, trade) => {
            if (trade.status !== "pending" || trade.deferredUntilWeek > state.currentWeek) return next;
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
        const difficulty = difficultyFor(state);
        const quota = random() < 0.6 ? 1 : 2;
        let next = state;
        let made = 0;
        const initiative = team => {
            const persona = personaFor(team);
            return hottestRival(state, team.teamId).heat * 20 + persona.aggression * 0.3 + (100 - persona.patience) * 0.15
                + (team.aiPersona === 'broker' ? 18 : 0) + createSeededRandom(`${state.seed}:trade-desk:${state.currentWeek}:${team.teamId}`)() * 100;
        };
        for (const seat of [...state.teams].sort((a, b) => initiative(b) - initiative(a))) {
            if (made >= quota) break;
            if (seat.manager !== "ai") continue;
            const proposer = next.teams.find((team) => team.teamId === seat.teamId);
            if (!proposer) continue;
            const persona = personaFor(proposer);
            // Entries already committed to a pending offer are off the table.
            const locked = new Set(next.trades.filter((trade) => trade.status === "pending").flatMap((trade) => [...trade.giveEntryIds, ...trade.receiveEntryIds]));
            const myNeed = teamNeed(proposer, next.settings, cards);
            if (!myNeed) continue;
            for (const partner of [...next.teams].sort((a, b) => Number(b.manager === "human") - Number(a.manager === "human") || relationshipFor(next, proposer.teamId, b.teamId).heat - relationshipFor(next, proposer.teamId, a.teamId).heat)) {
                if (partner.teamId === proposer.teamId) continue;
                const theirNeed = teamNeed(partner, next.settings, cards);
                if (!theirNeed || theirNeed === myNeed) continue;
                const givePool = surplusEntries(proposer, next.settings, cards, theirNeed, locked);
                const receivePool = surplusEntries(partner, next.settings, cards, myNeed, locked);
                if (!givePool.length || !receivePool.length) continue;
                const two = givePool.length > 1 && receivePool.length > 1 && random() < 0.35;
                const give = givePool.slice(0, two ? 2 : 1);
                const receive = receivePool.slice(0, two ? 2 : 1);
                if (tradeValue(cards, receive, persona) < tradeValue(cards, give, persona) * (acceptThreshold(persona, difficulty) + relationshipFor(next, proposer.teamId, partner.teamId).tradePremium)) continue;
                const giveIds = give.map((entry) => entry.entryId);
                const receiveIds = receive.map((entry) => entry.entryId);
                if (isDuplicatePending(next.trades, proposer.teamId, partner.teamId, giveIds, receiveIds)) continue;
                const giveNames = give.map((entry) => entry.name).join(" + ");
                const receiveNames = receive.map((entry) => entry.name).join(" + ");
                const note = `${persona.pitch} ${giveNames} for ${receiveNames}. You get ${theirNeed}; I get ${myNeed}.`;
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
        AI_PERSONAS, AI_DIFFICULTY_LABELS, entryValueFromCard, aiDraftChoice, aiAuctionStep, aiPrepareWeek, aiSubmitWaiverClaims,
        aiRespondToTrades, aiGenerateTrades,
    };
    App.TimeLeagueAI = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
