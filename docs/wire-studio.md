# The Wire Studio

The Wire Studio is an explicit, on-demand graphic breakdown. The newspaper stays readable as text; no graphics render or playoff requests run until a reader opens a breakdown. The multi-league front page remains text-only.

## Reading flows

- Open a matchup preview, recap, rivalry report, or documented championship story, then select **Open graphic breakdown**.
- In a single league, **Playoff picture** opens the postseason desk. The all-league view has the same action under each league's coverage disclosure.
- The Rivalries section offers breakdowns for followed and discovered pairs, including followed rivals who are not playing each other this week.
- Comparison graphics show completed-season form and a chronological, clickable meeting timeline. Each meeting opens its original score, team labels, and sources; regular-season and championship series remain separate.
- A season trajectory plots verified weekly fantasy points for both teams. Week buttons expose the exact scores, aggregate records, and separate head-to-head records after that week. A missing completed week stops the chart; unplayed weeks are not plotted as zero.
- Bracket and Playoff path views load the selected league season's Sleeper championship bracket. Winner connections focus and highlight the linked game. A team selector follows one team's rounds, byes, opponents, and available final scores. Later stops on a documented route remain conditional until advancement is known; they do not assign a future opponent or score.
- Race shows the range of records each team can finish with. Select a team and vary its additional wins to inspect a final-record scenario. In median leagues, the slider explicitly counts both head-to-head and median decisions. Other remaining decisions become losses and no future ties are assumed. Guarantees require sufficient evidence and supported seeding rules; uncertainty stays visible.

## Evidence boundaries

Owner IDs connect seasons; a reused roster slot does not. Story comparisons stop at that story's own completed week, including when a season archive contains later results. Historical graphics identify the original season and retain its scoring. Unknown scores stay unavailable; a bye is never counted as a scored win. Provider bracket results establish advancement, and consolation games stay outside the championship path.

Before the postseason begins, Sleeper's bracket is a provisional view of the current field. Matchups and bye positions can change; the graphic does not present them as qualification or a settled schedule. Unverified timing also keeps an active league's field provisional.

Race figures use completed regular-season results, distinguish median decisions from head-to-head games, and are not simulated playoff probabilities. Divisions, custom or unverified seeding, incomplete weeks, and unsupported formats restrict what can be asserted. Conservative record-based scenarios do not claim the shortest possible clinching route. The best finish bound counts opponents already beyond the selected final record; the worst bound counts every opponent that could still match or exceed it. These are outer bounds, not exact achievable positions: the other teams cannot necessarily realize their independent extremes together. Tied records never assume a tiebreak winner. Division/custom formats may show a final record but suppress finish bounds and qualification claims.

The dialog cancels pending loads on scope changes or close. Account, league, season, and edition changes cannot leave a previous story's graphic visible. Current and historical season selectors are distinct from the comparison snapshot. Sources, scope, and loading failures remain accessible in the graphic.

## Verification

Focused tests cover graphic provenance and cutoffs, scoring and bracket formats, race guarantees, missing data, cancellation, text-only portfolio rendering, and account/edition transitions. Browser checks exercise the actual compiled components at desktop and phone widths. Publication uses the existing live and sandbox workflows, followed by release revision and served-asset verification.

## Model additions

`broadcast.trajectory` contains `season`, `startWeek`, `throughWeek`, `recordScope`, and `weeks`. Each weekly entry supplies two teams in the comparison's established order (`points`, `record`, `h2hRecord`) and matchup source URLs. A documentary title feature has no current-season trajectory.

Bracket games expose `fromGames` and `nextGames` only for explicit winner references or unique verified winners from the immediately preceding round. Path stops retain `gameId`; future stops have `conditional: true` with unknown opponent and points.

`WrWirePlayoffs.race()` supplies numeric wins/losses/ties, `futureDecisions`, and `decisionsPerWeek`. `WrWirePlayoffs.scenario({race, teamId, wins})` returns a final record, conservative record bounds when seeding is supported, a qualification explanation, and explicit assumptions. Invalid inputs return `null`.

The focused tests now also cover timeline and trajectory interaction, story-week chart cutoffs, zero/missing points, conditional bracket routes, and every win/loss outcome in a two-week fixture schedule against the scenario bounds.
