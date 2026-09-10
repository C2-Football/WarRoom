# War Room security review — September 9, 2026

**Remediated locally after this audit.** See [fixes and verification](remediation.md). The findings below preserve the original audit evidence; their line numbers refer to the pre-fix source. `reproduce.cjs` now runs the regression checks for the fixed behavior. Production deployment remains pending.

Reviewed `/Users/jacobc/Projects/warroom`, including the existing uncommitted changes, at base commit `5588db12e6da978a6377664be164889eadafd3ce`. Scope was inferred from recent project context; ReconAI and warroom-draftfix were not audited.

Found **five code-level issues: two high and three medium**, plus **four dependency packages with published advisories**. Prioritize the Sleeper identity and AI entitlement fixes. Findings describe the local source; deployed function versions, production database permissions and production exploitability were not verified. No production account operations or exploit requests were made. Application source and dependencies were left unchanged.

## 1. High — Ordinary app users can claim unrelated Sleeper identities

**Location:** [set-password/index.ts:49](../../supabase/functions/set-password/index.ts#L49), particularly the app-session branch at lines 79–81 and service-role upsert at lines 107–117.

Any active app session may select a target Sleeper username and create its password when the target has no existing password. The public Sleeper lookup establishes only that the username exists. There is no administrator check or evidence that the caller controls the target identity.

An attacker can register an ordinary app account, call `set-password` with another person's passwordless Sleeper username and an attacker-selected password, then authenticate through `get-session-token`. That endpoint issues `app_metadata.sleeper_username` for the target. The legacy RLS policies trust this claim for private owner data, messages, draft boards and other records. The Cup service also derives commissioner identity from the signed Sleeper username. This compromises the identity inside Dynasty HQ; it does not establish access to the external Sleeper account.

**Evidence:** An offline execution of the actual handler returned success and wrote a password and `is_gifted: true` for an unrelated target using a mocked ordinary app session. Login issuance and downstream permissions were traced in `get-session-token/index.ts`, `schema.sql`, `legacy-reconai-migrations/014_rls_lockdown.sql`, and `league-cup/index.ts`.

**Fix:** Restrict gift provisioning to a verified administrative workflow, and require verified identity binding before minting a Sleeper principal. Public username existence must not establish ownership. Make first-password assignment atomic so parallel requests cannot overwrite a password created after the initial check. Add negative tests for unrelated free accounts and concurrent claims.

## 2. High — Free bundle accounts receive Pro AI authorization

**Location:** [ai-analyze/index.ts:103](../../supabase/functions/ai-analyze/index.ts#L103), with the claim source in [fw-signin/index.ts:83](../../supabase/functions/fw-signin/index.ts#L83).

Signup accepts `productSlug: "bundle"` and provisions a free subscription. On subsequent sign-in, the server expands that subscription into `products: ["war_room", "dynast_hq"]` while correctly retaining `tier: "free"`. `loadAppAIPlan` finds no paid subscriptions, falls back to these product claims, and treats possession of both products as sufficient for Pro.

The resulting server-side plan permits Pro request budgets, model tiers and web search without payment. This does not require forging a JWT or bypassing the browser interface. The same fallback logic can also retain a former paid tier from an unexpired token after cancellation.

**Evidence:** The offline harness ran the actual sign-in handler, including password verification, against a synthetic free bundle subscription, captured its issued claims, and passed them into the actual plan resolver. The result was `plan: "pro"` despite a database containing only a free subscription. JWT signing was stubbed; claim generation and authorization logic were executed unchanged.

**Fix:** Derive paid authorization exclusively from current active/trialing subscriptions whose tier is `pro`, or an explicit server-side admin role. Treat product membership separately from payment status. A database error or absence of a paid subscription must not revive paid JWT claims. Test free bundle signup/sign-in, cancellation, past-due subscriptions and database failures.

## 3. Medium — Yahoo callback trusts forged OAuth state

**Location:** [yahoo-proxy/index.ts:155](../../supabase/functions/yahoo-proxy/index.ts#L155), plus state creation at lines 269–273 and token storage at lines 199–201.

OAuth state is unsigned base64 JSON containing `ownerKey`, return URL and a nonce. The callback decodes it and accepts the owner without verifying that the server issued the state, that the nonce belongs to the initiating session, that it has not expired, or that it has not already been used. An allowed return origin does not provide these checks.

With a valid authorization code and a chosen target owner identifier, an attacker can submit a callback that stores a Yahoo connection under that owner. This creates an account-linking CSRF risk: a victim can be induced to adopt an attacker-controlled Yahoo connection. The local test establishes arbitrary owner binding, not theft of an arbitrary victim's Yahoo token; real Yahoo code exchange and a two-browser attack were not exercised.

**Evidence:** The actual callback accepted a never-issued nonce and a client-selected owner, stored mocked tokens under that owner and returned HTTP 302.

**Fix:** Use a cryptographically random, expiring, single-use state record stored server-side with owner, approved return URL and initiating-session binding. Consume it atomically before completing account linking. Validate active app-session versions on Yahoo API/refresh actions as well; `requesterKey` currently checks the signature but does not perform the shared session-version lookup.

## 4. Medium — Concurrent requests bypass authentication rate limits

**Location:** [security.ts:166](../../supabase/functions/_shared/security.ts#L166), especially the separate read and upsert at lines 184–197.

Rate limiting reads a counter, increments it in application memory and overwrites the database row. Parallel requests can all see the same old count, pass the limit and overwrite one another. Sign-in, legacy login, signup and password reset use this helper. Database errors are also not checked, allowing requests to continue without a successfully persisted limit.

**Evidence:** With an eight-attempt limit and seven attempts already recorded, the offline concurrency fixture admitted all 20 simultaneous calls. The final database counter was eight. This is a deterministic reproduction of the lost-update condition, not a load test against production.

**Fix:** Move counter increment, window reset and lockout evaluation into one transactional database operation with row locking or an atomic upsert. Handle storage failures explicitly. The AI endpoint's separate KV limiter also uses a read/set sequence and should use atomic compare-and-set or an atomic counter.

## 5. Medium — Development server exposes environment and Git files

**Location:** [serve-static.cjs:77](../../scripts/serve-static.cjs#L77), with default root/host configuration at lines 42–45.

The path resolver allows any file inside the served root, including `/.env.local` and `/.git/config`. The repository has a local environment file, and this same server explicitly loads it for provider credentials. Lexical root containment also does not stop symlinks from resolving outside the root.

Exposure requires access to the preview server. It defaults to loopback, so this is not evidence of a public production leak; risk increases when the preview is bound to a network interface, forwarded or exposed through a tunnel. The server has no Host allowlist to mitigate DNS-rebinding access.

**Evidence:** The actual path resolver returned both a synthetic `.env.local` and `.git/config` from an isolated temporary directory. No real environment values were read or included in this report. The HTTP handler streams paths returned by this resolver.

**Fix:** Serve an explicit public build directory or restrict paths to approved public assets. Block dotfiles and internal directories, enforce containment after resolving symlinks, and validate Host/Origin for local service endpoints.

## Dependency audit

`npm audit --json --ignore-scripts` reported four affected packages: one critical, two high and one moderate. These are package advisory severities, separate from assessed application findings above.

| Package | Installed | Advisory severity | Dependency path / exposure |
|---|---:|---|---|
| `tar` | 7.5.11 | Critical | `@capacitor/cli`; archive-processing resource exhaustion advisories |
| `@xmldom/xmldom` | 0.8.13 | High | `@capacitor/cli → plist`; XML injection and denial-of-service advisories |
| `brace-expansion` | 5.0.5 | High | `eslint → minimatch`; expansion denial-of-service advisories |
| `@humanfs/node` | 0.16.7 | Moderate | `eslint`; recursive copy can follow symlinked files outside the source tree |

These paths are mobile/build/lint tooling; no browser or Edge Function request path to these particular installed packages was established. `npm audit` reports fixes available for all four. Refresh compatible dependencies and the lockfile, rerun the audit, and validate mobile/build tooling. Do not interpret the critical package label as demonstrated remote code execution in the live website.

Sources: [node-tar advisory](https://github.com/advisories/GHSA-23hp-3jrh-7fpw), [xmldom advisory](https://github.com/advisories/GHSA-965w-775f-mr7g), [brace-expansion advisory](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [humanfs advisory](https://github.com/advisories/GHSA-p498-v437-472g). The audit returned additional advisories for some of these same packages.

## Verification and limits

- `node reports/security-audit-2026-09-09/reproduce.cjs`: five vulnerable behaviors reproduced offline. This harness deliberately asserts current vulnerable behavior; success means reproduction, not a security pass. It stubs all remote services and uses synthetic credentials.
- `node tests/security-contract.js`: 15 passed, one failed. The failure is missing `league-cup` JWT configuration in `supabase/config.toml`. CI explicitly passes `--no-verify-jwt`, so this is deployment/configuration drift, not a demonstrated authentication bypass.
- Vault sealed-state database integration, public endpoint boundary tests, and private messaging endpoint tests passed. These independently support the current local sealing implementation previously described in project notes.
- A pattern scan covered 544 tracked text files smaller than 4 MB for private-key blocks, common provider credentials and service-role JWTs; no matches were found. This was not a full Git-history scan or a comprehensive secret scanner. Real `.env.local` contents were not inspected.
- Reviewed authentication and reset flows, AI authorization, OAuth/proxy handlers, relevant RLS migrations, static serving, selected HTML sinks and deployment workflows. This is a targeted security review, not an exhaustive proof that all code is secure. npm audit does not cover separately resolved Deno/npm/CDN imports.

Recommended order: fix identity provisioning and paid AI authorization first; then OAuth state binding and atomic rate limits; harden the preview server and refresh dependencies. Add behavioral regression tests alongside each fix. Preserve existing unrelated working-tree changes.
