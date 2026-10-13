'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const app = fs.readFileSync('js/app.js', 'utf8');
const source = fs.readFileSync('js/utils/team-comparison-data.js', 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function harness() {
    const context = vm.createContext({ setTimeout, clearTimeout, window: { AbortController, App: {}, S: { untouched: true } } });
    vm.runInContext(app.slice(app.indexOf('    async function fetchEmpireTradedPicks('), app.indexOf('    // A league list and its hydrated rosters')), context);
    // Browser classic-script function declarations are window properties.
    context.window.fetchEmpireTradedPicks = context.fetchEmpireTradedPicks;
    context.window.fetchEmpireDraftInventory = context.fetchEmpireDraftInventory;
    vm.runInContext(fs.readFileSync('js/utils/team-comparison.js', 'utf8'), context);
    vm.runInContext(source, context);
    return { data: context.window.App.TeamComparisonData, helper: context.window.App.TeamComparison, context };
}
const league = { id: 'L', season: '2026', draft_id: 'D', settings: { type: 2, draft_rounds: 2 }, rosters: [{ roster_id: 1, owner_id: 'me' }, { roster_id: 2, owner_id: 'them' }] };
const draft = { draft_id: 'D', league_id: 'L', season: '2026', status: 'complete', type: 'snake', settings: { rounds: 2 }, slot_to_roster_id: { 1: 1, 2: 2 } };
const moved = { season: '2027', round: 1, roster_id: 1, owner_id: 2 };
function fixture(options = {}) {
    const requests = [];
    return { requests, fetcher: async (url, request) => {
        requests.push(url);
        if (options.wait) await options.wait;
        const ownership = url.endsWith('/traded_picks');
        if (ownership && options.ownershipFailure || !ownership && options.progressFailure) return { ok: false };
        if (options.networkFailure) throw Error('offline');
        const body = ownership ? options.picks ?? [] : url.endsWith('/drafts') ? options.drafts ?? [draft] : options.consumed ?? [];
        return { ok: true, json: async () => body };
    } };
}
const value = (helper, input, result) => helper.draftCapital({ roster: input.rosters[0], league: { ...input, ...result.context }, skin: { type: 'dynasty' }, getPickValue: () => 100 });

test('actual app classic-script declarations expose both readers on window', () => {
    const browser = vm.createContext({ App: { WR_KEYS: {}, WrStorage: {} }, location: { hostname: 'localhost', pathname: '/' }, AbortController, setTimeout, clearTimeout });
    browser.window = browser;
    vm.runInContext(app.slice(0, app.indexOf('    // A league list and its hydrated rosters')), browser);
    assert.equal(typeof browser.window.fetchEmpireTradedPicks, 'function');
    assert.equal(typeof browser.window.fetchEmpireDraftInventory, 'function');
});

test('normal league load fetches verified ownership and draft progress without mutating hydrated state', async () => {
    const { data, helper, context } = harness(), feed = fixture();
    const before = plain(league), result = await data.load(league, feed);
    assert.equal(result.ready, true); assert.equal(result.status, 'ready'); assert.equal(result.contextKey, '2026:L');
    assert.equal(result.context._pickFeedState, 'ready'); assert.equal(result.context._draftInventoryState, 'ready');
    assert.equal(result.context.tradedPicks.length, 0); assert.equal(result.context._draftInventory.phase, 'complete');
    assert.equal(feed.requests.length, 2); assert.equal(value(helper, league, result).count, 4); assert.equal(value(helper, league, result).complete, true);
    assert.deepEqual(plain(league), before); assert.deepEqual(plain(context.window.S), { untouched: true });
});

test('failed ownership never becomes zero transfers, even when provider hydration supplied []', async () => {
    const { data, helper } = harness();
    for (const failure of [{ ownershipFailure: true }, { networkFailure: true }, { picks: [null] }]) {
        data.clear();
        const result = await data.load({ ...league, tradedPicks: [] }, fixture(failure));
        assert.equal(result.ready, false); assert.equal(result.context._pickFeedState, 'unavailable');
        assert.equal(result.context.tradedPicks, undefined); assert.equal(value(helper, league, result).count, 0);
        assert.equal(value(helper, league, result).totalValue, null); assert.match(result.error, /ownership/);
    }
});

test('unverified progress retains only known future ownership and blocks full capital claims', async () => {
    const { data, helper } = harness();
    const result = await data.load(league, fixture({ progressFailure: true }));
    assert.equal(result.status, 'partial'); assert.equal(result.context._pickFeedState, 'ready'); assert.equal(result.context._draftInventoryState, 'unavailable');
    const capital = value(helper, league, result);
    assert.equal(capital.count, 4); assert.equal(capital.complete, false); assert.equal(capital.picks.some(pick => pick.year === 2026), false);
});

test('failed refresh preserves labeled last-known transfers/progress and a retry recovers', async () => {
    const { data, helper } = harness();
    const first = await data.load(league, fixture({ picks: [moved] }));
    assert.equal(value(helper, league, first).count, 3);
    const stale = await data.load(league, { ...fixture({ networkFailure: true }), force: true });
    assert.equal(stale.ready, false); assert.equal(stale.status, 'partial');
    assert.equal(stale.context._pickFeedState, 'stale'); assert.equal(stale.context._draftInventoryState, 'stale');
    assert.equal(value(helper, league, stale).count, 3); assert.equal(value(helper, league, stale).complete, false);
    const recovered = await data.load(league, fixture());
    assert.equal(recovered.ready, true); assert.equal(value(helper, league, recovered).count, 4);
});

test('fresh caching is scoped to league, season and selected draft; returned snapshots cannot mutate it', async () => {
    const { data } = harness(), feed = fixture();
    const first = await data.load(league, feed);
    first.context.tradedPicks.push(moved); first.context._draftInventory.consumed.push({ round: 1, rosterId: '1', playerId: 'mutation' });
    const cached = await data.load(league, feed);
    assert.equal(feed.requests.length, 2); assert.equal(cached.context.tradedPicks.length, 0); assert.equal(cached.context._draftInventory.consumed.length, 0);
    await data.load(league, { ...feed, force: true }); assert.equal(feed.requests.length, 4);
    const other = await data.load({ ...league, id: 'other' }, fixture({ drafts: [{ ...draft, league_id: 'other' }] }));
    assert.equal(other.contextKey, '2026:other'); assert.equal(other.ready, true);
    const nextSeason = await data.load({ ...league, season: '2027' }, fixture({ drafts: [{ ...draft, season: '2027' }] }));
    assert.equal(nextSeason.contextKey, '2027:L'); assert.equal(nextSeason.ready, true);
    const otherDraft = fixture({ drafts: [{ ...draft, draft_id: 'another' }] });
    assert.equal((await data.load({ ...league, draft_id: 'another' }, otherDraft)).ready, true); assert.equal(otherDraft.requests.length, 2);
});

test('active drafts have a short cache and filter consumed original slots through the existing helper', async () => {
    const { data, helper } = harness(); let now = 1000;
    const feed = fixture({ picks: [{ season: '2026', round: 1, roster_id: 2, owner_id: 1 }], drafts: [{ ...draft, status: 'drafting' }], consumed: [{ round: 1, draft_slot: 2, roster_id: 1, player_id: 'acquired' }] });
    const result = await data.load(league, { ...feed, now: () => now });
    assert.equal(result.ready, true); assert.equal(feed.requests.length, 3);
    assert.equal(value(helper, league, result).count, 6); assert.equal(value(helper, league, result).picks.some(pick => !pick.own), false);
    now = 15000; await data.load(league, { ...feed, now: () => now }); assert.equal(feed.requests.length, 3);
    now = 17000; await data.load(league, { ...feed, now: () => now }); assert.equal(feed.requests.length, 6);
});

test('a replacement draft in the same season cannot inherit old completed progress', async () => {
    const { data, helper } = harness();
    const replacement = { ...league, draft_id: 'D2', _draftInventoryState: 'ready',
        _draftInventory: { draftId: 'D', season: '2026', phase: 'complete', rounds: 2, consumed: [] } };
    const failedFeed = fixture({ progressFailure: true });
    const failed = await data.load(replacement, failedFeed);
    assert(failedFeed.requests.some(url => url.endsWith('/drafts')), 'selected replacement progress is requested');
    assert.equal(failed.context._draftInventoryState, 'unavailable', 'old completion is not retained as stale replacement progress');
    assert.equal(failed.context._draftInventory, undefined);
    const retry = fixture({ drafts: [{ ...draft, draft_id: 'D2', status: 'pre_draft' }] });
    const ready = await data.load(replacement, retry);
    assert.equal(ready.context._draftInventory.draftId, 'D2'); assert.equal(ready.ready, true);
    assert.equal(value(helper, replacement, ready).count, 6, 'replacement draft includes its verified unused current rights');
});

test('simultaneous consumers share reads while cancelled consumers cannot poison a current consumer', async () => {
    const { data } = harness(); let release, current = true;
    const wait = new Promise(resolve => { release = resolve; }), feed = fixture({ wait });
    const leaving = data.load(league, { ...feed, isCurrent: () => current });
    const staying = data.load(league, feed);
    assert.equal(feed.requests.length, 2); current = false; release();
    assert.equal((await leaving).status, 'cancelled'); assert.equal((await staying).ready, true);
    assert.equal((await data.load(league, feed)).ready, true); assert.equal(feed.requests.length, 2);
});

test('clearing during an in-flight read prevents stale cache publication', async () => {
    const { data } = harness(); let release;
    const wait = new Promise(resolve => { release = resolve; }), pending = data.load(league, fixture({ wait }));
    data.clear(); release(); await pending;
    const next = fixture(); await data.load(league, next); assert.equal(next.requests.length, 2);
});

test('missing readers, cancelled calls and other formats/providers cannot make wrong-provider requests', async () => {
    const { data, context } = harness(), feed = fixture();
    assert.equal((await data.load(league, { ...feed, isCurrent: () => false })).status, 'cancelled');
    for (const change of [{ _mfl: true }, { _espn: true }, { _yahoo: true }, { _platform: 'espn' }, { _source: 'yahoo' }]) assert.equal((await data.load({ ...league, ...change }, feed)).ready, false);
    for (const type of [0, 3]) assert.equal((await data.load({ ...league, settings: { type } }, feed)).status, 'disabled');
    assert.equal(feed.requests.length, 0);
    delete context.window.fetchEmpireDraftInventory;
    assert.match((await data.load(league, feed)).error, /readers/); assert.equal(feed.requests.length, 0);
});

test('keeper can load verified rights while valuation remains unpriced and timeout cannot invent ownership', async () => {
    const { data, helper } = harness();
    const keeperLeague = { ...league, settings: { ...league.settings, type: 1 } };
    const ready = await data.load(keeperLeague, fixture());
    assert.equal(ready.ready, true);
    const capital = helper.draftCapital({ roster: keeperLeague.rosters[0], league: { ...keeperLeague, ...ready.context }, skin: { type: 'keeper' }, getPickValue: () => 100 });
    assert.equal(capital.complete, true); assert.equal(capital.totalValue, null); assert.equal(capital.valued, false);
    data.clear();
    const timed = await data.load(league, { timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')))) });
    assert.equal(timed.context._pickFeedState, 'unavailable'); assert.equal(timed.context.tradedPicks, undefined);
});
