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
// d352383 (team helmets): the engine seats leagues via
// App.TimeLeagueHelmet.defaultHelmet(), so this module must load before it.
require('../js/shared/time-league-helmet.js');
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
        gameDeckVersion: 0, // Preserve historical-week regression fixtures.
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

test('AI_PERSONAS shares twelve distinct profiles with the engine', () => {
    assert.strictEqual(AI.AI_PERSONAS, Engine.AI_PERSONAS);
    assert.equal(Engine.AI_PERSONA_IDS.length, 12);
    assert.equal(new Set(Object.values(AI.AI_PERSONAS).map(p => [p.aggression, p.patience, p.riskTolerance].join(':'))).size, 12);
    for (const id of Engine.AI_PERSONA_IDS) {
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

test('risk profiles select distinct visible decade distributions without using out-of-era peaks', () => {
    const steady = card('steady', 'Steady Producer', 'RB', [{ season: 1980, points: 170 }, { season: 1981, points: 175 }, { season: 1982, points: 180 }]);
    const spike = card('spike', 'Big Swing', 'RB', [{ season: 1980, points: 30 }, { season: 1981, points: 70 }, { season: 1982, points: 250 }]);
    const outside = card('outside', 'Outside Star', 'RB', [{ season: 1980, points: 60 }, { season: 2000, points: 900 }]);
    const pool = new Map([steady, spike, outside].map(c => [c.identity, c]));
    const choose = aiPersona => {
        const state = Engine.createTimeLeague({ name: 'Visible draft', seed: 'distribution', createdAt: '2026-09-07', settings: baseSettings({ rosterSlots: { RB: 1 }, eraRules: { mode: 'selected-decades', decades: ['1980s'] } }), seats: [{ name: 'Rival', manager: 'ai', aiPersona }, { name: 'You', manager: 'human' }] });
        // Force the test owner onto the current draft seat without depending on lottery order.
        state.teams.forEach(t => { t.manager = 'ai'; t.aiPersona = aiPersona; });
        return AI.aiDraftChoice(state, pool)?.identity;
    };
    assert.equal(choose('grinder'), 'steady');
    assert.equal(choose('gambler'), 'spike');
    assert.equal(choose('sentinel'), 'steady');
    assert.equal(choose('showman'), 'spike');
});

test('all twelve managers make legal deterministic draft choices, claims and trade decisions', () => {
    const pool = samplePool();
    const bids = new Set(), notes = new Set();
    for (const aiPersona of Engine.AI_PERSONA_IDS) {
        let state = Engine.createTimeLeague({ name: 'Personality checks', seed: 'personality', createdAt: '2026-09-07', settings: baseSettings({ rosterSlots: { RB: 1, BN: 1 }, waiverMode: 'faab', faabBudget: 100 }), seats: [{ name: 'You', manager: 'human' }, { name: 'Rival', manager: 'ai', aiPersona }] });
        state.teams.forEach(t => { t.manager = 'ai'; });
        assert(AI.aiDraftChoice(state, pool));
        assert.deepEqual(AI.aiDraftChoice(state, pool), AI.aiDraftChoice(state, pool));
        state = { ...state, phase: 'season', weekStage: 'claims' };
        const claimed = AI.aiSubmitWaiverClaims(state, pool, '2026-09-07T12:00:00Z');
        const rivalClaim = claimed.pendingClaims.find(c => c.teamId === 't2');
        assert(rivalClaim, aiPersona + ' should claim into an empty legal roster');
        assert(rivalClaim.bidAmount > 0 && rivalClaim.bidAmount <= 100);
        bids.add(rivalClaim.bidAmount);
        const tradeCards = new Map([card('give', 'Incoming', 'RB', [{ season: 1980, points: 150 }]), card('take', 'Outgoing', 'RB', [{ season: 1980, points: 100 }])].map(c => [c.identity, c]));
        state.teams = state.teams.map((t, i) => ({ ...t, manager: i ? 'ai' : 'human', roster: [{ entryId: 'e' + (i + 1), identity: i ? 'take' : 'give', name: i ? 'Outgoing' : 'Incoming', position: 'RB', slot: 'RB', drawnSeason: 1980, acquiredWeek: 0, acquiredVia: 'draft' }] }));
        state = Engine.proposeTrade(state, { fromTeamId: 't1', toTeamId: 't2', giveEntryIds: ['e1'], receiveEntryIds: ['e2'], note: '' }, '2026-09-07T12:00:00Z');
        const response = AI.aiRespondToTrades(state, tradeCards, '2026-09-07T12:01:00Z');
        assert.equal(response.trades[0].status, 'accepted', aiPersona + ' accepts a clear legal upgrade');
        notes.add(response.trades[0].note);
    }
    assert(bids.size >= 8, 'FAAB behavior should differ materially across the field');
    assert.equal(notes.size, 12, 'Every persona has its own actual trade response');
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

test('AI replaces no-game starters without inspecting future stats or changing human choices', () => {
    const cards = new Map();
    const make = (id, position, slot, points) => {
        cards.set(id, card(id, id, position, [{ season: 2000, points }]));
        return { entryId: id, identity: id, name: id, position, drawnSeason: 2000, slot };
    };
    let state = Engine.createTimeLeague({ name: 'Availability', seed: 'availability', createdAt: '2026-01-01T00:00:00Z',
        settings: baseSettings({ rosterSlots: { RB: 1, FLEX: 1, SUPER_FLEX: 1, K: 1, DEF: 1, BN: 5 } }),
        seats: [{ name: 'Human', manager: 'human' }, { name: 'Rival', manager: 'ai' }] });
    const roster = [make('no-rb', 'RB', 'RB', 400), make('no-wr', 'WR', 'FLEX', 350), make('no-qb', 'QB', 'SUPER_FLEX', 300),
        make('no-k', 'K', 'K', 200), make('no-def', 'DEF', 'DEF', 180),
        make('yes-rb', 'RB', 'BN', 100), make('yes-wr', 'WR', 'BN', 90), make('yes-qb', 'QB', 'BN', 80),
        make('yes-k', 'K', 'BN', 70), make('spare-wr', 'WR', 'BN', 1000)];
    state = { ...state, phase: 'season', currentWeek: 2, teams: state.teams.map(team => ({ ...team, roster })) };
    const logs = new Map(['yes-rb', 'yes-wr', 'yes-qb', 'yes-k'].map(id => [App.TimeLeagueSeason.gameLogKey(id, 2000, 2),
        { get stats() { throw new Error('Future statistics must stay private'); } }]));
    // A high-value reserve with a game in a different week is unavailable now.
    logs.set(App.TimeLeagueSeason.gameLogKey('spare-wr', 2000, 1), {});
    const before = JSON.stringify(state);
    const next = AI.aiPrepareWeek(state, cards, logs);
    assert.equal(JSON.stringify(state), before, 'Preparation cannot mutate the saved league');
    assert.deepStrictEqual(next.teams[0], state.teams[0], 'AI preparation preserves every human lineup decision');
    const slots = Object.fromEntries(next.teams[1].roster.map(entry => [entry.entryId, entry.slot]));
    assert.equal(slots['yes-rb'], 'RB'); assert.equal(slots['yes-wr'], 'FLEX');
    assert.equal(slots['yes-qb'], 'SUPER_FLEX'); assert.equal(slots['yes-k'], 'K');
    assert.equal(slots['no-def'], 'DEF', 'A wrong-position bench player cannot replace a defense');
    assert(['no-rb', 'no-wr', 'no-qb', 'no-k'].every(id => slots[id] === 'BN'));
    assert.deepStrictEqual(AI.aiPrepareWeek(next, cards, logs), next, 'A prepared lineup is stable on retry');
    assert.deepStrictEqual(AI.aiPrepareWeek(state, cards), state, 'Loading data cannot imply that every player is unavailable');
    assert.equal(Engine.lineupProblems(next, 't2').length, 0);
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

test('AI offers reach human managers and remain pending until their response', () => {
    const cards = new Map();
    let state = Engine.createTimeLeague({ name: 'Incoming', seed: 'incoming', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings({ rosterSlots: { RB: 1, WR: 1, BN: 2 } }), seats: [{ name: 'AI', manager: 'ai', aiPersona: 'steward' }, { name: 'Human', manager: 'human' }] });
    const make = (id, position, points, slot) => {
        cards.set(id, { identity: id, name: id, position, peak: points, seasons: [{ season: 2000, points }] });
        return { entryId: id, identity: id, name: id, position, drawnSeason: 2000, slot };
    };
    state = { ...state, phase: 'season', teams: state.teams.map((team, index) => ({ ...team, roster: index === 0
        ? [make('a1','WR',100,'WR'), make('a2','WR',80,'BN'), make('a3','RB',20,'RB')]
        : [make('h1','RB',100,'RB'), make('h2','RB',90,'BN'), make('h3','WR',20,'WR')] })) };
    const next = AI.aiGenerateTrades(state, cards, '2026-01-01T00:00:00Z');
    assert.ok(next.trades.length > 0);
    const offer = next.trades[0];
    assert.equal(offer.toTeamId, state.teams[1].teamId);
    assert.equal(offer.status, 'pending');
    const responded = AI.aiRespondToTrades(next, cards, '2026-01-01T00:00:00Z');
    assert.equal(responded.trades[0].status, 'pending');
    assert.deepStrictEqual(responded.teams, state.teams);
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
