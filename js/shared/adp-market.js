// ══════════════════════════════════════════════════════════════════
// js/shared/adp-market.js — window.App.getRedraftAdp / fetchRedraftAdp
//
// Real market ADP (average draft position) shown ALONGSIDE DHQ on draft
// boards — a "market says / DHQ says" companion column. Display only:
// never feeds DHQ, ROS value, or any pricing calculation.
//
// Source: MFL's public ADP export (no auth needed) —
//   https://api.myfantasyleague.com/{year}/export?TYPE=adp&JSON=1
// keyed by MFL's own numeric player id.
//
// ID bridge: rather than hand-building a name/team crosswalk, we reuse
// FantasyCalc's own redraft-values response — every row already carries
// both `player.mflId` and `player.sleeperId`. A generic call is enough
// (we only read the id pair off each row, never `value`).
//
//   fetchRedraftAdp()   → Promise<{ [sleeperId]: {adp, rank, draftsSelectedIn} }>
//     Fetches + joins the map once, caches it in localStorage for ~18h
//     (inside the 12-24h band), and re-fetches on cache miss/expiry.
//     Concurrent callers share the same in-flight promise.
//   getRedraftAdp(sid)  → {adp, rank, draftsSelectedIn} | null
//     Synchronous — null until the fetch has landed, or if MFL has no
//     ADP entry for that player.
//   Fires window.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail }))
//   once the map is ready — mirrors dhq-shared/player-value.js's
//   'wr:ros-market-loaded' pattern, so a mounted React draft board can
//   force a re-render when data lands after first paint.
//
// Kicked off eagerly (fire-and-forget) on script load so it is warm by
// the time a draft screen mounts — not lazily on first getter call.
//
// Scope note (enforced by callers, not this module): only redraft and
// chopped league types show this column. MFL's own IS_KEEPER=1 and
// IS_KEEPER=DYNASTY params return zero picks (live-verified 2026-08-10)
// — there is no real keeper/dynasty ADP signal anywhere today, so this
// module only ever fetches the default (redraft) export.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const CACHE_TTL_MS = 18 * 60 * 60 * 1000; // ~18h — inside the 12-24h band

    let _map = null;       // { [sleeperId]: {adp, rank, draftsSelectedIn} } once loaded
    let _pending = [];     // ADP rows FantasyCalc couldn't bridge, awaiting a
                           // Sleeper players map to name-join against
    let _year = null;      // year the current _map/_fetching promise is for
    let _fetching = null;  // in-flight promise, de-dupes concurrent callers

    // Same precedence the rest of the app uses to derive the active MFL
    // season (see league-skin.js buildLeagueProfile / draft-room.js /
    // league-detail.js): active league's own season first, then the global
    // window.S.season, then the locally-stored MFL connection year, then a
    // clock fallback. Never hardcoded.
    function _currentYear() {
        try {
            return String(
                root.S?.currentLeague?.season
                || root.S?.season
                || (root.localStorage && root.localStorage.getItem('mfl_year'))
                || new Date().getFullYear()
            );
        } catch (e) {
            return String(new Date().getFullYear());
        }
    }

    // v2: the cached payload gained a `pending` list when the MFL-players
    // name bridge landed. Without a key bump, anyone holding a v1 entry would
    // sit on the old FantasyCalc-only map (198 of 378) for the rest of the 18h
    // TTL — i.e. through tonight's draft.
    function _cacheKey(year) { return 'wr_adp_market_v2_' + year; }

    function _readCache(year) {
        try {
            const raw = localStorage.getItem(_cacheKey(year));
            if (!raw) return null;
            const cached = JSON.parse(raw);
            if (Date.now() - (cached._ts || 0) >= CACHE_TTL_MS) return null;
            return cached.map ? { map: cached.map, pending: cached.pending || [] } : null;
        } catch (e) {
            return null;
        }
    }

    function _writeCache(year, map, pending) {
        try {
            // Skip caching empty results — an empty map is far more likely a
            // transient fetch hiccup than "no ADP data exists"; caching it
            // would poison the cache for the full TTL window (mirrors the
            // same guard in dhq-shared/mfl-api.js buildCrosswalk).
            if (!map || !Object.keys(map).length) return;
            localStorage.setItem(_cacheKey(year), JSON.stringify({ map, pending: pending || [], _ts: Date.now() }));
        } catch (e) {}
    }

    // FantasyCalc redraft values give us a clean mflId -> sleeperId bridge
    // for free — every row carries both ids. This call is only for the id
    // bridge, not for values, so a generic shape (numQbs/numTeams/ppr) is
    // fine; it does not need to match any particular league's settings.
    async function _buildMflToSleeperBridge() {
        const url = 'https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1';
        const r = await fetch(url);
        if (!r || !r.ok) return {};
        const rows = await r.json();
        const bridge = {};
        (Array.isArray(rows) ? rows : []).forEach(d => {
            const mflId = d && d.player && d.player.mflId;
            const sid = d && d.player && d.player.sleeperId;
            if (mflId && sid) bridge[String(mflId)] = String(sid);
        });
        return bridge;
    }

    // MFL blocks cross-origin browser requests outright (no CORS headers —
    // confirmed live: 'Access-Control-Allow-Origin' pinned to MFL's own
    // www*.myfantasyleague.com host). Route through the same Supabase Edge
    // Function relay the rest of the app's MFL support already uses
    // (dhq-shared/mfl-api.js's _mflGet/_getProxyUrl) rather than a direct
    // fetch — mirrored here instead of imported so this module stays
    // self-contained (it doesn't otherwise depend on mfl-api.js).
    function _mflProxyUrl() {
        const config = root.App?.CONFIG || root.OD?.CONFIG || {};
        if (config.endpoints?.mflProxy) return config.endpoints.mflProxy;
        if (config.functionsBase) return config.functionsBase + '/mfl-proxy';
        const base = root.OD?.SUPABASE_URL || root.App?.SUPABASE_URL;
        return base ? base + '/functions/v1/mfl-proxy' : null;
    }

    // Shared MFL GET (ADP + players both go through the same relay).
    async function _mflGetJson(url) {
        const proxyUrl = _mflProxyUrl();
        const anonKey = root.App?.CONFIG?.supabaseAnon || root.OD?.CONFIG?.supabaseAnon || root.OD?.SUPABASE_ANON || root.App?.SUPABASE_ANON;
        const token = root.OD?.getSessionToken?.() || null;
        let data;
        if (proxyUrl && anonKey) {
            const r = await fetch(proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (token || anonKey),
                    'apikey': anonKey,
                },
                body: JSON.stringify({ url }),
            });
            if (!r.ok) return null;
            data = await r.json();
        } else {
            // Fallback for contexts with no Supabase config (e.g. same-origin
            // test harnesses) — a real browser hitting MFL directly still
            // fails on CORS, same as before this fix, just without a proxy.
            const r = await fetch(url);
            if (!r || !r.ok) return null;
            data = await r.json();
        }
        return data;
    }

    async function _fetchMflAdp(year) {
        const data = await _mflGetJson('https://api.myfantasyleague.com/' + year + '/export?TYPE=adp&JSON=1');
        const rows = data && data.adp && data.adp.player;
        if (Array.isArray(rows)) return rows;
        return rows ? [rows] : [];
    }

    // ── Second bridge: MFL's own player export, name-joined to Sleeper ──
    // FantasyCalc only publishes its top ~198 redraft values, but MFL's ADP
    // export carries 378 players. Bridging on FantasyCalc alone therefore
    // resolved 100% of the top 50 and only 67% by pick 180 — i.e. a third of
    // the board went blank exactly through the middle rounds of a 12x15
    // draft. MFL's players export gives id -> name/pos/team for all of them,
    // so anything FantasyCalc misses is name-matched to Sleeper instead.
    // Measured live 2026-09-06: 52% -> 99% (375/378).
    async function _fetchMflPlayers(year) {
        const rows = await _mflGetJson('https://api.myfantasyleague.com/' + year + '/export?TYPE=players&JSON=1&DETAILS=0');
        const list = rows && rows.players && rows.players.player;
        const out = {};
        (Array.isArray(list) ? list : (list ? [list] : [])).forEach(p => {
            if (p && p.id) out[String(p.id)] = p;
        });
        return out;
    }

    // Accent/suffix/punctuation-insensitive, so "Marvin Harrison Jr." and
    // "Marvin Harrison" collapse to the same key on both sides of the join.
    const _NAME_SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;
    function _normName(str) {
        let out = String(str || '');
        try { out = out.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* older engine */ }
        return out.toLowerCase().replace(_NAME_SUFFIX, '').replace(/[^a-z]/g, '');
    }
    // MFL writes "Last, First"; Sleeper writes "First Last".
    function _mflDisplayName(name) {
        const raw = String(name || '');
        if (raw.indexOf(',') === -1) return raw;
        const parts = raw.split(',');
        return (parts[1] || '').trim() + ' ' + (parts[0] || '').trim();
    }
    // MFL position codes that don't match Sleeper's.
    const _MFL_POS = { PK: 'K', TMDL: 'DEF', DEF: 'DEF' };
    // MFL team codes that don't match Sleeper's.
    const _MFL_TEAM = { NEP: 'NE', GBP: 'GB', KCC: 'KC', SFO: 'SF', TBB: 'TB', NOS: 'NO', LVR: 'LV', JAC: 'JAX' };

    function _sleeperPlayers() {
        return (root.App && root.App._playersCache) || (root.S && root.S.playersData) || null;
    }

    // Build {normName|POS -> sid} and {normName -> [sids]} off the Sleeper map.
    function _sleeperNameIndex(playersData) {
        const byNamePos = {}; const byName = {}; const defs = {};
        Object.keys(playersData || {}).forEach(pid => {
            const p = playersData[pid];
            if (!p) return;
            const pos = String(p.position || '').toUpperCase();
            if (pos === 'DEF') { defs[String(pid).toUpperCase()] = String(pid); return; }
            const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
            const n = _normName(full);
            if (!n) return;
            if (byNamePos[n + '|' + pos] == null) byNamePos[n + '|' + pos] = String(pid);
            (byName[n] = byName[n] || []).push(String(pid));
        });
        return { byNamePos, byName, defs };
    }

    // Resolve rows FantasyCalc couldn't bridge, using whatever Sleeper map is
    // loaded. Safe to call repeatedly — resolved rows are spliced out.
    function _resolvePending() {
        if (!_pending || !_pending.length) return 0;
        const playersData = _sleeperPlayers();
        if (!playersData || !Object.keys(playersData).length) return 0;
        const idx = _sleeperNameIndex(playersData);
        const still = [];
        let added = 0;
        _pending.forEach(row => {
            const pos = _MFL_POS[row.pos] || row.pos;
            let sid = null;
            if (pos === 'DEF') {
                const t = _MFL_TEAM[row.team] || row.team;
                if (t && idx.defs[t]) sid = idx.defs[t];
            } else {
                const n = _normName(_mflDisplayName(row.name));
                sid = idx.byNamePos[n + '|' + pos]
                    || ((idx.byName[n] && idx.byName[n].length === 1) ? idx.byName[n][0] : null);
            }
            if (!sid) { still.push(row); return; }
            if (!_map) _map = {};
            // Never overwrite a FantasyCalc id-pair match with a name guess.
            if (_map[sid]) return;
            _map[sid] = { adp: row.adp, rank: row.rank, draftsSelectedIn: row.draftsSelectedIn };
            added++;
        });
        _pending = still;
        if (added) {
            _writeCache(_year, _map, _pending);
            try { root.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail: { year: _year, resolved: added } })); } catch (e) { /* headless */ }
        }
        return added;
    }

    async function _buildAdpMap(year) {
        // The players export is best-effort: if it fails we still ship the
        // FantasyCalc-bridged rows rather than losing ADP entirely.
        const [bridge, adpRows, mflPlayers] = await Promise.all([
            _buildMflToSleeperBridge(),
            _fetchMflAdp(year),
            _fetchMflPlayers(year).catch(() => ({})),
        ]);
        const map = {};
        const pending = [];
        adpRows.forEach(row => {
            const mflId = row && row.id;
            const adp = Number(row && row.averagePick);
            if (mflId == null || !(adp > 0)) return;
            const entry = {
                adp,
                rank: Number(row.rank) || null,
                draftsSelectedIn: Number(row.draftsSelectedIn) || null,
            };
            const sid = bridge[String(mflId)];
            if (sid) { map[sid] = entry; return; }
            const mp = mflPlayers[String(mflId)];
            if (!mp) return;
            pending.push({
                name: mp.name, pos: String(mp.position || '').toUpperCase(),
                team: String(mp.team || '').toUpperCase(), ...entry,
            });
        });
        return { map, pending };
    }

    async function fetchRedraftAdp() {
        const year = _currentYear();

        if (_map && _year === year) return _map;
        if (_fetching && _year === year) return _fetching;

        const cached = _readCache(year);
        if (cached) {
            _map = cached.map;
            _pending = cached.pending || [];
            _year = year;
            _resolvePending();
            try { root.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail: { year, cached: true } })); } catch (e) { /* headless */ }
            return _map;
        }

        _year = year;
        _fetching = _buildAdpMap(year)
            .then(built => {
                _map = built.map;
                _pending = built.pending || [];
                _year = year;
                // Players are usually still loading at this point; whatever
                // can't resolve yet stays pending for the getter to retry.
                _resolvePending();
                _writeCache(year, _map, _pending);
                try { root.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail: { year, cached: false } })); } catch (e) { /* headless */ }
                return _map;
            })
            .catch(() => {
                // Leave _map as-is (null or a prior year's map) so getRedraftAdp
                // fails closed to "not loaded" rather than caching a failure.
                return _map || {};
            })
            .finally(() => { _fetching = null; });
        return _fetching;
    }

    // Synchronous getter for React render paths — never blocks, never
    // triggers a fetch itself. Returns null until the map has landed, or
    // when MFL simply has no ADP entry for this player.
    function getRedraftAdp(sid) {
        if (sid == null) return null;
        // The name-join needs the Sleeper players map, which loads after this
        // module warms itself. Drain any backlog the first time a render path
        // asks for a value once that map exists — cheap no-op when empty.
        if (_pending && _pending.length) _resolvePending();
        if (!_map) return null;
        return _map[String(sid)] || null;
    }

    App.fetchRedraftAdp = fetchRedraftAdp;
    App.getRedraftAdp = getRedraftAdp;

    // Warm the cache eagerly (fire-and-forget) so it's ready by the time a
    // draft screen mounts, rather than lazily on first getter call. Guarded
    // to real browser contexts so a Node `require()` of this module (e.g.
    // future unit tests) never fires a live network call as a side effect.
    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        fetchRedraftAdp().catch(() => {});
    }

    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = { fetchRedraftAdp, getRedraftAdp };
})(typeof window !== 'undefined' ? window : globalThis);
