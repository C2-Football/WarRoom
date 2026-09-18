# Empire draft capital format correctness — 2026-09-18

Status: bounded correction implemented and locally verified; queued for independent integrated review/release. Branch `codex/readiness-pick-formats-20260918` starts at `3f6f241`. No root release-candidate mutation, backend writes, or deployment.

## Reproduction and intended behavior

The production `buildEmpirePortfolioModel` generated current season plus two future years for every format and applied the dynasty rookie-pick curve to all of them. An actual-model fixture with 16 rounds produced 48 picks, 40,440 dynasty pick value, and a strong-capital recommendation in each of redraft, keeper, dynasty, and Chopped. A verified empty transfer history established ownership but could not establish the inappropriate multi-year seasonal horizon or keeper economics.

Current accepted source establishes the boundary: `js/league-skin.js` grants future picks to dynasty and keeper, limits seasonal formats to this draft year, and reserves dynasty value for dynasty. `js/trade-calc.js` already limits seasonal pick ownership to one year. `reports/redraft-keeper-alex-foundation-2026-09-13.md` and `js/shared/wr-ai-context.js` require unknown keeper costs and eligibility to remain unknown. No calibrated keeper-pick pricing source was found. Keeper future rights remain supported; they must not be removed merely because their valuation is unavailable.

## Correction

- Resolve per-league format, including the canonical normalization/override seam and explicit redraft zero before vestigial keeper counts.
- Seasonal and unknown formats use one draft year; dynasty and keeper retain three-year ownership. Out-of-horizon transfers cannot create seasonal future assets.
- Only dynasty picks invoke the dynasty valuation curve. Keeper/seasonal/unknown values are null, labeled unpriced; mixed year/portfolio value totals cannot pass off the priced subset as a full total.
- Dynasty capital-strength advice counts only dynasty picks and names that scope. Round 1–2 counts remain visible without calling unknown keeper/seasonal economics premium value.
- Asset detail explains seasonal horizon, keeper eligibility/cost limits, and unpriced non-dynasty values. No new prices or keeper assumptions are invented. Scenario loss already excludes picks and remains player-only.

## Evidence

- `tests/empire-pick-formats.cjs`: 5 passed, zero skips. Executes actual production model/bridge/scenario and canonical LeagueSkin. Covers seasonal formats/aliases, keeper ownership and transfers, no invocation of dynasty curve outside dynasty, unchanged dynasty capital, mixed unpriced totals, exact-zero and override precedence, unknown format, keeper-count fallback, and scenario isolation.
- `npm run test:empire`: 21 value checks, 4 baseline decision checks, 7 scenario checks, and all 12 pick failure/format checks passed in this isolated branch. Root's newer journal batch is outside this branch and requires the combined suite after integration.
- Core 97 checks passed. Existing dynasty capital fixture now declares `settings.type: 2` explicitly; the same ownership/value assertions remain. Unknown-format behavior has dedicated meaningful coverage.
- ESLint and whitespace checks passed; preview compiled 147 scripts. The initial shared sync correctly rejected drift after another batch advanced canonical shared main to `7bd3531`. This branch intentionally retains its original `5de7baa36225c43e8cacb00a2763e4c65508f296` pin and built with `SHARED_SOURCE=/Users/jacobc/Projects/dhq-shared-readiness-picks-pin`, a detached checkout at that exact revision. No guard bypass or copied performance delta.
- Real Chromium/Playwright CLI fixture on local port 3501: two provider-intercepted pre-draft leagues, redraft and keeper, four rounds each. Supabase requests were blocked before navigation. Through hub → Empire → Assets → Players & picks → Picks, verified 4 redraft + 12 keeper rights, 16 unpriced total, three year rows (8/4/4), and no dynasty capital-strength recommendation. [390px screenshot](empire-pick-formats-390.png) visually reviewed.
- 320×640, 390×844, and 844×390 responsive checks found no document/card overflow; explanation is 16px. Local synthetic evidence only; no actual league transaction or native/physical-device claim.

## Integration and remaining boundaries

Only the model/read-only pick labels in `global-view.js`, the Empire script, and tests changed. Preserve root's journal and navigation recovery changes during cherry-pick. Root should independently review and rerun combined Empire checks before adding this to a coherent next release batch.

This does not declare Empire format correctness complete. The existing model's current-year rights do not reconcile completed draft selections; that requires a separate draft-lifecycle inventory rather than guessing from season alone. Empire's global player DHQ/age/posture advice is another adjacent format concern outside this pick-specific batch. Keeper costs, eligibility, and economic calibration remain unknown rather than fabricated. Final integrated browser/live release evidence remains outstanding.
