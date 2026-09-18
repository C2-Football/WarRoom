# Public readiness — season checklist and saved Rule Lab proposals

Date: 2026-09-18. Branch `codex/readiness-callbacks-20260918`, after `c2bf7e5`. No remote mutation or deployment. This is another bounded INV-03 persistence repair, not completion of Commissioner release readiness.

## Reproductions and repairs

- **Season checklist:** the previous Genesis engine returned `done:true` even when account storage rejected the write, while readiness continued to read `done:false`. Writes now require confirmation and the container reports failure without claiming a new checklist state. Retrying changes the stored checkbox once.
- **Proposal save:** the prior container ignored storage failure and the Rule Lab form cleared its typed name after the callback regardless of result. The name and staged rule/roster changes now remain available after rejection; only a confirmed save clears the name. Retry reads the latest rules and current saved list. Failed deletion keeps the saved proposal and remains retryable.
- Loading another saved proposal is blocked while a save is unresolved. Explicit reset/discard clears the failed add intent and its unsaved staged proposal; existing saved proposals remain untouched. The shared failure helper supports per-operation discard handlers, so this is an explicit recovery action rather than a false success.
- Ratification's error key is separate from new-proposal saving. **Ratification itself remains unfinished:** its multi-league amendment writes still require checked, idempotent recovery. This batch does not claim to fix it.

## Verification

- `tests/commish-plan-recovery.cjs` executes the actual container callbacks and shared recovery hook: failed/newer-rule retry, unchanged failed-delete record, successful deletion, pending navigation, explicit discard, and checklist status changes only after confirmed storage.
- `tests/commish-genesis.js`: 35 checks pass, including failed checklist writes before/after a saved state. `tests/commish-rulelab-panel.js`: 39 checks pass, including the actual JSX name field and Save button across rejection and retry.
- `npm run test:commish`, `npm run build:preview`, and `git diff --check` pass with the updated matching canonical shared twin.
- Chromium at 390 × 844, local isolated fixture with the actual Rule Lab panel, account storage and proposal callbacks: opened Saved Proposals, typed `Keep this 2027 proposal`, rejected saving, observed the retained name and error with zero stored proposals; restored storage, retried and reloaded; exactly one draft retained that name and `rec:1`. This is local component/browser evidence, not hosted or physical-device validation. No user records were used. Expected fixture console messages were the React 18 legacy-render warning and a missing favicon.
- Independent product_inventory review reran all 35 Genesis checks, 39 Rule Lab panel checks and the actual callback regression. No unresolved material issue was found in this bounded change.

## Remaining work

Commissioner launch remains blocked on Rule Lab ratification, drift/amendment coordination and schedule persistence/recovery. The reviewer also identified an existing malformed-local-record recovery gap: a non-array `commish_rulelab_proposals` value violates current render and mutation assumptions. Do not count corrupt-record recovery as verified. Root owns final integrated browser/release evidence and the independent account-password-settings repair.
