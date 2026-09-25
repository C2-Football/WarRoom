# Vault phone density — 25 September 2026

Status: **complete for this scoped polish update**. Release `e6c1c8e909c648c1bc110b2438cd8bdd5e287337` deployed to both existing sites. Full Vault behavior checks, independent review, all four CI/Pages workflows,734 served-asset comparisons, and all eight hosted viewport journeys pass.

## Scope and baseline

User-provided phone screenshots show oversized My team and Game day rows. This follow-up refines those existing surfaces without changing rules, scores, saves, accounts, backend contracts, or features. Scout remains retired. Original dirty checkout and other agents' work are preserved.

Worktree: `/Users/jacobc/Projects/warroom-polish-20260925`; branch `codex/vault-mobile-density-20260925`. Starting application revision: `46c65405542d35233bfb44596e8a80eca7394a33`, verified on both remote main branches. Parent `947c595` adds prior release evidence only. Canonical shared code remains pinned to `7bd35313fc78e25a2d1ac24035989673a93f28e6`; use the clean `dhq-shared-polish-20260925` checkout for synchronization.

## Acceptance and fixes

| Issue | Reproduction and root cause | Resolution | Verification |
| --- | --- | --- | --- |
| P2: oversized roster rows | Week 2 Hidden Years; repeated position, weeks remaining, and stacked signal headings make the first row 164px | Compact inline PPG, game count and candidate-year clues; omit duplicate slot badge and repeated weeks-left on phones; full history and Move remain accessible | Final phone median87.4px; observed and estimated values remain distinct; four-size matrix passes |
| P2: oversized matchup pairs | Full-width slot heading plus repeated kickoff/hidden-year labels make phone pairs 158–179px | Central position column; shared kickoff/hidden-year context; names and scores lead each side; preserve individual live stats and availability | Final median pairs67.4–88.2px; no pregame/future scores or concealed-year leak |
| P2: short-landscape chrome crowds game | 667×375 fixed bottom actions and navigation consume about160px | Landscape nav uses horizontal icon/label buttons; week status and actions share a row, retaining44px targets | Final footer+nav117.6px; normal-click/menu and simulated24px safe-top checks pass |
| Regression found and corrected: narrow FLEX score collision | Final Roger Craig score18.90 overlapped `1980s · RB` at320; page-level overflow did not detect it | Intrinsic score column; remaining width belongs to naturally wrapping metadata, mirrored for both teams | Per-cell pregame/Q1/final score checks pass at all four sizes |
| Regression found and corrected: landscape options close covered | Fixed-position menu inherited the footer's backdrop-filter containing block and overlapped the sticky header | Anchor popup above its More control; bound its scroll height below the header; opaque background keeps underlying text out | Close and last stage are reachable with normal clicks, including simulated safe-top inset |

## Validation checkpoint

- `npm run test:timeleague`: passed, exit0. Includes concealed-year UI, roster actions, save/recovery, authorization/privacy contracts, exact landed-event scoring, real-archive full-season and Hidden Years saved/reloaded lifecycle, and server/browser scoring consistency. [Log](vault-phone-density-timeleague-20260925.log).
- Focused hidden-year UI, roster moves/Home, live matchup checks and changed-component ESLint passed.
- Real browser fixture: six teams, legal72-pick draft, completed Week1, legal Week2 claim, actual historical archive. Network mutations are blocked before disposable saves are loaded. This does not establish hosted-account or multiplayer behavior.
- [Browser evidence](vault-phone-density-browser-20260925.md) tracks320×740,390×844,667×375 and1440×1000; history, substitution, reload, kickoff, Q1 and completed game.
- Independent reviewer challenged narrow FLEX rows; the resulting collision was reproduced and fixed. [Final review](vault-phone-density-independent-review-20260925.md) finds no unresolved material issue.
- [Compiled preview build](vault-phone-density-build-preview-20260925.log), design-token checks and34 canonical shared/data/twin comparisons pass. [Shared pin evidence](vault-phone-density-shared-20260925.json).
- [Archived screenshots and measurements](vault-phone-density-20260925/after-evidence.json) include unchanged desktop row geometry. Phone names16px, supporting labels at least13px, and touch controls at least44×44px.
- New browser regression is included in the shared browser gate; standalone URL, phase and viewport overrides are stripped in that gate.

## Release and recovery

No backend, migration, save-format, or dependency change. Recovery is a normal frontend revert/redeploy to the prior application revision; no user-data rollback is needed. Existing live and sandbox share a production backend, so all fixture tests deny network mutations.

Current deployment runs: [live Pages](https://github.com/C2-Football/WarRoom/actions/runs/36176698211), [live CI](https://github.com/C2-Football/WarRoom/actions/runs/36176698220), [sandbox Pages](https://github.com/C2-Football/WarRoom-sandbox/actions/runs/36176715499), [sandbox CI](https://github.com/C2-Football/WarRoom-sandbox/actions/runs/36176715751). Local production build passes at the released revision:149 JSX /263 total modules.

[Workflow evidence](vault-phone-density-workflows-20260925.json): both CI and both Pages runs succeeded at the intended revision. [Served-asset evidence](vault-phone-density-deployment-assets-20260925.json):367/367 actual assets per destination,734 total, match the local production output or unchanged source; both release manifests match the intended revision. [Production build](vault-phone-density-release-build-20260925.log) passes.

[Post-deployment browser evidence](vault-phone-density-hosted-20260925/README.md): all320/390/667/1440 journeys pass independently on live and sandbox through a completed Week2 game, with no page exceptions. Public guest routes were used, with isolated browser-local saves and blocked network mutations. [Live roster](vault-phone-density-hosted-20260925/live-roster-390.png) and [live matchup](vault-phone-density-hosted-20260925/live-gameday-390.png) show the published layout.

Test-runner cleanup limitation: both hosted harnesses remained idle after all assertions, evidence writes and browser-context closures completed. Only those two owned Node processes were terminated (exit143); their precise lingering handle is unknown. Do not describe these hosted harness exits as0. The complete local compiled four-size run exited0 normally. [Cleanup record](vault-phone-density-hosted-20260925/cleanup.json) preserves the distinction; no application failure was observed.

No outstanding blocker for this scoped update. No backend, migration, save, or dependency changed. Responsive desktop-browser emulation and hosted local-save journeys are the evidence obtained; physical phones, native distribution and online multiplayer were not revalidated in this pass. The original public-launch goal remains incomplete. All new release evidence is retained here; temporary processes are closed at handoff.
