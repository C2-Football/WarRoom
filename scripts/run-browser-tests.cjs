#!/usr/bin/env node
'use strict';

// Browser journeys are a separate release gate. Run every suite even after a
// failure, and never turn a missing browser or skipped journey into a pass.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const suites = [
  'browser-readonly.cjs',
  'browser-qa.js', 'launch-browser-qa.js', 'live-click-paths.js',
  'draft-browser-qa.js', 'league-skin-browser-qa.js', 'empire-save-browser-qa.cjs', 'vault-auth-browser-qa.cjs',
];
let failed = 0;
for (const suite of suites) {
  console.log(`\nRunning ${suite}`);
  const result = spawnSync(process.execPath, [path.join(root, 'tests', suite)], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  const output = (result.stdout || '') + (result.stderr || '');
  process.stdout.write(output);
  const skipped = /^\s*SKIP\b|probe skipped/im.test(output);
  if (result.status !== 0 || result.error || skipped) {
    failed++;
    console.error(`FAIL ${suite}${skipped ? ': required browser coverage was skipped' : ''}${result.error ? ': ' + result.error.message : ''}`);
  } else console.log(`PASS ${suite}`);
}
console.log(`\n${failed ? 'FAIL' : 'PASS'} browser gate: ${suites.length - failed} passed, ${failed} failed; all ${suites.length} suites attempted`);
process.exitCode = failed ? 1 : 0;
