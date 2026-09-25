# Independent Vault phone-density review — 25 September 2026

**No unresolved material finding in the final reviewed candidate.** Reviewer: Vault polish lane; no production or test edits made by this reviewer. Reviewed the uncommitted diff on `codex/vault-mobile-density-20260925`, base `947c595049e9445a8aa42405c7fce4a91997e887`, plus the final compiled four-viewport evidence.

## Material finding resolved

The initial compact matchup grid allowed the 320px final Roger Craig FLEX cell's `18.90` score to overlap `1980s · RB` by about 2.95px. Independent review requested a cell-level check because page overflow would not catch it; the QA lane reproduced the collision. Root's correction gives scores intrinsic width on both mirrored sides and lets the remaining metadata column wrap. It preserves score size, decade and FLEX position. The final browser regression checks actual rendered text rectangles at pregame, Q1 and final, and passes all phone widths.

## Source assessment

- The roster and matchup changes alter presentation only. Player averages, completed-game denominators, scoring moments, final scores, saved rosters, permissions and action callbacks are unchanged.
- Observed PPG retains its completed-game count; an unplayed player's value remains visibly labeled `Est. PPG`, with its possible-year count and full research available. Redundant position badges are removed only when the slot already states that position; FLEX and bench retain the player's position.
- Both full and compact matchup labels use the existing public decade helper while years are concealed. The new markup does not emit the drawn year into a CSS-hidden variant. Revealed-year and desktop full-label branches remain present.
- The phone grid, typography and reduced padding are scoped below 768px. Desktop roster and matchup geometry match the measured baseline. The additional default-hidden compact spans do not replace the full desktop content.
- The short-landscape action row keeps 44px touch targets and safe-area space. More and no-More states receive explicit grid placement. The options popup is anchored above its actual More trigger, bounded below the header, scrollable and opaque; this avoids transformed-footer containment and background text bleeding through it. Final QA includes opening, scrolling and closing the menu with a simulated 24px top inset.
- The browser gate includes the new test and removes `VAULT_DENSITY_URL`, `VAULT_DENSITY_PHASE` and `VAULT_DENSITY_WIDTHS` overrides, so a different target or reduced-width run cannot silently satisfy the release check.

## Verification examined

Independent runs passed: `node tests/time-league-hidden-years-ui.js`, `node tests/time-league-live-matchup.js`, and `node tests/time-league-roster-home.js`. These include DOM-independent concealed-year assertions, negative and missing scores, replay continuity, saved results, invalid/save-failure recovery, atomic lineup changes and multiplayer permission behavior. Scoped whitespace validation passed.

The QA lane's final compiled application run passed at all four sizes, with zero page exceptions. I inspected its final numeric evidence and representative phone/desktop roster, pregame, playback and final screenshots.

| Viewport | Median roster row | Median pregame matchup pair | Roster name size |
|---|---:|---:|---:|
| 320 × 740 | 87.4px | 88.2px | 16px |
| 390 × 844 | 87.4px | 67.4px | 16px |
| 667 × 375 | 87.4px | 67.4px | 16px |
| 1440 × 1000 | 146.9px | 87.8px | 12.5px |

Phone names remain 16px. Desktop's existing 12.5px roster names and 146.9px/87.8px row geometry were not changed by this phone-only pass. The first developing browser harness incorrectly applied phone font/touch thresholds to desktop; its final version keeps strict phone thresholds and separately hit-tests the existing desktop controls. This does not change a production assertion or reduce the phone requirements.

The final new regression uses actual historical-engine fixtures and normal pointer/keyboard actions. It covers observed versus estimated PPG, candidate/completed history, Move close/Escape, a legal atomic swap and reload, pregame zeroes, exact Q1 landed-event scores, final saved scores, concealed years via `textContent`, intra-cell score/metadata separation, week-options scrolling, phone hit targets and page overflow. No forced clicks or invented scoring success are used. The final harness requires current compact markup; earlier baseline captures and the developing baseline interaction run are separate evidence, not a mode that bypasses current assertions.

Evidence: [QA report](vault-phone-density-browser-20260925.md), [final compiled browser results](vault-phone-density-20260925/after-evidence.json), [final run log](vault-phone-density-20260925/final-compiled-browser.log), [phone roster](vault-phone-density-20260925/after-roster-390.png), [narrow matchup](vault-phone-density-20260925/after-gameday-320.png), and [final score layout](vault-phone-density-20260925/after-final-320.png). The durable numeric evidence is byte-identical to the completed four-size working result; additional screenshots remain under `output/playwright/vault-phone-density/`.

This is a bounded source and local compiled-browser review. It does not establish deployment, native installation, physical-device use, authenticated persistence or hosted multiplayer. Root owns integrated release validation and served-asset verification.

## Reviewed file fingerprints

- `js/components/time-league-team-panel.js` — `2a625207cddf6a855ffc2c8e5ec307e0bdea0f816cc3729fcb3fa2635fd361c1`
- `js/components/time-league-gamecast-panel.js` — `f900711d89a1808327662e955321a19265eb3696d0946d9c7abd758be2ad8b59`
- `time-league-mobile.css` — `87393f596bfc40447173a0d79841706a5d2ad1469440f7f6cd56df985ec50ae4`
- `index.html` — `b9c2755ac5f377070b8ca146a12b8f3d5116270f7607f493fe4f57207b61710f`
- `scripts/run-browser-tests.cjs` — `a64ed4a8a3494fa77853a11450f784374de950a30a31c2f9118c6e79c084efb6`
- `tests/vault-phone-density-browser.cjs` — `71259274c14de7d28bcd4a4c422b2ee87bb551ef32f650854b68e8646760bdbb`
