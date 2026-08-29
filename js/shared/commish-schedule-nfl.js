// ══════════════════════════════════════════════════════════════════
// js/shared/commish-schedule-nfl.js — window.App.Commish.ScheduleNFL
//
// NFL-STYLE DIVISION SCHEDULE — a second generation strategy for the
// Schedule Builder (commish-schedule.js), for leagues built around real
// divisions. Everything it produces is the SAME schedule shape
// commish-schedule.js already defines ([{week, matchups, bye, source}]),
// so the existing panel — force-a-pairing, validateSchedule, actuals sync,
// export — works on its output completely unchanged. This file only adds a
// second way to GENERATE that shape; it depends on
// App.Commish.Schedule.buildRoundRobin (load/require it first).
//
// The format (owner spec, verified against this league's real Sleeper
// data — 4 real divisions of 4, a previous_league_id chain with a
// completed prior season):
//
//   Weeks 1-3    each team plays its 3 division-mates once (round A)
//   Weeks 4-7    each team plays all 4 teams of ONE other full division —
//                which division rotates on a 3-year cycle (only 3 ways to
//                pair 4 divisions into two full-division matchups exist,
//                so a 3-year cycle covers all of them with no per-year
//                table needed: pattern = (season - 2021) mod 3)
//   Weeks 8-9    2 opponents chosen by PRIOR-SEASON standing: one from each
//                of the two divisions NOT played above — the team that
//                finished at your same division rank last year
//   Weeks 10-11  2 lottery opponents — an independent random perfect
//                matching of the full league each week, no de-duplication
//                against anything else, BY DESIGN ("for the sake of
//                spontaneity... a team may draw to play the same team
//                twice each year, every year, forever" — the owner's own
//                words). Labelled 'lottery' in the output so the UI can
//                mark them for hand-entry once the real bingo draw happens.
//   Weeks 12-14  the SAME 3 division-mates again (round B) — placed with a
//                deliberately arbitrary initial order at generation time;
//                flexFinalWeeks() reorders them once week 11 is actually
//                played, so the round where current #1 plays current #2
//                lands on week 14.
//
// Playoffs (weeks 15-17) are explicitly OUT of scope here — Sleeper
// generates its own bracket from playoff_week_start once the regular
// season standings exist; duplicating that would be pure overlap.
//
//   buildDivisionRotation(divisionIds, seasonYear)     — pure
//     → { opponentOf: {[divisionId]: opponentDivisionId}, pairs: [[a,b],[c,d]] }
//     4 division ids ONLY — this format has no meaning for any other
//     count. Errors return null rather than guessing a pairing.
//
//   buildInterDivisionBlock(teamsA, teamsB)            — pure
//     → [[a,b], ...] × 4 rounds, a complete 4×4 bipartite pairing.
//
//   rankPriorSeason(rosterRows)                        — pure
//     rosterRows: [{teamId, division, wins, losses, fpts}] for ONE
//     completed season → { [teamId]: { division, rank(1-based) } }.
//     Ranks by wins desc, fpts desc (Sleeper's own standings tiebreak).
//
//   buildNFLStyleSeason(opts)                          — pure
//     opts: { teams:[{id,division}], priorStandings:{id:{division,rank}}|
//     null, seasonYear, rng? } — rng defaults to Math.random, injectable
//     for deterministic tests.
//     → { schedule, meta:{ divisionPairing, usedFallbackStandings } }
//     Requires EXACTLY 4 divisions of EQUAL size (this format's own
//     assumption — see isEligible). priorStandings=null (a league's true
//     first season) falls back to ranking by team id within each division
//     and sets meta.usedFallbackStandings so the UI can say so plainly —
//     never a silent, unlabeled fabrication.
//
//   isEligible(teams)                                  — pure
//     → true only for exactly 4 divisions of equal size. The generic
//     round-robin stays the universal default; this format only offers
//     itself where its own assumptions actually hold.
//
//   retargetPairToWeek(schedule, teams4, targetWeek, teamA, teamB,
//                       candidateWeeks) — pure
//     Within a 4-team round-robin, "which round has A vs B" and "who else
//     plays" are both fixed by the other two teams — so moving A-vs-B to
//     targetWeek has exactly one valid outcome: swap it with whatever
//     pairing THIS SAME four teams already have at targetWeek. Only those
//     two weeks' entries for these 4 teams change; every other division's
//     game in either week is untouched. candidateWeeks is REQUIRED: these
//     4 teams play each other twice in this format (weeks 1-3 AND weeks
//     12-14), so "the week where A plays B" is genuinely ambiguous without
//     a window — an unscoped search can silently grab the already-played
//     block-A occurrence instead of the still-open block-B one.
//
//   flexFinalWeeks({ schedule, teams, currentStandings }) — pure
//     currentStandings: { [teamId]: { division, wins, losses, fpts } }
//     computed from ACTUAL results through week 11 (the office already
//     has this from Schedule.mergeActuals — this function does not fetch
//     anything). For each division, finds current #1/#2 and retargets
//     their round B game (already somewhere in weeks 12-14) onto week 14.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    App.Commish = App.Commish || {};

    function RR() {
        const S = App.Commish && App.Commish.Schedule;
        if (!S) throw new Error('commish-schedule-nfl.js requires commish-schedule.js loaded first');
        return S;
    }

    // ── Division rotation (pure math, no per-year table) ──────────────
    // Anchor year 2021 = pattern 0, per the owner's own worked example
    // (2021/2024/2027 -> 1v2,3v4). (season-2021) can be negative for a
    // season before the anchor; the double-mod keeps it a valid 0-2 index.
    function buildDivisionRotation(divisionIds, seasonYear) {
        const ids = (divisionIds || []).map(String);
        if (ids.length !== 4) return null;
        const patterns = [
            [[ids[0], ids[1]], [ids[2], ids[3]]],
            [[ids[0], ids[2]], [ids[1], ids[3]]],
            [[ids[0], ids[3]], [ids[1], ids[2]]],
        ];
        const idx = (((Number(seasonYear) - 2021) % 3) + 3) % 3;
        const pairs = patterns[idx];
        const opponentOf = {};
        pairs.forEach(([a, b]) => { opponentOf[a] = b; opponentOf[b] = a; });
        // `pairs` (not just the flat opponentOf map) is what the rank-games
        // block needs: the two divisions NOT played by a given division are
        // always exactly the OTHER pair, and a naive per-team assignment of
        // "which leftover division is week 8 vs week 9" produces a
        // structurally unbalanced week (verified: 9 games one week, 7 the
        // other) because two different teams can independently claim the
        // same pairing for different weeks. Cross-matching by POSITION
        // within each pair (first-of-A vs first-of-B in week 8, first-of-A
        // vs second-of-B in week 9, etc.) is what keeps both weeks at
        // exactly half the league.
        return { opponentOf, pairs };
    }

    // ── Inter-division 4x4 bipartite pairing ───────────────────────────
    // Fix teamsA, rotate teamsB — a bipartite analogue of the round-robin
    // circle method: round r pairs A[i] with B[(i+r) mod 4].
    function buildInterDivisionBlock(teamsA, teamsB) {
        const a = (teamsA || []).map(String), b = (teamsB || []).map(String);
        if (a.length !== 4 || b.length !== 4) return [];
        const rounds = [];
        for (let r = 0; r < 4; r++) {
            rounds.push(a.map((teamA, i) => [teamA, b[(i + r) % 4]]));
        }
        return rounds;
    }

    // ── Prior-season ranking (pure) ────────────────────────────────────
    function rankPriorSeason(rosterRows) {
        const rows = rosterRows || [];
        const byDivision = {};
        rows.forEach(r => {
            const d = String(r.division);
            (byDivision[d] = byDivision[d] || []).push(r);
        });
        const out = {};
        Object.entries(byDivision).forEach(([div, teams]) => {
            const sorted = teams.slice().sort((x, y) => (Number(y.wins) - Number(x.wins)) || (Number(y.fpts) - Number(x.fpts)));
            sorted.forEach((t, i) => { out[String(t.teamId)] = { division: div, rank: i + 1 }; });
        });
        return out;
    }

    // ── Eligibility (pure) ──────────────────────────────────────────────
    function isEligible(teams) {
        const byDiv = {};
        (teams || []).forEach(t => { const d = String(t.division); (byDiv[d] = byDiv[d] || []).push(t); });
        const divs = Object.values(byDiv);
        if (divs.length !== 4) return false;
        const size = divs[0].length;
        return size > 0 && divs.every(d => d.length === size);
    }

    function defaultRng() { return Math.random; }

    // ── The season (pure given its inputs; rng is the only "randomness") ─
    function buildNFLStyleSeason(opts) {
        const o = opts || {};
        const teams = o.teams || [];
        const rng = typeof o.rng === 'function' ? o.rng : defaultRng();
        if (!isEligible(teams)) return null;

        const byDiv = {};
        teams.forEach(t => { const d = String(t.division); (byDiv[d] = byDiv[d] || []).push(String(t.id)); });
        const divisionIds = Object.keys(byDiv).sort();
        const rotation = buildDivisionRotation(divisionIds, o.seasonYear);
        if (!rotation) return null;

        const usedFallbackStandings = !o.priorStandings;
        const standings = o.priorStandings || (() => {
            // True first season: no prior data exists to rank by. Fall back
            // to a stable, documented default (team-id order within each
            // division) rather than inventing a rank that looks earned.
            const fb = {};
            divisionIds.forEach(d => byDiv[d].slice().sort().forEach((id, i) => { fb[id] = { division: d, rank: i + 1 }; }));
            return fb;
        })();

        const week = {}; // week number -> matchups[]
        for (let w = 1; w <= 14; w++) week[w] = [];

        // Weeks 1-3 and 12-14: division round A + B (same opponents twice).
        // Both blocks are generated from the SAME 3-round round-robin per
        // division — round B just starts life in weeks 12-14 in generation
        // order; flexFinalWeeks() is what actually earns that placement.
        divisionIds.forEach(d => {
            const { rounds } = RR().buildRoundRobin({ teamIds: byDiv[d], weeks: 3 });
            rounds.forEach((pairs, i) => { week[1 + i].push(...pairs); week[12 + i].push(...pairs); });
        });

        // Weeks 4-7: the full other division, per this year's rotation.
        rotation.pairs.forEach(([d1, d2]) => {
            const rounds = buildInterDivisionBlock(byDiv[d1], byDiv[d2]);
            rounds.forEach((pairs, i) => { week[4 + i].push(...pairs); });
        });

        // Weeks 8-9: standing-based, one opponent from EACH of the two
        // divisions this team did NOT face in the inter-division block.
        //
        // Those two divisions are always exactly the OTHER pair: a team in
        // pairA plays pairA's partner in weeks 4-7, so its only remaining
        // opponents live in pairB, and vice versa. A per-team "which
        // leftover division is week 8 vs week 9" assignment is NOT globally
        // consistent — two different teams can each believe a given pairing
        // belongs to a different week, and de-duplicating by whichever
        // claims it first produces an unbalanced week (verified: 9 games
        // one week, 7 the other, for exactly this reason). Cross-matching
        // by POSITION within each pair is what keeps both weeks at exactly
        // half the league, with no dedup needed: pairA-first meets
        // pairB-first in week 8 and pairB-second in week 9; pairA-second
        // gets the opposite, so neither pairB division is double-booked.
        const rankOf = (id) => (standings[id] || {}).rank;
        const byDivisionAndRank = (d) => {
            const out = {};
            byDiv[d].forEach(id => { out[rankOf(id)] = id; });
            return out;
        };
        const rankMatch = (divA, divB, w) => {
            const a = byDivisionAndRank(divA), b = byDivisionAndRank(divB);
            Object.keys(a).forEach(r => { if (b[r]) week[w].push([a[r], b[r]]); });
        };
        // Exactly 2 pairs always exist (4 divisions), so this is a single
        // relationship, not a loop — a loop over both pairs runs the same
        // cross-match twice and duplicates every rank pairing.
        const [[d1, d2], [d3, d4]] = rotation.pairs;
        rankMatch(d1, d3, 8); rankMatch(d1, d4, 9);
        rankMatch(d2, d4, 8); rankMatch(d2, d3, 9);

        // Weeks 10-11: lottery. Independent random matching per week — NOT
        // checked against anything else in the schedule, by design.
        const allIds = teams.map(t => String(t.id));
        [10, 11].forEach(w => {
            const shuffled = allIds.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            for (let i = 0; i < shuffled.length; i += 2) week[w].push([shuffled[i], shuffled[i + 1]]);
        });

        const schedule = [];
        for (let w = 1; w <= 14; w++) {
            const source = (w >= 10 && w <= 11) ? 'lottery' : 'planned';
            schedule.push({ week: w, matchups: week[w], bye: null, source });
        }
        return { schedule, meta: { divisionPairing: rotation, usedFallbackStandings } };
    }

    // ── Post-week-11 flex ────────────────────────────────────────────
    // candidateWeeks is REQUIRED, not inferred. A division's 4 teams play
    // each other TWICE in this format — once in weeks 1-3, again in weeks
    // 12-14 — so searching the whole schedule for "the week where A plays
    // B" is genuinely ambiguous: the pair occurs in ONE week from EACH
    // block, and an unscoped search can silently grab the already-played
    // block-A week. Verified live: it did, and swapping that week's real,
    // played result out for a still-open week 14 slot corrupted a week
    // that had already happened. Restricting the search to the caller's
    // own window (flexFinalWeeks passes [12,13,14]) removes the ambiguity
    // entirely rather than requiring the caller to somehow pick the "right"
    // occurrence out of two valid-looking matches.
    function retargetPairToWeek(schedule, teams4, targetWeek, teamA, teamB, candidateWeeks) {
        const four = new Set((teams4 || []).map(String));
        const a = String(teamA), b = String(teamB);
        if (!four.has(a) || !four.has(b) || a === b) return { schedule, ok: false, error: 'teams4 must contain exactly A and B' };
        if (!Array.isArray(candidateWeeks) || !candidateWeeks.length) {
            return { schedule, ok: false, error: 'candidateWeeks is required — see the ambiguity note above' };
        }
        const weekSet = new Set(candidateWeeks.map(Number));
        // A week where this 4-team division plays ITSELF holds the division's
        // WHOLE matching for that week — TWO pairs (4 teams = 2 disjoint
        // pairs), not one. Swapping only the first-found pair (the original
        // bug here) leaves the second pair behind, duplicating one team and
        // dropping another. Every pair belonging to `four` must move together.
        const relevantPairs = (wk) => (wk.matchups || []).filter(([x, y]) => four.has(x) && four.has(y));
        const otherPairs = (wk) => (wk.matchups || []).filter(([x, y]) => !(four.has(x) && four.has(y)));

        const sourceWk = (schedule || []).find(wk => {
            if (!weekSet.has(wk.week)) return false;
            return relevantPairs(wk).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
        });
        if (!sourceWk) return { schedule, ok: false, error: a + ' vs ' + b + ' does not occur within weeks ' + candidateWeeks.join(',') + ' for this 4-team block' };
        if (sourceWk.week === Number(targetWeek)) return { schedule, ok: true, changed: false };

        if (!weekSet.has(Number(targetWeek))) {
            return { schedule, ok: false, error: 'target week ' + targetWeek + ' is outside candidateWeeks ' + candidateWeeks.join(',') };
        }
        const targetWk = (schedule || []).find(wk => wk.week === Number(targetWeek));
        if (!targetWk) return { schedule, ok: false, error: 'week ' + targetWeek + ' not found in schedule' };

        const srcRelevant = relevantPairs(sourceWk), tgtRelevant = relevantPairs(targetWk);
        const next = (schedule || []).map(wk => {
            if (wk.week === sourceWk.week) return { ...wk, matchups: [...otherPairs(wk), ...tgtRelevant] };
            if (wk.week === targetWk.week) return { ...wk, matchups: [...otherPairs(wk), ...srcRelevant] };
            return wk;
        });
        return { schedule: next, ok: true, changed: true };
    }

    function flexFinalWeeks(opts) {
        const o = opts || {};
        const teams = o.teams || [];
        const currentStandings = o.currentStandings || {};
        let schedule = o.schedule || [];
        const byDiv = {};
        teams.forEach(t => { const d = String(t.division); (byDiv[d] = byDiv[d] || []).push(String(t.id)); });

        const notes = [];
        Object.entries(byDiv).forEach(([div, ids]) => {
            // ids.slice() always returns all 4 team ids regardless of whether
            // their standings exist, and Number(undefined) - Number(undefined)
            // is NaN, which a sort comparator treats as "no preference" (keeps
            // input order) rather than throwing — so a division with NO real
            // standings data silently produced a meaningless-but-plausible-
            // looking #1/#2 instead of failing. A real assertion caught this:
            // an empty currentStandings should be a reported failure, not a
            // fabricated ranking that happens not to crash.
            const missing = ids.filter(id => !currentStandings[id] || !Number.isFinite(Number(currentStandings[id].wins)));
            if (missing.length) { notes.push({ division: div, ok: false, reason: 'no current-season standings data for ' + missing.join(', ') }); return; }
            const ranked = ids.slice().sort((x, y) => {
                const sx = currentStandings[x], sy = currentStandings[y];
                return (Number(sy.wins) - Number(sx.wins)) || (Number(sy.fpts) - Number(sx.fpts));
            });
            const first = ranked[0], second = ranked[1];
            const { schedule: next, ok, changed, error } = retargetPairToWeek(schedule, ids, 14, first, second, [12, 13, 14]);
            if (!ok) { notes.push({ division: div, ok: false, reason: error }); return; }
            schedule = next;
            notes.push({ division: div, ok: true, changed, week14: [first, second] });
        });
        return { schedule, notes };
    }

    App.Commish.ScheduleNFL = {
        buildDivisionRotation,
        buildInterDivisionBlock,
        rankPriorSeason,
        isEligible,
        buildNFLStyleSeason,
        retargetPairToWeek,
        flexFinalWeeks,
    };

    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Commish.ScheduleNFL;
})(typeof window !== 'undefined' ? window : globalThis);
