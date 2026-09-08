# The Duat historical beta in Dynasty HQ

September 8, 2026

The Duat is implemented as a second Dynasty HQ game beside the Vault. Historical
scoring follows the user's choice: each resurrected ruler plays the actual NFL
weeks from that army's own season. The game has solo campaigns against thirteen
AI factions and private campaigns with friends.

## Playable loop

Choose a faction and four consecutive ruler years from 2002–2025. Inspect the
four eight-player armies; a d20 selects the ruler for the campaign. Set one QB
and four flex starters, declare an eligible favor, and play the week. Results
resolve all-play standings, alliance best ball and territorial conquest. Weeks
15–17 settle the seven-seed Heavenly Battle and the Camel, crowning the Lord of
the Duat. Completed weeks can replay at one-, three- or five-minute pace.

The original fourteen factions, 47 territories, 79 routes, four-army allocation,
d20 bands, sacred weeks, Heptad and Heavenly Battle are preserved. The map uses
real Natural Earth geography. Seven scoring favors are executable: Kratos I–III,
Horus I–II and Janus II–III. The other twelve descriptions remain in the catalog
and are not offered as working effects. Each faction starts with $100 in favors.

## Reuse and separation

The game reuses Dynasty HQ accounts and Games entry, the Vault's historical
player/statistic primitives and gamecast, and its tested online patterns. Duat
campaign rules, saves, database tables and endpoint are separate. No historical
league records or invented rival scores enter a new campaign.

The Duat has its own verified archive because the Vault's bundled file stops at
Week 14. It contains 127,055 weekly records across 24 complete seasons, with
3,271 distinct player identities. Every season covers NFL regular-season weeks
1–17. Week 18 and NFL postseason games are excluded. Same-name players are
separated, and missing player records score zero without claiming a bye/injury.
Source hashes and attribution are recorded in the manifest. All rows were
reconciled against the source releases. AI estimates and lineup decisions use
only earlier seasons and completed campaign weeks.

Solo saves persist after every move, recover from a damaged shelf, and support
backup export/import. Friends use private invitation links and individual email
accounts. The host advances only after all humans join and mark ready. The server
validates actions, hides pending opponent choices, rejects stale changes, and
atomically saves results. Human territory choices settle before AI claims.

## Validation and release

The Duat rules, campaign, archive, favors, saves, account restoration, module-load
recovery, transaction and endpoint tests pass. Actual browser play completed all
17 weeks, changed starters, spent a favor, replayed results, resumed after reload,
and displayed the final tournaments on a 390-pixel screen without page overflow.
Independent replay verification matched all 238 faction totals across 17 weeks.
The existing core and Vault suites passed before the final release integration.

The new migration and Duat function have deployment wiring with explicit archive
packaging checks. Release evidence, including the final frontend revision and
live two-account campaign verification, is recorded separately after publishing.

A pre-existing security-contract check reports missing declarative JWT pins for
league-cup and time-league; their deployment commands already disable gateway JWT
verification. Duat has the correct pin. This beta does not change those unrelated
functions or claim that the old configuration check passes.

## First beta limits

Historical campaigns only; seven supported scoring favors; one 17-week campaign
per save; original eight-player armies without the Vault's draft/waiver/trade
systems. Private friends campaigns use ready checks and host advancement. Local
solo games need an exported backup to move devices. Historical results are public
source data, so knowing past NFL results is part of the historical format.
