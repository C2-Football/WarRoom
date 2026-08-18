// ══════════════════════════════════════════════════════════════════
// time-league-engine.js — pure state machine for the Time League game mode.
// Every function returns a new state (inputs are never mutated) and all
// randomness flows from createSeededRandom with seeds derived from
// `state.seed`, so any league can be replayed exactly from its creation
// inputs plus the action log.
//
// Ported from The Duat's app/time-league-engine.ts.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { createDraftOrder, findOpenRosterSlot } = App.TimeLeagueDraftRoom;
    const { eraEligibleCard, filterSeasonsForEra, normalizeEraDraftRules, openDraftEra } = App.TimeLeagueEraRules;
    const {
        createSeededRandom, expandRosterSlots, normalizePlayerPosition, ROSTER_SLOT_IDS, SLOT_ELIGIBILITY,
    } = App.TimeLeagueRoster;
    const {
        buildRoundRobinSchedule, eraFactorFor, gameLogKey, isStarterSlot, scoreStatLine, REFERENCE_EXTENDED_SCORING,
    } = App.TimeLeagueSeason;

    const round2 = (value) => Math.round(value * 100) / 100;
    const fixed1 = (value) => value.toFixed(1);

    const idNumber = (id, prefix) => {
        const value = Number(id.slice(prefix.length));
        return Number.isFinite(value) ? value : 0;
    };

    const nextId = (prefix, ids) => `${prefix}${ids.reduce((max, id) => Math.max(max, idNumber(id, prefix)), 0) + 1}`;

    const appendEvents = (activity) => {
        const events = [...activity];
        let last = events.reduce((max, event) => Math.max(max, idNumber(event.id, "a")), 0);
        return {
            push(week, kind, message, createdAt) {
                last += 1;
                events.push({ id: `a${last}`, week, kind, message, createdAt });
            },
            list: () => events,
        };
    };

    /**
     * The mystery draw. Callers pass the era-filtered season list, so a league
     * can never hand out a season its own rules forbid; an empty list means the
     * card is undraftable rather than silently drawn from the whole career.
     */
    const drawSeasonFrom = (seasons, seedKey) => {
        if (!seasons.length) return null;
        const random = createSeededRandom(seedKey);
        return seasons[Math.floor(random() * seasons.length)].season;
    };

    /** PlayerPosition order; the roulette deals a decade to every one of them. */
    const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

    /** Seasons this card may still be drawn from under the league's era rules. */
    const eraSeasons = (state, card) => filterSeasonsForEra(card.seasons, state.settings.eraRules, card.position);

    /** One line for the founding log; null unless a roulette actually dealt decades. */
    function rouletteLine(rules) {
        if (rules.mode !== "position-roulette") return null;
        const dealt = Object.entries(rules.positionDecades ?? {})
            .filter((entry) => Boolean(entry[1]))
            .map(([position, decade]) => `${position} ${decade}`);
        return dealt.length ? `Era roulette — ${dealt.join(" · ")}` : null;
    }

    /** Waiver adds outlive draft numbering, so scan every record that holds an entry id. */
    const nextEntryNumber = (state) => {
        const scan = (ids) => ids.reduce((max, id) => Math.max(max, idNumber(id, "e")), 0);
        return Math.max(
            scan(state.draftPicks.map((pick) => pick.entryId)),
            scan(state.teams.flatMap((team) => team.roster.map((entry) => entry.entryId))),
            scan(state.finalizedWeeks.flatMap((week) => week.results.flatMap((result) => result.starters.map((starter) => starter.entryId)))),
        ) + 1;
    };

    const STARTER_SLOT_ORDER = ROSTER_SLOT_IDS.filter((slot) => slot !== "BN" && slot !== "IR" && slot !== "TAXI");

    /** Draftable capacity: starters plus bench. IR/TAXI are excluded because the draft cannot fill them. */
    function rosterCapacity(settings) {
        return expandRosterSlots(settings.rosterSlots).length;
    }

    function createTimeLeague(input) {
        const teams = input.seats.map((seat, index) => {
            const teamId = `t${index + 1}`;
            return {
                teamId,
                name: seat.name,
                manager: seat.manager,
                ...(seat.aiPersona ? { aiPersona: seat.aiPersona } : {}),
                // Setup always hands one over (defaultSeats / addSeat both stamp
                // one in), but a manually-built seats array (tests, deep links)
                // still lands on a real, deterministic helmet instead of none.
                helmet: seat.helmet || App.TimeLeagueHelmet.defaultHelmet(teamId),
                roster: [],
                queue: [],
                ...(input.settings.waiverMode === "faab" ? { faabRemaining: input.settings.faabBudget } : {}),
            };
        });
        const teamIds = teams.map((team) => team.teamId);
        const draftOrder = createDraftOrder(teamIds, rosterCapacity(input.settings), "snake")
            .map(({ overall, round, teamId }) => ({ overall, round, teamId }));
        const schedule = buildRoundRobinSchedule(teamIds, input.settings.regularSeasonWeeks)
            .map(({ week, pairs }) => ({ week, pairs }));
        const random = createSeededRandom(`${input.seed}:${input.createdAt}:league-id`);
        const leagueId = `tl-${Array.from({ length: 10 }, () => "0123456789abcdefghjkmnpqrstvwxyz"[Math.floor(random() * 32)]).join("")}`;
        // Roulette rolls once, here, and is frozen into the stored settings: the
        // board, the draws and the waiver wire all read the same assignment forever.
        const settings = {
            ...input.settings,
            eraRules: openDraftEra(input.settings.eraRules, `${input.seed}:era`, POSITIONS),
        };
        const founding = [{
            id: "a1",
            week: 1,
            kind: "league",
            message: `League founded — ${input.name}, ${teams.length} seats, ${input.settings.regularSeasonWeeks} weeks`,
            createdAt: input.createdAt,
        }];
        const roulette = rouletteLine(settings.eraRules);
        if (roulette) founding.push({ id: "a2", week: 1, kind: "league", message: roulette, createdAt: input.createdAt });
        return {
            version: 1,
            leagueId,
            name: input.name,
            seed: input.seed,
            createdAt: input.createdAt,
            phase: "draft",
            settings,
            teams,
            draftOrder,
            draftPicks: [],
            seasonsRevealed: false,
            currentWeek: 1,
            schedule,
            finalizedWeeks: [],
            pendingClaims: [],
            trades: [],
            activity: founding,
        };
    }

    function currentDraftSeat(state) {
        const taken = new Set(state.draftPicks.map((pick) => pick.overall));
        return state.draftOrder.find((seat) => !taken.has(seat.overall)) ?? null;
    }

    function draftedIdentities(state) {
        return new Set(state.draftPicks.map((pick) => pick.identity));
    }

    /**
     * The live draft board: every card the league's era rules can still field,
     * minus the identities already off the board. Best peaks first.
     */
    function eraEligibleCards(state, cards) {
        const taken = draftedIdentities(state);
        return [...cards.values()]
            .filter((card) => !taken.has(card.identity)
                && positionIsStartable(state.settings, card.position)
                && eraEligibleCard(card, state.settings.eraRules))
            .sort((left, right) => right.peak - left.peak || left.identity.localeCompare(right.identity));
    }

    /**
     * A league with no kicker or defense slot has no kickers or defenses in its
     * player pool at all — otherwise they are draftable, look valuable on peak,
     * and then sit on a bench where they can never score.
     */
    function positionIsStartable(settings, position) {
        return STARTER_SLOT_ORDER.some((slot) => (settings.rosterSlots[slot] ?? 0) > 0 && SLOT_ELIGIBILITY[slot].includes(position));
    }

    function applyDraftPick(state, card, opts) {
        const seat = state.phase === "draft" ? currentDraftSeat(state) : null;
        if (!seat || draftedIdentities(state).has(card.identity)) return state;
        const team = state.teams.find((item) => item.teamId === seat.teamId);
        if (!team) return state;
        const open = findOpenRosterSlot(
            card.position,
            team.roster.map((entry) => entry.slot),
            state.settings.rosterSlots,
            state.settings.maxQuarterbacks,
            team.roster.map((entry) => entry.position),
        );
        const drawnSeason = drawSeasonFrom(eraSeasons(state, card), `${state.seed}:draw:${card.identity}:${seat.overall}`);
        if (!open || drawnSeason === null) return state;
        const entry = {
            entryId: `e${seat.overall}`,
            identity: card.identity,
            name: card.name,
            position: card.position,
            drawnSeason,
            slot: open.slot,
            acquiredVia: "draft",
            acquiredWeek: state.currentWeek,
        };
        const pick = {
            overall: seat.overall,
            round: seat.round,
            teamId: seat.teamId,
            entryId: entry.entryId,
            identity: card.identity,
            name: card.name,
            position: card.position,
            madeBy: opts.madeBy,
        };
        const pickInRound = state.draftOrder.filter((item) => item.round === seat.round)
            .findIndex((item) => item.overall === seat.overall) + 1;
        const complete = state.draftPicks.length + 1 >= state.draftOrder.length;
        const events = appendEvents(state.activity);
        events.push(state.currentWeek, "draft", `R${seat.round}.${String(pickInRound).padStart(2, "0")} — ${team.name} selects ${card.name}, ${card.position}`, opts.createdAt);
        if (complete) events.push(state.currentWeek, "league", "Draft complete — mystery seasons revealed", opts.createdAt);
        return {
            ...state,
            phase: complete ? "season" : state.phase,
            seasonsRevealed: complete || state.seasonsRevealed,
            teams: state.teams.map((item) => (item.teamId === team.teamId ? { ...item, roster: [...item.roster, entry] } : item)),
            draftPicks: [...state.draftPicks, pick],
            activity: events.list(),
        };
    }

    function setEntrySlot(state, teamId, entryId, slot) {
        const team = state.teams.find((item) => item.teamId === teamId);
        const entry = team?.roster.find((item) => item.entryId === entryId);
        if (!team || !entry || entry.slot === slot) return state;
        const capacity = state.settings.rosterSlots[slot] ?? 0;
        if (capacity <= 0 || !SLOT_ELIGIBILITY[slot].includes(entry.position)) return state;
        const moves = new Map([[entryId, slot]]);
        const occupants = team.roster.filter((item) => item.slot === slot);
        if (occupants.length >= capacity) {
            const partner = occupants.find((item) => SLOT_ELIGIBILITY[entry.slot].includes(item.position));
            if (partner) {
                moves.set(partner.entryId, entry.slot);
            } else {
                const benchUsed = team.roster.filter((item) => item.slot === "BN" && item.entryId !== entryId).length;
                if (benchUsed >= (state.settings.rosterSlots.BN ?? 0)) return state;
                moves.set(occupants[0].entryId, "BN");
            }
        }
        return {
            ...state,
            teams: state.teams.map((item) => (item.teamId !== teamId ? item : {
                ...item,
                roster: item.roster.map((member) => (moves.has(member.entryId) ? { ...member, slot: moves.get(member.entryId) } : member)),
            })),
        };
    }

    function autoFillLineup(state, teamId, cards) {
        const team = state.teams.find((item) => item.teamId === teamId);
        if (!team) return state;
        const open = new Map();
        for (const slot of STARTER_SLOT_ORDER) {
            const room = (state.settings.rosterSlots[slot] ?? 0) - team.roster.filter((item) => item.slot === slot).length;
            if (room > 0) open.set(slot, room);
        }
        const seasonPoints = (entry) => cards.get(entry.identity)?.seasons.find((item) => item.season === entry.drawnSeason)?.points ?? 0;
        const bench = team.roster
            .filter((item) => item.slot === "BN")
            .sort((left, right) => seasonPoints(right) - seasonPoints(left) || left.entryId.localeCompare(right.entryId));
        const moves = new Map();
        for (const entry of bench) {
            const slot = STARTER_SLOT_ORDER.find((candidate) => (open.get(candidate) ?? 0) > 0 && SLOT_ELIGIBILITY[candidate].includes(entry.position));
            if (!slot) continue;
            moves.set(entry.entryId, slot);
            open.set(slot, (open.get(slot) ?? 0) - 1);
        }
        if (!moves.size) return state;
        return {
            ...state,
            teams: state.teams.map((item) => (item.teamId !== teamId ? item : {
                ...item,
                roster: item.roster.map((member) => (moves.has(member.entryId) ? { ...member, slot: moves.get(member.entryId) } : member)),
            })),
        };
    }

    function lineupProblems(state, teamId) {
        const team = state.teams.find((item) => item.teamId === teamId);
        if (!team) return ["Unknown team."];
        const problems = [];
        for (const slot of STARTER_SLOT_ORDER) {
            const capacity = state.settings.rosterSlots[slot] ?? 0;
            const occupants = team.roster.filter((item) => item.slot === slot);
            for (const occupant of occupants) {
                if (!SLOT_ELIGIBILITY[slot].includes(occupant.position)) {
                    problems.push(`${occupant.name} (${occupant.position}) is not eligible at ${slot}`);
                }
            }
            if (occupants.length > capacity) problems.push(`${slot} is over capacity (${occupants.length}/${capacity})`);
            else if (occupants.length < capacity) {
                const missing = capacity - occupants.length;
                problems.push(missing > 1 ? `${slot} has ${missing} empty slots` : `${slot} slot is empty`);
            }
        }
        return problems;
    }

    /**
     * Prices one week for every team and files the result. `extendedScoring`
     * covers the kicking / team-defense / IDP surface; defaulting to the
     * reference table is what keeps a drafted K or DEF from scoring a
     * permanent 0.00.
     */
    function finalizeCurrentWeek(state, logIndex, eraFactors, createdAt, extendedScoring = REFERENCE_EXTENDED_SCORING) {
        if (state.phase !== "season") return state;
        const week = state.currentWeek;
        const factors = state.settings.eraAdjusted ? eraFactors : null;
        const results = state.teams.map((team) => {
            const starters = team.roster.filter((entry) => isStarterSlot(entry.slot)).map((entry) => {
                const log = logIndex.get(gameLogKey(entry.identity, entry.drawnSeason, week)) ?? null;
                const raw = log ? scoreStatLine(log.stats, state.settings.scoring, extendedScoring) : 0;
                const factor = eraFactorFor(factors, entry.drawnSeason, entry.position);
                return {
                    entryId: entry.entryId,
                    identity: entry.identity,
                    name: entry.name,
                    position: entry.position,
                    drawnSeason: entry.drawnSeason,
                    slot: entry.slot,
                    points: round2(raw * factor),
                    factor,
                    stats: log ? log.stats : null,
                };
            });
            return { teamId: team.teamId, total: round2(starters.reduce((sum, line) => sum + line.points, 0)), starters };
        });
        const totals = new Map(results.map((result) => [result.teamId, result.total]));
        const matchups = (state.schedule.find((item) => item.week === week)?.pairs ?? []).map(([home, away]) => {
            const homePoints = totals.get(home) ?? 0;
            const awayPoints = totals.get(away) ?? 0;
            return { home, away, homePoints, awayPoints, winner: homePoints > awayPoints ? home : awayPoints > homePoints ? away : null };
        });
        const name = (teamId) => state.teams.find((team) => team.teamId === teamId)?.name ?? teamId;
        const line = (matchup) => {
            if (matchup.winner === null) return `${name(matchup.home)} ${fixed1(matchup.homePoints)} ties ${name(matchup.away)} ${fixed1(matchup.awayPoints)}`;
            const winnerHome = matchup.winner === matchup.home;
            const loser = winnerHome ? matchup.away : matchup.home;
            return `${name(matchup.winner)} ${fixed1(winnerHome ? matchup.homePoints : matchup.awayPoints)} def. ${name(loser)} ${fixed1(winnerHome ? matchup.awayPoints : matchup.homePoints)}`;
        };
        const headlines = [];
        let top = null;
        for (const result of results) {
            for (const starter of result.starters) {
                if (!top || starter.points > top.starter.points) top = { starter, teamId: result.teamId };
            }
        }
        if (top) headlines.push(`Top scorer — ${top.starter.name} (${name(top.teamId)}) ${fixed1(top.starter.points)}`);
        if (matchups.length) {
            const byMargin = [...matchups].sort((left, right) =>
                Math.abs(left.homePoints - left.awayPoints) - Math.abs(right.homePoints - right.awayPoints));
            headlines.push(`Closest — ${line(byMargin[0])}`);
            const blowout = byMargin[byMargin.length - 1];
            if (blowout !== byMargin[0]) headlines.push(`Blowout — ${line(blowout)}`);
        }
        const events = appendEvents(state.activity);
        for (const matchup of matchups) events.push(week, "week", `W${week} final — ${line(matchup)}`, createdAt);
        let next = {
            ...state,
            finalizedWeeks: [...state.finalizedWeeks, { week, results, matchups, headlines }],
            currentWeek: week + 1,
            activity: events.list(),
        };
        if (week + 1 > state.settings.regularSeasonWeeks) {
            const champion = computeStandings(next)[0];
            const finale = appendEvents(next.activity);
            if (champion) finale.push(week, "league", `Season complete — ${name(champion.teamId)} crowned champion`, createdAt);
            next = { ...next, phase: "complete", ...(champion ? { championTeamId: champion.teamId } : {}), activity: finale.list() };
        }
        return next;
    }

    function computeStandings(state) {
        const table = new Map(state.teams.map((team) => [team.teamId, {
            teamId: team.teamId, wins: 0, losses: 0, ties: 0, allPlayWins: 0, allPlayLosses: 0, pointsFor: 0, pointsAgainst: 0,
        }]));
        for (const week of state.finalizedWeeks) {
            for (const result of week.results) {
                const standing = table.get(result.teamId);
                if (!standing) continue;
                standing.pointsFor = round2(standing.pointsFor + result.total);
                for (const other of week.results) {
                    if (other.teamId === result.teamId) continue;
                    if (result.total > other.total) standing.allPlayWins += 1;
                    else if (result.total < other.total) standing.allPlayLosses += 1;
                }
            }
            for (const matchup of week.matchups) {
                const home = table.get(matchup.home);
                const away = table.get(matchup.away);
                if (!home || !away) continue;
                home.pointsAgainst = round2(home.pointsAgainst + matchup.awayPoints);
                away.pointsAgainst = round2(away.pointsAgainst + matchup.homePoints);
                if (matchup.winner === matchup.home) { home.wins += 1; away.losses += 1; }
                else if (matchup.winner === matchup.away) { away.wins += 1; home.losses += 1; }
                else { home.ties += 1; away.ties += 1; }
            }
        }
        return [...table.values()].sort((left, right) => (
            right.wins - left.wins
            || left.losses - right.losses
            || right.pointsFor - left.pointsFor
            || right.allPlayWins - left.allPlayWins
            || left.teamId.localeCompare(right.teamId)
        ));
    }

    function freeAgents(state, cards) {
        const rostered = new Set(state.teams.flatMap((team) => team.roster.map((entry) => entry.identity)));
        return [...cards.values()]
            .filter((card) => !rostered.has(card.identity)
                && positionIsStartable(state.settings, card.position)
                && eraEligibleCard(card, state.settings.eraRules))
            .sort((left, right) => right.peak - left.peak || left.identity.localeCompare(right.identity));
    }

    function submitWaiverClaim(state, claim, createdAt) {
        if (state.phase !== "season" || !state.settings.waiversEnabled || !claim.addIdentity) return state;
        const team = state.teams.find((item) => item.teamId === claim.teamId);
        if (!team) return state;
        if (state.pendingClaims.some((item) => item.teamId === claim.teamId && item.addIdentity === claim.addIdentity)) return state;
        const dropTarget = claim.dropEntryId ? team.roster.find((entry) => entry.entryId === claim.dropEntryId) : undefined;
        if (claim.dropEntryId && !dropTarget) return state;
        if (claim.addPosition === "QB") {
            const quarterbacks = team.roster.filter((entry) => entry.position === "QB" && entry.entryId !== claim.dropEntryId).length;
            if (quarterbacks >= state.settings.maxQuarterbacks) return state;
        }
        const faab = state.settings.waiverMode === "faab";
        let bidAmount = 0;
        if (faab) {
            bidAmount = Math.floor(claim.bidAmount ?? 0);
            if (!Number.isFinite(bidAmount) || bidAmount < 0) return state;
            // Every live claim from this desk reserves its bid against the same
            // budget, so a second claim can't spend money the first already holds.
            const reserved = state.pendingClaims.filter((item) => item.teamId === claim.teamId).reduce((sum, item) => sum + (item.bidAmount ?? 0), 0);
            if (bidAmount + reserved > (team.faabRemaining ?? 0)) return state;
        }
        const record = {
            claimId: nextId("w", state.pendingClaims.map((item) => item.claimId)),
            teamId: claim.teamId,
            addIdentity: claim.addIdentity,
            addName: claim.addName,
            addPosition: claim.addPosition,
            dropEntryId: claim.dropEntryId,
            week: state.currentWeek,
            ...(faab ? { bidAmount } : {}),
        };
        const events = appendEvents(state.activity);
        events.push(state.currentWeek, "waiver", faab
            ? `Waivers — ${team.name} bids $${bidAmount} for ${claim.addName}`
            : `Waivers — ${team.name} files a claim for ${claim.addName}`, createdAt);
        return { ...state, pendingClaims: [...state.pendingClaims, record], activity: events.list() };
    }

    function cancelWaiverClaim(state, claimId) {
        if (!state.pendingClaims.some((item) => item.claimId === claimId)) return state;
        return { ...state, pendingClaims: state.pendingClaims.filter((item) => item.claimId !== claimId) };
    }

    function processWaivers(state, cards, createdAt) {
        if (!state.pendingClaims.length) return state;
        const faab = state.settings.waiverMode === "faab";
        const priority = computeStandings(state).map((standing) => standing.teamId).reverse();
        const rank = new Map(priority.map((teamId, index) => [teamId, index]));
        // FAAB sorts by bid first — highest offer wins a contested player — then
        // falls back to the same worst-record priority as a tiebreak; priority
        // mode ignores bid entirely, exactly as it always has.
        const ordered = [...state.pendingClaims].sort((left, right) => (
            (faab ? (right.bidAmount ?? 0) - (left.bidAmount ?? 0) : 0)
            || (rank.get(left.teamId) ?? priority.length) - (rank.get(right.teamId) ?? priority.length)
            || idNumber(left.claimId, "w") - idNumber(right.claimId, "w")
        ));
        const taken = new Set(state.teams.flatMap((team) => team.roster.map((entry) => entry.identity)));
        const week = state.currentWeek;
        const benchCapacity = state.settings.rosterSlots.BN ?? 0;
        const events = appendEvents(state.activity);
        let teams = state.teams;
        let entryNumber = nextEntryNumber(state);
        for (const claim of ordered) {
            const team = teams.find((item) => item.teamId === claim.teamId);
            const card = cards.get(claim.addIdentity);
            // No era-allowed season left for this position means no add: the claim
            // dies here rather than smuggling an out-of-era player onto a roster.
            const drawnSeason = card ? drawSeasonFrom(eraSeasons(state, card), `${state.seed}:waiver:${card.identity}:${claim.week}`) : null;
            if (!team || !card || drawnSeason === null) {
                events.push(week, "waiver", `Waivers W${week} — claim on ${claim.addName} voided`, createdAt);
                continue;
            }
            if (taken.has(claim.addIdentity)) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} misses ${card.name}${faab ? " (outbid)" : ""}`, createdAt);
                continue;
            }
            const dropEntry = claim.dropEntryId ? team.roster.find((entry) => entry.entryId === claim.dropEntryId) ?? null : null;
            if (claim.dropEntryId && !dropEntry) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} claim on ${card.name} voided`, createdAt);
                continue;
            }
            const afterDrop = dropEntry ? team.roster.filter((entry) => entry.entryId !== dropEntry.entryId) : team.roster;
            if (afterDrop.filter((entry) => entry.slot === "BN").length >= benchCapacity) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} claim on ${card.name} voided`, createdAt);
                continue;
            }
            if (card.position === "QB" && afterDrop.filter((entry) => entry.position === "QB").length >= state.settings.maxQuarterbacks) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} claim on ${card.name} voided (quarterback limit)`, createdAt);
                continue;
            }
            const bidAmount = faab ? (claim.bidAmount ?? 0) : null;
            if (faab && bidAmount > (team.faabRemaining ?? 0)) {
                events.push(week, "waiver", `Waivers W${week} — ${team.name} claim on ${card.name} voided (insufficient budget)`, createdAt);
                continue;
            }
            const entry = {
                entryId: `e${entryNumber}`,
                identity: card.identity,
                name: card.name,
                position: card.position,
                drawnSeason,
                slot: "BN",
                acquiredVia: "waiver",
                acquiredWeek: week,
            };
            entryNumber += 1;
            teams = teams.map((item) => (item.teamId === team.teamId ? {
                ...item,
                roster: [...afterDrop, entry],
                ...(faab ? { faabRemaining: (item.faabRemaining ?? 0) - bidAmount } : {}),
            } : item));
            taken.add(card.identity);
            if (dropEntry) taken.delete(dropEntry.identity);
            events.push(week, "waiver", `Waivers W${week} — ${team.name} lands ${card.name}${faab ? ` ($${bidAmount})` : ""}${dropEntry ? `, drops ${dropEntry.name}` : ""}`, createdAt);
        }
        return { ...state, teams, pendingClaims: [], activity: events.list() };
    }

    function proposeTrade(state, offer, createdAt) {
        if (state.phase !== "season" || !state.settings.tradesEnabled) return state;
        const from = state.teams.find((item) => item.teamId === offer.fromTeamId);
        const to = state.teams.find((item) => item.teamId === offer.toTeamId);
        if (!from || !to || from.teamId === to.teamId) return state;
        const give = [...new Set(offer.giveEntryIds)];
        const receive = [...new Set(offer.receiveEntryIds)];
        if (!give.length || give.length !== offer.giveEntryIds.length || receive.length !== offer.receiveEntryIds.length || give.length !== receive.length) return state;
        const owns = (team, ids) => ids.every((id) => team.roster.some((entry) => entry.entryId === id));
        if (!owns(from, give) || !owns(to, receive)) return state;
        const trade = {
            tradeId: nextId("tr", state.trades.map((item) => item.tradeId)),
            fromTeamId: from.teamId,
            toTeamId: to.teamId,
            giveEntryIds: give,
            receiveEntryIds: receive,
            week: state.currentWeek,
            status: "pending",
            note: offer.note,
            createdAt,
        };
        const events = appendEvents(state.activity);
        events.push(state.currentWeek, "trade", `Trade — ${from.name} offers ${to.name} ${give.length}-for-${receive.length}`, createdAt);
        return { ...state, trades: [...state.trades, trade], activity: events.list() };
    }

    function respondToTrade(state, tradeId, accept, note, createdAt) {
        const trade = state.trades.find((item) => item.tradeId === tradeId);
        if (!trade || trade.status !== "pending") return state;
        const from = state.teams.find((item) => item.teamId === trade.fromTeamId);
        const to = state.teams.find((item) => item.teamId === trade.toTeamId);
        if (!from || !to) return state;
        const nextNote = note || trade.note;
        const events = appendEvents(state.activity);
        if (!accept) {
            events.push(state.currentWeek, "trade", `Trade — ${to.name} rejects ${from.name} offer`, createdAt);
            return {
                ...state,
                trades: state.trades.map((item) => (item.tradeId === tradeId ? { ...item, status: "rejected", note: nextNote } : item)),
                activity: events.list(),
            };
        }
        const giveEntries = trade.giveEntryIds.map((id) => from.roster.find((entry) => entry.entryId === id)).filter(Boolean);
        const receiveEntries = trade.receiveEntryIds.map((id) => to.roster.find((entry) => entry.entryId === id)).filter(Boolean);
        if (giveEntries.length !== trade.giveEntryIds.length || receiveEntries.length !== trade.receiveEntryIds.length) return state;
        const qbAfter = (roster, out, incoming) =>
            roster.filter((entry) => entry.position === "QB" && !out.some((item) => item.entryId === entry.entryId)).length
            + incoming.filter((entry) => entry.position === "QB").length;
        if (qbAfter(from.roster, giveEntries, receiveEntries) > state.settings.maxQuarterbacks
            || qbAfter(to.roster, receiveEntries, giveEntries) > state.settings.maxQuarterbacks) {
            events.push(state.currentWeek, "trade", `Trade — ${from.name}/${to.name} deal voided (quarterback limit)`, createdAt);
            return {
                ...state,
                trades: state.trades.map((item) => (item.tradeId === tradeId ? { ...item, status: "rejected", note: "Voided — quarterback limit." } : item)),
                activity: events.list(),
            };
        }
        const moved = (entry) => ({ ...entry, slot: "BN", acquiredVia: "trade", acquiredWeek: state.currentWeek });
        const fromRoster = [...from.roster.filter((entry) => !trade.giveEntryIds.includes(entry.entryId)), ...receiveEntries.map(moved)];
        const toRoster = [...to.roster.filter((entry) => !trade.receiveEntryIds.includes(entry.entryId)), ...giveEntries.map(moved)];
        events.push(
            state.currentWeek,
            "trade",
            `Trade — ${from.name} sends ${giveEntries.map((entry) => entry.name).join(", ")} for ${receiveEntries.map((entry) => entry.name).join(", ")}`,
            createdAt,
        );
        return {
            ...state,
            teams: state.teams.map((item) => (
                item.teamId === from.teamId ? { ...item, roster: fromRoster }
                    : item.teamId === to.teamId ? { ...item, roster: toRoster }
                        : item
            )),
            trades: state.trades.map((item) => (item.tradeId === tradeId ? { ...item, status: "accepted", note: nextNote } : item)),
            activity: events.list(),
        };
    }

    // ----- storage normalization ------------------------------------------------

    const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
    const readString = (value) => (typeof value === "string" ? value : null);
    const readNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const readSlot = (value) => (ROSTER_SLOT_IDS.includes(String(value)) ? String(value) : "BN");

    function readArray(value, item) {
        if (!Array.isArray(value)) return null;
        const result = [];
        for (const raw of value) {
            const parsed = item(raw);
            if (parsed === null) return null;
            result.push(parsed);
        }
        return result;
    }

    const SCORING_KEYS = ["passTd", "reception", "rushRecYd", "passingYd", "turnover"];
    const STAT_KEYS = ["passYd", "passTd", "passInt", "rushYd", "rushTd", "rec", "recYd", "recTd", "fumblesLost", "twoPointConversions"];
    const AI_PERSONAS = ["warlord", "archivist", "gambler", "steward"];
    const AI_DIFFICULTIES = ["rookie", "veteran", "allpro"];

    const clampInt = (value, min, max) => Math.min(max, Math.max(min, Math.floor(value)));

    const readSettings = (value) => {
        if (!isRecord(value) || !isRecord(value.rosterSlots) || !isRecord(value.scoring)) return null;
        const rosterSlots = {};
        for (const [key, count] of Object.entries(value.rosterSlots)) {
            const parsed = readNumber(count);
            if (!ROSTER_SLOT_IDS.includes(key) || parsed === null) return null;
            // Hostile or fractional counts would desync rosterCapacity from slot checks.
            rosterSlots[key] = clampInt(parsed, 0, 12);
        }
        const scoring = { passTd: 0, reception: 0, rushRecYd: 0, passingYd: 0, turnover: 0 };
        for (const key of SCORING_KEYS) {
            const parsed = readNumber(value.scoring[key]);
            if (parsed === null) return null;
            scoring[key] = parsed;
        }
        const regularSeasonWeeks = readNumber(value.regularSeasonWeeks);
        const maxQuarterbacks = readNumber(value.maxQuarterbacks);
        if (regularSeasonWeeks === null || maxQuarterbacks === null) return null;
        return {
            rosterSlots,
            scoring,
            regularSeasonWeeks: clampInt(regularSeasonWeeks, 1, 18),
            maxQuarterbacks: clampInt(maxQuarterbacks, 0, 8),
            // Saves written before era drafting existed carry no rules at all; they
            // load as any-era instead of locking the league out of every player.
            eraRules: normalizeEraDraftRules(value.eraRules),
            eraAdjusted: value.eraAdjusted === true,
            waiversEnabled: value.waiversEnabled === true,
            tradesEnabled: value.tradesEnabled === true,
            // Saves written before FAAB existed carry no waiverMode at all; they
            // load as priority waivers rather than silently granting a budget.
            waiverMode: value.waiverMode === "faab" ? "faab" : "priority",
            faabBudget: clampInt(readNumber(value.faabBudget) ?? 100, 0, 1000),
            // "veteran" is today's only behavior, so saves written before difficulty
            // existed load unchanged rather than silently getting harder or easier.
            aiDifficulty: AI_DIFFICULTIES.includes(value.aiDifficulty) ? value.aiDifficulty : "veteran",
        };
    };

    const readEntry = (value) => {
        if (!isRecord(value)) return null;
        const entryId = readString(value.entryId);
        const identity = readString(value.identity);
        const name = readString(value.name);
        const position = normalizePlayerPosition(value.position);
        const drawnSeason = readNumber(value.drawnSeason);
        const acquiredWeek = readNumber(value.acquiredWeek);
        if (!entryId || !identity || !name || !position || drawnSeason === null || acquiredWeek === null) return null;
        const acquiredVia = value.acquiredVia === "waiver" || value.acquiredVia === "trade" ? value.acquiredVia : "draft";
        return { entryId, identity, name, position, drawnSeason, slot: readSlot(value.slot), acquiredVia, acquiredWeek };
    };

    // Helmet is deliberately NOT a hard requirement here (unlike roster/queue
    // above) — a league founded before this feature existed has no helmet on
    // disk at all, and rejecting the whole team over a missing cosmetic field
    // would corrupt real league data over a helmet. Falls back to the same
    // deterministic default createTimeLeague uses, keyed on teamId so it's
    // stable across reloads rather than reshuffling every load.
    const readHelmet = (value, teamId) => {
        const Helmet = App.TimeLeagueHelmet;
        if (isRecord(value)) {
            return {
                color: Helmet.colorById(readString(value.color) || "").id,
                facemask: Helmet.facemaskById(readString(value.facemask) || "").id,
                stripe: value.stripe !== false,
                stripeColor: readString(value.stripeColor) || Helmet.STRIPE_COLORS[0],
            };
        }
        return Helmet.defaultHelmet(teamId);
    };

    const readTeam = (value) => {
        if (!isRecord(value)) return null;
        const teamId = readString(value.teamId);
        const name = readString(value.name);
        const manager = value.manager === "human" || value.manager === "ai" ? value.manager : null;
        const roster = readArray(value.roster, readEntry);
        const queue = readArray(value.queue, readString);
        if (!teamId || !name || !manager || !roster || !queue) return null;
        const aiPersona = AI_PERSONAS.includes(value.aiPersona) ? value.aiPersona : null;
        const helmet = readHelmet(value.helmet, teamId);
        const hasFaab = "faabRemaining" in value;
        const faabRemaining = hasFaab ? readNumber(value.faabRemaining) : undefined;
        if (hasFaab && faabRemaining === null) return null;
        return { teamId, name, manager, ...(aiPersona ? { aiPersona } : {}), helmet, roster, queue, ...(faabRemaining !== undefined ? { faabRemaining } : {}) };
    };

    const readSeat = (value) => {
        if (!isRecord(value)) return null;
        const overall = readNumber(value.overall);
        const round = readNumber(value.round);
        const teamId = readString(value.teamId);
        return overall !== null && round !== null && teamId ? { overall, round, teamId } : null;
    };

    const readPick = (value) => {
        if (!isRecord(value)) return null;
        const seat = readSeat(value);
        const entryId = readString(value.entryId);
        const identity = readString(value.identity);
        const name = readString(value.name);
        const position = normalizePlayerPosition(value.position);
        const madeBy = value.madeBy === "human" || value.madeBy === "ai" ? value.madeBy : null;
        if (!seat || !entryId || !identity || !name || !position || !madeBy) return null;
        return { ...seat, entryId, identity, name, position, madeBy };
    };

    const readPair = (value) => {
        if (!Array.isArray(value) || value.length !== 2) return null;
        const home = readString(value[0]);
        const away = readString(value[1]);
        return home && away ? [home, away] : null;
    };

    const readScheduleWeek = (value) => {
        if (!isRecord(value)) return null;
        const week = readNumber(value.week);
        const pairs = readArray(value.pairs, readPair);
        return week !== null && pairs ? { week, pairs } : null;
    };

    /** Comfortably above the whole ScoringStatId surface, so only hostile saves hit it. */
    const EXTRA_KEY_LIMIT = 128;

    /**
     * The stored full-surface bag. Ids this build does not recognise are kept
     * rather than dropped — they price to nothing against any weights map, and
     * a save written by a newer build should not lose detail on a round trip.
     */
    const readExtra = (value) => {
        if (!isRecord(value)) return null;
        const extra = {};
        let kept = 0;
        for (const key of Object.keys(value)) {
            if (kept >= EXTRA_KEY_LIMIT) break;
            const parsed = readNumber(value[key]);
            if (parsed === null || parsed === 0) continue;
            extra[key] = parsed;
            kept += 1;
        }
        return kept > 0 ? extra : null;
    };

    const readStats = (value) => {
        if (!isRecord(value)) return null;
        const stats = { passYd: 0, passTd: 0, passInt: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0, fumblesLost: 0, twoPointConversions: 0 };
        for (const key of STAT_KEYS) {
            const parsed = readNumber(value[key]);
            if (parsed === null) return null;
            stats[key] = parsed;
        }
        const extra = readExtra(value.extra);
        if (extra) stats.extra = extra;
        return stats;
    };

    const readSnapshot = (value) => {
        if (!isRecord(value)) return null;
        const entryId = readString(value.entryId);
        const identity = readString(value.identity);
        const name = readString(value.name);
        const position = normalizePlayerPosition(value.position);
        const drawnSeason = readNumber(value.drawnSeason);
        const points = readNumber(value.points);
        const factor = readNumber(value.factor);
        const stats = value.stats == null ? null : readStats(value.stats);
        if (!entryId || !identity || !name || !position || drawnSeason === null || points === null || factor === null) return null;
        if (value.stats != null && stats === null) return null;
        return { entryId, identity, name, position, drawnSeason, slot: readSlot(value.slot), points, factor, stats };
    };

    const readTeamResult = (value) => {
        if (!isRecord(value)) return null;
        const teamId = readString(value.teamId);
        const total = readNumber(value.total);
        const starters = readArray(value.starters, readSnapshot);
        return teamId && total !== null && starters ? { teamId, total, starters } : null;
    };

    const readMatchup = (value) => {
        if (!isRecord(value)) return null;
        const home = readString(value.home);
        const away = readString(value.away);
        const homePoints = readNumber(value.homePoints);
        const awayPoints = readNumber(value.awayPoints);
        const winner = value.winner == null ? null : readString(value.winner);
        if (!home || !away || homePoints === null || awayPoints === null || (value.winner != null && winner === null)) return null;
        return { home, away, homePoints, awayPoints, winner };
    };

    const readFinalizedWeek = (value) => {
        if (!isRecord(value)) return null;
        const week = readNumber(value.week);
        const results = readArray(value.results, readTeamResult);
        const matchups = readArray(value.matchups, readMatchup);
        const headlines = readArray(value.headlines, readString);
        return week !== null && results && matchups && headlines ? { week, results, matchups, headlines } : null;
    };

    const readClaim = (value) => {
        if (!isRecord(value)) return null;
        const claimId = readString(value.claimId);
        const teamId = readString(value.teamId);
        const addIdentity = readString(value.addIdentity);
        const addName = readString(value.addName);
        const addPosition = normalizePlayerPosition(value.addPosition);
        const week = readNumber(value.week);
        if (!claimId || !teamId || !addIdentity || !addName || !addPosition || week === null) return null;
        const hasBid = "bidAmount" in value;
        const bidAmount = hasBid ? readNumber(value.bidAmount) : undefined;
        if (hasBid && bidAmount === null) return null;
        return { claimId, teamId, addIdentity, addName, addPosition, dropEntryId: readString(value.dropEntryId) ?? "", week, ...(bidAmount !== undefined ? { bidAmount } : {}) };
    };

    const readTrade = (value) => {
        if (!isRecord(value)) return null;
        const tradeId = readString(value.tradeId);
        const fromTeamId = readString(value.fromTeamId);
        const toTeamId = readString(value.toTeamId);
        const giveEntryIds = readArray(value.giveEntryIds, readString);
        const receiveEntryIds = readArray(value.receiveEntryIds, readString);
        const week = readNumber(value.week);
        const status = value.status === "pending" || value.status === "accepted" || value.status === "rejected" || value.status === "withdrawn" ? value.status : null;
        const createdAt = readString(value.createdAt);
        if (!tradeId || !fromTeamId || !toTeamId || !giveEntryIds || !receiveEntryIds || week === null || !status || !createdAt) return null;
        return { tradeId, fromTeamId, toTeamId, giveEntryIds, receiveEntryIds, week, status, note: readString(value.note) ?? "", createdAt };
    };

    const readActivityEvent = (value) => {
        if (!isRecord(value)) return null;
        const id = readString(value.id);
        const week = readNumber(value.week);
        const kind = value.kind === "draft" || value.kind === "waiver" || value.kind === "trade" || value.kind === "week" || value.kind === "league" ? value.kind : null;
        const message = readString(value.message);
        const createdAt = readString(value.createdAt);
        if (!id || week === null || !kind || !message || !createdAt) return null;
        return { id, week, kind, message, createdAt };
    };

    function normalizeTimeLeague(raw) {
        if (!isRecord(raw) || raw.version !== 1) return null;
        const leagueId = readString(raw.leagueId);
        const name = readString(raw.name);
        const seed = readString(raw.seed);
        const createdAt = readString(raw.createdAt);
        const phase = raw.phase === "draft" || raw.phase === "season" || raw.phase === "complete" ? raw.phase : null;
        const settings = readSettings(raw.settings);
        const teams = readArray(raw.teams, readTeam);
        const draftOrder = readArray(raw.draftOrder, readSeat);
        const draftPicks = readArray(raw.draftPicks, readPick);
        const schedule = readArray(raw.schedule, readScheduleWeek);
        const finalizedWeeks = readArray(raw.finalizedWeeks, readFinalizedWeek);
        const pendingClaims = readArray(raw.pendingClaims, readClaim);
        const trades = readArray(raw.trades, readTrade);
        const activity = readArray(raw.activity, readActivityEvent);
        const currentWeek = readNumber(raw.currentWeek);
        if (!leagueId || !name || !seed || !createdAt || !phase || !settings || !teams || !teams.length
            || !draftOrder || !draftPicks || !schedule || !finalizedWeeks || !pendingClaims || !trades || !activity || currentWeek === null) return null;
        const championTeamId = readString(raw.championTeamId);
        return {
            version: 1,
            leagueId,
            name,
            seed,
            createdAt,
            phase,
            settings,
            teams,
            draftOrder,
            draftPicks,
            seasonsRevealed: raw.seasonsRevealed === true,
            currentWeek: clampInt(currentWeek, 1, settings.regularSeasonWeeks + 1),
            schedule,
            finalizedWeeks,
            pendingClaims,
            trades,
            activity,
            ...(championTeamId ? { championTeamId } : {}),
        };
    }

    const api = {
        rosterCapacity, createTimeLeague, currentDraftSeat, draftedIdentities, eraEligibleCards,
        positionIsStartable, applyDraftPick, setEntrySlot, autoFillLineup, lineupProblems,
        finalizeCurrentWeek, computeStandings, freeAgents, submitWaiverClaim, cancelWaiverClaim,
        processWaivers, proposeTrade, respondToTrade, normalizeTimeLeague,
    };
    App.TimeLeagueEngine = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
