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

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
