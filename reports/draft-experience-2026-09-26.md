# Vault and Duat draft experience

Local implementation on `codex/vault-duat-desktop-20260926`, following the browser,
scouting and friends-access work. Nothing was deployed during this task.

## Adapted from Dynasty HQ

The live/mock board in `js/draft/command-center.js` and `js/draft/big-board.js`
provided the interaction pattern: stable ranks, column sorting, search, position
filters, an available-first board, queue filtering, result counts, player-card
entry and explicit draft actions. The shared `App.GameDraftTable` implements
those interactions using each game's own data and actions. It does not load
current NFL/provider records, account data or trade tools.

The desktop table has sortable headers and an independently scrolling body.
Phone layouts retain search, position and sort controls, with labeled player
rows and separate queue/draft buttons. Missing metrics sort last in either
direction; zero and negative observations remain actual values. Filters retain
original board ranks, and clearing filters or changing the army/era recovers
the appropriate player list.

## Vault

- Columns include eligible years, reference archive PPG and peak eligible-season
  points. These are labeled archive comparisons, not predictions for the drawn
  season. Search, position/FLEX/Superflex, queue and drafted-player filters work
  together.
- Clicking a player opens the career card with eligible season statistics.
  Drafted players remain inspectable, with pick/queue actions disabled.
- Existing queue persistence, roster needs, opponent context, recent picks and
  draft-board views remain. The desktop sidebar keeps the roster, player-card
  shortcut and queue beside the table.
- Snake/linear Draft and auction Nominate use the existing clock, seat,
  eligibility and online authority checks. Position Roulette and partial
  archive reveals still constrain the pool and player card.

## Duat

- A full draft workspace replaces the flat pick list: sortable player board,
  player cards, saved army-specific queue, on-clock/next-pick context, roster
  needs, position counts, recent picks and all-picks history.
- Historical cards show estimates and prior seasons only. The scoring season
  and future seasons remain sealed. Mystery cards use the existing public
  candidate-year explorer at `throughWeek=0`.
- Queues store only player IDs, scoped to campaign, dynasty cycle, faction and
  army. Queuing does not make a pick.
- Online off-turn player pools remain absent, and rival recruits remain sealed
  in both recent picks and full history. Hosts' waiting/readiness controls and
  the existing draft engine are preserved.

## Verification

The shared board passed 11 source-real interaction/data suites, including
sorting directions, missing/zero values, combined filters, ranks, pagination,
keyboard controls and separation of card/queue/pick actions. Independent review
found no blocking privacy or pick-authority regression in either adapter.

Vault's complete test chain passed. Browser checks covered filtering, sorting,
queue persistence after reload, card opening and keyboard focus return, a real
local draft pick, drafted-player inspection and auction nomination at desktop
and phone widths. The complete table/card/queue/pick journey also passed in the
compiled preview at 1440px and 390px. At 1024px the table remains 778px wide with
all actions visible and supporting panels below. No uncaught page errors or
horizontal page/card overflow were observed. Browser artifacts are under
`output/playwright/draft-port/`.

The complete default `npm run test:duat` command passed all 415 tests after the
existing inline-draft tests were updated to exercise the new adapter and card.
Duat's real local solo browser journey covered combined search/position/decade
filters, metric sorting, queue reload, candidate-season game logs, Escape/focus
return, drafting and roster update, and queue cleanup. It passed at 1440, 667,
390 and 320px with no horizontal page overflow or uncaught page errors. Own picks
remain readable in the full history while rival recruits stay sealed.
Historical and mystery drafts were both exercised. Phone pagination settles at
20 rows and returns to 40 on desktop; historical card columns fit at 390px.
The final checks also cover immediate Escape/focus return and prevent off-turn
queue counts from disclosing a rival's private pick in a full local campaign.

ESLint, design-token contracts and whitespace checks passed. The preview build
compiled 151 Babel scripts; the production-asset build compiled 152 JSX scripts
and minified 267 modules. Neither build publishes the site. The shared board
test suite is registered in the normal runner and frontend CI validation.

These are local source/fixture checks, not a hosted release, authenticated live
multiplayer test, or physical-device test. Outbound game mutations are blocked
in browser fixtures. The engine and server projection rules are unchanged.
