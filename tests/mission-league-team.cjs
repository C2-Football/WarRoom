'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
let state, effect, cleanup, dependencies, writes = [], forecasts = [], pending = {};
const React = {
  Fragment: 'fragment',
  useState(initial) { if (state === undefined) state = initial; return [state, value => { state = typeof value === 'function' ? value(state) : value; }]; },
  useEffect(fn, next) { if (!dependencies || next.some((v, i) => v !== dependencies[i])) { cleanup?.(); dependencies = next; effect = fn; } },
  createElement(type, props, ...children) { return { type, props: props || {}, children }; },
};
const root = { App: { Schedule: { buildSeason: opts => { forecasts.push(opts); return Promise.resolve({ summary: { remainingWeeks: 4, projWins: 7.2, projLosses: 6.8 } }); } } }, OD: { loadDNA: id => new Promise(resolve => { pending[id] = resolve; }) }, dispatchEvent: event => writes.push(event), wrNavigateTab: route => writes.push(route) };
root.S={currentLeagueId:'a'};root.App.LI_LOADED=true;root.App.LI={sourceLeagueId:'a',tradeHistory:[],ownerProfiles:{}};
const context = { React, window: root, console, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('reconai-shared/intelligence-context.js','utf8'),context);
vm.runInContext(fs.readFileSync('js/shared/owner-scouting.js','utf8'),context);
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/league-map.js', 'utf8'), { presets: ['react'] }).code, context);
const walk = n => n == null || typeof n === 'boolean' ? [] : Array.isArray(n) ? n.flatMap(walk) : typeof n === 'object' ? [n, ...walk(n.children)] : [n];
const text = n => walk(n).filter(x => typeof x !== 'object').join('');
let props = { team: { displayName:'Target Owner', roster: { roster_id: 2, owner_id: 'o2', settings: { wins: 0, losses: 1, ties: 1 } } }, league: { league_id: 'a', season: 2026 }, leagueSkin: { phase: 'in_season' }, assessment: { healthScore: 0, strengths: ['WR'], needs: [{ pos: 'RB' }], window: 'Contender' }, playersData: {}, statsData: {}, priorData: { p1: { gp: 17 } }, isPro: true, myRosterId:1 };
function render() { const tree = context.LeagueTeamMissionSummary(props); if (effect) { const fn = effect; effect = null; cleanup = fn(); } return tree; }
// Team rows use the same prior-season projection baseline and season-keyed NFL schedule as Roster/Game Day.
let projectedContext, byeContext;
vm.runInContext(fs.readFileSync('js/shared/player-metrics.js','utf8'),context);
root.WR.PlayerMetrics = { ...root.WR.PlayerMetrics, slots: (selected, values) => values };
root.App.WeeklyProj = { currentWeek: () => 1, projectPlayer: (pid, options) => { projectedContext = { pid, options }; return { available: true, matchupGrade:'A', points: { median: options.priorData[pid] ? 14.6 : 0 } }; }, formStats: () => ({ rollingPPG: 0 }) };
root.App.NFLByes = { seasonFor: league => Number(league.season), weekForPlayer: (player, season) => { byeContext = { player, season }; return season === 2026 ? 9 : 6; } };
const metricPlayer = { pid: 'p1', p: { team: 'GB', age: 25, bye_week: 6 }, dhq: 4000, ppg: 12.3 };
const metricOptions = { preference: { selected: ['proj', 'ppg', 'bye'] }, currentLeague: props.league, playersData: { p1: metricPlayer.p }, statsData: {}, stats2025Data: props.priorData };
let metrics = context.leagueTeamPlayerMetrics(metricPlayer, metricOptions);
assert.equal(projectedContext.options.priorData, props.priorData, 'Team player forecast retains the real prior-season baseline');
assert.equal(metrics.proj, 14.6, 'Prior-year production contributes before current-season games are available');
assert.equal(metrics.ppg, 0, 'A zero rolling PPG remains a valid result');
assert.equal(metrics.bye, 9, 'Stale bye_week from player metadata cannot override the authoritative league-season schedule');
assert.equal(byeContext.season, 2026);
metrics = context.leagueTeamPlayerMetrics(metricPlayer, { ...metricOptions, currentLeague: { ...props.league, season: 2025 } });
assert.equal(metrics.bye, 6, 'Historical team rows use that season schedule');
root.App.NFLByes.weekForPlayer = () => null;
assert.equal(context.leagueTeamPlayerMetrics(metricPlayer, metricOptions).bye, null, 'Unavailable schedule does not fall back to stale player metadata');
assert.equal(context.leagueTeamPlayerMetricValues(metricPlayer, metricOptions).matchup, null, 'Free team profiles cannot expose matchup grades through sorting');
assert.equal(context.leagueTeamPlayerMetricValues(metricPlayer, { ...metricOptions, isPro:true }).matchup, 'A');
const comparisonPlayers = ['positive','zero','negative','missing'].map(pid => ({ pid, p:{ full_name:pid }, pos:'WR', acq:{ method:'FA', date:'' } }));
const comparisonValues = new Map([
  ['positive',{ proj:10, ppg:12, dhq:1000, age:30, bye:10, matchup:'A+' }],
  ['zero',{ proj:0, ppg:0, dhq:999, age:21, bye:5, matchup:'C' }],
  ['negative',{ proj:-2.5, ppg:-1, dhq:0, age:25, bye:1, matchup:'F' }],
  ['missing',{ proj:null, ppg:null, dhq:null, age:null, bye:null, matchup:null }],
]);
const sortedIds = (key,dir) => Array.from(context.leagueTeamSortPlayers(comparisonPlayers,{ key,dir },comparisonValues), player => player.pid);
assert.deepEqual(sortedIds('proj',-1),['positive','zero','negative','missing']);
assert.deepEqual(sortedIds('proj',1),['negative','zero','positive','missing'],'Unknown forecasts remain last when a team-profile header reverses');
assert.deepEqual(sortedIds('dhq',-1),['positive','zero','negative','missing'],'Value sorting uses raw numbers rather than formatted 1,000/999 strings');
assert.deepEqual(sortedIds('age',1),['zero','negative','positive','missing']);
assert.deepEqual(sortedIds('bye',1),['negative','zero','positive','missing']);
assert.deepEqual(sortedIds('matchup',-1),['positive','zero','negative','missing']);
assert.deepEqual(sortedIds('matchup',1),['negative','zero','positive','missing']);
assert.deepEqual(comparisonPlayers.map(player => player.pid),['positive','zero','negative','missing'],'Sorting is display-only and leaves the provider roster order intact');
(async () => {
  let tree = render(); assert(text(tree).includes('0–1–1'), 'Zero wins and ties are preserved'); assert(text(tree).includes('Roster health0'), 'Zero health is not replaced by a default');
  assert.equal(forecasts[0].stats2025Data, props.priorData, 'Real projection receives prior season data');
  props = { ...props, league: { league_id: 'b', season: 2026 } };root.S.currentLeagueId='b'; render();
  pending.a({ o2: 'FLEECER' }); await new Promise(setImmediate); assert(!text(render()).includes('Fleecer'), 'Late previous league scouting cannot leak');
  pending.b({ o2: 'STALWART' }); await new Promise(setImmediate); tree = render(); assert(text(tree).includes('Stalwart')); assert(text(tree).includes('7.2–6.8')); assert(text(tree).includes('WR') && text(tree).includes('RB'));
  assert(text(tree).includes('Saved owner read'));assert(text(tree).includes('Approach'));assert(!text(tree).includes('Open scouting for the current read'),'Scouting is readable without a second screen');
  const tradeLink=walk(tree).find(n=>n.type==='button');assert(text(tradeLink).includes('Trade Center with Target Owner'));tradeLink.props.onClick(); assert.equal(root._wrOwnerProfileTarget.rosterId, 2); assert.equal(root._wrOwnerProfileTarget.leagueId, 'b');assert.equal(root._wrOwnerProfileTarget.view,'finder');assert.equal(root._wrOwnerProfileTarget.season,2026); assert.equal(writes.at(-1), 'trades');
  root.App.LI={sourceLeagueId:'c',tradeHistory:[1,2,3].map(id=>({id,roster_ids:['2',1],sides:{2:{players:[],picks:[],totalValue:500},1:{players:[],picks:[],totalValue:0}}})),ownerProfiles:{2:{trades:3,tradesWon:3,tradesLost:0,tradesFair:0,avgValueDiff:500}}};
  props={...props,league:{league_id:'c',season:2026}};root.S.currentLeagueId='c';render();pending.c({});await new Promise(setImmediate);tree=render();assert.match(text(tree),/The Fleecer/);assert.match(text(tree),/Inferred from trade history · 3 trades/);assert.match(text(tree),/100% won/);assert.match(text(tree),/visible surplus/);
  root.App.LI.sourceLeagueId='old-league';tree=render();assert.doesNotMatch(text(tree),/The Fleecer|100% won|3 trades on file/,'Old league history cannot leak into the selected team');root.App.LI.sourceLeagueId='c';
  const count = forecasts.length; props = { ...props, team: { ...props.team, projWins: 0, projLosses: 14 } }; tree = render(); assert(text(tree).includes('0.0–14.0'), 'Loaded standings simulation preserves zero'); assert.equal(forecasts.length, count, 'An available standings forecast is reused');
  props = { ...props, team: { roster: props.team.roster }, leagueSkin: { phase: 'complete' } }; render(); assert.equal(forecasts.length, count, 'Completed seasons do not start a new projection');
  console.log('PASS mission league team: source-scoped scouting, schedule projection, unavailable/zero fields and selected-owner navigation');
})().catch(error => { console.error(error); process.exitCode = 1; });
