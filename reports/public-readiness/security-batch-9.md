# Public readiness — recoverable local Rule Lab ratification

Date: 2026-09-18. Branch `codex/readiness-callbacks-20260918`, after `ac502dd`. No remote mutation or deployment. This continues INV-03; Commissioner launch is not yet fully verified.

## Reproduction and correction

The previous Rule Lab callback swallowed amendment-write failures and unconditionally marked a proposal ratified. A second league or final proposal-status failure could silently omit history or duplicate the first league on retry. Roster proposals were labeled ratified without recording any roster amendment.

The Bylaws engine now commits all amendments for one league in a single confirmed write and records a durable operation ID with that history. Retrying a partially completed operation skips completed leagues. The container updates proposal status only after all selected ledgers and the status itself are confirmed; failures remain visible and protect navigation. Successful deletion resolves a retained retry for the same proposal, preserving already recorded history. Ratification reads the current saved list before writing, so stale render data cannot ratify a proposal removed in another view.

Both scoring and roster intent are recorded. The visible status says **RATIFIED LOCALLY** with the target league count; button help states that provider settings are not changed. These are local browser amendment records, not provider publishing or a substitute for reviewing actual setting changes.

## Verification

- `tests/commish-ratification-recovery.cjs` executes the real Bylaws engine, recovery hook and production ratification callback: rejected batch is atomic; later-league failure retains the unfinished status; final-status failure preserves history; retries avoid duplicate entries; roster before/after values are retained; removed proposals cause no writes.
- `tests/commish-plan-recovery.cjs` also verifies that deleting a saved proposal clears only that proposal's retained ratification error.
- Full `npm run test:commish`, `npm run build:preview`, and `git diff --check` pass.
- Chromium at 390 × 844 using an isolated local fixture with actual production Rule Lab panel, recovery hook, callback, account storage and Bylaws engine: Ratify with the second league's storage rejected showed an incomplete warning and draft status, with two amendments in league one and zero in league two. Restore storage → Retry → full reload produced **RATIFIED LOCALLY · 2 leagues**, two amendments in each league, and the saved scoring/roster proposal. This is local component/browser evidence, not hosted or physical-device proof. No real account or league records were used.

- Independent product_inventory review reran the actual regression and examined the source. No material issue was found in this bounded workflow. Evidence covers sequential local recovery, not concurrent same-account browser-tab writes.

## Scope still open

Drift acknowledgment/amendment coordination, schedule persistence/recovery, and malformed local proposal-record recovery remain unfinished Commissioner checks. Parent owns integration and release evidence. This batch does not erase those launch requirements.

## Additional independent reviews

- Reviewed peer Vault invite-context change and ran actual `time-league-invites.js`: consumed legacy/current invites retain the Vault route while removing private invite codes. Reviewed the opt-in read-only browser smoke allowlist against the backend: only sign-in and list/profile-get/exact controlled completed-room load are allowed POSTs; other write methods are blocked, and backend non-POST requests are rejected. Exact controlled identity, room completion and stable-version assertions are present; exported evidence omits credentials/raw responses. No material finding; no hosted replay or credential access by this reviewer.
- Reviewed root backend workflow prerequisite repair: added canonical `dhq-shared` checkout exactly matches Pages revision `7bd35313fc78e25a2d1ac24035989673a93f28e6`; explicit `SHARED_SOURCE` sync precedes security contracts and preserves the player-value twin guard. No material finding. Root owns the fresh-checkout replay and subsequent hosted workflow outcome.
