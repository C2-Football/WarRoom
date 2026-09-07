#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function buildCtx() {
  const ctx = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    Date,
    window: null,
  };
  ctx.window = ctx;
  ctx.DraftCC = {};
  ctx.App = {
    PlayerValue: {
      projectPlayerValue: (_pid, dhq, _age, _pos, years) => Math.round(dhq * (1 + years * 0.08)),
    },
  };
  return vm.createContext(ctx);
}

function load(ctx, relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(source, ctx, { filename: relPath });
}

const ctx = buildCtx();
load(ctx, 'js/draft/live-decision-engine.js');

const pool = [
  { pid: 'rb1', name: 'Rocket Back', pos: 'RB', dhq: 5000, age: 21, tier: 1 },
  { pid: 'wr1', name: 'Safe Wideout', pos: 'WR', dhq: 4800, age: 24, tier: 1 },
  { pid: 'qb1', name: 'Risky Quarterback', pos: 'QB', dhq: 4700, age: 35, tier: 2 },
  { pid: 'te1', name: 'Tier Tight End', pos: 'TE', dhq: 4300, age: 22, tier: 1 },
];

const baseState = {
  mode: 'live-sync',
  currentIdx: 0,
  userRosterId: 7,
  userSlot: 7,
  draftedPids: {},
  pool,
  pickOrder: [
    { overall: 1, round: 1, slot: 1, rosterId: 1 },
    { overall: 2, round: 1, slot: 2, rosterId: 2 },
    { overall: 3, round: 1, slot: 3, rosterId: 3 },
    { overall: 4, round: 1, slot: 4, rosterId: 7 },
  ],
  personas: {
    1: {
      rosterId: 1,
      teamName: 'Owner One',
      ownerIntel: {
        confidence: { overall: 'high' },
        reasonCodes: [{ code: 'draft_position_bias', detail: 'Owner One has chased RB in early rounds.' }],
      },
    },
    7: {
      rosterId: 7,
      teamName: 'You',
      assessment: { needs: [{ pos: 'RB', urgency: 'critical' }] },
    },
  },
  draftContext: {
    boardContext: {
      activeLane: 'my',
      lanes: {
        dhq: { order: ['rb1', 'wr1', 'qb1', 'te1'] },
        ai: { order: ['rb1', 'te1', 'wr1', 'qb1'] },
        my: { order: ['wr1', 'rb1', 'qb1', 'te1'] },
      },
      entries: {
        rb1: { pid: 'rb1', myRank: 2, dhqRank: 1, tier: 1, tag: 'target', target: true },
        wr1: { pid: 'wr1', myRank: 1, dhqRank: 2, tier: 1 },
        qb1: { pid: 'qb1', myRank: 3, dhqRank: 3, tier: 2, tag: 'fade', fade: true },
        te1: { pid: 'te1', myRank: 4, dhqRank: 4, tier: 1 },
      },
    },
  },
};

console.log('\nWar Room live decision engine contract');

test('buildDecisionDeck returns live pick cards from board, need, and projection context', () => {
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(baseState);
  eq(deck.schemaVersion, 'draft-live-decision-v1', 'schema');
  ok(deck.cards.find(c => c.kind === 'recommended'), 'recommended card');
  ok(deck.cards.find(c => c.kind === 'safe'), 'safe card');
  ok(deck.cards.find(c => c.kind === 'upside'), 'upside card');
  eq(deck.assumptions.boardLane, 'my', 'active board lane');
});

test('target survival and owner tendency alerts use live room context', () => {
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(baseState);
  ok(deck.alerts.some(a => a.type === 'target_survival'), 'target survival alert');
  ok(deck.alerts.some(a => a.type === 'owner_tendency'), 'owner tendency alert');
});

test('avoid card respects user-board fade markers', () => {
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(baseState);
  const avoid = deck.cards.find(c => c.kind === 'avoid');
  ok(avoid, 'avoid card');
  eq(avoid.player.pid, 'qb1', 'fade player selected');
  ok(avoid.detail.includes('User-board'), 'avoid reason');
});

test('trade window becomes a live trade card', () => {
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(baseState, {
    tradeWindow: {
      rosterId: 2,
      teamName: 'Owner Two',
      likelihood: 71,
      acceptanceLine: 64,
    },
  });
  const trade = deck.cards.find(c => c.kind === 'trade_down');
  ok(trade, 'trade card');
  eq(trade.action, 'trade', 'trade action');
  ok(trade.detail.includes('Owner Two'), 'trade detail names partner');
});

test('liveTradeEvolutionSignal buckets trades by round and classifies the room', () => {
  const fn = ctx.DraftCC.liveDecisionEngine.liveTradeEvolutionSignal;
  ok(typeof fn === 'function', 'helper exported');

  const quiet = fn({ ...baseState, leagueSize: 12, rounds: 5, currentIdx: 30, completedTrades: [], draftTuning: { tradeActivity: 50 } });
  eq(quiet.totalTrades, 0, 'no trades counted');
  eq(quiet.currentRound, 3, 'currentRound from currentIdx/leagueSize+1');
  eq(quiet.draftClass, 'quiet', 'empty board past 2 rounds reads quiet');

  const heavy = fn({
    ...baseState, leagueSize: 12, rounds: 5, currentIdx: 14,
    draftTuning: { tradeActivity: 50 },
    completedTrades: [
      { acceptedAt: 1, targetRosterId: 2 },
      { acceptedAt: 3, fromRosterId: 4 },
      { acceptedAt: 13, fromRosterId: 5 },
    ],
  });
  eq(heavy.totalTrades, 3, 'all valid trades counted');
  eq(heavy.byRound[1], 2, 'two trades bucketed into round 1 (idx 1,3)');
  eq(heavy.byRound[2], 1, 'one trade bucketed into round 2 (idx 13)');
  eq(heavy.draftClass, 'heavy', 'three early deals reads heavy');

  const typical = fn({
    ...baseState, leagueSize: 12, rounds: 5, currentIdx: 26,
    draftTuning: { tradeActivity: 50 },
    completedTrades: [{ acceptedAt: 5, fromRosterId: 2 }],
  });
  eq(typical.draftClass, 'typical', 'one deal over ~3 rounds reads typical');
});

test('redraft forecasts consume picks in real order without mutating live state', () => {
  const state = { ...baseState, variant: 'redraft', leagueSize: 4, originalPool: pool, picks: [],
    draftContext: { ...baseState.draftContext, leagueFormat: { rosterSlots: ['QB', 'RB', 'WR', 'TE'] } } };
  const before = JSON.stringify(state);
  const read = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state);
  eq(read.forecasts.length, 3, 'three opponents before our pick');
  eq(new Set(read.forecasts.map(f => f.player.pid)).size, 3, 'no repeated single-copy players');
  eq(read.forecasts[0].rosterId, '1', 'real owner sequence');
  eq(read.survivors.length, 1, 'projected picks excluded from survivors');
  eq(JSON.stringify(state), before, 'does not mutate actual picks or pool');
  ok(read.fullHorizon, 'forecast reaches our turn');
  const picked = read.forecasts[0].player;
  const updated = { ...state, currentIdx: 1, picks: [{ ...picked, rosterId: 1, overall: 1 }], draftedPids: { [picked.pid]: 1 } };
  const next = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(updated);
  ok(!next.forecasts.some(f => f.player.pid === picked.pid), 'real drafted player cannot be forecast again');
  ok(next.commentary[0].includes(picked.name), 'commentary follows real pick');
});

test('redraft decisions suppress dynasty projections and trade advice', () => {
  const state = { ...baseState, variant: 'redraft', originalPool: pool, picks: [], leagueSize: 4 };
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state, { tradeWindow: { rosterId: 2, likelihood: 90, acceptanceLine: 70 } });
  ok(deck.seasonal, 'seasonal presentation');
  ok(!deck.cards.some(c => c.action === 'trade'), 'no trade card');
  ok(!deck.cards.some(c => /five-year/.test(c.detail)), 'no dynasty copy');
  deck.cards.filter(c => c.player).forEach(c => eq(c.player.y5, c.player.dhq, 'no five-year growth weighting'));
  eq(ctx.DraftCC.liveDecisionEngine.buildLiveReadout(state).outlier, null, 'no trade-up outlier');
  eq(ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead({ ...state, mode: 'solo' }), null, 'mock unaffected');
  eq(ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead({ ...state, draftMechanic: 'auction' }).forecasts.length, 0, 'no fabricated auction selection order');
});

test('redraft forecast respects copies and marks incomplete horizons', () => {
  const state = { ...baseState, variant: 'redraft', playerCopies: 2, pool: [pool[0]], originalPool: [pool[0]], picks: [], draftedPids: {} };
  const read = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state);
  eq(read.forecasts.length, 2, 'two available copies');
  eq(read.fullHorizon, false, 'no unsupported next-turn survival claim');
});

test('redraft predictions respond to market ADP and filled starting slots', () => {
  const players = [{ pid: 'q', name: 'Quarterback', pos: 'QB', dhq: 5000 }, { pid: 'r', name: 'Running Back', pos: 'RB', dhq: 5000 }];
  const state = { ...baseState, variant: 'redraft', currentIdx: 0, pool: players, originalPool: players, picks: [],
    draftContext: { leagueFormat: { rosterSlots: ['QB', 'RB'] } } };
  ctx.App.getRedraftAdp = pid => ({ adp: pid === 'q' ? 1 : 100 });
  eq(ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state).forecasts[0].player.pid, 'q', 'earlier ADP leads');
  ctx.App.getRedraftAdp = () => ({ adp: 1 });
  const built = { ...state, picks: [{ pid: 'other', name: 'Existing QB', pos: 'QB', rosterId: '1', overall: 0 }] };
  eq(ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(built).forecasts[0].player.pid, 'r', 'actual filled QB slot steers to RB');
  delete ctx.App.getRedraftAdp;
});

test('overlapping flex slots use each player once and recognize a second QB', () => {
  const state = { draftContext: { leagueFormat: { rosterSlots: ['QB', 'WR', 'FLEX', 'SUPER_FLEX', 'BN'] } } };
  const fit = ctx.DraftCC.liveDecisionEngine.lineupFit;
  eq(fit(state, { QB: 1, WR: 2 }).filled, 3, 'three players fill exactly three slots');
  eq(fit(state, { QB: 1, WR: 2 }, 'QB').filled, 4, 'second QB fits superflex');
  eq(fit(state, { QB: 2, WR: 2 }, 'QB').filled, 4, 'third QB adds no starter');
  eq(fit(state, { WR: 2, QB: 2 }).filled, 4, 'assignment is independent of count key order');
});

test('target tracking names threats and offers an available replacement after a pick', () => {
  const state = { ...baseState, variant: 'redraft', originalPool: pool, picks: [], redraftBroadcast: { watchPids: ['rb1'] } };
  const read = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state);
  const watch = read.watch.find(w => w.player.pid === 'rb1');
  ok(watch.threats.length, 'target has identified opposing managers');
  const selected = { ...pool[0], rosterId: 1, overall: 1, source: 'live-sync' };
  const updated = { ...state, currentIdx: 1, picks: [selected], draftedPids: { rb1: 1 }, pool: pool.slice(1) };
  const next = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(updated);
  const taken = next.watch.find(w => w.player.pid === 'rb1');
  eq(taken.risk, 'Taken', 'taken target stays visible');
  ok(taken.backup && taken.backup.pid !== 'rb1', 'replacement remains available');
  ok(!next.shortlist.some(p => p.pid === 'rb1'), 'shortlist excludes lost target');
  const own = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead({ ...updated, picks: [{ ...selected, rosterId: 7 }] });
  eq(own.watch.find(w => w.player.pid === 'rb1').risk, 'Yours', 'your pick is celebrated rather than warned');
});

function fitState(overrides = {}) {
  const available = [
    { pid: 'extra_q1', name: 'Expensive QB', pos: 'QB', dhq: 90000 },
    { pid: 'extra_q2', name: 'Another Expensive QB', pos: 'QB', dhq: 80000 },
    { pid: 'useful_r', name: 'Useful Running Back', pos: 'RB', dhq: 3600 },
    { pid: 'useful_w', name: 'Useful Receiver', pos: 'WR', dhq: 3300 },
    { pid: 'useful_w2', name: 'Receiver Depth', pos: 'WR', dhq: 2900 },
    { pid: 'useful_t', name: 'Useful Tight End', pos: 'TE', dhq: 2700 },
    { pid: 'useful_k', name: 'Starting Kicker', pos: 'K', dhq: 600 },
    { pid: 'useful_d', name: 'Starting Defense', pos: 'DEF', dhq: 500 },
  ];
  return {
    mode: 'live-sync', variant: 'redraft', phase: 'drafting', userRosterId: 7, leagueSize: 4, currentIdx: 2,
    pool: available, originalPool: available, draftedPids: {},
    picks: [{ pid: 'my_q1', name: 'My QB', pos: 'QB', dhq: 5000, rosterId: '7', overall: 1 },
      { pid: 'my_q2', name: 'My Other QB', pos: 'QB', dhq: 4000, rosterId: 7, overall: 2 }],
    pickOrder: Array.from({ length: 48 }, (_, i) => ({ overall: i + 1, rosterId: i % 4 === 3 ? 7 : i % 4 + 1, round: Math.floor(i / 4) + 1 })),
    draftContext: { leagueFormat: { rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'] } },
    ...overrides,
  };
}

test('a 1QB team with two QBs never recommends surplus high-DHQ QBs on any route', () => {
  const state = fitState();
  state.redraftBroadcast = { watchPids: ['extra_q1', 'extra_q2'] };
  const engine = ctx.DraftCC.liveDecisionEngine;
  const deck = engine.buildDecisionDeck(state);
  eq(deck.cards.length, 3, 'three useful choices remain');
  ok(deck.cards.every(c => c.player.pos !== 'QB'), 'all card types reject surplus QBs even at 25x DHQ');
  eq(new Set(deck.cards.map(c => c.player.pid)).size, deck.cards.length, 'choices are distinct');
  ok(deck.cards.every(c => c.meta.rosterFit.reason && c.meta.rosterFit.opportunityCost), 'each pick has an explainable cost');
  const read = engine.buildRedraftRoomRead(state);
  ok(read.shortlist.every(p => p.pos !== 'QB'), 'watch list cannot inject surplus QB into recommendations');
  ok(read.survivors.every(p => p.pos !== 'QB'), 'projected survivors are useful to this roster');
  eq(read.watch.length, 2, 'explicitly watched players remain observable');
  eq(deck.rosterPlan.positions.find(p => p.pos === 'QB').status, 'set', 'QB group is covered');
});

test('a third QB remains surplus in 1QB while RB/WR bench depth stays useful', () => {
  const state = fitState();
  state.picks.push({ pid: 'my_q3', pos: 'QB', rosterId: 7, overall: 3 });
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  ok(deck.cards.every(c => c.player.pos !== 'QB'), 'no fourth QB');
  eq(deck.rosterPlan.counts.QB, 3, 'real recorded group count');
});

test('needed low-ranked starters are evaluated before any board-pocket truncation', () => {
  const state = fitState();
  state.pool = Array.from({ length: 60 }, (_, i) => ({ pid: 'q' + i, name: 'QB ' + i, pos: 'QB', dhq: 90000 - i }));
  state.pool.push({ pid: 'late_wr', name: 'Late Receiver', pos: 'WR', dhq: 1000 });
  state.originalPool = state.pool;
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  eq(deck.cards[0].player.pid, 'late_wr', 'needed WR beyond first40 is found');
  eq(deck.cards.length, 1, 'no manufactured duplicate alternatives');
});

test('remaining pick deadlines reserve the lineup slots even when backups have much larger values', () => {
  const state = fitState();
  state.picks = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE'].map((pos, i) => ({ pid: 'owned' + i, pos, rosterId: 7, overall: i + 1 }));
  state.currentIdx = 7;
  state.pickOrder = Array.from({ length: 9 }, (_, i) => ({ overall: i + 1, rosterId: 7 }));
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  eq(deck.rosterPlan.mustFillStarters, true, 'K and DEF with exactly2 picks');
  eq(deck.rosterPlan.remainingPicks, 2, 'actual remaining owned picks');
  ok(deck.cards.length === 2 && deck.cards.every(c => ['K', 'DEF'].includes(c.player.pos)), 'only missing required slots are recommended');
  ok(deck.cards.every(c => c.detail.includes('remaining picks')), 'deadline explained');
});

test('full starting coverage redirects choices to useful depth instead of another 1QB starter', () => {
  const state = fitState();
  state.picks = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'K', 'DEF'].map((pos, i) => ({ pid: 'full' + i, pos, rosterId: 7, overall: i + 1 }));
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  eq(deck.rosterPlan.openSlots.length, 0, 'starting lineup filled');
  ok(['RB', 'WR'].includes(deck.cards[0].player.pos), 'bench skill flexibility leads');
  ok(deck.cards.every(c => !['QB', 'K', 'DEF'].includes(c.player.pos)), 'no redundant specialists');
});

test('superflex still recommends a second starting QB, even when a skill player currently covers SF', () => {
  const state = fitState();
  state.draftContext.leagueFormat.rosterSlots = ['QB', 'RB', 'WR', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN'];
  state.picks = ['QB', 'RB', 'WR', 'WR'].map((pos, i) => ({ pid: 'sf' + i, pos, rosterId: 7, overall: i + 1 }));
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  eq(deck.rosterPlan.filled, 4, 'SF already legally covered');
  eq(deck.cards[0].player.pos, 'QB', 'second QB remains useful');
  ok(deck.cards[0].meta.rosterFit.starterUpgrade, 'identifies starting upgrade');
  ok(!deck.cards[0].detail.includes('backup'), 'does not call QB2 a backup');
});

test('explicit positional caps are honored even when a flexible slot could use that position', () => {
  const state = fitState({ positionLimits: { RB: 0 } });
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  ok(deck.cards.every(c => c.player.pos !== 'RB'), 'explicit zero cap blocks RB');
  eq(deck.rosterPlan.positions.find(p => p.pos === 'RB').status, 'blocked', 'cap explained');
});

test('keeper rosters deduplicate actual picks and normalized player IDs', () => {
  const state = fitState();
  state.picks = [{ pid: '101', pos: 'QB', rosterId: '7', overall: 1 }];
  state.originalPool = [...state.pool, { pid: 101, pos: 'QB', dhq: 4000 }, { pid: 102, pos: 'WR', dhq: 2000 }];
  state.draftContext.leagueFormat.flags = { keeper: true };
  state.draftContext.teamContext = { currentRoster: [101, '101', 102] };
  const plan = ctx.DraftCC.liveDecisionEngine.buildRosterPlan(state);
  eq(plan.counts.QB, 1, 'keeper + mirrored draft record counted once');
  eq(plan.counts.WR, 1, 'unmirrored keeper counted');
  eq(plan.rosterSize, 2, 'actual roster size deduplicated');
});

test('regular redraft does not import an old previous-season roster as keepers', () => {
  const state = fitState({ picks: [] });
  state.draftContext.teamContext = { currentRoster: ['extra_q1'] };
  const plan = ctx.DraftCC.liveDecisionEngine.buildRosterPlan(state);
  eq(plan.counts.QB || 0, 0, 'unflagged old roster ignored');
  eq(plan.positions.find(p => p.pos === 'QB').status, 'need', 'unfilled QB remains available');
});

test('unknown keeper positions or lineup settings do not invent a full position group', () => {
  const state = fitState({ picks: [], draftContext: { leagueFormat: { flags: { keeper: true } }, teamContext: { currentRoster: ['unresolved'] } } });
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  eq(deck.rosterPlan.known, false, 'unknown roster knowledge');
  ok(deck.cards.some(c => c.player.pos === 'QB'), 'QB not arbitrarily hidden');
  ok(deck.cards.every(c => c.meta.rosterFit.status === 'unknown'), 'unknown fit explained');
});

test('placeholder and unrecognized drafted positions leave roster fit unknown', () => {
  for (const pos of ['?', 'UNKNOWN', 'unrecognized']) {
    const state = fitState({ picks: [{ pid: 'metadata_missing', pos, rosterId: 7, overall: 1 }] });
    const plan = ctx.DraftCC.liveDecisionEngine.buildRosterPlan(state);
    eq(plan.known, false, 'placeholder is not real position data');
    eq(plan.unknownPlayers, 1, 'missing metadata counted');
    eq(Object.keys(plan.counts).length, 0, 'placeholder not added to position build');
    eq(plan.rosterSize, 1, 'actual rostered player still counts for capacity');
    ok(plan.positions.filter(p => p.starterCapacity > 0).every(p => p.status === 'unknown'), 'no invented known starter holes');
  }
});

test('valid player metadata can resolve a placeholder draft position', () => {
  const prior = ctx.S;
  ctx.S = { players: { resolved_qb: { position: 'QB' } } };
  try {
    const plan = ctx.DraftCC.liveDecisionEngine.buildRosterPlan(fitState({ picks: [{ pid: 'resolved_qb', pos: '?', rosterId: 7, overall: 1 }] }));
    eq(plan.known, true, 'real player metadata resolves draft placeholder');
    eq(plan.counts.QB, 1, 'resolved QB covers group');
  } finally { if (prior === undefined) delete ctx.S; else ctx.S = prior; }
});

test('watched and taken QB backup advice cannot suggest another surplus QB', () => {
  const state = fitState();
  state.redraftBroadcast = { watchPids: ['extra_q1'] };
  let watched = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state).watch[0];
  ok(watched.backup && watched.backup.pos !== 'QB', 'watchedQB backup is a useful roster alternative');
  state.picks.push({ ...state.pool[0], rosterId: 1, overall: 3 });
  watched = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state).watch[0];
  eq(watched.risk, 'Taken', 'taken target remains visible');
  ok(watched.backup && watched.backup.pos !== 'QB', 'lostQB backup is still useful for actual roster');
});

test('missing or unresolved viewer identity is unknown, not a completed draft roster', () => {
  for (const userRosterId of [null, 999]) {
    const state = fitState({ userRosterId });
    const plan = ctx.DraftCC.liveDecisionEngine.buildRosterPlan(state);
    eq(plan.identityKnown, false, 'viewer identity not resolved');
    eq(plan.known, false, 'no fabricated own roster certainty');
    eq(plan.remainingPicks, null, 'remaining picks unknown rather than0');
    ok(!/complete/i.test(plan.summary), 'does not claim a completed roster');
    const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
    ok(deck.cards.every(c => c.meta.rosterFit.status === 'unknown' && !c.drivers.includes('useful_depth')), 'value-only cards do not manufacture fit');
  }
  const state = fitState({ userRosterId: 999 });
  state.pickOrder[0].originalRosterId = 999;
  const known = ctx.DraftCC.liveDecisionEngine.buildRosterPlan(state);
  eq(known.identityKnown, true, 'original owner validates a roster that traded every pick');
  eq(known.remainingPicks, 0, 'that known roster actually has no future picks');
});

test('known league eligibility excludes IDPs even when the viewer roster is unknown', () => {
  const state = fitState({ userRosterId: 999 });
  state.pool = [{ pid: 'lb_superstar', name: 'Defender', pos: 'LB', dhq: 999999 }, ...state.pool];
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  eq(deck.rosterPlan.known, false, 'viewer knowledge remains unknown');
  eq(deck.rosterPlan.positions.find(p => p.pos === 'LB').status, 'blocked', 'league format proves LB incompatibility');
  ok(deck.cards.every(c => c.player.pos !== 'LB'), 'no unusable defender in fallback board options');
});

test('opponent forecast describes a second superflex QB as a starter upgrade', () => {
  const state = fitState();
  state.draftContext.leagueFormat.rosterSlots = ['QB', 'RB', 'WR', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN'];
  state.picks.push(...['QB', 'RB', 'WR', 'WR'].map((pos, i) => ({ pid: 'their_sf' + i, pos, rosterId: 3, overall: 0 - i })));
  const forecast = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state).forecasts[0];
  eq(forecast.player.pos, 'QB', 'secondQB is a useful SF upgrade');
  ok(forecast.reason.includes('superflex'), 'forecast explains starting upgrade');
  ok(!forecast.reason.includes('roster depth'), 'not mislabeled backup depth');
});

test('actual picks exclude unavailable players when draftedPids has not refreshed yet', () => {
  const state = fitState();
  state.picks.push({ ...state.pool.find(p => p.pid === 'useful_r'), rosterId: '1', overall: 3 });
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  ok(!deck.cards.some(c => c.player.pid === 'useful_r'), 'actual picked player removed despite stale map');
});

test('opponent forecasts do not keep selecting excess QBs because of ADP or locked old calls', () => {
  const state = fitState();
  state.picks.push({ pid: 'their_q1', pos: 'QB', rosterId: 3, overall: 0 });
  state.sleeperDraftId = 'fit-draft';
  state.redraftBroadcast = { forecasts: { 3: { draftId: 'fit-draft', rosterId: '3', player: { pid: 'extra_q1' }, reason: 'Old QB call' } } };
  ctx.App.getRedraftAdp = pid => ({ adp: pid === 'extra_q1' ? 1 : 100 });
  try {
    const read = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state);
    ok(read.forecasts[0].player.pos !== 'QB', 'filled1QB opponent does not take a2ndQB');
    ok(read.forecasts[0].reason !== 'Old QB call', 'invalid locked recommendation is not reused');
  } finally { delete ctx.App.getRedraftAdp; }
});

test('position outlook contains counted options and named conditional threats without invented odds', () => {
  const state = fitState();
  state.picks.push({ pid: 'their_q', pos: 'QB', rosterId: 3, overall: 0 });
  const read = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(state);
  ok(read.fullHorizon, 'one opponent before user fully modeled');
  ok(read.positionOutlook.length > 0, 'useful position outlook exists');
  ok(read.positionOutlook.every(row => row.canCompare && Number.isInteger(row.projectedSurvivors)), 'only complete horizon produces counts');
  const threatened = read.positionOutlook.find(row => row.threats.length);
  ok(threatened && threatened.threats[0].rosterId && threatened.threats[0].team, 'specific manager pressure');
  ok(read.positionOutlook.every(row => !/%|guaranteed to/.test(row.basis)), 'no percentage certainty');
});

test('on-clock and auction outlooks leave wait comparisons unknown', () => {
  for (const overrides of [{ currentIdx: 3 }, { draftMechanic: 'auction' }]) {
    const read = ctx.DraftCC.liveDecisionEngine.buildRedraftRoomRead(fitState(overrides));
    ok(read.positionOutlook.every(row => !row.canCompare && row.projectedSurvivors === null && row.bestNext === null), 'unknown wait opportunity');
  }
});

test('rookie and dynasty recommendation logic does not inherit the redraft QB restriction', () => {
  const state = fitState({ variant: 'rookie' });
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state);
  eq(deck.rosterPlan, null, 'no seasonal cap for dynasty');
  ok(deck.cards.some(c => c.player?.pos === 'QB'), 'high-value dynasty QB remains legitimate');
});

test('complete drafts have no extra recommendation and facts remain available without Pro', () => {
  const state = fitState({ phase: 'complete' });
  eq(ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state).cards.length, 0, 'draft complete suppresses choices');
  ctx.wrIsPro = () => false;
  try {
    eq(ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(state), null, 'interpretive deck stays gated');
    eq(ctx.DraftCC.liveDecisionEngine.buildRosterPlan(state).counts.QB, 2, 'own roster facts remain available');
  } finally { delete ctx.wrIsPro; }
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
