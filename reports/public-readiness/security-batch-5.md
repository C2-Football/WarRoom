# Public readiness — account-sensitive app callbacks

Date: 2026-09-18. Worktree: `warroom-readiness-callbacks`, branch `codex/readiness-callbacks-20260918`, baseline integrated `f0f6e53`. Parent integration owns release. No remote writes/deployments by this branch.

## SEC-SESSION-06 — High — delayed provider/profile callbacks cross account boundaries

Source and actual-callback reproduction: A begins cloud display-name/MFL connection restoration or manual MFL fetch; B signs in before the reply arrives; the mounted callback writes A's name, league/team pointers or API secret after B's new session. React effect cleanup alone cannot protect the interval before the browser's queued storage event. Similar callbacks can continue with account-sensitive Owner DNA requests or publish stale shared Empire state.

Repair adds the existing synchronous AccountSession boundary at callback entry and after awaits, before storage writes, cloud follow-up calls or state publication. It covers display name, MFL restore/connect/team finalization, ESPN connection result, Commissioner discovery, Empire picks/stats/DNA/player setup and refresh. Display-name save callbacks and league navigation also check before acting. Sleeper's connection save now checks the helper as well as its existing raw metadata/session comparison, covering signed legacy principal changes.

The existing shared provider code remains pinned and unchanged. ESPN's shared connector writes only old-page transient `S` state/public crosswalk cache before returning; the app boundary then invalidates the old tree before accepting a result. No delayed callback may restore credentials or publish cloud metadata after that boundary.

## Evidence

- `tests/app-account-callbacks.cjs` executes extracted actual functions/effects with the actual shared account helper. Paused cloud names, cloud connection lookup, MFL provider replies, ESPN replies and team selection cannot update B's context or make follow-up cloud saves. Same-account MFL connection and team selection still persist normally.
- The same test pauses Empire traded-pick and Owner DNA results; switching accounts preserves B's shared state, does not publish A's private DNA, and prevents the next follow-up request.
- `npm run test:security`, `npm run test:sleeper-portfolio`, `npm run test:login-auth` and `npm run build:preview` pass locally; `git diff --check` passes. The new callback test is added to the security suite.
- Deterministic callback tests supplement earlier real two-tab browser account-boundary proof. Full integrated browser journeys and post-release checks remain root's work.

Integration note: product inventory has a concurrent truthful traded-pick loader change in `populateEmpireWindowState`. Keep its coverage/error behavior and the account checks at entry and after every await before publishing shared state. Do not drop the stale-account regression during merge.

Independent review was requested from product_inventory; its final disposition should be recorded in the integrated evidence. Remaining Commissioner save-failure behavior is separate from this privacy fix.
