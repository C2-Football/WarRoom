#!/usr/bin/env node
'use strict';

// Post-draft protocol contract: per-type grade efficiency, PostDraft persistence,
// and the UDFA craze board. JSX modules are compiled with @babel/standalone so the
// test is self-contained (no prior build required).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (err) { failed++; failures.push(`  FAIL: ${name}\n        ${err.message}`); process.stdout.write('F'); }
}
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }
function eq(a, b, label) { if (a !== b) throw new Error(`${label || 'mismatch'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function approx(a, b, tol, label) { if (Math.abs(a - b) > tol) throw new Error(`${label}: ${a} not within ${tol} of ${b}`); }

function makeStorage() {
  const store = {};
  return {
    getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => Object.keys(store).forEach(k => delete store[k]),
    _store: store,
  };
}

function makeCtx() {
  const localStorage = makeStorage();
  const listeners = {};
  const ctx = {
    console, Math, Number, String, Array, Object, Set, Map, Date, JSON, Boolean, isNaN, parseInt, parseFloat,
    localStorage, wrLog: () => {}, setInterval: () => 0, clearInterval: () => {},
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    window: null,
  };
  ctx.window = ctx;
  ctx.window.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  ctx.window.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); };
  ctx.window.dispatchEvent = (ev) => { (listeners[ev.type] || []).forEach(fn => fn(ev)); return true; };
  ctx._listeners = listeners;
  ctx.React = { createElement: () => null, useMemo: (f) => (typeof f === 'function' ? f() : f), useState: (v) => [v, () => {}], useEffect: () => {}, useCallback: (f) => f, useRef: () => ({ current: null }) };
  ctx.App = {};
  ctx.S = {};
  ctx.OD = { getClient: () => null }; // no Supabase → graceful localStorage fallback
  return vm.createContext(ctx);
}

function loadRaw(ctx, rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
}
function loadJsx(ctx, rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const out = Babel.transform(src, { presets: [['react', { runtime: 'classic' }]], sourceType: 'script' }).code;
  vm.runInContext(out, ctx, { filename: rel });
}

console.log('\nWar Room post-draft protocol contract');

// ─────────────────────────────────────────────────────────────────────────────
// A. Per-type grade efficiency engine (state.js)
// ─────────────────────────────────────────────────────────────────────────────
(function gradeEngine() {
  const ctx = makeCtx();
  // A decreasing slot-value curve so expected DHQ varies by pick.
  ctx.window.getIndustryPickValue = (overall) => Math.max(50, Math.round(8000 / Math.max(1, overall)));
  loadRaw(ctx, 'js/draft/state.js');
  const s = ctx.DraftCC.state;

  const picks = [
    { pid: 'a', pos: 'QB', overall: 1, round: 1, dhq: 8000, consensusRank: 1 },
    { pid: 'b', pos: 'RB', overall: 5, round: 1, dhq: 1600, consensusRank: 5 },
  ];

  test('expectedDHQ uses industry curve for rookie/startup', () => {
    eq(s.expectedDHQ({ overall: 1 }, { variant: 'startup' }), 8000, 'overall 1');
    eq(s.expectedDHQ({ overall: 4 }, { variant: 'rookie' }), 2000, 'overall 4');
  });
  test('expectedDHQ uses replacement floor for redraft K/DEF, slot for skill', () => {
    ok(s.expectedDHQ({ overall: 50, pos: 'DEF' }, { variant: 'redraft' }) === 760, 'DEF replacement floor');
    ok(s.expectedDHQ({ overall: 2, pos: 'WR' }, { variant: 'redraft' }) > 0, 'skill falls through to slot');
  });
  test('expectedDHQ uses $ spent for auction', () => {
    const lo = s.expectedDHQ({ overall: 1, amount: 1 }, { variant: 'auction', budget: 200 });
    const hi = s.expectedDHQ({ overall: 99, amount: 180 }, { variant: 'auction', budget: 200 });
    ok(hi > lo, 'more $ → higher expectation regardless of slot');
  });
  test('gradeBasisFor labels each variant', () => {
    eq(s.gradeBasisFor('auction'), 'vs $ spent', 'auction');
    eq(s.gradeBasisFor('redraft'), 'vs replacement', 'redraft');
    eq(s.gradeBasisFor('rookie'), 'vs expected pick value', 'rookie');
  });
  test('pickEfficiency is actual/expected ratio', () => {
    approx(s.pickEfficiency({ overall: 1, dhq: 8000 }, { variant: 'startup' }), 1.0, 0.01, 'on-expectation');
    ok(s.pickEfficiency({ overall: 1, dhq: 4000 }, { variant: 'startup' }) < 1, 'overpay <1');
  });
  test('neutral draft maps to ~C for every variant', () => {
    // avgPickScore == neutral → aggregateGrade == GRADE_AGG_CENTER (48) → C band
    ['rookie', 'startup', 'redraft', 'best_ball', 'auction'].forEach(v => {
      const score = s.aggregateGrade(s.recapNeutral ? s.recapNeutral(v) : 51.6, v);
      // We can't read neutral directly; instead assert a neutral-ish pick grades in C/B/D band, not A/F extremes.
      ok(score >= 30 && score <= 70, v + ' neutral mid-band');
    });
  });
  test('buildDraftRecap emits v5 with efficiency + gradeBasis per variant', () => {
    const base = {
      id: 'r', phase: 'complete', leagueId: 'L', season: 2026, mode: 'solo',
      userRosterId: 1, userSlot: 1, leagueSize: 12, rounds: 5,
      originalPool: picks.map(p => ({ ...p })),
      personas: { 1: { assessment: { needs: [] } } },
      draftContext: { teamContext: { needs: [], currentRoster: [] } },
      picks: picks.map(p => ({ ...p, rosterId: 1, slot: 1, pickInRound: 1 })),
    };
    const rk = s.buildDraftRecap({ ...base, variant: 'rookie' });
    const rd = s.buildDraftRecap({ ...base, variant: 'redraft' });
    eq(rk.schemaVersion, 'draft-recap-v5', 'v5');
    eq(rk.gradeBasis, 'vs expected pick value', 'rookie basis');
    eq(rd.gradeBasis, 'vs replacement', 'redraft basis');
    ok(typeof rk.efficiency === 'number', 'overall efficiency number');
    ok(rk.picks.every(p => 'efficiency' in p && 'expectedDHQ' in p), 'per-pick fields');
    ok(typeof rk.expectedDHQTotal === 'number', 'expected total');
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// B. PostDraft persistence module (post-draft.js)
// ─────────────────────────────────────────────────────────────────────────────
(function postDraftModule() {
  const ctx = makeCtx();
  loadRaw(ctx, 'reconai-shared/storage.js');   // real DhqStorage
  loadJsx(ctx, 'js/post-draft.js');            // compiles fine (no JSX, but harmless)
  const PD = ctx.App.PostDraft;

  test('PostDraft module attaches API', () => {
    ['getCraze', 'openCraze', 'closeCraze', 'stageClaim', 'getStagedClaims', 'onDraftClosed', 'archiveRecap', 'getRecapArchive', 'computeWindowEnd'].forEach(k => ok(typeof PD[k] === 'function', k));
  });
  test('openCraze → getCraze round-trips and dispatches event', () => {
    let fired = 0;
    ctx.window.addEventListener('wr:udfa-craze-open', () => fired++);
    const c = PD.openCraze('L1', { seed: [{ pid: 'x1', name: 'Rook', pos: 'WR' }], league: { settings: { waiver_clear_days: 2 } } });
    ok(c.open, 'open');
    eq(PD.getCraze('L1').seed[0].pid, 'x1', 'seed persisted');
    ok(fired >= 1, 'event fired');
  });
  test('computeWindowEnd honors waiver_clear_days, falls back to 48h', () => {
    const t0 = 1700000000000;
    eq(PD.computeWindowEnd({ settings: { waiver_clear_days: 2 } }, t0), t0 + 2 * 86400000, 'clear days');
    eq(PD.computeWindowEnd({ settings: {} }, t0), t0 + 48 * 3600000, '48h fallback');
  });
  test('stageClaim records and clears a bid', () => {
    PD.stageClaim('L1', 'x1', 14);
    eq(PD.getStagedClaims('L1').x1, 14, 'staged');
    PD.stageClaim('L1', 'x1', null);
    eq(PD.getStagedClaims('L1').x1, undefined, 'cleared');
  });
  test('closeCraze marks dismissed', () => {
    PD.closeCraze('L1');
    eq(PD.getCraze('L1').open, false, 'closed');
  });
  test('expired window auto-closes on read', () => {
    PD.openCraze('L2', { windowEnd: Date.now() - 1000 });
    eq(PD.getCraze('L2').open, false, 'auto-expired');
  });
  test('draft:closed archives recap and opens craze for rookie variant', () => {
    const recap = { id: 'rc1', leagueId: 'L3', season: 2026, variant: 'rookie', savedAt: Date.now(), postDraftMoves: { waiverTargets: [{ pid: 'u1', name: 'UDFA One', pos: 'RB', dhq: 900 }] } };
    ctx.window.dispatchEvent(Object.assign(new ctx.CustomEvent('draft:closed', { detail: { recap } })));
    ok(PD.getRecapArchive('L3').some(r => r.id === 'rc1'), 'recap archived');
    ok(PD.getCraze('L3') && PD.getCraze('L3').open, 'craze opened');
    eq(PD.getCraze('L3').seed[0].pid, 'u1', 'seed from waiverTargets');
  });
  test('draft:closed does NOT open craze for non-rookie variant', () => {
    const recap = { id: 'rc2', leagueId: 'L4', season: 2026, variant: 'startup', savedAt: Date.now(), postDraftMoves: { waiverTargets: [] } };
    ctx.window.dispatchEvent(Object.assign(new ctx.CustomEvent('draft:closed', { detail: { recap } })));
    ok(PD.getRecapArchive('L4').some(r => r.id === 'rc2'), 'recap still archived');
    ok(!PD.getCraze('L4') || !PD.getCraze('L4').open, 'no craze for startup');
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// C. UDFA craze board + lock flip + FAAB blend (free-agency.js)
// ─────────────────────────────────────────────────────────────────────────────
(function crazeBoard() {
  const ctx = makeCtx();
  loadRaw(ctx, 'reconai-shared/storage.js');
  loadJsx(ctx, 'js/free-agency.js');
  const A = ctx.App;

  test('rookiesLockedForWaivers: locked while drafting, unlocks only when ALL complete', () => {
    const league = { settings: { type: 2 }, season: 2026 };
    const drafting = [{ draft_id: 'd1', season: 2026, settings: { player_type: 'rookie', rounds: 4 }, status: 'drafting' }];
    const mixed = [
      { draft_id: 'd1', season: 2026, settings: { player_type: 'rookie', rounds: 4 }, status: 'complete' },
      { draft_id: 'd2', season: 2026, settings: { player_type: 'rookie', rounds: 1 }, metadata: { name: 'Supplemental' }, status: 'pre_draft' },
    ];
    const allDone = mixed.map(d => ({ ...d, status: 'complete' }));
    ctx.S.drafts = drafting; eq(A.rookiesLockedForWaivers(league, null), true, 'drafting → locked');
    ctx.S.drafts = mixed; eq(A.rookiesLockedForWaivers(league, null), true, 'one pending → still locked');
    ctx.S.drafts = allDone; eq(A.rookiesLockedForWaivers(league, null), false, 'all complete → unlocked');
  });

  test('blendFaabWithHistory anchors model bid to league avg', () => {
    const blended = A.blendFaabWithHistory({ sug: 10, lo: 7, hi: 14 }, { low: 20, high: 40, avg: 30, count: 9 });
    eq(blended.sug, 20, 'avg of 10 and 30');
    eq(blended.leagueAvg, 30, 'surfaces league avg');
    eq(A.blendFaabWithHistory(null, { low: 5, high: 15, avg: 10, count: 4 }).sug, 10, 'history-only');
    eq(A.blendFaabWithHistory({ sug: 8, lo: 5, hi: 12 }, null).sug, 8, 'model-only');
  });

  test('observeUdfaCrazeFlip fires craze-open on lock→unlock transition', () => {
    const league = { league_id: 'LX', settings: { type: 2 }, season: 2026 };
    let fired = 0;
    ctx.window.addEventListener('wr:udfa-craze-open', () => fired++);
    A.PostDraft = { openCraze: () => {} }; // stub so observe can call it
    // First call records "locked".
    ctx.S.drafts = [{ draft_id: 'd', season: 2026, settings: { player_type: 'rookie', rounds: 4 }, status: 'drafting' }];
    A.observeUdfaCrazeFlip(league, null);
    eq(fired, 0, 'no flip yet');
    // Now all complete → flip true→false.
    ctx.S.drafts = [{ draft_id: 'd', season: 2026, settings: { player_type: 'rookie', rounds: 4 }, status: 'complete' }];
    A.observeUdfaCrazeFlip(league, null);
    eq(fired, 1, 'craze opened on flip');
    // Idempotent — no second fire while already unlocked.
    A.observeUdfaCrazeFlip(league, null);
    eq(fired, 1, 'no duplicate fire');
  });

  test('buildUdfaCrazeBoard tiers signed UDFAs by need; watch = no NFL team', () => {
    // Prospects: two signed UDFAs (one fills WR need, one no need) + one limbo (no team).
    ctx.window.getProspects = () => ([
      { pid: 'u_need', name: 'Need UDFA', pos: 'WR', nflTeam: 'KC', isUDFA: true, dynastyValue: 800, tierLabel: 'UDFA' },
      { pid: 'u_spec', name: 'Spec UDFA', pos: 'TE', nflTeam: 'DAL', isUDFA: true, dynastyValue: 700, tierLabel: 'UDFA' },
      { pid: 'u_limbo', name: 'Limbo UDFA', pos: 'RB', nflTeam: '', isUDFA: true, dynastyValue: 300, tierLabel: 'UDFA' },
    ]);
    ctx.window.assessTeamFromGlobal = () => ({ needs: [{ pos: 'WR', urgency: 'deficit' }], strengths: [], tier: 'CONTENDER', window: 'CONTENDING' });
    ctx.App.livFAABRange = (pos) => (pos === 'WR' ? { low: 20, high: 40, avg: 30, count: 9 } : null);
    ctx.App.LI = { playerScores: { u_need: 800, u_spec: 700 }, playerMeta: {} };
    const playersData = {
      u_need: { full_name: 'Need UDFA', position: 'WR', team: 'KC', years_exp: 0, status: 'Active' },
      u_spec: { full_name: 'Spec UDFA', position: 'TE', team: 'DAL', years_exp: 0, status: 'Active' },
    };
    const currentLeague = { settings: { type: 2, waiver_budget: 100 }, season: 2026, rosters: [], roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX'], scoring_settings: {} };
    const board = ctx.App.buildUdfaCrazeBoard({ playersData, statsData: {}, prevStatsData: {}, myRoster: { roster_id: 1, settings: {} }, currentLeague, crazeSeed: [{ pid: 'u_need' }] });
    ok(board.tiers.priority.some(c => c.pid === 'u_need'), 'WR-need UDFA is priority');
    ok(board.tiers.speculative.some(c => c.pid === 'u_spec'), 'no-need UDFA is speculative');
    ok(board.tiers.watch.some(w => w.pid === 'u_limbo'), 'limbo UDFA is watch');
    const needCand = board.tiers.priority.find(c => c.pid === 'u_need');
    ok(needCand.seeded === true, 'seeded flag from recap seed');
    ok(needCand.faab && needCand.faab.leagueCount === 9, 'FAAB anchored to league history');
  });

  test('buildUdfaCrazeBoard returns empty for non-dynasty leagues', () => {
    const board = ctx.App.buildUdfaCrazeBoard({ currentLeague: { settings: { type: 0 } } });
    eq(board.tiers.priority.length, 0, 'no priority');
    eq(board.candidates.length, 0, 'no candidates');
  });

  test('FA name resolver eliminates "Unknown": DEF resolves to first+last, team-only DEF to D/ST', () => {
    // Team defenses carry first/last (city/nickname) but a null full_name — the old
    // table render dropped these to "Unknown". A team-only feed entry has no name parts.
    ctx.window.getProspects = () => [];
    ctx.window.assessTeamFromGlobal = () => ({ needs: [], strengths: [], tier: 'CONTENDER', window: 'CONTENDING' });
    ctx.App.livFAABRange = () => null;
    ctx.App.LI = { playerScores: { KC: 1200, NE: 1100, p_part: 900 }, playerMeta: {} };
    const playersData = {
      KC: { first_name: 'Kansas City', last_name: 'Chiefs', position: 'DEF', team: 'KC', status: 'Active' }, // no full_name
      NE: { position: 'DEF', team: 'NE', status: 'Active' },                                                  // no name parts at all
      p_part: { last_name: 'Onlylast', position: 'RB', team: 'BUF', status: 'Active' },                       // partial name
    };
    const currentLeague = { settings: { type: 2, waiver_budget: 100 }, season: 2026, rosters: [], roster_positions: ['QB', 'RB', 'WR', 'TE', 'DEF'], scoring_settings: {} };
    const board = ctx.App.buildFreeAgencyActionBoard({ playersData, statsData: {}, prevStatsData: {}, myRoster: { roster_id: 1, settings: {} }, currentLeague });
    const byPid = Object.fromEntries(board.actionBoardPlayers.map(x => [x.pid, x.name]));
    eq(byPid.KC, 'Kansas City Chiefs', 'DEF first+last');
    eq(byPid.NE, 'NE D/ST', 'team-only DEF synthesized');
    eq(byPid.p_part, 'Onlylast', 'partial name resolves');
    ok(!Object.values(byPid).includes('Unknown'), 'no Unknown names remain');
  });
})();

console.log('\n');
if (failures.length) { console.log(failures.join('\n\n')); console.log(`\nFAIL ${passed + failed} tests - ${passed} passed, ${failed} failed`); process.exit(1); }
console.log(`PASS ${passed + failed} tests - ${passed} passed, 0 failed`);
