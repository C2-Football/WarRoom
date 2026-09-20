# Billing cutover and recovery

Prepared locally; no production billing migration, gate change, webhook, checkout session, charge, or email has been sent by this agent. This is a release procedure, not evidence of a completed release.

## Why the gate is required

Separate Edge deployments are not atomic. Old hooks write `subscriptions` directly; new hooks maintain independent purchase sources and derive that row. Deploying in parallel alone cannot prevent an old request from overwriting a new aggregate.

The additive migration starts with processing **disabled**. New hooks return an error for retry without recording source/receipt changes; new checkout returns a temporary-unavailable error before creating a Stripe object. Existing entitlement reads continue to use the existing subscription rows. Portal management remains available. Already-open Stripe checkout and native purchases can finish at their provider during this maintenance window; their webhook updates wait for retry. They must not be described as immediately activated in the app.

Only after all three deployed writers and their shared helper are verified does the operator record their hashes and start a database-enforced seven-minute drain. This exceeds Supabase's documented maximum hosted worker lifetime of 400 seconds. The old handler bodies perform their database work before returning, with no background task. New tracking begins only after that drain, through one atomic activation. [Supabase runtime limits](https://supabase.com/docs/guides/functions/limits)

## Exact checkpoints

1. Freeze the integrated candidate and pass billing/security/Deno checks. Preserve the current deployed versions and configuration for `fw-stripe-webhook`, `fw-revenuecat-webhook`, `fw-create-checkout`, and `fw-billing-portal`. Keep subscriber-level baseline data private; do not commit real payment/customer/account records to this repository. Record baseline counts by provider/status and any known failed deliveries. Prior provider state already lost by the old single-row implementation requires provider-backed reconciliation; this migration does not invent that history.
2. Apply `20260920010000_billing_event_recovery.sql` and `20260920050000_billing_checkout_recovery.sql` after confirming the existing native billing/gift migrations are recorded. Read `billing_event_control`: first deployment must be disabled, with no source/receipt rows created by the new hooks. The migration replays without clearing receipts, sources, or an already activated gate. For a recovery or subsequent incompatible writer change, call `pause_billing_event_processing()` before deployment instead of relying on migration replay to pause it.
3. Deploy the three gated writers and portal. Verify each deployed `index.ts` matches the integrated candidate and that each deployed `_shared/billing-events.ts` matches its candidate hash. Also verify the checkout bundle’s new `_shared/billing-checkout.ts` dependency against the candidate. Probe each writer with a safe GET: expect HTTP405 plus `X-DHQ-Billing-Writer: billing-events-v1`. The version marker distinguishes new writers from legacy handlers; exact source hashes distinguish candidate revisions. Save deployment completion times, downloaded source hashes, and probe output. If any check fails, remain paused and repair the deployment. Do not activate a partially replaced set.
4. Only after step 3, construct the manifest below from those verified deployed files. Call `stage_billing_event_cutover(manifest)`. It sets processing disabled and returns the database timestamp `activate_after`, seven minutes later. Record the exact manifest and returned timestamp in private release evidence. A local candidate hash alone is not deployed-source verification.

```json
{
  "fw-stripe-webhook": "<verified deployed index.ts SHA256>",
  "fw-revenuecat-webhook": "<verified deployed index.ts SHA256>",
  "fw-create-checkout": "<verified deployed index.ts SHA256>",
  "_shared/billing-events.ts": "<identical verified helper SHA256 in all three bundles>",
  "_shared/billing-checkout.ts": "<verified checkout recovery helper SHA256>"
}
```

5. Wait until the **database** clock passes `activate_after`, sharing normal progress updates while waiting. Do not edit the timestamp to skip the drain; only the isolated SQL tests advance it. Immediately before activation, repeat all three safe writer probes and download/hash comparisons against the recorded manifest, even if no intervening deployment is expected. Any mismatch or writer change requires restaging and a fresh drain.
6. Call `activate_billing_event_processing()` and verify it returns true. Read control state and record `activated_at`, manifest, source/receipt counts, and the served writer probes. New Stripe events retrieve current subscription state under a per-purchase observation lease; RevenueCat receipts use original purchase/store/environment identity and period guards. Duplicate or out-of-order delivery does not blindly reapply an old aggregate. [Stripe delivery ordering and retries](https://docs.stripe.com/webhooks#event-ordering), [RevenueCat event fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)
7. Verify actual provider delivery recovery through the existing configured integrations: identify events that failed during the paused window, observe successful retry/acknowledgment, and match their IDs to committed receipts and resulting provider-source/aggregate state. Do not use invented signed events or real charges as a substitute for delivery evidence. Investigate `legacy_preserved` outcomes and unmatched identities using the provider's current records. Retrying an old Stripe event re-reads its current object; RevenueCat ambiguous legacy state remains explicit. Compare current paid/trial/gift entitlement reads, including a gift expiry, with the verified provider state. Preserve a private exact-ID checklist for any delivery that cannot yet be reconciled.

## Failure recovery

- If either writer fails verification before activation, keep processing disabled. Deploy the corrected candidate to every affected writer, reverify all three sources/helper/probes, then stage a fresh drain. Existing source/receipt rows are retained.
- After activation, `pause_billing_event_processing()` stops new claim/application work and waits for any current aggregate transaction holding the shared control lock to finish. Subsequent applications fail and leave their receipt uncommitted for retry. Checkout reports temporary unavailability. It does not revoke existing access or delete subscription data.
- Repair forward to the previously verified compatible code or a reviewed fix. Do not restore the old direct aggregate writers while retaining active new tracking, and do not drop sources/receipts to make a rollback appear clean. Restage the verified manifest, wait the drain, reactivate, and reconcile affected delivery IDs.
- Provider automatic retries are finite. If a pause could exceed their retry window, use the existing provider delivery-management access to preserve and replay missed deliveries after recovery. If that access is unavailable, record the exact unresolved event/account dependency and keep billing readiness blocked; do not claim recovered activation.

## Evidence limits and remaining work

Local actual-handler and PostgreSQL fixtures cover paused staging, required manifest/drain, migration replay, pause/recovery, write rollback, duplicate events, lease contention, same-second Stripe events, stale snapshots, old-period RevenueCat negatives, independent stores, legacy reconciliation, and browser-role denial. PGlite serializes SQL connections, so these are not independent hosted-connection or real provider delivery proofs. No native device purchase or store-distribution claim follows from them.

RevenueCat `TRANSFER`/cross-account restore remains blocked on current provider ownership access and a tested reconciliation path; the current explicit503 preserves delivery retry and existing access. See [billing journey follow-up](billing-journeys.md) for the verified checkout duplicate/recovery subset, finite retry dependency, and native client review. Provider-backed repair of already-lost legacy source history and actual device purchase evidence also remain outstanding. Preserve these as open work, not optional scope.
