#!/usr/bin/env node
// Copy the shared browser-engine modules into War Room for local dev + deploy.
// Canonical source is the neutral C2-Football/dhq-shared repo — checked out as a
// sibling ../dhq-shared locally, or pointed at via $SHARED_SOURCE in CI. War Room
// no longer reads the ReconAI repo for shared code (both apps vendor dhq-shared).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'reconai-shared');

const FILES = [
  'app-config.js',
  'bug-capture.js',
  'constants.js',
  'utils.js',
  'storage.js',
  'event-bus.js',
  'platform-provider.js',
  'sleeper-api.js',
  'espn-api.js',
  'mfl-api.js',
  'yahoo-api.js',
  'supabase-client.js',
  'tier.js',
  'pick-value-model.js',
  'dhq-providers.js',
  'dhq-core.js',
  'intelligence-context.js',
  'dhq-engine.js',
  'nfl-fit.js',
  'team-assess.js',
  'analytics-engine.js',
  'dhq-ai.js',
  'assistant-tutorial.js',
  'ai-dispatch.js',
  'strategy.js',
  'trade-engine.js',
  'mock-engine.js',
  'gm-engine.js',
  'player-modal.js',
  'rookie-data.js',
];

function findSourceDir() {
  const candidates = [
    process.env.SHARED_SOURCE,
    process.env.RECONAI_SHARED_SOURCE, // back-compat alias
    path.resolve(ROOT, '..', 'dhq-shared'),
    path.resolve(ROOT, '..', 'reconai', 'shared'), // legacy fallback
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function hasBundledSnapshot() {
  return FILES.every(file => fs.existsSync(path.join(TARGET, file)));
}

const SOURCE = findSourceDir();

if (!SOURCE) {
  if (hasBundledSnapshot()) {
    console.log('[sync-reconai-shared] Source checkout unavailable; using bundled reconai-shared snapshot');
    process.exit(0);
  }
  console.error('[sync-reconai-shared] Missing ReconAI shared source and bundled snapshot');
  process.exit(1);
}

fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

for (const file of FILES) {
  const src = path.join(SOURCE, file);
  if (!fs.existsSync(src)) {
    console.error(`[sync-reconai-shared] Missing shared file: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(TARGET, file));
}

console.log(`[sync-reconai-shared] Copied ${FILES.length} files to ${path.relative(ROOT, TARGET)}/`);

// ── Rookie/prospect CSVs (shared data) ──────────────────────────────────────
// Vendored from dhq-shared/draft-war-room into War Room's own draft-war-room/ so
// the app loads them SAME-ORIGIN (no cross-repo jsDelivr fetch). Copy-in-place —
// do NOT wipe draft-war-room/ (it also holds War-Room-only tool files + data).
const DATA_FILES = ['player.csv', 'player-enrichment.csv', 'data/mock_draft_db.csv'];
const DATA_SOURCE = path.join(SOURCE, 'draft-war-room');
const DATA_TARGET = path.join(ROOT, 'draft-war-room');

if (fs.existsSync(DATA_SOURCE)) {
  for (const file of DATA_FILES) {
    const src = path.join(DATA_SOURCE, file);
    if (!fs.existsSync(src)) {
      console.error(`[sync-reconai-shared] Missing shared data file: ${src}`);
      process.exit(1);
    }
    const dest = path.join(DATA_TARGET, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  console.log(`[sync-reconai-shared] Vendored ${DATA_FILES.length} rookie CSVs into draft-war-room/`);
} else if (DATA_FILES.every(f => fs.existsSync(path.join(DATA_TARGET, f)))) {
  console.log('[sync-reconai-shared] No draft-war-room/ in source; keeping existing vendored CSVs');
} else {
  console.error('[sync-reconai-shared] Missing rookie CSVs in source and locally');
  process.exit(1);
}
