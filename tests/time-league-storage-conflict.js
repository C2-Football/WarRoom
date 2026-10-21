'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'types', 'season', 'engine', 'storage']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueStorage: Store, TimeLeagueTypes: T } = App;
const stamp = '2026-10-21T12:00:00Z';
const initial = E.normalizeTimeLeague(E.createTimeLeague({
    name: 'Two local tabs', seed: 'storage-conflict', createdAt: stamp,
    seats: [{ name: 'Home', manager: 'human' }, { name: 'Rival', manager: 'human' }],
    settings: { gameDeckVersion: 0, rosterSlots: { QB: 1, BN: 1 }, maxQuarterbacks: 2,
        regularSeasonWeeks: 2, scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 },
        eraRules: { mode: 'any-era', decades: [] }, draftPickSeconds: 0 },
}));
const disk = new Map();
let rejectIndexOnce = false;
window.localStorage = {
    getItem: key => disk.get(key) ?? null,
    setItem(key, value) {
        if (rejectIndexOnce && key === T.TIME_LEAGUE_INDEX_KEY) {
            rejectIndexOnce = false;
            throw new DOMException('Full origin shelf', 'QuotaExceededError');
        }
        disk.set(key, value);
    },
    removeItem: key => disk.delete(key),
};
const key = T.timeLeagueStorageKey(initial.leagueId), indexKey = T.TIME_LEAGUE_INDEX_KEY;
const shelf = state => [{ leagueId: state.leagueId, name: state.name, phase: state.phase, currentWeek: state.currentWeek }];
const card = (identity, name) => ({ identity, name, position: 'QB', peak: 100, seasons: [{ season: 2020, points: 100 }] });
const first = card('player:QB:first', 'First choice'), second = card('player:QB:second', 'Second choice');
const expectConflict = run => {
    const before = new Map(disk);
    assert.throws(run, { name: 'VaultSnapshotConflictError' });
    assert.deepEqual(disk, before, 'A rejected stale write changes neither the saved game nor its shelf');
};

// Both tabs open the same waiting draft. One starts it and makes a real pick;
// the stale tab must not erase that pick with its own alternative selection.
Store.writeSnapshot(initial, shelf(initial), { expectedSnapshot: null });
const tabA = disk.get(key), tabB = disk.get(key);
const running = E.startDraft(initial, stamp);
const committed = E.applyDraftPick(running, first, { madeBy: 'human', createdAt: stamp });
Store.writeSnapshot(committed, shelf(committed), { expectedSnapshot: tabA });
const staleMove = E.applyDraftPick(running, second, { madeBy: 'human', createdAt: stamp });
expectConflict(() => Store.writeSnapshot(staleMove, shelf(staleMove), { expectedSnapshot: tabB }));
assert.equal(Store.decode(disk.get(key)).draftPicks[0].identity, first.identity);

// Reloading gives the second tab the actual next seat and a fresh base token.
const refreshedToken = disk.get(key), refreshed = E.normalizeTimeLeague(Store.decode(refreshedToken));
const continued = E.applyDraftPick(refreshed, second, { madeBy: 'human', createdAt: stamp });
Store.writeSnapshot(continued, shelf(continued), { expectedSnapshot: refreshedToken });
assert.equal(Store.decode(disk.get(key)).draftPicks.length, 2);
assert.deepEqual(Store.decode(disk.get(key)).draftPicks.map(pick => pick.teamId), ['t1', 't2']);

// Deletion and a colliding creation both count as a changed base.
const beforeDeletion = disk.get(key);
disk.delete(key);
expectConflict(() => Store.writeSnapshot(continued, shelf(continued), { expectedSnapshot: beforeDeletion }));
Store.writeSnapshot(initial, shelf(initial), { expectedSnapshot: null });
expectConflict(() => Store.writeSnapshot(continued, shelf(continued), { expectedSnapshot: null }));

// An explicit invalid expectation cannot silently opt out of protection.
for (const expectedSnapshot of [undefined, {}, 0, 'broken JSON', 'null', JSON.stringify({ leagueId: 'another-season' })]) {
    expectConflict(() => Store.writeSnapshot(continued, shelf(continued), { expectedSnapshot }));
}
disk.set(key, 'damaged snapshot');
expectConflict(() => Store.writeSnapshot(continued, shelf(continued), { expectedSnapshot: 'damaged snapshot' }));

// Compression preserves the same base. Even recovery that compacts the old
// record after the first quota error must still be able to save the next move.
const large = E.normalizeTimeLeague({ ...initial, activity: [...initial.activity,
    { id: 'a2', week: 1, kind: 'league', message: 'Recovery fixture '.repeat(1500), createdAt: stamp }] });
const plain = JSON.stringify(large), compressed = Store.encode(large);
assert(compressed.startsWith('VAULT1:LZ16:'));
disk.set(key, compressed);
disk.set(indexKey, JSON.stringify(shelf(large)));
const renamed = { ...large, name: 'Reencoded base accepted' };
Store.writeSnapshot(renamed, shelf(renamed), { expectedSnapshot: plain });
assert.deepEqual(Store.decode(disk.get(key)), renamed);
disk.set(key, plain);
rejectIndexOnce = true;
Store.writeSnapshot(renamed, shelf(renamed), { expectedSnapshot: plain });
assert.equal(rejectIndexOnce, false);
assert.deepEqual(Store.decode(disk.get(key)), renamed);

// Existing callers retain their established behavior until the UI supplies a
// base token. The storage format and schema remain unchanged.
Store.writeSnapshot(initial, shelf(initial));
assert.deepEqual(Store.decode(disk.get(key)), initial);
console.log('PASS: real draft stale-tab rejection, reload continuation, deletion/create conflicts, malformed bases, reencoding, quota compaction and legacy callers.');
