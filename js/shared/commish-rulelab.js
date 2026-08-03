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
                    // Full roster kept for best-lineup replay: structure
                    // proposals (superflex, extra FLEX) can only be answered by
                    // refielding each roster's OPTIMAL lineup from everyone
                    // they had that week — as-played starters can't sit in
                    // slots that didn't exist yet.
                    players: Array.isArray(r.players) ? r.players.slice() : [],
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
    // Two modes, one function, so both rulesets always flow the same path:
    //
    //  as_played (default) — each roster-week total is the sum of
    //  scorePlayerWeek over the starters that roster actually fielded. Empty
    //  slots ('0'/falsy) skipped; a started player with no stat line that
    //  week scores 0 but still registers in playerTotals (he was started —
    //  that's the record).
    //
    //  optimal — each roster-week refields the OPTIMAL lineup from the full
    //  roster (row.players) for the given slot structure, via the start/sit
    //  solver. This is the ONLY honest way to evaluate structure proposals:
    //  as-played starters cannot occupy a SUPER_FLEX that didn't exist. The
    //  caller must run BOTH baseline and proposal in optimal mode when
    //  comparing structures — mixing modes would credit the proposal with
    //  lineup-optimization skill nobody exercised.
    function rescoreSeason(opts) {
        const seasonStats = (opts && opts.seasonStats) || {};
        const lineups = (opts && opts.lineups) || {};
        const scoring = (opts && opts.scoring) || {};
        const playersData = (opts && opts.playersData) || {};
        const calcFn = opts && opts.calcFn;
        const mode = (opts && opts.mode) === 'optimal' ? 'optimal' : 'as_played';
        const rosterPositions = (opts && opts.rosterPositions) || [];
        const startSit = (opts && opts.startSit) || (App.StartSit || null);
        if (mode === 'optimal' && (!startSit || typeof startSit.optimalLineupWeekly !== 'function')) {
            throw new Error('rulelab: optimal mode needs App.StartSit.optimalLineupWeekly — load startsit-engine.js (or pass startSit)');
        }

        const weeks = Object.keys(lineups).map(Number).filter(w => w > 0).sort((a, b) => a - b);
        const weeklyScores = {};
        const playerTotals = {};

        for (const w of weeks) {
            const rows = lineups[w] || [];
            const stats = seasonStats[w] || {};
            const scored = [];
            for (const r of rows) {
                let total = 0;
                if (mode === 'optimal') {
                    // Candidates: the whole roster that week (fall back to the
                    // starters when the players array wasn't captured).
                    const pool = (r.players && r.players.length ? r.players : (r.starters || []))
                        .filter(pid => pid && pid !== '0' && pid !== 0)
                        .map(rawPid => {
                            const pid = String(rawPid);
                            return {
                                pid,
                                pos: String(playerPos(playersData[pid]) || '').toUpperCase(),
                                available: true,
                                pts: scorePlayerWeek(stats[pid], scoring, playerPos(playersData[pid]), calcFn),
                            };
                        });
                    const opt = startSit.optimalLineupWeekly(pool, rosterPositions);
                    total = opt.total;
                    // Credit the counterfactual starters — under these rules,
                    // these are the players who matter.
                    for (const s of opt.starters) {
                        playerTotals[String(s.pid)] = (playerTotals[String(s.pid)] || 0) + s.pts;
                    }
                } else {
                    for (const rawPid of (r.starters || [])) {
                        if (!rawPid || rawPid === '0' || rawPid === 0) continue; // empty slot
                        const pid = String(rawPid);
                        const pts = scorePlayerWeek(stats[pid], scoring, playerPos(playersData[pid]), calcFn);
                        total += pts;
                        playerTotals[pid] = (playerTotals[pid] || 0) + pts;
                    }
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

    // ── Pure: league-shape analytics over a pair of rescored runs ─────
    // Position share: what fraction of all started points each position owns.
    // The TE-premium question in one row: "TEs go from 8.1% to 11.4%".
    function positionShare(basePlayerTotals, propPlayerTotals, playersData) {
        const share = (totals) => {
            const byPos = {};
            let sum = 0;
            for (const pid of Object.keys(totals)) {
                const pts = Math.max(0, totals[pid]);   // negative-point weeks don't subtract relevance
                const pos = String(playerPos(playersData[pid]) || '?').toUpperCase() || '?';
                byPos[pos] = (byPos[pos] || 0) + pts;
                sum += pts;
            }
            const out = {};
            for (const pos of Object.keys(byPos)) out[pos] = sum > 0 ? byPos[pos] / sum : 0;
            return out;
        };
        const b = share(basePlayerTotals), p = share(propPlayerTotals);
        const all = new Set(Object.keys(b).concat(Object.keys(p)));
        return Array.from(all)
            .map(pos => ({
                pos,
                basePct: Math.round(b[pos] * 1000) / 10,
                propPct: Math.round((p[pos] || 0) * 1000) / 10,
                deltaPct: Math.round(((p[pos] || 0) - (b[pos] || 0)) * 1000) / 10,
            }))
            .filter(r => r.basePct >= 0.5 || r.propPct >= 0.5)
            .sort((a, b2) => Math.abs(b2.deltaPct) - Math.abs(a.deltaPct) || b2.propPct - a.propPct);
    }

    // Competitive-balance read for one rescored run: how spread out the league
    // is (top pf − bottom pf) and how volatile a week is (stdev of all
    // team-week scores). Plus Spearman rank correlation between the two
    // standings — 1.0 means the proposal reshuffled nothing.
    function balanceStats(order, weeklyScores) {
        const pfs = order.map(r => r.pf);
        const spread = pfs.length ? Math.round((pfs[0] - pfs[pfs.length - 1]) * 10) / 10 : 0;
        const scores = [];
        for (const w of Object.keys(weeklyScores)) (weeklyScores[w] || []).forEach(r => scores.push(r.points));
        let volatility = 0;
        if (scores.length > 1) {
            const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
            volatility = Math.round(Math.sqrt(scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (scores.length - 1)) * 10) / 10;
        }
        return { spread, volatility };
    }
    function spearman(baseRank, propRank) {
        const ids = Object.keys(baseRank);
        const n = ids.length;
        if (n < 2) return 1;
        let d2 = 0;
        ids.forEach(id => { const d = baseRank[id] - (propRank[id] || 0); d2 += d * d; });
        return Math.round((1 - (6 * d2) / (n * (n * n - 1))) * 1000) / 1000;
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
        // Structure proposal → both runs switch to best-lineup replay: the
        // baseline uses the league's real slots, the proposal its new ones,
        // and BOTH refield optimal lineups so the diff isolates the structure
        // change rather than crediting it with lineup-setting skill.
        const rosterProposal = (opts && opts.rosterProposal && Array.isArray(opts.rosterProposal.rosterPositions) && opts.rosterProposal.rosterPositions.length)
            ? opts.rosterProposal.rosterPositions : null;
        const startSit = opts && opts.startSit;
        const mode = rosterProposal ? 'optimal' : 'as_played';
        const currentSlots = (league.roster_positions || []).filter(s => s && !/^(BN|BE|BENCH|IR|TAXI|RES)$/i.test(String(s)));
        const baseline = rescoreSeason({ league, seasonStats, lineups: counted, scoring: current, playersData, calcFn, mode, rosterPositions: currentSlots, startSit });
        const proposed = rescoreSeason({ league, seasonStats, lineups: counted, scoring: proposedScoring, playersData, calcFn, mode, rosterPositions: rosterProposal || currentSlots, startSit });

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
            methodology: mode === 'optimal' ? 'best_lineup' : 'as_played',
            standingsShift,
            playoffField,
            seedOneChanged,
            teamDeltas,
            playerDeltas,
            proposerNote,
            positionShare: positionShare(baseline.playerTotals, proposed.playerTotals, playersData),
            balance: (() => {
                const b = balanceStats(baseOrder, baseline.weeklyScores);
                const p = balanceStats(propOrder, proposed.weeklyScores);
                return {
                    baseline: b, proposed: p,
                    volatilityDeltaPct: b.volatility ? Math.round(((p.volatility - b.volatility) / b.volatility) * 1000) / 10 : 0,
                    spearman: spearman(baseRank, propRank),
                };
            })(),
        };
    }

    // ── Pure: threshold sweep ────────────────────────────────────────
    // Run one scoring knob through a range and report where the league
    // actually flips — the wind-tunnel question: "at WHAT TE premium does
    // the #1 seed change hands?" Each step is a full honest runProposal;
    // rescoring is milliseconds, so seven steps cost nothing.
    function sweep(opts) {
        const key = opts && opts.key;
        const values = (opts && opts.values) || [];
        if (!key || !values.length) return { key, steps: [], firstFlipAt: null };
        const currentVal = Number(((opts.league || {}).scoring_settings || {})[key]) || 0;
        const steps = values.map(v => {
            const r = runProposal(Object.assign({}, opts, { proposal: Object.assign({}, opts.baseProposal || {}, { [key]: v }) }));
            if (r.empty) return { value: v, empty: true };
            return {
                value: v,
                isCurrent: v === currentVal,
                seedFlips: !!r.seedOneChanged,
                seedTo: r.seedOneChanged ? r.seedOneChanged.to : null,
                fieldMoves: r.playoffField.in.length,
                ranksMoved: r.standingsShift.filter(s => s.delta !== 0).length,
            };
        });
        const firstFlip = steps.find(s => !s.empty && !s.isCurrent && (s.seedFlips || s.fieldMoves > 0 || s.ranksMoved > 0));
        return { key, currentValue: currentVal, steps, firstFlipAt: firstFlip ? firstFlip.value : null };
    }

    // ── Pure: a sensible sweep range for ANY scoring key ─────────────
    // Anchored on the current value so the ladder brackets reality: for a
    // live value c, sweep 0 → 2c in proportional steps; for c = 0 (a rule the
    // league doesn't score yet) use the canonical fantasy increments. Integer
    // rules (TDs, turnovers) sweep whole points; fractional rules keep
    // quarter-point granularity. Always includes 0 and the current value.
    function sweepValuesFor(key, currentValue) {
        const c = Number(currentValue) || 0;
        let values;
        if (c === 0) {
            values = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
        } else if (Number.isInteger(c) && Math.abs(c) >= 2) {
            // TD-like: 4 → sweep the arguable neighborhood, not 0.5-steps.
            const lo = Math.max(0, Math.abs(c) - 2), hi = Math.abs(c) + 2;
            values = [];
            for (let v = lo; v <= hi; v++) values.push(c < 0 ? -v : v);
            if (!values.includes(0)) values.unshift(0);
        } else {
            const mag = Math.abs(c);
            values = [0, 0.5, 0.75, 1, 1.25, 1.5, 2].map(m => Math.round(m * mag * 100) / 100);
            if (c < 0) values = values.map(v => -v);
        }
        if (!values.some(v => v === c)) values.push(c);
        return Array.from(new Set(values)).sort((a, b) => a - b);
    }

    // ── Pure: merge one sweep run per season into the verdict ────────
    // Input: [{ season, perLeague: [{ leagueName, steps, firstFlipAt }] }].
    // Output per league: the value×season movement grid plus two honest
    // numbers — the earliest movement anywhere, and the CONSENSUS threshold:
    // the smallest value at which EVERY replayed season moves. "The #1 seed
    // flips at ≥1.0 in 2 of 2 seasons" is close to unarguable; one season's
    // flip alone is weather.
    function mergeSweeps(seasonSweeps) {
        const runs = (seasonSweeps || []).filter(s => s && Array.isArray(s.perLeague));
        if (!runs.length) return [];
        const leagues = {};
        runs.forEach(run => {
            run.perLeague.forEach(pl => {
                const L = leagues[pl.leagueName] = leagues[pl.leagueName] || { leagueName: pl.leagueName, seasons: [], byValue: {} };
                // A season where every step came back empty is NO DATA for
                // this league (chain didn't reach it, or zero counted weeks)
                // — it must not count in the consensus denominator.
                const hasData = (pl.steps || []).some(s => !s.empty);
                L.seasons.push({ season: run.season, firstFlipAt: pl.firstFlipAt, hasData });
                (pl.steps || []).forEach(s => {
                    if (s.empty) return;
                    const cell = s.seedFlips ? 'SEED' : s.fieldMoves > 0 ? 'FIELD' : s.ranksMoved > 0 ? s.ranksMoved + ' MV' : 'HOLD';
                    (L.byValue[s.value] = L.byValue[s.value] || { value: s.value, isCurrent: !!s.isCurrent, bySeason: {} }).bySeason[run.season] = cell;
                    if (s.isCurrent) L.byValue[s.value].isCurrent = true;
                });
            });
        });
        return Object.values(leagues).map(L => {
            const rows = Object.values(L.byValue).sort((a, b) => a.value - b.value);
            const replayed = L.seasons.filter(s => s.hasData);
            const flips = replayed.map(s => s.firstFlipAt).filter(v => v != null);
            const minFlip = flips.length ? Math.min.apply(null, flips) : null;
            // Consensus needs movement in EVERY replayed season — one season
            // that never moves anywhere in range vetoes it.
            const consensus = (flips.length === replayed.length && replayed.length > 0)
                ? Math.max.apply(null, flips) : null;
            return {
                leagueName: L.leagueName,
                seasons: replayed.map(s => s.season),
                noData: L.seasons.filter(s => !s.hasData).map(s => s.season),
                rows,
                minFlip,
                consensus,
                heldIn: flips.length,
                of: replayed.length,
            };
        });
    }

    // ── Pure: the ballot memo ────────────────────────────────────────
    // Plain text the commissioner pastes next to the vote. States the
    // methodology and the proposer's own position — a ballot that hides
    // either is campaigning, not governing.
    function ballotText(leagueName, result, proposalSummary) {
        if (!result || result.empty) return '';
        const L = [];
        L.push('RULE CHANGE IMPACT STATEMENT — ' + leagueName);
        L.push('Proposal: ' + (proposalSummary || 'scoring change'));
        L.push('Replayed: the ' + result.seasonUsed + ' season, ' + result.weeksCounted + ' weeks, '
            + (result.methodology === 'best_lineup' ? 'best-lineup replay (structure change — both runs field optimal lineups)' : 'as-played lineups rescored'));
        L.push('');
        L.push(result.seedOneChanged
            ? '#1 SEED FLIPS: ' + result.seedOneChanged.from + ' → ' + result.seedOneChanged.to
            : '#1 seed holds.');
        L.push(result.playoffField.unchanged
            ? 'Playoff field unchanged (' + result.playoffField.size + '-team cut).'
            : 'PLAYOFF FIELD: IN — ' + (result.playoffField.in.join(', ') || 'none') + ' · OUT — ' + (result.playoffField.out.join(', ') || 'none'));
        const moved = result.standingsShift.filter(s => s.delta !== 0);
        L.push(moved.length
            ? 'Standings: ' + moved.length + ' teams change rank (' + moved.slice(0, 4).map(m => m.name + ' ' + m.baselineRank + '→' + m.proposedRank).join(', ') + (moved.length > 4 ? ', …' : '') + ')'
            : 'Standings hold — no team changes rank.');
        const ps = (result.positionShare || []).filter(p => Math.abs(p.deltaPct) >= 0.5).slice(0, 3);
        if (ps.length) L.push('Position relevance: ' + ps.map(p => p.pos + ' ' + p.basePct + '%→' + p.propPct + '%').join(' · '));
        if (result.balance && result.balance.volatilityDeltaPct) {
            L.push('Weekly volatility ' + (result.balance.volatilityDeltaPct > 0 ? '+' : '') + result.balance.volatilityDeltaPct + '%.');
        }
        const g = (result.playerDeltas || []).filter(p => p.delta > 0).slice(0, 3);
        if (g.length) L.push('Biggest winners: ' + g.map(p => p.name + ' +' + p.delta).join(', '));
        if (result.proposerNote) L.push(result.proposerNote.line);
        L.push('');
        L.push('Method: both runs rescore identical lineups from raw stat lines — the diff is the rule change and nothing else. Playoffs were real games; this re-cuts the field and seeds, it never re-crowns a champion.');
        return L.join('\n');
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
                    rosterProposal: opts && opts.rosterProposal,
                    startSit: opts && opts.startSit,
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
        sweep,
        sweepValuesFor,
        mergeSweeps,
        ballotText,
        positionShare,
        balanceStats,
        spearman,
    };
    App.Commish.RuleLab = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
