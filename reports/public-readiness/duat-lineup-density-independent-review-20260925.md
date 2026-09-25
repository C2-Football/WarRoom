# Independent Duat lineup review — 2026-09-25

Scope: the compact lineup change on `codex/duat-lineup-density-20260925`, based on current application revision `e6c1c8e909c648c1bc110b2438cd8bdd5e287337`; checkout baseline `58cddb52b6d36ad0f832ad0ddd9d85622dddaee2` adds only the preceding release documentation. Reviewed source: `js/components/duat-weekly-flow.js`, `js/components/duat-mystery.js`, `duat-polish.css`, `index.html`, the bounded confirmation-label change in `js/tabs/duat.js`, and `tests/duat-mystery-ui.js`.

## Assessment

No unresolved material source finding. The row redesign keeps the existing game, selection rules, estimate calculation, actual results and research content. The final frozen-source four-viewport browser matrix passed with explicit accessible-clue assertions and terminal exit code 0. Its recorded production SHA-256 hashes match the currently reviewed files. The reviewed source, raw preview and compiled release candidate are clear of material findings. This review does not claim deployment or whole-suite launch readiness.

## Findings resolved during review

- The compact research button's explicit accessible name originally omitted the visible decade and remaining candidate count. The final markup uses `aria-describedby` to associate the exact visible clue with the button; its `aria-controls` target also exists while collapsed.
- The disabled introduction originally said the lineup was locked even in the read-only Army view. It now says “Viewing your starting lineup,” while the existing Edit army action remains available where allowed.

## Source and behavior review

- **Selection and accessibility:** selection remains a native 44px checkbox with a player-specific name, checked/disabled state and visible keyboard focus. The separate research button avoids nested interactive controls or accidental lineup changes. Research supports Enter/Space, expanded state and Escape dismissal; closing from inside the panel restores focus to its trigger. The name/decade/clue remains readable beside a single aligned metric column.
- **Read-only and ready state:** callers retain their existing disabled boundaries (`busy || ready` in preparation, unconditional disabled selectors in Army), and recommendation controls receive the same disabled state. Server action handlers and readiness rules are unchanged. Research remains readable without granting mutation authority.
- **Hidden-year boundaries:** compact mode reuses the existing Explorer body and `Mystery.inspect` call with the unchanged viewed-game `throughWeek` argument. Candidate archive seasons remain explicitly separated from observed campaign games. No private assignment, future score or final-reveal condition changes. The old details-based draft/recap path remains the default when compact mode is absent.
- **Truthful statistics:** `Est. PPG` is still the engine estimate blending reference-weighted and observed base points. The optional previous-week result is the actual completed snapshot's `effectivePoints`, including offerings. No prior-result value is invented before a result exists. Both the inline labels and Positions & scoring help distinguish estimate from actual result. Classic cards retain their real reference label without pretending to have a mystery explorer.
- **Test replacement:** the old compound copy assertion became obsolete because identity and clue now belong to the compact Explorer. Replacement assertions cover the native checkbox name/state, estimate label, compact Explorer/player identity and unchanged viewed-game boundary; the new compact test independently verifies identity/clue and expanded/collapsed behavior. Existing noncompact archive, Week 17 reveal and stripped-source-data tests remain intact. No game-engine assertion was removed.
- **Scope and compatibility:** no engine, save format, backend, entitlement or provider change. The new Week N confirmation label retains the original callback/disabled conditions and removes a redundant sentence. No speculative portraits, teams or projected scores were added.

## Independent checks

- `node --test tests/duat-mystery-ui.js`: 5 passed, 0 failed/skipped, including existing archive/reveal/privacy coverage.
- A separate direct rendering probe passed classic fallback, independent estimate/actual labels, selection callback and read-only disabled controls. Its first assertion mismatched synthetic tree whitespace in `W 1`; the corrected whitespace-tolerant probe passed with the value/meaning assertions unchanged.
- Actual browser at 390×844 and 1440×1000 with a valid classic historical Week 8 fixture: all eight player names and reference labels match; all estimates and Week 7 actuals match the engine; no mystery research control appears; Space changes the native checkbox; an illegal count disables confirmation and restoration reenables it; no page overflow or exceptions. On phone, Army selectors are disabled while Edit army is enabled. Process exited 0.
- Classic evidence: [browser log](duat-lineup-density-20260925/classic-independent-browser.log), [results](duat-lineup-density-20260925/classic-independent-evidence.json), [390px capture](duat-lineup-density-20260925/classic-independent-390.png) and [1440px capture](duat-lineup-density-20260925/classic-independent-1440.png). Browser contexts were disposable; all mutation methods were blocked before navigation. No hosted records were touched.
- Inspected the classic and Hidden Years 390px roster captures: compact rows retain readable names, distinct positions, selection states and aligned actual/estimated points. Existing historical identity has no verified portrait crosswalk, so the implementation correctly uses no guessed photo.
- `git diff --check`: passed.

## Final browser evidence

The [final browser report](duat-lineup-density-browser-20260925.md) records the frozen-source Hidden Years matrix passing at 320×740, 390×844, 667×375 and 1440×1000, terminal exit 0. Independently checked the [archived raw-preview JSON](duat-lineup-density-20260925/after-evidence.json): four passed viewports, zero page errors, and accessible clue/control-target checks in every case. Phone evidence also covers all eight normal checkbox controls, safe-area/short-landscape access, independent keyboard research, legal swap/save/reload, read-only Army, and Escape focus recovery. A separate opening-week case confirms no invented prior result.

Rows now measure about 76.6px on phones (96.1px for the longest name at 320px) and 80.6px on desktop, compared with 165–248px phone rows and 134px desktop rows in the baseline. The early harness changes align with the requested design: metrics share one right-aligned column rather than an identical y coordinate; the existing dirty-state button label changes; a one-pixel tolerance accommodates fractional layout. Original failure logs remain preserved, and substantive privacy, legal-state, metric equality, persistence and accessibility assertions remain.

The [compiled browser log](duat-lineup-density-20260925/compiled-browser.log) and [compiled evidence](duat-lineup-density-20260925/compiled-evidence.json) also pass all four viewports with terminal exit 0 at `http://127.0.0.1:3026/dist-preview/?duat=1`. Independently checked that all recorded production hashes still match current source, all four viewports retain the accessible-clue checks, and no page errors occurred. Raw and compiled proof are archived separately in the [evidence gallery](duat-lineup-density-20260925/README.md).

**Final independent assessment:** no unresolved material finding remains in this bounded lineup redesign; local release-candidate review is clear. Production deployment verification remains the root release owner's responsibility. Native/physical-device, hosted-authentication and multiplayer proof remain outside this local evidence.
