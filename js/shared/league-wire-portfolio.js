// One newsroom, with independent league evidence and progressive delivery.
(function (root) {
    'use strict';
    const recent = new Map();
    const keyFor = l => `${l.league_id || l.id}|${l.season}`;
    function period(league, nfl) {
        const range = root.WrWireStories.bounds(league);
        const historical = Number(league.season) < Number(nfl.season);
        const postseason = String(league.season) === String(nfl.season) && nfl.season_type === 'post';
        const week = historical || postseason ? range.end + 1 : nfl.season_type === 'regular' ? Math.max(1, Math.min(18, Number(nfl.display_week || nfl.week) || 1)) : 1;
        return { start: range.start, end: Math.min(range.end, week - 1), week, live: !historical && !postseason && Number(league.season) === Number(nfl.season) };
    }
    async function load({ leagues, accountId = '', signal, force = false, onUpdate, fetcher = (...args) => root.fetch(...args), now = Date.now }) {
        const eligible = [...new Map(leagues.filter(l => root.App.LeagueLiveScores.supported(l)).map(l => [keyFor(l), l])).values()];
        const json = async url => { if (signal?.aborted) throw Error('aborted'); const r = await fetcher(url, { signal }); if (!r.ok) throw Error('Scores unavailable'); return r.json(); };
        let nfl;
        try { nfl = await json('https://api.sleeper.app/v1/state/nfl'); if (!nfl?.season) throw Error('No season'); }
        catch (_) { if (!signal?.aborted) eligible.forEach(league => onUpdate({ league, status: 'error', error: 'The league calendar could not load. Refresh to retry.', stories: [] })); return; }
        let cursor = 0;
        const archiveJobs = [];
        async function worker() {
            while (cursor < eligible.length && !signal?.aborted) {
                const league = eligible[cursor++], span = period(league, nfl), cacheKey = `${accountId}|${keyFor(league)}|${span.week}`;
                const cached = recent.get(cacheKey);
                if (!force && cached && now() - cached.at < 60000) { onUpdate(cached.value); continue; }
                const nameFor = rid => root.WrWireStories.oldName(league, rid);
                let weeks = [], past = { seasons: [], complete: false }, board = null, error = '', currentReady = false;
                const publish = status => {
                    if (signal?.aborted) return null;
                    const edition = root.WrWireStories.build({ league, weeks, start: span.start, end: span.end, priorSeasons: past.seasons, archiveComplete: past.complete,
                        board, nameFor, headToHead: !root.App?.Chopped?.isChopped?.(league) && league.type !== 'chopped' && league.leagueSkin?.type !== 'chopped',
                        playerName: pid => root.S?.players?.[pid]?.full_name || 'A starting player' });
                    const stories = edition.stories.filter(s => s.documentary || s.week === span.end).concat(edition.previews);
                    const value = { league, status, error, stories, week: span.week, completedThrough: edition.completedThrough, priorSeasons: past.seasons.length, reusedSeasons: past.fromMemory ? past.seasons.length : past.savedCount || 0, currentReady, at: now() };
                    onUpdate(value); return value;
                };
                publish('loading');
                // Current news is usable while the older archive is still loading.
                await Promise.allSettled([
                    (async () => {
                        try { const r = await root.App.LeagueLiveTable.loadHistory({ league, week: span.end + 1, signal, force, fetcher, now }); weeks = r.priorWeeks; currentReady = true; }
                        catch (_) { error = 'Some completed scores could not load. Refresh to retry.'; }
                        publish('loading');
                    })(),
                    (async () => {
                        if (!span.live || span.week > root.WrWireStories.bounds(league).end) return;
                        try { const rows = await json(`https://api.sleeper.app/v1/league/${encodeURIComponent(league.league_id || league.id)}/matchups/${span.week}`); if (!Array.isArray(rows)) throw Error('Invalid scores'); board = { week: span.week, rows }; }
                        catch (_) { error = 'Current matchups could not load. Refresh to retry.'; }
                        publish('loading');
                    })(),
                ]);
                archiveJobs.push(async () => {
                    try { past = await root.WrWireStories.loadArchive({ league, signal, fetcher, now, retry: force, onProgress: p => { past = p; publish('loading'); } }); }
                    catch (_) { error = 'Earlier history is incomplete. Refresh to retry.'; }
                    if (!past.complete && !error) error = past.reason || 'Earlier history is incomplete.';
                    const value = publish(error ? 'partial' : 'ready');
                    if (value?.status === 'ready') { recent.set(cacheKey, { at: now(), value }); while (recent.size > 40) recent.delete(recent.keys().next().value); }
                });
            }
        }
        await Promise.all(Array.from({ length: Math.min(2, eligible.length) }, worker));
        let archiveCursor = 0;
        async function archiveWorker() { while (archiveCursor < archiveJobs.length && !signal?.aborted) await archiveJobs[archiveCursor++](); }
        await Promise.all(Array.from({ length: Math.min(2, archiveJobs.length) }, archiveWorker));
    }
    // Round-robin each league's best current story before any league's second.
    function headlines(entries, topic = 'all', leagueId = 'all') {
        const queues = entries.filter(e => leagueId === 'all' || String(e.league.league_id || e.league.id) === leagueId).map(entry => ({ entry,
            stories: entry.stories.filter(s => topic === 'all' || (topic === 'history' ? s.documentary : topic === 'recaps' ? s.kind === 'recap' : s.kind === 'record'))
                .slice().sort((a, b) => Number(!!a.documentary) - Number(!!b.documentary) || (b.weight || 0) - (a.weight || 0) || (b.eventSeason || 0) - (a.eventSeason || 0)),
        }));
        const out = [];
        for (let i = 0; queues.some(q => q.stories.length > i); i++) queues.forEach(q => { if (q.stories[i]) out.push({ ...q.stories[i], league: q.entry.league }); });
        return out;
    }
    root.WrWirePortfolio = { load, period, headlines };
})(typeof window !== 'undefined' ? window : globalThis);
