# Duat compact lineup — hosted verification

**Final result: live and sandbox each passed all four complete viewport journeys. Both processes reached confirmed terminal exit code 0.** Both cache-busted release manifests match application revision `45b18264f9b08ef2e74726c77f659d8c9183b010`.

## Final application release

Both Pages workflows completed successfully before their browser matrix began:

- Live: [Pages run 36181292604](https://github.com/C2-Football/WarRoom/actions/runs/36181292604), [saved status](live-pages.json), [verified manifest](live-release.json), [browser log](live-browser.log), [browser evidence](live-evidence.json).
- Sandbox: [Pages run 36181296232](https://github.com/C2-Football/WarRoom-sandbox/actions/runs/36181296232), [saved status](sandbox-pages.json), [verified manifest](sandbox-release.json), [browser log](sandbox-browser.log), [browser evidence](sandbox-evidence.json).

Exact browser invocations used `DUAT_LINEUP_URL=https://c2-football.github.io/WarRoom/index.html DUAT_LINEUP_PHASE=live node tests/duat-lineup-density-browser.cjs` and the corresponding `/WarRoom-sandbox/index.html` URL with `DUAT_LINEUP_PHASE=sandbox`. The recorded final targets contain only `?duat=1`, with no developer bypass.

| Viewport | Actual collapsed row height | Live | Sandbox |
| --- | --- | --- | --- |
| 320×740 | 76.64px; long name 96.09px | [Passed](live-lineup-320.png) | [Passed](sandbox-lineup-320.png) |
| 390×844 | 76.64px | [Passed](live-lineup-390.png) | [Passed](sandbox-lineup-390.png) |
| 667×375 | 76.64px | [Passed](live-lineup-667.png) | [Passed](sandbox-lineup-667.png) |
| 1440×1000 | 80.64px | [Passed](live-lineup-1440.png) | [Passed](sandbox-lineup-1440.png) |

All eight final journeys verified compact readable rows, at least 44px selection/research controls, exact engine estimates labeled `Est. PPG`, real W7 results including zero, aligned metrics, accessible candidate clues, sealed assigned years, keyboard research independent of lineup selection, all eight normal checkbox interactions, a different legal lineup saved and restored after reload, and the enabled Week 8 kickoff action. There were zero page exceptions and no horizontal overflow.

All phone cases additionally passed simulated 20px safe-area insets, 50px primary actions with zero dock overlap, read-only Army selection with available research, and Escape focus recovery. Each site's 390px journey also verified a fresh Week 1 campaign with explicit archive estimates and no invented previous result.

Public screenshots were reviewed for the compact phone and short-landscape layouts. More detail: [live whole roster](live-roster-390.png), [sandbox whole roster](sandbox-roster-390.png), [live research](live-research-390.png), [sandbox research](sandbox-research-390.png), [live pregame](live-pregame-390.png), [sandbox pregame](sandbox-pregame-390.png).

In the final eight journeys, the archive had finished before research opened. The independent real-table readiness gate and exact candidate-count checks passed, but the conditional loading-verdict assertion was **not exercised by those final runs**; evidence records `explicitLoadingObserved: false` and `loadingVerdictChecked: false`. The deterministic unit regression covers the loading-copy guard. The naturally observed initial timing case remains preserved below rather than being presented as final-code coverage.

## Initial application release

Revision `34a6b4c2b239e7d35425746ec797220ce79261ab` was verified in both cache-busted release manifests after both assigned Pages runs completed successfully:

- Live: [Pages run 36179870328](https://github.com/C2-Football/WarRoom/actions/runs/36179870328), [saved status](initial-live-pages.json), [release manifest](initial-live-release.json).
- Sandbox: [Pages run 36179872690](https://github.com/C2-Football/WarRoom-sandbox/actions/runs/36179872690), [saved status](initial-sandbox-pages.json), [release manifest](initial-sandbox-release.json).

## Loading-path diagnosis

The initial live browser process exited 1 at the exact candidate-clue assertion: the saved Week 8 campaign rendered `8 possible seasons` before the archive arrived, while the complete-data engine fixture expected `1 possible season`. [Original failure](live-initial-loading-race.log).

A separate read-only runtime probe reproduced the transition without delaying or replacing the archive:

- At 19:35:18.869 UTC, the real `logIndex` size was 0 and `archiveReady` was false; the conservative clue showed eight candidates.
- Research opened 44ms later and explicitly reported archive loading. All three archive responses returned HTTP 200; the CSV request finished at 19:35:18.992 UTC.
- At 19:35:19.225 UTC, the real parsed archive contained 127,055 entries, `archiveReady` was true, and the exact clue settled to one candidate. No page errors occurred.

[Runtime evidence](live-loading-diagnostic.json), [diagnostic terminal log](live-loading-diagnostic.log), [loading screenshot](live-research-loading.png), [loaded screenshot](live-research-loaded.png).

The browser harness now waits for the independently observable real seventeen-week archive table before checking exact candidate counts. It retains the equality assertion and records whether loading was observed. After reload it also waits for the actual kickoff action to become enabled. No archive values are substituted and no backend calls are enabled.

The first follow-up matrix was intentionally stopped when the independent reviewer identified a separate existing copy issue: before archive readiness, one paragraph prematurely claimed candidate box scores matched. That paragraph is now gated on archive readiness in final revision `45b18264f9b08ef2e74726c77f659d8c9183b010`. [Intentionally interrupted run](live-interrupted-before-followup.log); it is not counted as a pass. Only the final live/sandbox logs and evidence above establish hosted success.

## Method and boundaries

The test targets the actual public `index.html?duat=1`, with no developer bypass. Disposable browser contexts receive a valid locally saved Hidden Years campaign generated through the real historical engine and legally advanced through seven weeks. All mutation methods are rejected before the same-origin asset allowlist and before navigation; backend/provider requests are blocked. The app's own archive assets are fetched from the tested destination. Pinned runtime dependencies are supplied at their configured versions; external webfonts are omitted. Raw campaign fixtures remain in ignored local output only.

This verifies public frontend behavior with isolated local campaigns. It does not prove hosted authentication, real-user multiplayer, native installation, physical-device behavior, or whole-suite launch readiness.
