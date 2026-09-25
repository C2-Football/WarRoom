# Duat hosted polish verification — 2026-09-25

**Result: both deployed frontend destinations passed the unchanged Duat polish browser journey at all four viewports.** Both processes completed with exit code 0. No production source or test changes were made during this verification.

## Released revision

Expected revision: `46c65405542d35233bfb44596e8a80eca7394a33`.

Both cache-busted `release.json` responses matched this revision before browser testing:

| Destination | Manifest checked at (UTC) | Build time (UTC) | Browser result |
| --- | --- | --- | --- |
| [Live](https://c2-football.github.io/WarRoom/index.html) | 16:52:42.058 | 16:51:19.466 | 4/4 viewports, exit 0 |
| [Sandbox](https://c2-football.github.io/WarRoom-sandbox/index.html) | 16:52:42.128 | 16:51:27.754 | 4/4 viewports, exit 0 |

Full responses: [live manifest](polish-hosted-duat-live-release.json), [sandbox manifest](polish-hosted-duat-sandbox-release.json).

## Actual checks

Ran `tests/duat-polish-browser.cjs` sequentially with `DUAT_POLISH_URL` targeting each deployed `index.html`. Preserved live evidence before the sandbox run. The test retained its existing assertions and external-mutation guard.

- Viewports: 320×740, 390×844, 667×375, 1440×1000.
- Entry: selected mode is visually distinct; Resurrection keeps its unavailable-feed warning; faction disclosure/search and existing first-expedition rules work.
- Creation: a new campaign enters the draft, restores a readable scroll position, and accepts a real draft pick.
- Weekly play: a valid campaign generated through the historical engine opens; alliance reveal and lineup selection work. Normal checkbox interaction correctly disables/enables continuation for illegal/legal lineups.
- Persistence: the saved weekly step survives reload; the next kickoff action is enabled.
- Phone navigation: Realm calendar expands; campaign backup downloads and contains the fixture campaign; Escape dismisses More.
- Every viewport: zero uncaught page errors, no horizontal overflow, no primary-action/dock overlap. Primary actions measured 50px on phone and 44px on desktop.
- Screenshot review: live 320px entry, live short-landscape lineup, live desktop Home, and sandbox 390px Home retained the intended typography, atmospheric artwork, hierarchy, and readable controls.

## Evidence and boundaries

- Logs: [live](polish-hosted-duat-live.log), [sandbox](polish-hosted-duat-sandbox.log).
- Machine-readable results: [live](polish-hosted-duat-live-evidence.json), [sandbox](polish-hosted-duat-sandbox-evidence.json).
- Separate screenshot/backup directories: `output/playwright/duat-polish-hosted-live/` and `output/playwright/duat-polish-hosted-sandbox/`.

These checks used the **actual served frontend assets**, with the existing `?dev=true&duat=1` entry and disposable browser contexts. The test created local campaigns and a valid fixture through the real historical archive engine. The visible preview banner is produced by that dev query on either host. Pinned third-party runtime scripts were fetched at their configured versions and supplied to the browser; remote fonts were omitted.

All non-GET/HEAD requests were blocked before the same-origin asset allowlist; external backend/provider requests were blocked. No real accounts or hosted records were mutated. This is deployed responsive-browser, interaction, and local-persistence evidence. It does **not** establish hosted authentication, multiplayer, real provider availability, native installation, physical-device behavior, complete season progression, or whole-suite public-launch readiness.
