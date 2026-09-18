# INV-04 — Sleeper portfolio coverage and recovery

Date: 2026-09-18. Branch: `codex/readiness-portfolio-20260918`, based on integrated `13ece66`. Local source and controlled-browser verification; not deployed by this agent.

## High-severity reproduction

The hub fetched a valid list of two leagues, then swallowed per-league roster/user errors. With both details unavailable it displayed **0 connected leagues** and **Your first league starts here**. With one successful league it displayed **1 connected league**, offered no retry or coverage warning, and passed that subset to Empire as the entire portfolio. Thus aggregate holdings and exposure denominators silently excluded unknown leagues. The initial deep-link effect also gave up on a known unavailable league after another league loaded.

The old refresh assigned its return array inside `setSleeperLeagues(previous => ...)`. React may defer that callback, so Empire's awaited refresh could receive `null` rather than the newly fetched data.

## Resolution

- A single loader distinguishes a verified league list from hydrated roster/user data. It streams usable leagues in provider order and carries known, loaded, pending, failed and stale counts independently.
- Failed details remain unknown; no placeholder or zero roster is invented. A failed refresh keeps prior good data, labels it stale and permits retry. A valid empty list removes disconnected leagues; malformed/null/unavailable lists preserve prior data with a warning.
- Stale data cannot cross the provider username or season. Overlapping requests in different contexts cannot overwrite newer data or clear the newer request's loading state. Concurrent retries of the same context share one request.
- Hub empty states, connection status and retry notices distinguish unavailable data from an empty account. Saved league cards are labeled. Known failed deep links stay pending and open after a successful retry.
- Empire displays coverage and a retry action across workspaces. Aggregate/exposure labels identify loaded leagues, unavailable holdings remain unknown, stale data suppresses the Live badge, and incomplete exposure checks do not claim that all holdings fit a limit. Shared player ownership context reports known coverage separately from holdings.
- Refresh returns its fetched snapshot directly, independent of React state-updater scheduling.

## Executed checks

Commands run in this worktree:

- `npm run test:sleeper-portfolio`: 10 passing behavioral tests; no skips. Tests execute actual loader, refresh function, ownership/model/bridge code. Cover all/partial detail failures, streaming, ordered output, retry, stale-good refresh, invalid/list outage, verified empty list, duplicated IDs, timeout, cross-identity/season isolation, deferred React updater and late completion, and honest partial model/ownership coverage.
- `npm run test:workspaces`: routing, notebook, portfolio consolidation and workspace intelligence pass. Added actual deep-link effect recovery with a known unavailable league before retry.
- `npm run test:empire`: 21 valuation, 4 decision and 7 scenario checks pass.
- `npm run test:core`: 97 checks pass.
- `npx eslint js/app.js js/tabs/global-view.js`, `git diff --check`, `npm run build:preview`: pass. Shared synchronization stays at canonical `dhq-shared` revision `5de7baa36225c43e8cacb00a2763e4c65508f296`; no vendored/shared changes.

### Browser evidence

Playwright CLI session `readiness-portfolio` ran the actual built application at `http://127.0.0.1:3498/dist-preview/?dev=true` using a synthetic Sleeper user and two synthetic leagues. All requests to Supabase were intercepted with HTTP 503, so this was not a production-data mutation or authenticated backend proof. Only public-provider reads were otherwise allowed.

Fixtures used public user ID `fixture-owner`, leagues `fixture-alpha` and `fixture-beta`, one controlled roster per league and distinct 1–0 / 2–0 records. No synthetic data entered the production backend. Roster and user responses were changed between success and HTTP 503 to reproduce/recover the actual failures.

Observed:

1. Before fix, both details failed: **0 connected leagues**, **Your first league starts here**, no warning/retry. One detail succeeded: **1 connected league**, no warning/retry.
2. Fixed all-failure: **0 of 2 Sleeper leagues loaded**, **Your league data is unavailable**, missing-league details and reachable retry; no first-league claim. [390px screenshot](sleeper-portfolio-hub-390.png).
3. Fixed partial: **1 of 2 Sleeper leagues loaded** in hub and Empire; Empire explains the subset denominator. Data quality names partial coverage.
4. Clicked Empire **Retry league sync** after restoring the missing roster: both leagues appeared, warning disappeared, and actual `App.PortfolioContext.player('fixture-player')` returned count 2, total 2, covered 2, complete true.
5. Then failed Beta's users response and clicked **Refresh Leagues**: both rosters stayed available, coverage said one league used last loaded data, ownership complete became false, and no Live badge appeared. The 3–0 combined prior record was preserved rather than dropped.
6. Opened `#league=fixture-beta&tab=dashboard` with only Alpha available. After restoring Beta and clicking the hub retry, the unchanged bookmark opened Fixture Beta's dashboard; runtime `S.currentLeagueId` was `fixture-beta` and ownership again reported complete 2/2.
7. At 320×640, 390×844 and 844×390, hub and Empire coverage/retry did not create horizontal overflow. Retry buttons measured 44px high; Empire notice text measured 16px. Hub retry remains reachable by normal scroll in short landscape. Screenshot visually inspected.

Browser console failures were expected blocked Supabase writes, deliberately failed provider details, and 404 reads for synthetic IDs in ancillary league intelligence. No console output is being represented as a clean real-provider journey. The broad suite and final integrated release/browser matrix remain root-owned requirements.

Independent root review inspected loader, request coalescing/progress, known-vs-loaded accounting, stale labels, Empire completeness and regression coverage; no material finding in this batch. This does not resolve the separate pick-feed defect below or declare Empire ready.

## Remaining scope and next executable checks

- Root must review/integrate this batch, run the integrated suites and verify both deployments before claiming it fixed live.
- Native install, physical device and real-account provider availability were not tested here. Responsive-browser evidence is limited to the dimensions above.
- Separate adjacent concern discovered while opening synthetic Empire: `/traded_picks` HTTP 404 became **Pick feed ready** and inferred starting picks. Investigate the existing app/shared feeder's failure-vs-empty contract; do not treat this coverage fix as proof that pick data is truthful.
- Account-session agent owns remaining post-await provider/connection identity guards in app.js after this batch integrates. This loader guards account-session changes before applying results; the existing verified username form also compares captured account metadata before persistence.
