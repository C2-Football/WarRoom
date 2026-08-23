#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label}: expected ${needle}`);
  }
}

function assertFile(rel, checks) {
  const source = read(rel);
  checks.forEach(([needle, label]) => assertIncludes(source, needle, `${rel} ${label}`));
}

console.log('\nWar Room intelligence surface contract');

const checks = [
  ['reconai-shared/intelligence-context.js', [
    ['buildPlayerContext', 'exports player context builder'],
    ['buildTeamContext', 'exports team context builder'],
    ['buildWhyView', 'exports shared why renderer'],
    ['getSourceRegistry', 'exports source registry'],
    ['buildSourceEvidence', 'exports source evidence builder'],
    ['sourceFreshness', 'exports source freshness helper'],
    ['buildFantasyCalcRequest', 'exports FantasyCalc request builder'],
    ['fetchFantasyCalcSnapshot', 'exports FantasyCalc snapshot fetcher'],
  ]],
  // player-card and free-agency deliberately DO NOT render the why view.
  // 58a7fe9 ("strip league-context + bottom AI notes from player cards")
  // removed the League Context block, the bottom AI Recommendation box and
  // the format-reason tail on FA's why line, as an explicit de-cluttering
  // pass — the cards were "drowning in" that context. Both surfaces still
  // BUILD their recommendation object (asserted below); it is only the
  // rendered why block that was cut, so those assertions stay.
  //
  // The buildWhyView assertions for these two files were left behind and had
  // this contract failing from 58a7fe9 until 2026-08-23. It went unnoticed
  // because that commit verified with `node tests/run.js` (the 108-test core
  // suite) rather than the full `npm test` chain this contract sits in.
  // Do not "restore" a why view here on the strength of a test name.
  ['js/components/player-card.js', [
    ['buildPlayerContext', 'uses shared player context'],
    ['buildRosterRecommendation', 'uses roster recommendation object'],
  ]],
  ['js/free-agency.js', [
    ['buildPlayerContext', 'uses shared player context'],
    ['buildWaiverRecommendation', 'uses waiver recommendation object'],
  ]],
  ['js/trade-calc.js', [
    ['buildTeamContext', 'uses shared team context'],
    ['buildTradeRecommendation', 'uses trade recommendation object'],
    ['buildWhyView', 'renders why view from recommendation'],
    ['ownerBehaviorProfiles', 'stores shared owner behavior objects'],
  ]],
  ['js/tabs/alex-insights.js', [
    ['buildBehavioralRecommendation', 'uses behavioral recommendation object'],
    ['buildWhyView', 'renders why view from recommendation'],
  ]],
];

let passed = 0;
const failures = [];

for (const [rel, fileChecks] of checks) {
  try {
    assertFile(rel, fileChecks);
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failures.push(`  FAIL: ${err.message}`);
    process.stdout.write('F');
  }
}

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

const failed = failures.length;
console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} files - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
