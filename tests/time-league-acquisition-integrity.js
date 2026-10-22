'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'hidden-years', 'ai', 'actions']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueActions: A, TimeLeagueAI: AI } = App;
const stamp = '2026-10-21T00:00:00Z';
const scoring = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
const player = (number, position, slot = position) => ({ entryId: `e${number}`, identity: `player:${position}:fixture-${number}`,
    name: `Fixture ${number}`, position, slot, drawnSeason: 2020, acquiredVia: 'draft', acquiredWeek: 1 });
const fixture = (settings = {}, count = 3) => {
    const initial = E.createTimeLeague({ name: 'Acquisition fixture', seed: 'acquisition-integrity', createdAt: stamp,
        settings: { gameDeckVersion: 0, hiddenYears: false, rosterSlots: { RB: 1, WR: 1, BN: 1 }, maxQuarterbacks: 1,
            regularSeasonWeeks: 2, playoffTeams: 0, scoring, eraRules: { mode: 'any-era', decades: [] },
            waiversEnabled: true, tradesEnabled: true, waiverMode: 'priority', faabBudget: 10, ...settings },
        seats: Array.from({ length: count }, (_, index) => ({ name: `Team ${index + 1}`, manager: 'human' })) });
    return E.normalizeTimeLeague({ ...initial, phase: 'season', weekStage: 'claims', seasonsRevealed: true,
        teams: initial.teams.map((team, index) => ({ ...team, faabRemaining: 10,
            roster: [player(index * 3 + 1, 'RB'), player(index * 3 + 2, 'WR'), player(index * 3 + 3, 'WR', 'BN')] })) });
};
const card = (number, position = 'WR') => ({ ...player(number, position), seasons: [{ season: 2020, games: 16, points: 100 }], peak: 100 });
const dataFor = state => ({ cards: new Map([...state.teams.flatMap(team => team.roster).map(entry => ({ ...entry, seasons: [{ season: 2020, games: 16, points: 100 }], peak: 100 })), card(100), card(101), card(102, 'QB'), card(103)].map(row => [row.identity, row])), logIndex: new Map(), eraFactors: new Map() });
const member = (teamId = 't1') => ({ role: 'commissioner', seat_team_id: teamId });
const act = (state, action, data = dataFor(state), teamId = 't1') => A.applyOnlineAction(state, action, member(teamId), data, stamp);
const reload = state => { const safe = E.normalizeTimeLeague(JSON.parse(JSON.stringify(state))); assert(safe); return safe; };
const offer = (give = 'e1', receive = 'e4', to = 't2') => ({ fromTeamId: 't1', toTeamId: to, giveEntryIds: [give], receiveEntryIds: [receive] });
const oldPending = (row, number = 1) => ({ ...row, tradeId: `tr${number}`, status: 'pending', week: 1, createdAt: stamp });
let passed = 0;
const test = (name, run) => { run(); passed++; console.log(`  ok ${name}`); };

test('waiver validation names the existing duplicate, drop, QB and budget constraints', () => {
    const state = fixture({ waiverMode: 'faab', rosterSlots: { QB: 1, WR: 1, BN: 1 } });
    state.teams[0].roster = [player(1, 'QB'), player(2, 'WR'), player(3, 'WR', 'BN')];
    const base = { teamId: 't1', addIdentity: card(100).identity, addName: 'Fixture 100', addPosition: 'WR', dropEntryId: 'e3', bidAmount: 6.9 };
    assert.equal(E.waiverClaimProblem(state, base), null);
    const staged = E.submitWaiverClaim(state, base, stamp);
    assert.equal(staged.pendingClaims[0].bidAmount, 6, 'Existing whole-dollar flooring is preserved');
    for (const [claim, pattern] of [
        [base, /already have a claim/],
        [{ ...base, addIdentity: 'another', dropEntryId: 'gone' }, /drop is no longer/],
        [{ ...base, addIdentity: 'another', addPosition: 'QB' }, /Quarterback limit/],
        [{ ...base, addIdentity: 'another', bidAmount: 5 }, /pending bids are reserved/],
        [{ ...base, addIdentity: 'another', bidAmount: -0.1 }, /nonnegative/],
        [{ ...base, addIdentity: 'another', bidAmount: NaN }, /nonnegative/],
        [{ ...base, addIdentity: 'another', bidAmount: Infinity }, /nonnegative/],
    ]) {
        assert.match(E.waiverClaimProblem(staged, claim), pattern);
        assert.equal(E.submitWaiverClaim(staged, claim, stamp), staged);
    }
    assert.equal(E.waiverClaimProblem(staged, { ...base, addIdentity: 'another', addPosition: 'QB', dropEntryId: 'e1', bidAmount: 4 }), null, 'Dropping a QB frees the existing cap');
    const priority = { ...staged, settings: { ...staged.settings, waiverMode: 'priority' }, pendingClaims: [] };
    assert.equal(E.waiverClaimProblem(priority, { ...base, bidAmount: -100 }), null, 'Priority mode still ignores bids');
});

test('Actions return the exact claim reason after existing privacy gates', () => {
    const state = fixture({ rosterSlots: { QB: 1, WR: 1, BN: 1 } });
    state.teams[0].roster = [player(1, 'QB'), player(2, 'WR'), player(3, 'WR', 'BN')];
    assert.throws(() => act(state, { type: 'claim', teamId: 't1', identity: card(102, 'QB').identity, dropEntryId: 'e3' }), /Quarterback limit reached/);
    // applyOnlineAction obtains data.cards up front; the pool itself must never
    // be inspected on unauthorized or unopened planning paths.
    const sealed = { cards: new Proxy(new Map(), { get() { throw Error('Pool inspected before privacy gate'); } }) };
    assert.throws(() => act({ ...state, phase: 'draft' }, { type: 'claim', teamId: 't1', identity: 'hidden' }, sealed), /open during the season/);
    assert.throws(() => act(state, { type: 'claim', teamId: 't2', identity: 'hidden' }, sealed), /own team/);
});

test('claim IDs survive cancel, refiling, reload, settlement and a real next-week gate', () => {
    let state = fixture(), data = dataFor(state);
    const file = number => ({ type: 'claim', teamId: 't1', identity: card(number).identity, dropEntryId: 'e3' });
    state = act(state, file(100), data); const firstId = state.pendingClaims[0].claimId;
    state = reload(act(state, { type: 'cancel-claim', claimId: firstId }, data));
    state = act(state, file(101), data); const secondId = state.pendingClaims[0].claimId;
    assert.notEqual(secondId, firstId);
    assert(Number(secondId.slice(1)) > Number(firstId.slice(1)));
    assert.throws(() => act(state, { type: 'cancel-claim', claimId: firstId }, data), /belongs to another manager/);
    assert.equal(state.pendingClaims[0].claimId, secondId);
    state = reload(act(state, { type: 'process-claims' }, data));
    assert.equal(state.pendingClaims.length, 0); assert.equal(state.waiverResults.length, 1);
    assert.throws(() => act(state, { type: 'process-claims' }, data), /Open waiver planning/);
    state = act(act(state, { type: 'finalize-rosters' }, data), { type: 'week' }, data);
    assert.equal(state.currentWeek, 2);
    state = reload(act(state, { type: 'advance-week' }, data));
    const dropEntryId = state.teams[0].roster.find(entry => entry.identity === card(101).identity).entryId;
    state = act(state, { ...file(100), dropEntryId }, data);
    assert(Number(state.pendingClaims[0].claimId.slice(1)) > Number(secondId.slice(1)));
});

test('legacy high pending claim IDs raise the durable activity watermark', () => {
    let state = fixture();
    state.pendingClaims = [{ claimId: 'w900', teamId: 't2', addIdentity: 'old', addName: 'Old', addPosition: 'WR', dropEntryId: 'e6', week: 1 }];
    state = E.submitWaiverClaim(state, { teamId: 't1', addIdentity: 'new', addName: 'New', addPosition: 'WR', dropEntryId: 'e3' }, stamp);
    assert.equal(state.pendingClaims[1].claimId, 'w901'); assert.equal(state.activity.at(-1).id, 'a901');
    state = reload(E.cancelWaiverClaim(E.cancelWaiverClaim(state, 'w900'), 'w901'));
    state = E.submitWaiverClaim(state, { teamId: 't1', addIdentity: 'next', addName: 'Next', addPosition: 'WR', dropEntryId: 'e3' }, stamp);
    assert.equal(state.pendingClaims[0].claimId, 'w902');
});

test('same-drop FAAB claims reserve every bid, settle once and charge only the landed player', () => {
    let state = fixture({ waiverMode: 'faab' }); const data = dataFor(state);
    for (const [number, bidAmount] of [[100, 6], [101, 4]]) state = act(state, { type: 'claim', teamId: 't1', identity: card(number).identity, dropEntryId: 'e3', bidAmount }, data);
    assert.throws(() => act(state, { type: 'claim', teamId: 't1', identity: card(103).identity, dropEntryId: 'e3', bidAmount: 1 }, data), /pending bids are reserved/);
    state = reload(act(state, { type: 'process-claims' }, data));
    assert.equal(state.teams[0].faabRemaining, 4); assert.equal(state.waiverResults.length, 1);
    assert.equal(state.waiverResults[0].identity, card(100).identity);
    assert(!state.teams[0].roster.some(entry => entry.identity === card(101).identity));
    assert(state.activity.some(event => /Fixture 101 voided \(selected drop already used/.test(event.message)));
    assert.equal(E.processWaivers(state, data.cards, stamp), state, 'A settled batch cannot charge or award again');
});

test('impossible human trades cannot move a sole required starter out of the game loop', () => {
    const state = fixture(), before = JSON.stringify(state), impossible = offer('e1', 'e6');
    assert.match(E.tradeProblem(state, impossible), /Team 1 cannot field.*RB needs an eligible player/);
    const proposed = act(state, { type: 'trade', teamId: 't1', ...impossible });
    assert.equal(proposed.trades.at(-1).status, 'pending', 'Negotiation remains legal while waivers may still fix a roster');
    assert.deepEqual(proposed.teams, state.teams);
    assert.equal(JSON.stringify(state), before);
    const oldSave = reload(act(proposed, { type: 'process-claims' }));
    const withdrawn = act(oldSave, { type: 'respond-trade', tradeId: oldSave.trades[0].tradeId, accept: true }, dataFor(state), 't2');
    assert.equal(withdrawn.trades[0].status, 'withdrawn'); assert.match(withdrawn.trades[0].note, /cannot field a legal roster/);
    assert.deepEqual(withdrawn.teams, state.teams, 'An old impossible pending offer is retired before any asset moves');
    assert.equal(act(withdrawn, { type: 'finalize-rosters' }).weekStage, 'ready');
});

test('a legal no-bench trade preserves manual choices and can reach the real ready gate', () => {
    const base = fixture({ rosterSlots: { RB: 1, WR: 1, BN: 0 } }, 2);
    let state = { ...base, teams: base.teams.map(team => ({ ...team, roster: team.roster.slice(0, 2) })) };
    const swap = offer(); assert.equal(E.tradeProblem(state, swap), null);
    state = act(state, { type: 'trade', teamId: 't1', ...swap });
    state = act(state, { type: 'process-claims' });
    state = act(state, { type: 'respond-trade', tradeId: state.trades.at(-1).tradeId, accept: true }, dataFor(state), 't2');
    assert.equal(state.trades.at(-1).status, 'accepted');
    assert.equal(state.teams[0].roster.find(entry => entry.entryId === 'e4').slot, 'BN', 'Acceptance does not silently choose the human lineup');
    assert.equal(state.teams[0].roster.find(entry => entry.entryId === 'e2').slot, 'WR');
    state = act(state, { type: 'lineup', teamId: 't1', entryId: 'e4', slot: 'RB' });
    state = act(state, { type: 'lineup', teamId: 't2', entryId: 'e1', slot: 'RB' }, dataFor(state), 't2');
    assert.equal(act(reload(state), { type: 'finalize-rosters' }).weekStage, 'ready');
});

test('shared feasibility handles nested flex, custom defensive slots, reserves and capacities', () => {
    const settings = { rosterSlots: { QB: 1, RB: 1, REC_FLEX: 1, FLEX: 1, SUPER_FLEX: 1, K: 1, DEF: 1, DL: 1, IDP_FLEX: 1, BN: 0, IR: 1, TAXI: 1 }, maxQuarterbacks: 2 };
    const positions = [['QB', 'QB'], ['QB', 'BN'], ['RB', 'RB'], ['WR', 'REC_FLEX'], ['TE', 'FLEX'], ['K', 'K'], ['DEF', 'DEF'], ['DL', 'DL'], ['LB', 'IDP_FLEX'], ['DB', 'IR'], ['WR', 'TAXI']];
    const roster = positions.map(([position, slot], index) => player(index + 1, position, slot));
    const result = E.rosterFeasibility(roster, settings);
    assert.equal(result.legal, true); assert.equal(result.slots.length, roster.length);
    assert.equal(new Set(result.slots.map(row => row.entryId)).size, roster.length);
    assert.equal(result.slots.find(row => row.entryId === 'e2').slot, 'SUPER_FLEX');
    assert.equal(E.rosterFeasibility([...roster, player(20, 'WR', 'BN')], settings).legal, false);
    assert.match(E.rosterFeasibility([...roster, player(20, 'WR', 'IR')], settings).problems.join(';'), /bench or reserve space/);
    assert.match(E.rosterFeasibility(roster.filter(entry => entry.position !== 'RB'), settings).problems.join(';'), /RB needs/);
});

test('accepted trades withdraw overlapping ownership-stale offers exactly once', () => {
    let state = fixture();
    state = E.proposeTrade(state, offer(), stamp);
    state = E.proposeTrade(state, offer('e1', 'e7', 't3'), stamp);
    const settledHistory = { ...oldPending(offer('e2', 'e5'), 99), status: 'rejected', note: 'Historic rejection' };
    state = { ...state, trades: [...state.trades, settledHistory], weekStage: 'lineup' };
    state = act(state, { type: 'respond-trade', tradeId: 'tr1', accept: true }, dataFor(state), 't2');
    assert.equal(state.trades[0].status, 'accepted'); assert.equal(state.trades[1].status, 'withdrawn');
    assert.match(state.trades[1].note, /no longer on the original roster/);
    assert.deepEqual(state.trades[2], { ...settledHistory, deferredUntilWeek: 0 });
    const restored = reload(state), events = restored.activity.length;
    assert.equal(E.processWaivers(restored, dataFor(restored).cards, stamp), restored);
    assert.equal(restored.activity.length, events);
    assert.equal(restored.teams.flatMap(team => team.roster).filter(entry => entry.entryId === 'e1').length, 1);
});

test('waiver settlement and explicit stale acceptance retire old offers without duplicate outcomes', () => {
    let state = E.proposeTrade(fixture(), offer('e3', 'e6'), stamp); const data = dataFor(state);
    state = act(state, { type: 'claim', teamId: 't1', identity: card(100).identity, dropEntryId: 'e3' }, data);
    state = act(state, { type: 'process-claims' }, data);
    assert.equal(state.trades[0].status, 'withdrawn'); assert.equal(state.waiverResults.length, 1);
    const stale = reload({ ...fixture(), weekStage: 'lineup', trades: [oldPending(offer('gone', 'e4'))] });
    const withdrawn = act(stale, { type: 'respond-trade', tradeId: 'tr1', accept: true }, dataFor(stale), 't2');
    assert.equal(withdrawn.trades[0].status, 'withdrawn'); assert.deepEqual(withdrawn.teams, stale.teams);
    assert.equal(E.respondToTrade(withdrawn, 'tr1', true, '', stamp), withdrawn);
    assert.equal(E.processWaivers(withdrawn, dataFor(stale).cards, stamp), withdrawn);
});

test('reserve-for-reserve offers remain legal and existing Move actions can finish the trade', () => {
    let state = fixture({ rosterSlots: { RB: 1, WR: 1, BN: 0, IR: 1, TAXI: 1 } }, 2);
    state.teams = state.teams.map((team, index) => ({ ...team, roster: [player(index * 10 + 1, 'RB'), player(index * 10 + 2, 'WR'), player(index * 10 + 3, 'TE', 'IR'), player(index * 10 + 4, 'WR', 'TAXI')] }));
    const swap = offer('e3', 'e13'); assert.equal(E.tradeProblem(state, swap), null);
    state = act(state, { type: 'trade', teamId: 't1', ...swap });
    state = act(state, { type: 'process-claims' });
    state = act(state, { type: 'respond-trade', tradeId: state.trades.at(-1).tradeId, accept: true }, dataFor(state), 't2');
    assert.equal(state.trades.at(-1).status, 'accepted');
    state = act(state, { type: 'lineup', teamId: 't1', entryId: 'e13', slot: 'IR' });
    state = act(state, { type: 'lineup', teamId: 't2', entryId: 'e3', slot: 'IR' }, dataFor(state), 't2');
    assert(state.teams.every(team => team.roster.filter(entry => entry.slot === 'BN').length === 0));
    assert.equal(act(reload(state), { type: 'finalize-rosters' }).weekStage, 'ready');
    const reserveOnlyRb = [player(1, 'WR', 'WR'), player(2, 'WR', 'BN'), player(3, 'RB', 'IR')];
    assert.equal(E.rosterFeasibility(reserveOnlyRb, state.settings).legal, true, 'Existing reserve players can cover an open starter through Move');
});

test('old pending quarterback-cap violations retain the existing rejected status', () => {
    const base = fixture({ rosterSlots: { QB: 1, RB: 1, BN: 1 } }, 2);
    const state = { ...base, weekStage: 'lineup', teams: base.teams.map((team, index) => ({ ...team,
        roster: [player(index * 3 + 1, 'QB'), player(index * 3 + 2, 'RB'), player(index * 3 + 3, 'WR', 'BN')] })), trades: [oldPending(offer('e3', 'e4'))] };
    const result = E.respondToTrade(state, 'tr1', true, '', stamp);
    assert.equal(result.trades[0].status, 'rejected'); assert.equal(result.trades[0].note, 'Voided — quarterback limit.');
    assert.deepEqual(result.teams, state.teams);
});

test('AI repairs a reserve-dependent accepted trade without changing human choices or reading hidden years', () => {
    for (const hiddenYears of [false, true]) {
        let state = fixture({ hiddenYears, gameDeckVersion: hiddenYears ? 1 : 0, rosterSlots: { RB: 1, WR: 1, BN: 0, IR: 1 } }, 2);
        state.teams = state.teams.map((team, index) => ({ ...team, ...(index ? { manager: 'ai', aiPersona: 'gambler' } : {}), roster: index
            ? [player(11, 'RB'), player(12, 'WR'), player(13, 'RB', 'IR')]
            : [player(1, 'RB'), player(2, 'WR'), player(3, 'WR', 'IR')] }));
        const cards = dataFor(state).cards;
        cards.set(state.teams[0].roster[2].identity, { ...cards.get(state.teams[0].roster[2].identity), peak: 1000, seasons: [{ season: 2020, games: 16, points: 1000 }] });
        const swap = offer('e3', 'e11');
        assert.equal(E.tradeProblem(state, swap), null);
        state = { ...E.proposeTrade(state, swap, stamp), weekStage: 'lineup' };
        if (hiddenYears) {
            for (const team of state.teams) for (const entry of team.roster) {
                delete entry.drawnSeason;
                Object.defineProperty(entry, 'drawnSeason', { get() { throw Error('AI reserve repair read a hidden year'); } });
            }
            for (const key of ['privateDraws', 'privateGameDecks', 'privateGameSeed', 'hiddenYearAssignments']) Object.defineProperty(state, key, { enumerable: false, get() { throw Error(`AI reserve repair read ${key}`); } });
        }
        const accepted = AI.aiRespondToTrades(state, cards, stamp);
        assert.equal(accepted.trades[0].status, 'accepted', `The ${hiddenYears ? 'hidden' : 'revealed'} AI can accept a legally repairable deal`);
        const human = accepted.teams[0];
        const prepared = AI.aiPrepareWeek(accepted, cards);
        assert.deepEqual(E.lineupProblems(prepared, 't2'), []);
        assert.equal(prepared.teams[1].roster.find(entry => entry.entryId === 'e13').slot, 'RB');
        assert.equal(prepared.teams[1].roster.filter(entry => entry.slot === 'BN').length, 0);
        assert.equal(prepared.teams[1].roster.filter(entry => entry.slot === 'IR').length, 1);
        assert.deepEqual(prepared.teams[0], human);
        assert.deepEqual(AI.aiPrepareWeek(prepared, cards), prepared, 'A repaired lineup remains deterministic on retry');
    }
});

test('validation uses public roster facts without reading assigned years or future data', () => {
    const state = fixture({ hiddenYears: true, gameDeckVersion: 1 });
    for (const team of state.teams) for (const entry of team.roster) {
        delete entry.drawnSeason;
        for (const key of ['drawnSeason', 'editionId', 'hiddenDecade', 'sourceWeek']) Object.defineProperty(entry, key, { get() { throw Error(`Validation read ${key}`); } });
    }
    for (const key of ['seed', 'privateDraws', 'privateGameDecks', 'hiddenYearAssignments', 'playerReports', 'finalizedWeeks']) Object.defineProperty(state, key, { get() { throw Error(`Validation read ${key}`); } });
    assert.equal(E.tradeProblem(state, offer()), null);
    assert.equal(E.rosterFeasibility(state.teams[0].roster, state.settings).legal, true);
    assert.equal(E.waiverClaimProblem(state, { teamId: 't1', addIdentity: 'public-target', addPosition: 'WR', dropEntryId: 'e3' }), null);
});

console.log(`PASS ${passed} acquisition integrity checks`);
