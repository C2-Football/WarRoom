# Account deletion: verified outcomes and recoverable failures

Branch `codex/readiness-account-deletion-20260920`, baseline `f2f3d819f52aeabf6009c7e98b88069fc17975cd`. This is a local candidate; no hosted account, Auth identity, payment subscription or user data was mutated. No deployment occurred.

## Reproduced failures

Actual current-native handlers at `aa13193b28c552f977fa36a4683bb3a688d3da4f` failed nine controlled regression groups: Stripe HTTP failure still returned deletion success; subscription lookup failure and missing Stripe configuration did the same; self-deletion passed an app UUID to Auth deletion instead of the distinct Auth UUID; admin deletion inspected only the first 1,000 Auth users; resolved `{error}` from Auth deletion was counted as success; failed account lookup became an orphan identity sweep; failed target-role lookup allowed deletion; a legacy Stripe subscription with null `store` bypassed paid confirmation. [Original failure log](evidence/account-deletion-before.log).

## Candidate behavior

- A shared deletion coordinator inventories public subscriptions and independent provider source rows before irreversible work. Every distinct Stripe source is checked, including a source hidden by the displayed RevenueCat subscription. Missing configuration or a failed read prevents deletion.
- Stripe cancellation requires a successful response with the exact subscription ID and a terminal status. Retry reads current provider state first. Completed or uncertain partial steps are explained in errors; their linkage remains on the preserved app account. [Stripe cancellation response contract](https://docs.stripe.com/api/subscriptions/cancel).
- Auth inventory is collected across pages before removal; errors or bounded inventory exhaustion prevent mutation. The coordinator verifies each exact Auth ID still has the target email, checks each returned deletion result, verifies absence, and refuses a detected reappearing identity. It never assumes app and Auth UUIDs match. [Supabase paginated inventory](https://supabase.com/docs/reference/javascript/auth-admin-listusers), [Auth deletion](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser).
- Self-service still requires explicit confirmation and a current app session. Admin access retains confirmed OAuth compatibility and protected-account rules. Caller and target versions, roles and exact target UUID are rechecked. Database inventory changes cause a retry rather than erasing new state.
- The final app-row deletion runs in a service-only transaction with deterministic account locks and an exact current snapshot comparison. Billing application already locks the same account row. A replacement account under the same email is preserved.
- Store-managed subscriptions are explicitly reported separately. Account deletion does not claim to cancel Apple or Google subscriptions or change store policies.

## Actual current-client patches

Current public/native sources are different from the C2 checkout. They remain untouched. Three reviewable patches target the exact snapshots: native `aa13193`, public `db1701f`, and shared `dedbb1614f08459905eef27d0f0b7bce27cd4e15`.

- [Shared](patches/current-shared-account-deletion.patch): require explicit `ok:true`; reject a changed session before sending an expected-token request or accepting its response.
- [Native](patches/current-native-account-deletion.patch) and [public](patches/current-public-account-deletion.patch): preserve current account/session on failure or a late response for another account, explain store subscription management, and restrict the admin's forced confirmation retry to `paying_customer` rather than every HTTP 409.
- [Source/candidate fingerprints](patches/account-deletion-client-fingerprints.json). `git apply --check` passed for all three patches against the unchanged snapshots. Generator: `python3 scripts/prepare-account-deletion-client-patches.py`; it writes only this worktree's patch artifacts and ignored temporary candidates.

The existing actual shared helper already retained sessions on non-2xx errors; the patch also protects malformed 2xx and account switching. These are prepared upstream changes, not published assets or native-build evidence.

## Verification

- `node tests/account-deletion-recovery.cjs`: 15 actual handler/coordinator groups pass, including original failures, hidden provider source, partial cancellation retry, Auth cleanup retry, session change before mutation, Auth recreation, and an uncertain final response that cannot erase a replacement account.
- `node tests/account-deletion-sql.cjs`: five actual PostgreSQL/PGlite groups pass for replay/grants, self/admin authorization, role/version changes, full source inventory changes, UUID replacement, and exact target cascade with unrelated saves preserved. Independent database connection contention is not exercised by PGlite.
- `node tests/account-deletion-current-clients.cjs`: actual extracted functions from both prepared current frontend candidates and shared candidate pass failure, malformed success, late-account-response, store notice, and paid-confirmation retry checks. [Client evidence](evidence/account-deletion-current-clients.log). This is executable source evidence, not a real-browser or store build claim.
- Full `npm run test:security` passed after syncing the canonical shared mirror. [Log](evidence/account-deletion-security.log). Both new backend suites are included in that command.
- Deno checked both handlers and the shared coordinator. [Log](evidence/account-deletion-deno.log).

## Release dependencies and limits

1. Integrate the separately reviewed billing source migration `20260920010000_billing_event_recovery.sql` before `20260920040000_account_deletion_recovery.sql`. The new source inventory deliberately fails closed if that schema is absent. Do not omit hidden billing sources as a compatibility fallback.
2. Preserve the established native `20260919000000_account_delete_cascades.sql` behavior and verify hosted constraints/triggers before any real deletion QA. It preserves shared rooms with remaining members and sweeps rooms with no members. The local fixture verifies exact account isolation, not every hosted cascade or room rule.
3. Apply the prepared shared/public/native client patches through their actual repositories and canonical shared pin process. Source access is currently read-only for those repositories; no upstream PR, merge, or release is claimed here. Deploy backend migration before these handler versions; the normal C2 workflow/config entries are prepared, not run.
4. Independent review of this candidate is pending with the security owner. Run post-integration security/billing checks and strictly scoped disposable-account browser/deletion checks only after review and the root's access/isolation gates.
5. Auth, Stripe and the app database cannot be one atomic transaction. The code detects session/state changes and observed Auth recreation, but a new Auth identity could appear after the final Auth scan. A lost final database response can leave deletion completed while the client sees uncertainty; the candidate reports uncertainty and the old identity cannot delete a replacement. Durable completion receipts or a provider-wide deletion lifecycle would be a separate design, not a claim made by this batch.

Next executable step: independent review, resolve findings, then integrate billing/auth prerequisites and prepare actual-source upstream release. This candidate does not declare account deletion or the suite publicly ready.
