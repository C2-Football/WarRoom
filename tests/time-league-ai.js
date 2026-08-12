#!/usr/bin/env node
// Unit tests for js/shared/time-league-ai.js — the deterministic AI-GM
// personas, ported from The Duat's app/time-league-ai.ts.
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
require('../js/shared/time-league-roster.js');
require('../js/shared/time-league-rules.js');
require('../js/shared/time-league-draft-room.js');
require('../js/shared/time-league-era-rules.js');
require('../js/shared/time-league-season.js');
const Engine = require('../js/shared/time-league-engine.js');
const AI = require('../js/shared/time-league-ai.js');

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
        rosterSlots: ROSTER_SLOTS, scoring: SCORING, regularSeasonWeeks: 2, maxQuarterbacks: 1,
        eraRules: { mode: 'any-era', decades: [] }, eraAdjusted: false, waiversEnabled: true, tradesEnabled: true,
        ...overrides,
    };
}

function seats(count = 4) {
    return Array.from({ length: count }, (_, i) => ({ name: `Team ${i + 1}`, manager: 'ai', aiPersona: ['warlord', 'archivist', 'gambler', 'steward'][i % 4] }));
}

function card(identity, name, position, seasons) {
    return { identity, name, position, seasons: seasons.map((s) => ({ ...s, games: 16, passYd: 0, passTd: 0, passInt: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0 })), peak: Math.max(...seasons.map((s) => s.points)) };
}

function samplePool() {
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
        assert.ok(guard < 2000, 'draft did not complete');
        const picksBefore = next.draftPicks.length;
        const board = Engine.eraEligibleCards(next, cards);
        assert.ok(board.length);
        for (const candidate of board) {
            next = Engine.applyDraftPick(next, candidate, { madeBy: 'ai', createdAt: '2026-01-01T00:00:00Z' });
            if (next.draftPicks.length > picksBefore) break;
        }
        assert.ok(next.draftPicks.length > picksBefore);
    }
    return next;
}

test('AI_PERSONAS has all four personas with a full trait profile', () => {
    for (const id of ['warlord', 'archivist', 'gambler', 'steward']) {
        const persona = AI.AI_PERSONAS[id];
        assert.ok(persona && persona.label && typeof persona.aggression === 'number');
    }
});

test('entryValueFromCard prefers the drawn season over peak when available', () => {
    const testCard = card('x', 'X', 'RB', [{ season: 2000, points: 5 }, { season: 2010, points: 50 }]);
    assert.strictEqual(AI.entryValueFromCard(testCard, 2000), 5);
    assert.strictEqual(AI.entryValueFromCard(testCard, undefined), 50);
});

test('aiDraftChoice is deterministic for the same league seed', () => {
    const cards = samplePool();
    const state = Engine.createTimeLeague({ name: 'AI Draft', seed: 'ai-seed-1', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    const a = AI.aiDraftChoice(state, cards);
    const b = AI.aiDraftChoice(state, cards);
    assert.strictEqual(a.identity, b.identity);
});

test('aiDraftChoice only returns cards with an open legal roster slot', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'AI Draft 2', seed: 'ai-seed-2', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    for (let i = 0; i < 5; i += 1) {
        const choice = AI.aiDraftChoice(state, cards);
        assert.ok(choice, 'AI should always find a legal pick against an oversized pool');
        state = Engine.applyDraftPick(state, choice, { madeBy: 'ai', createdAt: '2026-01-01T00:00:00Z' });
    }
});

test('aiPrepareWeek fills every AI team’s empty starter slots from the bench', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Prep Test', seed: 'prep-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    // Force one team's starters empty to verify autofill actually runs.
    const team = state.teams[0];
    state = {
        ...state,
        teams: state.teams.map((t) => (t.teamId !== team.teamId ? t : {
            ...t,
            roster: t.roster.map((e) => (e.slot === 'QB' ? { ...e, slot: 'BN' } : e)),
        })),
    };
    const next = AI.aiPrepareWeek(state, cards);
    const problems = Engine.lineupProblems(next, team.teamId);
    assert.ok(!problems.some((p) => p.includes('QB slot is empty')));
});

test('aiSubmitWaiverClaims never proposes a QB when the team is already at cap', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Waiver AI', seed: 'waiver-ai-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const next = AI.aiSubmitWaiverClaims(state, cards, '2026-01-01T00:00:00Z');
    for (const claim of next.pendingClaims) {
        assert.notStrictEqual(claim.addPosition, 'QB');
    }
});

test('aiSubmitWaiverClaims bids within budget and is deterministic under FAAB', () => {
    const cards = samplePool();
    const settings = baseSettings({ waiverMode: 'faab', faabBudget: 60 });
    let state = Engine.createTimeLeague({ name: 'Waiver AI FAAB', seed: 'waiver-ai-faab-seed', createdAt: '2026-01-01T00:00:00Z', settings, seats: seats() });
    state = draftFullRoster(state, cards);
    // The draft always takes the best-peak card first, so every undrafted card
    // in the sample pool is already worse than every roster — no AI would ever
    // clear its bid bar. Add one free agent nobody could have drafted so this
    // test actually exercises the bid path rather than asserting on an empty list.
    const augmented = new Map(cards);
    augmented.set('player:RB:bounty', card('player:RB:bounty', 'Bounty Back', 'RB', [{ season: 2015, points: 999 }]));
    const a = AI.aiSubmitWaiverClaims(state, augmented, '2026-01-01T00:00:00Z');
    const b = AI.aiSubmitWaiverClaims(state, augmented, '2026-01-01T00:00:00Z');
    assert.ok(a.pendingClaims.length > 0, 'every AI team should chase a free agent this much better than its roster');
    assert.deepStrictEqual(a.pendingClaims.map((c) => c.bidAmount), b.pendingClaims.map((c) => c.bidAmount));
    for (const claim of a.pendingClaims) {
        assert.ok(claim.bidAmount >= 1 && claim.bidAmount <= 60, `bid ${claim.bidAmount} must sit inside the $60 budget`);
    }
});

test('FAAB bids scale up with AI difficulty for the same persona', () => {
    const cards = samplePool();
    const settings = baseSettings({ waiverMode: 'faab', faabBudget: 60 });
    let state = Engine.createTimeLeague({ name: 'Difficulty FAAB', seed: 'diff-faab-seed', createdAt: '2026-01-01T00:00:00Z', settings, seats: seats() });
    state = draftFullRoster(state, cards);
    const augmented = new Map(cards);
    augmented.set('player:RB:bounty', card('player:RB:bounty', 'Bounty Back', 'RB', [{ season: 2015, points: 999 }]));
    const bidsAt = (difficulty) => {
        const s = { ...state, settings: { ...state.settings, aiDifficulty: difficulty } };
        const next = AI.aiSubmitWaiverClaims(s, augmented, '2026-01-01T00:00:00Z');
        return next.pendingClaims.map((c) => c.bidAmount);
    };
    const rookieBids = bidsAt('rookie');
    const allproBids = bidsAt('allpro');
    assert.strictEqual(rookieBids.length, allproBids.length, 'same teams should chase the bounty at both difficulties');
    for (let i = 0; i < rookieBids.length; i += 1) {
        assert.ok(allproBids[i] >= rookieBids[i], `all-pro bid ${allproBids[i]} should be at least as aggressive as rookie's ${rookieBids[i]}`);
    }
    assert.ok(allproBids.some((bid, i) => bid > rookieBids[i]), 'at least one team should bid strictly more at all-pro than rookie');
});

test('trade acceptance gets pickier as AI difficulty rises', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Difficulty Trade', seed: 'diff-trade-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const [teamA, teamB] = state.teams;
    // Avoid QB entries — swapping one across teams could trip either side's
    // 1-QB cap and void the trade regardless of value, which isn't what this
    // test is checking.
    const giveEntry = teamA.roster.find((e) => e.position !== 'QB');
    const receiveEntry = teamB.roster.find((e) => e.position !== 'QB');
    assert.ok(giveEntry && receiveEntry, 'a full draft should leave each team with a non-QB entry');
    // Relabel both entries onto synthetic cards with exact, known values so the
    // accept/reject line can be placed precisely between the veteran and
    // all-pro thresholds — the tiny sample pool rarely produces a naturally
    // occurring ratio that lands there.
    const persona = AI.AI_PERSONAS[teamB.aiPersona];
    const base = 1.08 - 0.16 * ((persona.aggression + persona.riskTolerance) / 200);
    const outgoingValue = 100;
    const incomingValue = Math.round(outgoingValue * (base + 0.03)); // between veteran (base) and all-pro (base + 0.07)
    const augmented = new Map(cards);
    augmented.set('synthetic:give', card('synthetic:give', 'Synthetic Give', giveEntry.position, [{ season: giveEntry.drawnSeason, points: incomingValue }]));
    augmented.set('synthetic:receive', card('synthetic:receive', 'Synthetic Receive', receiveEntry.position, [{ season: receiveEntry.drawnSeason, points: outgoingValue }]));
    const relabel = (s, entryId, identity, name) => ({
        ...s,
        teams: s.teams.map((t) => ({ ...t, roster: t.roster.map((e) => (e.entryId === entryId ? { ...e, identity, name } : e)) })),
    });
    state = relabel(state, giveEntry.entryId, 'synthetic:give', 'Synthetic Give');
    state = relabel(state, receiveEntry.entryId, 'synthetic:receive', 'Synthetic Receive');

    const statusAt = (difficulty) => {
        let s = { ...state, settings: { ...state.settings, aiDifficulty: difficulty } };
        s = Engine.proposeTrade(s, { fromTeamId: teamA.teamId, toTeamId: teamB.teamId, giveEntryIds: [giveEntry.entryId], receiveEntryIds: [receiveEntry.entryId], note: '' }, '2026-01-01T00:00:00Z');
        const tradeId = s.trades[0].tradeId;
        s = AI.aiRespondToTrades(s, augmented, '2026-01-01T00:00:00Z');
        return s.trades.find((t) => t.tradeId === tradeId).status;
    };
    assert.strictEqual(statusAt('veteran'), 'accepted', 'veteran should take a deal right at its own threshold');
    assert.strictEqual(statusAt('allpro'), 'rejected', 'all-pro should demand more value than the same deal offers');
});

test('aiGenerateTrades is deterministic for the same seed and week', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Trade AI', seed: 'trade-ai-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const a = AI.aiGenerateTrades(state, cards, '2026-01-01T00:00:00Z');
    const b = AI.aiGenerateTrades(state, cards, '2026-01-01T00:00:00Z');
    assert.strictEqual(a.trades.length, b.trades.length);
    assert.deepStrictEqual(a.trades.map((t) => t.tradeId), b.trades.map((t) => t.tradeId));
});

test('aiRespondToTrades resolves every pending offer addressed to an AI team', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Respond AI', seed: 'respond-ai-seed', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const [teamA, teamB] = state.teams;
    const position = teamA.roster.find((e) => e.position !== 'QB').position;
    const give = teamA.roster.find((e) => e.position === position);
    const receive = teamB.roster.find((e) => e.position === position);
    state = Engine.proposeTrade(state, { fromTeamId: teamA.teamId, toTeamId: teamB.teamId, giveEntryIds: [give.entryId], receiveEntryIds: [receive.entryId], note: '' }, '2026-01-01T00:00:00Z');
    const next = AI.aiRespondToTrades(state, cards, '2026-01-01T00:00:00Z');
    assert.notStrictEqual(next.trades[0].status, 'pending');
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
