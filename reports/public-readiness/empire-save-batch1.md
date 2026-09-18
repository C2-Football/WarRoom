# Empire decision save recovery

Severity: high (INV-03, loss of user-entered work). Candidate-local correction;
no release or whole-product readiness claim.

## Reproduction and cause

A browser storage quota/error made AccountStorage.set return false, but the journal
returned its unsaved record as if persistence succeeded. UI controls immediately
used saved data again, losing notes and status changes. Leaving Empire, including
same-document browser Back, could unmount the only unsaved copy.

## Resolution

Journal writes now reject unsuccessful storage. Inputs retain a local draft until
confirmed persistence; visible recovery offers retry with the latest typed values
or explicit discard of unsaved edits. Multiple failed decisions remain individually
recoverable even if a different decision subsequently saves. An explicit successful
record deletion removes that record's drafts. The last saved record remains intact
on failure. Full-document exit warns about pending work.

A shared navigation guard checks live pending refs before league/tab/back changes.
Blocked browser history movement reinserts the mounted form's route so the URL and
screen stay consistent. Retry/discard releases the guard; component unmount removes
its registration. Empire's own hub and league actions also preserve pending work.

## Verification and review

- `npm run test:empire`: underlying failed false/throw writes and actual production
  hook behavior, latest-text retry, retained failed creation/removal, explicit
  discard and multiple failed intents. Related values/scenarios checks included.
- Actual Chrome 390x844 fixture journey: quota failure visible, note retained,
  saved record unchanged, hub Back and actual browser Back preserve form+URL,
  retry persists, reload/reopen restores. External mutations intercepted locally.
  Evidence: evidence/empire-save-browser.log and empire-save-recovered-390.png.
- Independent reviewers found and corrected stale retry patches, league handoff,
  browser Back and cross-record failure clearing. Final follow-up found no unresolved material issue; independent review is
  recorded in the accompanying journal review report.

This fixes the decision journal. Commissioner and other storage callers remain
separate required work; this report does not close INV-03 across the suite.
