# Billing reconciliation — locally verified candidate, September 20

Branch `codex/readiness-billing-20260920`, baseline `4642e3e`. No deployment or external billing mutation. Canonical shared work remains clean at `7bd3531` pending production-provenance review.

## Source and preserved contract

Current native source `/Users/jacobc/Projects/warroom-current-native-source` at `aa13193b28c552f977fa36a4683bb3a688d3da4f` matches the downloaded hosted billing handlers. Public source is the separate `Owner-Dashboard---V6` repository. Both existing native migrations `20260710000000_dhq_pro_billing.sql` and `20260724000000_gift_grants.sql` are imported unchanged. The security reviewer verified their live history/columns/product slugs/gift trigger read-only; no subscriber rows were queried.

Preserve configured DHQ monthly/annual price IDs, the existing 7-day trial, legacy products, active/trialing access, separate `dhq_gift` expiry, `store` and billing-period fields, authenticated portal access, RevenueCat authorization, and current return origins. No prices, business terms, services, or store approvals are changed.

## Reproduced defects

- High: actual hosted Stripe and RevenueCat handlers returned HTTP200 after injected subscription write failures. RevenueCat also acknowledged an account lookup outage as an unknown user. Provider retries would be suppressed. Exact downloaded-source mock script: `/tmp/readiness-billing-review.cjs`; no remote dependencies were invoked.
- High: an old RevenueCat expiration overwrote an active Stripe `dhq` row because both write the same `(user_id, product_slug)` row without provider/transaction or event ordering. A timestamp guard alone cannot preserve independently active purchases.
- High recovery concern: checkout proceeded after failed customer linkage; repeated attempts could orphan customers and present an unusable management path. Portal lookup failure was reported as no web subscription.
- Default-origin defect: portal rejects `dhqfootball.com`, `www.dhqfootball.com`, and C2 Pages without an environment override. Checkout omits C2 from its defaults. Environment overrides can mask this; no secret values were read.

## Current implementation and evidence

The imported handlers now check database results; write failures return non-success and retries can succeed. Checkout stops when customer lookup/linkage fails and uses a stable customer-creation idempotency key. Portal distinguishes lookup failure from no Stripe history. Both accept the union of established origins and configured extras, and reject foreign returns.

`node tests/billing-recovery.cjs` passes actual-handler fixtures for four Stripe lifecycle events, eight RevenueCat lifecycle events, query failures, retry success, authorization denial, preserved trial/period/store/cancellation semantics, allowed and forbidden origins, and failed customer linkage. Dependencies are injected; no Stripe sessions, charges, emails, or webhooks were sent.

## Final local validation and review

- `npm run test:billing`: nine schema checks plus actual handler and PostgreSQL suites pass. The static upsert assertion now checks the established public key in the atomic SQL function; actual handlers execute that function through the shared event helper.
- `npm run test:security`: passes after syncing the exact existing shared pin `7bd3531`. The first run stopped on an absent ignored shared checkout; no assertion was weakened.
- Deno checks pass for all four changed billing endpoints. `git diff --check` passes. No frontend source changed in this batch.
- Security reviewer independently ran actual SQL and identified two failures: an already-created ambiguous RC source prevented eventual legacy reconciliation, and cancellation-only input could fabricate Pro. Both are fixed with exact regressions; retired legacy snapshots remain as evidence, unknown negative-only state remains incomplete/free, and later verified purchase recovery preserves the newest cancellation watermark. The reviewer found no remaining material issue in the bounded receipt/source/handler consistency scope. Root independently reviewed the activation gate, reran both actual billing suites, and found the bounded gate changes clear; official Supabase worker limits were independently rechecked. The runbook requires exact served-source and probe verification both before staging and again immediately before activation.
- Actual handler → shared helper → SQL fixtures cover distinct Stripe events sharing one second, a delayed competing reader, busy retry, late snapshot delivery, RC renewal surviving another store's cancellation, and old-period expiration arriving with a later generation time. Failure rollback leaves no success receipt; replay and service-only grants are checked.

Evidence logs are in `evidence/billing-local-tests.log`, `evidence/billing-local-security.log`, and `evidence/billing-local-deno.log`. All accounts/events/Stripe objects in these tests are synthetic; there were no external billing calls.

## Release state and next executable steps

No billing changes are deployed or activated. Follow [billing-cutover.md](billing-cutover.md): disabled-by-default database gate, verified writer/helper hashes and method probes, enforced seven-minute drain, atomic activation, exact delivery-ID reconciliation, and pause/restage recovery preserving all source/receipt data. Parallel deployment alone is explicitly insufficient.

Independent hosted connection contention and actual provider delivery/bootstrap evidence remain outstanding. Native purchase transfer/restore, already-lost source history, checkout session duplicate protection beyond stable customer creation, and misleading current native payment confirmation/recovery copy remain separate unfinished work. This candidate fixes the documented persistence/order subset; it does not close billing or suite-wide readiness.

Primary documentation checked September 20: [Stripe webhook event ordering and duplicate handling](https://docs.stripe.com/webhooks#event-ordering), [RevenueCat event fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields), and [Supabase worker duration limits](https://supabase.com/docs/guides/functions/limits). These guide recovery mechanics, not changes to pricing or business terms.
