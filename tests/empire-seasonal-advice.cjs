'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const Babel = require('@babel/standalone');
const context = vm.createContext({ window: { App: {} }, console, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync('js/league-skin.js', 'utf8'), context);
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/global-view.js', 'utf8'), { presets: ['react'] }).code, context);
const players = { veteran: { full_name: 'Veteran WR', position: 'WR', age: 35 }, rookie: { full_name: 'Rookie WR', position: 'WR', age: 21 } };
const league = (type, id = String(type)) => ({ league_id: id, name: 'League ' + id, season: '2026', settings: { type, draft_rounds: 4 }, status: 'in_season',
 rosters: [{ roster_id: 1, owner_id: 'me', players: ['veteran'] }, { roster_id: 2, owner_id: 'other', players: ['rookie'] }],
 empireAssessments: [{ ownerId: 'me', rosterId: 1, tier: 'REBUILDING', healthScore: 35, needs: ['WR'] }, { ownerId: 'other', rosterId: 2, tier: 'CONTENDER', healthScore: 90, needs: ['WR'], panic: 5 }], tradedPicks: [] });
const book = (values = { veteran: 6000, rookie: 1000 }, season = '2026') => ({ season, evidence: 'current-season', values });
const model = (leagues, books = {}) => context.buildEmpirePortfolioModel({ allLeagues: leagues, sleeperUserId: 'me', playersData: players, scores: { veteran: 100, rookie: 9000 }, seasonalBooks: books, liLoaded: true });

test('redraft and keeper use current-season league prices, never dynasty age pruning, tiers or power rank', () => {
 for (const type of [0, 1, 3, 'best_ball', 'dfs']) {
  const p = model([league(type)], { [String(type)]: book() });
  assert.equal(p.assets[0].value, 6000); assert.equal(p.assets[0].dhq, null);
  assert.equal(p.provinces[0].powerRank, 1, 'season value reverses the dynasty rank');
  assert.equal(p.provinces[0].totalDHQ, null); assert.equal(p.provinces[0].healthScore, null);
  assert.equal(p.totals.totalValue, 6000); assert.equal(p.totals.valueBasis, 'seasonal');
  assert.equal(p.ageAllocation.length, 0); assert(!p.signals.some(s => s.type === 'age' || s.type === 'strategy'));
  assert.equal(context.buildWarTable({ provinces: p.provinces }).buckets[0].key, 'seasonal');
  assert.equal(context.buildEmpireRolodex([league(type)], 'me', () => ({ key: 'DESPERATE' }))[0].exploit, 0);
  const rivals = context.buildThreatBoard({ leagues: [league(type)], myUserId: 'me' });
  assert.equal(rivals.count, 1); assert.equal(rivals.rows[0].threat, null); assert.equal(rivals.apex, null);
 }
});

test('missing player, historical book and unknown format remain unpriced with ownership intact', () => {
 for (const books of [{}, { '0': book({}, '2026') }, { '0': book(undefined, '2025') }]) {
  const p = model([league(0)], books);
  assert.equal(p.assets.length, 1); assert.equal(p.assets[0].value, null); assert.equal(p.assets[0].dhq, null);
  assert.equal(p.provinces[0].totalValue, null); assert.equal(p.provinces[0].powerRank, null); assert.equal(p.totals.totalValue, null);
  assert.equal(context.buildCommandBridge({ model: p }).kpis[0].value, 'Unavailable');
  assert.equal(p.exposure[0].count, 1); assert.equal(context.buildEmpireScenario(p).rows[0].unknown, 1);
 }
 const unknown = model([league(undefined)], { undefined: book() });
 assert.equal(unknown.assets[0].value, null);
});

test('mixed portfolio does not sum different bases; dynasty signals and scenario rows remain correctly scoped', () => {
 const p = model([league(2), league(0)], { '0': book() });
 assert.equal(p.totals.totalDHQ, 100); assert.equal(p.totals.totalValue, null); assert.equal(p.totals.useValueShare, false);
 const age = p.signals.find(s => s.type === 'age'); assert.match(age.body, /dynasty/); assert.match(age.body, /excludes seasonal and keeper/);
 const r = context.buildEmpireScenario(p, { target: 'veteran', drop: 50 });
 assert.equal(r.total, null); assert.equal(r.loss, null); assert.equal(r.lossPct, null);
 assert.equal(r.rows.find(row => row.province.format === 'dynasty').loss, 50);
 assert.equal(r.rows.find(row => row.province.format === 'redraft').loss, 3000);
 assert.equal(context.buildCommandBridge({ model: p }).kpis[0].value, 'By league');
 const map = context.buildProvincesMap({ provinces: p.provinces }); assert(map.tiles.every(tile => tile.grow === 1));
 const board = context.buildScoutBoard({ assets: p.assets, exposure: p.exposure, totalLeagues: 2 });
 assert.equal(board.rows.length, 1); assert.equal(board.rows[0].value, null); assert.equal(board.rows[0].valueLabel, 'By league');
});

test('seasonal concentration remains an actionable review without invented acceptance, premium or sale instruction', () => {
 const leagues = [league(0, 'A'), league(1, 'B')], p = model(leagues, { A: book(), B: book() });
 let postures = 0;
 const moves = context.buildEmpireMoves({ leagues, model: p, scores: { veteran: 100, rookie: 9000 }, myUserId: 'me', playersData: players, tradeEngine: { calcOwnerPosture() { postures++; return { key: 'DESPERATE' }; } } });
 assert.equal(moves.length, 2); assert.equal(postures, 0);
 for (const move of moves) { assert.equal(move.type, 'review'); assert.equal(move.accept, null); assert.equal(move.value, null); assert.match(move.why, /current-season roster fit/); }
});

test('explicit season loading requests matching current/prior years, failure recovers and late account callbacks cannot publish', async () => {
 const requested = [], options = { season: '2026', week: 2, fetchStats: async season => { requested.push(season); return {}; }, fetchProjections: async season => { requested.push(season); return { veteran: { rec: 100 } }; } };
 const loaded = await context.fetchEmpireSeasonValuations(options);
 assert.equal(loaded.season, '2026'); assert.equal(loaded.week, 2); assert.equal(loaded.status, 'ready'); assert.deepEqual(requested.sort(), ['2025', '2026', '2026']);
 const failed = await context.fetchEmpireSeasonValuations({ ...options, fetchProjections: async () => ({}) });
 assert.equal((await context.fetchEmpireSeasonValuations({ ...options, fetchProjections: async () => ({ veteran: { gp: 17 } }) })).status, 'unavailable', 'metadata alone is not usable projection evidence');
 assert.equal(failed.status, 'unavailable'); assert.equal(Object.keys(failed.proj).length, 0);
 assert.equal((await context.fetchEmpireSeasonValuations(options)).status, 'ready');
 const timeout = await context.fetchEmpireSeasonValuations({ ...options, timeoutMs: 5, fetchProjections: () => new Promise(() => {}) }); assert.equal(timeout.status, 'unavailable');
 assert.equal(await context.fetchEmpireSeasonValuations({ ...options, isCurrent: () => false }), null);
});
