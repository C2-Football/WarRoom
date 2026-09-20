# Current release compatibility and recovery

This file supersedes the September 18 pre-release recipe. Current release preparation and verification are recorded in [the September 20 frontend release](release-20260920-batch2.md), with [independent compatibility review](c2-frontend-compatibility-independent-20260920.md).

The last verified C2 frontend revision is `4c4c4e97b742acc5b4696808d290ab1d7784410e` on both destinations. The reviewed candidate retains canonical C2 shared `7bd35313fc78e25a2d1ac24035989673a93f28e6`. The actual public domain uses different owning repositories; these C2 deployments do not publish its pending proposals.

## Deployment boundary

Normal C2 pushes validate retained backend source without deploying any Edge Function or applying SQL. Only an explicit committed, reviewed manifest can authorize a manual Cup, Vault or Duat release. Account, billing, deletion and provider functions belong to separate release scopes. Do not use an older blanket migration/deployment workflow.

The current frontend changes require only existing backend contracts, including the already deployed password-change endpoint. No game entrypoint changed from the last verified frontend baseline. The pending billing and deletion migrations and writers remain held. The detailed release record identifies all held schema revisions and evidence limits.

Account reset, session revocation, password change and atomic provisioning security corrections have already been selectively applied and source-verified. Another owning deployment previously reverted seven functions; current versions and exact source restoration are recorded in [hosted auth reversion](hosted-auth-reversion-20260920.md). Their permanence remains dependent on owning-source integration and deployment coordination.

## Practical recovery

If this frontend batch needs rollback, rerun only the previously successful Pages workflow for `4c4c4e9`: canonical run `35517680678` or sandbox run `35517682249`. Verify the served revision, repository and asset hashes after recovery. Keep the permanent backend guard in current source. Never force shared history or restore the old automatic backend workflow to recover a frontend.

Do not roll back working atomic reset, session revocation or provisioning protections. A backend regression requires a separately reviewed source repair and explicitly scoped release. The sandbox frontend shares the production backend and is never a disposable database.

No migration or backend mutation is part of this frontend release. Consult the latest checkpoint and exact release evidence before operating; historical evidence is timestamped proof, not a guarantee that another owning workflow has not changed the host.
