#!/usr/bin/env node
// Unit tests for js/shared/time-league-engine.js — the core Time League
// state machine, ported from The Duat's app/time-league-engine.ts.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
const Roster = require('../js/shared/time-league-roster.js');
require('../js/shared/time-league-rules.js');
require('../js/shared/time-league-draft-room.js');
require('../js/shared/time-league-era-rules.js');
require('../js/shared/time-league-season.js');
// d352383 (Tecmo-Bowl team helmets) made the engine call
// App.TimeLeagueHelmet.defaultHelmet() when seating a league, but this test
// was never given the module — so App.TimeLeagueHelmet was undefined here and
// 18 of 19 tests died on "Cannot read properties of undefined". Went unseen
// because timeleague is the LAST step of a 31-step && chain that had been
// short-circuiting at step 3.
require('../js/shared/time-league-helmet.js');
const Engine = require('../js/shared/time-league-engine.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

const SCORING = { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 };
const ROSTER_SLOTS = { QB: 1, RB: 1, WR: 1, FLEX: 1, BN: 3 };

function baseSettings(overrides = {}) {
    return {
        rosterSlots: ROSTER_SLOTS,
        scoring: SCORING,
        regularSeasonWeeks: 2,
        maxQuarterbacks: 1,
        eraRules: { mode: 'any-era', decades: [] },
        eraAdjusted: false,
        waiversEnabled: true,
        waiverMode: 'priority',
        faabBudget: 100,
        tradesEnabled: true,
        aiDifficulty: 'veteran',
        ...overrides,
    };
}

function seats(count = 4) {
    return Array.from({ length: count }, (_, i) => ({ name: `Team ${i + 1}`, manager: i === 0 ? 'human' : 'ai' }));
}

function card(identity, name, position, seasons) {
    return { identity, name, position, seasons: seasons.map((s) => ({ ...s, games: 16, passYd: 0, passTd: 0, passInt: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0 })), peak: Math.max(...seasons.map((s) => s.points)) };
}

function samplePool() {
    // 4 teams * rosterCapacity(7) = 28 draft slots to fill; comfortably oversize
    // the pool so a full draft never runs out of era-eligible cards.
    const positions = ['QB', 'RB', 'WR', 'TE'];
    const cards = new Map();
    let n = 0;
    for (const pos of positions) {
        for (let i = 0; i < 12; i += 1) {
            n += 1;
            const identity = `player:${pos}:p${n}`;
            cards.set(identity, card(identity, `Player ${n}`, pos, [{ season: 2000 + (i % 20), points: 10 + i }]));
        }
    }
    return cards;
}

function draftFullRoster(state, cards) {
    let next = state;
    let guard = 0;
    while (next.phase === 'draft') {
        guard += 1;
        assert.ok(guard < 2000, 'draft did not complete — likely no legal card for the current seat');
        const picksBefore = next.draftPicks.length;
        const board = Engine.eraEligibleCards(next, cards);
        assert.ok(board.length, 'board must have a card to draft — otherwise the draft soft-locks');
        // The current seat's team may already be capped at a position (e.g. QB),
        // so the top-peak card isn't always legal for it — scan for one that is.
        for (const candidate of board) {
            next = Engine.applyDraftPick(next, candidate, { madeBy: 'human', createdAt: '2026-01-01T00:00:00Z' });
            if (next.draftPicks.length > picksBefore) break;
        }
        assert.ok(next.draftPicks.length > picksBefore, 'no board card was legal for the current seat');
    }
    return next;
}

test('createTimeLeague produces a deterministic draft order and empty rosters', () => {
    const state = Engine.createTimeLeague({ name: 'Test League', seed: 'seed-1', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    assert.strictEqual(state.phase, 'draft');
    assert.strictEqual(state.teams.length, 4);
    assert.strictEqual(state.draftOrder.length, Engine.rosterCapacity(baseSettings()) * 4);
    assert.ok(state.teams.every((team) => team.roster.length === 0));
});

test('createTimeLeague is deterministic for the same seed', () => {
    const a = Engine.createTimeLeague({ name: 'A', seed: 'same', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    const b = Engine.createTimeLeague({ name: 'A', seed: 'same', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    assert.strictEqual(a.leagueId, b.leagueId);
});

test('applyDraftPick assigns a roster slot and advances the draft seat', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Test', seed: 'draft-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    const board = Engine.eraEligibleCards(state, cards);
    const before = Engine.currentDraftSeat(state);
    state = Engine.applyDraftPick(state, board[0], { madeBy: 'human', createdAt: '2026-01-01T00:00:00Z' });
    const team = state.teams.find((t) => t.teamId === before.teamId);
    assert.strictEqual(team.roster.length, 1);
    assert.strictEqual(team.roster[0].identity, board[0].identity);
});

test('full draft completes and reveals seasons', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Test', seed: 'full-draft', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    assert.strictEqual(state.phase, 'season');
    assert.strictEqual(state.seasonsRevealed, true);
    assert.strictEqual(state.draftPicks.length, state.draftOrder.length);
});

test('QB cap is enforced during the draft', () => {
    // Only QBs in the pool, cap of 1 -> a team should never draft two.
    const cards = new Map();
    for (let i = 0; i < 8; i += 1) {
        cards.set(`player:QB:q${i}`, card(`player:QB:q${i}`, `QB ${i}`, 'QB', [{ season: 2010, points: 10 }]));
    }
    const settings = baseSettings({ rosterSlots: { QB: 1, BN: 3 }, maxQuarterbacks: 1 });
    let state = Engine.createTimeLeague({ name: 'QB Test', seed: 'qb-cap', createdAt: '2026-01-01T00:00:00Z', settings, seats: seats(2) });
    // Draft until no legal picks remain for the current seat's team.
    for (let i = 0; i < 4; i += 1) {
        const board = Engine.eraEligibleCards(state, cards);
        if (!board.length) break;
        state = Engine.applyDraftPick(state, board[0], { madeBy: 'human', createdAt: '2026-01-01T00:00:00Z' });
    }
    for (const team of state.teams) {
        const qbCount = team.roster.filter((e) => e.position === 'QB').length;
        assert.ok(qbCount <= 1, `team ${team.teamId} rostered ${qbCount} QBs, cap is 1`);
    }
});

test('setEntrySlot swaps two entries when the target slot is full', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Slot Test', seed: 'slot-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const team = state.teams[0];
    // Find a bench entry whose position is actually eligible for some other
    // occupied starter slot, otherwise the move is correctly refused by design.
    let bench = null;
    let starter = null;
    for (const candidate of team.roster.filter((e) => e.slot === 'BN')) {
        const target = team.roster.find((e) => e.slot !== 'BN' && e.slot !== candidate.slot
            && Roster.SLOT_ELIGIBILITY[e.slot].includes(candidate.position));
        if (target) { bench = candidate; starter = target; break; }
    }
    assert.ok(bench && starter, 'a full 4-position draft should produce at least one eligible bench/starter pair');
    const next = Engine.setEntrySlot(state, team.teamId, bench.entryId, starter.slot);
    const movedBench = next.teams.find((t) => t.teamId === team.teamId).roster.find((e) => e.entryId === bench.entryId);
    assert.strictEqual(movedBench.slot, starter.slot);
});

test('lineupProblems reports empty required slots', () => {
    const state = Engine.createTimeLeague({ name: 'Empty', seed: 'empty-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    const problems = Engine.lineupProblems(state, state.teams[0].teamId);
    assert.ok(problems.length > 0);
});

test('finalizeCurrentWeek scores starters and advances the week', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Week Test', seed: 'week-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const logIndex = new Map();
    for (const team of state.teams) {
        for (const entry of team.roster) {
            logIndex.set(`${entry.identity}:${entry.drawnSeason}:1`, {
                identity: entry.identity, name: entry.name, position: entry.position, season: entry.drawnSeason, week: 1,
                stats: { passYd: 0, passTd: 0, passInt: 0, rushYd: 50, rushTd: 1, rec: 0, recYd: 0, recTd: 0, fumblesLost: 0, twoPointConversions: 0 },
            });
        }
    }
    const next = Engine.finalizeCurrentWeek(state, logIndex, null, '2026-01-01T00:00:00Z');
    assert.strictEqual(next.currentWeek, 2);
    assert.strictEqual(next.finalizedWeeks.length, 1);
    assert.ok(next.finalizedWeeks[0].results.every((r) => r.total >= 0));
});

test('season completes and crowns a champion after the last week', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Champ Test', seed: 'champ-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings({ regularSeasonWeeks: 1 }), seats: seats() });
    state = draftFullRoster(state, cards);
    const next = Engine.finalizeCurrentWeek(state, new Map(), null, '2026-01-01T00:00:00Z');
    assert.strictEqual(next.phase, 'complete');
    assert.ok(next.championTeamId);
});

test('computeStandings ranks by wins then points-for', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Standings Test', seed: 'standings-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    state = Engine.finalizeCurrentWeek(state, new Map(), null, '2026-01-01T00:00:00Z');
    const standings = Engine.computeStandings(state);
    assert.strictEqual(standings.length, 4);
    for (let i = 1; i < standings.length; i += 1) {
        assert.ok(standings[i - 1].wins >= standings[i].wins);
    }
});

test('freeAgents excludes rostered players', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'FA Test', seed: 'fa-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const rostered = new Set(state.teams.flatMap((t) => t.roster.map((e) => e.identity)));
    const fa = Engine.freeAgents(state, cards);
    assert.ok(fa.every((c) => !rostered.has(c.identity)));
});

test('submitWaiverClaim then processWaivers lands the claim and clears the queue', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Waiver Test', seed: 'waiver-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const team = state.teams[0];
    // Every team already filled its 1-QB cap during the full draft, so a QB
    // free agent would be correctly refused — pick a non-QB to test the happy path.
    const fa = Engine.freeAgents(state, cards).find((c) => c.position !== 'QB');
    assert.ok(fa, 'sample pool must have a non-QB free agent left after a 4-team draft');
    // The bench is already at capacity after a full draft (adds always land on
    // BN), so a claim needs a drop to actually clear room.
    const dropEntry = team.roster.find((e) => e.slot === 'BN');
    assert.ok(dropEntry, 'a full draft should fill the bench');
    state = Engine.submitWaiverClaim(state, { teamId: team.teamId, addIdentity: fa.identity, addName: fa.name, addPosition: fa.position, dropEntryId: dropEntry.entryId }, '2026-01-01T00:00:00Z');
    assert.strictEqual(state.pendingClaims.length, 1);
    state = Engine.processWaivers(state, cards, '2026-01-01T00:00:00Z');
    assert.strictEqual(state.pendingClaims.length, 0);
    const updatedTeam = state.teams.find((t) => t.teamId === team.teamId);
    assert.ok(updatedTeam.roster.some((e) => e.identity === fa.identity));
    assert.ok(!updatedTeam.roster.some((e) => e.entryId === dropEntry.entryId));
});

test('FAAB: highest bid wins a contested free agent and pays its own bid', () => {
    const cards = samplePool();
    const settings = baseSettings({ waiverMode: 'faab', faabBudget: 100 });
    let state = Engine.createTimeLeague({ name: 'Faab Test', seed: 'faab-seed', createdAt: '2026-01-01T00:00:00Z', settings, seats: seats() });
    assert.ok(state.teams.every((t) => t.faabRemaining === 100));
    state = draftFullRoster(state, cards);
    const [teamA, teamB] = state.teams;
    const fa = Engine.freeAgents(state, cards).find((c) => c.position !== 'QB');
    const dropA = teamA.roster.find((e) => e.slot === 'BN');
    const dropB = teamB.roster.find((e) => e.slot === 'BN');
    state = Engine.submitWaiverClaim(state, { teamId: teamA.teamId, addIdentity: fa.identity, addName: fa.name, addPosition: fa.position, dropEntryId: dropA.entryId, bidAmount: 20 }, '2026-01-01T00:00:00Z');
    state = Engine.submitWaiverClaim(state, { teamId: teamB.teamId, addIdentity: fa.identity, addName: fa.name, addPosition: fa.position, dropEntryId: dropB.entryId, bidAmount: 45 }, '2026-01-01T00:00:00Z');
    state = Engine.processWaivers(state, cards, '2026-01-01T00:00:00Z');
    const winner = state.teams.find((t) => t.teamId === teamB.teamId);
    const loser = state.teams.find((t) => t.teamId === teamA.teamId);
    assert.ok(winner.roster.some((e) => e.identity === fa.identity), 'the $45 bid should win the player');
    assert.ok(!loser.roster.some((e) => e.identity === fa.identity), 'the $20 bid should lose the player');
    assert.strictEqual(winner.faabRemaining, 55, 'the winner pays its own bid, not the runner-up amount');
    assert.strictEqual(loser.faabRemaining, 100, 'a losing bid is never charged');
});

test('FAAB: submitWaiverClaim rejects a bid over the team\'s remaining budget', () => {
    const cards = samplePool();
    const settings = baseSettings({ waiverMode: 'faab', faabBudget: 30 });
    let state = Engine.createTimeLeague({ name: 'Faab Cap', seed: 'faab-cap', createdAt: '2026-01-01T00:00:00Z', settings, seats: seats() });
    state = draftFullRoster(state, cards);
    const team = state.teams[0];
    const fa = Engine.freeAgents(state, cards).find((c) => c.position !== 'QB');
    const drop = team.roster.find((e) => e.slot === 'BN');
    const before = state;
    state = Engine.submitWaiverClaim(state, { teamId: team.teamId, addIdentity: fa.identity, addName: fa.name, addPosition: fa.position, dropEntryId: drop.entryId, bidAmount: 31 }, '2026-01-01T00:00:00Z');
    assert.strictEqual(state, before, 'a bid over the remaining budget must be refused');
});

test('FAAB: ties break by worst-record priority, same as priority mode', () => {
    const cards = samplePool();
    const settings = baseSettings({ waiverMode: 'faab', faabBudget: 100 });
    let state = Engine.createTimeLeague({ name: 'Faab Tie', seed: 'faab-tie', createdAt: '2026-01-01T00:00:00Z', settings, seats: seats() });
    state = draftFullRoster(state, cards);
    // Finalize a week so standings (and thus waiver priority) aren't all tied at 0-0.
    state = Engine.finalizeCurrentWeek(state, new Map(), null, '2026-01-01T00:00:00Z');
    const priority = Engine.computeStandings(state).map((s) => s.teamId).reverse();
    const [worst, , , best] = [...state.teams].sort((a, b) => priority.indexOf(a.teamId) - priority.indexOf(b.teamId));
    const fa = Engine.freeAgents(state, cards).find((c) => c.position !== 'QB');
    const dropWorst = worst.roster.find((e) => e.slot === 'BN');
    const dropBest = best.roster.find((e) => e.slot === 'BN');
    state = Engine.submitWaiverClaim(state, { teamId: best.teamId, addIdentity: fa.identity, addName: fa.name, addPosition: fa.position, dropEntryId: dropBest.entryId, bidAmount: 10 }, '2026-01-01T00:00:00Z');
    state = Engine.submitWaiverClaim(state, { teamId: worst.teamId, addIdentity: fa.identity, addName: fa.name, addPosition: fa.position, dropEntryId: dropWorst.entryId, bidAmount: 10 }, '2026-01-01T00:00:00Z');
    state = Engine.processWaivers(state, cards, '2026-01-01T00:00:00Z');
    const worstAfter = state.teams.find((t) => t.teamId === worst.teamId);
    assert.ok(worstAfter.roster.some((e) => e.identity === fa.identity), 'equal bids should favor the worse record');
});

test('proposeTrade then respondToTrade(accept) swaps entries between rosters', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Trade Test', seed: 'trade-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const [teamA, teamB] = state.teams;
    // Swap same-position, non-QB entries so the trade can't trip either side's
    // quarterback cap — that voiding path is covered by its own scenario below.
    const position = teamA.roster.find((e) => e.position !== 'QB').position;
    const giveEntry = teamA.roster.find((e) => e.position === position);
    const receiveEntry = teamB.roster.find((e) => e.position === position);
    assert.ok(giveEntry && receiveEntry, 'both teams should roster a same non-QB position after a 4-position draft');
    state = Engine.proposeTrade(state, { fromTeamId: teamA.teamId, toTeamId: teamB.teamId, giveEntryIds: [giveEntry.entryId], receiveEntryIds: [receiveEntry.entryId], note: 'test trade' }, '2026-01-01T00:00:00Z');
    assert.strictEqual(state.trades.length, 1);
    const tradeId = state.trades[0].tradeId;
    state = Engine.respondToTrade(state, tradeId, true, '', '2026-01-01T00:00:00Z');
    const newA = state.teams.find((t) => t.teamId === teamA.teamId);
    const newB = state.teams.find((t) => t.teamId === teamB.teamId);
    assert.ok(newA.roster.some((e) => e.entryId === receiveEntry.entryId));
    assert.ok(newB.roster.some((e) => e.entryId === giveEntry.entryId));
    assert.strictEqual(state.trades[0].status, 'accepted');
});

test('respondToTrade(reject) leaves rosters untouched', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Reject Test', seed: 'reject-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const [teamA, teamB] = state.teams;
    const giveEntry = teamA.roster[0];
    const receiveEntry = teamB.roster[0];
    state = Engine.proposeTrade(state, { fromTeamId: teamA.teamId, toTeamId: teamB.teamId, giveEntryIds: [giveEntry.entryId], receiveEntryIds: [receiveEntry.entryId], note: '' }, '2026-01-01T00:00:00Z');
    const tradeId = state.trades[0].tradeId;
    const before = JSON.stringify(state.teams);
    state = Engine.respondToTrade(state, tradeId, false, '', '2026-01-01T00:00:00Z');
    assert.strictEqual(JSON.stringify(state.teams), before);
    assert.strictEqual(state.trades[0].status, 'rejected');
});

test('normalizeTimeLeague round-trips a valid state exactly', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'RoundTrip', seed: 'rt-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const roundTripped = Engine.normalizeTimeLeague(JSON.parse(JSON.stringify(state)));
    assert.deepStrictEqual(roundTripped, state);
});

test('normalizeTimeLeague rejects malformed/foreign payloads', () => {
    assert.strictEqual(Engine.normalizeTimeLeague(null), null);
    assert.strictEqual(Engine.normalizeTimeLeague({}), null);
    assert.strictEqual(Engine.normalizeTimeLeague({ version: 2 }), null);
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
