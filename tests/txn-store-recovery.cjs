'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/shared/txn-store.js', 'utf8');
const NOW = Date.UTC(2026, 9, 12), KEY = 'dhq_txns_L1_2026';
function fixture() {
    const records = new Map();
    let calls = [], failedWeek = null, invalidWeek = null, txnWeek = 1;
    const move = { type: 'waiver', status: 'complete', created: NOW - 3600000, roster_ids: [1] };
    const losingBid = { type: 'waiver', status: 'failed', created: NOW - 1800000, roster_ids: [2], settings: { waiver_bid: 12 } };
    const window = { S: { nflState: { season: '2026', season_type: 'regular', week: 3 } }, App: { DhqStorage: {
        get: (key, fallback) => records.has(key) ? JSON.parse(records.get(key)) : fallback,
        set: (key, value) => { records.set(key, JSON.stringify(value)); return true; },
    } }, fetchTransactions: (lid, week) => {
        calls.push(week);
        if (week === failedWeek) throw Error('Provider read failed');
        if (week === invalidWeek) return null;
        return Promise.resolve(week === txnWeek ? [move, losingBid] : []);
    } };
    class Clock extends Date { static now() { return NOW; } }
    vm.runInNewContext(source, { window, Date: Clock, setTimeout });
    return { api: window.WrTxns, window, records, move, losingBid,
        get calls() { return calls; }, resetCalls: () => { calls = []; },
        fail: week => { failedWeek = week; }, invalid: week => { invalidWeek = week; }, empty: () => { txnWeek = -1; } };
}
const names = [];
async function test(name, fn) { await fn(); names.push(name); console.log('PASS ' + name); }
(async () => {
    await test('partial weekly failure never caches an incomplete list; retry reads every week', async () => {
        const f = fixture(); f.fail(2);
        const failed = await f.api.fetchLeagueActivity('L1');
        assert.equal(failed.status, 'unavailable'); assert.equal(failed.hasCache, false);
        assert.equal(JSON.stringify(failed.failedWeeks), '[2]'); assert.equal(f.records.size, 0);
        await assert.rejects(f.api.fetchLeagueTxns('L1'), { code: 'ACTIVITY_UNAVAILABLE' });
        f.fail(null); f.resetCalls(); const retried = await f.api.fetchLeagueActivity('L1');
        assert.equal(retried.status, 'fresh'); assert.equal(retried.txns.length, 1);
        assert.equal(retried.failedWaivers.length, 1, 'losing bids remain separate activity evidence');
        assert.equal(JSON.stringify(f.calls), '[0,1,2,3]');
        const row = JSON.parse(f.records.get(KEY)); assert.equal(row.complete, true); assert.equal(row.maxWeek, 3);
        f.resetCalls(); assert.equal((await f.api.fetchLeagueTxns('L1')).length, 1); assert.equal(f.calls.length, 0);
    });
    await test('failed refresh preserves prior cache and metadata instead of recording false freshness', async () => {
        const f = fixture(); await f.api.fetchLeagueActivity('L1'); const before = f.records.get(KEY);
        f.fail(1); const stale = await f.api.fetchLeagueActivity('L1', { force: true });
        assert.equal(stale.status, 'stale'); assert.equal(stale.fetchedAt, NOW);
        assert.equal(stale.txns[0].created, f.move.created); assert.equal(stale.failedWaivers.length, 1);
        assert.equal(f.records.get(KEY), before);
        f.resetCalls(); assert.equal((await f.api.fetchLeagueActivity('L1')).status, 'stale');
        assert(f.calls.length > 0, 'a known failed refresh must not revive the old cache as fresh');
        assert.equal((await f.api.fetchLeagueTxns('L1', { force: true }))[0].created, f.move.created, 'legacy history API keeps its array fallback');
        await assert.rejects(f.api.fetchLeagueTxns('L1', { force: true, requireComplete: true }), { code: 'ACTIVITY_UNAVAILABLE' });
        f.fail(null); assert.equal((await f.api.fetchLeagueActivity('L1', { force: true })).status, 'fresh');
    });
    await test('a successful empty season is fresh; an invalid response is unavailable', async () => {
        const f = fixture(); f.empty(); const result = await f.api.fetchLeagueActivity('L1');
        assert.equal(result.status, 'fresh'); assert.equal(result.txns.length, 0);
        assert.equal((await f.api.fetchLeagueTxns('L1', { requireComplete: true })).length, 0);
        const bad = fixture(); bad.invalid(3);
        assert.equal((await bad.api.fetchLeagueActivity('L1')).status, 'unavailable');
        assert.equal(bad.records.size, 0);
    });
    await test('legacy cache cannot establish complete activity and remains preserved on failure', async () => {
        const f = fixture(), legacy = JSON.stringify({ ts: NOW, season: '2026', txns: [] });
        f.records.set(KEY, legacy); f.fail(2);
        assert.equal((await f.api.fetchLeagueActivity('L1')).status, 'stale'); assert(f.calls.length > 0);
        assert.equal(f.records.get(KEY), legacy);
        f.fail(null); assert.equal((await f.api.fetchLeagueActivity('L1')).status, 'fresh');
    });
    await test('a new NFL week extends coverage even when the previous cache is inside its TTL', async () => {
        const f = fixture(); await f.api.fetchLeagueActivity('L1'); f.resetCalls(); f.window.S.nflState.week = 4;
        await f.api.fetchLeagueActivity('L1'); assert(f.calls.includes(4));
        assert.equal(JSON.parse(f.records.get(KEY)).maxWeek, 4);
    });
    await test('missing fetcher is explicit unavailable data, with stale history available only as fallback', async () => {
        const f = fixture(); delete f.window.fetchTransactions;
        assert.equal((await f.api.fetchLeagueActivity('L1')).status, 'unavailable');
        await assert.rejects(f.api.fetchLeagueTxns('L1'), { code: 'ACTIVITY_UNAVAILABLE' });
        f.records.set(KEY, JSON.stringify({ ts: NOW - 7 * 3600000, txns: [f.move] }));
        assert.equal((await f.api.fetchLeagueActivity('L1')).status, 'stale');
        assert.equal((await f.api.fetchLeagueTxns('L1')).length, 1);
    });
    console.log(names.length + ' transaction activity recovery groups passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
