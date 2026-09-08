# The Duat historical game

The Duat is a separate Dynasty HQ game, entered from the hub or
`index.html?duat=1`. New campaigns use the v3 configurable historical draft, archaeology reveal
and optional country-conquest format: solo against AI factions, or private
campaigns with friends and AI. Solo uses browser saves; friends use the
authenticated Duat endpoint. Release wiring is included; production availability
must be verified separately.

Original rules were ported from The Duat at `ada801d`. Runtime code has no
dependency on that checkout or its Sites hosting. The game reuses the Vault's
pure identity, roster, player-card and stat-scoring helpers. Duat state, browser
storage and database tables remain separate from Vault leagues.

## Campaign versions and play

| Contract | Existing v1 campaigns | Existing v2 campaigns |
| --- | --- | --- |
| Factions | Original fourteen | Choose from 28; fourteen active per campaign |
| Armies | Four automatically allocated armies | Four eight-round snake drafts, one per selected historical year |
| Opening | Original ruler reveal | Draft, then fourteen individual archaeology reveals |
| World | Original 47 territories | 175 geographic country regions |
| Conquest | Original neutral territory claims | Neutral claims plus separate attack/fortify actions |

Versioned validation preserves existing saves and rooms; it does not silently
convert their geography, army allocation or warfare rules. The original
implementation report is retained at
[`reports/duat-game-foundation-2026-09-08.md`](../../reports/duat-game-foundation-2026-09-08.md).
The expansion and its verification are recorded separately in
[`reports/duat-mythic-expansion-2026-09-08.md`](../../reports/duat-mythic-expansion-2026-09-08.md).

A v2 campaign selects four distinct years from 2002–2025. Each of fourteen
factions drafts eight players for each year: 448 total picks, including 32 for a
single human faction. Seeded snake order alternates by round. Army validation
preserves enough players to start one QB and four RB/WR/TE, with three on the
bench. Draft estimates use prior seasons and position baselines; they do not
read the selected year's scoring results.

The host reveals one faction at a time. A seeded d20 chooses its walking ruler
using the original bands 1–5, 6–10, 11–15 and 16–20. Opponent armies remain sealed
until their reveal. Fourteen reveals open Week 1. All-play runs through Week 14;
seven paired alliances play Heptad; the top seven enter the Heavenly Battle in
Weeks 15–17, including reseeding and the Camel. Completed results can replay at
one-, three- or five-minute pace with pause and quarter controls. The saved
weekly result is authoritative; the replay is illustrative, not NFL play-by-play.

## Configurable v3 campaigns

The creation screen explicitly requests `version: 3`. Missing endpoint versions
remain v1 for cached clients; existing v1/v2 saves retain their original rules.
Settings are chosen before creation and remain immutable for the campaign.
The rules summary remains available in the draft, reveal and season views.

| Setting | Supported choices |
| --- | --- |
| `leagueSize` | 8, 10, 12, 14 or 16 factions |
| `mummyCount` | 1, 2, 4 or 5 distinct historical armies, with equal d20 odds |
| `roster` | `duat`: QB + 4 FLEX; `classic`: QB + 2 RB + 2 WR + TE + FLEX; `superflex`: classic plus SUPER_FLEX |
| `bench` | 1–6 players per army |
| `playoffTeams` | 2, 4, 6, 7 or 8; championship always in Week 17 |
| `favors` / `conquest` | Independent booleans, both default true |
| `favorBudget` | Integer 0–500 per faction for the whole season; default 100 |

Scoring presets offer standard, half-PPR and PPR. Custom `scoring` accepts
`passTd` (0–10), `reception` (0–2), `passingYd` and `rushRecYd` (0–1 each), and
`turnover` (−10–0). Rushing/receiving TDs remain 6 and conversions 2. The same
configuration drives weekly scores, gamecast and prior-year draft estimates.
No K/DST positions or extended scoring categories are exposed.

Drafts reset the snake at the beginning of each mummy army, including when the
roster creates an odd number of rounds. Picks reserve enough positions to fill
every faction's starting slots. A dynamic program assigns the strongest legal
lineup to positional, FLEX and SUPER_FLEX slots; Heptad uses the same assignment
on both allies' starters before favors. All league sizes use two-faction alliances.

Disabled conquest awards no land or war actions, runs no AI conquest, and rejects
claim/attack/fortify requests. Disabled favors start every treasury at zero and
reject declarations; enabled budgets apply equally to human and AI managers.

## Modules and loading

| Module / browser export | Responsibility |
| --- | --- |
| `rules.js` / `App.DuatRules` | Original factions, 47-territory board, nineteen-favor catalog, Heptad and Heavenly Battle |
| `world.js` / `App.DuatWorld` | Generated country paths, land/sea routes, 28 faction choices and geographic provenance |
| `army-generation.js` / `App.DuatArmies` | Original allocation/imports, reveal order and d20 bands |
| `conquest.js` / `App.DuatConquest` | Versioned claims, homelands, war actions, battle previews and fortification |
| `favors.js` / `App.DuatFavors` | Seven historical scoring favors, declarations and treasury costs |
| `campaign.js` / `App.DuatCampaign` | Draft, scoring, AI, standings, tournaments and campaign actions |
| `session.js` / `App.DuatSession` | Legacy v1 pure seat/readiness fixture; current rooms use the endpoint and SQL contracts |
| `storage.js` / `App.DuatStorage` | Validated solo saves, index recovery and storage failure handling |
| `remote.js` / `App.DuatRemote` | Authenticated requests and account-switch response protection |
| `js/components/duat-presentation.js` | Country map, draft, excavation, pantheon and result presentation |
| `js/tabs/duat.js` | Setup, gameplay orchestration, saves and friend invitations |

`duat.css` provides the painterly bronze, obsidian and turquoise presentation.
`images/duat/` contains the temple hero, excavation scene and Horus, Kratos and
Janus portraits. Its manifest records generation prompts, hashes and intended
uses. These illustrations are decorative; the playable map uses source geometry.

`index.html` loads the deferred Duat group in this exact order: rules, world,
army-generation, conquest, favors, campaign, session, storage, remote,
presentation, tab. Shared historical roster, draft-room, season and player-card
helpers load first. Domain modules also support Node `require` for tests and
server packaging. Loader tests execute the actual browser modules and cover a
failed world dependency followed by a full retry.

## Historical data and favors

`data/duat/` vendors nflverse regular-season statistics for **2002–2025,
calendar Weeks 1–17**: 127,055 weekly records and 3,271 distinct player cards in
`nflverse-game-logs.csv`, `player-cards.json` and `manifest.json`. The manifest
records source URLs, hashes, attribution, coverage and identity aliases.
The builder checks canonical identities against nflverse IDs across all years,
including same-name and father/son collisions. Total fumbles lost and all three
conversion types are included. Week 18 and NFL postseason are excluded;
Buffalo–Cincinnati's canceled 2022 Week 17 game remains absent.

Players score from their walking army's year and the current calendar week:
half-PPR, 4 per passing TD, 6 per rushing/receiving TD, 0.04 per passing yard,
0.1 per rushing/receiving yard, 2 per conversion and −1 per interception or lost
fumble. A missing player row in a covered week scores zero without diagnosing an
injury or bye. Missing season/week coverage blocks creation. AI decisions use
earlier seasons and completed weeks, never hidden current or future results.

The pantheon offers seven executable favors from the original nineteen:
Kratos I–III, Horus I–II and Janus II–III. Sacred weeks are 5, 7, 10, 14, 15,
16 and 17; the documented original seasonal treasury is $100 and costs are
$10/$20/$30. Kratos multiplies points, Horus supplies a floor only for a recorded
game, and Janus imports an eligible earlier finalized base score. An unavailable
Horus declaration spends nothing. Favors affect all-play and Heavenly Battle;
Heptad uses the best legal starting roster from both allies' starting lineups at unchanged
base scores. The other twelve catalog favors are not offered as active effects.

## Geographic conquest and war

The v2 board uses 175 regions generated from Natural Earth's generalized
country geometry via `world-atlas@2.0.2`. Countries are playing regions, not
historical empire boundaries. Source land boundaries determine land routes;
sea routes are game connections. The map supports inspection, search, ownership
filters, zoom/pan and returning to the player's realm. Land area and world
share are approximate spherical measurements of generalized polygons.

Neutral claims and war actions are separate resources:

- Through Week 14, the weekly winner earns two neutral claims and the other
  top-half factions earn one. Last place loses its latest non-homeland territory;
  losses settle before awards. Claims buy connected, unowned land. Human claims
  that can be spent settle before advancing; AI claims resolve automatically.
- After each completed Week 1–16, every faction earns one war action and the
  winner earns two, with a bank cap of three. One action attacks an enemy frontier
  or fortifies owned land. Protected homelands cannot be captured; fortifications
  have three levels. Week 17 ends warfare.

Attack strength is 10 + nonnegative latest weekly points / 10 + 0.5 per finishing
place above last. Adjacent friendly territories add up to three support points.
Defense adds two, plus four per fortification level. Both sides roll a seeded
d20; ties hold for the defender. The preview explains strength and the result
records both rolls, the outcome and ownership change. Result recording is
idempotent, so retries cannot award the same week's resources twice.

## Saves and authenticated friends

Solo saves retain the namespaces `dhq-duat-campaigns-v1` and
`dhq-duat-campaign-v1:<id>`, with versioned campaign payloads. JSON backups under
5 MB are validated before import. Save-index recovery is read-only; failed
writes attempt to restore the previous save and index. Validation checks
structure, not authenticity. Local backups cannot replace authoritative rooms.

Friends require a Dynasty HQ email-account session. The Duat endpoint validates
the app token internally, creates private seeds and accepts action intents,
not client replacement state. Projections hide pending opponent lineups/favors
and unrevealed armies. Friends claim reserved factions with invitation codes
before the draft starts. Human seats must join and ready at gated transitions;
only the current faction drafts its pick. The host starts the draft, reveals
factions and advances weeks.

`20260908160000_duat_campaigns.sql` creates private campaign, membership and
receipt tables; `20260908180000_duat_draft_campaigns.sql` extends the transactional
contracts for v2 while retaining v1. `20260908210000_duat_campaign_settings.sql`
extends these contracts for variable league sizes and protects settings, scoring
and seasons from replacement. Service-role transactions recheck membership,
readiness, ownership and expected revision, then deduplicate by actor and intent.
Browser roles cannot read private rows or call mutation functions.
`verify_jwt = false` permits custom app-token validation; it does not make the
endpoint anonymous. There is no background season scheduler.

## Build, test and release

```sh
npm run test:duat
npm run test:login-auth
npm run test:core
npm run test:timeleague
node scripts/build-duat-server.cjs
npm run build:preview
```

The Duat suite includes draft, world, combat, source-data, favors, save recovery,
browser module initialization and offline multiplayer tests with the actual
Edge handler and PostgreSQL-compatible transactions. Offline tests do not prove
live multi-account availability.

To refresh statistics explicitly, run
`python3 scripts/build-duat-data.py --cache-dir work/duat-cache`.
To regenerate world geometry, run `node scripts/build-duat-world.cjs`; it needs
`world-atlas`, `topojson-client` and `d3-geo`, optionally supplied through
`--source-dir=/path/to/node_modules`. Generated `world.js` is vendored, so
normal preview/server builds need no external source checkout.

The server builder produces ignored `supabase/functions/duat/runtime.js`,
bundling the same engine, world and compressed historical data; each room loads
its selected years. The frontend workflow packages the data, country-map resource
and five WebP assets, verifies their presence, and includes Duat assets in
release hashes. The function workflow builds both game runtimes before Deno
checks, applies and verifies both allowlisted Duat migrations, and deploys the
endpoint only from canonical `C2-Football/WarRoom`.

Frontend publication, migration application, endpoint deployment and live
account testing are separate release checks. A successful local preview or
offline test establishes none of those by itself.
