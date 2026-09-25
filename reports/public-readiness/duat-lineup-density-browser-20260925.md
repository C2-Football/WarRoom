# Duat compact lineup browser QA — 2026-09-25

Status: final frozen-source and production-build local matrices both passed at all four viewports; each process exited 0. Independent classic historical checks passed at phone and desktop sizes. No production source was edited by this QA agent.

Scope: Week 8 Historical Replay / Hidden Years lineup density, truthful inline statistics, player research, keyboard/touch selection, persistence, and narrow/short viewport controls. No native-device or hosted-authentication claim.

## Reproduction and honest fixture

`tests/duat-lineup-density-browser.cjs` creates a real eight-faction campaign using the repository's archive cards/game logs, legally drafts and reveals all armies, and advances the actual engine through seven completed weeks. Weekly presentation progress is acknowledged through its normal clock/recap/conquest events. The result is Week 8 with eight actual Egypt players, including LaDainian Tomlinson, a long name, and genuine Week 7 zero scores. The valid state and expected values are saved under `output/playwright/duat-lineup-density/week8-fixture.json`.

No scores, avatars, teams, current-season projections, or hidden scoring-year revelations are invented. Existing estimated PPG is a blend of observed base points and two reference-weighted games, not a pure observed average; the UI must retain an explicit estimate label. Prior-week results come from the actual completed Week 7 snapshot.

The test permits local preview origins and, only through explicit `DUAT_LINEUP_URL`, the existing HTTPS `c2-football.github.io/WarRoom/` and `/WarRoom-sandbox/` destinations (root or `index.html`). It removes any `dev` query on hosted URLs. A request fence is installed before the first page loads, rejects all non-GET/HEAD requests before allowing same-origin static assets, and blocks external backend/provider requests. Each viewport gets a disposable browser context. Pinned runtime dependencies are served at their configured versions; external webfonts are omitted. No hosted dev bypass or shared production records are used. This report records the local run; root owns any subsequent hosted verification.

## Baseline

Capture completed before production markup/CSS changes against `http://127.0.0.1:3026/?duat=1`; process exited 0.

| Viewport | Actual collapsed player-row height | Horizontal overflow |
| --- | --- | --- |
| 320×740 | 225–248px | None |
| 390×844 | 186px | None |
| 667×375 | 165px | None |
| 1440×1000 | 134px | None |

The reproduced layout splits each player across a large selection card and another research disclosure, while prior-week metrics wrap onto a separate line. This materially reduces roster information visible at once.

Durable evidence: [baseline measurements](duat-lineup-density-20260925/before-evidence.json), [baseline log](duat-lineup-density-20260925/before-browser.log), and [phone baseline](duat-lineup-density-20260925/before-lineup-390.png). [The evidence index](duat-lineup-density-20260925/README.md) links the saved before/after screenshots. Raw campaign fixtures remain only in the ignored local output directory.

## Final verification

Invocation: `node tests/duat-lineup-density-browser.cjs`. Target: `http://127.0.0.1:3026/?duat=1`. All four viewport journeys passed, process exited 0. The test recorded SHA-256 hashes for all four changed production files and verified that they did not change during the final matrix.

| Viewport | Final collapsed row height | Average height reduction | Result |
| --- | --- | --- | --- |
| 320×740 | 76.64px; long name 96.09px | 65.8% | Passed |
| 390×844 | 76.64px | 58.9% | Passed |
| 667×375 | 76.64px | 53.7% | Passed |
| 1440×1000 | 80.64px | 39.7% | Passed |

Verified at every viewport:

- Full real player names stay readable; selection and research controls remain at least 44px high. Both metrics remain inside one compact player row and share a consistent right-aligned column. No horizontal overflow or page exceptions.
- Every estimated value matches the engine and retains `Est. PPG`; every W7 value matches the actual result, including genuine zeros. Collapsed rows do not reveal the assigned hidden season.
- Each research button exposes its visible decade/candidate clue as an accessible description and points to an existing disclosure target.
- All eight native checkbox controls respond to normal interaction. Removing or adding one starter disables confirmation; restoring the legal lineup re-enables it. Space operates the checkbox.
- Enter/Space opens/closes research without changing lineup selection. Research shows exactly the seven observed campaign weeks; candidate archive history remains separately labeled and no final-year reveal appears.
- A genuinely different legal lineup is saved, survives reload, and resumes at the enabled Week 8 kickoff action.

Phone-only checks also passed: simulated 20px top/bottom safe-area insets, normal controls in short landscape, 50px primary action, no action/dock overlap, and read-only Army preserving research while disabling lineup changes. Escape from research restores focus to its button. The final trimmed footer was inspected in the short-landscape screenshot.

At 390px, a separate valid Week 1 campaign confirms that archive estimates remain explicit, no prior-week score is invented, and research reports no observed games before play.

Independent reviewer checked ordinary historical (non-Hidden-Years) campaigns at 390px and desktop: all eight real names/reference labels, exact engine estimate/actual values, no mystery controls, keyboard legality gating, and read-only Army behavior passed with no overflow/page errors. See [independent evidence](duat-lineup-density-20260925/classic-independent-evidence.json) and [independent browser log](duat-lineup-density-20260925/classic-independent-browser.log).

Final source evidence: [measurements and checks](duat-lineup-density-20260925/after-evidence.json), [terminal log](duat-lineup-density-20260925/after-browser.log), and [phone layout](duat-lineup-density-20260925/after-lineup-390.png).

The compiled production candidate also passed the complete unchanged four-viewport matrix, exit 0, with identical row heights and all accessibility, truthfulness, selection, persistence, safe-area, and pregame checks. Invocation: `DUAT_LINEUP_URL=http://127.0.0.1:3026/dist-preview/ DUAT_LINEUP_PHASE=compiled node tests/duat-lineup-density-browser.cjs`. [Compiled results and source hashes](duat-lineup-density-20260925/compiled-evidence.json), [compiled log](duat-lineup-density-20260925/compiled-browser.log), [compiled phone screenshot](duat-lineup-density-20260925/compiled-lineup-390.png), [compiled short landscape](duat-lineup-density-20260925/compiled-lineup-667.png).

Three initial harness assumptions were corrected with their original logs preserved: metrics stack within one right-aligned player column rather than sharing an identical y coordinate; the existing primary action changes its label when the lineup becomes dirty; the narrow long-name row's 96.09px height requires the standard 1px fractional-layout tolerance around the 96px target. None required a product workaround or weakened legal-state, privacy, persistence, or accessibility checks. The final unchanged matrix passed after the production accessibility/copy changes were frozen.

## Reuse and evidence limits

The harness honors `READINESS_PREVIEW_ORIGIN`, `READINESS_PREVIEW_PATH`, and `READINESS_PREVIEW_URL` for the integrated preview gate. `DUAT_LINEUP_PHASE=after|compiled|live|sandbox` prefixes all environment-specific screenshot/measurement/result filenames, so post-deployment runs preserve local evidence. Root handles gate wiring, release, and hosted verification.

This proves emulated responsive-browser behavior, historical fixture correctness, local persistence, and the tested accessibility interactions. It does not prove physical-device/native behavior, hosted authentication, multiplayer, or whole-suite launch readiness.
