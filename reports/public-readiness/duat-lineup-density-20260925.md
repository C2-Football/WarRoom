# Duat compact lineup — 25 September 2026

Status: compact layout deployed on both sites; final loading-copy follow-up is locally tested and awaiting final compiled/hosted release verification. This bounded polish update does not establish whole-suite launch readiness.

## Scope and baseline

The supplied Sleeper screenshot establishes the requested direction: compact football rows, colored position controls, readable names and aligned stats. The supplied Duat screenshot shows oversized cards, repeated hidden-year/week labels, separate research boxes and duplicated confirmation copy. Preserve Duat identity, historical rules, actual scores, estimate semantics, concealed years and existing save/progression behavior. No feature expansion, Scout changes, generated data or guessed player portraits.

Worktree: `/Users/jacobc/Projects/warroom-polish-20260925`; branch `codex/duat-lineup-density-20260925`. Starting HEAD `58cddb5` is an evidence-only commit above prior application `e6c1c8e909c648c1bc110b2438cd8bdd5e287337`. The original dirty checkout remains untouched. Shared dependency pin remains `7bd35313fc78e25a2d1ac24035989673a93f28e6`, synchronized from the clean `dhq-shared-polish-20260925` checkout.

## Issues, causes and resolutions

| Issue | Cause and resolution | Verification |
| --- | --- | --- |
| P2: oversized lineup rows | Nested cards and a separate full-width Explore disclosure made typical phone rows 186px. Use a flat row: 44px position checkbox, player-name research button, and right-aligned metrics. | Typical phone 76.64px, 59% shorter. All eight real roster members remain accessible; long-name row wraps to 96.09px at 320px. |
| P2: repeated context and confirmation copy | Repeated hidden-year/through-week text consumed each row. Keep decade/candidate count beside the name, Est. PPG and actual prior week at right, with one optional scoring explanation. Put the current week in the confirmation button. | Exact engine estimates and completed scores, including zeros; hidden actual years remain sealed; invalid/dirty lineup feedback preserved. |
| Accessibility review: missing accessible clue | Research toggle label omitted visible decade/count. Associate the clue using aria-describedby. | Keyboard selection/research, valid expanded/control/description relationships, Escape/focus recovery, read-only Army controls. |
| Copy review: read-only Army described as locked | Shared Preparation can be read-only while Edit army remains available. Use neutral viewing copy. | Classic and Hidden Years Army preserve the existing edit action and disabled row selectors. |
| P3: premature research comparison during archive loading | A null compatibility result fell through to a match claim before comparison data existed. Render the comparison verdict only when the archive is ready; retain existing loading feedback and actual observed weeks. | Both compact and standard regression cases reproduced the old claim; all seven research UI checks now pass. |
| Browser harness: asynchronous archive race | Hosted saved campaigns can render before archive comparison finishes. Initial full count 8 narrowed correctly to 1 within about 356ms; all archive requests returned 200. | Wait for the real 17-row archive table before exact filtered-count assertions; retain all assertions and separately reject premature verdicts if loading is observed. |

Position colors plus checked/outlined states distinguish starters from bench. Selection and research are independent controls. No trustworthy portrait-provider IDs exist in the bundled historical cards, so no photo identities were guessed.

## Validation

- Final Duat suite: **395 passed, zero failures/skips/todo**, after the loading-copy fix. [Log](duat-lineup-density-tests-20260925.log). Both new loading regressions failed against the original behavior before passing: [before](duat-lineup-density-20260925/archive-loading-copy-before.log), [after](duat-lineup-density-20260925/archive-loading-copy-after.log).
- Core 97/97, design-token 4/4, changed-source lint and diff checks pass. [Core](duat-lineup-density-core-20260925.log), [design tokens](duat-lineup-density-design-tokens-20260925.log).
- [Compiled preview build](duat-lineup-density-build-preview-20260925.log) passes; all 34 shared module/data/twin comparisons match the pinned source. [Shared evidence](duat-lineup-density-shared-20260925.json).
- Real archive Week 8 fixture after seven engine-scored weeks. Matrix: 320×740, 390×844, 667×375 and 1440×1000. Selection, keyboard research, exact estimate/actual values, concealed-year boundaries, safe areas, legal substitution, save/reload, confirmation, read-only Army and first-week missing-result state are covered. [QA report](duat-lineup-density-browser-20260925.md), [screenshots and evidence](duat-lineup-density-20260925/README.md). Final follow-up compiled matrix passed all four sizes, exit 0, with the final loading-copy source hashes unchanged throughout.
- Existing broader Duat browser suite passes creation, draft entry, weekly navigation, persistence and layout at all four sizes on compiled preview, exit 0. [Log](duat-lineup-density-broader-browser-20260925.log). Independent classic historical checks pass at phone and desktop sizes.
- [Independent review](duat-lineup-density-independent-review-20260925.md) resolved the accessible-clue, read-only copy and loading-verdict findings. No engine, save-format, backend, entitlement or provider changes.

## Release and recovery

Initial layout revision `34a6b4c2b239e7d35425746ec797220ce79261ab` deployed successfully on live and sandbox. All six CI/Pages/C2 validation workflows passed, and both manifests plus 734 served assets matched the intended build. [Initial workflows](duat-lineup-density-initial-workflows-20260925.json), [initial assets](duat-lineup-density-initial-deployment-assets-20260925.json), [initial build](duat-lineup-density-initial-release-build-20260925.log). The hosted loading-race failure and diagnostic remain preserved in [hosted evidence](duat-lineup-density-hosted-20260925/README.md).

Final release candidate: validated and pending commit. Next: publish the bounded comparison-copy and browser-readiness follow-up; wait for all six workflows; verify exact manifests and served bytes; complete live and sandbox four-viewport journeys. Do not count the initial hosted attempt as a pass.

Live and sandbox share the production backend. All fixture browser checks block network mutations before navigation and use disposable browser-local saves. Hosted targets use public guest entry without a development bypass. Push-triggered C2 workflows validate contracts/builds/types; backend release jobs intentionally require explicit dispatch and are skipped here.

Recovery is an ordinary frontend revert/redeploy to the prior application revision; no data rollback, migration or dependency change is involved. Evidence is responsive browser emulation and browser-local persistence, not physical phones, native distribution, hosted-account or multiplayer verification. The broader public-readiness effort remains incomplete.
