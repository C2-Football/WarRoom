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
