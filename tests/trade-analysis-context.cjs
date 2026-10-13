'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const source = fs.readFileSync('js/trade-calc.js', 'utf8');
const names = ['tcTradeVerdictKey', 'tcSeasonVerdictEvidence', 'buildTradeVerdictContext', 'requestAlexVerdict'];
const functions = new Map();
Babel.packages.traverse.default(Babel.packages.parser.parse(source, { plugins: ['jsx'] }), {
  FunctionDeclaration(path) { if (names.includes(path.node.id?.name)) functions.set(path.node.id.name, source.slice(path.node.start, path.node.end)); },
});
assert.equal(functions.size, names.length, 'Exercise the actual client context and request functions');
const pending = [], updates = [], saved = [];
const context = vm.createContext({
  window: { App: { WeeklyProj: { currentWeek: () => 7 } }, WR: { AIContext: { decisionContext: () => ({ leagueType: 'redraft', phase: 'in_season' }) } },
    OD: { callAI: args => new Promise((resolve, reject) => pending.push({ args, resolve, reject })), saveAIAnalysis: (...args) => { saved.push(args); return Promise.resolve(); } } },
  currentLeague: { name: 'Example', season: '2026', status: 'in_season', settings: { type: 0 }, roster_positions: ['RB', 'FLEX'], scoring_settings: { rec: 1 } },
  leagueId: 'league-one', resolvedLeagueSkin: { type: 'redraft', phase: 'in_season' },
  tradeIds: { A: ['sent'], B: ['received'] }, tradePickIds: { A: [], B: [] }, tradeFaab: { A: 0, B: 0 },
  playerAsset: pid => ({ name: pid === 'sent' ? 'Outgoing starter' : 'Incoming starter', pos: 'RB', age: 25, value: 1000 }),
  assessments: [{ ownerId: 'partner', ownerName: 'Example partner', wins: 2, losses: 4, needs: [] }],
  myAssessment: { wins: 3, losses: 3, needs: [], strengths: ['RB'] },
  setAlexVerdict: data => updates.push(data), activeTradeVerdictKeyRef: { current: 'old' }, alexVerdictRequestRef: { current: 0 },
});
vm.runInContext(names.map(name => functions.get(name)).join('\n'), context);
const result = { status: 'limited', effectiveWeek: 8,
  powerRank: { before: 4, after: 5, beforePoints: 100, afterPoints: 95 },
  wins: { beforeRemaining: 3, afterRemaining: 2.5, delta: -.5 },
  playoffs: { available: false, beforePct: null, afterPct: null, reason: 'Schedule incomplete.' },
  weeks: [{ week: 8, opponentName: 'Trade partner', beforePoints: 100, afterPoints: 95, opponentBeforePoints: 94, opponentAfterPoints: 100,
    beforeWinPct: 0, afterWinPct: null, pointsDelta: -5, beforeStarters: [{ pid: 'sent' }], afterStarters: [{ pid: 'received' }], unfilledAfter: 1 }],
  assumptions: ['Current injuries held fixed.'], warnings: ['One lineup slot remains open.'], coverage: { projected: 1, total: 7 },
};
const controller = { enabled: true, status: 'ready', analyze: () => result, playerName: pid => pid === 'sent' ? 'Outgoing starter' : 'Incoming starter' };
const verdict = { otherOwnerId: 'partner', psychTaxes: [], grudgeTax: { total: 0 }, otherDnaKey: 'NONE', theirPosture: {},
  verdictText: 'A · GOOD VALUE', diffDisplay: '+1000', likelihood: 60, seasonImpactController: controller, seasonImpactDeal: {} };
const output = context.buildTradeVerdictContext(verdict);
assert.equal(output.leagueType, 'redraft'); assert.equal(output.decisionContext.leagueType, 'redraft'); assert.equal(output.currentWeek, 7);
assert.equal(output.seasonImpact.wins.delta, -.5, 'A good value grade must carry the actual negative season effect');
assert.equal(output.seasonImpact.playoffs.beforePct, null, 'Unavailable playoff odds remain unknown');
assert.equal(output.seasonImpact.weeks[0].beforeWinPct, 0, 'A genuine zero survives context serialization');
assert.equal(output.seasonImpact.weeks[0].afterWinPct, null);
assert.equal(output.seasonImpact.weeks[0].opponentAfterPoints, 100, 'Alex sees the changed trade partner');
assert.equal(output.seasonImpact.weeks[0].startersOut[0], 'Outgoing starter');
assert.equal(output.seasonImpact.weeks[0].startersIn[0], 'Incoming starter');
assert.equal(output.seasonImpact.weeks[0].unfilledAfter, 1);
assert.equal(output.seasonImpact.assumptions[0], result.assumptions[0]);
assert.equal(context.tcSeasonVerdictEvidence({ enabled: false }, {}), null);
assert.equal(context.tcSeasonVerdictEvidence({ enabled: true, status: 'unavailable', reason: 'Unsupported league rules.' }, {}).reason, 'Unsupported league rules.');
assert.equal(context.tcSeasonVerdictEvidence({ enabled: true, status: 'loading' }, {}).status, 'loading');
assert.equal(context.tcSeasonVerdictEvidence({ ...controller, analyze() { throw Error('failed'); } }, {}).status, 'unavailable');
const keyInput = { leagueId: 'one', season: '2026', owners: { A: 'me', B: 'partner' }, tradeIds: { A: ['a', 'b'], B: ['c'] }, tradePickIds: { A: [], B: [] }, tradeFaab: {}, seasonKey: 'evidence-1' };
const key = context.tcTradeVerdictKey(keyInput);
assert.equal(context.tcTradeVerdictKey({ ...keyInput, tradeIds: { A: ['b', 'a'], B: ['c'] } }), key, 'Asset order alone must not invalidate the same deal');
for (const override of [{ leagueId: 'two' }, { season: '2027' }, { owners: { A: 'other', B: 'partner' } }, { seasonKey: 'evidence-2' }, { tradeIds: { A: ['a'], B: ['c'] } }, { tradeFaab: { A: 10 } }])
  assert.notEqual(context.tcTradeVerdictKey({ ...keyInput, ...override }), key, 'Changed league, owners, deal or season evidence invalidates Alex');

(async () => {
  const old = context.requestAlexVerdict(verdict, 'old');
  assert.equal(pending[0].args.context.seasonImpact.wins.delta, -.5);
  context.activeTradeVerdictKeyRef.current = 'new'; pending[0].resolve({ analysis: 'Stale old league read' }); await old;
  assert.equal(updates.length, 1, 'A late old response cannot replace the current analysis'); assert.equal(saved.length, 0, 'Stale responses must not be saved');
  const first = context.requestAlexVerdict(verdict, 'new'), second = context.requestAlexVerdict(verdict, 'new');
  pending[2].resolve({ analysis: 'Newest complete explanation' }); await second;
  pending[1].resolve({ analysis: 'Earlier retry' }); await first;
  assert.equal(updates.at(-1).text, 'Newest complete explanation'); assert.equal(saved.length, 1);
  const staleFailure = context.requestAlexVerdict(verdict, 'new');
  context.activeTradeVerdictKeyRef.current = 'refreshed'; pending[3].reject(Error('Old failure')); await staleFailure;
  assert(!updates.some(update => update.error), 'A stale failure cannot replace refreshed evidence');
  console.log('PASS unified trade-analysis context: shared season evidence, unavailable/zero values, changed starters and opponent, refreshed keys, and stale request/save isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
