// ══════════════════════════════════════════════════════════════════
// js/shared/commish-rulelab.js — App.Commish.RuleLab
// The Rule Lab: replay a completed season under a proposed scoring change.
// "Under this TE premium, a different team takes the #1 seed" — settled with
// the league's own season, not a hypothetical.
//
// METHODOLOGY (non-negotiable — this is what makes the lab honest):
// We NEVER compare proposed-scoring results against the points Sleeper
// actually recorded. The season is rescored TWICE through the IDENTICAL
// pipeline — once under the league's CURRENT scoring (the baseline), once
// under current-scoring-plus-proposal-overrides — and only those two runs
// are diffed. Sleeper's own rounding, stat corrections, and any drift
// between recorded points and raw stat lines cancel out completely:
// every difference shown is the rule change and nothing else.
//
// Equally non-negotiable: we NEVER claim a re-crowned CHAMPION. The playoffs
// were real games played by real people under the real rules; a scoring
// tweak cannot replay them. The lab only re-cuts the regular-season
// standings, the playoff FIELD, and the #1 SEED — hence the API speaks in
// standings/field/seed, never "champion".
//
//   PRESETS — [{ key, label, overrides }] common proposals; proposals
//     compose as plain objects: Object.assign({}, a.overrides, b.overrides).
//   loadSeasonStats(season)
//     → Promise<{ [week]: { [playerId]: rawStatLine } }> weeks 1..18 via the
//       public Sleeper stats endpoint. Module-level cache: stats are
//       league-independent, so ONE load serves every league in an omnibus.
//   loadSeasonLineups(leagueId, weeks)
//     → Promise<{ [week]: [{ rosterId, matchupId, points, starters }] }>
//       via the cached global fetchMatchups. Weeks with fewer than two
//       rosters holding real points are dropped (unplayed/in-progress).
//   scorePlayerWeek(statLine, scoring, position, calcFn)
//     → number. calcFn defaults to the global calcFantasyPts (position-
//       blind), so TE premium (scoring.bonus_rec_te = extra pts per TE
//       reception) is applied HERE, only when position === 'TE' — mirroring
//       startsit-engine scoreProjection.
//   rescoreSeason({ league, seasonStats, lineups, scoring, playersData, calcFn })
//     → { weeklyScores: { [wk]: [{ rosterId, points, matchupId }] },
//         playerTotals: { [pid]: seasonPts } }  — as-played: each
//       roster-week is the sum over its actual starters.
//   runProposal({ league, seasonStats, lineups, proposal, playersData,
//                 calcFn, myRosterId, season })
//     → { seasonUsed, weeksCounted, standingsShift, playoffField,
//         seedOneChanged, teamDeltas, playerDeltas, proposerNote }
//       or { empty: true, reason } when there is nothing to replay.
//   runOmnibus({ leagues, seasonStats, lineupsByLeague, proposal,
//                playersData, calcFn, myRosterIdByLeague })
//     → [{ leagueId, leagueName, result }] — each league is replayed
//       against its OWN current scoring as its baseline.
//
// Standings order = wins desc then PF desc (Sleeper's default; ties count
// half). Ledgers/standings come from App.Luck.buildLedger, so both rulesets
// also carry all-play and luck for free. Pure compute is fully deterministic
// and wall-clock-free (no Date.now()); fetch helpers are browser-only.
// Sleeper is READ-ONLY: the lab is an argument-settler, never an executor.
// Warroom-local (direct <script> tag), Node-testable (pure parts).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    App.Commish = App.Commish || {};

    // ── Proposal presets ─────────────────────────────────────────────
    // Plain override objects layered onto the league's CURRENT scoring.
    // Compose freely: Object.assign({}, halfPpr.overrides, tePrem.overrides).
    const PRESETS = [
        { key: 'std_rec', label: 'Standard (0 PPR)', overrides: { rec: 0 } },
        { key: 'half_ppr', label: 'Half PPR (0.5/rec)', overrides: { rec: 0.5 } },
        { key: 'full_ppr', label: 'Full PPR (1.0/rec)', overrides: { rec: 1.0 } },
        { key: 'te_premium_half', label: 'TE Premium (+0.5/rec)', overrides: { bonus_rec_te: 0.5 } },
        { key: 'te_premium_full', label: 'TE Premium (+1.0/rec)', overrides: { bonus_rec_te: 1.0 } },
        { key: 'six_pt_pass_td', label: '6-pt Passing TDs', overrides: { pass_td: 6 } },
        { key: 'harsh_int', label: 'INT −2', overrides: { pass_int: -2 } },
    ];

    // ── Data: season stat lines (impure, cached in-module) ───────────
    // Raw weekly stat lines for every NFL player. League-independent, so the
    // cache is keyed by season only — one network pass serves an entire
    // omnibus across N leagues. The cached value is the in-flight promise,
    // so concurrent callers share one load; a rejected load is evicted.
    const seasonStatsCache = {}; // { [season]: Promise<{week: {pid: statLine}}> }

    function loadSeasonStats(season) {
        const key = String(season || '');
        if (!key) return Promise.resolve({});
        if (seasonStatsCache[key]) return seasonStatsCache[key];
        const p = (async () => {
            const f = globalThis.fetch;
            const out = {};
            if (typeof f !== 'function') return out;
            const weeks = [];
            for (let w = 1; w <= 18; w++) weeks.push(w);
            await Promise.all(weeks.map(async w => {
                try {
                    const res = await f('https://api.sleeper.app/v1/stats/nfl/regular/' + key + '/' + w);
                    if (!res || !res.ok) return;
                    const body = await res.json();
                    if (body && typeof body === 'object' && Object.keys(body).length) out[w] = body;
                } catch (e) { /* skip week — an unplayed week has no stats */ }
            }));
            return out;
        })();
        seasonStatsCache[key] = p;
        p.catch(() => { delete seasonStatsCache[key]; });
        return p;
    }

    // ── Data: as-played lineups (impure) ─────────────────────────────
    // Who each roster actually STARTED, week by week. fetchMatchups is the
    // globally cached Sleeper fetcher, so no extra cache layer here. The
    // recorded `points` are kept ONLY for the played-week gate (≥2 rosters
    // with real points) — the rescoring pipeline never reads them.
    async function loadSeasonLineups(leagueId, weeks) {
        const lid = leagueId != null ? String(leagueId) : '';
        const out = {};
        if (!lid || typeof root.fetchMatchups !== 'function') return out;
        let ws = Array.isArray(weeks) && weeks.length ? weeks.map(Number) : null;
        if (!ws) { ws = []; for (let w = 1; w <= 18; w++) ws.push(w); }
        ws = ws.filter(w => w >= 1 && w <= 18);
        await Promise.all(ws.map(async w => {
            try {
                const rows = await root.fetchMatchups(lid, w);
                const mapped = (rows || []).map(r => ({
                    rosterId: r.roster_id,
                    matchupId: r.matchup_id != null ? r.matchup_id : null,
                    points: Number(r.points) || 0,
                    starters: Array.isArray(r.starters) ? r.starters.slice() : [],
                }));
                if (mapped.filter(x => x.points > 0).length >= 2) out[w] = mapped;
            } catch (e) { /* skip week */ }
        }));
        return out;
    }

    // ── Pure: score one player-week ──────────────────────────────────
    // calcFantasyPts is position-blind, so true TE premium (bonus_rec_te =
    // extra points per TE reception, on top of `rec`) can only be honored
    // here, where the caller supplies the position — the same seam
    // startsit-engine scoreProjection uses. calcFn is injectable for Node.
    function scorePlayerWeek(statLine, scoring, position, calcFn) {
        const score = calcFn || root.calcFantasyPts || (App.Sleeper && App.Sleeper.calcFantasyPts);
        if (typeof score !== 'function') throw new Error('rulelab: no calcFantasyPts available — pass calcFn');
        if (!statLine) return 0; // missing from that week's stats = 0, honestly
        let pts = Number(score(statLine, scoring || {})) || 0;
        const teBonus = (String(position || '').toUpperCase() === 'TE' && scoring && Number(scoring.bonus_rec_te))
            ? Number(scoring.bonus_rec_te) : 0;
        if (teBonus) pts += teBonus * (Number(statLine.rec) || 0);
        return pts;
    }

    function playerPos(p) {
        if (!p) return '';
        return p.position || (Array.isArray(p.fantasy_positions) && p.fantasy_positions[0]) || '';
    }
    function playerName(p, pid) {
        if (!p) return String(pid);
        return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || String(pid);
    }

    // ── Pure: rescore a season under one scoring object ──────────────
    // As-played: each roster-week total is the sum of scorePlayerWeek over
    // the starters that roster actually fielded. Empty slots ('0'/falsy)
    // are skipped; a started player with no stat line that week scores 0
    // but still registers in playerTotals (he was started — that's the
    // record). Both rulesets flow through THIS one function; see header.
    function rescoreSeason(opts) {
        const seasonStats = (opts && opts.seasonStats) || {};
        const lineups = (opts && opts.lineups) || {};
        const scoring = (opts && opts.scoring) || {};
        const playersData = (opts && opts.playersData) || {};
        const calcFn = opts && opts.calcFn;

        const weeks = Object.keys(lineups).map(Number).filter(w => w > 0).sort((a, b) => a - b);
        const weeklyScores = {};
        const playerTotals = {};

        for (const w of weeks) {
            const rows = lineups[w] || [];
            const stats = seasonStats[w] || {};
            const scored = [];
            for (const r of rows) {
                let total = 0;
                for (const rawPid of (r.starters || [])) {
                    if (!rawPid || rawPid === '0' || rawPid === 0) continue; // empty slot
                    const pid = String(rawPid);
                    const pts = scorePlayerWeek(stats[pid], scoring, playerPos(playersData[pid]), calcFn);
                    total += pts;
                    playerTotals[pid] = (playerTotals[pid] || 0) + pts;
                }
                scored.push({
                    rosterId: r.rosterId,
                    points: Math.round(total * 100) / 100,
                    matchupId: r.matchupId != null ? r.matchupId : null,
                });
            }
            weeklyScores[w] = scored;
        }
        for (const pid of Object.keys(playerTotals)) {
            playerTotals[pid] = Math.round(playerTotals[pid] * 100) / 100;
        }
        return { weeklyScores, playerTotals };
    }

    // ── Seeded copy ──────────────────────────────────────────────────
    function pickCopy(seed, variants) {
        const AV = root.AlexVoice;
        if (AV && typeof AV.pick === 'function') return AV.pick(seed, variants);
        return variants[0];
    }

    // Sleeper default standings: wins desc, then points-for desc. Ties count
    // half so a tie-heavy record ranks between the equivalent W/L records.
    function standingsSort(rows) {
        return rows.slice().sort((a, b) =>
            (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf || Number(a.rosterId) - Number(b.rosterId));
    }

    // ── Pure: the product ────────────────────────────────────────────
    // Rescore twice (current vs current+proposal), ledger both through
    // App.Luck.buildLedger, and diff. NOTE: no "champion" anywhere in this
    // return shape, on purpose — playoffs were real games; the lab only
    // re-cuts the regular-season standings, the playoff field, and the #1
    // seed. Keep it that way.
    function runProposal(opts) {
        const league = (opts && opts.league) || {};
        const seasonStats = (opts && opts.seasonStats) || {};
        const lineups = (opts && opts.lineups) || {};
        const proposal = (opts && opts.proposal) || {};
        const playersData = (opts && opts.playersData) || {};
        const calcFn = opts && opts.calcFn;
        const myRosterId = opts && opts.myRosterId;
        const seasonUsed = (opts && opts.season) || league.season || null;

        // A week counts when it holds lineup rows for at least two rosters —
        // the fetch helper already gated on real points; the pure path just
        // refuses weeks that cannot form a matchup.
        const counted = {};
        for (const k of Object.keys(lineups)) {
            const w = Number(k);
            if (w >= 1 && Array.isArray(lineups[k]) && lineups[k].length >= 2) counted[w] = lineups[k];
        }
        const weeks = Object.keys(counted).map(Number).sort((a, b) => a - b);
        if (!weeks.length) {
            return {
                empty: true,
                reason: 'No completed weeks with real lineups to replay — the Rule Lab needs at least one played week.',
                seasonUsed, weeksCounted: 0,
            };
        }

        const Luck = App.Luck;
        if (!Luck || typeof Luck.buildLedger !== 'function') {
            throw new Error('rulelab: App.Luck.buildLedger required — load luck-engine.js first');
        }

        const current = league.scoring_settings || {};
        const proposedScoring = Object.assign({}, current, proposal);
        const baseline = rescoreSeason({ league, seasonStats, lineups: counted, scoring: current, playersData, calcFn });
        const proposed = rescoreSeason({ league, seasonStats, lineups: counted, scoring: proposedScoring, playersData, calcFn });

        const baseOrder = standingsSort(Luck.buildLedger({ league, weeklyScores: baseline.weeklyScores }).rows);
        const propOrder = standingsSort(Luck.buildLedger({ league, weeklyScores: proposed.weeklyScores }).rows);
        if (!baseOrder.length) {
            return {
                empty: true,
                reason: 'League rosters are missing — cannot build standings to replay.',
                seasonUsed, weeksCounted: weeks.length,
            };
        }

        const baseRank = {}, propRank = {};
        baseOrder.forEach((r, i) => { baseRank[String(r.rosterId)] = i + 1; });
        propOrder.forEach((r, i) => { propRank[String(r.rosterId)] = i + 1; });

        // delta > 0 = the team CLIMBS under the proposal.
        const standingsShift = baseOrder.map(r => ({
            rosterId: r.rosterId,
            name: r.name,
            baselineRank: baseRank[String(r.rosterId)],
            proposedRank: propRank[String(r.rosterId)],
            delta: baseRank[String(r.rosterId)] - propRank[String(r.rosterId)],
        }));

        const size = Math.min(Number(league.settings && league.settings.playoff_teams) || 6, baseOrder.length);
        const baseField = baseOrder.slice(0, size);
        const propField = propOrder.slice(0, size);
        const baseSet = new Set(baseField.map(r => String(r.rosterId)));
        const propSet = new Set(propField.map(r => String(r.rosterId)));
        const inNames = propField.filter(r => !baseSet.has(String(r.rosterId))).map(r => r.name);
        const outNames = baseField.filter(r => !propSet.has(String(r.rosterId))).map(r => r.name);
        const playoffField = { size, in: inNames, out: outNames, unchanged: !inNames.length && !outNames.length };

        const b1 = baseOrder[0], p1 = propOrder[0];
        const seedOneChanged = String(b1.rosterId) === String(p1.rosterId) ? null
            : { from: b1.name, to: p1.name, fromRosterId: b1.rosterId, toRosterId: p1.rosterId };

        const propPf = {};
        propOrder.forEach(r => { propPf[String(r.rosterId)] = r.pf; });
        const teamDeltas = baseOrder.map(r => {
            const after = propPf[String(r.rosterId)] != null ? propPf[String(r.rosterId)] : 0;
            return {
                rosterId: r.rosterId,
                name: r.name,
                baselinePts: r.pf,
                proposedPts: after,
                delta: Math.round((after - r.pf) * 10) / 10,
            };
        }).sort((a, b) => b.delta - a.delta || Number(a.rosterId) - Number(b.rosterId));

        // Player-level winners and losers among STARTED players only.
        const pids = new Set(Object.keys(baseline.playerTotals).concat(Object.keys(proposed.playerTotals)));
        const moved = [];
        for (const pid of pids) {
            const d = Math.round(((proposed.playerTotals[pid] || 0) - (baseline.playerTotals[pid] || 0)) * 10) / 10;
            if (!d) continue;
            const p = playersData[pid];
            moved.push({ pid, name: playerName(p, pid), pos: playerPos(p), delta: d });
        }
        const gainers = moved.filter(x => x.delta > 0)
            .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name)).slice(0, 12);
        const losers = moved.filter(x => x.delta < 0)
            .sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name)).slice(0, 12);
        const playerDeltas = gainers.concat(losers);

        // Honest disclosure: when the proposer's roster is known, say where
        // it lands on the gainer board. A commissioner pitching a rule that
        // happens to pay their own team should be the FIRST to say so.
        let proposerNote = null;
        if (myRosterId != null) {
            const idx = teamDeltas.findIndex(t => String(t.rosterId) === String(myRosterId));
            if (idx >= 0) {
                const myRank = idx + 1;
                const n = teamDeltas.length;
                const seed = 'rulelab:' + String(league.league_id || league.id || '') + ':' + String(myRosterId)
                    + ':' + Object.keys(proposal).sort().join(',');
                proposerNote = {
                    myRank,
                    line: pickCopy(seed, [
                        'Full disclosure: your own roster is the #' + myRank + ' gainer of ' + n + ' under this proposal.',
                        'Worth saying out loud — this change ranks your roster #' + myRank + ' of ' + n + ' in points gained.',
                        'Before you table it: your team lands #' + myRank + ' of ' + n + ' on the gainer board under these rules.',
                    ]),
                };
            }
        }

        return {
            empty: false,
            seasonUsed,
            weeksCounted: weeks.length,
            standingsShift,
            playoffField,
            seedOneChanged,
            teamDeltas,
            playerDeltas,
            proposerNote,
        };
    }

    // ── Omnibus: one proposal across every commissioned league ───────
    // Pure mapping — each league is replayed against its OWN current
    // scoring as its baseline (runProposal reads league.scoring_settings),
    // and seasonStats is shared because stat lines are league-independent.
    function runOmnibus(opts) {
        const leagues = (opts && opts.leagues) || [];
        const lineupsByLeague = (opts && opts.lineupsByLeague) || {};
        const myByLeague = (opts && opts.myRosterIdByLeague) || {};
        return leagues.map(l => {
            const lid = String(l.league_id || l.id || '');
            return {
                leagueId: lid,
                leagueName: l.name || ('League ' + lid),
                result: runProposal({
                    league: l,
                    seasonStats: opts && opts.seasonStats,
                    lineups: lineupsByLeague[lid] || {},
                    proposal: opts && opts.proposal,
                    playersData: opts && opts.playersData,
                    calcFn: opts && opts.calcFn,
                    myRosterId: myByLeague[lid],
                }),
            };
        });
    }

    const api = {
        PRESETS,
        loadSeasonStats,
        loadSeasonLineups,
        scorePlayerWeek,
        rescoreSeason,
        runProposal,
        runOmnibus,
    };
    App.Commish.RuleLab = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
