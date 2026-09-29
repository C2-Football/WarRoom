// The newsroom can turn the page after the games finish while the provider
// keeps its scoring week open for corrections. This never changes NFL state
// used by lineups, transactions, or projections elsewhere in the app.
(function (root) {
    'use strict';
    const verified = new WeakMap();
    const canceled = signal => {
        if (signal?.aborted) { const error = Error('Request canceled.'); error.name = 'AbortError'; throw error; }
    };
    const providerWeek = nfl => Math.max(1, Math.min(18, Number(nfl.display_week || nfl.week) || 1));
    async function loadState(signal, fetcher) {
        canceled(signal);
        const controller = new root.AbortController();
        let timedOut = false;
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 18000);
        try {
            const response = await fetcher('https://api.sleeper.app/v1/state/nfl', { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
            canceled(signal);
            if (!response.ok) throw Error('The league calendar could not load.');
            const nfl = await response.json();
            canceled(signal);
            if (timedOut) throw Error('The league calendar took too long to load.');
            return nfl;
        } catch (error) {
            canceled(signal);
            if (timedOut) throw Error('The league calendar took too long to load.');
            throw error;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    async function load({ signal, force = false, fetcher = root.fetch, now = Date.now } = {}) {
        const nfl = await loadState(signal, fetcher);
        const week = Number(nfl?.display_week || nfl?.week);
        if (!/^\d{4}$/.test(String(nfl?.season || '')) || !['pre', 'regular', 'post', 'off'].includes(nfl?.season_type) || (nfl.season_type === 'regular' && (!Number.isInteger(week) || week < 1 || week > 18))) throw Error('The league calendar could not be verified.');
        let checkedAt = now(), scoreboardUnavailable = false;
        let completedWeek = nfl.season_type === 'regular' ? week - 1 : 0, provisional = false;
        if (nfl.season_type === 'regular' && root.WrWireNfl?.loadWeek) {
            if (!verified.has(fetcher)) verified.set(fetcher, new Map());
            const cache = verified.get(fetcher), key = `${nfl.season}|regular|${week}`;
            try {
                const scores = await root.WrWireNfl.loadWeek({ phase: { season: nfl.season, week, seasontype: 2 }, signal, force, fetcher, now });
                canceled(signal);
                if (scores.completionVerified === true) {
                    completedWeek = week; provisional = true;
                    if (Number.isFinite(scores.checkedAt)) checkedAt = Math.min(checkedAt, scores.checkedAt);
                    cache.set(key, { completedWeek, checkedAt });
                    while (cache.size > 8) cache.delete(cache.keys().next().value);
                } else cache.delete(key); // New contradictory evidence supersedes an earlier final.
            } catch (error) {
                canceled(signal); if (error?.name === 'AbortError') throw error;
                scoreboardUnavailable = true;
                const prior = cache.get(key);
                if (prior) { completedWeek = prior.completedWeek; provisional = true; checkedAt = prior.checkedAt; }
            }
        }
        return { nfl, completedWeek, provisional, checkedAt, ...(scoreboardUnavailable ? { scoreboardUnavailable: true } : {}) };
    }
    function period(league, calendarOrNfl = {}) {
        const calendar = calendarOrNfl?.nfl ? calendarOrNfl : null, nfl = calendar?.nfl || calendarOrNfl;
        const range = root.WrWireStories.bounds(league);
        if (Number(nfl.season) > 0 && Number(league.season) > Number(nfl.season)) return { start: range.start, end: range.start - 1, week: range.start, live: false, provisional: false };
        const historical = Number(league.season) < Number(nfl.season);
        const sameSeason = String(league.season) === String(nfl.season);
        const postseason = sameSeason && nfl.season_type === 'post';
        const current = providerWeek(nfl);
        const advance = sameSeason && nfl.season_type === 'regular' && calendar?.provisional === true && Number(calendar.completedWeek) === current;
        const week = historical || postseason ? range.end + 1 : nfl.season_type === 'regular' ? current + (advance ? 1 : 0) : 1;
        return { start: range.start, end: Math.min(range.end, week - 1), week, live: !historical && !postseason && sameSeason,
            provisional: !!advance && current >= range.start && current <= range.end };
    }
    root.WrWireCalendar = { load, period };
})(typeof window !== 'undefined' ? window : globalThis);
