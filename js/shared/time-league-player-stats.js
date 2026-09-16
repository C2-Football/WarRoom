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
        if (!league.seasonsRevealed || !Number.isInteger(entry?.drawnSeason)) return { ...hidden, status: 'sealed' };
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
    function players(league, cards, logIndex, eraFactors, throughWeek = Infinity, period = 'ytd') {
        if (!league.seasonsRevealed) return [];
        const E = App.TimeLeagueEngine;
        cards = E.cardsFor(league, cards);
        const done = completedWeeks(league, throughWeek);
        const weeks = period === 'ytd' ? done : done.filter(week => week === Number(period));
        const owned = league.teams.flatMap(team => team.roster.map(entry => ({ ...entry, teamId: team.teamId, teamName: team.name })));
        const free = E.freeAgents(league, cards).flatMap(card => {
            const drawnSeason = E.waiverSeason(league, card);
            return drawnSeason == null ? [] : [{ identity: card.identity, name: card.name, position: card.position, drawnSeason, teamId: 'fa', teamName: 'Free agent' }];
        });
        return [...owned, ...free].map(entry => ({ ...entry, ...totals(league, entry, logIndex, eraFactors, weeks),
            seasonPoints: cards.get(entry.identity)?.seasons.find(season => season.season === entry.drawnSeason)?.points ?? null }));
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
    App.TimeLeaguePlayerStats = { completedWeeks, totals, signals, players, filterAndSort };
})(typeof window !== 'undefined' ? window : globalThis);
