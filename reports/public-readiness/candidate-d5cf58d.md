# First integrated repair release candidate

Product source frozen at `d5cf58d2a8a461b2432ebaab23f63808a3a6f2e5`.
This batch repairs reproduced defects; it is not a full-suite launch sign-off.

## Gates

- `npm test`: **43 suites passed, 0 failed, 0 suite quarantines**, 118 seconds.
  Includes security, login/auth, billing, Empire, Commissioner, Vault, Duat,
  workspaces and live-score suites. See `evidence/candidate-d5cf58d/npm-test.log`.
- ESLint: exit 0, **0 errors / 33 warnings**. Warnings remain recorded in
  `evidence/candidate-d5cf58d/eslint.log`; this is not a warning-free claim.
- Production build: passed, 148 JSX modules compiled and 259 modules minified;
  all five application entries, including `draft-war-room/index.html`, rewritten.
- Explicit browser gate: the full run passed six entries but exposed a transient
  renderer assertion in the draft helper at 320px. Its generic Draft locator saw a
  desktop row during the phone transition. The focused reproduction also observed
  that row detach; the actual phone renderer passed after normal actionability
  scrolling. The helper now waits for `.la-live-draft .wr-asset-row`, keeps the
  horizontal bounds check, and additionally proves a trial tap and center hit test.
  Independent reviewer product_inventory cleared this test-only correction.
  The full draft suite then passed **all 9 checks**; no product code changed.
  Combined gate evidence: 126 responsive checks, 6 arrival/auth flows, 41 click
  journeys, 9 draft checks, league-skin matrix, Empire save/reload/Back recovery,
  external-write-isolation preflight. Original failure and successful rerun are
  both preserved in `evidence/candidate-d5cf58d/`.
- Independent area reviews and batch authentication/migration review passed after
  both reproduced account races were fixed. Review reports remain linked in the
  checkpoint. Queued later Commissioner/history fixes are not in this candidate.

## Coverage qualification

The suite runner has no quarantined suites. Inspection also found an older
**individual WIP assertion** in `tests/analytics-report.js`: removed landing funnel
instrumentation is still missing and does not fail that suite. This is an open
operational-diagnostics item, not a passing telemetry requirement. It is separate
from the retired landing-content suite quarantine. No missing browser/runtime
dependency or skipped browser suite is accepted by the browser gate.

Local browser tests use isolated fixtures and block external writes. Hosted
controlled-account API evidence is separate. Physical-device, native build and
store distribution remain unverified; the native provenance guard remains active.

## Deployment state and recovery

Before release, both deployed metadata endpoints and Git remote main references
match `5d28f396a3f41f3e95075264ea2890227907c761`. See
`evidence/releases-before.json`. The read-only release verifier deliberately failed
on the old standalone draft entry because it still ships runtime Babel; the new
production build includes that entry. No live claim is inferred from local output.

The additive security migrations match the inspected hosted schema; local SQL
rollback/replay and revocation rehearsals pass. See `release-compatibility.md`.
Only the canonical repository deploys the shared backend. Recovery uses ordinary
component/frontend revert commits while preserving the new revocation protections.

After successful deployment, run `node reports/public-readiness/verify-release.cjs
<full-release-sha>`, inspect read-only catalog evidence using
`verify-hosted-release.sql`, verify controlled hosted reset contention and resume
the original failed Duat room. Do not reset the controlled account while the Vault
browser agent is using its sessions.
