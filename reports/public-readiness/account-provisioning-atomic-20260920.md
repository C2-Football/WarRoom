# Atomic account provisioning correction — 2026-09-20

Branch `codex/readiness-hosted-reconcile-20260920`, follow-up to `c68e49d`. Signup/OAuth deployment was held before any release after the independent reviewer found this additional high-severity race.

## Failure and cause

The prior and hosted flows inserted `app_users`, awaited a separate initial subscription insert, then deleted the account if the subscription failed. A second OAuth request could observe the row in that interval and return a working session. The first request then removed that account and its newly saved child data. Native reviewer executed the actual production handler with controlled local dependencies: first request 500, concurrent request 200, one token issued, one account deleted. Its rerunnable before-regression is preserved in the independent review evidence. This was not a hosted destructive test.

## Correction

`20260920030000_atomic_account_provisioning.sql` adds service-only `public.create_app_account(text,text,text,text)`. Account creation, the existing gift trigger, and the initial free subscription all belong to one PostgreSQL transaction. No existing account is updated or deleted. Invalid arguments and duplicate emails fail safely. The function has an empty fixed search path, explicitly qualified tables, and no execute grant for public/anon/authenticated roles.

Both signup and OAuth create through this RPC; no exposed-row deletion remains. Signup reports duplicate-email conflicts as 409. If two OAuth requests race, the loser re-reads the committed winner after a unique conflict and returns that identity with `isNew:false`. All current entitlement resolution and confirmed-provider identity protections remain. An unavailable provisioning RPC returns 503, with no client-side fallback to non-atomic inserts.

## Verification

`tests/account-provisioning-atomic.cjs` executes the actual migration twice in PGlite, checks anon/authenticated denial and service access, and injects a failure during the initial subscription insert. The account and gift trigger writes roll back together. Existing account password and isolated saved state remain intact on duplicate attempts.

Actual endpoint tests hold a first provisioning request, permit a second OAuth request to create and use its account, then fail the first: the successful identity and saved progress survive. Retry resumes it. Competing OAuth requests converge on one ID and one initial subscription; competing signup returns 409 without overwriting the provider account. These are real PostgreSQL statements plus actual handler interleavings. PGlite serializes SQL; they do not establish contention or uncommitted-row visibility across two independent hosted database connections.

Full `npm run test:security`, `npm run test:billing` (9), `npm run test:login-auth` (20 restoration cases plus request recovery), Deno checks of both changed handlers, and `git diff --check` passed. [Security output](evidence/account-provisioning-security-20260920.log). Static provisioning contracts were updated to require the transaction RPC and forbid endpoint deletion, while the new executable tests protect the failure that the former source-only rollback assertion missed.

Independent reviewer `/root/native_packaging` inspected the SQL transaction, privileges, adapters and retry/conflict behavior, reran the SQL/handler tests and existing auth groups, and found no remaining material issue in this bounded correction. The original exposure race is closed locally. No hosted account was created or deleted and no endpoint was deployed by this lane.

## Apply and recovery

1. Root checks that `create_app_account(text,text,text,text)` is absent or has the expected reviewed definition, and that existing app/account/subscription/gift schema matches. No migration data rewrite is needed.
2. Apply the entire transactional migration and verify its service-only grants and recorded version. The broad workflow allowlist includes it for eventual reproducible deployment; that workflow remains held for unrelated hosted reconciliation.
3. Deploy the two corrected endpoints only after the migration. Re-download sources and verify hashes/version before controlled account journeys.
4. Leave the additive RPC installed if a deployment step fails. New creation returns 503 if the RPC is unavailable, preserving data. Repair forward or restore the reviewed atomic handler; do not restore the known destructive rollback code. Existing sign-in/profile/refresh paths remain available independently.

Reserved-domain internal QA setup via explicit admin SQL is a separate, authorized test-data path: fresh exact UUID/email INSERTs inside a transaction, prior empty-scope checks, current PBKDF2 hashes, session version 1, free subscriptions and no roles. Check for unexpected gift grants before mutation journeys. Such fixtures prove hosted authenticated actions and recovery, not public signup or deliverable-email behavior. Root owns any live setup and evidence.

The paused operations preservation delta is retained at `/tmp/readiness-operations-preservation.patch` and `/tmp/readiness-operations-reconciliation.cjs`; it is deliberately excluded from this urgent auth commit.
