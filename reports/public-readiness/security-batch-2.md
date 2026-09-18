# Public readiness — security batch 2: atomic password reset

Date: 2026-09-18. Branch: `codex/readiness-security-20260918`. Base includes privacy batch `d42db1a`. Local investigation and repair only; no hosted mutation or deployment by this agent.

## SEC-RESET-03 — High — reused reset token and partial password rotation

Baseline reproduction executed the actual `fw-confirm-password-reset` handler with a deterministic isolated database adapter. Two concurrent requests presented the same token. Injected failures in session-version rotation and token consumption were ignored. Result: both requests returned HTTP 200 `{ok:true}`, password wrote twice, session version remained 1, token remained unused. Reproducer is an ignored local fixture at `output/security/reproduce-reset.cjs`; no real tokens/accounts were used.

Root cause: token validation, password write, session revocation and token consumption were independent database requests. The latter two errors were ignored. Concurrent requests could both validate an unused token and change the password. A successful reset could leave old sessions valid and a reusable link.

Resolution: additive migration `20260918010000_atomic_password_reset.sql` adds service-only `confirm_app_password_reset(token_hash,password_hash)`. It locks the account before checking/locking its reset token, rechecks expiry using current wall time, rotates the password and session version, and marks outstanding account reset links used in one transaction. Account-first lock ordering serializes different reset links for the same account without a cross-token lock-order inversion. Invalid/expired/used tokens return no row. Any mutation error rolls the entire operation back. No plaintext password or token enters the database.

The actual confirmation handler uses the RPC, fails closed on an RPC error, and returns success only for a committed reset. Existing PBKDF2 format, emailed-link redirect and generic invalid-link behavior are retained. Malformed input and unsupported methods are rejected. The request handler verifies token persistence before sending email, keeps its non-enumerating public response, and records storage/delivery failures truthfully instead of success.

## Verification

`node tests/password-reset-atomic.cjs` passes with the actual production handlers, shared active-session verifier, actual signin password verifier and isolated PostgreSQL-compatible PGlite database:

- Migration applies twice without changing existing account credentials or outstanding reset links.
- An existing pre-migration link resets the password; generated PBKDF2 hash works with signin's verifier.
- Old session version fails the actual shared active-session check; the new version passes.
- Used, expired and unknown links fail. Other previously issued links for the reset account fail; another account's credentials/token are unchanged.
- Twelve concurrently submitted handler requests produce one success, eleven invalid-link responses and one session-version increment.
- A database trigger forces token-consumption failure after the password update. Password, version, timestamps and token all roll back, no success audit is emitted, and the same link succeeds after the failure is removed.
- RPC outage returns failure with unchanged account state.
- `anon` and `authenticated` roles cannot execute the reset RPC. `service_role` can. Invalid hash arguments are rejected.
- Token-storage failure sends no email or debug token; known/unknown account public responses remain generic. Provider failure records a failed delivery. Successful request persists a hashed token and its link can complete the actual confirmation handler.

`npm run test:security` and `git diff --check` pass including these regressions. Existing string-level contract now asserts the atomic service RPC rather than the removed multi-request update. The new regression runs in the security suite.

Limit: PGlite serializes database queries. This proves actual SQL semantics, rollback and endpoint behavior; it does not prove separate production connections contending for locks. No live email or hosted reset has been tested in this batch.

## Integration, deployment and recovery

- Both apply and verification allowlists in `.github/workflows/deploy-functions.yml` include the migration. Established workflow applies migrations before deploying functions.
- Apply migration first. It creates one function and grants inside an explicit transaction; it neither changes existing rows nor removes existing APIs. Existing handlers still run during the transition.
- Then deploy `fw-confirm-password-reset` and `fw-request-password-reset`. A new handler against a missing RPC fails closed. Verify recorded migration, service-only function privileges and both function deployments before live reset smoke tests.
- Rehearsal is the isolated real-SQL test above: pre-existing account/link preservation, repeat migration, browser/service grants, injected partial-write failure and successful recovery.
- The mutation is atomic; no repair of partially rotated credentials should be necessary. On unexpected deployed behavior, keep reset confirmation unavailable/fail-closed while correcting the function/handler. Do not roll back to the vulnerable old handler, undo legitimate new passwords, reset session counters or unconsume used tokens. The additive function can stay installed during rollback of unrelated frontend changes.
- Hosted verification needs only disposable accounts: issue a controlled reset link, submit competing confirmations, verify exactly one succeeds, old password/session fails, new password/signin succeeds, repeated link fails, and an unrelated test account is unchanged. Verify production `RESET_DEBUG_RETURN_TOKEN` is unset/false; do not expose production reset tokens through the unauthenticated request endpoint.
- Independent reviewer `product_inventory` examined commit `3744f22`, reran the regression and found no material issue. Hosted verification remains required before claiming this issue fixed live. Parent owns deployment and integrated release checks.
