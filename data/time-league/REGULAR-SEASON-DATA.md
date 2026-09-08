# Regular-season archive

New leagues using `gameDeckVersion: 1` use `regular-season-game-logs.csv`,
`regular-season-era-factors.json`, and `player-cards.json`. Existing leagues use
the original `nflverse-game-logs.csv`, `era-factors.json`, and the exact archived
`legacy-player-cards.json`. The legacy scoring rows, indexing, and totals are
not rewritten.

The new archive restores recorded regular-season games after week 14. A card's
`games` / `recordedGames` is its number of source scoring lines, not a separately
verified NFL participation count. `scheduledGames` records the available team
schedule and `sourceWeeks` identifies the distinct scoring rows. There is no
repeated source game inside a player-season.

## Sources and limits

- 1970–1998 skill positions: the existing historical player-game corpus.
  Complete team date calendars distinguish regular season from postseason;
  player appearance counts are never used to classify playoffs. This preserves
  the 14-game era, 16-game era, nine-game 1982 season, and 15-game 1987 season.
  Fumbles and two-point conversions are unavailable in that corpus, so its
  seasons explicitly carry `regular-season-missing-stats` coverage.
- 1999–2025: cached [nflverse player weekly statistics](https://github.com/nflverse/nflverse-data/releases/tag/stats_player),
  filtered to `REG`, under the upstream CC-BY-4.0 attribution. Kickers and team
  defenses start in 1999. Defense does not include unavailable points/yards
  allowed or blocked kicks. No individual defensive players enter this pool.
- NFL week numbers remain official source week keys for nflverse. Earlier games
  use a chronological player-game ordinal because the corpus has no NFL week
  field; the team-game ordinal is retained separately as `historical_week`.
  Neither is presented as a known bye.
- Same-name players are resolved to one consistent source career, including
  matching across the 1999 source boundary. Excluded namesakes are listed in
  the manifest. A conflicting Derek Brown source career is quarantined.
- Some upstream 1999/2000 team game logs are missing, including from freshly
  checked upstream releases. Those affected seasons are excluded from new
  draws. Historical matchup evidence corrects known 2001/2002 Jacksonville
  team-label errors. Unresolved player or defensive contributions are excluded
  at the affected player-season scope. The manifest lists every exclusion and
  correction count. Known archive gaps never become presumed missed games.

## Rebuild

Run from the repository with the existing source files:

```sh
node scripts/build-vault-regular-season-data.cjs \
  --nflverse-cache '/path/to/nflverse/cache' \
  --profiles '/path/to/profiles_1512362725.022629.json' \
  --historical-games '/path/to/games_1512362753.8735218.json.zip'
node tests/time-league-regular-season-data.cjs
```

Use `--output /path/to/staging` to review a build before replacing current
assets. The builder accepts uncompressed historical JSON too. It streams the
large historical archive, reads the cached weekly files, records source hashes,
and writes only its output directory. It does not download data or modify
source files. Repeated builds with the same inputs produce identical outputs.

The validation checks legacy hashes, source-game uniqueness, all card totals
against every scoring line, runtime metadata preservation, 14/16/17-game and
shortened-season examples, and same-name career separation. Detailed source
coverage and excluded seasons are in `regular-season-manifest.json`.
