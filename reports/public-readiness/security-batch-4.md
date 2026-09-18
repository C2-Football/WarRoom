# Public readiness — direct database session revocation

Date: 2026-09-18. Branch: `codex/readiness-security-20260918`. Follows atomic reset `3744f22`. Local SQL rehearsal only; no hosted mutation/deployment.

## SEC-RESET-05 — High — revoked account JWT retains direct data access

Reproduction: load the actual account/security migrations and actual previous `current_app_user_id` plus account-owner policy installer; create a disposable account with database session version 2; assume the `authenticated` role with its previous token claims at version 1. The old SQL still exposes the account row and private plan row, and accepts a private plan update. The old Edge verifier correctly denies the token, so endpoint checks alone missed this separate PostgREST path. `tests/account-session-rls.cjs` proves this old behavior before applying the repair.

Root cause: raw claim RLS policies and `current_app_user_id()` trust the signed app-user ID without checking its live session version. Incrementing the version during reset does not revoke those policies.

Repair: migration `20260918020000_account_session_rls.sql` makes `current_app_user_id()` verify the claimed ID/version against the live account row. Its restricted definer lookup avoids RLS recursion and returns only the caller's own active ID. Malformed, absent, overflowed and stale versions return null. It never falls back to the OAuth/legacy subject or editable provider metadata.

The same additive migration installs a **restrictive** active-session policy on each existing public RLS table for browser roles (`anon`, `authenticated`). This closes older policies that read raw app-user claims or token subjects. A restrictive policy grants no new row access: each table's existing permissive ownership/read/write policy must also pass. Legacy/OAuth claims without an app-user ID keep their existing access rules. Service-role RLS bypass is unchanged. The transaction changes functions/policies only; it does not rewrite, delete or re-key user rows.

## Actual SQL evidence

`node tests/account-session-rls.cjs` passes:

- Actual prior SQL reproduces revoked-token direct account/private-data read and write.
- New migration applied twice preserves account/password/version rows.
- Revoked callers receive zero account, subscription, product and private-plan rows; update/delete affect zero rows; inserts into private ownership and raw-subject paths fail RLS.
- Current sessions retain their own reads/writes and cannot read/update/insert another owner's private data.
- Bad UUID, missing/zero/text/overflowed session versions fail closed.
- Legacy owner reads/writes still work, OAuth obtains no new access, service role still accesses server data.
- Completing the actual atomic reset RPC invalidates the old direct SQL caller. A fresh version reads retained plans, and the unrelated account stays active.

`npm run test:security` includes the new SQL regression. This uses isolated PGlite roles and actual PostgreSQL-compatible SQL. Hosted PostgREST headers/configuration, deployed policy inventory and production performance require root's release verification.

## Release and recovery

- Added the migration to both deploy workflow allowlists, after the atomic reset migration. Run the established migrations-before-functions workflow.
- Rehearsal above verifies pre-existing data, idempotent retry, active/legacy/service compatibility and reset integration. Existing app JWTs already include session_version; pre-version or revoked JWTs now require reauthentication.
- Verify deployed helper is definer with a fixed search path, has browser-role execution permission, and is owned by the trusted migration owner. Verify public RLS tables have the restrictive policy, `app_users` does not force owner RLS, and a disposable account's old/new tokens behave through actual REST endpoints after reset.
- Future RLS tables should use the version-aware account helper; any new raw-claim policy needs the same active-session gate.
- On a deployment failure, the explicit transaction preserves prior policies. On a compatibility problem after commit, correct the helper/policy without changing account rows, reverting session versions, reopening revoked access, or restoring the old ID-only helper. Keep affected browser operations unavailable rather than reporting false recovery. Server-role operations remain available.
- Independent review and hosted proof must complete before this is reported as verified live. Parent owns release/integration.
