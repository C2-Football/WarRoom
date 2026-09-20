# Reset security and live operational reconciliation

Date: 2026-09-20. Branch `codex/readiness-reset-reconcile-20260920`, based on root `4c4c4e9`. No deployment, mail, account creation, or database mutation.

## Why a direct restoration was unsafe

Read-only downloads showed the currently hosted reset handlers were version 171 and differed from the September 18 release. Confirmation again used separate token check, password write, session-version update and token consumption, and GET links targeted the old `warroom.skjjcruz.com` route. The repo's atomic RPC correction remains necessary.

However, the live request handler also contained operational improvements absent from the repo: env-first/Vault-fallback credentials, a `noreply@dhqfootball.com` sender default, and a current `dhqfootball.com` reset route. Its shared security helper added current web/native origins and OAuth/reserved-address helpers. Restoring the repository snapshot without reconciling these differences would have removed those paths.

## Changes

- Retain the repository's atomic confirmation RPC, bounded input/method checks, checked token insertion, truthful delivery audit and fail-closed atomic rate limiter.
- Preserve the live request handler's environment-first Vault secret lookup and current sender default. Both request and confirmation fallback to `https://dhqfootball.com/reset-password.html`; configured URL overrides still win.
- Preserve supported `dhqfootball.com`, `www`, legacy Pages and Capacitor origins, and union them with configured origins as the hosted implementation does. Keep the lightweight proxy CORS twin consistent and preserve personal-AI request headers.
- Preserve the existing reserved-test-email and OAuth identity helper exports. Independent review caught a latent fallback bypass: a session-version-rejected app JWT could otherwise be accepted through Auth/email mapping. The merged helper now rejects all app-marked tokens from fallback using decoding only for denial, supports base64url decoding, and requires a verified Auth token with a confirmed email for mapping. Actual helper regressions cover valid/revoked/malformed app tokens and confirmed/unconfirmed/invalid OAuth. This batch does not migrate other endpoint callers or assert that their separate flows are verified.

## Evidence and limits

- Actual HTTP GET: canonical reset page 200, `www` redirects there, served reset form posts to the configured Supabase confirmation endpoint. Web search access failed; direct HTTP inspection succeeded.
- Read-only SQL and CLI metadata returned booleans/names only: env Resend key and reply-to exist, sender/reset-URL overrides do not; Vault key/sender are currently absent. The code therefore retains the live default sender. No delivery outcome groups were present in the last seven days. Provider-domain verification and actual email delivery remain unproven; no secrets were returned and no mail was sent. See [safe evidence](evidence/reset-operational-readonly-20260920.json).
- `tests/reset-operational-compat.cjs` executes actual CORS helpers and reset request handler with isolated fixtures: env/Vault precedence, default/configured sender/link, supported-origin union, rejection of an arbitrary origin, reserved-address helper, and retained fail-closed limiting. No real network delivery occurs.
- `tests/password-reset-atomic.cjs` passes actual SQL/handler rollback, retry, single consumption, sibling invalidation, malformed inputs, grants and failure checks. Default-route assertions now reflect the verified current domain.
- Full `npm run test:security` and `git diff --check` pass. Deno checks cover both reset handlers and the proxy helper.

## Newer live behavior that must survive future releases

Read-only `fw-signup` source confirms production rejects reserved email domains unless the address belongs to `TEST_RESET_EMAILS`. That designated QA branch deletes an existing app account on signup and skips its rate checks; `fw-oauth-sync` similarly resets designated QA accounts. No signup/reset test was run against that branch. Its configured addresses were not read. Fresh test-account selection must honor this behavior and isolation.

The hosted signup/OAuth/session issuers also use a newer shared entitlement module with trialing/dhq/dhq_gift behavior absent from this repo snapshot. This batch intentionally does not overwrite those endpoints. A full backend deployment must reconcile them before replacing newer live behavior.

Hosted OAuth exchange returns the standard app user id and session-version JWT without a provider field. OAuth-only records use an `oauth:<provider>` password sentinel; the new app-password endpoint must use that authoritative distinction for actionable provider guidance. Independent review reran root's new account-password tests: all four actual endpoint/SQL/client/UI groups passed. Legacy bcrypt rotation still lacks session-version revocation and is a separate existing limitation; do not attribute all-session revocation to that path.

Independent product_inventory review ran the actual operational/identity regression and examined the final denial/confirmed-email changes. Its material fallback finding is resolved; no remaining material issue was found in this bounded delta.

## Release follow-through

Parent owns deployment. Reconcile/integrate this reviewed batch, deploy the two reset functions with their shared helpers only, then inspect served source/version plus configured current-origin preflight and GET redirect. A successful function deploy is not email delivery proof. Keep broader hosted/repository drift explicitly open until audited.
