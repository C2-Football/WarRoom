# Public readiness — truthful and recoverable drift acknowledgment

Date: 2026-09-20. Branch `codex/readiness-callbacks-20260918`, after `042b13d`. No remote writes/deployment. This is a bounded INV-03 persistence repair; schedule/corrupt-save recovery and whole-product validation remain unfinished.

## Reproduction and repair

Drift's baseline/pending/acknowledgment saves ignored false storage results. The office also swallowed amendment failures before clearing the drift baseline. This could report a captured baseline or completed acknowledgment without durable history.

The engine now requires confirmed writes. Failed baseline or pending capture retains any previous record and returns an explicit storage error, preserving detected changes for the view. Operations offers a retry and does not label the result quiet; Genesis does not count unsaved tracking as ready. The copy describes checks made when opening the office, removing the unsupported nightly-check claim.

Acknowledgment persists the full local amendment batch before advancing the baseline. Both records use checked writes; a stable batch identifier allows a failed baseline write to be retried without duplicating already saved amendments. The office reports incomplete progress and retains pending state. It rechecks before acknowledgment, refreshes the displayed result on recovery, and never claims provider settings changed. Mounted account invalidation blocks these writes and the initial async load's engine pass.

## Verification

- `tests/commish-drift-recovery.cjs` uses actual Drift/Bylaws engines, container callbacks, save hook and rendered Ops JSX. Covers failed initial baseline, failed changed-state capture, amendment write failure, baseline failure after a successful ledger write, navigation protection, retry, reopened state, and invalidated-account rejection.
- `tests/commish-genesis.js` includes failed-tracking readiness; all 36 checks pass. All 15 existing Drift rules still pass.
- Full `npm run test:commish`, `npm run build:preview`, and `git diff --check` pass.
- Real Chromium 390 × 844, isolated fixture using production engines/account storage/office callbacks/Ops panel: failed baseline acknowledgment left two amendments, zero acknowledgments, pending changes, and an incomplete warning. Restore storage → Retry → reload retained two amendments, one acknowledgment, zero pending changes. No real user/league records were used. This is local component/browser proof, not hosted, physical-device, or concurrent-tab proof.

- Independent product_inventory review reran the actual recovery regression and Genesis suite, and found no material issue in this bounded failure/retry contract. Concurrent tabs and malformed storage remain separate evidence gaps.

## Next work

Schedule controls still need retained draft/retry recovery and async identity/version protection. Malformed local proposal data must remain preserved while the office offers recovery. Parent owns integration and final release evidence; do not mark Commissioner ready based on this batch.
