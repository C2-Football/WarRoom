# Public readiness — security batch 1

Date: 2026-09-18. Owner: security_boundaries. Branch: `codex/readiness-security-20260918`.
Baseline: `5d28f396a3f41f3e95075264ea2890227907c761`.
Canonical shared dependency verified clean at `5de7baa36225c43e8cacb00a2763e4c65508f296`, matching `.github/workflows/deploy.yml`.

Status: first local privacy/session batch implemented and independently reviewed; **suite public readiness is not established**. No remote data, accounts, migrations, credentials, deployments, or production writes were changed by this batch.

## Scope and acceptance

| Area | Current finding / evidence | Status |
| --- | --- | --- |
| Commissioner local plans | Private notes, tasks, dues bookkeeping, bylaws, drift acknowledgments, genesis, preferences, follow-ups, proposals and schedules must stay with their account. | Reproduced cross-account disclosure; local fix verified. |
| Empire decision journal | Same-device A/B switching, sign-out, reload and returning A must preserve isolated plans. | Local fix verified. |
| Session lifecycle | Sign-out must remove active email/legacy/OAuth session and provider/AI secrets; mounted old-account UI and delayed callbacks must not act as the next account. | Local fix verified; root login integration still required. |
| Vault server boundary | Raw sealed state must be unavailable to browser DB roles; Edge projection/permissions must preserve hidden draws and seat ownership. | Existing local SQL + actual-handler tests passed; real hosted two-account QA still required. |
| Duat server boundary | Raw snapshots/invites/receipts must be server-only; server action intent, host/member gates, revisions and private projections must hold through succession. | Existing local SQL + actual-handler/runtime tests passed; hosted multi-account QA still required. |
| Commissioner publishing | Cup edits must require verified commissioner/site-admin identity; local planning must not imply provider publication. | Existing Cup handler tests pass. Most Commissioner tools are local planning; Sleeper integration is read-only. |

## SEC-LOCAL-01 — High — shared-device private planning disclosure

Reproduction: using the real planning engines and typed storage, save a confidential Empire decision, commissioner task, treasury note, amendment and follow-up while signed in as A; replace the account session with B; read the same stores, including the same league. On baseline `5d28f39`, B receives A's notes and ledger. Logout removes auth keys but does not scope these data keys. The regression run against baseline fails with `B must not see A planning data even for the same league`.

Root cause: `empire_decisions_v1`, `commish_*` and `wr_commish_schedule_*` use origin-wide keys, not account ownership.

Resolution:

- Added WarRoom-local `App.AccountStorage`, loaded before the planning engines. Keys use the app-account identity, signed legacy identity, or OAuth subject; editable connected Sleeper usernames do not determine ownership.
- Updated all listed Commissioner stores plus Empire decisions. App and legacy identifiers cannot collide. Signed-out access returns no private account records.
- Retained unscoped legacy records byte for byte. Their original owner is unknown; they are never automatically imported to the next account.
- Known-owner connection metadata is backed up and restored on account return. Unmarked metadata remains preserved as unassigned recovery data.
- Root login integration calls `App.AccountStorage.prepareSignIn(nextSession, updates)`, where `updates` is an array of `[localStorageKey, rawStringOrNull]`. This function performs the writes; callers must not run a second unguarded write loop. It throws on invalid identity, backup failure, or write failure.
- The sign-in transition verifies a durable context backup before changing active keys, completes quota-sensitive writes before deletion, and rolls back failed writes. A pending-transition record retains the backup if rollback itself cannot write; retry restores only the matching account's context.

Verification: `tests/account-storage.cjs` exercises the actual eight planning engines with the pinned shared typed-storage implementation. A/B, same-league notes, sign-out, reload, return, profile changes, app/legacy identity separation, legacy preservation and storage-adapter failure all pass. `tests/account-session.cjs` exercises full quota, partial update failure, failed rollback, and restored-storage recovery.

## SEC-SESSION-02 — High — stale mounted account and surviving credentials

Reproduction: populate `sessionStorage.mfl_api_key` and ESPN cookie fields; execute the original `handleLogout`; credentials survive because the original handler removes only three auth keys. Account changes in another tab leave a mounted private view until a reload.

Resolution:

- `handleLogout` delegates to `App.AccountSession.signOut`. It clears active tokens, the configured project's OAuth persistence, provider/AI secrets, and old embedded connector secrets, and calls SDK local sign-out. Offline SDK failure still finishes local logout.
- Nonsecret active profile pointers are cleared only after a verified backup. If backup storage is full, auth and secrets are still removed while recovery data stays in place.
- Storage/focus/visibility listeners invalidate a changed account's mounted React tree. The storage adapter also checks synchronously before access, so an old callback cannot write to B before the queued `storage` event runs. Invalidation remains in force until reload.
- A delayed commissioner treasury-sheet response is ignored after an identity change.

Real browser evidence: Playwright CLI, isolated Chromium session `readiness-security`, a local fixture using actual React 18, the helper, shared typed storage, commissioner tasks and Empire decisions. No connected service or real account was used. Saved A plans, opened a second tab, changed the synthetic session to B; the first tab automatically reloaded, displayed `account:qa-b`, and showed empty tasks/decisions. Saved B plans, switched back to A in the second tab; the first tab automatically returned to A's saved task and trade plan. Clicking Sign out navigated to the local landing fixture. Browser storage inspection confirmed null app token and MFL credential, with A/B scoped plan keys retained; the other tab showed signed-out empty stores. Only console error was the fixture's missing favicon.

## Validation completed on this branch

Prerequisite: `npm run sync:shared` from the pinned canonical sibling. Dependencies use the primary checkout's identical lockfile via a local `node_modules` symlink (not committed).

- `npm run test:security` — all existing checks plus both new account regressions passed.
- `npm run test:commish` — passed.
- `npm run test:empire` — passed.
- `node tests/portfolio-consolidation.cjs` — 8 passed; harness now initializes actual typed/scoped storage and a synthetic session instead of implicitly sharing anonymous memory.
- `npm run test:login-auth` — passed on this branch's baseline login; root's changed login still needs integration verification with the new transition API.
- `node tests/time-league-sealed-state-db.cjs` — passed real PostgreSQL-compatible grants/RLS/RPC tests including anonymous, nonmember, joined seat and commissioner read denial.
- `node tests/time-league-public-endpoint.cjs` — passed actual Edge handler authentication, reveals, readiness, stale writes, HMAC draws, current-week waivers and custom scoring.
- `node tests/duat-online.cjs` — 14 transaction/endpoint scenarios passed, including real runtime v2/v3 draft and contention.
- `node tests/duat-dynasty-online.cjs` — 11 scenarios passed, including actual generated runtime v4 multi-seat play through annual succession; zero live accounts/writes.
- `node tests/cup-service.js` — six formats, permissions, score validation, rulings and optimistic revision conflicts passed.
- `npm run build:preview` — compiled 147 Babel scripts. `git diff --check` passed.

These are local isolated tests. PGlite serializes queries; its competing-action tests do not prove independent production connection contention. Source/fixture evidence is not hosted membership, migration, real-account, full-product browser, or physical-device proof.

Independent review: root and `product_inventory` reviewed the substantive privacy/session changes. Review findings about archive failure, returning-account context, quota logout recovery, corrupt old credentials, and failed rollback were resolved with regressions. No unresolved material finding in the reviewed account-isolation scope; root login integration and final deployed review remain required.

## Remaining launch blockers and next executable steps

1. **INV-03 — High, unresolved:** existing planning engines/form handlers often ignore a failed `set` and return success-shaped records. The new adapter correctly reports failure, but full propagation through Empire/Commissioner forms is a separate persistence/UX repair. Reproduce quota failure through each save form; preserve entered values, report failure, and only acknowledge durable writes. This batch does not claim that defect is fixed.
2. **Password-reset atomicity — high-priority investigation, not yet reproduced here:** reviewer identified separate token validation/password update/session-version increment/token-consumption writes in `fw-confirm-password-reset`, with ignored errors. Add an actual SQL transaction/race regression and verify old-session revocation before release; make the trusted mutation atomic if reproduced.
3. Integrate login's email, legacy and OAuth success paths with `prepareSignIn(nextSession, updates)` and rerun quota + return-account login journeys on the integrated candidate.
4. Old unassigned private records have no ownership evidence. Preserve them for owner-assisted recovery; do not silently attribute them to the first account. There is no automatic recovery UI for those records in this batch.
5. Finish hosted disposable-account authorization, sealed response, reconnect and competing-action tests only after confirming test-data isolation. Sandbox shares the production backend.
6. Full Commissioner fresh-account publication needs verified provider identity. App-profile Sleeper usernames are editable connection metadata, not proof of commissioner identity. Do not grant Cup management from that metadata.
7. Root must perform required integrated suites/browser journeys, release through established process, and verify served revision/assets on both sites. This branch is neither pushed nor deployed.
