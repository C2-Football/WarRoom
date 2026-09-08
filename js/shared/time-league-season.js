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

    /** Yield one row at a time so the large archive never retains every cell. */
    function* parseCsv(text) {
        let row = [];
        let cell = "";
        let quoted = false;
        let rowCount = 0;
        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
            else if (char === '"') quoted = !quoted;
            else if (char === "," && !quoted) { row.push(cell); cell = ""; }
            else if ((char === "\n" || char === "\r") && !quoted) {
                if (char === "\r" && text[index + 1] === "\n") index += 1;
                row.push(cell);
                if (row.some(Boolean)) {
                    if (++rowCount > 1000001) throw new Error("The game archive exceeds the supported one-million-row limit.");
                    yield row;
                }
                row = []; cell = "";
            } else cell += char;
        }
        row.push(cell);
        if (row.some(Boolean)) {
            if (++rowCount > 1000001) throw new Error("The game archive exceeds the supported one-million-row limit.");
            yield row;
        }
    }

    /**
     * Accepts CSVs shaped like either PFR game-log exports or nflverse weekly
     * stats. Rows for the same player-season-week are summed so split exports
     * still resolve to one line.
     */
    function parseGameLogCsv(text) {
        const rows = parseCsv(text);
        const first = rows.next();
        if (first.done) return { logs: [], skippedRows: 0 };
        const headers = first.value.map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
        const find = (...names) => headers.findIndex((header) => names.includes(header));
        const playerIndex = find("player", "playername", "name", "playerdisplayname");
        const seasonIndex = find("season", "year", "seasonyear");
        const weekIndex = find("week", "wk", "gameweek");
        const positionIndex = find("pos", "position");
        const metadataIndexes = Object.fromEntries(Object.entries({ sourceGameId: "sourcegameid", team: "team", opponent: "opponent", gameDate: "gamedate", source: "source", coverage: "coverage", sourceWeekKind: "sourceweekkind", historicalWeek: "historicalweek", scheduledGames: "scheduledgames" }).map(([key, header]) => [key, find(header)]));
        if (playerIndex < 0 || seasonIndex < 0 || weekIndex < 0 || positionIndex < 0) {
            let skippedRows = 0;
            while (!rows.next().done) skippedRows += 1;
            return { logs: [], skippedRows };
        }
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
        for (const row of rows) {
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
                for (const [field, index] of Object.entries(metadataIndexes)) {
                    if (index >= 0 && row[index]) log[field] = ["scheduledGames", "historicalWeek"].includes(field) ? Number(row[index]) : row[index];
                }
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
        const index = new Map();
        for (const log of logs) index.set(gameLogKey(log.identity, log.season, log.week), log);
        return index;
    }

    /**
     * The single price of one week for one player. The ten core fields are paid
     * against the league's configurable values; anything the row carried in
     * `stats.extra` (kicking, team defense, IDP) is paid against `extended`.
     */
    function scoreStatLine(stats, scoring, extended = REFERENCE_EXTENDED_SCORING) {
        const weights = { passYd: scoring.passingYd, passTd: scoring.passTd,
            rushYd: scoring.rushRecYd, recYd: scoring.rushRecYd, rec: scoring.reception,
            rushTd: RUSH_REC_TD_POINTS, recTd: RUSH_REC_TD_POINTS,
            twoPointConversions: TWO_POINT_CONVERSION_POINTS, passInt: scoring.turnover,
            fumblesLost: scoring.turnover, ...scoring.stats };
        const points = Object.entries(weights).reduce((sum, [key, weight]) => sum + (stats[key] || 0) * weight, 0);
        const bonuses = (scoring.bonuses || []).reduce((sum, bonus) =>
            ['passYd', 'rushYd', 'recYd', 'rec'].includes(bonus.stat)
                && Number.isFinite(bonus.threshold) && bonus.threshold > 0 && Number.isFinite(bonus.points)
                && (stats[bonus.stat] || 0) >= bonus.threshold ? sum + bonus.points : sum, 0);
        const core = Math.round((points + bonuses) * 100) / 100;
        const extraPoints = scoreExtendedStats(stats.extra, scoring.extended || extended);
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

    const poolCaches = new WeakMap();
    const deckCaches = new WeakMap();
    const editionKey = entry => `${entry.identity}:${entry.drawnSeason}`;
    const usesGameDeck = league => league?.settings?.gameDeckVersion === 1;
    const dataIndexFor = (league, index) => !usesGameDeck(league) && index?.legacyIndex ? index.legacyIndex : index;
    const factorsFor = (league, factors) => !usesGameDeck(league) && factors?.legacyFactors ? factors.legacyFactors : factors;

    function sourceGames(entry, index) {
        if (!index) return [];
        let pools = poolCaches.get(index);
        if (!pools) {
            pools = new Map();
            for (const [key, value] of index) {
                const match = /^(.*):(\d+):(\d+)$/.exec(key);
                if (!match) continue;
                const identity = value.identity || match[1], season = value.season || Number(match[2]);
                const poolKey = `${identity}:${season}`;
                if (!pools.has(poolKey)) pools.set(poolKey, []);
                pools.get(poolKey).push(value.identity && value.season && value.week ? value : Object.assign(Object.create(value), { identity, season, week: value.week || Number(match[3]) }));
            }
            for (const pool of pools.values()) pool.sort((a, b) => a.week - b.week);
            poolCaches.set(index, pools);
        }
        return pools.get(editionKey(entry)) || [];
    }

    // The private deck is stable for an edition across ownership changes. A
    // source game is used at most once; the calendar never truncates its pool.
    function gameDeck(league, entry, index, weeks = 14) {
        if (!usesGameDeck(league) || !index || league.publicSnapshotVersion === 1) return null;
        const seed = league.privateGameSeed || league.seed;
        if (!seed) throw new Error('The private game deck is unavailable. Reload the league.');
        let cache = deckCaches.get(index);
        if (!cache) { cache = new Map(); deckCaches.set(index, cache); }
        const cacheKey = JSON.stringify([seed, league.leagueId, editionKey(entry), weeks]);
        if (cache.has(cacheKey)) return cache.get(cacheKey);
        if (league.privateGameDecks) {
            const order = league.privateGameDecks[editionKey(entry)];
            if (!order) throw new Error('The private game deck is unavailable. Reload the league.');
            const deck = order.map(sourceWeek => {
                if (sourceWeek === null) return null;
                const log = index.get(gameLogKey(entry.identity, entry.drawnSeason, sourceWeek));
                if (!log) throw new Error('A source game is missing from the full archive. Reload the league.');
                return log;
            });
            cache.set(cacheKey, deck);
            return deck;
        }
        if (league.privateDraws) throw new Error('The private game deck could not be prepared. Reload the league.');
        const games = sourceGames(entry, index);
        // scheduledGames is emitted only from a verified team REG schedule.
        // A missing record carries no asserted injury, bye, or inactive reason.
        const scheduled = Math.max(0, ...games.map(log => Number(log.scheduledGames) || 0));
        const size = Math.max(14, weeks, games.length, Math.min(25, scheduled));
        const deck = [...games, ...Array.from({ length: size - games.length }, () => null)];
        const random = App.TimeLeagueRoster.createSeededRandom(`vault-games-v1:${seed}:${league.leagueId}:${editionKey(entry)}`);
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        cache.set(cacheKey, deck);
        if (cache.size > 10000) cache.delete(cache.keys().next().value);
        return deck;
    }

    function completedProduction(league, entry, week) {
        const archived = league.finalizedWeeks?.find(row => row.week === week);
        return archived?.playerProduction?.find(row => row.identity === entry.identity && row.drawnSeason === entry.drawnSeason)
            || archived?.results?.flatMap(row => row.starters || []).find(row => row.identity === entry.identity && row.drawnSeason === entry.drawnSeason)
            || league.playerReports?.[editionKey(entry)]?.completed?.find(row => row.week === week) || null;
    }

    function resolveGameLog(league, entry, week, index, weeks = 14) {
        if (!usesGameDeck(league)) {
            const log = dataIndexFor(league, index)?.get(gameLogKey(entry.identity, entry.drawnSeason, week)) || null;
            return log && !Number.isInteger(log.week) ? Object.assign(Object.create(log), { week, identity: entry.identity, season: entry.drawnSeason }) : log;
        }
        if (league.publicSnapshotVersion === 1) {
            const saved = completedProduction(league, entry, week);
            return saved?.stats ? { stats: saved.stats, week } : Number.isInteger(saved?.sourceWeek) ? index?.get(gameLogKey(entry.identity, entry.drawnSeason, saved.sourceWeek)) : null;
        }
        if (!index) return undefined;
        return gameDeck(league, entry, index, weeks)?.[week - 1] || null;
    }

    function gamePoints(league, entry, log, scoring, factors) {
        return log ? Math.round(scoreStatLine(log.stats, scoring) * eraFactorFor(factorsFor(league, factors), entry.drawnSeason, entry.position) * 100) / 100 : 0;
    }

    // Only the current report is actionable. Later dates are deliberately
    // indistinguishable, even when a historical archive has missing records.
    function rosterOutlook(entry, currentWeek, weeks, index, scoring, factors, league) {
        if (usesGameDeck(league) && league.publicSnapshotVersion === 1) {
            const report = league.playerReports?.[editionKey(entry)];
            if (!report || report.week !== currentWeek) return null;
            const schedule = Array.from({ length: weeks }, (_, i) => {
                const week = i + 1, saved = report.completed?.find(row => row.week === week);
                return { week, played: week < currentWeek, available: saved ? Number.isInteger(saved.sourceWeek) : week === currentWeek ? report.currentAvailable : null,
                    points: saved ? saved.points : null };
            });
            return { schedule, remaining: report.remaining, average: report.average, estimatedRemaining: report.estimatedRemaining, signal: report.signal };
        }
        if (!index) return null;
        const schedule = Array.from({ length: weeks }, (_, i) => {
            const week = i + 1, played = week < currentWeek;
            if (week > currentWeek || (week === currentWeek && league?.weekStage === "postgame")) return { week, available: null, played: false, points: null };
            const log = resolveGameLog(league, entry, week, index, weeks);
            const saved = played && league ? completedProduction(league, entry, week) : null;
            return { week, available: saved ? Boolean(saved.stats) : Boolean(log), played,
                points: played ? saved ? saved.points : gamePoints(league, entry, log, scoring, factors) : null };
        });
        const played = schedule.filter(row => row.played && row.available);
        const remaining = Math.max(0, weeks - currentWeek + 1);
        const average = played.length ? played.reduce((sum, row) => sum + row.points, 0) / played.length : null;
        const recent = played.slice(-3), prior = played.slice(0, -3);
        const mean = rows => rows.reduce((sum, row) => sum + row.points, 0) / rows.length;
        const change = prior.length >= 2 ? mean(recent) - mean(prior) : null;
        const current = schedule.find(row => row.week === currentWeek);
        return { schedule, remaining, average, estimatedRemaining: average === null ? null : average * remaining,
            signal: !current ? 'Season complete' : current.available === null ? 'Awaiting next week' : !current.available ? 'No recorded game' : change === null ? 'Building form' : change > 3 ? 'Trending up' : change < -3 ? 'Cooling off' : 'Steady form' };
    }

    function weeklyStarOutlook(entry, currentWeek, weeks, index, scoring, factors, league) {
        if (usesGameDeck(league) && league.publicSnapshotVersion === 1) {
            const report = league.playerReports?.[editionKey(entry)];
            if (!report || report.week !== currentWeek) return null;
            const schedule = Array.from({ length: weeks }, (_, i) => {
                const week = i + 1, saved = report.completed?.find(row => row.week === week);
                return { week, played: week < currentWeek, available: saved ? Number.isInteger(saved.sourceWeek) : week === currentWeek ? report.currentAvailable : null,
                    stars: saved ? saved.stars : week === currentWeek ? report.currentStars : null };
            });
            return { schedule, stars: report.currentStars, maxRemainingStars: report.maxRemainingStars, remainingGames: report.remaining };
        }
        if (!index) return null;
        const logs = usesGameDeck(league) ? sourceGames(entry, index) : Array.from({ length: weeks }, (_, i) => resolveGameLog(league, entry, i + 1, index, weeks)).filter(Boolean);
        const ranked = logs.map(log => ({ log, points: gamePoints(league, entry, log, scoring, factors) })).sort((a, b) => b.points - a.points || a.log.week - b.log.week);
        const edge = Math.min(3, Math.floor(ranked.length / 2)), middle = ranked.length - edge * 2;
        const starsByWeek = new Map(ranked.map((row, rank) => [row.log.week, ranked.length === 1 ? 5 : rank < edge ? 5 : rank >= ranked.length - edge ? 1 : 4 - Math.min(2, Math.floor((rank - edge) * 3 / Math.max(1, middle)))]));
        const schedule = Array.from({ length: weeks }, (_, i) => {
            const week = i + 1;
            if (week > currentWeek || (week === currentWeek && league?.weekStage === "postgame")) return { week, played: false, available: null, stars: null };
            const log = resolveGameLog(league, entry, week, index, weeks);
            return { week, played: week < currentWeek, available: Boolean(log), stars: log ? starsByWeek.get(log.week) ?? null : null };
        });
        // The remaining ceiling uses the entire unused source pool, not a
        // future calendar. It cannot disclose where a missing game was dealt.
        const used = new Set(Array.from({ length: Math.max(0, currentWeek - 1) }, (_, i) => resolveGameLog(league, entry, i + 1, index, weeks)?.week));
        const ceiling = ranked.filter(row => !used.has(row.log.week)).map(row => starsByWeek.get(row.log.week));
        return { stars: schedule.find(row => row.week === currentWeek)?.stars ?? null,
            maxRemainingStars: currentWeek <= weeks && ceiling.length ? Math.max(...ceiling) : null,
            remainingGames: Math.max(0, weeks - currentWeek + 1), schedule };
    }

    const api = {
        isStarterSlot, emptyStatLine, EXTENDED_STAT_IDS, REFERENCE_EXTENDED_SCORING, scoreExtendedStats,
        gameLogKey, parseGameLogCsv, buildGameLogIndex, scoreStatLine, eraFactorFor,
        buildRoundRobinSchedule, rosterOutlook, weeklyStarOutlook, usesGameDeck, dataIndexFor, factorsFor, sourceGames, gameDeck, resolveGameLog, completedProduction, editionKey, gamePoints,
    };
    App.TimeLeagueSeason = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
