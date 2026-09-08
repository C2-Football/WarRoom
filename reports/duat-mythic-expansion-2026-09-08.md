# The Duat mythic expansion — v2

September 8, 2026

This expansion adds a playable historical draft and a larger territorial game
to the Duat in Dynasty HQ, with the user-selected painterly mythic strategy art
direction. New campaigns use v2. Existing v1 saves and rooms retain their original
automatic armies, 47-territory board and neutral-claim rules. The
[foundation report](duat-game-foundation-2026-09-08.md) remains the record of v1.

## What players can do

Choose a historical faction from 28 available choices, with fourteen active in
each campaign, and select four historical years. Draft four eight-player armies
in four snake drafts: 32 picks for a human faction, 448 across the campaign.
Each army must support one QB and four RB/WR/TE starters, with three on the bench.
Solo rivals draft automatically. Friends claim individual seats before the
host starts; each player controls their own picks.

An archaeology sequence uncovers fourteen factions one by one. A seeded d20
selects each faction's walking ruler from its four years using the original
five-number bands. Opponent armies stay hidden until their reveal. The campaign
then plays the original seventeen-week structure: fourteen weeks of all-play,
seven Heptad alliances and the seven-seed Heavenly Battle through Week 17,
including the Camel. Results support one-, three- and five-minute replay with
pause and quarter controls.

Explore 175 country regions, inspect ownership, search the map, filter realms,
zoom and pan, and compare approximate land area and world share. Geography comes
from [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) through
[world-atlas 2.0.2](https://github.com/topojson/world-atlas). Modern geographic
regions are used as a timeless game board; they do not depict historical empire
borders. Source boundary arcs define land routes, and explicit game connections
define sea routes.

The new artwork supplies a temple war room, an excavation scene and portraits
of Horus, Kratos as the ancient Greek personification of strength, and Janus.
Bronze, fire, obsidian, lapis and turquoise carry through the game. Five optimized
WebP files total approximately 1.34 MB. Their exact generation prompts, hashes,
dimensions and provenance are retained in `images/duat/manifest.json`.
Country boundaries remain source geometry rather than generated artwork.

## Neutral land and enemy territory

Neutral claims preserve the original scoring rewards through Week 14: two for
the weekly winner, one for the other top-half factions, and loss of the latest
non-homeland territory for last place. Losses settle before rewards. Claims
purchase connected unowned land; available human claims resolve before advancing.

War uses a separate bank. Every faction earns one action after each completed
Week 1–16; the winner earns two. Up to three actions can be banked. An action
attacks an enemy frontier or fortifies owned territory. Homelands remain
protected, fortification stops at level three, and warfare ends after Week 17.

Battle previews show the latest football score, rank, friendly support and
defensive bonuses. Strength is 10 + nonnegative weekly points / 10 + 0.5 per
place above last, with up to three adjacent support points. Defense adds two
plus four per fortification level. Each side rolls a seeded d20; ties favor the
defender. The visible outcome records the rolls and whether territory changed
hands. Weekly rewards and action receipts reject duplicate application.

## Preserved historical and account contracts

The archive contains 127,055 weekly records and 3,271 distinct player identities
across NFL regular-season calendar Weeks 1–17 in 2002–2025. NFL postseason and
Week 18 are excluded. Source-year coverage, hashes, total fumbles lost, all three
conversion types and identity aliases are validated. Earlier source auditing
reconciled every transformed row against the cached releases with zero mismatches.

AI draft estimates and lineup choices use prior seasons, position baselines and
completed campaign weeks. They do not inspect unrevealed current or future
results. Historical results themselves remain public source data.

The pantheon exposes seven working scoring favors from the original nineteen:
Kratos I–III, Horus I–II and Janus II–III, illustrated by the three god portraits.
The original $100 seasonal treasury, $10/$20/$30 costs and sacred Weeks
5, 7, 10, 14, 15, 16 and 17 remain. Horus requires an actual recorded game and
spends nothing if unavailable. Janus uses an eligible finalized past base score.
Heptad excludes favor effects and bench players.

Solo saves persist locally and support validated JSON backup export/import.
Friends use Dynasty HQ email accounts, reserved seats and private invitation
codes. The server retains the seed, hides pending opponent choices, validates
turns and host/readiness gates, and commits actions with revision checks and
duplicate protection. Local backups cannot replace server campaign state.

The v2 migration extends the existing Duat transaction functions for drafting,
individual reveals, attacks and fortification while retaining v1 behavior.
Duat storage, endpoint and tables remain separate from the Vault.

## Verification recorded for this expansion

| Check | Result |
| --- | --- |
| Full Duat suite | 114/114 passed |
| Core suite | 114 passed |
| Full Vault suite | All 46 command stages passed, including sealed-state database and draft-order integration |
| Login restoration contracts | 16 passed, including scoped Vault/Duat account restoration |
| Final module-loading suite | 6/6 passed after the battle outcome presentation change |
| Changed JavaScript/CJS/TypeScript lint | 16 files checked, zero errors or warnings; TypeScript syntax also parsed |
| Browser campaign | All 448 draft picks, including 32 human picks; all fourteen individual reveals |
| Browser season | Completed all seventeen weeks; 81 battles, including human attacks in fourteen weeks; persisted state validated |
| Responsive browser review | Desktop and 390-pixel views, including gods and Heptad, without page overflow |

Module tests execute the actual browser dependencies, enforce their order and
exercise a failed world load followed by retry. Offline multiplayer tests use
the actual Edge handler and PostgreSQL-compatible transactions. These checks
cover behavior and integration locally; they do not substitute for live
two-account verification or prove independent connection load behavior.

## Release boundary

At this report's checkpoint, the backend has deployed. GitHub Pages publication
and live acceptance are pending, so this report does not claim the expansion
is available to players. Final production evidence is tracked separately.

The frontend workflow packages the three historical-data artifacts, map resource
and five WebP assets, and records Duat asset hashes. The backend workflow builds
the generated runtime before Deno checks, applies and verifies both Duat
migrations, and deploys only from the canonical repository. Generated runtime
files remain ignored. Release completion still requires confirmation of the
published frontend assets and live authenticated campaign behavior.

The scope remains historical campaigns, seven supported scoring favors and
one seventeen-week season per save. Friend games use host advancement and ready
checks. The v2 snake draft adds army selection; it does not introduce the Vault's
waiver or trade systems.
