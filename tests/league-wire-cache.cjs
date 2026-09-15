'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const disk = new Map();
const row = (rid, points) => ({ roster_id: rid, points, matchup_id: 1, starters: ['p'], players_points: { p: 5, bench: 8 } });
const older = { league_id: 'old', season: '2025', status: 'complete', previous_league_id: null, settings: { playoff_week_start: 2 }, rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }], users: [{ user_id: 'a', display_name: 'A' }] };
const current = { league_id: 'current', season: '2026' };
let calls = [];
const fetcher = async url => { calls.push(url); const path = url.split('/league/')[1]; const body = { current: { ...current, previous_league_id: 'old' }, old: older, 'old/rosters': older.rosters, 'old/users': older.users, 'old/matchups/1': [row(1, 20), row(2, 10)] }[path]; return { ok: !!body, json: async () => body }; };
function runtime(store = disk) {
    const root = { console, setTimeout, clearTimeout, AbortController, fetch: fetcher, WrWireArchiveCache: { read: async id => structuredClone(store.get(id)), write: async s => { if (s.league.status === 'complete') store.set(s.league.league_id, structuredClone(s)); } } };
    root.window = root; vm.createContext(root);
    for (const file of ['league-live-scores', 'league-live-table', 'league-wire-journal']) vm.runInContext(fs.readFileSync(`js/shared/${file}.js`, 'utf8'), root);
    return root;
}
(async () => {
    const first = await runtime().WrWireStories.loadArchive({ league: current, fetcher });
    assert(first.complete); assert(disk.has('old')); assert.equal(calls.length, 5);
    calls = [];
    const reopened = await runtime().WrWireStories.loadArchive({ league: current, fetcher });
    assert(reopened.complete); assert.equal(calls.length, 1, 'new browser context fetches only current lineage; no historical endpoints');
    assert.equal(reopened.seasons[0].weeks[0].rows[0].points, 20);
    calls = [];
    await runtime().WrWireStories.loadArchive({ league: current, fetcher, force: true });
    assert.equal(calls.length, 5, 'explicit recheck bypasses historical cache');
    const corrupt = new Map([['old', { ...first.seasons[0], weeks: [{ week: 1, rows: [row(1, 999)] }] }]]);
    calls = [];
    const recovered = await runtime(corrupt).WrWireStories.loadArchive({ league: current, fetcher });
    assert.equal(calls.length, 5); assert.equal(recovered.seasons[0].weeks[0].rows[0].points, 20, 'incomplete stored scores are fetched again');
    const wrong = new Map([['old', { ...first.seasons[0], league: { ...older, league_id: 'other' } }]]);
    calls = []; await runtime(wrong).WrWireStories.loadArchive({ league: current, fetcher }); assert.equal(calls.length, 5, 'cache identity checked');
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(runtime().WrWireStories.loadArchive({ league: current, signal: aborted.signal, fetcher }), /interrupted/);
    // Exercise storage adapter denial and compaction through its public methods.
    const storage = { setTimeout, clearTimeout, indexedDB: { open() { throw Error('denied'); } } }; storage.window = storage; vm.createContext(storage);
    vm.runInContext(fs.readFileSync('js/shared/league-wire-cache.js', 'utf8'), storage);
    assert.equal(await storage.WrWireArchiveCache.read('old'), null);
    assert.equal(await storage.WrWireArchiveCache.write(first.seasons[0]), false);
    console.log('PASS Wire persistent archive: reload reuse, manual recheck, corrupt and wrong-league cache recovery, cancellation and storage denial');
})().catch(error => { console.error(error); process.exitCode = 1; });
