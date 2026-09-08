# The Duat historical game

The Duat is a separate Dynasty HQ game, entered from the hub or
`index.html?duat=1`. This implementation supports a complete historical season:
solo against thirteen AI factions, or private campaigns with friends and AI.
Solo play uses browser saves; friends use the authenticated Duat Edge endpoint.
The backend and deployment wiring are included, but this document does not
establish that any production deployment has occurred.

Original rules were ported from The Duat at `ada801d`. Runtime code has no
dependency on that checkout or its Sites hosting. The game reuses the Vault's
pure identity, roster, player-card and stat-scoring helpers; Duat campaign state,
browser storage and database tables are separate from Vault leagues.

## Modules and entry

| Module | Responsibility |
| --- | --- |
| `rules.js` / `App.DuatRules` | Original faction, world and nineteen-favor catalogs; Heptad and Heavenly Battle |
| `army-generation.js` / `App.DuatArmies` | Four-army allocation, archived/provider imports, reveal order and d20 bands |
| `conquest.js` / `App.DuatConquest` | Homelands, weekly rewards/losses and connected territory claims |
| `favors.js` / `App.DuatFavors` | Seven executable historical scoring favors, declaration validation and treasury costs |
| `campaign.js` / `App.DuatCampaign` | Historical scoring, AI decisions, all-play standings, tournaments and complete-season actions |
| `storage.js` / `App.DuatStorage` | Validated solo saves, save-index recovery and storage failure handling |
| `remote.js` / `App.DuatRemote` | Account-authenticated requests and rejection of responses after an account switch |
| `session.js` / `App.DuatSession` | Reusable pure seat, readiness, revision and receipt contracts; the server transport implements transactions in SQL |

`js/tabs/duat.js` renders setup, ruler reveal, lineups, favors, game results,
conquest, tournaments, campaign saves and friend invitations. `duat.css` styles
the game. `index.html` declares the deferred `duat` module group; the app loader
loads its shared historical helpers before campaign code. Individual domain
modules also support Node `require` for tests and server packaging.

## Rules and historical data

The original format is fourteen factions, four eight-player ruler armies per
faction, and a starting five of QB1/FLEX4 with three bench players. Each campaign
selects four historical years. A seeded d20 chooses the walking ruler using
bands 1–5, 6–10, 11–15 and 16–20. All-play runs through Week 14; seven paired
alliances play Heptad; the top seven enter the Heavenly Battle in Weeks 15–17,
including reseeding and the Camel. New campaigns begin with equal homelands
and no imported league records or example scores.

`data/duat/` vendors nflverse regular-season statistics for **2002–2025,
calendar Weeks 1–17**: `nflverse-game-logs.csv`, `player-cards.json` and
`manifest.json`. The manifest records source URLs, hashes, attribution, weekly
coverage and identity aliases. The data builder checks canonical identities
against nflverse player IDs across all years, including same-name players and
father/son collisions. It uses total fumbles lost and all three conversion types.
Week 18 and NFL postseason are excluded; no NFL playoff points enter Duat's
championship. Buffalo–Cincinnati's canceled 2022 Week 17 game remains absent.

Each player scores from the walking army's historical year and the current
calendar week. Original scoring is half-PPR, 4 passing-TD points, 6 rushing or
receiving-TD points, 0.04 passing-yard points, 0.1 rushing/receiving-yard points,
2 conversion points and −1 per interception or lost fumble. A missing player
record in a covered week scores zero; this does not diagnose an injury or bye.
Missing season/week coverage blocks campaign creation. AI estimates and lineup
choices use earlier seasons and completed campaign weeks, never unrevealed
current-week or future scoring results.

Sacred weeks are 5, 7, 10, 14, 15, 16 and 17. The documented original seasonal
treasury is $100. Seven of the nineteen catalog favors are executable: Kratos
I–III, Horus I–II and Janus II–III, at their original $10/$20/$30 prices. Horus
requires a recorded game at resolution; an unavailable declaration spends
nothing. Janus imports an earlier finalized base score, without its old favor.
Favor effects apply to all-play and Heavenly Battle; Heptad uses unchanged base
scores. Other catalog favors are unavailable rather than presented as working.

Conquest settles last-place losses before awards and protects active homelands.
Claims spend earned currency on connected, unowned territory. Human factions
must resolve available claims before the next week; AI claims resolve through
the campaign adapter. All-play ties award half results, with points and faction
ID breaking equal records. Weekly conquest ranking breaks score ties by faction ID.

## Saves and friends

Solo saves use `dhq-duat-campaigns-v1` and `dhq-duat-campaign-v1:<id>`. The UI
exports JSON backups and restores validated backups under 5 MB to this browser.
Save-index recovery is read-only; failed writes attempt to restore the previous
save and index. Backup validation checks structure, not authenticity, and local
backups cannot replace authoritative multiplayer state.

Friends require a Dynasty HQ email-account session. `supabase/functions/duat`
validates that session internally, generates private campaign seeds, accepts
intent rather than replacement state, and returns `projectCampaign` views.
Opponents' pending lineups/favors and unrevealed ruler decks stay hidden.
The host receives invitation codes for reserved seats; each friend claims one
faction. Every human must join and mark ready before host advancement.

`20260908160000_duat_campaigns.sql` creates separate campaign, membership and
action-receipt tables. Browser roles cannot access private rows or mutation
functions. Service-role transactions recheck membership, readiness and expected
revision while committing, and deduplicate action IDs by actor and intent.
`verify_jwt = false` preserves the app's custom-token authentication; it does
not make the endpoint anonymous. There is no background season scheduler.

## Build and verify

```sh
npm run test:duat
npm run test:login-auth
node scripts/build-duat-server.cjs
npm run build:preview
```

The Duat suite includes domain, data, storage and offline multiplayer acceptance
tests, including the actual Edge request handler and PostgreSQL-compatible
transactions. These tests do not establish production availability or independent
connection load behavior. The main `npm test` runner also includes the suite.

To refresh source data explicitly, run
`python3 scripts/build-duat-data.py --cache-dir work/duat-cache`; this reuses
cached nflverse releases or downloads missing years and rewrites the three data
artifacts. Review provenance changes and fixed-source regression fixtures.
The server builder produces ignored `supabase/functions/duat/runtime.js`,
bundling the same engine and compressed data. Each room loads its four years.

`deploy-functions.yml` runs contracts, builds both game runtimes before Deno
checks, applies and verifies the allowlisted Duat migration, then deploys the
function. Its repository guard limits backend deployment to the canonical
`C2-Football/WarRoom` repository. A local preview or successful offline test
does not publish frontend assets, apply production SQL or deploy the endpoint;
release verification must check those separately.
