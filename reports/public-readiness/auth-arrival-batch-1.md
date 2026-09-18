# Arrival and account recovery — first batch

Status: fixed locally; integrated release and live verification pending.
Baseline: `5d28f39`. No real signup, password change, email or checkout was sent.

| Issue | Severity | Reproduction and root cause | Resolution |
| --- | --- | --- | --- |
| AUTH-001: arrival cannot reach an account | High | Click Start free on actual landing page: URL remains landing.html, demo calculator scrolls into view, zero login/onboarding links exist. Eight account/billing CTAs were demo scroll buttons. | Existing signup CTAs link to the real Create account tab; header Sign in and existing billing entry have real links. Product design/pricing copy retained. |
| AUTH-002: reset reports success while offline | High | Actual Chrome offline mode: Forgot password reports a link is on the way despite failed fetch. HTTP errors were ignored too. | Check HTTP status and explicit response acknowledgement, show retryable errors, describe acknowledgement rather than email delivery. Reset completion requires explicit `ok: true`. |
| AUTH-003: malformed/competing/hung sign-in | High | 200 empty JSON stored as a session and produced welcome text; competing submissions and unbounded requests had no complete recovery contract. | Validate app identity/token, hold one account request, 15-second request timeout, retry on failure. OAuth uses bounded SDK startup with controlled navigation and validated same-service URL. Late results cannot redirect over subsequent sign-in. |
| AUTH-004: storage failure strands legacy login | High | Independent reviewer injected quota failure on od_session_v1: old app session was removed, submit rejected, form stayed disabled. | Replacement writes are guarded; previous values roll back on failure; error explains recovery and form unlocks. Account-switch adapter integration is a separate pending seam. |
| MOBILE-001: narrow arrival overflow | Medium | At 320px actual strategy demo controls expanded the document to 326px. Header anchor styling initially conflicted with the existing phone hide rule, caught before commit. | Narrow controls wrap into readable 44px rows; phone header keeps navigation within the viewport. |
| QA-001: obsolete browser journeys and false skip pass | High verification gap | Old launch QA targeted removed landing auth modal, old plan selection and obsolete paid feature gating. `test:browser` short-circuited after the first failing suite; missing browsers exited zero. | Launch QA now exercises actual arrival/login/onboarding, existing upgrade route, administrator UI and accepted capability/role separation. Browser runner attempts every suite and fails required skips. |

## Verification

- Original reset bug and dead arrival CTA reproduced through Playwright CLI in
  real Chrome. No fixture is described as a deployed account check.
- `npm run test:login-auth`: existing 16 restoration scenarios plus executable
  actual-page handlers covering network/server/malformed failures, retries,
  missing identities, duplicate submissions, timeouts, OAuth rejection/hang/late
  completion and quota failures for every legacy session write.
- `node tests/launch-browser-qa.js`: **6 flows passed**, real Chrome with isolated
  contexts and intercepted authentication, email, billing and admin services.
  Includes 320px arrival/signup; no external writes are allowed through fixtures.
- Missing-Chrome probe: all five browser suites attempted; runner exits 1 and
  reports 0 passed, 5 failed. Missing execution is never a pass.
- ESLint for changed tests/runner and `git diff --check` passed. Design-token
  contract passed. Full baseline npm test: 39 passed, 0 failed, one pre-existing
  landing-content quarantine; it does not establish final-candidate readiness.
- Independent native agent reviewed auth changes, reproduced OAuth/storage
  failures, then confirmed both corrections with no remaining material finding
  in that bounded diff. See `auth-review-1.md` once integrated.

## Remaining checks

Integrate and review account-scoped session preparation, returning-account
context restoration and logout. Backend reset token consumption/session
invalidation needs atomicity review (separate security batch). Real disposable
account authentication, reset delivery, OAuth providers and deployed journeys
remain unverified. Complete all broader/browser suites after integration.

Evidence: `evidence/auth-regression.log`, `evidence/auth-launch-browser.log`,
`evidence/browser-gate-missing-browser.log`, baseline logs in the same directory.
