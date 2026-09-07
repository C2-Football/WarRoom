// Compact, identity-scoped career records. Only finalized games contribute.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const emptyStats = () => ({ wins: 0, losses: 0, ties: 0, points: 0, games: 0, trophies: 0, leagues: 0, completed: 0, high: null });
    const round = value => Math.round(value * 100) / 100;
    function recordFor({ league, mode, seatTeamId, rowId, archived = false } = {}) {
        if (!league?.leagueId || !['solo', 'multiplayer'].includes(mode) || !seatTeamId) return null;
        const team = league.teams?.find(item => item.teamId === seatTeamId && item.manager === 'human');
        if (!team) return null;
        const stats = emptyStats();
        const regular = { wins: 0, losses: 0, ties: 0 };
        const playoffs = { wins: 0, losses: 0, ties: 0 };
        const seen = new Set();
        for (const week of league.finalizedWeeks || []) {
            if (seen.has(week.week)) continue;
            seen.add(week.week);
            const matchup = week.matchups?.find(item => item.home === seatTeamId || item.away === seatTeamId);
            if (!matchup) continue;
            const result = week.results?.find(item => item.teamId === seatTeamId);
            const points = result?.total ?? (matchup.home === seatTeamId ? matchup.homePoints : matchup.awayPoints);
            if (!Number.isFinite(points)) continue;
            const outcome = matchup.winner == null ? 'ties' : matchup.winner === seatTeamId ? 'wins' : 'losses';
            stats[outcome] += 1;
            (week.week > league.settings.regularSeasonWeeks ? playoffs : regular)[outcome] += 1;
            stats.games += 1;
            stats.points += points;
            if (!stats.high || points > stats.high.points) stats.high = { points, week: week.week, leagueName: league.name, teamName: team.name };
        }
        stats.points = round(stats.points);
        stats.leagues = 1;
        stats.completed = league.phase === 'complete' ? 1 : 0;
        stats.trophies = stats.completed && league.championTeamId === seatTeamId ? 1 : 0;
        const draftMap = new Map();
        const picks = new Set();
        for (const pick of league.draftPicks || []) {
            if (pick.teamId !== seatTeamId || !pick.identity || picks.has(pick.overall)) continue;
            picks.add(pick.overall);
            const existing = draftMap.get(pick.identity);
            if (existing) existing.count += 1;
            else draftMap.set(pick.identity, { identity: pick.identity, name: pick.name, position: pick.position, count: 1 });
        }
        return {
            version: 1, leagueId: league.leagueId, rowId: rowId || null, seatTeamId, mode,
            name: league.name, teamName: team.name, createdAt: league.createdAt, phase: league.phase,
            archived, finalizedCount: seen.size, draftCount: picks.size,
            stats, regular, playoffs, drafted: [...draftMap.values()],
        };
    }
    function summarize(records = []) {
        const unique = new Map();
        for (const record of records) {
            if (record?.version !== 1 || !record.leagueId || !record.seatTeamId || !['solo', 'multiplayer'].includes(record.mode) || !record.stats) continue;
            const key = `${record.mode}:${record.leagueId}:${record.seatTeamId}`;
            const old = unique.get(key);
            const progress = item => (item.finalizedCount || 0) * 10000 + (item.draftCount || 0);
            if (!old || progress(record) > progress(old) || (progress(record) === progress(old) && (!record.archived || old.archived))) unique.set(key, record);
        }
        const leagues = [...unique.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const profile = { overall: emptyStats(), solo: emptyStats(), multiplayer: emptyStats(), leagues, mostDrafted: [], trophies: leagues.filter(item => item.stats.trophies) };
        const drafted = new Map();
        for (const record of leagues) {
            for (const target of [profile.overall, profile[record.mode]]) {
                for (const key of ['wins', 'losses', 'ties', 'points', 'games', 'trophies', 'leagues', 'completed']) target[key] += record.stats[key] || 0;
                if (record.stats.high && (!target.high || record.stats.high.points > target.high.points)) target.high = record.stats.high;
                target.points = round(target.points);
            }
            for (const pick of record.drafted || []) {
                const old = drafted.get(pick.identity);
                if (old) old.count += pick.count;
                else drafted.set(pick.identity, { ...pick });
            }
        }
        profile.mostDrafted = [...drafted.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        return profile;
    }
    const api = { recordFor, summarize };
    App.TimeLeagueCareer = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
