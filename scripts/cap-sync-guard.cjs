#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { assertNativeReleaseReady } = require('./native-artifact.cjs');
try {
  assertNativeReleaseReady(path.resolve(__dirname, '..'));
} catch (error) {
  console.error('\ncap-sync-guard:', error.message, '\n');
  process.exitCode = 1;
}
