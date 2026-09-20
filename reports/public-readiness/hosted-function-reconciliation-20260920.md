# Hosted function reconciliation checkpoint — 2026-09-20

Candidate branch: `codex/readiness-hosted-reconcile-20260920`, based on integrated `4642e3e99185459b892819c54f83ba8133448633`. No functions deployed, no email sent, no account created/reset/deleted by this lane.

## Source and deployment inventory

35 functions were listed with version, bundle digest, update time and JWT gateway configuration. 34 downloaded successfully to separate directories under `/tmp/readiness-hosted-inventory-20260920/`; separate directories preserve the independently bundled shared-module revisions. `time-league` returned management API HTTP 500 on both download attempts. Docker is unavailable locally, so its source equivalence is still unverified. The root release previously validated its deployment separately.

[Full inventory and source hashes](evidence/hosted-function-inventory-20260920.json) compares each downloaded file with the integrated repository. [Committed source provenance](evidence/hosted-native-provenance-20260920.json) compares them with `skjjcruz/github.com-skjjcruz-owner-dashboard-dev` revision `aa13193b28c552f977fa36a4683bb3a688d3da4f` (read-only local worktree `/Users/jacobc/Projects/warroom-current-native-source`). Account, billing, AI and admin entrypoints match that committed source byte for byte, except the two reset endpoints which root restored during this checkpoint. This establishes a newer source branch, not unexplained server edits.

Root separately established that `dhqfootball.com` is served by `skjjcruz/Owner-Dashboard---V6`, whose web-only source is distinct from the C2 frontend. Backend imports here do not prove that frontend is released or that write access to its repo exists.

| Function group | Current reconciliation state |
| --- | --- |
| `fw-request-password-reset`, `fw-confirm-password-reset` | Hosted version 172 source and bundled shared helper match integrated reset reconciliation exactly. Root owns post-deploy proof. |
| `fw-signup`, `fw-signin`, `fw-profile`, `fw-oauth-sync`, `fw-refresh-session` | This candidate imports established entitlements/OAuth/refresh behavior, with security corrections below. Independent review complete. |
| `set-password`, `get-session-token`, `yahoo-proxy`, `mfl-proxy`, `espn-proxy` | Native agent owns reconciliation. Hosted gift provisioning lacks repo admin/CAS protections; Yahoo lacks stored browser-bound state/session-version enforcement. Preserve repo security and newer functional additions. |
| `fw-create-checkout`, `fw-stripe-webhook`, `fw-revenuecat-webhook`, `fw-billing-portal` | Product inventory agent owns billing repair after actual-handler reproductions of ignored database failures, cross-store renewal/expiration overwrite, and portal default-domain rejection. Preserve current configured prices, trial and store semantics. |
| `ai-analyze`, `ai-feedback` | Large newer AI implementation remains to reconcile with repo BYO/free-access contracts. Feedback hosted allowlist lacks repo `keeper_take`. Do not overwrite either policy blindly. |
| `admin-list-users`, `admin-analytics-report`, `admin-delete-user`, `admin-grant-pro`, `admin-support-queue`, `admin-audit-log`, `admin-billing-summary` | Newer committed operational behavior must be retained. Role-protected callers rely on shared OAuth identity resolution; use the reconciled version-check/confirmed-email helper. Individual operational mutation semantics remain unverified. |
| `fw-delete-account` | Hosted-only entrypoint; separately review cancellation error handling and app/auth ID mapping before claiming deletion recovery. No deletion tested. |
| `report-bug`, `feature-requests` | Newer committed changes not yet reconciled. |
| `nfl-scoreboard`, `nfl-depth-charts` | Newer public provider behavior not yet reconciled; scoreboard deliberately uses read-only wildcard CORS. |
| `ops-email-doctor`, `ops-board-vault` | Both current entrypoints are inert retired stubs returning 410 for every request, with no database or secret access; no restoration needed. |
| `league-cup`, `duat` | Entrypoints match integrated repo exactly, but separately bundled shared helper is older. Duat runtime source is generated and requires its own build/hash proof. |
| `time-league` | Source download failed; no equivalence claim. |
| `fw-change-password` | Repository-only, not present in this hosted inventory. Root owns pending release. |

There are 13 hosted-only entrypoints relative to this candidate baseline, not 15. `fw-change-password` is the sole repository-only entrypoint. The broad workflow remains unsafe until changed hosted functions are reconciled or its deployment scope is explicitly constrained. A reset-only restoration is not permission to overwrite the other newer functions.

## Auth defects, corrections and evidence

**AUTH-H1 — public signup destroys designated QA accounts (high).** Actual downloaded signup handler with synthetic existing QA account and `TEST_RESET_EMAILS` accepted an arbitrary new password, deleted the existing account, and returned HTTP 200 with a new ID. No database was contacted. Candidate preserves the reserved-domain allowlist but applies normal IP/email limits and returns 409 for every existing account. No implicit deletion remains. Input types/size and failed existence lookup are checked before writes.

**AUTH-H2 — provider sign-in destroys designated QA accounts (high).** Actual downloaded OAuth handler returned a new app ID after deleting the synthetic existing account. Candidate always resumes the existing account. It also requires a verified Auth token and confirmed email before email-based identity mapping; custom app JWTs are refused before Auth fallback, so a revoked app token cannot exchange for a fresh session. Decoding is used only to deny, never to grant access. A genuinely new provider account keeps the existing `oauth:<provider>` sentinel and `isNew` response.

**AUTH-H3 — refresh can resurrect a concurrently revoked session (high).** Actual downloaded refresh handler first validated version 2, then read version 3 after a simulated password reset and minted version 3. Candidate rejects this mismatch and stamps only the version that was validated. Resets after its final read can at most leave a stale version-2 token, which the server boundary rejects.

**AUTH-M1 — inconsistent gift/trial entitlement state.** Exact committed `entitlements.ts` preserves active/trialing, `expires_at`, `dhq`/`dhq_gift`/bundle expansion and standard JWT claims. All five account paths now use it. Profile query failure returns an error instead of claiming a free account. Independent review found that the existing gift-on-insert trigger could grant Pro while signup still minted Free; signup now resolves persisted entitlements after provisioning, with an actual trigger-shaped fixture proving immediate gift access. If this read fails, the account is retained and the response truthfully directs sign-in recovery.

Superseded assessment: a subsequent independent review reproduced a race in the retained signup/OAuth provisioning rollback. A concurrent request could open the new row before its creator deleted it after subscription failure. The release was held; [atomic provisioning follow-up](account-provisioning-atomic-20260920.md) replaces this unsafe pattern with a transaction and documents the corrected evidence. The original local auth tests did not cover this race.

Validation: actual production handler/helper regressions in `tests/hosted-auth-reconciliation.cjs` first failed on the three downloaded defects, then passed on the candidate; full `npm run test:security`, `npm run test:billing`, `npm run test:login-auth`, Deno check of all five account endpoints, and `git diff --check` passed. The security harness now supplies the actual shared entitlement functions after their extraction; assertions were retained. [Full security output](evidence/hosted-auth-security-20260920.log), [Deno output](evidence/hosted-auth-deno-20260920.log). Expected injected outage errors in the test log are intentional negative-path evidence.

Independent reviewer: `/root/product_inventory` reviewed source and reran all actual auth groups, found the signup gift mismatch, then verified its correction and reported no remaining material finding in this bounded delta. These are local execution proofs, not hosted account or email-delivery proofs.

## Schema compatibility and QA path

A read-only hosted query verified `expires_at`, `billing_period`, `store`, `rc_app_user_id`, the established product slugs, and `apply_gift_grant_on_signup`. Both native migrations `20260710000000` and `20260724000000` are recorded. [Safe schema-only result](evidence/hosted-auth-schema-20260920.json). Product inventory owns importing their existing committed migration history. No migration or user record was changed here.

Safe new-user QA must use an exact designated test address or an authorized deliverable test mailbox. `TEST_RESET_EMAILS` presence is known; its contents were not read, and a fabricated address at a real domain is not a substitute for this policy. Before this candidate is deployed, existing designated accounts can still be erased by signup or OAuth; do not exercise those paths. Afterward, existing accounts sign in normally and signup returns 409. A clean reset belongs to the explicit authenticated admin account-management workflow; it requires verifying the exact disposable target and protecting paid/non-test records. This lane did not invoke it. No safe fresh mailbox has been established yet, so hosted fresh-account/email journeys remain open while independent work continues.

Next executable steps: root integrate this reviewed batch and the separate proxy/billing corrections; retain explicit deployment scope; validate hosted schema/migration compatibility; deploy the intended account endpoints individually; download and compare served sources; then run controlled account, refresh/revocation and provider journeys with an established disposable identity. Continue the remaining AI/admin/provider inventory rather than treating the whole backend as reconciled.
