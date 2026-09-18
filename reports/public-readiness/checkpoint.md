# Readiness checkpoint

Updated: 2026-09-18. State: **active initial assessment and first fixes**.

## Baseline and working state

- Source checkout: `/Users/jacobc/Projects/warroom`, `main`, revision
  `5d28f396a3f41f3e95075264ea2890227907c761`. Untracked mockups/mobile reports
  intentionally preserved, not part of this release.
- Integration worktree: `/Users/jacobc/Projects/warroom-public-readiness`.
- Branch: `codex/public-readiness-20260918`, clean baseline fetched from
  `origin/main`; both remotes match baseline.
- Canonical `dhq-shared` checkout is clean at pinned
  `5de7baa36225c43e8cacb00a2763e4c65508f296`; `../reconai` exists and is preserved.
- Installed dependencies are reused via a gitignored symlink to primary
  `node_modules`; lockfile matches baseline. Local Node v25.8.1; CI Node 20.
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

1. Root: baseline `npm test`, explicit browser journeys, initial journey fixes,
   integration, release evidence and readiness record.
2. Security agent: isolated `warroom-readiness-security` worktree; server private
   state and permissions, reproducible first security batch, no remote mutation.
3. Native agent: isolated `warroom-readiness-native` worktree; solve packaging
   cause and verify build stages without weakening guard.
4. Inventory agent: read-only route/product/dependency map and evidence gaps.

## Next executable steps

1. Inspect `evidence/baseline-npm-test.log`, all failures, skips and quarantines.
2. Run `npm run test:browser` and inspect results independently of unit checks.
3. Verify fresh-user journeys using realistic browser interaction and isolated
   test data. Prioritize reproduced high-severity findings.
4. Integrate only reviewed, tested agent commits; run focused and broader checks.
5. Continue product acceptance matrix, then release coherent verified batches.

No product is marked fully ready yet. Setup limitations do not block productive
repository work. External blockers will be consolidated only after independent
authorized work is exhausted.
