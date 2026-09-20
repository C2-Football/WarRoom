# Independent C2 frontend release compatibility — 2026-09-20

**Disposition: clear for the bounded frontend release; no material contract blocker found.** Reviewed exact deployed frontend baseline `4c4c4e9` against integrated `e1998fadad57703dfac5e359ffb2591f68e213ac` (same product code as `51ef4e3`). Root working changes during review were evidence/images only; no reviewed product source changed. This is not a whole-suite readiness signoff and does not authorize the held billing/deletion cutover.

## Contract assessment

- **Settings password rotation:** the only newly referenced account endpoint is `fw-change-password`. Actual client sends signed-session `{currentPassword,password}`, requires explicit `{ok:true,signInRequired:true}`, guards concurrent account changes, and uses the allowlisted sign-out destination. Reviewed deployed endpoint and additive `change_app_password` SQL expose exactly that contract. Existing legacy clients use existing `get-session-token` and `set-password`; this frontend release neither changes their hosted source nor claims old-token revocation parity.
- **Arrival/auth recovery:** login only adds truthful password-change confirmation and explicit `reauth=1` cancellation of automatic restoration. Existing account request/response contracts are retained. No signup/OAuth provisioning or new billing schema is requested by a changed frontend call.
- **Vault:** changed browser remote client preserves the existing `time-league` operations/payloads and treats an existing HTTP401 as a terminal credential rejection. Reopening after explicit sign-in remains the recovery path. Invitation URLs preserve the Vault destination. Source comparison found no change in any game entrypoint, Vault server engine module/data/compiler, Duat server code/data/compiler or Cup engine; `time-league-remote-client.js` is a browser adapter, not a generated server input.
- **Commissioner:** follow-up/preferences/checklist/rule-ratification/drift changes use existing account-scoped local storage. They report incomplete local writes, retain drafts and retry without duplicate local ledger entries. They do not add provider/server publication or require a new backend schema.
- **Empire and historical links:** additions use existing read-only Sleeper endpoints and current-season projection/stat helpers. They preserve account/season ownership context, discard stale callbacks, keep uncertain draft progress/values explicit, and separate seasonal from dynasty calculations. They introduce no server writes or held backend dependency.
- **Billing/deletion hold:** `onboarding.html`, `upgrade.html` and their existing checkout callers are unchanged from4c4c4e9. No changed frontend code calls `fw-delete-account`, `admin-delete-user`, the new checkout-attempt RPCs, billing event/source tables or deletion snapshots. Their source/SQL can remain in the repository without activating it during this frontend push. The existing unrelated real billing/provider defects remain open; this release does not cure or hide them.
- **Build/release isolation:** new plain-JS password helper is loaded before Settings and included by the established Pages artifact copy. All changed browser scripts have updated entry cachebusters. Canonical C2 shared dependency remains pinned at7bd3531. Pages workflow does not apply SQL. The independently reviewed C2 backend guard permits normal push validation only; backend release requires explicit reviewed game scope and contains no automatic migration path. No game backend deployment is required for these browser deltas.

## Independent verification

Re-ran actual source suites:

- `tests/account-password.cjs`:4 actual endpoint/SQL/client/Settings groups.
- Vault auth recovery and invitation tests:2 groups.
- Historical league route and draft inventory tests:7+7 cases.
- Seasonal Empire advice:5 cases.
- Commissioner follow-up, ratification, drift and plan recovery:5 groups.

All passed; no skipped test was counted as proof. [Combined independent log](evidence/c2-frontend-independent-contracts-sep20.log). The broader43-suite,12-browser and all-entrypoint Deno passes are root's separately recorded integrated gates, not duplicated or reattributed as this reviewer's runs. No fresh browser/provider journey was performed in this review.

Read-only configured Supabase metadata was fetched again during this review. All8 account function versions still match the already source-verified selective restoration: signup206, signin205, request/confirm reset174, profile173, OAuth77, refresh36 and change-password1. [Independent current-version check](evidence/c2-frontend-account-version-review-sep20.json). The reviewed record of applied account-password/provisioning SQL matches the new client prerequisites. No hosted rows, migrations, account passwords, connections or functions were changed by this review.

## Release conditions and operational limits

Root may proceed with the authorized coherent **C2 frontend-only** release after recording the exact final commit. Keep billing/deletion migrations and handlers held until their owning cutover is independently completed. Recheck current hosted account versions at dispatch/postflight because unrelated owning workflows have previously overwritten shared backend source. Verify both Pages workflows, release revision/served asset hashes and supported post-deployment journeys; a push is not deployment evidence.

The older `release-compatibility.md` still describes automatic schema application and an obsolete5d28 pre-release baseline. Root was notified to replace or explicitly supersede that operational guidance in its current release/recovery record before release. Follow the current game-only guard and this bounded contract assessment, not that historical rollout recipe.

No claim is made for actual public/native repository publication, provider account completion, Apple/Google purchases, native builds/devices/stores, independent hosted concurrency, complete product readiness, or permanent absence of external backend drift.
