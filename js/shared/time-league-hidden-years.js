/* global module */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const enabled = state => state?.settings?.hiddenYears === true;
    const concealed = state => enabled(state) && state.yearsRevealed !== true;
    const round = value => Math.round(value * 100) / 100;
    const editionKey = entry => entry.editionId || entry.entryId || `wire:${entry.identity}`;
    function eligibleSeasons(state, card) {
        const rows = App.TimeLeagueEraRules.filterSeasonsForEra(card?.seasons || [], state.settings.eraRules, card?.position);
        const fixed = state.hiddenYearCandidates?.[card?.identity];
        if (enabled(state) && Array.isArray(fixed)) return fixed.map(year => (card?.seasons || []).find(row => row.season === year) || { season: year, games: null, points: null });
        if (!enabled(state) || !rows.length) return rows;
        const savedDecade = state.hiddenYearDecades?.[card.identity];
        if (savedDecade) return rows.filter(row => App.TimeLeagueEraRules.decadeOf(row.season) === savedDecade);
        const decades = [...new Set(rows.map(row => App.TimeLeagueEraRules.decadeOf(row.season)))].filter(Boolean).sort();
        // The advertised decade is public and fixed before a pick. It does not
        // depend on the secret selected year, draft order or a future game.
        const random = App.TimeLeagueRoster.createSeededRandom(`vault-decade-v1:${state.leagueId}:${card.identity}`);
        const decade = decades[Math.floor(random() * decades.length)];
        return rows.filter(row => App.TimeLeagueEraRules.decadeOf(row.season) === decade);
    }
    function decadeFor(state, entry, cards) {
        if (entry?.hiddenDecade) return entry.hiddenDecade;
        if (state.hiddenYearDecades?.[entry?.identity]) return state.hiddenYearDecades[entry.identity];
        const card = cards?.get ? cards.get(entry?.identity) : entry;
        const rows = eligibleSeasons(state, card);
        return rows.length ? App.TimeLeagueEraRules.decadeOf(rows[0].season) : null;
    }
    const label = (state, entry, cards) => concealed(state) ? `${decadeFor(state, entry, cards) || 'Unknown decade'} · hidden year` : entry?.drawnSeason ?? 'Sealed year';
    function observationRows(state, entry, throughWeek = Infinity) {
        const limit = Math.min(throughWeek, state.currentWeek - 1);
        const rows = [];
        for (const week of state.finalizedWeeks || []) {
            if (week.week > limit) continue;
            const same = row => entry.editionId ? row.editionId === entry.editionId : row.entryId === entry.entryId;
            const saved = week.playerProduction?.find(same) || week.results?.flatMap(row => row.starters || []).find(same)
                || state.playerReports?.[editionKey(entry)]?.completed?.find(row => row.week === week.week);
            if (!saved) continue;
            rows.push({ week: week.week, points: Number.isFinite(saved.points) ? saved.points : null,
                available: saved.stats != null, stats: saved.stats == null ? null : JSON.parse(JSON.stringify(saved.stats)) });
        }
        return rows.sort((a, b) => a.week - b.week);
    }
    function fingerprint(stats) {
        const flat = { ...stats, ...stats?.extra }; delete flat.extra;
        return JSON.stringify(Object.entries(flat).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value !== 0).sort(([a], [b]) => a.localeCompare(b)));
    }
    function read(state, entry, cards, logIndex, throughWeek = Infinity, eraFactors) {
        const card = cards?.get(entry?.identity) || { identity: entry.identity, position: entry.position, seasons: [] }, decade = decadeFor(state, entry, cards);
        const eligible = eligibleSeasons(state, card)
            .filter(row => !decade || App.TimeLeagueEraRules.decadeOf(row.season) === decade);
        const observed = state.seasonsRevealed ? observationRows(state, entry, throughWeek) : [];
        const played = observed.filter(row => row.available && row.points != null);
        const average = played.length ? round(played.reduce((sum, row) => sum + row.points, 0) / played.length) : null;
        const requested = new Map();
        for (const row of observed.filter(row => row.available)) { const key = fingerprint(row.stats); requested.set(key, (requested.get(key) || 0) + 1); }
        const indexed = logIndex && App.TimeLeagueSeason.dataIndexFor(state, logIndex);
        const source = new Map(eligible.map(row => [row.season, indexed ? App.TimeLeagueSeason.sourceGames({ identity: entry.identity, drawnSeason: row.season }, indexed) : []]));
        // Partial/missing archives never prove a candidate impossible. Exact
        // stat lines can identify a year early; the game does not fake ambiguity.
        const evidenceComplete = Boolean(indexed && eligible.length && eligible.every(row => Number.isInteger(row.games) && row.games > 0 && source.get(row.season).length >= row.games));
        const candidates = eligible.filter(row => {
            if (!evidenceComplete) return true;
            const counts = new Map();
            for (const game of source.get(row.season)) { const key = fingerprint(game.stats); counts.set(key, (counts.get(key) || 0) + 1); }
            return [...requested].every(([key, count]) => (counts.get(key) || 0) >= count);
        }).map(row => {
            let points = row.points, basis = 'reference scoring';
            const games = source.get(row.season);
            if (evidenceComplete && (!state.settings.eraAdjusted || eraFactors?.size)) {
                const factor = state.settings.eraAdjusted ? App.TimeLeagueSeason.eraFactorFor(eraFactors, row.season, entry.position) : 1;
                points = round(games.reduce((sum, game) => sum + round(App.TimeLeagueSeason.scoreStatLine(game.stats, state.settings.scoring, App.TimeLeagueSeason.REFERENCE_EXTENDED_SCORING) * factor), 0));
                basis = 'league scoring';
            }
            return { season: row.season, games: row.games, points, average: row.games > 0 && Number.isFinite(points) ? round(points / row.games) : null, basis,
                passYd: row.passYd, passTd: row.passTd, passInt: row.passInt, rushYd: row.rushYd, rushTd: row.rushTd, rec: row.rec, recYd: row.recYd, recTd: row.recTd };
        });
        const averages = candidates.map(row => row.average).filter(Number.isFinite);
        const prior = averages.length && averages.length === candidates.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null;
        return { enabled: enabled(state), concealed: concealed(state), decade, candidateYears: candidates.map(row => row.season), candidates, observed,
            average, games: played.length, points: observed.length ? round(observed.reduce((sum, row) => sum + (row.points || 0), 0)) : 0,
            estimatedAverage: average ?? (prior == null ? null : round(prior)), spread: averages.length ? round(Math.max(...averages) - Math.min(...averages)) : null,
            estimateBasis: average == null ? 'candidate archive' : 'completed Vault games', evidenceComplete };
    }
    const api = { enabled, concealed, editionKey, eligibleSeasons, decadeFor, label, observationRows, fingerprint, read };
    App.TimeLeagueHiddenYears = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
