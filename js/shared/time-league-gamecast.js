// Historical game totals reconstructed on a shared four-quarter clock.
// Quarter placement is simulated; every stat and finalized point is conserved.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const { createSeededRandom } = App.TimeLeagueRoster;
    const GAMECAST_END = 60;
    const QUARTER_LENGTH = 15;
    const DEFAULT_SCORING = { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 };
    const toCents = points => Math.round(points * 100);
    const round2 = value => Math.round(value * 100) / 100;
    const QUARTERS = Array.from({ length: 4 }, (_, i) => ({ quarter: i + 1, start: i * QUARTER_LENGTH, end: (i + 1) * QUARTER_LENGTH }));
    const CORE_LABELS = { passYd: 'passing yards', passTd: 'passing TD', passInt: 'INT thrown', rushYd: 'rushing yards', rushTd: 'rushing TD', rec: 'receptions', recYd: 'receiving yards', recTd: 'receiving TD', fumblesLost: 'fumbles lost', twoPointConversions: 'two-point conversions' };
    const EXTRA_LABELS = { fgm: 'field goals made', fgmiss: 'field goals missed', xpm: 'extra points made', xpmiss: 'extra points missed',
        fgm_0_19: 'FG made (0–19 yd)', fgm_20_29: 'FG made (20–29 yd)', fgm_30_39: 'FG made (30–39 yd)', fgm_40_49: 'FG made (40–49 yd)', fgm_50p: 'FG made (50+ yd)',
        fgmiss_0_19: 'FG missed (0–19 yd)', fgmiss_20_29: 'FG missed (20–29 yd)', fgmiss_30_39: 'FG missed (30–39 yd)', fgmiss_40_49: 'FG missed (40–49 yd)', fgmiss_50p: 'FG missed (50+ yd)',
        sack: 'sacks', int: 'interceptions', ff: 'forced fumbles', fr: 'fumble recoveries', def_td: 'defensive TD', def_st_td: 'return TD', safe: 'safeties',
        idp_tkl_solo: 'solo tackles', idp_tkl_ast: 'assisted tackles', idp_tkl_loss: 'tackles for loss', idp_sack: 'sacks', idp_int: 'interceptions', idp_ff: 'forced fumbles', idp_fr: 'fumble recoveries', idp_pass_def: 'passes defended', idp_td: 'defensive TD', idp_safe: 'safeties' };
    const hasStats = stats => Object.entries(stats).some(([key, value]) => key === 'extra' ? hasStats(value || {}) : Number.isFinite(value) && value !== 0);

    function addStats(target, source) {
        for (const [key, value] of Object.entries(source)) {
            if (key === 'extra') { target.extra ||= {}; addStats(target.extra, value); }
            else if (Number.isFinite(value)) target[key] = round2((target[key] || 0) + value);
        }
        return target;
    }

    function describeStats(stats, limit = Infinity) {
        const parts = Object.entries(CORE_LABELS).filter(([key]) => stats[key]).map(([key, label]) => `${stats[key]} ${label}`);
        const extra = stats.extra || {};
        for (const [key, value] of Object.entries(extra)) {
            if (!value || !EXTRA_LABELS[key]) continue;
            if (['fgm', 'fgmiss'].includes(key) && Object.keys(extra).some(band => band.startsWith(key + '_') && extra[band] > 0)) continue;
            parts.push(`${value} ${EXTRA_LABELS[key]}`);
        }
        return parts.slice(0, limit).join(' · ');
    }

    /** Integer events spread evenly; yardage varies by quarter without losing a yard. */
    function splitAmount(value, random, volume = false) {
        if (!Number.isFinite(value) || value === 0) return [0, 0, 0, 0];
        const unit = Number.isInteger(value) ? 1 : Number.isInteger(value * 2) ? 0.5 : 0.01;
        const count = Math.round(Math.abs(value) / unit), sign = Math.sign(value);
        const shares = [0, 0, 0, 0];
        if (volume) {
            const weights = shares.map(() => 0.65 + random() * 0.7), total = weights.reduce((a, b) => a + b, 0);
            const exact = weights.map(weight => count * weight / total);
            exact.forEach((value, i) => { shares[i] = Math.floor(value); });
            const order = exact.map((value, i) => ({ i, fraction: value - shares[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
            for (let i = 0, rest = count - shares.reduce((a, b) => a + b, 0); i < rest; i++) shares[order[i].i]++;
        } else {
            const offset = Math.floor(random() * 4), order = [0, 2, 1, 3].map(i => (i + offset) % 4);
            shares.fill(Math.floor(count / 4));
            for (let i = 0; i < count % 4; i++) shares[order[i]]++;
        }
        return shares.map(value => round2(value * unit * sign));
    }

    function splitStats(stats, random) {
        const quarters = Array.from({ length: 4 }, () => ({}));
        for (const [key, value] of Object.entries(stats)) {
            if (key === 'extra') continue;
            splitAmount(value, random, key.endsWith('Yd')).forEach((part, i) => { quarters[i][key] = part; });
        }
        // A receiving touchdown belongs to a quarter with a reception.
        if (stats.rec >= stats.recTd && stats.recTd > 0) {
            const catches = splitAmount(stats.rec - stats.recTd, random);
            quarters.forEach((quarter, i) => { quarter.rec = (quarter.recTd || 0) + catches[i]; });
        }
        if (stats.rec > 0 && stats.recYd) {
            // One long reception cannot appear as receiving yards in four
            // quarters. Allocate those yards only where a catch actually lands.
            let used = 0;
            const active = quarters.map((quarter, i) => ({ i, catches: quarter.rec || 0 })).filter(item => item.catches > 0);
            quarters.forEach(quarter => { quarter.recYd = 0; });
            active.forEach((item, index) => {
                const yards = index === active.length - 1 ? stats.recYd - used : Math.round(stats.recYd * item.catches / stats.rec);
                quarters[item.i].recYd = yards; used += yards;
            });
        }
        if (stats.extra) {
            quarters.forEach(quarter => { quarter.extra = {}; });
            for (const [key, value] of Object.entries(stats.extra)) {
                splitAmount(value, random).forEach((part, i) => { quarters[i].extra[key] = part; });
            }
            // Total and distance-band columns describe the same kicks.
            for (const totalKey of ['fgm', 'fgmiss']) {
                const bands = Object.keys(stats.extra).filter(key => key.startsWith(totalKey + '_'));
                const bandTotal = bands.reduce((sum, key) => sum + stats.extra[key], 0);
                if (bands.length && Number.isFinite(stats.extra[totalKey]) && stats.extra[totalKey] >= bandTotal) {
                    const rest = splitAmount(stats.extra[totalKey] - bandTotal, random);
                    quarters.forEach((quarter, i) => { quarter.extra[totalKey] = rest[i] + bands.reduce((sum, key) => sum + quarter.extra[key], 0); });
                }
            }
        }
        return quarters;
    }

    function availabilityEvent(entry, teamId, t, status, description) {
        return { t, quarter: Math.floor(t / QUARTER_LENGTH) + 1, teamId, entryId: entry.entryId,
            playerName: entry.name, kind: 'availability', status, points: 0, stats: {},
            touchdowns: 0, isTouchdown: false, description };
    }

    function buildEntryEvents(seed, week, teamId, entry, scoring, simulatedAvailability) {
        if (!entry.stats) return simulatedAvailability ? [availabilityEvent(entry, teamId, 0,
            'no-record', `${entry.name}: no recorded appearance in this week's draw. The archive does not confirm an injury.`)] : [];
        if (!hasStats(entry.stats) && toCents(entry.points) === 0) return [];
        const random = createSeededRandom(`${seed}:quarters:${week}:${teamId}:${entry.entryId}`);
        const events = [];
        const emit = (stats, quarter, minute) => {
            if (!hasStats(stats)) return;
            const touchdowns = ['passTd', 'rushTd', 'recTd'].reduce((sum, key) => sum + (stats[key] || 0), 0)
                + ['def_td', 'def_st_td', 'idp_td'].reduce((sum, key) => sum + (stats.extra?.[key] || 0), 0);
            events.push({ t: quarter * QUARTER_LENGTH + minute, quarter: quarter + 1, teamId,
                entryId: entry.entryId, playerName: entry.name, stats, touchdowns, isTouchdown: touchdowns > 0,
                description: `${entry.name}: ${describeStats(stats) || 'scoring adjustment'}` });
        };
        splitStats(entry.stats, random).forEach((stats, quarter) => {
            const { extra = {}, passInt = 0, fumblesLost = 0, ...production } = stats;
            emit(production, quarter, 3 + random() * 6);
            emit({ passInt, fumblesLost }, quarter, 7 + random() * 6);
            const defense = Object.fromEntries(Object.entries(extra).filter(([key]) => !/^(fgm|fgmiss|xpm|xpmiss)(_|$)/.test(key)));
            emit({ extra: defense }, quarter, 4 + random() * 8);
            for (const totalKey of ['fgm', 'fgmiss']) {
                let totalRemaining = extra[totalKey] || 0;
                const bands = Object.keys(extra).filter(key => key.startsWith(totalKey + '_')).sort();
                for (const key of bands) {
                    for (let n = 0; n < extra[key]; n++) {
                        const kick = { [key]: 1 };
                        if (totalRemaining > 0) { kick[totalKey] = 1; totalRemaining--; }
                        emit({ extra: kick }, quarter, 5 + random() * 8);
                    }
                }
                for (let n = 0; n < totalRemaining; n++) emit({ extra: { [totalKey]: 1 } }, quarter, 5 + random() * 8);
            }
            for (const key of ['xpm', 'xpmiss']) {
                for (let n = 0; n < (extra[key] || 0); n++) emit({ extra: { [key]: 1 } }, quarter, 11 + random() * 3);
            }
        });
        if (!events.length) events.push({ t: GAMECAST_END - 1, quarter: 4, teamId, entryId: entry.entryId, playerName: entry.name, stats: {}, touchdowns: 0, isTouchdown: false, description: `${entry.name}: final scoring adjustment` });
        events.sort((a, b) => a.t - b.t);
        const cumulative = {};
        let previousCents = 0;
        events.forEach((event, index) => {
            addStats(cumulative, event.stats);
            // Score cumulative production so custom thresholds and era rounding
            // land once, at the moment earned. Saved totals remain authoritative.
            const cents = index === events.length - 1 ? toCents(entry.points)
                : toCents(App.TimeLeagueSeason.scoreStatLine(cumulative, scoring) * (entry.factor > 0 ? entry.factor : 1));
            event.points = (cents - previousCents) / 100;
            previousCents = cents;
        });
        // This is fictional presentation, not inferred NFL injury history. A
        // small share of quieter skill-position games end with an early exit.
        // Move all original production before that moment; never remove stats,
        // add lost points, or invent future recovery dates. Old replays opt out.
        const quietGame = { QB: 12, RB: 8, WR: 8, TE: 6 }[entry.position];
        if (simulatedAvailability && entry.points > 0 && entry.points <= quietGame) {
            const availabilityRandom = createSeededRandom(`${seed}:availability:${week}:${entry.identity || entry.entryId}:${entry.drawnSeason}`);
            if (availabilityRandom() < 0.12) {
                const exitAt = 20 + availabilityRandom() * 20;
                const last = events[events.length - 1].t;
                for (const event of events) {
                    event.t = event.t / last * (exitAt - 1);
                    event.quarter = Math.floor(event.t / QUARTER_LENGTH) + 1;
                }
                events.push({ ...availabilityEvent(entry, teamId, exitAt, 'out',
                    `${entry.name} leaves the game and will not return. Vault simulation — the historical game total is unchanged.`), simulated: true });
            }
        }
        return events;
    }

    function quarterAt(clock) { return Math.max(1, Math.min(4, Math.ceil(clock / QUARTER_LENGTH))); }
    function nextQuarterEnd(clock) { return Math.min(GAMECAST_END, (Math.floor(clock / QUARTER_LENGTH) + 1) * QUARTER_LENGTH); }
    function clockLabel(clock) {
        const bounded = Math.max(0, Math.min(GAMECAST_END, clock));
        if (bounded >= GAMECAST_END) return 'FINAL';
        if (bounded === 30) return 'HALFTIME';
        if (bounded > 0 && bounded % QUARTER_LENGTH === 0) return `END Q${quarterAt(bounded)}`;
        const remaining = Math.ceil((QUARTER_LENGTH - bounded % QUARTER_LENGTH) * 60);
        return `Q${quarterAt(bounded)} · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    }

    function buildGamecast(input) {
        const events = input.results.flatMap(result => result.starters.flatMap(entry =>
            buildEntryEvents(input.seed, input.week, result.teamId, entry, input.scoring || DEFAULT_SCORING, input.simulatedAvailability === true)));
        events.sort((a, b) => a.t - b.t || a.teamId.localeCompare(b.teamId) || a.entryId.localeCompare(b.entryId));
        return { week: input.week, events, quarters: QUARTERS.map(quarter => ({ ...quarter })), duration: GAMECAST_END,
            finals: Object.fromEntries(input.results.map(result => [result.teamId, toCents(result.total) / 100])) };
    }

    function weekHeadlines(results, matchups, teamName) {
        const fmt = (value) => String(toCents(value) / 100);
        const headlines = [];

        let topTeam = null;
        for (const result of results) {
            if (!topTeam || result.total > topTeam.total) topTeam = result;
        }
        if (topTeam) headlines.push(`${teamName(topTeam.teamId)} set the week's pace with ${fmt(topTeam.total)} points.`);

        let bestLine = null;
        for (const result of results) {
            for (const entry of result.starters) {
                if (!bestLine || entry.points > bestLine.entry.points) bestLine = { entry, teamId: result.teamId };
            }
        }
        if (bestLine) {
            headlines.push(`Line of the week: ${bestLine.entry.name} goes for ${fmt(bestLine.entry.points)} to power ${teamName(bestLine.teamId)}.`);
        }

        const margin = (matchup) => Math.abs(matchup.homePoints - matchup.awayPoints);
        let closest = null;
        let blowout = null;
        let shootout = null;
        for (const matchup of matchups) {
            if (!closest || margin(matchup) < margin(closest)) closest = matchup;
            if (!blowout || margin(matchup) > margin(blowout)) blowout = matchup;
            if (!shootout || matchup.homePoints + matchup.awayPoints > shootout.homePoints + shootout.awayPoints) shootout = matchup;
        }
        if (closest) {
            if (closest.winner) {
                const loser = closest.winner === closest.home ? closest.away : closest.home;
                headlines.push(`Closest call: ${teamName(closest.winner)} edge ${teamName(loser)} by ${fmt(margin(closest))}.`);
            } else {
                headlines.push(`${teamName(closest.home)} and ${teamName(closest.away)} deadlock at ${fmt(closest.homePoints)}.`);
            }
        }
        if (blowout && blowout !== closest && blowout.winner) {
            const loser = blowout.winner === blowout.home ? blowout.away : blowout.home;
            headlines.push(`${teamName(blowout.winner)} roll past ${teamName(loser)} by ${fmt(margin(blowout))}.`);
        }
        if (shootout && shootout !== closest && shootout !== blowout && headlines.length < 5) {
            headlines.push(`Shootout: ${teamName(shootout.home)} and ${teamName(shootout.away)} combine for ${fmt(shootout.homePoints + shootout.awayPoints)}.`);
        }
        return headlines.slice(0, 5);
    }

    const api = { GAMECAST_END, QUARTER_LENGTH, quarterAt, nextQuarterEnd, clockLabel, addStats, describeStats, buildGamecast, weekHeadlines };
    App.TimeLeagueGamecast = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
