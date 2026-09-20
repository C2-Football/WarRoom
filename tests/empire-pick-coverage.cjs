'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const app = fs.readFileSync('js/app.js', 'utf8');
const view = fs.readFileSync('js/tabs/global-view.js', 'utf8');
const context = vm.createContext({ setTimeout, clearTimeout, window: { AbortController, App: {} } });
vm.runInContext(app.slice(app.indexOf('    async function fetchEmpireTradedPicks('), app.indexOf('    // A league list and its hydrated rosters')), context);
vm.runInContext(view.slice(view.indexOf('function tierColor('), view.indexOf('// Scenario math')), context);
vm.runInContext(view.slice(view.indexOf('function buildCommandBridge('), view.indexOf("if (typeof window !== 'undefined')", view.indexOf('function buildCommandBridge('))), context);
const load = context.fetchEmpireTradedPicks;
const league = { id: 'L1', name: 'Alpha', season: '2026', _draftInventory: { season: '2026', phase: 'pre_draft', rounds: 4, consumed: [] }, _draftInventoryState: 'ready', settings: { type: 2, draft_rounds: 4 }, rosters: [{ roster_id: 1, owner_id: 'me', players: [] }, { roster_id: 2, owner_id: 'them', players: [] }] };
const transfer = { season: '2026', round: 1, roster_id: 1, owner_id: 2 };
const reply = body => async () => ({ ok: true, json: async () => body });
const model = leagues => context.buildEmpirePortfolioModel({ allLeagues: leagues, sleeperUserId: 'me', playersData: {} });
const materialize = (snapshot, input = league) => ({ ...input, tradedPicks: snapshot.picks, _pickFeedState: snapshot.status });

test('HTTP, network and malformed pick failures cannot become verified zero transfers or own-pick capital', async () => {
    for (const fetcher of [async () => ({ ok: false }), async () => { throw Error('offline'); }, ...[null, {}, [null], [{ ...transfer, owner_id: null }], [{ ...transfer, season: '' }]].map(reply)]) {
        const snapshot = await load(league, { fetcher });
        assert.equal(snapshot.status, 'unavailable');
        assert.equal(snapshot.picks, undefined);
        const portfolio = model([materialize(snapshot)]);
        assert.equal(portfolio.picks.length, 0, 'do not invent original picks still being owned');
        assert.equal(portfolio.pickCapital.complete, false);
        assert.equal(portfolio.signals.some(signal => signal.type === 'capital'), false);
        assert.equal(portfolio.dataQuality.items.find(item => item.key === 'picks').status, 'degraded');
        assert.equal(context.buildCommandBridge({ model: portfolio }).kpis.find(item => item.key === 'picks').value, '—');
    }
});

test('a verified empty feed proves own-pick holdings; transferred picks use normalized owners', async () => {
    const empty = await load(league, { fetcher: reply([]) });
    assert.equal(empty.status, 'ready');
    assert.equal(model([materialize(empty)]).pickCapital.total, 12);
    let called = false;
    const moved = await load(league, { fetcher: reply([{ ...transfer, owner_id: 'them' }]), normalize: (rosters, rows) => {
        assert.equal(rosters, league.rosters); called = true; return rows.map(row => ({ ...row, owner_id: 2 }));
    } });
    assert(called);
    assert.equal(moved.picks[0].league_id, 'L1');
    const portfolio = model([materialize(moved)]);
    assert.equal(portfolio.pickCapital.complete, true);
    assert.equal(portfolio.pickCapital.total, 11);
    assert.equal(portfolio.picks.some(pick => pick.year === 2026 && pick.round === 1 && pick.own), false);
});

test('failed refresh keeps labeled prior good ownership; retry replaces it; other seasons cannot reuse it', async () => {
    const prior = await load(league, { fetcher: reply([transfer]) });
    const failed = await load(league, { previous: prior, fetcher: async () => ({ ok: false }) });
    assert.equal(failed.status, 'stale');
    const portfolio = model([materialize(failed)]);
    assert.equal(portfolio.pickCapital.total, 11);
    assert.equal(portfolio.pickCapital.staleLeagues, 1);
    assert.equal(portfolio.pickCapital.complete, false);
    assert.equal(portfolio.signals.some(signal => signal.type === 'capital'), false);
    const recovered = await load(league, { previous: failed, fetcher: reply([]) });
    assert.equal(recovered.status, 'ready');
    assert.equal(model([materialize(recovered)]).pickCapital.total, 12);
    const other = await load({ ...league, season: '2025' }, { previous: prior, fetcher: async () => ({ ok: false }) });
    assert.equal(other.status, 'unavailable');
    assert.equal(other.picks, undefined);
});

test('duplicate rows cannot inflate acquired picks; conflicting owners fail rather than guessing', async () => {
    const acquired = { ...transfer, roster_id: 2, owner_id: 1 };
    const snapshot = await load(league, { fetcher: reply([acquired, acquired]) });
    assert.equal(snapshot.picks.length, 1);
    assert.equal(model([materialize(snapshot)]).pickCapital.acquired, 1);
    const conflicted = await load(league, { fetcher: reply([transfer, { ...transfer, owner_id: 1 }]) });
    assert.equal(conflicted.status, 'unavailable');
});

test('partial pick coverage excludes unknown holdings and cannot generate full-portfolio capital claims', async () => {
    const ready = await load(league, { fetcher: reply([]) });
    const partial = model([materialize(ready), { ...league, id: 'L2', tradedPicks: undefined, _pickFeedState: 'unavailable' }]);
    assert.equal(partial.pickCapital.total, 12);
    assert.equal(partial.pickCapital.verifiedLeagues, 1);
    assert.equal(partial.pickCapital.complete, false);
    assert.equal(partial.signals.some(signal => signal.type === 'capital'), false);
    const complete = model([materialize(ready), materialize(ready, { ...league, id: 'L2' })]);
    assert.equal(complete.pickCapital.total, 24);
    assert.equal(complete.pickCapital.complete, true);
    assert.equal(complete.signals.some(signal => signal.type === 'capital'), true);
});

test('a slow provider times out and non-Sleeper connections never query the wrong provider', async () => {
    const slow = await load(league, { timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')))) });
    assert.equal(slow.status, 'unavailable');
    for (const provider of [{ _espn: true }, { _mfl: true }]) {
        const result = await load({ ...league, ...provider }, { fetcher: () => { throw Error('should not be called'); } });
        assert.equal(result.status, 'unavailable');
        assert.match(result.error, /connection/);
    }
});

test('actual Empire hydration retains snapshots when roster refresh creates new league objects', async () => {
    const hydration = vm.createContext({ window: { App: {}, S: {} }, sleeperUser: { user_id: 'me' }, empirePickSnapshotsRef: { current: new Map() }, setEmpireAssessReady() {},
        fetchEmpireDraftInventory: async () => ({ inventory: league._draftInventory, status: 'ready' }),
        fetchEmpireTradedPicks: (input, options) => load(input, { ...options, fetcher: reply([transfer]) }) });
    vm.runInContext(app.slice(app.indexOf('    function accountSessionCurrent('), app.indexOf('    // Resume is account history')), hydration);
    vm.runInContext(app.slice(app.indexOf('        async function populateEmpireWindowState('), app.indexOf('        // Per-league health/tier assessment')), hydration);
    const old = { ...league };
    await hydration.populateEmpireWindowState([old]);
    assert.equal(old._pickFeedState, 'ready');
    hydration.fetchEmpireTradedPicks = (input, options) => load(input, { ...options, fetcher: async () => ({ ok: false }) });
    const freshRoster = { ...league };
    await hydration.populateEmpireWindowState([freshRoster]);
    assert.equal(freshRoster._pickFeedState, 'stale');
    assert.equal(freshRoster.tradedPicks[0].owner_id, 2);
    assert.equal(hydration.window.S.tradedPicks.length, 1);
});
