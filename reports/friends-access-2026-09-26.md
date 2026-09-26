# Vault and Duat friends access

Implemented locally on `codex/vault-duat-desktop-20260926`. This follows the
browser layout and scouting changes in `ba98959` and `95f76c9`. No frontend,
database migration, or Edge function was deployed during this task.

## Player-facing changes

- Signed-out Vault invitations open an explicit account/guest entry panel.
  Legacy invite URLs also open Vault. Login preserves Vault and Duat invitations
  in the return URL even when session storage is unavailable.
- Duat returns to friends mode after sign-in. Both clients stop shared actions
  on rejected authentication, offer recovery, and discard stale responses when
  the actor or token changes. Interrupted claim/load requests retain the invite
  and allow retry.
- Hosts still use a free email/password account. Invited friends can enter a
  display name and join without registering, connecting Sleeper, or subscribing.
- Guest seats survive reload and can be restored with a private guest pass.
  Passes expire after 180 days and must be saved before clearing browser data or
  moving devices. There is no automatic account conversion or lost-pass recovery.
- Host player lists show joined names and guest status, alongside the existing
  readiness controls. Each invitation claims one seat. Unclaimed seats lock
  once the draft starts.
- User instructions: [Playing with friends](../docs/friends-access.md).

## Access boundaries and recovery

Guest credentials are opaque 256-bit capabilities accepted only by the two
game endpoints. The database stores their SHA-256 hashes. Each capability is
bound to one game, room and joined member seat; it cannot host, claim another
seat, or authenticate to account/community endpoints. Existing action role
checks and sealed public-state projection still apply. Joined-player labels
expose names and guest status, not emails or credentials.

The service-only SQL claim creates the membership and credential receipt in one
transaction. Token-hash and room locks make retries idempotent without double
claiming seats. A lost response can recover the same seat after play starts.
Invalid claims roll back the internal identity, membership and receipt together.

The browser saves the pending capability before claiming a seat, uses a separate
guest storage namespace, and serializes modifications across tabs with Web Locks.
Browsers without safe persistent storage or Web Locks fail before claiming and
offer the account path. Account sessions take precedence and are never created
or overwritten by guest joining.

## Verification

- Complete `npm run test:timeleague` chain passed, including real archive
  lifecycle journeys, endpoint and sealed-state database checks.
- Complete `npm run test:duat` passed: 415 tests, zero failures.
- `npm run test:game-guests` passed with source-real browser helper tests,
  handler authorization tests and the actual SQL migration running in PGlite.
  Cases include lost responses, concurrent tabs, rollback, expiry/revocation,
  another room/game, forged actors, guest host-action denial, readiness ownership,
  and preservation of full-account authentication.
- Login contracts passed all 32 return-route restoration cases and auth request
  recovery tests. The complete security chain passed; after release-guard
  additions, all 21 release tests and catalog fingerprint regressions passed.
- Deno checked both actual game handlers. Changed JavaScript passed ESLint;
  design-token and whitespace checks passed. Preview and production-asset builds
  completed. Building assets does not deploy them.
- Real browser fixture checks at 390px and 1440px covered guest join, room load,
  reload, and Duat pass restoration after clearing storage. They found no
  horizontal overflow or uncaught page errors. Guest actors had no full account
  token/session, and host draft actions remained unavailable. Both games also
  ran with development mode off through local HTTPS fixture origins. The Vault
  guest-pass disclosure measures about 46px when collapsed, keeping access
  controls available without crowding the game screen.

## Release and hosted verification remaining

Publish migration `20260926010000_game_guest_sessions.sql` before releasing the
two game functions and frontend. Release guards now require the reviewed
migration plus the actual guest table/claim routine; the guest table's RLS,
grants, columns and constraints are included in the schema fingerprint. No
automatic SQL deployment or additional function targets were enabled.

Read-only hosted checks confirmed the relevant functions were active. Two
previously designated test accounts both returned HTTP 401 during sign-in. That
does not establish a general sign-in failure; their credentials no longer
authenticated. No replacement accounts were created, no passwords were reset,
and no hosted game rooms were changed. A current test-account sign-in is needed
to verify hosted host creation, account join, guest join and reconnect after the
release. Local fixtures are not evidence of deployed multiplayer behavior.

Local browser evidence is under `output/playwright/friends-guest/`,
`output/playwright/duat-friends/`, and
`output/playwright/friends-access/live-login-check.jsonl`. The last artifact
contains only sanitized status/identity-match results, not credentials.
