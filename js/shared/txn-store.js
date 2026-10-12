// js/shared/txn-store.js — per-league transaction persistence (P0-a data pipeline).
//
// Sleeper transactions are fetched per-week and, today, only for the single open league
// (window.S.transactions, set by provider.hydrate). Empire / cross-league features need
// every league's transactions without re-hydrating each one. This caches a league's
// full weekly transaction set in localStorage (keyed by league+season, TTL'd) and exposes
// readers. It is the substrate for cross-league recent-activity and (later) Owner DNA,
// which is derived from trade history.
//
// fetchLeagueTxns/getCached/recentTrades are on-demand and cheap. hydrateLeagues() does a
// background all-leagues sweep but is OPT-IN — callers (Command Bridge, DNA build) invoke
// it deliberately; it is intentionally not wired into the critical page-load path.
(function () {
    'use strict';

    const KEY = (lid, season) => 'dhq_txns_' + lid + '_' + season;
    const TTL_MS = 6 * 60 * 60 * 1000;  // 6h — transactions are append-only within a week
    const failedRefreshes = new Set();

    function store() { return window.App && window.App.DhqStorage; }

    function ctx() {
        const ns = (window.S && window.S.nflState) || (window.App && window.App.LI && window.App.LI.nflState) || {};
        const season = String(ns.season || (window.S && window.S.currentSeason) || new Date().getFullYear());
        const week = Number(ns.display_week || ns.week || 0);
        const offseason = !ns.season_type || ns.season_type === 'off' || week <= 1;
        return { season, week, offseason };
    }

    // Sync read of the cached transaction array for a league (current season by default).
    function getCached(lid, season) {
        const st = store(); if (!st || !lid) return [];
        season = season || ctx().season;
        const c = st.get(KEY(lid, season), null);
        return (c && Array.isArray(c.txns)) ? c.txns : [];
    }

    // Activity callers need evidence that EVERY requested week was read. Older
    // cache rows have no such proof (the earlier reader swallowed failures).
    // Keep those rows as fallback history, but refresh before trusting silence.
    async function fetchLeagueActivity(lid, opts) {
        opts = opts || {};
        const st = store();
        const c = ctx();
        const season = opts.season || c.season;
        const key = KEY(lid, season);
        const maxWeek = c.offseason ? 18 : Math.min(18, Math.max(0, c.week || 18));
        const cached = st?.get(key, null);
        const hasCache = !!cached && Array.isArray(cached.txns);
        const result = (status, row, error = null, failedWeeks = []) => ({
            status, txns: Array.isArray(row?.txns) ? row.txns : [],
            failedWaivers: Array.isArray(row?.failedWaivers) ? row.failedWaivers : [],
            fetchedAt: row?.ts || null, error, failedWeeks, hasCache: !!row,
        });
        if (!opts.force && !failedRefreshes.has(key) && hasCache && cached.complete === true && cached.maxWeek >= maxWeek
            && cached.ts > 0 && Date.now() >= cached.ts && (Date.now() - cached.ts) < TTL_MS) {
            return result('fresh', cached);
        }
        const unavailable = (error, failedWeeks = []) => {
            failedRefreshes.add(key);
            return result(hasCache ? 'stale' : 'unavailable', hasCache ? cached : null, error, failedWeeks);
        };
        if (typeof window.fetchTransactions !== 'function') return unavailable('Transaction activity is unavailable. Retry when the league connection is ready.');
        // Offseason: scan all 18 weeks for offseason trades; in-season: up to current week.
        const fetches = [];
        for (let w = 0; w <= maxWeek; w++) {
            fetches.push(Promise.resolve().then(() => window.fetchTransactions(lid, w)).then(rows => {
                if (!Array.isArray(rows)) throw new Error('Invalid transaction response');
                return { rows, week: w };
            }).catch(() => ({ rows: null, week: w })));
        }
        const results = await Promise.all(fetches);
        const failedWeeks = results.filter(r => !r.rows).map(r => r.week);
        if (failedWeeks.length) return unavailable('Transaction activity could not be refreshed for every week. Retry to check manager activity.', failedWeeks);
        const all = results.flatMap(r => r.rows).filter(t => t && t.type);
        const txns = all.filter(t => t.status !== 'failed');
        // Failed WAIVER claims are kept separately: a losing FAAB bid is real
        // willingness-to-pay evidence (the FAAB engine's best input), but every
        // existing reader of `txns` assumes completed transactions only — so
        // the main array's contract is unchanged.
        const failedWaivers = all.filter(t => t.status === 'failed' && t.type === 'waiver' && Number(t.settings && t.settings.waiver_bid) > 0);
        const next = { ts: Date.now(), season, complete: true, maxWeek, txns, failedWaivers };
        failedRefreshes.delete(key);
        if (st) {
            try { st.set(key, next); }
            catch (e) { if (window.dhqLog) window.dhqLog('txns.cache', e); }
        }
        return result('fresh', next);
    }

    // Preserve the array API for history consumers. Failed refreshes return
    // earlier history when available, never a newly fabricated empty ledger.
    async function fetchLeagueTxns(lid, opts) {
        const activity = await fetchLeagueActivity(lid, opts);
        if (activity.status !== 'fresh' && (opts?.requireComplete || !activity.hasCache)) {
            const error = new Error(activity.error);
            error.code = 'ACTIVITY_UNAVAILABLE'; error.activity = activity;
            throw error;
        }
        return activity.txns;
    }

    // Failed FAAB claims (losing bids) for a league — [] until a post-change
    // fetch repopulates the cache (old cache entries predate the field; the
    // 6h TTL heals them without a version bump).
    function getFailedWaivers(lid, season) {
        const st = store(); if (!st || !lid) return [];
        season = season || ctx().season;
        const c = st.get(KEY(lid, season), null);
        return (c && Array.isArray(c.failedWaivers)) ? c.failedWaivers : [];
    }

    // Background-populate every given league's cache (yields between leagues so a heavy
    // league can't freeze the caller; respects per-league TTL). Returns { [lid]: txns }.
    async function hydrateLeagues(leagues, opts) {
        const out = {};
        for (const l of (leagues || [])) {
            const lid = l && (l.id || l.league_id);
            if (!lid) continue;
            await new Promise(r => setTimeout(r, 0));
            try { out[lid] = await fetchLeagueTxns(lid, opts); } catch (e) { out[lid] = getCached(lid); }
        }
        return out;
    }

    // Most-recent completed trades for a league (newest first), from cache.
    function recentTrades(lid, limit) {
        return getCached(lid)
            .filter(t => t.type === 'trade')
            .sort((a, b) => (b.status_updated || b.created || 0) - (a.status_updated || a.created || 0))
            .slice(0, limit || 10);
    }

    window.WrTxns = { fetchLeagueTxns, fetchLeagueActivity, hydrateLeagues, getCached, getFailedWaivers, recentTrades };
})();
