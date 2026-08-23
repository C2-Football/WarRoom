// ══════════════════════════════════════════════════════════════════
// js/shared/nfl-context.js — window.App.NflContext
// Loads the weekly NFL matchup context (opponent + home/away, Vegas
// implied total/spread, and weather) and feeds it to App.WeeklyProj so
// projections become matchup/weather-aware. Source: ESPN's public
// scoreboard (schedule + odds + weather in one call), fetched THROUGH a
// same-origin proxy (the browser is CORS-blocked from ESPN directly):
//   dev  → /api/nfl-scoreboard  (serve-static.cjs)
//   prod → a Supabase edge fn mirroring that proxy (DYNASTY_HQ_CONFIG).
// Degrades to a no-op (neutral projections) if the proxy is unavailable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const _done = {}; // `${season}|${week}` already loaded

    // ESPN uses a few abbreviations that differ from Sleeper/MFL — normalize so
    // context keys match each player's team. (LAR/LAC/LV already align.)
    const ESPN_TO_SLEEPER = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
    function normTeam(a) { a = String(a || '').toUpperCase(); return ESPN_TO_SLEEPER[a] || a; }

    function endpoint() {
        // Prefer the RESOLVED config (app-config.js merges defaults into
        // App.CONFIG/OD.CONFIG — the raw DYNASTY_HQ_CONFIG seed in index.html
        // doesn't carry defaulted endpoints like nflScoreboard). Dev keeps the
        // same-origin proxy so local work never burns the shared prod cache.
        try {
            if (root.location && /^(localhost|127\.0\.0\.1)$/.test(root.location.hostname)) return '/api/nfl-scoreboard';
            const cfg = (root.App && root.App.CONFIG) || (root.OD && root.OD.CONFIG) || root.DYNASTY_HQ_CONFIG || {};
            return (cfg.endpoints && cfg.endpoints.nflScoreboard) || '/api/nfl-scoreboard';
        } catch (e) { return '/api/nfl-scoreboard'; }
    }

    // ESPN scoreboard → { `${TEAM}|${week}`: { opp, home, vegas:{impliedTotal,spread,opp}, weather } }
    function parse(espn, week) {
        const out = {};
        const events = (espn && espn.events) || [];
        events.forEach(ev => {
            const comp = ev.competitions && ev.competitions[0];
            if (!comp) return;
            const cs = comp.competitors || [];
            const home = cs.find(c => c.homeAway === 'home');
            const away = cs.find(c => c.homeAway === 'away');
            const hAbbr = normTeam(home && home.team && home.team.abbreviation);
            const aAbbr = normTeam(away && away.team && away.team.abbreviation);
            if (!hAbbr || !aAbbr) return;

            const indoor = !!(comp.venue && comp.venue.indoor);
            const w = comp.weather;
            const weather = indoor ? { indoor: true }
                : (w ? { temp: (w.temperature != null ? Number(w.temperature) : (w.highTemperature != null ? Number(w.highTemperature) : null)), display: w.displayValue || '', condId: w.conditionId } : null);

            // Odds → game total + favorite/line (parse details, which names the favorite).
            const odds = comp.odds && comp.odds[0];
            let total = null, favAbbr = null, line = null;
            if (odds) {
                if (odds.overUnder != null) total = Number(odds.overUnder);
                const det = odds.details ? String(odds.details) : '';
                if (/\beven\b|\bpk\b|pick/i.test(det)) line = 0;
                const m = det.match(/([A-Z]{2,4})\s*(-?\d+(?:\.\d+)?)/);
                if (m) { favAbbr = m[1]; line = Math.abs(Number(m[2])); }
                if (line == null && odds.spread != null) { line = Math.abs(Number(odds.spread)); favAbbr = Number(odds.spread) < 0 ? hAbbr : aAbbr; }
            }

            function teamCtx(meAbbr, oppAbbr, isHome) {
                let impliedTotal = null, spread = null;
                if (total != null && line != null && favAbbr) {
                    const fav = meAbbr === favAbbr;
                    impliedTotal = total / 2 + (fav ? line / 2 : -line / 2);
                    spread = fav ? -line : line;
                } else if (total != null) {
                    impliedTotal = total / 2;
                }
                const vegas = impliedTotal != null
                    ? { impliedTotal: Math.round(impliedTotal * 10) / 10, spread: spread, opp: oppAbbr }
                    : (oppAbbr ? { opp: oppAbbr } : null);
                return { opp: oppAbbr, home: isHome, vegas: vegas, weather: weather };
            }
            out[hAbbr + '|' + week] = teamCtx(hAbbr, aAbbr, true);
            out[aAbbr + '|' + week] = teamCtx(aAbbr, hAbbr, false);
        });
        return out;
    }

    // seasontype is ESPN's: 1 = preseason, 2 = regular, 3 = postseason. It
    // defaults to 2 so every existing caller (the projection context path,
    // Empire's ticker) is byte-identical — only callers that explicitly want
    // preseason/postseason pass it. Both proxies already accept and forward
    // the param and validate it 1-4, so nothing server-side needed changing.
    function fetchWeek(week, season, seasontype) {
        const st = Number(seasontype) || 2;
        let u = endpoint() + '?week=' + week + '&seasontype=' + st;
        if (season) u += '&season=' + season;
        return fetch(u).then(r => { if (!r.ok) throw new Error('scoreboard ' + r.status); return r.json(); });
    }

    // ESPN scoreboard → live/final/scheduled game scores, for anything that
    // just wants "what's the score" (e.g. Empire's ticker) rather than the
    // matchup-context shape `parse()` builds for projections.
    function parseScores(espn) {
        const events = (espn && espn.events) || [];
        return events.map(ev => {
            const comp = ev.competitions && ev.competitions[0];
            const cs = (comp && comp.competitors) || [];
            const home = cs.find(c => c.homeAway === 'home');
            const away = cs.find(c => c.homeAway === 'away');
            const status = (comp && comp.status) || ev.status || {};
            const type = status.type || {};
            return {
                home: normTeam(home && home.team && home.team.abbreviation),
                away: normTeam(away && away.team && away.team.abbreviation),
                homeScore: home && home.score != null ? Number(home.score) : null,
                awayScore: away && away.score != null ? Number(away.score) : null,
                state: type.state || 'pre',            // 'pre' | 'in' | 'post'
                shortDetail: type.shortDetail || '',    // "Q3 4:12", "Final", "1:00 PM"
                completed: !!type.completed,
            };
        }).filter(g => g.home && g.away);
    }

    function loadScores(week, season, seasontype) {
        return fetchWeek(week, season, seasontype).then(parseScores).catch(e => { if (root.wrLog) root.wrLog('nflContext.loadScores', e); return []; });
    }

    // Sleeper's nflState is the authoritative "where are we in the NFL
    // calendar" source (season_type: 'pre' | 'regular' | 'post' + its own week
    // counter, which restarts per phase). Mapped to ESPN's seasontype so the
    // scoreboard is asked for the games that are actually being played right
    // now — in August that is preseason, not regular-season week 1.
    function currentPhase() {
        const st = (root.S && root.S.nflState) || {};
        const type = String(st.season_type || 'regular').toLowerCase();
        const stWeek = Number(st.week) || Number(st.display_week) || 1;
        if (type === 'pre') return { seasontype: 1, week: stWeek, isPre: true, season: st.season };
        if (type === 'post') return { seasontype: 3, week: stWeek, isPost: true, season: st.season };
        const regWeek = Number(App.WeeklyProj && App.WeeklyProj.currentWeek && App.WeeklyProj.currentWeek()) || stWeek;
        return { seasontype: 2, week: regWeek, season: st.season };
    }

    // Load one or more weeks and feed App.WeeklyProj.setContext. Caches per
    // (season, week). Returns the merged byTeamWeek map (or {} on failure).
    async function load(weeks, season) {
        const WP = App.WeeklyProj;
        if (!WP) return {};
        season = Number(season || (root.S && root.S.season) || (root.S && root.S.nflState && root.S.nflState.season) || 0) || 0;
        const list = (Array.isArray(weeks) ? weeks : [weeks]).map(Number).filter(w => w > 0 && w <= 18);
        const byTeamWeek = {};
        for (const wk of list) {
            const key = season + '|' + wk;
            if (_done[key]) continue;
            try {
                const espn = await fetchWeek(wk, season);
                Object.assign(byTeamWeek, parse(espn, wk));
                _done[key] = true;
            } catch (e) { if (root.wrLog) root.wrLog('nflContext.load', e); }
        }
        if (Object.keys(byTeamWeek).length && WP.setContext) WP.setContext({ byTeamWeek });
        return byTeamWeek;
    }

    function loadCurrent(season) {
        const WP = App.WeeklyProj;
        const wk = WP && WP.currentWeek ? WP.currentWeek() : 1;
        return load([wk], season);
    }

    App.NflContext = App.NflContext || { load, loadCurrent, parse, parseScores, loadScores, currentPhase, endpoint, _done };
})(typeof window !== 'undefined' ? window : globalThis);
