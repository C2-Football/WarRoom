# C2 recovery release candidate — September20

State: released and independently verified on both C2 frontends at944c2e9d889a1103b48475ce46133bcd97282cc1. Scope is the existing C2 WarRoom and WarRoom-sandbox frontends. The actual dhqfootball.com and native repositories remain separate upstream proposals. This is a repair batch, not entire-suite launch sign-off.

## Candidate and evidence

The integration contains current remote main4c4c4e97b742acc5b4696808d290ab1d7784410e, preserving the separately released PPG work. Product code51ef4e3 plus documentation checkpoints is validated:43automated suites pass,0quarantines; all12browser suites pass;147Babel sources build; all retained Edge entrypoints pass Deno with isolated dependency behavior. No original-checkout edits are included. Detailed logs: integrated-all-tests-checkout-guard-corrected-sep20.log, integrated-browser-checkout-guard-sep20.log, integrated-build-checkout-guard-sep20.log, integrated-edge-deno-sep20.log under evidence/.

This frontend batch includes reviewed Commissioner plan/save recovery, historical league routes, format-aware Empire capital/advice, Vault invitation/session recovery, account-isolated callbacks and Settings password rotation. Canonical C2 shared7bd35313fc78e25a2d1ac24035989673a93f28e6 remains pinned and the player-value twin matches. Actual shareddedbb161 is a different owner source and is not substituted into C2.

## Backend compatibility and ownership

No Cup/Vault/Duat entrypoint differs from4c4c4e9. The Settings password endpoint and additive account-password/provisioning functions are already deployed/applied; restored account/reset source and dependency hashes were verified at16:26UTC, with versions unchanged at16:54UTC. Controlled reset/password competition and session revocation, same Duat save recovery and current profile access passed as separately timestamped evidence.

The permanent C2 workflow guard validates normal pushes without any backend release or SQL writes. Only explicit committed reviewed manual manifests can deploy Cup/Vault/Duat. It cannot redeploy account, billing, deletion, admin or provider functions. Pending billing10000/checkout50000/deletion40000/60000 schema and writers remain held, and this frontend batch does not enable them. Billing transfer ownership/configuration and native/auth source integration remain separate blockers. Independent bounded release compatibility review is clear at6fc76c0: existing frontend contracts match the host, no game runtime changed, and the held writers/schema are not required. Focused related contracts passed independently; all8 hosted account versions remain as restored. See c2-frontend-compatibility-independent-20260920.md and its evidence.

## Release and recovery

1. Confirm both C2 main heads still4c4c4e9 and the candidate is their descendant. Commit the concrete preparation record and deploy only the exact selected revision, without force push. Preserve unrelated working files.
2. Follow the established fast-forward main release process on canonical and sandbox. Verify each Pages and CI workflow reaches terminal success. The canonical backend workflow must validate only; its release job must stay skipped for push.
3. Check release.json revision/repository, every advertised served asset hash and entry route on both C2 sites. Run post-deploy browser journeys with external mutations guarded, including the restored account path where safely possible. A push or successful build is not completion.
4. If a frontend regression requires recovery, rerun only the previous known-good frontend Pages workflow: canonical35517680678 and sandbox35517682249, both4c4c4e9. Verify the served rollback revision/assets. This preserves the new source-level backend guard. Do not restore the old blanket backend deployment workflow or force-push shared history.

Previous verified live assets: evidence/release-4c4c4e9.json. Previous successful workflows: https://github.com/C2-Football/WarRoom/actions/runs/35517680678 and https://github.com/C2-Football/WarRoom-sandbox/actions/runs/35517682249. New workflow IDs, exact selected release revision, compatibility disposition, served verification and post-deploy results will be appended after actual actions.

## Verified release outcome

Exact selected revision `944c2e9d889a1103b48475ce46133bcd97282cc1` was fast-forwarded to both main branches. All six workflows completed successfully. Canonical Pages35525512110, CI35525512138 and game validation35525512200; sandbox Pages35525513723, CI35525513589 and game validation35525513633. Both backend release jobs were skipped as required; no function deployment or SQL ran. [Exact heads and workflow evidence](evidence/release-944c2e9-workflows.json).

Both served release.json revisions/repositories match. Every advertised game asset plus content-hashed entry script was downloaded and hashed:327 assets and13 entry pages per site passed. No runtime Babel remains in those entries. [Served evidence](evidence/release-944c2e9.json).

Actual served frontend browser checks pass on both sites with isolated backend fixtures: Settings password recovery at320/390/844, Vault401 stop-polling/sign-in/reopen at320, and Empire save failure/back navigation/retry/reload at390. These use production page/script bytes while intercepting provider/account writes; they are not live password or Vault mutations. Logs are evidence/batch2-served-{password,vault,empire}-{canonical,sandbox}.log.

Separately, real deployed password sign-in for the exact controlled account and hosted Duat friends-list/open/reload/reopen pass on both sites. The existing owned room remains revision113, cycle2, Week1; only list/load room actions were allowed. The390px next action is at least44px tall, hit-test reachable, and the page has no horizontal overflow. Root visually inspected the canonical phone screenshot. [Real hosted journey](evidence/batch2-live-c2-reopen-sep20.json). The first harness attempt mistakenly waited for the desktop season-home class; source inspection established the dedicated phone heading/action, which the corrected harness asserts without changing the product or reducing the expected journey. The original failure is retained in batch2-live-c2-reopen-original-locator-sep20.*.

Read-only postflight confirms all8 restored account versions unchanged. [Postflight](evidence/batch2-account-version-postflight.json). This remains timestamped metadata evidence, not control over other owning deployments. Both existing C2 destinations are verified for this repair batch; actual public-domain/native proposals, billing/transfer cutover and whole-suite launch gates remain open.
