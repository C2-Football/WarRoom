# Supabase function ownership

All of these applications use production project `sxshiqyxhhifvtfqawbq`. A source
copy in this checkout does not authorize this repository to deploy that endpoint.

| Release owner | Scope |
| --- | --- |
| `C2-Football/WarRoom` | `league-cup`, `time-league` (Vault), `duat` |
| `skjjcruz/github.com-skjjcruz-owner-dashboard-dev` | Account/authentication, billing, admin, server AI, scoreboard and native operations; use its reviewed owner release process. The newer `fw-change-password` belongs in this account lane. |
| `skjjcruz/ReconAI-sandbox-dev` | `espn-proxy`, `mfl-proxy`, `yahoo-proxy` |
| Existing separately managed releases | `report-bug`, `feature-requests`, and any unverified endpoint are excluded from C2 releases. Verify their owning release process before deployment. |

Current source/workflow evidence is pinned in
[the backend release safety report](../../reports/public-readiness/c2-backend-release-safety-20260920.md).
The actual ReconAI repository is active; an archived C2 mirror did not transfer
ownership of the shared production provider endpoints.

C2 pushes run validation only. Game releases use a reviewed, committed
`.github/c2-releases/<name>.json` manifest and explicit workflow dispatch after
all gates pass. The agent can prepare and dispatch an authorized release; no new
owner confirmation is required by this mechanism. The planner has no broad
fallback, migration-application command, billing cutover, or non-game scope.

Retained account/provider/SQL source remains available for tests, reconciliation,
and upstream patches. Apply shared schema changes through their separately
reviewed migration/cutover process, then refresh the game's read-only compatibility
evidence. Do not use a blanket `supabase functions deploy` from this checkout.
