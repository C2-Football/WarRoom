# Readiness checkpoint

Updated: 2026-09-18. State: **active implementation and controlled integration testing**.

## Baseline and working state

- Source checkout `/Users/jacobc/Projects/warroom`, main at
  `5d28f396a3f41f3e95075264ea2890227907c761`; unrelated untracked work preserved.
- Integration `/Users/jacobc/Projects/warroom-public-readiness`, branch
  `codex/public-readiness-20260918`, frozen integrated product revision `d5cf58d`. Empire journal retries/navigation, account
  callbacks, truthful pick-feed coverage, draft fixes and shared performance are
  integrated, including reviewed Commissioner task/dues, format-specific picks and
  both OAuth/cross-tab authentication race fixes.
- Both WarRoom remotes still baseline; **no frontend/backend readiness deployment**.
  Only the independently verified canonical shared commit has been published.
- Canonical shared dependency published and pinned
  `7bd35313fc78e25a2d1ac24035989673a93f28e6`; remote main verified. Primary shared
  checkout fast-forwarded cleanly, vendored sync and player-value twin agree.
- `node_modules` is an untracked symlink to original dependencies; never stage it.
  Local Node 25.8.1; CI Node 20. Preview running on localhost:3028.
- Persistent goal thread `01a0b5f1-9d40-7202-a6a8-27887434173c` active.
  Astra/Ultra and Prevent sleep could not be independently verified: Computer Use
  refused access to Codex settings; no bypass attempted.

## Integrated fixes and evidence

- Arrival/auth request failures, duplicate submissions, OAuth/session restoration,
  transactional account switch, account-scoped storage and onboarding identity
  guards. Fixture browser journeys and actual callback/unit tests pass; real OAuth,
  checkout and email delivery still require separate verification.
- Validated Sleeper connection, incomplete portfolio coverage, stale-good data and
  retry. Account context preserved; no failed refresh represented as complete.
- Password reset now atomic in the candidate, including password/session version
  change and consumption of all reset links. Database RLS revocation gate protects
  existing public RLS tables. Local database concurrency/rollback/old-session tests
  and independent reviews pass. **Neither migration nor backend is live yet.**
- Duat runtime packs exact historical records, shares immutable season indexes and
  avoids repeated candidate scans. 392 Duat checks and original-vs-new engine parity
  pass. See duat-runtime-batch1.md and independent review. Hosted proof pending.
- Safe native staging includes only compiled allowlisted public assets and verifies
  manifest hashes. Native archive guard remains enforced; distribution provenance
  is unresolved, and build/install/device/store are not verified.
- Responsive draft overflow and redraft specificity corrections are integrated.
  Hydrated responsive matrix126 and live click41 pass on the integrated candidate.
  Shared ranking correction removes the reproduced phone stall. Final draft helper
  now waits for the phone renderer and proves actual tap reachability; 9 checks pass.

## Controlled hosted evidence

- Supabase project `sxshiqyxhhifvtfqawbq` is shared by both frontends. Root worktree
  linked through the existing CLI authorization. Read-only catalog query confirms
  all 49 current public tables have RLS; see evidence/hosted-security-before.json.
- Two disposable accounts created after source review and verified initially empty
  Vault/Duat collections. Credentials/tokens only in mode-0600
  `tmp/public-readiness/accounts.private.json`; never commit or print contents.
- Run ID `readiness-20260918-99b2f837-2a00-4a2d-b337-a17ce0164755`.
- Vault room `9abe0f2c-7f52-4035-984a-606a0b121142`: live API journey PASSED from
  invite/join through sealed draft, controlled competing writes, season completion,
  winner and other-account reopening. Anonymous/nonmember/host-role and private
  response checks pass. See evidence/live-vault.json. This is API proof, not all
  browser journeys or auction/bid privacy coverage.
- Duat room `d5038ca0-15c5-4acf-b7c4-f08e1283161f`: two-account role/private-state/
  competing readiness tests pass, then actual draft load fails HTTP 546 compute.
  Keep this original room for post-release recovery. Script
  `tmp/public-readiness/live-duat.cjs`; evidence/live-duat.json records failure.
  Candidate runtime correction remains hosted-unverified. Do not create a new room
  to hide recovery failure. Check report stage before resuming after a later cycle.

## Current ownership and queued work

- Root: first repair release, hosted verification and original Duat recovery.
  Next root lane is Settings password rotation in isolated
  `warroom-readiness-account-settings` / `codex/readiness-account-settings-20260918`.
  Actual callback/client/endpoint reproduction proves ordinary app accounts call
  the legacy/admin endpoint and fail403. New app rotation is under development,
  not part of this release. Its report is in that worktree.
- Security agent: Commissioner follow-ups/preferences `c2bf7e5` and Genesis/proposals
  `ac502dd` ready and independently reviewed; queue for next integration. Remaining
  ratification/drift/schedule recovery continues isolated.
- Inventory agent: historical deep-link fix `8b28c0e` ready; review reports `8c8765e`
  and `3893a33` queued. Now investigating consumed draft rights, followed by Empire
  seasonal player advice, in `warroom-readiness-empire-seasonal`.
- Native/browser agent: real controlled-account Vault browser journey. Original
  completed room reopened by both users unchangedv22; new isolated Browser Vault
  `e6563c66-2713-4ded-8b1b-c3373261ca41` created/joined through UI. Invite reload loses
  Vault context; isolated correction underway. **Defer account password changes and
  reset contention until this agent finishes its active sessions.**

## Release gate and next executable steps

1. Integrated product source `d5cf58d`: `npm test`43 pass/0 fail/0 suite quarantines;
   ESLint0 errors/33 warnings; production build148 JSX/259 minified modules passes.
   Detailed evidence and qualifications: `candidate-d5cf58d.md`.
2. Full browser run6 pass/1 draft failure. Reproduction established a transient
   desktop-row locator during phone resizing; test-only correction waits for actual
   phone rows and adds trial tap/center-hit assertions. Independent review clear;
   full draft rerun9 pass. All7 browser gate entries now have passing candidate
   evidence. Keep original failure log. Other product source remains identical.
3. Analytics detail inspection: one older individual WIP assertion still reports
   missing landing funnel telemetry. This remains open; no full diagnostics pass.
4. Both public release metadata endpoints and Git mains still baseline5d28f39.
   Publish this reviewed repair batch through canonical backend and both Pages
   workflows, wait for terminal statuses, then run `verify-release.cjs <full-sha>`.
5. Inspect `verify-hosted-release.sql` catalog evidence for migration records,
   restrictive gates and grants; verify public reset redirect resolves. No hosted
   migration has been applied manually in this goal.
6. Resume original Duat room via `tmp/public-readiness/live-duat.cjs` after backend
   deployment. Preserve first failure evidence and record recovery/new cycles.
7. After Vault browser agent releases its sessions, run prepared
   `tmp/public-readiness/live-reset.cjs`: exact controlled account identities,
   competing reset links, old-session Edge/REST revocation, replay, fresh login and
   existing game retention. Private plan prevents blind mutation reruns.
8. Integrate queued reviewed product batches and continue the remaining acceptance
   matrix. Account settings, Commissioner stores, seasonal Empire advice, historical
   routes, browser game completion and operational diagnostics remain unfinished.

## Outstanding scope and external boundaries

- Commissioner silent saves, other suite save/recovery/error paths, historical
  deep-link season restoration, full public onboarding/account/settings flows,
  format-correct Empire scenarios, Wire/history, Draft and server authorization
  checks remain in scope. See inventory.md; no product is fully ready yet.
- Vault archive provenance conflicts with the native distribution restriction.
  Existing source notes mark older local Kaggle/PFR history non-distributable;
  no cleared complete replacement identified. Do not bypass guard or silently
  truncate promised history. Native toolchain/device/store evidence absent.
- No external action requested while independent authorized work remains. Public
  pricing/policies/legal/store approval claims must not be invented.
