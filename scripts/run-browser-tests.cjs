#!/usr/bin/env node
'use strict';

// Browser journeys are a separate release gate. Run every suite even after a
// failure, and never turn a missing browser or skipped journey into a pass.
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const suites = [
  'browser-readonly.cjs',
  'browser-qa.js', 'launch-browser-qa.js', 'live-click-paths.js',
  'draft-browser-qa.js', 'league-skin-browser-qa.js', 'empire-save-browser-qa.cjs', 'vault-auth-browser-qa.cjs', 'account-password-browser-qa.cjs', 'empire-seasonal-browser-qa.cjs', 'empire-draft-inventory-browser-qa.cjs', 'league-linked-season-browser-qa.cjs', 'commish-proposal-browser.cjs',
  'commish-polish-browser.cjs', 'duat-polish-browser.cjs', 'vault-phone-density-browser.cjs',
];
async function main() {
  let server;
  try {
    // The read-only fixture suites share a fresh preview of this exact worktree.
    // Do not silently connect to another task's long-running preview server.
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser gate preview did not start')), 10000);
      server = spawn(process.execPath, ['scripts/serve-static.cjs', '--host=127.0.0.1', '--port=0'], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      });
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error('Browser gate preview exited ' + code)); });
      let output = '';
      server.stdout.on('data', chunk => {
        output += String(chunk);
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      server.stderr.on('data', chunk => process.stderr.write(chunk));
    });
    // Standalone suites accept explicit deployed/dev URLs. The release gate
    // must always verify its own fresh compiled worktree, even if the caller
    // previously exported a standalone override.
    const gateEnv = { ...process.env, READINESS_PREVIEW_ORIGIN: origin, READINESS_PREVIEW_PATH: '/dist-preview/' };
    delete gateEnv.READINESS_PREVIEW_URL;
    delete gateEnv.COMMISH_POLISH_URL;
    delete gateEnv.DUAT_POLISH_URL;
    delete gateEnv.VAULT_DENSITY_URL;
    delete gateEnv.VAULT_DENSITY_PHASE;
    delete gateEnv.VAULT_DENSITY_WIDTHS;
    let failed = 0;
    for (const suite of suites) {
      console.log(`\nRunning ${suite}`);
      const result = spawnSync(process.execPath, [path.join(root, 'tests', suite)], {
        cwd: root, env: gateEnv, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
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
  } finally { if (server) server.kill('SIGTERM'); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
