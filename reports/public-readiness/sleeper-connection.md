# Sleeper connection recovery — 2026-09-18

Baseline: `5d28f396a3f41f3e95075264ea2890227907c761`. Fix branch: `codex/readiness-connect-20260918`. Severity: high; the first connection journey could become unrecoverable through ordinary controls.

## Reproduction and cause

Real Chrome against the locally compiled baseline, with a disposable browser context and mocked Sleeper response:

1. Open hub → Add league → enter `readiness-invalid-fixture`.
2. The original handler immediately persisted the string and reloaded.
3. Mocked public user lookup returned `null` (unknown user).
4. Open Add league: error said “Couldn't find that Sleeper username — check spelling and try again” but `document.querySelectorAll('#wr-sleeper-input').length` was **0**. Storage held `{"sleeperUsername":"readiness-invalid-fixture"}`.

`js/app.js` showed the editable input only before a username existed; the connect action saved before validation. A typo therefore required logout or storage manipulation to recover.

## Resolution

- Validate the public Sleeper profile before replacing the stored connection; use the returned canonical username.
- Retain prior connection and email session on invalid input, provider/network failures, timeout or storage failure.
- Bound lookup to 12 seconds, expose a helpful error, and allow retry without losing input.
- Keep the labeled connection form available for an existing or broken connection; disable duplicate submits while checking.
- Reject a late result if the account/session or connection changed during the lookup.
- Preserve existing connection metadata. Successful save reloads the app, so league state and owner caches are reinitialized using the new connection.

## Verified evidence

- `npm run test:sleeper-connect`: **9/9 pass**, no skips; behavioral tests cover invalid/404/503/malformed responses, offline, timeout, quota/no-op persistence, canonical identity, email-session preservation, account change, duplicate-submit and retry.
- `npm run test:login-auth`: **16 session-restoration scenarios pass**.
- `npm run test:design-tokens`: **4/4 pass**.
- `npx eslint js/app.js`: pass; `git diff --check`: pass.
- `npm run build:preview`: compiled 147 Babel modules, canonical shared twin check passed. Shared dependency revision was not changed.
- Chrome fixture reproduction after fix: the previously invalid saved username opens an editable form; submitting invalid input keeps the form and shows the precise validation error without reload; correcting to the valid fixture profile persists the canonical username and reopens hub successfully. Reopening the form shows the valid username and truthful “No leagues found for 2026” for the fixture's empty list.
- Responsive browser checks at **320×640**, **390×844**, and **844×390**: document width matches viewport; username is **16px**; primary action is **46px** high and can scroll fully into view at every size. [390px screenshot](sleeper-recovery-phone.png) inspected visually.

Browser tests used intercepted fixture responses and blocked Supabase requests to prevent backend mutation. Expected console messages were blocked 503 requests/analytics warnings and the existing meta-CSP frame-ancestors warning; no new JavaScript exception was observed. This does **not** establish live provider reliability, authenticated integration, native installation, physical-device keyboard/safe-area behavior, or deployed readiness. Root must run integrated browser checks and release verification.
