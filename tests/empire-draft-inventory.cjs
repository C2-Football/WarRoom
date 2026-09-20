'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const app = fs.readFileSync('js/app.js', 'utf8'), view = fs.readFileSync('js/tabs/global-view.js', 'utf8');
const context = vm.createContext({ setTimeout, clearTimeout, window: { AbortController, App: {} } });
vm.runInContext(app.slice(app.indexOf('    async function fetchEmpireDraftInventory('), app.indexOf('    // A league list and its hydrated rosters')), context);
vm.runInContext(view.slice(view.indexOf('function tierColor('), view.indexOf('// Scenario math')), context);
const load = context.fetchEmpireDraftInventory;
const league = { id: 'L', name: 'Fixture', season: '2026', status: 'pre_draft', draft_id: 'D', settings: { type: 2, draft_rounds: 4 },
    rosters: [{ roster_id: 1, owner_id: 'me', players: [] }, { roster_id: 2, owner_id: 'other', players: [] }], tradedPicks: [], _pickFeedState: 'ready' };
const draft = { draft_id: 'D', league_id: 'L', season: '2026', status: 'pre_draft', type: 'snake', settings: { rounds: 4 }, slot_to_roster_id: { 1: 1, 2: 2 } };
const ok = value => ({ ok: true, json: async () => value });
const fixture = (drafts = [draft], picks = []) => { const requests = []; return { requests, fetcher: async url => { requests.push(url); return ok(url.endsWith('/drafts') ? drafts : picks); } }; };
const model = (snapshot, extra = {}) => context.buildEmpirePortfolioModel({ allLeagues: [{ ...league, ...extra, _draftInventory: snapshot.inventory, _draftInventoryState: snapshot.status }], sleeperUserId: 'me' });

test('completed drafts consume current rights even while league still says pre_draft; future dynasty rights remain', async () => {
    const ready = await load(league, fixture()); assert.equal(model(ready).pickCapital.total, 12);
    const completed = await load(league, fixture([{ ...draft, status: 'complete' }]));
    const result = model(completed); assert.equal(result.pickCapital.complete, true); assert.equal(result.pickCapital.total, 8);
    assert.equal(result.pickCapital.byYear.map(row => row.year).join(','), '2027,2028');
    const seasonal = model(completed, { settings: { type: 0, draft_rounds: 4 } });
    assert.equal(seasonal.pickCapital.total, 0); assert.equal(seasonal.pickCapital.complete, true);
    const auction = await load(league, fixture([{ ...draft, type: 'auction', status: 'complete' }]));
    assert.equal(model(auction, { settings: { type: 0 } }).pickCapital.total, 0);
});

test('in-progress drafts remove the consumed original slots, including acquired picks, rather than the picking roster', async () => {
    const snapshot = await load(league, fixture([{ ...draft, status: 'drafting' }], [
        { round: 1, draft_slot: 2, roster_id: 1, player_id: 'acquired-pick-player' },
        { round: 2, draft_slot: 1, roster_id: 2, player_id: 'own-pick-player' },
    ]));
    const result = model(snapshot, { tradedPicks: [{ season: '2026', round: 1, roster_id: 2, owner_id: 1 }] });
    assert.equal(result.pickCapital.total, 11);
    assert.equal(result.picks.filter(pick => pick.year === 2026 && pick.round === 1).length, 1);
    assert.equal(result.picks.find(pick => pick.year === 2026 && pick.round === 1).own, true);
    assert.equal(result.picks.some(pick => pick.year === 2026 && pick.round === 2), false);
    assert.equal(result.pickCapital.acquired, 0);
    const fallback = await load(league, fixture([{ ...draft, status: 'drafting', slot_to_roster_id: null, draft_order: { me: 1, other: 2 } }], [{ round: 1, draft_slot: 2, player_id: 'p' }]));
    assert.equal(fallback.inventory.consumed[0].rosterId, '2');
});

test('draft settings establish actual current rounds without changing future league rounds', async () => {
    const snapshot = await load(league, fixture([{ ...draft, settings: { rounds: 7 } }]));
    const result = model(snapshot); assert.equal(result.pickCapital.total, 15);
    assert.equal(result.pickCapital.byYear[0].count, 7);
});

test('unknown draft progress never creates current holdings and blocks complete capital claims', async () => {
    for (const drafts of [null, {}, [], [{ ...draft, season: '2025' }], [{ ...draft, status: 'unknown' }], [{ ...draft, settings: {} }], [{ ...draft, type: 'auction' }]]) {
        const snapshot = await load(league, fixture(drafts)); assert.equal(snapshot.status, 'unavailable');
        const result = model(snapshot); assert.equal(result.pickCapital.total, 8); assert.equal(result.pickCapital.complete, false);
        assert.equal(result.pickCapital.unknownDraftLeagues, 1); assert.equal(result.pickCapital.staleLeagues, 0);
        assert.equal(result.picks.some(pick => pick.year === 2026), false); assert(!result.signals.some(signal => signal.type === 'capital'));
    }
    const multiple = await load({ ...league, draft_id: null }, fixture([draft, { ...draft, draft_id: 'other' }]));
    assert.equal(multiple.status, 'unavailable', 'ambiguous multiple drafts require a primary draft ID');
});

test('unmappable, malformed, or conflicting draft picks remain unknown; exact duplicates do not consume twice', async () => {
    const pick = { round: 1, draft_slot: 1, player_id: 'p' };
    for (const picks of [null, {}, [null], [{ ...pick, draft_slot: 8 }], [{ ...pick, round: 0 }], [{ ...pick, player_id: null }], [pick, { ...pick, player_id: 'other' }]]) {
        const snapshot = await load(league, fixture([{ ...draft, status: 'drafting' }], picks)); assert.equal(snapshot.status, 'unavailable');
    }
    const deduped = await load(league, fixture([{ ...draft, status: 'drafting' }], [pick, pick]));
    assert.equal(deduped.inventory.consumed.length, 1); assert.equal(model(deduped).pickCapital.total, 11);
});

test('failed refresh retains explicit stale progress, retry consumes the draft, and a different season cannot reuse it', async () => {
    const previous = await load(league, fixture());
    const failed = await load(league, { previous, fetcher: async () => ({ ok: false }) });
    assert.equal(failed.status, 'stale'); const stale = model(failed); assert.equal(stale.pickCapital.total, 12);
    assert.equal(stale.pickCapital.complete, false); assert.equal(stale.pickCapital.staleLeagues, 1); assert(!stale.signals.some(signal => signal.type === 'capital'));
    const retried = await load(league, { previous: failed, ...fixture([{ ...draft, status: 'complete' }]) });
    assert.equal(model(retried).pickCapital.total, 8); assert.equal(model(retried).pickCapital.complete, true);
    const other = await load({ ...league, season: '2025' }, { previous, fetcher: async () => ({ ok: false }) }); assert.equal(other.inventory, undefined);
});

test('timeout and account changes cannot start a later picks read or publish verified progress', async () => {
    const timed = await load(league, { timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')))) });
    assert.equal(timed.status, 'unavailable');
    let release, current = true, requests = 0;
    const promise = load(league, { isCurrent: () => current, fetcher: () => { requests++; return new Promise(resolve => { release = () => resolve(ok([{ ...draft, status: 'drafting' }])); }); } });
    current = false; release(); assert.equal((await promise).status, 'unavailable'); assert.equal(requests, 1);
    const external = fixture(); await load({ ...league, _espn: true }, external); assert.equal(external.requests.length, 0);
});
