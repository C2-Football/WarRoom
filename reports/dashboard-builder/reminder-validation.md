# Reminder frontend validation — 2026-10-23

The local candidate passes the reminder browser flow and production build. These checks use the shared dependency pinned at `74d6369224db5b814a9f3fdeff8fb7d60735aa81` through `SHARED_SOURCE=/private/tmp/dhq-alex-shared-74d6369`.

## Checks

- `npm run test:dashboard-builder`: passed, including 31 reminder groups, three email opt-out groups, dashboard/query/render/preview coverage, and the executable release packaging regression. Channel fixtures enforce the backend's exact payload allowlists; only schedule changes carry operation IDs.
- `node tests/account-session.cjs`: passed after the channel payload correction, including real logout cleanup and account changes.
- `npm run test:chain`: passed. The initial sandbox run stopped at its local preview server; the run with loopback permission completed successfully. The latest channel and opt-out changes were then checked by the focused suites and browser matrix.
- The 17 routine suites omitted by the chain/focused run were executed with `scripts/run-tests.cjs --only=...`: 16 passed. Duat had one timing-only failure at `tests/duat-provinces.js:110` (2,161 ms). The unchanged failing file passed all 10 tests in isolation, with that check taking 235 ms. The original aggregate failure remains recorded; no Duat code or timing threshold was changed.
- `npm run test:dashboard-reminder-browser`: passed at 320×700, 390×844, 667×375 with touch input, and 1365×900. No browser runtime errors. Source hashes were unchanged throughout the final run.
- Production build passed: 165 JSX modules, 313 total minified modules. Syntax and whitespace checks passed.

The routine test runner now includes `dashboard-builder`. Its 49-suite inventory is covered by the full chain, focused builder suite, and the 17 supplementary suites, subject to the recorded Duat timing failure and isolated retry above.

## Browser behavior

The real application was exercised with invalid/correct email verification, email disable, daily scheduling, scheduled/pause states, lost-response reconciliation, unavailable reads, reload, and iOS Home Screen guidance. Push permission is requested only during a trusted click. The actual service worker registers and stores/clears its account/device binding through real MessageChannel and IndexedDB calls; subscription, disconnect and permission decline are checked.

The real email opt-out page strips its fragment capability, makes no automatic opt-out request, rejects malformed links, and requires an explicit action. Network errors remain retryable; only an acknowledged response shows success, and expired links remain inactive. All four viewports cover the opt-out flow, viewport fit and reachable touch controls.

## Release packaging

`dashboard-reminder-sw.js` is discovered explicitly because it is registered dynamically rather than referenced by an HTML script tag. The build emits it into the Pages overlay and records its shipped-byte hash in `release.assets`. The release regression runs the actual builder in a temporary fixture, verifies raw-copy/overlay ordering and hashes, and verifies a missing required worker fails the build.

`reminder-unsubscribe.html` is explicitly copied into the Pages artifact and is a compiled entry with a content-hashed script. Both it and the worker are included in the existing two-host release verifier for C2-Football/WarRoom and C2-Football/WarRoom-sandbox.

Local production asset fingerprints:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `dashboard-reminder-sw.js` | 3,483 | `6433a92a0f6099ec9e74735df01efc8826866c4832a44e6cc47909819770e0d7` |
| `js/shared/reminder-unsubscribe.js` | 1,863 | `d0bce8efb63a259aab2c92f3d4a02475f933cc1345d2fbaa1611f342e11d0367` |

The local build was made from the uncommitted candidate based on `32baf402c96b2668cc8236952a3bac694b820715`; its revision metadata is not hosted release proof.

## Evidence boundary

Browser evidence is in `output/playwright/dashboard-reminders/`: `results.json`, source hashes, and screenshots of scheduled email/push, permission decline and email opt-out. Test/build logs and built asset metadata are in `output/dashboard-reminders/validation/`.

Accounts, league/provider data, delivery API responses, Notification permission and PushManager subscription transport are fixtures. No live email, push notification or unsubscribe was sent by these tests. This is local Chromium emulation and real local service-worker behavior, not physical-device, Safari, authenticated hosted backend, scheduler execution or recipient delivery proof. The shared owner backend release and actual delivery confirmation remain separate and pending; hosted production and sandbox verification must follow publication of the final commit.
