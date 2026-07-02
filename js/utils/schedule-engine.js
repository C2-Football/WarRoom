// ══════════════════════════════════════════════════════════════════
// js/utils/schedule-engine.js — window.App.Schedule
// Full-season schedule + win projection for the Game Day Central rail.
//
// buildSeason({ league, myRoster, playersData, statsData, stats2025Data })
//   → Promise<{ weeks: [{week, oppName, oppRosterId, isPast, isCurrent,
//                          winPct, margin, myProj, oppProj, result, bye}],
//                summary: {record, projRecord, projWins, projLosses,
//                          projPF, winPct, remainingWeeks, week} }>
//
// Opponents come from App.Matchup.resolveSeasonOpponents (Sleeper + MFL).
// Each upcoming matchup is projected with App.WeeklyProj.optimalForRoster
// (median) + App.Matchup.forecast; completed weeks use actual scores when the
// platform exposes them (Sleeper always; MFL when the schedule carries a score).
// Warroom-local util (direct <script> tag), no vendored mirror.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const _cache = {};                 // cacheKey -> { ts, data }
    const TTL_MS = 8 * 60 * 1000;

    function currentWeek() {
        return (App.WeeklyProj && App.WeeklyProj.currentWeek && App.WeeklyProj.currentWeek()) || 1;
    }

    function rosterName(roster, league) {
        if (!roster) return '—';
        const users = (league && league.users) || [];
        const u = users.find(x => String(x.user_id) === String(roster.owner_id));
        return (roster.metadata && roster.metadata.team_name)
            || roster._team_name
            || (u && u.metadata && u.metadata.team_name)
            || (u && u.display_name)
            || ('Team ' + roster.roster_id);
    }

    async function buildSeason(opts) {
        opts = opts || {};
        const league = opts.league || {};
        const myRoster = opts.myRoster || null;
        const M = App.Matchup, WP = App.WeeklyProj;
        if (!myRoster || !M || !WP || !M.resolveSeasonOpponents) return null;

        const myRosterId = myRoster.roster_id;
        const leagueId = league.league_id || league.id || '';
        const curWk = currentWeek();
        const pws = Number(league.settings && league.settings.playoff_week_start) || 15;
        const lastReg = Math.max(1, Math.min(18, pws - 1));
        const weeks = [];
        for (let w = 1; w <= lastReg; w++) weeks.push(w);

        const startersKey = ((myRoster.starters) || []).join(',');
        const cacheKey = [leagueId, myRosterId, curWk, lastReg, startersKey].join('|');
        const hit = _cache[cacheKey];
        if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

        const rostersById = {};
        (league.rosters || []).forEach(r => { rostersById[String(r.roster_id)] = r; });

        const oppMap = await M.resolveSeasonOpponents({ league, myRosterId, weeks });
        const projOpts = {
            playersData: opts.playersData,
            statsData: opts.statsData,
            priorData: opts.stats2025Data || opts.priorData,
            objective: 'median',
        };

        let futureWins = 0, futureLosses = 0, futurePF = 0, winPctSum = 0, winPctCount = 0;

        const rows = weeks.map(w => {
            const entry = oppMap[w];
            const bye = !entry;                                   // no matchup scheduled
            const oppRoster = entry ? rostersById[String(entry.oppRosterId)] : null;
            const isPast = w < curWk;
            const isCurrent = w === curWk;
            let winPct = null, margin = null, myProj = null, oppProj = null, result = null;

            if (entry && oppRoster) {
                // A week is "decided" once it carries real scores — regardless of
                // whether the NFL week has rolled over (Sleeper leaves display_week
                // on the just-finished week until ~Tuesday). This renders the true
                // W/L AND keeps a settled game out of the projection accumulators,
                // so it isn't double-counted against settings.wins.
                const hasActual = (entry.myPts > 0 || entry.oppPts > 0);
                if (hasActual) {
                    result = entry.myPts > entry.oppPts ? 'W' : entry.myPts < entry.oppPts ? 'L' : 'T';
                    myProj = Math.round(entry.myPts * 10) / 10;
                    oppProj = Math.round(entry.oppPts * 10) / 10;
                } else {
                    try {
                        const mine = WP.optimalForRoster(myRoster, league, { ...projOpts, week: w });
                        const theirs = WP.optimalForRoster(oppRoster, league, { ...projOpts, week: w });
                        const myDist = M.dist(mine.optimal.starters.map(s => s.pid), mine.projections, 'median');
                        const oppDist = M.dist(theirs.optimal.starters.map(s => s.pid), theirs.projections, 'median');
                        const fc = M.forecast(myDist, oppDist);
                        winPct = fc.winPct; margin = fc.margin; myProj = fc.projMe; oppProj = fc.projOpp;
                        if (!isPast) {                            // current + future feed the projection
                            futureWins += fc.winPct / 100;
                            futureLosses += (100 - fc.winPct) / 100;
                            futurePF += fc.projMe;
                            winPctSum += fc.winPct; winPctCount++;
                        }
                    } catch (e) { if (root.wrLog) root.wrLog('schedule.projectWeek', e); }
                }
            }
            return {
                week: w, bye,
                oppRosterId: entry && entry.oppRosterId,
                oppName: oppRoster ? rosterName(oppRoster, league) : (bye ? 'BYE' : '—'),
                isPast, isCurrent, winPct, margin, myProj, oppProj, result,
            };
        });

        const st = (myRoster.settings) || {};
        const wins = Number(st.wins) || 0, losses = Number(st.losses) || 0, ties = Number(st.ties) || 0;
        const pf = Number(st.fpts) || 0;
        const projWins = wins + futureWins;
        const projLosses = losses + futureLosses;
        const totalGames = projWins + projLosses + ties;
        const r1 = n => Math.round(n * 10) / 10;

        const summary = {
            week: curWk,
            record: wins + '-' + losses + (ties ? '-' + ties : ''),
            projWins: r1(projWins),
            projLosses: r1(projLosses),
            projRecord: r1(projWins) + '-' + r1(projLosses) + (ties ? '-' + ties : ''),
            projPF: r1(pf + futurePF),
            winPct: winPctCount ? Math.round(winPctSum / winPctCount) : (totalGames ? Math.round(projWins / totalGames * 100) : null),
            remainingWeeks: winPctCount,
        };

        const data = { weeks: rows, summary };
        // Only cache a season that actually carries signal — never poison the
        // cache with an all-zero computation from a caller whose stat data
        // hadn't loaded yet.
        const hasSignal = rows.some(r => (r.myProj || 0) > 0 || (r.oppProj || 0) > 0 || r.result);
        if (hasSignal) _cache[cacheKey] = { ts: Date.now(), data };
        return data;
    }

    App.Schedule = App.Schedule || { buildSeason, _cache };
})(typeof window !== 'undefined' ? window : globalThis);
