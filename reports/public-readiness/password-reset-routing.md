# Password reset destination recovery

Severity: high, a public account-recovery journey cannot open. Candidate fix;
hosted redirect remains broken until the backend is deployed.

Read-only reproduction on 2026-09-18 20:35 UTC: GET the public confirm endpoint
with a clearly synthetic routing token (no reset mutation). It returned HTTP 302 to
`https://warroom.skjjcruz.com/reset-password.html`, whose hostname failed DNS lookup
with ENOTFOUND. The CLI secret-name inventory confirms neither PASSWORD_RESET_URL
nor APP_RESET_URL is configured; no secret values were read. The default is thus
also used when composing email links. RESEND_API_KEY is configured, but that alone
does not establish successful delivery.

Both existing Pages reset-password routes return HTTP 200 with their reset input.
The candidate changes the fallback in request and confirm functions to the existing
production `https://c2-football.github.io/WarRoom/reset-password.html`. Explicit
configured and legacy overrides still take precedence. No new domain/service,
account, billing or business policy is introduced.

Actual-handler regression covers default redirect, token encoding, explicit
configured override, legacy override with a query string and generated email-link
routing. Existing password atomicity, grants, replay and delivery-failure checks
remain intact. Provider delivery is mocked; no email sent by this probe.

Evidence: `evidence/reset-public-routing.json` and
`evidence/reset-routing-regression.log`. Independent security review passed, including rerunning the actual handler/SQL
regression and checking the published target HTTP 200. Actual post-deployment
redirect/target checks remain required before closing the hosted issue.
