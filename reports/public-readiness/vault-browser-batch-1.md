# Vault browser journey and invitation recovery

Baseline: `5835b11`; isolated branch `codex/readiness-vault-browser-20260918`.
UI: compiled `dist-preview` served at `http://localhost:3001` in real headless
Google Chrome. Backend: existing hosted `sxshiqyxhhifvtfqawbq` services. This is
local responsive-browser UI plus hosted API evidence, not deployed frontend,
physical-device, native-install or store-distribution evidence.

## Isolation

Two disposable accounts were verified before use by exact IDs:
`9159bd98-98e2-49fb-8741-d4cd513bfcb4` and
`c5fbdc81-d5ac-4118-8547-ed27b28e822b`. Credentials remain only in an existing
mode-0600 private file, never in this report or tracked scripts. Both signed in
through the actual email/password form in separate browser contexts; the app and
remote client retained each expected account ID. Local preview's development
banner describes unlocked local features; it does not replace these verified
hosted app-account identities.

The original completed room `9abe0f2c-7f52-4035-984a-606a0b121142` was read-only.
A browser request guard rejected every Vault mutation outside the new explicitly
named room, and excluded non-Vault provider, billing, analytics and messaging writes. The
new room was created through UI as
`readiness-20260918-99b2f837-2a00-4a2d-b337-a17ce0164755 Browser Vault`, ID
`e6563c66-2713-4ded-8b1b-c3373261ca41`. New-room private invitation metadata stays
in an untracked mode-0600 file. No original Vault or Duat room was mutated.

## Reproduced issue and fix

**Medium: invitation reload loses the game destination.** An authenticated member
opened a seat invitation, joined, drafted and viewed the saved roster. Reloading
then returned to the hub. Re-entering Vault recovered the room, so saved data was
not lost. Root cause: `js/app.js` removed `tl_invite` without retaining a Vault
route parameter; generated invite links also omitted `vault=1`.

The consume hook now retains `vault=1` while removing the private invite code.
Generated seat links also include the destination. Actual browser verification
reopened the original legacy invitation URL, confirmed the private code was gone
and `vault=1` remained, then reloaded directly into the correct new room.
`tests/time-league-invites.js` executes the production consume hook and initial
mode expression for both old/new invitation URLs, verifies pending-code storage,
removal from the address bar and preservation of unrelated query parameters.

## Verification completed

- Both accounts reopened the preserved hosted champion room at version 22.
- Rerunnable read-only smoke passed independently for both accounts at 390×844,
  320×740 and 844×390: real UI sign-in, exact identity, room shelf entry, no page
  overflow, reachable league options, full reload, repeated hosted complete-state
  loads at unchanged version 22. See `evidence/vault-readonly-smoke-local.json`
  and `evidence/vault-readonly-smoke-member-local.json`.
- New two-human room: UI creation, distinct seat-invite join, host-only room start,
  independent sealed QB-era reveals, both human draft picks. The member's320px
  draft action was44px tall and successfully clicked. Hidden years remained
  hidden in the draft/season UI.
- Setup used supported UI choices: manual order, clock off, QB1 only, no bench,
  two-team championship. The UI enforces 14 total gameweeks, so the original
  API-only compact season was not substituted for this browser season.
- Host/member saved rosters and hosted versions agreed after drafting. Member
  offline polling showed saved roster and explicit reconnecting state. After
  reconnect, the room remained usable; the fixed invitation URL reload preserves
  direct game entry.
- Offline host End week failed with a visible connection error and retained the
  saved week recap. Reconnecting and retrying succeeded. A real competing
  background trade refresh produced HTTP409 during Run waivers; the UI truthfully
  said the move was not saved and the explicit retry succeeded.
- Short landscape844×390 week control:44px tall, center hit target resolved to the
  actual button, no horizontal overflow; real game progression continued.
- `node tests/time-league-invites.js`, `node tests/time-league-beta-entry.cjs`,
  `node tests/time-league-remote-recovery.js`, preview build and diff whitespace
  checks passed. Node emitted its known unset localstorage-file warning.

## Durable read-only smoke

`scripts/vault-readonly-browser-smoke.cjs` requires an explicit existing-site base
URL and external private credential path. `--account=0` or`1` selects only the two
verified controlled accounts. It allows sign-in, profile/list reads and loads of
only the preserved completed room; all room writes are denied. It exports only
safe checkpoints, statuses, phases, versions and controlled IDs. It never exports
storage state, full response bodies, invitation links or raw browser errors.

Example after release (credentials supplied separately):

```sh
node scripts/vault-readonly-browser-smoke.cjs --base=https://c2-football.github.io/WarRoom/ --credentials=/absolute/private/accounts.private.json --account=0 --output=/absolute/path/to/sanitized-evidence.json
```

Use `--base=http://localhost:3001/ --preview=true` for the compiled local UI.
Read-only OPTIONS checks showed the currently hosted Vault endpoint accepts both
existing public origins and localhost:3001 but not127.0.0.1:3000; the signin endpoint
accepts all checked origins. Tests use the accepted origin without rewriting CORS.

## Completion and independent review

On September 18, the isolated browser season completed all 14 gameweeks and its
championship. Browser Host A won 20.8–3.4. The member was offline during weeks
11–14, then reconnected to the saved final week and used the real replay controls
to reach the championship. Both accounts fully reloaded the same champion result.
Each manager separately revealed the years; the unrevealed member retained its own
reveal choice after the host's reveal, and each choice survived reload. Both
accounts subsequently loaded `complete`, week15, version101 from the hosted API.
No browser page exceptions occurred.

See `evidence/vault-browser-journey.json`, `evidence/vault-browser-api.json` and
`evidence/vault-browser-champion-320.png`. Repeated polls are deduplicated by
account/room/status/version in the API file; original counts are retained.

Independent security reviewer `security_boundaries` reran the invitation
regression and diff check, inspected actual endpoint semantics and the read-only
allowlist, and found no material issue in this bounded delta. The reviewer did not
access credentials or claim hosted-smoke execution.

## September 20 resumption: current hosted checks blocked

The existing worktree, browser handles and exact room were revalidated without
creating a replacement room. Retained browser sessions were receiving401 with
`Sign in to play with friends.` The game showed saved champion content with
“Reconnecting automatically”; repeated polling continued instead of offering
sign-in recovery. The exact cause of invalidation was not established by this
browser check; **token expiry is not proven**. Root independently reported that
the original tokens had a future expiration and the two controlled account IDs
were absent from its exact hosted record query; that investigation remains
separate from the verified September 18 journey.

Two fresh read-only smoke processes targeting production and sandbox were stopped
on root's instruction before a verified sign-in checkpoint. No deployed
authenticated-smoke pass is claimed. All this agent's browser contexts and smoke
processes are closed, and no password was changed. Root owns the controlled
account/room persistence investigation. No replacement accounts or rooms were
created. The interrupted browser processes had accumulated repeated unauthorized
reads; sanitized counts remain in the API evidence. The401 retry/sign-in recovery
problem is accepted as this agent's next bounded source fix.

## Remaining scope

This batch proves the two-manager snake/QB1 phone season described above, not all
Vault variations. Hosted availability/persistence must be rechecked after the
controlled-record investigation. Fresh auction/FAAB competing-bid UI and private
bid-state checks, alternative roster/draft modes, and deployed invitation-fix smoke
remain unverified by this batch. Existing native/archive distribution restrictions
are unchanged. This is not a Vault launch-readiness declaration.
