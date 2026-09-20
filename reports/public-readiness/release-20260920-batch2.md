# C2 recovery release candidate — September20

State: preparation; no second-batch frontend deployment yet. Scope is the existing C2 WarRoom and WarRoom-sandbox frontends. The actual dhqfootball.com and native repositories remain separate upstream proposals. This is a repair batch, not entire-suite launch sign-off.

## Candidate and evidence

The integration contains current remote main4c4c4e97b742acc5b4696808d290ab1d7784410e, preserving the separately released PPG work. Product code51ef4e3 plus documentation checkpoints is validated:43automated suites pass,0quarantines; all12browser suites pass;147Babel sources build; all retained Edge entrypoints pass Deno with isolated dependency behavior. No original-checkout edits are included. Detailed logs: integrated-all-tests-checkout-guard-corrected-sep20.log, integrated-browser-checkout-guard-sep20.log, integrated-build-checkout-guard-sep20.log, integrated-edge-deno-sep20.log under evidence/.

This frontend batch includes reviewed Commissioner plan/save recovery, historical league routes, format-aware Empire capital/advice, Vault invitation/session recovery, account-isolated callbacks and Settings password rotation. Canonical C2 shared7bd35313fc78e25a2d1ac24035989673a93f28e6 remains pinned and the player-value twin matches. Actual shareddedbb161 is a different owner source and is not substituted into C2.

## Backend compatibility and ownership

No Cup/Vault/Duat entrypoint differs from4c4c4e9. The Settings password endpoint and additive account-password/provisioning functions are already deployed/applied; restored account/reset source and dependency hashes were verified at16:26UTC, with versions unchanged at16:54UTC. Controlled reset/password competition and session revocation, same Duat save recovery and current profile access passed as separately timestamped evidence.

The permanent C2 workflow guard validates normal pushes without any backend release or SQL writes. Only explicit committed reviewed manual manifests can deploy Cup/Vault/Duat. It cannot redeploy account, billing, deletion, admin or provider functions. Pending billing10000/checkout50000/deletion40000/60000 schema and writers remain held, and this frontend batch does not enable them. Billing transfer ownership/configuration and native/auth source integration remain separate blockers. Independent bounded release compatibility review is pending at preparation; earlier substantive fixes have individual review evidence.

## Release and recovery

1. Confirm both C2 main heads still4c4c4e9 and the candidate is their descendant. Commit the concrete preparation record and deploy only the exact selected revision, without force push. Preserve unrelated working files.
2. Follow the established fast-forward main release process on canonical and sandbox. Verify each Pages and CI workflow reaches terminal success. The canonical backend workflow must validate only; its release job must stay skipped for push.
3. Check release.json revision/repository, every advertised served asset hash and entry route on both C2 sites. Run post-deploy browser journeys with external mutations guarded, including the restored account path where safely possible. A push or successful build is not completion.
4. If a frontend regression requires recovery, rerun only the previous known-good frontend Pages workflow: canonical35517680678 and sandbox35517682249, both4c4c4e9. Verify the served rollback revision/assets. This preserves the new source-level backend guard. Do not restore the old blanket backend deployment workflow or force-push shared history.

Previous verified live assets: evidence/release-4c4c4e9.json. Previous successful workflows: https://github.com/C2-Football/WarRoom/actions/runs/35517680678 and https://github.com/C2-Football/WarRoom-sandbox/actions/runs/35517682249. New workflow IDs, exact selected release revision, compatibility disposition, served verification and post-deploy results will be appended after actual actions.
