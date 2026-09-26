(function (root) {
    'use strict';
    const App = root.App;
    const round = value => Math.round(value * 100) / 100;
    function completedWeeks(league, throughWeek = Infinity) {
        return (league.finalizedWeeks || []).filter(row => row.week <= throughWeek).map(row => row.week).sort((a, b) => a - b);
    }
    // Player production includes bench games and weeks before acquisition. Team
    // standings still count only starters; changing owners never resets a player.
    function totals(league, entry, logIndex, eraFactors, weeks) {
        const S = App.TimeLeagueSeason;
        let points = 0, games = 0;
        const stats = {};
        if (league.settings.hiddenYears && league.yearsRevealed !== true && App.TimeLeagueHiddenYears) {
            const rows = App.TimeLeagueHiddenYears.observationRows(league, entry).filter(row => weeks.includes(row.week));
            for (const row of rows) {
                if (!row.available) continue;
                if (!Number.isFinite(row.points)) return { points: null, games: null, average: null, stats: {} };
                points += row.points; games++;
                for (const [key, value] of Object.entries({ ...row.stats, ...row.stats.extra })) if (typeof value === 'number') stats[key] = (stats[key] || 0) + value;
            }
            return { points: round(points), games, average: games ? round(points / games) : 0, stats };
        }
        for (const week of weeks) {
            const saved = S.completedProduction(league, entry, week);
            const log = S.resolveGameLog(league, entry, week, logIndex, App.TimeLeagueEngine.seasonEndWeek(league));
            if (!saved && ((league.publicSnapshotVersion === 1 && league.settings.gameDeckVersion === 1) || !logIndex || (league.settings.eraAdjusted && !eraFactors?.size))) return { points: null, games: null, average: null, stats: {} };
            if (saved && !Object.hasOwn(saved, 'stats') && Number.isInteger(saved.sourceWeek) && !log) return { points: null, games: null, average: null, stats: {} };
            const line = saved && Object.hasOwn(saved, 'stats') ? saved.stats : log?.stats;
            if (!line) continue;
            games++;
            points += saved ? saved.points : round(S.scoreStatLine(line, league.settings.scoring, S.REFERENCE_EXTENDED_SCORING) * S.eraFactorFor(league.settings.eraAdjusted ? S.factorsFor(league, eraFactors) : null, entry.drawnSeason, entry.position));
            for (const [key, value] of Object.entries(line)) {
                if (typeof value === 'number') stats[key] = (stats[key] || 0) + value;
            }
            for (const [key, value] of Object.entries(line.extra || {})) if (typeof value === 'number') stats[key] = (stats[key] || 0) + value;
        }
        return { points: round(points), games, average: games ? round(points / games) : 0, stats };
    }
    // The same recorded-game average is comparable on a roster, the wire and
    // a substitution sheet. A weekly star clue ranks the assigned historical
    // game within this player's archive; it is not a win or play probability.
    function signals(league, entry, logIndex, eraFactors, throughWeek = Infinity) {
        const hidden = { average: null, games: null, points: null, currentStars: null, currentAvailable: null };
        const hiddenYear = league.settings.hiddenYears && league.yearsRevealed !== true;
        if (!league.seasonsRevealed || league.phase === 'draft' || (!hiddenYear && !Number.isInteger(entry?.drawnSeason))) return { ...hidden, status: 'sealed' };
        const production = totals(league, entry, logIndex, eraFactors, completedWeeks(league, throughWeek));
        const result = { ...hidden, points: production.points, games: production.games,
            average: production.games > 0 && Number.isFinite(production.average) ? production.average : null };
        const endWeek = App.TimeLeagueEngine.seasonEndWeek(league);
        if (league.phase === 'complete' || league.currentWeek > endWeek) return { ...result, status: 'complete' };
        if (league.weekStage === 'postgame' || throughWeek < league.currentWeek - 1) return { ...result, status: 'awaiting-week' };
        const rating = App.TimeLeagueSeason.weeklyStarOutlook(entry, league.currentWeek, endWeek, logIndex,
            league.settings.scoring, league.settings.eraAdjusted ? eraFactors : null, league);
        const current = rating?.schedule?.find(row => row.week === league.currentWeek);
        const available = current?.available;
        if (typeof available !== 'boolean') return { ...result, status: 'unavailable' };
        return { ...result, status: 'ready', currentAvailable: available,
            currentStars: available && Number.isInteger(rating.stars) && rating.stars >= 1 && rating.stars <= 5 ? rating.stars : null };
    }
    // Public archive research is separate from the privately assigned Vault
    // calendar. A single evidence-backed candidate opens its historical games;
    // the exact unused pool is not a promise that every game will be drawn.
    function scouting(league, entry, cards, logIndex, eraFactors, throughWeek = Infinity) {
        const S = App.TimeLeagueSeason, H = App.TimeLeagueHiddenYears;
        const hidden = league.settings.hiddenYears && league.yearsRevealed !== true;
        cards = App.TimeLeagueEngine.cardsFor(league, cards);
        // Solo wire rows deliberately omit their private year. Resolve it only
        // inside the authorized current-clue calculation, never archive research.
        let signalEntry = entry;
        if (hidden && league.publicSnapshotVersion !== 1 && league.seasonsRevealed && league.phase !== 'draft'
            && !Number.isInteger(entry.drawnSeason) && cards?.has(entry.identity)) {
            signalEntry = { ...entry, drawnSeason: App.TimeLeagueEngine.waiverSeason(league, cards.get(entry.identity)) };
        }
        const result = { ...signals(league, signalEntry, logIndex, eraFactors, throughWeek), identifiedYear: null, candidateCount: null,
            remainingPoints: null, remainingBasis: null, remainingEstimated: true, remainingGames: null,
            playableRemaining: null, playableRemainingEstimated: true, remainingWeeks: 0,
            archivePoints: null, archiveGames: null, archive: [] };
        if (!league.seasonsRevealed || league.phase === 'draft') return result;
        const selectedFactors = S.factorsFor(league, eraFactors);
        const intel = hidden && H ? H.read(league, entry, cards, logIndex, throughWeek, selectedFactors) : null;
        const year = hidden ? intel?.candidateYears.length === 1 ? intel.candidateYears[0] : null : Number.isInteger(entry.drawnSeason) ? entry.drawnSeason : null;
        result.identifiedYear = year;
        result.candidateCount = intel ? intel.candidateYears.length : year == null ? null : 1;
        // During replay, only weeks the viewer has completed reduce the public
        // remainder. Neither a saved unseen final nor a new clue enters it.
        const visibleThrough = Math.max(0, Math.min(Number.isFinite(throughWeek) ? throughWeek : league.currentWeek - 1, league.currentWeek - 1));
        const end = App.TimeLeagueEngine.seasonEndWeek(league);
        const remainingWeeks = Math.max(0, end - visibleThrough);
        result.remainingWeeks = remainingWeeks;
        const candidateScored = intel?.candidates.length && intel.candidates.every(row => row.basis === 'league scoring');
        const estimatedAverage = intel ? intel.average ?? (candidateScored ? intel.estimatedAverage : null) : result.average;
        if (Number.isFinite(estimatedAverage)) {
            result.remainingPoints = round(estimatedAverage * remainingWeeks);
            result.playableRemaining = result.remainingPoints;
            result.remainingBasis = intel?.average == null && intel ? 'candidate archive estimate' : 'completed-game estimate';
        }
        const season = cards?.get(entry.identity)?.seasons?.find(row => row.season === year);
        const indexed = S.dataIndexFor(league, logIndex);
        const source = year == null || !indexed ? [] : S.sourceGames({ identity: entry.identity, drawnSeason: year }, indexed);
        const complete = hidden ? intel?.evidenceComplete : Boolean(season && Number.isInteger(season.games) && season.games > 0 && source.length >= season.games);
        if (!complete || !source.length || (league.settings.eraAdjusted && !selectedFactors?.size)) return result;
        const observed = hidden ? intel.observed : completedWeeks(league, visibleThrough).map(week => {
            const saved = S.completedProduction(league, entry, week);
            const log = S.resolveGameLog(league, entry, week, logIndex, end);
            return { week, stats: saved && Object.hasOwn(saved, 'stats') ? saved.stats : log?.stats };
        });
        const fingerprint = H?.fingerprint || (stats => JSON.stringify(Object.entries({ ...stats, ...stats?.extra }).filter(([key, value]) => key !== 'extra' && typeof value === 'number' && Number.isFinite(value) && value !== 0).sort(([a], [b]) => a.localeCompare(b))));
        const counts = new Map(), poolCounts = new Map();
        for (const row of observed) if (row.stats != null) { const key = fingerprint(row.stats); counts.set(key, (counts.get(key) || 0) + 1); }
        for (const row of source) { const key = fingerprint(row.stats); poolCounts.set(key, (poolCounts.get(key) || 0) + 1); }
        // Changed/missing evidence cannot manufacture an exact remainder.
        if ([...counts].some(([key, count]) => (poolCounts.get(key) || 0) < count)) return result;
        const consumed = new Map(counts);
        const factor = league.settings.eraAdjusted ? S.eraFactorFor(selectedFactors, year, entry.position) : 1;
        let remaining = 0, total = 0, remainingGames = 0;
        result.archive = source.map(log => {
            const key = fingerprint(log.stats), used = (consumed.get(key) || 0) > 0;
            const points = round(S.scoreStatLine(log.stats, league.settings.scoring, S.REFERENCE_EXTENDED_SCORING) * factor);
            total += points;
            if (used) consumed.set(key, consumed.get(key) - 1);
            else { remaining += points; remainingGames++; }
            // Identical stat lines do not identify which historical date was
            // consumed. Mark every such row ambiguous until all copies appeared.
            const matched = counts.get(key) || 0;
            return { historicalWeek: log.historicalWeek ?? log.week, week: log.week, date: log.gameDate || null,
                team: log.team || null, opponent: log.opponent || null, points, stats: log.stats,
                observed: matched === 0 ? false : matched >= poolCounts.get(key) ? true : null };
        });
        result.archivePoints = round(total); result.archiveGames = source.length;
        result.remainingPoints = round(remaining); result.remainingGames = remainingGames;
        result.remainingBasis = 'unused archive'; result.remainingEstimated = false;
        // Includes publicly documented no-record slots. The expectation is an
        // average of the unused public pool, never a peek at future assignments.
        const scheduled = S.usesGameDeck(league) ? Math.max(14, end, source.length, ...source.map(log => Number(log.scheduledGames) || 0)) : Math.max(end, source.length);
        const unusedSlots = Math.max(remainingGames, scheduled - visibleThrough);
        result.playableRemaining = remainingWeeks && unusedSlots ? round(remaining * Math.min(1, remainingWeeks / unusedSlots)) : 0;
        result.playableRemainingEstimated = remainingWeeks > 0 && remainingWeeks < unusedSlots;
        return result;
    }
    function players(league, cards, logIndex, eraFactors, throughWeek = Infinity, period = 'ytd') {
        if (!league.seasonsRevealed) return [];
        const E = App.TimeLeagueEngine;
        cards = E.cardsFor(league, cards);
        const done = completedWeeks(league, throughWeek);
        const weeks = period === 'ytd' ? done : done.filter(week => week === Number(period));
        const owned = league.teams.flatMap(team => team.roster.map(entry => ({ ...entry, teamId: team.teamId, teamName: team.name })));
        const free = E.freeAgents(league, cards).flatMap(card => {
            if (league.settings.hiddenYears && league.yearsRevealed !== true) return [{ identity: card.identity, name: card.name, position: card.position,
                editionId: `mystery:${card.identity}`, hiddenDecade: App.TimeLeagueHiddenYears?.decadeFor(league, card, cards), teamId: 'fa', teamName: 'Free agent' }];
            const drawnSeason = E.waiverSeason(league, card);
            return drawnSeason == null ? [] : [{ identity: card.identity, name: card.name, position: card.position, drawnSeason, teamId: 'fa', teamName: 'Free agent' }];
        });
        return [...owned, ...free].map(entry => ({ ...entry, ...totals(league, entry, logIndex, eraFactors, weeks),
            seasonPoints: league.settings.hiddenYears && league.yearsRevealed !== true ? null : cards.get(entry.identity)?.seasons.find(season => season.season === entry.drawnSeason)?.points ?? null }));
    }
    function filterAndSort(rows, { search = '', position = 'ALL', team = 'ALL', sort = 'points', ascending = false } = {}) {
        const allowed = position === 'FLEX' ? ['RB', 'WR', 'TE'] : position === 'SUPER_FLEX' ? ['QB', 'RB', 'WR', 'TE'] : [position];
        return rows.filter(row => (position === 'ALL' || allowed.includes(row.position)) && (team === 'ALL' || row.teamId === team)
            && row.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => {
            const av = a[sort], bv = b[sort];
            if (av == null || bv == null) return av == null && bv == null ? a.name.localeCompare(b.name) : av == null ? 1 : -1;
            const difference = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
            return (ascending ? difference : -difference) || a.name.localeCompare(b.name);
        });
    }
    App.TimeLeaguePlayerStats = { completedWeeks, totals, signals, scouting, players, filterAndSort };
})(typeof window !== 'undefined' ? window : globalThis);
