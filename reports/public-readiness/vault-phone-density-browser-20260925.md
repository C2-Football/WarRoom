# Vault phone density browser verification — 2026-09-25

Status: **passed on the final compiled candidate**, at 320 × 740, 390 × 844, 667 × 375, and 1440 × 1000. All four journeys completed with no page errors. Production release verification is recorded separately by the release owner.

The supplied screenshots show oversized roster rows and Game day matchups. The fixture uses the current engine and bundled real historical archive: six teams, a legal 72-pick draft, completed Week 1, and a legal Week 2 waiver claim. Tom Brady has a recorded 10.4 points/game; newly acquired Emmitt Smith has an explicitly labeled 9.3 archive estimate. No scores or historical player records were invented. All saves live in disposable browser contexts, and a network mutation deny rule is installed before the page opens. This does not establish hosted-account, multiplayer, native-build, or physical-device behavior.

## Measured density

Comparisons use the same first player row and first matchup pair before and after. Long names and FLEX metadata may wrap; the new test separately verifies that score and metadata text never collide, including at final scores.

| Viewport | First roster row, before → after | First pregame pair, before → after | Final candidate median roster / pair |
| --- | ---: | ---: | ---: |
| 320 × 740 | 163.7 → 87.4 px | 178.7 → 67.4 px | 87.4 / 88.2 px |
| 390 × 844 | 163.7 → 87.4 px | 158.4 → 67.4 px | 87.4 / 67.4 px |
| 667 × 375 | 163.7 → 87.4 px | 158.4 → 67.4 px | 87.4 / 67.4 px |
| 1440 × 1000 | 146.9 → 146.9 px | 87.8 → 87.8 px | 146.9 / 87.8 px |

Phone player names remain 16px and supporting metadata/PPG labels at least 13px. Phone history, Move, replacement, navigation, week actions, and menu controls retain at least 44 × 44px targets. Desktop layout retains its previous typography and pointer-control dimensions.

The short-landscape footer and dock total 117.6px: 64.6px for week actions plus 53px for navigation. An additional **emulated** 24px top-safe-area test proved the Week options close button stayed below the sticky header. This is browser emulation, not physical iPhone evidence.

## Verified behavior

- Recorded completed-game PPG and archive estimates remain visibly distinct and match real fixture data.
- Hidden exact years remain absent from both visible text and CSS-hidden full/compact text in roster, Move, and Game day views. The historical dossier may legitimately show candidate years.
- Player history opens the actual completed Week 1 game log, and its close button is reachable.
- The Move dialog opens, closes, supports Escape, and completes a named legal Emmitt Smith / LaDainian Tomlinson swap. Reload preserves both slots and every roster member.
- Before kickoff, every player score is zero. At the first quarter break, each displayed score equals only the historical events already played; it differs from the final total where expected.
- Advancing playback to the final exposes exactly the saved result, with no score/decade/position collision in any starter cell, including FLEX.
- Week options opens/closes normally; all four stages remain reachable within its scroll area.
- No page overflows horizontally. Actual pointer clicks and hit testing verify that fixed bars do not block these actions, including short landscape.

## Issues caught during verification

| Severity | Reproduction / cause | Resolution / evidence |
| --- | --- | --- |
| Medium | At 320px, Roger Craig's final FLEX score `18.90` overlapped `1980s · RB` by 2.95px because the point column could shrink below its text width. | Intrinsic score width, with remaining width assigned to wrapping metadata. All pregame, Q1, and final cell text-overlap checks pass. Original failure is retained in `text-fit-check.log`. |
| Medium | At 667 × 375, the Week options close control appeared behind the sticky league header. The popup's fixed offsets interacted with the backdrop-filter footer's containing block. | Popup anchors above its More control with a bounded, opaque scrolling panel. Normal open/close, last-stage scrolling, and emulated top-safe-area checks pass. Original failure is retained in `landscape-final-check.log`. |

A diagnostic first used nearest scrolling, which treats controls behind fixed bars as in-view. The final test centers content controls, then checks actual hit targets and uses unforced clicks. That diagnostic alone was not counted as a product defect. Initial desktop failures came from applying new mobile size expectations to untouched desktop controls; final touch-size assertions are explicitly limited to phones, while desktop retains normal pointer checks.

## Reproduction and evidence

[Test source](../../tests/vault-phone-density-browser.cjs) accepts the browser gate's `READINESS_PREVIEW_ORIGIN` / `READINESS_PREVIEW_PATH`, or a standalone `VAULT_DENSITY_URL`. Hosted URLs use the real public guest entry without the local development bypass. All external mutations remain denied. Browser selection honors `PLAYWRIGHT_CHROME_PATH`, uses installed Mac Chrome when available, otherwise uses Playwright's installed Chromium; unavailable browsers fail rather than skip.

The release gate clears standalone URL, width, and artifact-name overrides and requires all four viewports. `VAULT_DENSITY_PHASE` only names artifacts; it does not disable any assertion. The original baseline was captured before production edits with a separate diagnostic script; the final durable test intentionally requires the new compact markup.

Raw evidence under `output/playwright/vault-phone-density/`:

- `baseline.json`, `baseline.log`, `before-roster-*.png`, `before-gameday-*.png`.
- `final-compiled-browser.log`: all four compiled-candidate journeys pass.
- `after-evidence.json`: `passed: true`, four planned/completed viewports, exact metrics, checks, blocked network requests, and empty page-error arrays.
- `after-roster-*.png`, `after-gameday-*.png`, `after-move-*.png`, `after-playback-*.png`, `after-final-*.png`, `after-week-options-*.png`.
- `after-safe-top-667.png`: explicitly emulated safe-area/menu evidence.

The release owner archives selected durable evidence under `reports/public-readiness/vault-phone-density-20260925/` and records the final revision/deployment status separately.
