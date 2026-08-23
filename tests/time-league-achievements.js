#!/usr/bin/env node
// Unit tests for js/shared/time-league-achievements.js — the Vault's
// achievement catalog, mirroring War Room's real achievements.js shape
// (catalog/computeStats/evaluate/tierLabel/tierColor).
'use strict';

const assert = require('assert');
global.window = globalThis;
window.App = {};
const Roster = require('../js/shared/time-league-roster.js');
require('../js/shared/time-league-rules.js');
require('../js/shared/time-league-draft-room.js');
require('../js/shared/time-league-era-rules.js');
require('../js/shared/time-league-season.js');
// d352383 (team helmets): the engine seats leagues via
// App.TimeLeagueHelmet.defaultHelmet(), so this module must load before it.
require('../js/shared/time-league-helmet.js');
const Engine = require('../js/shared/time-league-engine.js');
const Achievements = require('../js/shared/time-league-achievements.js');

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
        rosterSlots: ROSTER_SLOTS, scoring: SCORING, regularSeasonWeeks: 1, maxQuarterbacks: 1,
        eraRules: { mode: 'any-era', decades: [] }, eraAdjusted: false,
        waiversEnabled: true, waiverMode: 'priority', faabBudget: 100, tradesEnabled: true,
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
        for (const candidate of board) {
            next = Engine.applyDraftPick(next, candidate, { madeBy: 'human', createdAt: '2026-01-01T00:00:00Z' });
            if (next.draftPicks.length > picksBefore) break;
        }
        assert.ok(next.draftPicks.length > picksBefore);
    }
    return next;
}

test('catalog covers all four tiers with unique ids', () => {
    const ids = new Set(Achievements.catalog.map((a) => a.id));
    assert.strictEqual(ids.size, Achievements.catalog.length, 'no duplicate ids');
    const tiers = new Set(Achievements.catalog.map((a) => a.tier));
    assert.deepStrictEqual([...tiers].sort(), ['desk', 'performance', 'roster', 'season']);
});

test('a fresh, undrafted league earns nothing', () => {
    const state = Engine.createTimeLeague({ name: 'Fresh', seed: 'ach-fresh', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    const stats = Achievements.computeStats(state, state.teams[0].teamId);
    const { earned } = Achievements.evaluate(stats);
    assert.strictEqual(earned.length, 0);
});

test('champion badge earns only for the crowned team after the season completes', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Champ', seed: 'ach-champ', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings({ regularSeasonWeeks: 1 }), seats: seats() });
    state = draftFullRoster(state, cards);
    state = Engine.finalizeCurrentWeek(state, new Map(), null, '2026-01-01T00:00:00Z');
    assert.strictEqual(state.phase, 'complete');
    for (const team of state.teams) {
        const stats = Achievements.computeStats(state, team.teamId);
        const { earned } = Achievements.evaluate(stats);
        const hasChampion = earned.some((b) => b.id === 'champion');
        assert.strictEqual(hasChampion, team.teamId === state.championTeamId);
    }
});

test('dealmaker progresses toward its target as trades are accepted', () => {
    const cards = samplePool();
    let state = Engine.createTimeLeague({ name: 'Dealmaker', seed: 'ach-deal', createdAt: '2026-01-01T00:00:00Z', settings: baseSettings(), seats: seats() });
    state = draftFullRoster(state, cards);
    const [teamA, teamB] = state.teams;
    const position = teamA.roster.find((e) => e.position !== 'QB').position;
    const give = teamA.roster.find((e) => e.position === position);
    const receive = teamB.roster.find((e) => e.position === position);
    let before = Achievements.evaluate(Achievements.computeStats(state, teamA.teamId));
    assert.strictEqual(before.earned.some((b) => b.id === 'dealmaker'), false);
    state = Engine.proposeTrade(state, { fromTeamId: teamA.teamId, toTeamId: teamB.teamId, giveEntryIds: [give.entryId], receiveEntryIds: [receive.entryId], note: '' }, '2026-01-01T00:00:00Z');
    state = Engine.respondToTrade(state, state.trades[0].tradeId, true, '', '2026-01-01T00:00:00Z');
    const after = Achievements.evaluate(Achievements.computeStats(state, teamA.teamId));
    const dealmaker = [...after.earned, ...after.unearned].find((b) => b.id === 'dealmaker');
    assert.strictEqual(dealmaker.value, 1);
    assert.ok(dealmaker.progress > 0 && dealmaker.progress < 1, 'one of two trades should be partial progress, not earned');
});

test('tierLabel and tierColor cover every tier used by the catalog', () => {
    for (const badge of Achievements.catalog) {
        assert.strictEqual(typeof Achievements.tierLabel(badge.tier), 'string');
        assert.ok(Achievements.tierLabel(badge.tier).length > 0);
        assert.ok(Achievements.tierColor(badge.tier).length > 0);
    }
});

console.log('');
if (failed) {
    console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
    failures.forEach((f) => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
    process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
