// On-demand, verified Sleeper ownership/progress for the normal Compare path.
// Reuses the app's validated pick readers; never promotes hydrate's [] fallback
// into evidence of zero transfers, and never mutates a league or window.S.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const cache = new Map();
    const id = value => value == null ? '' : String(value);

    function contextKey(league) {
        return id(league?.season) + ':' + id(league?.id || league?.league_id);
    }

    function unavailable(league, error, status = 'unavailable') {
        return {
            contextKey: contextKey(league), leagueId: id(league?.id || league?.league_id), season: id(league?.season),
            status, ready: false, fetchedAt: null, error,
            context: {
                tradedPicks: undefined, _pickFeedState: 'unavailable', _pickFeedError: error,
                _draftInventory: undefined, _draftInventoryState: 'unavailable', _draftInventoryError: error,
            },
        };
    }

    function copy(result) {
        const context = result.context;
        return { ...result, context: { ...context,
            tradedPicks: context.tradedPicks?.map(pick => ({ ...pick })),
            _draftInventory: context._draftInventory ? { ...context._draftInventory, consumed: context._draftInventory.consumed.map(pick => ({ ...pick })) } : undefined,
        } };
    }

    // isCurrent is checked separately for each consumer of an in-flight read.
    // Leaving Compare cannot poison another consumer or publish into its state.
    async function load(league, options = {}) {
        const current = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
        if (!current()) return unavailable(league, null, 'cancelled');
        const type = options.skin?.type || league?.leagueSkin?.type || ({ 1: 'keeper', 2: 'dynasty' })[league?.settings?.type];
        if (!['dynasty', 'keeper'].includes(type)) return unavailable(league, 'Draft capital is disabled for this format.', 'disabled');
        const platform = String(league?._platform || league?._source || league?.platform || league?.provider || '').toLowerCase();
        if (league?._espn || league?._mfl || league?._yahoo || (platform && platform !== 'sleeper')) return unavailable(league, 'Verified draft ownership is available for Sleeper connections.');
        if (!league || !id(league.id || league.league_id) || !/^\d{4}$/.test(id(league.season)) || !Array.isArray(league.rosters) || !league.rosters.length) return unavailable(league, 'League and roster context is unavailable.');
        // These are top-level app.js declarations in both source and the
        // precompiled classic-script build, so they exist by the first UI call.
        const readOwnership = root.fetchEmpireTradedPicks;
        const readProgress = root.fetchEmpireDraftInventory;
        if (typeof readOwnership !== 'function' || typeof readProgress !== 'function') return unavailable(league, 'Draft data readers are not ready. Retry after the app loads.');
        const now = typeof options.now === 'function' ? options.now : Date.now;
        const key = contextKey(league) + ':draft:' + id(league.draft_id);
        let entry = cache.get(key);
        if (!entry) { entry = {}; cache.set(key, entry); }
        const ttl = entry.result?.context._draftInventory?.phase === 'drafting' ? 15 * 1000 : 60 * 1000;
        if (!options.force && entry.result?.ready && now() - entry.result.fetchedAt < ttl) return copy(entry.result);
        if (!entry.pending) {
            const seededOwnership = league._pickFeedState === 'ready' && Array.isArray(league.tradedPicks)
                ? { contextKey: contextKey(league), picks: league.tradedPicks, status: 'ready', error: null } : null;
            const seededProgress = league._draftInventoryState === 'ready' && id(league._draftInventory?.season) === id(league.season)
                && (!league.draft_id || id(league._draftInventory?.draftId) === id(league.draft_id))
                ? { contextKey: contextKey(league), inventory: league._draftInventory, status: 'ready', error: null } : null;
            const readOptions = { fetcher: options.fetcher, timeoutMs: options.timeoutMs };
            const request = (async () => {
                const settled = await Promise.allSettled([
                    readOwnership(league, { ...readOptions, previous: entry.ownership || seededOwnership }),
                    readProgress(league, { ...readOptions, previous: entry.progress || seededProgress }),
                ]);
                const ownership = settled[0].status === 'fulfilled' && settled[0].value
                    ? settled[0].value : { status: 'unavailable', error: 'Could not verify pick ownership. Retry league sync.' };
                const progress = settled[1].status === 'fulfilled' && settled[1].value
                    ? settled[1].value : { status: 'unavailable', error: 'Could not verify draft progress. Retry league sync.' };
                const ready = ownership.status === 'ready' && progress.status === 'ready';
                const known = Array.isArray(ownership.picks) || !!progress.inventory;
                const errors = [...new Set([ownership.error, progress.error].filter(Boolean))];
                const result = {
                    contextKey: contextKey(league), leagueId: id(league.id || league.league_id), season: id(league.season),
                    status: ready ? 'ready' : known ? 'partial' : 'unavailable', ready, fetchedAt: now(), error: errors.join(' ') || null,
                    context: {
                        tradedPicks: ownership.picks, _pickFeedState: ownership.status, _pickFeedError: ownership.error || null,
                        _draftInventory: progress.inventory, _draftInventoryState: progress.status, _draftInventoryError: progress.error || null,
                    },
                };
                if (cache.get(key) === entry) {
                    entry.ownership = ownership; entry.progress = progress; entry.result = copy(result);
                }
                return result;
            })();
            entry.pending = request;
            request.finally(() => { if (entry.pending === request) entry.pending = null; });
        }
        const result = await entry.pending;
        return current() ? copy(result) : unavailable(league, null, 'cancelled');
    }

    App.TeamComparisonData = { load, contextKey, clear: () => cache.clear() };
})(typeof window !== 'undefined' ? window : globalThis);
