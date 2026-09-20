# Readiness checkpoint

Updated: 2026-09-20. State: **active implementation; suite NOT READY**. Goal remains active.

## Current repositories and release authority

- Original `/Users/jacobc/Projects/warroom` is preserved, including unrelated PPG edits and untracked reports/mockups. Never clean/reset it.
- Integration `/Users/jacobc/Projects/warroom-public-readiness`, branch `codex/public-readiness-20260918`, current product revision `4642e3e99185459b892819c54f83ba8133448633`.
- **Actual public domain `https://dhqfootball.com/` deploys from `skjjcruz/Owner-Dashboard---V6`, main `db1701fd2e840e40184f645d1d50c4ec5a39d79c` (b132).** Detached read-only snapshot: `/Users/jacobc/Projects/warroom-current-public-source`. This newer web-only app is a separate repository from the C2 deployments. Current GitHub identity `jcc100218` has pull but no push/maintain/admin authority on it.
- **Current native/backend source** is `skjjcruz/github.com-skjjcruz-owner-dashboard-dev`, main `aa13193b28c552f977fa36a4683bb3a688d3da4f` (b132a), snapshot `/Users/jacobc/Projects/warroom-current-native-source`. Its account/billing entrypoints match the hosted source; proxies/Vault/Duat have additional source provenance to reconcile. Preserve current RevenueCat, gifting, native origins, delivery and entitlement behavior.
- Actual public Pages workflow uses `skjjcruz/DHQ-Shared` without a pinned revision. The C2 shared dependency is a distinct repository. Owner commits restore market-blended values and retain injured players; compare these decisions before proposing shared changes.
- C2 origin `C2-Football/WarRoom` and sandbox `C2-Football/WarRoom-sandbox` both main `4c4c4e97b742acc5b4696808d290ab1d7784410e`. Both served deployments independently verified: 326 asset hashes and 13 entry checks each (`evidence/release-4c4c4e9.json`). This does **not** verify the custom-domain frontend.
- C2 canonical shared pin `7bd35313fc78e25a2d1ac24035989673a93f28e6`; canonical checkout and vendored player-value twin agree. First batch `cce6234` release workflows succeeded; see `release-20260918-batch1.md`.
- **Hold the full C2 backend workflow:** it would overwrite newer hosted functionality until reconciliation is complete. Only two independently reviewed reset endpoints were selectively restored Sep20, as described below. No other new batch is deployed.
- `node_modules` is an untracked dependency symlink; never stage. Node25.8.1 locally/20 CI; Deno2.9.6 type checks available. Preview on localhost:3043 (old3028 stopped).
- Persistent goal `01a0b5f1-9d40-7202-a6a8-27887434173c` active. Astra/Ultra and Prevent sleep were not independently verified; Computer Use refused Codex settings access and no bypass was attempted.

## Integrated work and current validation

- First released batch: auth request/retry/account-switch isolation, validated Sleeper connections and incomplete/stale portfolio states, Empire journal save recovery, Commissioner task/dues persistence, format-aware picks, atomic reset/session RLS, packed Duat runtime and responsive draft/native staging protections.
- Current unpublished integration adds Commissioner preferences/follow-ups/Genesis/proposals/ratification/drift recovery; historical-season deep links; consumed draft rights; Vault invitation recovery and rejected-session polling/sign-in recovery; Settings password rotation; reconciliation of current reset delivery/origins with atomic security.
- Settings rotation uses an authenticated dedicated endpoint plus transactional password/session/reset-token change. Wrong-current-password, races, rollback, account switching, duplicate submission, legacy/provider handling and local browser recovery pass. New endpoint and migration `20260918030000_account_password_change.sql` are **not deployed/applied**. See `account-password-independent-review.md` and account password report/evidence.
- Focused integrated Commissioner, Empire, workspaces, account callbacks, security, Vault auth and build checks pass. Actual Chrome fixtures pass Settings at320/390/844, Vault401 recovery at320, historical route/failure/retry matrix and consumed draft inventory. Deno checks pass reset/request/password entrypoints. These browser tests deliberately block external writes and are not hosted-account proof.
- First release candidate `d5cf58d`: full npm test43 suites pass,0 suite quarantines, ESLint0 errors/33 warnings, production build pass; full browser gate ultimately passed after a reviewed locator correction with actual phone tap proof. This historical result is not a broad pass for the newer integrated candidate. One older individual analytics WIP assertion remains open.
- Queued: independently reviewed Empire seasonal valuation batch `d490983` (minor truthful-copy correction pending); Vault FAAB privacy handler/database fixture coverage `69ef42f`; independent seasonal review `16a078e`.

## Hosted backend and controlled data

- All frontends use production Supabase `sxshiqyxhhifvtfqawbq`; sandbox is not a disposable database. Existing CLI authorized; no customer records mutated in current reconciliation.
- Read-only catalog proves all49 public tables have restrictive session-version RLS gates; atomic reset and gate migrations remain present. Source downloaded from34/35 hosted functions; Vault large download needs retry.
- Sep19 independently deployed old reset code had lost atomicity and pointed confirmation at a dead domain. Sep20 root selectively deployed reconciled `fw-confirm-password-reset` and `fw-request-password-reset` from4642e3e, preserving current delivery and origins. Post-deploy downloaded source and shared security are byte-identical to reviewed candidate. Synthetic GET redirects to live dhqfootball.com reset form200. Web/native allowed origins verified; arbitrary origin excluded. **No email delivery, password/account mutation or hosted reset contention tested in this restoration.** Evidence `evidence/reset-restored-verified-sep20.json`.
- Original controlled run `readiness-20260918-99b2f837-2a00-4a2d-b337-a17ce0164755`: mode0600 `tmp/public-readiness/accounts.private.json`, never print/stage/reuse. Two accounts and three rooms were deliberately removed by owner-directed admin cleanup Sep19 16:42:36UTC, confirmed by scoped retained audits. Absence is not attributed to this release.
- Historical Vault API room `9abe0f2c-7f52-4035-984a-606a0b121142`: two-account sealed draft, competing actions and completion passed. Historical browser room `e6563c66-2713-4ded-8b1b-c3373261ca41`: all14 weeks, playoff/champion, reload/year reveal passed with local frontend and hosted backend. Preserve evidence; neither is current deployed-browser proof.
- Original Duat room `d5038ca0-15c5-4acf-b7c4-f08e1283161f`: role/privacy/readiness passed, draft load failedHTTP546. Original recovery unavailable after intentional cleanup. Packed runtime parity and local suite pass; new hosted complete lifecycle still required.
- No controlled live accounts currently in use. Public allowlisted QA signup/OAuth in current hosted source destructively deletes/recreates existing accounts; reserved fake domains require an exact configured allowlist entry. Do not use this unsafe flow or invent deliverable addresses. Fresh runs require a safe non-destructive account path and separately verified empty scope/new evidence.

## Ownership and next executable actions

1. Security agent owns current native/hosted auth/account reconciliation: preserve entitlements/native/ops behavior, remove public destructive QA cleanup, restore strict session/OAuth/rate/error handling and refresh/reset race protection. Isolated source/handler tests pass; independent review and integration pending. Commissioner schedule/malformed-save work is paused safely for later.
2. Native agent owns legacy credential and Yahoo/ESPN/MFL reconciliation: preserve admin/CAS/stored-state/session revocation guards and current provider operations; also fixes reproduced legacy hash-upgrade race. No deploy. Vault FAAB fixtures are independently ready.
3. Product agent owns billing reliability: preserve existing Stripe/RevenueCat/gift rules, check all storage failures, durable dedup/order and independent provider state. No real charges/webhooks. Shared-engine changes pause until actual public source decisions are compared.
4. Root updates actual release-path record, reviews/integrates queued batches, prepares compatible public frontend corrections and reviews backend reconciliation. Never deploy the full stale backend set. Track actual custom-domain access as a release dependency; no user action requested while productive authorized work remains.
5. Once coherent, run full automated/browser candidate checks, safe migration rehearsals and independent review. Only then selective backend release with recovery/source comparison, appropriate frontend release verification and fresh isolated hosted journeys.
6. Continue unfinished primary journeys: hosted Duat and Vault private bids/reconnects, account email/OAuth/onboarding/billing, Commissioner remaining saves, Wire/history/scoring/providers, Draft/Cup authorization, mobile keyboard/safe-area/accessibility/performance and diagnostics. No product is fully signed off.

## External boundaries

- Actual production repository is currently read-only through configured GitHub identity; prepare concrete compatible work before requesting missing release authority if needed.
- Native archive includes historical data documented local-only; distribution provenance unresolved. Safe compiled-asset staging guard stays enforced. No complete native build/install/device/store evidence; actual current native repo still needs its own packaging audit.
- Sleeper commercial-use permission is a documented prerequisite to verify, not a claim that no prior agreement exists. Do not contact providers, buy services, change policy/pricing, accept contracts or issue announcements.
- No readiness claim or background activity claim beyond actual evidence. Productive work continues; missing external access is not a reason to abandon independent authorized paths.
