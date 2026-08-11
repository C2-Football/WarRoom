#!/usr/bin/env node
// cap-sync-guard.cjs — refuses to run a Capacitor sync/build while the Time
// League dataset (data/time-league/) is present in the repo.
//
// capacitor.config.json sets webDir: "." (the whole repo root), and
// `npx cap sync`'s copy step (copyWebDir) is a blind recursive copy with no
// filtering — there's no Capacitor-level exclude to hook into. This guard is
// the procedural substitute: it runs as a prerequisite to the cap:* npm
// scripts and refuses to proceed while the dataset directory exists, so it
// can never land in a native iOS/Android build by accident. The dataset is
// sandbox-only and web-only for now (see The Duat's docs/data-sources.md for
// why); pass --include-time-league to override once that changes.
'use strict';

const fs = require('fs');
const path = require('path');

const DATASET_DIR = path.join(__dirname, '..', 'data', 'time-league');
const override = process.argv.includes('--include-time-league');

if (fs.existsSync(DATASET_DIR) && !override) {
    console.error(
        '\ncap-sync-guard: refusing to sync/build a native app while data/time-league/ exists.\n' +
        'That dataset (weekly game logs + player cards, ~20MB) is web-only for now — it must not\n' +
        'land in an iOS/Android bundle. Re-run with --include-time-league if that has changed.\n',
    );
    process.exit(1);
}

process.exit(0);
