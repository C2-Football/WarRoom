# Readiness checkpoint

Updated: 2026-09-18 19:45 UTC. State: **active implementation and controlled integration testing**.

## Baseline and working state

- Source checkout: `/Users/jacobc/Projects/warroom`, `main`, revision
  `5d28f396a3f41f3e95075264ea2890227907c761`. Untracked mockups/mobile reports
  intentionally preserved, not part of this release.
- Integration worktree: `/Users/jacobc/Projects/warroom-public-readiness`.
- Branch: `codex/public-readiness-20260918`, current integration revision
  `13ece66` (auth/arrival, guarded native staging, validated Sleeper connections).
  Both remotes still match the original baseline; no readiness batch deployed.
- Canonical `dhq-shared` checkout is clean at pinned
  `5de7baa36225c43e8cacb00a2763e4c65508f296`; `../reconai` exists and is preserved.
- Installed dependencies are reused via a symlink to primary `node_modules`;
  it is untracked and must never be staged (the directory ignore does not match
  the symlink). Lockfile matches baseline. Local Node v25.8.1; CI Node 20.
- Persistent goal active in thread `01a0b5f1-9d40-7202-a6a8-27887434173c`.
- Requested Astra/Ultra configuration is not independently confirmed through an
  available configuration control. Computer Use refused access to the Codex app,
  so “Prevent sleep while running” could not be changed or verified. No bypass.

## Releases

- Production: `https://c2-football.github.io/WarRoom/`.
- Sandbox: `https://c2-football.github.io/WarRoom-sandbox/`.
- Existing GitHub Pages and CI production workflows succeeded at baseline;
  backend workflow also succeeded. Live asset matching still needs fresh proof.
- Backend: shared Supabase project `sxshiqyxhhifvtfqawbq`; canonical repository
  alone deploys edge functions and allowlisted migrations.
- No readiness changes deployed yet. Recovery baseline is the SHA above;
  establish batch-specific backend compatibility before each deployment.

## In progress

1. Root: real isolated-account Vault/Duat API journeys, authentication transaction
   integration, release evidence and readiness record. Private disposable account
   credentials live only in mode-0600 `tmp/public-readiness/accounts.private.json`.
   Sanitized evidence confirms two distinct identities and initially empty game
   collections. Local Duat run uses only the run-ID-named test campaign.
2. Security agent: isolated `warroom-readiness-security`; account-scoped plans,
   transactional sign-in/sign-out/cross-tab recovery; then atomic password-reset
   server correction with local database rehearsal. No agent remote mutations.
3. Native agent: isolated `warroom-readiness-native`; staging correction integrated,
   now repairing obsolete browser fixtures/controls and guarding external writes.
4. Inventory agent: `warroom-readiness-portfolio`; failed/partial provider coverage,
   stale-good refresh and honest Empire denominators. Connection correction and
   source inventory already integrated; independent storage review complete.

## Evidence so far

- Baseline `npm test`: 39 passed, 0 failed, 1 preexisting landing-content quarantine
  out of 40 suites. Quarantine is not counted as a pass. Final candidate must rerun.
- Six repaired arrival/auth/onboarding/billing fixture browser flows pass. They
  use real browser interaction, mocked service responses and blocked external
  writes; they do not establish real OAuth, reset delivery or checkout.
- Live disposable account signup/sign-in/profile and initial empty Vault/Duat
  collections pass against the existing shared backend. No customer records used.
- Integrated production compilation passes; native staging and connection
  focused regressions pass. Native build/install/device/store remain unverified.
- Original browser suite had obsolete labels, invalid seeds and live-season
  assumptions. Explicit runner now executes all five suites and fails on skips.
  Original live-click-path run was interrupted, not passed; guarded rerun pending.

## Known high-priority unfinished findings

- INV-01 account isolation changes await integration of transactional login API.
- INV-03 failed local saves can still return success; retained drafts/retry needed.
- INV-04 partial Sleeper details can show a false complete/empty portfolio (active).
- Reset token consume/password/session invalidation require one atomic operation.
- Vault archive provenance conflicts with the existing native distribution guard.
  Safe native staging is solved; archive clearance/replacement and native release
  remain blocked. No guard bypass or reduced historical coverage authorized.
- Historical deep-link season recovery (INV-05), full fresh-user browser paths,
  deployed authorization/recovery, performance/accessibility and final independent
  review remain incomplete. See inventory for all required products.

## Next executable steps

1. Resume `tmp/public-readiness/live-duat.cjs` from its evidence/checkpoint; inspect
   failure before retrying to avoid duplicate rooms. Add isolated Vault journey.
2. Integrate security helper and use `prepareSignIn(nextSession, updates)` to make
   identity/context writes transactional; verify actual helper in login tests.
3. Integrate independent review and guarded browser fixes. Run `npm test` and
   `npm run test:browser`, inspect all failures/quarantines, preserve missing proof.
4. Resolve failed-save and provider-coverage defects, then remaining matrix.
5. Release only coherent verified batches, verify workflows, metadata/assets and
   post-deployment journeys on both destinations. Backend migrations need safe
   rehearsal and compatibility review before deployment.

No product is marked fully ready yet. Setup limitations do not block productive
repository work. External blockers will be consolidated only after independent
authorized work is exhausted.
