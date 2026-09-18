# Empire decision recovery and navigation review — 2026-09-18

Independently reviewed the root worktree's pending Empire decision save/recovery changes against baseline `f0f6e53`. No unresolved material finding after the multi-intent correction described below. This is source, regression, and local browser evidence; deployment remains root-owned.

## Finding resolved during review

The first implementation retained a failed draft A but unconditionally cleared all failure state when decision B saved. The recovery banner and Retry/Discard controls disappeared while `hasPending()` remained true and navigation stayed blocked. A failed creation could also be forgotten because it had no existing draft ID. An independent actual-hook reproduction returned `failure: null`, pending A, `hasPending: true`, `retry: false`, and unchanged saved A.

The corrected hook stores failed intents by operation/record, clears only the successful operation, and retries the oldest remaining failure. Explicit successful removal clears errors for that record; discard clears pending work while retaining the last saved data. Reviewed and reran the added actual-hook cases: failed A update plus B success; failed creation plus another failed update plus B success; sequential retries without duplicates. These pass and address the finding.

## Verification and scope

- `node tests/empire-decisions.js`: all 6 groups passed after the correction, including false-return/throw persistence failures, create/update/remove preserving durable records, editable retry state, newer edits merging into retry, multiple independent failures, and explicit discard.
- Independently ran `node tests/empire-save-browser-qa.cjs` before the final multi-intent correction: passed at 390×844. Actual browser interaction confirmed failed save message, retained draft, unchanged stored record, blocked hub navigation, actual `history.back()` preserving the mounted form and URL, successful retry, and restored note after reload. Four external writes were blocked by the fixture guard. Root is rerunning this script on the final build.
- Reviewed `navigation-guard.js`, registration/unregistration, app route/tab/back checks, and journal `beforeunload`. Same-document navigation consults the live ref state and re-routes to recovery; document departure uses the browser's unsaved-work guard. Failed storage writes now throw instead of reporting success.
- The guard's blocked Back path reinserts the protected route with `pushState`; this preserves the current form at the cost of rewriting forward history. No data-loss regression was found in the current tested path.

Integration checks: preserve this recovery banner alongside roster and pick coverage notices; preserve account-session checks when app navigation and callback changes meet. Rerun final integrated Empire, callback, browser, and account-switch checks before release. This review does not establish other modules' persistence recovery or broad suite readiness.
