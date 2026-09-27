# Vault and Duat scouting workspace

## Delivered scope

- Shared three-player comparison and inline draft scouting; reusable lineup
  comparison uses public weekly outlook, remaining points and period-labeled
  averages. Missing values stay unavailable, zero remains valid, and estimates
  and hidden-season uncertainty are explicit.
- Saved column, sort and density preferences plus room/seat-scoped research IDs
  and search. Player objects, scores, account credentials and hidden draws are
  not written to preference storage.
- Responsive desktop research panes, compact roster support, phone comparison
  scrolling, keyboard focus handling and accessible action feedback.
- Duat public archive research between picks. Rival picks/private draws do not
  influence archive membership, counts or ranking; legal candidates and pick
  authority remain turn-scoped. Matching public archive revisions omit repeated
  rows; the client merges only the same credential, room, faction, army and
  revision from its in-memory server-approved cache.
- Pick receipts preserve context on rejected saves and highlight authoritative
  roster additions. Explicit room health/retry, joined/readiness counts and
  synchronous Duat duplicate-action protection.
- Duat preparation now gates prior-score rendering at the viewed-week boundary,
  including truthful estimate period labels.

## Verification

Shared board/comparison18 interaction suites and room-status lifecycle tests
passed. Full Vault chain passed, including real archive lifecycles and sealed
state/endpoint checks. Full Duat suite passed429 tests; the cache endpoint and
receipt tests were rerun afterward. Guest client, actual SQL and endpoint tests,
login recovery32 cases, design tokens and changed-source lint passed. Independent
reviews covered public scouting, guest migration, room recovery and source
recovery used by the release guard.

Real browser fixture journeys covered comparison/preferences across reload,
quick scout/full cards, queue, rejected save/retry/confirmed pick, and lineup
comparison at desktop and phone widths. No page overflow or uncaught page errors
were observed in the final game journeys. External writes were blocked in these
fixtures; they are not hosted multiplayer or physical-device evidence.

## Release preparation

Guest migration20260926010000 was applied in a separately reviewed atomic SQL
transaction that also recorded the exact version/name/source. Catalog checks
verified RLS and service-only claim execution. The migration itself creates no
accounts or game rooms. Independent rehearsal covered duplicate rejection and
full rollback if the history write fails. Guest claims require retaining the
schema/identity mappings if the frontend later rolls back.

Supabase's multipart Vault download returned500. A bounded read-only fallback
now recovers original TypeScript from source maps and unchanged JavaScript from
the raw ESZIP, without executing bundle code. Pinned parser tooling is denied the
management credential. Existing exact import-closure, scope and before/after
host-version checks still apply. All recovered Duat hashes matched the normal
CLI download, and Vault's complete seven-file version40 closure was recovered.
Release guard27 tests, actual catalog tests and extractor tests passed.

The frontend, game-function and hosted verification outcome will be recorded
below after the release. A current account login is still needed for the final
hosted account/guest multiplayer journey; previous QA credentials were rejected.
