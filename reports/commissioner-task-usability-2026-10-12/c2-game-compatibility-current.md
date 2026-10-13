# Read-only C2 game compatibility refresh

Observed 2026-10-13T00:09:04.782076+00:00 on project `sxshiqyxhhifvtfqawbq` after the account-owned ignored-task migration. The exact fixed C2 schema query and selected migration registry queries were executed read-only through the authenticated owner CLI. No user rows were queried, no game function was deployed, and no frozen manifest was edited.

Cup (`league-cup`), Vault (`time-league`) and Duat all have every required migration recorded. The guest-session table and claim routine required by Vault/Duat are present. The new account migration is recorded. The prior release receipt establishes that all 36 pre-existing Edge Function versions and bundle hashes stayed unchanged and only the new private account tables/routines were added.

The current fixed catalog fingerprint is `b8e793ec618f71996a7430099a5604df6b39e93720d7b8f62d1758ca2621ed25` (15 selected relations, 47 public routines). The two new private account tables are outside its relation filter. Its routine filter includes all public routines, so all three new ignored-task routines are included. Registry version values are prerequisite checks, not inputs to the catalog digest; the new registry row alone does not change the fingerprint.

The three September frozen Vault/Duat manifests record `8a90ac2cf5f0c1ac73ac15cf46f39ab0d203a3e9a59752af92f0186267e10596`, which differs. Their exact files were preserved. Removing only the three new routines from the current snapshot yields `8870311634ce17c0daeb810bd2dcee21d7d52ff66472ed0e6ef971d19eb4c81f`; this still differs, so the new routines do not explain the entire difference from that historical baseline. This counterfactual is not a captured pre-release snapshot, and remaining historical drift is unclassified.

The current prerequisite checks pass; the old frozen manifests would fail current schema verification and must not be reused for a new game deployment. A future authorized game release needs new prepared and reviewed compatibility evidence. This metadata check did not find a new game contract defect and does not gate this frontend release, which deploys no games. It is not authenticated game-behavior proof.

See [machine-readable evidence](c2-game-compatibility-current.json), [fixed catalog response](c2-game-schema-current.json), [registry response](c2-game-registry-current.json), and [account release receipt](ignored-backend-release-receipt.json).
