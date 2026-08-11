// ══════════════════════════════════════════════════════════════════
// time-league-gamecast.js — turns a finalized Time League week into a
// deterministic "live game day" timeline. Every starter's finalized points
// are split into 2-6 events whose points sum back to the entry total to the
// cent, so replaying the events cumulatively reproduces the final scores
// exactly.
//
// Ported from The Duat's app/gamecast-engine.ts.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { createSeededRandom } = App.TimeLeagueRoster;

    const toCents = (points) => Math.round(points * 100);

    /** Decade bucket for commentary flavor: 0 = pre-1980, 1 = 80s/90s, 2 = modern. */
    const eraOf = (season) => (season < 1980 ? 0 : season < 2000 ? 1 : 2);

    const CHUNK_LINES = {
        rush: [
            ["{name} grinds it out between the tackles — {yd} tough yards", "{name} pounds it forward for {yd}"],
            ["{name} rips off a {yd}-yard burst", "{name} slashes upfield for {yd}"],
            ["{name} churns out {yd} on the ground", "{name} finds a crease for {yd}"],
        ],
        pass: [
            ["{name} works the play-action — {yd} through the air", "{name} stays patient, {yd} yards passing"],
            ["{name} airs it out for {yd} yards", "{name} carves the secondary for {yd}"],
            ["{name} picks the zone apart — {yd} passing", "{name} moves the chains, {yd} through the air"],
        ],
        rec: [
            ["{name} works the sticks — {rec} grabs for {yd}", "{name} hauls in {rec} for {yd} the hard way"],
            ["{name} hauls in {rec} for {yd}", "{name} stacks {rec} catches for {yd} yards"],
            ["{name} wins in space — {rec} for {yd}", "{name} piles up {rec} catches, {yd} yards"],
        ],
    };

    const TD_LINES = {
        pass: [
            ["{name} play-fakes and strikes — {yd}-yard TD!", "{name} lofts it over the top, {yd}-yard score!"],
            ["{name} strikes — {yd}-yard TD to the corner!", "{name} fires a {yd}-yard dart for six!"],
            ["{name} threads it — {yd}-yard touchdown strike!", "{name} rips a {yd}-yard TD on a rope!"],
        ],
        rush: [
            ["{name} plunges in from {yd} out — old-school muscle!", "{name} grinds in a {yd}-yard touchdown between the tackles!"],
            ["{name} bounces outside and scores from {yd}!", "{name} hits the hole — {yd}-yard rushing TD!"],
            ["{name} punches it in from {yd} out!", "{name} walks in untouched from {yd}!"],
        ],
        rec: [
            ["{name} slips behind the coverage — {yd}-yard scoring grab!", "{name} hauls in the {yd}-yard touchdown down the seam!"],
            ["{name} SCORES — {yd}-yard strike!", "{name} torches the corner for a {yd}-yard TD!"],
            ["{name} wins in space — {yd}-yard touchdown!", "{name} takes the slant {yd} yards to the house!"],
        ],
    };

    const TURNOVER_LINES = [
        "{name} coughs it up — the drive dies on the spot",
        "{name} forces one into traffic and pays for it",
    ];

    /**
     * Kickers, team defenses and IDP record none of the yardage the offensive
     * splitter narrates, so their wire is built from the extended bag instead.
     * Scores get one event each; every other stat collapses into a single
     * counted play, which keeps a busy defense inside the 2-6 event budget.
     */
    const countOf = (count, one, many) => (count === 1 ? one : `${count} ${many}`);

    const SPECIAL_SPECS = [
        { key: "def_td", td: true, weight: 6, line: (name) => `${name} takes it back the other way — defensive touchdown!` },
        { key: "def_st_td", td: true, weight: 6, line: (name) => `${name} breaks the return all the way — touchdown!` },
        { key: "idp_td", td: true, weight: 6, line: (name) => `${name} scoops it clean and scores!` },
        { key: "safe", weight: 5, line: (name, n) => `${name} buries him in the end zone — ${countOf(n, "a safety", "safeties")}!` },
        { key: "idp_safe", weight: 5, line: (name, n) => `${name} drags him down for ${countOf(n, "a safety", "safeties")}!` },
        { key: "int", weight: 4, line: (name, n) => `${name} jumps the route — ${countOf(n, "intercepted", "interceptions")}!` },
        { key: "idp_int", weight: 4, line: (name, n) => `${name} reads it all the way — ${countOf(n, "a pick", "picks")}!` },
        { key: "fgm_50p", weight: 4, line: (name, n) => `${name} drills ${countOf(n, "one", "kicks")} from 50-plus!` },
        { key: "fgm_40_49", weight: 3, line: (name, n) => `${name} splits the uprights from 40-plus${n > 1 ? ` — ${n} of them` : ""}` },
        { key: "fgm_30_39", weight: 3, line: (name, n) => `${name} knocks through ${countOf(n, "a 30-yarder", "from 30-plus")}` },
        { key: "fgm_20_29", weight: 2, line: (name, n) => `${name} converts ${countOf(n, "the chip shot", "short field goals")}` },
        { key: "fgm_0_19", weight: 2, line: (name, n) => `${name} taps in ${countOf(n, "the gimme", "short ones")}` },
        { key: "fgm", weight: 3, line: (name, n) => `${name} is good on ${countOf(n, "the kick", "field goals")}` },
        { key: "sack", weight: 3, line: (name, n) => `${name} gets home — ${countOf(n, "a sack", "sacks")}` },
        { key: "idp_sack", weight: 3, line: (name, n) => `${name} wins the edge — ${countOf(n, "a sack", "sacks")}` },
        { key: "fr", weight: 3, line: (name, n) => `${name} pounces on ${countOf(n, "the loose ball", "loose balls")}` },
        { key: "idp_fr", weight: 3, line: (name, n) => `${name} falls on ${countOf(n, "the fumble", "fumbles")}` },
        { key: "ff", weight: 2, line: (name, n) => `${name} punches ${n === 1 ? "it" : `${n} of them`} out` },
        { key: "idp_ff", weight: 2, line: (name, n) => `${name} rakes ${countOf(n, "the ball", "balls")} free` },
        { key: "xpm", weight: 1, line: (name, n) => `${name} adds ${countOf(n, "the extra point", "extra points")}` },
        { key: "idp_pass_def", weight: 2, line: (name, n) => `${name} breaks up ${countOf(n, "the throw", "throws")}` },
        { key: "idp_tkl_loss", weight: 2, line: (name, n) => `${name} stuffs it behind the line — ${countOf(n, "a TFL", "TFLs")}` },
        { key: "idp_tkl_solo", weight: 1, line: (name, n) => `${name} cleans up — ${countOf(n, "a solo stop", "solo stops")}` },
        { key: "idp_tkl_ast", weight: 1, line: (name, n) => `${name} is in on ${countOf(n, "an assist", "assists")}` },
        { key: "fgmiss", weight: 1, line: (name, n) => `${name} pushes ${countOf(n, "one", "kicks")} wide` },
        { key: "xpmiss", weight: 1, line: (name, n) => `${name} yanks ${countOf(n, "the extra point", "extra points")}` },
    ];

    /** True when the line records no offensive production but does carry extended stats. */
    function isSpecialLine(stats) {
        if (!stats.extra || !Object.values(stats.extra).some((value) => Number(value) > 0)) return false;
        return !(stats.passYd || stats.rushYd || stats.recYd || stats.rec
            || stats.passTd || stats.rushTd || stats.recTd);
    }

    const fillLine = (template, values) => template
        .replace("{name}", values.name)
        .replace("{yd}", String(values.yd ?? 0))
        .replace("{rec}", String(values.rec ?? 0));

    function buildEntryEvents(seed, week, teamId, entry) {
        if (!entry.stats) return [];
        const stats = entry.stats;
        const pointsCents = toCents(entry.points);
        const random = createSeededRandom(`${seed}:cast:${week}:${entry.entryId}`);
        const era = eraOf(entry.drawnSeason);
        const factor = entry.factor > 0 ? entry.factor : 1;
        // Staggered kickoff waves (5/60/115) so different rosters feel like different game windows.
        const kickoff = 5 + Math.floor(random() * 3) * 55;

        if (isSpecialLine(stats)) {
            const extra = stats.extra;
            const present = SPECIAL_SPECS
                .map((spec) => ({ spec, count: Math.round(Number(extra[spec.key] ?? 0)) }))
                .filter((item) => item.count > 0);
            const moments = [];
            // Scores are individual moments; everything else collapses to one counted play.
            for (const item of present.filter((candidate) => candidate.spec.td)) {
                for (let index = 0; index < Math.min(item.count, 3); index += 1) {
                    moments.push({ line: item.spec.line(entry.name, 1), isTouchdown: true, weight: item.spec.weight });
                }
            }
            const room = Math.max(1, 6 - moments.length);
            for (const item of present.filter((candidate) => !candidate.spec.td).slice(0, room)) {
                moments.push({ line: item.spec.line(entry.name, item.count), isTouchdown: false, weight: item.spec.weight });
            }
            if (!moments.length) return [];
            // Truncated stats still pay out: the final moment absorbs the remainder,
            // so the per-entry sum stays exact to the cent.
            const weightTotal = moments.reduce((sum, moment) => sum + moment.weight, 0);
            let spent = 0;
            return moments.map((moment, index) => {
                const cents = index === moments.length - 1 ? pointsCents - spent : Math.round(pointsCents * (moment.weight / weightTotal));
                spent += cents;
                return {
                    t: kickoff + Math.round(random() * 80),
                    teamId,
                    entryId: entry.entryId,
                    playerName: entry.name,
                    points: cents / 100,
                    description: moment.line,
                    isTouchdown: moment.isTouchdown,
                };
            });
        }

        const touchdowns = [];
        for (let count = 0; count < stats.passTd; count += 1) touchdowns.push("pass");
        for (let count = 0; count < stats.rushTd; count += 1) touchdowns.push("rush");
        for (let count = 0; count < stats.recTd; count += 1) touchdowns.push("rec");

        // Each TD claims a 6-ish point share (4 for passing), scaled by the era factor
        // and capped so turnover-heavy lines never over-allocate past the entry total.
        const tdRawCents = touchdowns.map((kind) => Math.round((kind === "pass" ? 400 : 600) * factor));
        const tdRawTotal = tdRawCents.reduce((sum, cents) => sum + cents, 0);
        const tdScale = tdRawTotal > 0 && pointsCents > 0 ? Math.min(1, pointsCents / tdRawTotal) : 0;
        const tdCents = tdRawCents.map((cents) => Math.round(cents * tdScale));

        const chunkRoll = 1 + Math.floor(random() * 4);
        const chunkCount = Math.min(Math.max(chunkRoll, touchdowns.length ? 1 : 2), Math.max(1, 6 - touchdowns.length));
        const weights = [];
        for (let index = 0; index < chunkCount; index += 1) weights.push(0.5 + random());
        const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

        // Non-TD chunks carry the exact remainder; the last chunk absorbs rounding.
        const chunkBudget = pointsCents - tdCents.reduce((sum, cents) => sum + cents, 0);
        const chunkCents = [];
        let allocated = 0;
        weights.forEach((weight, index) => {
            const cents = index === weights.length - 1 ? chunkBudget - allocated : Math.round(chunkBudget * (weight / weightTotal));
            allocated += cents;
            chunkCents.push(cents);
        });

        const volumes = [
            ["pass", Math.abs(stats.passYd)],
            ["rush", Math.abs(stats.rushYd)],
            ["rec", Math.abs(stats.recYd) + stats.rec * 8],
        ];
        volumes.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
        const [primary, secondary] = volumes;
        const categories = [];
        for (let index = 0; index < chunkCount; index += 1) {
            categories.push(secondary[1] > 0 && secondary[1] * 2 >= primary[1] && index % 2 === 1 ? secondary[0] : primary[0]);
        }
        const categoryYards = { pass: stats.passYd, rush: stats.rushYd, rec: stats.recYd };
        const categoryWeight = { pass: 0, rush: 0, rec: 0 };
        categories.forEach((category, index) => {
            categoryWeight[category] += weights[index];
        });

        const events = [];
        categories.forEach((category, index) => {
            const templateRoll = random();
            const timeRoll = random();
            const share = categoryWeight[category] > 0 ? weights[index] / categoryWeight[category] : 0;
            const yards = Math.round(categoryYards[category] * share);
            const catches = category === "rec" && stats.rec > 0 ? Math.max(1, Math.round(stats.rec * share)) : 0;
            const cents = chunkCents[index];
            const chunkPool = CHUNK_LINES[category][era];
            const description = cents < 0
                ? fillLine(TURNOVER_LINES[Math.floor(templateRoll * TURNOVER_LINES.length)], { name: entry.name })
                : yards >= 1
                    ? fillLine(chunkPool[Math.floor(templateRoll * chunkPool.length)], { name: entry.name, yd: yards, rec: catches })
                    : `${entry.name} pieces together the quiet yards`;
            events.push({
                t: kickoff + Math.round(timeRoll * 80),
                teamId,
                entryId: entry.entryId,
                playerName: entry.name,
                points: cents / 100,
                description,
                isTouchdown: false,
            });
        });

        touchdowns.forEach((kind, index) => {
            const yardRoll = random();
            const templateRoll = random();
            const timeRoll = random();
            const yards = 1 + Math.floor(yardRoll * (kind === "rush" ? 24 : 42));
            const tdPool = TD_LINES[kind][era];
            events.push({
                t: kickoff + Math.round(timeRoll * 80),
                teamId,
                entryId: entry.entryId,
                playerName: entry.name,
                points: tdCents[index] / 100,
                description: fillLine(tdPool[Math.floor(templateRoll * tdPool.length)], { name: entry.name, yd: yards }),
                isTouchdown: true,
            });
        });

        return events;
    }

    function buildGamecast(input) {
        const decorated = [];
        for (const result of input.results) {
            for (const entry of result.starters) {
                if (!entry.stats || toCents(entry.points) === 0) continue;
                for (const event of buildEntryEvents(input.seed, input.week, result.teamId, entry)) {
                    decorated.push({ event, seq: decorated.length });
                }
            }
        }
        decorated.sort((left, right) => left.event.t - right.event.t
            || left.event.entryId.localeCompare(right.event.entryId)
            || left.seq - right.seq);
        return {
            week: input.week,
            events: decorated.map((item) => item.event),
            finals: Object.fromEntries(input.results.map((result) => [result.teamId, toCents(result.total) / 100])),
        };
    }

    function weekHeadlines(results, matchups, teamName) {
        const fmt = (value) => String(toCents(value) / 100);
        const headlines = [];

        let topTeam = null;
        for (const result of results) {
            if (!topTeam || result.total > topTeam.total) topTeam = result;
        }
        if (topTeam) headlines.push(`${teamName(topTeam.teamId)} set the week's pace with ${fmt(topTeam.total)} points.`);

        let bestLine = null;
        for (const result of results) {
            for (const entry of result.starters) {
                if (!bestLine || entry.points > bestLine.entry.points) bestLine = { entry, teamId: result.teamId };
            }
        }
        if (bestLine) {
            headlines.push(`Line of the week: ${bestLine.entry.name} goes for ${fmt(bestLine.entry.points)} to power ${teamName(bestLine.teamId)}.`);
        }

        const margin = (matchup) => Math.abs(matchup.homePoints - matchup.awayPoints);
        let closest = null;
        let blowout = null;
        let shootout = null;
        for (const matchup of matchups) {
            if (!closest || margin(matchup) < margin(closest)) closest = matchup;
            if (!blowout || margin(matchup) > margin(blowout)) blowout = matchup;
            if (!shootout || matchup.homePoints + matchup.awayPoints > shootout.homePoints + shootout.awayPoints) shootout = matchup;
        }
        if (closest) {
            if (closest.winner) {
                const loser = closest.winner === closest.home ? closest.away : closest.home;
                headlines.push(`Closest call: ${teamName(closest.winner)} edge ${teamName(loser)} by ${fmt(margin(closest))}.`);
            } else {
                headlines.push(`${teamName(closest.home)} and ${teamName(closest.away)} deadlock at ${fmt(closest.homePoints)}.`);
            }
        }
        if (blowout && blowout !== closest && blowout.winner) {
            const loser = blowout.winner === blowout.home ? blowout.away : blowout.home;
            headlines.push(`${teamName(blowout.winner)} roll past ${teamName(loser)} by ${fmt(margin(blowout))}.`);
        }
        if (shootout && shootout !== closest && shootout !== blowout && headlines.length < 5) {
            headlines.push(`Shootout: ${teamName(shootout.home)} and ${teamName(shootout.away)} combine for ${fmt(shootout.homePoints + shootout.awayPoints)}.`);
        }
        return headlines.slice(0, 5);
    }

    const api = { buildGamecast, weekHeadlines };
    App.TimeLeagueGamecast = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
