#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stageNative } = require('./native-artifact.cjs');
const root = path.resolve(__dirname, '..');
try {
  execFileSync(process.execPath, ['scripts/sync-reconai-shared.cjs'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/build-deploy.cjs'], { cwd: root, stdio: 'inherit' });
  const result = stageNative(root);
  console.log(`[build-native] Staged ${result.files} public assets (${(result.bytes / 1024 / 1024).toFixed(2)} MiB) in dist-native/`);
  console.log('[build-native] Staging verified. Native copy/build is blocked by the Vault archive policy; see docs/native-packaging.md.');
} catch (error) {
  console.error('[build-native] failed:', error.message);
  process.exitCode = 1;
}
