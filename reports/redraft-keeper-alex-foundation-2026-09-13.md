# Redraft, keeper and Alex: first correction pass

Local changes only. No commit, deployment or live model-quality claim.

## Corrected behavior

- Alex receives explicit retention format, scoring, roster slots, season/week, trade permission and imported keeper-rule availability. Structured requests and generic chat use server-side decision rules. Explicit other-league and portfolio requests do not inherit the open league.
- Redraft advice focuses on weekly and remaining-season decisions. Dynasty-only heuristic rebuild, youth/value-window and future-capital cards are suppressed outside dynasty. Unknown formats do not default to dynasty.
- Removed blanket DHQ/PPG/age exclusions and arbitrary QB/TE multipliers from the shared client preamble and common server system prompt. Advice must compare actual alternatives and label missing evidence.
- Keeper weekly start/sit support is enabled. Draft context recognizes native keeper format without requiring a count, while explicit redraft/Chopped formats ignore vestigial keeper counts.
- The keeper panel no longer invents three slots or calls top blended scores final keeps. It explains its provisional ranking and missing costs/eligibility. Unknown and zero slot counts remain distinct.
- Keeper responses are keyed to user, rules, scoring, candidates and scores; late responses are ignored after those inputs change. Structured insight hashes also change with scoring, format, starters and FAAB usage. Server response-cache version advances.

## Verification

Passed AI transport/provider and format-context tests, core tests (97), redraft engine tests (16), redraft valuation tests (15), draft context tests (11), live decision tests (33), workspace tests (5), intelligence surface checks (5), and first-class mode checks (7). Changed browser files pass lint and whitespace checks. Preview compiles 141 scripts.

Local browser rendering used an explicitly synthetic keeper fixture because the clean development session had no connected leagues. Checked unknown-to-two-slot rendering, suppression of an old asynchronous answer, and the 390px phone layout. Screenshot: `output/playwright/keeper-shortlist-mobile.png`. The page logged the existing meta-CSP frame-ancestors warning. No real model calls or roster transactions were made.

## Required next work

This is a correction pass, not a calibrated keeper optimizer or proof of predictive quality. The existing 60/40 dynasty/ROS shortlist remains uncalibrated and current-season keeper market values are not comprehensively redesigned.

Use a real keeper league's slot limit, eligible players, round/salary costs, escalation, tenure limits, deadline and draft rules to build a separate keeper-surplus comparison. Do not invent next-season ADP or treat unknown costs as free. Support no-cost leagues explicitly when confirmed.

Evaluate Alex on reviewed real scenarios: weekly starter versus ROS trade value; low-history injury replacement; cheap veteran in redraft; costly star versus cheap keeper; depleted FAAB; disabled trades; missing current injury reporting; league switching; and conflicting user strategy. Prompt and routing tests do not establish live-answer correctness or calibration.

Existing provider/account isolation and billing behavior are unchanged. Deployment must include frontend assets and the updated AI function. Unrelated concurrent League Wire work is outside this change.

## Waiver decision corrections (follow-up)

Implemented all six audited waiver issues locally:

- Seasonal values return unknown when the current league/week map is unavailable, preserve zero, and enumerate projection-only players. Scoring changes refresh the map. Shared player-value copies remain identical.
- Ranked recommendations compare optimized before/after starting lineups, including FLEX, actual roster capacity and a specific possible drop. A better backup alone does not establish a redraft upgrade. Dynasty bench improvements are explicitly labeled stashes.
- Coverage excludes reserve/taxi, unavailable players and current byes. Imported locked/protected players are excluded from drops. Current platform kickoff/transaction locks still require verification before submitting a claim.
- Removed score-to-dollar and scarcity-multiplier bid suggestions from the waiver board. Bid planning describes completed same-league, same-position winning bids only with at least five observations, preserving zero bids and unknown budgets. It makes no winning-price/probability claim.
- Alex receives scoring, week, roster availability, projections, actual before/after gains, proposed drop and remaining-budget evidence. Missing news, pricing and lock evidence is explicit.
- Waiver answers expire after 15 minutes and match the complete decision snapshot. Late responses are ignored after changes or clearing. Returned player names must belong to eligible candidates.

Verification: FA market suite, roster matching/drop tests, QB-role regression, new bid/context/cache tests, redraft suite (17 valuation tests), and AI routing/format suite passed. Preview compiles 141 scripts; changed valuation/waiver code has no lint errors (unused-variable warnings remain). Whitespace checks and shared-copy comparison pass.

Synthetic browser verification: an available starter improves the best QB lineup by 3 projected points and proposes the weaker reserve as a drop; Mendoza is excluded from the ranked plan. Verified same-position historical bids, delayed-response rejection after a budget change, invalid model-candidate filtering, and immediate invalidation after scoring changes. The 390px screenshot is `output/playwright/waiver-decision-mobile.png`. No real model request or roster transaction was submitted. Fixture history read produced a missing-row endpoint error; the app's existing meta-CSP warning also remains.

This is not evidence of an A-grade live model or a calibrated keeper optimizer. Current injury/depth feeds and league-specific keeper costs remain quality dependencies. Nothing in this follow-up has been committed or deployed.
