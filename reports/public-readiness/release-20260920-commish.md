# Commissioner recovery release — September20

State: validated C2 frontend candidate, not yet deployed. Product code065dab0; later commits contain evidence/checkpoints only. Existing destinations are WarRoom and WarRoom-sandbox. Actual dhqfootball.com/native/shared changes remain separate draft proposals. Entire suite is not ready.

This batch preserves unreadable saved proposals before recovery and retains draft names on failed saves. Rule ratification now binds each league amendment and its retry marker to the proposal contents, so a concurrently edited proposal cannot inherit an earlier version's success. Legacy partial records without content proof require explicit amendment review instead of guessed completion. The visible operations remain local planning; there is no claim of publishing provider rules.

## Acceptance and compatibility

- Full integrated npm test:43 passed,0failed,0quarantined. All13 browser suites attempted and passed.147 compiled scripts; canonical shared7bd35313fc78e25a2d1ac24035989673a93f28e6 remains unchanged and its player-value twin matches. Detailed logs: evidence/commish-final-integrated-{tests,browser}-sep20.log.
- Actual compiled-app320×700,390×844,844×390: hub→Commissioner→Rules, unreadable data, failed backup, exact original-byte download, successful preserved copy, failed save, retry, reload, reopened proposal and downloadable recovery copy. No page errors/overflow; recovery controls at least44px. Provider/account data are controlled fixtures; external writes are blocked.
- Independent source/callback/Node20/browser review cleared the bounded change after reproducing and correcting the concurrent ratification finding. See commish-proposal-independent-review-20260920.md.
- Diff from served944c2e9 contains only Commissioner browser code, matching entry cachebusters, tests and reports. No backend, SQL, deployment workflow, shared pin or game engine source differs. The prior reviewed frontend/backend contract remains compatible. This batch needs no migration or backend deployment; normal push release jobs must remain skipped. Billing/deletion cutover remains held.

## Shared-host preflight incident

The18:57UTC read-only preflight found seven account endpoint versions changed around18:53UTC. Fresh downloads exactly matched the older native mainaa13193 entrypoints and security helper, reintroducing the already reproduced account/reset defects. fw-change-password remained unchanged. The latest visible native deploy workflow remains the12:38UTC run; no actor/cause is inferred. Root selectively restored the same seven reviewed functions after confirming their local bytes against the preserved manifest. No schema, billing/provider or unrelated function was changed. Fresh downloads of all eight bundles/helpers match the unchanged reviewed manifest. Both current owned profiles are accepted and the exact Duat save remains revision113, cycle2 Week1. Restoration completed18:59:43UTC; source verification and smoke passed after it. See hosted-auth-reversion-20260920.md and evidence/auth-second-*.json. Permanent upstream ownership remains blocked by missing native workflow/write access.

## Dispatch, verification and recovery

Both remote heads were rechecked at944c2e9. Fast-forward only the exact selected revision to both existing main branches; preserve unrelated original checkout changes. Verify all six workflows to terminal success and both game release jobs skipped. Compare release.json revision/repository and every advertised script/game asset hash on both sites, then run the actual served Commissioner recovery journey with isolated browser storage/provider fixtures and a real controlled-account reopen.

For a frontend regression, rerun only the known-good previous frontend Pages workflows at944c2e9: canonical35525512110 and sandbox35525513723. Verify the rollback assets. Preserve the backend guard; never restore blanket backend deployment or force-push shared history. Local recovery archives are additive and remain in browser storage; rollback does not require data deletion.

Exact dispatch revision, workflow IDs, served assets and postflight checks will be appended after verification.
