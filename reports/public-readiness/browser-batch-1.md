# Browser readiness batch 1 — 2026-09-18

Branch: `codex/readiness-native-20260918`, based on `5d28f39`, following native staging and independent auth-review commits. This batch is local browser evidence; no deployment or physical-device evidence is claimed.

## Resolved product defect

**Medium: live Draft controls cut off beside the desktop sidebar.** Reproduction: open a connected dynasty league, Draft → Follow Live Draft at 1365×900. The available rail was 1120.25 px, but its grid minimum tracks were 305+560+400 = 1265 px. The rail hid overflow, clipping Trade Desk and Exit. The viewport-only 1320 px breakpoint did not trigger.

`index.html` now gives the Draft cockpit an inline-size container and stacks the rail/wraps its controls when the actual available room is ≤1320 px. Existing redraft flexible tracks remain. The full Draft browser suite verifies no horizontal overflow or clipped controls in the affected live view and its neighboring board/mock views.

## Browser checks repaired without changing product behavior

- Draft account seeding now passes one structured argument to Playwright's `addInitScript`; the old two-argument form omitted the username. Readiness waits for actual league hydration.
- The current War Room command view contains Draft Plan and Alex Analyst Mock; obsolete League Reality/My Board Lens/Trade Market/Draft Readiness panels are absent from current source. Post-draft checks retain the results handoff.
- Mock setup uses Draft Source → League settings (the removed upcoming-draft hero is documented in `js/draft/command-center.js`) and the shared accessible Draft Rounds listbox. The test opens that listbox, checks its 1–100 range, selects one round, and verifies retention.
- Phone navigation uses the actual Draft view select and verifies usable Draft Setup/Start Mock Draft at 320 and 390 px. A fresh context per phone scene prevents desktop live/mocked draft state leaking into a different test scene.
- League-format tests use explicitly synthetic, intercepted pre-draft provider fixtures. Both original public sample leagues now report `in_season`, so they cannot establish empty pre-draft redraft behavior. Fixture evidence is labeled separately from real-provider reads. Current settings route is `gm-settings`.
- The shared browser route helper blocks every external POST/PUT/PATCH/DELETE before provider fixtures run and answers preflight locally. This prevents local browser QA from mutating the production backend shared by the sandbox frontend. Read-only public provider GETs remain available to non-fixture suites; images/fonts/media are omitted, so these suites do not prove asset loading.
- Missing browser/dependency/port access now yields a failed/nonzero result instead of a green skip.

## Verified

- `node scripts/build-preview.cjs`: passed, 147 Babel scripts compiled.
- `node tests/browser-readonly.cjs`: passed; denied external write methods, fixture precedence, local preflight, no query-string secrets in diagnostics.
- `node tests/draft-browser-qa.js`: **6 checks passed**, real public provider reads with outbound writes blocked. [Output](draft-browser-final.log).
- `node tests/league-skin-browser-qa.js`: **redraft/dynasty matrix passed**, synthetic provider fixtures. [Output](league-skin-fixture.log).
- `git diff --check`: passed.

These results do not establish mock-draft completion/recovery, live provider mutation, authenticated multi-account behavior, native install, or final suite readiness. General responsive and live click-path tests are undergoing separate repairs and will be reported in the next checkpoint. Parent owns the final integrated candidate and broader rerun.
