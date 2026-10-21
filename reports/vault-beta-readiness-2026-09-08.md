# The Vault — beta readiness review

## October 21, 2026 implementation release

Local branch: `codex/vault-experience-20261021`, reversible baseline `47bb5dd`.
Workspace: `/Users/jacobc/Projects/work/warroom-vault-experience-20261021`.
The main checkout and its unrelated changes are untouched. No push or deployment is authorized.

Finite release: make the existing solo journey easier to resume, guide the real
weekly decisions, explain saved results, and prevent a stale local tab from
silently overwriting newer progress. Preserve all draft formats, era rules,
historical data, scoring, characters, earned progress and online contracts.
No new modes, economy, AI service, or data source.

| Requirement / phase | Status | Completion evidence |
|---|---|---|
| A: inspect architecture, rules, baseline and disposable browser journey | VERIFIED | Baseline 47bb5dd; original Vault suite passed; real lobby/setup/draft captures in output/playwright/vault-experience/before-* |
| B: entry/resume and point-of-use draft premise | VERIFIED | Real hub/direct setup, 12-pick local draft, reload, saved shelf/team/stage/week context; fixed hub URL now retains vault=1 |
| C: legal next decisions and saved-result explanation | VERIFIED | Real planning, legal Move swap, lineup lock, game day/instant/recap, exact saved score, box-score route, reload and End week; known tie fixtures |
| D: existing rival/progression connections | VERIFIED | Actual friendly composer reply and authored reply each survive reload once; fixture-assisted 14-week champion, career/team links and completed shelf resume |
| E: save compatibility and conflict recovery | VERIFIED | Storage-conflict and recovery tests: stale views/tabs, held locks, switching rooms, quota recovery, old JSON/compression, no overwritten newer progress |
| E: integrated build, lifecycle/regression and rendered matrix | VERIFIED | First slice: 65-command Vault suite,160-script build, core97/97, first-class7/7, five-size Chromium journey and WebKit phone controls; follow-on evidence below |
| Authenticated hosted multiplayer / physical devices | BLOCKED | No live accounts or production mutations used; outside this local verification pass |

Statuses: NOT STARTED, DESIGNED, IMPLEMENTED, VERIFIED, BLOCKED. Verification
means evidence from this branch, with fixture/browser/hosted boundaries stated.
Other discoveries enter future work unless needed for this finite core journey.

### Verified architecture, rules and inventory

The Vault is `js/tabs/time-league.js` plus existing `time-league-*` components,
shared engine/actions/scoring/storage, historical assets and Supabase actions.
Dynasty HQ owns the hub, module loader, navigation, account/guest identities,
shared runtime and infrastructure. No parallel account or inventory was added.

| Existing surface/system | Observed release state |
|---|---|
| Hub/direct entry and setup | Working local routes; solo is browser-local; friends has account/guest waiting-room contracts |
| Player acquisition | Player identity, not a specific season; snake, linear and auction; Position Roulette, All-Era and selected decades; legal capacity/QB/position rules shared with AI |
| Season discovery | One eligible assigned season; Hidden Years reveals through public candidate evidence and final reveal; Classic reveals after draft. Local storage contains private state and is not secure secrecy |
| Team, claims, trades | Shared legality; four stages: claims/planning, lineup, ready, postgame. Disabled mechanics now have honest navigation; no new management subsystem |
| Competition and results | Recorded game statistics produce fantasy points; version1 shuffles source performances without repetition. Simulated quarter timing presents an already saved result |
| Rivals and progression | Steward Vance and existing owners, context templates, saved message IDs, expressive/relationship replies, achievements, ceremony and career are retained; no paid AI or new rewards |
| Friends multiplayer | Authoritative server permissions/versioning and sealed public-state tests pass locally. Real hosted multi-account acceptance is unverified |
| Incomplete/duplicate options | Full squad and Standard use the same roster shape; retained as existing setup options, not advertised as distinct strategic modes |

Default setup is six teams, Hidden Years, Position Roulette, snake, half-PPR and
12 regular games plus a four-team playoff (14 total). Supported setup variants
retain their existing season calculations. Legacy `gameDeckVersion:0` calendar
saves keep original assets; version1 keeps full regular-season game decks.

Data is unchanged: the archive validator reports 3,586 identities, 22,906
player-seasons and 272,461 unique scoring lines. See
[data provenance and limits](../data/time-league/REGULAR-SEASON-DATA.md) and the
manifest: 1970–1998 corpus has missing fumbles/two-point statistics; nflverse
1999–2025 is REG-filtered; K/DEF start in1999; documented exclusions remain.
Counts prove internal archive consistency, not independent certification of
every historical fact.

Scoring remains `TimeLeagueSeason.scoreStatLine` / `gamePoints`, including
custom weights, bonuses and optional era factors. Starter and team totals use
two-decimal precision. Regular ties stand; playoff ties go to the higher seed.
New recap presentation uses saved totals and starters, never future game draws.

### Save compatibility and recovery

No save schema, scoring version, historical asset or settled outcome changed.
New shelf metadata is optional; old indexes still open. Both plain JSON and
checksummed compressed saves remain readable. Unknown/unreadable saves are
kept and receive recovery feedback; they are never reset automatically.

Each local view now carries its own durable snapshot token. A changed/deleted
save is rejected before either shelf or game writes. **Load latest save** reads
the committed state and discards the rejected action; **Return to saved seasons**
allows leaving a missing/unreadable conflict without overwriting anything.
Recovery hides disabled gameplay overlays, releases native top-layer dialogs,
and focuses the recovery alert. Ordinary storage failures retain **Retry save** / **Keep previous save** and the
existing clock-preserving quota recovery. Browser Web Locks serialize cooperating
local saves; browsers/older clients without these locks retain optimistic checks,
not a cross-device transaction guarantee. Held-lock and room-switch fixtures
prove a delayed action cannot reopen a room that was left.

### Run and inspect

The local preview is running at `http://127.0.0.1:3037/?vault=1`. Its localhost
banner/identity is the repository's existing development behavior. To restart:

```sh
cd /Users/jacobc/Projects/work/warroom-vault-experience-20261021
node scripts/serve-static.cjs --port=3037 --compile
```

Dependencies and the exact workflow-pinned shared runtime (`74d6369`) were
prepared locally. A clean copy of that Git revision is at
`/tmp/vault-shared-20261021`; no dirty shared checkout was consumed.

```sh
SHARED_SOURCE=/tmp/vault-shared-20261021 npm run build:preview
npm run test:timeleague
npm run test:core
npm run test:first-class
```

True signed-out browser acceptance uses the separate local server below.
The Chromium harness maps only `vault-qa.test` to127.0.0.1; it does not use a
live hostname, account or save. Its route guard intercepts backend mutations;
analytics may receive a synthetic local response without transmitting data.

```sh
node scripts/serve-static.cjs --port=3038 --compile --allowed-hosts=vault-qa.test
# In a second terminal:
node tests/vault-experience-journey.cjs
node tests/vault-experience-journey.cjs --acceptance-only
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-experience-journey.cjs --webkit-smoke
```

The WebKit executable override matches this host's installed runtime; another
machine should use its own installed compatible runtime. Both browsers are
emulation, not physical devices. The actual controls cover a two-team compact
All-Era snake league; shared-engine/endpoint tests additionally cover other
formats, Position Roulette, custom scoring, larger leagues and permissions.
No new mode or multiplayer-support claim follows from these fixtures.

### Verification evidence and limitations

Evidence is under `output/playwright/vault-experience/` in this worktree:

- `verification.json`: PASS,7 journey groups and41 screenshots,38 intercepted
  backend mutation requests, zero page exceptions; actual hub/direct entry, setup and draft, legal roster,
  two-tab conflict, focus/hit-tested recovery, game day, stable final, advancement,
  fixture-assisted 14-week completion, career and saved-record resume.
- `acceptance-verification.json`: PASS,2 groups,12 intercepted requests, zero
  page exceptions; actual rival reply persistence and stale
  native-waiver-dialog recovery. No duplicate message or overwritten newer save.
- `webkit-verification.json`: PASS,1 group,2 screenshots,7 intercepted requests;
  390×844/430×932 phone controls, reduced motion,
  More-dialog Escape/focus return, legal roster swap, lock/game day/instant,
  enlarged text and reload. One explicitly recorded blocked-analytics CORS error
  comes from the isolation guard; no other application exception was accepted.
- `home-layout-verification.json`: long names separated at all five sizes,
  text-only125% font enlargement and no horizontal overflow. Default theme was
  inspected. Light mode is disabled upstream and is not claimed as verified.
- `baseline-suite.log`, `final-suite.log`, `final-build.log`, `core.log` and
  `entry.log`: original/final automated checks. Changed runtime JS passed ESLint;
  `git diff --check` passed.

Representative screen pairs: `before-lobby-390.png` / `after-lobby-390.png`,
`before-draft-1440.png` / `after-draft-1440.png`; final
`after-recap-390.png`, `after-complete-1440.png`,
`home-name-fix-enlarged-390.png`. The Chromium matrix uses390×844,430×932,
1024×1366,1366×1024 and1440×900 for lobby, draft, Home, roster, ready game day,
recap and completion. Setup additionally has390/1440 captures. Baseline captures
used local development identity; supporting Home/roster/game-day baselines were
reconstructed from exact baseline sources and their provenance is recorded; the final core journey verifies the actual
signed-out path without that bypass. No user's live progress was used.

The full historical fixtures run92 saved/reloaded actions per12-team,
156-pick season in legacy, full-game-deck and Hidden Years scenarios; scoring,
source-game uniqueness, AI legal rosters and playoff advancement reconcile.
Storage compatibility separately covers88 durable actions,14-week completion,
quota compaction, corrupt records and unrelated-data preservation. No new AI or
simulation strategy was introduced and no enjoyment/performance claim is made
from those checks.

Known pre-existing check failure: `node tests/design-tokens-contract.js` is3/4,
with two hardcoded8px radius literals in unchanged `js/free-agency.js` at the
baseline revision. `design-tokens-known-failure.log` records it; unrelated
Free Agency was not modified. Existing compiler size notes/Node localStorage
warnings are recorded in the logs. No source-data certification, offline test,
physical-device test, production performance test or hosted multiplayer session
was performed. Nothing was pushed, merged or deployed.

### Prioritized future work

1. Run a real hosted multi-account invitation/draft/reconnect/conflict session
   before widening friends-play claims; preserve server-owned disclosure.
2. Physically test Safari/Android touch, text scaling and screen-reader flow;
   observe human default-season pacing and whether newcomers return.
3. Plan save export/backup and unattended room advancement as separately scoped
   features; do not promise cross-device solo restoration or offline progression.
4. Address the existing unrelated design-token failure and duplicate roster
   preset label separately. Historical gaps stay documented; corrections require
   evidence and an explicit active-save compatibility decision.

### Follow-on slice: decision evidence

Continued from clean checkpoint `1750851` at the user's request. This finite
slice completes explanations within existing play; no new mode, scoring rule,
save schema, backup system or deployment is included.

| Requirement | Status | Acceptance |
|---|---|---|
| Saved-player scoring receipt and direct recap link | VERIFIED | Actual Home link opens/focuses the exact saved archive, own team first; keyboard-expandable recorded stats × league weights, bonuses, rounding and saved era factor reconcile to committed points; no-record, missing statistics and older mismatches remain explicit |
| Gap-only lineup action | VERIFIED | Fill empty slots explains its existing limits, disables full/no-compatible/locked states, preserves occupied starters and confirms named moves; actual Move→Fill→reload plus repeated-tap/save-failure fixtures |
| Hidden Years AI availability | VERIFIED | Rivals demote an explicitly known current no-game choice using the same coarse clue as the human roster; unknown/stale clues retain existing persona estimates; 36 deterministic legal lineups and private-data getter traps |
| Default Roulette and alternate draft controls | VERIFIED | Actual reveal/reload and 24-pick two-team standard Hidden Years Roulette draft; 12-pick linear and 12-lot auction, including paused-lot reload, legal human bid and budgets; nomination copy now matches Hidden Years |
| Integrated regressions and rendered receipt | VERIFIED | 67-command Vault suite, 160-script build, exact 272,473 scorer comparisons, prior saved-result regression, five-size Chromium receipts and WebKit phone controls; expected isolated telemetry errors recorded separately |

The prior finished release remains intact. Regular-season bye scoring/readiness
semantics are retained; a broader readiness redesign stays future work.

#### What changed for the player

The recap's **Scoring & box scores** action opens its saved week directly and
focuses the archive. Your matchup and team appear first. Each saved starter
expands in place to show recorded production, applicable rates, reached bonuses,
rounding and the saved era adjustment. Saved points remain authoritative even
when an older result lacks statistics or its original scoring context no longer
reconciles. A no-record game is distinct from unavailable statistics and from a
recorded zero. Historical coverage warnings remain visible. The link cannot
bypass pending/unfinished first playback or disclose a later result, and closing
the archive stays closed until another explicit request.

**Fill empty slots** now says what it does, disables an impossible/no-op action,
preserves existing starters, rejects repeated in-flight taps and reports saved
names or a recoverable failure. Existing scouting warnings offer **Compare
replacements** through the real legal Move sheet. This is not a new projection
or persistent automation. Hidden Years rivals now avoid an explicitly known
current no-record player when a legal replacement is available; their established
persona estimates still rank other options. Human decisions and settled results
are unchanged.

#### Rules, saves and evidence

No historical records, scoring weights, randomness, save schema, unlocks or
settled outcomes changed. The scorer's weights/bonus predicate are shared with
the receipt rather than maintaining a screen-specific formula. Exact output
parity against checkpoint `1750851` passed for all 272,461 source scoring lines
and 12 custom cases (bonuses, negative points, overrides and group rounding).
Opening a receipt performs no save. Existing plain/compressed save and complete
season tests still pass. The AI correction affects future lineup preparation
only; no resolved game is repriced or replayed.

Follow-on evidence is in `output/playwright/vault-next/`:

- `verification-core-variants.json`: PASS, 7 groups, 29 screenshots, 75 intercepted
  writes, zero page exceptions. Actual two-team standard Roulette draft and
  compact linear/auction drafts; first game/instant/reload; fixture-assisted
  scoring and Move/Fill checks. The six-team default was not fully drafted in
  this browser run. `verification-auction.json` separately records a real human
  bid after AI consideration and paused-lot reload.
- `verification-scoring-score-link.json`: PASS, 3 groups, 13 screenshots, 17
  intercepted writes, zero page exceptions. Final recap link, correct saved
  week, scroll/focus, own team first, no automatic reopening and stable results.
- `verification-webkit.json`: PASS, 4 groups, 14 screenshots, 25 intercepted
  writes; receipt, disclosure, enlarged text, gap-fill, reload and recap-link
  phone acceptance. Both browsers use disposable local saves and intercepted
  writes. WebKit's two expected blocked analytics CORS errors are listed
  separately; zero unexpected application exceptions were accepted.
- `scorer-parity-result.json`, `scorer-parity.cjs`, `scorer-parity.log`: exact
  baseline/current source and archive hashes, comparison counts and reproducible
  scorer check. This is calculation parity, not certification of every source
  fact or proof of gameplay enjoyment.
- `final-suite.log`, `final-build.log`, `regression-browser.log`: integrated
  checks and the first slice's complete signed-out journey regression. Focused
  receipt/AI/roster tests are now part of `npm run test:timeleague`; live-matchup
  tests also cover wrong-room, future/undisclosed-week and first-playback guards.
- `../vault-next-slice/fill-slots-verification.json`: independent roster review,
  full/partial/no-candidate states and reload at 390/1440.

Representative comparisons: `scoring-archive-before-390.png` versus
`scoring-receipt-detail-390.png`; desktop `scoring-receipt-detail-1440.png`;
direct-link `score-link-390.png`; `lineup-gap-390.png` versus
`lineup-filled-390.png`. Receipt layout was inspected at 390×844, 430×932,
1024×1366, 1366×1024 and 1440×900. WebKit is phone emulation at 390/430,
including 125% text, native details and real Move/Fill controls. No physical
device, hosted multiplayer, offline or performance-improvement claim is made.
The documented pre-existing unrelated design-token failure remains.

With the 3038 isolated server above running:

```sh
node tests/vault-next-journey.cjs --roulette --linear --auction --scoring --fill
node tests/vault-next-journey.cjs --scoring --score-link
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-next-journey.cjs --webkit --scoring --fill --score-link
node output/playwright/vault-next/scorer-parity.cjs
```

The first command creates disposable fixtures for the targeted follow-ups.
Browser artifacts stay in the existing ignored output directory; no account,
invitation, live room or user's progress was used. The preview remains at
`http://127.0.0.1:3037/?vault=1`. No push, merge or deployment occurred.

### Continued slice: kickoff readiness and unpaired results

Continued from clean checkpoint `fc10c31` at the user's request. The finite
scope is existing lineup readiness and accurate regular-bye/playoff-observer
presentation. A regular bye still scores PF/all-play and requires a legal
lineup. A team outside a playoff round does not block it. No rule, save schema,
historical data, replay persistence system or multiplayer permission changes.

| Requirement | Status | Completion criteria |
|---|---|---|
| One shared participation/readiness contract | VERIFIED | 10 known fixtures; Actions and UI share required-human-team and slot legality calculation, including regular byes and playoff observers; malformed schedules remain unknown |
| Actionable kickoff readiness | VERIFIED | Named blockers, direct local hotseat repair, authorized reopen after successful save, nonblocking current no-game advisories; 9 focused gate/profile cases retain role, early-vote, timed, save and auth behavior |
| Accurate Home and saved unpaired results | VERIFIED | Actual three-team bye PF/all-play/H2H calculations, live solo lineup and saved receipt; no false playoff Bye or invented observer score; first pending playback frame contains no final |
| Compatibility and interactive verification | VERIFIED | 70-command suite, 160-script build, Chromium and WebKit flows, final keyboard focus and measured-navigation full-target checks pass; hosted/physical boundaries unchanged |

First-playback interruption preserves the same committed outcome. Animation
position is not restored; a saved final remains available for replay.

#### Integrated behavior and compatibility

`weekParticipation` and `lineupReadiness` are derived engine reads, with no new
saved fields. Regular byes require legal human starters because those points
count toward points for and all-play. An observer outside the current playoff
pairings does not block that round. Missing/partial schedules remain unknown,
without weakening regular-week validation. Saved past matchups take precedence
over reconstructed schedules. No-record starters remain legal: the roster names
confirmed current zero-game choices and opens the existing Move comparison,
without treating unknown or stale reports as zeros.

The fixed week controls name real blocking teams before lock/kickoff. Local
hotseat repair selects that exact manager; online managers can only review their
own seat. A locked invalid lineup has a direct authorized **Reopen lineups**
action, and failed saves do not pretend to reopen it. Majority voting can still
record an early vote; it does not bypass authoritative lineup validation.
Readiness details close by button or Escape and return focus to their summary.
The existing server force behavior is preserved, not exposed as a new bypass.
Mobile navigation reserves its actual measured height, including wrapped
enlarged labels and safe-area padding, so it cannot clip the week-action touch
targets. This presentation measurement has no saved game-state fields.

Home, live playback, saved box scores and team history now distinguish a real
regular-season bye from a playoff observer or unknown schedule. Every saved
unpaired team result has reachable starter receipts, shown first for its owner.
No opposing lineup, win marker or observer score is invented. During first
playback, bye points follow landed scoring moments. The initial render before
the playback effect now shows only a preparation status, preventing a brief
saved-final/archive disclosure. Identified-year tests cover this initial frame,
unfinished playback and normal/replay/final disclosure.

No migration, historical-data edit, scoring change or outcome correction is
needed. Existing plain/compressed save, stale-tab recovery, complete-season and
authoritative endpoint checks pass. An interrupted first playback reloads the
same committed final, with Replay available; animation position is not restored.
Repeated End week input advances once and does not grant another result.

#### Verification and inspection

Follow-on checks and before/after evidence are under
`output/playwright/vault-readiness/`:

- `baseline.json`: 4 behavior/integrity checks and 14 captures, using exact
  `fc10c31` source overrides with disposable fixtures. It records the incorrect
  playoff-bye copy and confirms pre-existing settled-result integrity.
- `verification.json`: PASS, 6 scenarios, 11 checks, 60 viewport captures,
  36 intercepted writes and zero page exceptions; real controls for interruption,
  scoring bye, playoff observer, another missing human manager, legal no-record
  starter and locked legacy repair. Final after images use viewport captures;
  full-page baseline stitching can repeat fixed headers and is not evidence of
  duplicate application roots.
- `webkit.json`: PASS, the same 6 scenarios and 11 checks, 28 phone captures,
  30 intercepted writes and zero unexpected exceptions. Two expected denied
  analytics CORS errors are recorded separately. This is browser emulation,
  not a physical Safari session.
- `verification-safe-area.json` / `webkit-safe-area.json`: PASS, 9 viewport/text
  states and 9 captures each, 5 intercepted writes, zero page exceptions. Full
  44px action targets stay above navigation at 390/430 normal and 125% text,
  667×375 short landscape, 740×390 tablet navigation and phone return. Desktop
  restoration removes the mobile reserve and keeps its existing controls fully
  visible (the existing desktop More control is 40px wide). Actual navigation heights include 75px normally
  and 90px at enlarged phone text. These emulated geometry checks do not test
  physical device cutouts; separate `final-*-safe-area.log` files record them.
- `final-suite.log`, `final-build.log`, `lint.log`: 70-command Vault suite,
  160 compiled scripts and changed-runtime ESLint. `gate-focus.log` records the
  final 9-case keyboard/role/profile check after the last focus-handler edit.
  `nav-lint.log` and targeted integration/playback/recovery/guest checks cover
  the final navigation-measurement edit; it adds no game-state transition.
- `core-browser.log` and `core-browser-verification.json`: PASS, 7 journey groups
  and 41 captures; regression through
  actual signed-out hub/direct entry, draft, roster, conflict recovery, game day,
  saved recap, next-week advancement and fixture-assisted 14-week completion.

Representative images: `before-bye-recap-390.png` /
`after-bye-scoring-receipt-390.png`, `after-missing-other-manager-390.png`,
`after-legal-no-record-starter-390.png` and
`after-observer-ready-home-1440.png`. The Chromium matrix uses all five requested
sizes (390×844, 430×932, 1024×1366, 1366×1024, 1440×900). Browser sessions use
loopback fixtures and intercept writes; they establish neither hosted
multiplayer nor physical-device behavior. The prior unrelated design-token
failure remains outside this scope. No push, merge or deployment occurred.

With the same isolated preview servers above running:

```sh
node tests/vault-readiness-journey.cjs
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-readiness-journey.cjs --webkit
node tests/vault-readiness-journey.cjs --safe-area
PLAYWRIGHT_WEBKIT_PATH=/Users/jacobc/Library/Caches/ms-playwright/webkit-2368/pw_run.sh node tests/vault-readiness-journey.cjs --webkit --safe-area
```

The shared engine fixtures, unpaired presentation and gate/profile checks are
included in `npm run test:timeleague`. Remaining priorities are the hosted
multi-account and physical-device acceptance already listed above, human pacing
observations, and separately scoped backup/export work.

---

September 8, 2026 · Product, browser, rules, and architecture review

**Recommendation: run a small invited beta with 5–10 trusted testers. Do not launch public, ranked multiplayer yet.** The game has a distinctive premise, a complete season loop, and enough personality to invite repeat play. Keep the current architecture. The next investment should be reliability, clearer decisions, and observing real players—not another large feature expansion.

This review used a new local league, not an existing user save. Local gameplay ran with development authentication. Guest entry and login presentation were separately checked without that bypass. No real accounts were created, invitations sent, or human messages submitted. Actual two-account internet play and production load remain unverified.

## Experience scorecard

Grades describe the reviewed implementation after targeted corrections, not a claim that every device or multiplayer condition has passed.

| Dimension | Grade | Assessment |
|---|---|---|
| Core concept and identity | A− | Position Roulette, sealed editions, historical careers, and rival owners make this feel like its own game. Keep Roulette as the default. |
| Setup and first use | B+ | Reveals hide the board correctly; the new direct Vault entry avoids unrelated Dynasty onboarding. Settings still need observation with first-time testers. |
| Draft clarity and strategy | B+ | Recent picks, position runs, timers, filters, scouting, and the colorful recap work. Era-eligible ranking needed correction. A drawn-season grade is retrospective, not a fair measure of drafting skill. |
| Roster and player statistics | B+ | Legal swap choices, stars, remaining games, SZN/YTD, and position/team/week filters make decisions understandable. Mobile density is improved. No-game warnings deserve more prominence before lineup lock. |
| Game day | B+ | Both lineups and quarter totals are readable; pause, quarter skip, and instant completion work. The quarter reconstruction is engaging but is not authentic NFL play-by-play. Descriptive grammar and five-minute pacing could improve. |
| Waivers and trades | B | A displayed waiver edition was awarded exactly as shown; a clearly lopsided offer was rejected. Four gates give the user control. Trade response timing needed clearer copy. |
| Rival owners and messages | B+ | Win/loss and playoff-specific messages appear after games; reply presets, relationship movement, and typing delay work. Templates remain recognizable over a full season. |
| Season and playoffs | A− | Twelve regular games, seeded semifinals, championship, ceremony, and persistent results completed successfully. Playoff presentation could distinguish eliminated teams more clearly. |
| Mobile layout and accessibility | B | Tested at 320–390px, plus a short 390×520 viewport. No page-wide horizontal overflow in reviewed screens; tables intentionally scroll. This is not a complete assistive-technology audit. |
| Scoring and save continuity | A− | Browser totals reconciled with the followed player; independent real-data tests exercised custom scoring, save/reload, quarters, transactions, and playoffs. Source totals are internally consistent, not independently certified against every historical NFL game. |
| Friends-league onboarding | B−, provisional | Guest and email-entry screens work; invitations and authority have automated coverage. Fresh live signup and two distinct human accounts still need a real session. |
| Competitive integrity | B−, provisional after follow-up | Server snapshots now omit sealed editions and private draw inputs; explicit per-manager reveals and database access tests close the identified blocker. Real concurrent-account acceptance remains pending. |
| Operations and scale | C+ | Regression gates, pinned shared code, serialized backend releases, and release metadata improve repeatability. Staging isolation, unattended advancement, save portability, and real load evidence remain missing. |

**Overall product experience: B+ for a closed beta. Public-platform readiness: C.**

## Actual player journey

I created **Beta Review · Full Season**, a six-team solo league, using Position Roulette and the default twelve regular weeks plus a four-team playoff. All 72 draft picks and all 14 games were advanced through the browser controls. AI picks used the app's own pacing; repeated week gates used the same visible buttons. No league state or result was injected to complete this season.

1. Opened the QB archive, scouted Patrick Mahomes, and confirmed eligible 2018–2019 seasons, descending years, and leftmost fantasy points. The board and draft actions stayed locked until the reveal was complete.
2. Picked Mahomes first. His edition remained sealed until the draft finished, then revealed **2018 / 353.5 archive points**. The completed draft gave my class a **D**, despite its eventual championship appearance—useful evidence that draft grades should be treated as flavor.
3. Swapped Mahomes to the bench for Robert Griffin III through the replacement sheet, then reversed the swap. The sheet offered a compatible QB; both moves occurred together.
4. Claimed **2008 Marion Barber**, dropping Darren Waller. The displayed **197.1 remaining points** matched the edition received. Moved Barber into FLEX for Deuce McAllister.
5. Watched portions of Week 1 at the five-minute and one-minute settings, paused in Q2, skipped to halftime, resumed, then used Instant. Subsequent games used Instant to inspect the full season in one review. This does not prove a five-minute game is enjoyable for all 14 weeks.
6. Both lineups updated; kicker extra points were distributed through quarters. Frankie Deals sent a visible postgame message. A friendly reply showed the typing indicator and changed the relationship toward friendly.
7. Offered Deuce McAllister for LaDainian Tomlinson. Kade rejected it after the waiver batch: the trade did not change ownership. The review caught unclear disabled response controls and corrected their stage-specific explanation.
8. Checked the Home playoff hunt at midseason, YTD against Player Stats, and filters by QB, Beta Pilots, and Week 1. At Week 6 Mahomes showed **158.1 YTD** in both roster and stats.
9. Finished **7–5**, qualified as seed 2, won the semifinal, then lost the championship to Kade **110.5–105.8**. The championship-specific message and ceremony named the correct winner and MVP.
10. Reloaded the completed league. The champion, bracket, roster, and scores persisted. Mahomes ended with **353.5 YTD, 13 games, 4,300 passing yards, 43 passing TD, 11 INT, and 235 rushing yards**. Replayed Week 1, paused it, and returned to the roster: his current YTD correctly stayed **353.5**.

| Week | Beta Pilots | Opponent | Opponent score | Mahomes FPTS |
|---|---:|---|---:|---:|
| 1 | 176.2 | Frankie Deals | 99.7 | 28.34 |
| 2 | 130.6 | Warlord Kade | 84.9 | 38.84 |
| 3 | 128.3 | The Archivist | 95.6 | 25.26 |
| 4 | 104.8 | Riverboat Sol | 94.3 | 22.86 |
| 5 | 67.4 | Steward Vance | 125.9 | 15.82 |
| 6 | 90.1 | Frankie Deals | 84.3 | 26.98 |
| 7 | 75.7 | Warlord Kade | 104.1 | 32.82 |
| 8 | 93.9 | The Archivist | 70.2 | 26.02 |
| 9 | 109.7 | Riverboat Sol | 113.8 | 26.80 |
| 10 | 82.0 | Steward Vance | 144.7 | 20.06 |
| 11 | 166.9 | Frankie Deals | 104.4 | 35.92 |
| 12 | 100.2 | Warlord Kade | 114.1 | 0.00, no archived game |
| 13, semifinal | 158.8 | Steward Vance | 124.8 | 33.00 |
| 14, championship | 105.8 | Warlord Kade | 110.5 | 20.78 |

Team scores are rounded to one decimal for display. I intentionally did not optimize every lineup during the repeated-gate portion. Leaving unavailable players in exposed a real strategy cost; it is not a scoring error. Mahomes' final-game rating was one star after his stronger games were exhausted.

## Changes made in this review

- Ranked and displayed draft players using only seasons eligible for their revealed era, including the default selection and game counts.
- Explained that scout/SZN numbers are the **Weeks 1–14 archive using reference scoring**. League-scored YTD is separately labeled.
- Made each player-stat row use that player's position, so quarterbacks show passing production even in the All filter.
- Made AI managers replace an unavailable starter with an eligible available bench player. It checks whether a game exists, never its future score.
- Prevented legacy leagues from appending playoffs after the fourteen-week data limit; existing results remain intact.
- Preserved current YTD and messages while replaying an old game.
- Corrected new postgame conversation week labels, with compatible database normalization for older online clients.
- Reduced mobile roster row height from roughly 163px to 114px while retaining a 44px Move target; labeled Community in More.
- Explained when queued AI trade responses arrive instead of showing a disabled, unexplained action.
- Corrected saved-final labels after reload and centered the championship helmet.
- Added direct `?vault=1` entry, scoped email sign-in/return, and visible Report a bug actions.
- Added release regression gates, pinned the shared-engine revision, serialized backend releases, avoided duplicate Pages artifacts on workflow reruns, and generated release metadata.

## Architecture decisions

Keep the static frontend, shared deterministic game engine, and Supabase authoritative actions. The current server validates seat ownership, computes supported changes, and uses version checks to prevent conflicting writes. Those are good foundations. A rewrite is not justified by the observed experience.

The sealed-draft follow-up implements a private/public server snapshot contract, server-only cryptographic edition allocation, per-manager era reveals, and database access tests. See `reports/vault-beta-access-review-2026-09-08.md` for its scope and limitations. Real invite/reconnect/concurrent-account acceptance remains required before widening multiplayer access.

Before increasing the beta cohort:

- Separate staging from production. Main and sandbox currently share both Supabase and the GitHub Pages origin/storage; sandbox is a frontend preview, not disposable test data.
- Run two real multi-account sessions: join private seats, draft simultaneously, refresh/reconnect, attempt conflicting actions, and finish a week. The automated tests do not replace this.
- Add unattended server-driven timed advancement before promising that rooms progress while everyone is offline. For the first beta, use commissioner or majority advancement.
- Add save export/import or cloud backup before promising device portability. Solo saves currently stay in one browser/device.
- Measure polling, server latency/errors, and historical-data loading with actual users before expanding. Full snapshots/message polling every three seconds is not yet demonstrated at scale.

Do not present the community leaderboard as a standardized competitive ranking while league rules/scoring differ. Do not market broad Google/Apple multiplayer support until the app-account identity bridge is implemented. The scoped Vault sign-in uses the supported email path.

## Beta rollout

Use the verified release URL, with `index.html?vault=1`. If main is stale and sandbox is the only verified frontend, explicitly call the sandbox link a temporary preview. The final delivery message records actual release status.

1. Invite 5–10 people you trust; controlled link distribution is not a platform registration allowlist.
2. Ask each to create one solo Roulette league and play through three weeks on the same browser/device.
3. Then run two friends leagues with distinct email accounts. The host selects human seats plus AI fillers and shares one private invitation per person.
4. Use commissioner or majority advancement. Have one host lead the first draft and explain the four stages.
5. Collect bugs using Report a bug, including device, screenshot, expected result, and the last action. Keep fixes small during this cohort.
6. Expand only after both rooms complete without lost progress, stuck turns, incorrect ownership, or ambiguous advancement. Measure whether testers return for another session and can explain their lineup choices.

Detailed access steps and security findings: [Beta access review](vault-beta-access-review-2026-09-08.md).

## Verification and limits

- Core regression: 114/114 tests; login contract and full Vault suite passed during integration.
- Two independent real-data twelve-team seasons, each 156 picks and 92 serialized/reloaded actions, exercised default and custom scoring through championships. All 150 team-week totals per run reconciled with quarter/stats output.
- Archive audit: 215,734 logs, 4,420 player cards, 18,150 editions; all within Weeks 1–14; no missing-edition or internal aggregate mismatch. External historical source certification remains outside this review.
- Actual PostgreSQL/PGlite message tests covered migration replay, old-client compatibility, deduplication, privacy, access controls, concurrent writes, rate limits, and rollback.
- Mobile review used an engine-completed draft fixture, then real Week 1 controls; it is separate from the desktop season completed entirely through UI actions.
- Guest browser entry/login and the bug dialog were opened without submitting an account or report. Fresh live authentication remains a beta-host smoke test.
- No new app runtime exceptions were observed in the playthrough. The local preview still emits the existing meta-CSP warning; this is not proof of a full production security-header audit.

Screenshots are retained locally under `output/playwright/`: `beta-desktop-reveal.png`, `beta-desktop-draft-recap.png`, `beta-desktop-gamecast-live.png`, `beta-desktop-chat-typing.png`, `beta-desktop-home-midseason.png`, `beta-desktop-championship.png`, `vault-beta-mobile-roster-compact.png`, `vault-beta-mobile-roster-320-ytd.png`, and the access-review screenshots. The initial championship screenshot catches its entrance fade; text/result verification was performed after it settled.
