// ══════════════════════════════════════════════════════════════════
// js/shared/weekly-proj.js — window.App.WeeklyProj
// Client accessor that turns whatever weekly context we have into
// league-scored start/sit projections via the shared App.StartSit engine.
//
// PROGRESSIVE ENHANCEMENT: works TODAY off local data (season stats +
// recent weekly-points form), with neutral matchup/Vegas. When the
// refresh-projections edge function + player_week_projections table land,
// setContext() feeds real DvP/Vegas/injury and the same code path lights up.
//
// All scoring flows through calcFantasyPts(statLine, scoring) so every
// league's exact rules (PPR / SF / IDP / yardage bonuses) are honored.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const SS = () => App.StartSit;

    // External weekly context, keyed by `${nflTeam}|${week}`: { dvpMult, vegas:{impliedTotal,spread,opp}, injury:{pid:status} }.
    // Empty until the edge function populates it — projections stay neutral.
    const _ctx = { byTeamWeek: {}, byPid: {} };

    function setContext(ctx) {
        if (!ctx) return;
        if (ctx.byTeamWeek) Object.assign(_ctx.byTeamWeek, ctx.byTeamWeek);
        if (ctx.byPid) Object.assign(_ctx.byPid, ctx.byPid);
    }
    function teamWeekCtx(team, week) {
        return _ctx.byTeamWeek[`${String(team || '').toUpperCase()}|${week}`] || null;
    }

    // Opponent NFL team for a player's team in a given week — prefers the live
    // NFL context (ESPN scoreboard), then falls back to the SOS engine's
    // derived schedule so FUTURE weeks (no live context yet) still resolve an
    // opponent for matchup grading + the season schedule rail.
    function opponentTeam(team, week, ctx) {
        const T = String(team || '').toUpperCase();
        if (ctx && ctx.opp) return String(ctx.opp).toUpperCase();
        const sch = App.SOS && App.SOS.schedule;
        return (sch && sch[week] && sch[week][T]) ? String(sch[week][T]).toUpperCase() : null;
    }

    // Defense-vs-position multiplier from the SOS engine's per-position defense
    // rankings (1 = toughest defense → suppress production; 32 = softest →
    // boost). Neutral (1.0) until App.SOS.initialize() resolves, and for
    // positions SOS doesn't rank (K/DEF/IDP). This is the real DvP layer the
    // engine was built for — no backend projections table required.
    function dvpMultFor(oppTeam, pos) {
        const ranks = App.SOS && App.SOS.defenseRankings;
        if (!ranks || !oppTeam) return 1;
        const P = String(pos || '').toUpperCase();
        if (P !== 'QB' && P !== 'RB' && P !== 'WR' && P !== 'TE') return 1;
        const rank = ranks[oppTeam] && ranks[oppTeam]['vs' + P];
        if (!(rank > 0)) return 1;
        // rank 16.5 → 1.0 · rank 1 (toughest) → ~0.86 · rank 32 (softest) → ~1.14
        const mult = 1 + ((rank - 16.5) / 15.5) * 0.14;
        return Math.max(0.82, Math.min(1.18, mult));
    }

    function currentWeek() {
        const s = root.S || {};
        const w = Number(s.currentWeek || s.nflState?.display_week || s.nflState?.week || 0);
        return w > 0 ? w : 1;
    }

    // ── Provider weekly projections (Sleeper) ─────────────────────────
    // https://api.sleeper.app/v1/projections/nfl/regular/{season}/{week}
    // returns raw projected STAT LINES by pid (same stat keys as Sleeper
    // stats), so they score through the exact same league-scoring path as
    // everything else (owner tenet: league rules, never generic points).
    // This is what makes ROOKIES projectable — no NFL history required
    // (owner ask 2026-07-12: "projected should look at the upcoming week").
    // Lazily fetched once per (season, week), cached in-module; consumers
    // hear 'wr:projections-loaded' and recompute.
    const _prov = { key: null, byPid: null, fetching: null };
    function providerSeason() {
        const s = root.S || {};
        const lg = (s.leagues || []).find(l => l.league_id === s.currentLeagueId) || s.league;
        return String(s.nflState?.season || (lg && lg.season) || new Date().getFullYear());
    }
    function ensureWeekProjections(week) {
        const w = Number(week) || currentWeek();
        const season = providerSeason();
        const key = season + '|' + w;
        if (_prov.key === key && (_prov.byPid || _prov.fetching)) return _prov.fetching || Promise.resolve(_prov.byPid);
        if (typeof fetch !== 'function') return Promise.resolve(null);
        _prov.key = key; _prov.byPid = null;
        _prov.fetching = fetch('https://api.sleeper.app/v1/projections/nfl/regular/' + season + '/' + w)
            .then(r => (r && r.ok ? r.json() : null))
            .then(map => {
                if (_prov.key !== key) return null;
                _prov.byPid = map || {};
                _prov.fetching = null;
                try { root.dispatchEvent(new CustomEvent('wr:projections-loaded', { detail: { season, week: w } })); } catch (e) { /* headless */ }
                return _prov.byPid;
            })
            .catch(() => { if (_prov.key === key) { _prov.byPid = {}; _prov.fetching = null; } return null; });
        return _prov.fetching;
    }
    // Published provider line for a pid, or null. Pre-season most rows are
    // all-zero shells until analysts publish — only trust lines with real
    // projected volume. A cold cache self-warms (fire-and-forget fetch).
    function providerLine(pid, week) {
        const w = Number(week) || currentWeek();
        if (_prov.key !== (providerSeason() + '|' + w) || !_prov.byPid) { ensureWeekProjections(w); return null; }
        const line = _prov.byPid[pid];
        if (!line) return null;
        const vol = Number(line.pts_ppr) || Number(line.pts_std) || Number(line.pass_att) || Number(line.rush_att) || Number(line.rec_tgt) || Number(line.rec) || Number(line.idp_tkl) || Number(line.fga) || Number(line.xpm) || 0;
        return vol > 0 ? line : null;
    }

    // Weekly actuals are stored league-scored as weeklyPlayerPoints[week][pid].
    // Returns [{week, pts}] ascending for a player (only weeks with a value).
    function weeklyHistory(pid) {
        const wpp = (root.S && root.S.weeklyPlayerPoints) || {};
        const out = [];
        for (const k of Object.keys(wpp)) {
            const w = Number(k); if (!(w > 0)) continue;
            const pts = wpp[k] && wpp[k][pid];
            if (pts != null) out.push({ week: w, pts: Number(pts) });
        }
        out.sort((a, b) => a.week - b.week);
        return out;
    }

    // Rolling PPG over the last `lastN` PLAYED weeks (>0 pts), plus season
    // high/low. lastN === 'season' (or huge) → full-season average.
    function formStats(pid, lastN) {
        const hist = weeklyHistory(pid);
        if (!hist.length) return null;
        const played = hist.filter(g => g.pts > 0.1);
        const pool = played.length ? played : hist;
        const n = (lastN === 'season' || !lastN) ? pool.length : Math.max(1, Number(lastN));
        const recent = [...pool].sort((a, b) => b.week - a.week).slice(0, n);
        const avg = recent.reduce((s, g) => s + g.pts, 0) / (recent.length || 1);
        return {
            rollingPPG: +avg.toFixed(1),
            high: +Math.max(...pool.map(g => g.pts)).toFixed(1),
            low: +Math.min(...pool.map(g => g.pts)).toFixed(1),
            games: pool.length,
            recentCount: recent.length,
        };
    }

    // Recent-form points average over the last `lookback` completed weeks.
    function recentPPG(pid, week, lookback) {
        const wpp = (root.S && root.S.weeklyPlayerPoints) || null;
        if (!wpp) return null;
        const weeks = Object.keys(wpp).map(Number).filter(w => w > 0 && w < week).sort((a, b) => b - a).slice(0, lookback || 3);
        if (!weeks.length) return null;
        const vals = weeks.map(w => Number(wpp[w] && wpp[w][pid]) || 0).filter(v => v > 0);
        if (!vals.length) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    // Build a per-game baseline STAT LINE for a player: blend current-season
    // and prior-season per-game lines, then nudge by recent-form ratio.
    function buildBaseline(pid, season, prior, scoring, week) {
        const ss = SS();
        const seasonGp = Number(season && season.gp) || 0;
        const seasonLine = ss.perGameLine(season, seasonGp);
        const priorLine = ss.perGameLine(prior, Number(prior && prior.gp) || 0);

        // Lean on prior early in the year; lean on this season as games accrue.
        const seasonW = Math.min(seasonGp, 6) / 6 * 0.75 + (seasonGp > 0 ? 0.05 : 0);
        const priorW = 0.35;
        let line = ss.blendLines([{ line: seasonLine, weight: seasonW }, { line: priorLine, weight: priorW }]);
        if (!line) return null;

        // Recent-form multiplier (hot/cold) from weekly points vs season PPG.
        if (App.calcPPG && season) {
            const seasonPPG = App.calcPPG(season, scoring);
            const recent = recentPPG(pid, week, 3);
            if (seasonPPG > 2 && recent != null) {
                const factor = Math.max(0.7, Math.min(1.4, recent / seasonPPG));
                line = ss.scaleLine(line, factor);
            }
        }
        return line;
    }

    function isByeOrOut(player, ctx, pid, week) {
        const sleeperStatus = (player && player.injury_status) || '';
        const ctxStatus = ctx && ctx.injury && ctx.injury[pid];
        if (Number(player && player.bye_week) === week) return 'BYE';
        return ctxStatus || sleeperStatus || '';
    }

    // Project one player for a given week, scored through `scoring`.
    function projectPlayer(pid, { playersData, statsData, priorData, scoring, week }) {
        const ss = SS();
        if (!ss || !pid) return null;
        const player = (playersData && playersData[pid]) || null;
        const pos = (App.normPos && App.normPos(player && player.position)) || (player && player.position) || '';
        const season = (statsData && statsData[pid]) || null;
        const prior = (priorData && priorData[pid]) || null;
        // Provider analyst line anchors the baseline when published (already a
        // single-week line) — the internal season/prior blend is the fallback.
        const prov = providerLine(pid, week);
        const baseline = prov || buildBaseline(pid, season, prior, scoring, week);

        const team = player && player.team;
        const ctx = teamWeekCtx(team, week);
        const oppTeam = opponentTeam(team, week, ctx);
        const injuryStatus = isByeOrOut(player, ctx, pid, week);

        // Blend any live-context DvP with the SOS-derived defense-vs-position
        // multiplier (real DvP layer). Neutral 1.0 when SOS isn't ready — and
        // neutral for provider lines, which are already matchup-aware (no
        // double-counting the opponent).
        const ctxDvp = ctx && Number.isFinite(ctx.dvpMult) ? ctx.dvpMult : 1;
        const dvpMult = prov ? 1 : (ctxDvp !== 1 ? ctxDvp : 1) * dvpMultFor(oppTeam, pos);

        const proj = ss.projectPlayerWeek({
            pid, week, position: pos, baseline,
            dvpMult,
            vegas: ctx ? ctx.vegas : null,
            weather: ctx ? ctx.weather : null,
            opponent: ctx
                ? { abbr: ctx.opp, home: ctx.home, impliedTotal: ctx.vegas && ctx.vegas.impliedTotal, spread: ctx.vegas && ctx.vegas.spread }
                : (oppTeam ? { abbr: oppTeam } : null),
            injuryStatus,
            roleNote: ctx ? ctx.roleNote : '',
        });
        return ss.scoreProjection(proj, scoring);
    }

    function projectRoster(playerIds, opts) {
        const out = {};
        (playerIds || []).forEach(pid => { const p = projectPlayer(pid, opts); if (p) out[pid] = p; });
        return out;
    }

    // ── "Why this number" ledger ─────────────────────────────────────
    // Re-runs the projectPlayer pipeline one stage at a time, scoring each
    // intermediate stat line, so the UI can show the build-up instead of a
    // bare number. Deltas are league-scored points. The final row scores the
    // SAME median stat line under a neutral 0.5-PPR baseline — the honest
    // version of "consensus": identical stat line, your rules vs generic.
    const STANDARD_SCORING = {
        pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
        rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
        rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
        fum_lost: -2,
    };
    function explainPlayer(pid, opts) {
        const ss = SS();
        if (!ss || !pid) return null;
        const { playersData, statsData, priorData, scoring } = opts || {};
        const week = (opts && opts.week) || currentWeek();
        const player = (playersData && playersData[pid]) || null;
        const pos = (App.normPos && App.normPos(player && player.position)) || (player && player.position) || '';
        const season = (statsData && statsData[pid]) || null;
        const prior = (priorData && priorData[pid]) || null;
        const prov = providerLine(pid, week);
        const baseline = prov || buildBaseline(pid, season, prior, scoring, week);
        if (!baseline) return null;

        const team = player && player.team;
        const ctx = teamWeekCtx(team, week);
        const oppTeam = opponentTeam(team, week, ctx);
        const injuryStatus = isByeOrOut(player, ctx, pid, week);
        const avail = ss.availability(injuryStatus);

        const ctxDvp = ctx && Number.isFinite(ctx.dvpMult) ? ctx.dvpMult : 1;
        const dvpMult = prov ? 1 : (ctxDvp !== 1 ? ctxDvp : 1) * dvpMultFor(oppTeam, pos);
        const vegas = ctx ? ctx.vegas : null;
        const weather = ctx ? ctx.weather : null;

        // scoreProjection handles TE-premium; wrap one line in a throwaway proj.
        // opts.calcFn lets Node tests inject a scorer (browser uses the global).
        const scoreLine = (line, rules) =>
            ss.scoreProjection({ position: pos, statLine: { median: line, floor: null, ceiling: null } }, rules, opts && opts.calcFn).points.median;

        const stages = [];
        let line = baseline;
        let pts = scoreLine(line, scoring);
        const dvpRank = (() => {
            const r = App.SOS && App.SOS.defenseRankings;
            const v = r && oppTeam && r[oppTeam] && r[oppTeam]['vs' + pos];
            return v > 0 ? v : null;
        })();
        stages.push({
            key: 'base',
            label: prov ? 'Analyst line' : 'Usage baseline',
            detail: prov
                ? 'Sleeper weekly projection — already matchup-aware'
                : 'Season + prior-year per-game blend, recent-form adjusted',
            pts, delta: null,
        });

        const step = (key, label, detail, nextLine) => {
            const nextPts = scoreLine(nextLine, scoring);
            stages.push({ key, label, detail, pts: nextPts, delta: nextPts - pts });
            line = nextLine; pts = nextPts;
        };

        if (!prov) {
            step('dvp', 'Matchup — DvP',
                oppTeam
                    ? ('vs ' + oppTeam + (dvpRank ? ' — allows rank ' + dvpRank + ' fantasy pts to ' + pos : ' — defense-vs-position'))
                    : 'No opponent resolved — neutral',
                ss.applyMatchup(line, dvpMult));
        }
        step('vegas', 'Vegas',
            (vegas && Number.isFinite(Number(vegas.impliedTotal)))
                ? ('Implied total ' + vegas.impliedTotal + (Number.isFinite(Number(vegas.spread)) ? ' · spread ' + (vegas.spread > 0 ? '+' : '') + vegas.spread : ''))
                : 'No line available — neutral',
            ss.applyVegas(line, pos, vegas));
        step('weather', 'Weather',
            weather ? (weather.indoor ? 'Dome — no adjustment' : (weather.display || 'Outdoor') + (weather.temp != null ? ' · ' + Math.round(weather.temp) + '°' : '')) : 'No report — neutral',
            weather ? ss.applyWeather(line, weather) : line);
        step('avail', 'Injury / availability',
            injuryStatus ? String(injuryStatus) : 'No designation',
            avail.mult !== 1 ? ss.scaleLine(line, avail.mult) : line);

        const standardPts = scoreLine(line, STANDARD_SCORING);
        // Round once, then derive the edge from the ROUNDED pair — the three
        // displayed numbers must reconcile exactly (17.8 − 13.1 = 4.7, never
        // 4.8 from hidden precision).
        const leagueR = Math.round(pts * 10) / 10;
        const standardR = Math.round(standardPts * 10) / 10;
        return {
            pid, week, position: pos, opponent: oppTeam || null,
            provider: !!prov,
            injuryStatus: injuryStatus || '',
            stages,
            leaguePts: leagueR,
            standardPts: standardR,
            scoringEdge: Math.round((leagueR - standardR) * 10) / 10,
        };
    }

    // GM mode → optimization objective. win_now plays it safe (floor),
    // rebuild chases upside (ceiling), everyone else optimizes the median.
    function objectiveForMode(mode) {
        if (mode === 'win_now') return 'floor';
        if (mode === 'rebuild') return 'ceiling';
        return 'median';
    }
    function modeFor(leagueId) {
        try { return (App.WR && App.WR.GmMode && App.WR.GmMode.effects(leagueId).mode) || (root.WR && root.WR.GmMode && root.WR.GmMode.effects(leagueId).mode) || 'compete'; }
        catch (e) { return 'compete'; }
    }

    // Optimal weekly lineup for a roster + the delta vs current starters.
    // roster: { players:[], starters:[], reserve:[], taxi:[] }
    function optimalForRoster(roster, currentLeague, opts) {
        const ss = SS();
        opts = opts || {};
        const scoring = (currentLeague && currentLeague.scoring_settings) || {};
        const rosterPositions = (currentLeague && currentLeague.roster_positions) || [];
        const week = opts.week || currentWeek();
        const leagueId = (currentLeague && (currentLeague.league_id || currentLeague.id)) || '';
        const mode = opts.mode || modeFor(leagueId);
        const objective = opts.objective || objectiveForMode(mode);

        const resSet = new Set((roster && roster.reserve) || []);
        const taxiSet = new Set((roster && roster.taxi) || []);
        const ids = ((roster && roster.players) || []).filter(id => id && !resSet.has(id) && !taxiSet.has(id));

        const projections = projectRoster(ids, { playersData: opts.playersData, statsData: opts.statsData, priorData: opts.priorData, scoring, week });
        const scoreOf = pid => { const p = projections[pid]; return p && p.available ? (p.points[objective] || 0) : 0; };

        const players = ids.map(pid => {
            const p = projections[pid];
            const pl = opts.playersData && opts.playersData[pid];
            return { pid, pos: (App.normPos && App.normPos(pl && pl.position)) || (pl && pl.position) || '', available: !!(p && p.available), pts: scoreOf(pid) };
        });

        const optimal = ss.optimalLineupWeekly(players, rosterPositions);
        const delta = ss.lineupDelta((roster && roster.starters) || [], optimal, scoreOf);
        return { week, mode, objective, scoring, projections, optimal, delta };
    }

    App.WeeklyProj = App.WeeklyProj || {
        setContext, currentWeek, recentPPG, weeklyHistory, formStats, buildBaseline,
        projectPlayer, projectRoster, optimalForRoster, explainPlayer,
        ensureWeekProjections, providerLine,
        objectiveForMode, modeFor,
        _ctx,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.WeeklyProj;
})(typeof window !== 'undefined' ? window : globalThis);
