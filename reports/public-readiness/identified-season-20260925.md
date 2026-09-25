# Identified seasons — 2026-09-25

Status: local implementation verified; production release pending. This is a bounded polish change; overall public readiness remains incomplete.

Branch: `codex/identified-seasons-20260925`. Starting source/evidence revision: `1557b92`; deployed application before this batch: `45b18264f9b08ef2e74726c77f659d8c9183b010`. Worktree: `/Users/jacobc/Projects/warroom-polish-20260925`. Original checkout preserved; Scout untouched.

## Acceptance

- Vault and Duat identify the exact season as soon as public archive inference has exactly one candidate.
- Multiple candidates, zero matches, missing/partial archives and unviewed simulated games never produce invented identification. An original public singleton is already identifiable.
- Compact rows, research and adjacent labels agree. Duat research defaults to the identified year unless the user explicitly selected a comparison.
- Scores, game rules, final-recap reveals, saves and private state remain unchanged.
- Focused regression suites and realistic phone/desktop journeys pass; independent review resolves material findings.
- Existing live and sandbox releases are verified by workflow, revision, served bytes and public guest browser journeys with isolated local saves.

## Reproduction and cause

Both games already narrow public candidates to one but display “1 possible year/season” beside “hidden year.” The UI fails to name an answer available from public evidence. No engine or backend rule change is needed.

## Ownership and checkpoint

Vault agent: public-inference helper, roster/research and small draft/stats copy updates. Duat agent: Explorer, adjacent draft metadata and Duat browser assertions. Independent reviewer: inference/privacy review and Vault browser assertions. Root: Game day, Home, championship labels and spoiler-cap wiring; integrated verification and release.

Next: finish meaningful boundary tests, run full Vault/Duat checks, compile from the pinned canonical shared source, run browser journeys, resolve review findings, then release and verify both existing destinations. Browser fixtures block external mutations before navigation; sandbox shares production backend and is not disposable.

## Local validation checkpoint

- `npm test`: all 43 suites pass, zero failures/quarantines (112.7s). Full Vault suite includes complete shuffled and hidden-year seasons with 92 save/reload actions each. Full Duat suite 403/403, no skips/todo/cancellations. Core 97/97, auth 20 restoration scenarios plus recovery, security and design-token checks pass.
- New Vault integration test covers consistent Game day/box/Home/championship labels, missing archives, ambiguity, malformed caps, pending autoplay, unfinished first playback and replay retention. Deliberately wrong private year never replaces the public inference.
- Compiled browser: Vault 4/4 sizes (320×740,390×844,667×375,1440×1000), Duat 4/4 same sizes, real historical fixtures and isolated browser-local saves. Vault final-whistle test requires at least one new identification; all four sizes showed two newly identified players at final while Q1 remained capped. Duat 64 journey assertions including selection, research defaults/manual comparisons, save/reload and opening-week privacy.
- Both browser runners exited 0. Vault initial test-oracle failure came from DOM text concatenation; the corrected oracle checks actual visible `innerText`, retains strict per-player year equality and passed all sizes. Duat initial boot timeout did not reproduce after the compiled runtime settled; diagnostic and failed log retained.
- Source lint and diff whitespace checks pass. The final setup-only copy correction passed the setup interaction/recovery test and lint; production CI will recheck integrated Vault/Duat.
- Browser evidence and logs: [identified-season-20260925/](identified-season-20260925/). Independent review: [review](identified-season-independent-review-20260925.md).

## Release compatibility and recovery

Frontend-only labels/copy; no migrations, backend deployment, saved-data schema, private state, scoring or game-rule changes. Canonical shared source remains pinned at `7bd35313fc78e25a2d1ac24035989673a93f28e6`. Existing saves require no transformation. Recovery: revert this frontend application commit through the existing Pages pipeline on both destinations; prior served application `45b18264f9b08ef2e74726c77f659d8c9183b010` remains the known recovery reference. No data rollback required.

Evidence limits: browser-emulated devices and controlled local guest fixtures do not establish physical-device/native/store or real-account multiplayer readiness. Duat missing/empty archive loading is covered; arbitrary malformed partial archive maps are outside its unchanged atomic-load contract. Overall public launch status is still incomplete.
