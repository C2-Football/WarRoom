# Independent account-password batch review — 2026-09-20

Reviewer: native/Vault agent, independent of the implementation owner. Reviewed the uncommitted delta in `/Users/jacobc/Projects/warroom-readiness-account-settings`; no files in that worktree were edited and no hosted request was made.

Disposition: **no unresolved material finding in this bounded change**. This is approval of the inspected source/local regression evidence, not a hosted deployment or whole-suite readiness claim.

Examined the actual Settings callback and credential helper, `fw-change-password`, migration `20260918030000`, shared account sign-out, login confirmation, endpoint deployment/config registration, and new tests. The app-account path uses the signed identity rather than a supplied target; verifies the current password at the server; and locks/rechecks hash and session version before atomically rotating credentials and consuming reset links. The function remains service-only. Migration application uses sorted version order.

The client requires explicit successful acknowledgement, preserves form values on failures, distinguishes uncertain delivery from confirmed success, prevents duplicate in-flight submissions, and compares both credential-storage snapshots before further legacy requests or sign-out. OAuth sentinel rejection preserves the provider-owned password path. The optional sign-out destination is exactly allowlisted and the preview prefix cannot become an arbitrary redirect. The prior saved-game preservation behavior remains in place.

Independently executed `node tests/account-password.cjs`, `node tests/account-session.cjs`, and `git diff --check`: all passed. The new tests exercise the actual endpoint with real PGlite SQL, atomic rollback, one successful competing rotation, stale snapshots, service grants, account isolation, password verification, old-session/reset invalidation, real client error paths and actual extracted Settings callback. Reviewed the implementation owner's three successful actual Chrome fixture journeys at 320×740, 390×844 and 844×390; did not claim those as independently rerun or hosted browser tests.

Remaining release boundaries are correctly recorded by the owner: reconcile newer hosted authentication source before deployment; apply/verify the additive migration before exposing the new function; verify real hosted contention and sign-in with controlled accounts. PGlite serialized connections do not prove hosted concurrent lock behavior. Legacy JWT revocation is unchanged and is not claimed as repaired by this app-account endpoint.
