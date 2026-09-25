# The Wire documentary archive

The One and Psycho League now have a documentary history layer alongside the existing scored regular-season archive. Sources are the two user-supplied league workbooks and Sleeper league-history endpoints checked September 14, 2026 UTC. The source workbooks remain unchanged and local; only reviewed facts and their provenance are bundled.

Implemented behavior:

1. League-specific fact collections selected by verified league IDs or a directly linked renewal. A matching name alone cannot enable a collection.
2. A History section, championship timeline, consecutive-title stories, championship-player legacies and league honors. Every story includes source locations. Documentary facts retain their season and classification.
3. Exact historical account handles, workbook aliases and checked title participants bind owners. Current roster slots only locate already-bound owners. Unknown aliases remain unbound. A new owner cannot inherit an old owner's matchup context.
4. Workbook and Sleeper overlap is reconciled without adding cumulative workbook totals to live totals. Playoffs, regular-season meetings, Cup results and original scoring remain separate. Historical award snapshots are labeled and compared with checked Sleeper results; they cannot trigger record-breaking claims.
5. End-of-season facts only appear in later-season editions because their exact publication week is unknown. This applies to stories, related context, title timelines and historical scoring honors.
6. Current previews and completed recaps receive championship context only when both opponents have confirmed owner identities. Title rematches can appear before the regular-season archive finishes loading, without altering its win counts.

## Reconciliation results

The One's 2020, 2022, 2023, 2024 and 2025 title scores match Sleeper. Its 2021 workbook score is 170.85–140.93; the checked Sleeper result is 169.70–140.94. Both values are retained and the displayed final uses Sleeper. The source does not establish why the scores differ.

Psycho's missing title years are supplied by Sleeper: Skjjcruz beat Mwitkowski 270.08–220.10 in 2024, and TWhy123 beat Skjjcruz 252.33–224.96 in 2025. The earlier title-score differences are also retained:

| Season | Workbook | Checked Sleeper |
| --- | --- | --- |
| 2021 | 253.86–178.82 | 253.61–179.07 |
| 2022 | 204.32–176.98 | 204.33–176.98 |
| 2023 | 222.18–148.01 | 222.14–151.01 |

All 70 regular-season weeks from Psycho's 2021–2025 seasons were fetched for comparison with its scoring awards:

| Season | Workbook weekly high | Sleeper weekly high | Workbook season leader total | Sleeper leader total |
| --- | --- | --- | --- | --- |
| 2021 | 262.83 | 262.82 | 2975.74 | 2975.38 |
| 2022 | 265.12 | 265.13 | 2993.80 | 2993.84 |
| 2023 | 268.16 | 268.15 | 2989.91 | 2989.87 |
| 2024 | 307.39 | 307.39 | 3111.42 | 3111.92 |
| 2025 | 293.62 | 293.62 | 3236.56 | 3233.56 |

These are season-specific raw scores, not normalized cross-era rankings. The original named awards are preserved; source comparisons explain snapshot differences. The current record book continues to use its dynamically fetched, scoring-aware evidence. This checked documentary snapshot is not automatically refreshed by the edition-refresh control.

## Excluded claims

- The One's 2015/2016 matchup-only entries do not explicitly identify a winner; they cannot generate championship claims automatically.
- The One's Deniz Gazi championship count has no matching title-game entry. Do not assign it to a season.
- Cumulative wins and Cup counts lack enough timing/identity evidence for safe automatic addition. Median wins are not H2H wins.
- The One's 2017/2019 season PF–PA sums do not balance; numeric source rows are retained locally but not promoted to verified records.
- Date-formatted win–loss/vote cells, stale manager totals, unresolved name changes and conflicting rule proposals are not inferred or repaired.
- Pre-Sleeper individual game scores are not reconstructed from season aggregates.

## Maintenance and validation

`scripts/import-wire-chronicles.py` generates the bundled data from the local read-only cell captures and reconciliation snapshots in `output/league-histories/`. An alternate input directory may be passed as its first argument. Original file hashes are retained in the local manifest. Workbook cell coordinates and exact Sleeper endpoint references travel with each published fact; owner-binding evidence is retained in the collection. Raw workbooks and the full raw cell archives are not deployed.

The browser-facing enrichment is a pure optional layer in `js/shared/league-wire-chronicles.js`, invoked by `league-wire-journal.js`. It does not mutate shared facts or base record totals. `tests/league-wire-chronicles.cjs` covers cross-league isolation, verified renewal IDs, replacement owners, scoring overlap, preserved original scores, title supplements, edition cutoffs and matchup/recap context. It runs within `npm run test:live-scores`.

## Current-news editorial policy

The front page and ticker exclude documentary stories. The front page selects up to five distinct current stories per league, avoiding repeated lead subjects, categories, and matchup previews. Full current coverage remains in Stories/Recaps; the History section retains the documentary archive.

One separately labeled “This week’s lookback” is selected deterministically per edition week. It stays stable on reload, respects league/team filters, and never occupies a current headline slot. This is an in-product weekly editorial selection, not a scheduled notification.

Title-watch stories join current completed records to documented titles by verified owner identity within the league. They cover title defenses, attempts at another run, and groups chasing another documented championship. They do not claim first-ever milestones when the championship archive has gaps. Newcomer check-ins require complete linked history and the immediately preceding season’s manager list, appear during the first four completed weeks, and do not equate a renamed team with a new owner. Current standings are observations, not projected championship odds; no season forecast is invented.
