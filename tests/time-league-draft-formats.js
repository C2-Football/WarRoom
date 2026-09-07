'use strict';
const assert = require('assert');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'ai', 'actions']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueAI: AI, TimeLeagueActions: A } = App;
const stamp = ms => new Date(Date.UTC(2026, 8, 7) + ms).toISOString();
const settings = { rosterSlots: { QB: 1, RB: 1, BN: 1 }, maxQuarterbacks: 2, scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 }, regularSeasonWeeks: 12, eraRules: { mode: 'any-era', decades: [] }, waiversEnabled: true, tradesEnabled: true };
function league(patch = {}, managers = ['human', 'ai', 'human']) {
    return E.normalizeTimeLeague(E.createTimeLeague({ name: 'Clock test', seed: 'clock-a', createdAt: stamp(0), settings: { ...settings, ...patch }, seats: managers.map((manager, i) => ({ name: `Team ${i + 1}`, manager, aiPersona: i % 2 ? 'warlord' : 'steward' })) }));
}
const cards = new Map(['QB', 'RB'].flatMap(position => Array.from({ length: 15 }, (_, i) => ({ identity: `${position}${i}`, name: `${position} ${i}`, position, peak: 100 + i * 10, seasons: [{ season: 2010, points: 100 + i * 10, games: 16 }] }))).map(c => [c.identity, c]));
const host = { seat_team_id: 't1', role: 'commissioner' };
const friend = { seat_team_id: 't3', role: 'member' };
const action = (state, a, time, member = host) => A.applyOnlineAction(state, a, member, { cards }, stamp(time));
let count = 0;
function test(name, fn) { fn(); count++; console.log(`ok ${name}`); }

test('new leagues default to snake, sixty seconds, and an unstarted clock', () => {
    const s = league();
    assert.equal(s.settings.draftFormat, 'snake'); assert.equal(s.settings.draftPickSeconds, 60);
    assert.equal(s.draftClock.status, 'waiting'); assert.equal(s.draftClock.deadlineAt, null);
    assert.strictEqual(E.expireDraftClock(s, cards, stamp(900000)), s);
    assert.throws(() => action(s, { type: 'draft', identity: 'QB0' }, 0), /started/);
});
test('snake reverses even rounds while linear preserves seat order', () => {
    assert.deepEqual(league().draftOrder.slice(3, 6).map(p => p.teamId), ['t3', 't2', 't1']);
    assert.deepEqual(league({ draftFormat: 'linear' }).draftOrder.slice(3, 6).map(p => p.teamId), ['t1', 't2', 't3']);
});
test('new missing era rules choose sealed Position Roulette without log spoilers', () => {
    const s = league({ eraRules: undefined });
    assert.equal(s.settings.eraRules.mode, 'position-roulette');
    assert(!s.activity.some(a => /QB 20|RB 19|RB 20/.test(a.message)));
});
test('legacy saves load with no timer and retain any-era fallback', () => {
    const old = league(); delete old.draftClock; delete old.draftAuction;
    delete old.settings.draftPickSeconds; delete old.settings.eraRules;
    const restored = E.normalizeTimeLeague(old);
    assert.equal(restored.settings.draftPickSeconds, 0); assert.equal(restored.draftClock.deadlineAt, null);
    assert.equal(restored.settings.eraRules.mode, 'any-era');
});
test('clock starts only on explicit start, and pause preserves remaining time', () => {
    let s = E.startDraft(league(), stamp(100000));
    assert.equal(s.draftClock.deadlineAt, stamp(160000));
    s = E.pauseDraft(s, stamp(120000)); assert.equal(s.draftClock.remainingMs, 40000);
    assert.equal(s.draftClock.deadlineAt, null);
    const saved = E.normalizeTimeLeague(JSON.parse(JSON.stringify(s)));
    s = E.resumeDraft(saved, stamp(900000)); assert.equal(s.draftClock.deadlineAt, stamp(940000));
});
test('timer and AI pace update while unsupported settings are rejected', () => {
    let s = E.startDraft(league(), stamp(0));
    s = E.configureDraft(s, { draftPickSeconds: 15, draftAiSeconds: 8 }, stamp(1000));
    assert.equal(s.draftClock.deadlineAt, stamp(16000)); assert.equal(s.settings.draftAiSeconds, 8);
    assert.strictEqual(E.configureDraft(s, { draftPickSeconds: 7 }, stamp(0)), s);
    assert.throws(() => action(s, { type: 'draft-clock-pause' }, 2000, friend), /commissioner/);
});
test('an expired pick uses the first legal queue entry and advances once', () => {
    let s = E.startDraft(league(), stamp(0));
    s = { ...s, teams: s.teams.map(t => t.teamId === 't1' ? { ...t, queue: ['missing', 'QB3', 'QB1'] } : t) };
    assert.strictEqual(E.expireDraftClock(s, cards, stamp(59999)), s);
    s = E.expireDraftClock(s, cards, stamp(60000));
    assert.equal(s.draftPicks[0].identity, 'QB3'); assert.equal(s.draftClock.deadlineAt, stamp(120000));
    assert.strictEqual(E.expireDraftClock(s, cards, stamp(60000)), s);
});
test('forged premature timeout and post-deadline pick cannot bypass the clock', () => {
    const s = E.startDraft(league(), stamp(0));
    assert.throws(() => action(s, { type: 'draft-timeout' }, 59999, friend), /legal/);
    assert.throws(() => action(s, { type: 'draft', identity: 'QB0' }, 60000), /expired/);
    assert.equal(action(s, { type: 'draft-timeout' }, 60000, friend).draftPicks.length, 1);
});
test('regular AI automation works from a member but only after the configured pace', () => {
    let s = E.startDraft(league(), stamp(0)); s = action(s, { type: 'draft', identity: 'QB0' }, 1000);
    assert.throws(() => action(s, { type: 'draft-ai-step' }, 2999, friend), /not due/);
    s = action(s, { type: 'draft-ai-step' }, 3000, friend);
    assert.equal(s.draftPicks[1].teamId, 't2');
    assert.throws(() => action(s, { type: 'draft-ai-step' }, 6000, friend), /human/);
});
test('auction nominations follow seats, bids may come from other teams', () => {
    let s = E.startDraft(league({ draftFormat: 'auction' }), stamp(0));
    assert.strictEqual(E.nominateAuctionPlayer(s, 't2', cards.get('RB0'), 1, stamp(0)), s);
    s = E.nominateAuctionPlayer(s, 't1', cards.get('RB0'), 1, stamp(0));
    assert.equal(s.draftAuction.nomination.highTeamId, 't1');
    s = E.bidAuctionPlayer(s, 't3', 10, stamp(10000), cards);
    assert.equal(s.draftAuction.nomination.highBid, 10); assert.equal(s.draftClock.deadlineAt, stamp(70000));
    assert.strictEqual(E.bidAuctionPlayer(s, 't1', 9, stamp(11000), cards), s);
});
test('auction budgets reserve a dollar for every remaining roster slot', () => {
    const s = E.startDraft(league({ draftFormat: 'auction', draftAuctionBudget: 50 }), stamp(0));
    assert.equal(E.auctionMaxBid(s, 't1'), 48);
    assert.strictEqual(E.nominateAuctionPlayer(s, 't1', cards.get('RB0'), 49, stamp(0)), s);
    const n = E.nominateAuctionPlayer(s, 't1', cards.get('RB0'), 48, stamp(0));
    assert.equal(n.draftAuction.nomination.highBid, 48);
});
test('auction award occurs at deadline, charges winner, and preserves save data', () => {
    let s = E.startDraft(league({ draftFormat: 'auction' }), stamp(0));
    s = E.nominateAuctionPlayer(s, 't1', cards.get('RB0'), 1, stamp(0));
    s = E.bidAuctionPlayer(s, 't3', 12, stamp(1000), cards);
    assert.strictEqual(E.closeAuction(s, cards, stamp(60000)), s);
    s = E.expireDraftClock(s, cards, stamp(61000));
    assert.equal(s.draftPicks[0].teamId, 't3'); assert.equal(s.draftPicks[0].auctionPrice, 12);
    assert.equal(s.teams[2].draftBudgetRemaining, 188); assert.equal(E.currentDraftSeat(s).teamId, 't2');
    assert.deepEqual(E.normalizeTimeLeague(JSON.parse(JSON.stringify(s))), s);
});
test('ordinary draft picks cannot bypass auction bids', () => {
    const s = E.startDraft(league({ draftFormat: 'auction' }), stamp(0));
    assert.strictEqual(E.applyDraftPick(s, cards.get('QB0'), { madeBy: 'human', createdAt: stamp(0) }), s);
    assert.throws(() => action(s, { type: 'draft', identity: 'QB0' }, 1), /auction/);
});
test('auction AI competes deterministically, respects pace and cannot spend hidden money', () => {
    let s = E.startDraft(league({ draftFormat: 'auction', draftAuctionBudget: 50 }), stamp(0));
    s = E.nominateAuctionPlayer(s, 't1', cards.get('RB14'), 1, stamp(0));
    assert.throws(() => action(s, { type: 'auction-ai-step' }, 1999, friend), /not due/);
    const a = action(s, { type: 'auction-ai-step' }, 2000, friend);
    const b = action(s, { type: 'auction-ai-step' }, 2000, friend);
    assert.deepEqual(a, b); assert.equal(a.draftAuction.nomination.highTeamId, 't2');
    assert(a.draftAuction.nomination.highBid <= E.auctionMaxBid(a, 't2'));
    assert.throws(() => action(a, { type: 'auction-ai-step' }, 2000, friend), /not due/);
});
test('auction timeout nominates a queued legal player for an absent human', () => {
    let s = E.startDraft(league({ draftFormat: 'auction', draftPickSeconds: 15 }), stamp(0));
    s = { ...s, teams: s.teams.map(t => t.teamId === 't1' ? { ...t, queue: ['RB7'] } : t) };
    s = E.expireDraftClock(s, cards, stamp(15000));
    assert.equal(s.draftAuction.nomination.identity, 'RB7'); assert.equal(s.draftAuction.nomination.highBid, 1);
});
test('auction cannot bid on an expired lot or force an early timed award', () => {
    let s = E.startDraft(league({ draftFormat: 'auction', draftPickSeconds: 15 }), stamp(0));
    s = E.nominateAuctionPlayer(s, 't1', cards.get('RB0'), 1, stamp(0));
    assert.strictEqual(E.bidAuctionPlayer(s, 't3', 2, stamp(15000), cards), s);
    assert.throws(() => action(s, { type: 'auction-close' }, 1000), /expires/);
});
test('full auction fills every roster, skips full nominators, and ends exactly once', () => {
    let s = E.startDraft(league({ draftFormat: 'auction', draftPickSeconds: 15 }), stamp(0));
    let time = 0, guard = 0;
    while (s.phase === 'draft') {
        assert(++guard < 100);
        if (!s.draftAuction.nomination) {
            const teamId = E.currentDraftSeat(s).teamId;
            const card = E.eraEligibleCards(s, cards).find(c => E.auctionCanBid(s, teamId, c));
            assert(card); s = E.nominateAuctionPlayer(s, teamId, card, 1, stamp(time));
        }
        const next = E.expireDraftClock(s, cards, s.draftClock.deadlineAt);
        assert.notStrictEqual(next, s); s = next; time += 15000;
    }
    assert.equal(s.draftPicks.length, 9); assert(s.teams.every(t => t.roster.length === 3));
    assert.equal(new Set(s.draftPicks.map(p => p.identity)).size, 9);
    assert.equal(s.draftClock.deadlineAt, null); assert.equal(s.seasonsRevealed, true);
});
test('untimed auctions wait for deliberate close and do not outrun competing AI', () => {
    let s = E.startDraft(league({ draftFormat: 'auction', draftPickSeconds: 0 }), stamp(0));
    s = E.nominateAuctionPlayer(s, 't1', cards.get('RB14'), 1, stamp(0));
    assert.equal(s.draftClock.deadlineAt, null);
    assert.throws(() => action(s, { type: 'auction-close' }, 1000), /considering/);
    s = AI.aiAuctionStep(s, cards, stamp(2000));
    assert.equal(action(s, { type: 'auction-close' }, 4000).draftPicks.length, 1);
});
console.log(`Passed ${count} draft format and clock tests.`);
