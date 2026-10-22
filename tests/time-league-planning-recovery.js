'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'hidden-years', 'ai', 'actions', 'public-state']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueActions: A, TimeLeagueAI: AI, TimeLeaguePublicState: P } = App;
const stamp = '2026-10-21T00:00:00Z', later = '2026-10-21T01:00:00Z';
const scoring = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
const entry = (number, position, slot = position) => ({ entryId: `e${number}`, identity: `player:${position}:recovery-${number}`, name: `Player ${number}`,
    position, slot, drawnSeason: 2020, acquiredVia: 'draft', acquiredWeek: 1 });
const card = (number, position, points = 100) => ({ ...entry(number, position), peak: points, seasons: [{ season: 2020, games: 16, points }] });
function create(overrides = {}, count = 2) {
    const initial = E.createTimeLeague({ name: 'Planning recovery', seed: 'planning-recovery', createdAt: stamp,
        settings: { gameDeckVersion: 0, hiddenYears: false, rosterSlots: { RB: 1, WR: 1, BN: 2 }, maxQuarterbacks: 1,
            regularSeasonWeeks: 2, scoring, eraRules: { mode: 'any-era', decades: [] }, waiversEnabled: true, tradesEnabled: true,
            waiverMode: 'faab', faabBudget: 100, ...overrides },
        seats: Array.from({ length: count }, (_, index) => ({ name: index ? `Friend ${index}` : 'Host', manager: 'human' })) });
    return { ...initial, phase: 'season', weekStage: 'claims', seasonsRevealed: true,
        teams: initial.teams.map((team, index) => ({ ...team, roster: [entry(index * 10 + 1, 'RB'), entry(index * 10 + 2, 'WR'), entry(index * 10 + 3, 'WR', 'BN')] })) };
}
const dataFor = state => ({ cards: new Map([...state.teams.flatMap(team => team.roster).map(row => ({ ...row, peak: 10, seasons: [{ season: 2020, games: 16, points: 10 }] })), card(100, 'WR', 1000), card(101, 'RB', 900), card(102, 'WR', 800)].map(row => [row.identity, row])), logIndex: new Map(), eraFactors: new Map() });
const act = (state, action, data = dataFor(state), member = { role: 'commissioner', seat_team_id: 't1' }, now = later) => A.applyOnlineAction(state, action, member, data, now);
const reload = state => { const safe = E.normalizeTimeLeague(JSON.parse(JSON.stringify(state))); assert(safe); return safe; };
const gap = (stage = 'lineup') => {
    const state = create();
    return { ...state, weekStage: stage, teams: state.teams.map((team, index) => index ? team : { ...team, roster: [entry(1, 'WR', 'WR'), entry(2, 'WR', 'BN'), entry(3, 'WR', 'BN')] }) };
};
const claim = (number, position, dropEntryId, bidAmount = 1) => ({ type: 'claim', teamId: 't1', identity: card(number, position).identity, dropEntryId, bidAmount });
let passed = 0;
const test = (name, run) => { run(); passed++; console.log(`  ok ${name}`); };

test('legacy accepted rosters can reopen without reversing trades, awards, settings or prior results', () => {
    const base = gap('ready');
    const legacyTrade = { tradeId: 'tr1', fromTeamId: 't1', toTeamId: 't2', giveEntryIds: ['old-rb'], receiveEntryIds: ['e1'], week: 1, status: 'accepted', note: 'Legacy trade', createdAt: stamp, respondedWeek: 1 };
    const legacy = reload({ ...base, gateVotes: ['t1'], gateStartedAt: stamp, trades: [legacyTrade],
        waiverResults: [{ week: 1, identity: 'old-player', name: 'Old award', winnerTeamId: 't2', contenderTeamIds: ['t2'] }] });
    const recovery = E.planningRecovery(legacy);
    assert.deepEqual(recovery, { teams: [{ teamId: 't1', name: 'Host', problems: ['RB needs an eligible player'] }], available: true, reason: null, active: false });
    const before = JSON.stringify(legacy), next = act(legacy, { type: 'reopen-planning' });
    assert.equal(JSON.stringify(legacy), before, 'Opening recovery is a pure state transition');
    assert.equal(next.weekStage, 'claims'); assert.equal(next.planningRecoveryWeek, 1);
    for (const key of ['teams', 'trades', 'waiverResults', 'settings', 'finalizedWeeks', 'pendingClaims', 'draftPicks']) assert.deepEqual(next[key], legacy[key], `${key} survives reopening`);
    assert.deepEqual(next.gateVotes, []); assert.equal(next.gateStartedAt, later);
    assert.equal(next.activity.length, legacy.activity.length + 1);
    assert.equal(next.activity.at(-1).kind, 'league'); assert.match(next.activity.at(-1).message, /roster recovery for Host/);
    assert.equal(E.planningRecovery(next).active, true);
    assert.equal(E.reopenPlanning(next, later), next, 'A repeated opening cannot duplicate its event');
    assert.throws(() => act(next, { type: 'reopen-planning' }), /already open for roster recovery/);
});

test('a currently legal waiver drop can create a gap and recovery completes the real same-week loop', () => {
    let state = create(); const data = dataFor(state);
    assert.deepEqual(E.lineupProblems(state, 't1'), []);
    assert.equal(E.waiverLandingSlot(state, state.teams[0], 'WR', 'e1'), 'BN');
    state = act(state, claim(100, 'WR', 'e1', 7), data);
    state = reload(act(state, { type: 'process-claims' }, data));
    assert.equal(E.planningRecovery(state).available, true);
    assert.throws(() => act(state, { type: 'finalize-rosters' }, data), /Check Host/);
    const oldAwards = state.waiverResults.slice(), oldBudget = state.teams[0].faabRemaining;
    state = act(state, { type: 'reopen-planning' }, data);
    const drop = state.teams[0].roster.find(row => row.identity === card(100, 'WR').identity);
    state = act(state, claim(101, 'RB', drop.entryId, 5), data);
    state = reload(act(state, { type: 'process-claims' }, data));
    assert.equal(state.weekStage, 'lineup'); assert.equal(state.teams[0].faabRemaining, oldBudget - 5);
    assert.deepEqual(state.waiverResults.slice(0, oldAwards.length), oldAwards); assert.equal(state.waiverResults.length, oldAwards.length + 1);
    assert.equal(E.planningRecovery(state).available, false, 'A movable lineup gap no longer authorizes another acquisition pass');
    state = act(state, { type: 'auto-lineup', teamId: 't1' }, data);
    assert.deepEqual(E.lineupProblems(state, 't1'), []);
    state = act(state, { type: 'finalize-rosters' }, data);
    state = act(state, { type: 'week' }, data);
    assert.equal(state.currentWeek, 2); assert.equal(state.finalizedWeeks.length, 1);
    assert.throws(() => act(state, { type: 'reopen-planning' }, data), /only before kickoff/);
    state = act(state, { type: 'advance-week' }, data);
    assert.equal(state.planningRecoveryWeek, 1); assert.equal(E.planningRecovery(state).active, false, 'An old marker does not turn next week into recovery');
});

test('valid multi-claim plans may temporarily remove a required position before the later award restores it', () => {
    let state = create(); const data = dataFor(state);
    state = act(state, claim(100, 'WR', 'e1', 2), data);
    state = act(state, claim(101, 'RB', 'e3', 1), data);
    assert.equal(E.planningRecovery(state).available, false);
    state = act(state, { type: 'process-claims' }, data);
    assert.equal(state.waiverResults.length, 2); assert.equal(state.teams[0].faabRemaining, 97);
    assert.equal(E.rosterFeasibility(state.teams[0].roster, state.settings).legal, true);
    assert.equal(E.planningRecovery(state).available, false);
    state = act(state, { type: 'auto-lineup', teamId: 't1' }, data);
    assert.equal(act(state, { type: 'finalize-rosters' }, data).weekStage, 'ready');
});

test('only a human commissioner may reopen; majority and timed settings do not grant that authority', () => {
    for (const advancementMode of ['commissioner', 'majority', 'timed']) {
        const base = gap(), state = { ...base, settings: { ...base.settings, advancementMode } };
        for (const member of [{ role: 'member', seat_team_id: 't2' }, { role: 'commissioner' }, { role: 'commissioner', seat_team_id: 'missing' }]) {
            assert.throws(() => act(state, { type: 'reopen-planning' }, dataFor(state), member), member.role !== 'commissioner' ? /Only the commissioner/ : /Only a league manager/);
        }
        const aiSeat = { ...state, teams: state.teams.map((team, index) => index ? { ...team, manager: 'ai' } : team) };
        assert.throws(() => act(aiSeat, { type: 'reopen-planning' }, dataFor(state), { role: 'commissioner', seat_team_id: 't2' }), /Only a league manager/);
        assert.equal(act(state, { type: 'reopen-planning' }).weekStage, 'claims');
        if (advancementMode !== 'commissioner') assert.throws(() => act({ ...state, gateVotes: ['t1'] }, { type: advancementMode === 'majority' ? 'vote-advance' : 'timed-advance' }, dataFor(state), { role: 'member', seat_team_id: 't2' }, '2026-10-25T00:00:00Z'), /fill every starting lineup/);
    }
});

test('ordinary movable gaps, completed stages and disabled acquisitions cannot reopen planning', () => {
    const state = gap();
    for (const patch of [{ phase: 'draft' }, { phase: 'complete' }, { weekStage: 'claims' }, { weekStage: 'postgame' }]) {
        const invalid = { ...state, ...patch };
        assert.equal(E.planningRecovery(invalid).available, false); assert.equal(E.reopenPlanning(invalid, stamp), invalid);
    }
    const disabled = { ...state, settings: { ...state.settings, waiversEnabled: false, tradesEnabled: false } };
    assert.match(E.planningRecovery(disabled).reason, /both disabled/);
    for (const key of ['waiversEnabled', 'tradesEnabled']) assert.equal(E.planningRecovery({ ...disabled, settings: { ...disabled.settings, [key]: true } }).available, true);
    const movable = { ...state, teams: state.teams.map((team, index) => index ? team : { ...team, roster: [entry(1, 'RB', 'BN'), entry(2, 'WR'), entry(3, 'WR', 'BN')] }) };
    assert.equal(E.planningRecovery(movable).available, false); assert.match(E.planningRecovery(movable).reason, /lineup controls/);
    const scored = { ...state, finalizedWeeks: [{ week: 1, results: [], matchups: [], headlines: [] }] };
    assert.match(E.planningRecovery(scored).reason, /already been scored/); assert.equal(E.reopenPlanning(scored, stamp), scored);
});

test('regular byes still qualify but playoff observers cannot reopen for irrelevant roster gaps', () => {
    const regular = create({}, 3), bye = regular.teams.find(team => E.weekParticipation(regular, team.teamId).kind === 'bye');
    const byeGap = { ...regular, weekStage: 'lineup', teams: regular.teams.map(team => team.teamId === bye.teamId ? { ...team, roster: [] } : team) };
    assert.equal(E.planningRecovery(byeGap).available, true); assert.equal(E.planningRecovery(byeGap).teams[0].teamId, bye.teamId);
    const playoff = create({ regularSeasonWeeks: 1, playoffTeams: 2 }, 4);
    const round = { ...playoff, currentWeek: 2, weekStage: 'lineup' }, pair = E.playoffPairs(round, 2)[0];
    const observer = round.teams.find(team => !pair.includes(team.teamId));
    const observerGap = { ...round, teams: round.teams.map(team => team.teamId === observer.teamId ? { ...team, roster: [] } : team) };
    assert.deepEqual(E.planningRecovery(observerGap).teams, []); assert.equal(E.planningRecovery(observerGap).available, false);
    const activeGap = { ...round, teams: round.teams.map(team => team.teamId === pair[0] ? { ...team, roster: [] } : team) };
    assert.equal(E.planningRecovery(activeGap).available, true);
});

test('marker is optional, survives saved/public reloads, and never exposes hidden assigned years', () => {
    const untouched = reload(create()); assert(!Object.hasOwn(untouched, 'planningRecoveryWeek'));
    assert(!Object.hasOwn(P.projectPublicState(untouched, 't1', [], dataFor(untouched).cards), 'planningRecoveryWeek'));
    const state = act(gap(), { type: 'reopen-planning' });
    assert.equal(reload(state).planningRecoveryWeek, 1);
    const publicState = P.projectPublicState(state, 't1', [], dataFor(state).cards);
    assert.equal(publicState.planningRecoveryWeek, 1);
    assert.equal(E.normalizePublicTimeLeague(publicState).planningRecoveryWeek, 1);
    const guarded = gap(); guarded.settings = { ...guarded.settings, gameDeckVersion: 1, hiddenYears: true };
    for (const team of guarded.teams) for (const row of team.roster) {
        delete row.drawnSeason;
        Object.defineProperty(row, 'drawnSeason', { get() { throw Error('Recovery inspected an assigned year'); } });
    }
    for (const key of ['seed', 'privateDraws', 'privateGameDecks', 'hiddenYearAssignments', 'playerReports']) Object.defineProperty(guarded, key, { get() { throw Error(`Recovery inspected ${key}`); } });
    assert.equal(E.planningRecovery(guarded).available, true);
    for (const value of [null, -1, 0, 1.2, 20, '1']) assert(!Object.hasOwn(reload({ ...untouched, planningRecoveryWeek: value }), 'planningRecoveryWeek'));
});

test('recovery rounds do not repeat AI bids, generated offers, assets or budget charges', () => {
    let state = gap();
    state.teams[1] = { ...state.teams[1], manager: 'ai', aiPersona: 'gambler' };
    const data = dataFor(state), ordinary = AI.aiSubmitWaiverClaims({ ...state, weekStage: 'claims' }, data.cards, stamp);
    assert(ordinary.pendingClaims.some(row => row.teamId === 't2'), 'The fixture would ordinarily give the AI another automatic claim');
    state = act(state, { type: 'reopen-planning' }, data);
    const aiBefore = structuredClone(state.teams[1]), tradesBefore = structuredClone(state.trades), awardsBefore = structuredClone(state.waiverResults);
    state = act(state, { type: 'process-claims' }, data);
    assert.deepEqual(state.teams[1], aiBefore); assert.deepEqual(state.trades, tradesBefore); assert.deepEqual(state.waiverResults, awardsBefore);
    assert.equal(E.planningRecovery(state).available, true, 'A lost or missing repair can reopen again without resetting prior outcomes');
    state = act(state, { type: 'reopen-planning' }, data);
    state = act(state, { type: 'process-claims' }, data);
    assert.deepEqual(state.teams[1], aiBefore); assert.deepEqual(state.waiverResults, awardsBefore);
    assert.throws(() => act(state, { type: 'process-claims' }, data), /Open waiver planning/);
    const nextWeek = act({ ...state, currentWeek: 2, weekStage: 'claims' }, { type: 'process-claims' }, data);
    assert(nextWeek.waiverResults.some(row => row.week === 2 && row.winnerTeamId === 't2'), 'Ordinary automatic AI participation resumes when the marker is from a previous week');
    assert(nextWeek.teams[1].faabRemaining < aiBefore.faabRemaining);
});

test('reopening preserves already-filed claims and settles them once through the existing batch', () => {
    const base = gap();
    const pending = { claimId: 'w20', teamId: 't1', addIdentity: card(101, 'RB').identity, addName: 'Player 101', addPosition: 'RB', dropEntryId: 'e3', week: 1, bidAmount: 3 };
    const oldSave = reload({ ...base, pendingClaims: [pending] }); const data = dataFor(oldSave);
    const reopened = act(oldSave, { type: 'reopen-planning' }, data);
    assert.deepEqual(reopened.pendingClaims, oldSave.pendingClaims);
    const settled = act(reopened, { type: 'process-claims' }, data);
    assert.equal(settled.pendingClaims.length, 0); assert.equal(settled.teams[0].faabRemaining, 97);
    assert.equal(settled.waiverResults.length, 1); assert.equal(E.processWaivers(settled, data.cards, stamp), settled);
});

test('authoritative recommendation refresh preserves recovery trades and resumes in the next week', () => {
    const original = AI.aiGenerateTrades;
    let calls = 0;
    // A sentinel generated offer makes this an authority-boundary regression:
    // the guarded requests must never reach the recommendation generator.
    AI.aiGenerateTrades = state => {
        calls++;
        return { ...state, trades: [...state.trades, { tradeId: `tr${calls}`, fromTeamId: 't2', toTeamId: 't1', giveEntryIds: ['e11'], receiveEntryIds: ['e2'],
            week: state.currentWeek, status: 'pending', createdAt: stamp, note: 'Generated sentinel' }] };
    };
    try {
        const base = act(gap(), { type: 'reopen-planning' });
        for (const weekStage of ['claims', 'lineup']) {
            const state = { ...base, weekStage }, refreshed = act(state, { type: 'refresh-trade-offers' });
            assert.deepEqual(refreshed.trades, state.trades);
            assert.equal(refreshed.planningRecoveryWeek, state.planningRecoveryWeek);
            assert.equal(calls, 0, 'Old clients cannot generate another offer in either recovery stage');
        }
        const nextWeek = act({ ...base, currentWeek: 2, weekStage: 'claims' }, { type: 'refresh-trade-offers' });
        assert.equal(calls, 1); assert.equal(nextWeek.trades.length, base.trades.length + 1);
        assert.equal(nextWeek.trades.at(-1).note, 'Generated sentinel');
    } finally { AI.aiGenerateTrades = original; }
});

test('manual offers to AI still receive real responses during a trades-only recovery round', () => {
    let state = gap();
    state = { ...state, settings: { ...state.settings, waiversEnabled: false }, teams: state.teams.map((team, index) => index ? { ...team, manager: 'ai', aiPersona: 'gambler' } : team) };
    // The AI has a spare RB and benefits from the incoming receiver. The host
    // can repair its missing required RB without changing any old settled trade.
    state.teams[1].roster = [entry(11, 'RB'), entry(12, 'WR'), entry(13, 'RB', 'BN')];
    const data = dataFor(state); data.cards.set(state.teams[0].roster[1].identity, card(2, 'WR', 1000));
    state = act(state, { type: 'reopen-planning' }, data);
    state = act(state, { type: 'trade', teamId: 't1', toTeamId: 't2', giveEntryIds: ['e2'], receiveEntryIds: ['e13'] }, data);
    assert.equal(state.trades.at(-1).status, 'pending');
    state = act(state, { type: 'process-claims' }, data);
    assert.equal(state.trades.at(-1).status, 'accepted'); assert.equal(state.waiverResults.length, 0);
    assert.equal(E.rosterFeasibility(state.teams[0].roster, state.settings).legal, true);
    state = act(state, { type: 'auto-lineup', teamId: 't1' }, data);
    assert.equal(act(state, { type: 'finalize-rosters' }, data).weekStage, 'ready');
});

console.log(`PASS ${passed} planning recovery checks`);
