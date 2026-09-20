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
