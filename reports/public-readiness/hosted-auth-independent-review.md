# Hosted auth independent review

Review target: `c68e49d7f4dec88c4db7cd3c8a62cb70e522e481` in `warroom-readiness-hosted-reconcile`, 2026-09-20. No hosted requests, credentials, or database mutations were used. Source and tests were read without editing the author's worktree.

## High: failed provisioning can delete an account already signed in

**Reproduction:** execute `node reports/public-readiness/evidence/oauth-provisioning-race-review.cjs /Users/jacobc/Projects/warroom-readiness-hosted-reconcile` from this worktree. The harness loads the actual OAuth handler and shared helpers. A controlled in-memory database holds the initial free-subscription insert after the new account row is visible. A concurrent OAuth sign-in succeeds for that account. The initial subscription operation then fails.

**Observed at the reviewed commit:** the first request returns 500; the concurrent request returned 200 and minted an app session; the first request deletes the same account. The assertion that the signed-in account still exists fails. [Sanitized output](evidence/oauth-provisioning-race-review.log), [rerunnable harness](evidence/oauth-provisioning-race-review.cjs).

**Root cause:** `fw-oauth-sync` performs separate account and subscription inserts and deletes the account unconditionally on subscription failure. The new account is visible to other requests before provisioning finishes. `fw-signup` has the same exposed-row cleanup pattern, permitting a concurrent password sign-in to race cleanup. Deleting only the ID created by the request does not make cleanup safe after that ID has become externally visible.

**Impact:** a successful sign-in can immediately lose its account. Dependent state created during the interval may be deleted by cascading constraints or become inaccessible. This is a material account-integrity blocker, not merely a misleading error message.

**Disposition:** root and the security owner accepted the finding and held signup/OAuth deployment. The owner is implementing atomic account-plus-subscription provisioning with a service-only database function and meaningful transaction/handler regressions. Correction and independent re-verification are pending; this report does not clear the auth batch.

## Checks that passed

- `node tests/hosted-auth-reconciliation.cjs`: all five groups pass at the review target, including account preservation on designated QA sign-in, confirmed OAuth identity, custom-app-token rejection before OAuth fallback, session-version refresh race rejection, active/trialing/gift/bundle entitlement behavior, and entitlement lookup failure handling.
- Source review confirmed the captured validated session version is compared again before refresh minting; lookup failure does not become a free-tier success.
- The existing tests did not exercise subscription-insert failure interleaved with a successful sign-in. The new independent reproduction closes that evidence gap but intentionally fails on the reviewed implementation.

This is a bounded source/fixture review. It provides no hosted login, migration, email-delivery, native install, or full-suite readiness claim.
