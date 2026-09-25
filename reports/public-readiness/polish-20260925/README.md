# Suite polish evidence — 25 September 2026

These are unmodified captures of the actual local application. Management data uses synthetic QA leagues/accounts; the games use disposable local saves and the existing historical archive. Hosted writes were blocked. The yellow **LOCAL DEV** ribbon is part of the local preview. This package is responsive-browser evidence, not live deployment, hosted-account, multiplayer, native-build or physical-device proof.

Phone and desktop refer to browser viewport widths. Some screenshots show the full scrolled page, so their image height exceeds the viewport. Numbers and selected disclosures can differ between fixture runs; the images compare presentation, not portfolio calculations.

## Before and after

| Product | Representative before | Phone after | Desktop after |
|---|---|---|---|
| Dynasty HQ | [Desktop](hub/before-desktop.png) | [390](hub/after-hub-390.png) | [1440](hub/after-hub-1440.png) |
| Empire | [390](empire/empire-before-390.png) | [390](empire/review-empire-390.png) | [1440](empire/review-empire-1440.png) |
| Commissioner | [390](commissioner/before-overview-390.png) · [1440](commissioner/before-overview-1440.png) | [390](commissioner/after-overview-390.png) · [320](commissioner/after-overview-320.png) | [1440](commissioner/after-overview-1440.png) |
| The Vault | [390](vault/before-lobby-390.png) · [1440](vault/before-lobby-1440.png) | [390](vault/after-lobby-390.png) | [1440](vault/after-lobby-1440.png) |
| The Duat | [390](duat/before-entry-390.png) | [390](duat/entry-390.png) | [1440](duat/entry-1440.png) |

Hub after images are root's captures with artwork loaded. Empire after images are the final independent review captures; its phone snapshot is expanded with keyboard focus visible. The independent management harness blocks some image requests, so its original Hub captures were not selected for this visual comparison. No screenshots have been retouched or recompressed.

## Actions and game screens

- Commissioner: Rule Lab [before](commissioner/before-rules-390.png) / [after](commissioner/after-rules-390.png), [phone workspace menu](commissioner/after-menu-390.png).
- Vault: [draft](vault/after-draft-390.png), completed-draft Home on [phone](vault/after-home-390.png) / [desktop](vault/after-home-1440.png), [era disclosure at 320](vault/review-era-320.png). The earlier draft capture precedes the final removal of its duplicated draft-status pill; later source and focused checks cover that copy-only correction.
- Duat: [Home on phone](duat/home-390.png), [lineup](duat/lineup-390.png), [final independent 667×375 checkbox interaction](duat/duat-final-landscape-checkboxes-667.png). Earlier review captures remain in this folder for provenance; the final short-landscape correction and all-eight-checkbox check supersede the earlier geometry-only review.

## Verification records

- [Hub and Empire independent browser log](checks/root-independent-browser.log) and [review](../polish-hub-empire-independent-review-20260925.md).
- [Commissioner browser results](checks/browser-results.json), [browser log](checks/browser.log), [focused suite](checks/commish-tests.log), [handoff regression before](checks/command-before-regression.log) / [after](checks/command-after-regression.log), and [product report](../polish-commish-20260925.md).
- [Vault tests](../polish-vault-tests-20260925.log), [product report](../polish-vault-20260925.md), and [independent review](../polish-vault-independent-review-20260925.md).
- [Duat full browser results](checks/browser-evidence.json), [durable numeric matrix](../polish-duat-browser-evidence-20260925.json), [tests](../polish-duat-tests-20260925.log), [product report](../polish-duat-20260925.md), and [independent final review](../polish-duat-independent-review-20260925.md). Initial harness, CDN and landscape-failure logs are retained in `checks/`; the product report explains their resolutions.

Root also preserved related integration captures in `related-checks/`; these additional files are outside the copied-file manifest unless their original local source could be matched.

[Manifest](manifest.json) records original paths, byte sizes and SHA-256 hashes for every copied file. All copied files were checked byte-for-byte against their originals. The complete directory is under 6 MB. Deployment and suite-readiness status belong to the separate [master checkpoint](../polish-20260925.md).
