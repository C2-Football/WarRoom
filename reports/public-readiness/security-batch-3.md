# Public readiness — account lifecycle follow-through

Date: 2026-09-18. Branch: `codex/readiness-security-20260918`. Follows account isolation `d42db1a` and atomic reset `3744f22`. This is local evidence; no deployment or remote mutation.

## SEC-SESSION-04 — High — onboarding completes a stale account action

Reproduction uses the actual onboarding functions. Begin A's Sleeper lookup, pause its response, switch the stored session/profile to B, then resolve A's lookup before a queued browser storage event. Baseline `3744f22` writes A's connected Sleeper identity into B's profile and compatibility pointers. The baseline regression fails `a delayed A lookup cannot modify B connection/profile before a storage event`; exact diff shows B's profile gaining A's lookup result. Its following cloud-save call can also resolve using B's current session.

Fix: standalone onboarding opts into the same account-session boundary as the React application through `account-session-root`. It loads the shared account helper, validates the real session identity before boot, and checks identity before/after asynchronous lookup or checkout and before delayed progression, profile read/write, final completion and cloud synchronization. Expired/corrupt sessions and connection metadata without authentication go to sign-in. Account changes hide the page and reload, including when a callback runs before the browser's storage event. The legacy `od_locked_username_v2` pointer is now included in preserved/restored account context and cleared from the active connection on sign-out/switch.

The sandbox banner previously claimed changes could not affect production. It now says `SANDBOX PREVIEW — shared production services`, matching the verified backend arrangement; backend behavior is unchanged.

## Verification

- New `tests/onboarding-account-session.cjs` executes actual onboarding functions and actual helper. Paused Sleeper and checkout responses under a switched account cannot write pointers, send follow-up cloud saves, complete the other account's setup, or navigate to the prior account's checkout. Existing same-account connection/completion succeeds. Delayed next-step timer, invalid session boot, private profile read/write guard and standalone storage-event handling pass.
- `tests/account-session.cjs` now checks legacy pointer clearing alongside existing preserved-save/logout/quota/return-account cases.
- `npm run test:security`, `npm run test:login-auth`, `npm run build:preview` and `git diff --check` pass locally. The new behavior regression is included in the security suite.
- Prior actual two-tab Chromium tests cover the underlying shared helper and plan stores; this onboarding delta has deterministic actual-function tests. The final integrated browser onboarding journey remains root's release check.

## Audit coverage and next steps

`js/components.js` reads auth and clears corrupt legacy metadata; it does not issue auth credentials. Current repository callers do not call canonical `OD.acquireSessionToken` (which retains its own write in canonical `dhq-shared/supabase-client.js`); no unpinned copy or canonical dependency change was made.

Remaining app.js display-name/provider hydration and ESPN/MFL callback guards are a separate follow-up after the portfolio agent's overlapping app.js commit. Parent owns integrated login (including the transactional helper already cherry-picked), browser validation and release. Existing ignored planning-save failures (INV-03) remain separate; this delta does not claim to solve them.
