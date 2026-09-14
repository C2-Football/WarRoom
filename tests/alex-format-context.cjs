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
const c = load('supabase/functions/ai-analyze/index.ts', {}, ['adviceLeagueType','buildDecisionRules','buildTeamModeBlock','buildQualityThresholdBlock','buildLeagueFormatBlock','detectLeagueFormat','buildScarcityBlock','buildSystemPrompt']).context;
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
