# Public launch readiness

Status: **active, not launch-ready or fully assessed**. Started 2026-09-18.

This record implements the owner's delegated, persistent readiness goal. Existing
functionality stays in scope; passing unit checks does not establish complete
browser, server, multiplayer, native, or deployed readiness.

## Acceptance gates

- Inventory every existing product, route, dependency, release destination, and
  promised primary journey. Verify current source and behavior rather than older
  completion claims.
- Fresh user: arrival, authentication, onboarding, league connection, meaningful
  action, save, reopen, continuation; deep links, back navigation, sign-out,
  account switching, league/format/season/entitlement context.
- Empire: aggregation, exposure, scenarios, incomplete data, correct league
  handoffs, format-aware advice and explicit hypothetical framing.
- Commissioner: server-enforced membership/commissioner permissions; settings,
  rules, schedules, tasks, treasury, publishing; truthful local vs remote state.
- Vault: entry, draft, complete season, recovery; isolated controlled multi-user
  rooms, reconnect and races; no private seed, content, allocation, or bid leaks.
- Duat: onboarding, draft, lineup, weekly advancement, completed season and
  subsequent progression; save/reload/recovery and local/server consistency.
- Hub, account/settings, league connections/tools, Draft, Wire, Cup and other
  supported modules: successful primary journeys with accurate context/data.
- Mobile: 320px narrow and typical portrait, short landscape, safe areas,
  keyboards, scrolling/dialogs/navigation; readable current action with reachable
  controls. Native packaging guards must be solved at the cause. Responsive,
  native build, install, device and store evidence remain separate.
- Reliability/security: provider failures, slow requests, missing/current/
  historical data, retries, duplicate actions, expired sessions, authorization,
  secrets, persistence/recovery, accessibility and practical performance.
- Required current automated suites, explicit browser journeys, integration,
  authorization and recovery checks pass on the integrated release candidate;
  inspect all skips/quarantines. Independent review has no unresolved blocker.
- No known critical/high defect or primary-journey/data-integrity blocker;
  remaining minor issues documented. Verified revision, workflows, metadata,
  served assets and post-release journeys on both frontend destinations.

## Operating boundaries

The owner authorizes ordinary fixes, tests, branches, commits, integration and
verified deployments to existing sandbox/production. Preserve unrelated work;
no force push, purchases, new contracts, business/pricing changes, announcements,
or erasure of real data. Sandbox shares the production backend; prove test data
is isolated before any mutation. Rehearse migrations before production and
establish rollback/recovery. Ask only when no productive authorized path remains.

## Evidence index

- [Checkpoint and next steps](checkpoint.md)
- [Inventory](inventory.md) (being assembled)
- `evidence/`: command logs and compact machine-readable verification
- Area reports record severity, reproduction, cause, fix, related checks and
  evidence limitations. Unrun requirements remain unverified.

