# Rule Lab scoring usability

The scoring editor now keeps the experiment close to its result. Common presets and a searchable single-rule editor show the league’s current value alongside the proposal. Presets and +/− replay immediately; typed values stay staged until **Preview changes**. Decimal, negative, custom, and newly enabled catalog stats remain editable.

Desktop puts replay impact beside the controls. Smaller screens show a compact factual preview beside the editor and a focusable **See replay impact** action. The full replay shows rank movement, largest points change, seed/playoff effects, with all-team standings and player/position evidence under **View details**. Optional lineup changes, the full scoring catalog, thresholds, and saved draft management remain available.

**Save draft** stores settings in the current browser and confirms successful saves beside the action. A failed save keeps the intended draft and offers an idempotent retry. Sharing and threshold comparisons require the latest typed changes to be previewed.

## Accuracy and recovery

- Regular-season replay excludes configured playoff weeks.
- Missing whole-week raw stats stop numeric comparisons; failed or malformed lineup reads reject the incomplete season load.
- Incomplete stat loads are evicted; explicit reload clears historical packs and refetches stats.
- Threshold results are canceled when league, season, scoring, lineup, or account context changes. They use the same committed scoring and lineup structure as the preview.
- Unavailable threshold data never produces a HOLD or no-movement verdict. Zero-effect proposals do not arbitrarily name a top gainer.

## Validation

Final local and hosted evidence is recorded alongside this report. Browser journeys use two isolated leagues with different scoring, ten teams, forty players, and eighteen completed provider weeks; fourteen regular-season weeks are independently summed from raw stats. Recorded matchup points are deliberately bogus to detect accidental reuse. External writes are blocked.

Browser viewport and touch emulation validate phone, iPad-size, and desktop layouts; they do not establish physical iPad behavior. Drafts are browser-local and these changes do not publish league settings to Sleeper.

## Local acceptance

- [Integrated suite](integrated-tests.log): 44/44 passed in 206.0 seconds with the pinned shared dependency. No failures or quarantines.
- [Commissioner suite](commish-tests.log): passed, including 31 Rule Lab engine tests, 50 panel tests, 13 actual Office callback groups, and 7 lineup recovery groups.
- [Lint](lint.log): zero errors; 35 existing repository warnings. [Production build](production-build.log): 159 JSX and 285 modules compiled/minified.
- [Chromium](local-chromium.json): six phone/iPad/desktop layouts passed. Five pinned passes and the corrected desktop harness rerun are combined with invocation provenance.
- [WebKit](local-webkit.json): both iPad orientations and desktop passed after fixing native dropdown height. The initial native-select failure is preserved separately.
- [Screenshots](screenshots/): actual viewport captures of fixture-backed scoring, compact feedback, and all-team details.

Interrupted shared-sync attempts and a desktop disclosure harness correction are retained as diagnostics. The final runs use the release-pinned shared snapshot. External mutations were blocked in automated journeys.
