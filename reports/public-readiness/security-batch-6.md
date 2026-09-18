# Public readiness — Commissioner task and dues save recovery

Date: 2026-09-18. Branch: `codex/readiness-callbacks-20260918`; this batch follows `ec61010`. Parent integration owns release. This branch made no remote data changes or deployments.

## INV-03 partial resolution — High — false successful local saves

Reproduced on the committed pre-fix modules with the account-storage adapter returning `false`: `Tasks.add` returned an object with a new ID while `Tasks.list()` remained empty; `Treasury.markPaid` returned `paid:true` while the stored ledger remained empty. The task container swallowed exceptions and its form cleared after either failure. LeagueSafe/Sheet link and CSV controls similarly reported successful actions without checking durable storage. CSV applied each member separately, allowing a partial ledger update if storage failed midway.

Task and treasury mutations now require confirmed storage and propagate a `LOCAL_SAVE_FAILED` error. The container displays a truthful alert, retains task/link/CSV inputs, preserves the prior saved rows, and keeps failed operations pending until that operation succeeds or the user explicitly discards unsaved inputs. An unrelated successful action does not erase another failed operation; successful removal resolves that task's now-obsolete failed toggle. CSV stages the full ledger and commits once; failed writes cannot partially apply the import. URL validation remains distinct from storage failure. Saving an untouched displayed link preserves it, while explicitly clearing it still removes it. Empty task dates now remain unscheduled instead of coercing `null` to January 1970.

Failed changes block the office Back action, workspace changes and league handoffs. The hook also installs `beforeunload` protection and registers with the integrated `App.NavigationGuard` for app/history navigation. Explicit discard remounts task/dues forms and clears only transient failed inputs; saved records remain intact. **Integration dependency:** include the root's `js/shared/navigation-guard.js` and its app navigation call sites. The isolated branch contains the consumer, not that separately reviewed shared utility.

## Input focus correction

The real browser run found that the nested `Section` function was a new React component type on each render. Typing remounted the task/dues section and lost input focus. Both panels now use stable section component identities. This preserves the existing presentation and inputs throughout edits.

## Verification evidence

- `tests/commish-save-recovery.cjs` executes the actual engines, container callbacks, recovery hook, and task form. It covers adapters returning `false` or throwing, unchanged saved records on failed toggle/delete/payment/link changes, one-write CSV rollback/retry, null dates, input retention, exactly one successful task creation, unrelated-success isolation, explicit discard, and the shared navigation hook contract.
- `npm run test:commish` passes including the new regression; `node tests/portfolio-consolidation.cjs` passes all 8 checks, including actual selected Bylaws/Dues panel rendering. `npm run build:preview` and `git diff --check` pass. `test:security` passed earlier in this batch; the final panel identity changes do not modify security code.
- Chromium, 390 × 844, local isolated fixture using the **actual** Ops panel, account storage, task engine and container callbacks: typed a title and private note, rejected storage, observed `Change not saved`, both inputs retained and zero stored tasks; attempted to leave and remained on the task screen; restored storage and retried, observed one saved task and the closed form; reloaded and read the same title, note, `done:false`, `dueTs:null`. No horizontal overflow. Character-by-character typing retained focus and all characters after the section correction.
- Local browser fixture screenshot: `output/playwright/commish-save-rejected.png` (ignored diagnostic output). Browser artifacts are component integration evidence, not a hosted/full-office or physical-device claim. The fixture uses React 18's legacy render API, which emits its expected development compatibility warning; no application exception was observed.
- A mistyped supplemental command ending in `portfolio-consolidation.js` initially failed because the actual file is `.cjs`; the correct command then passed. No assertion or coverage was removed.

Independent review by product_inventory found the obsolete failed-toggle marker after successful task removal. That finding was corrected and the exact regression independently rerun. Final review found no unresolved material issue in this tasks/treasury subset; the separate report will accompany root integration.

## Remaining readiness work

This closes the task and treasury subset only. INV-03 remains open for other Commissioner storage callers: preferences, drift acknowledgment/amendment coordination, follow-ups, season setup, rule proposals, and schedule drafts. Those need durable-save/error/retry checks before Commissioner is launch-ready. Full office navigation with the integrated guard, responsive browser journeys and hosted release verification remain required. No production readiness claim is made by this batch.
