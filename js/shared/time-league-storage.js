/* global module, require */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const PREFIX = 'VAULT1:LZ16:';
    const codec = () => typeof module !== 'undefined' && module.exports ? require('../duat/vendor/lz-string-1.5.0.js') : root.LZString;
    const checksum = value => {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
        return (hash >>> 0).toString(16);
    };
    function encode(state) {
        const json = JSON.stringify(state);
        // Keep tiny setup saves readable; completed weeks repeat enough player
        // and scoring fields to benefit considerably from lossless compression.
        if (json.length < 16384 || !codec()) return json;
        const packed = PREFIX + checksum(json) + ':' + codec().compressToUTF16(json);
        return packed.length < json.length ? packed : json;
    }
    function decode(raw) {
        if (raw === null || !raw.startsWith(PREFIX)) return JSON.parse(raw);
        const boundary = raw.indexOf(':', PREFIX.length);
        if (boundary < 0 || !codec()) throw new Error('The saved Vault season could not be read.');
        const json = codec().decompressFromUTF16(raw.slice(boundary + 1));
        if (typeof json !== 'string' || checksum(json) !== raw.slice(PREFIX.length, boundary)) throw new Error('The saved Vault season is damaged.');
        return JSON.parse(json);
    }
    const isQuota = error => error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error?.code === 22 || error?.code === 1014;
    function snapshotMatches(expected, current, leagueId) {
        if (expected === null) return current === null;
        if (typeof expected !== 'string' || typeof current !== 'string') return false;
        try {
            const before = decode(expected), saved = decode(current);
            // Encoding can change during quota recovery without changing the
            // game. Compare the actual snapshot, never only a timestamp or phase.
            return before && saved && typeof before === 'object' && typeof saved === 'object'
                && before.leagueId === leagueId && saved.leagueId === leagueId
                && JSON.stringify(before) === JSON.stringify(saved);
        } catch { return false; }
    }
    function writeSnapshot(state, entries, options = {}) {
        const db = root.localStorage, types = App.TimeLeagueTypes;
        const key = types.timeLeagueStorageKey(state.leagueId), indexKey = types.TIME_LEAGUE_INDEX_KEY;
        const packed = encode(state), shelf = JSON.stringify(entries);
        const save = () => {
            // Callers that retain the raw snapshot they opened can reject a
            // stale tab before either durable record changes. This synchronous
            // optimistic check is not a cross-tab transaction or a server lock.
            if (Object.prototype.hasOwnProperty.call(options, 'expectedSnapshot')
                && !snapshotMatches(options.expectedSnapshot, db.getItem(key), state.leagueId)) {
                const conflict = new Error('This season changed in another tab. Reload its saved progress before making another move.');
                conflict.name = 'VaultSnapshotConflictError';
                throw conflict;
            }
            const previousIndex = db.getItem(indexKey);
            // The game is authoritative and is replaced last, atomically.
            // A failed write cannot replace it with a partly saved season.
            db.setItem(indexKey, shelf);
            try { db.setItem(key, packed); }
            catch (error) {
                try {
                    if (previousIndex === null) db.removeItem(indexKey);
                    else db.setItem(indexKey, previousIndex);
                } catch { /* The previous game itself remains untouched. */ }
                throw error;
            }
        };
        try { save(); }
        catch (error) {
            if (!isQuota(error)) throw error;
            // A full origin can reject even the small index write before the
            // compact new game gets a chance to free room. Compact this game's
            // existing record first, preserving every byte of its decoded JSON.
            // Do not evict other games, preferences, or unrelated app storage.
            const before = db.getItem(key);
            if (!before) throw error;
            const oldState = decode(before);
            if (oldState?.leagueId !== state.leagueId || !App.TimeLeagueEngine.normalizeTimeLeague(oldState)) throw error;
            const compact = encode(oldState);
            if (compact.length >= before.length) throw error;
            db.setItem(key, compact);
            save();
        }
        return packed;
    }
    const api = { encode, decode, writeSnapshot };
    App.TimeLeagueStorage = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
