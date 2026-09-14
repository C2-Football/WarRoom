// Context for the live standings table. The score subscription remains shared
// with the scoreboard; completed weeks form a separate, reusable baseline.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const historyCache = new Map();
    const HISTORY_TTL = 300000;

    async function loadHistory({ league, week, signal, force = false, fetcher = root.fetch.bind(root), now = Date.now }) {
        const start = Math.max(1, Number(league.settings?.start_week) || 1);
        const key = `${league.league_id || league.id}|${league.season}|${start}|${week}`;
        const cached = historyCache.get(key);
        if (!force && cached && now() - cached.updatedAt < HISTORY_TTL) return cached;
        const weeks = Array.from({ length: Math.max(0, week - start) }, (_, i) => start + i);
        const priorWeeks = [];
        let cursor = 0;
        async function worker() {
            while (cursor < weeks.length) {
                const w = weeks[cursor++];
                const response = await fetcher(`https://api.sleeper.app/v1/league/${encodeURIComponent(league.league_id || league.id)}/matchups/${w}`, { cache: 'no-store', signal });
                if (!response.ok) throw new Error('Completed weeks could not load.');
                const rows = await response.json();
                if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || r.roster_id == null)) throw new Error('A completed week is unavailable.');
                const ids = new Set(rows.map(r => String(r.roster_id)));
                if (ids.size !== rows.length || rows.some(r => App.LeagueLiveScores.rosterPoints(r) == null)
                    || (league.rosters?.length && (ids.size !== league.rosters.length || league.rosters.some(r => !ids.has(String(r.roster_id)))))) throw new Error('A completed week is incomplete.');
                priorWeeks.push({ week: w, rows });
            }
        }
        await Promise.all(Array.from({ length: Math.min(4, weeks.length) }, worker));
        priorWeeks.sort((a, b) => a.week - b.week);
        const result = { priorWeeks, updatedAt: now() };
        historyCache.set(key, result);
        return result;
    }

    function startedRosters({ rows = [], games = [], playersData = {}, historical = false }) {
        const startedTeams = new Set();
        games.forEach(game => {
            if (/POSTPONED|CANCEL|SUSPEND|DELAY/i.test(game.statusName || '')) return;
            if (game.state === 'in' || game.completed) { startedTeams.add(game.home); startedTeams.add(game.away); }
        });
        return rows.filter(row => {
            if (!row || row.roster_id == null) return false;
            if (historical) return true;
            const points = App.LeagueLiveScores.rosterPoints(row);
            if (points != null && points !== 0) return true;
            return (row.starters || []).some(pid => {
                if (!pid || String(pid) === '0') return false;
                const actual = App.LeagueLiveScores.playerPoints(row, pid);
                return (actual != null && actual !== 0) || startedTeams.has(playersData[pid]?.team);
            });
        }).map(row => String(row.roster_id));
    }

    function useContext({ league, board, playersData }) {
        const React = root.React;
        const id = league?.league_id || league?.id || '';
        const season = String(league?.season || '');
        const week = board.week;
        const currentWeek = App.LeagueLiveScores.currentWeek(league);
        const liveSeason = Number(root.S?.nflState?.season) || new Date().getFullYear();
        const historical = Number(season) < liveSeason || (Number(season) === liveSeason && week < currentWeek);
        const future = Number(season) > liveSeason || (Number(season) === liveSeason && week > currentWeek);
        const playoffStart = Number(league?.settings?.playoff_week_start);
        const lastReg = playoffStart > 0 ? playoffStart - 1 : 18;
        const enabled = App.LeagueLiveScores.supported(league) && !App.Chopped?.isChopped?.(league) && week <= lastReg && !future;
        const key = `${id}|${season}|${week}|${enabled}`;
        const [revision, setRevision] = React.useState(0);
        const [history, setHistory] = React.useState({ key: '', status: 'loading', priorWeeks: [] });
        const [nfl, setNfl] = React.useState({ key: '', games: [] });
        React.useEffect(() => {
            if (!enabled) return undefined;
            let alive = true, pending = false;
            let controller;
            const refresh = async (force = false) => {
                if (!alive || pending || root.document.hidden) return;
                pending = true;
                controller = new root.AbortController();
                const timeout = root.setTimeout(() => controller?.abort(), 20000);
                setHistory(old => ({ key, status: old.key === key && old.updatedAt ? 'refreshing' : 'loading', priorWeeks: old.key === key ? old.priorWeeks : [], updatedAt: old.key === key ? old.updatedAt : null }));
                const nflRequest = historical ? Promise.resolve([]) : Promise.resolve().then(() => App.NflContext?.loadScores?.(week, season, 2) || [])
                    .then(games => { if (alive) setNfl({ key, games }); }).catch(() => {});
                try {
                    const result = await loadHistory({ league, week, signal: controller.signal, force });
                    if (alive) setHistory({ key, status: 'ready', ...result });
                } catch (_) {
                    if (alive) setHistory(old => ({ ...old, key, status: old.updatedAt ? 'stale' : 'error' }));
                } finally {
                    root.clearTimeout(timeout);
                    pending = false;
                }
                await nflRequest;
            };
            refresh(revision > 0);
            const onVisible = () => { if (!root.document.hidden) refresh(); };
            const timer = root.setInterval(onVisible, 60000);
            root.document.addEventListener('visibilitychange', onVisible);
            return () => { alive = false; controller?.abort(); root.clearInterval(timer); root.document.removeEventListener('visibilitychange', onVisible); };
        }, [key, revision]);
        const currentHistory = history.key === key ? history : { status: 'loading', priorWeeks: [] };
        return {
            enabled, historical, future, currentWeek, lastReg, history: currentHistory,
            startedRosterIds: startedRosters({ rows: board.rows, games: nfl.key === key ? nfl.games : [], playersData, historical }),
            refresh: () => setRevision(n => n + 1),
        };
    }
    App.LeagueLiveTable = { loadHistory, startedRosters, useContext };
})(typeof window !== 'undefined' ? window : globalThis);
