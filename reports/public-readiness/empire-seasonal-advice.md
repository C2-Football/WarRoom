# Empire seasonal advice and valuation basis

2026-09-20. Worktree `warroom-readiness-empire-seasonal`, branch `codex/readiness-empire-seasonal-20260918`, source parent `f4efa76`. This isolated batch is validated locally and awaiting independent review/integration. It is unreleased; consumed-rights fix is separately committed `1e5e3d8`.

## Reproduced defect

The actual `buildEmpirePortfolioModel` prices a 35-year-old WR in a redraft or keeper league using universal dynasty `LI.playerScores`, emits “Post-window value needs pruning,” and ranks rosters on that same dynasty baseline. Downstream scenarios, moves, maps and rankings inherit it. The existing seasonal spread board does not correct those primary model fields. The old mark-data effect may reuse projections/stats from an unrelated historical `window.S` bridge.

## Implemented contract

- Dynasty holdings retain dynasty DHQ and age-window interpretation. Seasonal/keeper holdings use explicitly fetched current-season projection evidence through the existing league-specific seasonal engine; missing/historical-only evidence remains unknown. Keeper current-season values do not establish keeper surplus.
- Ownership/exposure and real records remain available regardless of prices. Unqualified dynasty health/tiers are not seasonal assessments. Complete seasonal roster values provide an intra-league value rank, labeled separately from standings.
- Different valuation bases never form a combined total or scenario loss. Scenario rows retain their own basis. Dynasty age advice, competitive windows and psychology are scoped to dynasty; seasonal concentration remains a review action without invented acceptance or trade premium.
- Player lists, maps, rankings and rival lists remain reachable. Individual league values and missing states are explicit. A seasonal fetch failure has a retry, and late account responses cannot publish.

## Verification

- `npm run test:empire`: passes actual seasonal-engine 24, decision 6, scenario 7, and combined pick/seasonal-model 25 groups. No skips/quarantines. New model/loader cases cover redraft/keeper/seasonal prices and rank, missing/historical/unknown inputs, mixed-model/scenario separation, preserved seasonal exposure review/rivals without dynasty posture, explicit-season fetch/error/retry/timeout/account invalidation. Actual engine tests cover missing current-player evidence, historical books, format precedence and mapped platform ownership.
- `node tests/run.js`: 97 passed. The old Chopped test injected a generic dynasty health score and called it seasonal evidence. It now verifies that such a value never contributes to current-season health; the existing survival, eliminated-roster and record assertions remain.
- `npm run test:workspaces`: passes. The actual JSX market fixture now explicitly declares a successful season-data load; its capability assertions remain intact.
- `npx eslint js/tabs/global-view.js js/shared/empire-values.js`, `git diff --check`: pass.
- `npm run build:preview`: passes, 147 Babel scripts; canonical shared pin remains `7bd3531` with matching player-value twin.
- `node tests/empire-seasonal-browser-qa.cjs`: actual Chrome against matching local preview. Read-only provider fixtures and fully disabled Supabase prevent external writes. An old in-memory projection bridge cannot override an empty explicit-2026 response; holdings remain unpriced, Retry uses the actual seasonal engine, Portfolio Lab labels season values/hypothetical limits, rankings and competitive windows remain reachable. 320×720, 390×844 and 844×390 have no document overflow. Successful retry collapses the explanatory notice so the current action retains phone space. Screenshot `empire-seasonal-lab-390.png` was visually inspected.

Browser evidence is controlled local runtime evidence, not deployed/physical-device or live-data calibration proof. Unknown keeper economics remain unknown. Dynasty DHQ retains its existing shared baseline approximation.

## Next executable work

1. Independent root review, integrate this batch and `1e5e3d8`, then validate/deploy through the established release process. No deploy performed by this agent.
2. Canonical `dhq-shared/team-assess.js` `buildPicksByOwner`/`picksAssessment` still invent current+2-year rights for every format and consumed drafts. Its global assessment cache fingerprints transfer count rather than contents, so same-count ownership updates also need review. Requires a canonical shared commit and root pin coordination.
3. Inline Empire `renderTradeDeskDetail` passes the selected league and season stats to `TradeCalcTab`; its `ensureRos` still implicitly reads prior/projection data from global `S`, and value access depends on current global league identity. Reproduce and repair that separate cross-league handoff before claiming all Empire format advice ready. The manual path remains visible; this batch does not claim its calculations are verified.
4. Seasonal team health/needs remain unscored until the shared assessment supports a verified seasonal basis. This is an explicit remaining feature-correctness dependency, not a passed requirement.
