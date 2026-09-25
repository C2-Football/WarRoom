# Duat compact lineup — 25 September 2026

Status: implementation and local validation complete; dual-site release verification in progress. This is a bounded polish update, not a declaration that the entire suite is launch-ready.

## Scope and baseline

The supplied Sleeper screenshot establishes the requested direction: compact football rows, colored position controls, readable names and aligned stats. The supplied Duat screenshot shows oversized cards, repeated hidden-year/week labels, separate research boxes and duplicated confirmation copy. Preserve Duat identity, historical rules, actual scores, estimate semantics, concealed years and existing save/progression behavior. No feature expansion, Scout changes, generated data or guessed player portraits.

Worktree: `/Users/jacobc/Projects/warroom-polish-20260925`; branch `codex/duat-lineup-density-20260925`. Starting HEAD `58cddb5` is a local evidence-only commit above deployed application `e6c1c8e909c648c1bc110b2438cd8bdd5e287337`; both remote main branches were checked at that application revision. The original dirty checkout remains untouched. Shared dependency pin remains `7bd35313fc78e25a2d1ac24035989673a93f28e6`, synchronized from the clean `dhq-shared-polish-20260925` checkout.

## Acceptance, causes and fixes

| Issue | Cause and resolution | Required verification |
| --- | --- | --- |
| P2: oversized lineup rows | Old nested card layout and a separate full-width Explore disclosure made typical phone rows186px. Replace with a flat row:44px position checkbox, player-name research button, and stacked right-aligned metrics. | All8 actual roster members reachable; narrow/phone/landscape/desktop layouts; long names;44px controls; no overlap/overflow. |
| P2: repeated context and confirmation copy | Repeated hidden-year and through-week text consumed each row. Keep decade/candidate count with the name, Est.PPG and prior completed week at right; explain scoring in one optional disclosure. Put the current week in the primary confirmation button. | Engine estimates and actual prior scores, including zeros, unchanged; no future score or concealed actual year revealed. Invalid/dirty lineup feedback preserved. |
| Accessibility review: research clue omitted from accessible name | Research toggle had a player-specific label that replaced visible clue text. Associate the visible decade/count via `aria-describedby`. | Keyboard selection/research, expanded state, valid control/description targets, Escape close/focus, read-only Army controls. |
| Copy review: read-only Army described as locked | Reused Preparation component can be read-only while Edit army remains available. Use neutral viewing copy. | Classic and Hidden Years Army remain viewable and editable through the established action. |

Football position colors and a checked/outlined state distinguish starters from bench without relying on color alone. Research opens within its player row, independently from selection. No trustworthy portrait-provider IDs exist in the bundled historical cards; this update uses real names and position badges without guessing identities.

## Verification checkpoint

- Final frozen-source local browser matrix passed, exit0, at320×740,390×844,667×375 and1440×1000. Typical phone rows76.64px versus186.39px baseline; longest name at320 wraps to96.09px. Production file hashes stayed unchanged throughout the run.
- Meaningful regression covers real engine-scored Week8 Hidden Years state, all checkbox controls, keyboard research, exact estimates/Week7 scores, safe areas, a legal substitution, save/reload, confirmation, read-only Army, first-week missing-result state and concealed research boundaries. All external mutations are denied before page load; fixtures are disposable browser-local saves.
- Final complete Duat checks393/393 passed with zero failures/skips after all source changes. Core97/97 and design-token4/4 checks pass; changed-source ESLint and `git diff --check` pass. [Duat log](duat-lineup-density-tests-20260925.log), [core log](duat-lineup-density-core-20260925.log), [design-token log](duat-lineup-density-design-tokens-20260925.log).
- Final compiled lineup matrix passes all four viewports with the same metric, privacy, keyboard, safe-area and save/reload assertions, exit0. [Compiled results](duat-lineup-density-20260925/compiled-evidence.json); [screenshots and evidence index](duat-lineup-density-20260925/README.md).
- Existing broader Duat browser suite passes creation, draft entry, weekly navigation, persistence and layout at all four viewport sizes against the compiled preview, exit0. [Log](duat-lineup-density-broader-browser-20260925.log).
- [Compiled preview build](duat-lineup-density-build-preview-20260925.log) passes with pinned shared source; all34 shared module/data/twin comparisons match the canonical revision. [Shared evidence](duat-lineup-density-shared-20260925.json).
- Independent classic-mode browser check passed at390 and1440: exact engine metrics, keyboard/legal selection, no hidden-year controls, read-only Army edit action, no overflow or page errors.
- [Detailed browser evidence](duat-lineup-density-browser-20260925.md) and [independent review](duat-lineup-density-independent-review-20260925.md) hold current results.
- New browser regression is included in the shared browser gate; explicit target/phase overrides are removed by that gate so it tests its own compiled worktree.

## Release and recovery

No backend, migration, dependency or save-format change. Recovery is a normal frontend revert/redeploy to the previous application revision; no user-data rollback is needed. Live and sandbox share the production backend, so hosted fixture checks must continue to deny all network mutations and use public guest entry without a development bypass.

Next: commit the validated frontend batch; publish through established CI/Pages on both destinations; compare release metadata and actual served assets; repeat the browser matrix against both hosted builds. Record exact application SHA and workflow URLs here.

Responsive browser emulation is separate from physical-phone, native-install and multiplayer evidence. Those are not claimed in this scoped update. The broader public-readiness effort remains incomplete.
