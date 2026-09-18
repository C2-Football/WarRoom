# INV-05 — Historical league deep-link recovery

Branch: `codex/readiness-history-20260918`, isolated from root candidate `c288d84`. No deployment or external mutation is part of this batch.

## Reproduction and intended behavior

Severity: high journey defect. With a connected fixture account that owns a 2026 league and its distinct 2025 predecessor, opening `#league=1660000000000000001&tab=stats` on the baseline left the historical hash in place but displayed the current-season hub. `S.currentLeagueId` remained null, with no error or recovery action. This is a bookmarked existing league, not a request to invent or extrapolate historical data.

The initial router looked only in the current-year hydrated portfolio, then marked an absent route applied. Its unused `AVAILABLE_YEARS` constant did not load older leagues. Back/Forward likewise had no recovery path for an ID outside those current lists.

## Resolution

- Fetch the linked league metadata, validate its NFL season and exact ID, then verify that ID in the connected account's league list for that same season. Only then fetch the historical roster and user details. Co-owner identification is supported; missing/malformed details remain errors rather than fabricated empty rosters.
- Preserve the current-year hub/Empire portfolio. Historical leagues have a separate in-memory route cache used by Back/Forward; they do not change exposure denominators or league counts.
- Render explicit loading and failure messages with Retry and Stay on home. Each read has a timeout. Account changes, another league selection, a canceled link, and moving to another hub experience invalidate pending work before it can publish. A late existing ESPN/MFL hydration can supersede the attempted Sleeper lookup.
- Key `LeagueDetail` by league ID so changing from a historical league to its current successor initializes the correct season-specific component state. Bookmarks retain their tab, legacy `brief` routes still normalize to Dashboard, and saved last-visit IDs retain exact long-string identity.

## Verification

- `npm run test:sleeper-portfolio`: 17 passing tests, including seven new tests executing the actual linked-season loader, controller and initial effect. Covered historical membership/co-owners, wrong account, malformed metadata/rosters, provider failure, timeout, retry, delayed account change, canceled response, no portfolio mixing, no-account recovery, and late provider hydration.
- `npm run test:workspaces`: passed, including eight portfolio consolidation checks. Its baseline positional market-data hook fixture was already corrected on root; this branch carries the identical named-state-slot harness from `d5cf58d`, plus the added route dependencies. No assertions were weakened.
- `node tests/app-account-callbacks.cjs`: passed both existing account-isolation groups. `npx eslint js/app.js`, `git diff --check`, and canonical `npm run build:preview` passed (147 scripts).
- `node tests/league-linked-season-browser-qa.cjs` against the matching built preview on port 3502 passed six browser groups: historical bookmark/reload and exact 2025 Stats context; actual Home/Back/Forward with one current 2026 hub league; historical-to-current remount; 503 → Retry → same historical league; unconnected season membership denial before roster reads; delayed canceled lookup unable to replace a newly selected current league.
- Actual Chrome recovery geometry passed 320×720, 390×844, and 844×390, with no document overflow, 16px recovery text/buttons, and minimum 44px button targets. Initial review found the shared small-button style insufficient; this panel now sets readable size and target height explicitly. Screenshot: [historical-link-retry-390.png](historical-link-retry-390.png), visually inspected. Images/fonts are blocked by the fixture, so its logo placeholder is not production asset evidence.
- All Supabase requests were fulfilled locally as unavailable, and an external mutation guard remained active. Synthetic public provider fixtures establish local behavior only; zero real accounts, leagues, scores, or backend records were changed. Run with the matching preview server (`node scripts/serve-static.cjs --port=3502`) or set `READINESS_PREVIEW_ORIGIN`.

## Scope and follow-through

This resolves restoring an existing connected Sleeper league by its own season-specific ID. It does not certify every historical tool, a cloud backup, real-account end-to-end behavior, physical devices, or production delivery. Full historical player/team provenance and current-versus-historical advice still require their own evidence. The historical route cache is intentionally in-memory; a reload re-verifies account membership and fetches the season again.

Root must integrate the batch, preserve account-session and navigation guards, run integrated checks, independently review, and verify the deployed revision before treating this as live. Remaining operational diagnostics lead from root: `analytics-report.js` still has internal WIP suppression of missing landing-funnel telemetry; that is unfinished diagnostics, not a passed telemetry check or a blocker introduced by this routing batch.
