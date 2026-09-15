// Completed Sleeper seasons are public historical evidence. Keep them on this
// device; never persist active-season scores here. Storage denial is non-fatal.
(function (root) {
    'use strict';
    let opening;
    function database() {
        if (!root.indexedDB) return Promise.resolve(null);
        if (opening) return opening;
        opening = new Promise(resolve => {
            let done = false;
            const finish = db => { if (done) { db?.close(); return; } done = true; clearTimeout(timer); resolve(db); };
            const timer = setTimeout(() => finish(null), 1500);
            try {
                const request = root.indexedDB.open('wr-wire-archive', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('seasons', { keyPath: 'id' });
                request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = null; }; finish(request.result); };
                request.onerror = request.onblocked = () => finish(null);
            } catch (_) { finish(null); }
        });
        return opening;
    }
    async function read(id) {
        const db = await database();
        if (!db) return null;
        return new Promise(resolve => {
            try {
                const request = db.transaction('seasons').objectStore('seasons').get(String(id));
                request.onsuccess = () => resolve(request.result?.version === 1 ? request.result.season : null);
                request.onerror = () => resolve(null);
            } catch (_) { resolve(null); }
        });
    }
    function compact(season) {
        const league = season.league;
        return { league: { ...league,
            rosters: league.rosters.map(r => ({ roster_id: r.roster_id, owner_id: r.owner_id })),
            users: league.users.map(u => ({ user_id: u.user_id, display_name: u.display_name, username: u.username, avatar: u.avatar, metadata: { team_name: u.metadata?.team_name } })),
        }, weeks: season.weeks.map(w => ({ week: w.week, rows: w.rows.map(r => ({ roster_id: r.roster_id, matchup_id: r.matchup_id, points: r.points, custom_points: r.custom_points,
            starters: r.starters || [], players_points: Object.fromEntries((r.starters || []).filter(pid => typeof r.players_points?.[pid] === 'number').map(pid => [pid, r.players_points[pid]])),
        })) })) };
    }
    async function write(season) {
        if (season?.league?.status !== 'complete') return false;
        const db = await database();
        if (!db) return false;
        return new Promise(resolve => {
            try {
                const tx = db.transaction('seasons', 'readwrite'), store = tx.objectStore('seasons');
                store.put({ id: String(season.league.league_id), version: 1, savedAt: Date.now(), season: compact(season) });
                // A bounded device cache. Old entries can always be fetched again.
                const request = store.getAll();
                request.onsuccess = () => request.result.sort((a, b) => b.savedAt - a.savedAt).slice(100).forEach(s => store.delete(s.id));
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => resolve(false);
            } catch (_) { resolve(false); }
        });
    }
    root.WrWireArchiveCache = { read, write };
})(typeof window !== 'undefined' ? window : globalThis);
