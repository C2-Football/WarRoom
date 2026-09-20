# Independent Commissioner proposal recovery review

Reviewed source: `a553617` plus correction `821eb5c` in the isolated C2 worktree `warroom-readiness-commish-proposals-review`, based on `d12849d`. No product source or remote state was changed by this reviewer. This review concerns C2 Commissioner; it does not establish that the divergent actual-public site contains the product.

## Bounded recovery disposition

No material finding in the damaged-list recovery mechanism itself. The module reads account-scoped raw bytes before parsing, validates list and row shape, and refuses create/delete/ratification writes from an unreadable list. Recovery requires a confirmed copy before clearing the active list. It checks observed account/source changes before both writes. An unreadable earlier archive is preserved rather than overwritten. Saved proposal names clear only after a confirmed new save; the recovery copy remains downloadable after new saves and reopening.

The review separately exercised writes that persist bytes but return an unconfirmed result. Both backup and main-list cases retain the original raw content in at least one place and return truthful failure text. This is synchronous optimistic browser-storage checking; it is not a cross-tab transaction guarantee.

## Material adjacent finding: changed content during ratification

The actual ratification callback was reproduced with a saved `p3` proposal whose reception score is 1. After its first league amendment write, the source list changes the same proposal ID to score 2. The callback returns success and marks the newer score-2 proposal ratified, while the ledger records score 1. Merely checking whether the ID still exists does not establish that its recorded content is unchanged.

The rerunnable [actual-callback reproduction](evidence/commish-proposal-review/ratification-observed-change.cjs) and [original failure](evidence/commish-proposal-review/ratification-before.log) use only isolated in-memory records. Root accepted this finding and corrected it in `821eb5c` with semantic-content fingerprints, guarded per-league/status writes, and durable retry checks. Legacy partial markers lack content proof and must not be assigned an inferred fingerprint or replayed under a new input-derived operation ID.

Final bounded disposition: **clear after correction**. The same actual-callback reproduction now returns false, preserves the changed proposal as a draft and leaves its earlier ledger entries intact. The actual new regressions establish that a changed-content retry makes no writes, restoring identical semantics (including reordered scoring keys) permits an idempotent retry, and a legacy marker without content proof remains unchanged with explicit review guidance. Existing non-fingerprinted marker users retain prior behavior. The fingerprint is stored in the same confirmed ledger record as rows and completion, not in a separately vulnerable write.

Independently reran the final callback tests, the original reviewer reproduction, and full `test:commish` under Node20 after the correction. [Final reproduction](evidence/commish-proposal-review/ratification-after.log), [final Commissioner suite](evidence/commish-proposal-review/commish-final-node20.log). No material finding remains in this bounded raw-data recovery and ratification correction. This is not a whole-product readiness or deployed-source claim.

## Independently rerun evidence

- Full `test:commish` under Node 20.20.2, including 10 new recovery groups and existing plan/ratification/panel/Drift tests: [passed](evidence/commish-proposal-review/commish-node20.log).
- Explicit canonical C2 shared revision `7bd3531` preview build: 147 compiled scripts, [passed](evidence/commish-proposal-review/build.log).
- Actual compiled local app at `a553617`, synthetic provider data and all external writes blocked: full hub → Commissioner → Rules journey at 320×700, 390×844 and 844×390, [passed](evidence/commish-proposal-review/browser.log). Corrupt-list read, failed backup, exact original-data download, retained name, confirmed copy, failed new-proposal save, retry, reload and reopening all passed. No page exceptions or horizontal overflow. Recovery-copy controls meet 44px; reviewer visually inspected the 320px recovery screen.
- [Written-but-unconfirmed storage checks](evidence/commish-proposal-review/unconfirmed-write-check.cjs): [passed](evidence/commish-proposal-review/unconfirmed-write.log).

The follow-up leaves the recovery UI unchanged; its semantic retry correction was independently tested through actual callbacks. Root owns final integrated broad/browser gates and release verification. This evidence is local responsive-browser and controlled-storage evidence, not hosted server persistence, native-device testing or deployment proof.
