# Readiness checkpoint

Updated: 2026-09-18. State: **active implementation and controlled integration testing**.

## Baseline and working state

- Source checkout `/Users/jacobc/Projects/warroom`, main at
  `5d28f396a3f41f3e95075264ea2890227907c761`; unrelated untracked work preserved.
- Integration `/Users/jacobc/Projects/warroom-public-readiness`, branch
  `codex/public-readiness-20260918`, current integrated code revision `2434e1a`. Empire journal retries/navigation, account
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
- Real browser draft overflow fix integrated; independent review found a redraft
  specificity follow-up still needed. Responsive browser matrix updated to wait for
  hydrated content, with 126 checks passing in agent worktree; integration pending.
  Intermittent phone UI stall reproduced and profiled to shared player ranking.

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

## Current ownership

- Root: Empire save/navigation recovery; integrated release gates, hosted schema
  compatibility, release record, safe test-account operational verification.
- Security agent: callback guard commit `ec61010` integrated/reviewed; Commissioner
  task/treasury failed-save recovery under development. Other silent-save stores
  remain explicit unfinished findings. Independent root navigation review.
- Inventory agent: traded-pick ownership failures/stale-good batch integrated;
  independently reviewed callback/journal/security changes. Format-specific draft
  capital correction now active after reproducing dynasty advice in redraft.
- Native/browser agent: canonical shared ranking performance, hydrated browser
  fixtures and redraft overflow specificity follow-up. No agent pushes.

## Release gate and next executable steps

1. First frozen frontend candidate c288d84: npm test 40 pass / 3 fail / 0 quarantined.
   The three stale harness failures are reproduced and fixed without app changes
   (fc663b7). Actual browser gate PASSED all 7 entries: 126 responsive checks, 6 arrival/auth
   flows, 41 live click paths, 9 draft checks, league skin matrix, Empire recovery
   and external-write guard preflight. Logs under evidence/candidate-c288d84.
   These precede the latest authentication/Commissioner/format integrations.
2. Release reviewer found delayed OAuth restoration overwrites newer explicit login;
   then adjacent pending explicit sign-in overwrites another-tab login. Both corrections (64a099 + 97d7a10) are integrated with independent security
   review and full-script regressions passing. No deployment yet.
3. Root fixed actual hosted reset links redirecting to a nonresolving old hostname
   (5835b11). Both URL override secret names absent; existing production reset page
   HTTP 200. Handler regression+independent review pass; live fallback remains old
   until deploy. Post-deploy probe and controlled reset script prepared (not run):
   tmp/public-readiness/live-reset.cjs. It asserts exact disposable IDs, checks both
   migrations, seeds only their reset hashes via existing CLI, races links, verifies
   revocation/re-signin/game retention. Raw tokens/passwords remain mode-0600 only.
4. Commissioner task/dues+review, pick format+blank-type correction and agent
   terminal click-path evidence are integrated. Focused Empire, Commissioner and
   login suites pass. Freeze this batch for renewed integrated broad/browser gates.
   Further Commissioner stores and INV05 historical deep links continue isolated.
   Native/browser agent is now exercising real controlled-account Vault UI using
   its own worktree/preview. DEFER PASSWORD RESET until that agent reports its
   sessions finished; root reset would revoke those sessions. Preserve original
   completed API Vault and failed Duat rooms.
5. Inspect current hosted auth table/function signatures read-only; compare to both
   new migrations and rehearse compatibility. Establish reversible frontend/backend
   rollback while keeping additive security migration protections in place.
6. Run fresh integrated `npm test`, all explicit applicable suites and browser gate;
   inspect failures and quarantines. Baseline was 39 pass / 0 fail / 1 preexisting
   landing-content quarantine, **not a final-candidate pass**. Browser gate now
   includes external-write guard preflight and failed-save journey.
7. Release coherent validated batch through established canonical dependency,
   backend and Pages workflows to both destinations. Verify terminal workflows,
   release metadata, served asset hashes and actual post-release journeys.
8. Resume original Duat room; verify atomic reset and direct REST revocation using
   only isolated test accounts; finish remaining product/format/error/permission/
   persistence matrix and independent final review.

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
