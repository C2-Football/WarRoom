# Checkout-aware account deletion — 2026-09-20

Bounded follow-up to `f4ef9d1` and `3c46867`, on branch `codex/readiness-account-deletion-20260920`. No live deletion, provider purchase, deployment, or remote data mutation was performed.

## Issue and intended behavior

High severity: an account could be deleted while an existing Stripe Checkout link remained usable. A later checkout completion could then create a paid subscription after local billing recovery records had cascaded away. New durable checkout attempts in billing commit `3df2672` make a second case explicit: a null local session ID can mean provider success with a lost acknowledgement, rather than no checkout.

Deletion must close verified checkout links and cancel subscriptions already produced by checkout before erasing Auth identities or the app account. Unknown provider state must preserve a useful retry path. This is an extension of existing deletion behavior; it neither creates checkout sessions nor changes prices or store policy.

## Resolution

- Additive migration `20260920060000_account_deletion_checkouts.sql` runs after existing deletion `040000` and frozen checkout `050000`. Service-only inspection now includes the complete ordered checkout-attempt rows plus the exact target Stripe-customer binding. Finalization compares that snapshot under the existing account locks and refuses active checkout leases. Claim/checkpoint/rotation/customer-binding changes invalidate older deletion attempts. All previous role, account-version, private billing-source, and exact-target guards remain.
- A new shared helper inventories paginated provider checkout history for the account's bound customer and every durable attempt customer. It checks account/customer identity, resolves each exact attempt metadata ID, and fails closed on missing/duplicate matches, active leases, ownership mismatches, unavailable history, or an enabled provider recovery link. It does not replay the checkout-create request, including for null session IDs.
- Verified open subscription checkout sessions, including older links without durable attempts, are expired and re-read. If completion won the race, the actual subscription is added to the cancellation inventory and its customer/account binding is checked before cancellation. An incomplete subscription confirmation retains the account for retry. Non-subscription payment sessions are not treated as subscription cancellations.
- Administrative deletion retains explicit confirmation before newly discovered checkout/subscription changes. Failed and partial operations retain the app account, report confirmed expiration counts and uncertain billing changes, and remain retryable. The new inspection field is required, so deploying the handler before its migration fails closed rather than silently accepting the old snapshot shape.

Provider behavior was checked against primary documentation: Stripe supports expiring open sessions and rejects already expired or otherwise non-expirable sessions; a rejected expiry therefore requires re-reading actual status. [Stripe expiration API](https://docs.stripe.com/api/checkout/sessions/expire). Customer-scoped history is paginated, so the implementation follows cursors and treats incomplete inventory as failure. [Stripe session-list API](https://docs.stripe.com/api/checkout/sessions/list).

## Verification

- [Focused command log](evidence/account-deletion-checkouts-focused.log): previous 16 deletion handler groups, five existing SQL groups, actual billing-source integration, 17 new checkout handler groups, and three new actual checkout/deletion SQL groups passed.
- New actual handler coverage: expiry before identity deletion; old-schema rejection; active lease; unacknowledged provider create found without creating another checkout; unknown and duplicate attempts; completion race; subscription ownership; paginated legacy links; retry after provider rejection; partial confirmed counts; completion lacking a subscription; lost expiry acknowledgement; competing durable attempt; wrong account and provider recovery link; missing configuration/history; administrative confirmation.
- Actual frozen billing `71d8971` plus checkout `3df2672` migrations were executed in disposable PGlite with additive deletion migrations. Tests include service-only access, full unknown-attempt data, live lease rejection, claim/checkpoint/unlock/rotation snapshot changes, changed customer binding, exact target cascade preserving an unrelated account, and later checkout refusing to recreate the deleted account. No independent database connections or hosted provider operations were used.
- [Full current `test:security`](evidence/account-deletion-checkouts-security.log) passed, including the new handler checks. Expected controlled error-path logs were inspected; they are not skipped cases.
- [Deno checks](evidence/account-deletion-checkouts-deno.log) passed for both actual deletion entry points and their imports using `--node-modules-dir=none --no-lock`. Shared dependency directories were not modified.
- `git diff --check` passed. Independent follow-up review is pending at this checkpoint; the earlier deletion candidate's independent clear review does not substitute for review of this delta.

Reproduce before integration:

```sh
READINESS_BILLING_SOURCE=/path/to/frozen/billing-71d8971 \
READINESS_CHECKOUT_SOURCE=/path/to/frozen/checkout-3df2672 \
npm run test:account-deletion
npm run test:security
npx --yes deno check --node-modules-dir=none --no-lock \
  supabase/functions/fw-delete-account/index.ts \
  supabase/functions/admin-delete-user/index.ts
```

## Release and remaining evidence

Root holds live billing/deletion until this delta and its prerequisites are integrated and independently reviewed. Integrate checkout `3df2672` before this additive migration; preserve its seven-minute worker lease and fifth helper hash in the billing cutover manifest. This branch does not duplicate or edit that canonical migration. Rehearse the combined migration order and exact deployed endpoint/helper bytes. The added workflow entries are source preparation, not an executed release.

For a scoped rollout, deploy the fail-closed deletion handlers before exposing the new checkout lifecycle: without `checkout_attempts` in the inspection result they refuse deletion. Then apply verified prerequisites and deploy the coordinated writers under the existing paused/drained billing cutover. Avoid a migration-first window where an older deletion handler ignores newly durable attempts. Root must verify actual hosted drift and migration state before selecting the exact steps.

Hosted provider cancellation, real checkout completion contention, hosted cascade behavior, current-source browser deletion, native purchase/restore, and independent-connection SQL contention remain untested here. The earlier documented Auth-recreation interval between final external scan and database commit remains; these independent services are not made atomic by this change. Uncoordinated old billing writers must be drained before activation. Very large or ambiguous provider history and configured recovery links produce an actionable support/retry state, not a false completion. None of these limits are counted as passed.
