# Duat compact lineup — hosted verification

Status: post-deployment checks paused for the final research-loading copy follow-up. No full hosted matrix is currently claimed as passed. Final release verification will replace this status after both four-viewport processes finish.

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

The follow-up matrix was intentionally stopped when the independent reviewer identified a separate existing copy issue: before archive readiness, one paragraph prematurely claimed candidate box scores matched. Root owns the production correction and follow-up release. [Intentionally interrupted run](live-interrupted-before-followup.log); this is not counted as a pass.

## Method and boundaries

The test targets the actual public `index.html?duat=1`, with no developer bypass. Disposable browser contexts receive a valid locally saved Hidden Years campaign generated through the real historical engine and legally advanced through seven weeks. All external mutation methods are rejected before navigation; backend/provider requests are blocked. The app's own archive assets are fetched from the tested destination. Raw campaign fixtures remain in ignored local output only.

This verifies public frontend behavior with isolated local campaigns. It does not prove hosted authentication, real-user multiplayer, native installation, physical-device behavior, or whole-suite launch readiness.
