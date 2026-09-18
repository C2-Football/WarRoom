# Native packaging and release gate

`npm run build:native` creates a **staging artifact**, not an installable or
release-ready app. Capacitor now reads `dist-native/`, never the repository root.
The builder syncs the canonical shared engine, uses the production compiler,
and copies an explicit public-asset allowlist. The emitted manifest records
source and output hashes. Files outside the allowlist, symbolic links, private
paths, stale source, missing entry dependencies, and browser Babel fail validation.

The old configuration used `webDir: "."`. Capacitor's recursive copy could
therefore include repository metadata, local configuration, backend source,
tests, and the entire Vault archive if its npm-only guard was bypassed. Guard
hooks now also run before direct Capacitor `copy` and `sync` commands. The old
`--include-time-league` argument grants no exception.

## Unresolved required archive

The Vault is still present in the app. Its complete native journey requires an
archive cleared for that distribution, and native copy/sync/build remains
**blocked** until that dependency and the game journey are verified. Omitting
the files while producing a working-looking installer would leave that promised
journey broken, so the guard fails even after safe staging passes. Do not fetch
the same restricted archive remotely as a workaround.

The existing guard referenced `/Users/jacobc/The Duat/docs/data-sources.md`.
The document's merger-era decision (lines 82–105 as inspected 2026-09-18) says the
1970–1998 Kaggle/PFR corpus is local-only and must not ship in DHQ distributions.
`data/time-league/regular-season-manifest.json` records that corpus as the current
archive's historical source. Its modern segment is the nflverse CC-BY-4.0 source.
This is a recorded project-policy/provenance conflict, not a new legal judgment.

The existing public Pages workflow also copies this archive. That separate
release-policy conflict must be resolved explicitly; packaging changes do not
establish distribution rights. Do not silently remove historical eras, rewrite
existing saves, or mark the Vault optional to close this blocker.

The currently available local nflverse cache and the upstream
[loader's supported range](https://raw.githubusercontent.com/nflverse/nflreadr/main/R/load_stats.R)
start at 1999. They do not replace the promised merger-era game pool. To unblock,
provide documented clearance for the required archive or an approved replacement
with equivalent coverage, then validate compatibility and full game/recovery
journeys before replacing the explicit guard with an enforceable asset contract.
No purchase, new terms acceptance, scraping, or public data mutation is authorized
by this tooling change.

## Commands and evidence levels

```sh
npm run build:native
npm run test:native
NATIVE_ARTIFACT_CHECK=1 npm run test:native
node scripts/cap-sync-guard.cjs  # currently fails for the required archive
```

The artifact-specific check verifies every staged JavaScript file parses and
checks entry dependencies and hashes. Default tests exercise injection, stale
source, private files, symlinks, unresolved archive, and actual Capacitor hooks.
They run as part of `npm test`.

Packaging, native compilation, install, physical-device journeys, and store
publication are separate acceptance stages. No checked-in iOS/Android platform
project exists. On the inspected host, full Xcode, a working Java runtime, and
the Android SDK are unavailable. A passing staging build does not claim those
later stages. Preserve the existing app ID when the archive and toolchains are
ready; follow [Capacitor's build workflow](https://capacitorjs.com/docs/basics/workflow).
