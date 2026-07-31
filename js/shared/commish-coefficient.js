// ══════════════════════════════════════════════════════════════════
// js/shared/commish-coefficient.js — window.App.Commish.Coefficient
// THE COEFFICIENT: one rating per HUMAN across every league they share with
// the commissioner. Head-to-head records are schedule-polluted and league
// records don't cross league lines — but all-play does: every week each team
// "plays" everyone in its league, so aggregating all-play across a person's
// teams yields a schedule-neutral, cross-league skill number on one scale.
//
//   buildCoefficient({ graph, ledgers })
//     graph   = App.Commish.buildMemberGraph output (read-only input)
//     ledgers = { [leagueId]: App.Luck.buildLedger output }
//     → { rows: [{ userId, name, isMe, rating, prevRating, delta,
//                  provisional, apRecord, apGames, leagueCount, teamCount,
//                  perLeague: [{ leagueId, leagueName, rating|null,
//                                apRecord|null, record }] }],
//         gamesTotal }   // counted all-play games summed over every row
//
// Rating = round(1000 × (apW + apT/2) / apGames) — an all-play win rate on a
// 0–1000 scale, so 500 reads as "league average human". Provisional below 20
// counted games: a hot fortnight in one 10-teamer shouldn't outrank a proven
// 3-league grinder. Movement (delta) = rating minus the rating rebuilt with
// each ledger's latest week excluded — "what did this week do to you".
// Pure compute only; leagues with no ledger contribute nothing (never invent
// games). Warroom-local (direct <script> tag), Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    function pctToRating(w, l, t) {
        const games = w + l + t;
        if (!games) return null;
        return Math.round(((w + t / 2) / games) * 1000);
    }

    // 'W-L', with ties appended only when they exist — nobody wants '6-3-0'.
    function apRecord(w, l, t) {
        return t > 0 ? (w + '-' + l + '-' + t) : (w + '-' + l);
    }

    // Per-ledger week context, computed once per league and shared by every
    // person seated there: the latest counted week (the one delta excludes)
    // plus how many rosters actually posted a score each week. Weekly rows
    // carry allPlayW/allPlayL but NOT ties — ties are reconstructed as
    // opponents − W − L, where opponents = (rosters scoring that week) − 1.
    // That inversion is exact against luck-engine's buildLedger math because
    // every roster counted in a week gets exactly one weekly entry for it.
    function ledgerWeekInfo(ledger) {
        const counts = {};
        let maxWeek = 0;
        for (const w of (ledger && ledger.weeks) || []) if (w > maxWeek) maxWeek = w;
        for (const row of (ledger && ledger.rows) || []) {
            for (const e of row.weekly || []) {
                counts[e.week] = (counts[e.week] || 0) + 1;
                if (e.week > maxWeek) maxWeek = e.week;
            }
        }
        return { maxWeek, counts };
    }

    // ── The Coefficient (pure) ───────────────────────────────────────
    function buildCoefficient(opts) {
        const graph = (opts && opts.graph) || {};
        const people = graph.people || {};
        const ledgers = (opts && opts.ledgers) || {};

        const infoByLeague = {};
        function weekInfo(lid) {
            if (!infoByLeague[lid]) infoByLeague[lid] = ledgerWeekInfo(ledgers[lid]);
            return infoByLeague[lid];
        }

        const rows = [];
        let gamesTotal = 0;

        for (const uid of Object.keys(people)) {
            const p = people[uid];
            let W = 0, L = 0, T = 0;    // full aggregate, straight off ledger rows
            let pW = 0, pL = 0, pT = 0; // aggregate with each ledger's max week excluded
            const perLeague = [];

            for (const team of p.teams || []) {
                const ledger = ledgers[team.leagueId];
                const row = ledger && (ledger.rows || []).find(r => String(r.rosterId) === String(team.rosterId));
                if (!row) {
                    // Honest empty state: no ledger (or the seat isn't in it)
                    // → the team contributes zero games and shows null, never
                    // a fabricated 0-0 that reads like a real record.
                    perLeague.push({
                        leagueId: team.leagueId, leagueName: team.leagueName,
                        rating: null, apRecord: null, record: team.record,
                    });
                    continue;
                }
                const rT = row.allPlayT || 0;
                W += row.allPlayW; L += row.allPlayL; T += rT;

                const info = weekInfo(team.leagueId);
                for (const e of row.weekly || []) {
                    if (e.week >= info.maxWeek) continue;
                    const opp = Math.max(0, (info.counts[e.week] || 1) - 1);
                    pW += e.allPlayW; pL += e.allPlayL;
                    pT += Math.max(0, opp - e.allPlayW - e.allPlayL);
                }
                perLeague.push({
                    leagueId: team.leagueId, leagueName: team.leagueName,
                    rating: pctToRating(row.allPlayW, row.allPlayL, rT),
                    apRecord: apRecord(row.allPlayW, row.allPlayL, rT),
                    record: team.record,
                });
            }

            const apGames = W + L + T;
            gamesTotal += apGames;
            const rating = pctToRating(W, L, T);
            // No counted prior week anywhere → prevRating null → delta null
            // (a one-week season has no movement to report).
            const prevRating = pctToRating(pW, pL, pT);
            rows.push({
                userId: p.userId,
                name: p.name,
                isMe: !!p.isMe,
                rating,
                prevRating,
                delta: rating != null && prevRating != null ? rating - prevRating : null,
                provisional: apGames < 20,
                apRecord: apRecord(W, L, T),
                apGames,
                leagueCount: p.leagueCount,
                teamCount: (p.teams || []).length,
                perLeague,
            });
        }

        // Rating desc; unrated humans sink to the bottom. Sample size breaks
        // rating ties (more games = more proven), then name for determinism.
        rows.sort((a, b) => {
            if (a.rating == null && b.rating == null) return a.name.localeCompare(b.name);
            if (a.rating == null) return 1;
            if (b.rating == null) return -1;
            return b.rating - a.rating || b.apGames - a.apGames || a.name.localeCompare(b.name);
        });

        return { rows, gamesTotal };
    }

    App.Commish = App.Commish || {};
    App.Commish.Coefficient = { buildCoefficient };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Commish.Coefficient;
})(typeof window !== 'undefined' ? window : globalThis);
