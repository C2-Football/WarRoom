# Native readiness batch 1 — 2026-09-18

Status: safe staging fixed and verified; native release blocked by a required
archive distribution dependency and unavailable native build toolchains.

Worktree: `/Users/jacobc/Projects/warroom-readiness-native`
Branch: `codex/readiness-native-20260918`
Baseline: `5d28f39` (full final change revision: the commit containing this report).
Canonical shared revision verified locally:
`5de7baa36225c43e8cacb00a2763e4c65508f296`, matching the Pages dependency pin.
No push, deployment, platform generation, installation, or remote data mutation.

## Issues and resolution

| Issue | Severity | Reproduction / cause | Resolution / status |
| --- | --- | --- | --- |
| NATIVE-001: unsafe root copy | High | `capacitor.config.json` had `webDir: "."`; old `cap-sync-guard` only blocked npm wrappers and had a dataset override. Native copy would recursively package non-public repository files. | Dedicated public-asset `dist-native/`, production compilation, source/output inventories and hashes, safe-path and symlink validation; direct Capacitor copy/sync hooks now guard. Verified with injected private files, restricted archive, symlinks and stale assets. |
| NATIVE-002: required Vault archive | Launch blocker | Original guard exits 1 with the tracked archive present. Current archive includes the historical corpus explicitly excluded by its referenced project data policy. Removing the guard or excluding data without preventing native release breaks a promised game journey. | Native staging excludes the archive. Native copy/sync/build remain fail-closed with a concrete blocker, including the old override flag and edited artifact readiness metadata. Full Vault UI remains in the staged app; no scope reduction or remote-fetch workaround. |
| NATIVE-003: nested Draft ships browser Babel | Medium | `draft-war-room/index.html` loads Babel and inline JSX but was absent from production entry list. | Added the actual entry to production compilation; nested script references resolve relative to the entry and preserve their URL paths while receiving content hashes. Verified staged entry has no browser Babel and referenced compiled assets exist. |
| NATIVE-004: native toolchain/evidence | External blocker | No tracked/generated ios/android project. `xcodebuild -version` reports only Command Line Tools; `java -version` reports no runtime; no Android SDK/adb/gradle found. | Documented; no unsupported install/device/store claims. |

## Verification actually completed

- Original guard failure reproduced before edits.
- `npm run build:native`: passed; 426 public assets, 37.32 MiB, with all 11 root
  entries plus the nested Draft entry. Production build compiled 148 JSX scripts
  and minified 257 modules. The separate ~54 MiB `data/time-league` archive is absent.
- `npm run test:native`: 8/8 passed, no skips.
- `NATIVE_ARTIFACT_CHECK=1 npm run test:native`: 9/9 passed, no skips; checks every
  staged `.js` with Node's parser as well as source/output hashes and local
  script/style dependencies, including deferred Vault and Duat modules.
- Actual installed Capacitor hook runner invoked both copy-before and sync-before
  hooks; both rejected the unresolved archive before any native copy.
- `npm run test:core`: 97/97 passed.
- `npm run test:login-auth`: passed all 16 restoration scenarios.
- No backend or browser behavior change beyond the existing nested Draft build.
  These are source/staging checks, not native/browser-device journey proof.

## Data lineage and alternatives investigated

The source document `/Users/jacobc/The Duat/docs/data-sources.md`, lines 82–105,
states the merger-era corpus was local-only. The current archive manifest,
`data/time-league/regular-season-manifest.json`, lines 38–48, records the matching
`zynicide/nfl-football-player-stats` corpus and exact source hashes. Its modern
segment declares nflverse CC-BY-4.0 at lines 50–56. `REGULAR-SEASON-DATA.md`
describes the same pre-1999 source. Existing `deploy.yml` copies the archive into
Pages, so the mismatch also needs explicit resolution in public launch policy.

Read-only local inspection found nflverse weekly CSVs for 1999–2025 and the same
Kaggle historical source. No equivalently covered cleared replacement was found.
The current upstream [nflverse loader](https://raw.githubusercontent.com/nflverse/nflreadr/main/R/load_stats.R)
limits seasons to 1999 onward (lines 104–114, accessed 2026-09-18). A Sports
Reference data-use page returned HTTP 403, so no new clearance is inferred.
This does not establish that no licensed alternative exists; obtaining one or
accepting different historical coverage is outside the current authority.

## Next executable steps

1. Integrate this batch and run `npm test` plus integrated browser QA. Have an
   independent reviewer inspect the allowlist, output validation and build change.
2. Continue all independent public-suite fixes; keep native and archive readiness
   blocked rather than turning this staging result into a launch claim.
3. Once existing distribution clearance or an approved equivalent archive is
   available, implement its validated native asset contract and test full Vault
   entry/draft/season/completion/save/recovery before removing the explicit gate.
4. With native toolchains available, generate platforms, verify actual copied
   assets, compile, install on supported devices, and separately verify store
   signing/distribution prerequisites.
