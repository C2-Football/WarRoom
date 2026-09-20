# Account settings password journey

Status: **HIGH, reproduced and fixed locally; independent review clear; hosted deployment pending**. Isolated branch
`codex/readiness-account-settings-20260918`, based on `d5cf58d`.

An ordinary email-account user opens Account, chooses Change password, enters the
current password and a valid new password, then submits. The actual settings
callback invokes canonical `OD.updatePassword`, which calls the legacy/admin
`set-password` endpoint. That endpoint correctly rejects ordinary app accounts
with HTTP 403; Settings replaces the explanation with “Failed to update password.”
Without a connected Sleeper username it can fail validation even earlier.

The isolated reproduction executes the actual Settings callback, canonical shared
client helper and TypeScript endpoint with a controlled app-session identity. It
confirms HTTP 403, generic failure, and no database/local password write. Evidence:
`evidence/password-settings-baseline.log`. This is not a hosted password mutation.

Intended behavior: app-account password changes verify the current password at the
server, use the authenticated account identity, commit the new password and session
revocation atomically, invalidate old reset links, preserve unrelated accounts and
game data, and offer honest retry/reauthentication. Legacy and OAuth accounts must
follow their own supported credential paths. No administrator provisioning or
client-side password-hash access may be used as a substitute.

This is independent of the first candidate's reset-link fixes. The settings defect
remains a full account-journey launch blocker while that repair batch is released.


## Implemented behavior and evidence

New `fw-change-password` verifies the active app session and current password, then calls a service-only SQL function that locks the account, compares the verified hash/version, rotates password and session version, and consumes all outstanding reset links in one transaction. A caller-supplied identity is ignored. Provider-only OAuth sentinel accounts receive provider guidance; email accounts that also use OAuth retain normal password capability.

Settings uses an explicit credential helper, retains fields after failures, prevents repeated submissions, bounds requests at15seconds and requires an explicit successful acknowledgement before local sign-out. Legacy users verify their current password through the server before invoking the existing legacy endpoint. Legacy JWT revocation remains outside this app-account change and is not claimed. Delayed callbacks cannot sign out or overwrite another account. No client-readable password hash is used. Sign-out preserves recoverable game saves and opens sign-in with a persistent confirmation.

Actual endpoint + real PGlite SQL and client/callback tests: `tests/account-password.cjs`, `evidence/account-password-regression.log`. Covers wrong/current/new password, account isolation, old-session and sibling-reset rejection, rollback, retry, competing requests with one winner, service-only grants, malformed/rate/method guards, OAuth sentinel, legacy reauthentication, uncertain acknowledgement/network/timeout, account switching and duplicate clicks. PGlite serializes connections; independent hosted contention remains required. Existing RLS session-revocation regression is part of full security suite; full security passes in `evidence/account-password-security.log`.

`npx deno check` passed for the new endpoint using Deno2.9.6/TypeScript6.0.3 (`evidence/account-password-deno.log`). Compiled preview build passes.

Actual Chrome journeys at320x740,390x844 and844x390: hub Account entry → actual password inputs → incorrect password keeps fields → retry shows disabled Updating → successful local API fixture acknowledgement → session removed → sign-in confirmation rendered. Existing offline save remains. All external mutations blocked, none leaked. `tests/account-password-browser-qa.cjs`, `evidence/account-password-browser.log` and `password-changed-*.png`. Browser testing caught a real local-preview destination-prefix error; sign-out now resolves the root login/landing route correctly, while production relative paths and allowlisting remain intact. Images/fonts are deliberately blocked by isolated browser harness, so screenshot missing logo is not a verified production asset failure.

No new password migration, function or client has been deployed. The additive migration is included in the normal workflow allowlist and function in its explicit deployment/config list. **Do not run full backend workflow until the newer independently deployed hosted signup/OAuth/entitlement source is reconciled.** That operational drift is tracked in the integration checkpoint. No real account/password/email was mutated by local tests.

Independent reviewer reran the actual SQL/handler/client/Settings and account-session suites and inspected final source with no material finding. Review report is queued in integration as `account-password-independent-review.md` from81bf1e3. Password browser test starts/stops its own isolated preview server and is registered in the required browser gate.
