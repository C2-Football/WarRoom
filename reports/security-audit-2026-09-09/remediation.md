# Security fixes — September 9, 2026

All five findings are fixed in the local working tree. Existing unrelated edits were preserved. No commit, push, production migration or deployment was performed.

| Finding | Fix |
|---|---|
| Sleeper identity claiming | Gift provisioning now requires an administrator role in both the endpoint and SQL. Atomic first-password assignment prevents concurrent overwrite. Legacy users can still rotate their own password, with conflict detection. The gift page states the administrator requirement. |
| Free-to-Pro AI access | Superseded by the owner’s free-access request: every feature is free, shared AI uses only the owner Gemini key with atomic quotas, and personal keys never trigger owner-paid fallbacks. Old billing claims cannot change that policy. |
| Forged Yahoo OAuth state | A short-lived server record holds the owner and return URL. A top-level start redirect binds the flow to a Secure, HttpOnly, SameSite=Lax browser cookie. The callback atomically consumes the matching state. App-session revocation is checked for callback completion and API/refresh access. No shared frontend module change is required. |
| Rate-limit race | Authentication and the AI minute limiter now use one transactional SQL operation that locks the counter row. Storage failures deny requests. |
| Preview file exposure | Static serving blocks environment files, Git/internal directories, private configuration and symlinks escaping the public boundary. Host, Origin and Fetch Metadata checks protect local endpoints. Explicit network hostnames can be allowed with `--allowed-hosts=hostname`; loopback remains the default. |

The lockfile updates `tar` to 7.5.22, `@xmldom/xmldom` to 0.8.15, `brace-expansion` to 5.0.9 and `@humanfs/node` to 0.16.8, with their supporting dependency changes. `npm audit --json --ignore-scripts` reports zero known vulnerabilities.

## Verification

- Eight suites passed: core, login/auth, AI, billing, security, bug capture, analytics and Vault/timeleague.
- The security suite includes behavioral endpoint tests, execution of the real SQL migration in PGlite, denial tests for anonymous/authenticated database roles, and HTTP tests against an isolated running preview server.
- New tests cover ordinary-account denial, legitimate administrator and self-service password paths, competing password assignments, free-bundle sign-in claims, stale paid claims, OAuth expiry/replay/browser mismatch/concurrent callbacks, revoked sessions, rate-limit storage failures and private-file access.
- PGlite serializes database queries; tests confirm SQL semantics and accounting, while row locking provides transaction serialization on PostgreSQL. This is not a production load test.
- Deno type checks passed for the shared security helper and all three changed endpoint files.
- The preview build compiled 108 Babel scripts successfully. Updated plist/XML and tar roundtrips passed; Capacitor and ESLint CLIs load successfully.
- `git diff --check` passed.

Run `npm run test:security` for the regression suite. The audit's `reproduce.cjs` entrypoint now runs the fixed-behavior tests instead of asserting the old vulnerabilities.

## Release requirements

Apply `supabase/migrations/20260909000000_security_audit_fixes.sql` **before deploying the changed Edge Functions**. The production workflow now includes this migration in its automatic allowlist and runs security tests before deployment. The migration is transactional, idempotent, and adds server-only OAuth storage and RPCs. It does not rewrite user accounts or league records.

The workflow already redeploys the functions using the shared helper. `league-cup` and `time-league` now also have explicit JWT gateway settings in `supabase/config.toml`, fixing the audit's failed deployment contract. The config file now triggers the backend workflow.

Restart any already-running preview process to load its serving protections. Backend protections become live only after migration and deployment. Real Yahoo consent/cookie handling through the hosted Supabase gateway has not been tested; endpoint tests use a mocked Yahoo provider. Previously provisioned identities and production audit logs were not inspected.
