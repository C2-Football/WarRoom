'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const load = require('./helpers/security-ts-loader.cjs');
const window = { App: {}, WR: {}, S: { nflState: { week: 4 } } };
vm.runInNewContext(fs.readFileSync('js/league-skin.js', 'utf8'), { window });
vm.runInNewContext(fs.readFileSync('js/shared/wr-ai-context.js', 'utf8'), { window });
const api = window.WR.AIContext;
const league = { league_id: '1234567890123456789', season: '2026', settings: { type: 0 }, roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'TE'], scoring_settings: { rec: 1, bonus_rec_te: 0.5 } };
assert.equal(api.decisionContext(league).leagueType, 'redraft');
assert.match(api.buildFormatPreamble(league), /No universal DHQ/);
assert.doesNotMatch(api.buildFormatPreamble(league), /1\.8x|1\.5x|DHQ below 500/);
const keeper = { ...league, settings: { type: 1 } };
assert.equal(window.App.LeagueSkin.build({ league: { ...keeper, status: 'in_season' }, nflState: { week: 4 } }).features.showStartSit, true);
assert.equal(api.keeperRules(keeper).slots, null);
assert.equal(api.keeperRules({ ...keeper, settings: { type: 1, max_keepers: 0, keeper_count: 3 } }).slots, 0);
assert.equal(api.keeperRules({ ...keeper, settings: { type: 1, max_keepers: '2' } }).slots, 2);
for (const invalid of [-1, 1.5, 'bad']) assert.equal(api.keeperRules({ ...keeper, settings: { max_keepers: invalid } }).slots, null);
assert.equal(api.decisionContext({ ...league, settings: { type: 3, max_keepers: 4 } }).canTrade, false);
assert.equal(api.decisionContext({}).leagueType, 'unknown');
window.App.Intelligence = { getLeagueTypeOverride: () => 'keeper' };
assert.equal(api.decisionContext(league).leagueType, 'keeper');
delete window.App.Intelligence;
const roster = { players: ['one','two'], starters: ['one'], settings: { wins: 1, losses: 2, waiver_budget_used: 10 } };
const h = api.stateHashFor(league, roster);
assert.notEqual(h, api.stateHashFor(keeper, roster));
assert.notEqual(h, api.stateHashFor({ ...league, scoring_settings: { rec: 0 } }, roster));
assert.notEqual(h, api.stateHashFor(league, { ...roster, starters: ['two'] }));
assert.notEqual(h, api.stateHashFor(league, { ...roster, settings: { ...roster.settings, waiver_budget_used: 20 } }));
assert.equal(api.buildStructuredBase(league, {}, roster).leagueType, 'redraft');
const c = load('supabase/functions/ai-analyze/index.ts', {}, ['adviceLeagueType','buildDecisionRules','buildTeamModeBlock','buildPartnerModeBlock','buildQualityThresholdBlock','buildLeagueFormatBlock','detectLeagueFormat','buildScarcityBlock','buildSystemPrompt','formatDealSide','buildTradeVerdictPrompt']).context;
for (const type of ['redraft','keeper','chopped','best_ball','unknown','dynasty']) {
  const context = { decisionContext: { leagueType: type, canTrade: type !== 'chopped' }, teamTier: 'REBUILDING', rosterPositions: league.roster_positions };
  const rules = c.buildDecisionRules(context);
  assert.match(rules, /Missing data is unknown/);
  assert.match(rules, /Preserve required JSON/);
  if (type !== 'dynasty') assert.equal(c.buildTeamModeBlock(context), '');
  assert.doesNotMatch(c.buildSystemPrompt(context), /1\.8x|1\.5x|DHQ below 500|DHQ < 500/);
}
assert.match(c.buildDecisionRules({ decisionContext: { leagueType: 'keeper' } }), /Unknown costs are not zero/);
assert.match(c.buildDecisionRules({ decisionContext: { leagueType: 'redraft' } }), /No multi-year rebuild/);
assert.match(c.buildDecisionRules({ decisionContext: { leagueType: 'chopped' } }), /Trades are disabled/);
console.log('PASS format resolution, unknown keeper rules, cache invalidation, and server advice constraints');

const redraftVerdict = { leagueType: 'redraft', phase: 'in_season', leagueName: 'Season League', rosterPositions: league.roster_positions,
  scoringSettings: league.scoring_settings, myTeam: { tier: 'REBUILDING', record: '2-5' }, partnerTeam: { tier: 'REBUILDING', owner: 'Other owner' },
  iSend: { players: [{ name: 'Veteran', pos: 'WR', age: 37, value: 0 }], picks: [{ year: 2027, round: 1, value: 5000 }] },
  iReceive: { players: [{ name: 'Starter', pos: 'RB', age: 21, value: 4000 }] },
  verdict: { verdictText: 'A value grade', diffDisplay: '+20%', likelihood: 75 },
  seasonImpact: { status: 'limited', reason: null, effectiveWeek: 8,
    powerRank: { before: 6, after: 7, total: 12, beforePoints: 110, afterPoints: 108, delta: -1 },
    wins: { beforeRemaining: 3.4, afterRemaining: 3.1, delta: -0.3, beforeFinal: 5.4, afterFinal: 5.1 },
    playoffs: { available: true, beforePct: 0, afterPct: 0, delta: 0, byeBeforePct: null, byeAfterPct: null, byeDelta: null },
    weeks: [{ week: 8, opponentName: 'Rival', beforePoints: 110, afterPoints: 105, pointsDelta: -5, beforeWinPct: 50, afterWinPct: 45, winDelta: -5 }],
    assumptions: ['Current week held unchanged; no live scores included.'], warnings: ['Injury status held fixed.'] } };
const verdictPrompt = c.buildTradeVerdictPrompt(redraftVerdict);
assert.match(verdictPrompt, /this redraft trade/);
assert.match(verdictPrompt, /Phase: in_season/);
assert.match(verdictPrompt, /SUPPLIED SEASON IMPACT/);
assert.match(verdictPrompt, /"effectiveWeek":8/);
assert.match(verdictPrompt, /"beforePct":0/);
assert.match(verdictPrompt, /"delta":-0\.3/);
assert.match(verdictPrompt, /"opponentName":"Rival"/);
assert.match(verdictPrompt, /Injury status held fixed/);
assert.match(verdictPrompt, /favorable value grade must not override negative season impact/);
assert.match(verdictPrompt, /percentage-point changes as percentage points/);
assert.match(verdictPrompt, /null, missing or unavailable metric is unknown, never zero/);
assert.doesNotMatch(verdictPrompt, /Age 37|Age 21|PICK 2027|1\.8x|1\.5x|is REBUILDING\. They value:|PRIORITIZE YOUTH/);
assert.match(verdictPrompt, /\*\*SEASON IMPACT\*\* — Explain/);
const unavailableVerdict = c.buildTradeVerdictPrompt({ ...redraftVerdict,
  seasonImpact: { ...redraftVerdict.seasonImpact, status: 'unavailable', reason: 'Schedule missing' } });
assert.match(unavailableVerdict, /Schedule missing/);
assert.doesNotMatch(unavailableVerdict, /"beforePct"|"beforeFinal"|"opponentName"/, 'unavailable snapshots cannot leak stale numeric estimates');
const unavailableOdds = c.buildTradeVerdictPrompt({ ...redraftVerdict, seasonImpact: { ...redraftVerdict.seasonImpact,
  playoffs: { available: false, reason: 'Division rules unknown', beforePct: 88, afterPct: 99 } } });
assert.match(unavailableOdds, /Division rules unknown/);
assert.doesNotMatch(unavailableOdds, /"beforePct":88|"afterPct":99/, 'unavailable odds cannot leak stale percentages');
const dynastyVerdict = c.buildTradeVerdictPrompt({ ...redraftVerdict, leagueType: 'dynasty', seasonImpact: undefined });
assert.match(dynastyVerdict, /this dynasty trade/);
assert.match(dynastyVerdict, /Age 37/);
assert.match(dynastyVerdict, /PICK 2027/);
assert.doesNotMatch(dynastyVerdict, /SUPPLIED SEASON IMPACT|\*\*SEASON IMPACT\*\* — Explain/);
console.log('PASS trade second opinion uses deterministic season estimates, preserves zero and downside, and respects missing odds and redraft horizon');

vm.runInNewContext(fs.readFileSync('js/draft/context.js','utf8'), { window, console });
for (const [settings, expected] of [[{type:1}, true], [{type:0,max_keepers:3}, false], [{type:3,max_keepers:3}, false], [{max_keepers:2}, true]]) {
  const format = window.DraftCC.context.buildLeagueFormat({ currentLeague: { ...league, settings } });
  assert.equal(format.flags.keeper, expected);
}
console.log('PASS keeper weekly lineup access and draft retention flags');

const insightSource = fs.readFileSync('js/tabs/alex-insights.js','utf8');
const insightFn = insightSource.slice(insightSource.indexOf('    function computeInsights('), insightSource.indexOf('    function getInsightsLeagueProfile('));
const computeInsights = vm.runInNewContext('(' + insightFn.trim() + ')', { window, DEFAULT_SETTINGS: {} });
window.App.LI = { playerScores: { veteran: 6000 }, tradeHistory: [] };
const props = { myRoster: { roster_id: 1, players: ['veteran'], settings: {} }, playersData: { veteran: { position: 'WR', age: 33 } }, currentLeague: league };
const seasonalCards = computeInsights(props, {});
assert(!seasonalCards.some(card => /rebuild|cash in now/.test(card.body)));
const dynastyCards = computeInsights({ ...props, currentLeague: { ...league, settings: { type: 2 } } }, {});
assert(dynastyCards.some(card => /cash in now/.test(card.body)));
console.log('PASS redraft suppresses dynasty-only heuristic rebuild advice');
