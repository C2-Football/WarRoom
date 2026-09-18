# Public readiness — Commissioner follow-ups and preferences

Date: 2026-09-18. Branch `codex/readiness-callbacks-20260918`, after tasks/dues `4ad0bb4`. The root's existing shared-twin change `0c313af` was cherry-picked locally as `05bbdea` for build compatibility with canonical shared `7bd3531`; do not integrate that duplicate. No remote writes or deployment occurred here.

## INV-03 additional resolution — High — private follow-up loss

Reproduced on the previous modules with rejected account storage: `Followups.save` returned the private note while `get` returned `null`; `Prefs.setManaged(false)` returned `false` while the league remained managed. The action drawer called its next action after attempting to save, regardless of success. Closing it discarded edited notes. Activity updates also rehydrated the form from stored data, overwriting unsaved edits.

Follow-up and preference writes now require a confirmed save, propagate failures, and preserve stored records. Saving a follow-up and appending its `SAVED` entry use one write. The drawer retains failed message/note/date fields, exposes an error inside the drawer, prevents Close and follow-on actions until its draft is saved or explicitly discarded, protects browser unload and app navigation, and does not replace typed edits when activity refreshes. Success says `Saved locally in this browser. Nothing was sent.` Explicit discard reverts only the unsaved fields. First edits in an initially empty drawer have an independent saved snapshot, so they cannot accidentally count as already saved.

Managed-league, alert and severity preferences update their visible state only after durable storage. A stored `false` preference remains a legitimate success and clears its corresponding prior error.

Queue preferences and activity history remain separate existing records. If the queue change succeeds and its activity entry fails, the UI states this partial result explicitly, keeps the drawer open and offers an activity-only retry. That retry cannot replay an old note or rewrite the queue state. A newer queue action supersedes an obsolete failed state-history entry; deletion resolves pending failures for the deleted follow-up. A reachable dismissal inside the drawer allows leaving an activity unrecorded when storage stays unavailable; it clears that error only and preserves any typed edits and their navigation guard. This is truthful recovery for the existing two-record operation, not a claim of cross-key atomic storage.

Copying now awaits the actual clipboard write before recording `COPIED`. Clipboard rejection does not produce a successful activity record. No message is sent by this workflow.

## Verification

- `tests/commish-followup-recovery.cjs` executes actual engines, the container's callbacks/recovery hook, and the compiled Action panel. It covers false/throw adapters, one-write draft/history persistence, preference false-value recovery, retained stored notes, honest partial state, activity-only retry, superseded failures, rejected clipboard writes, drawer Close/Mark done/navigation guards, edits surviving activity refresh, first-edit protection and explicit discard.
- `npm run test:commish` passes, including the prior task/dues regressions and the new follow-up regression. `node tests/mobile-management.cjs` passes 9 cases. `npm run build:preview` passes with the matching updated shared twin. `git diff --check` passes. The full Commissioner suite and preview build were rerun after the final saved-snapshot and review corrections.
- Chromium at 390 × 844, a local isolated fixture using the actual Action panel, account storage, preference/follow-up engines and container callbacks: typed a message/private note, rejected saving, verified that Close and Mark done leave the drawer and fields intact with no saved record, restored storage, retried, observed the local-save confirmation and one `SAVED` event, closed, reloaded, and recovered both exact fields. Diagnostic screenshot `output/playwright/commish-followup-reopened.png` is ignored local output. This is component integration/browser evidence, not a hosted/full-office or physical-device claim. The fixture's React 18 legacy renderer emits its expected development warning; its first request for a favicon returned 404.

Independent review by product_inventory found that an unsuccessful `OPENED` activity write could trap a clean drawer behind its backdrop. Added the reachable per-failure dismissal described above and actual JSX regressions proving both clean-close recovery and preservation of typed notes when dismissing only activity. The reviewer independently reran the regression and found no unresolved material issue in this bounded batch.

## Separate release reviews

- Independently reviewed OAuth restoration commits `64a099c` and `97d7a10`. The first review reproduced an additional stale explicit-sign-in race across tabs. The follow-up fixes it with auth-key snapshots before persistence/provider redirects and suppresses obsolete restoration errors. Independently reran all 20 restoration scenarios, actual full-script request-recovery tests, account-storage and account-session tests; no unresolved material finding in that delta.
- Independently reviewed root's reset URL fallback replacement in both reset handlers: changed the unavailable custom host to the existing production Pages reset route while retaining configured overrides. Re-ran `tests/password-reset-atomic.cjs`; read-only HEAD on `https://c2-football.github.io/WarRoom/reset-password.html` returned HTTP 200. No reset email or user mutation was performed during this review.

## Remaining scope

INV-03 remains open for drift acknowledgment/amendment coordination, season setup, rule proposals and schedule drafts. Full integrated Commissioner journeys, history navigation, error recovery and release verification are still required. This batch does not declare Commissioner or the suite ready.
