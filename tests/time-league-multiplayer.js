'use strict';
const assert = require('assert');
const fs = require('fs');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'player-cards', 'engine', 'ai', 'actions']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueActions: A, TimeLeaguePlayerCards: P, TimeLeagueSeason: S } = App;
const data = { cards: P.buildPlayerCardIndex(JSON.parse(fs.readFileSync('data/time-league/legacy-player-cards.json'))), logIndex: S.buildGameLogIndex(S.parseGameLogCsv(fs.readFileSync('data/time-league/nflverse-game-logs.csv', 'utf8')).logs), eraFactors: new Map() };
const host = { seat_team_id: 't1', role: 'commissioner' }, friend = { seat_team_id: 't2', role: 'member' };
let state = E.createTimeLeague({ name: 'Multiplayer QA', seed: 'friends-test', createdAt: '2026-09-07T00:00:00Z', seats: [{ name: 'Host', manager: 'human' }, { name: 'Friend', manager: 'human' }, { name: 'AI', manager: 'ai', aiPersona: 'steward' }], settings: { gameDeckVersion: 0, rosterSlots: { QB: 1, RB: 1, WR: 1, BN: 1 }, scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 }, maxQuarterbacks: 1, regularSeasonWeeks: 2, eraRules: { mode: 'any-era', decades: [] }, waiversEnabled: true, waiverMode: 'faab', faabBudget: 100, tradesEnabled: true, aiDifficulty: 'veteran' } });
state = E.startDraft(state, state.createdAt);
let passed = 0;
function test(name, fn) { fn(); console.log(`ok ${name}`); passed++; }
const run = (action, member = host) => A.applyOnlineAction(state, action, member, data, '2026-09-07T00:00:01Z');
test('friend cannot draft the host seat', () => assert.throws(() => run({ type: 'draft', identity: E.eraEligibleCards(state, data.cards)[0].identity }, friend), /turn/));
test('host cannot simulate a human seat', () => assert.throws(() => run({ type: 'ai-run' }), /legal/));
test('friend cannot advance AI or game weeks', () => { for (const type of ['ai-run', 'ai-pick', 'week']) assert.throws(() => run({ type }, friend), /commissioner/); });
test('queue and team identity are limited to owned seat', () => { for (const type of ['queue', 'team', 'lineup', 'auto-lineup', 'claim', 'trade']) assert.throws(() => run({ type, teamId: 't1' }, friend), /own team/); });
test('draft waiver probes cannot disclose hidden era eligibility', () => {
  const blockedPool = new Map();
  blockedPool.values = () => { throw new Error('Hidden era pool was consulted'); };
  for (const identity of ['eligible-player', 'outside-era-player', 'missing-player']) {
    assert.throws(() => A.applyOnlineAction({ ...state, weekStage: 'claims' },
      { type: 'claim', teamId: 't1', identity }, host, { ...data, cards: blockedPool }, state.createdAt),
    /^Error: Waiver claims open during the season\.$/);
  }
});
test('friend can rename their team', () => { state = run({ type: 'team', teamId: 't2', name: 'Second Player' }, friend); assert.equal(state.teams[1].name, 'Second Player'); assert.equal(state.teams[0].name, 'Host'); });
test('friend can save a new club mark and initials without changing another team', () => {
  const hostHelmet = JSON.stringify(state.teams[0].helmet);
  const helmet = { ...App.TimeLeagueHelmet.presetHelmet('ice-wolves'), monogram: 'ICE' };
  state = run({ type: 'team', teamId: 't2', name: 'Second Player', helmet }, friend);
  const restored = E.normalizeTimeLeague(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.teams[1].helmet.decal, 'wolf');
  assert.equal(restored.teams[1].helmet.monogram, 'ICE');
  assert.equal(JSON.stringify(state.teams[0].helmet), hostHelmet);
});
test('draft across two humans and AI completes without stealing a turn', () => {
  while (state.phase === 'draft') {
    const seat = E.currentDraftSeat(state);
    if (seat.teamId === 't3') { state = run({ type: 'ai-run' }); continue; }
    const member = seat.teamId === 't1' ? host : friend;
    const card = E.eraEligibleCards(state, data.cards).find(c => E.applyDraftPick(state, c, { madeBy: 'human', createdAt: '' }) !== state);
    state = run({ type: 'draft', identity: card.identity }, member);
  }
  assert.equal(state.draftPicks.length, 12);
  assert(state.teams.every(t => t.roster.length === 4));
});
test('both managers can set their own lineups', () => { state = run({ type: 'auto-lineup', teamId: 't1' }); state = run({ type: 'auto-lineup', teamId: 't2' }, friend); });
test('trade recipient alone can accept', () => {
  // This checks ownership and gate authorization. A same-position exchange
  // stays roster-legal regardless of changing player rankings or draft order.
  const give = state.teams[0].roster.find(entry => entry.position === 'QB');
  const receive = state.teams[1].roster.find(entry => entry.position === 'QB');
  assert(give && receive, 'Both teams drafted a starting quarterback');
  state = run({ type: 'trade', teamId: 't1', toTeamId: 't2', giveEntryIds: [give.entryId], receiveEntryIds: [receive.entryId], note: 'Trade QA' });
  const tradeId = state.trades.at(-1).tradeId;
  assert.throws(() => run({ type: 'respond-trade', tradeId, accept: true }, friend), /after waivers/);
  assert.throws(() => run({ type: 'ping-ai' }), /after waivers/);
  state = { ...state, weekStage: 'lineup' };
  assert.throws(() => run({ type: 'respond-trade', tradeId, accept: true }), /receiving manager/);
  state = run({ type: 'respond-trade', tradeId, accept: true }, friend);
  assert.equal(state.trades.at(-1).status, 'accepted');
  state = { ...state, weekStage: 'claims' };
});
test('AI trade responses wait for final decisions', () => {
  const original = state;
  state = run({ type: 'trade', teamId: 't1', toTeamId: 't3', giveEntryIds: [state.teams[0].roster[0].entryId], receiveEntryIds: [state.teams[2].roster[0].entryId], note: 'AI gate QA' });
  const id = state.trades.at(-1).tradeId;
  assert.throws(() => run({ type: 'ping-ai' }), /after waivers/);
  state = { ...state, weekStage: 'lineup' };
  state = run({ type: 'ping-ai' });
  assert.notEqual(state.trades.find(t => t.tradeId === id).status, 'pending');
  state = original;
});
test('cannot cancel another manager claim', () => {
  state = { ...state, weekStage: 'claims' };
  const card = E.freeAgents(state, data.cards).find(c => c.position === 'WR');
  state = run({ type: 'claim', teamId: 't2', identity: card.identity, dropEntryId: state.teams[1].roster.find(e => e.position !== 'QB').entryId, bidAmount: 4 }, friend);
  const claimId = state.pendingClaims.at(-1).claimId;
  assert.throws(() => run({ type: 'cancel-claim', claimId }), /another manager/);
});
test('majority and timer gates authorize advances without granting commissioner powers', () => {
  state = E.autoFillLineup(E.autoFillLineup(state, 't1', data.cards), 't2', data.cards);
  const original = state;
  state = { ...state, weekStage: 'lineup', settings: { ...state.settings, advancementMode: 'majority' }, gateVotes: [] };
  state = run({ type: 'vote-advance' }, friend);
  assert.equal(state.weekStage, 'lineup');
  state = run({ type: 'vote-advance' }, friend);
  assert.equal(state.gateVotes.length, 1);
  state = run({ type: 'vote-advance' });
  assert.equal(state.weekStage, 'ready');
  assert.deepEqual(state.gateVotes, []);
  state = { ...state, weekStage: 'lineup', settings: { ...state.settings, advancementMode: 'timed', gateHours: 1 }, gateStartedAt: '2026-09-07T00:00:00Z' };
  assert.throws(() => run({ type: 'timed-advance' }, friend), /deadline/);
  state.gateStartedAt = '2026-09-06T00:00:00Z';
  state = run({ type: 'timed-advance' }, friend);
  assert.equal(state.weekStage, 'ready');
  state = original;
});
test('commissioner controls settings and reopening while invalid lineups cannot finalize', () => {
  const original = state;
  assert.throws(() => run({ type: 'gate-settings', advancementMode: 'timed', gateHours: 2 }, friend), /commissioner/);
  state = run({ type: 'gate-settings', advancementMode: 'timed', gateHours: 2 });
  assert.equal(state.settings.gateHours, 2);
  assert.equal(state.gateStartedAt, '2026-09-07T00:00:01Z');
  state = { ...state, weekStage: 'ready' };
  assert.throws(() => run({ type: 'reopen-lineups' }, friend), /commissioner/);
  state = run({ type: 'reopen-lineups' });
  state = { ...state, teams: state.teams.map((t, i) => i ? t : { ...t, roster: [] }) };
  assert.throws(() => run({ type: 'finalize-rosters' }), /fill every/);
  state = original;
});
test('shared game weeks settle through a champion with real historical logs', () => {
  while (state.phase === 'season') {
    if (state.weekStage === 'postgame') {
      const rosters = JSON.stringify(state.teams);
      assert.throws(() => run({ type: 'week', force: true }), /planning/);
      assert.throws(() => run({ type: 'advance-week' }, friend), /commissioner/);
      state = run({ type: 'advance-week' });
      assert.equal(JSON.stringify(state.teams), rosters);
    }
    if (state.weekStage === 'claims') {
      state = run({ type: 'process-claims' });
      assert.equal(state.pendingClaims.length, 0);
      assert.equal(state.weekStage, 'lineup');
      assert.throws(() => run({ type: 'week' }), /planning/);
      state = E.autoFillLineup(E.autoFillLineup(state, 't1', data.cards), 't2', data.cards);
      state = run({ type: 'finalize-rosters' });
      assert.equal(state.weekStage, 'ready');
      assert.throws(() => run({ type: 'process-claims' }), /planning/);
    }
    state = run({ type: 'week', force: true });
    assert.equal(state.weekStage, 'postgame');
  }
  assert.equal(state.phase, 'complete'); assert.equal(state.finalizedWeeks.length, 2); assert(state.championTeamId);
  assert(state.finalizedWeeks.some(w => w.results.some(r => r.total > 0)));
});
console.log(`PASS: ${passed} multiplayer tests`);
