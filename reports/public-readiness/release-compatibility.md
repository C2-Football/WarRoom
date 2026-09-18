# Candidate release compatibility and recovery

Status: pre-release; no readiness batch deployed. Recovery frontend baseline:
`5d28f396a3f41f3e95075264ea2890227907c761` on both existing repositories.

## Hosted inspection (read-only)

Existing authenticated Supabase CLI access was linked to the already configured
shared project. Catalog-only queries retrieved no customer rows. Evidence:
`evidence/hosted-security-before.json` (49/49 public tables have RLS) and
`evidence/hosted-auth-compatibility-before.json` (columns, indexes, functions).
The hosted `app_users` and `password_reset_tokens` columns match both new migration
contracts, including non-null integer session_version default 1, password-change
and update timestamps, unique token hash and user/token foreign identifiers.
The old current_app_user_id helper returns the claim UUID without a live session
version check. The new atomic reset function does not yet exist on the host.

## Ordered rollout

The canonical backend workflow runs security/Vault/Duat tests, builds runtimes,
type-checks functions, applies allowlisted migrations in ascending order, records
and verifies them, then deploys functions. The sandbox repository does not deploy
the shared backend. The two migrations are additive/idempotent and locally rehearsed
for grants, replay, transaction rollback, concurrent reset links and revoked versus
current sessions. No existing user row rewrite, deletion or schema shape change.

1. Publish the verified canonical shared commit and pin both shared workflow inputs;
   verify vendored consistency. Run integrated candidate gates and independent review.
2. Deploy canonical main, then sandbox main through their existing workflows. Follow
   backend and frontend terminal outcomes; pushing alone is not deployment proof.
3. Inspect recorded migrations and restrictive policies on all existing public RLS
   tables; use only disposable accounts for reset/concurrency/direct REST checks.
4. Verify both release.json revisions and cache-busted served asset hashes, then
   post-deploy browser journeys and resume the original failed Duat campaign.

## Practical recovery

Keep the last verified revision and workflow URLs in the release record. Frontend
regressions can be reverted with an ordinary follow-up commit and both Pages
workflows; never rewrite shared history. If needed, revert only the defective backend
runtime component while retaining working security corrections, then redeploy the
canonical workflow. The Duat packing correction does not alter saved game schema.

Do not automatically roll back atomic resets or session revocation gates: that would
reopen known security defects. Their migration protections are additive; recovery
should repair the function/policy and rerun the idempotent migration when necessary.
A bad edge-function rollout can be corrected or component-reverted independently of
these protections. Existing reset links remain usable through the new RPC. Previously
revoked app sessions may now be denied by direct REST as intended; users sign in again.

No production migrations have been applied manually during this investigation.
Final release SHA, checks, operational postconditions and workflows remain pending.
