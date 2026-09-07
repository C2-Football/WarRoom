#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = vm.createContext({ console, window: null });
context.window = context;
for (const file of ['js/draft/state.js', 'js/draft/live-room-engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const engine = context.DraftCC.liveRoomEngine;
const stateHelpers = context.DraftCC.state;
const plain = value => JSON.parse(JSON.stringify(value));
const read = state => plain(engine.buildLiveRoom(state));
let passed = 0;
let failed = 0;
function test(name, fn) {
    try { fn(); passed++; process.stdout.write('.'); }
    catch (error) { failed++; process.stderr.write('\nFAIL ' + name + '\n' + error.stack + '\n'); }
}
const pool = [
    { pid: 'rb1', name: 'First Back', pos: 'RB', dhq: 6800, consensusRank: 1 },
    { pid: 'wr1', name: 'First Receiver', pos: 'WR', dhq: 6500, consensusRank: 2 },
    { pid: 'qb1', name: 'First Quarterback', pos: 'QB', dhq: 6400, consensusRank: 3 },
    { pid: 'te1', name: 'First Tight End', pos: 'TE', dhq: 5600, consensusRank: 4 },
    { pid: 'wr2', name: 'Second Receiver', pos: 'WR', dhq: 5500, consensusRank: 5 },
    { pid: 'wr3', name: 'Third Receiver', pos: 'WR', dhq: 5300, consensusRank: 6 },
];
function fixture(overrides = {}) {
    return {
        mode: 'live-sync', variant: 'rookie', phase: 'drafting', leagueSize: 3, rounds: 3,
        userRosterId: '3', currentIdx: 2,
        personas: {
            1: { rosterId: 1, teamName: 'Alpha', assessment: { needs: [{ pos: 'RB', urgency: 'deficit' }, { pos: 'TE', urgency: 'thin' }] } },
            2: { rosterId: '2', teamName: 'Beta', assessment: { needs: [] } },
            3: { rosterId: 3, teamName: 'You', assessment: { needs: ['WR'] } },
        },
        originalPool: pool,
        pickOrder: stateHelpers.buildPickOrder(3, 3, 'snake', {
            1: { rosterId: 1 }, 2: { rosterId: '2' }, 3: { rosterId: 3 },
        }),
        picks: [
            { ...pool[0], overall: 1, round: 1, rosterId: '1' },
            { ...pool[1], overall: 2, round: 1, rosterId: 2 },
        ],
        draftContext: { leagueFormat: { rosterSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'IR'] } },
        ...overrides,
    };
}
function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

test('all teams remain visible before their first pick, and IDs are normalized', () => {
    const room = read(fixture());
    assert.equal(room.teams.length, 3);
    assert.equal(room.teamsById['1'].pickCount, 1);
    assert.equal(room.teamsById['2'].pickCount, 1);
    assert.equal(room.teamsById['3'].pickCount, 0);
    assert.equal(room.teamsById['3'].isUser, true);
    assert.equal(room.onClockRosterId, '3');
    assert.equal(room.nextUserPick.picksAway, 0);
    assert.equal(room.teamsById['3'].grade.available, false);
    assert.equal(room.teamsById['3'].grade.letter, '—');
});

test('traded selections follow actual pick owners, including consecutive user selections', () => {
    const state = fixture();
    state.pickOrder[2] = { ...state.pickOrder[2], rosterId: '1', traded: true };
    const room = read(state);
    assert.equal(room.onClockRosterId, '1');
    assert.equal(room.nextUserPick.index, 3);
    assert.equal(room.nextUserPick.picksAway, 1);
    assert.equal(room.teamsById['1'].picksBeforeUser, 1);
    assert.equal(room.teamsById['3'].picksBeforeUser, 0);
    assert.equal(room.teamsById['1'].remainingPicks, 3);
});

test('a completed pick keeps its recorded owner when the order now differs', () => {
    const state = fixture();
    state.pickOrder[0] = { ...state.pickOrder[0], rosterId: 3 };
    state.picks[0].isUser = true; // An obsolete flag must not override actual ownership.
    const room = read(state);
    assert.equal(room.teamsById['1'].pickCount, 1);
    assert.equal(room.teamsById['3'].pickCount, 0);
});

test('snake labels use pick within round rather than draft slot', () => {
    const room = read(fixture());
    assert.equal(room.upcoming.find(p => p.slot.overall === 4).pickLabel, '2.01');
    assert.equal(room.upcoming.find(p => p.slot.overall === 6).pickLabel, '2.03');
});

test('multiple future picks before user are counted, not just distinct opponents', () => {
    const state = fixture();
    state.pickOrder[2] = { ...state.pickOrder[2], rosterId: 1 };
    state.pickOrder[3] = { ...state.pickOrder[3], rosterId: 1 };
    const room = read(state);
    assert.equal(room.nextUserPick.index, 8);
    assert.equal(room.teamsById['1'].picksBeforeUser, 4);
    assert.equal(room.teamsById['2'].picksBeforeUser, 2);
});

test('trading away every remaining selection gives no invented next user pick', () => {
    const state = fixture();
    state.pickOrder = state.pickOrder.map(slot => String(slot.rosterId) === '3' ? { ...slot, rosterId: 1 } : slot);
    const room = read(state);
    assert.equal(room.nextUserPick, null);
    assert.equal(room.teamsById['3'].nextPick, null);
    assert.equal(room.teamsById['3'].remainingPicks, 0);
    assert.equal(room.teamsById['1'].picksBeforeUser, null);
});

test('rookie needs track additions without pretending a rookie solves an existing hole', () => {
    const team = read(fixture()).teamsById['1'];
    assert.equal(team.startingLineup.known, false);
    assert.equal(team.needsBasis, 'Pre-draft roster needs');
    assert.deepEqual(team.needs.map(n => [n.pos, n.status, n.added]), [['RB', 'added', 1], ['TE', 'open', 0]]);
    assert.equal(team.needsKnown, true);
    assert.match(team.story, /TE needs/);
});

test('empty persona fallback does not claim a known balanced rookie roster', () => {
    const team = read(fixture()).teamsById['2'];
    assert.equal(team.needsKnown, false);
    assert.deepEqual(team.needs, []);
});

test('owner context supplies rookie needs when normalized persona has only empty defaults', () => {
    const state = fixture();
    state.draftContext.ownerContext = { 2: { roster: { needs: [{ pos: 'QB', urgency: 'thin' }] } } };
    const team = read(state).teamsById['2'];
    assert.equal(team.needsKnown, true);
    assert.equal(team.needs[0].pos, 'QB');
});

test('startup and redraft use actual additions and league lineup instead of veteran needs', () => {
    for (const variant of ['startup', 'redraft', 'best_ball']) {
        const team = read(fixture({ variant })).teamsById['1'];
        assert.equal(team.startingLineup.total, 6);
        assert.equal(team.startingLineup.filled, 1);
        assert.equal(team.startingLineup.open, 5);
        assert.equal(team.needsBasis, 'Open starting slots');
        assert.equal(team.needs.find(n => n.pos === 'RB').status, 'open'); // RB can still fill FLEX.
    }
});

test('overlapping flex slots never double count players and admit alternate positions', () => {
    const state = fixture({ variant: 'startup', currentIdx: 0 });
    state.draftContext.leagueFormat.rosterSlots = ['RB', 'FLEX', 'SUPER_FLEX', 'BN'];
    state.picks = [{ ...pool[0], overall: 1, rosterId: 1 }, { ...pool[1], overall: 2, rosterId: 1 }];
    let team = read(state).teamsById['1'];
    assert.equal(team.startingLineup.filled, 2);
    assert.equal(team.startingLineup.open, 1);
    assert.deepEqual(team.needs.map(n => n.pos).sort(), ['QB', 'RB', 'TE', 'WR']);
    state.picks.push({ ...pool[2], overall: 3, rosterId: 1 });
    team = read(state).teamsById['1'];
    assert.equal(team.startingLineup.filled, 3);
    assert.deepEqual(team.needs, []);
});

test('missing lineup settings remain unknown instead of inventing default roster rules', () => {
    const team = read(fixture({ variant: 'redraft', draftContext: {} })).teamsById['1'];
    assert.equal(team.startingLineup.known, false);
    assert.equal(team.needsKnown, false);
    assert.match(team.story, /unavailable/);
});

test('granular IDP slots do not invent eligibility from normalized DL or DB draft positions', () => {
    const state = fixture({ variant: 'startup', picks: [{ pid: 'defender', name: 'Defender', pos: 'DL', dhq: 800, overall: 1, rosterId: 1 }] });
    state.draftContext.leagueFormat.rosterSlots = ['QB', 'DE', 'DT', 'CB', 'S'];
    const team = read(state).teamsById['1'];
    assert.equal(team.startingLineup.known, false);
    assert.equal(team.startingLineup.filled, null);
    assert.match(team.startingLineup.reason, /IDP eligibility/);
    assert.equal(team.needsKnown, false);
    assert.deepEqual(team.needs, []);
    assert.deepEqual(team.positionCounts, { DL: 1 });
    assert.match(team.story, /1 DL/);
    assert.match(team.story, /IDP eligibility unavailable/);
});

test('value and grade use shared draft methodology with normalized player IDs', () => {
    const state = fixture();
    state.originalPool = [{ pid: 101, pos: 'RB', name: 'Numeric ID', dhq: 6800 }];
    state.picks = [{ pid: '101', pos: 'RB', name: 'Numeric ID', dhq: 6800, overall: 1, round: 1, rosterId: '1' }];
    const team = read(state).teamsById['1'];
    const expectedPicks = [{ ...state.picks[0], consensusRank: 1 }];
    const expected = stateHelpers.buildTeamRecaps(state, expectedPicks, stateHelpers.leagueTotalsFromPicks(expectedPicks)).find(team => team.rosterId === '1');
    assert.equal(team.grade.available, true);
    assert.equal(team.grade.score, expected.score);
    assert.equal(team.grade.letter, expected.grade);
    assert.equal(team.value.averageDelta, 0);
    assert.equal(team.value.biggestReach, null);
    assert.equal(team.value.bestPick, null);
});

test('team grades match the shared league grades including their room percentile term', () => {
    const state = fixture();
    const room = read(state);
    const recap = stateHelpers.buildTeamRecaps(state, state.picks, stateHelpers.leagueTotalsFromPicks(state.picks));
    for (const expected of recap.filter(team => team.picks.length)) {
        const grade = room.teamsById[String(expected.rosterId)].grade;
        assert.equal(grade.letter, expected.grade);
        assert.equal(grade.score, expected.score);
        assert.equal(grade.rank, expected.rank);
        assert.equal(grade.percentile, expected.percentile);
    }
});

test('incomplete room values do not produce a confident cross-team percentile grade', () => {
    const state = fixture();
    state.picks[1] = { ...state.picks[1], dhq: 0 };
    const grade = read(state).teamsById['1'].grade;
    assert.equal(grade.available, false);
    assert.equal(grade.letter, '—');
    assert.match(grade.reason, /league comparisons/);
});

test('pre-draft retains the scheduled order without claiming a manager is on the clock', () => {
    const state = fixture({ picks: [], currentIdx: 0, liveSync: { draftStatus: 'pre_draft', status: 'waiting' } });
    let room = read(state);
    assert.equal(room.awaitingStart, true);
    assert.equal(room.onClockRosterId, null);
    assert.equal(room.upcoming[0].rosterId, '1');
    assert.ok(room.teams.every(team => !team.isOnClock));
    state.liveSync = { draftStatus: 'drafting', status: 'mirroring' };
    room = read(state);
    assert.equal(room.awaitingStart, false);
    assert.equal(room.onClockRosterId, '1');
});

test('remote completion while final picks are still mirroring suppresses the clock but keeps grades provisional', () => {
    const room = read(fixture({ liveSync: { draftStatus: 'complete', status: 'complete' } }));
    assert.equal(room.onClockRosterId, null);
    assert.equal(room.isComplete, false);
    assert.equal(room.teamsById['1'].grade.provisional, true);
});

test('missing rank and zero DHQ never turn into a manufactured grade or value hit', () => {
    const state = fixture({ originalPool: [], picks: [{ pid: 'missing', name: 'Unmapped', rosterId: 1, overall: 1, dhq: 0 }] });
    const team = read(state).teamsById['1'];
    assert.equal(team.grade.available, false);
    assert.equal(team.grade.score, null);
    assert.equal(team.value.averageDelta, null);
    assert.equal(team.value.rankedPicks, 0);
});

test('recorded DHQ is preserved even when current pool values change', () => {
    const state = fixture();
    state.originalPool = state.originalPool.map(p => ({ ...p, dhq: 1 }));
    const team = read(state).teamsById['1'];
    assert.equal(team.grade.totalDHQ, 6800);
    assert.equal(team.lastPick.dhq, 6800);
});

test('changing personal board order cannot change opposing team value grades', () => {
    const state = fixture();
    const before = read(state).teamsById['1'];
    state.draftContext.boardContext = { activeLane: 'user', lanes: { user: { order: ['wr3', 'wr2', 'rb1'] } }, entries: { rb1: { userRank: 999 } } };
    const after = read(state).teamsById['1'];
    assert.deepEqual(after.grade, before.grade);
    assert.deepEqual(after.value, before.value);
});

test('actual My Board launch mutation keeps common DHQ value separate from the shared grade', () => {
    const ccSource = fs.readFileSync(path.join(root, 'js/draft/command-center.js'), 'utf8');
    const helper = ccSource.match(/function applyUserBigBoardOrder\(pool, leagueId, draftType\) \{[\s\S]*?\n    \}/);
    assert.ok(helper, 'the actual launch helper must be found');
    const launchContext = vm.createContext({ window: { DraftCC: { context: { _private: {
        loadStoredBoard: () => ({ activeLane: 'my', myOrder: ['wr3', 'wr2', 'te1', 'qb1', 'wr1', 'rb1'] }),
    } } } }, ccIsPro: () => true });
    vm.runInContext(helper[0] + '\nthis.reorder = applyUserBigBoardOrder;', launchContext);
    const reordered = plain(launchContext.reorder(plain(pool), 'test-league', 'rookie'));
    assert.equal(reordered[0].pid, 'wr3');
    assert.equal(reordered.find(p => p.pid === 'rb1').consensusRank, 6);
    const state = fixture({ originalPool: reordered });
    state.draftContext.boardContext = {
        activeLane: 'my',
        entries: Object.fromEntries(pool.map((p, i) => [p.pid, { pid: p.pid, dhqRank: i + 1, myRank: 6 - i }])),
        lanes: { dhq: { order: pool.map(p => p.pid) }, my: { order: reordered.map(p => p.pid) } },
    };
    state.picks = [{ ...reordered.find(p => p.pid === 'rb1'), overall: 1, round: 1, rosterId: '1' }];
    const room = read(state);
    const team = room.teamsById['1'];
    assert.equal(team.lastPick.consensusRank, 6, 'shared draft rank remains captured');
    assert.equal(team.lastPick.dhqRank, 1, 'common DHQ rank comes from saved canonical lane');
    assert.equal(team.lastPick.valueDelta, 0);
    assert.equal(team.value.source, 'Saved DHQ board');
    assert.match(team.grade.basis, /draft-time board ranks/);
    const shared = stateHelpers.buildTeamRecaps(state, state.picks, stateHelpers.leagueTotalsFromPicks(state.picks)).find(t => t.rosterId === '1');
    assert.equal(team.grade.letter, shared.grade);
    assert.equal(team.grade.score, shared.score);

    // A legacy resumed draft has no saved canonical lane: derive by DHQ value,
    // never accept the reordered array indices or overwritten consensus ranks.
    state.draftContext.boardContext = {};
    const legacy = read(state).teamsById['1'];
    assert.equal(legacy.lastPick.dhqRank, 1);
    assert.equal(legacy.value.averageDelta, 0);
    assert.equal(legacy.value.source, 'Draft-pool DHQ values');
});

test('canonical lane order works without entries and missing canonical ranks stay unknown', () => {
    const state = fixture();
    state.draftContext.boardContext = { lanes: { dhq: { order: ['wr1', 'rb1'] } } };
    let team = read(state).teamsById['1'];
    assert.equal(team.lastPick.dhqRank, 2);
    assert.equal(team.value.averageDelta, -1);
    state.picks[0] = { ...pool[2], overall: 1, rosterId: 1 };
    team = read(state).teamsById['1'];
    assert.equal(team.lastPick.dhqRank, null);
    assert.equal(team.value.averageDelta, null);
    assert.equal(team.grade.available, true, 'a known shared grade does not imply a known common-board value');
});

test('DHQ fallback ranks ignore personal order even when player values tie', () => {
    const state = fixture();
    state.originalPool = [{ pid: 'b', dhq: 200, consensusRank: 1 }, { pid: 'a', dhq: 200, consensusRank: 2 }];
    state.picks = [{ pid: 'b', dhq: 200, consensusRank: 1, overall: 1, rosterId: 1 }];
    const before = read(state).teamsById['1'].lastPick.dhqRank;
    state.originalPool.reverse();
    state.originalPool.forEach((p, i) => { p.consensusRank = i + 1; });
    assert.equal(read(state).teamsById['1'].lastPick.dhqRank, before);
    assert.equal(before, 2);
});

test('room pulse follows the most recent ordered picks and clears after an undo', () => {
    const state = fixture();
    state.picks = [1, 2, 3].map((overall, i) => ({ ...pool[1], pid: 'wr' + i, overall, rosterId: i + 1 }));
    state.picks.reverse();
    let room = read(state);
    assert.equal(room.pulse.leadingRun.pos, 'WR');
    assert.equal(room.pulse.leadingRun.count, 3);
    assert.equal(room.pulse.leadingRun.consecutive, 3);
    assert.equal(room.pulse.leadingRun.teamCount, 3);
    assert.equal(room.pulse.latestPick.overall, 3);
    state.picks = state.picks.filter(p => p.overall < 3);
    state.currentIdx = 2;
    room = read(state);
    assert.equal(room.pulse.leadingRun, null);
    assert.equal(room.pulse.latestPick.overall, 2);
    assert.equal(room.teamsById['3'].pickCount, 0);
    assert.equal(room.onClockRosterId, '3');
});

test('an owner correction moves the player and build to the corrected team', () => {
    const state = fixture();
    state.picks[0] = { ...state.picks[0], rosterId: 2 };
    const room = read(state);
    assert.equal(room.teamsById['1'].pickCount, 0);
    assert.equal(room.teamsById['2'].pickCount, 2);
    assert.deepEqual(room.teamsById['2'].positionCounts, { RB: 1, WR: 1 });
});

test('complete state suppresses clock and before-user signals without removing team builds', () => {
    const room = read(fixture({ phase: 'complete' }));
    assert.equal(room.isComplete, true);
    assert.equal(room.currentSlot, null);
    assert.equal(room.nextUserPick, null);
    assert.equal(room.onClockRosterId, null);
    assert.equal(room.upcoming.length, 0);
    assert.equal(room.teamsById['1'].pickCount, 1);
    assert.equal(room.teamsById['1'].grade.provisional, false);
});

test('auction mirrors builds without fabricated clock, future turns, or pick-order value grades', () => {
    const room = read(fixture({ variant: 'auction', draftMechanic: 'auction', auctionPoolSource: 'rookie' }));
    assert.equal(room.isRookie, true);
    assert.equal(room.onClockRosterId, null);
    assert.equal(room.nextUserPick, null);
    assert.equal(room.upcoming.length, 0);
    assert.equal(room.teamsById['1'].remainingPicks, null);
    assert.equal(room.teamsById['1'].grade.available, false);
    assert.equal(room.teamsById['1'].value.averageDelta, null);
    assert.equal(room.teamsById['1'].pickCount, 1);
});

test('unknown owners remain explicitly unknown and never borrow the user roster', () => {
    const state = fixture({ pickOrder: [], picks: [{ ...pool[0], overall: 1 }] });
    const room = read(state);
    assert.equal(room.teamsById.unknown.teamName, 'Unknown team');
    assert.equal(room.teamsById.unknown.isUser, false);
    assert.equal(room.teamsById['3'].pickCount, 0);
    assert.equal(room.teamsById['3'].remainingPicks, null);
});

test('a deeply frozen state is accepted and repeated calls are deterministic', () => {
    const state = freeze(fixture());
    assert.deepEqual(read(state), read(state));
    assert.deepEqual(state.picks.map(p => p.overall), [1, 2]);
});

test('pick analysis covers the latest pick, even after completion', () => {
    const state = fixture({ variant: 'redraft', phase: 'complete' });
    const take = engine.buildPickAnalysis(state);
    assert.equal(take.overall, 2);
    assert.match(take.text, /First Receiver/);
    assert.match(take.text, /covers another starting slot for Beta/);
});

test('a second QB in a single-QB lineup adds depth instead of claiming a new starter', () => {
    const state = fixture({ variant: 'redraft', draftContext: { leagueFormat: { rosterSlots: ['QB', 'RB', 'BN'] } }, picks: [
        { ...pool[2], overall: 1, rosterId: 1 },
        { pid: 'qb2', name: 'Second QB', pos: 'QB', overall: 2, rosterId: 1 },
    ] });
    const take = engine.buildPickAnalysis(state);
    assert.match(take.text, /without covering another starting slot/);
    assert.match(take.text, /Still to address: RB/);
    assert.match(take.text, /DHQ rank unavailable/);
});

test('delayed Alex commentary never attaches to a different pick', () => {
    const state = fixture({ alex: { stream: [
        { type: 'ai', relatedPickNo: 2, text: 'Correct selection.' },
        { type: 'ai', relatedPickNo: 1, text: 'Late response.' },
    ] } });
    assert.equal(engine.buildPickAnalysis(state).commentary, 'Correct selection.');
    state.alex.stream.shift();
    assert.equal(engine.buildPickAnalysis(state).commentary, null);
    assert.equal(engine.buildPickAnalysis(fixture({ picks: [] })), null);
});

test('auction analysis discusses the build without a snake rank comparison', () => {
    const take = engine.buildPickAnalysis(fixture({ variant: 'auction', draftMechanic: 'auction' }));
    assert.doesNotMatch(take.text, /DHQ rank|places ahead|places after/);
    assert.match(take.text, /Beta/);
});

test('pick analysis is deterministic and accepts immutable state', () => {
    const state = freeze(fixture({ variant: 'redraft' }));
    assert.deepEqual(plain(engine.buildPickAnalysis(state)), plain(engine.buildPickAnalysis(state)));
    assert.equal(state.picks.length, 2);
});

process.stdout.write('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exitCode = failed ? 1 : 0;
