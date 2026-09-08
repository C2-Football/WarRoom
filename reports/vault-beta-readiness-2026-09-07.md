# The Vault beta pass — September 7, 2026

The Position Roulette reveal now uses compact position tiles and one top-three scouting list. Consecutive years appear as ranges, with gaps preserved. Reveals appear immediately with a brief fade; reduced-motion preferences turn that off. Players and draft actions stay hidden until the reveals are finished and the user enters the draft. The draft clock starts separately. After entry, era scouting collapses behind “Your eras.”

## Twelve personalities

The Warlord, Archivist, Gambler and Steward are joined by the Broker, Scout, Tactician, Grinder, Showman, Contrarian, Alchemist and Sentinel. They differ in draft preferences, risk, positional needs, waiver spending, trade decisions and contextual messages. Trade initiative rotates across the field instead of favoring the first seats. Existing leagues retain explicitly saved personalities; newly created teams use the expanded defaults. A 12-team solo league contains the player and 11 AI opponents; all 12 personality types can be selected in setup.

Setup now shows one optional personality profile at a time. Phone manager controls wrap into two usable rows. Failed creation preserves settings and allows retry; repeated taps cannot create duplicate rooms. The Vault roster editor excludes taxi, IR and individual defensive positions while retaining Superflex.

## Reliability and validation

- The full Vault suite passed, including reveals, draft clocks and formats, roster moves, claims, trades, messaging, profiles, identity isolation and postseason behavior.
- A real historical-data lifecycle completed 156 draft picks in a 12-team league, followed by 12 regular-season games, semifinals and the championship. All four weekly gates and 92 authoritative actions survived serialization and reload. Quarter playback reproduced the saved scores exactly.
- Failure tests cover offline startup, download retry, reconnection, storage quota failures, prior-save preservation and draft-clock recovery. Friends-league tests cover stale versions, authenticated ownership, account changes and interrupted reads/writes.
- Core tests passed: 114/114. Changed source passed ESLint and whitespace checks. Production compilation and the multiplayer runtime type check passed.

Archive downloads can recover after failure. Game day waits for required era scoring data. A failed save no longer silently advances the game: the prior save remains intact and recovery is explicit.

## Hands-on beta checks

Automated component and server tests are not a two-device play session. Before expanding the beta group, play one friends draft with two signed-in accounts, reconnect one device during bidding, and complete a weekly advance vote. On a phone, check the reveal, career scout, manager editor and roster changes with the actual keyboard and touch controls. These visual and device checks remain user-owned.

Gamecast quarters reconstruct historical totals; they are not original play-by-play. The historical archive does not provide the metadata needed to identify a separate overtime period reliably.
