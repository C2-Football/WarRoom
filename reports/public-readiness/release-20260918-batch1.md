# Repair release 1 — 2026-09-18

Revision: `898c374a5d1b8a6a9cc63c5376e0f18cdbac1533`.
Product source tested at `d5cf58d`; subsequent delta is evidence/documentation and
the independently reviewed phone-renderer browser locator/actionability check.
Canonical shared pin: `7bd35313fc78e25a2d1ac24035989673a93f28e6`.

Both main branches fast-forward pushed from `5d28f39` at approximately 21:03 UTC.
No force push and no original-checkout changes. These pushes are **not yet
deployment verification**. Initial workflow references:

- [Production Pages](https://github.com/C2-Football/WarRoom/actions/runs/35394776267)
- [Canonical shared backend](https://github.com/C2-Football/WarRoom/actions/runs/35394776278)
- [Production CI](https://github.com/C2-Football/WarRoom/actions/runs/35394776358)
- [Sandbox Pages](https://github.com/C2-Football/WarRoom-sandbox/actions/runs/35394794390)
- [Sandbox CI](https://github.com/C2-Football/WarRoom-sandbox/actions/runs/35394794265)
- [Sandbox backend](https://github.com/C2-Football/WarRoom-sandbox/actions/runs/35394794169)
  intentionally skipped: both frontends use the canonical production backend.

Pending: terminal workflows, exact served revision and asset hashes, migration
catalog/grants, password-reset routing, controlled reset contention, original Duat
room recovery and post-deploy browser smoke. Keep controlled passwords unchanged
until the active Vault browser journey releases its sessions.

Recovery and compatibility: `release-compatibility.md`. Full readiness remains open.

## Backend workflow repair

Canonical backend run35394776278 failed in the security gate before any migration
or function deployment: account-storage regression reads the vendored
`reconai-shared/storage.js`, but this workflow had never checked out/synchronized
canonical shared code. CI and the Pages workflow use different test preparation.
Original failure: `evidence/backend-898c374-failure.log`.

The correction checks out the exact same shared revision as Pages and synchronizes
via explicit SHARED_SOURCE after npm ci, before all backend contracts. The twin
consistency guard and every test remain enforced. Independent security review found
no material issue. Clean detached898c374 worktree reproduced the missing module;
after the pinned shared sync, the full security suite passed. See
`evidence/backend-clean-missing-shared.log`, `backend-clean-shared-sync.log` and
`backend-clean-security.log`. Product source is unchanged by this workflow repair.

Both initial CI runs passed. Initial Pages workflows are still running. The
workflow repair will be pushed normally to both main branches and verified at its
new revision; no manual migration or test bypass was used.
