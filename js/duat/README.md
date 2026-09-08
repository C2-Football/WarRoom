# Duat game foundation

This is the first isolated domain foundation for a Duat game inside Dynasty HQ.
It is not wired to the app menu, a playable UI, a database or an online endpoint.

The source ports the original Duat at `ada801d` into standalone browser/Node
modules. There is no runtime dependency on the original Sites checkout, React,
TypeScript, the Vault's state shape, or a network service. Existing Vault saves
and tables are not used by these modules.

## Modules

| Module | Responsibility |
| --- | --- |
| `rules.js` / `App.DuatRules` | Canonical defaults, faction/world/favor catalogs, Heptad and Heavenly Battle |
| `army-generation.js` / `App.DuatArmies` | Four-army allocation, archived/provider armies, weighted reveal order, d20 bands |
| `conquest.js` / `App.DuatConquest` | Pure campaign homes, atomic weekly conquest results, connected territory claims |
| `session.js` / `App.DuatSession` | Room seats, ownership, readiness, action revisions, deduplication and viewer projection |

Browser loading order: rules, army generation, conquest, session. Node consumers
can require each file directly. Run `npm run test:duat`; the main test runner also
includes the Duat suite.

## Preserved rules

Original Duat: 14 factions; QB1/FLEX4/BN3; four ruler armies with d20 bands
1–5, 6–10, 11–15 and 16–20; all-play weeks 1–14; seven paired Heptad alliances;
the top-seven Heavenly Battle in weeks 15–17, including reseeding and the Camel.
Faction identities and geographic routes are ported; old league records and
example scores are not carried into new campaigns.

Tournament functions take scores from their caller. Missing/invalid scores pause
resolution. The nineteen favor descriptions are a catalog, not executable effects.
The choice of historical versus current-season scoring remains a product decision.

## Conquest contract

`recordWeek(state, {week, results, createdAt})` requires one verified
`{factionId, place, score}` result for every participating faction. Callers determine
all-play ranking and tie policy from the campaign's scoring rules. The function
settles last-place losses before rewards, so delivery order cannot change claims.
It never mutates its input; invalid/incomplete/conflicting results throw without
committing a partial week. Exact repeated results are idempotent.

`claimTerritory(state, {factionId, territoryId, createdAt})` spends one earned
claim on an adjacent, unowned node. Authority belongs in the session/server layer.
Homelands belonging to active factions are protected. Claims are opportunities to
choose available frontier; they are not reservations of particular territories.
Multiplayer claim order still needs to be enforced by the campaign phase adapter.

## Online integration boundaries

`context.actorId` must come from the existing authenticated DHQ account, never
from client JSON. Seat claims require trusted invitation authorization. The
transport must atomically compare and save revisions; this pure module alone does
not prevent two network requests from both writing the same revision.

Only return `projectForViewer(...)` output to a player. Campaign data defaults to
hidden until a game-specific projector is supplied. Private plans, queues, account
IDs and action receipts are not automatically exposed. The injected
`resolveCampaign` adapter must validate plans and execute actual Duat rules; the
session contract does not trust or implement arbitrary requested outcomes.

No API credentials, invitations, scheduler, persistence migration, or production
deployment are included. Favor effects, full campaign completion/continuation,
AI strategy and the score adapter remain to be integrated before a playable beta.
