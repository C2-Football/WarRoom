// ══════════════════════════════════════════════════════════════════
// time-league-season.js — weekly game-log scoring for Time League: CSV
// parsing, per-line scoring (core + full-surface K/DEF/IDP), and the
// round-robin schedule builder. Pure and deterministic.
//
// Ported from The Duat's app/time-season-engine.ts, trimmed to what Time
// League actually calls (that source also drives a separate, un-ported
// "Time Season" replay mode via resolveTimeSeason/eraAdjustmentFactors,
// which have no callers here). Folds in the CSV tokenizer from
// app/time-draft-data.ts as a private helper, since that file itself isn't
// ported (dead prototype, unused by Time League).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { canonicalPlayerIdentity } = App.TimeLeagueDraftRoom;
    const { normalizePlayerPosition } = App.TimeLeagueRoster;

    const RESERVE_SLOTS = new Set(["BN", "IR", "TAXI"]);
    // The league config exposes yardage, reception, pass-TD, and turnover values;
    // rushing/receiving touchdowns and two-point conversions are fixed league-wide.
    const RUSH_REC_TD_POINTS = 6;
    const TWO_POINT_CONVERSION_POINTS = 2;

    function isStarterSlot(slot) {
        return !RESERVE_SLOTS.has(slot);
    }

    function emptyStatLine() {
        return { passYd: 0, passTd: 0, passInt: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0, fumblesLost: 0, twoPointConversions: 0 };
    }

    const STAT_HEADER_ALIASES = {
        passYd: ["passyd", "passyds", "passyards", "passingyards", "pyds"],
        passTd: ["passtd", "passtds", "passingtds", "ptd", "ptds"],
        passInt: ["int", "ints", "interceptions", "passint", "passints"],
        rushYd: ["rushyd", "rushyds", "rushyards", "rushingyards"],
        rushTd: ["rushtd", "rushtds", "rushingtds"],
        rec: ["rec", "recs", "receptions", "catches"],
        recYd: ["recyd", "recyds", "recyards", "receivingyards"],
        recTd: ["rectd", "rectds", "receivingtds"],
        fumblesLost: ["fumbleslost", "fumlost", "fl", "fumbles", "fmb"],
        twoPointConversions: ["twopt", "2pt", "twopointconversions", "twoptconversions"],
    };

    /**
     * Header aliases for the full-surface columns. Deliberately unambiguous: the
     * team-defense ids take `def_*`/`dst_*` spellings rather than bare `sack`/`int`
     * so a passing-interception column can never be read as a defensive takeaway.
     */
    const EXTENDED_STAT_HEADER_ALIASES = {
        fgm: ["fgm", "fgmade", "fieldgoalsmade"],
        fgmiss: ["fgmiss", "fgmissed", "fieldgoalsmissed"],
        xpm: ["xpm", "patmade", "extrapointsmade"],
        xpmiss: ["xpmiss", "patmissed", "extrapointsmissed"],
        fgm_0_19: ["fgm019", "fgmade019"],
        fgm_20_29: ["fgm2029", "fgmade2029"],
        fgm_30_39: ["fgm3039", "fgmade3039"],
        fgm_40_49: ["fgm4049", "fgmade4049"],
        fgm_50p: ["fgm50p", "fgmade50p", "fgmade50"],
        fgmiss_0_19: ["fgmiss019", "fgmissed019"],
        fgmiss_20_29: ["fgmiss2029", "fgmissed2029"],
        fgmiss_30_39: ["fgmiss3039", "fgmissed3039"],
        fgmiss_40_49: ["fgmiss4049", "fgmissed4049"],
        fgmiss_50p: ["fgmiss50p", "fgmissed50p", "fgmissed50"],
        sack: ["defsack", "dstsack", "teamsack"],
        int: ["defint", "dstint", "teamint"],
        ff: ["defff", "dstff", "teamff"],
        fr: ["deffr", "dstfr", "teamfr"],
        def_td: ["deftd", "dsttd"],
        def_st_td: ["defsttd", "dststtd"],
        safe: ["defsafe", "dstsafe", "teamsafe"],
        idp_tkl_solo: ["idptklsolo", "idpsolo"],
        idp_tkl_ast: ["idptklast", "idpast"],
        idp_tkl_loss: ["idptklloss", "idptfl"],
        idp_sack: ["idpsack"],
        idp_int: ["idpint"],
        idp_ff: ["idpff"],
        idp_fr: ["idpfr"],
        idp_pass_def: ["idppassdef", "idppd"],
        idp_td: ["idptd"],
        idp_safe: ["idpsafe"],
    };

    const EXTENDED_STAT_IDS = Object.keys(EXTENDED_STAT_HEADER_ALIASES);

    /**
     * Mainstream default for the full-surface positions. Field goals are the one
     * place a row carries both a total and its distance bands, so exactly one
     * side of each pair is priced: makes by band (fgm left at zero), misses by
     * the fgmiss total (miss bands left at zero).
     */
    const REFERENCE_EXTENDED_SCORING = {
        fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5,
        fgmiss: -1, xpm: 1, xpmiss: -1,
        sack: 1, int: 2, ff: 1, fr: 2, def_td: 6, def_st_td: 6, safe: 2,
        idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_tkl_loss: 1, idp_sack: 2, idp_int: 3,
        idp_ff: 3, idp_fr: 3, idp_pass_def: 1, idp_td: 6, idp_safe: 2,
    };

    /** Scores the sparse full-surface line; ids the weights omit are worth nothing. */
    function scoreExtendedStats(extra, weights) {
        if (!extra) return 0;
        let points = 0;
        for (const id of Object.keys(extra)) points += (extra[id] ?? 0) * (weights[id] ?? 0);
        return Math.round(points * 100) / 100;
    }

    function gameLogKey(identity, season, week) {
        return `${identity}:${season}:${week}`;
    }

    /** Minimal CSV tokenizer (handles quoted cells + embedded commas/newlines). */
    function parseCsv(text) {
        const rows = [];
        let row = [];
        let cell = "";
        let quoted = false;
        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
            else if (char === '"') quoted = !quoted;
            else if (char === "," && !quoted) { row.push(cell); cell = ""; }
            else if ((char === "\n" || char === "\r") && !quoted) {
                if (char === "\r" && text[index + 1] === "\n") index += 1;
                row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
            } else cell += char;
        }
        row.push(cell); if (row.some(Boolean)) rows.push(row);
        return rows;
    }

    /**
     * Accepts CSVs shaped like either PFR game-log exports or nflverse weekly
     * stats. Rows for the same player-season-week are summed so split exports
     * still resolve to one line.
     */
    function parseGameLogCsv(text) {
        const rows = parseCsv(text).slice(0, 250001);
        if (rows.length < 2) return { logs: [], skippedRows: 0 };
        const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
        const find = (...names) => headers.findIndex((header) => names.includes(header));
        const playerIndex = find("player", "playername", "name", "playerdisplayname");
        const seasonIndex = find("season", "year", "seasonyear");
        const weekIndex = find("week", "wk", "gameweek");
        const positionIndex = find("pos", "position");
        if (playerIndex < 0 || seasonIndex < 0 || weekIndex < 0 || positionIndex < 0) return { logs: [], skippedRows: rows.length - 1 };
        const statIndexes = Object.fromEntries(
            Object.keys(STAT_HEADER_ALIASES).map((stat) => [stat, find(...STAT_HEADER_ALIASES[stat])]),
        );
        // Only the full-surface columns this CSV actually carries; a file without
        // any of them produces no `extra`.
        const extendedIndexes = EXTENDED_STAT_IDS
            .map((id) => [id, find(...(EXTENDED_STAT_HEADER_ALIASES[id] ?? []))])
            .filter(([, index]) => index >= 0);

        const addExtended = (log, extra) => {
            if (!log.stats.extra) {
                log.stats.extra = {};
                log.extra = log.stats.extra;
            }
            const target = log.stats.extra;
            for (const id of Object.keys(extra)) {
                target[id] = Math.round(((target[id] ?? 0) + (extra[id] ?? 0)) * 100) / 100;
            }
        };

        const byKey = new Map();
        let skippedRows = 0;
        for (const row of rows.slice(1)) {
            const name = row[playerIndex]?.replace(/[*+]/g, "").trim();
            const season = Number(row[seasonIndex]);
            const week = Number(row[weekIndex]);
            const position = normalizePlayerPosition(row[positionIndex]);
            if (!name || !position || !Number.isInteger(season) || season < 1920 || season > 2100 || !Number.isInteger(week) || week < 1 || week > 25) {
                skippedRows += 1;
                continue;
            }
            const stats = emptyStatLine();
            for (const stat of Object.keys(statIndexes)) {
                const index = statIndexes[stat];
                if (index < 0) continue;
                const value = Number(row[index]);
                if (Number.isFinite(value)) stats[stat] += value;
            }
            // Sparse by construction: blank cells and honest zeroes both stay out,
            // so a classic offensive line never grows an `extra`.
            let extra = null;
            for (const [id, index] of extendedIndexes) {
                const value = Number(row[index]);
                if (!Number.isFinite(value) || value === 0) continue;
                extra = extra ?? {};
                extra[id] = (extra[id] ?? 0) + value;
            }
            const identity = canonicalPlayerIdentity({ name, position });
            const key = gameLogKey(identity, season, week);
            const current = byKey.get(key);
            if (current) {
                for (const stat of Object.keys(stats)) current.stats[stat] += stats[stat];
                if (extra) addExtended(current, extra);
            } else {
                const log = { identity, name, position, season, week, stats };
                if (extra) {
                    stats.extra = extra;
                    log.extra = extra;
                }
                byKey.set(key, log);
            }
        }
        return { logs: [...byKey.values()], skippedRows };
    }

    function buildGameLogIndex(logs) {
        return new Map(logs.map((log) => [gameLogKey(log.identity, log.season, log.week), log]));
    }

    /**
     * The single price of one week for one player. The ten core fields are paid
     * against the league's configurable values; anything the row carried in
     * `stats.extra` (kicking, team defense, IDP) is paid against `extended`.
     */
    function scoreStatLine(stats, scoring, extended = REFERENCE_EXTENDED_SCORING) {
        const points = stats.passYd * scoring.passingYd
            + stats.passTd * scoring.passTd
            + (stats.rushYd + stats.recYd) * scoring.rushRecYd
            + stats.rec * scoring.reception
            + (stats.rushTd + stats.recTd) * RUSH_REC_TD_POINTS
            + stats.twoPointConversions * TWO_POINT_CONVERSION_POINTS
            + (stats.passInt + stats.fumblesLost) * scoring.turnover;
        const core = Math.round(points * 100) / 100;
        const extraPoints = scoreExtendedStats(stats.extra, extended);
        return extraPoints === 0 ? core : Math.round((core + extraPoints) * 100) / 100;
    }

    function eraFactorFor(factors, season, position) {
        return factors?.get(`${season}:${position}`) ?? 1;
    }

    /**
     * Deterministic circle-method round robin. Weeks beyond one full cycle
     * repeat the cycle, so any regular-season length works for any league size.
     * Odd team counts sit one team per week against the ghost seat (a bye).
     */
    function buildRoundRobinSchedule(teamIds, weeks) {
        const cleanTeams = teamIds.filter(Boolean);
        const seats = cleanTeams.length % 2 === 0 ? [...cleanTeams] : [...cleanTeams, null];
        const rounds = Math.max(1, seats.length - 1);
        const schedule = [];
        for (let week = 1; week <= Math.max(0, Math.floor(weeks)); week += 1) {
            const round = (week - 1) % rounds;
            const rotated = [seats[0], ...seats.slice(1).map((_, index, rest) => rest[(index + round) % rest.length])];
            const pairs = [];
            let byeTeamId = null;
            for (let index = 0; index < rotated.length / 2; index += 1) {
                const home = rotated[index];
                const away = rotated[rotated.length - 1 - index];
                if (home === null) { byeTeamId = away; continue; }
                if (away === null) { byeTeamId = home; continue; }
                pairs.push(round % 2 === 0 ? [home, away] : [away, home]);
            }
            schedule.push({ week, pairs, byeTeamId });
        }
        return schedule;
    }

    const api = {
        isStarterSlot, emptyStatLine, REFERENCE_EXTENDED_SCORING, scoreExtendedStats,
        gameLogKey, parseGameLogCsv, buildGameLogIndex, scoreStatLine, eraFactorFor,
        buildRoundRobinSchedule,
    };
    App.TimeLeagueSeason = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
