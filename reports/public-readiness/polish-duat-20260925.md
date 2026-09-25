# The Duat polish — 25 September 2026

Worktree: `warroom-polish-20260925`; baseline `07d779d`. Scope: existing entry, setup, Home and weekly preparation UI. No game rules, data sources, private-state boundaries, shared service code or native packaging changes.

## What changed

- Unified desktop and phone around the accepted teal, bronze and mythic serif identity. Reused existing Duat artwork for the phone entry and current-action card; no new images or speculative features.
- Made selected play modes visibly distinct on phones. The previous broad phone styling made selected and unselected borders match.
- Put game mode, faction selection and introductory instructions in labeled, keyboard-operable disclosures at desktop sizes too. All choices remain present. The main form leads with campaign creation; detailed learning material sits beside it on desktop.
- Shortened entry copy and removed repeated weekly summaries and duplicated alliance timing. Detailed scoring, favor, alliance and conquest guidance remains in “How this works.” Resurrection's unavailable-feed warning and preview-only gate remain explicit.
- Removed a nested lineup panel border/padding layer so player names have more room. Preserved one current weekly action, measured action spacing, safe areas and the phone dock. A real 667×375 interaction failure exposed crowded fixed bars: the short-landscape header and dock now use a compact layout while retaining 44px touch targets, and roster checkboxes can be reached and toggled normally.
- Reproduced creating a campaign leaving the draft scrolled partway down. A campaign/phase transition now focuses and reveals the new draft/excavation content; same-phase draft picks do not reset scroll.

Production files: `duat-polish.css`, `js/tabs/duat.js`, `js/components/duat-season-home.js`, `js/components/duat-weekly-flow.js`, `js/components/duat-heptad.js`. Root integrated the stylesheet after the existing Duat phone styles in `index.html`.

## Verification

- Final `npm run test:duat`: **392 passed, 0 failed, 0 skipped**. Evidence: `polish-duat-tests-20260925.log`.
- ESLint on all four modified JS files and `git diff --check`: passed.
- Browser method: actual local app, real historical archive/engine campaign fixture, disposable browser contexts, all hosted backends and external mutations blocked. React 18.3.1, ReactDOM 18.3.1 and Supabase 2.101.1 are fetched by their exact configured version and fulfilled locally after a CDN navigation timeout. Irrelevant remote webfonts are omitted; Duat's Georgia/system typography is preserved.
- Final browser matrix in `tests/duat-polish-browser.cjs`: **all four journeys passed** at 320×740, 390×844, 667×375 and 1440×1000. Checks cover visible selected mode, Resurrection preview warning, faction search, actual creation and a draft pick, creation scroll, Home/alliance, lineup legality, saved weekly step after reload, kickoff availability; phones also cover Realm calendar, backup export and More/Escape dismissal. Every current action measured 50px high, with no horizontal overflow, no action/dock overlap and zero page exceptions. Durable numeric evidence: `polish-duat-browser-evidence-20260925.json`. Full layout evidence: [browser results](polish-20260925/checks/browser-evidence.json). [Durable before/after images](polish-20260925/README.md) include entry, Home, lineup and the independent final short-landscape capture.
- Initial harness selector matched a nested summary rather than the outer Realm disclosure. Corrected to its direct-child summary; original failure preserved. A separate fresh browser run timed out fetching a CDN dependency; preserved and addressed by the exact-version local dependency fulfillment above. Neither harness/dependency failure required weakening product checks. The later short-landscape checkbox interception was a product defect; its failing output is preserved as [browser-landscape-control-failure.log](polish-20260925/checks/browser-landscape-control-failure.log), and the final run passed the same checkbox interactions after the compact-bar fix.
- Independent review by the Vault agent found no material issue: `polish-duat-independent-review-20260925.md`. Keyboard use, source/rules preservation, 320 and short-landscape controls, More/Escape and unchanged fixture state were independently checked.

## Evidence limits

This batch is local visual and browser verification. It does not establish native installation, physical-device behavior, hosted multiplayer operation, current NFL feed availability, or a production deployment. Existing broader launch-readiness blockers remain tracked by the root task.

## Durable browser release gate integration

Commissioner integration agent added this journey to `scripts/run-browser-tests.cjs` and changed its browser import to the directly declared `@playwright/test`. It now honors `READINESS_PREVIEW_ORIGIN` and defaults to `/dist-preview/`; standalone `READINESS_PREVIEW_PATH`, `READINESS_PREVIEW_URL`, or `DUAT_POLISH_URL` can select a development/deployed entry. The release runner clears standalone URL overrides and always tests its own fresh compiled origin. Evidence records the actual target origin/path.

Duat's request fence rejects all mutation methods before allowing same-origin static assets, including when a hosted URL is explicitly selected. No game or production source was changed by this integration.

Final integration check: the durable Duat journey passed at 320×740, 390×844, 667×375 and 1440×1000 against the freshly compiled `http://127.0.0.1:3025/dist-preview/`. Creation, a real draft pick, saved weekly-step recovery, invalid-lineup gating, kickoff and layout checks pass; phones additionally exercise Realm, backup export and Escape dismissal. [Compiled run](polish-duat-compiled-browser-20260925.log), [target and request-isolation evidence](polish-duat-compiled-browser-evidence-20260925.json), [build](polish-new-browser-build.log).
