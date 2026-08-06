// ══════════════════════════════════════════════════════════════════
// js/shared/empire-values.js — window.App.EmpireValues
// MARK TO LEAGUE: price every league on its OWN book, then read the gaps.
//
//   build({ leagues, playersData, statsData, priorData, projectionsData,
//           playerScores, week, myUserId })
//     → { byLeague: { [lid]: { values, points, replacementPerWk, slots,
//                              teams, format, name } },
//         priceOf(pid, lid), spread(pid),
//         arbitrage: [{ pid, name, pos, high, low, spreadPct, legs }],
//         leagues: [{ id, name, format, teams, priced }],
//         unpriced: [lid] }
//
// WHY THIS EXISTS. Empire used to value all leagues with whichever single
// LeagueIntel happened to be loaded (the in-code "H5 approximation"). That is
// the one thing this app's value doctrine forbids: a league's SCORING and
// ROSTER are exactly what should move a price, and flattening them means a
// superflex 6-point-passing-TD league and a 1QB 4-point league quote the same
// number for the same quarterback.
//
// Fixing it hands you the feature for free: once every league is marked to its
// own book, the SPREAD between books is arbitrage. A quarterback worth 7,000
// in your superflex league and 4,000 in your 1QB league is not a rounding
// error — it is a trade that only a portfolio view can see.
//
// HONEST SCOPE. These are league-scored SEASONAL prices (the same projection
// and value-over-replacement engine every redraft/chopped surface uses), run
// once per league with that league's own scoring, roster slots and team count.
// For a dynasty league that is a this-season price, NOT a dynasty valuation —
// the long-horizon component (age, draft capital, market) is deliberately not
// re-derived per league, because it barely varies by league settings. So:
// spreads are trustworthy for "where does this player play bigger", and are
// not a claim about dynasty worth. Surfaces must label it that way.
//
// NOT A BUG, in case you go looking: closely-matched players can land on the
// SAME value. calcFantasyPts ends in Math.round(pts * 10) / 10 because fantasy
// points are scored to a tenth, so two quarterbacks projected 0.014 pts/week
// apart round to the same tenth and price identically. That is real scoring
// granularity, not a collapse — and at ~0.3% of a value it cannot manufacture
// a spread, which has to clear MIN_SPREAD_PCT to appear at all.
//
// Pure compute over injected data. Warroom-local, Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // A spread has to clear this to be worth a user's attention — below it the
    // gap is engine noise, not an opportunity.
    const MIN_SPREAD_PCT = 18;
    // Every league's board is re-anchored to this common scale before any
    // cross-league comparison, so "6,000 here vs 4,000 there" means the same
    // thing in both books.
    const COMMON_SCALE = 6000;
    // The anchor is the MEAN OF THE TOP N SKILL PLAYERS, not the single best
    // asset. A max-anchor is hostage to one outlier: a league whose settings
    // produce one freak valuation (a team defense scored through IDP rules,
    // say) would have its entire board divided down, inventing enormous fake
    // arbitrage against every other league. A top-N mean is robust to that.
    const ANCHOR_N = 12;
    const SKILL = { QB: 1, RB: 1, WR: 1, TE: 1 };
    // Both sides must be real assets; a 40-vs-10 gap is 300% and meaningless.
    const MIN_SIDE_VALUE = Math.round(COMMON_SCALE * 0.08);

    function formatOf(league) {
        const t = Number((league && league.settings && league.settings.type));
        if (t === 3) return 'chopped';
        if (t === 2) return 'dynasty';
        if (t === 1) return 'keeper';
        return 'redraft';
    }

    function build(opts) {
        opts = opts || {};
        const PV = App.PlayerValue;
        const leagues = (opts.leagues || []).filter(Boolean);
        if (!PV || !PV.computePrices || !leagues.length) return null;

        const playersData = opts.playersData || (root.S && root.S.players) || {};
        const byLeague = {};
        const unpriced = [];
        const meta = [];

        leagues.forEach(l => {
            const lid = String(l.league_id || l.id || '');
            if (!lid) return;
            const slots = PV.slotsFromRoster(l.roster_positions || []);
            const teams = Number(l.total_rosters) || (l.rosters || []).length || 12;
            let board = null;
            try {
                board = PV.computePrices({
                    league: l,
                    leagueId: lid,
                    week: opts.week,
                    scoring: l.scoring_settings || {},
                    perTeamSlots: slots,
                    totalTeams: teams,
                    playersData,
                    statsData: opts.statsData || {},
                    priorData: opts.priorData || {},
                    projectionsData: opts.projectionsData || null,
                    playerScores: opts.playerScores || null,
                });
            } catch (e) { board = null; }
            const fmt = formatOf(l);
            meta.push({ id: lid, name: l.name || 'League', format: fmt, teams, priced: !!board });
            if (!board) { unpriced.push(lid); return; }

            // Re-anchor onto the common scale using the top-N skill mean.
            const skillVals = [];
            for (const pid in board.values) {
                const v = board.values[pid];
                if (!(v > 0)) continue;
                const pos = (App.normPos && App.normPos((playersData[pid] || {}).position)) || (playersData[pid] || {}).position;
                if (SKILL[pos]) skillVals.push(v);
            }
            skillVals.sort((a, b) => b - a);
            const topN = skillVals.slice(0, ANCHOR_N);
            const anchor = topN.length ? topN.reduce((a, b) => a + b, 0) / topN.length : 0;
            const k = anchor > 0 ? (COMMON_SCALE / anchor) : 1;
            const values = {};
            for (const pid in board.values) values[pid] = Math.round((board.values[pid] || 0) * k);

            byLeague[lid] = {
                values, points: board.points,
                replacementPerWk: board.replacementPerWk,
                slots, teams, format: fmt, name: l.name || 'League',
                anchor: Math.round(anchor), rescale: Math.round(k * 1000) / 1000,
            };
        });

        const pricedIds = Object.keys(byLeague);
        if (!pricedIds.length) return { byLeague, leagues: meta, unpriced, arbitrage: [], priceOf: () => 0, spread: () => null };

        const priceOf = (pid, lid) => {
            const b = byLeague[String(lid)];
            return (b && b.values[pid]) || 0;
        };

        // Spread for one player across the leagues that priced him.
        const spread = (pid) => {
            const legs = [];
            pricedIds.forEach(lid => {
                const v = byLeague[lid].values[pid] || 0;
                if (v > 0) legs.push({ leagueId: lid, name: byLeague[lid].name, format: byLeague[lid].format, value: v });
            });
            if (legs.length < 2) return null;
            legs.sort((a, b) => b.value - a.value);
            const high = legs[0], low = legs[legs.length - 1];
            const spreadPct = low.value > 0 ? Math.round(((high.value - low.value) / low.value) * 100) : 0;
            return { legs, high, low, spreadPct };
        };

        // ── Arbitrage board ──────────────────────────────────────────
        // Every player priced in 2+ leagues, ranked by how differently those
        // leagues value him. Restricted to real assets on BOTH sides so the
        // list is actionable rather than a parade of percentage artifacts.
        const seen = Object.create(null);
        pricedIds.forEach(lid => { for (const pid in byLeague[lid].values) seen[pid] = 1; });
        const arbitrage = [];
        for (const pid in seen) {
            const s = spread(pid);
            if (!s) continue;
            if (s.low.value < MIN_SIDE_VALUE || s.spreadPct < MIN_SPREAD_PCT) continue;
            const p = playersData[pid] || {};
            arbitrage.push({
                pid,
                name: p.full_name || pid,
                pos: (App.normPos && App.normPos(p.position)) || p.position || '',
                team: p.team || null,
                high: s.high, low: s.low, spreadPct: s.spreadPct, legs: s.legs,
                // The absolute points of value between the two books — what you
                // actually capture. Percentage alone floats waiver flotsam to
                // the top (a 550-to-2,074 fringe back is +277% and not a move
                // anyone makes); gap surfaces the spreads worth acting on.
                gap: s.high.value - s.low.value,
            });
        }
        arbitrage.sort((a, b) => b.gap - a.gap || b.spreadPct - a.spreadPct);

        return { byLeague, leagues: meta, unpriced, arbitrage, priceOf, spread };
    }

    const api = { build, formatOf, MIN_SPREAD_PCT, MIN_SIDE_VALUE };
    App.EmpireValues = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
