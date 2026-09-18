# Independent auth recovery review — 2026-09-18

Reviewed root working diff at `/Users/jacobc/Projects/warroom-public-readiness`
for `landing.html`, `login.html`, `reset-password.html`, and
`tests/auth-request-recovery.cjs`. No edits made in that worktree. Status below
reflects the inspected pre-fix working diff; the owner must record subsequent
resolution and evidence.

## Material findings

1. **OAuth startup can strand every sign-in method (high, primary journey).**
   `login.html:473` sets the shared pending flag before awaiting the SDK without
   a timeout. A promise that never settles leaves Google disabled and causes
   email/signup submissions to return silently. Read-only VM reproduction using
   the new test harness: `{buttonDisabled:true, credentialRequests:0,
   recoveryTimer:false}` after starting Google and then submitting valid email
   credentials. A resolved response with no redirect URL likewise has no retry
   transition. The existing regression covers an immediate rejected promise only.
   Add bounded startup, handle missing provider URL, release the shared lock on
   failure, and verify a late result cannot navigate after the user retries via
   another account method.
2. **Legacy username storage failure leaves the form locked (medium).**
   `login.html:450–455` removes the temporary app session and writes the legacy
   keys outside `authenticate`'s guarded error path. A quota exception on
   `od_session_v1` rejects the submit handler and retains the pending lock with
   no error message. VM reproduction: `{rejected:'QuotaExceededError',
   buttonDisabled:true, message:'', storedKeys:[]}`. Persist the correct session
   shape inside the recoverable path, preserve prior session state on partial
   failure, and add failed-storage/retry coverage.

## Other observations

- The new HTTP/JSON validation and reset-request acknowledgement wording avoid
  falsely reporting delivery or sign-in success on a network or malformed reply.
- `npm run test:login-auth` passes the existing 16 restoration scenarios and new
  request-recovery tests; the two cases above are missing behavior coverage.
- No new injection/open-redirect issue was found in the reviewed diff; service
  messages use textContent and new landing destinations are fixed local paths.
- No real account or backend mutation was performed.
- Existing password-reset backend uses non-atomic token consumption and ignores
  errors for session-version/token-used writes. This was sent to the security
  boundary owner for investigation; it is not a frontend-diff regression.
