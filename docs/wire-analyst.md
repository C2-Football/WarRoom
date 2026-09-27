# The Wire’s analyst

The Opinion section gives The Wire a point of view on each league’s scoring, roster setup, team depth, results and drafts. A separate front-page column introduces the desk without mixing opinions into current-news headlines. The combined Wire uses the same text-only cards; no image or graphic is added to its feed.

Each column has a visible opinion label, a short argument and concrete evidence. Supporting arithmetic, source links and limits live under **The numbers and sources**. The analyst can be playful about a rule or a draft result, but does not invent an owner’s motives, injury explanations, votes, grades or projections.

## What the analyst can judge

| Subject | Evidence | Scope of the take |
| --- | --- | --- |
| Scoring | Explicit numeric reception/rushing-yard, passing-TD/interception and made-field-goal yardage rules | How named scoring components reward or penalize an action. Kick-distance opinions require a kicker slot. Illustrative contributions are not complete player scores; other premiums or distance bands remain separate. Missing rates never receive standard-scoring defaults. |
| League format | Recognized starting positions, bench capacity, explicit reserve/taxi slots and median-game setting | The tradeoffs in depth, superflex choice and a second weekly result. Capacity does not prove that useful free agents are available. |
| Current roster depth | Current roster membership and known player eligibility, excluding reserve and taxi | Whether a roster covers its dedicated position slots, or has concentrated several players at one position relative to available eligible slots. This is an inventory check, not a health, bye-week, lineup-quality or projected-points judgment. |
| Season form | Every completed regular-season matchup through the selected edition | Whether head-to-head results flatter or understate same-week scoring against the whole league. Requires at least three completed weeks and six teams. Median results are kept separate. |
| Drafts | Existing verified draft receipts and selected-owner history | Later-pick value, why unequal lineup opportunity complicates a roast, and selected late-round successes across completed seasons. These remain retrospective opinions, not whole-draft or owner-skill grades. |

Scoring and format columns can appear before the first completed game. They use the selected season’s recorded settings. Current roster inventory appears only in the current edition, so an old week cannot inherit today’s roster. Result-based takes respect the edition’s completed-week cutoff and use custom roster totals when supplied.

The engine publishes a bounded set of supported takes. It does not manufacture a column for a subject with incomplete evidence. Current roster checks require a recognized lineup setup and complete position data for the roster being discussed. Unknown player data cannot turn into a claimed positional hole.

When no clear coverage hole qualifies, a roster-concentration column may examine a position with at least three eligible players, at least 1.5 times the lineup’s position-compatible capacity, on a roster with at least two spare players. Compatible flex slots are counted as an upper bound. Multi-position eligibility does not establish a feasible full lineup, and a concentration is not proof of trade demand or a reason to drop a particular player.

## Reading and filtering

The Opinion desk starts with four columns and offers more on request. Subject buttons separate scoring, league format, rosters, season form and drafts. Search applies to titles, copy, owner/team identities and supporting context.

A selected owner filters team-specific columns by the owner account. A known owner can follow a different historical roster slot; an unknown owner cannot inherit another season’s reused slot. League-wide rules remain visible with an explicit note that they affect every team. Account, league and edition changes reset the local subject and page length.

The combined edition also fingerprints scoring rules, roster membership, ownership, names and the recorded eligibility of rostered players. A same-week source change invalidates the warm edition. A source change during an asynchronous load cannot store newly built opinions under the earlier fingerprint. Unrelated player-catalog entries do not invalidate a league’s opinion cache.

Draft opinions remain on demand. Opening the desk alone does not fetch draft records. The draft service reuses already-loaded matchup history and checks at most two season drafts concurrently, beginning with up to eight loaded seasons. Older loaded seasons can be requested separately. Progressive results, cancellation, retries and saved-result notices use the existing draft-receipt lifecycle.

## Draft evidence boundaries

Only a verified primary completed snake or linear draft qualifies. Ambiguous or supplemental drafts, auction prices and keeper picks are not compared. At least four complete regular-season weeks and four verified fantasy starts are required. A fantasy start means the player appeared in a recorded fantasy starting lineup; it is not an NFL appearance.

Individual value opinions start from same-draft, same-position comparisons with similar fantasy-start counts. Unequal starts receive a separate lineup-opportunity opinion. Player points follow observed starting-lineup use across the league, including after trades; they do not prove return retained by the selecting owner. Missing player scores are not zero, and roster-level commissioner adjustments are not assigned to individual players.

Cross-season draft opinions require a known selecting account and at least two fully checked completed regular seasons. Each qualifying late-round pick is compared with its own season’s same-position group under that season’s scoring. The column names selected successes and explicitly leaves out any claim about the owner’s complete draft record or repeatable skill.

## Implementation and verification

- `js/shared/league-wire-analyst.js` builds evidence-backed rule, format, roster and form columns without network calls.
- `js/components/league-wire-analyst.js` renders the opinion card and desk; `league-wire-analyst.css` handles presentation.
- `js/shared/league-wire-draft-history.js` derives draft opinions from qualified receipts. `js/components/league-wire-features.js` supplies the lazy draft view.
- The single-league and multi-league Wire surfaces supply their existing scoped evidence and keep the front-page opinion separate from news.

Run the analyst engine and UI regressions with `node tests/league-wire-analyst.cjs` and `node tests/league-wire-analyst-ui.cjs`. The UI tests cover immediate filtering, historical identity, scope reset, lazy draft visibility, collapsed receipts and text-only cards. Draft and Wire integration checks remain in their existing suites. Browser verification should include the Opinion section and separate front-page column in both Wire views at phone and desktop widths.
