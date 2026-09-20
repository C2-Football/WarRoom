# Legacy account and provider reconciliation — 2026-09-20

Status: **reconciled and verified locally; independent integration review and deployment pending**. Branch `codex/readiness-legacy-proxy-reconcile-20260920`, base `4642e3e`. No real account, provider league, credential, hosted source or deployment was changed by this lane.

## Source inventory

Compared tested repository source with the downloaded hosted function bundles under `/tmp/readiness-hosted-inventory-20260920`, current native/backend repository `aa13193` at `/Users/jacobc/Projects/warroom-current-native-source`, and current public repository `db1701f` at `/Users/jacobc/Projects/warroom-current-public-source`. Exact file digests are in [legacy-proxy-source-fingerprints.json](evidence/legacy-proxy-source-fingerprints.json).

| Function | Observed relationship | Reconciled behavior |
| --- | --- | --- |
| `set-password` | Current native source equals hosted source; both lack the tested repository's administrator/type/atomic-write guards. | Retain the repository implementation, including administrator-only gifted provisioning, service-only compare/update RPC, exact-hash legacy self-update and POST/input checks. No newer functional addition was found to port. |
| `get-session-token` | Current native, hosted and pre-change repository source are identical. | Preserve behavior and fix the independently reproduced legacy hash-upgrade race below. |
| `yahoo-proxy` | Hosted-only in the two current source snapshots; hosted implementation adds durable owner limiting but lacks repository browser-bound OAuth state, session-version and truthful save-failure handling. | Retain all repository protections and add the deployed 120/minute owner API budget. |
| `espn-proxy` | Hosted-only in the two current source snapshots; deployed change replaces instance-local counters with durable IP limiting. | Preserve that 60/minute shared budget and existing cookie/read path. |
| `mfl-proxy` | Current native equals hosted source; differences are mostly formatting plus null-body handling and actionable404 guidance. | Port those functional improvements while retaining repository URL/shard checks and rate-limit retry headers. |

The public snapshot has no `supabase/functions` tree. Yahoo/ESPN restoration therefore requires the separately reconciled function files; absence from that snapshot is not proof that those supported connections are optional.

## New substantive defect

Severity: high. A legacy SHA-256 password sign-in verifies the old password, awaits bcrypt hashing, then previously updated by username alone. A concurrent password change during that await was overwritten with the old password's upgraded hash, and a token was issued for the stale attempt.

The actual pre-change handler reproduces the failure with a controlled in-memory account race: it returns200 where stale continuation must return401 ([before evidence](evidence/legacy-password-upgrade-before.log)). The fix compares the exact verified hash in the database update and requires an updated row before issuing a token. The same production-handler regression now passes both an ordinary successful upgrade and the concurrent-new-password case, preserving the new password and issuing no stale token ([after evidence](evidence/legacy-password-upgrade-after.log)). No real credentials were used. This does not claim general revocation of existing legacy JWTs.

## Durable limiter decision

The downloaded proxy helper relies on a separate `check_rate_limit` RPC and falls back to fresh instance-local allowance after storage failures. The reconciliation uses the already versioned, atomic, service-only `consume_auth_rate_limit` primitive through the existing secured helper. It preserves the deployed owner/IP limits and Retry-After/CORS contract while keeping the repository's fail-closed rule for provider calls. No new table or migration is introduced, and no storage failure silently resets the allowance across Edge instances. The `provider-proxy` scope separates these counts from authentication attempts.

## Verification and release boundary

- `npm run test:security`: passed, including the new actual proxy/legacy handler regressions, existing gift-provisioning/Yahoo state security tests, real PGlite atomic rate accounting and grants/RLS, account isolation/password/reset suites, and operational CORS/reset reconciliation. [Security log](evidence/proxy-reconcile-security.log). Initial fresh-worktree execution stopped at the absent ignored shared mirror; the pinned shared sync restored the required test dependency and the full rerun passed.
- Deno checks passed for all five endpoints and the new shared limiter: [Deno log](evidence/proxy-reconcile-deno.log).
- New proxy tests use separate module instances sharing a controlled database counter; 61 ESPN requests produce exactly60 provider reads, Yahoo denies over-budget/revoked callers before token/provider access, and malformed/foreign MFL input stays rejected. Storage/config failures return429 with retry guidance. These fixtures do not send provider traffic or prove hosted concurrency.
- `git diff --check`: passed. No guard, assertion or supported route was removed to obtain a pass.

Root must review/integrate this batch with the auth/entitlement reconciliation owned by the security agent. The secured baseline's `20260909000000_security_audit_fixes.sql` and active-session migrations are prerequisites for gift provisioning, Yahoo states and atomic limits; confirm hosted compatibility before any scoped deployment. A standalone cherry-pick onto the older native source does **not** carry the unchanged baseline `set-password` and Yahoo protections or their migrations: prepare the complete reviewed upstream delta. Preserve current source provenance and do not overwrite unrelated hosted functions.

After deployment, root should re-download/hash the exact functions and verify controlled authentication and read-only provider/error paths on the actual supported frontends. Current native/public repository write access is root's external integration dependency. This record is not a deployment, native package or public-launch completion claim.
