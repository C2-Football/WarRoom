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

const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flushPoll = () => new Promise(resolve => setImmediate(resolve));

function buildPollHarness(overrides = {}) {
  const pollCtx = buildCtx();
  const timers = new Map();
  let timerId = 0;
  const events = [], statuses = [], logs = [];
  Object.assign(pollCtx, {
    setInterval: fn => { timers.set(++timerId, fn); return timerId; },
    clearInterval: id => timers.delete(id),
    wrLog: (...args) => logs.push(args),
    Sleeper: {
      fetchDraftPicks: async () => [],
      fetchDraft: async () => ({ status: 'drafting' }),
      fetchDraftTradedPicks: async () => [],
    },
    ...overrides,
  });
  load(pollCtx, 'js/draft/live-sync.js');
  const sync = pollCtx.DraftCC.liveSync;
  return {
    ctx: pollCtx, sync, events, statuses, logs, timers,
    start: (id = 'D1', opts = {}) => sync.start(id, picks => events.push(picks), { onStatus: s => statuses.push(s), ...opts }),
    tick: () => Promise.all([...timers.values()].map(fn => fn())),
  };
}

function makeStorage() {
  const store = {};
  return {
    getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    _store: store,
  };
}

function buildCtx() {
  const localStorage = makeStorage();
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
    JSON,
    localStorage,
    wrLog: () => {},
    window: null,
  };
  ctx.window = ctx;
  ctx.DraftCC = {};
  ctx.App = {};
  return vm.createContext(ctx);
}

function load(ctx, relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(source, ctx, { filename: relPath });
}

const ctx = buildCtx();
load(ctx, 'js/draft/live-sync.js');
load(ctx, 'js/draft/state.js');
load(ctx, 'js/draft/live-decision-engine.js');

const pickOrder = [
  { round: 1, slot: 1, overall: 1, teamIdx: 0, originalRosterId: 1, rosterId: 1 },
  { round: 1, slot: 2, overall: 2, teamIdx: 1, originalRosterId: 2, rosterId: 2 },
  { round: 1, slot: 3, overall: 3, teamIdx: 2, originalRosterId: 3, rosterId: 3 },
];

console.log('\nWar Room live draft sync contract');

test('live player resolves metadata-only quarterbacks without a loaded database', () => {
  const player = ctx.DraftCC.liveSync.resolveLivePlayer({ player_id: 'q1', metadata: {
    first_name: 'Josh', last_name: 'Allen', position: 'QB', team: 'BUF',
  } }, { getDHQ: () => 8421 });
  eq(player.name, 'Josh Allen');
  eq(player.pos, 'QB');
  eq(player.team, 'BUF');
  eq(player.dhq, 8421);
  ok(player.photoUrl.endsWith('/q1.jpg'));
});

test('live player metadata preserves kicker and team defense identities and zero values', () => {
  for (const row of [
    { pid: 'k1', first: 'Tyler', last: 'Bass', pos: 'K', team: 'BUF', name: 'Tyler Bass' },
    { pid: 'BUF', first: 'Buffalo', last: 'Bills', pos: 'DEF', team: 'BUF', name: 'Buffalo Bills' },
  ]) {
    const player = ctx.DraftCC.liveSync.resolveLivePlayer({ player_id: row.pid, metadata: {
      first_name: row.first, last_name: row.last, position: row.pos, team: row.team,
    } }, { getDHQ: () => 0 });
    eq(player.name, row.name);
    eq(player.pos, row.pos);
    eq(player.team, row.team);
    eq(player.dhq, 0);
  }
});

test('live player keeps enriched pool fields and never replaces an explicit zero DHQ', () => {
  const csv = { rank: 7 };
  const poolPlayer = Object.freeze({ pid: 123, name: 'Pool Player', pos: 'WR', dhq: 0,
    team: 'GB', consensusRank: 18, tier: 2, csv, photoUrl: '/custom.jpg', college: 'College' });
  const player = ctx.DraftCC.liveSync.resolveLivePlayer({ player_id: '123', metadata: {
    first_name: 'Metadata', last_name: 'Player', position: 'QB', team: 'BUF',
  } }, { pool: [poolPlayer], originalPool: [{ pid: '123', dhq: 999 }],
    playersData: { 123: { full_name: 'Database Player', position: 'RB' } },
    getDHQ: () => { throw new Error('zero DHQ must not call the fallback'); } });
  eq(player.name, 'Pool Player');
  eq(player.pos, 'WR');
  eq(player.dhq, 0);
  eq(player.team, 'GB');
  eq(player.consensusRank, 18);
  eq(player.tier, 2);
  eq(player.csv, csv);
  eq(player.photoUrl, '/custom.jpg');
  eq(player.college, 'College');
});

test('live player skips placeholder fields independently across all identity sources', () => {
  const player = ctx.DraftCC.liveSync.resolveLivePlayer({ player_id: 'p1', metadata: {
    first_name: 'Real', last_name: 'Player', position: 'QB', team: 'BUF',
  } }, { pool: [{ pid: 'p1', name: 'Unknown', pos: '?', team: '?' }],
    originalPool: [{ pid: 'p1', name: 'Unknown Player', pos: 'unknown', tier: 3 }],
    playersData: { p1: { full_name: '?', first_name: 'Unknown', position: '?', photoUrl: '/db.jpg' } },
    getDHQ: () => 123 });
  eq(player.name, 'Real Player');
  eq(player.pos, 'QB');
  eq(player.team, 'BUF');
  eq(player.tier, 3);
  eq(player.photoUrl, '/db.jpg');
  eq(player.dhq, 123);
});

test('live player uses supplied database before metadata and applies position normalization', () => {
  const player = ctx.DraftCC.liveSync.resolveLivePlayer({ player_id: 'd1', metadata: {
    first_name: 'Fallback', last_name: 'Defender', position: 'LB',
  } }, { playersData: { d1: { full_name: 'Known Defender', position: 'DE', team: 'DAL' } },
    normPos: pos => pos === 'DE' ? 'DL' : pos });
  eq(player.name, 'Known Defender');
  eq(player.pos, 'DL');
  eq(player.team, 'DAL');
  eq(player.dhq, 0);
});

test('live player retains original-pool enrichment and handles absent identity honestly', () => {
  const player = ctx.DraftCC.liveSync.resolveLivePlayer({ player_id: 'p2' }, {
    originalPool: [{ pid: 'p2', name: 'Original Player', pos: 'RB', dhq: 42, csv: { rank: 2 } }],
  });
  eq(player.name, 'Original Player');
  eq(player.dhq, 42);
  eq(player.csv.rank, 2);
  const missing = ctx.DraftCC.liveSync.resolveLivePlayer(null);
  eq(missing.name, 'Unknown');
  eq(missing.pos, '?');
  eq(missing.dhq, 0);
  eq(missing.photoUrl, '');
});

test('live sync reconciliation skips already-seen picks and returns only new picks', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
    { pick_no: 2, player_id: 'p2', roster_id: 2 },
    { pick_no: 3, player_id: 'p3', roster_id: 3 },
  ], {
    initialPickNo: 1,
    seenPickKeys: ['no:1'],
    draftStatus: 'drafting',
  });
  eq(result.newPicks.length, 2, 'new pick count');
  eq(result.newPicks[0].pick_no, 2, 'first new pick');
  eq(result.duplicateCount, 1, 'duplicate count');
  eq(result.lastPickNo, 3, 'last pick no');
});

test('live sync reconciliation reports missing remote pick numbers', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
    { pick_no: 3, player_id: 'p3', roster_id: 3 },
  ], {
    initialPickNo: 0,
    seenPickKeys: [],
    draftStatus: 'drafting',
  });
  eq(result.missingPickNos[0], 2, 'missing pick');
  eq(result.gapCount, 1, 'gap count');
  eq(result.remoteBehind, false, 'not remote behind');
});

test('live sync reconciliation flags a remote feed behind the local mirror', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
  ], {
    initialPickNo: 2,
    seenPickKeys: ['no:1', 'no:2'],
    draftStatus: 'drafting',
  });
  ok(result.remoteBehind, 'remote behind flagged');
  eq(result.remoteMaxPickNo, 1, 'remote max pick');
  eq(result.missingPickNos.length, 0, 'missing pick list suppressed for rollback case');
});

test('live sync reconciliation flags conflicting pick records and withholds that slot', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
    { pick_no: 2, player_id: 'p2', roster_id: 2 },
    { pick_no: 2, player_id: 'pX', roster_id: 2 },
    { pick_no: 3, player_id: 'p3', roster_id: 3 },
  ], {
    initialPickNo: 1,
    seenPickKeys: ['no:1'],
    draftStatus: 'drafting',
  });
  eq(result.conflictPickNos[0], 2, 'conflicted pick number');
  eq(result.conflictCount, 1, 'conflict count');
  ok(!result.newPicks.some(p => Number(p.pick_no) === 2), 'conflicted slot withheld');
  ok(ctx.DraftCC.liveSync._private.liveSyncStaleReason(result).includes('conflicting records'), 'stale reason names conflict');
});

test('live sync reconciliation counts invalid Sleeper pick records', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
    { pick_no: 2, roster_id: 2 },
    { player_id: 'p3', roster_id: 3 },
  ], {
    initialPickNo: 1,
    seenPickKeys: ['no:1'],
    draftStatus: 'drafting',
  });
  eq(result.invalidPickCount, 2, 'invalid pick records counted');
  eq(result.newPicks.length, 0, 'invalid records are not mirrored');
  ok(ctx.DraftCC.liveSync._private.liveSyncStaleReason(result).includes('invalid pick'), 'stale reason names invalid records');
});

test('state applies live picks in order without duplicating sleeper picks', () => {
  const initial = ctx.DraftCC.state.initialDraftState({
    mode: 'live-sync',
    leagueId: 'L1',
    userRosterId: 1,
  });
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool: [{ pid: 'p1', name: 'One', pos: 'QB', dhq: 100 }, { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 }],
    pickOrder,
    personas: {},
    liveDraftStatus: 'drafting',
  });
  const once = ctx.DraftCC.state.reducer(started, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{
      sleeperPick: { pick_no: 1, player_id: 'p1', roster_id: 1, picked_by: 'u1' },
      player: { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    }],
    status: { status: 'mirroring', remotePickCount: 1, lastPollAt: 123 },
  });
  eq(once.currentIdx, 1, 'advanced one pick');
  eq(once.picks.length, 1, 'one pick applied');
  eq(once.picks[0].sleeperPickNo, 1, 'sleeper pick number stored');
  eq(once.liveSync.status, 'mirroring', 'live sync status');

  const duplicate = ctx.DraftCC.state.reducer(once, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{
      sleeperPick: { pick_no: 1, player_id: 'p1', roster_id: 1 },
      player: { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    }],
    status: { status: 'mirroring', remotePickCount: 1 },
  });
  eq(duplicate.currentIdx, 1, 'duplicate does not advance');
  eq(duplicate.picks.length, 1, 'duplicate does not append');
  eq(duplicate.liveSync.duplicateCount, 1, 'duplicate counted for current sync pass');
});

test('state flags a skipped live pick instead of applying it to the wrong slot', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool: [{ pid: 'p3', name: 'Three', pos: 'WR', dhq: 80 }],
    pickOrder,
    personas: {},
    liveDraftStatus: 'drafting',
  });
  const next = ctx.DraftCC.state.reducer(started, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{
      sleeperPick: { pick_no: 3, player_id: 'p3', roster_id: 3 },
      player: { pid: 'p3', name: 'Three', pos: 'WR', dhq: 80 },
    }],
    status: { status: 'mirroring', remotePickCount: 3 },
  });
  eq(next.currentIdx, 0, 'gap does not advance');
  eq(next.picks.length, 0, 'gap does not append wrong slot');
  eq(next.liveSync.status, 'stale', 'gap marks stale');
  ok(next.liveSync.missedPickCount > 0, 'gap counted');
  eq(next.liveSync.missingPickNos[0], 1, 'expected local pick preserved');
});

test('state keeps live sync stale when Sleeper returns conflicting pick data', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool: [{ pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 }],
    pickOrder,
    personas: {},
    liveDraftStatus: 'drafting',
  });
  const next = ctx.DraftCC.state.reducer(started, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{
      sleeperPick: { pick_no: 2, player_id: 'p2', roster_id: 2 },
      player: { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
    }],
    status: {
      status: 'stale',
      remotePickCount: 2,
      conflictCount: 1,
      conflictPickNos: [2],
      error: 'Sleeper returned conflicting records for pick 2. War Room paused before applying the wrong player.',
    },
  });
  eq(next.currentIdx, 0, 'conflict does not advance current pick');
  eq(next.picks.length, 0, 'conflict does not append pick');
  eq(next.liveSync.status, 'stale', 'conflict status preserved');
  eq(next.liveSync.conflictPickNos[0], 2, 'conflict pick stored');
});

test('live-sync manual pick is tagged manual-live and is undoable', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT', pool, originalPool: pool, pickOrder, personas: {}, liveDraftStatus: 'drafting',
  });
  // On-clock board click records the pick with no explicit source (override off).
  const picked = ctx.DraftCC.state.reducer(started, { type: 'MAKE_PICK', player: started.pool[0], isUser: true });
  eq(picked.picks[0].source, 'manual-live', 'live-sync hand-entered pick tagged manual-live');
  const undone = ctx.DraftCC.state.reducer(picked, { type: 'UNDO_LAST_PICK', manualOnly: true });
  eq(undone.picks.length, 0, 'manual live pick can be undone');
  eq(undone.currentIdx, 0, 'index rewound after undo');
});

test('live sync overwrites a manual pick when the real pick differs', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
    { pid: 'p3', name: 'Three', pos: 'WR', dhq: 80 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT', pool, originalPool: pool, pickOrder, personas: {}, liveDraftStatus: 'drafting',
  });
  const guessed = ctx.DraftCC.state.reducer(started, { type: 'MAKE_PICK', player: started.pool[0] });
  eq(guessed.picks[0].pid, 'p1', 'manual guess recorded');
  eq(guessed.currentIdx, 1, 'manual guess advanced the clock');
  const reconciled = ctx.DraftCC.state.reducer(guessed, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{ sleeperPick: { pick_no: 1, player_id: 'p2', roster_id: 1, picked_by: 'u1' }, player: { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 } }],
    status: { status: 'mirroring' },
  });
  eq(reconciled.picks.length, 1, 'pick replaced in place, not appended');
  eq(reconciled.picks[0].pid, 'p2', 'manual pick overwritten with reality');
  eq(reconciled.picks[0].source, 'live-sync', 'overwritten pick marked authoritative');
  eq(reconciled.currentIdx, 1, 'overwrite does not change the clock');
  ok(reconciled.draftedPids.p2 && !reconciled.draftedPids.p1, 'drafted set reflects reality');
  ok(reconciled.pool.some(p => p.pid === 'p1'), 'displaced manual player returned to pool');
  ok(!reconciled.pool.some(p => p.pid === 'p2'), 'real pick removed from pool');
  eq(reconciled.liveSync.overwriteCount, 1, 'overwrite counted');
});

test('live sync confirms a manual pick that matched reality without duplicating it', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT', pool, originalPool: pool, pickOrder, personas: {}, liveDraftStatus: 'drafting',
  });
  const guessed = ctx.DraftCC.state.reducer(started, { type: 'MAKE_PICK', player: started.pool[0] });
  const reconciled = ctx.DraftCC.state.reducer(guessed, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{ sleeperPick: { pick_no: 1, player_id: 'p1', roster_id: 1, picked_by: 'u1' }, player: { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 } }],
    status: { status: 'mirroring' },
  });
  eq(reconciled.picks.length, 1, 'matching live pick does not duplicate');
  eq(reconciled.picks[0].pid, 'p1', 'pick unchanged');
  eq(reconciled.picks[0].source, 'live-sync', 'manual guess confirmed as live-sourced');
  eq(reconciled.picks[0].sleeperPickNo, 1, 'sleeper pick number stamped on confirm');
  eq(reconciled.currentIdx, 1, 'confirm does not advance the clock');
  eq(reconciled.liveSync.reconciledCount, 1, 'reconcile counted');
});

test('live ownership update re-attributes only upcoming picks', () => {
  const slotToRoster = { 1: { rosterId: 'A', ownerName: 'TeamA' }, 2: { rosterId: 'B', ownerName: 'TeamB' }, 3: { rosterId: 'C', ownerName: 'TeamC' } };
  const order = ctx.DraftCC.state.buildPickOrder(2, 3, 'linear', slotToRoster, {});
  const state = { pickOrder: order, currentIdx: 2 }; // first two picks already made
  // Mid-draft trades: C's upcoming R1.3 -> Z, B's R2.2 -> W; A's already-made R1.1 -> X must be ignored.
  const ownership = {
    '1-1': { rosterId: 'X', ownerName: 'TeamX', traded: true },
    '1-3': { rosterId: 'Z', ownerName: 'TeamZ', traded: true },
    '2-2': { rosterId: 'W', ownerName: 'TeamW', traded: true },
  };
  const next = ctx.DraftCC.state.reducer(state, { type: 'UPDATE_LIVE_OWNERSHIP', pickOwnership: ownership });
  eq(next.pickOrder[0].rosterId, 'A', 'already-made pick keeps its drafter');
  eq(next.pickOrder[0].traded, false, 'already-made pick not retroactively marked traded');
  eq(next.pickOrder[2].rosterId, 'Z', 'upcoming pick re-attributed to new owner');
  eq(next.pickOrder[2].ownerName, 'TeamZ', 'upcoming owner name refreshed');
  eq(next.pickOrder[4].rosterId, 'W', 'second upcoming pick re-attributed');
  const again = ctx.DraftCC.state.reducer(next, { type: 'UPDATE_LIVE_OWNERSHIP', pickOwnership: ownership });
  ok(again === next, 'no-op returns the same state when ownership is unchanged');
});

test('state stores staged live offers for handoff', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const withDrawer = ctx.DraftCC.state.reducer(initial, { type: 'OPEN_PROPOSER', targetRosterId: 2 });
  const staged = ctx.DraftCC.state.reducer(withDrawer, {
    type: 'STAGE_LIVE_OFFER',
    offer: {
      partnerName: 'Team Two',
      giveText: 'R1.01',
      getText: 'R1.02',
      copyText: 'Offer text',
      likelihood: 72,
      acceptanceLine: 64,
    },
  });
  eq(staged.stagedLiveOffers.length, 1, 'staged offer stored');
  eq(staged.proposerDrawer.status, 'planned', 'drawer planned state');
  ok(staged.stagedLiveOffers[0].copyText.includes('Offer'), 'copy text preserved');
});

test('live offer lifecycle tracks sent, accepted, and rejected states', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const withDrawer = ctx.DraftCC.state.reducer(initial, { type: 'OPEN_PROPOSER', targetRosterId: 2 });
  const staged = ctx.DraftCC.state.reducer(withDrawer, {
    type: 'STAGE_LIVE_OFFER',
    offer: { id: 'offer-1', partnerName: 'Team Two', copyText: 'Offer text' },
  });
  const pending = ctx.DraftCC.state.reducer(staged, {
    type: 'UPDATE_LIVE_OFFER_STATUS',
    offerId: 'offer-1',
    status: 'pending',
  });
  eq(pending.stagedLiveOffers[0].status, 'pending', 'pending status stored');
  eq(pending.proposerDrawer.status, 'pending', 'drawer pending');
  const accepted = ctx.DraftCC.state.reducer(pending, {
    type: 'UPDATE_LIVE_OFFER_STATUS',
    offerId: 'offer-1',
    status: 'accepted',
  });
  eq(accepted.stagedLiveOffers[0].status, 'accepted', 'accepted status stored');
  ok(accepted.stagedLiveOffers[0].resolvedAt, 'resolved timestamp stored');

  const second = ctx.DraftCC.state.reducer(accepted, {
    type: 'STAGE_LIVE_OFFER',
    offer: { id: 'offer-2', partnerName: 'Team Three', copyText: 'Second offer' },
  });
  const rejected = ctx.DraftCC.state.reducer(second, {
    type: 'UPDATE_LIVE_OFFER_STATUS',
    offerId: 'offer-2',
    status: 'rejected',
  });
  eq(rejected.stagedLiveOffers.find(o => o.id === 'offer-2').status, 'rejected', 'rejected status stored');
});

test('manual draft picks update recap ranking from flat pick records', () => {
  const initial = ctx.DraftCC.state.initialDraftState({
    mode: 'manual',
    leagueId: 'L1',
    userRosterId: 1,
    userSlot: 1,
  });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100, consensusRank: 1 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90, consensusRank: 2 },
    { pid: 'p3', name: 'Three', pos: 'WR', dhq: 80, consensusRank: 3 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool,
    originalPool: pool,
    pickOrder,
    personas: {},
  });
  const one = ctx.DraftCC.state.reducer(started, {
    type: 'MAKE_PICK',
    player: started.pool[0],
    source: 'manual-draft',
  });
  const two = ctx.DraftCC.state.reducer(one, {
    type: 'MAKE_PICK',
    player: one.pool.find(p => p.pid === 'p2'),
    source: 'manual-draft',
  });
  const recap = ctx.DraftCC.state.buildDraftRecap(two);
  eq(two.pickedByIdx[1].pid, 'p1', 'pickedByIdx maintained');
  eq(recap.leagueTotals['1'], 100, 'user total');
  eq(recap.leagueTotals['2'], 90, 'other total');
  eq(recap.rank, 1, 'recap rank');
  ok(ctx.DraftCC.state.formatDraftRecapText(recap).includes('One - QB'), 'text export uses flat pick data');
});

test('manual correction undo restores board order and derived draft state', () => {
  const initial = ctx.DraftCC.state.initialDraftState({
    mode: 'manual',
    leagueId: 'L1',
    userRosterId: 1,
    userSlot: 1,
  });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool,
    originalPool: pool,
    pickOrder,
    personas: {},
  });
  const picked = ctx.DraftCC.state.reducer(started, {
    type: 'MAKE_PICK',
    player: started.pool[0],
    source: 'manual-draft',
  });
  const withAlex = {
    ...picked,
    alex: {
      ...picked.alex,
      stream: [
        { id: 'ev1', relatedPickNo: 1, title: 'R1.01 - One' },
        { id: 'ev2', relatedPickNo: 99, title: 'Keep this' },
      ],
    },
  };
  const undone = ctx.DraftCC.state.reducer(withAlex, { type: 'UNDO_LAST_PICK', manualOnly: true });
  eq(undone.picks.length, 0, 'pick removed');
  eq(undone.currentIdx, 0, 'index rewound');
  eq(undone.pool[0].pid, 'p1', 'player restored to original board position');
  ok(!undone.pickedByIdx[1], 'pickedByIdx cleared');
  eq(undone.alex.stream.length, 1, 'pick-linked Alex event removed');
  eq(undone.alex.stream[0].id, 'ev2', 'unrelated Alex event retained');
  eq(undone.manualCorrections[0].type, 'undo', 'undo correction logged');
});

test('auto-resume persistence preserves original board baseline', () => {
  ctx.localStorage.clear();
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'manual', leagueId: 'L2', userRosterId: 1 });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100, source: 'DHQ_ENGINE' },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90, source: 'DHQ_ENGINE' },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool: pool.slice(1),
    originalPool: pool,
    pickOrder,
    personas: {},
  });
  ctx.DraftCC.state.saveToLocal(started);
  const loaded = ctx.DraftCC.state.loadFromLocal('L2');
  eq(loaded.originalPool.length, 2, 'original pool preserved');
  eq(loaded.originalPool[0].pid, 'p1', 'original first board slot preserved');
});

test('broadcast locks before a real pick, persists, and scores without hindsight', () => {
  const reducer = ctx.DraftCC.state.reducer;
  const pool = [{ pid: 'p1', name: 'One', pos: 'QB', dhq: 100 }, { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 }];
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', variant: 'redraft', leagueId: 'broadcast', userRosterId: 3, sleeperDraftId: 'D1' });
  let state = reducer(initial, { type: 'START_DRAFT', pool, originalPool: pool, pickOrder, liveDraftStatus: 'drafting' });
  eq(reducer(state, { type: 'REDRAFT_FORECAST_LOCK' }), state, 'no lock before first successful poll');
  state = { ...state, liveSync: { ...state.liveSync, lastPollAt: Date.now(), status: 'mirroring' } };
  state = reducer(state, { type: 'REDRAFT_WATCH_TOGGLE', pid: 'p1' });
  state = reducer(state, { type: 'REDRAFT_FORECAST_LOCK' });
  const locked = state.redraftBroadcast.forecasts['1'];
  ok(locked, 'on-clock prediction locked');
  eq(reducer({ ...state, pool: pool.slice().reverse() }, { type: 'REDRAFT_FORECAST_LOCK' }).redraftBroadcast.forecasts['1'], locked, 'cannot replace a locked prediction');
  const picked = pool.find(p => p.pid === locked.player.pid);
  state = reducer(state, { type: 'APPLY_LIVE_SYNC_PICKS', picks: [{ sleeperPick: { pick_no: 1, roster_id: 1, player_id: picked.pid }, player: picked }], status: { status: 'mirroring', lastPollAt: Date.now() } });
  eq(ctx.DraftCC.liveDecisionEngine.predictionScorecard(state).hits, 1, 'real live pick scores exact hit');
  ctx.DraftCC.state.saveToLocal(state);
  const loaded = ctx.DraftCC.state.loadFromLocal('broadcast', 'live-sync');
  eq(loaded.redraftBroadcast.forecasts['1'].player.pid, picked.pid, 'original forecast survives refresh');
  eq(loaded.redraftBroadcast.watchPids[0], 'p1', 'tracked player survives refresh');
  const joinedLate = { ...state, redraftBroadcast: { forecasts: {} } };
  const nextLock = reducer(joinedLate, { type: 'REDRAFT_FORECAST_LOCK' });
  ok(!nextLock.redraftBroadcast.forecasts['1'], 'no backfill of completed picks');
  eq(ctx.DraftCC.liveDecisionEngine.predictionScorecard(nextLock).total, 0, 'late join receives no historical credit');
  const changed = { ...state, picks: state.picks.map(p => ({ ...p, rosterId: 9 })) };
  eq(ctx.DraftCC.liveDecisionEngine.predictionScorecard(changed).total, 0, 'changed pick owner excluded');
  const manual = { ...state, picks: state.picks.map(p => ({ ...p, source: 'manual-live' })) };
  eq(ctx.DraftCC.liveDecisionEngine.predictionScorecard(manual).total, 0, 'manual guesses cannot score');
});

testAsync('polls stay single-flight until picks, metadata, and trades all settle', async () => {
  const picks = deferred(), meta = deferred(), trades = deferred();
  let pickCalls = 0, metaCalls = 0, tradeCalls = 0;
  const h = buildPollHarness({ Sleeper: {
    fetchDraftPicks: () => { pickCalls++; return picks.promise; },
    fetchDraft: () => { metaCalls++; return meta.promise; },
    fetchDraftTradedPicks: () => { tradeCalls++; return trades.promise; },
  } });
  try {
    h.start();
    await h.tick();
    await h.tick();
    eq(pickCalls, 1, 'busy interval ticks do not issue more picks requests');
    picks.resolve([{ pick_no: 1, player_id: 'p1' }]);
    meta.resolve({ status: 'drafting' });
    await flushPoll();
    await h.tick();
    eq(pickCalls, 1, 'pending trade request keeps the poll busy');
    eq(h.statuses.length, 0, 'no partial snapshot emitted');
    trades.resolve([]);
    await flushPoll();
    eq(h.events.length, 1, 'first complete snapshot emits its pick');
    await h.tick();
    eq(pickCalls, 2, 'the next interval polls again after completion');
    eq(metaCalls, 1, 'metadata keeps its slower refresh cadence');
    eq(tradeCalls, 1, 'trades keep their slower refresh cadence');
    eq(h.events.length, 1, 'repeated snapshot does not duplicate the pick');
  } finally { h.sync.stop(); }
});

testAsync('a prolonged poll reports stale once and automatically recovers when picks arrive', async () => {
  let now = 1000, calls = 0;
  const pending = deferred();
  class PollDate extends Date { static now() { return now; } }
  const h = buildPollHarness({ Date: PollDate });
  h.ctx.Sleeper.fetchDraftPicks = () => ++calls === 1
    ? Promise.resolve([{ pick_no: 1, player_id: 'p1' }]) : pending.promise;
  try {
    h.start();
    await flushPoll();
    eq(h.statuses[0].status, 'mirroring', 'first snapshot is healthy');
    now += h.sync.POLL_INTERVAL_MS;
    const ongoing = h.tick();
    now += h.sync.STALE_AFTER_MS - 1;
    await h.tick();
    eq(h.statuses.length, 1, 'no warning before request freshness threshold');
    now++;
    await h.tick();
    eq(h.statuses.length, 2, 'threshold emits one stale warning');
    eq(h.statuses[1].status, 'stale', 'busy request is visibly stale');
    eq(h.statuses[1].stale, true, 'stale flag reaches downstream surfaces');
    eq(h.statuses[1].lastPollAt, 1000, 'warning preserves last successful check time');
    now += h.sync.STALE_AFTER_MS;
    await h.tick();
    await h.tick();
    eq(h.statuses.length, 2, 'repeated busy ticks do not repeat warning');
    eq(calls, 2, 'warning does not overlap the pending request');
    pending.resolve([{ pick_no: 1, player_id: 'p1' }, { pick_no: 2, player_id: 'p2' }]);
    await ongoing;
    const recovered = h.statuses[h.statuses.length - 1];
    eq(recovered.status, 'mirroring', 'response automatically restores healthy status');
    eq(recovered.stale, false, 'response clears stale flag');
    eq(recovered.error, null, 'response clears slow-request message');
    eq(h.events[1][0].player_id, 'p2', 'recovered pick is mirrored once');
    const nextPending = deferred();
    h.ctx.Sleeper.fetchDraftPicks = () => nextPending.promise;
    now += h.sync.POLL_INTERVAL_MS;
    const nextOngoing = h.tick();
    now += h.sync.STALE_AFTER_MS;
    await h.tick();
    eq(h.statuses.filter(s => s.status === 'stale').length, 2, 'a separate prolonged request can report its own warning');
    nextPending.resolve([{ pick_no: 1, player_id: 'p1' }, { pick_no: 2, player_id: 'p2' }]);
    await nextOngoing;
  } finally { h.sync.stop(); }
});

testAsync('stopped or replaced sessions cannot emit a pending slow-request warning', async () => {
  let now = 1000;
  const pending = deferred();
  class PollDate extends Date { static now() { return now; } }
  const h = buildPollHarness({ Date: PollDate });
  h.ctx.Sleeper.fetchDraftPicks = id => id === 'OLD' ? pending.promise : Promise.resolve([]);
  try {
    h.start('OLD');
    const oldTick = [...h.timers.values()][0];
    h.sync.stop();
    now += h.sync.STALE_AFTER_MS;
    await oldTick();
    eq(h.statuses.length, 0, 'queued old tick cannot warn after stop');
    h.start('NEW');
    await flushPoll();
    const statusCount = h.statuses.length;
    await oldTick();
    eq(h.statuses.length, statusCount, 'queued old tick cannot warn in replacement session');
    pending.resolve([{ pick_no: 1, player_id: 'old1' }]);
    await flushPoll();
    eq(h.statuses.length, statusCount, 'obsolete slow response remains suppressed');
  } finally { h.sync.stop(); }
});

testAsync('stopping suppresses delayed successful, missing, and failed picks responses', async () => {
  for (const outcome of ['success', 'missing', 'failure']) {
    const pending = deferred();
    const h = buildPollHarness();
    h.ctx.Sleeper.fetchDraftPicks = () => pending.promise;
    h.start();
    h.sync.stop();
    if (outcome === 'failure') pending.reject(new Error('old network error'));
    else pending.resolve(outcome === 'missing' ? null : [{ pick_no: 1, player_id: 'p1' }]);
    await flushPoll();
    eq(h.sync.isRunning(), false, outcome + ': stopped state preserved');
    eq(h.timers.size, 0, outcome + ': interval cleared');
    eq(h.statuses.length, 0, outcome + ': no stale status callback');
    eq(h.events.length, 0, outcome + ': no stale pick callback');
    eq(h.logs.length, 0, outcome + ': obsolete error stays quiet');
  }
});

testAsync('switching drafts isolates late metadata, trade ownership, and pick cursors', async () => {
  const oldMeta = deferred(), oldTrades = deferred();
  let newPickCalls = 0;
  const h = buildPollHarness({ Sleeper: {
    fetchDraftPicks: async id => id === 'OLD'
      ? [{ pick_no: 1, player_id: 'old1' }, { pick_no: 2, player_id: 'old2' }]
      : (++newPickCalls === 1 ? [{ pick_no: 1, player_id: 'new1' }]
        : [{ pick_no: 1, player_id: 'new1' }, { pick_no: 2, player_id: 'new2' }]),
    fetchDraft: id => id === 'OLD' ? oldMeta.promise : Promise.resolve({ status: 'drafting' }),
    fetchDraftTradedPicks: id => id === 'OLD' ? oldTrades.promise : Promise.resolve([]),
  } });
  const oldEvents = [], oldStatuses = [];
  try {
    h.sync.start('OLD', p => oldEvents.push(p), { onStatus: s => oldStatuses.push(s) });
    h.start('NEW');
    await flushPoll();
    eq(h.events[0][0].player_id, 'new1', 'new draft starts immediately');
    oldMeta.resolve({ status: 'complete' });
    oldTrades.resolve([{ round: 1, roster_id: 1, owner_id: 9 }]);
    await flushPoll();
    await h.tick();
    eq(oldEvents.length, 0, 'old draft cannot emit picks');
    eq(oldStatuses.length, 0, 'old draft cannot emit status');
    eq(h.events.length, 2, 'late old cursor did not skip new draft pick two');
    eq(h.events[1][0].player_id, 'new2', 'new draft keeps its own cursor');
    eq(h.statuses[h.statuses.length - 1].status, 'mirroring', 'old complete status did not poison metadata cache');
    eq(h.statuses[h.statuses.length - 1].tradedPicks.length, 0, 'old ownership did not poison trade cache');
  } finally { h.sync.stop(); }
});

testAsync('an old request finishing cannot unlock an active replacement poll', async () => {
  const oldPicks = deferred(), newPicks = deferred();
  let newCalls = 0;
  const h = buildPollHarness();
  h.ctx.Sleeper.fetchDraftPicks = id => id === 'OLD' ? oldPicks.promise : (newCalls++, newPicks.promise);
  try {
    h.start('OLD');
    h.start('NEW');
    eq(newCalls, 1, 'replacement request starts despite old request in flight');
    oldPicks.resolve([{ pick_no: 1, player_id: 'old1' }]);
    await flushPoll();
    await h.tick();
    eq(newCalls, 1, 'old finally cannot unlock replacement request');
    newPicks.resolve([{ pick_no: 1, player_id: 'new1' }]);
    await flushPoll();
    eq(h.events.length, 1, 'only replacement draft emits');
    eq(h.events[0][0].player_id, 'new1', 'replacement player preserved');
  } finally { h.sync.stop(); }
});

testAsync('restarting the same draft immediately resumes the caller supplied cursor', async () => {
  const oldPicks = deferred();
  let calls = 0;
  const h = buildPollHarness();
  h.ctx.Sleeper.fetchDraftPicks = () => ++calls === 1 ? oldPicks.promise
    : Promise.resolve([{ pick_no: 1, player_id: 'p1' }, { pick_no: 2, player_id: 'p2' }]);
  try {
    h.start('D1');
    h.start('D1', { initialPickNo: 1, seenPickKeys: ['no:1'] });
    await flushPoll();
    eq(calls, 2, 'explicit restart requests immediately despite the previous pending poll');
    eq(h.events.length, 1, 'restart emits one batch');
    eq(h.events[0].length, 1, 'already recorded pick is omitted');
    eq(h.events[0][0].pick_no, 2, 'resume uses the caller supplied cursor');
    oldPicks.resolve([{ pick_no: 1, player_id: 'p1' }]);
    await flushPoll();
    eq(h.events.length, 1, 'obsolete same-draft request stays suppressed');
  } finally { h.sync.stop(); }
});

testAsync('raw fetch JSON resolving after stop cannot notify the room', async () => {
  const body = deferred();
  const h = buildPollHarness({
    Sleeper: {},
    fetch: async url => ({ ok: true, json: () => url.endsWith('/picks') ? body.promise
      : Promise.resolve(url.endsWith('/traded_picks') ? [] : { status: 'drafting' }) }),
  });
  h.start();
  await flushPoll();
  h.sync.stop();
  body.resolve([{ pick_no: 1, player_id: 'p1' }]);
  await flushPoll();
  eq(h.statuses.length, 0, 'late response body emits no status');
  eq(h.events.length, 0, 'late response body emits no picks');
});

testAsync('failed picks wait for remaining requests and recover on the next poll', async () => {
  const picks = deferred(), meta = deferred();
  let pickCalls = 0;
  const h = buildPollHarness({ Sleeper: {
    fetchDraftPicks: () => ++pickCalls === 1 ? picks.promise : Promise.resolve([{ pick_no: 1, player_id: 'p1' }]),
    fetchDraft: () => meta.promise,
    fetchDraftTradedPicks: async () => [],
  } });
  try {
    h.start();
    picks.reject(new Error('temporary failure'));
    await flushPoll();
    await h.tick();
    eq(pickCalls, 1, 'failed picks do not unlock pending metadata request');
    meta.resolve({ status: 'drafting' });
    await flushPoll();
    eq(h.statuses.length, 1, 'current session reports its failure');
    eq(h.statuses[0].error, 'temporary failure', 'failure reason preserved');
    await h.tick();
    eq(pickCalls, 2, 'retry runs after all previous branches settle');
    eq(h.events[0][0].player_id, 'p1', 'retry applies the recovered pick');
  } finally { h.sync.stop(); }
});

testAsync('MFL delayed successes and failures cannot notify a stopped room', async () => {
  for (const fail of [false, true]) {
    const pending = deferred();
    const h = buildPollHarness({ MFL: { fetchDraftStatus: () => pending.promise } });
    h.start('mfl_draft_123_2026');
    h.sync.stop();
    if (fail) pending.reject(new Error('old MFL failure'));
    else pending.resolve([{ draft_id: 'mfl_draft_123_2026', status: 'drafting', picks: [{ pick_no: 1, player_id: 'm1' }], _slots: [{ round: 1, draft_slot: 1, roster_id: 9 }] }]);
    await flushPoll();
    eq(h.statuses.length, 0, 'old MFL status suppressed');
    eq(h.events.length, 0, 'old MFL picks suppressed');
    eq(h.logs.length, 0, 'old MFL failure stays quiet');
  }
});

testAsync('a status callback stopping the room suppresses its remaining pick callback', async () => {
  const h = buildPollHarness();
  h.ctx.Sleeper.fetchDraftPicks = async () => [{ pick_no: 1, player_id: 'p1' }];
  h.start('D1', { onStatus: () => h.sync.stop() });
  await flushPoll();
  eq(h.events.length, 0, 'pick callback respects stop from onStatus');
  eq(h.timers.size, 0, 'no interval is installed after stop');
});

(async () => {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      passed++;
      process.stdout.write('.');
    } catch (err) {
      failed++;
      failures.push(`  FAIL: ${name}\n        ${err.message}`);
      process.stdout.write('F');
    }
  }
  console.log('\n');
  if (failures.length) {
    console.log(failures.join('\n'));
    console.log('');
  }
  console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
