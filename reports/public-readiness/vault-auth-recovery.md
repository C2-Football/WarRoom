# Vault rejected-session recovery — 2026-09-20

Status: fixed and verified locally; independent review pending. This batch is not deployed and does not establish hosted authentication or complete suite readiness.

Branch: `codex/readiness-vault-auth-20260920`, based on released `cce6234` plus the reviewed Vault invitation batch (`eb8bae0`, local cherry-pick `f5e87c5`). Canonical shared revision remains `7bd35313fc78e25a2d1ac24035989673a93f28e6`.

## Failure and cause

The retained real Vault browser sessions continued polling every three seconds after the server rejected their credentials with HTTP 401. The UI presented this as a temporary connection problem and promised automatic reconnection. A normal link back to login could immediately restore the same locally saved, rejected session and redirect without providing a sign-in opportunity. This prevented an ordinary user from completing recovery. Severity: high for the affected recovery journey.

Root independently established that the two original controlled accounts and their test rooms were deliberately removed by owner-directed administration on September 19, 16:42 UTC. Their JWT expiry was September 25, so the rejection was not proven token expiry. The historical completed browser season and prior successful reopen evidence remain valid observations from before that cleanup; recovery of those deleted rooms is not claimed. No original account or room was recreated, and no real credentials were used for this fix's fixture tests. All prior controlled browser contexts were closed.

## Repair

- The remote client treats HTTP 401 as a sign-in requirement, cancels polling and focus/online listeners, and rejects repeat requests using that exact account/token pair without sending them. Transient network errors still retry; a 403 permission rejection does not invalidate an account. A new token can reconnect, and a late response for an older token cannot invalidate a newer session.
- Vault preserves the last saved room and navigation context, marks the connection as requiring sign-in, disables shared progression, stops automatic shared actions, and provides an explicit sign-in action in the page and current-action footer. A successful write followed by a rejected refresh remains reported as saved; it is not replayed.
- The explicit `reauth=1` login route leaves the existing local account state intact but bypasses automatic restoration, allowing the actual email/password form to replace the rejected credential after success. Vault intent and pending invite recovery are preserved. The link works in both hosted root pages and the compiled local preview.

## Verification

- Full `npm run test:timeleague`: passed, including lifecycle, hidden-state projection, real archive/server pool, multiplayer contracts, invite, persistence and recovery checks. Log: [vault-401-suite.log](evidence/vault-401-suite.log).
- Focused remote regressions cover stopped timers/listeners and stale callbacks, fresh credentials, non-auth permission errors, late responses, and truthful successful-write/failed-read behavior.
- Production root/component regression checks saved-room preservation, disabled progression, explicit sign-in and resumed authenticated state. The full production login-script regression checks rejected-session recovery, preserved invite intent, and successful explicit sign-in. Existing login restoration and auth request recovery suites pass.
- Compiled preview build passed: [vault-401-build.log](evidence/vault-401-build.log).
- Real headless Chrome at 320×740 passed: source UI opens a fixture saved room; one HTTP 401 stops all polling for 9.5 seconds plus focus/online events; the footer action is at least 44px high and actually hit-testable; clicking it opens the real login form; explicit sign-in stores a fresh fixture credential; the saved room reopens online. No room mutations and no page errors. All external writes are denied except intercepted fixture authentication and read operations. Log: [vault-401-browser.log](evidence/vault-401-browser.log). The rerunnable check is `node tests/vault-auth-browser-qa.cjs`, included in the browser suite runner.
- `git diff --check`: passed.

The browser test's initial run exposed a `/dist-preview/login.html` 404; the preview-aware recovery link fixed the cause and the full rerun passed. No assertions were weakened.

## Evidence boundaries and next steps

Local fixture browser recovery is verified. Hosted 401 recovery, fresh controlled-account multiplayer/bid privacy, and post-deployment smoke remain root-coordinated follow-through. Root is reconciling newer hosted authentication behavior before creating any replacement controlled test run. The original deleted account/room IDs must not be reused or silently replaced in historical evidence. Native build/install/device/store and the historical archive distribution blocker are unchanged by this batch.

Next executable steps: independent source/regression review; integrate this commit after the invitation batch; run integrated release gates; deploy through the established process when root's hosted compatibility checks pass; repeat the explicit recovery and preserved-room journeys using a separately authorized fresh controlled run.
