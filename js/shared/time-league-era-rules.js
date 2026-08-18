// ══════════════════════════════════════════════════════════════════
// time-league-era-rules.js — era drafting rule layer for Time League. A
// league can draft from any era, lock the pool to chosen decades, or run
// "position roulette", where every position group is dealt one decade the
// moment the draft opens.
//
// Pure and framework-free. All randomness flows through createSeededRandom
// so a rolled draft replays identically forever.
//
// Ported from The Duat's app/era-rules.ts.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { defaultEraDraftRules } = App.TimeLeagueRules;
    const { createSeededRandom } = App.TimeLeagueRoster;

    /**
     * The bundled corpus starts at the 1970 merger, so there is deliberately no
     * 1960s entry — an era we cannot field is worse than an era we never offer.
     */
    const ERA_DECADES = [
        { id: "1970s", label: "1970s", from: 1970, to: 1979, blurb: "Ground-and-pound; 14-game seasons" },
        { id: "1980s", label: "1980s", from: 1980, to: 1989, blurb: "West Coast timing; the pass breaks open" },
        { id: "1990s", label: "1990s", from: 1990, to: 1999, blurb: "Workhorse backs; the cap arrives" },
        { id: "2000s", label: "2000s", from: 2000, to: 2009, blurb: "Bell-cow carries; dynasty defenses" },
        { id: "2010s", label: "2010s", from: 2010, to: 2019, blurb: "Air-raid volume; PPR heaven" },
        { id: "2020s", label: "2020s", from: 2020, to: 2029, blurb: "Motion and spread; the 17-game grind" },
    ];

    const DECADE_IDS = ERA_DECADES.map((decade) => decade.id);
    const DECADE_RANK = new Map(ERA_DECADES.map((decade, index) => [decade.id, index]));
    const DRAFT_MODES = ["any-era", "selected-decades", "position-roulette"];

    /** PlayerPosition order from time-league-roster.js; unknown positions sort after it. */
    const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

    /**
     * The kicking, team-defense and IDP box scores begin in 1999 upstream, which
     * covers exactly one season of the 1990s. A league told "kickers draft the
     * 1990s" would be shopping a single year, so the 1990s are deliberately left
     * off: availability starts at the first decade the corpus covers end to end.
     * The skill positions run the whole corpus, from the 1970 merger forward.
     */
    const FULL_SURFACE_DECADES = ["2000s", "2010s", "2020s"];

    /**
     * The decades each position can actually be *fielded* from. This is a fact
     * about the bundled dataset, not a league rule — dealing a position a decade
     * it cannot field leaves every card era-ineligible, which soft-locks a draft
     * that has a required slot for that position. Every rule below intersects
     * with this map.
     */
    const POSITION_ERA_AVAILABILITY = {
        QB: DECADE_IDS, RB: DECADE_IDS, WR: DECADE_IDS, TE: DECADE_IDS,
        K: FULL_SURFACE_DECADES, DEF: FULL_SURFACE_DECADES,
        DL: FULL_SURFACE_DECADES, LB: FULL_SURFACE_DECADES, DB: FULL_SURFACE_DECADES,
    };

    function isDecadeId(value) {
        return typeof value === "string" && DECADE_RANK.has(value);
    }

    function sortDecades(decades) {
        return [...decades].sort((a, b) => (DECADE_RANK.get(a) ?? 0) - (DECADE_RANK.get(b) ?? 0));
    }

    /** Callers stay loose ("qb", " Rb "), the map stays canonical. */
    function normalizePosition(value) {
        return typeof value === "string" ? value.trim().toUpperCase() : "";
    }

    function comparePositions(a, b) {
        const rankA = POSITION_ORDER.indexOf(a);
        const rankB = POSITION_ORDER.indexOf(b);
        const orderA = rankA === -1 ? POSITION_ORDER.length : rankA;
        const orderB = rankB === -1 ? POSITION_ORDER.length : rankB;
        if (orderA !== orderB) return orderA - orderB;
        if (a === b) return 0;
        return a < b ? -1 : 1;
    }

    function shuffleWith(values, random) {
        const result = [...values];
        for (let index = result.length - 1; index > 0; index -= 1) {
            const next = Math.floor(random() * (index + 1));
            [result[index], result[next]] = [result[next], result[index]];
        }
        return result;
    }

    /** The decade a season belongs to, or null when it predates the merger corpus. */
    function decadeOf(season) {
        const year = Math.trunc(Number(season));
        if (!Number.isFinite(year)) return null;
        return ERA_DECADES.find((decade) => year >= decade.from && year <= decade.to)?.id ?? null;
    }

    function normalizePositionDecades(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const entries = Object.entries(value)
            .map(([position, decade]) => [normalizePosition(position), decade])
            .filter((entry) => entry[0] !== "" && isDecadeId(entry[1]))
            .sort((a, b) => comparePositions(a[0], b[0]));
        if (!entries.length) return undefined;
        return Object.fromEntries(entries);
    }

    /**
     * Defensive: anything that is not a recognizable rule object — localStorage
     * rot, a hand-edited import, an older league shape — degrades to any-era
     * rather than locking a league out of the entire player pool. An empty
     * positionDecades map is dropped so the draft can still roll one.
     */
    function normalizeEraDraftRules(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return defaultEraDraftRules();
        const raw = value;
        const mode = DRAFT_MODES.includes(raw.mode) ? raw.mode : "any-era";
        const decades = Array.isArray(raw.decades) ? sortDecades([...new Set(raw.decades.filter(isDecadeId))]) : [];
        const positionDecades = normalizePositionDecades(raw.positionDecades);
        const rules = { mode, decades };
        if (positionDecades) rules.positionDecades = positionDecades;
        return rules;
    }

    /**
     * The decades this position can be fielded from, newest dataset facts first.
     * A position the map does not name is assumed fieldable everywhere.
     */
    function availableDecadesFor(position) {
        const available = POSITION_ERA_AVAILABILITY[normalizePosition(position)];
        return available ? [...available] : [...DECADE_IDS];
    }

    /** The slice of `pool` this position can actually field, in pool order. */
    function eligibleDecades(pool, position) {
        const available = new Set(availableDecadesFor(position));
        return pool.filter((decade) => available.has(decade));
    }

    /**
     * The decades a position may draft from. An empty array means unrestricted.
     * Every branch intersects the league's rule with what the position can
     * field; an intersection that comes back empty means UNRESTRICTED rather
     * than blocked, since blocking would leave a required slot with zero legal
     * picks and the draft could never complete.
     */
    function allowedDecadesFor(rules, position) {
        const normalized = normalizeEraDraftRules(rules);
        if (normalized.mode === "selected-decades") return eligibleDecades(normalized.decades, position);
        if (normalized.mode === "position-roulette") {
            const assigned = normalized.positionDecades?.[normalizePosition(position)];
            return assigned ? eligibleDecades([assigned], position) : [];
        }
        return [];
    }

    function seasonAllowed(rules, position, season) {
        const allowed = allowedDecadesFor(rules, position);
        if (!allowed.length) return true;
        const decade = decadeOf(season);
        return decade !== null && allowed.includes(decade);
    }

    /**
     * Deals decades to positions from a seeded shuffle, refilling the bag a
     * whole decade-set at a time, so the roulette never quietly collapses the
     * league onto one era. A position with nothing eligible in the pool is left
     * out of the deal entirely — an absent position is unrestricted.
     */
    function rollPositionDecades(seed, positions, decades) {
        const pool = sortDecades([...new Set((decades ?? []).filter(isDecadeId))]);
        const entries = [...new Set((positions ?? []).map(normalizePosition).filter(Boolean))].sort(comparePositions);
        if (!pool.length || !entries.length) return {};
        const random = createSeededRandom(`${String(seed)}:era-roulette`);
        const rolled = {};
        const bags = new Map();
        entries.forEach((position) => {
            const eligible = eligibleDecades(pool, position);
            if (!eligible.length) return;
            const key = eligible.join("|");
            let bag = bags.get(key);
            if (!bag) {
                bag = [];
                bags.set(key, bag);
            }
            if (!bag.length) bag.push(...shuffleWith(eligible, random));
            const dealt = bag.shift();
            if (dealt) rolled[position] = dealt;
        });
        return rolled;
    }

    /**
     * Called once when the draft room opens. Only position-roulette leagues
     * that have not rolled yet are touched; the assignment is then frozen into
     * the rules so reopening the room shows the same ceremony.
     */
    function openDraftEra(rules, seed, positions) {
        const normalized = normalizeEraDraftRules(rules);
        if (normalized.mode !== "position-roulette" || normalized.positionDecades) return normalized;
        const pool = normalized.decades.length ? normalized.decades : DECADE_IDS;
        const rolled = rollPositionDecades(seed, positions, pool);
        if (!Object.keys(rolled).length) return normalized;
        return { ...normalized, positionDecades: rolled };
    }

    /** What the rules actually enforce, which is what the rail must show. */
    function rolledAssignments(rules) {
        const assignments = rules.positionDecades ?? {};
        return Object.entries(assignments)
            .filter((entry) => isDecadeId(entry[1]))
            .filter(([position, decade]) => eligibleDecades([decade], position).length > 0)
            .sort((a, b) => comparePositions(a[0], b[0]));
    }

    /** One line for the league header. */
    function eraRuleSummary(rules) {
        const normalized = normalizeEraDraftRules(rules);
        if (normalized.mode === "position-roulette") {
            const assignments = rolledAssignments(normalized);
            if (!assignments.length) return "Position roulette — decades are dealt when the draft opens";
            return `Position roulette — ${assignments.map(([position, decade]) => `${position} ${decade}`).join(" · ")}`;
        }
        if (normalized.mode === "selected-decades" && normalized.decades.length) {
            return `Selected decades — ${normalized.decades.join(" · ")}`;
        }
        return "Any era — every season since the 1970 merger";
    }

    /**
     * Short pills for the rules rail; always at least one. Position roulette
     * deliberately never lists the per-position decades here — this chip
     * rail renders on every screen of the league (nav header, dashboard),
     * not just the draft room, so spelling out "RB 2020s" here would leak
     * the whole roulette before the commissioner ever gets to turn a
     * position card over. The one place assignments are shown is the draft
     * room's Era Assignment reveal (time-league-draft-panel.js), one
     * position at a time, on demand.
     */
    function eraRuleChips(rules) {
        const normalized = normalizeEraDraftRules(rules);
        if (normalized.mode === "position-roulette") {
            const assignments = rolledAssignments(normalized);
            return assignments.length
                ? ["Position roulette", "Dealt at founding — reveal in the draft room"]
                : ["Position roulette", "Rolls at draft open"];
        }
        if (normalized.mode === "selected-decades" && normalized.decades.length) {
            return ["Selected decades", ...normalized.decades];
        }
        return ["Any era"];
    }

    /** Never mutates: always a fresh array, whole pool included when unrestricted. */
    function filterSeasonsForEra(seasons, rules, position) {
        const allowed = allowedDecadesFor(rules, position);
        if (!allowed.length) return [...seasons];
        const allowedDecades = new Set(allowed);
        return seasons.filter((entry) => {
            const decade = decadeOf(entry.season);
            return decade !== null && allowedDecades.has(decade);
        });
    }

    /** A card survives the era rules when at least one of its seasons is draftable. */
    function eraEligibleCard(card, rules) {
        return filterSeasonsForEra(card.seasons, rules, card.position).length > 0;
    }

    const api = {
        ERA_DECADES, POSITION_ERA_AVAILABILITY, decadeOf, normalizeEraDraftRules,
        availableDecadesFor, allowedDecadesFor, seasonAllowed, rollPositionDecades,
        openDraftEra, eraRuleSummary, eraRuleChips, filterSeasonsForEra, eraEligibleCard,
    };
    App.TimeLeagueEraRules = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
