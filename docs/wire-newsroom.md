# The Wire newsroom direction

The Wire should answer three questions quickly: what happened, why it matters, and what to watch this week. Its advantage is verified league-specific context, including owner continuity, original scoring rules, and the rivalries the reader chooses. More output is not the objective.

## Voice

Write like a reporter who knows the league. Start with the result, the consequential detail or the opinion itself, then give the numbers that explain it. Two short paragraphs are usually enough. Vary the sentence structure when the evidence calls for it, rather than swapping synonyms into the same sentence.

Let the facts supply the personality. A low-scoring win, a productive late pick or an overcrowded position can carry a little dry humor. Avoid invented motives, canned pep talks, generic lessons, repeated catchphrases and jokes that could sit underneath any headline. Opinions should make a defensible judgment rather than tell the reader to investigate it.

Keep methodology and sources in supporting details unless the limit changes how the reader should understand the sentence. A scoring example still names the components it counts; a historical comparison still names its season; draft returns still distinguish observed lineup points from points retained by the selecting owner. Team names and owner names take natural singular or neutral constructions. These are reporting principles, not an imitation of a particular writer.

## Current news and historical context

- Matchup coverage starts with current records and form. Every verified scheduled pair can receive a preview, including an opening-week introduction before results exist. Rivalry and championship context enrich that preview instead of producing duplicate stories.
- Recaps separate the result from its significance in short paragraphs. Secondary stories expose a short summary before expansion.
- A dedicated This week section separates matchup coverage from completed results. Full Stories and search make coverage beyond the edited front page reachable.
- Edition periods and successful current-data check times stay visible. History loading is separate from current-news readiness. Partial refreshes preserve usable reporting with its original scope and time.
- Same-season archived editions exclude current transactions and live record-watch stories. Historical titles and awards retain their event season and stay out of current headlines. History also includes regular-season reviews from complete verified Sleeper seasons when no curated sourcebook exists.

Title watch requires a new result with a meaningful development: a former champion taking the standings lead, ending a run of at least three wins or losses, reaching three straight wins or losses, or opening a title defense. At most one such story appears per edition. A past title alone does not create a fresh headline. The front-page lookback selects substantive historical context; thinner documented facts remain available in History.

Automatic rivalry discovery requires either at least four verified regular-season meetings, two wins apiece and a win-count gap no greater than two; or at least three meetings, a win apiece and two margins of five points or fewer. Personally selected rivalries remain available without meeting those thresholds. Their preferences are saved in the reader's browser. Championship meetings stay separate from the regular-season series.

## Sections with distinct jobs

- **Records** is a standing record book, not just record-breaking news. It includes the selected season's scoring high, comparable archived scoring highs and largest wins, every tied holder, and score receipts. When rules change, a separate cross-era high preserves original scoring. Coverage names the loaded seasons; playoffs and pre-Sleeper awards remain separate.
- **Trends** compares equal adjacent windows of completed player games: one week against one early in the season, growing to three against three. It uses the selected league's scoring, shows games counted and weekly receipts, and requires at least a two-point change in average. A one-week comparison is labeled early evidence. Current editions cover rostered players; historical editions are limited to recorded starters available through the selected cutoff. Missing appearances are omitted, real zero and negative scores remain, and commissioner adjustments to team totals are not allocated to players. These are observations, not forecasts or explanations of injuries and roles.
- **League feed** concentrates on recent transactions and compact live updates. The transaction window is the last seven days of loaded data; completed trades identify their actual assets, and waiver reporting identifies the largest verified bid in that window. It is not a transaction archive or a duplicate recap section. Live transactions do not leak into old editions.
- **NFL** combines current-week fixtures and live scores with the previous week's results, accounting for preseason, regular-season and postseason boundaries. Completed games receive short result-led recaps and supported standout performances. Quarter-based narratives require quarter totals that reconcile with the final score. Box scores open on request, with player categories, actual source labels and retry controls.

NFL scoreboards and game leaders come through the ESPN relay. The browser checks scores every minute while the view is active. Live and recently played schedules use a one-minute shared cache; distant future and archival schedules retain a three-hour cache. The relay reports its original upstream fetch time, so checking a cached response does not imply a newer score. Box scores prefer Sleeper weekly statistics only when season, week, phase, teams and game identity match; otherwise they try the verified ESPN event summary. Missing statistics display as unavailable, not zero. Scores and statistics can be delayed or corrected. Failed refreshes retain a same-game snapshot with an explicit stale state.

## When the new edition arrives

The Wire checks the current regular-season NFL schedule independently of Sleeper's display-week rollover. Once every game in a complete, correctly scoped scoreboard is final, it includes that week's verified Sleeper matchup totals and requests the following week's schedule for previews. A note says scores may change with stat corrections. This normally makes the new edition available after Monday night's last game, without waiting for the provider's correction window to close. Empty, malformed, postponed, suspended or unfinished schedules never authorize early publication.

Both Wire views refresh while visible and when returning to the app. Later fantasy scoring corrections rebuild the same edition; verified recaps do not wait for next week's schedule to become available. This is a reporting cutoff only: lineup tools, live scoreboards and the provider's official standings retain their existing calendar. Historical and playoff boundaries remain unchanged.

The multi-league newspaper remains text-only on desktop; phones show compact identity badges. Search and owner filters apply to loaded reporting and the relevant section data; they do not search remote, unloaded history. Owner continuity uses verified accounts rather than reused roster slots. Current-form averages and The Wire's record-then-points standings are neither projections nor official playoff seeds. League life and progressive draft retrospectives are described in [wire-league-life.md](wire-league-life.md).

Validation combines deterministic evidence tests, account/scope and partial-refresh checks, and browser review with public Sleeper fixtures. These checks do not establish authenticated persistence or physical-device behavior. Deployment verification separately checks both release revisions and actual served browser assets.

## Mobile identity marks

Phone articles use up to two compact badges: the involved teams, or the league logo for a league-wide story. Custom Sleeper team logos take precedence over owner avatars; failed or unavailable images fall back to initials. Image dimensions are reserved, and decorative marks do not repeat the adjacent names for screen readers. Desktop multi-league articles mount no marks.

The same marks appear in mobile news, League Life, Opinion and draft columns. Documentary and other-season stories use a year marker, avoiding any claim that a current team logo belonged to a past roster. Known owner accounts take precedence over reused roster slots. Single-league phone stories use these compact marks instead of a compressed illustration banner.
