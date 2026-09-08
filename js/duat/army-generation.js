// Duat army generation and ruler lottery.
// Preserved from The Duat app/roster-build.ts at ada801d.
// Source SHA-256: 4836fb6bf5cb2e7897b25237a648460b315e95b2239ada63c78fb24fcbabb94b
// Self-contained browser/server module. Scoring-year selection belongs to the campaign.
/* global module */
(function (root, factory) {
    const api = factory();
    (root.App = root.App || {}).DuatArmies = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const exports = {};
"use strict";
/**
 * Pure roster-build primitives shared by league setup, provider imports, the
 * custom draft room, and the preseason ruler reveal. This module intentionally
 * has no React, browser, storage, or network dependencies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUAT_ORIGINAL_D20_BANDS = exports.DUAT_ORIGINAL_ARMY_COUNT = exports.MATCHUP_FORMATS = exports.ROSTER_PRESETS = exports.SLOT_ELIGIBILITY = exports.ROSTER_SLOT_IDS = void 0;
exports.normalizeRosterSlots = normalizeRosterSlots;
exports.expandRosterSlots = expandRosterSlots;
exports.summarizeRosterSlots = summarizeRosterSlots;
exports.normalizeMatchupFormat = normalizeMatchupFormat;
exports.normalizePlayerPosition = normalizePlayerPosition;
exports.normalizePriorArmyCount = normalizePriorArmyCount;
exports.createArmyRollBands = createArmyRollBands;
exports.resolvePriorSeasons = resolvePriorSeasons;
exports.createSeededRandom = createSeededRandom;
exports.seededShuffle = seededShuffle;
exports.createLotteryRevealOrder = createLotteryRevealOrder;
exports.proportionalPositionTargets = proportionalPositionTargets;
exports.generateProportionalArmies = generateProportionalArmies;
exports.createRosterRevealSequence = createRosterRevealSequence;
exports.importProviderArmies = importProviderArmies;
exports.importArchivedArmies = importArchivedArmies;
exports.ROSTER_SLOT_IDS = [
    "QB",
    "RB",
    "WR",
    "TE",
    "FLEX",
    "REC_FLEX",
    "SUPER_FLEX",
    "K",
    "DEF",
    "DL",
    "LB",
    "DB",
    "IDP_FLEX",
    "BN",
    "IR",
    "TAXI",
];
exports.SLOT_ELIGIBILITY = {
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
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    FLEX: 0,
    REC_FLEX: 0,
    SUPER_FLEX: 0,
    K: 0,
    DEF: 0,
    DL: 0,
    LB: 0,
    DB: 0,
    IDP_FLEX: 0,
    BN: 0,
    IR: 0,
    TAXI: 0,
};
exports.ROSTER_PRESETS = {
    "duat-original": normalizeRosterSlots({ QB: 1, FLEX: 4, BN: 3 }),
    standard: normalizeRosterSlots({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DEF: 1, BN: 6, IR: 2 }),
    superflex: normalizeRosterSlots({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPER_FLEX: 1, BN: 8, IR: 3, TAXI: 3 }),
    idp: normalizeRosterSlots({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPER_FLEX: 1, DL: 2, LB: 2, DB: 2, IDP_FLEX: 1, BN: 10, IR: 3, TAXI: 3 }),
};
exports.MATCHUP_FORMATS = [
    { id: "head-to-head", label: "Head-to-head", description: "One scheduled opponent each scoring period." },
    { id: "all-play", label: "All-play", description: "Every team earns a result against every other team each period." },
    { id: "median", label: "Head-to-head + median", description: "A scheduled result plus a second result against the league median." },
    { id: "doubleheader", label: "Doubleheader", description: "Two scheduled opponents in the same scoring period." },
    { id: "total-points", label: "Total points", description: "Standings are determined by cumulative points rather than weekly matchups." },
    { id: "victory-points", label: "Victory points", description: "Award configurable points for wins, ties, and scoring bands." },
];
exports.DUAT_ORIGINAL_ARMY_COUNT = 4;
exports.DUAT_ORIGINAL_D20_BANDS = [
    { min: 1, max: 5, label: "1–5" },
    { min: 6, max: 10, label: "6–10" },
    { min: 11, max: 15, label: "11–15" },
    { min: 16, max: 20, label: "16–20" },
];
const RESERVE_SLOTS = new Set(["IR", "TAXI"]);
const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
function finiteCount(value, maximum = 64) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return 0;
    return Math.min(maximum, Math.max(0, Math.floor(number)));
}
function normalizeSlotName(value) {
    const raw = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
    const aliases = {
        BE: "BN",
        BENCH: "BN",
        RESERVE: "IR",
        DST: "DEF",
        "D/ST": "DEF",
        SUPERFLEX: "SUPER_FLEX",
        OP: "SUPER_FLEX",
        QB_FLEX: "SUPER_FLEX",
        WRRB_FLEX: "FLEX",
        WRRBTE_FLEX: "FLEX",
        "W/R/T": "FLEX",
        WRT: "FLEX",
        "W/R": "FLEX",
        REC: "REC_FLEX",
        IDP: "IDP_FLEX",
    };
    const normalized = aliases[raw] ?? raw;
    return exports.ROSTER_SLOT_IDS.includes(normalized) ? normalized : null;
}
function normalizeRosterSlots(input) {
    const result = { ...EMPTY_ROSTER_SLOTS };
    if (Array.isArray(input)) {
        for (const raw of input) {
            const slot = normalizeSlotName(String(raw));
            if (slot)
                result[slot] += 1;
        }
        return result;
    }
    if (!input || typeof input !== "object")
        return result;
    for (const [raw, count] of Object.entries(input)) {
        const slot = normalizeSlotName(raw);
        if (slot)
            result[slot] = finiteCount(count);
    }
    return result;
}
function expandRosterSlots(input, options = {}) {
    const counts = normalizeRosterSlots(input);
    return exports.ROSTER_SLOT_IDS.flatMap((slot) => {
        if (!options.includeReserveSlots && RESERVE_SLOTS.has(slot))
            return [];
        return Array.from({ length: counts[slot] }, () => slot);
    });
}
function summarizeRosterSlots(input) {
    const slots = normalizeRosterSlots(input);
    const starters = exports.ROSTER_SLOT_IDS.reduce((total, slot) => total + (BENCH_SLOTS.has(slot) ? 0 : slots[slot]), 0);
    const bench = slots.BN;
    const injuredReserve = slots.IR;
    const taxi = slots.TAXI;
    return {
        starters,
        bench,
        injuredReserve,
        taxi,
        activeRoster: starters + bench,
        totalCapacity: starters + bench + injuredReserve + taxi,
    };
}
function normalizeMatchupFormat(value) {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    const aliases = {
        h2h: "head-to-head",
        headtohead: "head-to-head",
        "head-to-head-plus-median": "median",
        "league-median": "median",
        allplay: "all-play",
        points: "total-points",
        totalpoints: "total-points",
        "victory-points": "victory-points",
        // Retired: the Heptad is a side tournament, not a matchup format. Canon
        // pairs it with an all-play season.
        heptad: "all-play",
    };
    const candidate = aliases[normalized] ?? normalized;
    return exports.MATCHUP_FORMATS.some((format) => format.id === candidate) ? candidate : "head-to-head";
}
function normalizePlayerPosition(value) {
    const raw = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    const aliases = {
        DST: "DEF",
        "D/ST": "DEF",
        TEAM_DEFENSE: "DEF",
        DE: "DL",
        DT: "DL",
        NT: "DL",
        EDGE: "DL",
        CB: "DB",
        S: "DB",
        FS: "DB",
        SS: "DB",
        ILB: "LB",
        OLB: "LB",
        MLB: "LB",
        // Historical archives label the skill positions by their era's names.
        HB: "RB",
        FB: "RB",
        TB: "RB",
        FL: "WR",
        SE: "WR",
        PK: "K",
    };
    const normalized = aliases[raw] ?? raw;
    return POSITION_ORDER.includes(normalized) ? normalized : null;
}
/**
 * Clamps a requested buried-army count to 0…maximum. Zero is a first-class
 * value: it turns the buried-ruler feature off entirely rather than being an
 * error, and one is a legal single-ruler deck.
 */
function normalizePriorArmyCount(value, maximum = 8) {
    const rawCeiling = Number(maximum);
    const ceiling = Number.isFinite(rawCeiling) ? Math.max(0, Math.floor(rawCeiling)) : 8;
    const count = Number(value);
    if (!Number.isFinite(count))
        return Math.min(exports.DUAT_ORIGINAL_ARMY_COUNT, ceiling);
    return Math.min(Math.max(0, Math.floor(count)), ceiling);
}
/**
 * Divides a die as evenly as possible across a configurable 0–8 army deck.
 * Zero armies means the feature is off, so there is nothing to roll for; one
 * army owns the whole die; four preserve the authentic
 * 1–5 / 6–10 / 11–15 / 16–20 bands.
 */
function createArmyRollBands(count, dieSides = 20) {
    const armyCount = normalizePriorArmyCount(count);
    if (armyCount <= 0)
        return [];
    const sides = Math.max(armyCount, Math.floor(Number(dieSides) || 20));
    const baseSize = Math.floor(sides / armyCount);
    let remainder = sides % armyCount;
    let min = 1;
    return Array.from({ length: armyCount }, () => {
        const size = baseSize + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        const max = min + size - 1;
        const band = { min, max, label: `${min}–${max}` };
        min = max + 1;
        return band;
    });
}
function resolvePriorSeasons(availableSeasons, count = 4, options = {}) {
    const maximumSeason = options.currentSeason == null ? Number.POSITIVE_INFINITY : Math.floor(options.currentSeason) - 1;
    const available = [...new Set(availableSeasons.map(Number).filter((season) => Number.isInteger(season) && season <= maximumSeason))]
        .sort((a, b) => b - a);
    const requested = [...new Set((options.requested ?? []).map(Number).filter(Number.isInteger))];
    const preferred = requested.filter((season) => available.includes(season));
    const fallback = available.filter((season) => !preferred.includes(season));
    return [...preferred, ...fallback].slice(0, normalizePriorArmyCount(count));
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
function seededShuffle(values, seed) {
    const random = createSeededRandom(seed);
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const next = Math.floor(random() * (index + 1));
        [result[index], result[next]] = [result[next], result[index]];
    }
    return result;
}
function createLotteryRevealOrder(teams, seed) {
    const random = createSeededRandom(`${seed}:lottery`);
    const totalWeight = teams.reduce((total, team) => total + Math.max(0.01, Number(team.lotteryWeight) || 1), 0);
    return teams
        .map((team) => {
        const lotteryWeight = Math.max(0.01, Number(team.lotteryWeight) || 1);
        const drawNumber = Math.floor(random() * 900000) + 100000;
        const raceScore = -Math.log(Math.max(Number.EPSILON, random())) / lotteryWeight;
        return {
            team,
            raceScore,
            drawNumber,
            lotteryWeight,
            initialOdds: lotteryWeight / totalWeight,
        };
    })
        .sort((left, right) => left.raceScore - right.raceScore || left.team.id.localeCompare(right.team.id))
        .map(({ team, drawNumber, lotteryWeight, initialOdds }, index) => ({
        revealIndex: index + 1,
        teamId: team.id,
        teamName: team.name,
        ownerName: team.ownerName,
        drawNumber,
        lotteryWeight,
        initialOdds,
    }));
}
function starterPositionWeights(slots) {
    const weights = Object.fromEntries(POSITION_ORDER.map((position) => [position, 0]));
    for (const slot of exports.ROSTER_SLOT_IDS) {
        if (BENCH_SLOTS.has(slot) || slots[slot] <= 0)
            continue;
        const eligible = exports.SLOT_ELIGIBILITY[slot];
        for (const position of eligible)
            weights[position] += slots[slot] / eligible.length;
    }
    if (Object.values(weights).every((value) => value <= 0)) {
        Object.assign(weights, { QB: 1, RB: 2, WR: 3, TE: 1 });
    }
    return weights;
}
/**
 * Turns a slot's eligibility into balanced concrete position targets. The
 * largest-remainder method keeps bench/flex demand proportional to starters.
 */
function proportionalPositionTargets(slot, count, rosterSlots, seed) {
    const total = finiteCount(count);
    if (!total)
        return [];
    const slots = normalizeRosterSlots(rosterSlots);
    const weights = starterPositionWeights(slots);
    const eligible = exports.SLOT_ELIGIBILITY[slot];
    const eligibleWeight = eligible.reduce((sum, position) => sum + weights[position], 0);
    const denominator = eligibleWeight > 0 ? eligibleWeight : eligible.length;
    const rows = eligible.map((position) => {
        const exact = total * ((eligibleWeight > 0 ? weights[position] : 1) / denominator);
        return { position, exact, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let left = total - rows.reduce((sum, row) => sum + row.count, 0);
    for (const row of seededShuffle(rows, `${seed}:${slot}:remainders`).sort((a, b) => b.remainder - a.remainder)) {
        if (left <= 0)
            break;
        row.count += 1;
        left -= 1;
    }
    return seededShuffle(rows.flatMap((row) => Array.from({ length: row.count }, () => row.position)), `${seed}:${slot}:targets`);
}
function teamSlotPlan(slots, teamId, season, seed, includeReserveSlots) {
    const plan = [];
    for (const slot of exports.ROSTER_SLOT_IDS) {
        if (!includeReserveSlots && RESERVE_SLOTS.has(slot))
            continue;
        const targets = proportionalPositionTargets(slot, slots[slot], slots, `${seed}:${season}:${teamId}`);
        for (const preferredPosition of targets)
            plan.push({ slot, preferredPosition });
    }
    return plan;
}
function weightedPlayerOrder(players, seed) {
    const random = createSeededRandom(seed);
    return [...players]
        .map((player) => {
        const rawWeight = player.allocationWeight ?? player.fantasyPoints ?? 1;
        const weight = Math.max(0.01, Number.isFinite(rawWeight) ? rawWeight : 1);
        return { player, score: -Math.log(Math.max(Number.EPSILON, random())) / weight };
    })
        .sort((left, right) => left.score - right.score || left.player.id.localeCompare(right.player.id))
        .map(({ player }) => player);
}
function uniqueTeams(teams) {
    const seen = new Set();
    return teams.filter((team) => {
        if (!team.id || seen.has(team.id))
            return false;
        seen.add(team.id);
        return true;
    });
}
function takePlayer(orderedPlayers, used, preferredPosition, slot) {
    const preferred = orderedPlayers.find((player) => !used.has(player.id) && player.position === preferredPosition);
    if (preferred)
        return preferred;
    const eligible = new Set(exports.SLOT_ELIGIBILITY[slot]);
    return orderedPlayers.find((player) => !used.has(player.id) && eligible.has(player.position));
}
function generateProportionalArmies(input) {
    const teams = uniqueTeams(input.teams);
    const rosterSlots = normalizeRosterSlots(input.rosterSlots);
    const historyCount = normalizePriorArmyCount(input.historyCount ?? 4);
    const seed = input.seed?.trim() || "the-duat";
    const source = input.source ?? "custom";
    // Zero buried armies is the feature switched off, not a data problem: no
    // seasons, no lottery, no ceremony, and deliberately no warnings.
    if (historyCount === 0)
        return { source, seed, seasons: [], revealOrder: [], armies: [], shortfalls: [], warnings: [] };
    const allSeasons = input.players.map((player) => player.season);
    const seasons = resolvePriorSeasons(allSeasons, historyCount, { requested: input.seasons, currentSeason: input.currentSeason });
    const revealOrder = createLotteryRevealOrder(teams, seed);
    const rollBands = createArmyRollBands(seasons.length);
    const armies = [];
    const shortfalls = [];
    const warnings = [];
    if (teams.length !== input.teams.length)
        warnings.push("Duplicate or blank team IDs were ignored.");
    if (seasons.length < historyCount)
        warnings.push(`Only ${seasons.length} of ${historyCount} requested prior seasons had player data.`);
    if (summarizeRosterSlots(rosterSlots).activeRoster === 0)
        warnings.push("The roster has no active slots to fill.");
    seasons.forEach((season, seasonIndex) => {
        const orderedPlayers = weightedPlayerOrder(input.players.filter((player) => player.season === season), `${seed}:${season}:players`);
        const used = new Set();
        const plans = new Map(teams.map((team) => [team.id, teamSlotPlan(rosterSlots, team.id, season, seed, Boolean(input.includeReserveSlots))]));
        const rosters = new Map(teams.map((team) => [team.id, []]));
        const rounds = Math.max(0, ...[...plans.values()].map((plan) => plan.length));
        for (let round = 0; round < rounds; round += 1) {
            const roundOrder = seededShuffle(teams, `${seed}:${season}:round:${round}`);
            for (const team of roundOrder) {
                const demand = plans.get(team.id)?.[round];
                if (!demand)
                    continue;
                const player = takePlayer(orderedPlayers, used, demand.preferredPosition, demand.slot);
                if (!player) {
                    shortfalls.push({ season, teamId: team.id, slot: demand.slot, preferredPosition: demand.preferredPosition });
                    continue;
                }
                used.add(player.id);
                rosters.get(team.id)?.push({ ...player, assignedSlot: demand.slot });
            }
        }
        for (const team of teams) {
            const roster = rosters.get(team.id) ?? [];
            armies.push({
                id: `${team.id}:${season}`,
                teamId: team.id,
                teamName: team.name,
                rulerNumber: seasonIndex + 1,
                season,
                source,
                rollBand: rollBands[seasonIndex],
                roster,
                totalFantasyPoints: roster.reduce((total, player) => total + (Number(player.fantasyPoints) || 0), 0),
            });
        }
    });
    if (shortfalls.length)
        warnings.push(`${shortfalls.length} roster slot${shortfalls.length === 1 ? "" : "s"} could not be filled from the available player pool.`);
    return { source, seed, seasons, revealOrder, armies, shortfalls, warnings };
}
function createRosterRevealSequence(result) {
    // With the buried-ruler feature off there is no reveal ceremony at all,
    // rather than a ceremony of empty envelopes.
    if (!result.armies.length)
        return [];
    return result.revealOrder.map((reveal) => ({
        ...reveal,
        armies: result.armies
            .filter((army) => army.teamId === reveal.teamId)
            .sort((left, right) => left.rulerNumber - right.rulerNumber),
    }));
}
/** Converts already-fetched Sleeper/MFL roster history into the same reveal contract. */
function importProviderArmies(teams, snapshots, options = {}) {
    const validTeams = uniqueTeams(teams);
    const seed = options.seed?.trim() || "the-duat";
    const historyCount = normalizePriorArmyCount(options.historyCount ?? 4);
    const seasons = resolvePriorSeasons(snapshots.map((snapshot) => snapshot.season), historyCount, { requested: options.seasons });
    const relevant = snapshots.filter((snapshot) => seasons.includes(snapshot.season));
    const source = relevant[0]?.provider ?? snapshots[0]?.provider ?? "sleeper";
    if (historyCount === 0)
        return { source, seed, seasons: [], revealOrder: [], armies: [], shortfalls: [], warnings: [] };
    const rollBands = createArmyRollBands(seasons.length);
    const armies = [];
    const warnings = [];
    seasons.forEach((season, seasonIndex) => {
        const seasonSnapshots = relevant.filter((snapshot) => snapshot.season === season && snapshot.provider === source);
        for (const team of validTeams) {
            const imported = seasonSnapshots.flatMap((snapshot) => snapshot.rosters).find((roster) => roster.teamId === team.id);
            const roster = (imported?.players ?? []).map((player) => ({ ...player, season, assignedSlot: player.position }));
            if (!imported)
                warnings.push(`${team.name} has no ${season} roster in the imported ${source} history.`);
            armies.push({
                id: `${team.id}:${season}`,
                teamId: team.id,
                teamName: imported?.teamName || team.name,
                rulerNumber: seasonIndex + 1,
                season,
                source,
                rollBand: rollBands[seasonIndex],
                roster,
                totalFantasyPoints: roster.reduce((total, player) => total + (Number(player.fantasyPoints) || 0), 0),
            });
        }
    });
    if (seasons.length < historyCount)
        warnings.unshift(`Only ${seasons.length} of ${historyCount} requested prior seasons were available from ${source}.`);
    return {
        source,
        seed,
        seasons,
        revealOrder: createLotteryRevealOrder(validTeams, seed),
        armies,
        shortfalls: [],
        warnings,
    };
}
/** Preserves exact archived rulers, kingdoms, assigned slots, years, and d20 bands. */
function importArchivedArmies(teams, decks, options = {}) {
    const validTeams = uniqueTeams(teams);
    const seed = options.seed?.trim() || options.archiveId?.trim() || "the-duat-archive";
    const historyCount = normalizePriorArmyCount(options.historyCount ?? exports.DUAT_ORIGINAL_ARMY_COUNT);
    if (historyCount === 0)
        return { source: "archive", seed, seasons: [], revealOrder: [], armies: [], shortfalls: [], warnings: [] };
    const generatedBands = createArmyRollBands(historyCount);
    // Archive decks do not need to share the same seasons. The founding Duat
    // workbook deliberately gives each faction its own four-year history.
    const selectedDecks = validTeams.flatMap((team) => decks
        .filter((deck) => deck.teamId === team.id)
        .sort((left, right) => left.rulerNumber - right.rulerNumber || right.season - left.season)
        .slice(0, historyCount));
    const armies = selectedDecks.map((deck) => ({
        id: deck.id,
        teamId: deck.teamId,
        teamName: deck.teamName || validTeams.find((team) => team.id === deck.teamId)?.name || deck.teamId,
        rulerNumber: deck.rulerNumber,
        rulerName: deck.rulerName,
        kingdom: deck.kingdom,
        season: deck.season,
        source: "archive",
        rollBand: deck.rollBand ?? generatedBands[deck.rulerNumber - 1],
        roster: [...deck.roster],
        totalFantasyPoints: deck.roster.reduce((total, player) => total + (Number(player.fantasyPoints) || 0), 0),
    }));
    const seasons = [...new Set(armies.map((army) => army.season))].sort((left, right) => right - left);
    const warnings = [];
    for (const team of validTeams) {
        const count = armies.filter((army) => army.teamId === team.id).length;
        if (count < historyCount)
            warnings.push(`${team.name} has ${count} of ${historyCount} requested archived armies.`);
    }
    return {
        source: "archive",
        seed,
        seasons,
        revealOrder: createLotteryRevealOrder(validTeams, seed),
        armies,
        shortfalls: [],
        warnings,
    };
}

    return exports;
});
