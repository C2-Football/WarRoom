# Vault multiplayer readiness — September 7, 2026

The Vault now supports account-owned online leagues with 2–12 teams, private seat invitations, a shared waiting room, synchronized drafting, individual lineups, waivers, trades, and commissioner-run game weeks.

## Implemented

- Atomic creation of league and seats; first human is the host. Claimed invitations are idempotent for their owner, cannot be stolen, and cannot give one account multiple seats.
- Account-aware team views and controls. Friends see their own queue, roster, home matchup, and gamecast. AI picks and week advancement belong to the commissioner.
- Server-authoritative actions using the existing engine and bundled historical datasets. Clients submit intent, never replacement game state. Compare-and-swap versions reject concurrent overwrites.
- Reusable invitations under Friends & Invites, joined counts, editable team names/helmets, and host-controlled draft start after all friends join.
- Each manager marks their lineup ready before game day. Readiness changes increment the shared version, and ready lineups cannot be edited or traded away.
- Authenticated refresh every three seconds and on reconnect/focus. Failed/conflicting moves leave saved state intact and display a recovery message. Stale responses cannot switch rooms or roll back a newer revision.
- Opponents' draft queues and pending waiver bids remain private. Invite secrets are returned only to the commissioner for unclaimed seats.
- Phone draft grids now contain their table overflow within the card.

## Verification

- 90 Vault tests pass, including ten new multiplayer engine scenarios covering two humans plus AI through a complete season.
- Database transaction tests: create/claim, idempotency, stolen invitations, duplicate seats, direct-write grants, invitation privacy, and readiness versions. Test data rolled back.
- Live authenticated endpoint tests with three isolated QA accounts: outsider denial, claimed-seat protection, start gating, wrong-turn denial, simultaneous saves, private bids, ready locks, and identical historical scores/champion across two players.
- Actual browser controls submitted picks from separate host/friend sessions. The normal Dynasty HQ app restored the right account/team and consumed a real invite link into the waiting room. Desktop and 390px phone views checked.
- ESLint, Deno Edge type checking, preview build, and production build pass.

## Deployment

The additive migration and `time-league` Edge function are deployed to the existing Supabase project. The GitHub deployment workflow rebuilds the Edge runtime from canonical shared engine code and historical data, then deploys it with the migration allowlist. Game logs are bundled by week to stay within Edge memory/compute limits.

The static frontend is published through the existing GitHub Pages workflow. Online sync is a three-second authenticated refresh, not a websocket. Managers must use their own signed-in accounts. The commissioner advances AI draft turns and game days explicitly.
