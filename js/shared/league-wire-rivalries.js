// Personal rivalry selections use verified owners within a linked league.
(function (root) {
    'use strict';
    const key = league => 'wire_rivalries_v1:' + encodeURIComponent(league.league_id || league.id);
    const pairKey = owners => owners.map(String).sort().join(':');
    function clean(rows) {
        if (!Array.isArray(rows)) return [];
        const seen = new Set();
        return rows.filter(r => r && Array.isArray(r.owners) && r.owners.length === 2 && r.owners.every(o => typeof o === 'string' && o.length > 0) && r.owners[0] !== r.owners[1])
            .map(r => ({ owners: r.owners.slice().sort(), name: typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '' }))
            .filter(r => { const id = pairKey(r.owners); if (seen.has(id)) return false; seen.add(id); return true; }).slice(0, 50);
    }
    function list(league, priorSeasons = []) {
        if (!(league?.league_id || league?.id)) return [];
        const storage = root.App?.AccountStorage;
        // Only follow provider-linked season IDs, never matching league names.
        const linked = new Map(priorSeasons.map(s => [String(s.league.league_id || s.league.id), s.league]));
        let current = league;
        const seen = new Set();
        while (current && !seen.has(String(current.league_id || current.id))) {
            seen.add(String(current.league_id || current.id));
            const saved = storage?.get(key(current), null);
            if (saved?.version === 1 && Array.isArray(saved.pairs)) return clean(saved.pairs);
            const previous = current.previous_league_id;
            current = previous ? linked.get(String(previous)) || (seen.has(String(previous)) ? null : { league_id: previous }) : null;
        }
        return [];
    }
    function save(league, pairs) {
        if (!(league?.league_id || league?.id)) throw Error('Choose a league first.');
        const value = { version: 1, pairs: clean(pairs) };
        if (root.App?.AccountStorage?.set(key(league), value) !== true) throw Error('Your rivalries could not be saved. Check that you’re signed in and browser storage is available, then try again.');
        root.dispatchEvent?.(new root.CustomEvent('wr:wire-rivalries-changed'));
        return value.pairs;
    }
    function set(league, owners, name, priorSeasons = []) {
        const eligible = new Set((league.rosters || []).map(r => String(r.owner_id || '')).filter(Boolean));
        if (!Array.isArray(owners) || owners.length !== 2 || owners.some(o => !eligible.has(String(o))) || String(owners[0]) === String(owners[1])) throw Error('Choose two different teams with current managers.');
        const id = pairKey(owners), rows = list(league, priorSeasons).filter(r => pairKey(r.owners) !== id);
        if (rows.length >= 50) throw Error('Remove a rivalry before adding another.');
        return save(league, rows.concat({ owners: owners.map(String), name }));
    }
    const remove = (league, owners, priorSeasons = []) => save(league, list(league, priorSeasons).filter(r => pairKey(r.owners) !== pairKey(owners)));
    root.WrWireRivalries = { list, set, remove, pairKey };
})(typeof window !== 'undefined' ? window : globalThis);
