# C2 backend release boundary — 2026-09-20

Prepared in isolated `warroom-readiness-c2-release-guard`, branch `codex/readiness-c2-release-guard-20260920`, from explicit root revision `129da3d`. Root's in-progress integration and all source snapshots were preserved. This batch changes tooling and documentation, not product rules or endpoint behavior. No push, deployment, Supabase project mutation, or external pipeline change was performed.

## Reproduction and ownership evidence

The prior C2 `deploy-functions.yml` ran after changes to any backend source/migration and many game frontend files. It applied all missing allowlisted SQL, including billing/provisioning/deletion changes, before deploying a broad list of account, admin, billing, AI, provider and game endpoints. Reports saying “hold deployment” had no executable effect. A source or frontend release could therefore overwrite another repository's current backend, or initialize the billing recovery gate without completing its coordinated activation.

Current ownership was established from committed source and actual workflows:

| Owner | Evidence and result |
| --- | --- |
| Actual native War Room | [`skjjcruz/github.com-skjjcruz-owner-dashboard-dev` at `aa13193`](https://github.com/skjjcruz/github.com-skjjcruz-owner-dashboard-dev/blob/aa13193b28c552f977fa36a4683bb3a688d3da4f/.github/workflows/deploy-functions.yml) has an explicit owned set for account, billing, admin, AI, scoreboard and operational endpoints. Its `SHARED-CODE.md` separately assigns provider relays to ReconAI. The newer password-change endpoint belongs with this account release lane. |
| Actual ReconAI | Read-only GitHub metadata confirmed [`skjjcruz/ReconAI-sandbox-dev` at `78294c8`](https://github.com/skjjcruz/ReconAI-sandbox-dev/blob/78294c80cf483aab32b37ae046d6b645f03ccb72/.github/workflows/deploy-functions.yml) is active, not archived. Its current workflow deploys exactly ESPN, MFL and Yahoo proxies. The C2 workflow's claim about an archived C2 mirror does not establish ownership of these actual production endpoints. [Exact workflow evidence](evidence/current-reconai-deploy-78294c8.yml). |
| Actual public frontend | `skjjcruz/Owner-Dashboard---V6` at `db1701f` has no backend deployment workflow. A public frontend release does not establish backend ownership. |
| C2 WarRoom | `league-cup`, `time-league`, and `duat` have their current game implementation/build inputs here, appear in the established C2 release path, and are absent from the actual native/public source sets. They are the bounded C2 release allowlist. Retained non-game copies remain test/reconciliation material. |
| Separately managed or unknown | Existing `report-bug` and `feature-requests` are excluded from the native workflow's automatic owned set; C2 does not claim them. All unverified names fail closed until ownership is established. |

[Machine-readable source inventory](evidence/c2-backend-ownership-20260920.json) records exact revisions, present functions and repository URLs. It is provenance evidence, not a declaration that every endpoint is currently correct. The distinct actual-native one-time auth release mechanism is unchanged.

## Implemented boundary

- Normal C2 pushes validate but cannot access the release job. Only explicit `workflow_dispatch` on canonical C2 main can select a committed `.github/c2-releases/<name>.json`. The standing release authorization allows the agent to prepare, review and dispatch it; this is not a request for renewed user permission.
- The planner permanently permits only Cup, Vault and Duat. No missing history/manifest, shared-file change, manual rerun, or unknown endpoint falls back to a larger release.
- A manifest pins an exact ancestor baseline; the complete candidate delta; local import closure; configuration, compiler, package lock, shared game modules and data inputs; and generated runtime bytes. Later candidate changes, dirty inputs, symlinks, new unreviewed import maps/computed imports, missing files, changed generated data or a stale manifest stop the release. A single-game scope remains possible.
- Previous hosted version, gateway state and the complete source import closure must match immediately before each deployment. Download metadata is rechecked after source retrieval to reject a concurrent rollout during inspection. Cup's shared JavaScript outside `supabase/functions` is included. Vault can use the CLI's documented local Docker unbundler when server-side unbundling fails; completeness and exact hash checks still apply.
- There is no migration application path in this workflow or planner. Fixed read-only queries require the game's known migration prerequisites to be recorded and compare a reviewed catalog fingerprint. The fingerprint includes game/account relation structure, RLS/policies, table and column grants, indexes, triggers, view definitions, and public routine bodies/owners/grants. An unchanged migration version alone is not accepted as schema compatibility.
- Every selected function is checked again after deployment against candidate source, generated runtime and gateway state, with a newer hosted version required. The workflow retains its Cup, security, billing, Vault, Duat, all-source type-checking, and Vault Docker gates. Planner/catalog regressions are included in `test:security`.
- Tooling versions are fixed in the workflow where used: Node `20.20.2`, Deno `2.9.6`, Supabase CLI `2.84.2`; the existing canonical C2 shared pin `7bd3531` is preserved. No shared dependency revision or endpoint implementation was changed.

## Actual verification

- [18 planner/CLI behavior tests plus three catalog SQL groups](evidence/c2-edge-release-focused.log) passed. They cover push isolation, wrong repository/branch/missing manifest, every non-game category, single-game scope, source/data/compiler/generated drift, changed candidates, dropped/replaced schema prerequisites, hosted version/body/gateway drift, incomplete downloads, Vault fallback, concurrent change during download, and exact served import closure.
- The catalog query executed in disposable PGlite. RLS weakening, altered policy, changed account columns, changed routine body, direct table/column grants and index changes all changed the fingerprint despite the same recorded migration. No user records were queried. This is not hosted schema proof or independent-connection contention evidence.
- [Full current `test:security`](evidence/c2-edge-release-security.log) passed with the new guard suite. Existing expected failure-path logs were inspected. No existing assertions or coverage were removed.
- Actual Vault and Duat builders ran with Node `20.20.2`; the planner discovered their real import and build-input sets. Cup has three imported files; Vault has seven and a 15,548,013-byte generated runtime; Duat has three and a 3,073,322-byte runtime. [Exact input inventory and generated hashes](evidence/c2-game-build-inputs-20260920.json).
- Workflow YAML parsed successfully. `git diff --check` passed. No deploy manifest was prepared against hosted Supabase during this task, and no hosted verification/deployment is counted as passed. Independent tooling review is pending at this checkpoint.

## Authorized release procedure

1. Integrate this guard before a C2 source/frontend push that includes pending backend changes. Resolve the workflow conflict in favor of this scoped mechanism, retaining tests; do not restore old automatic migration/deployment entries. Merge package scripts with other agents' additions.
2. Finish and validate the intended game candidate. Rehearse any required schema change separately under its owning migration/cutover process, then verify it on the intended environment. Billing/provisioning/deletion and provider changes must use their owning source/release process.
3. From the clean committed candidate and the pinned tooling environment, run the read-only preparation command below for only the required game names. Use a new manifest path. The command builds runtimes, reads hosted sources/catalogs, and writes the local manifest; it never deploys or applies SQL.

   ```sh
   python3 scripts/c2-edge-release.py prepare \
     --head <full-candidate-commit> --base <full-reviewed-baseline> \
     --functions duat \
     --manifest .github/c2-releases/<release-name>.json
   ```

4. Independently review the exact manifest and compatibility evidence, commit only that manifest, and dispatch the workflow on the resulting main revision with its path. A review-driven source/evidence change requires regenerating the manifest. The agent may perform these authorized steps without asking the user to repeat approval.
5. Verify the completed workflow, source/version results and real post-release journeys. A mixed/failed deployment needs a fresh inspection and scoped recovery plan; an old manifest cannot silently overwrite the changed state on retry.

## Limits and next steps

This change cannot prevent the actual native/ReconAI owner workflows or another operator from changing the shared backend. It does not disable those external pipelines. Their upstream guards and any cross-repository coordination remain root-owned work. Hosted preflight narrows but does not eliminate the interval between the last read and Supabase accepting a deployment; the API is not treated as a compare-and-swap transaction. GitHub concurrency here serializes this repository only.

The fixed schema fingerprint deliberately includes public routine bodies because a game may depend on shared trigger/security behavior. An unrelated routine change can therefore stop a release and require renewed evidence. Missing or oversized/incomplete hosted source remains a blocker, never permission to omit it. The planner pins local source/build artifacts; it does not claim to solve every existing remote npm resolution constraint. No native binary, store, purchase, device, multiplayer, or entire-suite readiness claim follows from this tooling batch.
