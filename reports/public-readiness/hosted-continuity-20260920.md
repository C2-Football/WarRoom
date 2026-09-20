# Hosted continuity — 2026-09-20

Status: controlled-record absence explained; reset endpoints reconciled, restored and source-verified Sep20. Full suite readiness remains open.

## Controlled data deliberately removed

Original run `readiness-20260918-99b2f837-2a00-4a2d-b337-a17ce0164755` had two isolated accounts and three games. On resume both old (not expired) JWTs returned 401, fresh sign-in returned unknown email, and privileged read-only SQL found neither account nor either Vault room nor the Duat room. The audit table retains original successful signup/sign-in events and two `admin_delete_user` successes at 2026-09-19 16:42:36 UTC identifying exactly those accounts, reason `readiness QA test account, owner-directed 2026-09-19`.

Therefore this absence is not treated as a release regression. Original Duat recovery and continuity across the interruption are **unavailable after intentional cleanup**, not passed. Original passing Vault/API/browser evidence and original Duat HTTP546 remain valid historical observations. Do not recreate deleted records or overwrite their credentials/evidence. Any later controlled run must have new identities and separate evidence, verified empty before mutation. No real customer records were changed by this investigation.

Read-only evidence: `evidence/controlled-retention.json`, `controlled-retention-audit.json`, `controlled-cleanup-audit.json`. Source/workflow/trigger/cron investigation found no account retention task; normalized statement metadata showed explicit QA deletion and led to the audit evidence. The only cron task was analytics retention. Investigation used a role that bypasses RLS, excluding policy-hidden rows as the explanation.

## Reset functions replaced after release

Canonical backend workflow35395124404 succeeded Sep18 and deployed both reset endpoints. Hosted function metadata on Sep20 instead reports version171 updated Sep19, without a corresponding canonical backend workflow. Downloaded source proves `fw-confirm-password-reset` is the older separate password/version/token mutation implementation and the confirmation function uses the unresolved `warroom.skjjcruz.com` default. The request function separately contains newer operational changes absent from the repository: a working dhqfootball.com default, verified sender and Vault secret fallback. A read-only GET reproduced the dead redirect; DNS resolution fails. Neither PASSWORD_RESET_URL nor APP_RESET_URL is configured.

The SQL atomic-reset and RLS migrations remain present. Actual catalog assertions verify 49/49 restrictive gates, matching USING/WITH CHECK, roles/ALL scope, service-only atomic reset grants and the version-aware identity helper. The actual local SQL/handler regression passed again before restoring endpoints.

Independent review blocked a verbatim repository redeploy before any mutation: that would remove newer hosted sender/Vault delivery paths and live/native CORS origins. The security agent is reconciling hosted operational changes with tested atomic reset/rate-limit behavior in an isolated worktree. No restoration/deployment has occurred yet. No database/account mutation or email is needed for this reconciliation. Download restored functions and compare exact source/shared security; test redirect and page HTTP200. Hosted reset contention remains separate controlled-account evidence, pending a fresh isolated run.


## Restoration completed and release provenance corrected

After the above review, commit `4642e3e99185459b892819c54f83ba8133448633` reconciled current delivery/Vault sender fallback and web/native origins with the atomic reset and durable rate-limit protections. Root selectively deployed only `fw-confirm-password-reset` and `fw-request-password-reset`. Fresh downloaded copies of both entrypoints and their shared security module exactly match reviewed source. Synthetic confirmation GET302 leads to `https://dhqfootball.com/reset-password.html?token=readiness-routing-only`, which serves200. Allowed production/native CORS origins and arbitrary-origin rejection were checked. See `evidence/reset-restored-verified-sep20.json` and reset deploy logs. This involved no email sending, account/password change, or real token consumption. Hosted reset contention and email delivery remain unverified.

Current native repository `skjjcruz/github.com-skjjcruz-owner-dashboard-dev` at `aa13193` matches hosted account/billing source and explains newer operational behavior absent from the C2 repository. Public `dhqfootball.com` deploys from separate `skjjcruz/Owner-Dashboard---V6` at `db1701f`. Keep full C2 backend deployment paused; reconcile current auth, billing, legacy and proxy behavior before any further release. Current actual public repository access is read-only. C2 main/sandbox independently verified at `4c4c4e9` are separate frontend destinations.


## Selective account release from 0a704ac

Root rehearsed both new DDL functions inside a hosted transaction that rolled back, verified the names were absent and schemas compatible, then applied/recorded `20260918030000` (Settings password change) and `20260920030000` (atomic account/access creation) in one transaction. Independent postflight confirms definitions, versions and service-only grants. Only six endpoints were then deployed: `fw-signup`, `fw-signin`, `fw-profile`, `fw-oauth-sync`, `fw-refresh-session`, `fw-change-password`. Fresh separate downloads match every reviewed entrypoint and bundled shared dependency exactly; gateway configuration and supported CORS origins were checked. Evidence: `account-deployment-sep20.json`, `account-hosted-source-sep20.json`, `account-hosted-cors-sep20.json`, migration/grant preflight/rehearsal/postflight files.

The late independent signup/OAuth race finding was fixed before release: no partially created account is exposed and later deleted on subscription failure. Original failing local interleaving and corrected SQL/handler tests remain recorded. The public QA deletion path and refresh-reset race are also corrected. No billing or admin endpoint was redeployed. Current actual-native upstream source still needs the compatible patch and available release authority, so another stale upstream release remains an operational risk.

A new internal operator QA run created two fresh reserved-domain accounts only after zero account/subscription/role/gift/game counts, inside a transaction that aborts on any unexpected grant or membership. Public password sign-in/profile and empty game collections passed. This is internal test setup, not public signup/email-delivery proof. Root owns their ongoing Duat lifecycle and the later password/revocation tests; never touch original intentionally deleted Sep18 identities.

## New controlled lifecycle and recovery passed

The Sep20 run completed the two-account Duat draft, private reveals/council,17 historical weeks with saves and reloads, season completion/private recap, and a second dynasty cycle/draft to Week1 (298 hosted API requests). The original HTTP546 stage did not recur in this new run. This does not recover the intentionally deleted original room and is not complete browser/device evidence.

After the game run completed, root raced two reset links and then two authenticated Settings password changes against controlled account A. Each produced exactly one successful rotation and one session-version increment. All pending reset links were consumed; prior profile/direct REST access failed and password-change additionally verified refresh rejection. Incorrect current password preserved a valid session; new sign-in recovered the same account and saved campaign. Controlled account B stayed active. No real customer record, charge, or email was changed. Both evidence files report passed: `evidence/live-reset-sep20.json`, `evidence/live-password-change-sep20.json`. Reset-email delivery, real OAuth/signup and released Settings UI remain open.
